// L5d e2e (docs/07 §11.1, §11.3, D-83): Playwright terhadap Supabase CLI lokal (job CI
// `supabase-e2e`) + `next build && next start`. Profil mobile Chromium (Pixel 7) dan WebKit (iPhone 14).
//   PW_BASE_URL       default http://localhost:3000
//   PW_NO_SERVER=1    jangan menyalakan next start (server sudah jalan)
//   PW_CHROMIUM_PATH  executable Chromium lain (mis. /opt/pw-browsers di lingkungan cloud)
//   ASK_ENGINE        default `stub` untuk next start e2e (Tanya tanpa Claude, docs/08 §13.1)
// Chromium memakai kamera palsu (file Y4M dari e2e/support/fake-camera.ts) untuk kamera label (alur 4);
// WebKit tidak punya kamera palsu, jadi alur 4 di WebKit memakai "Galeri" di kamera label (F-64).
import { defineConfig, devices } from '@playwright/test';
import { writeFakeCameraFile } from './e2e/support/fake-camera';

const baseURL = process.env.PW_BASE_URL ?? 'http://localhost:3000';
const chromiumPath = process.env.PW_CHROMIUM_PATH;
const fakeCamera = [
  '--use-fake-device-for-media-stream',
  '--use-fake-ui-for-media-stream',
  `--use-file-for-fake-video-capture=${writeFakeCameraFile()}`,
];

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: { baseURL, trace: 'retain-on-failure', locale: 'id-ID', timezoneId: 'Asia/Jakarta' },
  projects: [
    {
      name: 'chromium-mobile',
      use: {
        ...devices['Pixel 7'],
        permissions: ['camera'],
        launchOptions: { args: fakeCamera, ...(chromiumPath ? { executablePath: chromiumPath } : {}) },
      },
    },
    { name: 'webkit-mobile', use: { ...devices['iPhone 14'] } },
  ],
  webServer: process.env.PW_NO_SERVER
    ? undefined
    : {
        command: 'pnpm start',
        url: `${baseURL}/masuk`,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        // S-20 (docs/08 §13.1): e2e tidak pernah memanggil Claude; jawaban dari stub berbasis pola.
        env: { ASK_ENGINE: process.env.ASK_ENGINE ?? 'stub' },
      },
});
