import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolveBuildApiBase } from './api-base.mjs';

export function verifyBuildApiBase(expected, directory, receiptFile) {
  if (!expected) throw new Error('EXPECTED_API_BASE is required to verify a build.');
  const apiBase = resolveBuildApiBase(expected);
  const root = resolve(directory);
  const manifest = JSON.parse(readFileSync(resolve(root, 'api-config.json'), 'utf8'));
  if (manifest.api_base !== apiBase) throw new Error('Build API base differs from the validated configuration.');
  if (typeof manifest.api_chunk !== 'string' || !/^assets\/[A-Za-z0-9_-]+\.js$/.test(manifest.api_chunk)) {
    throw new Error('Invalid API chunk in build configuration.');
  }
  const chunkPath = resolve(root, manifest.api_chunk);
  if (!chunkPath.startsWith(root + sep)) throw new Error('API chunk is outside the build directory.');
  const chunk = readFileSync(chunkPath);
  if (createHash('sha256').update(chunk).digest('hex') !== manifest.sha256) {
    throw new Error('Compiled API chunk checksum differs from build configuration.');
  }
  if (!chunk.toString('utf8').includes(JSON.stringify(apiBase))) {
    throw new Error('Compiled JavaScript does not contain the validated API base.');
  }
  if (receiptFile && readFileSync(receiptFile, 'utf8').trim() !== apiBase) {
    throw new Error('Artifact PUBLIC_API_BASE differs from the validated build.');
  }
  return apiBase;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const apiBase = verifyBuildApiBase(process.env.EXPECTED_API_BASE, process.argv[2] || 'frontend/dist', process.argv[3]);
    console.log(`Verified compiled build/artifact API base: ${apiBase}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
