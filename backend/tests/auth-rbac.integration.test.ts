import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import jwt from 'jsonwebtoken';
import { parse } from 'dotenv';
import { runner } from 'node-pg-migrate';
import pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { hashPassword } from '../src/auth/password.js';
import type { Role } from '../src/types/auth.js';

function loadDbSettings() {
  let local: Record<string, string> = {};
  try {
    local = parse(readFileSync(new URL('../../.env', import.meta.url)));
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
  }
  const env = { ...local, ...process.env };
  const host = env.DB_HOST || '127.0.0.1';
  const port = Number(env.DB_PORT || 5432);
  const adminConfig: pg.ClientConfig = env.MIGRATION_DATABASE_URL
    ? { connectionString: env.MIGRATION_DATABASE_URL }
    : {
        host,
        port,
        database: env.DB_NAME || 'fashion_dev',
        user: 'db_admin',
        password: env.POSTGRES_PASSWORD,
        connectionTimeoutMillis: 3000,
      };
  return { env, host, port, adminConfig };
}

describe('Auth + RBAC Integration (Express + real PostgreSQL 17.9)', () => {
  const { env, host, port, adminConfig } = loadDbSettings();
  const dbName = `auth_rbac_test_${randomBytes(6).toString('hex')}`;
  const jwtSettings = {
    secret: randomBytes(32).toString('hex'),
    issuer: 'fashion-api',
    audience: 'fashion-web',
  };

  let adminClient: pg.Client;
  let testAdminClient: pg.Client;
  let appPool: pg.Pool;
  let app: ReturnType<typeof createApp>;

  const seededUsers = new Map<Role, { id: number; email: string; password: string }>();

  beforeAll(async () => {
    adminClient = new pg.Client(adminConfig);
    await adminClient.connect();
    await adminClient.query(`CREATE DATABASE "${dbName}" TEMPLATE template0`);

    const targetAdminConfig: pg.ClientConfig = adminConfig.connectionString
      ? {
          connectionString: (() => {
            const url = new URL(adminConfig.connectionString);
            url.pathname = `/${dbName}`;
            return url.href;
          })(),
        }
      : { ...adminConfig, database: dbName };

    await runner({
      databaseUrl: targetAdminConfig,
      dir: fileURLToPath(new URL('../../database/migrations/', import.meta.url)),
      migrationsTable: 'pgmigrations',
      direction: 'up',
      checkOrder: true,
      log: () => undefined,
    });

    await adminClient.query(`GRANT CONNECT ON DATABASE "${dbName}" TO app_rw_user`);

    testAdminClient = new pg.Client(targetAdminConfig);
    await testAdminClient.connect();

    // Connect application pool as least-privilege runtime role app_rw_user
    if (env.DB_PASSWORD) {
      appPool = new pg.Pool({
        host,
        port,
        database: dbName,
        user: 'app_rw_user',
        password: env.DB_PASSWORD,
        max: 10,
      });
    } else {
      appPool = new pg.Pool({ ...targetAdminConfig, max: 10 });
      appPool.on('connect', (client) => {
        void client.query('SET ROLE app_rw_user');
      });
    }

    // Seed one user for each back-office role (CUSTOMER is registered through API)
    const password = 'StaffPassword!123';
    const pwHash = await hashPassword(password);
    for (const role of ['SALES', 'WAREHOUSE', 'MARKETING', 'ADMIN'] as const) {
      const email = `${role.toLowerCase()}@auth-test.invalid`;
      const row = (await testAdminClient.query<{ id: number }>(
        `INSERT INTO app.users(full_name, email, password_hash, role, is_active)
         VALUES($1, $2, $3, $4, TRUE) RETURNING id`,
        [`Seed ${role}`, email, pwHash, role],
      )).rows[0];
      if (!row) throw new Error('Seed failed');
      seededUsers.set(role, { id: row.id, email, password });
    }

    app = createApp({
      checkDatabase: async () => { await appPool.query('SELECT 1'); },
      frontendOrigin: 'http://localhost:5173',
      pool: appPool,
      jwt: jwtSettings,
      loginRateLimit: {
        windowMs: 60_000,
        maxAttemptsPerAccount: 4,
        maxAttemptsPerIp: 50,
      },
      mountTestRoutes(expressApp, helpers) {
        // Test routes verifying 5-role policy & customer resource ownership isolation
        expressApp.get(
          '/api/_rbac/cart',
          helpers.requireAuth,
          helpers.requirePermission('cart:manage'),
          (_req, res) => res.json({ success: true, data: { scope: 'cart' } }),
        );
        expressApp.get(
          '/api/_rbac/orders/transition',
          helpers.requireAuth,
          helpers.requirePermission('orders:transition'),
          (_req, res) => res.json({ success: true, data: { scope: 'orders:transition' } }),
        );
        expressApp.get(
          '/api/_rbac/inventory/import',
          helpers.requireAuth,
          helpers.requirePermission('inventory:import'),
          (_req, res) => res.json({ success: true, data: { scope: 'inventory:import' } }),
        );
        expressApp.get(
          '/api/_rbac/vouchers/manage',
          helpers.requireAuth,
          helpers.requirePermission('vouchers:manage'),
          (_req, res) => res.json({ success: true, data: { scope: 'vouchers:manage' } }),
        );
        expressApp.get(
          '/api/_rbac/customer-resource/:ownerId',
          helpers.requireAuth,
          helpers.requireRole(['CUSTOMER', 'SALES', 'ADMIN']),
          helpers.requireSelfOrRoles(
            (req) => {
              const id = Number(req.params.ownerId);
              return Number.isInteger(id) && id > 0 ? id : null;
            },
            ['SALES', 'ADMIN'],
            { concealAsNotFound: true },
          ),
          (req, res) => res.json({ success: true, data: { owner_id: Number(req.params.ownerId) } }),
        );
      },
    });
  }, 30_000);

  afterAll(async () => {
    await appPool?.end().catch(() => undefined);
    await testAdminClient?.end().catch(() => undefined);
    if (adminClient) {
      await adminClient.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`).catch(() => undefined);
      await adminClient.end().catch(() => undefined);
    }
  });

  async function loginAs(email: string, password: string) {
    const res = await request(app).post('/api/auth/login').send({ email, password });
    expect(res.status).toBe(200);
    return res.body.data.access_token as string;
  }

  it('registers CUSTOMER, creates cart, hashes password with Argon2id, and prevents role injection & duplicates', async () => {
    const res = await request(app).post('/api/auth/register').send({
      full_name: '  Nguyễn Văn Khách  ',
      email: '  KhachHang1@Example.INVALID  ',
      password: 'ValidPassword!123',
      phone: '0901234567',
    });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({
      full_name: 'Nguyễn Văn Khách',
      email: 'khachhang1@example.invalid',
      phone: '0901234567',
      role: 'CUSTOMER',
      is_active: true,
    });
    expect(res.body.data.password_hash).toBeUndefined();
    expect(res.body.data.token_version).toBeUndefined();
    expect(res.body.data.access_token).toBeUndefined();

    // Verify DB state: Argon2id hash & auto-created cart
    const dbUser = (await testAdminClient.query<{ password_hash: string; role: string }>(
      'SELECT password_hash, role FROM app.users WHERE id = $1',
      [res.body.data.id],
    )).rows[0];
    expect(dbUser).toBeDefined();
    if (!dbUser) throw new Error('Missing user');
    expect(dbUser.role).toBe('CUSTOMER');
    expect(dbUser.password_hash).toMatch(/^\$argon2id\$v=19\$/);
    expect(dbUser.password_hash).not.toContain('ValidPassword!123');
    const cartRow = (await testAdminClient.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM app.carts WHERE user_id = $1',
      [res.body.data.id],
    )).rows[0];
    expect(cartRow?.n).toBe(1);

    // Duplicate email (case-insensitive) -> 409 EMAIL_EXISTS
    const dup = await request(app).post('/api/auth/register').send({
      full_name: 'Another Name',
      email: 'KHACHHANG1@example.invalid',
      password: 'ValidPassword!123',
    });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('EMAIL_EXISTS');

    // Role injection rejected -> 400 VALIDATION_ERROR
    const roleInject = await request(app).post('/api/auth/register').send({
      full_name: 'Attacker',
      email: 'attacker@example.invalid',
      password: 'ValidPassword!123',
      role: 'ADMIN',
    });
    expect(roleInject.status).toBe(400);
    expect(roleInject.body.error.code).toBe('VALIDATION_ERROR');

    // Short password rejected -> 400 VALIDATION_ERROR
    const shortPw = await request(app).post('/api/auth/register').send({
      full_name: 'Short PW',
      email: 'short@example.invalid',
      password: 'short',
    });
    expect(shortPw.status).toBe(400);
    expect(shortPw.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('handles login success, identical 401 failures, and rate limiting with Retry-After', async () => {
    const ok = await request(app).post('/api/auth/login').send({
      email: 'KHACHHANG1@example.invalid',
      password: 'ValidPassword!123',
    });
    expect(ok.status).toBe(200);
    expect(ok.body.data.token_type).toBe('Bearer');
    expect(ok.body.data.expires_in).toBe(1800);
    expect(ok.body.data.user.role).toBe('CUSTOMER');
    expect(ok.body.data.user.password_hash).toBeUndefined();

    const wrongPw = await request(app).post('/api/auth/login').send({
      email: 'khachhang1@example.invalid',
      password: 'WrongPassword!123',
    });
    expect(wrongPw.status).toBe(401);
    expect(wrongPw.body.error.code).toBe('INVALID_CREDENTIALS');

    const unknownEmail = await request(app).post('/api/auth/login').send({
      email: 'nobody@example.invalid',
      password: 'WrongPassword!123',
    });
    expect(unknownEmail.status).toBe(401);
    expect(unknownEmail.body.error.code).toBe('INVALID_CREDENTIALS');
    expect(unknownEmail.body.message).toBe(wrongPw.body.message);

    // Rate limit triggered after 4 attempts for the same account
    for (let i = 0; i < 3; i += 1) {
      const r = await request(app).post('/api/auth/login').send({
        email: 'ratelimit@example.invalid',
        password: 'WrongPassword!123',
      });
      expect(r.status).toBe(401);
    }
    const fourth = await request(app).post('/api/auth/login').send({
      email: 'ratelimit@example.invalid',
      password: 'WrongPassword!123',
    });
    expect(fourth.status).toBe(401);

    const limited = await request(app).post('/api/auth/login').send({
      email: 'ratelimit@example.invalid',
      password: 'WrongPassword!123',
    });
    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe('RATE_LIMITED');
    expect(Number(limited.headers['retry-after'])).toBeGreaterThanOrEqual(1);
  });

  it('rejects missing, malformed, tampered, and expired JWT tokens on /api/auth/me', async () => {
    const token = await loginAs('khachhang1@example.invalid', 'ValidPassword!123');
    const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
    expect(me.status).toBe(200);
    expect(me.body.data.email).toBe('khachhang1@example.invalid');
    expect(me.body.data.password_hash).toBeUndefined();
    expect(me.body.data.token_version).toBeUndefined();

    // Missing token
    const missing = await request(app).get('/api/auth/me');
    expect(missing.status).toBe(401);
    expect(missing.body.error.code).toBe('INVALID_TOKEN');

    // Non-Bearer scheme
    const badScheme = await request(app).get('/api/auth/me').set('Authorization', `Basic ${token}`);
    expect(badScheme.status).toBe(401);

    // Tampered token
    const tampered = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}x`);
    expect(tampered.status).toBe(401);

    // Expired token
    const expired = jwt.sign(
      { id: me.body.data.id, role: 'CUSTOMER', ver: 0 },
      jwtSettings.secret,
      { algorithm: 'HS256', issuer: jwtSettings.issuer, audience: jwtSettings.audience, expiresIn: -5 },
    );
    const expiredRes = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${expired}`);
    expect(expiredRes.status).toBe(401);
    expect(expiredRes.body.error.code).toBe('INVALID_TOKEN');
  });

  it('enforces 5-role policy and denies insufficient roles with 403 FORBIDDEN', async () => {
    const customerToken = await loginAs('khachhang1@example.invalid', 'ValidPassword!123');
    const salesToken = await loginAs(seededUsers.get('SALES')!.email, seededUsers.get('SALES')!.password);
    const warehouseToken = await loginAs(seededUsers.get('WAREHOUSE')!.email, seededUsers.get('WAREHOUSE')!.password);
    const marketingToken = await loginAs(seededUsers.get('MARKETING')!.email, seededUsers.get('MARKETING')!.password);
    const adminToken = await loginAs(seededUsers.get('ADMIN')!.email, seededUsers.get('ADMIN')!.password);

    // Only CUSTOMER can access cart; ADMIN does NOT inherit CUSTOMER permissions
    expect((await request(app).get('/api/_rbac/cart').set('Authorization', `Bearer ${customerToken}`)).status).toBe(200);
    expect((await request(app).get('/api/_rbac/cart').set('Authorization', `Bearer ${adminToken}`)).status).toBe(403);
    expect((await request(app).get('/api/_rbac/cart').set('Authorization', `Bearer ${salesToken}`)).status).toBe(403);

    // Order transition: SALES & ADMIN only
    expect((await request(app).get('/api/_rbac/orders/transition').set('Authorization', `Bearer ${salesToken}`)).status).toBe(200);
    expect((await request(app).get('/api/_rbac/orders/transition').set('Authorization', `Bearer ${adminToken}`)).status).toBe(200);
    expect((await request(app).get('/api/_rbac/orders/transition').set('Authorization', `Bearer ${warehouseToken}`)).status).toBe(403);
    expect((await request(app).get('/api/_rbac/orders/transition').set('Authorization', `Bearer ${customerToken}`)).status).toBe(403);

    // Inventory import: WAREHOUSE & ADMIN only
    expect((await request(app).get('/api/_rbac/inventory/import').set('Authorization', `Bearer ${warehouseToken}`)).status).toBe(200);
    expect((await request(app).get('/api/_rbac/inventory/import').set('Authorization', `Bearer ${adminToken}`)).status).toBe(200);
    expect((await request(app).get('/api/_rbac/inventory/import').set('Authorization', `Bearer ${marketingToken}`)).status).toBe(403);

    // Vouchers manage: MARKETING & ADMIN only
    expect((await request(app).get('/api/_rbac/vouchers/manage').set('Authorization', `Bearer ${marketingToken}`)).status).toBe(200);
    expect((await request(app).get('/api/_rbac/vouchers/manage').set('Authorization', `Bearer ${adminToken}`)).status).toBe(200);
    expect((await request(app).get('/api/_rbac/vouchers/manage').set('Authorization', `Bearer ${salesToken}`)).status).toBe(403);

    // /api/users: ADMIN only
    for (const deniedToken of [customerToken, salesToken, warehouseToken, marketingToken]) {
      const res = await request(app).get('/api/users').set('Authorization', `Bearer ${deniedToken}`);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    }
    const adminList = await request(app).get('/api/users?page=1&page_size=20').set('Authorization', `Bearer ${adminToken}`);
    expect(adminList.status).toBe(200);
    expect(adminList.body.data.items.length).toBeGreaterThanOrEqual(5);
    expect(adminList.body.meta.pagination.total).toBeGreaterThanOrEqual(5);
  });

  it('blocks access to another user resources and invalidates JWTs immediately on role/active change', async () => {
    const reg2 = await request(app).post('/api/auth/register').send({
      full_name: 'Khách Hai',
      email: 'khachhang2@example.invalid',
      password: 'ValidPassword!123',
    });
    expect(reg2.status).toBe(201);
    const customer2Id = reg2.body.data.id as number;

    const customer1Token = await loginAs('khachhang1@example.invalid', 'ValidPassword!123');
    const customer1Me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${customer1Token}`);
    const customer1Id = customer1Me.body.data.id as number;
    const customer2Token = await loginAs('khachhang2@example.invalid', 'ValidPassword!123');
    const salesToken = await loginAs(seededUsers.get('SALES')!.email, seededUsers.get('SALES')!.password);
    const adminToken = await loginAs(seededUsers.get('ADMIN')!.email, seededUsers.get('ADMIN')!.password);

    // Customer 1 can access own resource, but accessing Customer 2's resource is concealed as 404
    expect((await request(app).get(`/api/_rbac/customer-resource/${customer1Id}`).set('Authorization', `Bearer ${customer1Token}`)).status).toBe(200);
    const crossCustomer = await request(app)
      .get(`/api/_rbac/customer-resource/${customer2Id}`)
      .set('Authorization', `Bearer ${customer1Token}`);
    expect(crossCustomer.status).toBe(404);
    expect(crossCustomer.body.error.code).toBe('NOT_FOUND');

    // Privileged SALES can read customer resource
    expect((await request(app).get(`/api/_rbac/customer-resource/${customer2Id}`).set('Authorization', `Bearer ${salesToken}`)).status).toBe(200);

    // Customer cannot read another user's admin profile endpoint
    expect((await request(app).get(`/api/users/${customer2Id}`).set('Authorization', `Bearer ${customer1Token}`)).status).toBe(403);

    // ADMIN updates customer2's role to SALES -> old customer2 JWT immediately fails with 401
    const promote = await request(app)
      .put(`/api/users/${customer2Id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        full_name: 'Khách Hai (Sales)',
        phone: null,
        role: 'SALES',
        is_active: true,
      });
    expect(promote.status).toBe(200);
    expect(promote.body.data.role).toBe('SALES');

    const staleTokenCheck = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${customer2Token}`);
    expect(staleTokenCheck.status).toBe(401);
    expect(staleTokenCheck.body.error.code).toBe('INVALID_TOKEN');

    // Login again receives updated role
    const newToken = await loginAs('khachhang2@example.invalid', 'ValidPassword!123');
    const refreshedMe = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${newToken}`);
    expect(refreshedMe.status).toBe(200);
    expect(refreshedMe.body.data.role).toBe('SALES');

    // ADMIN deactivates customer2 -> login returns 401 INVALID_CREDENTIALS and active token returns 401
    const deactivate = await request(app)
      .put(`/api/users/${customer2Id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        full_name: 'Khách Hai (Locked)',
        phone: null,
        role: 'SALES',
        is_active: false,
      });
    expect(deactivate.status).toBe(200);
    expect((await request(app).get('/api/auth/me').set('Authorization', `Bearer ${newToken}`)).status).toBe(401);
    const lockedLogin = await request(app).post('/api/auth/login').send({
      email: 'khachhang2@example.invalid',
      password: 'ValidPassword!123',
    });
    expect(lockedLogin.status).toBe(401);
    expect(lockedLogin.body.error.code).toBe('INVALID_CREDENTIALS');

    // Protecting the last active ADMIN
    const adminId = seededUsers.get('ADMIN')!.id;
    const demoteLastAdmin = await request(app)
      .put(`/api/users/${adminId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        full_name: 'Seed ADMIN',
        phone: null,
        role: 'CUSTOMER',
        is_active: true,
      });
    expect(demoteLastAdmin.status).toBe(409);
    expect(demoteLastAdmin.body.error.code).toBe('LAST_ADMIN_PROTECTED');

    // Verify audit_events logged ROLE_CHANGED without password_hash
    const audits = (await testAdminClient.query<{ action: string; changes: Record<string, unknown> }>(
      "SELECT action, changes FROM app.audit_events WHERE entity_type = 'USER' AND entity_id = $1 ORDER BY id ASC",
      [String(customer2Id)],
    )).rows;
    expect(audits.length).toBeGreaterThanOrEqual(2);
    expect(audits[0]?.action).toBe('ROLE_CHANGED');
    expect(JSON.stringify(audits)).not.toContain('password_hash');
  });
});
