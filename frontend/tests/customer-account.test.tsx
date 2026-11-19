import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from '../src/app';

const META = { request_id: '22222222-2222-4222-8222-222222222222' };

function LocationProbe() {
  const loc = useLocation();
  return <div data-testid="loc-probe">{`${loc.pathname}${loc.search}`}</div>;
}

function renderAccountApp(initialRoute: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initialRoute]}>
        <App />
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function createAccountFetchMock(config?: {
  role?: 'CUSTOMER' | 'SALES';
  failMe401?: boolean;
  cancelConflict409?: boolean;
}) {
  const role = config?.role ?? 'CUSTOMER';
  let order1Status: 'PENDING' | 'CONFIRMED' | 'SHIPPING' | 'DELIVERED' | 'CANCELLED' = 'PENDING';

  const makeOrder = (id: number, status: typeof order1Status) => ({
    id,
    order_code: `F-${id}`,
    user_id: 1,
    status,
    payment_method: 'COD',
    payment_status: status === 'DELIVERED' ? 'PAID' : 'UNPAID',
    subtotal_amount: '1500000.00',
    discount_amount: '100000.00',
    final_amount: '1400000.00',
    voucher_code: 'SAVE100K',
    recipient_name: 'Nguyen Van Khach',
    recipient_phone: '0901234567',
    shipping_address: '10 Le Loi, Q1, TP.HCM',
    created_at: '2026-11-20T03:00:00.000Z',
    updated_at: '2026-11-20T03:00:00.000Z',
    delivered_at: status === 'DELIVERED' ? '2026-11-20T05:00:00.000Z' : null,
    items: [
      {
        id: 10,
        variant_id: 20,
        sku: 'DEMO-SHIRT-M',
        product_name: 'Áo Sơ Mi Snapshot Lịch Sử',
        brand_name: 'Nordic Peak',
        options_snapshot: [{ code: 'color', label: 'Màu sắc', value_code: 'white', value_label: 'Trắng' }],
        quantity: 1,
        unit_price: '1500000.00',
        list_unit_price: '1800000.00',
        line_amount: '1500000.00',
      },
    ],
  });

  const userProfile = {
    id: 1,
    full_name: role === 'CUSTOMER' ? 'Nguyen Van Khach' : 'Staff Sales',
    email: role === 'CUSTOMER' ? 'khach@test.invalid' : 'sales@test.invalid',
    phone: '0901234567',
    role,
    is_active: true,
    created_at: '2026-11-01T00:00:00.000Z',
  };

  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const jsonResp = (data: unknown, status = 200) => ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => data,
    });

    if (url.includes('/api/categories')) {
      return jsonResp({ success: true, data: { items: [] }, meta: META });
    }
    if (url.endsWith('/api/auth/register') && method === 'POST') {
      return jsonResp({ success: true, data: userProfile, meta: META }, 201);
    }
    if (url.endsWith('/api/auth/login') && method === 'POST') {
      const body = JSON.parse(String(init?.body)) as { password: string };
      if (body.password === 'WrongPassword123!') {
        return jsonResp(
          { success: false, message: 'Email hoặc mật khẩu không đúng.', error: { code: 'INVALID_CREDENTIALS', details: {} }, meta: META },
          401,
        );
      }
      return jsonResp({
        success: true,
        data: { access_token: 'jwt-customer', token_type: 'Bearer', expires_in: 1800, user: userProfile },
        meta: META,
      });
    }
    if (url.endsWith('/api/auth/me')) {
      if (config?.failMe401) {
        return jsonResp(
          { success: false, message: 'Phiên hết hạn.', error: { code: 'INVALID_TOKEN', details: {} }, meta: META },
          401,
        );
      }
      return jsonResp({ success: true, data: userProfile, meta: META });
    }
    if (url.includes('/api/orders/my-orders')) {
      const parsed = new URL(url, 'http://localhost');
      const status = parsed.searchParams.get('status');
      const orders = [makeOrder(101, order1Status), makeOrder(102, 'DELIVERED')].filter(
        (o) => !status || o.status === status,
      );
      return jsonResp({
        success: true,
        data: { items: orders },
        meta: { ...META, pagination: { page: 1, page_size: 10, total: orders.length, total_pages: orders.length ? 1 : 0 } },
      });
    }
    if (url.endsWith('/api/orders/101/cancel') && method === 'POST') {
      if (config?.cancelConflict409) {
        order1Status = 'SHIPPING';
        return jsonResp(
          {
            success: false,
            message: 'Đơn hàng không thể hủy ở trạng thái hiện tại.',
            error: { code: 'ORDER_NOT_CANCELLABLE', details: { current_status: 'SHIPPING' } },
            meta: META,
          },
          409,
        );
      }
      order1Status = 'CANCELLED';
      return jsonResp({ success: true, data: makeOrder(101, 'CANCELLED'), meta: META });
    }
    if (url.endsWith('/api/orders/101') && method === 'GET') {
      return jsonResp({ success: true, data: makeOrder(101, order1Status), meta: META });
    }
    if (url.endsWith('/api/orders/102') && method === 'GET') {
      return jsonResp({ success: true, data: makeOrder(102, 'DELIVERED'), meta: META });
    }
    if (url.endsWith('/api/orders/999') && method === 'GET') {
      return jsonResp(
        { success: false, message: 'Không tìm thấy đơn hàng.', error: { code: 'NOT_FOUND', details: {} }, meta: META },
        404,
      );
    }
    return jsonResp({ success: false, message: 'Not found', error: { code: 'NOT_FOUND', details: {} }, meta: META }, 404);
  });
}

describe('Task 12 Customer Account UI', () => {
  it('redirects unauthenticated users from protected account/order routes to /login with return_to', async () => {
    vi.stubGlobal('fetch', createAccountFetchMock());

    renderAccountApp('/account/orders');

    await waitFor(() => {
      expect(screen.getByTestId('loc-probe').textContent).toBe('/login?return_to=%2Faccount%2Forders');
    });
    expect(screen.getByRole('heading', { name: 'Đăng nhập tài khoản' })).toBeInTheDocument();
  });

  it('validates Register & Login forms with React Hook Form + Zod and renders Account profile', async () => {
    vi.stubGlobal('fetch', createAccountFetchMock());

    renderAccountApp('/register');

    const regEmail = await screen.findByLabelText(/Email/);
    fireEvent.change(regEmail, { target: { value: 'not-an-email' } });
    fireEvent.change(screen.getByLabelText(/Mật khẩu/), { target: { value: 'short' } });
    fireEvent.click(screen.getByRole('button', { name: 'Đăng ký' }));

    expect(await screen.findByText('Vui lòng nhập họ và tên.')).toBeInTheDocument();
    expect(screen.getByText('Email không hợp lệ.')).toBeInTheDocument();
    expect(screen.getByText('Mật khẩu tối thiểu 12 ký tự.')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/Họ và tên/), { target: { value: 'Nguyen Van Khach' } });
    fireEvent.change(screen.getByLabelText(/Email/), { target: { value: 'khach@test.invalid' } });
    fireEvent.change(screen.getByLabelText(/Số điện thoại/), { target: { value: '0901234567' } });
    fireEvent.change(screen.getByLabelText(/Mật khẩu/), { target: { value: 'StrongCustomerPass1!' } });
    fireEvent.click(screen.getByRole('button', { name: 'Đăng ký' }));

    await waitFor(() => {
      expect(screen.getByTestId('loc-probe').textContent).toBe('/login');
    });

    fireEvent.change(screen.getByLabelText(/Email/), { target: { value: 'khach@test.invalid' } });
    fireEvent.change(screen.getByLabelText(/Mật khẩu/), { target: { value: 'WrongPassword123!' } });
    fireEvent.click(screen.getByRole('button', { name: 'Đăng nhập' }));

    expect(await screen.findByText('Email hoặc mật khẩu không đúng.')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/Mật khẩu/), { target: { value: 'StrongCustomerPass1!' } });
    fireEvent.click(screen.getByRole('button', { name: 'Đăng nhập' }));

    await waitFor(() => {
      expect(screen.getByTestId('loc-probe').textContent).toBe('/');
    });

    fireEvent.click(screen.getByRole('link', { name: /Tài khoản Nguyen Van Khach/ }));
    expect(await screen.findByRole('heading', { name: 'Thông tin tài khoản' })).toBeInTheDocument();
    expect(screen.getByText('0901234567')).toBeInTheDocument();
  });

  it('displays Order History, historical price snapshots, Status Timeline, and Cancel Order flow', async () => {
    vi.stubGlobal('fetch', createAccountFetchMock());

    renderAccountApp('/login?return_to=%2Faccount%2Forders');
    fireEvent.change(screen.getByLabelText(/Email/), { target: { value: 'khach@test.invalid' } });
    fireEvent.change(screen.getByLabelText(/Mật khẩu/), { target: { value: 'StrongCustomerPass1!' } });
    fireEvent.click(screen.getByRole('button', { name: 'Đăng nhập' }));

    expect(await screen.findByRole('heading', { name: 'Đơn hàng của tôi' })).toBeInTheDocument();
    expect(await screen.findByText('F-101')).toBeInTheDocument();
    expect(screen.getByText('F-102')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Đã giao' }));
    expect(await screen.findByText('F-102')).toBeInTheDocument();
    expect(screen.queryByText('F-101')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('link', { name: 'Xem chi tiết' }));
    expect(await screen.findByRole('heading', { name: 'Đơn hàng F-102' })).toBeInTheDocument();
    expect(screen.getByText('Giá lưu tại thời điểm đặt hàng')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Hủy đơn hàng/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getAllByRole('link', { name: 'Đơn hàng của tôi' })[0]!);
    fireEvent.click(await screen.findByRole('tab', { name: 'Tất cả' }));
    const detailLinks = await screen.findAllByRole('link', { name: 'Xem chi tiết' });
    fireEvent.click(detailLinks[0]!);

    expect(await screen.findByRole('heading', { name: 'Đơn hàng F-101' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Hủy đơn hàng/ }));

    const confirmCancel = await screen.findByRole('button', { name: 'Xác nhận hủy đơn' });
    fireEvent.click(confirmCancel);
    expect(await screen.findByText('Vui lòng nhập lý do hủy đơn.')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/Lý do hủy đơn/), { target: { value: 'Đổi địa chỉ giao hàng' } });
    fireEvent.click(confirmCancel);

    expect(
      await screen.findByText('Đơn hàng đã bị hủy. Tồn kho và lượt dùng voucher (nếu có) đã được hoàn lại.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Hủy đơn hàng/ })).not.toBeInTheDocument();
  });

  it('enforces access control for staff roles and conceals cross-user orders cleanly', async () => {
    vi.stubGlobal('fetch', createAccountFetchMock({ role: 'SALES' }));

    renderAccountApp('/login?return_to=%2Faccount');
    fireEvent.change(screen.getByLabelText(/Email/), { target: { value: 'sales@test.invalid' } });
    fireEvent.change(screen.getByLabelText(/Mật khẩu/), { target: { value: 'StrongStaffPass1!' } });
    fireEvent.click(screen.getByRole('button', { name: 'Đăng nhập' }));

    expect(await screen.findByRole('heading', { name: 'Thông tin tài khoản' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Đơn hàng của tôi' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('link', { name: /Giỏ hàng/ }));
    expect(await screen.findByRole('heading', { name: 'Không có quyền truy cập (403)' })).toBeInTheDocument();
  });

  it('conceals cross-user order IDs (404 NOT_FOUND) on /account/orders/:orderId', async () => {
    vi.stubGlobal('fetch', createAccountFetchMock({ role: 'CUSTOMER' }));

    renderAccountApp('/login?return_to=%2Faccount%2Forders%2F999');
    fireEvent.change(screen.getByLabelText(/Email/), { target: { value: 'khach@test.invalid' } });
    fireEvent.change(screen.getByLabelText(/Mật khẩu/), { target: { value: 'StrongCustomerPass1!' } });
    fireEvent.click(screen.getByRole('button', { name: 'Đăng nhập' }));

    expect(await screen.findByRole('heading', { name: 'Không tìm thấy đơn hàng' })).toBeInTheDocument();
    expect(screen.queryByText('F-101')).not.toBeInTheDocument();
  });
});
