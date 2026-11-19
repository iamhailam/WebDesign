import type pg from 'pg';
import { withRetryableTransaction } from '../config/database.js';
import type { OrderDetailResponse } from './commerce.service.js';

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

function normalizeOrderDetail(raw: OrderDetailResponse): OrderDetailResponse {
  return {
    ...raw,
    created_at: toIso(raw.created_at),
    updated_at: toIso(raw.updated_at),
    delivered_at: toIsoNullable(raw.delivered_at),
  };
}

function buildPagination(page: number, pageSize: number, total: number) {
  return {
    page,
    page_size: pageSize,
    total,
    total_pages: total === 0 ? 0 : Math.ceil(total / pageSize),
  };
}

interface VoucherRow {
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
}

function normalizeVoucher(row: VoucherRow) {
  return {
    id: row.id,
    code: row.code,
    discount_type: row.discount_type,
    discount_value: formatMoney(row.discount_value) ?? '0.00',
    max_discount_amount: formatMoney(row.max_discount_amount),
    min_order_amount: formatMoney(row.min_order_amount) ?? '0.00',
    usage_limit: row.usage_limit,
    used_count: row.used_count,
    start_date: toIso(row.start_date),
    end_date: toIso(row.end_date),
    is_active: row.is_active,
    created_at: toIso(row.created_at),
  };
}

export function createBackofficeService(pool: pg.Pool) {
  // Orders Management (SALES, ADMIN)
  async function listOrders(
    actorId: number,
    filters: {
      page: number;
      page_size: number;
      status?: string | undefined;
      order_code?: string | undefined;
      user_id?: number | undefined;
    },
  ) {
    const res = await pool.query<{
      order_json: {
        id: number;
        order_code: string;
        user_id: number;
        recipient_name: string;
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
      };
      total_count: string;
    }>('SELECT * FROM app.fn_read_orders($1, $2, $3, $4, $5, $6)', [
      actorId,
      filters.page,
      filters.page_size,
      filters.status ?? null,
      filters.order_code ?? null,
      filters.user_id ?? null,
    ]);

    const total = res.rows[0] ? Number(res.rows[0].total_count) : 0;
    return {
      items: res.rows.map((r) => ({
        ...r.order_json,
        created_at: toIso(r.order_json.created_at),
        updated_at: toIso(r.order_json.updated_at),
        delivered_at: toIsoNullable(r.order_json.delivered_at),
      })),
      pagination: buildPagination(filters.page, filters.page_size, total),
    };
  }

  async function transitionOrderStatus(
    actorId: number,
    orderId: number,
    expectedStatus: string,
    targetStatus: string,
  ): Promise<OrderDetailResponse> {
    return withRetryableTransaction(pool, async (client) => {
      await client.query('SELECT * FROM app.fn_transition_order($1, $2, $3, $4)', [
        orderId,
        actorId,
        expectedStatus,
        targetStatus,
      ]);
      const detailRes = await client.query<{ fn_read_order_detail: OrderDetailResponse }>(
        'SELECT app.fn_read_order_detail($1, $2)',
        [actorId, orderId],
      );
      const row = detailRes.rows[0];
      if (!row) {
        throw new Error('Missing order detail row');
      }
      return normalizeOrderDetail(row.fn_read_order_detail);
    });
  }

  // Inventory (WAREHOUSE, ADMIN)
  async function listInventory(
    actorId: number,
    filters: {
      page: number;
      page_size: number;
      search?: string | undefined;
      low_stock_threshold?: number | undefined;
    },
  ) {
    const res = await pool.query<{
      row_json: {
        variant_id: number;
        sku: string;
        product_name: string;
        options: Array<Record<string, unknown>>;
        quantity: number;
        updated_at: string;
        is_active: boolean;
      };
      total_count: string;
    }>('SELECT * FROM app.fn_read_inventory($1, $2, $3, $4, $5)', [
      actorId,
      filters.page,
      filters.page_size,
      filters.search ?? null,
      filters.low_stock_threshold ?? null,
    ]);

    const total = res.rows[0] ? Number(res.rows[0].total_count) : 0;
    return {
      items: res.rows.map((r) => ({
        ...r.row_json,
        updated_at: toIso(r.row_json.updated_at),
      })),
      pagination: buildPagination(filters.page, filters.page_size, total),
    };
  }

  async function importInventory(
    actorId: number,
    idempotencyKey: string,
    input: { variant_id: number; quantity: number; note: string },
  ) {
    return withRetryableTransaction(pool, async (client) => {
      const callRes = await client.query<{ p_transaction_id: string; p_replayed: boolean }>(
        'CALL app.sp_import_inventory($1, $2, $3, $4, $5::uuid, NULL, NULL)',
        [input.variant_id, input.quantity, input.note, actorId, idempotencyKey],
      );
      const out = callRes.rows[0];
      if (!out) {
        throw new Error('Missing sp_import_inventory output');
      }
      const txRes = await client.query<{
        fn_read_inventory_transaction: {
          id: string;
          variant_id: number;
          sku: string;
          type: string;
          quantity_change: number;
          reference_type: string;
          reference_id: number | null;
          order_code: string | null;
          note: string | null;
          created_by: number;
          created_at: string;
        };
      }>('SELECT app.fn_read_inventory_transaction($1, $2::bigint)', [actorId, out.p_transaction_id]);
      const txRow = txRes.rows[0];
      if (!txRow) {
        throw new Error('Missing inventory transaction row');
      }
      const tx = txRow.fn_read_inventory_transaction;
      return {
        transaction: {
          ...tx,
          created_at: toIso(tx.created_at),
        },
        replayed: out.p_replayed,
      };
    });
  }

  async function listInventoryTransactions(
    actorId: number,
    filters: {
      page: number;
      page_size: number;
      variant_id?: number | undefined;
      type?: string | undefined;
      order_id?: number | undefined;
      from?: string | undefined;
      to?: string | undefined;
    },
  ) {
    const res = await pool.query<{
      tx_json: {
        id: string;
        variant_id: number;
        sku: string;
        type: string;
        quantity_change: number;
        reference_type: string;
        reference_id: number | null;
        order_code: string | null;
        note: string | null;
        created_by: number;
        created_at: string;
      };
      total_count: string;
    }>('SELECT * FROM app.fn_read_inventory_transactions($1, $2, $3, $4, $5, $6, $7::date, $8::date)', [
      actorId,
      filters.page,
      filters.page_size,
      filters.variant_id ?? null,
      filters.type ?? null,
      filters.order_id ?? null,
      filters.from ?? null,
      filters.to ?? null,
    ]);

    const total = res.rows[0] ? Number(res.rows[0].total_count) : 0;
    return {
      items: res.rows.map((r) => ({
        ...r.tx_json,
        created_at: toIso(r.tx_json.created_at),
      })),
      pagination: buildPagination(filters.page, filters.page_size, total),
    };
  }

  // Vouchers Management (MARKETING, ADMIN)
  async function listVouchers(
    actorId: number,
    filters: { page: number; page_size: number; search?: string | undefined; is_active?: boolean | undefined },
  ) {
    const res = await pool.query<{ voucher_json: VoucherRow; total_count: string }>(
      'SELECT * FROM app.fn_read_vouchers($1, $2, $3, $4, $5)',
      [actorId, filters.page, filters.page_size, filters.search ?? null, filters.is_active ?? null],
    );
    const total = res.rows[0] ? Number(res.rows[0].total_count) : 0;
    return {
      items: res.rows.map((r) => normalizeVoucher(r.voucher_json)),
      pagination: buildPagination(filters.page, filters.page_size, total),
    };
  }

  async function getVoucherById(actorId: number, voucherId: number) {
    const res = await pool.query<VoucherRow>('SELECT * FROM app.fn_read_voucher_by_id($1, $2)', [actorId, voucherId]);
    const row = res.rows[0];
    if (!row) {
      throw new Error('Missing voucher row');
    }
    return normalizeVoucher(row);
  }

  async function createVoucher(
    actorId: number,
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
    requestId: string,
  ) {
    return withRetryableTransaction(pool, async (client) => {
      const res = await client.query<VoucherRow>(
        'SELECT * FROM app.fn_manage_voucher($1, NULL, $2, $3, $4::numeric, $5::numeric, $6::numeric, $7, $8::timestamptz, $9::timestamptz, $10, $11::uuid)',
        [
          actorId,
          input.code,
          input.discount_type,
          input.discount_value,
          input.max_discount_amount,
          input.min_order_amount,
          input.usage_limit,
          input.start_date,
          input.end_date,
          input.is_active,
          requestId,
        ],
      );
      const row = res.rows[0];
      if (!row) {
        throw new Error('Missing created voucher row');
      }
      return normalizeVoucher(row);
    });
  }

  async function updateVoucher(
    actorId: number,
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
    requestId: string,
  ) {
    return withRetryableTransaction(pool, async (client) => {
      const res = await client.query<VoucherRow>(
        'SELECT * FROM app.fn_manage_voucher($1, $2, NULL, $3, $4::numeric, $5::numeric, $6::numeric, $7, $8::timestamptz, $9::timestamptz, $10, $11::uuid)',
        [
          actorId,
          voucherId,
          input.discount_type,
          input.discount_value,
          input.max_discount_amount,
          input.min_order_amount,
          input.usage_limit,
          input.start_date,
          input.end_date,
          input.is_active,
          requestId,
        ],
      );
      const row = res.rows[0];
      if (!row) {
        throw new Error('Missing updated voucher row');
      }
      return normalizeVoucher(row);
    });
  }

  async function listVoucherUsages(
    actorId: number,
    voucherId: number,
    filters: { page: number; page_size: number; status?: string | undefined },
  ) {
    const res = await pool.query<{
      usage_json: {
        id: number;
        voucher_id: number;
        user_id: number;
        user_display_name: string;
        email_masked: string;
        order_id: number;
        order_code: string;
        status: string;
        used_at: string;
      };
      total_count: string;
    }>('SELECT * FROM app.fn_read_voucher_usages($1, $2, $3, $4, $5)', [
      actorId,
      voucherId,
      filters.page,
      filters.page_size,
      filters.status ?? null,
    ]);
    const total = res.rows[0] ? Number(res.rows[0].total_count) : 0;
    return {
      items: res.rows.map((r) => ({
        ...r.usage_json,
        used_at: toIso(r.usage_json.used_at),
      })),
      pagination: buildPagination(filters.page, filters.page_size, total),
    };
  }

  // Reports (MARKETING, ADMIN)
  async function getRevenueReport(
    actorId: number,
    filters: { from: string; to: string; group_by: 'day' | 'month'; page: number; page_size: number },
  ) {
    const res = await pool.query<{
      fn_read_revenue_report: {
        items: Array<{
          period_start: string;
          order_count: number;
          gross_amount: string;
          discount_amount: string;
          revenue_amount: string;
        }>;
        totals: {
          order_count: number;
          gross_amount: string;
          discount_amount: string;
          revenue_amount: string;
        };
        total: number;
        page: number;
        page_size: number;
      };
    }>('SELECT app.fn_read_revenue_report($1, $2::date, $3::date, $4, $5, $6)', [
      actorId,
      filters.from,
      filters.to,
      filters.group_by,
      filters.page,
      filters.page_size,
    ]);
    const data = res.rows[0]?.fn_read_revenue_report;
    if (!data) {
      throw new Error('Missing revenue report payload');
    }
    return {
      items: data.items,
      totals: data.totals,
      pagination: buildPagination(data.page, data.page_size, data.total),
    };
  }

  async function getBestSellersReport(
    actorId: number,
    filters: { from: string; to: string; level: 'product' | 'sku'; page: number; page_size: number },
  ) {
    const res = await pool.query<{
      row_json: {
        rank: number;
        product_id: number;
        product_name: string;
        variant_id?: number;
        sku?: string;
        quantity_sold: string;
        gross_item_amount: string;
      };
      total_count: string;
    }>('SELECT * FROM app.fn_read_best_sellers_report($1, $2::date, $3::date, $4, $5, $6)', [
      actorId,
      filters.from,
      filters.to,
      filters.level,
      filters.page,
      filters.page_size,
    ]);
    const total = res.rows[0] ? Number(res.rows[0].total_count) : 0;
    return {
      items: res.rows.map((r) => r.row_json),
      pagination: buildPagination(filters.page, filters.page_size, total),
    };
  }

  // Audit Events (ADMIN)
  async function listAuditEvents(
    actorId: number,
    filters: {
      page: number;
      page_size: number;
      actor_id?: number | undefined;
      entity_type?: string | undefined;
      entity_id?: string | undefined;
      action?: string | undefined;
      from?: string | undefined;
      to?: string | undefined;
    },
  ) {
    const res = await pool.query<{
      event_json: {
        id: string;
        actor_id: number | null;
        actor_kind: string;
        action: string;
        entity_type: string;
        entity_id: string;
        changes: Record<string, unknown>;
        request_id: string | null;
        created_at: string;
      };
      total_count: string;
    }>('SELECT * FROM app.fn_read_audit_events($1, $2, $3, $4, $5, $6, $7, $8::date, $9::date)', [
      actorId,
      filters.page,
      filters.page_size,
      filters.actor_id ?? null,
      filters.entity_type ?? null,
      filters.entity_id ?? null,
      filters.action ?? null,
      filters.from ?? null,
      filters.to ?? null,
    ]);
    const total = res.rows[0] ? Number(res.rows[0].total_count) : 0;
    return {
      items: res.rows.map((r) => ({
        ...r.event_json,
        created_at: toIso(r.event_json.created_at),
      })),
      pagination: buildPagination(filters.page, filters.page_size, total),
    };
  }

  return {
    listOrders,
    transitionOrderStatus,
    listInventory,
    importInventory,
    listInventoryTransactions,
    listVouchers,
    getVoucherById,
    createVoucher,
    updateVoucher,
    listVoucherUsages,
    getRevenueReport,
    getBestSellersReport,
    listAuditEvents,
  };
}

export type BackofficeService = ReturnType<typeof createBackofficeService>;
