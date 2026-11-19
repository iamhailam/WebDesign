import { runner } from 'node-pg-migrate';
import { fileURLToPath } from 'node:url';
import { migrationConnection } from './environment.mjs';

const direction = process.argv[2] || 'up';
if (!['up', 'down'].includes(direction)) throw new Error('Direction must be up or down.');
try {
  const migrations = await runner({
    databaseUrl: migrationConnection(),
    dir: fileURLToPath(new URL('../database/migrations/', import.meta.url)),
    migrationsTable: 'pgmigrations',
    direction,
    count: direction === 'down' ? 1 : Infinity,
    checkOrder: true,
    log: () => undefined,
  });
  console.log(`Migration ${direction}: ${migrations.length} SQL migration(s) applied.`);
} catch {
  console.error('Migration failed. Check database availability, credentials and SQL migration files.');
  process.exitCode = 1;
}
