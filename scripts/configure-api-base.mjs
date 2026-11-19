import { appendFileSync } from 'node:fs';
import { resolveBuildApiBase } from './api-base.mjs';

try {
  // Deliberately ignore ambient VITE_* and .env: CI/release share this explicit source.
  const apiBase = resolveBuildApiBase(process.env.PRODUCTION_API_BASE, process.env.RELEASE_BUILD === 'true');
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `api_base=${apiBase}\n`);
  console.log(`Validated build API base: ${apiBase}`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
