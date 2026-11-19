import { afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { buildSslConfig } from '../src/config/database.js';
import { parseEnvironment, shouldLogRequests } from '../src/config/env.js';
import { createRequestRateLimiter } from '../src/middlewares/rate-limit.js';
import express from 'express';
import { errorHandler } from '../src/http/error.js';

const baseEnv = {
  DB_PASSWORD: 'test-only-password',
  JWT_SECRET: 'x'.repeat(48),
};

describe('Production configuration (Task 15)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps local defaults: TLS disabled, no proxy trust, access log off outside production', () => {
    const env = parseEnvironment({ ...baseEnv });
    expect(env.DB_SSL_MODE).toBe('disable');
    expect(env.TRUST_PROXY).toBe(0);
    expect(shouldLogRequests(env)).toBe(false);
    expect(buildSslConfig(env)).toBe(false);
  });

  it('rejects a non-https FRONTEND_ORIGIN in production without echoing values', () => {
    expect(() =>
      parseEnvironment({ ...baseEnv, NODE_ENV: 'production', FRONTEND_ORIGIN: 'http://shop.example.com' }),
    ).toThrowError(/Invalid environment: FRONTEND_ORIGIN/);
    try {
      parseEnvironment({ ...baseEnv, NODE_ENV: 'production', FRONTEND_ORIGIN: 'http://shop.example.com', JWT_SECRET: 'short' });
    } catch (error) {
      expect(String(error)).not.toContain('short');
      expect(String(error)).not.toContain('test-only-password');
    }
  });

  it('accepts a production profile with TLS, proxy hops and default access logging', () => {
    const env = parseEnvironment({
      ...baseEnv,
      NODE_ENV: 'production',
      FRONTEND_ORIGIN: 'https://shop.example.com',
      DB_SSL_MODE: 'verify-full',
      DB_SSL_CA: '-----BEGIN CERTIFICATE-----\\nABC\\n-----END CERTIFICATE-----',
      TRUST_PROXY: '1',
      READINESS_TOKEN: 'r'.repeat(48),
    });
    expect(env.TRUST_PROXY).toBe(1);
    expect(shouldLogRequests(env)).toBe(true);
    expect(shouldLogRequests({ ...env, LOG_REQUESTS: 'false' })).toBe(false);
    expect(buildSslConfig(env)).toEqual({
      rejectUnauthorized: true,
      ca: '-----BEGIN CERTIFICATE-----\nABC\n-----END CERTIFICATE-----',
    });
    expect(buildSslConfig({ DB_SSL_MODE: 'require', DB_SSL_CA: undefined })).toEqual({ rejectUnauthorized: false });
  });

  it('rejects unknown TLS modes and out-of-range proxy hop counts', () => {
    expect(() => parseEnvironment({ ...baseEnv, DB_SSL_MODE: 'prefer' })).toThrowError(/DB_SSL_MODE/);
    expect(() => parseEnvironment({ ...baseEnv, TRUST_PROXY: '9' })).toThrowError(/TRUST_PROXY/);
  });

  it('applies trust proxy hops and emits a PII-free structured access log without query strings', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const app = createApp({
      checkDatabase: vi.fn(),
      frontendOrigin: 'https://shop.example.com',
      trustProxy: 1,
      accessLog: true,
    });
    expect(app.get('trust proxy')).toBe(1);

    const response = await request(app)
      .get('/api/health?email=secret%40example.com&token=abc')
      .set('Authorization', 'Bearer should-not-be-logged');
    expect(response.status).toBe(200);

    const line = logSpy.mock.calls.map((call) => String(call[0])).find((l) => l.includes('http_request'));
    expect(line).toBeDefined();
    const entry = JSON.parse(line!) as Record<string, unknown>;
    expect(entry).toMatchObject({ event: 'http_request', method: 'GET', path: '/api/health', status: 200 });
    expect(entry.request_id).toBe(response.headers['x-request-id']);
    expect(line).not.toContain('secret');
    expect(line).not.toContain('should-not-be-logged');
  });

  it('does not emit access logs when disabled (default for tests/dev)', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const app = createApp({ checkDatabase: vi.fn(), frontendOrigin: 'http://localhost:5173' });
    expect(app.get('trust proxy')).toBe(0);
    await request(app).get('/api/health');
    expect(logSpy.mock.calls.some((call) => String(call[0]).includes('http_request'))).toBe(false);
  });

  it('requires verified DB TLS, runtime role, exact origin and private readiness in production', () => {
    const production = { ...baseEnv, NODE_ENV: 'production', FRONTEND_ORIGIN: 'https://shop.example.com',
      DB_SSL_MODE: 'verify-full', READINESS_TOKEN: 'r'.repeat(48) };
    for (const override of [{ DB_SSL_MODE: 'disable' }, { DB_SSL_MODE: 'require' }, { DB_USER: 'db_admin' },
      { FRONTEND_ORIGIN: 'https://shop.example.com/path' }, { READINESS_TOKEN: '' }]) {
      expect(() => parseEnvironment({ ...production, ...override })).toThrow(/Invalid environment/);
    }
  });

  it('protects readiness without querying DB for unauthenticated probes and keeps liveness public', async () => {
    const checkDatabase = vi.fn().mockResolvedValue(undefined);
    const app = createApp({ checkDatabase, frontendOrigin: 'https://shop.example.com', readinessToken: 'r'.repeat(48) });
    expect((await request(app).get('/api/health/ready')).status).toBe(404);
    expect((await request(app).get('/api/health/ready').set('X-Readiness-Token', 'wrong')).status).toBe(404);
    expect(checkDatabase).not.toHaveBeenCalled();
    expect((await request(app).get('/api/health/live')).status).toBe(200);
    expect((await request(app).get('/api/health/ready').set('X-Readiness-Token', 'r'.repeat(48))).status).toBe(200);
    expect(checkDatabase).toHaveBeenCalledOnce();
  });

  it('does not log arbitrary unmatched URL segments', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const app = createApp({ checkDatabase: vi.fn(), frontendOrigin: 'https://shop.example.com', accessLog: true });
    await request(app).get('/private/customer%40example.com');
    const line = String(logSpy.mock.calls[0]?.[0]);
    expect(line).toContain('unmatched');
    expect(line).not.toContain('customer');
  });

  it('limits expensive requests, separates IP buckets and resets windows', async () => {
    let now = 0;
    const app = express();
    app.set('trust proxy', 1);
    app.post('/limited', createRequestRateLimiter(2, 1000, () => now), (_req, res) => res.sendStatus(201));
    app.use(errorHandler);
    for (let i = 0; i < 2; i++) expect((await request(app).post('/limited').set('X-Forwarded-For', '192.0.2.1')).status).toBe(201);
    const blocked = await request(app).post('/limited').set('X-Forwarded-For', '192.0.2.1');
    expect(blocked.status).toBe(429);
    expect(blocked.headers['retry-after']).toBe('1');
    expect((await request(app).post('/limited').set('X-Forwarded-For', '192.0.2.2')).status).toBe(201);
    now = 1000;
    expect((await request(app).post('/limited').set('X-Forwarded-For', '192.0.2.1')).status).toBe(201);
  });

  it('mounts register/checkout limits before route work and permits authenticated CORS preflight', async () => {
    const app = createApp({ checkDatabase: vi.fn(), frontendOrigin: 'https://shop.example.com' });
    for (const [path, limit] of [['/api/auth/register', 5], ['/api/orders/checkout', 30]] as const) {
      for (let i = 0; i < limit; i++) expect((await request(app).post(path).send({})).status).toBe(404);
      const blocked = await request(app).post(path).send({});
      expect(blocked.status).toBe(429);
      expect(blocked.body.error.code).toBe('RATE_LIMITED');
    }
    const preflight = await request(app).options('/api/orders/checkout')
      .set('Origin', 'https://shop.example.com').set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'authorization,content-type,idempotency-key');
    expect(preflight.status).toBe(204);
    expect(preflight.headers['access-control-allow-origin']).toBe('https://shop.example.com');
    expect(preflight.headers['access-control-allow-headers']).toContain('idempotency-key');
    expect(preflight.headers['x-content-type-options']).toBe('nosniff');
  });
});
