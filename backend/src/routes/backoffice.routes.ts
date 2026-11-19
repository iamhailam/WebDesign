import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { requireRole } from '../auth/rbac.js';
import { ApiError } from '../http/error.js';
import { validateBody } from '../middlewares/validate.js';
import type { BackofficeService } from '../services/backoffice.service.js';
import type { UserSelf } from '../types/auth.js';

const moneyRegex = /^(0|[1-9][0-9]{0,9})(\.[0-9]{1,2})?$/;
const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isoDateRegex = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
const voucherCodeRegex = /^[A-Z0-9]+(-[A-Z0-9]+)*$/;

function isValidCalendarDate(value: string): boolean {
  if (!isoDateRegex.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value);
}

function diffDaysInclusive(from: string, to: string): number {
  const fromMs = Date.parse(`${from}T00:00:00.000Z`);
  const toMs = Date.parse(`${to}T00:00:00.000Z`);
  return Math.round((toMs - fromMs) / 86_400_000) + 1;
}

const moneySchema = z
  .string()
  .trim()
  .regex(moneyRegex, 'Số tiền phải là chuỗi số hợp lệ (tối đa 2 số lẻ).')
  .transform((v) => {
    const [whole, frac = ''] = v.split('.');
    return `${whole}.${frac.padEnd(2, '0')}`;
  });

const dateSchema = z.string().trim().refine(isValidCalendarDate, 'Ngày phải đúng định dạng YYYY-MM-DD.');

const optionalDateQuery = z.preprocess(
  (v) => (v === undefined || v === '' ? undefined : v),
  dateSchema.optional(),
);

const optionalPositiveIntQuery = z.preprocess(
  (v) => (v === undefined || v === '' ? undefined : v),
  z.coerce.number().int().min(1).max(2147483647).optional(),
);

const optionalNonNegativeIntQuery = z.preprocess(
  (v) => (v === undefined || v === '' ? undefined : v),
  z.coerce.number().int().min(0).max(2147483647).optional(),
);

const optionalBooleanQuery = z.preprocess((v) => {
  if (v === undefined || v === '') return undefined;
  if (v === 'true' || v === true) return true;
  if (v === 'false' || v === false) return false;
  return v;
}, z.boolean().optional());

const optionalSearchQuery = z.preprocess(
  (v) => (v === undefined || v === '' ? undefined : v),
  z.string().trim().min(1).max(100).optional(),
);

const listOrdersQuery = z.strictObject({
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(20),
  status: z.preprocess(
    (v) => (v === undefined || v === '' ? undefined : v),
    z.enum(['PENDING', 'CONFIRMED', 'SHIPPING', 'DELIVERED', 'CANCELLED']).optional(),
  ),
  order_code: optionalSearchQuery,
  user_id: optionalPositiveIntQuery,
});

const transitionOrderSchema = z.strictObject({
  expected_status: z.enum(['PENDING', 'CONFIRMED', 'SHIPPING', 'DELIVERED', 'CANCELLED']),
  target_status: z.enum(['CONFIRMED', 'SHIPPING', 'DELIVERED']),
});

const listInventoryQuery = z.strictObject({
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(20),
  search: optionalSearchQuery,
  low_stock_threshold: optionalNonNegativeIntQuery,
});

const importInventorySchema = z.strictObject({
  variant_id: z.number().int().min(1).max(2147483647),
  quantity: z.number().int().min(1).max(999999),
  note: z.string().trim().min(1).max(1000),
});

const listInventoryTransactionsQuery = z
  .strictObject({
    page: z.coerce.number().int().min(1).default(1),
    page_size: z.coerce.number().int().min(1).max(100).default(20),
    variant_id: optionalPositiveIntQuery,
    type: z.preprocess(
      (v) => (v === undefined || v === '' ? undefined : v),
      z.enum(['IMPORT', 'EXPORT_ORDER', 'RETURN_CANCEL']).optional(),
    ),
    order_id: optionalPositiveIntQuery,
    from: optionalDateQuery,
    to: optionalDateQuery,
  })
  .refine((q) => !q.from || !q.to || q.from <= q.to, {
    message: 'Ngày bắt đầu không được lớn hơn ngày kết thúc.',
    path: ['from'],
  });

const listVouchersQuery = z.strictObject({
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(20),
  search: optionalSearchQuery,
  is_active: optionalBooleanQuery,
});

const listVoucherUsagesQuery = z.strictObject({
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(20),
  status: z.preprocess(
    (v) => (v === undefined || v === '' ? undefined : v),
    z.enum(['APPLIED', 'RELEASED']).optional(),
  ),
});

function validateVoucherBusinessFields(
  data: {
    discount_type: 'FIXED' | 'PERCENT';
    discount_value: string;
    max_discount_amount: string | null;
    start_date: string;
    end_date: string;
  },
  ctx: z.RefinementCtx,
) {
  const val = Number(data.discount_value);
  if (data.discount_type === 'FIXED') {
    if (val <= 0 || !data.discount_value.endsWith('.00')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Voucher FIXED phải lớn hơn 0 và là số nguyên đồng (.00).',
        path: ['discount_value'],
      });
    }
    if (data.max_discount_amount !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Voucher FIXED không được đặt max_discount_amount (phải là null).',
        path: ['max_discount_amount'],
      });
    }
  } else {
    if (val <= 0 || val > 100) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Voucher PERCENT phải nằm trong khoảng (0, 100].',
        path: ['discount_value'],
      });
    }
    if (data.max_discount_amount !== null && Number(data.max_discount_amount) <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'max_discount_amount phải lớn hơn 0.',
        path: ['max_discount_amount'],
      });
    }
  }
  if (Date.parse(data.end_date) <= Date.parse(data.start_date)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'end_date phải lớn hơn start_date.',
      path: ['end_date'],
    });
  }
}

const createVoucherSchema = z
  .strictObject({
    code: z
      .string()
      .trim()
      .toUpperCase()
      .min(1)
      .max(40)
      .regex(voucherCodeRegex, 'Mã voucher chỉ gồm A-Z, 0-9 và dấu gạch nối đơn.'),
    discount_type: z.enum(['FIXED', 'PERCENT']),
    discount_value: moneySchema,
    max_discount_amount: moneySchema.nullable().optional().default(null),
    min_order_amount: moneySchema,
    usage_limit: z.number().int().min(1).max(2147483647),
    start_date: z.string().datetime({ offset: true }),
    end_date: z.string().datetime({ offset: true }),
    is_active: z.boolean().optional().default(true),
  })
  .superRefine(validateVoucherBusinessFields);

const updateVoucherSchema = z
  .strictObject({
    discount_type: z.enum(['FIXED', 'PERCENT']),
    discount_value: moneySchema,
    max_discount_amount: moneySchema.nullable(),
    min_order_amount: moneySchema,
    usage_limit: z.number().int().min(1).max(2147483647),
    start_date: z.string().datetime({ offset: true }),
    end_date: z.string().datetime({ offset: true }),
    is_active: z.boolean(),
  })
  .superRefine(validateVoucherBusinessFields);

const revenueReportQuery = z
  .strictObject({
    from: dateSchema,
    to: dateSchema,
    group_by: z.enum(['day', 'month']).default('day'),
    page: z.coerce.number().int().min(1).default(1),
    page_size: z.coerce.number().int().min(1).max(366).default(100),
  })
  .superRefine((q, ctx) => {
    if (q.from > q.to) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'from không được lớn hơn to.',
        path: ['from'],
      });
      return;
    }
    if (diffDaysInclusive(q.from, q.to) > 366) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Khoảng ngày báo cáo tối đa 366 ngày.',
        path: ['to'],
      });
    }
  });

const bestSellersReportQuery = z
  .strictObject({
    from: dateSchema,
    to: dateSchema,
    level: z.enum(['product', 'sku']).default('product'),
    page: z.coerce.number().int().min(1).default(1),
    page_size: z.coerce.number().int().min(1).max(100).default(20),
  })
  .superRefine((q, ctx) => {
    if (q.from > q.to) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'from không được lớn hơn to.',
        path: ['from'],
      });
      return;
    }
    if (diffDaysInclusive(q.from, q.to) > 366) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Khoảng ngày báo cáo tối đa 366 ngày.',
        path: ['to'],
      });
    }
  });

const auditEventsQuery = z
  .strictObject({
    page: z.coerce.number().int().min(1).default(1),
    page_size: z.coerce.number().int().min(1).max(100).default(20),
    actor_id: optionalPositiveIntQuery,
    entity_type: z.preprocess(
      (v) => (v === undefined || v === '' ? undefined : v),
      z.enum(['ORDER', 'INVENTORY', 'VOUCHER', 'PRODUCT', 'VARIANT', 'BRAND', 'CATEGORY', 'BANNER', 'USER']).optional(),
    ),
    entity_id: z.preprocess(
      (v) => (v === undefined || v === '' ? undefined : v),
      z.string().trim().min(1).max(64).optional(),
    ),
    action: z.preprocess(
      (v) => (v === undefined || v === '' ? undefined : v),
      z
        .enum([
          'ORDER_PLACED',
          'ORDER_CANCELLED',
          'ORDER_STATUS_CHANGED',
          'INVENTORY_IMPORTED',
          'PRICE_CHANGED',
          'ROLE_CHANGED',
          'CONTENT_CHANGED',
        ])
        .optional(),
    ),
    from: optionalDateQuery,
    to: optionalDateQuery,
  })
  .refine((q) => !q.from || !q.to || q.from <= q.to, {
    message: 'Ngày bắt đầu không được lớn hơn ngày kết thúc.',
    path: ['from'],
  });

function parsePositiveId(raw: string | string[] | undefined, field = 'id'): number {
  if (typeof raw !== 'string' || !/^[1-9][0-9]*$/.test(raw)) {
    throw new ApiError(400, 'VALIDATION_ERROR', `${field} không hợp lệ.`, {
      fields: [{ field, reason: 'Giá trị phải là số nguyên dương.' }],
    });
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value > 2147483647) {
    throw new ApiError(400, 'VALIDATION_ERROR', `${field} không hợp lệ.`, {
      fields: [{ field, reason: 'Giá trị vượt giới hạn.' }],
    });
  }
  return value;
}

function parseIdempotencyKey(raw: string | undefined): string {
  if (!raw || !uuidRegex.test(raw.trim())) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Header Idempotency-Key phải là UUID hợp lệ.', {
      fields: [{ field: 'Idempotency-Key', reason: 'Thiếu hoặc sai định dạng UUID.' }],
    });
  }
  return raw.trim().toLowerCase();
}

export function createBackofficeRouter(
  backofficeService: BackofficeService,
  requireAuth: RequestHandler,
): Router {
  const router = Router();
  const salesOrAdmin: RequestHandler[] = [requireAuth, requireRole(['SALES', 'ADMIN'])];
  const warehouseOrAdmin: RequestHandler[] = [requireAuth, requireRole(['WAREHOUSE', 'ADMIN'])];
  const marketingOrAdmin: RequestHandler[] = [requireAuth, requireRole(['MARKETING', 'ADMIN'])];
  const adminOnly: RequestHandler[] = [requireAuth, requireRole(['ADMIN'])];

  // Orders Management (SALES, ADMIN)
  router.get('/orders', ...salesOrAdmin, async (req, res) => {
    const actor = res.locals.auth as UserSelf;
    const q = listOrdersQuery.parse(req.query);
    const result = await backofficeService.listOrders(actor.id, q);
    res.json({
      success: true,
      data: { items: result.items },
      meta: { request_id: res.locals.requestId, pagination: result.pagination },
    });
  });

  router.patch('/orders/:id/status', ...salesOrAdmin, validateBody(transitionOrderSchema), async (req, res) => {
    const actor = res.locals.auth as UserSelf;
    const orderId = parsePositiveId(req.params.id, 'id');
    const body = req.body as z.infer<typeof transitionOrderSchema>;
    const data = await backofficeService.transitionOrderStatus(
      actor.id,
      orderId,
      body.expected_status,
      body.target_status,
    );
    res.json({ success: true, data, meta: { request_id: res.locals.requestId } });
  });

  // Inventory Management (WAREHOUSE, ADMIN)
  router.get('/inventory', ...warehouseOrAdmin, async (req, res) => {
    const actor = res.locals.auth as UserSelf;
    const q = listInventoryQuery.parse(req.query);
    const result = await backofficeService.listInventory(actor.id, q);
    res.json({
      success: true,
      data: { items: result.items },
      meta: { request_id: res.locals.requestId, pagination: result.pagination },
    });
  });

  router.post('/inventory/import', ...warehouseOrAdmin, validateBody(importInventorySchema), async (req, res) => {
    const actor = res.locals.auth as UserSelf;
    const idempotencyKey = parseIdempotencyKey(req.header('idempotency-key'));
    const body = req.body as z.infer<typeof importInventorySchema>;
    const result = await backofficeService.importInventory(actor.id, idempotencyKey, body);
    res.status(result.replayed ? 200 : 201).json({
      success: true,
      data: result,
      meta: { request_id: res.locals.requestId },
    });
  });

  router.get('/inventory/transactions', ...warehouseOrAdmin, async (req, res) => {
    const actor = res.locals.auth as UserSelf;
    const q = listInventoryTransactionsQuery.parse(req.query);
    const result = await backofficeService.listInventoryTransactions(actor.id, q);
    res.json({
      success: true,
      data: { items: result.items },
      meta: { request_id: res.locals.requestId, pagination: result.pagination },
    });
  });

  // Voucher Management (MARKETING, ADMIN)
  router.get('/vouchers', ...marketingOrAdmin, async (req, res) => {
    const actor = res.locals.auth as UserSelf;
    const q = listVouchersQuery.parse(req.query);
    const result = await backofficeService.listVouchers(actor.id, q);
    res.json({
      success: true,
      data: { items: result.items },
      meta: { request_id: res.locals.requestId, pagination: result.pagination },
    });
  });

  router.post('/vouchers', ...marketingOrAdmin, validateBody(createVoucherSchema), async (req, res) => {
    const actor = res.locals.auth as UserSelf;
    const body = req.body as z.infer<typeof createVoucherSchema>;
    const data = await backofficeService.createVoucher(actor.id, body, res.locals.requestId as string);
    res.status(201).json({ success: true, data, meta: { request_id: res.locals.requestId } });
  });

  router.get('/vouchers/:id/usages', ...marketingOrAdmin, async (req, res) => {
    const actor = res.locals.auth as UserSelf;
    const voucherId = parsePositiveId(req.params.id, 'id');
    const q = listVoucherUsagesQuery.parse(req.query);
    const result = await backofficeService.listVoucherUsages(actor.id, voucherId, q);
    res.json({
      success: true,
      data: { items: result.items },
      meta: { request_id: res.locals.requestId, pagination: result.pagination },
    });
  });

  router.get('/vouchers/:id', ...marketingOrAdmin, async (req, res) => {
    const actor = res.locals.auth as UserSelf;
    const voucherId = parsePositiveId(req.params.id, 'id');
    const data = await backofficeService.getVoucherById(actor.id, voucherId);
    res.json({ success: true, data, meta: { request_id: res.locals.requestId } });
  });

  router.put('/vouchers/:id', ...marketingOrAdmin, validateBody(updateVoucherSchema), async (req, res) => {
    const actor = res.locals.auth as UserSelf;
    const voucherId = parsePositiveId(req.params.id, 'id');
    const body = req.body as z.infer<typeof updateVoucherSchema>;
    const data = await backofficeService.updateVoucher(actor.id, voucherId, body, res.locals.requestId as string);
    res.json({ success: true, data, meta: { request_id: res.locals.requestId } });
  });

  // Reports (MARKETING, ADMIN)
  router.get('/reports/revenue', ...marketingOrAdmin, async (req, res) => {
    const actor = res.locals.auth as UserSelf;
    const q = revenueReportQuery.parse(req.query);
    const result = await backofficeService.getRevenueReport(actor.id, q);
    res.json({
      success: true,
      data: { items: result.items, totals: result.totals },
      meta: { request_id: res.locals.requestId, pagination: result.pagination },
    });
  });

  router.get('/reports/best-sellers', ...marketingOrAdmin, async (req, res) => {
    const actor = res.locals.auth as UserSelf;
    const q = bestSellersReportQuery.parse(req.query);
    const result = await backofficeService.getBestSellersReport(actor.id, q);
    res.json({
      success: true,
      data: { items: result.items },
      meta: { request_id: res.locals.requestId, pagination: result.pagination },
    });
  });

  // Audit Events (ADMIN only)
  router.get('/admin/audit-events', ...adminOnly, async (req, res) => {
    const actor = res.locals.auth as UserSelf;
    const q = auditEventsQuery.parse(req.query);
    const result = await backofficeService.listAuditEvents(actor.id, q);
    res.json({
      success: true,
      data: { items: result.items },
      meta: { request_id: res.locals.requestId, pagination: result.pagination },
    });
  });

  return router;
}
