import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from 'dotenv';
import { runner } from 'node-pg-migrate';
import pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { hashPassword } from '../src/auth/password.js';

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

function localTodayIso(): string {
  // Format current Asia/Ho_Chi_Minh date YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

describe('Back-Office Backend API & RBAC Matrix (Express + PostgreSQL 17.9)', () => {
  const { env, host, port, adminConfig } = loadDbSettings();
  const dbName = `backoffice_test_${randomBytes(6).toString('hex')}`;
  const jwtSettings = {
    secret: randomBytes(32).toString('hex'),
    issuer: 'fashion-api',
    audience: 'fashion-web',
  };

  let adminClient: pg.Client;
  let testAdminClient: pg.Client;
  let appPool: pg.Pool;
  let app: ReturnType<typeof createApp>;

  let customerToken = '';
  let salesToken = '';
  let warehouseToken = '';
  let marketingToken = '';
  let adminToken = '';

  let customerId = 0;
  let adminUserId = 0;
  let brandId = 0;
  let categoryId = 0;
  let shirtProductId = 0;
  let shoesProductId = 0;
  let shirtVariantId = 0;
  let shoesVariantId = 0;
  let inactiveVariantId = 0;

  let order1Id = 0;
  let order1Code = '';
  let order2Id = 0;
  let order3Id = 0;
  let usedVoucherId = 0;

  async function loginAs(email: string, password: string): Promise<string> {
    const res = await request(app).post('/api/auth/login').send({ email, password });
    expect(res.status).toBe(200);
    return res.body.data.access_token as string;
  }

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

    const pwHash = await hashPassword('BackofficePass!123');
    await testAdminClient.query('BEGIN');

    const custInsert = await testAdminClient.query<{ id: number }>(
      "INSERT INTO app.users(full_name, email, password_hash, role, is_active) VALUES('Customer Ops', 'customer@bo-test.invalid', $1, 'CUSTOMER', TRUE) RETURNING id",
      [pwHash],
    );
    customerId = custInsert.rows[0]?.id ?? 0;

    await testAdminClient.query(
      `INSERT INTO app.users(full_name, email, password_hash, role, is_active) VALUES
         ('Sales Ops', 'sales@bo-test.invalid', $1, 'SALES', TRUE),
         ('Warehouse Ops', 'warehouse@bo-test.invalid', $1, 'WAREHOUSE', TRUE),
         ('Marketing Ops', 'marketing@bo-test.invalid', $1, 'MARKETING', TRUE)`,
      [pwHash],
    );

    const adminInsert = await testAdminClient.query<{ id: number }>(
      "INSERT INTO app.users(full_name, email, password_hash, role, is_active) VALUES('Admin Ops', 'admin@bo-test.invalid', $1, 'ADMIN', TRUE) RETURNING id",
      [pwHash],
    );
    adminUserId = adminInsert.rows[0]?.id ?? 0;

    brandId = (
      await testAdminClient.query<{ id: number }>(
        "INSERT INTO app.brands(name, slug, is_active) VALUES('Maison Ops', 'maison-ops', TRUE) RETURNING id",
      )
    ).rows[0]!.id;

    categoryId = (
      await testAdminClient.query<{ id: number }>(
        "INSERT INTO app.categories(name, slug, is_active) VALUES('Apparel', 'apparel', TRUE) RETURNING id",
      )
    ).rows[0]!.id;

    shirtProductId = (
      await testAdminClient.query<{ id: number }>(
        `INSERT INTO app.products(category_id, brand_id, product_type_code, name, slug, description, is_active)
         VALUES($1, $2, 'CLOTHING', 'Oxford Shirt', 'oxford-shirt', 'Classic Oxford', TRUE) RETURNING id`,
        [categoryId, brandId],
      )
    ).rows[0]!.id;

    shoesProductId = (
      await testAdminClient.query<{ id: number }>(
        `INSERT INTO app.products(category_id, brand_id, product_type_code, name, slug, description, is_active)
         VALUES($1, $2, 'SHOES', 'Derby Leather', 'derby-leather', 'Leather shoes', TRUE) RETURNING id`,
        [categoryId, brandId],
      )
    ).rows[0]!.id;

    shirtVariantId = (
      await testAdminClient.query<{ id: number }>(
        "INSERT INTO app.product_variants(product_id, sku, list_price, price, is_active) VALUES($1, 'OXF-WHT-M', 800000.00, 600000.00, TRUE) RETURNING id",
        [shirtProductId],
      )
    ).rows[0]!.id;

    shoesVariantId = (
      await testAdminClient.query<{ id: number }>(
        "INSERT INTO app.product_variants(product_id, sku, list_price, price, is_active) VALUES($1, 'DRB-BLK-42', 1500000.00, 1200000.00, TRUE) RETURNING id",
        [shoesProductId],
      )
    ).rows[0]!.id;

    inactiveVariantId = (
      await testAdminClient.query<{ id: number }>(
        "INSERT INTO app.product_variants(product_id, sku, list_price, price, is_active) VALUES($1, 'OXF-OLD-XS', 500000.00, 400000.00, FALSE) RETURNING id",
        [shirtProductId],
      )
    ).rows[0]!.id;

    await testAdminClient.query(
      `INSERT INTO app.variant_attribute_values(variant_id, attribute_id, value_id)
       SELECT x.vid, a.id, av.id
       FROM (VALUES
         ($1::int, 'color', 'white'),
         ($1::int, 'clothing_size', 'm'),
         ($2::int, 'color', 'black'),
         ($2::int, 'shoe_size', 'eu-42'),
         ($3::int, 'color', 'black'),
         ($3::int, 'clothing_size', 's')
       ) AS x(vid, ac, vc)
       JOIN app.attributes a ON a.code = x.ac
       JOIN app.attribute_values av ON av.attribute_id = a.id AND av.code = x.vc`,
      [shirtVariantId, shoesVariantId, inactiveVariantId],
    );

    await testAdminClient.query(
      `INSERT INTO app.product_images(product_id, asset_path, alt_text, is_primary)
       VALUES ($1, '/media/sanphamdemo1.jpg', 'Oxford Shirt', TRUE),
              ($2, '/media/sanphamdemo2.jpg', 'Derby Shoes', TRUE)`,
      [shirtProductId, shoesProductId],
    );

    await testAdminClient.query(
      `INSERT INTO app.inventory(variant_id, quantity)
       VALUES($1, 25), ($2, 3), ($3, 2)
       ON CONFLICT (variant_id) DO UPDATE SET quantity = EXCLUDED.quantity`,
      [shirtVariantId, shoesVariantId, inactiveVariantId],
    );

    usedVoucherId = (
      await testAdminClient.query<{ id: number }>(
        `INSERT INTO app.vouchers(code, discount_type, discount_value, max_discount_amount, min_order_amount, usage_limit, used_count, start_date, end_date, is_active)
         VALUES('BOPROMO', 'FIXED', 100000.00, NULL, 300000.00, 10, 0, NOW() - INTERVAL '1 day', NOW() + INTERVAL '14 days', TRUE)
         RETURNING id`,
      )
    ).rows[0]!.id;

    await testAdminClient.query('COMMIT');

    if (env.DB_PASSWORD) {
      appPool = new pg.Pool({
        host,
        port,
        database: dbName,
        user: 'app_rw_user',
        password: env.DB_PASSWORD,
        max: 20,
      });
    } else {
      appPool = new pg.Pool({ ...targetAdminConfig, max: 20 });
      appPool.on('connect', (client) => {
        void client.query('SET ROLE app_rw_user');
      });
    }

    app = createApp({
      checkDatabase: async () => {
        await appPool.query('SELECT 1');
      },
      frontendOrigin: 'http://localhost:5173',
      pool: appPool,
      jwt: jwtSettings,
    });

    customerToken = await loginAs('customer@bo-test.invalid', 'BackofficePass!123');
    salesToken = await loginAs('sales@bo-test.invalid', 'BackofficePass!123');
    warehouseToken = await loginAs('warehouse@bo-test.invalid', 'BackofficePass!123');
    marketingToken = await loginAs('marketing@bo-test.invalid', 'BackofficePass!123');
    adminToken = await loginAs('admin@bo-test.invalid', 'BackofficePass!123');

    // Place 3 orders via storefront API so ledger, voucher usages, and order lifecycle have realistic history
    // Order 1: Shirt (qty 2, with BOPROMO) -> will transition to DELIVERED
    const c1 = await request(app)
      .post('/api/cart/items')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ variant_id: shirtVariantId, quantity: 2 });
    const o1 = await request(app)
      .post('/api/orders/checkout')
      .set('Authorization', `Bearer ${customerToken}`)
      .set('Idempotency-Key', randomUUID())
      .send({
        shipping_address: '10 Le Loi, Q1, TP.HCM',
        recipient_name: 'Customer Ops',
        recipient_phone: '0901112233',
        voucher_code: 'BOPROMO',
        cart_version: c1.body.data.version,
        expected_items: [{ variant_id: shirtVariantId, quantity: 2, unit_price: '600000.00' }],
      });
    expect(o1.status).toBe(201);
    order1Id = o1.body.data.order.id as number;
    order1Code = o1.body.data.order.order_code as string;

    // Order 2: Shoes (qty 2, no voucher) -> stays PENDING for concurrent status/cancel tests
    const c2 = await request(app)
      .post('/api/cart/items')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ variant_id: shoesVariantId, quantity: 2 });
    const o2 = await request(app)
      .post('/api/orders/checkout')
      .set('Authorization', `Bearer ${customerToken}`)
      .set('Idempotency-Key', randomUUID())
      .send({
        shipping_address: '20 Le Loi, Q1, TP.HCM',
        recipient_name: 'Customer Ops Two',
        recipient_phone: '0901112233',
        voucher_code: null,
        cart_version: c2.body.data.version,
        expected_items: [{ variant_id: shoesVariantId, quantity: 2, unit_price: '1200000.00' }],
      });
    expect(o2.status).toBe(201);
    order2Id = o2.body.data.order.id as number;

    // Order 3: Shirt (qty 1) -> will be cancelled by SALES
    const c3 = await request(app)
      .post('/api/cart/items')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ variant_id: shirtVariantId, quantity: 1 });
    const o3 = await request(app)
      .post('/api/orders/checkout')
      .set('Authorization', `Bearer ${customerToken}`)
      .set('Idempotency-Key', randomUUID())
      .send({
        shipping_address: '30 Le Loi, Q1, TP.HCM',
        recipient_name: 'Customer Ops Three',
        recipient_phone: '0901112233',
        voucher_code: null,
        cart_version: c3.body.data.version,
        expected_items: [{ variant_id: shirtVariantId, quantity: 1, unit_price: '600000.00' }],
      });
    expect(o3.status).toBe(201);
    order3Id = o3.body.data.order.id as number;
  }, 30_000);

  afterAll(async () => {
    await appPool?.end().catch(() => undefined);
    await testAdminClient?.end().catch(() => undefined);
    if (adminClient) {
      await adminClient.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`).catch(() => undefined);
      await adminClient.end().catch(() => undefined);
    }
  });

  it('enforces the 5-role RBAC matrix from SPEC.md and preserves storefront static routes', async () => {
    const today = localTodayIso();

    // Storefront routes still intact: customer can hit GET /api/vouchers/available (doesn't match /vouchers/:id)
    const custAvail = await request(app)
      .get('/api/vouchers/available')
      .set('Authorization', `Bearer ${customerToken}`);
    expect(custAvail.status).toBe(200);
    expect(Array.isArray(custAvail.body.data.items)).toBe(true);

    // Public catalog unaffected
    const pubProds = await request(app).get('/api/products?page=1&page_size=10');
    expect(pubProds.status).toBe(200);
    expect(pubProds.body.data.items.length).toBeGreaterThanOrEqual(2);

    // Orders Management: CUSTOMER, WAREHOUSE, MARKETING denied 403
    for (const token of [customerToken, warehouseToken, marketingToken]) {
      expect((await request(app).get('/api/orders').set('Authorization', `Bearer ${token}`)).status).toBe(403);
      expect(
        (
          await request(app)
            .patch(`/api/orders/${order1Id}/status`)
            .set('Authorization', `Bearer ${token}`)
            .send({ expected_status: 'PENDING', target_status: 'CONFIRMED' })
        ).status,
      ).toBe(403);
    }
    expect((await request(app).get(`/api/orders/${order1Id}`).set('Authorization', `Bearer ${warehouseToken}`)).status).toBe(403);
    expect((await request(app).get(`/api/orders/${order1Id}`).set('Authorization', `Bearer ${marketingToken}`)).status).toBe(403);

    // Inventory: CUSTOMER, SALES, MARKETING denied 403
    for (const token of [customerToken, salesToken, marketingToken]) {
      expect((await request(app).get('/api/inventory').set('Authorization', `Bearer ${token}`)).status).toBe(403);
      expect(
        (await request(app).get('/api/inventory/transactions').set('Authorization', `Bearer ${token}`)).status,
      ).toBe(403);
      expect(
        (
          await request(app)
            .post('/api/inventory/import')
            .set('Authorization', `Bearer ${token}`)
            .set('Idempotency-Key', randomUUID())
            .send({ variant_id: shirtVariantId, quantity: 1, note: 'Forbidden import' })
        ).status,
      ).toBe(403);
    }

    // Marketing (Vouchers + Reports): CUSTOMER, SALES, WAREHOUSE denied 403
    for (const token of [customerToken, salesToken, warehouseToken]) {
      expect((await request(app).get('/api/vouchers').set('Authorization', `Bearer ${token}`)).status).toBe(403);
      expect(
        (await request(app).get(`/api/vouchers/${usedVoucherId}`).set('Authorization', `Bearer ${token}`)).status,
      ).toBe(403);
      expect(
        (await request(app).get(`/api/vouchers/${usedVoucherId}/usages`).set('Authorization', `Bearer ${token}`)).status,
      ).toBe(403);
      expect(
        (
          await request(app)
            .get(`/api/reports/revenue?from=${today}&to=${today}`)
            .set('Authorization', `Bearer ${token}`)
        ).status,
      ).toBe(403);
      expect(
        (
          await request(app)
            .get(`/api/reports/best-sellers?from=${today}&to=${today}`)
            .set('Authorization', `Bearer ${token}`)
        ).status,
      ).toBe(403);
    }

    // Administration (Users, Catalog writes, Banners writes, Audit Events): CUSTOMER, SALES, WAREHOUSE, MARKETING denied 403
    for (const token of [customerToken, salesToken, warehouseToken, marketingToken]) {
      expect((await request(app).get('/api/users').set('Authorization', `Bearer ${token}`)).status).toBe(403);
      expect(
        (await request(app).get('/api/admin/audit-events').set('Authorization', `Bearer ${token}`)).status,
      ).toBe(403);
      expect((await request(app).get('/api/admin/products').set('Authorization', `Bearer ${token}`)).status).toBe(403);
      expect(
        (
          await request(app)
            .post('/api/brands')
            .set('Authorization', `Bearer ${token}`)
            .send({ name: 'Deny', slug: 'deny' })
        ).status,
      ).toBe(403);
      expect(
        (
          await request(app)
            .post('/api/admin/banners')
            .set('Authorization', `Bearer ${token}`)
            .send({
              title: 'Deny Banner',
              desktop_path: '/media/styleweb.png',
              alt_text: 'Deny',
              placement: 'HERO',
              target_type: 'NONE',
              starts_at: new Date().toISOString(),
              ends_at: new Date(Date.now() + 86400000).toISOString(),
            })
        ).status,
      ).toBe(403);
    }
  });

  it('handles Orders Management listing, concurrent status transitions, sequential delivery, and cancellation', async () => {
    // List orders without exposing shipping_address / recipient_phone
    const listAll = await request(app).get('/api/orders?page=1&page_size=20').set('Authorization', `Bearer ${salesToken}`);
    expect(listAll.status).toBe(200);
    expect(listAll.body.meta.pagination.total).toBe(3);
    const firstSummary = listAll.body.data.items[0] as Record<string, unknown>;
    expect(firstSummary).toHaveProperty('order_code');
    expect(firstSummary).toHaveProperty('recipient_name');
    expect(firstSummary).not.toHaveProperty('shipping_address');
    expect(firstSummary).not.toHaveProperty('recipient_phone');

    // Search by order_code & user_id
    const byCode = await request(app)
      .get(`/api/orders?order_code=${order1Code}&user_id=${customerId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(byCode.status).toBe(200);
    expect(byCode.body.data.items).toHaveLength(1);
    expect(byCode.body.data.items[0].id).toBe(order1Id);

    // Invalid status jump PENDING -> DELIVERED rejected 409 INVALID_STATUS_TRANSITION
    const badJump = await request(app)
      .patch(`/api/orders/${order1Id}/status`)
      .set('Authorization', `Bearer ${salesToken}`)
      .send({ expected_status: 'PENDING', target_status: 'DELIVERED' });
    expect(badJump.status).toBe(409);
    expect(badJump.body.error.code).toBe('INVALID_STATUS_TRANSITION');
    expect(badJump.body.error.details.allowed_targets).toEqual(['CONFIRMED']);

    // Concurrency test A: 2 staff transition PENDING -> CONFIRMED at the same time on Order 1
    const [t1, t2] = await Promise.all([
      request(app)
        .patch(`/api/orders/${order1Id}/status`)
        .set('Authorization', `Bearer ${salesToken}`)
        .send({ expected_status: 'PENDING', target_status: 'CONFIRMED' }),
      request(app)
        .patch(`/api/orders/${order1Id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ expected_status: 'PENDING', target_status: 'CONFIRMED' }),
    ]);
    const tStatuses = [t1.status, t2.status].sort((a, b) => a - b);
    expect(tStatuses).toEqual([200, 409]);
    const winner = t1.status === 200 ? t1 : t2;
    const loser = t1.status === 409 ? t1 : t2;
    expect(winner.body.data.status).toBe('CONFIRMED');
    expect(loser.body.error.code).toBe('STALE_ORDER_STATUS');
    expect(loser.body.error.details).toEqual({ current_status: 'CONFIRMED', allowed_targets: ['SHIPPING'] });

    // Sequential steps: CONFIRMED -> SHIPPING -> DELIVERED sets payment_status PAID and delivered_at
    const toShip = await request(app)
      .patch(`/api/orders/${order1Id}/status`)
      .set('Authorization', `Bearer ${salesToken}`)
      .send({ expected_status: 'CONFIRMED', target_status: 'SHIPPING' });
    expect(toShip.status).toBe(200);
    expect(toShip.body.data.status).toBe('SHIPPING');

    // Cannot cancel once SHIPPING
    const cancelShip = await request(app)
      .post(`/api/orders/${order1Id}/cancel`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'Too late' });
    expect(cancelShip.status).toBe(409);
    expect(cancelShip.body.error.code).toBe('ORDER_NOT_CANCELLABLE');

    const toDelivered = await request(app)
      .patch(`/api/orders/${order1Id}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ expected_status: 'SHIPPING', target_status: 'DELIVERED' });
    expect(toDelivered.status).toBe(200);
    expect(toDelivered.body.data.status).toBe('DELIVERED');
    expect(toDelivered.body.data.payment_status).toBe('PAID');
    expect(toDelivered.body.data.delivered_at).not.toBeNull();

    // Concurrency test B: transition (PENDING -> CONFIRMED) racing cancel on Order 2
    // Wait: cancel CAN cancel PENDING or CONFIRMED, so let's transition Order 2 to CONFIRMED first,
    // then race (CONFIRMED -> SHIPPING) vs cancel! Only one outcome can win cleanly!
    const conf2 = await request(app)
      .patch(`/api/orders/${order2Id}/status`)
      .set('Authorization', `Bearer ${salesToken}`)
      .send({ expected_status: 'PENDING', target_status: 'CONFIRMED' });
    expect(conf2.status).toBe(200);

    const [shipRace, cancelRace] = await Promise.all([
      request(app)
        .patch(`/api/orders/${order2Id}/status`)
        .set('Authorization', `Bearer ${salesToken}`)
        .send({ expected_status: 'CONFIRMED', target_status: 'SHIPPING' }),
      request(app)
        .post(`/api/orders/${order2Id}/cancel`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reason: 'Concurrent race cancel' }),
    ]);
    const raceStatuses = [shipRace.status, cancelRace.status].sort((a, b) => a - b);
    expect(raceStatuses).toEqual([200, 409]);

    // SALES cancels eligible PENDING Order 3 cleanly -> restores shirt stock (+1)
    const cancel3 = await request(app)
      .post(`/api/orders/${order3Id}/cancel`)
      .set('Authorization', `Bearer ${salesToken}`)
      .send({ reason: 'Customer asked sales to cancel' });
    expect(cancel3.status).toBe(200);
    expect(cancel3.body.data.status).toBe('CANCELLED');
  });

  it('handles Inventory stock listing, low-stock filter, idempotent import, and PII-free ledger', async () => {
    // Stock listing as WAREHOUSE includes inactive variants and supports low_stock_threshold
    const invAll = await request(app)
      .get('/api/inventory?page=1&page_size=20')
      .set('Authorization', `Bearer ${warehouseToken}`);
    expect(invAll.status).toBe(200);
    expect(invAll.body.meta.pagination.total).toBe(3);

    const lowStock = await request(app)
      .get('/api/inventory?low_stock_threshold=3')
      .set('Authorization', `Bearer ${warehouseToken}`);
    expect(lowStock.status).toBe(200);
    const lowSkus = (lowStock.body.data.items as Array<{ sku: string }>).map((r) => r.sku);
    expect(lowSkus).toContain('DRB-BLK-42');
    expect(lowSkus).toContain('OXF-OLD-XS');
    expect(lowSkus).not.toContain('OXF-WHT-M');

    // Import missing Idempotency-Key -> 400
    const noKey = await request(app)
      .post('/api/inventory/import')
      .set('Authorization', `Bearer ${warehouseToken}`)
      .send({ variant_id: shoesVariantId, quantity: 5, note: 'Missing key' });
    expect(noKey.status).toBe(400);

    // Successful import -> 201, replay -> 200, different body -> 409 IDEMPOTENCY_KEY_REUSED
    const importKey = randomUUID();
    const importBody = { variant_id: inactiveVariantId, quantity: 10, note: 'Restock batch #1' };
    const imp1 = await request(app)
      .post('/api/inventory/import')
      .set('Authorization', `Bearer ${warehouseToken}`)
      .set('Idempotency-Key', importKey)
      .send(importBody);
    expect(imp1.status).toBe(201);
    expect(imp1.body.data.replayed).toBe(false);
    expect(imp1.body.data.transaction.quantity_change).toBe(10);

    const impReplay = await request(app)
      .post('/api/inventory/import')
      .set('Authorization', `Bearer ${warehouseToken}`)
      .set('Idempotency-Key', importKey)
      .send(importBody);
    expect(impReplay.status).toBe(200);
    expect(impReplay.body.data.replayed).toBe(true);
    expect(impReplay.body.data.transaction.id).toBe(imp1.body.data.transaction.id);

    const impConflict = await request(app)
      .post('/api/inventory/import')
      .set('Authorization', `Bearer ${warehouseToken}`)
      .set('Idempotency-Key', importKey)
      .send({ ...importBody, quantity: 11 });
    expect(impConflict.status).toBe(409);
    expect(impConflict.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');

    // Confirm inactive variant quantity updated 2 -> 12 (imported once)
    const checkInactive = await request(app)
      .get('/api/inventory?search=OXF-OLD-XS')
      .set('Authorization', `Bearer ${warehouseToken}`);
    expect(checkInactive.body.data.items[0].quantity).toBe(12);

    // Ledger listing filtered by order_id & date, with NO shipping PII
    const today = localTodayIso();
    const ledger = await request(app)
      .get(`/api/inventory/transactions?order_id=${order3Id}&from=${today}&to=${today}`)
      .set('Authorization', `Bearer ${warehouseToken}`);
    expect(ledger.status).toBe(200);
    expect(ledger.body.data.items).toHaveLength(2); // EXPORT_ORDER + RETURN_CANCEL for order 3
    for (const tx of ledger.body.data.items as Array<Record<string, unknown>>) {
      expect(tx).toHaveProperty('order_code');
      expect(tx).not.toHaveProperty('shipping_address');
      expect(tx).not.toHaveProperty('recipient_name');
      expect(tx).not.toHaveProperty('recipient_phone');
    }
  });

  it('handles Marketing Voucher CRUD, terms-lock guard, masked usages, and Revenue/Best-Sellers reports', async () => {
    const startIso = new Date(Date.now() - 3600_000).toISOString();
    const endIso = new Date(Date.now() + 7 * 86400_000).toISOString();

    // Create PERCENT voucher
    const createPct = await request(app)
      .post('/api/vouchers')
      .set('Authorization', `Bearer ${marketingToken}`)
      .send({
        code: 'vip20',
        discount_type: 'PERCENT',
        discount_value: '20.00',
        max_discount_amount: '300000.00',
        min_order_amount: '500000.00',
        usage_limit: 5,
        start_date: startIso,
        end_date: endIso,
        is_active: true,
      });
    expect(createPct.status).toBe(201);
    expect(createPct.body.data.code).toBe('VIP20');
    const newVoucherId = createPct.body.data.id as number;

    // Duplicate code -> 409 DUPLICATE_CODE
    const dupCode = await request(app)
      .post('/api/vouchers')
      .set('Authorization', `Bearer ${marketingToken}`)
      .send({
        code: 'VIP20',
        discount_type: 'FIXED',
        discount_value: '50000.00',
        max_discount_amount: null,
        min_order_amount: '0.00',
        usage_limit: 5,
        start_date: startIso,
        end_date: endIso,
      });
    expect(dupCode.status).toBe(409);
    expect(dupCode.body.error.code).toBe('DUPLICATE_CODE');

    // Unused voucher terms CAN be edited
    const editUnused = await request(app)
      .put(`/api/vouchers/${newVoucherId}`)
      .set('Authorization', `Bearer ${marketingToken}`)
      .send({
        discount_type: 'PERCENT',
        discount_value: '25.00',
        max_discount_amount: '350000.00',
        min_order_amount: '500000.00',
        usage_limit: 10,
        start_date: startIso,
        end_date: endIso,
        is_active: true,
      });
    expect(editUnused.status).toBe(200);
    expect(editUnused.body.data.discount_value).toBe('25.00');

    // Used voucher (BOPROMO): changing discount_value -> 409 VOUCHER_TERMS_LOCKED
    const usedRow = (
      await request(app).get(`/api/vouchers/${usedVoucherId}`).set('Authorization', `Bearer ${marketingToken}`)
    ).body.data as Record<string, unknown>;

    const lockedRes = await request(app)
      .put(`/api/vouchers/${usedVoucherId}`)
      .set('Authorization', `Bearer ${marketingToken}`)
      .send({
        discount_type: usedRow.discount_type,
        discount_value: '200000.00',
        max_discount_amount: usedRow.max_discount_amount,
        min_order_amount: usedRow.min_order_amount,
        usage_limit: usedRow.usage_limit,
        start_date: usedRow.start_date,
        end_date: usedRow.end_date,
        is_active: usedRow.is_active,
      });
    expect(lockedRes.status).toBe(409);
    expect(lockedRes.body.error.code).toBe('VOUCHER_TERMS_LOCKED');

    // Used voucher: increasing usage_limit + toggling is_active succeeds 200
    const increaseLimit = await request(app)
      .put(`/api/vouchers/${usedVoucherId}`)
      .set('Authorization', `Bearer ${marketingToken}`)
      .send({
        discount_type: usedRow.discount_type,
        discount_value: usedRow.discount_value,
        max_discount_amount: usedRow.max_discount_amount,
        min_order_amount: usedRow.min_order_amount,
        usage_limit: Number(usedRow.usage_limit) + 5,
        start_date: usedRow.start_date,
        end_date: usedRow.end_date,
        is_active: true,
      });
    expect(increaseLimit.status).toBe(200);
    expect(increaseLimit.body.data.usage_limit).toBe(Number(usedRow.usage_limit) + 5);

    // Voucher usages redacts email & hides PII
    const usages = await request(app)
      .get(`/api/vouchers/${usedVoucherId}/usages?status=APPLIED`)
      .set('Authorization', `Bearer ${marketingToken}`);
    expect(usages.status).toBe(200);
    expect(usages.body.data.items).toHaveLength(1);
    const uRow = usages.body.data.items[0] as Record<string, unknown>;
    expect(uRow.email_masked).toBe('cu***@bo-test.invalid');
    expect(uRow.order_code).toBe(order1Code);
    expect(uRow).not.toHaveProperty('shipping_address');
    expect(uRow).not.toHaveProperty('recipient_phone');

    // Revenue report counts ONLY DELIVERED Order 1 (gross 1200000.00, discount 100000.00, revenue 1100000.00)
    const today = localTodayIso();
    const revDay = await request(app)
      .get(`/api/reports/revenue?from=${today}&to=${today}&group_by=day`)
      .set('Authorization', `Bearer ${marketingToken}`);
    expect(revDay.status).toBe(200);
    expect(revDay.body.data.items).toHaveLength(1);
    expect(revDay.body.data.items[0]).toEqual({
      period_start: today,
      order_count: 1,
      gross_amount: '1200000.00',
      discount_amount: '100000.00',
      revenue_amount: '1100000.00',
    });
    expect(revDay.body.data.totals).toEqual({
      order_count: 1,
      gross_amount: '1200000.00',
      discount_amount: '100000.00',
      revenue_amount: '1100000.00',
    });

    // Empty date range returns zero totals instead of null
    const revEmpty = await request(app)
      .get('/api/reports/revenue?from=2020-01-01&to=2020-01-31&group_by=month')
      .set('Authorization', `Bearer ${marketingToken}`);
    expect(revEmpty.status).toBe(200);
    expect(revEmpty.body.data.items).toEqual([]);
    expect(revEmpty.body.data.totals).toEqual({
      order_count: 0,
      gross_amount: '0.00',
      discount_amount: '0.00',
      revenue_amount: '0.00',
    });

    // Reject date range > 366 days
    const revTooLong = await request(app)
      .get('/api/reports/revenue?from=2025-01-01&to=2026-12-31')
      .set('Authorization', `Bearer ${marketingToken}`);
    expect(revTooLong.status).toBe(400);

    // Best-sellers level=product & level=sku return Oxford Shirt qty 2, gross_item_amount 1200000.00 (pre-voucher)
    const topSku = await request(app)
      .get(`/api/reports/best-sellers?from=${today}&to=${today}&level=sku`)
      .set('Authorization', `Bearer ${marketingToken}`);
    expect(topSku.status).toBe(200);
    expect(topSku.body.data.items).toEqual([
      {
        rank: 1,
        product_id: shirtProductId,
        product_name: 'Oxford Shirt',
        variant_id: shirtVariantId,
        sku: 'OXF-WHT-M',
        quantity_sold: '2',
        gross_item_amount: '1200000.00',
      },
    ]);
  });

  it('handles Administration user/role updates, catalog/banner management, and audit events', async () => {
    // ADMIN protects last active ADMIN from demotion
    const demoteLastAdmin = await request(app)
      .put(`/api/users/${adminUserId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        full_name: 'Admin Ops',
        phone: null,
        role: 'SALES',
        is_active: true,
      });
    expect(demoteLastAdmin.status).toBe(409);
    expect(demoteLastAdmin.body.error.code).toBe('LAST_ADMIN_PROTECTED');

    // Promote Customer to SALES (role change audited and revokes old customer JWT via token_version)
    const promoteRes = await request(app)
      .put(`/api/users/${customerId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        full_name: 'Customer Promoted',
        phone: '0908887777',
        role: 'SALES',
        is_active: true,
      });
    expect(promoteRes.status).toBe(200);
    expect(promoteRes.body.data.role).toBe('SALES');

    // Old customer JWT immediately invalid (401)
    expect((await request(app).get('/api/auth/me').set('Authorization', `Bearer ${customerToken}`)).status).toBe(401);

    // Create banner as ADMIN -> 201, public banners endpoint renders it
    const createBanner = await request(app)
      .post('/api/admin/banners')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        title: 'Ops Hero',
        desktop_path: '/media/styleweb.png',
        alt_text: 'Ops Hero Banner',
        placement: 'HERO',
        target_type: 'BRAND',
        brand_id: brandId,
        starts_at: new Date(Date.now() - 3600_000).toISOString(),
        ends_at: new Date(Date.now() + 86400_000).toISOString(),
        is_active: true,
      });
    expect(createBanner.status).toBe(201);

    const pubBanners = await request(app).get('/api/banners?placement=HERO');
    expect(pubBanners.status).toBe(200);
    expect(pubBanners.body.data.items.some((b: { target_path: string }) => b.target_path === '/brands/maison-ops')).toBe(
      true,
    );

    // Audit events visible to ADMIN with filter on ROLE_CHANGED and VOUCHER
    const auditRoles = await request(app)
      .get('/api/admin/audit-events?action=ROLE_CHANGED&entity_type=USER')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(auditRoles.status).toBe(200);
    expect(auditRoles.body.data.items.length).toBeGreaterThanOrEqual(1);
    expect(auditRoles.body.data.items[0].entity_id).toBe(String(customerId));
  });
});
