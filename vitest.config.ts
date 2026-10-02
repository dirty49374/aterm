import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    testTimeout: 20000,
    include: ['packages/*/test/**/*.test.ts', 'tooling/**/*.test.mjs'],
  },
});
