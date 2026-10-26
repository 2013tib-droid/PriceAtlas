// Login OTP di UI untuk e2e (docs/07 §11.2): kode diambil lewat admin generateLink (proses test,
// service role), lalu diketik di S-00a.
import { expect, type Page } from '@playwright/test';
import { generateEmailOtpForUser, uniqueEmail } from './supabase';

export async function login(page: Page, tag: string, base = ''): Promise<{ email: string; userId: string }> {
  const email = uniqueEmail(tag);
  await page.goto(`${base}/masuk`);
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Kirim kode' }).click();
  // Tunggu signInWithOtp selesai (user dibuat) sebelum generateLink, supaya tidak berlomba.
  await expect(page.getByRole('heading', { name: 'Masukkan kode' })).toBeVisible();
  const { otp, userId } = await generateEmailOtpForUser(email);
  await page.getByLabel('Kode 6 angka').fill(otp);
  await page.getByRole('button', { name: 'Masuk' }).click();
  await skipOnboarding(page);
  await expect(page.getByRole('heading', { name: 'Cari harga' })).toBeVisible();
  return { email, userId };
}

/** User baru selalu melihat S-00b sekali per perangkat (M6); alur selain 8 langsung "Lewati". */
export async function skipOnboarding(page: Page): Promise<void> {
  await expect(page.getByRole('heading', { name: WELCOME_HEADING })).toBeVisible();
  await page.getByRole('button', { name: 'Lewati' }).click();
}

export const WELCOME_HEADING = 'Murah atau mahal? Cek dulu sebelum beli.';
