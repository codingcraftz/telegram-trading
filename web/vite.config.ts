import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import path from 'node:path';

// 로컬 개발 시:
//   - vite dev server: 5173
//   - 봇 서버 (pnpm dev: tsx watch): 8080
//   - /api/* 요청은 봇 서버로 proxy
// 배포:
//   - vite build → dist/ → Dockerfile에서 봇의 dist/web/으로 복사
//   - 봇 Hono가 정적 파일 + API 모두 서빙
export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['vue', 'vue-router', 'pinia'],
        },
      },
    },
  },
});
