// @vitest-environment jsdom
// L5b S-03 Detail produk (semua keadaan docs/07 §7.3) + S-03b Cek harga rak.
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

const { ProductScreen } = await import('@/features/product/product-screen');

installDomPolyfills();
beforeEach(async () => {
  await resetHarness();
  freezeToday();
});
afterEach(() => vi.useRealTimers());

async function openProduct(id: string, query = '') {
  setUrl('/produk', `id=${id}${query}`);
  await renderWithProviders(<ProductScreen />);
  return screen.findByRole('heading', { level: 1 });
}
const region = (name: string) => within(screen.getByRole('region', { name }));

describe('S-03 Detail produk', () => {
  it('normal: header, ringkasan (90 hari, all-time, terakhir, tren), grafik, 3 toko teratas, ukuran lain, histori', async () => {
    const h = await openProduct(ID.milo200);
    expect(h.textContent).toBe('Milo Original 200 g');
    expect(screen.getByText('Nestle · Minuman · Milo Original')).toBeTruthy();
    const sum = within(screen.getByTestId('summary'));
    expect(sum.getByText('Termurah 90 hari')).toBeTruthy();
    expect(sum.getAllByText('Rp18.000').length).toBeGreaterThan(0);
    expect(sum.getByText('Harga terakhir:')).toBeTruthy();
    expect(sum.getByText(/AEON · AEON BSD · 3 hari lalu/)).toBeTruthy();
    expect(sum.getByText(/↓ turun \d+% vs 30 hari sebelumnya/)).toBeTruthy();
    expect(sum.getByText('9 data · terakhir 3 hari lalu')).toBeTruthy();

    const chart = await screen.findByTestId('price-chart');
    expect(chart.getAttribute('role')).toBe('img');
    expect(chart.getAttribute('aria-label')).toMatch(
      /^Grafik \d+ harga per satuan dari .* terendah Rp90\/g, tertinggi Rp105\/g\.$/,
    );
    expect(screen.getByText('Lihat sebagai tabel')).toBeTruthy();
    expect(screen.getAllByRole('row').length).toBeGreaterThan(2);

    const top = region('Lebih hemat di mana');
    await waitFor(() => expect(top.getAllByTestId('store-rank-row').length).toBe(3));
    expect(top.getAllByTestId('store-rank-row')[0]!.textContent).toContain('Alfamart · cabang tidak diketahui');
    expect(top.getByRole('link', { name: 'Lihat semua' }).getAttribute('href')).toBe(`/produk/hemat?id=${ID.milo200}`);
    expect(within(top.getAllByTestId('store-rank-row')[0]!).getByRole('link').getAttribute('href')).toBe(
      `/produk?id=${ID.milo200}&toko=20000000-0000-0000-0000-000000000002`,
    );

    const sizes = region('Ukuran lain di group ini');
    await waitFor(() => expect(sizes.getAllByTestId('size-row').length).toBe(5));
    expect(sizes.getAllByTestId('size-row')[0]!.textContent).toContain('paling hemat');
    expect(sizes.getByText('ini')).toBeTruthy();

    const rows = await screen.findAllByTestId('history-row');
    expect(rows).toHaveLength(5);
    // Baris member tidak dihitung dan bundle diberi tag teks (U-15).
    expect(screen.getAllByText('MEMBER Rp17.900 · tidak dihitung').length).toBe(1);
    expect(screen.getAllByText('BUNDLE · tidak dihitung').length).toBe(1);
    expect(screen.queryByText('dibatalkan')).toBeNull();
  });

  it('"Tampilkan yang dibatalkan" memanggil R8 dengan p_include_void dan menampilkan void dicoret', async () => {
    await openProduct(ID.milo200);
    await screen.findAllByTestId('history-row');
    await userEvent.setup().click(screen.getByLabelText('Tampilkan yang dibatalkan'));
    expect(await screen.findByText('dibatalkan')).toBeTruthy();
    expect(sb.rpc).toHaveBeenCalledWith('price_history', expect.objectContaining({ p_include_void: true }));
  });

  it('toggle "Hanya harga normal" memanggil R9 p_normal_only dan disimpan di prefs', async () => {
    await openProduct(ID.milo200);
    await screen.findByTestId('price-chart');
    await userEvent.setup().click(screen.getByLabelText('Hanya harga normal'));
    await waitFor(() =>
      expect(sb.rpc).toHaveBeenCalledWith('price_chart', { p_product_id: ID.milo200, p_normal_only: true }),
    );
    expect(screen.queryByText(/garis putus-putus/)).toBeNull();
    const { readPref } = await import('@/lib/offline/prefs');
    await waitFor(async () => expect(await readPref(ID.user, 'chart_normal_only', false)).toBe(true));
  });

  it('histori cursor: "Muat lebih banyak" mengirim p_before_date/p_before_id baris terakhir', async () => {
    const base = fx<{ id: string; transaction_date: string }[]>('history_milo200_void');
    const page1 = Array.from({ length: 20 }, (_, i) => ({
      ...base[i % base.length]!,
      id: `bbbbbbbb-0000-0000-0000-${String(i).padStart(12, '0')}`,
    }));
    state.rpcOverride = (fn, a) =>
      fn === 'price_history' && a.p_product_id === ID.milo200 && !a.p_store_id
        ? { data: a.p_before_id ? fx('history_milo200_page2') : page1, error: null }
        : undefined;
    await openProduct(ID.milo200);
    await waitFor(() => expect(screen.getAllByTestId('history-row')).toHaveLength(20));
    await userEvent.setup().click(screen.getByRole('button', { name: 'Muat lebih banyak' }));
    await waitFor(() => expect(screen.getAllByTestId('history-row').length).toBeGreaterThan(20));
    expect(sb.rpc).toHaveBeenCalledWith(
      'price_history',
      expect.objectContaining({ p_before_date: page1[19]!.transaction_date, p_before_id: page1[19]!.id, p_limit: 20 }),
    );
    expect(screen.queryByRole('button', { name: 'Muat lebih banyak' })).toBeNull();
  });

  it('filter toko dari S-05 (?toko=): R8 p_store_id + chip "Hanya AEON"', async () => {
    await openProduct(ID.milo200, `&toko=${ID.aeon}`);
    expect(await screen.findByText('Hanya AEON')).toBeTruthy();
    expect(sb.rpc).toHaveBeenCalledWith('price_history', expect.objectContaining({ p_store_id: ID.aeon }));
    expect(screen.getByRole('link', { name: 'Tampilkan semua toko' }).getAttribute('href')).toBe(
      `/produk?id=${ID.milo200}`,
    );
  });

  it('tren belum cukup: penjelasan D-44 dengan jumlah per jendela', async () => {
    await openProduct(ID.milo500);
    expect(
      screen.getByText(
        'Tren muncul setelah ada minimal 2 data di 30 hari terakhir dan 2 data di 30 hari sebelumnya. Sekarang: 1 dan 0.',
      ),
    ).toBeTruthy();
  });

  it('hanya sepanjang masa: "Belum ada harga 90 hari terakhir"', async () => {
    await openProduct(ID.milo3in1);
    const sum = within(screen.getByTestId('summary'));
    expect(sum.getByText('Belum ada harga 90 hari terakhir')).toBeTruthy();
    expect(sum.getByText(/terakhir dicatat 5 bln lalu/)).toBeTruthy();
  });

  it('belum ada data: ajakan foto, tanpa grafik/toko; Cek harga rak tetap ada', async () => {
    await openProduct(ID.milo1kg);
    expect(screen.getByText('Foto label atau struk yang memuat produk ini.')).toBeTruthy();
    expect(screen.queryByTestId('price-chart')).toBeNull();
    expect(screen.queryByRole('region', { name: 'Lebih hemat di mana' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Cek harga rak' })).toBeTruthy();
  });

  it('hanya bundle: ajakan + jumlah data bundle', async () => {
    await openProduct(ID.indomie);
    expect(screen.getByText('Hanya ada 1 data bundle · tidak dipakai untuk harga terbaik')).toBeTruthy();
  });

  it('produk privat: PRIBADI + menu Edit/Gabungkan/Pisahkan/Hapus', async () => {
    await openProduct(ID.gula);
    expect(screen.getByText('PRIBADI')).toBeTruthy();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Lainnya' }));
    const menu = within(await screen.findByRole('dialog', { name: 'Aksi produk' }));
    for (const l of ['Edit produk', 'Gabungkan', 'Pisahkan', 'Hapus produk'])
      expect(menu.getByRole('button', { name: l })).toBeTruthy();
  });

  it('produk global: Gabungkan nonaktif dengan teks D-30', async () => {
    await openProduct(ID.milo200);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Lainnya' }));
    const menu = within(await screen.findByRole('dialog', { name: 'Aksi produk' }));
    expect((menu.getByRole('button', { name: 'Gabungkan' }) as HTMLButtonElement).disabled).toBe(true);
    expect(menu.getByText('Produk katalog umum hanya bisa digabung oleh kurator.')).toBeTruthy();
    expect(menu.queryByRole('button', { name: 'Edit produk' })).toBeNull();
  });

  it('produk sudah digabung: router.replace ke produk pengganti + toast', async () => {
    await openProduct(ID.miloDup);
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith(`/produk?id=${ID.milo200}`));
    expect(toast).toHaveBeenCalledWith('Produk ini sudah digabung ke Milo Original. Kami buka produk penggantinya.');
  });

  it('NOT_FOUND: "Produk tidak ditemukan atau bukan milikmu" + Kembali', async () => {
    setUrl('/produk', `id=${ID.unknown}`);
    await renderWithProviders(<ProductScreen />);
    expect(await screen.findByText('Produk tidak ditemukan atau bukan milikmu.')).toBeTruthy();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Kembali' }));
    expect(nav.back).toHaveBeenCalled();
  });

  it('produk timbang: harga per kg + baris histori "0,535 kg · Rp24.075"', async () => {
    await openProduct(ID.jeruk);
    expect(screen.getAllByLabelText('45.000 rupiah per kilogram').length).toBeGreaterThan(0);
    expect(await screen.findByText(/0,535 kg · Rp24\.075/)).toBeTruthy();
  });

  it('screenshot marketplace: ongkir sebagai info, belum termasuk ongkir', async () => {
    await openProduct(ID.miloUht);
    const row = within((await screen.findAllByTestId('history-row'))[0]!);
    expect(row.getByText('ongkir Rp10.000 (info)')).toBeTruthy();
    expect(row.getByText('belum termasuk ongkir')).toBeTruthy();
    expect(row.getByText(/Screenshot/)).toBeTruthy();
  });

  it('ringkasan sedang diperbarui: record lebih baru dari refreshed_at', async () => {
    state.rpcOverride = (fn, a) => {
      if (fn !== 'get_product_detail' || a.p_product_id !== ID.milo200) return undefined;
      const d = fx<{ card: { summary: { refreshed_at: string } } }>('detail_milo200');
      d.card.summary.refreshed_at = '2000-01-01T00:00:00+00:00';
      return { data: d, error: null };
    };
    await openProduct(ID.milo200);
    expect(await screen.findByText('Ringkasan sedang diperbarui…')).toBeTruthy();
  });

  it('memuat: skeleton per bagian; gagal jaringan tanpa cache → pesan + Coba lagi', async () => {
    state.rpcOverride = (fn) => (fn === 'get_product_detail' ? new Promise(() => undefined) : undefined);
    setUrl('/produk', `id=${ID.milo200}`);
    const { container, unmount } = await renderWithProviders(<ProductScreen />);
    await waitFor(() => expect(container.querySelector('[aria-busy="true"]')).toBeTruthy());
    unmount();
    state.rpcOverride = (fn) => {
      if (fn === 'get_product_detail') throw new TypeError('Failed to fetch');
      return undefined;
    };
    await renderWithProviders(<ProductScreen />);
    expect(await screen.findByText('Tidak ada sinyal. Data yang terakhir dimuat tetap ditampilkan.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Coba lagi' })).toBeTruthy();
  });

  it('dibuka → disimpan ke "Baru dicek" (prefs)', async () => {
    await openProduct(ID.milo200);
    const { readPref } = await import('@/lib/offline/prefs');
    await waitFor(async () => expect(await readPref(ID.user, 'viewed_products', [])).toEqual([ID.milo200]));
  });
});

describe('S-03b Cek harga rak (D-55)', () => {
  async function openSheet(id: string = ID.milo200) {
    setUrl('/produk', `id=${id}&sheet=cek-harga`);
    await renderWithProviders(<ProductScreen />);
    return within(await screen.findByRole('dialog', { name: 'Cek harga rak' }));
  }
  async function type(sheet: ReturnType<typeof within>, digits: string) {
    const user = userEvent.setup();
    const clear = sheet.getByRole('button', { name: 'Kosongkan' }) as HTMLButtonElement;
    if (!clear.disabled) await user.click(clear);
    for (const d of digits) await user.click(sheet.getByRole('button', { name: d }));
  }

  it('lebih murah / mendekati (≤ 5%) / lebih mahal + harga terakhir + ukuran lain', async () => {
    const sheet = await openSheet();
    await waitFor(() => expect(sb.rpc).toHaveBeenCalledWith('compare_sizes', expect.anything()));
    await type(sheet, '17000');
    expect(sheet.getByText('Lebih murah dari semua harga di historimu 90 hari terakhir.')).toBeTruthy();
    expect(sheet.getByText('Rp85/g')).toBeTruthy();
    await type(sheet, '18500');
    expect(sheet.getByText('Mendekati harga terbaikmu.')).toBeTruthy();
    await type(sheet, '25000');
    expect(sheet.getByText('39% lebih mahal dari termurahmu 90 hari')).toBeTruthy();
    expect(sheet.getByText(/28% lebih mahal dari harga terakhir/)).toBeTruthy();
    expect(sheet.getByText('Ukuran 500 g di historimu: Rp95/g (24% lebih hemat per gram)')).toBeTruthy();
    // Tidak ada RPC tulis (D-55).
    const write = new Set(['submit_capture', 'correct_price_record', 'update_capture_item']);
    expect(sb.rpc.mock.calls.filter(([fn]) => write.has(fn as string))).toEqual([]);
    expect(sheet.getByRole('link', { name: 'Foto labelnya untuk disimpan' }).getAttribute('href')).toBe(
      '/kamera?jenis=label',
    );
  });

  it('keypad menerima ketikan angka dan Backspace (§10.1)', async () => {
    const sheet = await openSheet();
    const user = userEvent.setup();
    await user.click(sheet.getByRole('button', { name: '1' }));
    await user.keyboard('9500{Backspace}0');
    expect(sheet.getByText('Rp19.500')).toBeTruthy();
  });

  it('belum ada data: hanya harga per satuan + "Belum ada pembanding"', async () => {
    const sheet = await openSheet(ID.milo1kg);
    await type(sheet, '120000');
    expect(sheet.getByText('Belum ada pembanding di historimu.')).toBeTruthy();
    expect(sheet.getByText('Rp120/g')).toBeTruthy();
  });

  it('produk timbang: input harga per kg', async () => {
    const sheet = await openSheet(ID.jeruk);
    expect(sheet.getByText('Harga per kg di rak')).toBeTruthy();
    await type(sheet, '44000');
    expect(sheet.getByText('Lebih murah dari semua harga di historimu 90 hari terakhir.')).toBeTruthy();
    expect(sheet.getByLabelText('44.000 rupiah per kilogram').textContent).toBe('Rp44.000/kg');
    expect(sheet.getByText('(Rp44/g)')).toBeTruthy();
  });

  it('ditutup: kembali ke URL tanpa ?sheet (dibuka langsung → replace)', async () => {
    await openSheet();
    await userEvent.setup().keyboard('{Escape}');
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith(`/produk?id=${ID.milo200}`, { scroll: false }));
  });

  it('tombol menempel "Cek harga rak" membuka sheet lewat router.push (?sheet=cek-harga)', async () => {
    await openProduct(ID.milo200);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Cek harga rak' }));
    expect(nav.push).toHaveBeenCalledWith(`/produk?id=${ID.milo200}&sheet=cek-harga`, { scroll: false });
  });
});
