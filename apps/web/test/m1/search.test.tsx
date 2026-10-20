// @vitest-environment jsdom
// L5b S-02 Hasil cari + ProductCard (semua keadaan docs/07 §7.3) + GroupHeader + SearchDock.
import './mocks';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  freezeToday,
  ID,
  installDomPolyfills,
  nav,
  renderWithProviders,
  resetHarness,
  sb,
  setUrl,
  state,
} from './harness';

const { SearchScreen } = await import('@/features/search/search-screen');
const { SearchLayout, SEARCH_DEBOUNCE_MS } = await import('@/features/search/search-layout');

installDomPolyfills();
beforeEach(async () => {
  await resetHarness();
  freezeToday();
});
afterEach(() => {
  vi.useRealTimers();
  delete (window as { BarcodeDetector?: unknown }).BarcodeDetector;
});

async function renderSearch(q: string) {
  setUrl('/cari', `q=${encodeURIComponent(q)}`);
  return renderWithProviders(
    <SearchLayout>
      <SearchScreen />
    </SearchLayout>,
  );
}

describe('S-02 Hasil cari', () => {
  it('R3 dipanggil dengan q dari URL, hasil dikelompokkan per Product Group dengan header U-03', async () => {
    await renderSearch('milo');
    expect(await screen.findByText('5 produk untuk "milo"')).toBeTruthy();
    expect(sb.rpc).toHaveBeenCalledWith('search_products', { p_query: 'milo' });
    const groups = screen.getAllByRole('region', { name: /Milo Original/ });
    expect(groups.length).toBeGreaterThan(0);
    expect(screen.getByText('Paling hemat per gram: 200 g (Rp90/g)')).toBeTruthy();
    expect(screen.getByText('Paling hemat per ml: 180 ml (Rp33,3/ml)')).toBeTruthy();
    expect(screen.getAllByRole('link', { name: 'Bandingkan ukuran' })[0]!.getAttribute('href')).toBe(
      `/produk/ukuran?group=${ID.group}`,
    );
    // Baris Tanya (kerangka, D-57).
    expect(screen.getByText('Tanya: milo')).toBeTruthy();
  });

  it('kartu normal menjawab Q1–Q4 + D-15: harga 90 hari + label, toko · cabang tidak diketahui, tren teks, per gram, jumlah data', async () => {
    await renderSearch('milo');
    const c = within(await screen.findByRole('article', { name: /Milo Original 200 g/ }));
    expect(c.getAllByText('Rp18.000').length).toBeGreaterThan(0);
    expect(c.getAllByText('PROMO').length).toBeGreaterThan(0);
    expect(c.getByLabelText('90 rupiah per gram').textContent).toBe('Rp90/g');
    expect(c.getAllByText(/Alfamart · cabang tidak diketahui/).length).toBeGreaterThan(0);
    const trend = c.getByText(/↓ turun \d+% vs 30 hari sebelumnya/);
    expect(trend.getAttribute('aria-label')).toMatch(/^turun \d+ persen dibanding 30 hari sebelumnya$/);
    expect(c.getByText('9 data · terakhir 3 hari lalu')).toBeTruthy();
    expect(c.getByText('Termurah sepanjang masa:')).toBeTruthy();
    // Member tidak dihitung (D-27) → S-19b.
    expect(c.getByText(/Ada harga member AEON Rp17\.900 · tidak dihitung karena kamu belum terdaftar/)).toBeTruthy();
    expect(c.getByRole('link', { name: 'Atur' }).getAttribute('href')).toBe('/saya/member');
    expect(c.getByRole('link', { name: 'Milo Original 200 g' }).getAttribute('href')).toBe(`/produk?id=${ID.milo200}`);
    expect(c.getByRole('link', { name: 'Cek harga rak Milo Original 200 g' }).getAttribute('href')).toBe(
      `/produk?id=${ID.milo200}&sheet=cek-harga`,
    );
  });

  it('tren belum cukup: teks + jumlah data tetap tampil (D-15)', async () => {
    await renderSearch('milo');
    const c = within(await screen.findByRole('article', { name: /Milo Original 500 g/ }));
    expect(c.getByText('Tren: data belum cukup')).toBeTruthy();
    expect(c.getByText('2 data · terakhir 5 hari lalu')).toBeTruthy();
  });

  it('hanya sepanjang masa: "Belum ada harga 90 hari terakhir" + umur data', async () => {
    await renderSearch('milo');
    const c = within(await screen.findByRole('article', { name: /Milo 3in1/ }));
    expect(c.getByText('Belum ada harga 90 hari terakhir')).toBeTruthy();
    expect(c.getByText('Rp32.000')).toBeTruthy();
    expect(c.getByText(/terakhir dicatat 5 bln lalu/)).toBeTruthy();
    expect(c.queryByText('Termurah sepanjang masa:')).toBeNull();
  });

  it('toko online: "belum termasuk ongkir" (D-36)', async () => {
    await renderSearch('milo');
    const c = within(await screen.findByRole('article', { name: /Milo UHT/ }));
    expect(c.getAllByText(/Shopee · Nestle Official Store · .*belum termasuk ongkir/).length).toBeGreaterThan(0);
  });

  it('produk ada, histori kosong: kartu tipis + Cek harga rak', async () => {
    await renderSearch('milo');
    const c = within(await screen.findByRole('article', { name: /Milo Original 1 kg/ }));
    expect(c.getByText('Belum ada data harga di historimu')).toBeTruthy();
    expect(c.getByRole('link', { name: /Cek harga rak/ })).toBeTruthy();
  });

  it('hanya bundle (D-08)', async () => {
    await renderSearch('indomie');
    const c = within(await screen.findByRole('article', { name: /Indomie Goreng/ }));
    expect(c.getByText('Hanya ada 1 data bundle · tidak dipakai untuk harga terbaik')).toBeTruthy();
  });

  it('produk privat: badge PRIBADI; tanpa group tampil sendiri', async () => {
    await renderSearch('gula');
    const c = within(await screen.findByRole('article', { name: /Gula Pasir Curah/ }));
    expect(c.getByText('PRIBADI')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Bandingkan ukuran' })).toBeNull();
  });

  it('produk timbang: harga utama per kg (U-20)', async () => {
    await renderSearch('jeruk');
    const c = within(await screen.findByRole('article', { name: /Jeruk Medan/ }));
    expect(c.getAllByLabelText('45.000 rupiah per kilogram')[0]!.textContent).toBe('Rp45.000/kg');
    expect(c.getByText('Rp45/g')).toBeTruthy();
  });

  it('tidak ditemukan: kalimat wireframe + baris Tanya', async () => {
    await renderSearch('milo actv xyz');
    expect(
      await screen.findByText('Tidak ada produk "milo actv xyz". Coba kata lain, scan barcode, atau foto labelnya.'),
    ).toBeTruthy();
    expect(screen.getByText('Tanya: milo actv xyz')).toBeTruthy();
  });

  it('memuat: 3 kartu skeleton', async () => {
    state.rpcOverride = (fn) => (fn === 'search_products' ? new Promise(() => undefined) : undefined);
    const { container } = await renderSearch('milo');
    await waitFor(() => expect(container.querySelector('[aria-busy="true"]')).toBeTruthy());
    expect(container.querySelector('[aria-busy="true"]')!.children.length).toBe(4); // status + 3 kartu
  });

  it('gagal: pesan + Coba lagi memanggil ulang R3', async () => {
    let fail = true;
    state.rpcOverride = (fn) =>
      fn === 'search_products' && fail
        ? { data: null, error: { message: 'boom', code: 'XX000', details: null, hint: null } }
        : undefined;
    await renderSearch('milo');
    expect(await screen.findByText('Terjadi kesalahan. Coba lagi sebentar lagi.')).toBeTruthy();
    fail = false;
    await userEvent.setup().click(screen.getByRole('button', { name: 'Coba lagi' }));
    expect(await screen.findByText('5 produk untuk "milo"')).toBeTruthy();
  });

  it('jaringan putus: "Tidak ada sinyal" (bukan error server)', async () => {
    state.rpcOverride = (fn) => {
      if (fn === 'search_products') throw new TypeError('Failed to fetch');
      return undefined;
    };
    await renderSearch('milo');
    expect(await screen.findByText('Tidak ada sinyal. Data yang terakhir dimuat tetap ditampilkan.')).toBeTruthy();
  });

  it('offline dengan data tersimpan: label "data tersimpan, mungkin tidak terbaru"', async () => {
    await renderSearch('milo');
    await screen.findByText('5 produk untuk "milo"');
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    act(() => void window.dispatchEvent(new Event('offline')));
    expect(await screen.findByText(/data tersimpan, mungkin tidak terbaru/)).toBeTruthy();
  });

  it('offline tanpa data: pesan offline, tanpa skeleton', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    state.rpcOverride = (fn) => (fn === 'search_products' ? new Promise(() => undefined) : undefined);
    await renderSearch('milo');
    expect(await screen.findByText(/Tidak ada sinyal, dan data ini belum tersimpan di HP/)).toBeTruthy();
  });

  it('kurang dari 2 huruf: R3 tidak dipanggil (22023)', async () => {
    await renderSearch(' m ');
    expect(screen.getByText('Ketik minimal 2 huruf.')).toBeTruthy();
    expect(sb.rpc).not.toHaveBeenCalledWith('search_products', expect.anything());
  });
});

describe('SearchDock (U-02, D-58)', () => {
  it('mengetik di beranda → /cari?q= setelah jeda 250 ms; di /cari → replace', async () => {
    vi.useRealTimers();
    setUrl('/');
    await renderWithProviders(<SearchLayout>{null}</SearchLayout>);
    const user = userEvent.setup();
    const box = screen.getByRole('searchbox', { name: 'Cari produk' });
    await user.type(box, 'mi');
    expect(nav.push).not.toHaveBeenCalled();
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith('/cari?q=mi'), { timeout: SEARCH_DEBOUNCE_MS * 4 });
    expect(nav.push).toHaveBeenCalledTimes(1);
  });

  it('di /cari: Enter menyimpan pencarian terakhir; ikon scan tersembunyi tanpa BarcodeDetector', async () => {
    vi.useRealTimers();
    setUrl('/cari', 'q=milo');
    await renderWithProviders(<SearchLayout>{null}</SearchLayout>);
    const box = screen.getByRole('searchbox', { name: 'Cari produk' }) as HTMLInputElement;
    expect(box.value).toBe('milo');
    await userEvent.setup().type(box, '{Enter}');
    const { readPref } = await import('@/lib/offline/prefs');
    await waitFor(async () => expect(await readPref(ID.user, 'recent_searches', [])).toEqual(['milo']));
    expect(screen.queryByRole('link', { name: 'Scan barcode' })).toBeNull();
  });

  it('ikon scan tampil jika BarcodeDetector mendukung ean_13', async () => {
    vi.useRealTimers();
    (window as { BarcodeDetector?: unknown }).BarcodeDetector = Object.assign(class {}, {
      getSupportedFormats: async () => ['ean_13', 'qr_code'],
    });
    await renderWithProviders(<SearchLayout>{null}</SearchLayout>);
    expect((await screen.findByRole('link', { name: 'Scan barcode' })).getAttribute('href')).toBe(
      '/kamera?jenis=barcode',
    );
  });

  it('BarcodeDetector tanpa ean_13: ikon tetap tersembunyi', async () => {
    vi.useRealTimers();
    (window as { BarcodeDetector?: unknown }).BarcodeDetector = Object.assign(class {}, {
      getSupportedFormats: async () => ['qr_code'],
    });
    await renderWithProviders(<SearchLayout>{null}</SearchLayout>);
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByRole('link', { name: 'Scan barcode' })).toBeNull();
  });
});
