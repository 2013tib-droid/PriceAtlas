// M3 kriteria selesai (docs/07 §12, §11.3): alur 3 lengkap, 3b (duplikat), 5 (screenshot), terhadap
// Supabase lokal + worker stub (job CI supabase-e2e). Fixture gambar = apps/worker/test/fixtures.
//   3 : galeri struk-aeon → … → perlu dicek → S-10 → Benar / Ganti (S-14) / Bukan produk → Simpan →
//       "N harga baru tersimpan" → harga muncul di S-02/S-03.
//   3b: file yang sama lagi → dialog hash U-10 → "Tetap unggah" → banner duplikat S-10 → buang.
//   5 : screenshot shopee-milo-ragu (confidence harga rendah, Q-78, 6b M4) → perlu dicek pada unggahan
//       PERTAMA → S-11 → ongkir sebagai info → simpan (dulu lewat unggahan duplikat kedua, F-50).
import { expect, test, type Page } from '@playwright/test';
import { login } from './support/auth';
import { capturesOf, fixture, householdOf } from './support/captures';
import { hasSupabase } from './support/supabase';

test.skip(!hasSupabase(), 'butuh Supabase lokal + worker (job CI supabase-e2e)');

/** S-07 dari URL langsung: satu gambar galeri → Selesai. Mengembalikan dialog duplikat jika muncul. */
async function upload(page: Page, jenis: 'struk' | 'screenshot', name: string, expectDuplicate = false) {
  await page.goto(`/kamera?jenis=${jenis}`);
  await page.getByTestId('input-gallery').setInputFiles(fixture(name));
  await expect(page.getByTestId('part')).toHaveCount(1);
  await expect(page.getByTestId('part')).not.toContainText('Menyiapkan');
  await page.getByRole('button', { name: 'Selesai' }).click();
  if (expectDuplicate) {
    const dialog = page.getByRole('dialog', { name: 'Foto ini sudah pernah diunggah' });
    await expect(dialog).toBeVisible();
    return dialog;
  }
  // Tunggu tersimpan (meninggalkan /kamera) sebelum navigasi berikutnya (pelajaran M2).
  await expect(page).not.toHaveURL(/\/kamera/, { timeout: 20_000 });
  return null;
}

async function waitStatus(householdId: string, n: number, status: string) {
  await expect
    .poll(async () => (await capturesOf(householdId)).filter((c) => c.status === status).length, { timeout: 60_000 })
    .toBe(n);
}

test('alur 3: struk-aeon → perlu dicek → S-10 Benar / Ganti (S-14) / Bukan produk → Simpan → S-02/S-03', async ({
  page,
}, info) => {
  test.setTimeout(180_000);
  const { userId } = await login(page, `m3-a3-${info.project.name}`);
  const hh = await householdOf(userId);
  await upload(page, 'struk', 'struk-aeon');
  await waitStatus(hh, 1, 'needs_confirmation');

  // S-08 "Perlu dicek" langsung ke S-10.
  await page.goto('/unggahan');
  const needs = page.getByRole('region', { name: 'Perlu dicek (1)' });
  await expect(needs).toBeVisible({ timeout: 30_000 });
  await needs.getByRole('link').click();
  await expect(page).toHaveURL(/\/struk\?id=/);
  await expect(page.getByRole('heading', { level: 1, name: 'Cek struk' })).toBeVisible();
  await expect(page.getByTestId('receipt-header')).toContainText('AEON · AEON BSD');
  await expect(page.getByTestId('totals-check')).toContainText('✓');
  await expect(page.getByRole('heading', { name: 'Perlu dicek (2)' })).toBeVisible();
  await expect(page.getByTestId('member-hint')).toContainText('Kamu member AEON?');
  const [indomie, snack] = [
    page.getByTestId('needs-check-line').filter({ hasText: 'INDOMIE GRG 85G' }),
    page.getByTestId('needs-check-line').filter({ hasText: 'SNACK XYZ' }),
  ];

  // Benar (alias baru, U-12).
  await indomie.getByRole('button', { name: 'Benar' }).click();
  await expect(indomie.getByTestId('alias-learned')).toHaveText(
    "Selanjutnya 'INDOMIE GRG 85G' di AEON dikenali otomatis.",
  );

  // Ganti → S-14 (lapisan ?pilih=produk) → cari → pilih.
  await snack.getByRole('button', { name: 'Ganti produk' }).click();
  await expect(page).toHaveURL(/pilih=produk&untuk=line/);
  const picker = page.getByTestId('product-picker');
  await expect(picker).toBeVisible();
  await expect(page.getByLabel('Cari produk')).toHaveValue('SNACK XYZ');
  await page.getByLabel('Cari produk').fill('milo');
  await picker.getByTestId('pick-result').filter({ hasText: 'Milo 3in1' }).getByRole('button').click();
  await expect(picker).toBeHidden();
  await expect(page).not.toHaveURL(/pilih=produk/);
  await expect(snack.getByTestId('line-decided')).toContainText('Diganti: Milo 3in1');

  // Ubah pilihan → Bukan produk.
  await snack.getByRole('button', { name: 'Ubah pilihan' }).click();
  await snack.getByRole('button', { name: 'Bukan produk' }).click();
  await expect(snack.getByTestId('line-decided')).toContainText('Bukan produk');

  // Simpan → W4 → toast + SummaryUpdating.
  await expect(page.getByTestId('save-receipt')).toHaveText('Simpan 2 harga');
  await page.getByTestId('save-receipt').click();
  await expect(page.getByText('2 harga baru tersimpan')).toBeVisible();
  await expect(page.getByTestId('receipt-screen')).toHaveAttribute('data-status', 'confirmed');
  await expect(page.getByTestId('summary-updating').getByRole('status')).toHaveText('Ringkasan sudah diperbarui.', {
    timeout: 45_000,
  });
  await expect.poll(async () => (await capturesOf(hh))[0]?.status).toBe('done');

  // Harga muncul di S-02 dan S-03.
  await page.goto('/cari?q=indomie');
  const card = page.getByTestId('product-card').filter({ hasText: 'Indomie Goreng' });
  await expect(card).toContainText('Rp3.500');
  await expect(card).toContainText('AEON · AEON BSD');
  await card.getByRole('link', { name: /^Indomie Goreng/ }).click();
  await expect(page).toHaveURL(/\/produk\?id=/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Indomie Goreng');
  await expect(page.getByText('Rp3.500').first()).toBeVisible();

  // Mode tersimpan dari S-09 "Lihat struk".
  const [cap] = await capturesOf(hh);
  await page.goto(`/unggahan/detail?id=${cap!.id}`);
  await page.getByRole('link', { name: 'Lihat struk' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Struk' })).toBeVisible();
  await expect(page.getByTestId('needs-check-line')).toHaveCount(0);
  await expect(page.getByTestId('saved-line')).toHaveCount(2);
});

test('alur 3b: struk yang sama lagi → dialog hash U-10 → Tetap unggah → banner duplikat S-10 → buang', async ({
  page,
}, info) => {
  test.setTimeout(180_000);
  const { userId } = await login(page, `m3-a3b-${info.project.name}`);
  const hh = await householdOf(userId);
  await upload(page, 'struk', 'struk-aeon');
  await waitStatus(hh, 1, 'needs_confirmation');
  // R13 di cache (S-08) → dialog menyebut toko (Q-74, D-86).
  await page.goto('/unggahan');
  await expect(page.getByRole('region', { name: 'Perlu dicek (1)' })).toBeVisible({ timeout: 30_000 });

  // Lewat S-06 (navigasi klien): R13 di memori tetap ada saat dialog U-10 tampil.
  await page.getByRole('button', { name: 'Foto struk, label, atau screenshot' }).click();
  await page
    .getByRole('dialog', { name: 'Foto apa?' })
    .getByTestId('sheet-input-gallery')
    .setInputFiles(fixture('struk-aeon'));
  await expect(page).toHaveURL(/\/kamera\?jenis=struk/);
  await expect(page.getByTestId('part')).toHaveCount(1);
  await expect(page.getByTestId('part')).not.toContainText('Menyiapkan');
  await page.getByRole('button', { name: 'Selesai' }).click();
  const dialog = page.getByRole('dialog', { name: 'Foto ini sudah pernah diunggah' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('(struk AEON BSD)');
  await dialog.getByRole('button', { name: 'Tetap unggah' }).click();
  await expect(page).not.toHaveURL(/\/kamera/, { timeout: 20_000 });
  await waitStatus(hh, 2, 'needs_confirmation');

  // Struk terbaru (dicurigai duplikat hash, tidak di-auto-save) → banner, simpan nonaktif.
  const [dup] = await capturesOf(hh);
  await page.goto(`/unggahan/detail?id=${dup!.id}`);
  await page.getByRole('link', { name: 'Cek sekarang' }).click();
  const banner = page.getByTestId('duplicate-banner');
  await expect(banner).toContainText('Mungkin duplikat: struk AEON');
  await expect(banner).toContainText('total Rp114.700 sudah ada.');
  await expect(page.getByTestId('save-receipt')).toBeDisabled();
  await banner.getByRole('button', { name: 'Buang yang ini' }).click();
  await page.getByRole('dialog', { name: 'Buang struk ini?' }).getByRole('button', { name: 'Buang' }).click();
  await expect(page).toHaveURL(/\/unggahan$/);
  await expect(page.getByText('Struk dibuang.')).toBeVisible();
  await expect.poll(async () => (await capturesOf(hh)).find((c) => c.id === dup!.id)?.status).toBe('done');
  await expect(page.getByRole('region', { name: 'Perlu dicek (1)' })).toBeVisible({ timeout: 30_000 });
});

test('alur 5: screenshot ber-confidence rendah → S-11 → ongkir sebagai info → simpan', async ({ page }, info) => {
  test.setTimeout(180_000);
  const { userId } = await login(page, `m3-a5-${info.project.name}`);
  const hh = await householdOf(userId);

  await upload(page, 'screenshot', 'shopee-milo-ragu');
  await waitStatus(hh, 1, 'needs_confirmation');

  await page.goto('/unggahan');
  const needs = page.getByRole('region', { name: 'Perlu dicek (1)' });
  await expect(needs).toBeVisible({ timeout: 30_000 });
  await needs.getByRole('link').click();
  await expect(page).toHaveURL(/\/konfirmasi\?capture=/);
  await expect(page.getByRole('heading', { level: 1, name: 'Cek screenshot' })).toBeVisible();
  const item = page.getByTestId('observation-item');
  await expect(item).toContainText('Judul listing: "Milo Original 500 g Nestle"');
  await expect(item).toContainText('Seller: Nestle Official Store');
  await expect(item.getByTestId('marketplace-extra')).toHaveText('Ongkir Rp9.000 (info, tidak mengubah harga)');
  await expect(item).toContainText('harga belum termasuk ongkir');
  await expect(item.getByTestId('computed')).toContainText('Rp46.500');

  await page.getByTestId('save-items').click();
  await expect(page.getByText('1 harga baru tersimpan')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: 'Harga dari foto' })).toBeVisible();
  await expect(item.getByTestId('item-accepted')).toBeVisible();
  await waitStatus(hh, 1, 'done');
});
