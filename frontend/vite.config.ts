import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const env = loadEnv(mode, root, '');
  if (mode === 'production') {
    const apiBase = process.env.VITE_API_BASE_URL || env.VITE_API_BASE_URL || '/api';
    if (apiBase !== '/api') {
      const url = new URL(apiBase);
      if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/api' || url.search || url.hash) {
        throw new Error('VITE_API_BASE_URL must be /api or https://<api-host>/api.');
      }
    }
  }
  return {
    envDir: root,
    plugins: [react(), tailwindcss()],
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
