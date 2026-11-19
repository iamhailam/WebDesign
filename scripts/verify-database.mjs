import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { runner } from 'node-pg-migrate';
import { migrationConnection } from './environment.mjs';

const config = migrationConnection();
const admin = new pg.Client(config);
const name = `foundation_verify_${randomBytes(6).toString('hex')}`;
let created = false;
let probe;
try {
  await admin.connect();
  await admin.query(`CREATE DATABASE "${name}"`);
  created = true;
  const probeConfig = config.connectionString
    ? { connectionString: (() => { const url = new URL(config.connectionString); url.pathname = `/${name}`; return url.href; })() }
    : { ...config, database: name };
  const options = {
    databaseUrl: probeConfig,
    dir: fileURLToPath(new URL('../database/tests/fixtures/', import.meta.url)),
    migrationsTable: 'pgmigrations',
    checkOrder: true,
    log: () => undefined,
  };
  await runner({ ...options, direction: 'up' });
  probe = new pg.Client(probeConfig);
  await probe.connect();
  assert.equal((await probe.query('SELECT count(*)::int AS count FROM public.foundation_probe')).rows[0].count, 1);
  await probe.query("DO $$ BEGIN IF 1 + 1 <> 2 THEN RAISE EXCEPTION 'probe failed'; END IF; END $$ LANGUAGE plpgsql");
  const version = (await probe.query('SHOW server_version')).rows[0].server_version;
  await runner({ ...options, direction: 'down', count: 1 });
  assert.equal((await probe.query("SELECT to_regclass('public.foundation_probe') AS relation")).rows[0].relation, null);
  console.log(`PASS PostgreSQL ${version}: SQL up/down, fixture rollback and PL/pgSQL on disposable database.`);
} catch {
  console.error('Database verification failed; check the local database and migration fixture. No credentials were logged.');
  process.exitCode = 1;
} finally {
  await probe?.end();
  if (created) await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
  await admin.end();
}
