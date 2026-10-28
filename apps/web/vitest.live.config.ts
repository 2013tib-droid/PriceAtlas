import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

// Uji live Tanya (docs/08 §13.2): `pnpm --filter @priceatlas/web test:live-ask`. Manual, tidak di CI;
// dilewati kecuali LIVE_AI=1 dan ANTHROPIC_API_KEY tersedia.
export default defineConfig({
  resolve: { alias: { '@': resolve(import.meta.dirname, '.') } },
  test: {
    include: ['test/live/**/*.live.test.ts'],
    testTimeout: 30 * 60_000,
    hookTimeout: 120_000,
  },
});
