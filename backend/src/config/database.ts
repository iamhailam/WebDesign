import type { ConnectionOptions } from 'node:tls';
import pg from 'pg';
import type { Environment } from './env.js';

export function buildSslConfig(
  env: Pick<Environment, 'DB_SSL_MODE' | 'DB_SSL_CA'>,
): false | ConnectionOptions {
  switch (env.DB_SSL_MODE) {
    case 'disable':
      return false;
    case 'require':
      // Encrypted channel without CA/hostname verification (provider-managed certificates without a published CA).
      return { rejectUnauthorized: false };
    case 'verify-full':
      return env.DB_SSL_CA
        ? { rejectUnauthorized: true, ca: env.DB_SSL_CA.replace(/\\n/g, '\n') }
        : { rejectUnauthorized: true };
  }
}

export function createPool(env: Environment): pg.Pool {
  const pool = new pg.Pool({
    host: env.DB_HOST,
    port: env.DB_PORT,
    database: env.DB_NAME,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    max: env.DB_POOL_MAX,
    ssl: buildSslConfig(env),
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 3000,
    statement_timeout: 5000,
    query_timeout: 8000,
    application_name: 'fashion-api',
  });
  pool.on('error', () => {
    console.error(JSON.stringify({ event: 'database_pool_error' }));
  });
  return pool;
}

export async function withTransaction<T>(
  pool: pg.Pool,
  work: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout = '2s'");
    await client.query("SET LOCAL statement_timeout = '5s'");
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function withRetryableTransaction<T>(
  pool: pg.Pool,
  work: (client: pg.PoolClient) => Promise<T>,
  maxRetries = 2,
): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      return await withTransaction(pool, work);
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
      if ((code === '40P01' || code === '40001') && attempt < maxRetries) {
        attempt += 1;
        await new Promise((resolve) => setTimeout(resolve, 10 * attempt));
        continue;
      }
      throw error;
    }
  }
}
