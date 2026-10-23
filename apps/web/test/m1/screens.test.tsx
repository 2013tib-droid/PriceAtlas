// @vitest-environment jsdom
// L5b S-01 Beranda, S-04 Bandingkan ukuran, S-05 Lebih hemat di mana, scan barcode (docs/07 §7.3).
import './mocks';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  freezeToday,
  fx,
  ID,
  installDomPolyfills,
  nav,
  renderWithProviders,
  resetHarness,
  sb,
  setUrl,
  state,
} from './harness';

const { HomeScreen } = await import('@/features/home/home-screen');
const { SearchLayout } = await import('@/features/search/search-layout');
const { SizesScreen } = await import('@/features/sizes/sizes-screen');
const { CheaperScreen } = await import('@/features/cheaper/cheaper-screen');
const { BarcodeScanner } = await import('@/features/scan/barcode-scanner');
const { writePref } = await import('@/lib/offline/prefs');

installDomPolyfills();
beforeEach(async () => {
  await resetHarness();
  freezeToday();
});
afterEach(() => vi.useRealTimers());

const home = () =>
  renderWithProviders(
    <SearchLayout>
      <HomeScreen />
    </SearchLayout>,
  );

describe('S-01 Beranda', () => {
  it('normal: pencarian terakhir + baru dicek (prefs → R4) + harga baru masuk (REST + R4) + badge perlu dicek', async () => {
    await writePref(ID.user, 'recent_searches', ['milo', 'indomie']);
    await writePref(ID.user, 'viewed_products', [ID.miloUht, ID.milo200, ID.gula]);
    state.rest.capture = () => ({ data: null, error: null, count: 3 });
    await home();
    expect((await screen.findByRole('link', { name: 'milo' })).getAttribute('href')).toBe('/cari?q=milo');
    const viewed = within(await screen.findByRole('region', { name: 'Baru dicek' }));
    await waitFor(() => expect(viewed.getAllByRole('link')).toHaveLength(3));
    expect(sb.rpc).toHaveBeenCalledWith('get_product_cards', { p_ids: [ID.miloUht, ID.milo200, ID.gula] });
    expect(viewed.getByText('PRIBADI')).toBeTruthy();
    const fresh = within(screen.getByRole('region', { name: 'Harga baru masuk' }));
    await waitFor(() => expect(fresh.getAllByRole('link')).toHaveLength(10));
    expect(fresh.getAllByText(/Milo Original/).length).toBeGreaterThan(0);
    expect(fresh.getAllByText(/Shopee · 2 hari lalu/).length).toBe(1);
    expect((await screen.findByRole('link', { name: '3 perlu dicek' })).getAttribute('href')).toBe('/unggahan');
    expect(sb.from).toHaveBeenCalledWith('price_record_view');
    expect(sb.from).toHaveBeenCalledWith('capture');
  });

  it('kosong (U-19): tiga kartu ajakan, tanpa bagian harga', async () => {
    state.rest.price_record_view = () => ({ data: fx('recent_prices_empty'), error: null });
    await home();
    expect(await screen.findByRole('heading', { name: 'Histori harga masih kosong' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Foto struk belanja terakhirmu/ })).toBeTruthy();
    expect(screen.getByRole('link', { name: /Lagi di toko\? Mulai sesi belanja/ }).getAttribute('href')).toBe(
      '/belanja',
    );
    await userEvent.setup().click(screen.getByRole('button', { name: /Coba cari produk/ }));
    expect(document.activeElement).toBe(screen.getByRole('searchbox', { name: 'Cari produk' }));
    expect(screen.queryByRole('region', { name: 'Harga baru masuk' })).toBeNull();
  });

  it('memuat: skeleton bagian "Harga baru masuk"', async () => {
    state.rest.price_record_view = () => new Promise(() => undefined);
    await home();
    const r = await screen.findByRole('region', { name: 'Harga baru masuk' });
    expect(r.querySelector('[aria-busy="true"]')).toBeTruthy();
  });

  it('gagal: pesan + Coba lagi', async () => {
    let fail = true;
    state.rest.price_record_view = () =>
      fail
        ? { data: null, error: { message: 'boom', code: 'XX000', details: null, hint: null } }
        : { data: fx('recent_prices'), error: null };
    await home();
    expect(await screen.findByText('Terjadi kesalahan. Coba lagi sebentar lagi.')).toBeTruthy();
    fail = false;
    await userEvent.setup().click(screen.getByRole('button', { name: 'Coba lagi' }));
    await waitFor(() =>
      expect(within(screen.getByRole('region', { name: 'Harga baru masuk' })).getAllByRole('link')).toHaveLength(10),
    );
  });
});

describe('S-04 Bandingkan ukuran', () => {
  it('peringkat per dimensi, tanpa data di bawah, dimensi berbeda tidak dibandingkan, judul group', async () => {
    setUrl('/produk/ukuran', `group=${ID.group}`);
    await renderWithProviders(<SizesScreen />);
    const rows = await screen.findAllByTestId('size-row');
    expect(rows.map((r) => r.textContent?.slice(0, 12))).toHaveLength(5);
    expect(rows[0]!.textContent).toMatch(/^1\.200 g.*paling hemat/);
    expect(rows[1]!.textContent).toMatch(/^2\.500 g.*\+6%/);
    expect(rows[2]!.textContent).toContain('Belum ada harga di historimu');
    expect(rows[2]!.textContent).toContain('10 × 35 g');
    expect(rows[2]!.textContent).not.toMatch(/^\d\./);
    expect(screen.getByText('Tidak dibandingkan: satuan berbeda (g vs ml)')).toBeTruthy();
    expect(screen.getByRole('region', { name: 'per ml' })).toBeTruthy();
    expect(await screen.findByText('Milo Original · Harga terbaik per satuan')).toBeTruthy();
  });

  it('toggle sepanjang masa: URL ?jendela=semua; SKU lama "data terakhir Mei 2026"', async () => {
    setUrl('/produk/ukuran', `group=${ID.group}`);
    const { unmount } = await renderWithProviders(<SizesScreen />);
    await screen.findAllByTestId('size-row');
    await userEvent.setup().click(screen.getByLabelText('Sepanjang masa'));
    expect(nav.replace).toHaveBeenCalledWith(`/produk/ukuran?group=${ID.group}&jendela=semua`, { scroll: false });
    unmount();
    setUrl('/produk/ukuran', `group=${ID.group}&jendela=semua`);
    await renderWithProviders(<SizesScreen />);
    expect(await screen.findByText('data terakhir Mei 2026')).toBeTruthy();
    expect(sb.rpc).toHaveBeenCalledWith('compare_sizes', { p_group_id: ID.group, p_window: 'all' });
  });

  it('kosong 90 hari (household tanpa histori) → ajakan sepanjang masa', async () => {
    state.rpcOverride = (fn) => (fn === 'compare_sizes' ? { data: fx('sizes_milo_empty'), error: null } : undefined);
    setUrl('/produk/ukuran', `group=${ID.group}`);
    await renderWithProviders(<SizesScreen />);
    expect(await screen.findByText('Belum ada harga 90 hari terakhir untuk group ini.')).toBeTruthy();
  });

  it('hanya satu ukuran', async () => {
    state.rpcOverride = (fn) =>
      fn === 'compare_sizes' ? { data: fx<unknown[]>('sizes_milo_90d').slice(0, 1), error: null } : undefined;
    setUrl('/produk/ukuran', `group=${ID.group}`);
    await renderWithProviders(<SizesScreen />);
    expect(await screen.findByText('Baru ada satu ukuran di group ini.')).toBeTruthy();
  });

  it('NOT_FOUND', async () => {
    setUrl('/produk/ukuran', `group=${ID.unknown}`);
    await renderWithProviders(<SizesScreen />);
    expect(await screen.findByText('Produk tidak ditemukan atau bukan milikmu.')).toBeTruthy();
  });
});

describe('S-05 Lebih hemat di mana', () => {
  it('produk 90 hari: urut rata-rata, cabang tidak diketahui, "baru 1 data", tap → S-03 filter toko', async () => {
    setUrl('/produk/hemat', `id=${ID.milo200}`);
    await renderWithProviders(<CheaperScreen />);
    const rows = await screen.findAllByTestId('store-rank-row');
    expect(rows[0]!.textContent).toContain('Alfamart · cabang tidak diketahui');
    expect(rows[0]!.textContent).toContain('termurah Rp90/g');
    expect(rows.some((r) => r.textContent?.includes('baru 1 data'))).toBe(true);
    expect(within(rows[0]!).getByRole('link').getAttribute('href')).toBe(
      `/produk?id=${ID.milo200}&toko=20000000-0000-0000-0000-000000000002`,
    );
    expect(sb.rpc).toHaveBeenCalledWith('where_cheaper', { p_product_id: ID.milo200, p_window_days: 90 });
    expect(await screen.findByText('Milo Original 200 g')).toBeTruthy();
  });

  it('sepanjang masa: cabang tutup → penerus', async () => {
    setUrl('/produk/hemat', `id=${ID.milo200}&jendela=semua`);
    await renderWithProviders(<CheaperScreen />);
    expect(await screen.findByText('AEON · AEON Lama (tutup) → AEON BSD')).toBeTruthy();
    expect(sb.rpc).toHaveBeenCalledWith('where_cheaper', { p_product_id: ID.milo200, p_window_days: null });
  });

  it('group: per dimensi, toko online "harga belum termasuk ongkir", baris tidak bisa di-tap', async () => {
    setUrl('/produk/hemat', `id=${ID.milo200}&lingkup=group&group=${ID.group}`);
    await renderWithProviders(<CheaperScreen />);
    expect(await screen.findByText('harga belum termasuk ongkir')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'per ml' })).toBeTruthy();
    expect(within(screen.getAllByTestId('store-rank-row')[0]!).queryByRole('link')).toBeNull();
    expect(sb.rpc).toHaveBeenCalledWith('where_cheaper', { p_group_id: ID.group, p_window_days: 90 });
  });

  it('toggle cakupan: URL ?lingkup=group&group=…', async () => {
    setUrl('/produk/hemat', `id=${ID.milo200}`);
    await renderWithProviders(<CheaperScreen />);
    await screen.findAllByTestId('store-rank-row');
    await userEvent.setup().click(screen.getByLabelText('Semua ukuran'));
    expect(nav.replace).toHaveBeenCalledWith(`/produk/hemat?id=${ID.milo200}&lingkup=group&group=${ID.group}`, {
      scroll: false,
    });
  });

  it('kosong 90 hari: "Belum ada histori 90 hari. Lihat sepanjang masa?"', async () => {
    setUrl('/produk/hemat', `id=${ID.milo3in1}`);
    await renderWithProviders(<CheaperScreen />);
    expect(await screen.findByText('Belum ada histori 90 hari.')).toBeTruthy();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Lihat sepanjang masa?' }));
    expect(nav.replace).toHaveBeenCalledWith(`/produk/hemat?id=${ID.milo3in1}&jendela=semua&group=${ID.group}`, {
      scroll: false,
    });
  });
});

describe('Scan barcode (D-58, §5.7)', () => {
  let detect: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    vi.useRealTimers();
    detect = vi.fn();
    (window as { BarcodeDetector?: unknown }).BarcodeDetector = Object.assign(
      class {
        detect = detect;
      },
      { getSupportedFormats: async () => ['ean_13', 'ean_8', 'code_128'] },
    );
    const track = { stop: vi.fn() };
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [track] })) },
    });
    HTMLMediaElement.prototype.play = vi.fn(async () => undefined);
  });
  afterEach(() => {
    delete (window as { BarcodeDetector?: unknown }).BarcodeDetector;
  });

  it('terbaca → R6 → router.replace ke S-03', async () => {
    detect.mockResolvedValueOnce([]).mockResolvedValue([{ rawValue: '8992696404441', format: 'ean_13' }]);
    await renderWithProviders(<BarcodeScanner />);
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith(`/produk?id=${ID.milo500}`));
    expect(sb.rpc).toHaveBeenCalledWith('find_product_by_barcode', { p_code: '8992696404441' });
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith({
      video: { facingMode: 'environment' },
      audio: false,
    });
  });

  it('via_merge → toast + produk pengganti', async () => {
    detect.mockResolvedValue([{ rawValue: '9990000000012', format: 'ean_13' }]);
    await renderWithProviders(<BarcodeScanner />);
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith(`/produk?id=${ID.milo200}`));
    expect(toast).toHaveBeenCalledWith('Barcode ini milik produk yang sudah digabung. Kami buka produk penggantinya.');
  });

  it('tidak dikenal → pesan + Pilih atau buat produk (S-14 → S-15, D-85) / Scan lagi / Cari dengan mengetik', async () => {
    detect.mockResolvedValue([{ rawValue: '1234567890123', format: 'ean_13' }]);
    await renderWithProviders(<BarcodeScanner />);
    expect(
      await screen.findByText('Barcode 1234567890123 belum dikenal di katalogmu. Cari namanya atau buat produk baru.'),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Scan lagi' })).toBeTruthy();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Pilih atau buat produk' }));
    expect(nav.replace).toHaveBeenCalledWith('/produk/baru?barcode=1234567890123&pilih=produk&untuk=barcode');
    await user.click(screen.getByRole('button', { name: 'Cari dengan mengetik' }));
    expect(nav.replace).toHaveBeenCalledWith('/');
  });

  it('izin kamera ditolak → pesan', async () => {
    (navigator.mediaDevices.getUserMedia as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('NotAllowedError'),
    );
    await renderWithProviders(<BarcodeScanner />);
    expect(await screen.findByText(/Izin kamera ditolak/)).toBeTruthy();
  });

  it('tanpa BarcodeDetector → tidak didukung', async () => {
    delete (window as { BarcodeDetector?: unknown }).BarcodeDetector;
    await renderWithProviders(<BarcodeScanner />);
    expect(await screen.findByText('Browser ini belum bisa membaca barcode. Cari dengan mengetik.')).toBeTruthy();
  });
});
