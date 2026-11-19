import { z } from 'zod';
import {
  bannerSchema,
  brandSchema,
  categorySchema,
  imageSchema,
  listEnvelope,
  orderDetailSchema,
  paginationSchema,
  productCardSchema,
  productDetailSchema,
  requestJson,
  singleEnvelope,
  userSelfSchema,
  variantSchema,
  type Role,
} from '@/lib/api';

// Orders Management (SALES, ADMIN)
export const adminOrderSummarySchema = z.object({
  id: z.number(),
  order_code: z.string(),
  user_id: z.number(),
  recipient_name: z.string(),
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
});

export type AdminOrderSummaryDto = z.infer<typeof adminOrderSummarySchema>;

export async function fetchAdminOrdersApi(
  token: string,
  params: {
    page?: number | undefined;
    page_size?: number | undefined;
    status?: string | undefined;
    order_code?: string | undefined;
    user_id?: number | undefined;
  } = {},
) {
  const qs = new URLSearchParams({
    page: String(params.page ?? 1),
    page_size: String(params.page_size ?? 20),
  });
  if (params.status) qs.set('status', params.status);
  if (params.order_code) qs.set('order_code', params.order_code);
  if (params.user_id) qs.set('user_id', String(params.user_id));
  return requestJson(`/orders?${qs.toString()}`, listEnvelope(adminOrderSummarySchema), { token });
}

export async function fetchAdminOrderDetailApi(token: string, orderId: number) {
  return requestJson(`/orders/${orderId}`, singleEnvelope(orderDetailSchema), { token });
}

export async function transitionOrderStatusApi(
  token: string,
  orderId: number,
  input: {
    expected_status: 'PENDING' | 'CONFIRMED' | 'SHIPPING' | 'DELIVERED' | 'CANCELLED';
    target_status: 'CONFIRMED' | 'SHIPPING' | 'DELIVERED';
  },
) {
  return requestJson(`/orders/${orderId}/status`, singleEnvelope(orderDetailSchema), {
    method: 'PATCH',
    token,
    body: input,
  });
}

export async function cancelAdminOrderApi(token: string, orderId: number, reason: string) {
  return requestJson(`/orders/${orderId}/cancel`, singleEnvelope(orderDetailSchema), {
    method: 'POST',
    token,
    body: { reason },
  });
}

// Inventory (WAREHOUSE, ADMIN)
export const inventoryItemSchema = z.object({
  variant_id: z.number(),
  sku: z.string(),
  product_name: z.string(),
  options: z.array(z.record(z.string(), z.unknown())),
  quantity: z.number(),
  updated_at: z.string(),
  is_active: z.boolean(),
});

export const inventoryTransactionSchema = z.object({
  id: z.string(),
  variant_id: z.number(),
  sku: z.string(),
  type: z.enum(['IMPORT', 'EXPORT_ORDER', 'RETURN_CANCEL']),
  quantity_change: z.number(),
  reference_type: z.string(),
  reference_id: z.number().nullable(),
  order_code: z.string().nullable(),
  note: z.string().nullable(),
  created_by: z.number(),
  created_at: z.string(),
});

const importInventoryResponseSchema = z.object({
  transaction: inventoryTransactionSchema,
  replayed: z.boolean(),
});

export type InventoryItemDto = z.infer<typeof inventoryItemSchema>;
export type InventoryTransactionDto = z.infer<typeof inventoryTransactionSchema>;

export async function fetchAdminInventoryApi(
  token: string,
  params: {
    page?: number | undefined;
    page_size?: number | undefined;
    search?: string | undefined;
    low_stock_threshold?: number | undefined;
  } = {},
) {
  const qs = new URLSearchParams({
    page: String(params.page ?? 1),
    page_size: String(params.page_size ?? 20),
  });
  if (params.search) qs.set('search', params.search);
  if (params.low_stock_threshold !== undefined) {
    qs.set('low_stock_threshold', String(params.low_stock_threshold));
  }
  return requestJson(`/inventory?${qs.toString()}`, listEnvelope(inventoryItemSchema), { token });
}

export async function importInventoryApi(
  token: string,
  input: { variant_id: number; quantity: number; note: string },
  idempotencyKey: string,
) {
  return requestJson('/inventory/import', singleEnvelope(importInventoryResponseSchema), {
    method: 'POST',
    token,
    headers: { 'Idempotency-Key': idempotencyKey },
    body: input,
  });
}

export async function fetchInventoryTransactionsApi(
  token: string,
  params: {
    page?: number | undefined;
    page_size?: number | undefined;
    variant_id?: number | undefined;
    type?: 'IMPORT' | 'EXPORT_ORDER' | 'RETURN_CANCEL' | undefined;
    order_id?: number | undefined;
    from?: string | undefined;
    to?: string | undefined;
  } = {},
) {
  const qs = new URLSearchParams({
    page: String(params.page ?? 1),
    page_size: String(params.page_size ?? 20),
  });
  if (params.variant_id) qs.set('variant_id', String(params.variant_id));
  if (params.type) qs.set('type', params.type);
  if (params.order_id) qs.set('order_id', String(params.order_id));
  if (params.from) qs.set('from', params.from);
  if (params.to) qs.set('to', params.to);
  return requestJson(
    `/inventory/transactions?${qs.toString()}`,
    listEnvelope(inventoryTransactionSchema),
    { token },
  );
}

// Vouchers & Reports (MARKETING, ADMIN)
export const adminVoucherSchema = z.object({
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
});

export const voucherUsageSchema = z.object({
  id: z.number(),
  voucher_id: z.number(),
  user_id: z.number(),
  user_display_name: z.string(),
  email_masked: z.string(),
  order_id: z.number(),
  order_code: z.string(),
  status: z.enum(['APPLIED', 'RELEASED']),
  used_at: z.string(),
});

export type AdminVoucherDto = z.infer<typeof adminVoucherSchema>;
export type VoucherUsageDto = z.infer<typeof voucherUsageSchema>;

export async function fetchAdminVouchersApi(
  token: string,
  params: {
    page?: number | undefined;
    page_size?: number | undefined;
    search?: string | undefined;
    is_active?: boolean | undefined;
  } = {},
) {
  const qs = new URLSearchParams({
    page: String(params.page ?? 1),
    page_size: String(params.page_size ?? 20),
  });
  if (params.search) qs.set('search', params.search);
  if (params.is_active !== undefined) qs.set('is_active', String(params.is_active));
  return requestJson(`/vouchers?${qs.toString()}`, listEnvelope(adminVoucherSchema), { token });
}

export async function fetchAdminVoucherByIdApi(token: string, voucherId: number) {
  return requestJson(`/vouchers/${voucherId}`, singleEnvelope(adminVoucherSchema), { token });
}

export async function createVoucherApi(
  token: string,
  input: {
    code: string;
    discount_type: 'FIXED' | 'PERCENT';
    discount_value: string;
    max_discount_amount: string | null;
    min_order_amount: string;
    usage_limit: number;
    start_date: string;
    end_date: string;
    is_active: boolean;
  },
) {
  return requestJson('/vouchers', singleEnvelope(adminVoucherSchema), {
    method: 'POST',
    token,
    body: input,
  });
}

export async function updateVoucherApi(
  token: string,
  voucherId: number,
  input: {
    discount_type: 'FIXED' | 'PERCENT';
    discount_value: string;
    max_discount_amount: string | null;
    min_order_amount: string;
    usage_limit: number;
    start_date: string;
    end_date: string;
    is_active: boolean;
  },
) {
  return requestJson(`/vouchers/${voucherId}`, singleEnvelope(adminVoucherSchema), {
    method: 'PUT',
    token,
    body: input,
  });
}

export async function fetchVoucherUsagesApi(
  token: string,
  voucherId: number,
  params: { page?: number | undefined; page_size?: number | undefined; status?: string | undefined } = {},
) {
  const qs = new URLSearchParams({
    page: String(params.page ?? 1),
    page_size: String(params.page_size ?? 20),
  });
  if (params.status) qs.set('status', params.status);
  return requestJson(
    `/vouchers/${voucherId}/usages?${qs.toString()}`,
    listEnvelope(voucherUsageSchema),
    { token },
  );
}

const revenuePeriodSchema = z.object({
  period_start: z.string(),
  order_count: z.number(),
  gross_amount: z.string(),
  discount_amount: z.string(),
  revenue_amount: z.string(),
});

const revenueReportResponseSchema = z.object({
  success: z.literal(true),
  data: z.object({
    items: z.array(revenuePeriodSchema),
    totals: z.object({
      order_count: z.number(),
      gross_amount: z.string(),
      discount_amount: z.string(),
      revenue_amount: z.string(),
    }),
  }),
  meta: z.object({
    request_id: z.string(),
    pagination: paginationSchema.optional(),
  }),
});

export const bestSellerRowSchema = z.object({
  rank: z.number(),
  product_id: z.number(),
  product_name: z.string(),
  variant_id: z.number().optional(),
  sku: z.string().optional(),
  quantity_sold: z.string(),
  gross_item_amount: z.string(),
});

export type RevenuePeriodDto = z.infer<typeof revenuePeriodSchema>;
export type BestSellerRowDto = z.infer<typeof bestSellerRowSchema>;

export async function fetchRevenueReportApi(
  token: string,
  params: {
    from: string;
    to: string;
    group_by?: 'day' | 'month' | undefined;
    page?: number | undefined;
    page_size?: number | undefined;
  },
) {
  const qs = new URLSearchParams({
    from: params.from,
    to: params.to,
    group_by: params.group_by ?? 'day',
    page: String(params.page ?? 1),
    page_size: String(params.page_size ?? 100),
  });
  return requestJson(`/reports/revenue?${qs.toString()}`, revenueReportResponseSchema, { token });
}

export async function fetchBestSellersReportApi(
  token: string,
  params: {
    from: string;
    to: string;
    level?: 'product' | 'sku' | undefined;
    page?: number | undefined;
    page_size?: number | undefined;
  },
) {
  const qs = new URLSearchParams({
    from: params.from,
    to: params.to,
    level: params.level ?? 'product',
    page: String(params.page ?? 1),
    page_size: String(params.page_size ?? 20),
  });
  return requestJson(`/reports/best-sellers?${qs.toString()}`, listEnvelope(bestSellerRowSchema), {
    token,
  });
}

// Users (ADMIN)
export async function fetchAdminUsersApi(
  token: string,
  params: {
    page?: number | undefined;
    page_size?: number | undefined;
    search?: string | undefined;
    role?: Role | undefined;
    is_active?: boolean | undefined;
  } = {},
) {
  const qs = new URLSearchParams({
    page: String(params.page ?? 1),
    page_size: String(params.page_size ?? 20),
  });
  if (params.search) qs.set('search', params.search);
  if (params.role) qs.set('role', params.role);
  if (params.is_active !== undefined) qs.set('is_active', String(params.is_active));
  return requestJson(`/users?${qs.toString()}`, listEnvelope(userSelfSchema), { token });
}

export async function updateAdminUserApi(
  token: string,
  userId: number,
  input: {
    full_name: string;
    phone: string | null;
    role: Role;
    is_active: boolean;
  },
) {
  return requestJson(`/users/${userId}`, singleEnvelope(userSelfSchema), {
    method: 'PUT',
    token,
    body: input,
  });
}

// Admin Catalog & Banners (ADMIN)
export const adminProductCardSchema = productCardSchema.extend({
  is_active: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
});

export const adminProductDetailSchema = productDetailSchema.extend({
  is_active: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
});

export type AdminProductCardDto = z.infer<typeof adminProductCardSchema>;
export type AdminProductDetailDto = z.infer<typeof adminProductDetailSchema>;

export async function fetchAdminBrandsApi(
  token: string,
  params: { page?: number | undefined; page_size?: number | undefined; search?: string | undefined; is_active?: boolean | undefined } = {},
) {
  const qs = new URLSearchParams({
    page: String(params.page ?? 1),
    page_size: String(params.page_size ?? 50),
  });
  if (params.search) qs.set('search', params.search);
  if (params.is_active !== undefined) qs.set('is_active', String(params.is_active));
  return requestJson(`/admin/brands?${qs.toString()}`, listEnvelope(brandSchema), { token });
}

export async function createBrandApi(
  token: string,
  input: { name: string; slug: string; description: string | null; logo_path: string | null; is_active: boolean },
) {
  return requestJson('/brands', singleEnvelope(brandSchema), { method: 'POST', token, body: input });
}

export async function updateBrandApi(
  token: string,
  brandId: number,
  input: { name: string; description: string | null; logo_path: string | null; is_active: boolean },
) {
  return requestJson(`/brands/${brandId}`, singleEnvelope(brandSchema), {
    method: 'PUT',
    token,
    body: input,
  });
}

export async function fetchAdminCategoriesApi(
  token: string,
  params: { page?: number | undefined; page_size?: number | undefined; search?: string | undefined; is_active?: boolean | undefined } = {},
) {
  const qs = new URLSearchParams({
    page: String(params.page ?? 1),
    page_size: String(params.page_size ?? 50),
  });
  if (params.search) qs.set('search', params.search);
  if (params.is_active !== undefined) qs.set('is_active', String(params.is_active));
  return requestJson(`/admin/categories?${qs.toString()}`, listEnvelope(categorySchema), { token });
}

export async function createCategoryApi(
  token: string,
  input: { name: string; slug: string; description: string | null; is_active: boolean },
) {
  return requestJson('/categories', singleEnvelope(categorySchema), {
    method: 'POST',
    token,
    body: input,
  });
}

export async function updateCategoryApi(
  token: string,
  categoryId: number,
  input: { name: string; description: string | null; is_active: boolean },
) {
  return requestJson(`/categories/${categoryId}`, singleEnvelope(categorySchema), {
    method: 'PUT',
    token,
    body: input,
  });
}

export async function fetchAdminProductsApi(
  token: string,
  params: {
    page?: number | undefined;
    page_size?: number | undefined;
    search?: string | undefined;
    brand_id?: number | undefined;
    category_id?: number | undefined;
    product_type?: string | undefined;
    is_active?: boolean | undefined;
  } = {},
) {
  const qs = new URLSearchParams({
    page: String(params.page ?? 1),
    page_size: String(params.page_size ?? 20),
  });
  if (params.search) qs.set('search', params.search);
  if (params.brand_id) qs.set('brand_id', String(params.brand_id));
  if (params.category_id) qs.set('category_id', String(params.category_id));
  if (params.product_type) qs.set('product_type', params.product_type);
  if (params.is_active !== undefined) qs.set('is_active', String(params.is_active));
  return requestJson(`/admin/products?${qs.toString()}`, listEnvelope(adminProductCardSchema), {
    token,
  });
}

export async function fetchAdminProductDetailApi(token: string, productId: number) {
  return requestJson(`/admin/products/${productId}`, singleEnvelope(adminProductDetailSchema), {
    token,
  });
}

export async function createProductApi(
  token: string,
  input: {
    name: string;
    slug: string;
    category_id: number;
    brand_id: number;
    product_type_code: 'CLOTHING' | 'SHOES' | 'BAGS' | 'WATCHES' | 'ACCESSORIES' | 'PERFUME';
    description: string | null;
    is_active: false;
  },
) {
  return requestJson('/products', singleEnvelope(adminProductDetailSchema), {
    method: 'POST',
    token,
    body: input,
  });
}

export async function updateProductApi(
  token: string,
  productId: number,
  input: {
    name: string;
    category_id: number;
    brand_id: number;
    description: string | null;
    is_active: boolean;
  },
) {
  return requestJson(`/products/${productId}`, singleEnvelope(adminProductDetailSchema), {
    method: 'PUT',
    token,
    body: input,
  });
}

export async function createVariantApi(
  token: string,
  productId: number,
  input: {
    sku: string;
    price: string;
    list_price: string | null;
    options: Array<{ attribute_id: number; value_id: number }>;
    is_active: boolean;
  },
) {
  return requestJson(`/products/${productId}/variants`, singleEnvelope(variantSchema), {
    method: 'POST',
    token,
    body: input,
  });
}

export async function updateVariantApi(
  token: string,
  variantId: number,
  input: { price: string; list_price: string | null; is_active: boolean },
) {
  return requestJson(`/variants/${variantId}`, singleEnvelope(variantSchema), {
    method: 'PUT',
    token,
    body: input,
  });
}

export async function addProductImageApi(
  token: string,
  productId: number,
  input: {
    variant_id: number | null;
    asset_path: string;
    alt_text: string;
    sort_order: number;
    is_primary: boolean;
  },
) {
  return requestJson(`/products/${productId}/images`, singleEnvelope(imageSchema), {
    method: 'POST',
    token,
    body: input,
  });
}

export async function updateProductImageApi(
  token: string,
  imageId: number,
  input: { asset_path: string; alt_text: string; sort_order: number; is_primary: boolean },
) {
  return requestJson(`/product-images/${imageId}`, singleEnvelope(imageSchema), {
    method: 'PUT',
    token,
    body: input,
  });
}

export async function deleteProductImageApi(token: string, imageId: number) {
  return requestJson(`/product-images/${imageId}`, singleEnvelope(z.object({ deleted_id: z.number() })), {
    method: 'DELETE',
    token,
  });
}

export async function fetchAdminBannersApi(
  token: string,
  params: {
    page?: number | undefined;
    page_size?: number | undefined;
    placement?: 'HERO' | 'PROMO' | undefined;
    is_active?: boolean | undefined;
  } = {},
) {
  const qs = new URLSearchParams({
    page: String(params.page ?? 1),
    page_size: String(params.page_size ?? 20),
  });
  if (params.placement) qs.set('placement', params.placement);
  if (params.is_active !== undefined) qs.set('is_active', String(params.is_active));
  return requestJson(`/admin/banners?${qs.toString()}`, listEnvelope(bannerSchema), { token });
}

export async function createBannerApi(
  token: string,
  input: {
    title: string;
    desktop_path: string;
    mobile_path: string | null;
    alt_text: string;
    placement: 'HERO' | 'PROMO';
    target_type: 'NONE' | 'PRODUCT' | 'CATEGORY' | 'BRAND';
    product_id: number | null;
    category_id: number | null;
    brand_id: number | null;
    starts_at: string;
    ends_at: string;
    sort_order: number;
    is_active: boolean;
  },
) {
  return requestJson('/admin/banners', singleEnvelope(bannerSchema), {
    method: 'POST',
    token,
    body: input,
  });
}

export async function updateBannerApi(
  token: string,
  bannerId: number,
  input: {
    title: string;
    desktop_path: string;
    mobile_path: string | null;
    alt_text: string;
    placement: 'HERO' | 'PROMO';
    target_type: 'NONE' | 'PRODUCT' | 'CATEGORY' | 'BRAND';
    product_id: number | null;
    category_id: number | null;
    brand_id: number | null;
    starts_at: string;
    ends_at: string;
    sort_order: number;
    is_active: boolean;
  },
) {
  return requestJson(`/admin/banners/${bannerId}`, singleEnvelope(bannerSchema), {
    method: 'PUT',
    token,
    body: input,
  });
}

// Audit Events (ADMIN)
export const auditEventSchema = z.object({
  id: z.string(),
  actor_id: z.number().nullable(),
  actor_kind: z.string(),
  action: z.string(),
  entity_type: z.string(),
  entity_id: z.string(),
  changes: z.record(z.string(), z.unknown()),
  request_id: z.string().nullable(),
  created_at: z.string(),
});

export type AuditEventDto = z.infer<typeof auditEventSchema>;

export async function fetchAuditEventsApi(
  token: string,
  params: {
    page?: number | undefined;
    page_size?: number | undefined;
    actor_id?: number | undefined;
    entity_type?: string | undefined;
    entity_id?: string | undefined;
    action?: string | undefined;
    from?: string | undefined;
    to?: string | undefined;
  } = {},
) {
  const qs = new URLSearchParams({
    page: String(params.page ?? 1),
    page_size: String(params.page_size ?? 20),
  });
  if (params.actor_id) qs.set('actor_id', String(params.actor_id));
  if (params.entity_type) qs.set('entity_type', params.entity_type);
  if (params.entity_id) qs.set('entity_id', params.entity_id);
  if (params.action) qs.set('action', params.action);
  if (params.from) qs.set('from', params.from);
  if (params.to) qs.set('to', params.to);
  return requestJson(`/admin/audit-events?${qs.toString()}`, listEnvelope(auditEventSchema), {
    token,
  });
}
