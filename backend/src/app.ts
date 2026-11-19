import { randomUUID } from 'node:crypto';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { ApiError, errorHandler } from './http/error.js';

export interface AppOptions {
  checkDatabase: () => Promise<void>;
  frontendOrigin: string;
}

export function createApp(options: AppOptions) {
  const app = express();
  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    res.locals.requestId = randomUUID();
    res.setHeader('X-Request-ID', res.locals.requestId as string);
    res.setHeader('Cache-Control', 'no-store');
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
  app.get(['/api/health', '/api/health/live'], (_req, res) => {
    res.json({
      success: true,
      data: { status: 'ok', service: 'fashion-api' },
      meta: { request_id: res.locals.requestId },
    });
  });
  app.get('/api/health/ready', async (_req, res) => {
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
  app.use((_req, _res, next) => next(new ApiError(404, 'NOT_FOUND', 'Không tìm thấy tài nguyên.')));
  app.use(errorHandler);
  return app;
}
