import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from 'dotenv';

export const root = fileURLToPath(new URL('../', import.meta.url));

export function readEnvironment() {
  let local = {};
  try {
    local = parse(readFileSync(new URL('../.env', import.meta.url)));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  return { ...local, ...process.env };
}

export function migrationConnection(env = readEnvironment()) {
  if (env.MIGRATION_DATABASE_URL) return { connectionString: env.MIGRATION_DATABASE_URL };
  if (!env.POSTGRES_PASSWORD) throw new Error('POSTGRES_PASSWORD is required. Run npm run setup:env.');
  return {
    host: env.DB_HOST || '127.0.0.1',
    port: Number(env.DB_PORT || 5432),
    database: env.DB_NAME || 'fashion_dev',
    user: 'db_admin',
    password: env.POSTGRES_PASSWORD,
    connectionTimeoutMillis: 3000,
  };
}
