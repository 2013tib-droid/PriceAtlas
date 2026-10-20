// M0 kriteria selesai: login OTP e2e terhadap Supabase lokal (docs/07 §11.2, §12).
import { expect, test } from '@playwright/test';
import { codeFrom, generateEmailOtp, hasSupabase, latestEmail, uniqueEmail } from './support/supabase';

test.skip(!hasSupabase(), 'butuh Supabase lokal (job CI supabase-e2e)');

test('login OTP: email → kode (generateLink) → R1 → beranda', async ({ page }, info) => {
  const email = uniqueEmail(info.project.name);
  await page.goto('/unggahan');
  // proxy.ts: belum login → /masuk?next=/unggahan
  await expect(page).toHaveURL(/\/masuk\?next=%2Funggahan$/);
  await expect(page.getByRole('heading', { name: 'Masuk ke PriceAtlas' })).toBeVisible();

  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Kirim kode' }).click();
  await expect(page.getByRole('heading', { name: 'Masukkan kode' })).toBeVisible();

  const otp = await generateEmailOtp(email);
  await page.getByLabel('Kode 6 angka').fill(otp);
  await page.getByRole('button', { name: 'Masuk' }).click();

  await expect(page).toHaveURL(/\/unggahan$/);
  await expect(page.getByRole('heading', { name: 'Unggahan' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Navigasi utama' })).toBeVisible();

  // R1 dimuat (household dibuat trigger signup) dan sesi bertahan setelah reload (cookie @supabase/ssr).
  await page.getByRole('link', { name: 'Cari' }).click();
  await expect(page.getByTestId('signed-in-as')).toContainText(email);
  await page.reload();
  await expect(page.getByTestId('signed-in-as')).toContainText(email);

  // Sudah login membuka /masuk → kembali ke beranda.
  await page.goto('/masuk');
  await expect(page).toHaveURL(/\/$/);

  // Keluar → /masuk, dan halaman (app) kembali dialihkan.
  await page.getByRole('link', { name: 'Saya' }).click();
  await page.getByRole('button', { name: 'Keluar' }).click();
  await expect(page).toHaveURL(/\/masuk/);
  await page.goto('/saya');
  await expect(page).toHaveURL(/\/masuk\?next=%2Fsaya$/);
});

test('email OTP berisi kode 6 digit berbahasa Indonesia, tanpa magic link (F-20, Mailpit)', async ({ page }, info) => {
  test.skip(info.project.name !== 'chromium-mobile', 'cukup satu profil');
  const email = uniqueEmail('mailpit');
  await page.goto('/masuk');
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Kirim kode' }).click();
  await expect(page.getByRole('heading', { name: 'Masukkan kode' })).toBeVisible();

  const msg = await latestEmail(email);
  expect(msg.Subject).toMatch(/^Kode masuk PriceAtlas: \d{6}$/);
  expect(msg.HTML).toContain('Ketik kode ini di aplikasi untuk masuk');
  expect(msg.HTML).not.toMatch(/href=|verify\?token|ConfirmationURL/i);
  const otp = codeFrom(msg);

  // Kode salah → pesan; kode dari email → masuk.
  await page.getByLabel('Kode 6 angka').fill(otp === '000000' ? '111111' : '000000');
  await page.getByRole('button', { name: 'Masuk' }).click();
  await expect(page.getByText('Kode salah. Periksa 6 angka di emailmu.')).toBeVisible();
  await page.getByLabel('Kode 6 angka').fill(otp);
  await page.getByRole('button', { name: 'Masuk' }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId('signed-in-as')).toContainText(email);
});
