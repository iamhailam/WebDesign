import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from '../src/app';

const META = { request_id: '22222222-2222-4222-8222-222222222222' };

function LocationDisplay() {
  const loc = useLocation();
  return <div data-testid="loc">{`${loc.pathname}${loc.search}`}</div>;
}

function renderShoppingApp(initialRoute: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initialRoute]}>
        <App />
        <LocationDisplay />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function createStatefulShopFetch(overrides?: {
  checkoutFailures?: Array<{ status: number; code: string; message: string }>;
  networkErrorOnce?: boolean;
}) {
  let cartVersion = 1;
  let cartQty = 0;
  let stockRemaining = 3;
  let networkFailed = false;
  const capturedIdempotencyKeys: string[] = [];

  const productDetail = {
    id: 10,
    name: 'Áo Phao Nordic Peak',
    slug: 'ao-phao-nordic-peak',
    description: 'Áo phao giữ ấm dáng gọn.',
    brand: { id: 1, name: 'Nordic Peak', slug: 'nordic-peak' },
    category: { id: 1, name: 'Fashion', slug: 'fashion' },
    product_type_code: 'CLOTHING',
    base_image_url: '/media/sanphamdemo1.jpg',
    price_min: '1890000.00',
    price_max: '1990000.00',
    in_stock: true,
    images: [
      {
        id: 1,
        product_id: 10,
        variant_id: null,
        asset_path: '/media/sanphamdemo1.jpg',
        alt_text: 'Áo phao Nordic Peak',
        sort_order: 0,
        is_primary: true,
        created_at: '2026-11-20T00:00:00.000Z',
      },
    ],
    variants: [
      {
        id: 101,
        product_id: 10,
        sku: 'NP-BURG-M',
        options: [
          { attribute_id: 1, code: 'color', label: 'Màu sắc', value_id: 11, value_code: 'burgundy', value_label: 'Đỏ trầm' },
          { attribute_id: 2, code: 'clothing_size', label: 'Kích cỡ', value_id: 21, value_code: 'm', value_label: 'M' },
        ],
        price: '1890000.00',
        list_price: '2290000.00',
        stock_quantity: 3,
        is_active: true,
        images: [],
      },
      {
        id: 102,
        product_id: 10,
        sku: 'NP-BURG-L',
        options: [
          { attribute_id: 1, code: 'color', label: 'Màu sắc', value_id: 11, value_code: 'burgundy', value_label: 'Đỏ trầm' },
          { attribute_id: 2, code: 'clothing_size', label: 'Kích cỡ', value_id: 22, value_code: 'l', value_label: 'L' },
        ],
        price: '1990000.00',
        list_price: null,
        stock_quantity: 0,
        is_active: true,
        images: [],
      },
    ],
    option_schema: [
      { attribute_id: 1, code: 'color', label: 'Màu sắc', required: true, values: [{ id: 11, code: 'burgundy', label: 'Đỏ trầm' }] },
      {
        attribute_id: 2,
        code: 'clothing_size',
        label: 'Kích cỡ',
        required: true,
        values: [
          { id: 21, code: 'm', label: 'M' },
          { id: 22, code: 'l', label: 'L' },
        ],
      },
    ],
  };

  function makeCartPayload() {
    const lineAmount = (1890000 * cartQty).toFixed(2);
    return {
      id: 1,
      version: String(cartVersion),
      items:
        cartQty > 0
          ? [
              {
                variant_id: 101,
                sku: 'NP-BURG-M',
                product_id: 10,
                product_name: 'Áo Phao Nordic Peak',
                product_slug: 'ao-phao-nordic-peak',
                options: productDetail.variants[0]!.options,
                image_url: '/media/sanphamdemo1.jpg',
                quantity: cartQty,
                unit_price: '1890000.00',
                list_price: '2290000.00',
                line_amount: lineAmount,
                stock_quantity: stockRemaining,
                available: true,
                issue_code: cartQty > stockRemaining ? 'OUT_OF_STOCK' : null,
              },
            ]
          : [],
      subtotal_amount: cartQty > 0 ? lineAmount : '0.00',
      has_stock_issues: cartQty > stockRemaining,
      has_unavailable_items: false,
    };
  }

  const placedOrder = {
    id: 501,
    order_code: 'F-501',
    user_id: 7,
    status: 'PENDING',
    payment_method: 'COD',
    payment_status: 'UNPAID',
    subtotal_amount: '3780000.00',
    discount_amount: '100000.00',
    final_amount: '3680000.00',
    voucher_code: 'SAVE100K',
    recipient_name: 'Nguyen Van A',
    recipient_phone: '0901234567',
    shipping_address: '123 Nguyen Hue, Quan 1, TP.HCM',
    created_at: '2026-11-20T03:00:00.000Z',
    updated_at: '2026-11-20T03:00:00.000Z',
    delivered_at: null,
    items: [
      {
        id: 1,
        variant_id: 101,
        sku: 'NP-BURG-M',
        product_name: 'Áo Phao Nordic Peak',
        brand_name: 'Nordic Peak',
        options_snapshot: [
          { code: 'color', label: 'Màu sắc', value_code: 'burgundy', value_label: 'Đỏ trầm' },
          { code: 'clothing_size', label: 'Kích cỡ', value_code: 'm', value_label: 'M' },
        ],
        quantity: 2,
        unit_price: '1890000.00',
        list_unit_price: '2290000.00',
        line_amount: '3780000.00',
      },
    ],
  };

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const jsonResp = (data: unknown, status = 200) => ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => data,
    });

    if (url.includes('/api/categories')) {
      return jsonResp({ success: true, data: { items: [{ id: 1, name: 'Fashion', slug: 'fashion' }] }, meta: META });
    }
    if (url.includes('/api/products/by-slug/ao-phao-nordic-peak')) {
      return jsonResp({ success: true, data: productDetail, meta: META });
    }
    if (url.includes('/api/products?')) {
      return jsonResp({ success: true, data: { items: [] }, meta: { ...META, pagination: { page: 1, page_size: 5, total: 0, total_pages: 0 } } });
    }
    if (url.endsWith('/api/auth/login') && method === 'POST') {
      return jsonResp({
        success: true,
        data: {
          access_token: 'mock-jwt-token',
          token_type: 'Bearer',
          expires_in: 1800,
          user: {
            id: 7,
            full_name: 'Nguyen Van A',
            email: 'buyer@test.invalid',
            phone: '0901234567',
            role: 'CUSTOMER',
            is_active: true,
            created_at: '2026-11-20T00:00:00.000Z',
          },
        },
        meta: META,
      });
    }
    if (url.endsWith('/api/cart') && method === 'GET') {
      return jsonResp({ success: true, data: makeCartPayload(), meta: META });
    }
    if (url.endsWith('/api/cart/items') && method === 'POST') {
      const body = JSON.parse(String(init?.body)) as { variant_id: number; quantity: number };
      cartQty += body.quantity;
      cartVersion += 1;
      return jsonResp({ success: true, data: makeCartPayload(), meta: META });
    }
    if (url.includes('/api/cart/items/') && method === 'PUT') {
      const body = JSON.parse(String(init?.body)) as { quantity: number };
      cartQty = body.quantity;
      cartVersion += 1;
      return jsonResp({ success: true, data: makeCartPayload(), meta: META });
    }
    if (url.includes('/api/vouchers/available')) {
      return jsonResp({
        success: true,
        data: {
          items: [
            {
              id: 1,
              code: 'SAVE100K',
              discount_type: 'FIXED',
              discount_value: '100000.00',
              max_discount_amount: null,
              min_order_amount: '500000.00',
              usage_limit: 10,
              used_count: 0,
              start_date: '2026-01-01T00:00:00.000Z',
              end_date: '2030-01-01T00:00:00.000Z',
              is_active: true,
              created_at: '2026-01-01T00:00:00.000Z',
              eligible_for_cart: true,
            },
          ],
        },
        meta: META,
      });
    }
    if (url.endsWith('/api/vouchers/preview') && method === 'POST') {
      return jsonResp({
        success: true,
        data: {
          voucher_code: 'SAVE100K',
          cart_version: String(cartVersion),
          subtotal_amount: (1890000 * cartQty).toFixed(2),
          discount_amount: '100000.00',
          final_amount: (1890000 * cartQty - 100000).toFixed(2),
          preview_only: true,
        },
        meta: META,
      });
    }
    if (url.endsWith('/api/orders/checkout') && method === 'POST') {
      const hdrs = init?.headers as Record<string, string> | undefined;
      if (hdrs?.['Idempotency-Key']) {
        capturedIdempotencyKeys.push(hdrs['Idempotency-Key']);
      }
      if (overrides?.networkErrorOnce && !networkFailed) {
        networkFailed = true;
        throw new Error('Network disconnected');
      }
      const nextFailure = overrides?.checkoutFailures?.shift();
      if (nextFailure) {
        if (nextFailure.code === 'OUT_OF_STOCK') stockRemaining = 0;
        return jsonResp(
          { success: false, message: nextFailure.message, error: { code: nextFailure.code, details: {} }, meta: META },
          nextFailure.status,
        );
      }
      cartQty = 0;
      cartVersion += 1;
      return jsonResp({ success: true, data: { order: placedOrder, replayed: false }, meta: META }, 201);
    }
    if (url.endsWith('/api/orders/501') && method === 'GET') {
      return jsonResp({ success: true, data: placedOrder, meta: META });
    }
    return jsonResp({ success: false, message: 'Not found', error: { code: 'NOT_FOUND', details: {} }, meta: META }, 404);
  });

  return { fetchMock, capturedIdempotencyKeys };
}

describe('Task 11 Shopping Flow UI (Product -> Variant -> Cart -> Checkout -> Order)', () => {
  it('completes full shopping journey from Product Detail through Login, Cart, Voucher Preview, Checkout to Order Confirmation', async () => {
    const { fetchMock } = createStatefulShopFetch();
    vi.stubGlobal('fetch', fetchMock);

    renderShoppingApp('/products/ao-phao-nordic-peak');

    expect(await screen.findByRole('heading', { name: 'Áo Phao Nordic Peak' })).toBeInTheDocument();
    expect(screen.getByText('Chọn kích cỡ để xem mã SKU và tồn kho chính xác.')).toBeInTheDocument();

    // Picking size L shows stock 0 and disables Add to Cart
    fireEvent.click(screen.getByRole('radio', { name: 'L' }));
    expect(await screen.findByText('NP-BURG-L')).toBeInTheDocument();
    expect(screen.getByText('Hết hàng')).toBeInTheDocument();

    // Picking size M shows SKU, discount badge, stock = 3, clamps quantity at 3
    fireEvent.click(screen.getByRole('radio', { name: 'M' }));
    expect(await screen.findByText('NP-BURG-M')).toBeInTheDocument();
    expect(screen.getByText('Còn 3 sản phẩm')).toBeInTheDocument();

    const plusBtn = screen.getByRole('button', { name: 'Tăng số lượng' });
    fireEvent.click(plusBtn);
    fireEvent.click(plusBtn);
    expect(screen.getByLabelText('Số lượng')).toHaveValue(3);
    expect(plusBtn).toBeDisabled(); // Cannot exceed stock_quantity=3 in UI

    // Guest clicks Add to Cart -> redirects to /login with return_to
    fireEvent.click(screen.getByRole('button', { name: /Đăng nhập để thêm vào giỏ/ }));
    await waitFor(() => {
      expect(screen.getByTestId('loc').textContent).toBe('/login?return_to=%2Fproducts%2Fao-phao-nordic-peak');
    });

    // Sign in -> returns to product page
    fireEvent.change(await screen.findByLabelText(/Email/), { target: { value: 'buyer@test.invalid' } });
    fireEvent.change(screen.getByLabelText(/Mật khẩu/), { target: { value: 'StrongPassword123!' } });
    fireEvent.click(screen.getByRole('button', { name: 'Đăng nhập' }));

    await waitFor(() => {
      expect(screen.getByTestId('loc').textContent).toBe('/products/ao-phao-nordic-peak');
    });

    // Select size M, quantity 2, add to cart
    fireEvent.click(await screen.findByRole('radio', { name: 'M' }));
    fireEvent.click(screen.getByRole('button', { name: 'Tăng số lượng' }));
    fireEvent.click(screen.getByRole('button', { name: 'Thêm vào giỏ hàng' }));

    expect(await screen.findByText('Đã thêm sản phẩm vào giỏ hàng.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('link', { name: 'Xem giỏ hàng' }));

    // Cart page shows item, subtotal, checkout CTA
    expect(await screen.findByRole('heading', { name: 'Giỏ hàng của bạn' })).toBeInTheDocument();
    expect(screen.getByText('SKU: NP-BURG-M')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('link', { name: /Tiến hành đặt hàng COD/ }));

    // Checkout page: validate empty address inline, apply voucher preview, submit COD order
    expect(await screen.findByRole('heading', { name: 'Xác nhận đặt hàng COD' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Đặt hàng COD' }));
    expect((await screen.findAllByText(/Địa chỉ giao hàng cần tối thiểu 10 ký tự/)).length).toBeGreaterThanOrEqual(1);

    fireEvent.change(screen.getByLabelText(/Địa chỉ giao hàng chi tiết/), {
      target: { value: '123 Nguyen Hue, Quan 1, TP.HCM' },
    });

    fireEvent.click(screen.getByRole('button', { name: /SAVE100K/ }));
    expect(await screen.findByText(/Mã SAVE100K: giảm dự kiến/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Đặt hàng COD' }));

    // Success page fetches committed order F-501
    expect(await screen.findByRole('heading', { name: 'Đặt hàng thành công' })).toBeInTheDocument();
    expect(await screen.findByText('F-501')).toBeInTheDocument();
  });

  it('retains Idempotency-Key across network retries and handles voucher/stock conflicts clearly', async () => {
    const { fetchMock, capturedIdempotencyKeys } = createStatefulShopFetch({
      networkErrorOnce: true,
      checkoutFailures: [{ status: 409, code: 'VOUCHER_EXHAUSTED', message: 'Mã giảm giá đã hết lượt.' }],
    });
    vi.stubGlobal('fetch', fetchMock);

    // Pre-populate flow directly by logging in and hitting checkout
    renderShoppingApp('/login?return_to=%2Fproducts%2Fao-phao-nordic-peak');
    fireEvent.change(await screen.findByLabelText(/Email/), { target: { value: 'buyer@test.invalid' } });
    fireEvent.change(screen.getByLabelText(/Mật khẩu/), { target: { value: 'StrongPassword123!' } });
    fireEvent.click(screen.getByRole('button', { name: 'Đăng nhập' }));

    fireEvent.click(await screen.findByRole('radio', { name: 'M' }));
    fireEvent.click(screen.getByRole('button', { name: 'Thêm vào giỏ hàng' }));
    fireEvent.click(await screen.findByRole('link', { name: 'Xem giỏ hàng' }));
    fireEvent.click(await screen.findByRole('link', { name: /Tiến hành đặt hàng COD/ }));

    fireEvent.change(await screen.findByLabelText(/Địa chỉ giao hàng chi tiết/), {
      target: { value: '123 Nguyen Hue, Quan 1, TP.HCM' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Đặt hàng COD' }));

    // Network error triggers safe retry button using SAME Idempotency-Key
    const retryBtn = await screen.findByRole('button', { name: /Thử lại với cùng mã yêu cầu/ });
    fireEvent.click(retryBtn);

    await waitFor(() => expect(capturedIdempotencyKeys).toHaveLength(2));
    expect(capturedIdempotencyKeys[0]).toBe(capturedIdempotencyKeys[1]);

    // 2nd response hits 409 VOUCHER_EXHAUSTED without losing recipient form
    expect((await screen.findAllByText(/Mã giảm giá đã hết lượt/)).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByLabelText(/Địa chỉ giao hàng chi tiết/)).toHaveValue('123 Nguyen Hue, Quan 1, TP.HCM');
  });
});
