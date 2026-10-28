// Uji live MANUAL (docs/08 §13.2): `LIVE_AI=1 pnpm --filter @priceatlas/worker test:live`.
// Memanggil Claude sungguhan (berbayar, ±US$0,10 per jalan) dengan gambar SINTETIS saja. Tidak di CI.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/live/**/*.live.ts'],
    testTimeout: 300_000,
    fileParallelism: false,
  },
});
