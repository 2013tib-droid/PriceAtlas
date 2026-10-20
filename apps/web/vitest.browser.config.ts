import { resolve } from 'node:path';
import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

// L5c browser-only (docs/07 §11.1, job CI `browser`): kompresi gambar nyata (canvas/OffscreenCanvas,
// Web Worker), EXIF dibuang, sha256, IndexedDB nyata, aturan lewati dengan fixture worker.
//   PW_CHROMIUM_PATH  executable Chromium lain (lingkungan cloud: /opt/pw-browsers/…)
const executablePath = process.env.PW_CHROMIUM_PATH;

export default defineConfig({
  resolve: { alias: { '@': resolve(import.meta.dirname, '.') } },
  publicDir: false,
  server: { fs: { allow: [resolve(import.meta.dirname, '../..')] } },
  test: {
    include: ['test/browser/**/*.browser.test.ts'],
    testTimeout: 30_000,
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(executablePath ? { launchOptions: { executablePath } } : {}),
      instances: [{ browser: 'chromium' }],
    },
  },
});
