import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { requireRole } from '../auth/rbac.js';
import { ApiError } from '../http/error.js';
import { validateBody } from '../middlewares/validate.js';
import type { AuthService } from '../services/auth.service.js';
import { ROLES, type UserSelf } from '../types/auth.js';

const listUsersQuerySchema = z.strictObject({
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(20),
  search: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.string().trim().min(1).max(100).optional(),
  ),
  role: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.enum(ROLES).optional(),
  ),
  is_active: z.preprocess(
    (value) => {
      if (value === undefined || value === '') return undefined;
      if (value === 'true' || value === true) return true;
      if (value === 'false' || value === false) return false;
      return value;
    },
    z.boolean().optional(),
  ),
});

const updateUserSchema = z.strictObject({
  full_name: z.string().trim().min(1).max(120),
  phone: z.string().trim().regex(/^\+?[0-9]{8,15}$/).nullable(),
  role: z.enum(ROLES),
  is_active: z.boolean(),
});

function parsePositiveId(raw: string | string[] | undefined): number {
  if (typeof raw !== 'string' || !/^[1-9][0-9]*$/.test(raw)) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'ID không hợp lệ.', {
      fields: [{ field: 'id', reason: 'ID phải là số nguyên dương.' }],
    });
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value > 2147483647) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'ID vượt quá giới hạn cho phép.', {
      fields: [{ field: 'id', reason: 'ID không hợp lệ.' }],
    });
  }
  return value;
}

export function createUsersRouter(
  authService: AuthService,
  requireAuth: RequestHandler,
): Router {
  const router = Router();
  router.use(requireAuth, requireRole(['ADMIN']));

  router.get('/', async (req, res) => {
    const query = listUsersQuerySchema.parse(req.query);
    const actor = res.locals.auth as UserSelf;
    const result = await authService.listUsers(actor.id, query);
    res.status(200).json({
      success: true,
      data: { items: result.items },
      meta: {
        request_id: res.locals.requestId,
        pagination: result.pagination,
      },
    });
  });

  router.get('/:id', async (req, res) => {
    const targetId = parsePositiveId(req.params.id);
    const actor = res.locals.auth as UserSelf;
    const user = await authService.getUserById(actor.id, targetId);
    res.status(200).json({
      success: true,
      data: user,
      meta: { request_id: res.locals.requestId },
    });
  });

  router.put('/:id', validateBody(updateUserSchema), async (req, res) => {
    const targetId = parsePositiveId(req.params.id);
    const actor = res.locals.auth as UserSelf;
    const body = req.body as z.infer<typeof updateUserSchema>;
    const updated = await authService.updateUser(
      actor.id,
      targetId,
      body,
      res.locals.requestId as string,
    );
    res.status(200).json({
      success: true,
      data: updated,
      meta: { request_id: res.locals.requestId },
    });
  });

  return router;
}
