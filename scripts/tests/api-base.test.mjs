import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { resolveBuildApiBase, validateProductionApiBase } from '../api-base.mjs';
import { verifyBuildApiBase } from '../verify-build-api-base.mjs';

const productionBase = 'https://api.release-fixture.test/api';
const configureScript = fileURLToPath(new URL('../configure-api-base.mjs', import.meta.url));

function removeFixture(directory) {
  const target = resolve(directory);
  assert.equal(dirname(target), resolve(tmpdir()));
  assert.match(basename(target), /^fashion-api-(config|artifact)-/);
  rmSync(target, { recursive: true, force: true });
}

test('ordinary CI/local builds use /api without a configured deployment URL', () => {
  assert.equal(resolveBuildApiBase(undefined), '/api');
  assert.equal(resolveBuildApiBase(''), '/api');
  assert.equal(resolveBuildApiBase('/api'), '/api');
});

test('production configuration accepts canonical HTTPS API URLs and preserves distinct real hosts', () => {
  assert.equal(validateProductionApiBase(productionBase), productionBase);
  assert.equal(validateProductionApiBase('https://API.release-fixture.test:443/api'), productionBase);
  assert.equal(validateProductionApiBase('https://notexample.com/api'), 'https://notexample.com/api');
  assert.equal(resolveBuildApiBase(productionBase, true), productionBase);
});

test('release rejects missing, relative, HTTP and example.com URLs including subdomains/case/trailing dot', () => {
  for (const base of [undefined, '', '/api', 'http://api.release-fixture.test/api',
    'https://example.com/api', 'https://api.example.com/api', 'https://EXAMPLE.COM/api',
    'https://api.example.com./api', 'https://example%2ecom/api']) {
    assert.throws(() => resolveBuildApiBase(base, true), /PRODUCTION_API_BASE/);
  }
});

test('release rejects credentials, query/fragment, wrong API path, whitespace and invalid URLs', () => {
  for (const base of ['not-a-url', `${productionBase}/`, `${productionBase}?debug=1`,
    `${productionBase}#debug`, 'https://api.release-fixture.test/',
    'https://user:private-test-value@api.release-fixture.test/api', ` ${productionBase}`,
    'https://api.\nrelease-fixture.test/api']) {
    assert.throws(() => validateProductionApiBase(base), (error) => !error.message.includes('private-test-value'));
  }
});

test('CI configuration ignores ambient VITE_API_BASE_URL and emits the one validated source for release', () => {
  const directory = mkdtempSync(join(tmpdir(), 'fashion-api-config-'));
  try {
    const output = join(directory, 'github-output');
    const env = { ...process.env, GITHUB_OUTPUT: output, VITE_API_BASE_URL: 'https://unrelated.test/api',
      PRODUCTION_API_BASE: '', RELEASE_BUILD: 'false' };
    assert.equal(spawnSync(process.execPath, [configureScript], { env }).status, 0);
    assert.equal(readFileSync(output, 'utf8'), 'api_base=/api\n');
    writeFileSync(output, '');
    assert.equal(spawnSync(process.execPath, [configureScript], { env: { ...env,
      RELEASE_BUILD: 'true', PRODUCTION_API_BASE: productionBase } }).status, 0);
    assert.equal(readFileSync(output, 'utf8'), `api_base=${productionBase}\n`);
    writeFileSync(output, '');
    const rejected = spawnSync(process.execPath, [configureScript], { env: { ...env, RELEASE_BUILD: 'true' } });
    assert.equal(rejected.status, 1);
    assert.equal(readFileSync(output, 'utf8'), '');
  } finally { removeFixture(directory); }
});

test('artifact verifier checks expected API base, compiled bytes and PUBLIC_API_BASE consistently', () => {
  const directory = mkdtempSync(join(tmpdir(), 'fashion-api-artifact-'));
  try {
    mkdirSync(join(directory, 'assets'));
    const chunkPath = join(directory, 'assets', 'index-fixture.js');
    const configPath = join(directory, 'api-config.json');
    const receipt = join(directory, 'PUBLIC_API_BASE');
    const chunk = `const baseUrl=${JSON.stringify(productionBase)};fetch(baseUrl+'/health');`;
    const config = { api_base: productionBase, api_chunk: 'assets/index-fixture.js',
      sha256: createHash('sha256').update(chunk).digest('hex') };
    writeFileSync(chunkPath, chunk);
    writeFileSync(configPath, JSON.stringify(config));
    writeFileSync(receipt, productionBase + '\n');
    assert.equal(verifyBuildApiBase(productionBase, directory, receipt), productionBase);
    assert.throws(() => verifyBuildApiBase('', directory), /required/);
    assert.throws(() => verifyBuildApiBase('/api', directory), /differs/);
    writeFileSync(receipt, '/api\n');
    assert.throws(() => verifyBuildApiBase(productionBase, directory, receipt), /PUBLIC_API_BASE/);
    writeFileSync(chunkPath, chunk + '// modified');
    assert.throws(() => verifyBuildApiBase(productionBase, directory), /checksum/);
    const wrongChunk = 'const baseUrl="/api";';
    writeFileSync(chunkPath, wrongChunk);
    writeFileSync(configPath, JSON.stringify({ ...config, sha256: createHash('sha256').update(wrongChunk).digest('hex') }));
    assert.throws(() => verifyBuildApiBase(productionBase, directory), /JavaScript/);
    writeFileSync(configPath, JSON.stringify({ ...config, api_chunk: '../outside.js' }));
    assert.throws(() => verifyBuildApiBase(productionBase, directory), /Invalid API chunk/);
  } finally { removeFixture(directory); }
});
