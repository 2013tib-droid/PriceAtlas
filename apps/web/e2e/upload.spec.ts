// M2 kriteria selesai (docs/07 §12, §11.3): alur 3 sampai `needs_confirmation` dan skenario G,
// terhadap Supabase lokal + worker stub (EXTRACTOR=stub, WORKER_DB_ROLE=service_role; dijalankan
// job CI supabase-e2e). Fixture gambar = apps/worker/test/fixtures (dipetakan stub lewat sha256).
import { expect, test, type Page } from '@playwright/test';
import { login } from './support/auth';
import { capturesOf, fixture, fixtureSha, householdOf, imagesOf, skipBackoff } from './support/captures';
import { hasSupabase } from './support/supabase';

test.skip(!hasSupabase(), 'butuh Supabase lokal + worker (job CI supabase-e2e)');

/** S-07 dari URL langsung: satu gambar galeri → Selesai → kembali + toast (U-11). */
async function uploadFromCamera(page: Page, name: string) {
  await page.goto('/kamera?jenis=struk');
  await expect(page.getByRole('heading', { name: 'Foto struk' })).toBeVisible();
  await page.getByTestId('input-gallery').setInputFiles(fixture(name));
  await expect(page.getByTestId('part')).toHaveCount(1);
  await expect(page.getByTestId('part')).not.toContainText('Menyiapkan');
  await page.getByRole('button', { name: 'Selesai' }).click();
  await expect(page.getByText('Struk diunggah. Kami kabari kalau perlu dicek.')).toBeVisible();
}

test('alur 3: galeri struk-aeon → antrean → Storage → W1 → worker → polling S-08 → perlu dicek', async ({
  page,
}, info) => {
  test.setTimeout(150_000);
  const { userId } = await login(page, `m2-a3-${info.project.name}`);

  // S-06 lewat tombol kamera di tab bar → "Pilih dari galeri" (S-07b, 1 gambar).
  await page.getByRole('button', { name: 'Foto struk, label, atau screenshot' }).click();
  const sheet = page.getByRole('dialog', { name: 'Foto apa?' });
  await expect(sheet).toBeVisible();
  await expect(page).toHaveURL(/sheet=foto/);
  await sheet.getByTestId('sheet-input-gallery').setInputFiles(fixture('struk-aeon'));
  await expect(page).toHaveURL(/\/kamera\?jenis=struk&sumber=galeri$/);
  await expect(page.getByTestId('part')).toHaveCount(1);
  await expect(page.getByTestId('part')).not.toContainText('Menyiapkan');
  await page.getByRole('button', { name: 'Selesai' }).click();
  await expect(page.getByText('Struk diunggah. Kami kabari kalau perlu dicek.')).toBeVisible();
  await expect(page).not.toHaveURL(/\/kamera/);

  // S-08: polling R13 (5 dtk) sampai worker selesai → "Perlu dicek".
  await page.getByRole('link', { name: /^Unggahan/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Unggahan' })).toBeVisible();
  const needs = page.getByRole('region', { name: 'Perlu dicek (1)' });
  await expect(needs).toBeVisible({ timeout: 60_000 });
  await expect(needs).toContainText('2 item perlu dicek');
  await expect(needs).toContainText('AEON');
  await expect(page.getByTestId('uploads-badge')).toContainText('1');

  // Aturan lewati kompresi (F-23/F-40): byte yang diunggah = fixture, sehingga stub mengenalinya.
  const [cap] = await capturesOf(await householdOf(userId));
  expect(cap).toMatchObject({ status: 'needs_confirmation', kind: 'receipt' });
  const imgs = await imagesOf(cap!.id);
  expect(imgs).toEqual([
    { position: 1, sha256: fixtureSha('struk-aeon'), storage_path: expect.stringMatching(/\/1\.jpg$/) },
  ]);

  // S-09: gambar lewat signed URL, "Cek sekarang" menunggu M3.
  await needs.getByRole('link').click();
  await expect(page).toHaveURL(new RegExp(`/unggahan/detail\\?id=${cap!.id}$`));
  await expect(page.getByTestId('detail-status')).toContainText('2 item perlu dicek');
  await expect(page.getByRole('button', { name: 'Cek sekarang' })).toBeDisabled();
  await expect(page.getByTestId('carousel-image')).toHaveCount(1);
});

test('G: struk-buram → "Gambar buram" + Ulangi', async ({ page }, info) => {
  test.setTimeout(120_000);
  await login(page, `m2-gb-${info.project.name}`);
  await uploadFromCamera(page, 'struk-buram');
  await page.goto('/unggahan');
  const failed = page.getByRole('region', { name: 'Gagal (1)' });
  await expect(failed).toBeVisible({ timeout: 60_000 });
  await expect(failed).toContainText('Gambar buram atau terpotong.');
  await expect(failed.getByRole('button', { name: 'Ulangi' })).toBeVisible();

  await failed.getByRole('link').click();
  await expect(page.getByTestId('detail-status')).toContainText('Gambar buram atau terpotong.');
  await expect(page.getByText('Percobaan ke-1', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Foto ulang' })).toHaveAttribute('href', '/kamera?jenis=struk');
  await page.getByRole('button', { name: 'Ulangi' }).click();
  await expect(page.getByText('Unggahan diulang. Kami kabari hasilnya.')).toBeVisible();
  // W2 memulai putaran baru (D-75): worker membaca lagi; fixture buram gagal lagi (permanen).
  await expect(page.getByTestId('timeline')).toContainText('Percobaan ke-2 · gagal', { timeout: 30_000 });
});

test('G: struk-alfamart-timeout → gagal sementara → retry otomatis → selesai', async ({ page }, info) => {
  test.setTimeout(150_000);
  const { userId } = await login(page, `m2-gt-${info.project.name}`);
  await uploadFromCamera(page, 'struk-alfamart-timeout');
  const hh = await householdOf(userId);
  await expect.poll(async () => (await capturesOf(hh)).length, { timeout: 30_000 }).toBe(1);
  const [cap] = await capturesOf(hh);
  await page.goto(`/unggahan/detail?id=${cap!.id}`);

  // Percobaan 1 dan 2 gagal sementara (fixture); worker mengulang sendiri setelah backoff.
  for (const n of [1, 2]) {
    await expect(page.getByTestId('timeline')).toContainText(new RegExp(`Percobaan ke-${n} · gagal`), {
      timeout: 60_000,
    });
    await expect(page.getByTestId('detail-status')).toHaveAttribute('data-status', 'uploaded');
    await skipBackoff(cap!.id);
  }
  await expect(page.getByTestId('detail-status')).toContainText('1 harga tersimpan', { timeout: 60_000 });
  await expect(page.getByTestId('timeline')).toContainText('Percobaan ke-3 · berhasil dibaca');
  await expect(page.getByTestId('saved-record')).toHaveCount(1);
});
