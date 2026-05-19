import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.spec.ts', 'src/**/*.test.ts'],
    globals: false,
  },
  resolve: {
    alias: {
      // src/foo/bar.js → src/foo/bar.ts (tsx ESM 호환 import 처리)
      // 평가엔진은 순수 함수만이라 alias 거의 불필요. 미래 대비 빈 등록.
    },
  },
});
