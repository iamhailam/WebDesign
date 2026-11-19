import { randomUUID, timingSafeEqual } from 'node:crypto';
import express, { type Express, type RequestHandler } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import type pg from 'pg';
import type { JwtSettings } from './auth/jwt.js';
import {
  createAuthMiddleware,
  requirePermission,
  requireRole,
  requireSelfOrRoles,
} from './auth/rbac.js';
import { ApiError, errorHandler } from './http/error.js';
import { createLoginRateLimiter, createRequestRateLimiter, type LoginRateLimiterOptions } from './middlewares/rate-limit.js';
import { createAuthRouter } from './routes/auth.routes.js';
import { createBackofficeRouter } from './routes/backoffice.routes.js';
import { createCatalogRouter } from './routes/catalog.routes.js';
import { createCommerceRouter } from './routes/commerce.routes.js';
import { createUsersRouter } from './routes/users.routes.js';
import { createAuthService } from './services/auth.service.js';
import { createBackofficeService } from './services/backoffice.service.js';
import { createCatalogService } from './services/catalog.service.js';
import { createCommerceService } from './services/commerce.service.js';

export interface AuthHelpers {
  requireAuth: RequestHandler;
  requireRole: typeof requireRole;
  requirePermission: typeof requirePermission;
  requireSelfOrRoles: typeof requireSelfOrRoles;
}

export interface AppOptions {
  checkDatabase: () => Promise<void>;
  frontendOrigin: string;
  pool?: pg.Pool;
  jwt?: JwtSettings;
  loginRateLimit?: LoginRateLimiterOptions;
  /** Number of trusted reverse-proxy hops (0 = ignore X-Forwarded-For). */
  trustProxy?: number;
  /** Emit structured logs with route templates (no raw URL, query, body, headers or PII). */
  accessLog?: boolean;
  readinessToken?: string;
  mountTestRoutes?: (app: Express, helpers: AuthHelpers) => void;
}

export function createApp(options: AppOptions) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', options.trustProxy ?? 0);
  app.use((req, res, next) => {
    res.locals.requestId = randomUUID();
    res.setHeader('X-Request-ID', res.locals.requestId as string);
    res.setHeader('Cache-Control', 'no-store');
    if (options.accessLog) {
      const startedAt = process.hrtime.bigint();
      res.on('finish', () => {
        const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
        console.log(JSON.stringify({
          event: 'http_request',
          request_id: res.locals.requestId,
          method: req.method,
          path: typeof req.route?.path === 'string'
            ? `${req.baseUrl}${req.route.path}`
            : Array.isArray(req.route?.path) && req.route.path.includes(req.path) ? req.path : 'unmatched',
          status: res.statusCode,
          duration_ms: Math.round(durationMs * 10) / 10,
          code: res.locals.errorCode,
        }));
      });
    }
    next();
  });
  app.use(helmet());
  app.use(cors({
    origin(origin, callback) {
      if (!origin || origin === options.frontendOrigin) return callback(null, true);
      callback(new ApiError(403, 'CORS_FORBIDDEN', 'Origin không được phép.'));
    },
    exposedHeaders: ['X-Request-ID'],
  }));
  app.use(express.json({ limit: '64kb' }));
  // One process per service until an ingress/shared rate limiter is configured.
  app.post('/api/auth/register', createRequestRateLimiter(5, 60_000));
  app.post('/api/orders/checkout', createRequestRateLimiter(30, 60_000));
  app.get(['/api/health', '/api/health/live'], (_req, res) => {
    res.json({
      success: true,
      data: { status: 'ok', service: 'fashion-api' },
      meta: { request_id: res.locals.requestId },
    });
  });
  app.get('/api/health/ready', async (req, res) => {
    if (options.readinessToken) {
      const supplied = Buffer.from(req.get('X-Readiness-Token') ?? '');
      const expected = Buffer.from(options.readinessToken);
      if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
        throw new ApiError(404, 'NOT_FOUND', 'Không tìm thấy tài nguyên.');
      }
    }
    try {
      await options.checkDatabase();
    } catch {
      throw new ApiError(503, 'DATABASE_UNAVAILABLE', 'Cơ sở dữ liệu chưa sẵn sàng.');
    }
    res.json({
      success: true,
      data: { status: 'ready', database: 'up' },
      meta: { request_id: res.locals.requestId },
    });
  });

  if (options.pool) {
    const catalogService = createCatalogService(options.pool);
    if (options.jwt) {
      const authService = createAuthService(options.pool, options.jwt);
      const commerceService = createCommerceService(options.pool);
      const backofficeService = createBackofficeService(options.pool);
      const requireAuth = createAuthMiddleware((userId) => authService.getActor(userId), options.jwt);
      const loginLimiter = createLoginRateLimiter(options.loginRateLimit);
      app.use('/api/auth', createAuthRouter(authService, requireAuth, loginLimiter));
      app.use('/api/users', createUsersRouter(authService, requireAuth));
      app.use('/api', createCatalogRouter(catalogService, requireAuth));
      app.use('/api', createCommerceRouter(commerceService, requireAuth));
      app.use('/api', createBackofficeRouter(backofficeService, requireAuth));
      if (options.mountTestRoutes) {
        options.mountTestRoutes(app, {
          requireAuth,
          requireRole,
          requirePermission,
          requireSelfOrRoles,
        });
      }
    } else {
      app.use('/api', createCatalogRouter(catalogService));
    }
  }

  app.use((_req, _res, next) => next(new ApiError(404, 'NOT_FOUND', 'Không tìm thấy tài nguyên.')));
  app.use(errorHandler);
  return app;
}
