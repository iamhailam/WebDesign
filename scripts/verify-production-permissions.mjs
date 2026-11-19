import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { runner } from 'node-pg-migrate';

// Fresh, disposable Docker cluster; trust auth is ONLY for this loopback test.
// No existing DB, .env, production credentials or remote endpoint is used.
const name = `fashion-permissions-${randomBytes(6).toString('hex')}`;
const clients = [];
let created = false;
let stage = 'start isolated PostgreSQL';
function docker(args, input) {
  const result = spawnSync('docker', args, { encoding: 'utf8', input, timeout: 60000 });
  if (result.status !== 0 || result.error) throw new Error('Disposable cluster command failed.');
  return result.stdout.trim();
}
try {
  docker(['run', '-d', '--rm', '--name', name, '-p', '127.0.0.1::5432',
    '-e', 'POSTGRES_USER=provider_admin', '-e', 'POSTGRES_DB=fashion_proof',
    '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', 'postgres:17.9-bookworm']);
  created = true;
  const port = Number(docker(['port', name, '5432/tcp']).split(':').at(-1));
  let ready = false;
  for (let i = 0; i < 100; i++) {
    const result = spawnSync('docker', ['exec', name, 'pg_isready', '-h', '127.0.0.1', '-U', 'provider_admin', '-d', 'fashion_proof'],
      { stdio: 'ignore', timeout: 5000 });
    if (result.status === 0) { ready = true; break; }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!ready) throw new Error('Disposable PostgreSQL did not become ready.');
  stage = 'production bootstrap SQL';
  docker(['exec', '-i', name, 'psql', '-X', '-U', 'provider_admin', '-d', 'fashion_proof', '-v', 'ON_ERROR_STOP=1'],
    await readFile(new URL('../database/production-bootstrap.sql', import.meta.url), 'utf8'));
  const ownerConfig = { host: '127.0.0.1', port, database: 'fashion_proof', user: 'db_admin', connectionTimeoutMillis: 3000 };
  stage = 'migrate as non-superuser db_admin';
  await runner({ databaseUrl: ownerConfig, dir: fileURLToPath(new URL('../database/migrations/', import.meta.url)),
    migrationsTable: 'pgmigrations', direction: 'up', checkOrder: true, log: () => undefined });
  const owner = new pg.Client(ownerConfig);
  clients.push(owner);
  await owner.connect();
  assert.equal((await owner.query("SELECT rolsuper FROM pg_roles WHERE rolname=current_user")).rows[0].rolsuper, false);
  stage = 'verify least-privilege ACL';
  await owner.query(await readFile(new URL('../database/roles_backup.sql', import.meta.url), 'utf8'));
  await owner.query(await readFile(new URL('../database/verify-production.sql', import.meta.url), 'utf8'));
  const runtime = new pg.Client({ ...ownerConfig, user: 'app_rw_user' });
  const report = new pg.Client({ ...ownerConfig, user: 'report_ro_user' });
  clients.push(runtime, report);
  await runtime.connect();
  await report.connect();
  await runtime.query('SELECT * FROM app.vw_catalog_products LIMIT 1');
  await assert.rejects(runtime.query('SELECT * FROM app.users'), { code: '42501' });
  await assert.rejects(runtime.query('UPDATE app.inventory SET quantity=0'), { code: '42501' });
  await assert.rejects(runtime.query('SET ROLE db_admin'), { code: '42501' });
  await report.query('SELECT * FROM app.vw_revenue_summary LIMIT 1');
  await assert.rejects(report.query('SELECT * FROM app.orders'), { code: '42501' });
  await assert.rejects(report.query('SELECT app.fn_get_actor(1)'), { code: '42501' });
  console.log('PASS isolated PG17: production bootstrap, 19 migrations as non-superuser db_admin, runtime/report login identities and least-privilege allow/deny. TLS/provider credentials require staging verification.');
} catch (error) {
  console.error(JSON.stringify({ event: 'production_permissions_check_failed', stage, code: error.code ?? 'unknown' }));
  process.exitCode = 1;
} finally {
  await Promise.all(clients.map((client) => client.end().catch(() => undefined)));
  if (created) docker(['rm', '-f', '-v', name]);
}
