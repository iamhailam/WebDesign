import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('API base configuration', () => {
  it('isolates the component test profile from the parent production API URL', () => {
    expect(import.meta.env.VITE_API_BASE_URL).toBe('/api');
    expect(process.env.VITE_API_BASE_URL).toBe('/api');
  });

  it.each(['/api', 'https://api.release-fixture.test/api', ''])('uses the selected API base for health requests: %s', async (base) => {
    vi.stubEnv('VITE_API_BASE_URL', base);
    vi.resetModules();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({
      success: true, data: { status: 'ok', service: 'fashion-api' }, meta: { request_id: 'fixture' },
    }) });
    vi.stubGlobal('fetch', fetchMock);
    const { fetchHealth } = await import('../src/lib/api');
    await fetchHealth();
    expect(fetchMock).toHaveBeenCalledWith(`${base || '/api'}/health`, expect.any(Object));
  });
});
