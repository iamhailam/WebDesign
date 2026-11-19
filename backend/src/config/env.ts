import { readFileSync } from 'node:fs';
import { parse } from 'dotenv';
import { z } from 'zod';

const schema = z.object({
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
  JWT_SECRET: z.preprocess((value) => value === '' ? undefined : value, z.string().min(32).optional()),
  JWT_ISSUER: z.string().min(1).default('fashion-api'),
  JWT_AUDIENCE: z.string().min(1).default('fashion-web'),
});

export type Environment = z.infer<typeof schema>;

export function loadEnvironment(): Environment {
  let local: Record<string, string> = {};
  try {
    // Same path in src/config and dist/config; independent of Windows working directory.
    local = parse(readFileSync(new URL('../../../.env', import.meta.url)));
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
  }
  const result = schema.safeParse({ ...local, ...process.env });
  if (!result.success) {
    // Field names only: never include an environment value in an error/log.
    throw new Error(`Invalid environment: ${result.error.issues.map((issue) => issue.path.join('.')).join(', ')}`);
  }
  return result.data;
}
