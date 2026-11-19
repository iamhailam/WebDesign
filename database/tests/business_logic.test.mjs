import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { runner } from 'node-pg-migrate';
import { migrationConnection } from '../../scripts/environment.mjs';

const migrationDir = fileURLToPath(new URL('../migrations/', import.meta.url));

function createBarrier(count) {
  let arrived = 0;
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  return async () => {
    arrived += 1;
    if (arrived === count) {
      release();
    }
    await gate;
  };
}

async function createIsolatedDatabase() {
  const config = migrationConnection();
  const admin = new pg.Client(config);
  const dbName = `logic_test_${randomBytes(8).toString('hex')}`;
  await admin.connect();
  await admin.query(`CREATE DATABASE "${dbName}" TEMPLATE template0`);
  const target = config.connectionString
    ? {
        connectionString: (() => {
          const url = new URL(config.connectionString);
          url.pathname = `/${dbName}`;
          return url.href;
        })(),
      }
    : { ...config, database: dbName };

  await runner({
    databaseUrl: target,
    dir: migrationDir,
    migrationsTable: 'pgmigrations',
    direction: 'up',
    checkOrder: true,
    log: () => undefined,
  });

  const db = new pg.Client(target);
  await db.connect();

  return {
    db,
    target,
    async cleanup() {
      await db.end().catch(() => undefined);
      await admin.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
      await admin.end().catch(() => undefined);
    },
  };
}

test('Task 04: Database Business Logic (PostgreSQL real concurrency & transactions)', { timeout: 120000 }, async (t) => {
  const env = await createIsolatedDatabase();
  const { db, target } = env;

  try {
    // Seed actors, brand, category, products, variants, images using db_admin
    const actors = {};
    for (const [key, role, active] of [
      ['c1', 'CUSTOMER', true],
      ['c2', 'CUSTOMER', true],
      ['c3', 'CUSTOMER', true],
      ['c4', 'CUSTOMER', true],
      ['c5', 'CUSTOMER', true],
      ['inactive_c', 'CUSTOMER', false],
      ['warehouse', 'WAREHOUSE', true],
      ['sales', 'SALES', true],
      ['admin', 'ADMIN', true],
    ]) {
      const row = (await db.query(
        `INSERT INTO app.users(full_name, email, password_hash, role, is_active)
         VALUES($1, $2, '!test-only-hash!', $3, $4) RETURNING id`,
        [`Test ${key}`, `${key}@logic-test.invalid`, role, active],
      )).rows[0];
      const cartId = (await db.query('SELECT id FROM app.carts WHERE user_id = $1', [row.id])).rows[0].id;
      actors[key] = { id: row.id, cartId };
    }

    const brandId = (await db.query(
      "INSERT INTO app.brands(name, slug, is_active) VALUES('Thương Hiệu Gốc', 'brand-goc', TRUE) RETURNING id",
    )).rows[0].id;
    const categoryId = (await db.query(
      "INSERT INTO app.categories(name, slug, is_active) VALUES('Áo Khoác', 'ao-khoac', TRUE) RETURNING id",
    )).rows[0].id;

    async function createClothingVariant(slug, sku, price, listPrice = null) {
      await db.query('BEGIN');
      try {
        const pid = (await db.query(
          "INSERT INTO app.products(category_id, brand_id, product_type_code, name, slug, is_active) VALUES($1, $2, 'CLOTHING', 'Áo Khoác Gốc', $3, FALSE) RETURNING id",
          [categoryId, brandId, slug],
        )).rows[0].id;
        const vid = (await db.query(
          'INSERT INTO app.product_variants(product_id, sku, price, list_price, is_active) VALUES($1, $2, $3, $4, TRUE) RETURNING id',
          [pid, sku, price, listPrice],
        )).rows[0].id;
        for (const [attr, val] of [['color', 'black'], ['clothing_size', 'm']]) {
          await db.query(
            `INSERT INTO app.variant_attribute_values(variant_id, attribute_id, value_id)
             SELECT $1, a.id, av.id FROM app.attributes a
             JOIN app.attribute_values av ON av.attribute_id = a.id
             WHERE a.code = $2 AND av.code = $3`,
            [vid, attr, val],
          );
        }
        await db.query(
          "INSERT INTO app.product_images(product_id, asset_path, alt_text, is_primary) VALUES($1, '/media/sanphamdemo1.jpg', 'Demo', TRUE)",
          [pid],
        );
        await db.query('UPDATE app.products SET is_active = TRUE WHERE id = $1', [pid]);
        await db.query('COMMIT');
        return { pid, vid };
      } catch (error) {
        await db.query('ROLLBACK').catch(() => undefined);
        throw error;
      }
    }

    const skuRaceStock = await createClothingVariant('prod-race-stock', 'SKU-RACE-STOCK', '100000.00', '150000.00');
    const skuRaceVoucher = await createClothingVariant('prod-race-voucher', 'SKU-RACE-VOUCHER', '200000.00');
    const skuMulti1 = await createClothingVariant('prod-multi-1', 'SKU-MULTI-1', '100000.00');
    const skuMulti2 = await createClothingVariant('prod-multi-2', 'SKU-MULTI-2', '150000.00');
    const skuHist = await createClothingVariant('prod-hist', 'SKU-HIST', '100000.00', '150000.00');

    const shipping = JSON.stringify({
      shipping_address: '123 Đường Kiểm Thử, Quận 1, TP HCM',
      recipient_name: 'Khách Hàng Test',
      recipient_phone: '0901234567',
    });

    async function runAsRuntime(fn) {
      const client = new pg.Client(target);
      await client.connect();
      try {
        await client.query('BEGIN');
        await client.query('SET LOCAL ROLE app_rw_user');
        const result = await fn(client);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
      } finally {
        await client.end();
      }
    }

    await t.test('sp_import_inventory enforces role, idempotency, overflow and ledger reconciliation', async () => {
      const reqKey = randomUUID();
      const first = await runAsRuntime(async (c) => {
        const res = await c.query(
          'CALL app.sp_import_inventory($1, $2, $3, $4, $5, NULL, NULL)',
          [skuRaceStock.vid, 1, 'Nhập hàng đợt 1', actors.warehouse.id, reqKey],
        );
        return res.rows[0];
      });
      assert.equal(first.p_replayed, false);
      assert.ok(Number(first.p_transaction_id) > 0);

      // Replay with exact same key & payload returns same transaction_id and does NOT double add
      const replay = await runAsRuntime(async (c) => {
        const res = await c.query(
          'CALL app.sp_import_inventory($1, $2, $3, $4, $5, NULL, NULL)',
          [skuRaceStock.vid, 1, 'Nhập hàng đợt 1', actors.warehouse.id, reqKey],
        );
        return res.rows[0];
      });
      assert.equal(replay.p_replayed, true);
      assert.equal(replay.p_transaction_id, first.p_transaction_id);
      assert.equal((await db.query('SELECT quantity FROM app.inventory WHERE variant_id = $1', [skuRaceStock.vid])).rows[0].quantity, 1);

      // Same key with different payload -> P1009
      await assert.rejects(
        runAsRuntime((c) =>
          c.query('CALL app.sp_import_inventory($1, $2, $3, $4, $5, NULL, NULL)', [skuRaceStock.vid, 5, 'Nhập hàng đợt 1', actors.warehouse.id, reqKey]),
        ),
        { code: 'P1009' },
      );

      // Non-warehouse/admin actor rejected -> P3001
      await assert.rejects(
        runAsRuntime((c) =>
          c.query('CALL app.sp_import_inventory($1, $2, $3, $4)', [skuRaceStock.vid, 5, 'Sai quyền', actors.c1.id]),
        ),
        { code: 'P3001' },
      );

      // Seed stock for remaining test variants using 4-arg SPEC overload and 7-arg procedure
      await runAsRuntime(async (c) => {
        await c.query('CALL app.sp_import_inventory($1, $2, $3, $4)', [skuRaceVoucher.vid, 20, 'Nhập test voucher', actors.admin.id]);
        await c.query('CALL app.sp_import_inventory($1, $2, $3, $4)', [skuMulti1.vid, 10, 'Nhập multi 1', actors.warehouse.id]);
        await c.query('CALL app.sp_import_inventory($1, $2, $3, $4)', [skuMulti2.vid, 1, 'Nhập multi 2', actors.warehouse.id]);
        await c.query('CALL app.sp_import_inventory($1, $2, $3, $4)', [skuHist.vid, 10, 'Nhập hist', actors.warehouse.id]);
      });
    });

    await t.test('fn_calculate_voucher_discount validates eligibility, rounding and inclusive dates', async () => {
      await db.query(
        `INSERT INTO app.vouchers(code, discount_type, discount_value, max_discount_amount, min_order_amount, usage_limit, start_date, end_date, is_active)
         VALUES
           ('PCT15-CAP', 'PERCENT', 15.00, 30000.00, 100000.00, 10, now() - interval '1 hour', now() + interval '1 day', TRUE),
           ('FIXED50', 'FIXED', 50000.00, NULL, 40000.00, 10, now() - interval '1 hour', now() + interval '1 day', TRUE),
           ('INACTIVE-V', 'FIXED', 10000.00, NULL, 0, 10, now() - interval '1 hour', now() + interval '1 day', FALSE),
           ('EXPIRED-V', 'FIXED', 10000.00, NULL, 0, 10, now() - interval '2 days', now() - interval '1 minute', TRUE),
           ('FUTURE-V', 'FIXED', 10000.00, NULL, 0, 10, now() + interval '1 hour', now() + interval '2 days', TRUE)`,
      );

      // 100005.00 * 15% = 15000.75 -> rounded half-up to 15001.00 VND
      const pctRounded = (await runAsRuntime((c) =>
        c.query("SELECT app.fn_calculate_voucher_discount('pct15-cap', $1, 100005.00)::text AS d", [actors.c1.id]),
      )).rows[0].d;
      assert.equal(pctRounded, '15001.00');

      // Capped at max_discount_amount 30000.00
      const pctCapped = (await runAsRuntime((c) =>
        c.query("SELECT app.fn_calculate_voucher_discount('PCT15-CAP', $1, 500000.00)::text AS d", [actors.c1.id]),
      )).rows[0].d;
      assert.equal(pctCapped, '30000.00');

      // FIXED clamped to subtotal
      const fixedClamped = (await runAsRuntime((c) =>
        c.query("SELECT app.fn_calculate_voucher_discount('FIXED50', $1, 45000.00)::text AS d", [actors.c1.id]),
      )).rows[0].d;
      assert.equal(fixedClamped, '45000.00');

      // Error cases
      await assert.rejects(runAsRuntime((c) => c.query("SELECT app.fn_calculate_voucher_discount('PCT15-CAP', $1, 99999.00)", [actors.c1.id])), { code: 'P1002' });
      await assert.rejects(runAsRuntime((c) => c.query("SELECT app.fn_calculate_voucher_discount('INACTIVE-V', $1, 100000.00)", [actors.c1.id])), { code: 'P1002' });
      await assert.rejects(runAsRuntime((c) => c.query("SELECT app.fn_calculate_voucher_discount('EXPIRED-V', $1, 100000.00)", [actors.c1.id])), { code: 'P1002' });
      await assert.rejects(runAsRuntime((c) => c.query("SELECT app.fn_calculate_voucher_discount('FUTURE-V', $1, 100000.00)", [actors.c1.id])), { code: 'P1002' });
      await assert.rejects(runAsRuntime((c) => c.query("SELECT app.fn_calculate_voucher_discount('NO-SUCH-CODE', $1, 100000.00)", [actors.c1.id])), { code: 'P1002' });
    });

    await t.test('A. 5 concurrent checkouts competing for SKU with stock = 1 -> 1 succeeds, 4 fail P1001', async () => {
      const customerKeys = ['c1', 'c2', 'c3', 'c4', 'c5'];
      for (const k of customerKeys) {
        await db.query('INSERT INTO app.cart_items(cart_id, variant_id, quantity) VALUES($1, $2, 1)', [actors[k].cartId, skuRaceStock.vid]);
      }

      const barrier = createBarrier(5);
      const results = await Promise.all(
        customerKeys.map(async (k) => {
          const client = new pg.Client(target);
          await client.connect();
          try {
            await barrier();
            await client.query('BEGIN');
            await client.query('SET LOCAL ROLE app_rw_user');
            const res = await client.query(
              'SELECT * FROM app.fn_place_order($1, $2::jsonb, NULL, $3::uuid)',
              [actors[k].id, shipping, randomUUID()],
            );
            await client.query('COMMIT');
            return { ok: true, customer: k, order: res.rows[0] };
          } catch (error) {
            await client.query('ROLLBACK').catch(() => undefined);
            return { ok: false, customer: k, code: error.code, message: error.message };
          } finally {
            await client.end();
          }
        }),
      );

      const winners = results.filter((r) => r.ok);
      const losers = results.filter((r) => !r.ok);
      assert.equal(winners.length, 1);
      assert.equal(losers.length, 4);
      for (const l of losers) {
        assert.equal(l.code, 'P1001');
      }

      const qtyLeft = (await db.query('SELECT quantity FROM app.inventory WHERE variant_id = $1', [skuRaceStock.vid])).rows[0].quantity;
      assert.equal(qtyLeft, 0);

      const exportsCount = (await db.query(
        "SELECT count(*)::int AS n FROM app.inventory_transactions WHERE variant_id = $1 AND type = 'EXPORT_ORDER'",
        [skuRaceStock.vid],
      )).rows[0].n;
      assert.equal(exportsCount, 1);

      // Losing customers still keep their cart item; clean up for next tests
      const winnerKey = winners[0].customer;
      for (const k of customerKeys) {
        const count = (await db.query('SELECT count(*)::int AS n FROM app.cart_items WHERE cart_id = $1', [actors[k].cartId])).rows[0].n;
        assert.equal(count, k === winnerKey ? 0 : 1);
      }
      await db.query('DELETE FROM app.cart_items');
    });

    await t.test('B. 5 concurrent checkouts competing for voucher with 1 remaining usage -> 1 succeeds, 4 fail P1003', async () => {
      await db.query(
        `INSERT INTO app.vouchers(code, discount_type, discount_value, min_order_amount, usage_limit, start_date, end_date, is_active)
         VALUES('RACE-ONE-SLOT', 'FIXED', 50000.00, 100000.00, 1, now() - interval '1 hour', now() + interval '1 day', TRUE)`,
      );

      const customerKeys = ['c1', 'c2', 'c3', 'c4', 'c5'];
      for (const k of customerKeys) {
        await db.query('INSERT INTO app.cart_items(cart_id, variant_id, quantity) VALUES($1, $2, 1)', [actors[k].cartId, skuRaceVoucher.vid]);
      }

      const barrier = createBarrier(5);
      const results = await Promise.all(
        customerKeys.map(async (k) => {
          const client = new pg.Client(target);
          await client.connect();
          try {
            await barrier();
            await client.query('BEGIN');
            await client.query('SET LOCAL ROLE app_rw_user');
            const res = await client.query(
              'SELECT * FROM app.fn_place_order($1, $2::jsonb, $3, $4::uuid)',
              [actors[k].id, shipping, 'RACE-ONE-SLOT', randomUUID()],
            );
            await client.query('COMMIT');
            return { ok: true, customer: k, order: res.rows[0] };
          } catch (error) {
            await client.query('ROLLBACK').catch(() => undefined);
            return { ok: false, customer: k, code: error.code };
          } finally {
            await client.end();
          }
        }),
      );

      const winners = results.filter((r) => r.ok);
      const losers = results.filter((r) => !r.ok);
      assert.equal(winners.length, 1);
      assert.equal(losers.length, 4);
      for (const l of losers) {
        assert.equal(l.code, 'P1003');
      }

      const vRow = (await db.query("SELECT used_count, usage_limit FROM app.vouchers WHERE code = 'RACE-ONE-SLOT'")).rows[0];
      assert.equal(vRow.used_count, 1);
      assert.equal(vRow.used_count, vRow.usage_limit);

      const usageCount = (await db.query(
        "SELECT count(*)::int AS n FROM app.voucher_usages vu JOIN app.vouchers v ON v.id = vu.voucher_id WHERE v.code = 'RACE-ONE-SLOT' AND vu.status = 'APPLIED'",
      )).rows[0].n;
      assert.equal(usageCount, 1);

      // Stock deducted only once (20 -> 19)
      const stockAfter = (await db.query('SELECT quantity FROM app.inventory WHERE variant_id = $1', [skuRaceVoucher.vid])).rows[0].quantity;
      assert.equal(stockAfter, 19);

      await db.query('DELETE FROM app.cart_items');
    });

    await t.test('C. Checkout failure on 2nd item rolls back 1st item deduction, voucher and order completely', async () => {
      // skuMulti1 has stock 10 (cart qty 2 -> deducted first in variant_id ASC loop),
      // skuMulti2 has stock 1 (cart qty 2 -> fails P1001!).
      await db.query(
        'INSERT INTO app.cart_items(cart_id, variant_id, quantity) VALUES($1, $2, 2), ($1, $3, 2)',
        [actors.c2.cartId, skuMulti1.vid, skuMulti2.vid],
      );

      const ordersBefore = (await db.query('SELECT count(*)::int AS n FROM app.orders')).rows[0].n;
      const ledgerBefore = (await db.query('SELECT count(*)::int AS n FROM app.inventory_transactions')).rows[0].n;
      const auditBefore = (await db.query('SELECT count(*)::int AS n FROM app.audit_events')).rows[0].n;

      await assert.rejects(
        runAsRuntime((c) =>
          c.query('SELECT * FROM app.fn_place_order($1, $2::jsonb, $3, $4::uuid)', [actors.c2.id, shipping, 'FIXED50', randomUUID()]),
        ),
        { code: 'P1001' },
      );

      assert.equal((await db.query('SELECT quantity FROM app.inventory WHERE variant_id = $1', [skuMulti1.vid])).rows[0].quantity, 10);
      assert.equal((await db.query('SELECT quantity FROM app.inventory WHERE variant_id = $1', [skuMulti2.vid])).rows[0].quantity, 1);
      assert.equal((await db.query("SELECT used_count FROM app.vouchers WHERE code = 'FIXED50'")).rows[0].used_count, 0);
      assert.equal((await db.query('SELECT count(*)::int AS n FROM app.orders')).rows[0].n, ordersBefore);
      assert.equal((await db.query('SELECT count(*)::int AS n FROM app.inventory_transactions')).rows[0].n, ledgerBefore);
      assert.equal((await db.query('SELECT count(*)::int AS n FROM app.audit_events')).rows[0].n, auditBefore);
      assert.equal((await db.query('SELECT count(*)::int AS n FROM app.cart_items WHERE cart_id = $1', [actors.c2.cartId])).rows[0].n, 2);

      // Also test failure at voucher step AFTER both items passed & deducted in the loop
      await db.query('UPDATE app.cart_items SET quantity = 1 WHERE cart_id = $1 AND variant_id = $2', [actors.c2.cartId, skuMulti2.vid]);
      await assert.rejects(
        runAsRuntime((c) =>
          c.query('SELECT * FROM app.fn_place_order($1, $2::jsonb, $3, $4::uuid)', [actors.c2.id, shipping, 'RACE-ONE-SLOT', randomUUID()]),
        ),
        { code: 'P1003' },
      );
      assert.equal((await db.query('SELECT quantity FROM app.inventory WHERE variant_id = $1', [skuMulti1.vid])).rows[0].quantity, 10);
      assert.equal((await db.query('SELECT quantity FROM app.inventory WHERE variant_id = $1', [skuMulti2.vid])).rows[0].quantity, 1);

      await db.query('DELETE FROM app.cart_items');
    });

    await t.test('D. Concurrent order cancellation restores multi-SKU stock and voucher exactly once', async () => {
      await db.query(
        'INSERT INTO app.cart_items(cart_id, variant_id, quantity) VALUES($1, $2, 2), ($1, $3, 1)',
        [actors.c3.cartId, skuMulti1.vid, skuMulti2.vid],
      );
      const placed = (await runAsRuntime((c) =>
        c.query('SELECT * FROM app.fn_place_order($1, $2::jsonb, $3, $4::uuid)', [actors.c3.id, shipping, 'FIXED50', randomUUID()]),
      )).rows[0];

      assert.equal((await db.query('SELECT quantity FROM app.inventory WHERE variant_id = $1', [skuMulti1.vid])).rows[0].quantity, 8);
      assert.equal((await db.query('SELECT quantity FROM app.inventory WHERE variant_id = $1', [skuMulti2.vid])).rows[0].quantity, 0);
      assert.equal((await db.query("SELECT used_count FROM app.vouchers WHERE code = 'FIXED50'")).rows[0].used_count, 1);

      // 4 concurrent cancellations (customer c3 + sales + admin + c3 again)
      const cancelActors = [actors.c3.id, actors.sales.id, actors.admin.id, actors.c3.id];
      const barrier = createBarrier(cancelActors.length);
      const results = await Promise.all(
        cancelActors.map(async (actorId) => {
          const client = new pg.Client(target);
          await client.connect();
          try {
            await barrier();
            await client.query('BEGIN');
            await client.query('SET LOCAL ROLE app_rw_user');
            const res = await client.query(
              'SELECT * FROM app.fn_cancel_order($1, $2, $3)',
              [placed.order_id, actorId, 'Hủy đồng thời'],
            );
            await client.query('COMMIT');
            return { ok: true, row: res.rows[0] };
          } catch (error) {
            await client.query('ROLLBACK').catch(() => undefined);
            return { ok: false, code: error.code };
          } finally {
            await client.end();
          }
        }),
      );

      assert.equal(results.filter((r) => r.ok).length, 1);
      assert.equal(results.filter((r) => !r.ok).length, 3);
      for (const loser of results.filter((r) => !r.ok)) {
        assert.equal(loser.code, 'P1010');
      }

      // Sequential duplicate cancel also returns P1010
      await assert.rejects(
        runAsRuntime((c) => c.query('SELECT * FROM app.fn_cancel_order($1, $2, $3)', [placed.order_id, actors.c3.id, 'Lần 2'])),
        { code: 'P1010' },
      );

      // Stock and voucher counter restored exactly once
      assert.equal((await db.query('SELECT quantity FROM app.inventory WHERE variant_id = $1', [skuMulti1.vid])).rows[0].quantity, 10);
      assert.equal((await db.query('SELECT quantity FROM app.inventory WHERE variant_id = $1', [skuMulti2.vid])).rows[0].quantity, 1);
      assert.equal((await db.query("SELECT used_count FROM app.vouchers WHERE code = 'FIXED50'")).rows[0].used_count, 0);
      assert.equal((await db.query('SELECT status FROM app.voucher_usages WHERE order_id = $1', [placed.order_id])).rows[0].status, 'RELEASED');
      assert.equal((await db.query("SELECT count(*)::int AS n FROM app.inventory_transactions WHERE reference_id = $1 AND type = 'RETURN_CANCEL'", [placed.order_id])).rows[0].n, 2);

      // Unauthorized actor (c4 or warehouse) cannot cancel another order
      await db.query('INSERT INTO app.cart_items(cart_id, variant_id, quantity) VALUES($1, $2, 1)', [actors.c3.cartId, skuMulti1.vid]);
      const order2 = (await runAsRuntime((c) =>
        c.query('SELECT * FROM app.fn_place_order($1, $2::jsonb, $3, $4::uuid)', [actors.c3.id, shipping, 'FIXED50', randomUUID()]),
      )).rows[0];
      await assert.rejects(
        runAsRuntime((c) => c.query('SELECT * FROM app.fn_cancel_order($1, $2, $3)', [order2.order_id, actors.c4.id, 'IDOR'])),
        { code: 'P3001' },
      );
      await assert.rejects(
        runAsRuntime((c) => c.query('SELECT * FROM app.fn_cancel_order($1, $2, $3)', [order2.order_id, actors.warehouse.id, 'Wrong role'])),
        { code: 'P3001' },
      );
      // Cancel cleanly so stock returns
      await runAsRuntime((c) => c.query('SELECT * FROM app.fn_cancel_order($1, $2, $3)', [order2.order_id, actors.c3.id, 'Cleanup']));
    });

    await t.test('E. Price & catalog changes after purchase do not alter historical order_items snapshots', async () => {
      await db.query('INSERT INTO app.cart_items(cart_id, variant_id, quantity) VALUES($1, $2, 2)', [actors.c4.cartId, skuHist.vid]);
      const idempKey = randomUUID();
      const firstOrder = (await runAsRuntime((c) =>
        c.query('SELECT * FROM app.fn_place_order($1, $2::jsonb, NULL, $3::uuid)', [actors.c4.id, shipping, idempKey]),
      )).rows[0];
      assert.equal(firstOrder.replayed, false);

      // Verify idempotency replay returns same order
      const replayOrder = (await runAsRuntime((c) =>
        c.query('SELECT * FROM app.fn_place_order($1, $2::jsonb, NULL, $3::uuid)', [actors.c4.id, shipping, idempKey]),
      )).rows[0];
      assert.equal(replayOrder.replayed, true);
      assert.equal(replayOrder.order_id, firstOrder.order_id);

      // Mutate catalog price, list_price, product name, brand name
      await db.query("UPDATE app.product_variants SET price = 250000.00, list_price = 320000.00 WHERE id = $1", [skuHist.vid]);
      await db.query("UPDATE app.products SET name = 'Áo Khoác Đã Đổi Tên' WHERE id = $1", [skuHist.pid]);
      await db.query("UPDATE app.brands SET name = 'Thương Hiệu Đã Đổi Tên' WHERE id = $1", [brandId]);

      // Historical order keeps exact original prices and names
      const histOrder = (await db.query('SELECT subtotal_amount::text, final_amount::text FROM app.orders WHERE id = $1', [firstOrder.order_id])).rows[0];
      const histItem = (await db.query('SELECT unit_price::text, list_unit_price::text, product_name, brand_name, sku, options_snapshot FROM app.order_items WHERE order_id = $1', [firstOrder.order_id])).rows[0];
      assert.deepEqual(histOrder, { subtotal_amount: '200000.00', final_amount: '200000.00' });
      assert.equal(histItem.unit_price, '100000.00');
      assert.equal(histItem.list_unit_price, '150000.00');
      assert.equal(histItem.product_name, 'Áo Khoác Gốc');
      assert.equal(histItem.brand_name, 'Thương Hiệu Gốc');
      assert.equal(histItem.sku, 'SKU-HIST');
      assert.equal(histItem.options_snapshot.length, 2);

      // New order after mutation uses the new catalog prices & names while order #1 stays frozen
      const cartVer = (await db.query('SELECT version FROM app.carts WHERE id = $1', [actors.c4.cartId])).rows[0].version;
      await db.query('INSERT INTO app.cart_items(cart_id, variant_id, quantity) VALUES($1, $2, 1)', [actors.c4.cartId, skuHist.vid]);
      // Expected old price triggers P1007 PRICE_CHANGED
      await assert.rejects(
        runAsRuntime((c) =>
          c.query(
            'SELECT * FROM app.fn_place_order($1, $2::jsonb, NULL, $3::uuid, $4, $5::jsonb)',
            [actors.c4.id, shipping, randomUUID(), cartVer, JSON.stringify([{ variant_id: skuHist.vid, quantity: 1, unit_price: '100000.00' }])],
          ),
        ),
        { code: 'P1007' },
      );

      const secondOrder = (await runAsRuntime((c) =>
        c.query(
          'SELECT * FROM app.fn_place_order($1, $2::jsonb, NULL, $3::uuid, $4, $5::jsonb)',
          [actors.c4.id, shipping, randomUUID(), cartVer, JSON.stringify([{ variant_id: skuHist.vid, quantity: 1, unit_price: '250000.00' }])],
        ),
      )).rows[0];
      const newItem = (await db.query('SELECT unit_price::text, product_name, brand_name FROM app.order_items WHERE order_id = $1', [secondOrder.order_id])).rows[0];
      assert.deepEqual(newItem, { unit_price: '250000.00', product_name: 'Áo Khoác Đã Đổi Tên', brand_name: 'Thương Hiệu Đã Đổi Tên' });

      // Order #1 still frozen
      const histItemAgain = (await db.query('SELECT unit_price::text, product_name FROM app.order_items WHERE order_id = $1', [firstOrder.order_id])).rows[0];
      assert.deepEqual(histItemAgain, { unit_price: '100000.00', product_name: 'Áo Khoác Gốc' });
    });

    await t.test('Order transition, trg_protect_finalized_orders, trg_set_updated_at & reporting views', async () => {
      // Deliver the Test E 2-unit skuHist order (200000.00) while leaving other orders PENDING/CANCELLED
      const deliveredTarget = (await db.query(
        `SELECT o.id, o.updated_at
         FROM app.orders o
         JOIN app.order_items oi ON oi.order_id = o.id
         WHERE o.user_id = $1 AND oi.variant_id = $2 AND oi.quantity = 2
         ORDER BY o.id ASC LIMIT 1`,
        [actors.c4.id, skuHist.vid],
      )).rows[0];

      // Cannot jump directly from PENDING -> DELIVERED
      await assert.rejects(
        runAsRuntime((c) => c.query("SELECT * FROM app.fn_transition_order($1, $2, 'PENDING', 'DELIVERED')", [deliveredTarget.id, actors.sales.id])),
        { code: 'P1011' },
      );

      // Step-by-step PENDING -> CONFIRMED -> SHIPPING -> DELIVERED
      await runAsRuntime((c) => c.query("SELECT * FROM app.fn_transition_order($1, $2, 'PENDING', 'CONFIRMED')", [deliveredTarget.id, actors.sales.id]));
      await runAsRuntime((c) => c.query("SELECT * FROM app.fn_transition_order($1, $2, 'CONFIRMED', 'SHIPPING')", [deliveredTarget.id, actors.sales.id]));

      // Cannot cancel once SHIPPING
      await assert.rejects(
        runAsRuntime((c) => c.query('SELECT * FROM app.fn_cancel_order($1, $2, $3)', [deliveredTarget.id, actors.c4.id, 'Quá muộn'])),
        { code: 'P1010' },
      );

      const delivered = (await runAsRuntime((c) =>
        c.query("SELECT * FROM app.fn_transition_order($1, $2, 'SHIPPING', 'DELIVERED')", [deliveredTarget.id, actors.admin.id]),
      )).rows[0];
      assert.equal(delivered.status, 'DELIVERED');
      assert.equal(delivered.payment_status, 'PAID');
      assert.ok(delivered.delivered_at !== null);
      assert.ok(new Date(delivered.updated_at).getTime() >= new Date(deliveredTarget.updated_at).getTime());

      // trg_protect_finalized_orders exists and blocks direct mutation/delete even for db_admin
      const trigExists = (await db.query(
        "SELECT count(*)::int AS n FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'app' AND c.relname = 'orders' AND t.tgname = 'trg_protect_finalized_orders'",
      )).rows[0].n;
      assert.equal(trigExists, 1);

      await assert.rejects(db.query('DELETE FROM app.orders WHERE id = $1', [deliveredTarget.id]), { code: '23514' });
      await assert.rejects(db.query("UPDATE app.orders SET status = 'CANCELLED', payment_status = 'UNPAID', delivered_at = NULL WHERE id = $1", [deliveredTarget.id]), { code: '23514' });

      // report_ro_user reads ONLY DELIVERED orders in vw_revenue_summary & vw_best_selling_products
      const reportClient = new pg.Client(target);
      await reportClient.connect();
      try {
        await reportClient.query('BEGIN');
        await reportClient.query('SET LOCAL ROLE report_ro_user');
        const rev = (await reportClient.query('SELECT sum(order_count)::int AS orders, sum(revenue_amount)::text AS revenue FROM app.vw_revenue_summary')).rows[0];
        assert.deepEqual(rev, { orders: 1, revenue: '200000.00' });
        const best = (await reportClient.query('SELECT variant_id, quantity_sold::int, sales_rank::int FROM app.vw_best_selling_products')).rows;
        assert.deepEqual(best, [{ variant_id: skuHist.vid, quantity_sold: 2, sales_rank: 1 }]);
        await reportClient.query('ROLLBACK');
      } finally {
        await reportClient.end();
      }

      // Inventory balance == SUM(inventory_transactions.quantity_change) across EVERY variant
      const drift = (await db.query(
        'SELECT count(*)::int AS n FROM app.inventory i WHERE i.quantity <> COALESCE((SELECT sum(quantity_change) FROM app.inventory_transactions it WHERE it.variant_id = i.variant_id), 0)',
      )).rows[0].n;
      assert.equal(drift, 0);
    });
  } finally {
    await env.cleanup();
  }
});
