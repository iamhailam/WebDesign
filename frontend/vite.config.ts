import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, loadEnv } from 'vite';
import { resolveBuildApiBase } from '../scripts/api-base.mjs';

export default defineConfig(({ mode }) => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const env = loadEnv(mode, root, '');
  const configuredBase = process.env.VITE_API_BASE_URL || env.VITE_API_BASE_URL || '/api';
  const apiBase = mode === 'production' ? resolveBuildApiBase(configuredBase) : configuredBase;
  return {
    envDir: root,
    define: { 'import.meta.env.VITE_API_BASE_URL': JSON.stringify(apiBase) },
    plugins: [react(), tailwindcss(), {
      name: 'verify-api-base',
      apply: 'build',
      enforce: 'post',
      generateBundle(_options, bundle) {
        const chunk = Object.values(bundle).find((entry) => entry.type === 'chunk'
          && Object.keys(entry.modules).some((id) => id.replace(/\\/g, '/').endsWith('/src/lib/api.ts')));
        if (!chunk || chunk.type !== 'chunk' || !chunk.code.includes(JSON.stringify(apiBase))) {
          this.error('Compiled API module must contain the configured API base.');
        }
      },
      writeBundle(outputOptions, bundle) {
        const chunk = Object.values(bundle).find((entry) => entry.type === 'chunk'
          && Object.keys(entry.modules).some((id) => id.replace(/\\/g, '/').endsWith('/src/lib/api.ts')));
        if (!chunk || chunk.type !== 'chunk' || !outputOptions.dir) {
          this.error('Compiled API module was not written to disk.');
        }
        const written = readFileSync(resolve(outputOptions.dir, chunk.fileName));
        if (!written.toString('utf8').includes(JSON.stringify(apiBase))) {
          this.error('Written API chunk does not contain the configured API base.');
        }
        writeFileSync(
          resolve(outputOptions.dir, 'api-config.json'),
          JSON.stringify({
            api_base: apiBase,
            api_chunk: chunk.fileName,
            sha256: createHash('sha256').update(written).digest('hex'),
          }, null, 2) + '\n',
        );
      },
    }],
    resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
    build: {
      rollupOptions: {
        output: {
          manualChunks: {
            react: ['react', 'react-dom', 'react-dom/client'],
            router: ['react-router-dom'],
            query: ['@tanstack/react-query'],
            validation: ['zod'],
            forms: ['react-hook-form', '@hookform/resolvers/zod'],
          },
        },
      },
    },
    server: {
      port: 5173,
      strictPort: true,
      proxy: { '/api': { target: `http://127.0.0.1:${process.env.PORT || env.PORT || '3000'}`, changeOrigin: true } },
    },
  };
});
