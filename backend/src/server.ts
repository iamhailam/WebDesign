import { createApp } from './app.js';
import { createPool } from './config/database.js';
import { loadEnvironment } from './config/env.js';

const env = loadEnvironment();
const pool = createPool(env);
const app = createApp({
  frontendOrigin: env.FRONTEND_ORIGIN,
  checkDatabase: async () => { await pool.query('SELECT 1'); },
  pool,
  jwt: {
    secret: env.JWT_SECRET,
    issuer: env.JWT_ISSUER,
    audience: env.JWT_AUDIENCE,
  },
});
const server = app.listen(env.PORT, env.HOST, () => {
  console.log(JSON.stringify({ event: 'server_started', host: env.HOST, port: env.PORT }));
});
server.on('error', () => {
  console.error(JSON.stringify({ event: 'server_start_failed' }));
  void pool.end().finally(() => { process.exitCode = 1; });
});

let stopping = false;
function shutdown() {
  if (stopping) return;
  stopping = true;
  const timeout = setTimeout(() => process.exit(1), 10000);
  timeout.unref();
  server.close(() => {
    void pool.end().finally(() => { clearTimeout(timeout); });
  });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
