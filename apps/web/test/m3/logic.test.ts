// L5a M3 (docs/07 §11.1): pemetaan aksi baris → p_lines, "Benarkan semua" (≥ 3, U-12), field ragu
// (τ R2), turunan skema form S-15 dari kontrak, debounce + konflik W18, peringatan beda ukuran,
// pemetaan error §8.2 untuk S-10/S-11/S-12/S-15. Fixture = keluaran RPC asli (test/fixtures/rpc.json).
import {
  CreatePrivateProductInput,
  RPC_INPUTS,
  type CaptureItem,
  type ReceiptDetail,
  type ReceiptLine,
} from '@priceatlas/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isAlreadyCreated, itemsError, locationError, productError, receiptError } from '@/lib/confirm/errors';
import { ItemPatchQueue, stillApplicable, type ItemPatchDeps } from '@/lib/confirm/item-patch';
import {
  completeLocationPick,
  openedFromApp,
  openLocationHref,
  safeBack,
  takeLocationPick,
} from '@/lib/confirm/location-handoff';
import {
  defaultProductForm,
  previewUnitPrice,
  productFormSchema,
  toProductInput,
  type ProductFormValues,
} from '@/lib/confirm/product-form';
import {
  ACCEPT_ALL_MIN,
  acceptAll,
  affectedProductIds,
  attachedTotals,
  canAcceptAll,
  clearReceiptState,
  doubtfulFields,
  groupLines,
  isDoubtfulMatch,
  loadReceiptState,
  saveReceiptState,
  savedCountAfter,
  toPLines,
  undecidedLines,
} from '@/lib/confirm/receipt';
import { parseTextSize, sizeMismatch } from '@/lib/confirm/size';
import { fromRpcError } from '@/lib/data/errors';
import { fx } from '../m1/harness';

const TAU = 0.9;
const err = (key: string) => fromRpcError(fx<{ error: { message: string } }>(key).error);
const receipt = (k = 'aeon') => fx<ReceiptDetail>(`receipt_${k}`);

function withLines(r: ReceiptDetail, extra: number): ReceiptDetail {
  const tmpl = r.lines.find((l) => l.needs_check && l.suggestion)!;
  const more: ReceiptLine[] = Array.from({ length: extra }, (_, i) => ({
    ...tmpl,
    id: `00000000-0000-4000-8000-00000000000${i}`,
    line_no: 90 + i,
  }));
  return { ...r, lines: [...r.lines, ...more] };
}

describe('S-10 keputusan baris → p_lines W4 (docs/05 §3.3, §4.1)', () => {
  it('struk-aeon asli: 2 baris perlu dicek (fuzzy Indomie, AI Snack), auto-save Milo 500 g, kantong = bukan produk', () => {
    const g = groupLines(receipt());
    expect(g.needsCheck.map((l) => l.raw_text)).toEqual(['INDOMIE GRG 85G', 'SNACK XYZ']);
    expect(g.needsCheck.map((l) => l.match_tier)).toEqual(['fuzzy', 'ai']);
    expect(g.autoSaved.map((l) => l.raw_text)).toEqual(['MILO ORI 500G']);
    expect(g.nonProduct.map((l) => l.raw_text)).toEqual(['KANTONG PLASTIK']);
  });

  it('accept / replace (product_id) / non_product / skip; bundle hanya untuk accept/replace; baris lain tidak dikirim', () => {
    const r = receipt();
    const [indomie, snack] = groupLines(r).needsCheck;
    const auto = groupLines(r).autoSaved[0]!;
    const milo3in1 = snack!.suggestion!;
    expect(toPLines(r, { [indomie!.id]: { action: 'accept', is_bundle: true } })).toEqual([
      { line_id: indomie!.id, action: 'accept', is_bundle: true },
    ]);
    const lines = toPLines(r, {
      [indomie!.id]: { action: 'non_product', is_bundle: true },
      [snack!.id]: { action: 'replace', product: milo3in1 },
      [auto.id]: { action: 'skip' },
    });
    expect(lines).toEqual([
      { line_id: auto.id, action: 'skip' },
      { line_id: indomie!.id, action: 'non_product' },
      { line_id: snack!.id, action: 'replace', product_id: milo3in1.id },
    ]);
    // Lolos skema input kontrak (rpcCall).
    expect(RPC_INPUTS.confirm_receipt.safeParse({ p_receipt_id: r.header.id, p_lines: lines }).success).toBe(true);
  });

  it('replace tanpa produk dan accept tanpa saran bukan keputusan sah → tetap "belum diputuskan"', () => {
    const r = receipt('nostore');
    const [milo, gula] = groupLines(r).needsCheck;
    expect(gula!.suggestion).toBeNull();
    const d = { [milo!.id]: { action: 'replace' as const }, [gula!.id]: { action: 'accept' as const } };
    expect(toPLines(r, d)).toEqual([]);
    expect(undecidedLines(r, d).map((l) => l.id)).toEqual([milo!.id, gula!.id]);
  });

  it('"Simpan N harga": auto-save + accept/replace; skip pada auto-save mengurangi; produk terkait untuk SummaryUpdating', () => {
    const r = receipt();
    const [indomie, snack] = groupLines(r).needsCheck;
    const auto = groupLines(r).autoSaved[0]!;
    expect(savedCountAfter(r, {})).toBe(1);
    const d = { [indomie!.id]: { action: 'accept' as const }, [snack!.id]: { action: 'non_product' as const } };
    expect(savedCountAfter(r, d)).toBe(2);
    expect(savedCountAfter(r, { ...d, [auto.id]: { action: 'skip' as const } })).toBe(1);
    expect(affectedProductIds(r, d)).toEqual([indomie!.suggestion!.id]);
    expect(affectedProductIds(r, { ...d, [auto.id]: { action: 'skip' as const } }).sort()).toEqual(
      [auto.record!.product_id, indomie!.suggestion!.id].sort(),
    );
  });

  it(`"Benarkan semua saran" hanya jika ≥ ${ACCEPT_ALL_MIN} item perlu dicek punya saran (U-12)`, () => {
    const r = receipt();
    expect(canAcceptAll(r)).toBe(false);
    const big = withLines(r, 1);
    expect(canAcceptAll(big)).toBe(true);
    const d = acceptAll(big, { [groupLines(big).needsCheck[0]!.id]: { action: 'non_product' } });
    // Keputusan yang sudah ada tidak ditimpa.
    expect(Object.values(d).map((x) => x.action)).toEqual(['non_product', 'accept', 'accept']);
  });

  it('diskon menempel: 2 × 45.000 − 5.000 = 85.000 (D-63)', () => {
    const milo = receipt().lines.find((l) => l.raw_text === 'MILO ORI 500G')!;
    expect(attachedTotals(milo)).toEqual({ discount: -5000, voided: false, net: 85000 });
  });

  it('pilihan disimpan di sessionStorage per struk dan bisa dihapus (keadaan gagal §7.3)', () => {
    const store = new Map<string, string>();
    vi.stubGlobal('sessionStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    });
    expect(loadReceiptState('r1')).toEqual({ decisions: {}, duplicate: null });
    saveReceiptState('r1', { decisions: { l1: { action: 'skip' } }, duplicate: 'distinct' });
    expect(loadReceiptState('r1')).toEqual({ decisions: { l1: { action: 'skip' } }, duplicate: 'distinct' });
    clearReceiptState('r1');
    expect(loadReceiptState('r1').decisions).toEqual({});
    vi.unstubAllGlobals();
  });
});

describe('field ragu: field_confidence < τ dari R2 (U-15, D-49)', () => {
  it('struk tanpa toko: store 0,4 dan date 0,62 ragu; total 0,98 tidak', () => {
    expect([...doubtfulFields(receipt('nostore').field_confidence, TAU)].sort()).toEqual(['date', 'store']);
  });
  it('struk-aeon: branch 0,9 = τ bukan ragu (aturan "< τ")', () => {
    expect(doubtfulFields(receipt().field_confidence, TAU).size).toBe(0);
    expect(doubtfulFields(receipt().field_confidence, 0.95).has('branch')).toBe(true);
  });
  it('saran baris: confidence < τ atau kosong = ragu', () => {
    expect(isDoubtfulMatch(0.563, TAU)).toBe(true);
    expect(isDoubtfulMatch(1, TAU)).toBe(false);
    expect(isDoubtfulMatch(null, TAU)).toBe(true);
  });
});

describe('peringatan beda ukuran (klien, bukan blokir)', () => {
  const milo200 = { sale_mode: 'unit' as const, pack_count: 1, content_size: 200, content_unit: 'g' };
  const milo3in1 = { sale_mode: 'unit' as const, pack_count: 10, content_size: 35, content_unit: 'g' };
  it('membaca ukuran dari teks struk/label/judul', () => {
    expect(parseTextSize('MILO ORI 500G')).toMatchObject({ base: 500, dimension: 'mass', text: '500G' });
    expect(parseTextSize('MILO 3IN1 10X35G')).toMatchObject({ base: 350, text: '10X35G' });
    expect(parseTextSize('Minyak 1,5 L')).toMatchObject({ base: 1500, dimension: 'volume' });
    expect(parseTextSize('Milo Original 500 g Nestle')).toMatchObject({ base: 500 });
    expect(parseTextSize('SNACK XYZ')).toBeNull();
    expect(parseTextSize('GULA 1KG')).toMatchObject({ base: 1000 });
  });
  it('beda → teks ukuran; sama / tanpa ukuran / beda dimensi / timbang → null', () => {
    expect(sizeMismatch('Milo Original 500 g Nestle', milo200)).toBe('500 g');
    expect(sizeMismatch('MILO ORIGINAL 200G', milo200)).toBeNull();
    expect(sizeMismatch('MILO 3IN1 10X35G', milo3in1)).toBeNull();
    expect(sizeMismatch('SNACK XYZ', milo200)).toBeNull();
    expect(sizeMismatch('UHT 180ML', milo200)).toBeNull();
    expect(
      sizeMismatch('JERUK 1KG', { sale_mode: 'weight', pack_count: 1, content_size: null, content_unit: 'kg' }),
    ).toBeNull();
  });
});

describe('skema form S-15 diturunkan dari CreatePrivateProductInput (§4.2)', () => {
  const values = (v: Partial<ProductFormValues>): ProductFormValues => ({ ...defaultProductForm(), ...v });
  const issues = (v: ProductFormValues) => {
    const r = productFormSchema.safeParse(v);
    return r.success ? {} : Object.fromEntries(r.error.issues.map((i) => [i.path.join('.'), i.message]));
  };

  it('nama wajib; ukuran wajib untuk kemasan (23514 di server); barcode 8–14 angka', () => {
    expect(issues(values({}))).toMatchObject({
      name: 'Tulis nama produk.',
      content_size: 'Isi ukuran kemasan untuk produk yang dijual per kemasan.',
    });
    expect(issues(values({ name: 'Gula', content_size: '1', barcodes: [{ code: '12AB' }] }))).toEqual({
      'barcodes.0.code': 'Barcode berisi 8–14 angka.',
    });
    expect(issues(values({ name: 'Gula', content_size: '1', groupMode: 'new' }))).toEqual({
      groupName: 'Tulis nama group baru.',
    });
  });

  it('timbang tidak butuh ukuran; multipack → pack_count; brand/group baru → {new}; hasil lolos skema kontrak', () => {
    const weight = values({ name: 'Jeruk Medan', sale_mode: 'weight', content_unit: 'kg', content_size: '5' });
    expect(issues(weight)).toEqual({});
    expect(toProductInput(weight)).toMatchObject({
      sale_mode: 'weight',
      content_size: null,
      pack_count: 1,
      group: 'same_as_name',
    });
    const multi = values({
      name: 'Milo 3in1',
      pack_count: '10',
      content_size: '35',
      brand: 'Nestle',
      groupMode: 'new',
      groupName: 'Milo',
      barcodes: [{ code: '8990000000017' }, { code: '' }],
    });
    const input = toProductInput(multi, 'c0000000-0000-0000-0000-0000000000aa');
    expect(input).toEqual({
      id: 'c0000000-0000-0000-0000-0000000000aa',
      name: 'Milo 3in1',
      variant: null,
      sale_mode: 'unit',
      pack_count: 10,
      content_size: 35,
      content_unit: 'g',
      category_id: null,
      brand: { new: 'Nestle' },
      group: { new: 'Milo' },
      barcodes: [{ code: '8990000000017', code_type: 'gtin' }],
    });
    expect(CreatePrivateProductInput.safeParse({ p_product: input }).success).toBe(true);
  });

  it('pratinjau harga per satuan memakai unitPrice() kontrak: Rp10.000 ÷ (10 × 35 g) = Rp28,571429/g', () => {
    expect(previewUnitPrice(values({ pack_count: '10', content_size: '35' }), 10000)).toBe(28.571429);
    expect(previewUnitPrice(values({ content_size: '1,5', content_unit: 'kg' }), 30000)).toBe(20);
    expect(previewUnitPrice(values({ content_size: '' }), 10000)).toBeNull();
  });
});

describe('antrean W18: debounce + konflik STALE_WRITE (§7.3 S-11, §8.2)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  const base = () => fx<CaptureItem[]>('items_label')[0]!;

  function deps(over: Partial<ItemPatchDeps> = {}) {
    const d = {
      send: vi.fn(async (_id: string, patch: Record<string, unknown>, expected: string) => ({
        ...base(),
        ...patch,
        updated_at: `${expected}+1`,
      })) as unknown as ItemPatchDeps['send'],
      reload: vi.fn(async () => undefined) as ItemPatchDeps['reload'],
      onItem: vi.fn(),
      onError: vi.fn(),
      onPending: vi.fn(),
      delayMs: 600,
      ...over,
    };
    return d;
  }

  it('perubahan beruntun digabung dan dikirim sekali setelah jeda, dengan p_expected_updated_at versi tampil', async () => {
    const d = deps();
    const q = new ItemPatchQueue(d);
    const item = base();
    q.set(item, { normal_price: 19000 });
    q.set(item, { normal_price: 18500, promo_price: 17000 });
    expect(q.pending(item.id)).toBe(true);
    await vi.advanceTimersByTimeAsync(599);
    expect(d.send).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(d.send).toHaveBeenCalledTimes(1);
    expect(d.send).toHaveBeenCalledWith(item.id, { normal_price: 18500, promo_price: 17000 }, item.updated_at);
    expect(d.onItem).toHaveBeenCalled();
    expect(q.pending(item.id)).toBe(false);
    expect(d.onPending).toHaveBeenLastCalledWith(item.id, false);
  });

  it('perubahan saat permintaan berjalan dikirim berikutnya dengan updated_at hasil W18 sebelumnya', async () => {
    let release: () => void = () => undefined;
    const d = deps();
    const original = d.send;
    d.send = vi.fn(
      (id: string, patch: Record<string, unknown>, expected: string) =>
        new Promise((res) => {
          release = () => res((original as (...a: unknown[]) => Promise<CaptureItem>)(id, patch, expected));
        }),
    ) as unknown as ItemPatchDeps['send'];
    const q = new ItemPatchQueue(d);
    const item = base();
    q.set(item, { normal_price: 19000 });
    const f = q.flush(item.id);
    await vi.advanceTimersByTimeAsync(0);
    q.set(item, { is_bundle: true });
    release();
    await vi.advanceTimersByTimeAsync(0);
    const f2 = q.flush(item.id);
    await vi.advanceTimersByTimeAsync(0);
    release();
    await Promise.all([f, f2]);
    expect(d.send).toHaveBeenNthCalledWith(2, item.id, { is_bundle: true }, `${item.updated_at}+1`);
  });

  it('STALE_WRITE (fixture asli): muat ulang, kirim ulang hanya perubahan yang masih berlaku', async () => {
    const latest = { ...base(), normal_price: 18000, is_bundle: true, updated_at: '2026-10-20T23:00:00+07:00' };
    const d = deps({ reload: vi.fn(async () => latest) });
    const send = vi.fn(async (id: string, patch: Record<string, unknown>, expected: string) => {
      if (send.mock.calls.length === 1) throw err('update_item_stale');
      return { ...latest, ...patch, updated_at: `${expected}+1` } as CaptureItem;
    });
    d.send = send as unknown as ItemPatchDeps['send'];
    const q = new ItemPatchQueue(d);
    q.set(base(), { normal_price: 19000, is_bundle: true });
    await q.flush();
    expect(d.reload).toHaveBeenCalledWith(base().id);
    expect(d.onError).toHaveBeenCalledWith(base().id, expect.anything(), 'conflict');
    // is_bundle sudah sama dengan versi terbaru → tidak dikirim lagi.
    expect(send).toHaveBeenNthCalledWith(2, base().id, { normal_price: 19000 }, latest.updated_at);
  });

  it('stillApplicable: product_id dibandingkan dengan suggested_product_id', () => {
    const item = base();
    expect(stillApplicable({ product_id: item.suggested_product_id!, normal_price: 1 }, item)).toEqual({
      normal_price: 1,
    });
  });

  it('error lain (mis. INVALID_EXTRA) dilaporkan sebagai error, tanpa kirim ulang', async () => {
    const d = deps({
      send: vi.fn(async () => {
        throw err('confirm_items_no_price');
      }) as unknown as ItemPatchDeps['send'],
    });
    const q = new ItemPatchQueue(d);
    q.set(base(), { normal_price: null });
    await q.flush();
    expect(d.send).toHaveBeenCalledTimes(1);
    expect(d.onError).toHaveBeenCalledWith(base().id, expect.anything(), 'error');
  });
});

describe('pemetaan error §8.2 (S-10, S-11, S-12, S-15)', () => {
  it('S-10 DUPLICATE_DECISION_REQUIRED: pesan dengan toko/tanggal/total struk lama (R15), aksi banner', () => {
    const e = receiptError(err('confirm_receipt_duplicate'), receipt('duplicate'));
    expect(e.message).toBe(
      'Struk ini mirip struk AEON 15 Okt 2026, total Rp114.700. Pilih dulu: simpan sebagai struk berbeda, atau buang yang ini.',
    );
    expect(e.action).toEqual({ kind: 'duplicate', duplicateOf: receipt('duplicate').duplicate!.receipt_id });
  });
  it('S-10 UNDECIDED_LINES: jumlah dari detail.line_ids, gulir ke baris pertama', () => {
    const e = receiptError(err('confirm_receipt_undecided'));
    const ids = groupLines(receipt()).needsCheck.map((l) => l.id);
    expect(e.message).toBe('Masih ada 2 barang yang belum diputuskan. Pilih Benar, Ganti, Bukan produk, atau Lewati.');
    expect(e.action).toEqual({ kind: 'scroll-line', lineId: ids[0], count: 2 });
  });
  it('S-10 RECEIPT_STORE_REQUIRED → S-12; INVALID_STATE → "Lihat unggahan"; STALE_WRITE → muat ulang', () => {
    expect(receiptError(err('confirm_receipt_nostore'))).toEqual({
      message: 'Pilih toko untuk struk ini sebelum menyimpan.',
      action: { kind: 'pick-store' },
    });
    const invalid = fromRpcError({ message: 'INVALID_STATE', code: 'PT409', details: '{}', hint: null });
    expect(receiptError(invalid)).toEqual({
      message: 'Struk ini sudah dibuang, jadi tidak bisa disimpan.',
      action: { kind: 'view-upload' },
    });
    expect(receiptError(err('update_item_stale')).action).toEqual({ kind: 'reload' });
    const fk = fromRpcError({
      message: 'insert or update violates foreign key',
      code: '23503',
      details: null,
      hint: null,
    });
    expect(receiptError(fk).message).toBe('Cabang ini bukan cabang dari toko yang dipilih.');
  });
  it('S-11 STORE_REQUIRED → S-12 (item), NO_APPLICABLE_PRICE → fokus harga normal, INVALID_EXTRA, INVALID_STATE', () => {
    const item = fx<CaptureItem[]>('items_label');
    expect(itemsError(err('confirm_items_store_required'))).toEqual({
      message: 'Pilih toko untuk harga ini. Cabangnya boleh tidak diisi.',
      action: { kind: 'pick-store', itemId: item[0]!.id },
    });
    expect(itemsError(err('confirm_items_no_price')).action).toEqual({ kind: 'focus-normal', itemId: item[1]!.id });
    const extra = fromRpcError({ message: 'INVALID_EXTRA', code: 'PT422', details: '{"extra": {}}', hint: null });
    expect(itemsError(extra)).toEqual({
      message: 'Info tambahan (ongkir, voucher, catatan) tidak valid. Periksa lagi isiannya.',
      action: { kind: 'focus-extra', itemId: null },
    });
    const state = fromRpcError({ message: 'INVALID_STATE', code: 'PT409', details: '{}', hint: null });
    expect(itemsError(state)).toEqual({ message: 'Item ini sudah diputuskan sebelumnya.', action: { kind: 'reload' } });
  });
  it('S-15 23514 → ukuran, 23P01 → barcode (fixture asli); 23505 = sukses (id klien)', () => {
    expect(productError(err('create_product_23514'))).toEqual({
      message: 'Isi ukuran kemasan untuk produk yang dijual per kemasan.',
      field: 'content_size',
    });
    expect(productError(err('create_product_23P01'))).toEqual({
      message: 'Barcode ini sudah dipakai produk lain di periode yang sama.',
      field: 'barcodes',
    });
    const dup = fromRpcError({ message: 'duplicate key', code: '23505', details: null, hint: null });
    expect(isAlreadyCreated(dup)).toBe(true);
    expect(isAlreadyCreated(err('create_product_23P01'))).toBe(false);
  });
  it('S-12: error umum lewat copy (jaringan, tidak dikenal)', () => {
    expect(locationError(new TypeError('Failed to fetch'))).toBe(
      'Tidak ada sinyal. Data yang terakhir dimuat tetap ditampilkan.',
    );
  });
});

describe('S-12 hasil dikembalikan ke layar asal (kembali=)', () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal('sessionStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('openLocationHref → completeLocationPick → takeLocationPick sekali, hanya untuk target yang sama', () => {
    const href = openLocationHref('koreksi', 'receipt:r1', '/struk?id=r1');
    expect(href).toBe('/lokasi?mode=koreksi&untuk=receipt%3Ar1&kembali=%2Fstruk%3Fid%3Dr1');
    expect(openedFromApp('receipt:r1')).toBe(true);
    expect(openedFromApp('receipt:r2')).toBe(false);
    const store = { id: 's', name: 'AEON', channel: 'offline' as const, is_private: false };
    completeLocationPick('receipt:r1', { store, branch: null });
    expect(takeLocationPick('items:c1')).toBeNull();
    expect(takeLocationPick('receipt:r1')).toEqual({ store, branch: null });
    expect(takeLocationPick('receipt:r1')).toBeNull();
  });
  it('safeBack hanya path relatif app (bukan redirect ke situs lain)', () => {
    expect(safeBack('/struk?id=1')).toBe('/struk?id=1');
    expect(safeBack('//evil.example')).toBe('/unggahan');
    expect(safeBack('https://evil.example')).toBe('/unggahan');
    expect(safeBack(null)).toBe('/unggahan');
  });
});

describe('Q-74 (D-86): dialog duplikat hash menyebut toko dari R13 di cache, tanpa RPC baru', () => {
  it('capture struk lama ada di R13 cache → "… (struk AEON BSD)"; tidak ada → tanggal saja', async () => {
    const { QueryClient } = await import('@tanstack/react-query');
    const { duplicateDate } = await import('@/features/capture/duplicate-dialog');
    const list =
      fx<{ id: string; kind: string; store_name: string | null; branch_name: string | null }[]>('captures_all');
    const receiptRow = list.find((c) => c.kind === 'receipt' && c.branch_name)!;
    const qc = new QueryClient();
    qc.setQueryData(['rpc', 'list_captures', { p_limit: 50, p_kind: null }], list);
    const at = '2026-10-20T05:00:00Z';
    const withStore = duplicateDate({ capture_id: receiptRow.id, created_at: at }, 'Asia/Jakarta', qc);
    expect(withStore).toMatch(new RegExp(`\\(struk ${receiptRow.branch_name}\\)$`));
    expect(duplicateDate({ capture_id: 'lain', created_at: at }, 'Asia/Jakarta', qc)).not.toMatch(/struk/);
  });
});
