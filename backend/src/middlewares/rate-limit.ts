import type { Request, RequestHandler } from 'express';
import { ApiError } from '../http/error.js';

export interface LoginRateLimiterOptions {
  windowMs?: number;
  maxAttemptsPerAccount?: number;
  maxAttemptsPerIp?: number;
  now?: () => number;
}

interface Bucket {
  count: number;
  resetAt: number;
}

/** Bounded single-process fixed-window limiter; never logs IPs or account data. */
export function createRequestRateLimiter(limit: number, windowMs: number, now = Date.now): RequestHandler {
  const buckets = new Map<string, Bucket>();
  return (req, res, next) => {
    const ts = now();
    const key = getClientIp(req);
    const bucket = buckets.get(key);
    if (bucket && ts < bucket.resetAt) {
      if (bucket.count >= limit) {
        res.setHeader('Retry-After', String(Math.max(1, Math.ceil((bucket.resetAt - ts) / 1000))));
        return next(new ApiError(429, 'RATE_LIMITED', 'Quá nhiều yêu cầu. Vui lòng thử lại sau.'));
      }
      bucket.count += 1;
    } else {
      for (const [ip, entry] of buckets) if (ts >= entry.resetAt) buckets.delete(ip);
      // Fail closed when all slots are active instead of allocating unbounded memory.
      if (buckets.size >= 10000) {
        res.setHeader('Retry-After', String(Math.ceil(windowMs / 1000)));
        return next(new ApiError(429, 'RATE_LIMITED', 'Quá nhiều yêu cầu. Vui lòng thử lại sau.'));
      }
      buckets.set(key, { count: 1, resetAt: ts + windowMs });
    }
    next();
  };
}

export interface LoginRateLimiter {
  middleware: RequestHandler;
  resetAccount: (req: Request) => void;
}

function getClientIp(req: Request): string {
  return req.ip || req.socket.remoteAddress || 'unknown';
}

function getEmailKey(req: Request): string {
  const body = req.body as { email?: unknown } | undefined;
  if (body && typeof body.email === 'string') {
    return body.email.trim().toLowerCase();
  }
  return '';
}

export function createLoginRateLimiter(options: LoginRateLimiterOptions = {}): LoginRateLimiter {
  const windowMs = options.windowMs ?? 15 * 60 * 1000;
  const maxPerAccount = options.maxAttemptsPerAccount ?? 10;
  const maxPerIp = options.maxAttemptsPerIp ?? 30;
  const now = options.now ?? (() => Date.now());

  const ipBuckets = new Map<string, Bucket>();
  const accountBuckets = new Map<string, Bucket>();

  function consume(store: Map<string, Bucket>, key: string, limit: number, ts: number): number | null {
    const existing = store.get(key);
    if (!existing || ts >= existing.resetAt) {
      if (store.size >= 10000) {
        for (const [k, b] of store) {
          if (ts >= b.resetAt) store.delete(k);
        }
        if (!store.has(key) && store.size >= 10000) return Math.ceil(windowMs / 1000);
      }
      store.set(key, { count: 1, resetAt: ts + windowMs });
      return null;
    }
    if (existing.count >= limit) {
      return Math.max(1, Math.ceil((existing.resetAt - ts) / 1000));
    }
    existing.count += 1;
    return null;
  }

  const middleware: RequestHandler = (req, res, next) => {
    const ts = now();
    const ip = getClientIp(req);
    const ipRetry = consume(ipBuckets, ip, maxPerIp, ts);
    if (ipRetry !== null) {
      res.setHeader('Retry-After', String(ipRetry));
      return next(new ApiError(429, 'RATE_LIMITED', 'Quá nhiều lần thử đăng nhập. Vui lòng thử lại sau.'));
    }

    const email = getEmailKey(req);
    if (email) {
      const accountRetry = consume(accountBuckets, `${ip}:${email}`, maxPerAccount, ts);
      if (accountRetry !== null) {
        res.setHeader('Retry-After', String(accountRetry));
        return next(new ApiError(429, 'RATE_LIMITED', 'Quá nhiều lần thử đăng nhập. Vui lòng thử lại sau.'));
      }
    }
    next();
  };

  function resetAccount(req: Request) {
    const email = getEmailKey(req);
    if (email) {
      accountBuckets.delete(`${getClientIp(req)}:${email}`);
    }
  }

  return { middleware, resetAccount };
}
