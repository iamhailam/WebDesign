import { test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { migrationConnection } from '../environment.mjs';

test('production migration refuses local fallback credentials', () => {
  assert.throws(() => migrationConnection({ NODE_ENV: 'production', POSTGRES_PASSWORD: 'unused-test-only' }),
    /MIGRATION_DATABASE_URL/);
});

test('connection-string flags cannot disable production migrator TLS verification', () => {
  const config = migrationConnection({ NODE_ENV: 'production',
    MIGRATION_DATABASE_URL: 'postgresql://db_admin@db.example.invalid/app?sslmode=no-verify&ssl=false',
    MIGRATION_SSL_CA: 'test-public-ca\\nnext-line' });
  const client = new pg.Client(config);
  assert.deepEqual(client.ssl, { rejectUnauthorized: true, ca: 'test-public-ca\nnext-line' });
});

test('local migration mode preserves explicit connection URL for isolated DB tools', () => {
  const url = 'postgresql://db_admin@127.0.0.1/test';
  assert.equal(migrationConnection({ NODE_ENV: 'test', MIGRATION_DATABASE_URL: url }).connectionString, url);
});
