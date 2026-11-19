import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { runner } from 'node-pg-migrate';
import { migrationConnection, readEnvironment, root } from './environment.mjs';

// Local Docker drill only. Never dump an existing application/production DB.
const env = readEnvironment();
const config = migrationConnection(env);
if (env.NODE_ENV === 'production' || config.connectionString || !['127.0.0.1', 'localhost'].includes(config.host)) {
  throw new Error('Restore drill requires local Compose credentials; remote/production targets are refused.');
}
const suffix = randomBytes(8).toString('hex');
const source = `restore_source_${suffix}`;
const target = `restore_target_${suffix}`;
const archive = `/tmp/fashion_restore_${suffix}.dump`;
const admin = new pg.Client(config);
const clients = [];
const created = [];
const startedAt = Date.now();
let recoveryStartedAt;
let stage = 'create disposable databases';

function docker(args) {
  const result = spawnSync('docker', ['compose', 'exec', '-T', 'postgres', ...args], {
    cwd: root, encoding: 'utf8', timeout: 120000, maxBuffer: 1024 * 1024,
  });
  if (result.error || result.status !== 0) throw new Error('Local PostgreSQL backup/restore command failed.');
}
async function connect(database) {
  const client = new pg.Client({ ...config, database });
  clients.push(client);
  await client.connect();
  return client;
}
async function inventory(db) {
  const tables = (await db.query("SELECT tablename FROM pg_tables WHERE schemaname='app' ORDER BY tablename")).rows;
  const counts = {};
  for (const { tablename } of tables) {
    if (!/^[a-z_]+$/.test(tablename)) throw new Error('Unexpected identifier.');
    counts[tablename] = (await db.query(`SELECT count(*)::int AS n FROM app."${tablename}"`)).rows[0].n;
  }
  return {
    counts,
    migrations: (await db.query('SELECT name FROM public.pgmigrations ORDER BY id')).rows,
    objects: (await db.query(`SELECT c.relkind, count(*)::int AS n FROM pg_class c
      JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='app' GROUP BY c.relkind ORDER BY c.relkind`)).rows,
    constraints: (await db.query(`SELECT count(*)::int AS n FROM pg_constraint c
      JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname='app'`)).rows,
  };
}
try {
  await admin.connect();
  for (const name of [source, target]) {
    await admin.query(`CREATE DATABASE "${name}" TEMPLATE template0`);
    created.push(name);
  }
  stage = 'fresh migrations';
  await runner({ databaseUrl: { ...config, database: source },
    dir: fileURLToPath(new URL('../database/migrations/', import.meta.url)),
    migrationsTable: 'pgmigrations', direction: 'up', checkOrder: true, log: () => undefined });
  const from = await connect(source);
  stage = 'synthetic fixtures';
  await from.query('BEGIN');
  for (const file of ['001_demo.sql', '002_multibrand_demo.sql']) {
    await from.query(await readFile(new URL(`../database/seeds/${file}`, import.meta.url), 'utf8'));
  }
  await from.query("UPDATE app.users SET is_active=true WHERE email='customer@seed-demo.invalid'");
  await from.query('COMMIT');
  stage = 'backup';
  const before = await inventory(from);
  const sample = (await from.query("SELECT id, user_id FROM app.orders WHERE order_code='DEMO-ORDER-001'")).rows[0];
  docker(['pg_dump', '-U', 'db_admin', '-d', source, '--format=custom', '--no-owner', '--no-acl', '-f', archive]);
  docker(['pg_restore', '--list', archive]);
  recoveryStartedAt = Date.now();
  stage = 'restore';
  docker(['pg_restore', '-U', 'db_admin', '-d', target, '--no-owner', '--no-acl', '--role=db_admin',
    '--exit-on-error', '--single-transaction', archive]);
  const to = await connect(target);
  stage = 'grants and inventory comparison';
  await to.query(await readFile(new URL('../database/roles_backup.sql', import.meta.url), 'utf8'));
  assert.deepEqual(await inventory(to), before);
  stage = 'production verification SQL';
  await to.query(await readFile(new URL('../database/verify-production.sql', import.meta.url), 'utf8'));
  // Exercise restored SECURITY DEFINER read + owner check through runtime role.
  stage = 'runtime receipt and write denial';
  await to.query('SET ROLE app_rw_user');
  const receipt = await to.query('SELECT app.fn_read_order_detail($1,$2) AS receipt', [sample.user_id, sample.id]);
  assert.equal(receipt.rows[0].receipt.order_code, 'DEMO-ORDER-001');
  await assert.rejects(to.query('UPDATE app.inventory SET quantity=quantity+1'), { code: '42501' });
  await to.query('RESET ROLE');
  await assert.rejects(to.query('UPDATE app.order_items SET unit_price=0 WHERE order_id=$1', [sample.id]));
  console.log(JSON.stringify({ event: 'restore_drill_passed', tables: Object.keys(before.counts).length,
    migrations: before.migrations.length, recovery_ms: Date.now() - recoveryStartedAt,
    total_ms: Date.now() - startedAt, scope: 'local synthetic fixture; not a production RPO/RTO measurement' }));
} catch (error) {
  console.error(JSON.stringify({ event: 'restore_drill_failed', stage, code: error.code ?? 'unknown',
    check: stage === 'production verification SQL' && error.code === 'P0001' ? error.message : undefined }));
  process.exitCode = 1;
} finally {
  await Promise.all(clients.map((client) => client.end().catch(() => undefined)));
  for (const name of created) await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
  if (created.length) docker(['rm', '-f', archive]);
  await admin.end();
}
