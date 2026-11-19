import type { Request, RequestHandler } from 'express';
import { ApiError } from '../http/error.js';
import type { ActorRecord, Role, UserSelf } from '../types/auth.js';
import { verifyAccessToken, type JwtSettings } from './jwt.js';

export type Permission =
  | 'auth:me'
  | 'catalog:read'
  | 'catalog:manage'
  | 'banners:manage'
  | 'cart:manage'
  | 'vouchers:preview'
  | 'vouchers:manage'
  | 'orders:checkout'
  | 'orders:read:own'
  | 'orders:read:all'
  | 'orders:transition'
  | 'orders:cancel:own'
  | 'orders:cancel:any'
  | 'inventory:read'
  | 'inventory:import'
  | 'reports:read'
  | 'users:manage'
  | 'audit:read';

// Allowlist policy per SPEC §4, PRD §5 & DECISIONS D-07/D-09/D-13 (ADMIN does not inherit CUSTOMER cart/checkout).
export const ROLE_PERMISSIONS: Readonly<Record<Role, readonly Permission[]>> = {
  CUSTOMER: [
    'auth:me',
    'catalog:read',
    'cart:manage',
    'vouchers:preview',
    'orders:checkout',
    'orders:read:own',
    'orders:cancel:own',
  ],
  SALES: [
    'auth:me',
    'catalog:read',
    'orders:read:all',
    'orders:transition',
    'orders:cancel:any',
  ],
  WAREHOUSE: [
    'auth:me',
    'catalog:read',
    'inventory:read',
    'inventory:import',
  ],
  MARKETING: [
    'auth:me',
    'catalog:read',
    'vouchers:manage',
    'reports:read',
  ],
  ADMIN: [
    'auth:me',
    'catalog:read',
    'catalog:manage',
    'banners:manage',
    'orders:read:all',
    'orders:transition',
    'orders:cancel:any',
    'inventory:read',
    'inventory:import',
    'vouchers:manage',
    'reports:read',
    'users:manage',
    'audit:read',
  ],
};

export function hasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

export function toUserSelf(actor: ActorRecord): UserSelf {
  return {
    id: actor.id,
    full_name: actor.full_name,
    email: actor.email,
    phone: actor.phone,
    role: actor.role,
    is_active: actor.is_active,
    created_at: actor.created_at,
  };
}

export function createAuthMiddleware(
  getActor: (userId: number) => Promise<ActorRecord | null>,
  jwtSettings: JwtSettings,
): RequestHandler {
  return async (req, res, next) => {
    const header = req.header('authorization');
    if (!header || !header.startsWith('Bearer ')) {
      return next(new ApiError(401, 'INVALID_TOKEN', 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn.'));
    }
    const token = header.slice('Bearer '.length).trim();
    if (!token) {
      return next(new ApiError(401, 'INVALID_TOKEN', 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn.'));
    }

    const claims = verifyAccessToken(token, jwtSettings);
    const actor = await getActor(claims.id);
    if (!actor || !actor.is_active || actor.role !== claims.role || actor.token_version !== claims.ver) {
      return next(new ApiError(401, 'INVALID_TOKEN', 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn.'));
    }

    res.locals.auth = toUserSelf(actor);
    next();
  };
}

export function requireRole(allowedRoles: readonly Role[]): RequestHandler {
  return (_req, res, next) => {
    const auth = res.locals.auth as UserSelf | undefined;
    if (!auth) {
      return next(new ApiError(401, 'INVALID_TOKEN', 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn.'));
    }
    if (!allowedRoles.includes(auth.role)) {
      return next(new ApiError(403, 'FORBIDDEN', 'Bạn không có quyền thực hiện thao tác này.'));
    }
    next();
  };
}

export function requirePermission(permission: Permission): RequestHandler {
  return (_req, res, next) => {
    const auth = res.locals.auth as UserSelf | undefined;
    if (!auth) {
      return next(new ApiError(401, 'INVALID_TOKEN', 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn.'));
    }
    if (!hasPermission(auth.role, permission)) {
      return next(new ApiError(403, 'FORBIDDEN', 'Bạn không có quyền thực hiện thao tác này.'));
    }
    next();
  };
}

export function requireSelfOrRoles(
  resolveOwnerId: (req: Request) => Promise<number | null> | number | null,
  privilegedRoles: readonly Role[] = [],
  options: { concealAsNotFound?: boolean } = {},
): RequestHandler {
  const conceal = options.concealAsNotFound ?? true;
  return async (req, res, next) => {
    const auth = res.locals.auth as UserSelf | undefined;
    if (!auth) {
      return next(new ApiError(401, 'INVALID_TOKEN', 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn.'));
    }
    if (privilegedRoles.includes(auth.role)) {
      return next();
    }
    const ownerId = await resolveOwnerId(req);
    if (ownerId === null) {
      return next(new ApiError(404, 'NOT_FOUND', 'Không tìm thấy tài nguyên.'));
    }
    if (ownerId !== auth.id) {
      if (conceal) {
        return next(new ApiError(404, 'NOT_FOUND', 'Không tìm thấy tài nguyên.'));
      }
      return next(new ApiError(403, 'FORBIDDEN', 'Bạn không có quyền truy cập tài nguyên này.'));
    }
    next();
  };
}
