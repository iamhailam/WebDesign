import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { runner } from 'node-pg-migrate';
import pg from 'pg';
import { migrationConnection, readEnvironment } from './environment.mjs';

if (readEnvironment().NODE_ENV === 'production') {
  throw new Error('Benchmark script is disabled in production.');
}

const ORDERS_TARGET = 60_000;
const BENCH_USERS = 200;

const baseConfig = migrationConnection();
const admin = new pg.Client(baseConfig);
const dbName = `bench_orders_${randomBytes(6).toString('hex')}`;
let created = false;
let benchClient;

function dbConfigFor(database) {
  if (baseConfig.connectionString) {
    const url = new URL(baseConfig.connectionString);
    url.pathname = `/${database}`;
    return { connectionString: url.href };
  }
  return { ...baseConfig, database };
}

async function runExplain(client, sql, params = []) {
  const res = await client.query(`EXPLAIN (ANALYZE, BUFFERS) ${sql}`, params);
  const lines = res.rows.map((r) => r['QUERY PLAN']);
  const execLine = lines.find((l) => l.startsWith('Execution Time:')) ?? '';
  const planLine = lines.find((l) => l.startsWith('Planning Time:')) ?? '';
  return {
    executionTime: execLine.replace('Execution Time:', '').trim(),
    planningTime: planLine.replace('Planning Time:', '').trim(),
    planText: lines.join('\n'),
  };
}

try {
  await admin.connect();
  await admin.query(`CREATE DATABASE "${dbName}" TEMPLATE template0`);
  created = true;

  const targetConfig = dbConfigFor(dbName);
  await runner({
    databaseUrl: targetConfig,
    dir: fileURLToPath(new URL('../database/migrations/', import.meta.url)),
    migrationsTable: 'pgmigrations',
    direction: 'up',
    checkOrder: true,
    log: () => undefined,
  });

  benchClient = new pg.Client(targetConfig);
  await benchClient.connect();

  await benchClient.query('BEGIN');
  await benchClient.query(await readFile(new URL('../database/seeds/001_demo.sql', import.meta.url), 'utf8'));
  await benchClient.query(await readFile(new URL('../database/seeds/002_multibrand_demo.sql', import.meta.url), 'utf8'));
  await benchClient.query('COMMIT');

  // Ensure benchmark users and variant references
  await benchClient.query('BEGIN');
  await benchClient.query(
    `INSERT INTO app.users (full_name, email, password_hash, phone, role, is_active)
     SELECT 'Bench Customer ' || g,
            'bench' || g || '@example.invalid',
            '$argon2id$v=19$m=19456,t=2,p=1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
            '090' || lpad(g::text, 7, '0'),
            'CUSTOMER',
            TRUE
     FROM generate_series(1, $1) AS g`,
    [BENCH_USERS],
  );

  const userRes = await benchClient.query(
    `SELECT id FROM app.users WHERE email LIKE 'bench%@example.invalid' ORDER BY id ASC`,
  );
  const userIds = userRes.rows.map((r) => r.id);
  const targetUserId = userIds[0];

  const varRes = await benchClient.query(
    `SELECT v.id, v.sku, v.price, p.name AS product_name, b.name AS brand_name
     FROM app.product_variants v
     JOIN app.products p ON p.id = v.product_id
     JOIN app.brands b ON b.id = p.brand_id
     WHERE v.is_active
     ORDER BY v.id ASC
     LIMIT 2`,
  );
  const v1 = varRes.rows[0];
  const v2 = varRes.rows[1];
  if (!v1 || !v2 || v1.id === v2.id) {
    throw new Error('Benchmark requires at least 2 distinct active variants.');
  }
  const subtotal = (Number(v1.price) + Number(v2.price)).toFixed(2);

  // TX 1: Bulk insert 60,000 PENDING orders + 120,000 order_items satisfying all deferred/row triggers
  await benchClient.query(
    `WITH inserted_orders AS (
       INSERT INTO app.orders (
         order_code, user_id, shipping_address, recipient_name, recipient_phone,
         subtotal_amount, discount_amount, final_amount, voucher_code_snapshot,
         status, payment_method, payment_status, created_at
       )
       SELECT
         'BENCH-' || lpad(g::text, 6, '0'),
         $1::int + (g % $2),
         'So 123 Duong Benchmark, Quan 1, TP HCM #' || g,
         'Bench Recipient ' || g,
         '0912345678',
         $3::numeric(12,2),
         0.00,
         $3::numeric(12,2),
         NULL,
         'PENDING',
         'COD',
         'UNPAID',
         NOW() - ((g % 180) || ' days')::interval - ((g % 86400) || ' seconds')::interval
       FROM generate_series(1, $4) AS g
       RETURNING id
     )
     INSERT INTO app.order_items (
       order_id, variant_id, product_name, brand_name,
       sku, options_snapshot, quantity, unit_price, list_unit_price
     )
     SELECT io.id, $5::int, $6::text, $7::text, $8::text, '[{"code":"color","label":"Mau","value_code":"black","value_label":"Den"}]'::jsonb, 1, $9::numeric(12,2), NULL::numeric(12,2)
     FROM inserted_orders io
     UNION ALL
     SELECT io.id, $10::int, $11::text, $12::text, $13::text, '[{"code":"color","label":"Mau","value_code":"white","value_label":"Trang"}]'::jsonb, 1, $14::numeric(12,2), NULL::numeric(12,2)
     FROM inserted_orders io`,
    [
      targetUserId,
      BENCH_USERS,
      subtotal,
      ORDERS_TARGET,
      v1.id,
      v1.product_name,
      v1.brand_name,
      v1.sku,
      v1.price,
      v2.id,
      v2.product_name,
      v2.brand_name,
      v2.sku,
      v2.price,
    ],
  );
  await benchClient.query('COMMIT');

  // Stepwise valid state transitions (same guard rules as production)
  // 1..52000 -> CONFIRMED -> SHIPPING -> DELIVERED (86.7% DELIVERED)
  // 52001..55000 -> CANCELLED (5%)
  // 55001..56500 -> SHIPPING (2.5%)
  // 56501..58000 -> CONFIRMED (2.5%)
  // 58001..60000 -> PENDING (3.3%)
  await benchClient.query('BEGIN');
  await benchClient.query(`UPDATE app.orders SET status = 'CONFIRMED' WHERE order_code BETWEEN 'BENCH-000001' AND 'BENCH-056500'`);
  await benchClient.query(`UPDATE app.orders SET status = 'CONFIRMED' WHERE order_code BETWEEN 'BENCH-056501' AND 'BENCH-058000'`);
  await benchClient.query(`UPDATE app.orders SET status = 'CANCELLED' WHERE order_code BETWEEN 'BENCH-052001' AND 'BENCH-055000'`);
  await benchClient.query('COMMIT');

  await benchClient.query('BEGIN');
  await benchClient.query(`UPDATE app.orders SET status = 'SHIPPING' WHERE order_code BETWEEN 'BENCH-000001' AND 'BENCH-052000'`);
  await benchClient.query(`UPDATE app.orders SET status = 'SHIPPING' WHERE order_code BETWEEN 'BENCH-055001' AND 'BENCH-056500'`);
  await benchClient.query('COMMIT');

  await benchClient.query('BEGIN');
  await benchClient.query(
    `UPDATE app.orders
     SET status = 'DELIVERED',
         payment_status = 'PAID',
         delivered_at = created_at + INTERVAL '2 days'
     WHERE order_code BETWEEN 'BENCH-000001' AND 'BENCH-052000'`,
  );
  await benchClient.query('COMMIT');

  await benchClient.query('VACUUM ANALYZE app.orders');
  await benchClient.query('VACUUM ANALYZE app.order_items');

  const counts = await benchClient.query(`
    SELECT
      (SELECT count(*)::int FROM app.orders) AS orders_count,
      (SELECT count(*)::int FROM app.order_items) AS order_items_count,
      pg_size_pretty(pg_total_relation_size('app.orders')) AS orders_size,
      pg_size_pretty(pg_total_relation_size('app.order_items')) AS items_size,
      version() AS pg_version
  `);

  const queries = [
    {
      id: 'Q1',
      name: 'Customer order history (user_id, created_at DESC LIMIT 20)',
      sql: `SELECT id, order_code, status, final_amount, created_at
            FROM app.orders
            WHERE user_id = $1
            ORDER BY created_at DESC, id DESC
            LIMIT 20`,
      params: [targetUserId],
    },
    {
      id: 'Q2',
      name: 'Revenue report last 30 days (DELIVERED by delivered_at)',
      sql: `SELECT (delivered_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date AS revenue_date,
                   count(*)::int AS order_count,
                   sum(subtotal_amount) AS gross_amount,
                   sum(discount_amount) AS discount_amount,
                   sum(final_amount) AS revenue_amount
            FROM app.orders
            WHERE status = 'DELIVERED'
              AND delivered_at >= NOW() - INTERVAL '30 days'
            GROUP BY 1
            ORDER BY 1 DESC`,
      params: [],
    },
    {
      id: 'Q3',
      name: 'Active orders queue (PENDING/CONFIRMED/SHIPPING)',
      sql: `SELECT id, order_code, status, created_at
            FROM app.orders
            WHERE status IN ('PENDING', 'CONFIRMED', 'SHIPPING')
            ORDER BY created_at DESC, id DESC
            LIMIT 50`,
      params: [],
    },
    {
      id: 'Q4',
      name: 'Best-selling SKUs in last 30 delivered days',
      sql: `SELECT oi.variant_id, sum(oi.quantity)::bigint AS qty_sold
            FROM app.order_items oi
            JOIN app.orders o ON o.id = oi.order_id
            WHERE o.status = 'DELIVERED'
              AND o.delivered_at >= NOW() - INTERVAL '30 days'
            GROUP BY oi.variant_id
            ORDER BY qty_sold DESC
            LIMIT 20`,
      params: [],
    },
  ];

  // Warm cache & measure WITH indexes
  const indexedResults = {};
  for (const q of queries) {
    await benchClient.query(q.sql, q.params);
    indexedResults[q.id] = await runExplain(benchClient, q.sql, q.params);
  }

  // Drop secondary indexes on orders & order_items to measure BEFORE indexing
  await benchClient.query(`
    DROP INDEX IF EXISTS
      app.idx_orders_user_created,
      app.idx_orders_active_status,
      app.idx_orders_delivered,
      app.idx_orders_created,
      app.idx_order_items_variant
  `);
  await benchClient.query('ANALYZE app.orders');
  await benchClient.query('ANALYZE app.order_items');

  const unindexedResults = {};
  for (const q of queries) {
    await benchClient.query(q.sql, q.params);
    unindexedResults[q.id] = await runExplain(benchClient, q.sql, q.params);
  }

  console.log(
    JSON.stringify(
      {
        meta: counts.rows[0],
        results: queries.map((q) => ({
          id: q.id,
          name: q.name,
          before: unindexedResults[q.id],
          after: indexedResults[q.id],
        })),
      },
      null,
      2,
    ),
  );
} finally {
  await benchClient?.end().catch(() => undefined);
  if (created) {
    await admin.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`).catch(() => undefined);
  }
  await admin.end().catch(() => undefined);
}
