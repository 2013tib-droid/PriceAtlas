import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    testTimeout: 60_000,
    hookTimeout: 120_000,
    fileParallelism: false,
    // Uji live (API berbayar) hanya lewat `test:live` (docs/08 §13.2), tidak pernah di `test`/CI.
    exclude: [...configDefaults.exclude, 'test/live/**'],
  },
});
