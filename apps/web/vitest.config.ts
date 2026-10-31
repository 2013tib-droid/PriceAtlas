import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// L5a unit (node) + L5b komponen (jsdom, ditandai `// @vitest-environment jsdom` per file).
// Test e2e Playwright ada di e2e/ dan dijalankan terpisah (pnpm test:e2e); L5c browser di
// test/browser (pnpm test:browser, vitest.browser.config.ts). Uji live Tanya di test/live (pnpm
// test:live-ask, vitest.live.config.ts; manual).
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': resolve(import.meta.dirname, '.') } },
  test: {
    include: ['test/**/*.test.{ts,tsx}'],
    exclude: ['test/browser/**', 'test/live/**', '**/node_modules/**'],
    setupFiles: ['test/setup.ts'],
    // Test komponen yang ada memakai alur foto; mode foto mati (D-100, default build) diuji eksplisit
    // dengan vi.stubEnv di test/paste.
    env: { NEXT_PUBLIC_PHOTO_CAPTURE: 'on' },
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
