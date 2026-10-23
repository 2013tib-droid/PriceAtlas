// M5 kriteria selesai (docs/07 §12, §11.3 alur 6), terhadap Supabase lokal + worker stub (job CI
// supabase-e2e):
//   6a: S-03 baris histori → S-16 → ubah harga observasi (W6) → ringkasan diperbarui (pg_cron) dan
//       harga terbaik baru di S-03; STALE_WRITE "dua tab" = dua page dalam context yang sama (sesi
//       login sama): tab kedua menyimpan dulu, tab pertama mendapat STALE_WRITE → versi terbaru dimuat,
//       perubahan yang masih berlaku ditampilkan lagi → simpan ulang. RPC tidak diubah.
//   6b: record struk (struk-aeon dikonfirmasi lewat S-10) → baris S-10 mode tersimpan → S-16 → angka
//       terkunci → "Ubah baris struk" (W7) → record dibentuk ulang + riwayat "mengubah baris struk".
//   6c: merge produk privat → produk katalog (S-17, R19 + W10) dan split sederhana (S-18: produk baru
//       lewat W8 = T1, centang, W9 = T2).
// Data tambahan lewat helper test (service role, sisi test saja): e2e/support/seed.ts, catalog.ts.
import { expect, test, type Page } from '@playwright/test';
import { login } from './support/auth';
import { capturesOf, fixture, householdOf } from './support/captures';
import { recordsOf, seedPrivateProduct } from './support/catalog';
import { P, seedMiloPrices } from './support/seed';
import { hasSupabase } from './support/supabase';

test.skip(!hasSupabase(), 'butuh Supabase lokal + worker (job CI supabase-e2e)');

async function openFirstHistoryRecord(page: Page, productId: string) {
  await page.goto(`/produk?id=${productId}`);
  const row = page.getByTestId('history-row').first();
  await expect(row).toBeVisible({ timeout: 20_000 });
  await row.getByRole('link').click();
  await expect(page).toHaveURL(/\/harga\?id=/);
  await expect(page.getByRole('heading', { level: 1, name: 'Detail harga' })).toBeVisible();
}

test('alur 6a: S-16 ubah harga observasi → ringkasan diperbarui; STALE_WRITE dua tab', async ({ page }, info) => {
  test.setTimeout(180_000);
  const { userId } = await login(page, `m5-a6a-${info.project.name}`);
  await seedMiloPrices(userId);

  // Baris histori terbaru Milo 200 g (AEON BSD, Rp19.500) → S-16.
  await openFirstHistoryRecord(page, P.milo200);
  await expect(page.getByTestId('record-screen')).toHaveAttribute('data-source', 'price_label');
  await expect(page.getByLabel('Harga normal')).toHaveValue('19500');
  const url = page.url();

  // Tab kedua (sesi sama) membuka record yang sama dan menyimpan lebih dulu.
  const tab2 = await page.context().newPage();
  await tab2.goto(url);
  await expect(tab2.getByLabel('Harga normal')).toHaveValue('19500');
  await tab2.getByLabel('Harga normal').fill('17000');
  await tab2.getByTestId('save-record').click();
  await expect(tab2.getByText('Perubahan tersimpan.')).toBeVisible();
  await expect(tab2.getByTestId('summary-updating').getByRole('status')).toHaveText('Ringkasan sudah diperbarui.', {
    timeout: 45_000,
  });
  await expect(tab2.getByTestId('history')).toContainText('harga normal: Rp19.500 → Rp17.000');
  await tab2.close();

  // Tab pertama masih memegang versi lama → STALE_WRITE → muat ulang + catatan tetap.
  await page.getByLabel('Catatan').fill('rak promo');
  await page.getByTestId('save-record').click();
  await expect(page.getByTestId('record-error')).toContainText('baru saja berubah di tempat lain');
  await expect(page.getByTestId('conflict-notice')).toContainText('catatan');
  await expect(page.getByLabel('Harga normal')).toHaveValue('17000');
  await expect(page.getByLabel('Catatan')).toHaveValue('rak promo');
  await page.getByTestId('save-record').click();
  await expect(page.getByText('Perubahan tersimpan.')).toBeVisible();
  await expect(page.getByTestId('record-error')).toBeHidden();

  // S-03: harga terbaik 90 hari sekarang Rp17.000 (lebih murah dari promo Rp18.000).
  await page.goto(`/produk?id=${P.milo200}`);
  await expect(page.getByTestId('summary')).toContainText('Rp17.000', { timeout: 30_000 });
});

test('alur 6b: record struk → S-16 angka terkunci → editor baris (W7) → record dibentuk ulang', async ({
  page,
}, info) => {
  test.setTimeout(240_000);
  const { userId } = await login(page, `m5-a6b-${info.project.name}`);
  const hh = await householdOf(userId);

  // struk-aeon → perlu dicek → S-10: Benar (Indomie) + Bukan produk (SNACK) → Simpan.
  await page.goto('/kamera?jenis=struk');
  await page.getByTestId('input-gallery').setInputFiles(fixture('struk-aeon'));
  await expect(page.getByTestId('part')).toHaveCount(1);
  await expect(page.getByTestId('part')).not.toContainText('Menyiapkan');
  await page.getByRole('button', { name: 'Selesai' }).click();
  await expect(page).not.toHaveURL(/\/kamera/, { timeout: 20_000 });
  await expect
    .poll(async () => (await capturesOf(hh)).filter((c) => c.status === 'needs_confirmation').length, {
      timeout: 60_000,
    })
    .toBe(1);
  await page.goto('/unggahan');
  const needs = page.getByRole('region', { name: 'Perlu dicek (1)' });
  await expect(needs).toBeVisible({ timeout: 30_000 });
  await needs.getByRole('link').click();
  await expect(page.getByRole('heading', { level: 1, name: 'Cek struk' })).toBeVisible();
  const line = (t: string) => page.getByTestId('needs-check-line').filter({ hasText: t });
  await line('INDOMIE GRG 85G').getByRole('button', { name: 'Benar' }).click();
  await line('SNACK XYZ').getByRole('button', { name: 'Bukan produk' }).click();
  await page.getByTestId('save-receipt').click();
  await expect(page.getByTestId('receipt-screen')).toHaveAttribute('data-status', 'confirmed');

  // Mode tersimpan: baris Milo di-tap → S-16 (F-52, D-87); editor kecil W7 S-10 tetap ada.
  const milo = page.getByTestId('saved-line').filter({ hasText: 'MILO ORI 500G' });
  await expect(milo.getByRole('button', { name: 'Koreksi' })).toBeVisible();
  await milo.getByTestId('saved-line-link').click();
  await expect(page).toHaveURL(/\/harga\?id=/);
  await expect(page.getByTestId('record-screen')).toHaveAttribute('data-source', 'receipt');
  await expect(page.getByTestId('saved-price')).toContainText('Rp42.500');
  await expect(page.getByLabel('Harga normal')).not.toBeEditable();
  await expect(page.getByTestId('receipt-locked')).toContainText('mengubah baris struk');
  await expect(page.getByRole('link', { name: 'Buka struk (tanggal & toko)' })).toBeVisible();

  // Editor baris struk (W7): total baris 90.000 → 88.000 → harga efektif dibentuk ulang (D-23).
  await page.getByRole('button', { name: 'Ubah baris struk' }).click();
  const dialog = page.getByRole('dialog', { name: 'Koreksi baris' });
  await dialog.getByLabel('Total baris (Rp)').fill('88000');
  await dialog.getByRole('button', { name: 'Simpan koreksi' }).click();
  await expect(page.getByText('Baris diperbarui. Ringkasan menyusul dalam beberapa detik.')).toBeVisible();
  await expect(page.getByTestId('saved-price')).toContainText('Rp41.500');
  await expect(page.getByTestId('history')).toContainText('mengubah baris struk');
  await expect(page.getByTestId('history')).toContainText('total baris: Rp90.000 → Rp88.000');
});

test('alur 6c: merge produk privat → katalog (S-17) dan split sederhana (S-18)', async ({ page }, info) => {
  test.setTimeout(180_000);
  const { userId } = await login(page, `m5-a6c-${info.project.name}`);
  await seedMiloPrices(userId);
  const dup = await seedPrivateProduct(userId, { name: 'Milo 200 gr', size: 200, unit: 'g', price: 19000 });

  // S-17: R19 pratinjau (ukuran sama) → Gabungkan (W10) → produk tujuan + toast.
  await page.goto(`/produk/gabung?id=${dup}&ke=${P.milo200}`);
  await expect(page.getByTestId('merge-counts')).toHaveText('Pindah: 1 harga · 0 alias · 0 barcode');
  await expect(page.getByTestId('merge-pair')).toContainText('(katalog)');
  await page.getByTestId('merge-confirm').click();
  await expect(page).toHaveURL(new RegExp(`/produk\\?id=${P.milo200}`));
  await expect(page.getByText('"Milo 200 gr" digabung ke Milo Original.')).toBeVisible();
  await expect.poll(async () => (await recordsOf(userId, dup)).length).toBe(0);

  // S-18: Milo 500 g (katalog, 1 harga) → produk baru (W8, T1) → centang → konfirmasi → W9 (T2).
  await page.goto(`/produk/pisah?id=${P.milo500}`);
  await expect(page.getByText('Produk katalog umum: hanya data harga milikmu yang dipindah.')).toBeVisible();
  await page.getByTestId('split-create').click();
  await expect(page.getByLabel('Nama')).toHaveValue('Milo Original');
  await page.getByLabel('Nama').fill('Milo Original Rak Bawah');
  await page.getByRole('button', { name: 'Simpan produk' }).click();
  await expect(page.getByTestId('split-screen')).toHaveAttribute('data-step', '2');
  await expect(page.getByTestId('split-records').getByRole('checkbox')).toHaveCount(1);
  await page.getByRole('button', { name: 'Centang semua yang tampil' }).click();
  await expect(page.getByTestId('split-count')).toHaveText('1 dicentang');
  await page.getByTestId('split-next').click();
  await page.getByTestId('split-next').click();
  await expect(page.getByTestId('split-summary')).toContainText('Pindahkan 1 harga dari "Milo Original 500 g"');
  await page.getByTestId('split-move').click();
  await expect(page.getByText(/^1 harga dipindahkan ke Milo Original Rak Bawah/)).toBeVisible();
  await expect(page).toHaveURL(/\/produk\?id=/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Milo Original Rak Bawah');
  await expect(page.getByTestId('history-row')).toHaveCount(1, { timeout: 20_000 });
  await expect.poll(async () => (await recordsOf(userId, P.milo500)).length).toBe(0);
});
