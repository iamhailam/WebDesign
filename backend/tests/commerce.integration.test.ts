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

interface VariantInfo {
  id: number;
  price: string;
}

describe('Commerce API Integration & Concurrency (Express + PostgreSQL 17.9)', () => {
  const { env, host, port, adminConfig } = loadDbSettings();
  const dbName = `commerce_test_${randomBytes(6).toString('hex')}`;
  const jwtSettings = {
    secret: randomBytes(32).toString('hex'),
    issuer: 'fashion-api',
    audience: 'fashion-web',
  };

  let adminClient: pg.Client;
  let testAdminClient: pg.Client;
  let appPool: pg.Pool;
  let app: ReturnType<typeof createApp>;

  let customerAToken = '';
  let customerBToken = '';
  let adminToken = '';
  let salesToken = '';
  let warehouseToken = '';
  let marketingToken = '';
  const racerTokens: string[] = [];

  let activeBrandId = 0;
  let activeCategoryId = 0;
  let activeProductId = 0;
  let shirtMVariant: VariantInfo = { id: 0, price: '0.00' };
  let shirtLVariant: VariantInfo = { id: 0, price: '0.00' };
  let inactiveVariantId = 0;

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

    const pwHash = await hashPassword('CommercePass!123');
    await testAdminClient.query('BEGIN');

    // Create users across all 5 roles + 5 racer customers
    const userInserts: Array<[string, string, string]> = [
      ['Customer Alpha', 'alpha@commerce-test.invalid', 'CUSTOMER'],
      ['Customer Beta', 'beta@commerce-test.invalid', 'CUSTOMER'],
      ['Commerce Admin', 'admin@commerce-test.invalid', 'ADMIN'],
      ['Commerce Sales', 'sales@commerce-test.invalid', 'SALES'],
      ['Commerce Warehouse', 'warehouse@commerce-test.invalid', 'WAREHOUSE'],
      ['Commerce Marketing', 'marketing@commerce-test.invalid', 'MARKETING'],
      ['Racer 1', 'racer1@commerce-test.invalid', 'CUSTOMER'],
      ['Racer 2', 'racer2@commerce-test.invalid', 'CUSTOMER'],
      ['Racer 3', 'racer3@commerce-test.invalid', 'CUSTOMER'],
      ['Racer 4', 'racer4@commerce-test.invalid', 'CUSTOMER'],
      ['Racer 5', 'racer5@commerce-test.invalid', 'CUSTOMER'],
    ];
    for (const [fullName, email, role] of userInserts) {
      await testAdminClient.query(
        'INSERT INTO app.users(full_name, email, password_hash, role, is_active) VALUES($1, $2, $3, $4, TRUE)',
        [fullName, email, pwHash, role],
      );
    }

    const brandRes = await testAdminClient.query<{ id: number }>(
      "INSERT INTO app.brands(name, slug, is_active) VALUES('Atelier Test', 'atelier-test', TRUE) RETURNING id",
    );
    activeBrandId = brandRes.rows[0]?.id ?? 0;

    const catRes = await testAdminClient.query<{ id: number }>(
      "INSERT INTO app.categories(name, slug, is_active) VALUES('Tops', 'tops', TRUE) RETURNING id",
    );
    activeCategoryId = catRes.rows[0]?.id ?? 0;

    const prodRes = await testAdminClient.query<{ id: number }>(
      `INSERT INTO app.products(category_id, brand_id, product_type_code, name, slug, description, is_active)
       VALUES($1, $2, 'CLOTHING', 'Linen Resort Shirt', 'linen-resort-shirt', 'Breathable linen', TRUE)
       RETURNING id`,
      [activeCategoryId, activeBrandId],
    );
    activeProductId = prodRes.rows[0]?.id ?? 0;

    const v1 = await testAdminClient.query<{ id: number; price: string }>(
      `INSERT INTO app.product_variants(product_id, sku, list_price, price, is_active)
       VALUES($1, 'LINEN-WHT-M', 690000.00, 500000.00, TRUE)
       RETURNING id, price::text`,
      [activeProductId],
    );
    shirtMVariant = { id: v1.rows[0]?.id ?? 0, price: v1.rows[0]?.price ?? '0.00' };

    const v2 = await testAdminClient.query<{ id: number; price: string }>(
      `INSERT INTO app.product_variants(product_id, sku, list_price, price, is_active)
       VALUES($1, 'LINEN-BLK-L', 750000.00, 600000.00, TRUE)
       RETURNING id, price::text`,
      [activeProductId],
    );
    shirtLVariant = { id: v2.rows[0]?.id ?? 0, price: v2.rows[0]?.price ?? '0.00' };

    const v3 = await testAdminClient.query<{ id: number }>(
      `INSERT INTO app.product_variants(product_id, sku, list_price, price, is_active)
       VALUES($1, 'LINEN-ARC-S', 500000.00, 400000.00, FALSE)
       RETURNING id`,
      [activeProductId],
    );
    inactiveVariantId = v3.rows[0]?.id ?? 0;

    await testAdminClient.query(
      `INSERT INTO app.variant_attribute_values(variant_id, attribute_id, value_id)
       SELECT x.variant_id, a.id, av.id
       FROM (VALUES
         ($1::int, 'color', 'white'),
         ($1::int, 'clothing_size', 'm'),
         ($2::int, 'color', 'black'),
         ($2::int, 'clothing_size', 'l'),
         ($3::int, 'color', 'black'),
         ($3::int, 'clothing_size', 's')
       ) AS x(variant_id, attr_code, val_code)
       JOIN app.attributes a ON a.code = x.attr_code
       JOIN app.attribute_values av ON av.attribute_id = a.id AND av.code = x.val_code`,
      [shirtMVariant.id, shirtLVariant.id, inactiveVariantId],
    );

    await testAdminClient.query(
      `INSERT INTO app.product_images(product_id, asset_path, alt_text, is_primary)
       VALUES($1, '/media/sanphamdemo1.jpg', 'Linen Resort Shirt', TRUE)`,
      [activeProductId],
    );

    await testAdminClient.query(
      `INSERT INTO app.inventory(variant_id, quantity)
       VALUES($1, 20), ($2, 2), ($3, 5)
       ON CONFLICT (variant_id) DO UPDATE SET quantity = EXCLUDED.quantity`,
      [shirtMVariant.id, shirtLVariant.id, inactiveVariantId],
    );

    // Vouchers: active percent, high min_order, expired, and single-use race voucher
    await testAdminClient.query(
      `INSERT INTO app.vouchers(code, discount_type, discount_value, max_discount_amount, min_order_amount, usage_limit, used_count, start_date, end_date, is_active)
       VALUES
         ('SAVE100K', 'FIXED', 100000.00, NULL, 400000.00, 50, 0, NOW() - INTERVAL '1 day', NOW() + INTERVAL '7 days', TRUE),
         ('VIP2M', 'PERCENT', 20.00, 500000.00, 2000000.00, 50, 0, NOW() - INTERVAL '1 day', NOW() + INTERVAL '7 days', TRUE),
         ('EXPIRED10', 'FIXED', 50000.00, NULL, 0.00, 10, 0, NOW() - INTERVAL '10 days', NOW() - INTERVAL '1 day', TRUE),
         ('RACEONE', 'FIXED', 50000.00, NULL, 100000.00, 1, 0, NOW() - INTERVAL '1 day', NOW() + INTERVAL '7 days', TRUE)`,
    );

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

    customerAToken = await loginAs('alpha@commerce-test.invalid', 'CommercePass!123');
    customerBToken = await loginAs('beta@commerce-test.invalid', 'CommercePass!123');
    adminToken = await loginAs('admin@commerce-test.invalid', 'CommercePass!123');
    salesToken = await loginAs('sales@commerce-test.invalid', 'CommercePass!123');
    warehouseToken = await loginAs('warehouse@commerce-test.invalid', 'CommercePass!123');
    marketingToken = await loginAs('marketing@commerce-test.invalid', 'CommercePass!123');

    for (let i = 1; i <= 5; i++) {
      racerTokens.push(await loginAs(`racer${i}@commerce-test.invalid`, 'CommercePass!123'));
    }
  }, 30_000);

  afterAll(async () => {
    await appPool?.end().catch(() => undefined);
    await testAdminClient?.end().catch(() => undefined);
    if (adminClient) {
      await adminClient.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`).catch(() => undefined);
      await adminClient.end().catch(() => undefined);
    }
  });

  it('enforces auth and CUSTOMER-only boundaries on cart, voucher, and customer order routes', async () => {
    expect((await request(app).get('/api/cart')).status).toBe(401);
    expect((await request(app).post('/api/orders/checkout').send({})).status).toBe(401);

    for (const token of [adminToken, salesToken, warehouseToken, marketingToken]) {
      expect((await request(app).get('/api/cart').set('Authorization', `Bearer ${token}`)).status).toBe(403);
      expect(
        (
          await request(app)
            .post('/api/cart/items')
            .set('Authorization', `Bearer ${token}`)
            .send({ variant_id: shirtMVariant.id, quantity: 1 })
        ).status,
      ).toBe(403);
      expect((await request(app).get('/api/vouchers/available').set('Authorization', `Bearer ${token}`)).status).toBe(
        403,
      );
      expect((await request(app).get('/api/orders/my-orders').set('Authorization', `Bearer ${token}`)).status).toBe(403);
      expect(
        (await request(app).post('/api/orders/checkout').set('Authorization', `Bearer ${token}`).send({})).status,
      ).toBe(403);
    }
  });

  it('manages cart items using DB prices/stock without deducting inventory or accepting client totals', async () => {
    // Empty initial cart
    const emptyRes = await request(app).get('/api/cart').set('Authorization', `Bearer ${customerAToken}`);
    expect(emptyRes.status).toBe(200);
    expect(emptyRes.body.data.items).toEqual([]);
    expect(emptyRes.body.data.subtotal_amount).toBe('0.00');

    // Reject client-injected extra fields such as unit_price or subtotal
    const badExtra = await request(app)
      .post('/api/cart/items')
      .set('Authorization', `Bearer ${customerAToken}`)
      .send({ variant_id: shirtMVariant.id, quantity: 1, unit_price: '1.00' });
    expect(badExtra.status).toBe(400);
    expect(badExtra.body.error.code).toBe('VALIDATION_ERROR');

    // Inactive variant cannot be added
    const inactiveAdd = await request(app)
      .post('/api/cart/items')
      .set('Authorization', `Bearer ${customerAToken}`)
      .send({ variant_id: inactiveVariantId, quantity: 1 });
    expect(inactiveAdd.status).toBe(409);
    expect(inactiveAdd.body.error.code).toBe('ITEM_UNAVAILABLE');

    // Non-existent variant
    const missingAdd = await request(app)
      .post('/api/cart/items')
      .set('Authorization', `Bearer ${customerAToken}`)
      .send({ variant_id: 999999, quantity: 1 });
    expect(missingAdd.status).toBe(404);
    expect(missingAdd.body.error.code).toBe('NOT_FOUND');

    // Add quantity 1 then +1 -> accumulated to 2, version incremented
    const add1 = await request(app)
      .post('/api/cart/items')
      .set('Authorization', `Bearer ${customerAToken}`)
      .send({ variant_id: shirtMVariant.id, quantity: 1 });
    expect(add1.status).toBe(200);
    expect(add1.body.data.items).toHaveLength(1);
    expect(add1.body.data.items[0].quantity).toBe(1);
    expect(add1.body.data.subtotal_amount).toBe('500000.00');

    const add2 = await request(app)
      .post('/api/cart/items')
      .set('Authorization', `Bearer ${customerAToken}`)
      .send({ variant_id: shirtMVariant.id, quantity: 1 });
    expect(add2.status).toBe(200);
    expect(add2.body.data.items[0].quantity).toBe(2);
    expect(add2.body.data.subtotal_amount).toBe('1000000.00');
    expect(BigInt(add2.body.data.version)).toBeGreaterThan(BigInt(add1.body.data.version));

    // Stock was NOT deducted during cart mutations
    const stockCheck = await testAdminClient.query<{ quantity: number }>(
      'SELECT quantity FROM app.inventory WHERE variant_id = $1',
      [shirtMVariant.id],
    );
    expect(stockCheck.rows[0]?.quantity).toBe(20);

    // PUT updates quantity; putting absent variant returns 404 CART_ITEM_NOT_FOUND
    const putMissing = await request(app)
      .put(`/api/cart/items/${shirtLVariant.id}`)
      .set('Authorization', `Bearer ${customerAToken}`)
      .send({ quantity: 2 });
    expect(putMissing.status).toBe(404);
    expect(putMissing.body.error.code).toBe('CART_ITEM_NOT_FOUND');

    // Add shirt L with quantity 3 while inventory quantity=2 -> cart allows with stock warning
    const addL = await request(app)
      .post('/api/cart/items')
      .set('Authorization', `Bearer ${customerAToken}`)
      .send({ variant_id: shirtLVariant.id, quantity: 3 });
    expect(addL.status).toBe(200);
    expect(addL.body.data.has_stock_issues).toBe(true);
    const lItem = (addL.body.data.items as Array<Record<string, unknown>>).find(
      (i) => i.variant_id === shirtLVariant.id,
    );
    expect(lItem?.issue_code).toBe('OUT_OF_STOCK');

    // Remove shirt L
    const delL = await request(app)
      .delete(`/api/cart/items/${shirtLVariant.id}`)
      .set('Authorization', `Bearer ${customerAToken}`);
    expect(delL.status).toBe(200);
    expect(delL.body.data.has_stock_issues).toBe(false);
    expect(delL.body.data.items).toHaveLength(1);

    // PUT quantity back to 1 on shirt M
    const putM = await request(app)
      .put(`/api/cart/items/${shirtMVariant.id}`)
      .set('Authorization', `Bearer ${customerAToken}`)
      .send({ quantity: 1 });
    expect(putM.status).toBe(200);
    expect(putM.body.data.subtotal_amount).toBe('500000.00');
  });

  it('lists available vouchers and previews discount read-only without mutating usage counters', async () => {
    const cartRes = await request(app).get('/api/cart').set('Authorization', `Bearer ${customerAToken}`);
    expect(cartRes.status).toBe(200);
    const cartVersion = cartRes.body.data.version as string;

    const listRes = await request(app)
      .get('/api/vouchers/available?page=1&page_size=10')
      .set('Authorization', `Bearer ${customerAToken}`);
    expect(listRes.status).toBe(200);
    const items = listRes.body.data.items as Array<Record<string, unknown>>;
    const save100k = items.find((v) => v.code === 'SAVE100K');
    const vip2m = items.find((v) => v.code === 'VIP2M');
    expect(save100k?.eligible_for_cart).toBe(true);
    expect(vip2m?.eligible_for_cart).toBe(false);
    expect(vip2m?.ineligible_reason).toBe('MIN_ORDER_NOT_MET');
    expect(items.some((v) => v.code === 'EXPIRED10')).toBe(false);

    // Preview valid voucher
    const previewOk = await request(app)
      .post('/api/vouchers/preview')
      .set('Authorization', `Bearer ${customerAToken}`)
      .send({ voucher_code: 'save100k', cart_version: cartVersion, subtotal: '500000.00' });
    expect(previewOk.status).toBe(200);
    expect(previewOk.body.data).toEqual({
      voucher_code: 'SAVE100K',
      cart_version: cartVersion,
      subtotal_amount: '500000.00',
      discount_amount: '100000.00',
      final_amount: '400000.00',
      preview_only: true,
    });

    // Verify voucher usage untouched
    const voucherRow = await testAdminClient.query<{ used_count: number }>(
      "SELECT used_count FROM app.vouchers WHERE code = 'SAVE100K'",
    );
    expect(voucherRow.rows[0]?.used_count).toBe(0);

    // Tampered subtotal -> 409 PRICE_CHANGED
    const priceChanged = await request(app)
      .post('/api/vouchers/preview')
      .set('Authorization', `Bearer ${customerAToken}`)
      .send({ voucher_code: 'SAVE100K', cart_version: cartVersion, subtotal: '100000.00' });
    expect(priceChanged.status).toBe(409);
    expect(priceChanged.body.error.code).toBe('PRICE_CHANGED');

    // Stale cart_version -> 409 CART_CHANGED
    const staleVersion = await request(app)
      .post('/api/vouchers/preview')
      .set('Authorization', `Bearer ${customerAToken}`)
      .send({ voucher_code: 'SAVE100K', cart_version: '0' });
    expect(staleVersion.status).toBe(409);
    expect(staleVersion.body.error.code).toBe('CART_CHANGED');

    // Expired voucher -> 409 VOUCHER_INVALID
    const expiredPreview = await request(app)
      .post('/api/vouchers/preview')
      .set('Authorization', `Bearer ${customerAToken}`)
      .send({ voucher_code: 'EXPIRED10', cart_version: cartVersion });
    expect(expiredPreview.status).toBe(409);
    expect(expiredPreview.body.error.code).toBe('VOUCHER_INVALID');
  });

  it('rejects invalid checkout requests, rolls back item-2 OOS, handles idempotency, and preserves price snapshots', async () => {
    const validShipping = {
      shipping_address: '123 Nguyen Hue, Quan 1, TP.HCM',
      recipient_name: 'Nguyen Van A',
      recipient_phone: '0901234567',
    };

    // Empty cart rejection for Customer B (using Customer B's actual cart_version)
    const bCart = await request(app).get('/api/cart').set('Authorization', `Bearer ${customerBToken}`);
    expect(bCart.status).toBe(200);
    const emptyCheckout = await request(app)
      .post('/api/orders/checkout')
      .set('Authorization', `Bearer ${customerBToken}`)
      .set('Idempotency-Key', randomUUID())
      .send({
        ...validShipping,
        voucher_code: null,
        cart_version: bCart.body.data.version,
        expected_items: [{ variant_id: shirtMVariant.id, quantity: 1, unit_price: '500000.00' }],
      });
    expect(emptyCheckout.status).toBe(409);
    expect(emptyCheckout.body.error.code).toBe('CART_EMPTY');

    // Missing Idempotency-Key -> 400
    const missingKey = await request(app)
      .post('/api/orders/checkout')
      .set('Authorization', `Bearer ${customerAToken}`)
      .send({
        ...validShipping,
        voucher_code: null,
        cart_version: '1',
        expected_items: [{ variant_id: shirtMVariant.id, quantity: 1, unit_price: '500000.00' }],
      });
    expect(missingKey.status).toBe(400);
    expect(missingKey.body.error.code).toBe('VALIDATION_ERROR');

    // Customer A adds shirt L qty=5 (only 2 in stock) as 2nd item -> atomic rollback on item 2 OOS
    const withOosRes = await request(app)
      .post('/api/cart/items')
      .set('Authorization', `Bearer ${customerAToken}`)
      .send({ variant_id: shirtLVariant.id, quantity: 5 });
    expect(withOosRes.status).toBe(200);

    const oosCheckout = await request(app)
      .post('/api/orders/checkout')
      .set('Authorization', `Bearer ${customerAToken}`)
      .set('Idempotency-Key', randomUUID())
      .send({
        ...validShipping,
        voucher_code: 'SAVE100K',
        cart_version: withOosRes.body.data.version,
        expected_items: [
          { variant_id: shirtMVariant.id, quantity: 1, unit_price: '500000.00' },
          { variant_id: shirtLVariant.id, quantity: 5, unit_price: '600000.00' },
        ],
      });
    expect(oosCheckout.status).toBe(409);
    expect(oosCheckout.body.error.code).toBe('OUT_OF_STOCK');

    // Confirm complete rollback (no stock deducted on shirt M, voucher unused, zero orders for Customer A)
    const invM = await testAdminClient.query<{ quantity: number }>(
      'SELECT quantity FROM app.inventory WHERE variant_id = $1',
      [shirtMVariant.id],
    );
    expect(invM.rows[0]?.quantity).toBe(20);
    const vCount = await testAdminClient.query<{ used_count: number }>(
      "SELECT used_count FROM app.vouchers WHERE code = 'SAVE100K'",
    );
    expect(vCount.rows[0]?.used_count).toBe(0);

    // Fix shirt L to qty=1
    const fixedCart = await request(app)
      .put(`/api/cart/items/${shirtLVariant.id}`)
      .set('Authorization', `Bearer ${customerAToken}`)
      .send({ quantity: 1 });
    expect(fixedCart.status).toBe(200);
    const cartVer = fixedCart.body.data.version as string;

    // Stale expected_items unit_price -> 409 PRICE_CHANGED
    const priceMismatch = await request(app)
      .post('/api/orders/checkout')
      .set('Authorization', `Bearer ${customerAToken}`)
      .set('Idempotency-Key', randomUUID())
      .send({
        ...validShipping,
        voucher_code: null,
        cart_version: cartVer,
        expected_items: [
          { variant_id: shirtMVariant.id, quantity: 1, unit_price: '450000.00' },
          { variant_id: shirtLVariant.id, quantity: 1, unit_price: '600000.00' },
        ],
      });
    expect(priceMismatch.status).toBe(409);
    expect(priceMismatch.body.error.code).toBe('PRICE_CHANGED');

    // Successful checkout with idempotency key
    const idemKey = randomUUID();
    const checkoutPayload = {
      ...validShipping,
      voucher_code: 'SAVE100K',
      cart_version: cartVer,
      expected_items: [
        { variant_id: shirtMVariant.id, quantity: 1, unit_price: '500000.00' },
        { variant_id: shirtLVariant.id, quantity: 1, unit_price: '600000.00' },
      ],
    };

    const placedRes = await request(app)
      .post('/api/orders/checkout')
      .set('Authorization', `Bearer ${customerAToken}`)
      .set('Idempotency-Key', idemKey)
      .send(checkoutPayload);
    expect(placedRes.status).toBe(201);
    expect(placedRes.headers.location).toBe(`/api/orders/${placedRes.body.data.order.id}`);
    expect(placedRes.body.data.replayed).toBe(false);
    expect(placedRes.body.data.order.subtotal_amount).toBe('1100000.00');
    expect(placedRes.body.data.order.discount_amount).toBe('100000.00');
    expect(placedRes.body.data.order.final_amount).toBe('1000000.00');
    expect(placedRes.body.data.order.status).toBe('PENDING');

    const createdOrderId = placedRes.body.data.order.id as number;

    // Replay same Idempotency-Key + identical payload -> 200 replayed: true
    const replayRes = await request(app)
      .post('/api/orders/checkout')
      .set('Authorization', `Bearer ${customerAToken}`)
      .set('Idempotency-Key', idemKey)
      .send(checkoutPayload);
    expect(replayRes.status).toBe(200);
    expect(replayRes.body.data.replayed).toBe(true);
    expect(replayRes.body.data.order.id).toBe(createdOrderId);

    // Same Idempotency-Key + different payload -> 409 IDEMPOTENCY_KEY_REUSED
    const conflictRes = await request(app)
      .post('/api/orders/checkout')
      .set('Authorization', `Bearer ${customerAToken}`)
      .set('Idempotency-Key', idemKey)
      .send({ ...checkoutPayload, recipient_name: 'Different Name' });
    expect(conflictRes.status).toBe(409);
    expect(conflictRes.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');

    // Cart is now empty, stock deducted once
    const afterCart = await request(app).get('/api/cart').set('Authorization', `Bearer ${customerAToken}`);
    expect(afterCart.body.data.items).toEqual([]);
    const invAfter = await testAdminClient.query<{ variant_id: number; quantity: number }>(
      'SELECT variant_id, quantity FROM app.inventory WHERE variant_id = ANY($1::int[]) ORDER BY variant_id',
      [[shirtMVariant.id, shirtLVariant.id]],
    );
    expect(invAfter.rows).toEqual([
      { variant_id: shirtMVariant.id, quantity: 19 },
      { variant_id: shirtLVariant.id, quantity: 1 },
    ]);

    // Update live price of shirt M -> historical snapshot on created order remains 500000.00
    await testAdminClient.query('UPDATE app.product_variants SET list_price = 999000.00, price = 888000.00 WHERE id = $1', [
      shirtMVariant.id,
    ]);

    const detailRes = await request(app)
      .get(`/api/orders/${createdOrderId}`)
      .set('Authorization', `Bearer ${customerAToken}`);
    expect(detailRes.status).toBe(200);
    const snapshotM = (detailRes.body.data.items as Array<Record<string, unknown>>).find(
      (i) => i.variant_id === shirtMVariant.id,
    );
    expect(snapshotM?.unit_price).toBe('500000.00');

    // Restore original shirt M price for subsequent tests
    await testAdminClient.query('UPDATE app.product_variants SET list_price = 690000.00, price = 500000.00 WHERE id = $1', [
      shirtMVariant.id,
    ]);

    // Ownership isolation: Customer B cannot read or cancel Customer A's order (404 NOT_FOUND)
    const bList = await request(app).get('/api/orders/my-orders').set('Authorization', `Bearer ${customerBToken}`);
    expect(bList.status).toBe(200);
    expect(bList.body.data.items).toEqual([]);

    const bDetail = await request(app)
      .get(`/api/orders/${createdOrderId}`)
      .set('Authorization', `Bearer ${customerBToken}`);
    expect(bDetail.status).toBe(404);
    expect(bDetail.body.error.code).toBe('NOT_FOUND');

    const bCancel = await request(app)
      .post(`/api/orders/${createdOrderId}/cancel`)
      .set('Authorization', `Bearer ${customerBToken}`)
      .send({ reason: 'Try IDOR cancel' });
    expect(bCancel.status).toBe(404);
    expect(bCancel.body.error.code).toBe('NOT_FOUND');

    // Warehouse role cannot read/cancel orders (403 FORBIDDEN)
    expect(
      (await request(app).get(`/api/orders/${createdOrderId}`).set('Authorization', `Bearer ${warehouseToken}`))
        .status,
    ).toBe(403);
    expect(
      (
        await request(app)
          .post(`/api/orders/${createdOrderId}/cancel`)
          .set('Authorization', `Bearer ${warehouseToken}`)
          .send({ reason: 'Unauthorized role' })
      ).status,
    ).toBe(403);

    // Concurrent cancel on Customer A's order: 2 requests -> 1 x 200, 1 x 409 ORDER_NOT_CANCELLABLE
    const [cancel1, cancel2] = await Promise.all([
      request(app)
        .post(`/api/orders/${createdOrderId}/cancel`)
        .set('Authorization', `Bearer ${customerAToken}`)
        .send({ reason: 'Changed mind 1' }),
      request(app)
        .post(`/api/orders/${createdOrderId}/cancel`)
        .set('Authorization', `Bearer ${salesToken}`)
        .send({ reason: 'Sales concurrent cancel' }),
    ]);
    const cancelStatuses = [cancel1.status, cancel2.status].sort((a, b) => a - b);
    expect(cancelStatuses).toEqual([200, 409]);
    const failedCancel = cancel1.status === 409 ? cancel1 : cancel2;
    expect(failedCancel.body.error.code).toBe('ORDER_NOT_CANCELLABLE');

    // Stock restored once (20, 2) and voucher restored once (used_count = 0)
    const invRestored = await testAdminClient.query<{ variant_id: number; quantity: number }>(
      'SELECT variant_id, quantity FROM app.inventory WHERE variant_id = ANY($1::int[]) ORDER BY variant_id',
      [[shirtMVariant.id, shirtLVariant.id]],
    );
    expect(invRestored.rows).toEqual([
      { variant_id: shirtMVariant.id, quantity: 20 },
      { variant_id: shirtLVariant.id, quantity: 2 },
    ]);
    const voucherRestored = await testAdminClient.query<{ used_count: number }>(
      "SELECT used_count FROM app.vouchers WHERE code = 'SAVE100K'",
    );
    expect(voucherRestored.rows[0]?.used_count).toBe(0);

    // Filter my-orders by CANCELLED returns 1
    const aOrders = await request(app)
      .get('/api/orders/my-orders?status=CANCELLED')
      .set('Authorization', `Bearer ${customerAToken}`);
    expect(aOrders.status).toBe(200);
    expect(aOrders.body.data.items).toHaveLength(1);
    expect(aOrders.body.data.items[0].status).toBe('CANCELLED');
  });

  it('prevents overselling when 5 customers checkout concurrently for stock = 1', async () => {
    await testAdminClient.query('UPDATE app.inventory SET quantity = 1 WHERE variant_id = $1', [shirtLVariant.id]);

    const cartVersions: string[] = [];
    for (const token of racerTokens) {
      const added = await request(app)
        .post('/api/cart/items')
        .set('Authorization', `Bearer ${token}`)
        .send({ variant_id: shirtLVariant.id, quantity: 1 });
      expect(added.status).toBe(200);
      cartVersions.push(added.body.data.version as string);
    }

    const responses = await Promise.all(
      racerTokens.map((token, idx) =>
        request(app)
          .post('/api/orders/checkout')
          .set('Authorization', `Bearer ${token}`)
          .set('Idempotency-Key', randomUUID())
          .send({
            shipping_address: `Race Street #${idx + 1}, District 1, HCMC`,
            recipient_name: `Racer ${idx + 1}`,
            recipient_phone: `090900000${idx + 1}`,
            voucher_code: null,
            cart_version: cartVersions[idx],
            expected_items: [{ variant_id: shirtLVariant.id, quantity: 1, unit_price: '600000.00' }],
          }),
      ),
    );

    const winners = responses.filter((r) => r.status === 201);
    const losers = responses.filter((r) => r.status === 409);
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(4);
    for (const loser of losers) {
      expect(loser.body.error.code).toBe('OUT_OF_STOCK');
    }

    const stockFinal = await testAdminClient.query<{ quantity: number }>(
      'SELECT quantity FROM app.inventory WHERE variant_id = $1',
      [shirtLVariant.id],
    );
    expect(stockFinal.rows[0]?.quantity).toBe(0);
  });

  it('prevents voucher over-redemption when 5 customers race on a voucher with 1 slot left', async () => {
    // Clear any leftover cart items for racers then add stocked shirt M
    const cartVersions: string[] = [];
    for (const token of racerTokens) {
      await request(app)
        .delete(`/api/cart/items/${shirtLVariant.id}`)
        .set('Authorization', `Bearer ${token}`);
      const added = await request(app)
        .post('/api/cart/items')
        .set('Authorization', `Bearer ${token}`)
        .send({ variant_id: shirtMVariant.id, quantity: 1 });
      expect(added.status).toBe(200);
      cartVersions.push(added.body.data.version as string);
    }

    const responses = await Promise.all(
      racerTokens.map((token, idx) =>
        request(app)
          .post('/api/orders/checkout')
          .set('Authorization', `Bearer ${token}`)
          .set('Idempotency-Key', randomUUID())
          .send({
            shipping_address: `Voucher Street #${idx + 1}, District 3, HCMC`,
            recipient_name: `Racer Voucher ${idx + 1}`,
            recipient_phone: `091100000${idx + 1}`,
            voucher_code: 'RACEONE',
            cart_version: cartVersions[idx],
            expected_items: [{ variant_id: shirtMVariant.id, quantity: 1, unit_price: '500000.00' }],
          }),
      ),
    );

    const winners = responses.filter((r) => r.status === 201);
    const losers = responses.filter((r) => r.status === 409);
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(4);
    for (const loser of losers) {
      expect(loser.body.error.code).toBe('VOUCHER_EXHAUSTED');
    }

    const voucherFinal = await testAdminClient.query<{ used_count: number }>(
      "SELECT used_count FROM app.vouchers WHERE code = 'RACEONE'",
    );
    expect(voucherFinal.rows[0]?.used_count).toBe(1);
  });
});
