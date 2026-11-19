import type pg from 'pg';
import { withRetryableTransaction, withTransaction } from '../config/database.js';
import { ApiError } from '../http/error.js';
import type { Role } from '../types/auth.js';

function toIso(value: Date | string): string {
  return new Date(value).toISOString();
}

function toIsoNullable(value: Date | string | null | undefined): string | null {
  return value ? new Date(value).toISOString() : null;
}

function formatMoney(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const str = String(value);
  return str.includes('.') ? `${str}00`.slice(0, str.indexOf('.') + 3) : `${str}.00`;
}

export interface CartResponse {
  id: number;
  version: string;
  items: Array<Record<string, unknown>>;
  subtotal_amount: string;
  has_stock_issues: boolean;
  has_unavailable_items: boolean;
}

export interface OrderDetailResponse {
  id: number;
  order_code: string;
  user_id: number;
  status: string;
  payment_method: string;
  payment_status: string;
  subtotal_amount: string;
  discount_amount: string;
  final_amount: string;
  voucher_code: string | null;
  recipient_name: string;
  recipient_phone: string;
  shipping_address: string;
  created_at: string;
  updated_at: string;
  delivered_at: string | null;
  items: Array<Record<string, unknown>>;
}

function normalizeOrderDetail(raw: OrderDetailResponse): OrderDetailResponse {
  return {
    ...raw,
    created_at: toIso(raw.created_at),
    updated_at: toIso(raw.updated_at),
    delivered_at: toIsoNullable(raw.delivered_at),
  };
}

export function createCommerceService(pool: pg.Pool) {
  async function getCart(actorId: number): Promise<CartResponse> {
    const res = await pool.query<{ fn_read_cart: CartResponse }>('SELECT app.fn_read_cart($1)', [actorId]);
    return res.rows[0]!.fn_read_cart;
  }

  async function addCartItem(actorId: number, variantId: number, quantity: number): Promise<CartResponse> {
    return withTransaction(pool, async (client) => {
      const res = await client.query<{ fn_mutate_cart: CartResponse }>(
        "SELECT app.fn_mutate_cart($1, 'ADD', $2, $3)",
        [actorId, variantId, quantity],
      );
      return res.rows[0]!.fn_mutate_cart;
    });
  }

  async function setCartItemQuantity(actorId: number, variantId: number, quantity: number): Promise<CartResponse> {
    return withTransaction(pool, async (client) => {
      const res = await client.query<{ fn_mutate_cart: CartResponse }>(
        "SELECT app.fn_mutate_cart($1, 'SET', $2, $3)",
        [actorId, variantId, quantity],
      );
      return res.rows[0]!.fn_mutate_cart;
    });
  }

  async function removeCartItem(actorId: number, variantId: number): Promise<CartResponse> {
    return withTransaction(pool, async (client) => {
      const res = await client.query<{ fn_mutate_cart: CartResponse }>(
        "SELECT app.fn_mutate_cart($1, 'REMOVE', $2, NULL)",
        [actorId, variantId],
      );
      return res.rows[0]!.fn_mutate_cart;
    });
  }

  async function listAvailableVouchers(actorId: number, page: number, pageSize: number) {
    const res = await pool.query<{
      id: number;
      code: string;
      discount_type: 'FIXED' | 'PERCENT';
      discount_value: string;
      max_discount_amount: string | null;
      min_order_amount: string;
      usage_limit: number;
      used_count: number;
      start_date: Date | string;
      end_date: Date | string;
      is_active: boolean;
      created_at: Date | string;
      eligible_for_cart: boolean;
      ineligible_reason: string | null;
      total_count: string;
    }>('SELECT * FROM app.fn_read_available_vouchers($1, $2, $3)', [actorId, page, pageSize]);

    const total = res.rows[0] ? Number(res.rows[0].total_count) : 0;
    return {
      items: res.rows.map((r) => ({
        id: r.id,
        code: r.code,
        discount_type: r.discount_type,
        discount_value: formatMoney(r.discount_value) ?? '0.00',
        max_discount_amount: formatMoney(r.max_discount_amount),
        min_order_amount: formatMoney(r.min_order_amount) ?? '0.00',
        usage_limit: r.usage_limit,
        used_count: r.used_count,
        start_date: toIso(r.start_date),
        end_date: toIso(r.end_date),
        is_active: r.is_active,
        created_at: toIso(r.created_at),
        eligible_for_cart: r.eligible_for_cart,
        ...(r.ineligible_reason ? { ineligible_reason: r.ineligible_reason } : {}),
      })),
      pagination: {
        page,
        page_size: pageSize,
        total,
        total_pages: total === 0 ? 0 : Math.ceil(total / pageSize),
      },
    };
  }

  async function previewVoucher(
    actorId: number,
    voucherCode: string,
    cartVersion: string,
    clientSubtotal?: string,
  ) {
    const res = await pool.query<{
      voucher_code: string;
      cart_version: string;
      subtotal_amount: string;
      discount_amount: string;
      final_amount: string;
      preview_only: boolean;
    }>(
      'SELECT * FROM app.fn_preview_voucher($1, $2, $3::bigint, $4::numeric)',
      [actorId, voucherCode, cartVersion, clientSubtotal ?? null],
    );
    const row = res.rows[0]!;
    return {
      voucher_code: row.voucher_code,
      cart_version: row.cart_version,
      subtotal_amount: formatMoney(row.subtotal_amount) ?? '0.00',
      discount_amount: formatMoney(row.discount_amount) ?? '0.00',
      final_amount: formatMoney(row.final_amount) ?? '0.00',
      preview_only: row.preview_only,
    };
  }

  async function checkout(
    actorId: number,
    idempotencyKey: string,
    input: {
      shipping_address: string;
      recipient_name: string;
      recipient_phone: string;
      voucher_code: string | null;
      cart_version: string;
      expected_items: Array<{ variant_id: number; quantity: number; unit_price: string }>;
    },
  ): Promise<{ order: OrderDetailResponse; replayed: boolean }> {
    return withRetryableTransaction(pool, async (client) => {
      const placeRes = await client.query<{ order_id: number; order_code: string; replayed: boolean }>(
        'SELECT * FROM app.fn_place_order($1, $2::jsonb, $3, $4::uuid, $5::bigint, $6::jsonb)',
        [
          actorId,
          JSON.stringify({
            shipping_address: input.shipping_address,
            recipient_name: input.recipient_name,
            recipient_phone: input.recipient_phone,
          }),
          input.voucher_code,
          idempotencyKey,
          input.cart_version,
          JSON.stringify(input.expected_items),
        ],
      );
      const placed = placeRes.rows[0]!;
      const detailRes = await client.query<{ fn_read_order_detail: OrderDetailResponse }>(
        'SELECT app.fn_read_order_detail($1, $2)',
        [actorId, placed.order_id],
      );
      return {
        order: normalizeOrderDetail(detailRes.rows[0]!.fn_read_order_detail),
        replayed: placed.replayed,
      };
    });
  }

  async function listMyOrders(actorId: number, page: number, pageSize: number, status?: string) {
    const res = await pool.query<{
      order_json: {
        id: number;
        order_code: string;
        status: string;
        payment_method: string;
        payment_status: string;
        subtotal_amount: string;
        discount_amount: string;
        final_amount: string;
        voucher_code: string | null;
        created_at: string;
        updated_at: string;
        delivered_at: string | null;
        items: Array<Record<string, unknown>>;
      };
      total_count: string;
    }>('SELECT * FROM app.fn_read_my_orders($1, $2, $3, $4)', [actorId, page, pageSize, status ?? null]);

    const total = res.rows[0] ? Number(res.rows[0].total_count) : 0;
    return {
      items: res.rows.map((r) => ({
        ...r.order_json,
        created_at: toIso(r.order_json.created_at),
        updated_at: toIso(r.order_json.updated_at),
        delivered_at: toIsoNullable(r.order_json.delivered_at),
      })),
      pagination: {
        page,
        page_size: pageSize,
        total,
        total_pages: total === 0 ? 0 : Math.ceil(total / pageSize),
      },
    };
  }

  async function getOrderDetail(actorId: number, orderId: number): Promise<OrderDetailResponse> {
    const res = await pool.query<{ fn_read_order_detail: OrderDetailResponse }>(
      'SELECT app.fn_read_order_detail($1, $2)',
      [actorId, orderId],
    );
    return normalizeOrderDetail(res.rows[0]!.fn_read_order_detail);
  }

  async function cancelOrder(
    actorId: number,
    actorRole: Role,
    orderId: number,
    reason: string,
  ): Promise<OrderDetailResponse> {
    try {
      return await withRetryableTransaction(pool, async (client) => {
        await client.query('SELECT * FROM app.fn_cancel_order($1, $2, $3)', [orderId, actorId, reason]);
        const detailRes = await client.query<{ fn_read_order_detail: OrderDetailResponse }>(
          'SELECT app.fn_read_order_detail($1, $2)',
          [actorId, orderId],
        );
        return normalizeOrderDetail(detailRes.rows[0]!.fn_read_order_detail);
      });
    } catch (error) {
      // Conceal cross-customer order IDs as 404 NOT_FOUND per API_CONTRACT §1/§10
      if (
        actorRole === 'CUSTOMER' &&
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 'P3001'
      ) {
        throw new ApiError(404, 'NOT_FOUND', 'Không tìm thấy đơn hàng.');
      }
      throw error;
    }
  }

  return {
    getCart,
    addCartItem,
    setCartItemQuantity,
    removeCartItem,
    listAvailableVouchers,
    previewVoucher,
    checkout,
    listMyOrders,
    getOrderDetail,
    cancelOrder,
  };
}

export type CommerceService = ReturnType<typeof createCommerceService>;
