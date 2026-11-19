import pg from 'pg';
import type { Environment } from './env.js';

export function createPool(env: Environment): pg.Pool {
  const pool = new pg.Pool({
    host: env.DB_HOST,
    port: env.DB_PORT,
    database: env.DB_NAME,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    max: env.DB_POOL_MAX,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 3000,
    statement_timeout: 5000,
    application_name: 'fashion-api',
  });
  pool.on('error', () => {
    console.error(JSON.stringify({ event: 'database_pool_error' }));
  });
  return pool;
}
