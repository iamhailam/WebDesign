import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export const errorHandler: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
  let status = 500;
  let code = 'INTERNAL_ERROR';
  let message = 'Đã xảy ra lỗi hệ thống.';
  let details: Record<string, unknown> = {};
  if (error instanceof ApiError) {
    ({ status, code, message, details } = error);
  } else if (error instanceof ZodError) {
    status = 400;
    code = 'VALIDATION_ERROR';
    message = 'Dữ liệu không hợp lệ.';
    details = { fields: error.issues.map((issue) => ({ field: issue.path.join('.'), reason: issue.message })) };
  } else if (error instanceof Error && 'type' in error) {
    if (error.type === 'entity.parse.failed') {
      status = 400;
      code = 'INVALID_JSON';
      message = 'JSON không hợp lệ.';
    } else if (error.type === 'entity.too.large') {
      status = 413;
      code = 'PAYLOAD_TOO_LARGE';
      message = 'Dữ liệu vượt giới hạn cho phép.';
    }
  }
  if (status >= 500) {
    console.error(JSON.stringify({ event: 'request_failed', request_id: res.locals.requestId, code }));
  }
  res.status(status).json({
    success: false,
    message,
    error: { code, details },
    meta: { request_id: res.locals.requestId },
  });
};
