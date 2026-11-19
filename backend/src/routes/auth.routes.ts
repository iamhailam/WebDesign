import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { validateBody } from '../middlewares/validate.js';
import type { LoginRateLimiter } from '../middlewares/rate-limit.js';
import type { AuthService } from '../services/auth.service.js';
import type { UserSelf } from '../types/auth.js';

const emailSchema = z.string().trim().toLowerCase().pipe(z.email().max(254));
const phoneSchema = z.string().trim().regex(/^\+?[0-9]{8,15}$/);

const registerSchema = z.strictObject({
  full_name: z.string().trim().min(1).max(120),
  email: emailSchema,
  password: z.string().min(12).max(128),
  phone: z.preprocess((value) => (value === undefined ? null : value), phoneSchema.nullable()),
});

const loginSchema = z.strictObject({
  email: emailSchema,
  password: z.string().min(1).max(128),
});

export function createAuthRouter(
  authService: AuthService,
  requireAuth: RequestHandler,
  loginRateLimiter: LoginRateLimiter,
): Router {
  const router = Router();

  router.post('/register', validateBody(registerSchema), async (req, res) => {
    const user = await authService.registerCustomer(req.body as z.infer<typeof registerSchema>);
    res.status(201).json({
      success: true,
      data: user,
      meta: { request_id: res.locals.requestId },
    });
  });

  router.post('/login', loginRateLimiter.middleware, validateBody(loginSchema), async (req, res) => {
    const { email, password } = req.body as z.infer<typeof loginSchema>;
    const session = await authService.login(email, password);
    loginRateLimiter.resetAccount(req);
    res.status(200).json({
      success: true,
      data: session,
      meta: { request_id: res.locals.requestId },
    });
  });

  router.get('/me', requireAuth, (_req, res) => {
    res.status(200).json({
      success: true,
      data: res.locals.auth as UserSelf,
      meta: { request_id: res.locals.requestId },
    });
  });

  return router;
}
