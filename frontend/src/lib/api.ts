import { z } from 'zod';

const baseUrl = import.meta.env.VITE_API_BASE_URL || '/api';

export class ApiClientError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export type Role = 'CUSTOMER' | 'SALES' | 'WAREHOUSE' | 'MARKETING' | 'ADMIN';

const healthSchema = z.object({
  success: z.literal(true),
  data: z.object({ status: z.literal('ok'), service: z.string() }),
  meta: z.object({ request_id: z.string() }),
});

export const paginationSchema = z.object({
  page: z.number(),
  page_size: z.number(),
  total: z.number(),
  total_pages: z.number(),
});

export const categorySchema = z.object({
  id: z.number(),
  name: z.string(),
  slug: z.string(),
  description: z.string().nullable().optional(),
  is_active: z.boolean().optional(),
  created_at: z.string().optional(),
});

export const brandSchema = z.object({
  id: z.number(),
  name: z.string(),
  slug: z.string(),
  description: z.string().nullable().optional(),
  logo_path: z.string().nullable().optional(),
  is_active: z.boolean().optional(),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
});

export const productCardSchema = z.object({
  id: z.number(),
  name: z.string(),
  slug: z.string(),
  brand: z.object({ id: z.number(), name: z.string(), slug: z.string() }),
  category: z.object({ id: z.number(), name: z.string(), slug: z.string() }),
  product_type_code: z.string(),
  base_image_url: z.string().nullable().optional(),
  price_min: z.string(),
  price_max: z.string(),
  in_stock: z.boolean(),
});

export const imageSchema = z.object({
  id: z.number(),
  product_id: z.number(),
  variant_id: z.number().nullable(),
  asset_path: z.string(),
  alt_text: z.string(),
  sort_order: z.number(),
  is_primary: z.boolean(),
  created_at: z.string(),
});

export const variantOptionSchema = z.object({
  attribute_id: z.number(),
  code: z.string(),
  label: z.string(),
  value_id: z.number(),
  value_code: z.string(),
  value_label: z.string(),
});

export const variantSchema = z.object({
  id: z.number(),
  product_id: z.number(),
  sku: z.string(),
  options: z.array(variantOptionSchema),
  price: z.string(),
  list_price: z.string().nullable(),
  stock_quantity: z.number(),
  is_active: z.boolean(),
  images: z.array(imageSchema),
});

const optionSchemaEntry = z.object({
  attribute_id: z.number(),
  code: z.string(),
  label: z.string(),
  required: z.boolean(),
  values: z.array(
    z.object({
      id: z.number(),
      code: z.string(),
      label: z.string(),
    }),
  ),
});

export const productDetailSchema = productCardSchema.extend({
  description: z.string().nullable(),
  images: z.array(imageSchema),
  variants: z.array(variantSchema),
  option_schema: z.array(optionSchemaEntry),
});

export const bannerSchema = z.object({
  id: z.number(),
  title: z.string(),
  desktop_path: z.string(),
  mobile_path: z.string().nullable().optional(),
  alt_text: z.string(),
  placement: z.enum(['HERO', 'PROMO']),
  target_type: z.enum(['NONE', 'PRODUCT', 'CATEGORY', 'BRAND']),
  target_path: z.string().nullable().optional(),
  product_id: z.number().nullable().optional(),
  category_id: z.number().nullable().optional(),
  brand_id: z.number().nullable().optional(),
  starts_at: z.string().optional(),
  ends_at: z.string().optional(),
  sort_order: z.number().optional(),
  is_active: z.boolean().optional(),
});

const productTypeAttributeSchema = z.object({
  id: z.number(),
  code: z.string(),
  name: z.string(),
  unit: z.string().nullable(),
  is_required: z.boolean(),
  values: z.array(
    z.object({
      id: z.number(),
      code: z.string(),
      label: z.string(),
    }),
  ),
});

export const productTypeSchema = z.object({
  code: z.string(),
  name: z.string(),
  attributes: z.array(productTypeAttributeSchema).optional(),
});

export const userSelfSchema = z.object({
  id: z.number(),
  full_name: z.string(),
  email: z.string(),
  phone: z.string().nullable(),
  role: z.enum(['CUSTOMER', 'SALES', 'WAREHOUSE', 'MARKETING', 'ADMIN']),
  is_active: z.boolean(),
  created_at: z.string(),
});

const loginResponseSchema = z.object({
  access_token: z.string(),
  token_type: z.literal('Bearer'),
  expires_in: z.number(),
  user: userSelfSchema,
});

const cartLineSchema = z.object({
  variant_id: z.number(),
  sku: z.string(),
  product_id: z.number(),
  product_name: z.string(),
  product_slug: z.string(),
  options: z.array(variantOptionSchema),
  image_url: z.string().nullable().optional(),
  quantity: z.number(),
  unit_price: z.string(),
  list_price: z.string().nullable(),
  line_amount: z.string(),
  stock_quantity: z.number(),
  available: z.boolean(),
  issue_code: z.string().nullable(),
});

const cartSchema = z.object({
  id: z.number(),
  version: z.string(),
  items: z.array(cartLineSchema),
  subtotal_amount: z.string(),
  has_stock_issues: z.boolean(),
  has_unavailable_items: z.boolean(),
});

const availableVoucherSchema = z.object({
  id: z.number(),
  code: z.string(),
  discount_type: z.enum(['FIXED', 'PERCENT']),
  discount_value: z.string(),
  max_discount_amount: z.string().nullable(),
  min_order_amount: z.string(),
  usage_limit: z.number(),
  used_count: z.number(),
  start_date: z.string(),
  end_date: z.string(),
  is_active: z.boolean(),
  created_at: z.string(),
  eligible_for_cart: z.boolean(),
  ineligible_reason: z.string().optional(),
});

const voucherPreviewSchema = z.object({
  voucher_code: z.string(),
  cart_version: z.string(),
  subtotal_amount: z.string(),
  discount_amount: z.string(),
  final_amount: z.string(),
  preview_only: z.boolean(),
});

const orderLineSchema = z.object({
  id: z.number(),
  variant_id: z.number(),
  sku: z.string(),
  product_name: z.string(),
  brand_name: z.string(),
  options_snapshot: z.array(
    z.object({
      code: z.string(),
      label: z.string(),
      value_code: z.string(),
      value_label: z.string(),
    }),
  ),
  quantity: z.number(),
  unit_price: z.string(),
  list_unit_price: z.string().nullable(),
  line_amount: z.string(),
});

const orderSummarySchema = z.object({
  id: z.number(),
  order_code: z.string(),
  status: z.enum(['PENDING', 'CONFIRMED', 'SHIPPING', 'DELIVERED', 'CANCELLED']),
  payment_method: z.string(),
  payment_status: z.string(),
  subtotal_amount: z.string(),
  discount_amount: z.string(),
  final_amount: z.string(),
  voucher_code: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  delivered_at: z.string().nullable(),
  items: z.array(orderLineSchema),
});

export const orderDetailSchema = orderSummarySchema.extend({
  user_id: z.number(),
  recipient_name: z.string(),
  recipient_phone: z.string(),
  shipping_address: z.string(),
});

export type UserSelf = z.infer<typeof userSelfSchema>;
export type ProductDetailDto = z.infer<typeof productDetailSchema>;
export type ProductVariantDto = z.infer<typeof variantSchema>;
export type ProductTypeDto = z.infer<typeof productTypeSchema>;
export type BrandDto = z.infer<typeof brandSchema>;
export type CategoryDto = z.infer<typeof categorySchema>;
export type BannerDto = z.infer<typeof bannerSchema>;
export type CartDto = z.infer<typeof cartSchema>;
export type CartLineDto = z.infer<typeof cartLineSchema>;
export type AvailableVoucherDto = z.infer<typeof availableVoucherSchema>;
export type VoucherPreviewDto = z.infer<typeof voucherPreviewSchema>;
export type OrderSummaryDto = z.infer<typeof orderSummarySchema>;
export type OrderDetailDto = z.infer<typeof orderDetailSchema>;

export function singleEnvelope<T extends z.ZodTypeAny>(dataSchema: T) {
  return z.object({
    success: z.literal(true),
    data: dataSchema,
    meta: z.object({ request_id: z.string() }),
  });
}

export function listEnvelope<T extends z.ZodTypeAny>(itemSchema: T) {
  return z.object({
    success: z.literal(true),
    data: z.object({ items: z.array(itemSchema) }),
    meta: z.object({
      request_id: z.string(),
      pagination: paginationSchema.optional(),
    }),
  });
}

let unauthorizedHandler: (() => void) | null = null;

export function registerUnauthorizedHandler(handler: () => void) {
  unauthorizedHandler = handler;
}

export async function requestJson<T>(
  path: string,
  schema: z.ZodType<T>,
  options: {
    method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | undefined;
    token?: string | null | undefined;
    body?: unknown;
    headers?: Record<string, string> | undefined;
  } = {},
): Promise<T> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...options.headers,
  };
  if (options.token) {
    headers.Authorization = `Bearer ${options.token}`;
  }
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      method: options.method ?? 'GET',
      headers,
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
    });
  } catch {
    throw new ApiClientError(0, 'NETWORK_ERROR', 'Không thể kết nối máy chủ. Vui lòng kiểm tra mạng và thử lại.');
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    if (response.status === 401 && unauthorizedHandler && options.token) {
      unauthorizedHandler();
    }
    const errObj = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
    const inner = errObj.error && typeof errObj.error === 'object' ? (errObj.error as Record<string, unknown>) : {};
    const code = typeof inner.code === 'string' ? inner.code : `HTTP_${response.status}`;
    const message =
      typeof errObj.message === 'string' && errObj.message
        ? errObj.message
        : 'Yêu cầu thất bại. Vui lòng thử lại.';
    const details =
      inner.details && typeof inner.details === 'object' ? (inner.details as Record<string, unknown>) : {};
    throw new ApiClientError(response.status, code, message, details);
  }

  return schema.parse(payload);
}

export async function fetchHealth() {
  const response = await fetch(`${baseUrl}/health`, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error('Không thể kết nối API. Vui lòng thử lại.');
  return healthSchema.parse(await response.json());
}

// Public Catalog & Banners
export async function fetchPublicCategories(page = 1, pageSize = 20) {
  return requestJson(`/categories?page=${page}&page_size=${pageSize}`, listEnvelope(categorySchema));
}

export async function fetchPublicBrands(page = 1, pageSize = 20, search?: string) {
  const qs = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
  if (search) qs.set('search', search);
  return requestJson(`/brands?${qs.toString()}`, listEnvelope(brandSchema));
}

export async function fetchPublicBanners(placement?: 'HERO' | 'PROMO') {
  const qs = new URLSearchParams({ page: '1', page_size: '10' });
  if (placement) qs.set('placement', placement);
  return requestJson(`/banners?${qs.toString()}`, listEnvelope(bannerSchema));
}

export async function fetchProductTypes() {
  return requestJson('/product-types', listEnvelope(productTypeSchema));
}

export async function fetchCategoryBySlug(slug: string) {
  return requestJson(`/categories/by-slug/${encodeURIComponent(slug)}`, singleEnvelope(categorySchema));
}

export async function fetchBrandBySlug(slug: string) {
  return requestJson(`/brands/by-slug/${encodeURIComponent(slug)}`, singleEnvelope(brandSchema));
}

export async function fetchProductBySlug(slug: string) {
  return requestJson(`/products/by-slug/${encodeURIComponent(slug)}`, singleEnvelope(productDetailSchema));
}

export interface ProductListParams {
  page?: number | undefined;
  page_size?: number | undefined;
  category_id?: number | undefined;
  brand_id?: number | undefined;
  product_type?: string | undefined;
  search?: string | undefined;
  min_price?: string | undefined;
  max_price?: string | undefined;
  in_stock?: boolean | undefined;
  sort?: 'newest' | 'price_asc' | 'price_desc' | 'name_asc' | undefined;
}

export async function fetchPublicProducts(params: ProductListParams = {}) {
  const qs = new URLSearchParams({
    page: String(params.page ?? 1),
    page_size: String(params.page_size ?? 12),
  });
  if (params.category_id) qs.set('category_id', String(params.category_id));
  if (params.brand_id) qs.set('brand_id', String(params.brand_id));
  if (params.product_type) qs.set('product_type', params.product_type);
  if (params.search) qs.set('search', params.search);
  if (params.min_price) qs.set('min_price', params.min_price);
  if (params.max_price) qs.set('max_price', params.max_price);
  if (params.in_stock) qs.set('in_stock', 'true');
  if (params.sort) qs.set('sort', params.sort);
  return requestJson(`/products?${qs.toString()}`, listEnvelope(productCardSchema));
}

// Auth
export async function loginApi(input: { email: string; password: string }) {
  return requestJson('/auth/login', singleEnvelope(loginResponseSchema), {
    method: 'POST',
    body: input,
  });
}

export async function registerCustomerApi(input: {
  full_name: string;
  email: string;
  password: string;
  phone: string | null;
}) {
  return requestJson('/auth/register', singleEnvelope(userSelfSchema), {
    method: 'POST',
    body: input,
  });
}

export async function fetchMeApi(token: string) {
  return requestJson('/auth/me', singleEnvelope(userSelfSchema), { token });
}

// Cart (CUSTOMER)
export async function fetchCartApi(token: string) {
  return requestJson('/cart', singleEnvelope(cartSchema), { token });
}

export async function addCartItemApi(token: string, input: { variant_id: number; quantity: number }) {
  return requestJson('/cart/items', singleEnvelope(cartSchema), {
    method: 'POST',
    token,
    body: input,
  });
}

export async function updateCartItemApi(token: string, variantId: number, quantity: number) {
  return requestJson(`/cart/items/${variantId}`, singleEnvelope(cartSchema), {
    method: 'PUT',
    token,
    body: { quantity },
  });
}

export async function removeCartItemApi(token: string, variantId: number) {
  return requestJson(`/cart/items/${variantId}`, singleEnvelope(cartSchema), {
    method: 'DELETE',
    token,
  });
}

// Vouchers Preview (CUSTOMER)
export async function fetchAvailableVouchersApi(token: string, page = 1, pageSize = 20) {
  return requestJson(`/vouchers/available?page=${page}&page_size=${pageSize}`, listEnvelope(availableVoucherSchema), {
    token,
  });
}

export async function previewVoucherApi(
  token: string,
  input: { voucher_code: string; cart_version: string; subtotal?: string | undefined },
) {
  return requestJson('/vouchers/preview', singleEnvelope(voucherPreviewSchema), {
    method: 'POST',
    token,
    body: input,
  });
}

// Orders & Checkout (CUSTOMER)
export interface CheckoutPayload {
  shipping_address: string;
  recipient_name: string;
  recipient_phone: string;
  voucher_code: string | null;
  cart_version: string;
  expected_items: Array<{ variant_id: number; quantity: number; unit_price: string }>;
}

export async function checkoutOrderApi(token: string, idempotencyKey: string, payload: CheckoutPayload) {
  return requestJson(
    '/orders/checkout',
    singleEnvelope(
      z.object({
        order: orderDetailSchema,
        replayed: z.boolean(),
      }),
    ),
    {
      method: 'POST',
      token,
      headers: { 'Idempotency-Key': idempotencyKey },
      body: payload,
    },
  );
}

export async function fetchMyOrdersApi(
  token: string,
  params: { page?: number | undefined; page_size?: number | undefined; status?: string | undefined } = {},
) {
  const qs = new URLSearchParams({
    page: String(params.page ?? 1),
    page_size: String(params.page_size ?? 10),
  });
  if (params.status) qs.set('status', params.status);
  return requestJson(`/orders/my-orders?${qs.toString()}`, listEnvelope(orderSummarySchema), { token });
}

export async function fetchOrderDetailApi(token: string, orderId: number) {
  return requestJson(`/orders/${orderId}`, singleEnvelope(orderDetailSchema), { token });
}

export async function cancelOrderApi(token: string, orderId: number, reason: string) {
  return requestJson(`/orders/${orderId}/cancel`, singleEnvelope(orderDetailSchema), {
    method: 'POST',
    token,
    body: { reason },
  });
}
