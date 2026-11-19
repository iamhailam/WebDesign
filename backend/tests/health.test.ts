import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';

describe('HTTP foundation', () => {
  it('serves public liveness without querying PostgreSQL', async () => {
    const checkDatabase = vi.fn();
    const app = createApp({ checkDatabase, frontendOrigin: 'http://localhost:5173' });
    const response = await request(app).get('/api/health');
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ success: true, data: { status: 'ok' } });
    expect(response.body.meta.request_id).toBe(response.headers['x-request-id']);
    expect(checkDatabase).not.toHaveBeenCalled();
  });

  it('probes the database only for readiness', async () => {
    const checkDatabase = vi.fn().mockResolvedValue(undefined);
    const response = await request(createApp({ checkDatabase, frontendOrigin: 'http://localhost:5173' })).get('/api/health/ready');
    expect(response.status).toBe(200);
    expect(response.body.data.database).toBe('up');
    expect(checkDatabase).toHaveBeenCalledOnce();
  });

  it('returns a safe 503 envelope when the database fails', async () => {
    const checkDatabase = vi.fn().mockRejectedValue(new Error('password=do-not-expose'));
    const response = await request(createApp({ checkDatabase, frontendOrigin: 'http://localhost:5173' })).get('/api/health/ready');
    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe('DATABASE_UNAVAILABLE');
    expect(JSON.stringify(response.body)).not.toContain('do-not-expose');
    expect(response.body.meta.request_id).toBeTruthy();
  });

  it('normalizes unknown routes, malformed JSON and forbidden origins', async () => {
    const app = createApp({ checkDatabase: async () => undefined, frontendOrigin: 'http://localhost:5173' });
    const missing = await request(app).get('/api/missing');
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('NOT_FOUND');
    const malformed = await request(app).post('/api/health').set('Content-Type', 'application/json').send('{');
    expect(malformed.status).toBe(400);
    expect(malformed.body.error.code).toBe('INVALID_JSON');
    const forbidden = await request(app).get('/api/health').set('Origin', 'https://example.invalid');
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.error.code).toBe('CORS_FORBIDDEN');
  });
});
