// 6b M5 (docs/08 §13.2 e2e): S-20 Tanya dengan ASK_ENGINE=stub — route /api/ask sungguhan (sesi
// cookie, begin_ask/record_ask_usage, tool dengan JWT user), tanpa Claude dan tanpa kunci API.
// Stub menjawab dari pola pertanyaan (packages/ai-tools/src/ask.ts runAskStub). Data: e2e/support/seed.ts.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { skipOnboarding } from './support/auth';
import { seedMiloPrices } from './support/seed';
import { generateEmailOtpForUser, hasSupabase, uniqueEmail } from './support/supabase';

test.skip(!hasSupabase(), 'butuh Supabase lokal (job CI supabase-e2e)');

const MILO200 = '70000000-0000-0000-0000-000000000200';

async function login(page: Page, tag: string) {
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

const conversation = (page: Page) => page.getByRole('list', { name: 'Percakapan' });

async function ask(page: Page, question: string) {
  await page.getByLabel('Pertanyaan').fill(question);
  await page.getByRole('button', { name: 'Kirim' }).click();
}

test('S-20: Tanya dari S-02 → ambigu → jawaban + tautan layar sumber; S-03b; di luar kemampuan; offline; riwayat', async ({
  page,
  context,
}, info) => {
  test.setTimeout(150_000);
  await login(page, `ask-${info.project.name}`);

  // S-02 → baris "Tanya: milo" → S-20 mengirim pertanyaan itu sekali.
  await page.goto('/cari?q=milo');
  await page.getByRole('link', { name: /^Tanya: milo/ }).click();
  await expect(page).toHaveURL(/\/tanya$/);
  await expect(page.getByRole('heading', { name: 'Maksudmu yang mana?' })).toBeVisible();

  // Pilih produk → jawaban dari tool cari_harga_terbaik (data household sendiri).
  await conversation(page).getByRole('button', { name: 'Milo Original 200 g' }).click();
  const answer = conversation(page).getByText(
    'Termurah 90 hari terakhir: Rp18.000 (promo) di Alfamart, cabang tidak diketahui.',
  );
  await expect(answer).toBeVisible();
  await expect(conversation(page)).toContainText('5 data · terakhir 3 hari lalu');
  await expect(conversation(page)).toContainText('cari_harga_terbaik(Milo Original 200 g)');
  await expect(page.getByText(/^Jawaban: Termurah 90 hari terakhir/)).toBeAttached(); // aria-live

  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id)).toEqual([]);

  // Tautan layar sumber S-03.
  await conversation(page).getByRole('link', { name: 'Lihat detail produk' }).last().click();
  await expect(page).toHaveURL(new RegExp(`/produk\\?id=${MILO200}$`));
  await page.goBack();
  await expect(page).toHaveURL(/\/tanya$/);
  await expect(answer).toBeVisible(); // riwayat di perangkat

  // F-113: harga per satuan → S-03b (sheet Cek harga rak terbuka).
  await ask(page, 'harga per gram Milo Original 200 g?');
  await expect(conversation(page).getByText('Harga terbaik 90 hari: Rp90/g.')).toBeVisible();
  await conversation(page).getByRole('link', { name: 'Buka Cek harga rak' }).click();
  await expect(page).toHaveURL(/sheet=cek-harga/);
  await expect(page.getByRole('dialog', { name: 'Cek harga rak' })).toBeVisible();
  await page.goBack();
  await page.goBack();
  await expect(page).toHaveURL(/\/tanya$/);

  // Di luar kemampuan (D-57).
  await ask(page, 'total belanjaku bulan ini');
  await expect(conversation(page).getByText(/Saya hanya bisa menjawab dari histori hargamu/)).toBeVisible();

  // Offline: kirim nonaktif + petunjuk, riwayat tetap terbaca (§10.5).
  await context.setOffline(true);
  await expect(page.getByText('Tanya butuh sinyal. Hasil cari tetap bisa dipakai offline.')).toBeVisible();
  await page.getByLabel('Pertanyaan').fill('milo naik atau turun?');
  await expect(page.getByRole('button', { name: 'Kirim' })).toBeDisabled();
  await expect(answer).toBeVisible();
  await context.setOffline(false);
  await expect(page.getByRole('button', { name: 'Kirim' })).toBeEnabled();
});
