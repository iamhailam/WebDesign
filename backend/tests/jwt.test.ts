import { randomBytes } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { describe, expect, it } from 'vitest';
import { verifyAccessToken } from '../src/auth/jwt.js';

const settings = { secret: randomBytes(32).toString('hex'), issuer: 'fashion-api', audience: 'fashion-web' };
const claims = { id: 1, role: 'CUSTOMER', ver: 0 };
const options = { issuer: settings.issuer, audience: settings.audience };

describe('JWT verifier primitive (not full DB authentication)', () => {
  it('validates signed claims and rejects wrong audience, expired and tampered tokens', () => {
    const token = jwt.sign(claims, settings.secret, { ...options, expiresIn: '30m' });
    expect(verifyAccessToken(token, settings)).toMatchObject(claims);
    expect(() => verifyAccessToken(token, { ...settings, audience: 'other' })).toThrow('Phiên đăng nhập');
    const expired = jwt.sign(claims, settings.secret, { ...options, expiresIn: -1 });
    expect(() => verifyAccessToken(expired, settings)).toThrow('Phiên đăng nhập');
    expect(() => verifyAccessToken(`${token}invalid`, settings)).toThrow('Phiên đăng nhập');
  });

  it('rejects missing expiry and invalid role even with a valid signature', () => {
    expect(() => verifyAccessToken(jwt.sign(claims, settings.secret, options), settings)).toThrow('Phiên đăng nhập');
    const invalid = jwt.sign({ ...claims, role: 'SELLER' }, settings.secret, { ...options, expiresIn: '30m' });
    expect(() => verifyAccessToken(invalid, settings)).toThrow('Phiên đăng nhập');
  });
});
