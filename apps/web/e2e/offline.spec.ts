// M0 kriteria selesai: shell terbuka offline (D-81, docs/07 §5.2). M7: search offline di cache
// produk R5 (D-60, §5.6, skenario O "cari di cache R5"). Service worker hanya diuji di Chromium. "Offline" = setOffline (navigator.onLine, strip offline) + proxy diputus
// (jaringan benar-benar gagal untuk service worker, lihat support/cut-proxy.ts).
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { skipOnboarding } from './support/auth';
import { P, seedMiloPrices } from './support/seed';
import { startCutProxy, type CutProxy } from './support/cut-proxy';
import { generateEmailOtp, generateEmailOtpForUser, hasSupabase, uniqueEmail } from './support/supabase';

test.skip(({ browserName }) => browserName !== 'chromium', 'service worker: Chromium saja');

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
  // SW mengambil alih halaman ini (clientsClaim).
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
}

async function goOffline(context: BrowserContext) {
  await proxy.cut();
  await context.setOffline(true);
}

test('tanpa sesi: /masuk dan shell tab terbuka offline, SW tidak menyimpan Supabase', async ({ page, context }) => {
  await page.goto(`${proxy.url}/masuk`);
  await waitForShellCache(page);

  const cached = await page.evaluate(async () => {
    const urls: string[] = [];
    for (const name of await caches.keys())
      for (const req of await (await caches.open(name)).keys()) urls.push(req.url);
    return urls;
  });
  for (const p of ['/', '/cari', '/produk', '/unggahan', '/belanja', '/saya', '/masuk', '/offline']) {
    expect(cached, p).toContain(`${proxy.url}${p}`);
  }
  expect(cached.filter((u) => /\/(rest|storage|auth)\/v1\/|\/api\//.test(u))).toEqual([]);

  await goOffline(context);
  // Tab (app) dari cache; tanpa sesi → "Masuk butuh sinyal", tanpa dialihkan.
  await page.goto(`${proxy.url}/belanja`);
  await expect(page.getByRole('navigation', { name: 'Navigasi utama' })).toBeVisible();
  await expect(page.getByText('Masuk butuh sinyal. Coba lagi saat online.')).toBeVisible();
  await expect(page).toHaveURL(/\/belanja$/);

  await page.goto(`${proxy.url}/masuk`);
  await expect(page.getByRole('heading', { name: 'Masuk ke PriceAtlas' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Kirim kode' })).toBeDisabled();

  // Route yang tidak ada di cache → /offline.
  await page.goto(`${proxy.url}/produk/ukuran?group=1`);
  await expect(page.getByRole('heading', { name: 'Halaman ini butuh sinyal' })).toBeVisible();
});

test('setelah login: shell (app) terbuka offline dengan strip offline', async ({ page, context }) => {
  test.skip(!hasSupabase(), 'butuh Supabase lokal (job CI supabase-e2e)');
  const email = uniqueEmail('offline');
  await page.goto(`${proxy.url}/masuk`);
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Kirim kode' }).click();
  // Tunggu signInWithOtp selesai (user dibuat) sebelum generateLink, supaya tidak berlomba.
  await expect(page.getByRole('heading', { name: 'Masukkan kode' })).toBeVisible();
  await page.getByLabel('Kode 6 angka').fill(await generateEmailOtp(email));
  await page.getByRole('button', { name: 'Masuk' }).click();
  await skipOnboarding(page);
  await expect(page.getByRole('heading', { name: 'Cari harga' })).toBeVisible();
  await page.getByRole('link', { name: 'Saya' }).click();
  await expect(page.getByTestId('signed-in-as')).toContainText(email);
  await waitForShellCache(page);

  await goOffline(context);
  for (const [path, heading] of [
    ['/unggahan', 'Unggahan'],
    ['/belanja', 'Sesi belanja'],
    ['/', 'Cari harga'],
    ['/cari?q=milo', 'Hasil cari'],
    ['/saya', 'Saya'],
  ] as const) {
    await page.goto(`${proxy.url}${path}`);
    await expect(page.getByRole('heading', { name: heading })).toBeVisible();
    await expect(page.getByText('Offline. Foto tetap tersimpan dan diunggah otomatis.')).toBeVisible();
  }
  // R1 dipulihkan dari IndexedDB (persist TanStack Query) walau offline.
  await expect(page.getByTestId('signed-in-as')).toContainText(email);
});

test('M7: cache produk R5 → cari dan detail ringkas saat offline (D-60, §5.6)', async ({ page, context }) => {
  test.skip(!hasSupabase(), 'butuh Supabase lokal (job CI supabase-e2e)');
  test.setTimeout(150_000);
  const email = uniqueEmail('offline-r5');
  await page.goto(`${proxy.url}/masuk`);
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Kirim kode' }).click();
  await expect(page.getByRole('heading', { name: 'Masukkan kode' })).toBeVisible();
  const { otp, userId } = await generateEmailOtpForUser(email);
  // Ringkasan siap sebelum login, supaya R5 pertama (setelah login) memuat 50 teratas.
  await seedMiloPrices(userId);
  await page.getByLabel('Kode 6 angka').fill(otp);
  await page.getByRole('button', { name: 'Masuk' }).click();
  await skipOnboarding(page);
  await expect(page.getByRole('heading', { name: 'Cari harga' })).toBeVisible();
  await waitForShellCache(page);

  // R5 tersimpan di IndexedDB user (store offline_cards), tidak di Cache Storage (P-14).
  await expect
    .poll(
      () =>
        page.evaluate(
          (name) =>
            new Promise<number>((resolve) => {
              const req = indexedDB.open(name);
              req.onsuccess = () => {
                const db = req.result;
                if (!db.objectStoreNames.contains('offline_cards')) return resolve(0);
                const count = db.transaction('offline_cards').objectStore('offline_cards').count();
                count.onsuccess = () => resolve(count.result);
                count.onerror = () => resolve(0);
              };
              req.onerror = () => resolve(0);
            }),
          `priceatlas:${userId}`,
        ),
      { timeout: 20_000 },
    )
    .toBeGreaterThanOrEqual(2);

  await goOffline(context);
  // "original" belum pernah dicari online (tidak ada R3 tersimpan) → dicari di kartu R5.
  await page.goto(`${proxy.url}/cari?q=original`);
  await expect(page.getByText(/2 produk untuk "original" · data tersimpan, mungkin tidak terbaru/)).toBeVisible();
  const card200 = page.getByRole('article', { name: /Milo Original\s+200 g/ });
  await expect(card200).toContainText('Rp18.000');
  await expect(card200).toContainText('PROMO');
  await page.goto(`${proxy.url}/cari?q=indomie`);
  await expect(
    page.getByText('Tidak ada "indomie" di data yang tersimpan di HP. Coba lagi saat ada sinyal.'),
  ).toBeVisible();

  // S-03 belum pernah dibuka (R7 tidak tersimpan): ringkasan kartu saja.
  await page.goto(`${proxy.url}/produk?id=${P.milo200}`);
  await expect(page.getByRole('heading', { level: 1, name: /Milo Original/ })).toBeVisible();
  await expect(page.getByText('Detail lengkap butuh sinyal.')).toBeVisible();
  await expect(page.getByTestId('product-card')).toContainText('Rp18.000');
});
