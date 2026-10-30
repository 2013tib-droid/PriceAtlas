// @vitest-environment jsdom
// L5b M5: S-17 Gabungkan (preview, ConfirmTwice, global, sudah digabung, P0001), S-18 Pisahkan (langkah,
// RECORDS_NOT_OWNED, ulang T2 dengan id sama), S-15 edit + arsip, menu ⋯ S-03, tap histori S-03 dan
// baris S-10 mode tersimpan → S-16. Keluaran R19/R20/W9/W10/REST product ASLI (test/fixtures/rpc.json).
import '../m1/mocks';
import type { MergePreview, ProductDetail, ReceiptDetail } from '@priceatlas/contracts';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  CAT,
  freezeToday,
  fx,
  ID,
  installDomPolyfills,
  m3Ids,
  nav,
  renderWithProviders,
  resetHarness,
  sb,
  setUrl,
  state,
} from '../m1/harness';

const { MergeScreen } = await import('@/features/catalog/merge-screen');
const { SplitScreen } = await import('@/features/catalog/split-screen');
const { EditProductScreen } = await import('@/features/catalog/edit-product-screen');
const { ProductScreen } = await import('@/features/product/product-screen');
const { ReceiptScreen } = await import('@/features/receipt/receipt-screen');
const { loadSplitTarget, saveSplitTarget } = await import('@/lib/catalog/split');

installDomPolyfills();

const err = (key: string) => ({ data: null, error: fx<{ error: unknown }>(key).error });
const preview = (k: string) => fx<MergePreview>(k);
const rpcCalls = (name: string) => sb.rpc.mock.calls.filter(([fn]) => fn === name);
const restUpdates = (table: string) =>
  state.restCalls.filter((c) => c.table === table && c.calls.some(([m]) => m === 'update'));

beforeEach(async () => {
  await resetHarness();
  freezeToday();
});

/** R7 untuk produk privat dobel Citra (fixture R7 asli dengan produk dari R19 `from`). */
function dupDetail(): ProductDetail {
  const d = fx<ProductDetail>('detail_gula');
  return { ...d, card: { ...d.card, product: preview('merge_preview_ok').from } };
}

async function openMerge(into: string | null, extra?: (fn: string) => { data: unknown; error: unknown } | undefined) {
  setUrl('/produk/gabung', `id=${CAT.dup}${into ? `&ke=${into}` : ''}`);
  state.rpcOverride = (fn) =>
    extra?.(fn) ?? (fn === 'get_product_detail' ? { data: dupDetail(), error: null } : undefined);
  const view = await renderWithProviders(<MergeScreen />);
  await screen.findByTestId('merge-screen');
  return view;
}

describe('S-17 Gabungkan', () => {
  it('produk katalog umum tidak bisa memulai (D-30): teks, tanpa pemilih', async () => {
    setUrl('/produk/gabung', `id=${ID.milo200}`);
    await renderWithProviders(<MergeScreen />);
    expect((await screen.findByTestId('merge-global')).textContent).toBe(
      'Produk katalog umum hanya bisa digabung oleh kurator.',
    );
    expect(screen.queryByRole('button', { name: 'Pilih produk tujuan' })).toBeNull();
  });

  it('pilih tujuan → S-14 mode target merge: sumber disembunyikan, tanpa "Buat produk baru"', async () => {
    setUrl('/produk/gabung', `id=${ID.gula}`);
    const view = await renderWithProviders(<MergeScreen />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Pilih produk tujuan' }));
    expect(String(nav.push.mock.calls[0]![0])).toMatch(/pilih=produk&untuk=merge/);
    setUrl('/produk/gabung', `id=${ID.gula}&pilih=produk&untuk=merge`);
    view.rerenderUi(<MergeScreen />);
    expect(await screen.findByRole('dialog', { name: 'Gabungkan ke…' })).toBeTruthy();
    const input = screen.getByLabelText('Cari produk');
    await user.clear(input);
    await user.type(input, 'gula');
    const picker = within(screen.getByTestId('product-picker'));
    await waitFor(() => expect(picker.queryByText('Ketik minimal 2 huruf untuk mencari.')).toBeNull());
    await waitFor(() => expect(picker.queryByRole('status')).toBeNull());
    expect(picker.queryByRole('button', { name: /Pilih Gula Pasir Curah/ })).toBeNull();
    expect(picker.queryByRole('button', { name: '+ Buat produk baru' })).toBeNull();
  });

  it('ukuran sama: pratinjau R19 (jumlah, tidak bisa dibatalkan) → Gabungkan → W10 → produk tujuan', async () => {
    await openMerge(CAT.gulaAren);
    expect((await screen.findByTestId('merge-counts')).textContent).toBe('Pindah: 2 harga · 1 alias · 1 barcode');
    expect(screen.getByText(/akan menjadi rujukan ke produk tujuan\. Tidak bisa dibatalkan\./)).toBeTruthy();
    expect(screen.queryByTestId('merge-mismatch')).toBeNull();
    await userEvent.setup().click(screen.getByTestId('merge-confirm'));
    await waitFor(() =>
      expect(sb.rpc).toHaveBeenCalledWith('merge_product', { p_from: CAT.dup, p_into: CAT.gulaAren }),
    );
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith(`/produk?id=${CAT.gulaAren}`));
    expect(toast.success).toHaveBeenCalledWith('"Gula Aren Bubuk Kebun" digabung ke Gula Aren Bubuk.');
  });

  it('beda ukuran (U-16): peringatan + ConfirmTwice (tekan dua kali) + "Pindahkan ke group"', async () => {
    await openMerge(CAT.big);
    expect((await screen.findByTestId('merge-mismatch')).textContent).toMatch(/^Ukuran berbeda: 250 g vs 1 kg\./);
    const user = userEvent.setup();
    const confirm = screen.getByTestId('merge-confirm');
    await user.click(confirm);
    expect(confirm.dataset.armed).toBe('true');
    expect(confirm.textContent).toBe('Ya, tetap gabungkan');
    expect(screen.getByText('Tekan sekali lagi untuk menggabungkan walaupun ukurannya berbeda.')).toBeTruthy();
    expect(rpcCalls('merge_product')).toHaveLength(0);
    await user.click(confirm);
    await waitFor(() => expect(rpcCalls('merge_product')).toHaveLength(1));
  });

  it('"Pindahkan ke group" → REST PATCH product (filter updated_at) dengan group tujuan', async () => {
    await openMerge(CAT.big);
    const user = userEvent.setup();
    const move = await screen.findByTestId('merge-move-group');
    await waitFor(() => expect((move as HTMLButtonElement).disabled).toBe(false));
    await user.click(move);
    await waitFor(() => expect(restUpdates('product')).toHaveLength(1));
    const calls = restUpdates('product')[0]!.calls;
    expect(calls[0]).toEqual(['update', [{ product_group_id: preview('merge_preview_size').into.product_group_id }]]);
    expect(calls).toContainEqual(['eq', ['updated_at', fx<{ updated_at: string }[]>('rest_product')[0]!.updated_at]]);
    expect(toast.success).toHaveBeenCalledWith(expect.stringMatching(/masuk ke group yang sama/));
  });

  it('beda dimensi: "(satuan berbeda)"; ke katalog: barcode PRIBADI tetap (F-01/D-65)', async () => {
    await openMerge(CAT.syrup);
    expect((await screen.findByTestId('merge-mismatch')).textContent).toMatch(/250 g vs 500 ml \(satuan berbeda\)/);
  });

  it('ke produk katalog umum: barcode privat tidak pindah', async () => {
    await openMerge(ID.milo200);
    expect((await screen.findByTestId('merge-barcodes-kept')).textContent).toBe(
      '1 barcode PRIBADI tetap di produk lama (tidak pindah ke produk katalog umum).',
    );
    expect(screen.getByTestId('merge-pair').textContent).toMatch(/\(katalog\)/);
  });

  it('sudah digabung ke tujuan yang sama (R19 asli) = sukses, tanpa tombol', async () => {
    await openMerge(CAT.gulaAren, (fn) =>
      fn === 'merge_product_preview' ? { data: preview('merge_preview_already'), error: null } : undefined,
    );
    expect((await screen.findByTestId('merge-already')).textContent).toMatch(/sudah digabung ke/);
    expect(screen.queryByTestId('merge-confirm')).toBeNull();
  });

  it('W10 gagal tetapi sumber ternyata sudah digabung ke tujuan (respons hilang) → sukses', async () => {
    let merged = false;
    await openMerge(CAT.gulaAren, (fn) => {
      if (fn === 'merge_product') {
        merged = true;
        return { data: null, error: { message: 'Failed to fetch' } };
      }
      if (fn === 'merge_product_preview' && merged) return { data: preview('merge_preview_already'), error: null };
      return undefined;
    });
    await userEvent.setup().click(await screen.findByTestId('merge-confirm'));
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith(`/produk?id=${CAT.gulaAren}`));
    expect(toast.success).toHaveBeenCalledWith(expect.stringMatching(/sudah digabung ke/));
  });

  it('P0001 (W10 asli: tujuan tidak aktif) → pesan §8.2', async () => {
    await openMerge(CAT.gulaAren, (fn) => (fn === 'merge_product' ? err('merge_target_inactive') : undefined));
    await userEvent.setup().click(await screen.findByTestId('merge-confirm'));
    expect((await screen.findByTestId('merge-error')).textContent).toBe(
      'Produk tujuan tidak aktif atau bukan milikmu. Pilih produk lain.',
    );
  });

  it('42501 (W10 asli) → teks D-30', async () => {
    await openMerge(CAT.gulaAren, (fn) => (fn === 'merge_product' ? err('merge_forbidden') : undefined));
    await userEvent.setup().click(await screen.findByTestId('merge-confirm'));
    expect((await screen.findByTestId('merge-error')).textContent).toBe(
      'Produk katalog umum hanya bisa digabung oleh kurator.',
    );
  });

  it('tujuan tidak bisa (R19 alasan) → pesan, tanpa tombol gabung', async () => {
    const blocked = { ...preview('merge_preview_ok'), can_merge: false, reason: 'target_not_active' as const };
    await openMerge(CAT.gulaAren, (fn) =>
      fn === 'merge_product_preview' ? { data: blocked, error: null } : undefined,
    );
    expect((await screen.findByTestId('merge-blocked')).textContent).toBe(
      'Produk tujuan tidak aktif. Pilih produk lain.',
    );
    expect(screen.queryByTestId('merge-confirm')).toBeNull();
  });
});

describe('S-18 Pisahkan', () => {
  const rows = () => fx<{ id: string; source_type: string; store_name: string }[]>('split_history');
  const target = { id: CAT.dup, name: 'Gula Aren Bubuk Kebun 250 g', created: false, saved: true };

  async function openSplit(extra?: (fn: string) => { data: unknown; error: unknown } | undefined) {
    setUrl('/produk/pisah', `id=${ID.milo500}`);
    state.rpcOverride = (fn, a) =>
      extra?.(fn) ??
      (fn === 'price_history' && a.p_product_id === ID.milo500 ? { data: rows(), error: null } : undefined);
    const view = await renderWithProviders(<SplitScreen />);
    await screen.findByTestId('split-screen');
    return view;
  }

  it('langkah 1: produk katalog umum boleh (hanya record milik sendiri), dua pilihan tujuan', async () => {
    await openSplit();
    expect(screen.getByText('Produk katalog umum: hanya data harga milikmu yang dipindah.')).toBeTruthy();
    expect(screen.getByText('Langkah 1 dari 4')).toBeTruthy();
    const user = userEvent.setup();
    await user.click(screen.getByTestId('split-pick'));
    expect(String(nav.push.mock.calls[0]![0])).toMatch(/pilih=produk&untuk=split/);
  });

  it('langkah 2–4: filter, centang (tombol nonaktif sampai dicentang), alias, konfirmasi → W9', async () => {
    saveSplitTarget(ID.milo500, target);
    await openSplit();
    expect(screen.getByTestId('split-screen').dataset.step).toBe('2');
    await screen.findByTestId('split-records');
    expect(screen.getByTestId('split-target').textContent).toMatch(/Tujuan: Gula Aren Bubuk Kebun 250 g/);
    const next = () => screen.getByTestId('split-next') as HTMLButtonElement;
    expect(next().disabled).toBe(true);
    expect(screen.getByTestId('split-count').textContent).toBe('Belum ada yang dicentang.');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Struk' }));
    let list = within(screen.getByTestId('split-records'));
    expect(list.getAllByRole('checkbox')).toHaveLength(1);
    await user.click(list.getByRole('checkbox'));
    await user.click(screen.getAllByRole('button', { name: 'Semua' })[1]!);
    list = within(screen.getByTestId('split-records'));
    expect(list.getAllByRole('checkbox')).toHaveLength(3);
    expect(screen.getByTestId('split-count').textContent).toBe('1 dicentang');
    await user.click(next());
    // Langkah 3: alias dari teks baris struk (R20 record struk yang dicentang).
    const alias = await screen.findByRole('checkbox', { name: /Teks 'MILO ORI 500G' di AEON/ });
    await user.click(alias);
    await user.click(next());
    expect(screen.getByTestId('split-summary').textContent).toBe(
      'Pindahkan 1 harga dari "Milo Original 500 g" ke "Gula Aren Bubuk Kebun 250 g".',
    );
    await user.click(screen.getByTestId('split-move'));
    const receiptRow = rows().find((r) => r.source_type === 'receipt')!;
    await waitFor(() =>
      expect(sb.rpc).toHaveBeenCalledWith('move_price_records', {
        p_record_ids: [receiptRow.id],
        p_target_product_id: CAT.dup,
        p_alias: { store_id: '20000000-0000-0000-0000-000000000001', alias_text: 'MILO ORI 500G' },
      }),
    );
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith(`/produk?id=${CAT.dup}`));
    expect(toast.success).toHaveBeenCalledWith('1 harga dipindahkan ke Gula Aren Bubuk Kebun 250 g.');
    expect(loadSplitTarget(ID.milo500)).toBeNull();
  });

  it('RECORDS_NOT_OWNED (W9 asli) → pesan + daftar dimuat ulang, kembali ke langkah 2', async () => {
    saveSplitTarget(ID.milo500, target);
    await openSplit((fn) => (fn === 'move_price_records' ? err('move_not_owned') : undefined));
    await screen.findByTestId('split-records');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Centang semua yang tampil' }));
    await user.click(screen.getByTestId('split-next'));
    await user.click(screen.getByTestId('split-next'));
    await user.click(screen.getByTestId('split-move'));
    expect((await screen.findByTestId('split-error')).textContent).toBe(
      'Sebagian data yang dipilih bukan milikmu. Muat ulang daftar lalu pilih lagi.',
    );
    await waitFor(() => expect(screen.getByTestId('split-screen').dataset.step).toBe('2'));
    expect(rpcCalls('price_history').length).toBeGreaterThanOrEqual(2);
  });

  it('gagal di antara T1 dan T2 → "Coba lagi" mengulang T2 dengan id produk yang sama (§4.5)', async () => {
    let fail = true;
    await openSplit((fn) => {
      if (fn !== 'move_price_records') return undefined;
      if (fail) {
        fail = false;
        return { data: null, error: { message: 'Failed to fetch' } };
      }
      return undefined;
    });
    const user = userEvent.setup();
    // T1: produk baru lewat S-15 (W8) dengan id yang disimpan sebelum dikirim.
    await user.click(screen.getByTestId('split-create'));
    const pending = loadSplitTarget(ID.milo500)!;
    expect(pending).toMatchObject({ created: true, saved: false });
    const name = await screen.findByLabelText('Nama');
    expect((name as HTMLInputElement).value).toBe('Milo Original');
    await user.click(screen.getByRole('button', { name: 'Simpan produk' }));
    await waitFor(() => expect(rpcCalls('create_private_product')).toHaveLength(1));
    expect((rpcCalls('create_private_product')[0]![1] as { p_product: { id: string } }).p_product.id).toBe(pending.id);
    await waitFor(() => expect(screen.getByTestId('split-screen').dataset.step).toBe('2'));
    await screen.findByTestId('split-records');
    const saved = loadSplitTarget(ID.milo500)!;
    expect(saved).toMatchObject({ saved: true, created: true });
    await user.click(screen.getByRole('button', { name: 'Centang semua yang tampil' }));
    await user.click(screen.getByTestId('split-next'));
    await user.click(screen.getByTestId('split-next'));
    await user.click(screen.getByTestId('split-move'));
    expect(await screen.findByTestId('split-error')).toBeTruthy();
    const retry = screen.getByTestId('split-move');
    expect(retry.textContent).toBe('Coba lagi (produk tujuan yang sama)');
    await user.click(retry);
    await waitFor(() => expect(rpcCalls('move_price_records')).toHaveLength(2));
    const [a, b] = rpcCalls('move_price_records').map(
      ([, x]) => (x as { p_target_product_id: string }).p_target_product_id,
    );
    expect(a).toBe(b);
    expect(a).toBe(saved.id);
  });
});

describe('S-15 edit + arsip', () => {
  async function openEdit(id: string = CAT.syrup) {
    setUrl('/produk/edit', `id=${id}`);
    const view = await renderWithProviders(<EditProductScreen />);
    return view;
  }

  it('produk privat: isian dari REST product, simpan nonaktif sampai ada perubahan', async () => {
    await openEdit();
    const name = (await screen.findByLabelText('Nama')) as HTMLInputElement;
    expect(name.value).toBe('Sirup Gula Aren');
    expect((screen.getByLabelText('Ukuran per isi') as HTMLInputElement).value).toBe('500');
    expect((screen.getByTestId('edit-save') as HTMLButtonElement).disabled).toBe(true);
  });

  it('ubah ukuran → teks hitung ulang → PATCH dengan filter updated_at → detail produk', async () => {
    await openEdit();
    const user = userEvent.setup();
    const size = await screen.findByLabelText('Ukuran per isi');
    await user.clear(size);
    await user.type(size, '600');
    expect(screen.getByTestId('recompute').textContent).toBe(
      'Harga per satuan semua data produk ini akan dihitung ulang.',
    );
    await user.click(screen.getByTestId('edit-save'));
    await waitFor(() => expect(restUpdates('product')).toHaveLength(1));
    const calls = restUpdates('product')[0]!.calls;
    expect(calls[0]).toEqual(['update', [{ content_size: 600 }]]);
    expect(calls).toContainEqual(['eq', ['id', CAT.syrup]]);
    expect(calls).toContainEqual(['eq', ['updated_at', fx<{ updated_at: string }[]>('rest_product')[0]!.updated_at]]);
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith(`/produk?id=${CAT.syrup}`));
    expect(toast.success).toHaveBeenCalledWith('Produk Sirup Gula Aren Asli diperbarui.');
  });

  it('STALE_WRITE (PATCH 0 baris) → baris terbaru dimuat, perubahan yang masih berlaku tetap', async () => {
    let first = true;
    state.rest.product = (c) => {
      if (c.calls.some(([m]) => m === 'update')) return { data: fx('patch_product_stale'), error: null };
      if (first) {
        first = false;
        return { data: fx('rest_product'), error: null };
      }
      return { data: fx('patch_product_ok'), error: null };
    };
    await openEdit();
    const user = userEvent.setup();
    const variant = await screen.findByLabelText('Varian (opsional)');
    await user.type(variant, 'botol');
    await user.click(screen.getByTestId('edit-save'));
    expect((await screen.findByTestId('edit-error')).textContent).toBe(
      'Produk ini baru saja berubah. Perubahanmu yang masih berlaku ditampilkan lagi.',
    );
    expect((screen.getByLabelText('Nama') as HTMLInputElement).value).toBe('Sirup Gula Aren Asli');
    expect((screen.getByLabelText('Varian (opsional)') as HTMLInputElement).value).toBe('botol');
  });

  it('23514 (REST asli) → pesan ukuran pada field', async () => {
    state.rest.product = (c) =>
      c.calls.some(([m]) => m === 'update')
        ? { data: null, error: fx<{ error: unknown }>('patch_product_23514').error }
        : { data: fx('rest_product'), error: null };
    await openEdit();
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Varian (opsional)'), 'x');
    await user.click(screen.getByTestId('edit-save'));
    expect((await screen.findByTestId('edit-error')).textContent).toBe(
      'Isi ukuran kemasan untuk produk yang dijual per kemasan.',
    );
  });

  it('produk katalog umum → tidak bisa diedit (D-38)', async () => {
    state.rest.product = () => ({ data: fx('rest_product_global'), error: null });
    await openEdit(ID.milo200);
    expect((await screen.findByTestId('edit-blocked')).textContent).toMatch(/Produk katalog umum tidak bisa diedit/);
  });

  it('Hapus produk → konfirmasi → PATCH status archived → beranda', async () => {
    await openEdit();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Hapus produk' }));
    const confirm = await screen.findByTestId('archive-confirm');
    await waitFor(() => expect((confirm as HTMLButtonElement).disabled).toBe(false));
    await user.click(confirm);
    await waitFor(() => expect(restUpdates('product')).toHaveLength(1));
    expect(restUpdates('product')[0]!.calls[0]).toEqual(['update', [{ status: 'archived' }]]);
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith('/'));
    expect(toast.success).toHaveBeenCalledWith(expect.stringMatching(/dihapus\.$/));
  });
});

describe('Sambungan ke S-16 (D-85, F-35, F-52, D-87)', () => {
  it('S-03: baris histori bisa di-tap → /harga?id=', async () => {
    setUrl('/produk', `id=${ID.milo200}`);
    await renderWithProviders(<ProductScreen />);
    const rows = await screen.findAllByTestId('history-row');
    const first = fx<{ id: string }[]>('history_milo200')[0]!;
    expect(within(rows[0]!).getByRole('link').getAttribute('href')).toBe(`/harga?id=${first.id}`);
  });

  it('S-03 menu ⋯ produk privat: "Hapus produk" → dialog arsip', async () => {
    setUrl('/produk', `id=${ID.gula}`);
    await renderWithProviders(<ProductScreen />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Lainnya' }));
    await user.click(await screen.findByRole('button', { name: 'Hapus produk' }));
    expect(await screen.findByRole('dialog', { name: 'Hapus produk ini?' })).toBeTruthy();
  });

  it('S-10 mode tersimpan: baris di-tap → S-16; editor kecil W7 tetap ada', async () => {
    setUrl('/struk', `id=${m3Ids().receipts.aeon}`);
    const confirmed = fx<ReceiptDetail>('receipt_confirmed');
    state.rpcOverride = (fn) => (fn === 'get_receipt' ? { data: confirmed, error: null } : undefined);
    await renderWithProviders(<ReceiptScreen />);
    const links = await screen.findAllByTestId('saved-line-link');
    const withRecord = confirmed.lines.filter((l) => l.record && l.line_type === 'product');
    expect(links.map((a) => a.getAttribute('href'))).toEqual(withRecord.map((l) => `/harga?id=${l.record!.id}`));
    expect(within(screen.getAllByTestId('saved-line')[0]!).getByRole('button', { name: 'Koreksi' })).toBeTruthy();
  });
});
