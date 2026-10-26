// M6 kriteria selesai (docs/07 §12, §11.3): alur 7 (Pengaturan) dan alur 8 (Onboarding) terhadap
// Supabase lokal + worker stub (job CI supabase-e2e).
//   7: label-milo di sesi AEON BSD → S-11 harga member "tidak dihitung" → S-19 → S-19b member AEON on
//      (W16) → S-11 "Dihitung untukmu" memakai harga member; S-19c berbagi on → data lama (W15) → off
//      (konfirmasi, W14); Privasi: login ulang OTP + ketik HAPUS AKUN + tekan dua kali → route hapus
//      akun → /masuk, user Auth hilang, household diarsipkan, data lokal dihapus.
//   8: login OTP pertama → S-00b → Mulai → S-00c pilih AEON Member → Simpan & lanjut → S-01 kosong;
//      S-00b tidak tampil lagi di perangkat yang sama.
import { expect, test, type Page } from '@playwright/test';
import { login, WELCOME_HEADING } from './support/auth';
import { fixture, householdOf } from './support/captures';
import { admin, generateEmailOtpForUser, hasSupabase, uniqueEmail } from './support/supabase';

test.skip(!hasSupabase(), 'butuh Supabase lokal + worker (job CI supabase-e2e)');

const AEON_MEMBER = '40000000-0000-0000-0000-000000000001';

async function memberships(householdId: string): Promise<string[]> {
  const { data, error } = await admin()
    .from('household_program_membership')
    .select('member_program_id')
    .eq('household_id', householdId);
  if (error) throw error;
  return (data ?? []).map((r) => r.member_program_id as string);
}

async function household(householdId: string) {
  const { data, error } = await admin()
    .from('household')
    .select('share_prices_public,archived_at')
    .eq('id', householdId)
    .single();
  if (error) throw error;
  return data as { share_prices_public: boolean; archived_at: string | null };
}

/** Sesi di AEON BSD → label-milo dari galeri kamera label → S-11 (pola alur 4). */
async function labelInSession(page: Page) {
  await page.goto('/belanja');
  await page.getByRole('link', { name: 'Mulai belanja' }).click();
  await page
    .getByTestId('store-row')
    .filter({ hasText: /^AEON$/ })
    .getByRole('button')
    .click();
  await page.getByTestId('branch-row').filter({ hasText: 'AEON BSD' }).getByRole('button').click();
  await expect(page.getByRole('heading', { level: 1, name: 'Belanja di AEON BSD' })).toBeVisible();
  await page.locator('[data-session-banner]').getByRole('link', { name: 'Foto label' }).click();
  await page.getByTestId('label-gallery').setInputFiles(fixture('label-milo'));
  await expect(page.getByTestId('label-shot').first()).toHaveText('Label 1: tersimpan', { timeout: 20_000 });
  await page.getByRole('button', { name: 'Selesai' }).click();
  const check = page.getByTestId('session-label').filter({ hasText: 'perlu dicek' });
  await expect(check).toBeVisible({ timeout: 60_000 });
  await check.getByRole('link').click();
  await expect(page.getByRole('heading', { level: 1, name: 'Cek label harga' })).toBeVisible();
}

test('alur 7: member on → S-11 computed berubah; berbagi publik on/off; hapus akun (login ulang + teks)', async ({
  page,
}, info) => {
  test.setTimeout(300_000);
  const { email, userId } = await login(page, `m6-a7-${info.project.name}`);
  const hh = await householdOf(userId);

  // S-11: harga member AEON belum dihitung (bukan member, D-27).
  await labelInSession(page);
  const s11 = page.url();
  // Item MILO 3IN1 (member AEON Rp21.000, normal Rp23.000); urutan item tetap (posisi di foto).
  const notCounted = 'Harga member tidak dihitung: kamu belum terdaftar AEON Member.';
  const items = page.getByTestId('observation-item');
  await expect(items.filter({ hasText: notCounted })).toHaveCount(1, { timeout: 20_000 });
  const idx = (await items.allTextContents()).findIndex((t) => t.includes(notCounted));
  const computed = items.nth(idx).getByTestId('computed');
  await expect(computed).toContainText('Rp23.000');

  // S-19 → S-19b: tandai AEON Member (W16).
  await page.getByRole('link', { name: 'Saya', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Saya' })).toBeVisible();
  await expect(page.getByTestId('me-member')).toContainText('Belum ada yang diikuti');
  await page.getByTestId('me-member').click();
  await expect(page.getByRole('heading', { level: 1, name: 'Program member' })).toBeVisible();
  await expect(page.getByTestId('member-intro')).toContainText('tidak mengubah harga yang sudah tercatat');
  const sw = page.getByTestId(`program-${AEON_MEMBER}`).getByRole('switch');
  await sw.click();
  await expect(sw).toHaveAttribute('aria-checked', 'true');
  await expect.poll(() => memberships(hh)).toEqual([AEON_MEMBER]);

  // Kembali ke S-11: "Dihitung untukmu" sekarang harga member (R16 computed live, D-26).
  await page.goto(s11);
  await expect(computed).toContainText('Rp21.000', { timeout: 20_000 });
  await expect(computed).not.toContainText('tidak dihitung');

  // S-19c: nyalakan → data lama (W15) → matikan dengan konfirmasi (W14 tarik).
  await page.goto('/saya');
  await expect(page.getByTestId('me-member')).toContainText('1 diikuti: AEON Member');
  await expect(page.getByTestId('me-share')).toContainText('Mati');
  await page.getByTestId('me-share').click();
  const share = page.getByRole('switch', { name: /Bagikan harga secara anonim/ });
  await expect(share).toHaveAttribute('aria-checked', 'false');
  await share.click();
  await expect(share).toHaveAttribute('aria-checked', 'true');
  await expect.poll(async () => (await household(hh)).share_prices_public).toBe(true);
  await page.getByTestId('share-existing').click();
  await expect(page.getByTestId('share-queued')).toBeVisible();
  await share.click();
  const dialog = page.getByRole('dialog', { name: 'Matikan berbagi?' });
  await expect(dialog).toContainText('Harga yang sudah dibagikan akan ditarik dari data publik.');
  await dialog.getByRole('button', { name: 'Matikan' }).click();
  await expect(share).toHaveAttribute('aria-checked', 'false');
  await expect.poll(async () => (await household(hh)).share_prices_public).toBe(false);

  // Privasi & hapus akun (D-76): login ulang OTP → HAPUS AKUN → tekan dua kali.
  await page.goto('/saya');
  await page.getByTestId('me-privacy').click();
  await expect(page.getByRole('heading', { level: 1, name: 'Privasi & data' })).toBeVisible();
  await expect(page.getByText('Foto struk dihapus otomatis setelah 12 bulan.')).toBeVisible();
  await page.getByRole('button', { name: 'Kirim kode' }).click();
  await expect(page.getByLabel('Kode 6 angka')).toBeVisible();
  const { otp } = await generateEmailOtpForUser(email);
  await page.getByLabel('Kode 6 angka').fill(otp);
  await page.getByRole('button', { name: 'Periksa kode' }).click();
  await page.getByLabel('Ketik HAPUS AKUN').fill('HAPUS AKUN');
  const del = page.getByTestId('delete-account');
  await del.click();
  await expect(del).toHaveAttribute('data-armed', 'true');
  await del.click();
  await expect(page).toHaveURL(/\/masuk/, { timeout: 30_000 });
  await expect(page.getByText('Akun dihapus. Data dihapus bertahap di latar belakang.')).toBeVisible();

  // Server: user Auth hilang, household diarsipkan (job delete_household menyusul, docs/05 §7.6).
  const { data: gone } = await admin().auth.admin.getUserById(userId);
  expect(gone.user).toBeNull();
  expect((await household(hh)).archived_at).not.toBeNull();
  // Klien: IndexedDB user dihapus (Q-61, P-13); halaman (app) kembali dialihkan ke /masuk.
  const dbs = await page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name));
  expect(dbs).not.toContain(`priceatlas:${userId}`);
  await page.goto('/saya');
  await expect(page).toHaveURL(/\/masuk\?next=%2Fsaya$/);
});

test('alur 8: login OTP pertama → S-00b → S-00c → S-01 keadaan kosong', async ({ page }, info) => {
  test.setTimeout(120_000);
  const email = uniqueEmail(`m6-a8-${info.project.name}`);
  await page.goto('/');
  await expect(page).toHaveURL(/\/masuk/);
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Kirim kode' }).click();
  await expect(page.getByRole('heading', { name: 'Masukkan kode' })).toBeVisible();
  const { otp, userId } = await generateEmailOtpForUser(email);
  await page.getByLabel('Kode 6 angka').fill(otp);
  await page.getByRole('button', { name: 'Masuk' }).click();

  // S-00b.
  await expect(page).toHaveURL(/\/selamat-datang$/);
  await expect(page.getByRole('heading', { level: 1, name: WELCOME_HEADING })).toBeVisible();
  await expect(page.getByText('Harga termurah 90 hari terakhir, dan di toko mana')).toBeVisible();
  await page.getByRole('button', { name: 'Mulai' }).click();

  // S-00c: program dihentikan tidak bisa ditandai; pilih AEON Member → Simpan & lanjut (W16).
  await expect(page).toHaveURL(/\/selamat-datang\/member$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Kamu member di mana?' })).toBeVisible();
  await expect(page.getByText('program dihentikan')).toBeVisible();
  await page.getByTestId(`program-${AEON_MEMBER}`).getByRole('switch').click();
  await page.getByRole('button', { name: 'Simpan & lanjut' }).click();

  // S-01 keadaan kosong (U-19).
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('heading', { name: 'Cari harga' })).toBeVisible();
  await expect(page.getByText('Histori harga masih kosong')).toBeVisible();
  await expect(page.getByText('Foto struk belanja terakhirmu')).toBeVisible();
  await expect.poll(async () => memberships(await householdOf(userId))).toEqual([AEON_MEMBER]);

  // Sudah dilihat di perangkat ini (💾): /selamat-datang langsung meneruskan ke beranda.
  await page.goto('/selamat-datang');
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('heading', { name: 'Cari harga' })).toBeVisible();
});
