import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { ApiError } from '../http/error.js';

const accessClaims = z.object({
  id: z.number().int().positive(),
  role: z.enum(['CUSTOMER', 'SALES', 'WAREHOUSE', 'MARKETING', 'ADMIN']),
  ver: z.number().int().nonnegative(),
  exp: z.number().int().positive(),
  iat: z.number().int().positive(),
});

export interface JwtSettings {
  secret: string;
  issuer: string;
  audience: string;
}

// Cryptographic verification only. T04 must resolve the current DB actor,
// active flag and token_version before mounting any protected business route.
export function verifyAccessToken(token: string, settings: JwtSettings) {
  try {
    if (settings.secret.length < 32) throw new Error('JWT configuration invalid');
    return accessClaims.parse(jwt.verify(token, settings.secret, {
      algorithms: ['HS256'],
      issuer: settings.issuer,
      audience: settings.audience,
      maxAge: '30m',
    }));
  } catch {
    throw new ApiError(401, 'INVALID_TOKEN', 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn.');
  }
}
