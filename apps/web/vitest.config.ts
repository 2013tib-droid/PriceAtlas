import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { alias: { '@': resolve(import.meta.dirname, '.') } },
  test: { testTimeout: 30_000, hookTimeout: 120_000 },
});
