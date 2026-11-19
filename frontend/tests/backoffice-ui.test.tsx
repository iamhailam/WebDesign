import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from '../src/app';
import type { Role } from '../src/lib/api';

const META = { request_id: '33333333-3333-4333-8333-333333333333' };

function LocationProbe() {
  const loc = useLocation();
  return <div data-testid="loc-probe">{`${loc.pathname}${loc.search}`}</div>;
}

function renderBackoffice(initialRoute: string) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initialRoute]}>
        <App />
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function loginToRoute(initialRoute: string, email: string) {
  renderBackoffice(`/login?return_to=${encodeURIComponent(initialRoute)}`);
  fireEvent.change(await screen.findByLabelText(/Email/), { target: { value: email } });
  fireEvent.change(screen.getByLabelText(/Mật khẩu/), {
    target: { value: 'StrongStaffPass1!' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Đăng nhập' }));
}

function createBackofficeFetchMock(
  role: Role,
  options?: {
    staleTransition?: boolean;
    failFirstImport?: boolean;
    emptyDashboard?: boolean;
    lastAdminConflict?: boolean;
    notPublishableConflict?: boolean;
  },
) {
  const userProfile = {
    id: 90,
    full_name: `Staff ${role}`,
    email: `${role.toLowerCase()}@test.invalid`,
    phone: '0909000999',
    role,
    is_active: true,
    created_at: '2026-11-01T00:00:00.000Z',
  };

  let orderStatus: 'PENDING' | 'CONFIRMED' | 'SHIPPING' | 'DELIVERED' | 'CANCELLED' = 'PENDING';
  let importAttempts = 0;
  const capturedImportKeys: string[] = [];
  const capturedVoucherPutBodies: Array<Record<string, unknown>> = [];
  const capturedBannerPayloads: Array<Record<string, unknown>> = [];

  let voucherState = {
    id: 70,
    code: 'USED10',
    discount_type: 'PERCENT' as const,
    discount_value: '10.00',
    max_discount_amount: '100000.00',
    min_order_amount: '300000.00',
    usage_limit: 10,
    used_count: 3,
    start_date: '2026-11-01T00:00:00.123Z',
    end_date: '2026-12-01T23:59:59.456Z',
    is_active: true,
    created_at: '2026-11-01T00:00:00.000Z',
  };

  let productDetail = {
    id: 10,
    name: 'Áo Khoác Nháp',
    slug: 'ao-khoac-nhap',
    brand: { id: 1, name: 'Nordic Peak', slug: 'nordic-peak' },
    category: { id: 1, name: 'Áo khoác', slug: 'ao-khoac' },
    product_type_code: 'CLOTHING',
    base_image_url: '/media/products/coat.webp',
    price_min: '0.00',
    price_max: '0.00',
    in_stock: false,
    is_active: false,
    description: 'Sản phẩm nháp chờ hoàn thiện SKU',
    created_at: '2026-11-01T00:00:00.000Z',
    updated_at: '2026-11-01T00:00:00.000Z',
    images: [
      {
        id: 501,
        product_id: 10,
        variant_id: null,
        asset_path: '/media/products/coat.webp',
        alt_text: 'Áo Khoác Nháp',
        sort_order: 0,
        is_primary: true,
        created_at: '2026-11-01T00:00:00.000Z',
      },
    ],
    variants: [] as Array<Record<string, unknown>>,
    option_schema: [],
  };

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const jsonResp = (data: unknown, status = 200) => ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => data,
    });

    if (url.endsWith('/api/auth/login') && method === 'POST') {
      return jsonResp({
        success: true,
        data: {
          access_token: `jwt-${role}`,
          token_type: 'Bearer',
          expires_in: 1800,
          user: userProfile,
        },
        meta: META,
      });
    }

    if (url.endsWith('/api/auth/me')) {
      return jsonResp({ success: true, data: userProfile, meta: META });
    }

    if (url.includes('/api/product-types')) {
      return jsonResp({
        success: true,
        data: {
          items: [
            {
              code: 'CLOTHING',
              name: 'Quần áo',
              attributes: [
                {
                  id: 1,
                  code: 'color',
                  name: 'Màu sắc',
                  unit: null,
                  is_required: true,
                  values: [{ id: 11, code: 'BLACK', label: 'Đen' }],
                },
                {
                  id: 2,
                  code: 'size',
                  name: 'Kích cỡ',
                  unit: null,
                  is_required: true,
                  values: [{ id: 21, code: 'L', label: 'L' }],
                },
              ],
            },
          ],
        },
        meta: META,
      });
    }

    if (url.includes('/api/orders/501/status') && method === 'PATCH') {
      if (options?.staleTransition) {
        orderStatus = 'CONFIRMED';
        return jsonResp(
          {
            success: false,
            message: 'Trạng thái đơn đã thay đổi bởi nhân viên khác.',
            error: { code: 'STALE_ORDER_STATUS', details: {} },
            meta: META,
          },
          409,
        );
      }
      const body = JSON.parse(String(init?.body)) as {
        target_status: 'CONFIRMED' | 'SHIPPING' | 'DELIVERED';
      };
      orderStatus = body.target_status;
      return jsonResp({
        success: true,
        data: {
          id: 501,
          order_code: 'ORD-501',
          user_id: 22,
          recipient_name: 'Tran Khach Hang',
          recipient_phone: '0908887776',
          shipping_address: '99 Nguyen Hue, Q1, TP.HCM',
          status: orderStatus,
          payment_method: 'COD',
          payment_status: orderStatus === 'DELIVERED' ? 'PAID' : 'UNPAID',
          subtotal_amount: '950000.00',
          discount_amount: '50000.00',
          final_amount: '900000.00',
          voucher_code: 'SALE50K',
          created_at: '2026-11-20T01:00:00.000Z',
          updated_at: '2026-11-20T02:00:00.000Z',
          delivered_at: orderStatus === 'DELIVERED' ? '2026-11-20T04:00:00.000Z' : null,
          items: [
            {
              id: 1,
              variant_id: 30,
              sku: 'COAT-BLK-M',
              product_name: 'Áo Khoác Cashmere',
              brand_name: 'Nordic Peak',
              options_snapshot: [],
              quantity: 1,
              unit_price: '950000.00',
              list_unit_price: '1200000.00',
              line_amount: '950000.00',
            },
          ],
        },
        meta: META,
      });
    }

    if (url.includes('/api/orders/501/cancel') && method === 'POST') {
      orderStatus = 'CANCELLED';
      return jsonResp({
        success: true,
        data: {
          id: 501,
          order_code: 'ORD-501',
          user_id: 22,
          recipient_name: 'Tran Khach Hang',
          recipient_phone: '0908887776',
          shipping_address: '99 Nguyen Hue, Q1, TP.HCM',
          status: 'CANCELLED',
          payment_method: 'COD',
          payment_status: 'UNPAID',
          subtotal_amount: '950000.00',
          discount_amount: '50000.00',
          final_amount: '900000.00',
          voucher_code: 'SALE50K',
          created_at: '2026-11-20T01:00:00.000Z',
          updated_at: '2026-11-20T02:30:00.000Z',
          delivered_at: null,
          items: [],
        },
        meta: META,
      });
    }

    if (url.includes('/api/orders/501')) {
      return jsonResp({
        success: true,
        data: {
          id: 501,
          order_code: 'ORD-501',
          user_id: 22,
          recipient_name: 'Tran Khach Hang',
          recipient_phone: '0908887776',
          shipping_address: '99 Nguyen Hue, Q1, TP.HCM',
          status: orderStatus,
          payment_method: 'COD',
          payment_status: 'UNPAID',
          subtotal_amount: '950000.00',
          discount_amount: '50000.00',
          final_amount: '900000.00',
          voucher_code: 'SALE50K',
          created_at: '2026-11-20T01:00:00.000Z',
          updated_at: '2026-11-20T02:00:00.000Z',
          delivered_at: null,
          items: [
            {
              id: 1,
              variant_id: 30,
              sku: 'COAT-BLK-M',
              product_name: 'Áo Khoác Cashmere',
              brand_name: 'Nordic Peak',
              options_snapshot: [],
              quantity: 1,
              unit_price: '950000.00',
              list_unit_price: null,
              line_amount: '950000.00',
            },
          ],
        },
        meta: META,
      });
    }

    if (url.includes('/api/orders?')) {
      return jsonResp({
        success: true,
        data: {
          items: [
            {
              id: 501,
              order_code: 'ORD-501',
              user_id: 22,
              recipient_name: 'Tran Khach Hang',
              status: orderStatus,
              payment_method: 'COD',
              payment_status: 'UNPAID',
              subtotal_amount: '950000.00',
              discount_amount: '50000.00',
              final_amount: '900000.00',
              voucher_code: 'SALE50K',
              created_at: '2026-11-20T01:00:00.000Z',
              updated_at: '2026-11-20T02:00:00.000Z',
              delivered_at: null,
            },
          ],
        },
        meta: { ...META, pagination: { page: 1, page_size: 20, total: 1, total_pages: 1 } },
      });
    }

    if (url.endsWith('/api/inventory/import') && method === 'POST') {
      importAttempts += 1;
      const headers = new Headers(init?.headers);
      const idemKey = headers.get('Idempotency-Key') ?? '';
      capturedImportKeys.push(idemKey);

      if (options?.failFirstImport && importAttempts === 1) {
        return jsonResp(
          {
            success: false,
            message: 'Lỗi tạm thời khi ghi sổ kho.',
            error: { code: 'TRANSIENT_FAILURE', details: {} },
            meta: META,
          },
          503,
        );
      }

      return jsonResp({
        success: true,
        data: {
          transaction: {
            id: '9001',
            variant_id: 30,
            sku: 'COAT-BLK-M',
            type: 'IMPORT',
            quantity_change: 15,
            reference_type: 'IMPORT_RECEIPT',
            reference_id: null,
            order_code: null,
            note: 'Nhập hàng đợt 1',
            created_by: 90,
            created_at: '2026-11-20T03:00:00.000Z',
          },
          replayed: false,
        },
        meta: META,
      });
    }

    if (url.includes('/api/inventory/transactions')) {
      return jsonResp({
        success: true,
        data: {
          items: [
            {
              id: '9000',
              variant_id: 30,
              sku: 'COAT-BLK-M',
              type: 'EXPORT_ORDER',
              quantity_change: -1,
              reference_type: 'ORDER',
              reference_id: 501,
              order_code: 'ORD-501',
              note: null,
              created_by: 22,
              created_at: '2026-11-20T01:05:00.000Z',
            },
          ],
        },
        meta: { ...META, pagination: { page: 1, page_size: 20, total: 1, total_pages: 1 } },
      });
    }

    if (url.includes('/api/inventory?')) {
      return jsonResp({
        success: true,
        data: {
          items: [
            {
              variant_id: 30,
              sku: 'COAT-BLK-M',
              product_name: 'Áo Khoác Cashmere',
              options: [{ label: 'Màu', value_label: 'Đen' }],
              quantity: 2,
              updated_at: '2026-11-20T01:00:00.000Z',
              is_active: true,
            },
          ],
        },
        meta: { ...META, pagination: { page: 1, page_size: 20, total: 1, total_pages: 1 } },
      });
    }

    if (url.includes('/api/reports/revenue')) {
      return jsonResp({
        success: true,
        data: options?.emptyDashboard
          ? {
              items: [],
              totals: {
                order_count: 0,
                gross_amount: '0.00',
                discount_amount: '0.00',
                revenue_amount: '0.00',
              },
            }
          : {
              items: [
                {
                  period_start: '2026-11-19',
                  order_count: 4,
                  gross_amount: '4200000.00',
                  discount_amount: '200000.00',
                  revenue_amount: '4000000.00',
                },
              ],
              totals: {
                order_count: 4,
                gross_amount: '4200000.00',
                discount_amount: '200000.00',
                revenue_amount: '4000000.00',
              },
            },
        meta: { ...META, pagination: { page: 1, page_size: 100, total: 1, total_pages: 1 } },
      });
    }

    if (url.includes('/api/reports/best-sellers')) {
      return jsonResp({
        success: true,
        data: {
          items: options?.emptyDashboard
            ? []
            : [
                {
                  rank: 1,
                  product_id: 10,
                  product_name: 'Áo Khoác Cashmere',
                  quantity_sold: '12',
                  gross_item_amount: '11400000.00',
                },
              ],
        },
        meta: { ...META, pagination: { page: 1, page_size: 10, total: 1, total_pages: 1 } },
      });
    }

    if (url.includes('/api/vouchers/70/usages')) {
      return jsonResp({
        success: true,
        data: {
          items: [
            {
              id: 1,
              voucher_id: 70,
              user_id: 22,
              user_display_name: 'Tran Khach Hang',
              email_masked: 'tr***@test.invalid',
              order_id: 501,
              order_code: 'ORD-501',
              status: 'APPLIED',
              used_at: '2026-11-20T01:00:00.000Z',
            },
          ],
        },
        meta: { ...META, pagination: { page: 1, page_size: 20, total: 1, total_pages: 1 } },
      });
    }

    if (url.endsWith('/api/vouchers/70') && method === 'PUT') {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      capturedVoucherPutBodies.push(body);
      voucherState = {
        ...voucherState,
        usage_limit: Number(body.usage_limit),
        is_active: Boolean(body.is_active),
      };
      return jsonResp({ success: true, data: voucherState, meta: META });
    }

    if (url.endsWith('/api/vouchers/70')) {
      return jsonResp({ success: true, data: voucherState, meta: META });
    }

    if (url.includes('/api/vouchers?')) {
      return jsonResp({
        success: true,
        data: { items: [voucherState] },
        meta: { ...META, pagination: { page: 1, page_size: 20, total: 1, total_pages: 1 } },
      });
    }

    if (url.includes('/api/admin/brands')) {
      return jsonResp({
        success: true,
        data: {
          items: [
            {
              id: 1,
              name: 'Nordic Peak',
              slug: 'nordic-peak',
              description: 'Brand 1',
              logo_path: '/media/brands/nordic.svg',
              is_active: true,
            },
          ],
        },
        meta: { ...META, pagination: { page: 1, page_size: 50, total: 1, total_pages: 1 } },
      });
    }

    if (url.includes('/api/admin/categories')) {
      return jsonResp({
        success: true,
        data: {
          items: [
            {
              id: 1,
              name: 'Áo khoác',
              slug: 'ao-khoac',
              description: 'Category 1',
              is_active: true,
            },
          ],
        },
        meta: { ...META, pagination: { page: 1, page_size: 50, total: 1, total_pages: 1 } },
      });
    }

    if (url.endsWith('/api/products/10') && method === 'PUT') {
      if (options?.notPublishableConflict) {
        return jsonResp(
          {
            success: false,
            message: 'Sản phẩm cần ít nhất 1 SKU đang hoạt động và 1 hình ảnh trước khi xuất bản.',
            error: { code: 'PRODUCT_NOT_PUBLISHABLE', details: {} },
            meta: META,
          },
          409,
        );
      }
      return jsonResp({ success: true, data: productDetail, meta: META });
    }

    if (url.endsWith('/api/products/10/variants') && method === 'POST') {
      const body = JSON.parse(String(init?.body)) as { sku: string; price: string };
      const createdVariant = {
        id: 88,
        product_id: 10,
        sku: body.sku,
        options: [
          { attribute_id: 1, code: 'color', label: 'Màu sắc', value_id: 11, value_code: 'BLACK', value_label: 'Đen' },
        ],
        price: `${body.price}.00`,
        list_price: null,
        stock_quantity: 0,
        is_active: true,
        images: [],
      };
      productDetail = {
        ...productDetail,
        variants: [createdVariant],
      };
      return jsonResp({ success: true, data: createdVariant, meta: META }, 201);
    }

    if (url.endsWith('/api/admin/products/10')) {
      return jsonResp({ success: true, data: productDetail, meta: META });
    }

    if (url.includes('/api/admin/products')) {
      return jsonResp({
        success: true,
        data: { items: [productDetail] },
        meta: { ...META, pagination: { page: 1, page_size: 20, total: 1, total_pages: 1 } },
      });
    }

    if (url.endsWith('/api/users/90') && method === 'PUT') {
      if (options?.lastAdminConflict) {
        return jsonResp(
          {
            success: false,
            message: 'Không thể hạ quyền hoặc vô hiệu hóa quản trị viên ADMIN cuối cùng.',
            error: { code: 'LAST_ADMIN_PROTECTED', details: {} },
            meta: META,
          },
          409,
        );
      }
      return jsonResp({ success: true, data: userProfile, meta: META });
    }

    if (url.includes('/api/users')) {
      return jsonResp({
        success: true,
        data: { items: [userProfile] },
        meta: { ...META, pagination: { page: 1, page_size: 20, total: 1, total_pages: 1 } },
      });
    }

    if (url.endsWith('/api/admin/banners') && method === 'POST') {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      capturedBannerPayloads.push(body);
      return jsonResp(
        {
          success: true,
          data: {
            id: 77,
            ...body,
            target_path: '/products?category_id=1',
          },
          meta: META,
        },
        201,
      );
    }

    if (url.includes('/api/admin/banners')) {
      return jsonResp({
        success: true,
        data: { items: [] },
        meta: { ...META, pagination: { page: 1, page_size: 20, total: 0, total_pages: 0 } },
      });
    }

    if (url.includes('/api/admin/audit-events')) {
      return jsonResp({
        success: true,
        data: { items: [] },
        meta: { ...META, pagination: { page: 1, page_size: 20, total: 0, total_pages: 0 } },
      });
    }

    return jsonResp({ success: true, data: { items: [] }, meta: META });
  });

  return {
    fetchMock,
    capturedImportKeys,
    capturedVoucherPutBodies,
    capturedBannerPayloads,
  };
}

describe('Task 13 Back-Office UI & Role Matrix', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('redirects guests to /login?return_to=... and blocks CUSTOMER with 403', async () => {
    vi.stubGlobal('fetch', createBackofficeFetchMock('CUSTOMER').fetchMock);

    renderBackoffice('/admin/orders');
    await waitFor(() => {
      expect(screen.getByTestId('loc-probe').textContent).toBe(
        '/login?return_to=%2Fadmin%2Forders',
      );
    });

    fireEvent.change(await screen.findByLabelText(/Email/), {
      target: { value: 'customer@test.invalid' },
    });
    fireEvent.change(screen.getByLabelText(/Mật khẩu/), {
      target: { value: 'StrongStaffPass1!' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Đăng nhập' }));

    expect(
      await screen.findByRole('heading', { name: 'Không có quyền truy cập (403)' }),
    ).toBeInTheDocument();
  });

  it('enforces role-specific sidebar navigation & landing redirects for SALES, WAREHOUSE, MARKETING, and ADMIN', async () => {
    // 1. SALES -> /admin/orders and blocked on /admin/inventory
    vi.stubGlobal('fetch', createBackofficeFetchMock('SALES').fetchMock);
    await loginToRoute('/admin', 'sales@test.invalid');
    expect(await screen.findByRole('heading', { name: 'Quản lý đơn hàng' })).toBeInTheDocument();
    const salesNav = screen.getByRole('navigation', { name: 'Điều hướng Back-Office' });
    expect(within(salesNav).getByRole('link', { name: 'Đơn hàng' })).toBeInTheDocument();
    expect(within(salesNav).queryByRole('link', { name: 'Tồn kho SKU' })).not.toBeInTheDocument();
    expect(
      within(salesNav).queryByRole('link', { name: 'Tổng quan doanh thu' }),
    ).not.toBeInTheDocument();

    cleanup();

    // 2. WAREHOUSE -> /admin/inventory
    vi.stubGlobal('fetch', createBackofficeFetchMock('WAREHOUSE').fetchMock);
    await loginToRoute('/admin', 'warehouse@test.invalid');
    expect(await screen.findByRole('heading', { name: 'Quản lý tồn kho SKU' })).toBeInTheDocument();
    const whNav = screen.getByRole('navigation', { name: 'Điều hướng Back-Office' });
    expect(within(whNav).getByRole('link', { name: 'Tồn kho SKU' })).toBeInTheDocument();
    expect(within(whNav).getByRole('link', { name: 'Sổ kho (Ledger)' })).toBeInTheDocument();
    expect(within(whNav).queryByRole('link', { name: 'Voucher khuyến mãi' })).not.toBeInTheDocument();

    cleanup();

    // 3. MARKETING -> /admin/dashboard
    vi.stubGlobal('fetch', createBackofficeFetchMock('MARKETING').fetchMock);
    await loginToRoute('/admin', 'marketing@test.invalid');
    expect(
      await screen.findByRole('heading', { name: 'Tổng quan doanh thu & Bán chạy' }),
    ).toBeInTheDocument();
    const mktNav = screen.getByRole('navigation', { name: 'Điều hướng Back-Office' });
    expect(within(mktNav).getByRole('link', { name: 'Tổng quan doanh thu' })).toBeInTheDocument();
    expect(within(mktNav).getByRole('link', { name: 'Voucher khuyến mãi' })).toBeInTheDocument();
    expect(within(mktNav).queryByRole('link', { name: 'Người dùng & Vai trò' })).not.toBeInTheDocument();

    cleanup();

    // 4. ADMIN -> full navigation
    vi.stubGlobal('fetch', createBackofficeFetchMock('ADMIN').fetchMock);
    await loginToRoute('/admin', 'admin@test.invalid');
    expect(
      await screen.findByRole('heading', { name: 'Tổng quan doanh thu & Bán chạy' }),
    ).toBeInTheDocument();
    const adminNav = screen.getByRole('navigation', { name: 'Điều hướng Back-Office' });
    expect(within(adminNav).getByRole('link', { name: 'Sản phẩm' })).toBeInTheDocument();
    expect(within(adminNav).getByRole('link', { name: 'Người dùng & Vai trò' })).toBeInTheDocument();
    expect(within(adminNav).getByRole('link', { name: 'Banner trang chủ' })).toBeInTheDocument();
    expect(within(adminNav).getByRole('link', { name: 'Nhật ký kiểm toán' })).toBeInTheDocument();
  });

  it('prevents STAFF cross-module route access with 403', async () => {
    vi.stubGlobal('fetch', createBackofficeFetchMock('SALES').fetchMock);
    await loginToRoute('/admin/inventory', 'sales@test.invalid');
    expect(
      await screen.findByRole('heading', { name: 'Không có quyền truy cập (403)' }),
    ).toBeInTheDocument();
  });

  it('handles SALES Order sequential confirmation, 409 STALE_ORDER_STATUS refresh, and Cancel modal', async () => {
    vi.stubGlobal('fetch', createBackofficeFetchMock('SALES', { staleTransition: true }).fetchMock);
    await loginToRoute('/admin/orders/501', 'sales@test.invalid');

    expect(await screen.findByRole('heading', { name: /Đơn hàng ORD-501/ })).toBeInTheDocument();
    expect(screen.getByText('99 Nguyen Hue, Q1, TP.HCM')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Xác nhận đơn hàng/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Xác nhận chuyển' }));

    expect(
      await screen.findByText('Trạng thái đơn vừa thay đổi từ phiên khác'),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Hủy đơn hàng' }));
    fireEvent.change(await screen.findByLabelText(/Lý do hủy đơn/), {
      target: { value: 'Khách yêu cầu hủy trước khi giao' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Xác nhận hủy đơn' }));

    expect(await screen.findByText('Đã hủy đơn hàng')).toBeInTheDocument();
  });

  it('holds the exact same Idempotency-Key across Inventory import retry and omits shipping PII in Ledger', async () => {
    const mock = createBackofficeFetchMock('WAREHOUSE', { failFirstImport: true });
    vi.stubGlobal('fetch', mock.fetchMock);
    await loginToRoute('/admin/inventory', 'warehouse@test.invalid');

    expect(await screen.findByText('COAT-BLK-M')).toBeInTheDocument();
    expect(screen.getByText('Sắp hết')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Nhập kho' }));
    fireEvent.change(await screen.findByLabelText(/Ghi chú phiếu nhập/), {
      target: { value: 'Nhập lô bổ sung' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Xác nhận nhập kho' }));

    expect(await screen.findByText('Nhập kho thất bại')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Xác nhận nhập kho' }));
    expect(await screen.findByText(/Đã nhập \+15 vào SKU COAT-BLK-M/)).toBeInTheDocument();

    expect(mock.capturedImportKeys).toHaveLength(2);
    expect(mock.capturedImportKeys[0]).toBeTruthy();
    expect(mock.capturedImportKeys[0]).toBe(mock.capturedImportKeys[1]);

    // Check Ledger PII-free text order reference
    fireEvent.click(screen.getByRole('link', { name: 'Xem sổ kho (Ledger)' }));
    expect(await screen.findByRole('heading', { name: /Sổ cái biến động kho/ })).toBeInTheDocument();
    expect(await screen.findByText('(ORD-501)')).toBeInTheDocument();
    expect(screen.queryByText(/Nguyen Hue/)).not.toBeInTheDocument();
  });

  it('validates Dashboard date range and enforces Voucher locked-terms ISO preservation + masked emails', async () => {
    const mock = createBackofficeFetchMock('MARKETING', { emptyDashboard: true });
    vi.stubGlobal('fetch', mock.fetchMock);
    await loginToRoute('/admin/dashboard', 'marketing@test.invalid');

    expect(
      await screen.findByText('Chưa có dữ liệu doanh thu trong kỳ'),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/Từ ngày/), { target: { value: '2026-12-10' } });
    fireEvent.change(screen.getByLabelText(/Đến ngày/), { target: { value: '2026-11-01' } });
    fireEvent.click(screen.getByRole('button', { name: 'Áp dụng kỳ báo cáo' }));
    expect(
      await screen.findByText('Ngày bắt đầu không được lớn hơn ngày kết thúc.'),
    ).toBeInTheDocument();

    // Navigate to Voucher detail with used_count > 0
    fireEvent.click(screen.getByRole('link', { name: 'Voucher khuyến mãi' }));
    const voucherLink = await screen.findByRole('link', { name: 'USED10' });
    fireEvent.click(voucherLink);

    expect(
      await screen.findByText(/Điều khoản chiết khấu đã khóa \(used_count = 3\)/),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Loại chiết khấu')).toBeDisabled();
    expect(screen.getByLabelText('Giá trị giảm')).toBeDisabled();
    expect(screen.getByText('tr***@test.invalid')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/Giới hạn lượt dùng/), { target: { value: '25' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu cấu hình Voucher' }));

    await waitFor(() => {
      expect(mock.capturedVoucherPutBodies).toHaveLength(1);
    });
    expect(mock.capturedVoucherPutBodies[0]).toMatchObject({
      usage_limit: 25,
      start_date: '2026-11-01T00:00:00.123Z',
      end_date: '2026-12-01T23:59:59.456Z',
    });
  });

  it('handles ADMIN product publish checklist, dynamic SKU creation, LAST_ADMIN_PROTECTED, and banners', async () => {
    const mock = createBackofficeFetchMock('ADMIN', {
      notPublishableConflict: true,
      lastAdminConflict: true,
    });
    vi.stubGlobal('fetch', mock.fetchMock);
    await loginToRoute('/admin/products/10', 'admin@test.invalid');

    expect(await screen.findByRole('heading', { name: 'Áo Khoác Nháp' })).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Xuất bản sản phẩm (hiển thị trên Storefront)'));
    fireEvent.click(screen.getByRole('button', { name: 'Lưu thông tin sản phẩm' }));

    expect(await screen.findByText('Chưa đủ điều kiện xuất bản')).toBeInTheDocument();

    // Dynamic SKU creation
    fireEvent.click(screen.getByRole('button', { name: 'Thêm SKU mới' }));
    fireEvent.change(await screen.findByLabelText(/Mã SKU/), { target: { value: 'COAT-BLK-L' } });
    fireEvent.change(screen.getByLabelText(/Giá bán/), { target: { value: '890000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Tạo SKU' }));
    expect(await screen.findByText('COAT-BLK-L')).toBeInTheDocument();

    // Users LAST_ADMIN_PROTECTED handling
    fireEvent.click(screen.getByRole('link', { name: 'Người dùng & Vai trò' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Phân quyền' }));
    fireEvent.change(await screen.findByLabelText(/Vai trò RBAC/), { target: { value: 'SALES' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));
    expect(
      await screen.findByText('Không thể hạ quyền hoặc khóa ADMIN cuối cùng'),
    ).toBeInTheDocument();

    // Banners creation
    fireEvent.click(screen.getByRole('link', { name: 'Banner trang chủ' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Tạo Banner mới' }));
    fireEvent.change(await screen.findByLabelText(/Tiêu đề/), { target: { value: 'Winter Sale' } });
    fireEvent.change(screen.getByLabelText(/Ảnh Desktop/), {
      target: { value: '/media/banners/winter.webp' },
    });
    fireEvent.change(screen.getByLabelText(/Alt text/), { target: { value: 'Winter Sale Banner' } });
    fireEvent.change(screen.getByLabelText(/Loại đích chuyển hướng/), {
      target: { value: 'CATEGORY' },
    });
    fireEvent.change(await screen.findByLabelText(/Đối tượng đích/), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Tạo banner' }));

    await waitFor(() => {
      expect(mock.capturedBannerPayloads).toHaveLength(1);
    });
    expect(mock.capturedBannerPayloads[0]).toMatchObject({
      title: 'Winter Sale',
      target_type: 'CATEGORY',
      category_id: 1,
      product_id: null,
      brand_id: null,
    });
  });
});
