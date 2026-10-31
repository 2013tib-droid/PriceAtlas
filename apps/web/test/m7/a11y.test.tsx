// @vitest-environment jsdom
// L5b M7: audit a11y otomatis (docs/07 §10.1, §11.1, kriteria M7 "axe tanpa pelanggaran serius").
// jest-axe (axe-core) pada setiap layar S-xx dengan data fixture RPC ASLI; hanya dampak serious dan
// critical yang menggagalkan. Kontras warna tidak bisa dihitung di jsdom (jest-axe mematikannya),
// jadi kontras diperiksa di e2e (e2e/a11y.spec.ts, browser sungguhan). Catatan cek manual
// VoiceOver/TalkBack: docs/07 §1.11.
import '../m1/mocks';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { configureAxe } from 'jest-axe';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CAT,
  captureIds,
  freezeToday,
  fx,
  ID,
  installDomPolyfills,
  m3Ids,
  m5Ids,
  renderWithProviders,
  resetHarness,
  setUrl,
  state,
} from '../m1/harness';

const axe = configureAxe({ impactLevels: ['serious', 'critical'] });
const SERIOUS = new Set(['serious', 'critical']);
/** Pelanggaran serious/critical (impactLevels jest-axe hanya dipakai matcher, bukan `violations`). */
const serious = (results: Awaited<ReturnType<typeof axe>>) =>
  results.violations
    .filter((v) => SERIOUS.has(v.impact ?? ''))
    .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);

const { AppShell } = await import('@/components/app/app-shell');
const { PhotoSheet } = await import('@/components/app/photo-sheet');
const { SearchLayout } = await import('@/features/search/search-layout');
const { HomeScreen } = await import('@/features/home/home-screen');
const { SearchScreen } = await import('@/features/search/search-screen');
const { ProductScreen } = await import('@/features/product/product-screen');
const { SizesScreen } = await import('@/features/sizes/sizes-screen');
const { CheaperScreen } = await import('@/features/cheaper/cheaper-screen');
const { UploadsScreen } = await import('@/features/uploads/uploads-screen');
const { UploadDetailScreen } = await import('@/features/uploads/upload-detail-screen');
const { ReceiptScreen } = await import('@/features/receipt/receipt-screen');
const { ItemsScreen } = await import('@/features/observation/items-screen');
const { LocationScreen } = await import('@/features/location/location-screen');
const { NewProductScreen } = await import('@/features/new-product/new-product-screen');
const { ShoppingScreen } = await import('@/features/shopping/shopping-screen');
const { RecordScreen } = await import('@/features/record/record-screen');
const { MergeScreen } = await import('@/features/catalog/merge-screen');
const { SplitScreen } = await import('@/features/catalog/split-screen');
const { EditProductScreen } = await import('@/features/catalog/edit-product-screen');
const { MeScreen } = await import('@/features/me/me-screen');
const { MemberScreen } = await import('@/features/me/member-screen');
const { ShareScreen } = await import('@/features/me/share-screen');
const { PrivacyScreen } = await import('@/features/me/privacy-screen');
const { WelcomeScreen } = await import('@/features/onboarding/welcome-screen');
const { MemberStepScreen } = await import('@/features/onboarding/member-step-screen');
const { AskScreen } = await import('@/features/ask/ask-screen');
const { PasteScreen } = await import('@/features/paste/paste-screen');
const { SignInScreen } = await import('@/features/auth/sign-in-screen');

installDomPolyfills();
beforeEach(async () => {
  await resetHarness();
  freezeToday();
});

/** Tunggu judul layar dan sampai tidak ada bagian yang masih memuat, lalu jalankan axe. */
async function audit(path: string, query: string, ui: ReactNode, opts: { heading?: RegExp | string } = {}) {
  setUrl(path, query);
  await renderWithProviders(ui);
  await screen.findAllByRole('heading', opts.heading ? { name: opts.heading } : { level: 1 });
  await waitFor(() => expect(document.querySelector('[aria-busy="true"]')).toBeNull(), { timeout: 5000 });
  const results = await axe(document.body);
  const minor = results.violations.filter((v) => !SERIOUS.has(v.impact ?? '')).map((v) => `${v.id} (${v.impact})`);
  if (process.env.A11Y_REPORT) process.stderr.write(`[axe] ${path}: ${minor.join(', ') || '-'}\n`);
  expect(serious(results)).toEqual([]);
}

const withSearch = (node: ReactNode) => <SearchLayout>{node}</SearchLayout>;

describe('axe: tanpa pelanggaran serious/critical (§10.1)', () => {
  it('layout (app) + S-01 Beranda (tab bar, strip, banner)', async () => {
    await audit('/', '', <AppShell>{withSearch(<HomeScreen />)}</AppShell>);
  });
  it('S-01 keadaan kosong (U-19)', async () => {
    state.rest.price_record_view = () => ({ data: [], error: null });
    await audit('/', '', withSearch(<HomeScreen />));
  });
  it('S-02 Hasil cari', async () => {
    await audit('/cari', 'q=milo', withSearch(<SearchScreen />), { heading: /Milo UHT/ });
  });
  it('S-02 tidak ditemukan', async () => {
    await audit('/cari', 'q=milo actv xyz', withSearch(<SearchScreen />), { heading: 'Hasil cari' });
  });
  it('S-03 Detail produk', async () => {
    await audit('/produk', `id=${ID.milo200}`, <ProductScreen />);
  });
  it('S-03b Cek harga rak (sheet)', async () => {
    await audit('/produk', `id=${ID.milo200}&sheet=cek-harga`, <ProductScreen />, { heading: 'Cek harga rak' });
  });
  it('S-04 Bandingkan ukuran', async () => {
    await audit('/produk/ukuran', `group=${ID.group}`, <SizesScreen />);
  });
  it('S-05 Lebih hemat di mana', async () => {
    await audit('/produk/hemat', `id=${ID.milo200}`, <CheaperScreen />);
  });
  it('S-06 Pilih jenis foto (sheet)', async () => {
    await audit('/', 'sheet=foto', <PhotoSheet />, { heading: 'Foto apa?' });
  });
  it('S-08 Unggahan', async () => {
    await audit('/unggahan', '', <UploadsScreen />);
  });
  it('S-09 Detail unggahan (gagal)', async () => {
    await audit('/unggahan/detail', `id=${captureIds().failed}`, <UploadDetailScreen />);
  });
  it('S-10 Konfirmasi struk', async () => {
    await audit('/struk', `id=${m3Ids().receipts.aeon}`, <ReceiptScreen />);
  });
  it('S-11 Konfirmasi label', async () => {
    await audit('/konfirmasi', `capture=${m3Ids().items.label}`, <ItemsScreen />);
  });
  it('S-12 Pilih toko & cabang', async () => {
    await audit('/lokasi', 'mode=manual', <LocationScreen />);
  });
  it('S-13 Sesi belanja', async () => {
    state.rpcOverride = (fn) => (fn === 'get_active_session' ? { data: fx('session_labels'), error: null } : undefined);
    await audit('/belanja', '', <ShoppingScreen />);
  });
  it('S-15 Produk baru', async () => {
    await audit('/produk/baru', '', <NewProductScreen />);
  });
  it('S-15 Edit produk + barcode', async () => {
    await audit('/produk/edit', `id=${CAT.syrup}`, <EditProductScreen />);
  });
  it('S-16 Detail & koreksi harga', async () => {
    await audit('/harga', `id=${m5Ids().records.label}`, <RecordScreen />);
  });
  it('S-17 Gabungkan', async () => {
    await audit('/produk/gabung', `id=${ID.gula}`, <MergeScreen />);
  });
  it('S-18 Pisahkan', async () => {
    await audit('/produk/pisah', `id=${ID.milo500}`, <SplitScreen />);
  });
  it('S-19 Saya + dialog Keluar', async () => {
    await audit('/saya', '', <MeScreen />);
  });
  it('S-19b Program member', async () => {
    await audit('/saya/member', '', <MemberScreen />);
  });
  it('S-19c Berbagi harga publik', async () => {
    await audit('/saya/berbagi', '', <ShareScreen />);
  });
  it('Privasi & hapus akun', async () => {
    await audit('/saya/privasi', '', <PrivacyScreen />);
  });
  it('S-00a Masuk', async () => {
    await audit('/masuk', '', <SignInScreen />);
  });
  it('S-00b Selamat datang', async () => {
    await audit('/selamat-datang', '', <WelcomeScreen />);
  });
  it('S-00c Member (onboarding)', async () => {
    await audit('/selamat-datang/member', '', <MemberStepScreen />);
  });
  it('S-20 Tanya', async () => {
    // Tanpa ?q= (dengan q, S-20 langsung mengirim; keadaan berisi jawaban diaudit di test/m8).
    await audit('/tanya', '', <AskScreen />);
  });
  it('S-21 Tempel struk (D-100)', async () => {
    await audit('/tempel', '', <PasteScreen />);
  });

  it('dialog terbuka (Keluar dengan konfirmasi) tetap lolos', async () => {
    setUrl('/saya');
    await renderWithProviders(<MeScreen />);
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Ubah nama' }));
    expect(serious(await axe(document.body))).toEqual([]);
    vi.useRealTimers();
  });
});
