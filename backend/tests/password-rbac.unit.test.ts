import { describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import type { Request, Response } from 'express';
import { hashPassword, verifyPassword } from '../src/auth/password.js';
import { signAccessToken, verifyAccessToken, ACCESS_TOKEN_TTL_SECONDS } from '../src/auth/jwt.js';
import { hasPermission, ROLE_PERMISSIONS } from '../src/auth/rbac.js';
import { createLoginRateLimiter } from '../src/middlewares/rate-limit.js';
import { ROLES } from '../src/types/auth.js';

describe('Password hashing (Argon2id)', () => {
  it('produces salted PHC Argon2id hashes and verifies matching/mismatching passwords', async () => {
    const hash1 = await hashPassword('StrongPass!1234');
    const hash2 = await hashPassword('StrongPass!1234');
    expect(hash1).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(hash1).not.toBe(hash2);
    expect(await verifyPassword('StrongPass!1234', hash1)).toBe(true);
    expect(await verifyPassword('WrongPass!1234', hash1)).toBe(false);
  });

  it('safely rejects disabled or malformed hashes without throwing', async () => {
    expect(await verifyPassword('AnyPassword123', '!disabled-demo-no-login!')).toBe(false);
    expect(await verifyPassword('AnyPassword123', '')).toBe(false);
    expect(await verifyPassword('AnyPassword123', '$argon2id$v=19$m=10,t=1,p=1$abc$def')).toBe(false);
  });
});

describe('JWT signing and 30m TTL', () => {
  it('signs and verifies access tokens with 30-minute expiration', () => {
    const settings = {
      secret: randomBytes(32).toString('hex'),
      issuer: 'fashion-api',
      audience: 'fashion-web',
    };
    const token = signAccessToken({ id: 42, role: 'ADMIN', ver: 3 }, settings);
    const claims = verifyAccessToken(token, settings);
    expect(claims.id).toBe(42);
    expect(claims.role).toBe('ADMIN');
    expect(claims.ver).toBe(3);
    expect(claims.exp - claims.iat).toBe(ACCESS_TOKEN_TTL_SECONDS);
  });
});

describe('5-role RBAC permission policy', () => {
  it('defines policies for all 5 roles without ADMIN inheriting CUSTOMER checkout/cart', () => {
    expect(ROLES).toEqual(['CUSTOMER', 'SALES', 'WAREHOUSE', 'MARKETING', 'ADMIN']);
    expect(Object.keys(ROLE_PERMISSIONS).sort()).toEqual([...ROLES].sort());

    expect(hasPermission('CUSTOMER', 'cart:manage')).toBe(true);
    expect(hasPermission('CUSTOMER', 'orders:checkout')).toBe(true);
    expect(hasPermission('CUSTOMER', 'users:manage')).toBe(false);

    expect(hasPermission('ADMIN', 'users:manage')).toBe(true);
    expect(hasPermission('ADMIN', 'audit:read')).toBe(true);
    expect(hasPermission('ADMIN', 'cart:manage')).toBe(false);
    expect(hasPermission('ADMIN', 'orders:checkout')).toBe(false);

    expect(hasPermission('SALES', 'orders:transition')).toBe(true);
    expect(hasPermission('SALES', 'inventory:import')).toBe(false);

    expect(hasPermission('WAREHOUSE', 'inventory:import')).toBe(true);
    expect(hasPermission('WAREHOUSE', 'orders:read:all')).toBe(false);

    expect(hasPermission('MARKETING', 'vouchers:manage')).toBe(true);
    expect(hasPermission('MARKETING', 'reports:read')).toBe(true);
    expect(hasPermission('MARKETING', 'users:manage')).toBe(false);
  });
});

describe('Login rate limiter middleware', () => {
  it('blocks excessive attempts with 429 and Retry-After and resets per-account counter on success', () => {
    let nowMs = 1_000_000;
    const limiter = createLoginRateLimiter({
      windowMs: 60_000,
      maxAttemptsPerAccount: 3,
      maxAttemptsPerIp: 10,
      now: () => nowMs,
    });

    const makeReq = (ip: string, email: string) =>
      ({
        ip,
        socket: { remoteAddress: ip },
        body: { email },
      }) as unknown as Request;

    const makeRes = () => {
      const headers: Record<string, string> = {};
      return {
        headers,
        setHeader(name: string, value: string) {
          headers[name] = value;
        },
      } as unknown as Response & { headers: Record<string, string> };
    };

    const runAttempt = (ip: string, email: string) => {
      let captured: unknown = null;
      const res = makeRes();
      limiter.middleware(makeReq(ip, email), res, (err?: unknown) => {
        captured = err ?? null;
      });
      return { captured, headers: res.headers };
    };

    expect(runAttempt('127.0.0.1', 'User@Example.com').captured).toBeNull();
    expect(runAttempt('127.0.0.1', 'user@example.com').captured).toBeNull();
    expect(runAttempt('127.0.0.1', 'user@example.com').captured).toBeNull();

    const blocked = runAttempt('127.0.0.1', 'user@example.com');
    expect(blocked.captured).toMatchObject({ status: 429, code: 'RATE_LIMITED' });
    expect(Number(blocked.headers['Retry-After'])).toBeGreaterThanOrEqual(1);

    // Advance window -> allowed again, then resetAccount clears account bucket
    nowMs += 61_000;
    expect(runAttempt('127.0.0.1', 'user@example.com').captured).toBeNull();
    limiter.resetAccount(makeReq('127.0.0.1', 'user@example.com'));
    expect(runAttempt('127.0.0.1', 'user@example.com').captured).toBeNull();
  });
});
