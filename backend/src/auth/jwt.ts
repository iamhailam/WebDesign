import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { ApiError } from '../http/error.js';
import { ROLES, type AccessTokenClaims, type Role } from '../types/auth.js';

const accessClaims = z.object({
  id: z.number().int().positive(),
  role: z.enum(ROLES),
  ver: z.number().int().nonnegative(),
  exp: z.number().int().positive(),
  iat: z.number().int().positive(),
});

export const ACCESS_TOKEN_TTL_SECONDS = 1800;

export interface JwtSettings {
  secret: string;
  issuer: string;
  audience: string;
}

export function signAccessToken(
  payload: { id: number; role: Role; ver: number },
  settings: JwtSettings,
): string {
  if (settings.secret.length < 32) {
    throw new Error('JWT configuration invalid');
  }
  return jwt.sign(
    { id: payload.id, role: payload.role, ver: payload.ver },
    settings.secret,
    {
      algorithm: 'HS256',
      issuer: settings.issuer,
      audience: settings.audience,
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    },
  );
}

export function verifyAccessToken(token: string, settings: JwtSettings): AccessTokenClaims {
  try {
    if (settings.secret.length < 32) throw new Error('JWT configuration invalid');
    return accessClaims.parse(jwt.verify(token, settings.secret, {
      algorithms: ['HS256'],
      issuer: settings.issuer,
      audience: settings.audience,
      maxAge: `${ACCESS_TOKEN_TTL_SECONDS}s`,
    }));
  } catch {
    throw new ApiError(401, 'INVALID_TOKEN', 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn.');
  }
}
