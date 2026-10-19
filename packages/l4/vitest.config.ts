import { defineConfig } from 'vitest/config';

// L4: terhadap Supabase CLI lokal yang sedang berjalan (bukan bagian `pnpm -r test`).
export default defineConfig({
  test: { include: ['test/**/*.l4.test.ts'], testTimeout: 120_000, hookTimeout: 120_000, fileParallelism: false },
});
