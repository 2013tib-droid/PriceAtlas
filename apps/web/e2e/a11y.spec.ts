// M7 kriteria selesai (docs/07 §12): axe tanpa pelanggaran serius di browser sungguhan (termasuk
// kontras warna yang tidak bisa dihitung di jsdom), PWA bisa dipasang (pengganti audit "Lighthouse
// PWA installable", F-95), dan S-20 Tanya kerangka dari baris "Tanya: …" di S-02 (§9).
import AxeBuilder from '@axe-core/playwright';
import { devices, expect, test, type Page } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { skipOnboarding } from './support/auth';
import { P, seedMiloPrices } from './support/seed';
import { generateEmailOtpForUser, hasSupabase, uniqueEmail } from './support/supabase';

const SERIOUS = new Set(['serious', 'critical']);

async function seriousViolations(page: Page): Promise<string[]> {
  // Hanya WCAG A/AA (target §10.1); aturan best-practice tidak menggagalkan.
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  return results.violations
    .filter((v) => SERIOUS.has(v.impact ?? ''))
    .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`);
}

/** Tunggu sampai skeleton/memuat selesai supaya axe memeriksa isi layar, bukan kerangka. */
async function settled(page: Page) {
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0, { timeout: 15_000 });
}

test('tanpa sesi: S-00a dan /offline tanpa pelanggaran serius', async ({ page }) => {
  await page.goto('/masuk');
  await expect(page.getByRole('heading', { name: 'Masuk ke PriceAtlas' })).toBeVisible();
  expect(await seriousViolations(page)).toEqual([]);
  await page.goto('/offline');
  await expect(page.getByRole('heading', { name: 'Halaman ini butuh sinyal' })).toBeVisible();
  expect(await seriousViolations(page)).toEqual([]);
});

test('PWA bisa dipasang: manifest + service worker tanpa installability error', async ({
  playwright,
  browserName,
  baseURL,
}) => {
  test.skip(browserName !== 'chromium', 'Page.getInstallabilityErrors hanya di Chromium (CDP)');
  // Konteks biasa Playwright = mode penyamaran ("in-incognito"); profil persisten seperti browser user.
  const dir = mkdtempSync(join(tmpdir(), 'pa-install-'));
  const context = await playwright.chromium.launchPersistentContext(dir, {
    ...devices['Pixel 7'],
    baseURL,
    ...(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {}),
  });
  try {
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto('/masuk');
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
    const manifest = await (await page.request.get('/manifest.webmanifest')).json();
    expect(manifest).toMatchObject({ display: 'standalone', start_url: '/', scope: '/', lang: 'id' });
    const cdp = await context.newCDPSession(page);
    await expect
      .poll(async () => (await cdp.send('Page.getInstallabilityErrors')).installabilityErrors.map((e) => e.errorId), {
        timeout: 20_000,
      })
      .toEqual([]);
  } finally {
    await context.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('setelah login: layar utama tanpa pelanggaran serius; S-02 → S-20 Tanya', async ({ page }, info) => {
  test.skip(!hasSupabase(), 'butuh Supabase lokal (job CI supabase-e2e)');
  test.setTimeout(240_000);
  const email = uniqueEmail(`a11y-${info.project.name}`);
  await page.goto('/masuk');
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Kirim kode' }).click();
  await expect(page.getByRole('heading', { name: 'Masukkan kode' })).toBeVisible();
  const { otp, userId } = await generateEmailOtpForUser(email);
  await seedMiloPrices(userId);
  await page.getByLabel('Kode 6 angka').fill(otp);
  await page.getByRole('button', { name: 'Masuk' }).click();
  // S-00b sebelum dilewati.
  await expect(page.getByRole('button', { name: 'Lewati' })).toBeVisible();
  expect(await seriousViolations(page), '/selamat-datang').toEqual([]);
  await skipOnboarding(page);
  await expect(page.getByRole('heading', { name: 'Cari harga' })).toBeVisible();

  const group = '60000000-0000-0000-0000-000000000001';
  for (const [path, heading] of [
    ['/', 'Cari harga'],
    ['/cari?q=milo', /Milo Original\s+200 g/],
    [`/produk?id=${P.milo200}`, /Milo Original/],
    [`/produk?id=${P.milo200}&sheet=cek-harga`, 'Cek harga rak'],
    [`/produk/ukuran?group=${group}`, /Bandingkan ukuran/],
    [`/produk/hemat?id=${P.milo200}`, /Lebih hemat di mana/],
    ['/unggahan', 'Unggahan'],
    ['/belanja', 'Sesi belanja'],
    ['/lokasi?mode=sesi', 'Kamu belanja di mana?'],
    ['/produk/baru', 'Produk baru'],
    ['/saya', 'Saya'],
    ['/saya/member', 'Program member'],
    ['/saya/berbagi', /Berbagi harga/],
    ['/saya/privasi', /Privasi/],
    ['/tanya?q=milo', 'Tanya'],
  ] as const) {
    await page.goto(path);
    await expect(page.getByRole('heading', { name: heading }).first()).toBeVisible();
    await settled(page);
    expect(await seriousViolations(page), path).toEqual([]);
  }

  // S-02 → baris "Tanya: milo" → S-20 (kerangka; kirim nonaktif sampai Tahap 6, D-57).
  await page.goto('/cari?q=milo');
  await page.getByRole('link', { name: /Tanya: milo/ }).click();
  await expect(page).toHaveURL(/\/tanya\?q=milo$/);
  await expect(page.getByRole('heading', { name: 'Tanya', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Lihat hasil cari "milo"' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Kirim' })).toBeDisabled();
  await page.getByRole('button', { name: 'harga per gram?' }).click();
  await expect(page.getByLabel('Pertanyaan', { exact: true })).toHaveValue('milo harga per gram?');
});
