import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { requireRole } from '../auth/rbac.js';
import { ApiError } from '../http/error.js';
import { validateBody } from '../middlewares/validate.js';
import type { CommerceService } from '../services/commerce.service.js';
import type { UserSelf } from '../types/auth.js';

const moneyRegex = /^(0|[1-9][0-9]{0,9})(\.[0-9]{1,2})?$/;
const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const phoneRegex = /^\+?[0-9]{8,15}$/;

const moneySchema = z
  .string()
  .trim()
  .regex(moneyRegex, 'Số tiền phải là chuỗi số hợp lệ (tối đa 2 số lẻ).')
  .transform((v) => {
    const [whole, frac = ''] = v.split('.');
    return `${whole}.${frac.padEnd(2, '0')}`;
  });

const addCartItemSchema = z.strictObject({
  variant_id: z.number().int().min(1).max(2147483647),
  quantity: z.number().int().min(1).max(999),
});

const updateCartItemSchema = z.strictObject({
  quantity: z.number().int().min(1).max(999),
});

const paginationQuery = z.strictObject({
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(20),
});

const myOrdersQuery = z.strictObject({
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(20),
  status: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.enum(['PENDING', 'CONFIRMED', 'SHIPPING', 'DELIVERED', 'CANCELLED']).optional(),
  ),
});

const previewVoucherSchema = z.strictObject({
  voucher_code: z.string().trim().toUpperCase().min(1).max(40),
  cart_version: z.string().trim().regex(/^[0-9]+$/, 'cart_version không hợp lệ.'),
  subtotal: moneySchema.optional(),
});

const checkoutSchema = z
  .strictObject({
    shipping_address: z.string().trim().min(10).max(500),
    recipient_name: z.string().trim().min(1).max(120),
    recipient_phone: z.string().trim().regex(phoneRegex, 'Số điện thoại không hợp lệ.'),
    voucher_code: z.preprocess(
      (v) => (v === undefined ? null : v),
      z.string().trim().toUpperCase().min(1).max(40).nullable(),
    ),
    cart_version: z.string().trim().regex(/^[0-9]+$/, 'cart_version không hợp lệ.'),
    expected_items: z
      .array(
        z.strictObject({
          variant_id: z.number().int().min(1).max(2147483647),
          quantity: z.number().int().min(1).max(999),
          unit_price: moneySchema,
        }),
      )
      .min(1)
      .max(100),
  })
  .refine(
    (body) => new Set(body.expected_items.map((i) => i.variant_id)).size === body.expected_items.length,
    { message: 'expected_items không được chứa biến thể trùng lặp.', path: ['expected_items'] },
  );

const cancelOrderSchema = z.strictObject({
  reason: z.string().trim().min(1).max(500),
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

export function createCommerceRouter(
  commerceService: CommerceService,
  requireAuth: RequestHandler,
): Router {
  const router = Router();
  const customerOnly: RequestHandler[] = [requireAuth, requireRole(['CUSTOMER'])];

  // Cart endpoints (CUSTOMER only)
  router.get('/cart', ...customerOnly, async (_req, res) => {
    const actor = res.locals.auth as UserSelf;
    const data = await commerceService.getCart(actor.id);
    res.json({ success: true, data, meta: { request_id: res.locals.requestId } });
  });

  router.post('/cart/items', ...customerOnly, validateBody(addCartItemSchema), async (req, res) => {
    const actor = res.locals.auth as UserSelf;
    const { variant_id, quantity } = req.body as z.infer<typeof addCartItemSchema>;
    const data = await commerceService.addCartItem(actor.id, variant_id, quantity);
    res.json({ success: true, data, meta: { request_id: res.locals.requestId } });
  });

  router.put('/cart/items/:variantId', ...customerOnly, validateBody(updateCartItemSchema), async (req, res) => {
    const actor = res.locals.auth as UserSelf;
    const variantId = parsePositiveId(req.params.variantId, 'variantId');
    const { quantity } = req.body as z.infer<typeof updateCartItemSchema>;
    const data = await commerceService.setCartItemQuantity(actor.id, variantId, quantity);
    res.json({ success: true, data, meta: { request_id: res.locals.requestId } });
  });

  router.delete('/cart/items/:variantId', ...customerOnly, async (req, res) => {
    const actor = res.locals.auth as UserSelf;
    const variantId = parsePositiveId(req.params.variantId, 'variantId');
    const data = await commerceService.removeCartItem(actor.id, variantId);
    res.json({ success: true, data, meta: { request_id: res.locals.requestId } });
  });

  // Voucher endpoints (CUSTOMER only)
  router.get('/vouchers/available', ...customerOnly, async (req, res) => {
    const actor = res.locals.auth as UserSelf;
    const q = paginationQuery.parse(req.query);
    const data = await commerceService.listAvailableVouchers(actor.id, q.page, q.page_size);
    res.json({
      success: true,
      data: { items: data.items },
      meta: { request_id: res.locals.requestId, pagination: data.pagination },
    });
  });

  router.post('/vouchers/preview', ...customerOnly, validateBody(previewVoucherSchema), async (req, res) => {
    const actor = res.locals.auth as UserSelf;
    const body = req.body as z.infer<typeof previewVoucherSchema>;
    const data = await commerceService.previewVoucher(
      actor.id,
      body.voucher_code,
      body.cart_version,
      body.subtotal,
    );
    res.json({ success: true, data, meta: { request_id: res.locals.requestId } });
  });

  // Order endpoints (static routes before :id)
  router.post('/orders/checkout', ...customerOnly, validateBody(checkoutSchema), async (req, res) => {
    const actor = res.locals.auth as UserSelf;
    const idempotencyKey = parseIdempotencyKey(req.header('idempotency-key'));
    const body = req.body as z.infer<typeof checkoutSchema>;
    const result = await commerceService.checkout(actor.id, idempotencyKey, body);
    if (!result.replayed) {
      res.setHeader('Location', `/api/orders/${result.order.id}`);
      res.status(201).json({
        success: true,
        data: result,
        meta: { request_id: res.locals.requestId },
      });
      return;
    }
    res.status(200).json({
      success: true,
      data: result,
      meta: { request_id: res.locals.requestId },
    });
  });

  router.get('/orders/my-orders', ...customerOnly, async (req, res) => {
    const actor = res.locals.auth as UserSelf;
    const q = myOrdersQuery.parse(req.query);
    const data = await commerceService.listMyOrders(actor.id, q.page, q.page_size, q.status);
    res.json({
      success: true,
      data: { items: data.items },
      meta: { request_id: res.locals.requestId, pagination: data.pagination },
    });
  });

  router.get('/orders/:id', requireAuth, requireRole(['CUSTOMER', 'SALES', 'ADMIN']), async (req, res) => {
    const actor = res.locals.auth as UserSelf;
    const orderId = parsePositiveId(req.params.id, 'id');
    const data = await commerceService.getOrderDetail(actor.id, orderId);
    res.json({ success: true, data, meta: { request_id: res.locals.requestId } });
  });

  router.post(
    '/orders/:id/cancel',
    requireAuth,
    requireRole(['CUSTOMER', 'SALES', 'ADMIN']),
    validateBody(cancelOrderSchema),
    async (req, res) => {
      const actor = res.locals.auth as UserSelf;
      const orderId = parsePositiveId(req.params.id, 'id');
      const { reason } = req.body as z.infer<typeof cancelOrderSchema>;
      const data = await commerceService.cancelOrder(actor.id, actor.role, orderId, reason);
      res.json({ success: true, data, meta: { request_id: res.locals.requestId } });
    },
  );

  return router;
}
