import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { migrationConnection, readEnvironment } from './environment.mjs';

if (readEnvironment().NODE_ENV === 'production') throw new Error('Demo seed is disabled in production.');
const client = new pg.Client(migrationConnection());
try {
  await client.connect();
  await client.query('BEGIN');
  await client.query(await readFile(new URL('../database/seeds/001_demo.sql', import.meta.url), 'utf8'));
  await client.query('COMMIT');
  console.log('Demo seed committed. Synthetic accounts are inactive; existing fixtures were not reset.');
} catch (error) {
  await client.query('ROLLBACK').catch(() => undefined);
  console.error(`Demo seed failed (SQLSTATE ${error.code || 'unknown'}; constraint ${error.constraint || 'n/a'}). No credential values logged.`);
  process.exitCode = 1;
} finally {
  await client.end();
}
