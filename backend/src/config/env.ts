import { readFileSync } from 'node:fs';
import { parse } from 'dotenv';
import { z } from 'zod';

const emptyToUndefined = (value: unknown) => (value === '' ? undefined : value);

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    HOST: z.string().default('127.0.0.1'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    FRONTEND_ORIGIN: z.url().default('http://localhost:5173'),
    DB_HOST: z.string().min(1).default('127.0.0.1'),
    DB_PORT: z.coerce.number().int().min(1).max(65535).default(5432),
    DB_NAME: z.string().min(1).default('fashion_dev'),
    DB_USER: z.string().min(1).default('app_rw_user'),
    DB_PASSWORD: z.string().min(1),
    DB_POOL_MAX: z.coerce.number().int().min(1).max(50).default(10),
    // TLS to PostgreSQL: disable (local Docker), require (encrypted), verify-full (encrypted + CA/hostname check).
    DB_SSL_MODE: z.preprocess(emptyToUndefined, z.enum(['disable', 'require', 'verify-full']).default('disable')),
    // Optional PEM CA bundle for verify-full; literal "\n" sequences are accepted for single-line secret stores.
    DB_SSL_CA: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
    // Number of trusted reverse-proxy hops in front of Express (0 = direct exposure, do not trust X-Forwarded-For).
    TRUST_PROXY: z.preprocess(emptyToUndefined, z.coerce.number().int().min(0).max(5).default(0)),
    // Structured access log with route templates (no raw URL or query). Defaults on in production.
    LOG_REQUESTS: z.preprocess(emptyToUndefined, z.enum(['true', 'false']).optional()),
    READINESS_TOKEN: z.preprocess(emptyToUndefined, z.string().min(32).optional()),
    JWT_SECRET: z.preprocess(emptyToUndefined, z.string().min(32)),
    JWT_ISSUER: z.string().min(1).default('fashion-api'),
    JWT_AUDIENCE: z.string().min(1).default('fashion-web'),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV !== 'production') return;
    const origin = new URL(env.FRONTEND_ORIGIN);
    if (origin.protocol !== 'https:' || origin.origin !== env.FRONTEND_ORIGIN) {
      ctx.addIssue({ code: 'custom', path: ['FRONTEND_ORIGIN'], message: 'Production requires an https origin.' });
    }
    if (env.DB_SSL_MODE !== 'verify-full') {
      ctx.addIssue({ code: 'custom', path: ['DB_SSL_MODE'], message: 'Production requires verified database TLS.' });
    }
    if (env.DB_USER !== 'app_rw_user') {
      ctx.addIssue({ code: 'custom', path: ['DB_USER'], message: 'Use the provisioned runtime role.' });
    }
    if (!env.READINESS_TOKEN) {
      ctx.addIssue({ code: 'custom', path: ['READINESS_TOKEN'], message: 'Production requires a readiness credential.' });
    }
  });

export type Environment = z.infer<typeof schema>;

export function parseEnvironment(raw: Record<string, string | undefined>): Environment {
  const result = schema.safeParse(raw);
  if (!result.success) {
    // Field names only: never include an environment value in an error/log.
    throw new Error(`Invalid environment: ${result.error.issues.map((issue) => issue.path.join('.')).join(', ')}`);
  }
  return result.data;
}

export function loadEnvironment(): Environment {
  let local: Record<string, string> = {};
  try {
    // Same path in src/config and dist/config; independent of Windows working directory.
    if (process.env.NODE_ENV !== 'production') {
      local = parse(readFileSync(new URL('../../../.env', import.meta.url)));
    }
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
  }
  return parseEnvironment({ ...local, ...process.env });
}

export function shouldLogRequests(env: Pick<Environment, 'NODE_ENV' | 'LOG_REQUESTS'>): boolean {
  if (env.LOG_REQUESTS !== undefined) return env.LOG_REQUESTS === 'true';
  return env.NODE_ENV === 'production';
}
