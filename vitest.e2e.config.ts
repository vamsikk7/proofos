import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['e2e/**/*.spec.ts'],
    testTimeout: 30000,
    hookTimeout: 30000,
    reporters: ['verbose'],
    fileParallelism: false,
  },
});
