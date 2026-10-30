// @vitest-environment jsdom
// L5b M5: S-16 Detail & koreksi harga (`/harga?id=`) di setiap keadaan §7.3, memakai keluaran R20/W6/W7
// ASLI (test/fixtures/rpc.json: record label, struk, screenshot, gambar dihapus, riwayat audit,
// STALE_WRITE, NO_APPLICABLE_PRICE, USE_RECEIPT_LINE, INVALID_EXTRA).
import '../m1/mocks';
import type { PriceRecordDetail } from '@priceatlas/contracts';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  freezeToday,
  fx,
  ID,
  installDomPolyfills,
  m5Ids,
  nav,
  renderWithProviders,
  resetHarness,
  sb,
  setUrl,
  state,
} from '../m1/harness';

const { RecordScreen, recordTarget } = await import('@/features/record/record-screen');
const { completeLocationPick } = await import('@/lib/confirm/location-handoff');

installDomPolyfills();

const err = (key: string) => ({ data: null, error: fx<{ error: unknown }>(key).error });
const detail = (k: string) => fx<PriceRecordDetail>(`record_${k}`);

beforeEach(async () => {
  await resetHarness();
  freezeToday();
});

async function open(key: 'label' | 'receipt' | 'shopee', override?: PriceRecordDetail) {
  const id = m5Ids().records[key];
  setUrl('/harga', `id=${id}`);
  if (override)
    state.rpcOverride = (fn) => (fn === 'price_record_detail' ? { data: override, error: null } : undefined);
  const view = await renderWithProviders(<RecordScreen />);
  await screen.findByTestId('record-screen');
  return { ...view, id };
}
const saveBtn = () => screen.getByTestId('save-record') as HTMLButtonElement;
const w6Calls = () => sb.rpc.mock.calls.filter(([fn]) => fn === 'correct_price_record');

describe('S-16 keadaan dasar', () => {
  it('memuat: skeleton tanpa spinner tengah', async () => {
    setUrl('/harga', `id=${m5Ids().records.label}`);
    state.rpcOverride = (fn) => (fn === 'price_record_detail' ? new Promise(() => undefined) : undefined);
    await renderWithProviders(<RecordScreen />);
    expect(screen.getByRole('status').textContent).toBe('Memuat…');
  });

  it('NOT_FOUND (R20 asli) → pesan + Kembali', async () => {
    setUrl('/harga', `id=${ID.unknown}`);
    await renderWithProviders(<RecordScreen />);
    expect(await screen.findByText('Data ini tidak ditemukan. Mungkin sudah dihapus.')).toBeTruthy();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Kembali' }));
    expect(nav.back).toHaveBeenCalled();
  });

  it('dari label: harga tersimpan, produk katalog, gambar sumber, info pengenalan, riwayat, aturan member', async () => {
    const { id } = await open('label');
    expect(screen.getByTestId('record-screen').dataset.source).toBe('price_label');
    expect(screen.getByText('Dari label harga')).toBeTruthy();
    expect(screen.getByTestId('saved-price').textContent).toMatch(/Rp17\.500PROMO/);
    expect(await screen.findByRole('link', { name: /Milo Original/ })).toBeTruthy();
    expect(screen.getByText('Produk katalog umum: yang kamu ubah hanya data harga ini, bukan produknya.')).toBeTruthy();
    expect(await screen.findByRole('img', { name: 'Gambar sumber harga ini' })).toBeTruthy();
    expect(state.storage.createSignedUrl).toHaveBeenCalledWith(detail('label').image!.storage_path, 300);
    expect(screen.getByTestId('matching').textContent).toBe(
      'Dikenali otomatis dari barcode · dikonfirmasi · keyakinan 100%',
    );
    expect(within(screen.getByTestId('history')).getByText('Dibuat')).toBeTruthy();
    expect(screen.getByTestId('member-rule').textContent).toMatch(/tidak mengubah data lama/);
    expect((screen.getByLabelText('Harga normal') as HTMLInputElement).value).toBe('19500');
    expect(saveBtn().disabled).toBe(true);
    expect(saveBtn().textContent).toBe('Belum ada perubahan.');
    expect(screen.getByRole('button', { name: 'Batalkan data ini' })).toBeTruthy();
    void id;
  });

  it('gambar sudah dihapus retensi → "Gambar dihapus", tanpa signed URL', async () => {
    await open('label', detail('label_purged'));
    expect(screen.getByTestId('image-purged').textContent).toBe('Gambar dihapus (disimpan 12 bulan).');
    expect(state.storage.createSignedUrl).not.toHaveBeenCalled();
  });

  it('riwayat audit asli: perubahan harga normal (terbaru di atas)', async () => {
    await open('label', detail('label_corrected'));
    const items = within(screen.getByTestId('history')).getAllByRole('listitem');
    expect(items[0]!.textContent).toMatch(/Diubah.*harga normal: Rp19\.500 → Rp19\.900/);
    expect(items.at(-1)!.textContent).toMatch(/^Dibuat/);
  });
});

describe('S-16 simpan (W6) dan konflik', () => {
  it('ubah harga observasi → W6 dengan p_expected_updated_at → toast + ringkasan diperbarui', async () => {
    const { id } = await open('label');
    const user = userEvent.setup();
    const normal = screen.getByLabelText('Harga normal');
    await user.clear(normal);
    await user.type(normal, '19.900');
    expect(screen.getByText('Harga efektif dan harga per satuan dihitung ulang setelah disimpan.')).toBeTruthy();
    await user.click(saveBtn());
    await waitFor(() =>
      expect(sb.rpc).toHaveBeenCalledWith('correct_price_record', {
        p_id: id,
        p_patch: { normal_price: 19900 },
        p_expected_updated_at: detail('label').record.updated_at,
        p_update_alias: false,
      }),
    );
    expect(toast.success).toHaveBeenCalledWith('Perubahan tersimpan.');
    expect(await screen.findByTestId('summary-updating')).toBeTruthy();
    // Ringkasan produk record dipantau lewat R4 (tanpa optimistic update angka harga).
    await waitFor(() =>
      expect(sb.rpc).toHaveBeenCalledWith('get_product_cards', { p_ids: [detail('label').record.product_id] }),
    );
  });

  it('STALE_WRITE → versi terbaru dimuat, perubahan yang masih berlaku ditampilkan lagi, simpan ulang', async () => {
    const { id } = await open('label');
    let stale = true;
    state.rpcOverride = (fn) => {
      if (fn === 'correct_price_record' && stale) {
        stale = false;
        return err('correct_stale');
      }
      if (fn === 'price_record_detail' && !stale) return { data: detail('label_corrected'), error: null };
      return undefined;
    };
    const user = userEvent.setup();
    const normal = screen.getByLabelText('Harga normal');
    await user.clear(normal);
    await user.type(normal, '18000');
    await user.type(screen.getByLabelText('Catatan'), 'rak bawah');
    await user.click(saveBtn());
    expect((await screen.findByTestId('record-error')).textContent).toMatch(/baru saja berubah di tempat lain/);
    expect((await screen.findByTestId('conflict-notice')).textContent).toBe(
      'Perubahanmu yang masih berlaku ditampilkan lagi: harga normal, catatan.',
    );
    expect((screen.getByLabelText('Harga normal') as HTMLInputElement).value).toBe('18000');
    await user.click(saveBtn());
    await waitFor(() => expect(w6Calls()).toHaveLength(2));
    expect(w6Calls()[1]![1]).toEqual({
      p_id: id,
      p_patch: { normal_price: 18000, extra: { note: 'rak bawah' } },
      p_expected_updated_at: detail('label_corrected').record.updated_at,
      p_update_alias: false,
    });
  });

  it('NO_APPLICABLE_PRICE (W6 asli) → pesan §8.2 + fokus ke harga normal', async () => {
    await open('label');
    state.rpcOverride = (fn) => (fn === 'correct_price_record' ? err('correct_no_price') : undefined);
    const user = userEvent.setup();
    await user.clear(screen.getByLabelText('Harga normal'));
    await user.clear(screen.getByLabelText('Harga promo'));
    await user.click(saveBtn());
    expect((await screen.findByTestId('record-error')).textContent).toMatch(/Belum ada harga yang berlaku untukmu/);
    const normal = screen.getByLabelText('Harga normal');
    expect(normal.getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(normal);
  });

  it('INVALID_EXTRA (kontrak D-66) dicegah di klien: tautan listing bukan https', async () => {
    await open('shopee');
    const user = userEvent.setup();
    const url = screen.getByLabelText('Tautan listing (https://)');
    await user.clear(url);
    await user.type(url, 'http://contoh.test');
    await user.click(saveBtn());
    expect((await screen.findByTestId('record-error')).textContent).toBe(
      'Info tambahan (ongkir, voucher, catatan) tidak valid. Periksa lagi isiannya.',
    );
    expect(w6Calls()).toHaveLength(0);
  });

  it('INVALID_EXTRA dari server (W6 asli) → pesan + fokus ke info tambahan', async () => {
    await open('shopee');
    state.rpcOverride = (fn) => (fn === 'correct_price_record' ? err('correct_invalid_extra') : undefined);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Catatan'), 'x');
    await user.click(saveBtn());
    expect((await screen.findByTestId('record-error')).textContent).toMatch(/Info tambahan/);
    expect(document.activeElement).toBe(screen.getByLabelText('Catatan'));
  });

  it('lokasi dari S-12 (mode koreksi) → store_id + branch_id di patch', async () => {
    const id = m5Ids().records.label;
    completeLocationPick(recordTarget(id), {
      store: { id: '20000000-0000-0000-0000-000000000002', name: 'Alfamart', channel: 'offline', is_private: false },
      branch: null,
    });
    await open('label');
    expect(await screen.findByText(/Alfamart · cabang tidak diketahui/)).toBeTruthy();
    await userEvent.setup().click(saveBtn());
    await waitFor(() =>
      expect(w6Calls()[0]![1]).toMatchObject({
        p_patch: { store_id: '20000000-0000-0000-0000-000000000002', branch_id: null },
      }),
    );
  });

  it('"Ubah toko/cabang" → S-12 mode koreksi dengan kembali ke S-16', async () => {
    const { id } = await open('label');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Ubah toko/cabang' }));
    const href = String(nav.push.mock.calls[0]![0]);
    expect(href).toMatch(/^\/lokasi\?mode=koreksi/);
    expect(new URL(href, 'http://x').searchParams.get('untuk')).toBe(`record:${id}`);
    expect(new URL(href, 'http://x').searchParams.get('kembali')).toBe(`/harga?id=${id}`);
  });
});

describe('S-16 record struk dan screenshot', () => {
  it('struk: angka terkunci (D-23), "Ubah baris struk" → W7, "Buka struk" → S-10', async () => {
    await open('receipt');
    const d = detail('receipt');
    expect(screen.getByTestId('record-screen').dataset.source).toBe('receipt');
    expect((screen.getByLabelText('Harga normal') as HTMLInputElement).readOnly).toBe(true);
    expect(screen.queryByLabelText('Tanggal transaksi')).toBeNull();
    expect(screen.getByTestId('receipt-locked').textContent).toMatch(/mengubah baris struk/);
    expect(screen.getByRole('link', { name: 'Buka struk (tanggal & toko)' }).getAttribute('href')).toBe(
      `/struk?id=${d.record.receipt_id}`,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Ubah baris struk' }));
    const amount = await screen.findByLabelText('Total baris (Rp)');
    await user.clear(amount);
    await user.type(amount, '88000');
    await user.click(screen.getByRole('button', { name: 'Simpan koreksi' }));
    await waitFor(() =>
      expect(sb.rpc).toHaveBeenCalledWith('correct_receipt_line', {
        p_line_id: d.receipt_line!.id,
        p_patch: { line_amount: 88000 },
        p_expected_updated_at: d.receipt_line!.updated_at,
      }),
    );
    expect(toast.success).toHaveBeenCalledWith('Baris diperbarui. Ringkasan menyusul dalam beberapa detik.');
  });

  it('struk: USE_RECEIPT_LINE (W6 asli) → pesan + tombol "Ubah baris struk"', async () => {
    await open('receipt');
    state.rpcOverride = (fn) => (fn === 'correct_price_record' ? err('correct_use_receipt_line') : undefined);
    const user = userEvent.setup();
    await user.click(screen.getByLabelText('Bundle (tidak ikut harga terbaik dan tren)'));
    await user.click(saveBtn());
    // §8.2: editor baris struk (W7) langsung dibuka; pesan tetap tampil setelah ditutup.
    const dialog = await screen.findByRole('dialog', { name: 'Koreksi baris' });
    await user.click(within(dialog).getByRole('button', { name: 'Batal' }));
    const box = await screen.findByTestId('record-error');
    expect(box.textContent).toMatch('Harga dari struk diubah lewat baris struknya.');
    expect(within(box).getByRole('button', { name: 'Ubah baris struk' })).toBeTruthy();
  });

  it('struk: ganti produk (S-14) + tawaran alias → W6 product_id + p_update_alias', async () => {
    const id = m5Ids().records.receipt;
    setUrl('/harga', `id=${id}&pilih=produk&untuk=record:${id}`);
    const view = await renderWithProviders(<RecordScreen />);
    const picker = within(await screen.findByTestId('product-picker'));
    expect(picker.getByText('Untuk "MILO ORI 500G"')).toBeTruthy();
    const user = userEvent.setup();
    const input = screen.getByLabelText('Cari produk');
    await user.clear(input);
    await user.type(input, 'milo');
    await user.click(await picker.findByRole('button', { name: 'Pilih Milo Original 200 g' }));
    // Lapisan ditutup (router tiruan: URL tanpa `pilih`).
    setUrl('/harga', `id=${id}`);
    view.rerenderUi(<RecordScreen />);
    expect((await screen.findByTestId('picked-product')).textContent).toMatch(/Diganti ke: Milo Original 200 g/);
    const alias = screen.getByRole('checkbox', { name: /Perbarui juga alias 'MILO ORI 500G' di AEON\?/ });
    await user.click(alias);
    await user.click(saveBtn());
    await waitFor(() =>
      expect(w6Calls()[0]![1]).toEqual({
        p_id: id,
        p_patch: { product_id: ID.milo200 },
        p_expected_updated_at: detail('receipt').record.updated_at,
        p_update_alias: true,
      }),
    );
  });

  it('6b M4 (Q-87, F-72): label: tawaran alias memakai teks label dari R20 source_text', async () => {
    const id = m5Ids().records.label;
    setUrl('/harga', `id=${id}&pilih=produk&untuk=record:${id}`);
    const view = await renderWithProviders(<RecordScreen />);
    const picker = within(await screen.findByTestId('product-picker'));
    const user = userEvent.setup();
    const input = screen.getByLabelText('Cari produk');
    await user.clear(input);
    await user.type(input, 'milo');
    await user.click(await picker.findByRole('button', { name: 'Pilih Milo Original 500 g' }));
    setUrl('/harga', `id=${id}`);
    view.rerenderUi(<RecordScreen />);
    await screen.findByTestId('picked-product');
    expect(screen.getByRole('checkbox', { name: /Perbarui juga alias 'MILO ORIGINAL 200G' di / })).toBeTruthy();
    expect(screen.queryByRole('checkbox', { name: /alias teks ini/ })).toBeNull();
  });

  it('6b M4: R20 tanpa source_text (cache lama) → kalimat umum untuk label', async () => {
    const id = m5Ids().records.label;
    const old: Record<string, unknown> = { ...detail('label') };
    delete old.source_text;
    state.rpcOverride = (fn) => (fn === 'price_record_detail' ? { data: old, error: null } : undefined);
    setUrl('/harga', `id=${id}&pilih=produk&untuk=record:${id}`);
    const view = await renderWithProviders(<RecordScreen />);
    const picker = within(await screen.findByTestId('product-picker'));
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Cari produk'), 'milo');
    await user.click(await picker.findByRole('button', { name: 'Pilih Milo Original 500 g' }));
    setUrl('/harga', `id=${id}`);
    view.rerenderUi(<RecordScreen />);
    await screen.findByTestId('picked-product');
    expect(screen.getByRole('checkbox', { name: /Perbarui juga alias teks ini di / })).toBeTruthy();
  });

  it('screenshot: ongkir/voucher sebagai info; extra dikirim utuh (D-36, D-66)', async () => {
    const { id } = await open('shopee');
    expect(screen.getByText('Dari screenshot')).toBeTruthy();
    expect(screen.getByText(/hanya info: tidak mengubah harga efektif/)).toBeTruthy();
    const ship = screen.getByLabelText('Ongkir') as HTMLInputElement;
    expect(ship.value).toBe('9000');
    const user = userEvent.setup();
    await user.clear(ship);
    await user.type(ship, '12.000');
    await user.click(saveBtn());
    await waitFor(() =>
      expect(w6Calls()[0]![1]).toMatchObject({
        p_id: id,
        p_patch: {
          extra: {
            listing_url: 'https://shopee.co.id/milo-original-500g',
            listing_title: 'Milo Original 500 g Nestle',
            shipping_fee: 12000,
          },
        },
      }),
    );
  });

  it('"Batalkan data ini" → konfirmasi → W6 status void → toast', async () => {
    const { id } = await open('shopee');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Batalkan data ini' }));
    await user.click(await screen.findByTestId('void-confirm'));
    await waitFor(() =>
      expect(sb.rpc).toHaveBeenCalledWith('correct_price_record', {
        p_id: id,
        p_patch: { status: 'void' },
        p_expected_updated_at: detail('shopee').record.updated_at,
      }),
    );
    expect(toast.success).toHaveBeenCalledWith('Data harga dibatalkan.');
  });

  it('record dibatalkan (R20 asli): label "dibatalkan" + "Aktifkan lagi"', async () => {
    await open('shopee', detail('shopee_void'));
    expect(screen.getByTestId('saved-price').textContent).toMatch(/Data ini dibatalkan\./);
    expect(screen.getByRole('button', { name: 'Aktifkan lagi' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Batalkan data ini' })).toBeNull();
  });
});
