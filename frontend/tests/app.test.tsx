import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from '../src/app';

function renderRoute(route: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[route]}><App /></MemoryRouter></QueryClientProvider>);
}

describe('foundation routes and health contract', () => {
  it('uses the API response on the system route', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true, data: { status: 'ok', service: 'fashion-api' }, meta: { request_id: '22222222-2222-4222-8222-222222222222' } }) }));
    renderRoute('/system');
    expect(await screen.findByText('API đang hoạt động.')).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith('/api/health', expect.any(Object));
  });

  it('does not claim success for a malformed health response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true }) }));
    renderRoute('/system');
    expect(await screen.findByRole('alert')).toHaveTextContent('Không thể kết nối API');
    expect(screen.queryByText('API đang hoạt động.')).not.toBeInTheDocument();
  });

  it('renders a real not-found route with a way back', () => {
    renderRoute('/unknown');
    expect(screen.getByRole('heading', { name: 'Không tìm thấy trang' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Về trang chủ' })).toHaveAttribute('href', '/');
  });
});
