// M2 skenario O (docs/07 §11.3, D-59, U-17): offline → foto masuk antrean IndexedDB → S-08
// "Menunggu sinyal" → online → terunggah otomatis. "Offline" = proxy diputus (F-26, service worker
// menyajikan shell) + setOffline (navigator.onLine, request halaman ke Supabase). Chromium saja,
// sama dengan test shell offline M0 (service worker).
import { expect, test, type Page } from '@playwright/test';
import { login } from './support/auth';
import { capturesOf, fixture, fixtureSha, householdOf, imagesOf } from './support/captures';
import { startCutProxy, type CutProxy } from './support/cut-proxy';
import { hasSupabase } from './support/supabase';

test.skip(({ browserName }) => browserName !== 'chromium', 'service worker: Chromium saja');
test.skip(!hasSupabase(), 'butuh Supabase lokal (job CI supabase-e2e)');

let proxy: CutProxy;
test.beforeEach(async ({ baseURL }) => {
  proxy = await startCutProxy(new URL(baseURL!));
});
test.afterEach(async () => {
  await proxy.close();
});

async function waitForShellCache(page: Page) {
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await expect
    .poll(() => page.evaluate(async () => (await caches.keys()).some((k) => k.startsWith('shell-'))), {
      timeout: 20_000,
    })
    .toBe(true);
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
}

test('O: offline → antrean → "Menunggu sinyal" → online → terunggah', async ({ page, context }) => {
  test.setTimeout(120_000);
  const { userId } = await login(page, 'm2-offline', proxy.url);
  await page.getByRole('link', { name: /^Unggahan/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Unggahan' })).toBeVisible();
  await waitForShellCache(page);

  await proxy.cut();
  await context.setOffline(true);

  // S-07 dari cache service worker; foto disimpan di HP (§5.4 langkah 1).
  await page.goto(`${proxy.url}/kamera?jenis=struk`);
  await expect(page.getByRole('heading', { name: 'Foto struk' })).toBeVisible();
  await page.getByTestId('input-gallery').setInputFiles(fixture('struk-aeon'));
  await expect(page.getByTestId('part')).not.toContainText('Menyiapkan');
  await page.getByRole('button', { name: 'Selesai' }).click();
  await expect(page.getByText('Foto disimpan di HP. Akan diunggah saat ada sinyal.').first()).toBeVisible();

  await page.goto(`${proxy.url}/unggahan`);
  const local = page.getByRole('region', { name: 'Menunggu sinyal (1)' });
  await expect(local).toBeVisible();
  await expect(local.getByTestId('local-row')).toContainText('Menunggu sinyal');
  await expect(page.getByText('Offline. Foto tetap tersimpan dan diunggah otomatis.')).toBeVisible();
  const hh = await householdOf(userId);
  expect(await capturesOf(hh)).toEqual([]);

  // Sinyal kembali: event `online` memicu antrean (tanpa reload, tanpa Background Sync).
  await context.setOffline(false);
  await expect(page.getByRole('region', { name: /Menunggu sinyal|Belum terunggah/ })).toHaveCount(0, {
    timeout: 30_000,
  });
  await expect(page.getByTestId('capture-row')).toHaveCount(1, { timeout: 30_000 });
  const caps = await capturesOf(hh);
  expect(caps).toHaveLength(1);
  expect((await imagesOf(caps[0]!.id))[0]?.sha256).toBe(fixtureSha('struk-aeon'));
});
