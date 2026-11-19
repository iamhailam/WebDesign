import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { parse } from 'dotenv';
import { runner } from 'node-pg-migrate';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';

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

describe('E2E HTTP + PostgreSQL Shopping Flow (Product -> Variant -> Cart -> Checkout -> Order)', () => {
  const { env, host, port, adminConfig } = loadDbSettings();
  const dbName = `shop_e2e_${randomBytes(6).toString('hex')}`;
  const jwtSettings = {
    secret: randomBytes(32).toString('hex'),
    issuer: 'fashion-api',
    audience: 'fashion-web',
  };

  let adminClient: pg.Client;
  let testAdminClient: pg.Client;
  let appPool: pg.Pool;
  let server: ReturnType<ReturnType<typeof createApp>['listen']>;
  let baseUrl = '';

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

    await testAdminClient.query('BEGIN');
    await testAdminClient.query(readFileSync(new URL('../../database/seeds/001_demo.sql', import.meta.url), 'utf8'));
    await testAdminClient.query(
      readFileSync(new URL('../../database/seeds/002_multibrand_demo.sql', import.meta.url), 'utf8'),
    );
    await testAdminClient.query(
      `INSERT INTO app.vouchers(code, discount_type, discount_value, max_discount_amount, min_order_amount, usage_limit, used_count, start_date, end_date, is_active)
       VALUES('E2ESAVE100', 'FIXED', 100000.00, NULL, 500000.00, 10, 0, NOW() - INTERVAL '1 day', NOW() + INTERVAL '7 days', TRUE)
       ON CONFLICT (code) DO NOTHING`,
    );
    await testAdminClient.query('COMMIT');

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

    const app = createApp({
      checkDatabase: async () => {
        await appPool.query('SELECT 1');
      },
      frontendOrigin: 'http://127.0.0.1:4173',
      pool: appPool,
      jwt: jwtSettings,
    });

    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        const addr = server.address() as AddressInfo;
        baseUrl = `http://127.0.0.1:${addr.port}/api`;
        resolve();
      });
    });
  }, 30_000);

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      if (!server) return resolve();
      server.close(() => resolve());
    });
    await appPool?.end().catch(() => undefined);
    await testAdminClient?.end().catch(() => undefined);
    if (adminClient) {
      await adminClient.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`).catch(() => undefined);
      await adminClient.end().catch(() => undefined);
    }
  });

  it('executes live HTTP E2E flow: Product -> Variant -> Register/Login -> Cart -> Voucher Preview -> Checkout -> Order', async () => {
    // 1. Browse products & fetch product detail
    const productsResp = await fetch(`${baseUrl}/products?category_id=2&page=1&page_size=10`);
    expect(productsResp.status).toBe(200);
    const productsJson = (await productsResp.json()) as {
      data: { items: Array<{ slug: string }> };
    };
    const slug = productsJson.data.items[0]?.slug ?? 'ao-phao-nordic-peak';

    const detailResp = await fetch(`${baseUrl}/products/by-slug/${slug}`);
    expect(detailResp.status).toBe(200);
    const detailJson = (await detailResp.json()) as {
      data: {
        variants: Array<{ id: number; sku: string; price: string; stock_quantity: number }>;
      };
    };
    const inStockVariant = detailJson.data.variants.find((v) => v.stock_quantity >= 2);
    expect(inStockVariant).toBeDefined();
    const initialStock = inStockVariant!.stock_quantity;

    // 2. Register & Login customer
    const regResp = await fetch(`${baseUrl}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        full_name: 'E2E Shopper',
        email: 'e2eshopper@test.invalid',
        password: 'E2EStrongPassword!1',
        phone: '0901234567',
      }),
    });
    expect(regResp.status).toBe(201);

    const loginResp = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'e2eshopper@test.invalid',
        password: 'E2EStrongPassword!1',
      }),
    });
    expect(loginResp.status).toBe(200);
    const loginJson = (await loginResp.json()) as { data: { access_token: string } };
    const token = loginJson.data.access_token;

    // 3. Add variant to cart + update quantity
    const addResp = await fetch(`${baseUrl}/cart/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ variant_id: inStockVariant!.id, quantity: 1 }),
    });
    expect(addResp.status).toBe(200);

    const putResp = await fetch(`${baseUrl}/cart/items/${inStockVariant!.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ quantity: 2 }),
    });
    expect(putResp.status).toBe(200);
    const putJson = (await putResp.json()) as {
      data: { version: string; subtotal_amount: string };
    };

    // 4. Preview voucher E2ESAVE100
    const previewResp = await fetch(`${baseUrl}/vouchers/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        voucher_code: 'E2ESAVE100',
        cart_version: putJson.data.version,
        subtotal: putJson.data.subtotal_amount,
      }),
    });
    expect(previewResp.status).toBe(200);
    const previewJson = (await previewResp.json()) as {
      data: { discount_amount: string; final_amount: string };
    };
    expect(previewJson.data.discount_amount).toBe('100000.00');

    // 5. Checkout COD
    const checkoutResp = await fetch(`${baseUrl}/orders/checkout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'Idempotency-Key': randomUUID(),
      },
      body: JSON.stringify({
        shipping_address: '123 Nguyen Hue, Quan 1, TP.HCM',
        recipient_name: 'E2E Shopper',
        recipient_phone: '0901234567',
        voucher_code: 'E2ESAVE100',
        cart_version: putJson.data.version,
        expected_items: [
          {
            variant_id: inStockVariant!.id,
            quantity: 2,
            unit_price: inStockVariant!.price,
          },
        ],
      }),
    });
    expect(checkoutResp.status).toBe(201);
    const checkoutJson = (await checkoutResp.json()) as {
      data: { order: { id: number; order_code: string; status: string; final_amount: string } };
    };
    expect(checkoutJson.data.order.status).toBe('PENDING');
    expect(checkoutJson.data.order.final_amount).toBe(previewJson.data.final_amount);

    // 6. Verify Order Detail & My Orders & Stock Deduction
    const orderDetailResp = await fetch(`${baseUrl}/orders/${checkoutJson.data.order.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(orderDetailResp.status).toBe(200);

    const myOrdersResp = await fetch(`${baseUrl}/orders/my-orders`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(myOrdersResp.status).toBe(200);
    const myOrdersJson = (await myOrdersResp.json()) as { data: { items: Array<{ id: number }> } };
    expect(myOrdersJson.data.items.some((o) => o.id === checkoutJson.data.order.id)).toBe(true);

    const detailAfterResp = await fetch(`${baseUrl}/products/by-slug/${slug}`);
    const detailAfterJson = (await detailAfterResp.json()) as {
      data: { variants: Array<{ id: number; stock_quantity: number }> };
    };
    const updatedVariant = detailAfterJson.data.variants.find((v) => v.id === inStockVariant!.id);
    expect(updatedVariant?.stock_quantity).toBe(initialStock - 2);
  });
});
