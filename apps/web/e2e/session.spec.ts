// M4 kriteria selesai (docs/07 §12, §11.3 alur 4): mulai sesi (S-12) → banner → foto label (kamera
// palsu Chromium) → S-13 kartu → perpanjang → akhiri, terhadap Supabase lokal + worker stub (job CI
// supabase-e2e). Logika dan fixture worker tidak diubah, sehingga:
//   * Frame kamera palsu (Chromium) melewati pipeline klien asli (canvas → JPEG → sha256 → antrean →
//     Storage → W1) dan diperiksa sampai capture terdaftar dengan sesi yang benar + byte JPEG ≤ 2048 px.
//     Stub worker memetakan fixture lewat sha256, jadi frame ini selesai `failed` (unsupported) dan
//     tampil "gagal dibaca" di S-13 (F-63).
//   * Isi kartu (produk, harga, label, vs_best_pct) dari label-milo lewat "Galeri" di kamera label yang
//     sama (sesi sama, sha256 = fixture): Milo 200 g auto-accept (lokasi dari sesi), Milo 3in1 perlu
//     dicek → S-11 → simpan → kartu tersimpan.
//   * WebKit tidak punya kamera palsu: alur yang sama tanpa langkah kamera (F-64).
import { createHash } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { login } from './support/auth';
import { fixture, householdOf } from './support/captures';
import { seedMiloPrices } from './support/seed';
import { expireSessionIn, imageBytes, jpegSize, sessionCaptures, sessionsOf } from './support/session';
import { hasSupabase } from './support/supabase';

test.skip(!hasSupabase(), 'butuh Supabase lokal + worker (job CI supabase-e2e)');

const AEON = '20000000-0000-0000-0000-000000000001';
const AEON_BSD = '30000000-0000-0000-0000-000000000001';

test('alur 4: mulai sesi (S-12) → banner → foto label → S-13 kartu → perpanjang → akhiri', async ({ page }, info) => {
  test.setTimeout(240_000);
  const camera = info.project.name.startsWith('chromium');
  const { userId } = await login(page, `m4-a4-${info.project.name}`);
  // Histori Milo 200 g (termurah 90 hari Rp18.000) supaya vs_best_pct berarti.
  await seedMiloPrices(userId);
  const hh = await householdOf(userId);

  // S-13 tanpa sesi → "Mulai belanja" → S-12 mode sesi.
  await page.goto('/belanja');
  await expect(page.getByText(/Lagi di toko\? Mulai sesi/)).toBeVisible();
  await page.getByRole('link', { name: 'Mulai belanja' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Kamu belanja di mana?' })).toBeVisible();
  await page
    .getByTestId('store-row')
    .filter({ hasText: /^AEON$/ })
    .getByRole('button')
    .click();
  const branches = page.getByTestId('branch-row');
  await expect(branches.filter({ hasText: 'AEON Lama' }).getByRole('button')).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Tidak tahu cabangnya' })).toHaveCount(0);
  await branches.filter({ hasText: 'AEON BSD' }).getByRole('button').click();

  await expect(page).toHaveURL(/\/belanja$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Belanja di AEON BSD' })).toBeVisible();
  await expect(page.getByText('Foto label harga pertama.')).toBeVisible();
  const [session] = await sessionsOf(hh);
  expect(session).toMatchObject({ branch_id: AEON_BSD, ended_at: null });

  // S-06 dengan sesi: Label di urutan pertama + sasaran sesi (U-08).
  await page.getByRole('button', { name: 'Foto struk, label, atau screenshot' }).click();
  const sheet = page.getByRole('dialog', { name: 'Foto apa?' });
  await expect(sheet.getByRole('listitem').first()).toContainText('Label harga akan masuk ke AEON BSD');
  await sheet.getByRole('button', { name: 'Tutup' }).click();
  await expect(sheet).toBeHidden();

  // Banner (U-13) → kamera label.
  const banner = page.getByRole('region', { name: 'Belanja di AEON BSD' });
  await expect(banner).toContainText('0 label');
  await banner.getByRole('link', { name: 'Foto label' }).click();
  await expect(page).toHaveURL(/\/kamera\?jenis=label$/);
  await expect(page.getByTestId('label-target')).toHaveText('Label masuk ke AEON BSD (sesi belanja).');

  let n = 0;
  if (camera) {
    // Kamera palsu: jendela bidik menyala, shutter → foto tersimpan, kamera tetap terbuka.
    const shutter = page.getByRole('button', { name: 'Ambil foto label' });
    await expect(shutter).toBeEnabled({ timeout: 20_000 });
    await shutter.click();
    n += 1;
    await expect(page.getByTestId('label-shot').nth(0)).toHaveText('Label 1: tersimpan', { timeout: 20_000 });
    await expect(page).toHaveURL(/\/kamera\?jenis=label$/);
  }
  await page.getByTestId('label-gallery').setInputFiles(fixture('label-milo'));
  n += 1;
  await expect(page.getByTestId('label-shot').nth(n - 1)).toHaveText(`Label ${n}: tersimpan`, { timeout: 20_000 });

  // Semua foto terdaftar (W1) dengan sesi yang benar; lokasi capture diisi dari cabang sesi.
  await expect
    .poll(async () => (await sessionCaptures(hh)).filter((c) => c.shopping_session_id === session!.id).length, {
      timeout: 60_000,
    })
    .toBe(n);
  const caps = (await sessionCaptures(hh)).filter((c) => c.shopping_session_id === session!.id);
  for (const c of caps) expect(c).toMatchObject({ kind: 'price_label', store_id: AEON, branch_id: AEON_BSD });
  if (camera) {
    // Frame kamera = JPEG nyata dari canvas (≤ 2048 px), sha256 byte final = capture_image.sha256.
    const img = await imageBytes(caps[0]!.id);
    const size = jpegSize(img.bytes);
    expect(size).not.toBeNull();
    expect(Math.max(size!.width, size!.height)).toBeLessThanOrEqual(2048);
    expect(createHash('sha256').update(img.bytes).digest('hex')).toBe(img.sha256);
  }

  // Selesai → kembali ke S-13; label masuk kartu (polling R18 selama diproses).
  await page.getByRole('button', { name: 'Selesai' }).click();
  await expect(page).toHaveURL(/\/belanja$/);
  await expect(page.getByText(`Label di sesi ini (${n})`)).toBeVisible({ timeout: 20_000 });
  await expect(banner).toContainText(`${n} label`);
  const labels = page.getByTestId('session-label');
  if (camera) await expect(labels.filter({ hasText: 'gagal dibaca' })).toBeVisible({ timeout: 60_000 });
  const check = labels.filter({ hasText: 'perlu dicek' });
  await expect(check).toContainText('Milo Original 200 g', { timeout: 60_000 });

  // "perlu dicek ›" → S-11 → simpan (lokasi dari sesi, docs/05 §4.2 langkah 4).
  await check.getByRole('link').click();
  await expect(page).toHaveURL(/\/konfirmasi\?capture=/);
  await expect(page.getByRole('heading', { level: 1, name: 'Cek label harga' })).toBeVisible();
  await page.getByTestId('save-items').click();
  await expect(page.getByText(/harga baru tersimpan/)).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: 'Harga dari foto' })).toBeVisible();

  // Hampir kedaluwarsa (data test: expires_at dimajukan) → S-13 kartu tersimpan + "Perpanjang".
  await expireSessionIn(session!.id, 20 * 60_000);
  await page.getByRole('link', { name: 'Belanja', exact: true }).click();
  await expect(page).toHaveURL(/\/belanja$/);
  const saved = labels.filter({ hasText: 'Milo Original 200 g' });
  await expect(saved).toContainText('Rp17.500', { timeout: 30_000 });
  await expect(saved).toContainText('PROMO');
  await expect(saved).toContainText(/lebih murah dari biasanya|setara harga terbaikmu/);
  await expect(page.getByText(/^Sesi berakhir (19|20) menit lagi\.$/)).toBeVisible();
  await page.getByRole('button', { name: 'Perpanjang' }).click();
  await expect(page.getByText(/^Sesi diperpanjang sampai \d{2}:\d{2}\.$/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Perpanjang' })).toHaveCount(0);
  const extended = (await sessionsOf(hh))[0]!;
  expect(Date.parse(extended.expires_at) - Date.now()).toBeGreaterThan(2 * 60 * 60_000);

  // Akhiri (W13) → ringkasan, banner hilang, kembali ke ajakan.
  await page.getByRole('button', { name: 'Akhiri sesi' }).click();
  await expect(page.getByText(`Sesi di AEON BSD diakhiri. ${n} label tersimpan.`)).toBeVisible();
  await expect(page.getByRole('link', { name: 'Mulai belanja' })).toBeVisible();
  await expect(page.locator('[data-session-banner]')).toHaveCount(0);
  await expect.poll(async () => (await sessionsOf(hh))[0]!.ended_at).not.toBeNull();
});
