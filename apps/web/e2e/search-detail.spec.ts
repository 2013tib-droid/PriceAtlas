// M1 kriteria selesai (docs/07 §12, §11.3): alur 1 (Cari) dan alur 2 (Detail) terhadap Supabase
// lokal, menjawab 6 pertanyaan inti (wireframe §8.1). Data harga: e2e/support/seed.ts.
import { expect, test, type Page } from '@playwright/test';
import { skipOnboarding } from './support/auth';
import { seedMiloPrices } from './support/seed';
import { generateEmailOtpForUser, hasSupabase, uniqueEmail } from './support/supabase';

test.skip(!hasSupabase(), 'butuh Supabase lokal (job CI supabase-e2e)');

async function loginWithPrices(page: Page, tag: string) {
  const email = uniqueEmail(tag);
  await page.goto('/');
  await expect(page).toHaveURL(/\/masuk/);
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Kirim kode' }).click();
  await expect(page.getByRole('heading', { name: 'Masukkan kode' })).toBeVisible();
  const { otp, userId } = await generateEmailOtpForUser(email);
  await seedMiloPrices(userId);
  await page.getByLabel('Kode 6 angka').fill(otp);
  await page.getByRole('button', { name: 'Masuk' }).click();
  await skipOnboarding(page);
  await expect(page.getByRole('heading', { name: 'Cari harga' })).toBeVisible();
}

async function typePrice(page: Page, digits: string) {
  const clear = page.getByRole('button', { name: 'Kosongkan' });
  if (await clear.isEnabled()) await clear.click();
  for (const d of digits) await page.getByRole('button', { name: d, exact: true }).click();
}

test('alur 1–2: cari "milo" → kartu → detail → cek harga rak → ukuran → lebih hemat', async ({ page }, info) => {
  test.setTimeout(150_000);
  await loginWithPrices(page, `m1-${info.project.name}`);

  // S-01: harga baru masuk (REST price_record_view) tampil, bukan keadaan kosong.
  await expect(page.getByRole('heading', { name: 'Harga baru masuk' })).toBeVisible();

  // Alur 1 — S-02 lewat SearchDock (U-02).
  await page.getByRole('searchbox', { name: 'Cari produk' }).fill('milo');
  await expect(page).toHaveURL(/\/cari\?q=milo$/);
  const card200 = page.getByRole('article', { name: /Milo Original\s+200 g/ });
  // Q1 harga termurah (90 hari + label) · Q2 toko & cabang · Q3 tren · Q4 per gram · D-15 jumlah data.
  await expect(card200).toContainText('Rp18.000');
  await expect(card200).toContainText('PROMO');
  await expect(card200).toContainText('Rp90/g');
  await expect(card200).toContainText('Alfamart · cabang tidak diketahui');
  await expect(card200).toContainText(/↓ turun \d+% vs 30 hari sebelumnya/);
  await expect(card200).toContainText('5 data · terakhir 3 hari lalu');
  await expect(card200).toContainText('Termurah sepanjang masa');
  const card500 = page.getByRole('article', { name: /Milo Original\s+500 g/ });
  await expect(card500).toContainText('Tren: data belum cukup');
  await expect(card500).toContainText('1 data · terakhir 5 hari lalu');
  // Q5 ukuran mana lebih hemat: header group (U-03).
  await expect(page.getByText('Paling hemat per gram: 200 g (Rp90/g)')).toBeVisible();
  await expect(page.getByText(/^Tanya: milo/)).toBeVisible();

  // Alur 2 — S-03.
  await card200.getByRole('link', { name: 'Milo Original 200 g', exact: true }).click();
  await expect(page).toHaveURL(/\/produk\?id=70000000-0000-0000-0000-000000000200$/);
  await expect(page.getByRole('heading', { level: 1, name: /Milo Original\s+200 g/ })).toBeVisible();
  await expect(page.getByTestId('summary')).toContainText('Rp18.000');
  await expect(page.getByTestId('price-chart')).toBeVisible();
  await page.getByText('Hanya harga normal').click();
  await expect(page.getByTestId('price-chart')).toBeVisible();
  // Q6 lebih hemat di mana: 3 toko teratas.
  const top = page.getByRole('region', { name: 'Lebih hemat di mana' }).getByTestId('store-rank-row');
  await expect(top.first()).toContainText('Alfamart · cabang tidak diketahui');
  await expect(top).toHaveCount(2);
  await expect(page.getByTestId('history-row')).toHaveCount(5);

  // S-03b Cek harga rak (D-55): lebih murah / mendekati / lebih mahal.
  await page.getByRole('button', { name: 'Cek harga rak' }).click();
  await expect(page).toHaveURL(/sheet=cek-harga/);
  const dialog = page.getByRole('dialog', { name: 'Cek harga rak' });
  await typePrice(page, '17000');
  await expect(dialog.getByTestId('shelf-result')).toContainText(
    'Lebih murah dari semua harga di historimu 90 hari terakhir.',
  );
  await typePrice(page, '18500');
  await expect(dialog.getByTestId('shelf-result')).toContainText('Mendekati harga terbaikmu.');
  await typePrice(page, '25000');
  await expect(dialog.getByTestId('shelf-result')).toContainText('39% lebih mahal dari termurahmu 90 hari');
  await expect(dialog.getByTestId('shelf-result')).toContainText('Ukuran 500 g di historimu');
  await page.keyboard.press('Escape');
  await expect(page).not.toHaveURL(/sheet=cek-harga/);

  // S-04 Bandingkan ukuran.
  await page
    .getByRole('region', { name: 'Ukuran lain di group ini' })
    .getByRole('link', { name: 'Bandingkan' })
    .click();
  await expect(page.getByRole('heading', { name: 'Bandingkan ukuran' })).toBeVisible();
  const sizes = page.getByTestId('size-row');
  await expect(sizes.first()).toContainText('200 g');
  await expect(sizes.first()).toContainText('paling hemat');
  await expect(sizes.nth(1)).toContainText('500 g');
  await expect(sizes.nth(1)).toContainText('+6%');
  await expect(page.getByText(/Tidak dibandingkan: satuan berbeda/)).toBeVisible();
  await page.getByText('Sepanjang masa').click();
  await expect(page).toHaveURL(/jendela=semua/);

  // S-05 Lebih hemat di mana (lengkap) dari S-03.
  await page.goBack();
  await expect(page.getByRole('heading', { level: 1, name: /Milo Original\s+200 g/ })).toBeVisible();
  await page.getByRole('region', { name: 'Lebih hemat di mana' }).getByRole('link', { name: 'Lihat semua' }).click();
  await expect(page.getByRole('heading', { name: 'Lebih hemat di mana' })).toBeVisible();
  const rows = page.getByTestId('store-rank-row');
  await expect(rows.first()).toContainText('termurah Rp90/g');
  await expect(rows.nth(1)).toContainText('AEON · AEON BSD');
  await page.getByText('Semua ukuran').click();
  await expect(page).toHaveURL(/lingkup=group/);
  await expect(rows.first()).toBeVisible();
  // Tap baris (mode produk) → S-03 dengan histori difilter ke toko itu.
  await page.getByText('Produk ini').click();
  await rows.nth(1).click();
  await expect(page).toHaveURL(/toko=20000000-0000-0000-0000-000000000001/);
  await expect(page.getByText('Hanya AEON')).toBeVisible();
  await expect(page.getByTestId('history-row')).toHaveCount(4);

  // S-01 "Baru dicek" dan "Pencarian terakhir" (prefs IndexedDB).
  await page.getByRole('link', { name: 'Cari' }).click();
  await expect(page.getByRole('heading', { name: 'Baru dicek' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'milo', exact: true })).toBeVisible();
});
