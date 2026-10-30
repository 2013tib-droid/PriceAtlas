// Uji live sintetis (docs/08 §13.2 baris Live): manual, TIDAK di CI.
//   LIVE_AI=1 ANTHROPIC_API_KEY=… pnpm --filter @priceatlas/worker test:live
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/live/**/*.live.test.ts'],
    testTimeout: 300_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
});
