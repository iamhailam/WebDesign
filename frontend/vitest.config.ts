import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: {
    environment: 'jsdom',
    env: { VITE_API_BASE_URL: '/api' },
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.tsx'],
  },
});
