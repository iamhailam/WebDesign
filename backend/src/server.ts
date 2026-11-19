import { createApp } from './app.js';
import { createPool } from './config/database.js';
import { loadEnvironment, shouldLogRequests } from './config/env.js';

const env = loadEnvironment();
const pool = createPool(env);
let stopping = false;
const app = createApp({
  frontendOrigin: env.FRONTEND_ORIGIN,
  checkDatabase: async () => {
    if (stopping) throw new Error('Draining');
    await pool.query('SELECT 1');
  },
  pool,
  trustProxy: env.TRUST_PROXY,
  accessLog: shouldLogRequests(env),
  ...(env.READINESS_TOKEN ? { readinessToken: env.READINESS_TOKEN } : {}),
  jwt: {
    secret: env.JWT_SECRET,
    issuer: env.JWT_ISSUER,
    audience: env.JWT_AUDIENCE,
  },
});
const server = app.listen(env.PORT, env.HOST, () => {
  console.log(JSON.stringify({ event: 'server_started', host: env.HOST, port: env.PORT, node_env: env.NODE_ENV }));
});
server.requestTimeout = 15000;
server.headersTimeout = 10000;
server.keepAliveTimeout = 5000;
server.on('error', () => {
  console.error(JSON.stringify({ event: 'server_start_failed' }));
  void pool.end().finally(() => { process.exitCode = 1; });
});

function shutdown() {
  if (stopping) return;
  stopping = true;
  console.log(JSON.stringify({ event: 'server_stopping' }));
  const timeout = setTimeout(() => process.exit(1), 10000);
  timeout.unref();
  server.close(() => {
    void pool.end().finally(() => { clearTimeout(timeout); });
  });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
