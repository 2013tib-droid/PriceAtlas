// L5a M5 (docs/07 §11.1): pemetaan patch S-16 (kunci terkunci record struk, extra D-66), konflik W6,
// pemetaan error §8.2 untuk S-15 edit / S-16 / S-17 / S-18, pratinjau merge (beda ukuran/dimensi),
// pilihan record split + id T1/T2, form edit dari kontrak, riwayat audit, PLU S-15 baru (F-55).
// Fixture = keluaran RPC asli mode A (test/fixtures/rpc.json, divalidasi skema kontrak).
import type {
  AuditEntry,
  MergePreview,
  PriceRecordDetail,
  PriceRecordFull,
  PriceRecordView,
  RpcErrorLike,
} from '@priceatlas/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mergeError, productEditError, recordError, splitError } from '@/lib/catalog/errors';
import { auditChanges, historyLines } from '@/lib/catalog/history';
import { canMoveToGroup, canStartMerge, countsText, mergeView, mismatchText } from '@/lib/catalog/merge';
import {
  canEditProduct,
  editFormFrom,
  productEditSchema,
  reapplyProductEdits,
  sizeChanged,
  toProductPatch,
} from '@/lib/catalog/product-edit';
import {
  affectedProducts,
  checkRecordPatch,
  extraFromForm,
  loadRecordDraft,
  lockedKeysIn,
  reapplyAfterConflict,
  recordFormFrom,
  saveRecordDraft,
  toRecordPatch,
} from '@/lib/catalog/record-form';
import {
  aliasSourceRecord,
  aliasStore,
  keepExisting,
  loadSplitTarget,
  moveInput,
  saveSplitTarget,
  sourceOptions,
  storeOptions,
  toggle,
  toggleAllVisible,
  visibleRows,
} from '@/lib/catalog/split';
import { defaultProductForm, productFormSchema, toProductInput } from '@/lib/confirm/product-form';
import { CATALOG_COPY, ERROR_COPY, SQLSTATE_COPY } from '@/lib/copy/id';
import { staleWriteError } from '@/lib/data/confirm';
import { AppError, fromRpcError } from '@/lib/data/errors';
import type { ProductRow } from '@/lib/data/rest-schemas';
import { fx } from '../m1/harness';

const detail = (k: string) => fx<PriceRecordDetail>(k);
const rec = (k: string) => detail(k).record;
const err = (k: string) => fromRpcError(fx<{ error: RpcErrorLike }>(k).error);
const preview = (k: string) => fx<MergePreview>(k);
const row = (k: string) => fx<ProductRow[]>(k)[0]!;

// sessionStorage tiruan untuk modul yang menyimpan draf/tujuan split (node tanpa DOM).
const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  Object.defineProperty(globalThis, 'sessionStorage', {
    configurable: true,
    value: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    },
  });
});
afterEach(() => {
  Reflect.deleteProperty(globalThis, 'sessionStorage');
});

describe('S-16 isian → p_patch W6', () => {
  it('tanpa perubahan → patch kosong; harga observasi "19.900" → normal_price 19900', () => {
    const r = rec('record_label');
    const v = recordFormFrom(r);
    expect(v.normal_price).toBe('19500');
    expect(v.promo_price).toBe('17500');
    expect(toRecordPatch(r, v)).toEqual({});
    expect(toRecordPatch(r, { ...v, normal_price: '19.900' })).toEqual({ normal_price: 19900 });
  });

  it('observasi: promo dikosongkan → null; tanggal, program, lokasi (S-12) ikut patch', () => {
    const r = rec('record_label');
    const v = recordFormFrom(r);
    const patch = toRecordPatch(
      r,
      {
        ...v,
        promo_price: '',
        transaction_date: '2026-10-20',
        member_program_id: '40000000-0000-0000-0000-000000000001',
      },
      { location: { store_id: '20000000-0000-0000-0000-000000000002', branch_id: null } },
    );
    expect(patch).toEqual({
      promo_price: null,
      transaction_date: '2026-10-20',
      member_program_id: '40000000-0000-0000-0000-000000000001',
      store_id: '20000000-0000-0000-0000-000000000002',
      branch_id: null,
    });
    expect(checkRecordPatch(patch)).toBeNull();
  });

  it('record struk: kunci terkunci (angka, tanggal, lokasi) tidak pernah dikirim (D-23)', () => {
    const r = rec('record_receipt');
    expect(r.source_type).toBe('receipt');
    const v = recordFormFrom(r);
    const patch = toRecordPatch(
      r,
      { ...v, normal_price: '1', transaction_date: '2026-01-01', is_bundle: true },
      { location: { store_id: '20000000-0000-0000-0000-000000000002', branch_id: null }, product: { id: 'x' } },
    );
    expect(patch).toEqual({ is_bundle: true, product_id: 'x' });
    expect(lockedKeysIn(r, patch)).toEqual([]);
    expect(lockedKeysIn(r, { normal_price: 1, is_bundle: true })).toEqual(['normal_price']);
    expect(lockedKeysIn(rec('record_label'), { normal_price: 1 })).toEqual([]);
  });

  it('extra D-66: dikirim utuh tanpa kunci sistem; kosong = dihapus; listing tetap', () => {
    const shopee = rec('record_shopee');
    const v = recordFormFrom(shopee);
    expect(v.shipping_fee).toBe('9000');
    const patch = toRecordPatch(shopee, { ...v, shipping_fee: '12.000', note: ' beli 2 ' });
    expect(patch).toEqual({
      extra: {
        listing_url: 'https://shopee.co.id/milo-original-500g',
        listing_title: 'Milo Original 500 g Nestle',
        shipping_fee: 12000,
        note: 'beli 2',
      },
    });
    expect(toRecordPatch(shopee, { ...v, shipping_fee: '' }).extra).not.toHaveProperty('shipping_fee');
    // Record struk dengan member_hint (kunci sistem): catatan baru → member_hint TIDAK ikut dikirim.
    const receipt = rec('record_receipt');
    expect(receipt.extra.member_hint).toBeTruthy();
    const rp = toRecordPatch(receipt, { ...recordFormFrom(receipt), note: 'dua pcs' });
    expect(rp).toEqual({ extra: { note: 'dua pcs' } });
    expect(extraFromForm(recordFormFrom(receipt), receipt.extra)).toEqual({});
  });

  it('extra di luar kontrak / URL bukan https → INVALID_EXTRA sebelum dikirim', () => {
    const shopee = rec('record_shopee');
    const bad = toRecordPatch(shopee, { ...recordFormFrom(shopee), listing_url: 'http://contoh.test' });
    expect(checkRecordPatch(bad)).toEqual({ field: 'extra', kind: 'extra' });
    expect(checkRecordPatch({ promo_min_qty: 1 })).toEqual({ field: 'promo_min_qty', kind: 'invalid' });
  });

  it('STALE_WRITE: muat ulang → perubahan user yang masih berlaku ditampilkan lagi', () => {
    const original = rec('record_label');
    const latest = { ...original, ...fx<PriceRecordFull>('correct_label_ok') };
    const user = { ...recordFormFrom(original), normal_price: '19900', note: 'rak bawah', promo_price: '17000' };
    const again = reapplyAfterConflict(latest, user, original);
    // normal_price sudah 19900 di versi terbaru → tidak perlu dikirim lagi; catatan + promo tetap.
    expect(again.changed.sort()).toEqual(['note', 'promo_price']);
    expect(again.values.normal_price).toBe('19900');
    expect(toRecordPatch(latest, again.values)).toEqual({ promo_price: 17000, extra: { note: 'rak bawah' } });
  });

  it('produk terkait untuk invalidasi + SummaryUpdating: lama dan baru', () => {
    const r = rec('record_receipt');
    expect(affectedProducts(r, { is_bundle: true })).toEqual([r.product_id]);
    expect(affectedProducts(r, { product_id: 'p2' })).toEqual([r.product_id, 'p2']);
  });

  it('draf isian per versi record (sessionStorage); versi lain = dibuang', () => {
    const r = rec('record_label');
    const values = { ...recordFormFrom(r), normal_price: '18000' };
    saveRecordDraft(r.id, { baseUpdatedAt: r.updated_at, values, product: null, updateAlias: false });
    expect(loadRecordDraft(r.id, r.updated_at)?.values.normal_price).toBe('18000');
    expect(loadRecordDraft(r.id, '2000-01-01T00:00:00Z')).toBeNull();
    saveRecordDraft(r.id, null);
    expect(loadRecordDraft(r.id, r.updated_at)).toBeNull();
  });
});

describe('§8.2 S-16 / S-17 / S-18 / S-15 edit dari error asli', () => {
  it('S-16 W6/W7', () => {
    expect(recordError(err('correct_stale'))).toEqual({
      message: ERROR_COPY.STALE_WRITE.message,
      action: { kind: 'reload' },
    });
    expect(recordError(err('correct_line_stale')).action.kind).toBe('reload');
    expect(recordError(err('correct_no_price'))).toEqual({
      message: ERROR_COPY.NO_APPLICABLE_PRICE.message,
      action: { kind: 'focus-normal' },
    });
    expect(recordError(err('correct_use_receipt_line'))).toEqual({
      message: 'Harga dari struk diubah lewat baris struknya.',
      action: { kind: 'edit-line' },
    });
    expect(recordError(err('correct_invalid_extra')).action.kind).toBe('focus-extra');
    expect(recordError(err('record_unknown')).action.kind).toBe('back');
    const derived = new AppError(
      'rpc',
      { code: 'RECEIPT_DERIVED_FIELD', sqlstate: 'PT422', http: 422, detail: {}, hint: null, message: '' },
      '',
    );
    expect(recordError(derived)).toEqual({
      message: ERROR_COPY.RECEIPT_DERIVED_FIELD.message,
      action: { kind: 'edit-line' },
    });
  });

  it('S-17 W10/R19: 42501 → D-30, P0001 → produk tujuan, NOT_FOUND', () => {
    expect(err('merge_forbidden').rpc?.sqlstate).toBe('42501');
    expect(mergeError(err('merge_forbidden'))).toBe('Produk katalog umum hanya bisa digabung oleh kurator.');
    expect(mergeError(err('merge_target_inactive'))).toBe(SQLSTATE_COPY.P0001!.message);
    expect(mergeError(err('merge_target_other'))).toBe(SQLSTATE_COPY.P0001!.message);
    expect(mergeError(err('merge_preview_unknown'))).toBe(CATALOG_COPY.merge.notFound);
    expect(mergeError(err('patch_product_23503'))).toBe('Group ini tidak tersedia.');
  });

  it('S-18 W9: RECORDS_NOT_OWNED → muat ulang; tujuan hilang → pilih lagi; jaringan → ulangi T2', () => {
    expect(splitError(err('move_not_owned'))).toEqual({
      message: ERROR_COPY.RECORDS_NOT_OWNED.message,
      action: { kind: 'reload-records' },
    });
    expect(splitError(err('move_target_missing')).action.kind).toBe('pick-target');
    expect(splitError(new TypeError('Failed to fetch')).action.kind).toBe('retry');
  });

  it('S-15 edit PATCH product: 0 baris, 23514, 23503', () => {
    expect(productEditError(staleWriteError())).toMatchObject({ stale: true, field: null });
    expect(productEditError(err('patch_product_23514'))).toEqual({
      message: SQLSTATE_COPY['23514']!.message,
      field: 'content_size',
      stale: false,
    });
    expect(productEditError(err('patch_product_23503'))).toMatchObject({ field: 'product_group_id', stale: false });
  });
});

describe('S-17 pratinjau merge (R19 asli)', () => {
  it('ukuran sama → siap, tanpa konfirmasi dua kali; jumlah yang pindah', () => {
    const v = mergeView(preview('merge_preview_ok'));
    expect(v).toMatchObject({ kind: 'ready', twice: false, mismatch: null });
    expect(countsText(preview('merge_preview_ok').counts)).toBe('Pindah: 2 harga · 1 alias · 1 barcode');
  });

  it('beda ukuran (U-16) / beda dimensi → ConfirmTwice + teks', () => {
    expect(mergeView(preview('merge_preview_size'))).toMatchObject({ kind: 'ready', twice: true });
    expect(mismatchText(preview('merge_preview_size'))).toBe('250 g vs 1 kg');
    expect(mismatchText(preview('merge_preview_dimension'))).toBe('250 g vs 500 ml (satuan berbeda)');
  });

  it('ke produk katalog: barcode PRIBADI tetap (F-01/D-65); bisa "Pindahkan ke group"', () => {
    const p = preview('merge_preview_global_target');
    expect(p.counts.barcodes_kept).toBe(1);
    expect(countsText(p.counts)).toBe('Pindah: 2 harga · 1 alias · 0 barcode');
    expect(canMoveToGroup(p)).toBe(true);
    expect(canMoveToGroup({ ...p, into: { ...p.into, product_group_id: p.from.product_group_id } })).toBe(false);
  });

  it('sumber global → diblokir (D-30); sudah digabung ke tujuan sama → sukses', () => {
    expect(mergeView(preview('merge_preview_source_global'))).toEqual({
      kind: 'blocked',
      reason: 'source_global',
      message: CATALOG_COPY.merge.reasons.source_global,
    });
    expect(mergeView(preview('merge_preview_already'))).toEqual({ kind: 'done' });
    expect(canStartMerge(preview('merge_preview_ok').from)).toBe(true);
    expect(canStartMerge(preview('merge_preview_global_target').into)).toBe(false);
  });
});

describe('S-18 pilihan record + T1/T2', () => {
  const rows = fx<PriceRecordView[]>('split_history');

  it('filter toko & sumber dari daftar R8', () => {
    expect(storeOptions(rows).map((o) => o.name)).toEqual(['AEON', 'Shopee']);
    expect(sourceOptions(rows)).toEqual(['receipt', 'marketplace']);
    const aeon = storeOptions(rows)[0]!.id;
    expect(visibleRows(rows, { storeId: aeon, source: null }).map((r) => r.source_type)).toEqual(['receipt']);
    expect(visibleRows(rows, { storeId: null, source: 'marketplace' })).toHaveLength(2);
  });

  it('centang, centang semua yang tampil (toggle), pertahankan yang masih ada setelah muat ulang', () => {
    const first = rows[0]!.id;
    let sel = toggle(new Set(), first);
    expect([...sel]).toEqual([first]);
    sel = toggleAllVisible(sel, rows);
    expect(sel.size).toBe(3);
    expect(toggleAllVisible(sel, rows).size).toBe(0);
    expect([...keepExisting(new Set([first, 'hilang']), rows)]).toEqual([first]);
  });

  it('alias: toko + record struk pertama yang dicentang (teks dari R20)', () => {
    const receipt = rows.find((r) => r.source_type === 'receipt')!;
    const sel = new Set(rows.map((r) => r.id));
    expect(aliasSourceRecord(rows, sel)).toBe(receipt.id);
    expect(aliasStore(rows, new Set([receipt.id]))).toEqual({ id: receipt.store_id, name: 'AEON' });
    expect(aliasSourceRecord(rows, new Set([rows[0]!.id]))).toBeNull();
  });

  it('input W9 dari kontrak: id terurut, alias kosong = null', () => {
    const ids = rows.map((r) => r.id);
    const target = 'c0000000-0000-0000-0000-000000000020';
    const a = moveInput(new Set(ids), target, { store_id: rows[2]!.store_id, alias_text: '  ' });
    expect(a).toEqual({ p_record_ids: [...ids].sort(), p_target_product_id: target, p_alias: null });
    const b = moveInput(new Set([ids[0]!]), target, { store_id: rows[2]!.store_id, alias_text: ' MILO ORI ' });
    expect(b.p_alias).toEqual({ store_id: rows[2]!.store_id, alias_text: 'MILO ORI' });
    expect(() => moveInput(new Set(), target, null)).toThrow();
  });

  it('id produk tujuan disimpan sebelum T1 → ulangi T2 dengan id yang sama (§4.5)', () => {
    const t = { id: 'c0000000-0000-0000-0000-0000000000ff', name: '', created: true, saved: false };
    saveSplitTarget('asal', t);
    expect(loadSplitTarget('asal')).toEqual(t);
    saveSplitTarget('asal', { ...t, name: 'Milo 3in1', saved: true });
    expect(loadSplitTarget('asal')?.id).toBe(t.id);
    saveSplitTarget('asal', null);
    expect(loadSplitTarget('asal')).toBeNull();
  });
});

describe('S-15 edit: form dari kontrak → kolom product yang berubah', () => {
  const r = row('rest_product');

  it('nilai awal dari baris REST; tanpa perubahan → patch kosong', () => {
    const v = editFormFrom(r);
    expect(v).toMatchObject({ name: 'Sirup Gula Aren', content_size: '500', content_unit: 'ml', pack_count: '1' });
    expect(toProductPatch(v, r)).toEqual({});
  });

  it('ubah ukuran → teks hitung ulang; ubah nama saja → tidak', () => {
    const v = editFormFrom(r);
    const size = toProductPatch({ ...v, content_size: '600' }, r);
    expect(size).toEqual({ content_size: 600 });
    expect(sizeChanged(size)).toBe(true);
    expect(sizeChanged(toProductPatch({ ...v, name: 'Sirup Aren' }, r))).toBe(false);
  });

  it('timbang → pack_count 1, content_size null; aturan ukuran kontrak', () => {
    const v = editFormFrom(r);
    expect(toProductPatch({ ...v, sale_mode: 'weight', content_unit: 'kg' }, r)).toEqual({
      sale_mode: 'weight',
      content_size: null,
      content_unit: 'kg',
    });
    const bad = productEditSchema.safeParse({ ...v, content_size: '' });
    expect(bad.success ? [] : bad.error.issues.map((i) => i.path.join('.'))).toEqual(['content_size']);
    expect(productEditSchema.safeParse({ ...v, sale_mode: 'weight', content_size: '' }).success).toBe(true);
  });

  it('konflik (0 baris): perubahan user yang masih berlaku tetap', () => {
    const latest = row('patch_product_ok');
    const user = { ...editFormFrom(r), variant: 'botol' };
    const again = reapplyProductEdits(latest, user, r);
    expect(again.changed).toEqual(['variant']);
    expect(again.values).toMatchObject({ name: 'Sirup Gula Aren Asli', content_size: '600', variant: 'botol' });
  });

  it('hanya produk privat aktif yang bisa diedit (D-29, D-30, D-38)', () => {
    expect(canEditProduct(r)).toBe(true);
    expect(canEditProduct(row('rest_product_global'))).toBe(false);
    expect(canEditProduct(row('patch_product_archive'))).toBe(false);
  });
});

describe('S-15 baru: PLU produk timbang dengan toko (F-55)', () => {
  const aeon = '20000000-0000-0000-0000-000000000001';
  const weight = {
    ...defaultProductForm({ name: 'Jeruk Pontianak' }),
    sale_mode: 'weight' as const,
    content_unit: 'kg',
  };

  it('PLU + toko → barcodes { code_type: plu, store_id }; kemasan → selalu GTIN', () => {
    const v = { ...weight, barcodes: [{ code: '2001', code_type: 'plu' as const, store_id: aeon }] };
    expect(productFormSchema.safeParse(v).success).toBe(true);
    expect(toProductInput(v).barcodes).toEqual([{ code: '2001', code_type: 'plu', store_id: aeon }]);
    const unit = {
      ...v,
      sale_mode: 'unit' as const,
      content_size: '1',
      barcodes: [{ code: '8990000000017', code_type: 'plu' as const, store_id: aeon }],
    };
    expect(toProductInput(unit).barcodes).toEqual([{ code: '8990000000017', code_type: 'gtin' }]);
  });

  it('PLU tanpa toko / bukan angka → pesan per field', () => {
    const r = productFormSchema.safeParse({ ...weight, barcodes: [{ code: '20A', code_type: 'plu', store_id: '' }] });
    expect(r.success ? {} : Object.fromEntries(r.error.issues.map((i) => [i.path.join('.'), i.message]))).toEqual({
      'barcodes.0.code': 'Kode PLU berisi 1–14 angka.',
      'barcodes.0.store_id': 'Pilih toko untuk kode PLU.',
    });
  });
});

describe('Riwayat S-16 dari audit_log asli', () => {
  it('ubah harga observasi: "harga normal: Rp19.500 → Rp19.900", lalu "Dibuat"', () => {
    const d = detail('record_label_corrected');
    const lines = historyLines(d.record, d.history);
    expect(lines.map((l) => l.kind)).toEqual(['changed', 'created']);
    expect(lines[0]!.changes).toContain('harga normal: Rp19.500 → Rp19.900');
    expect(lines.at(-1)!.at).toBe(d.record.created_at);
  });

  it('baris struk diubah (W7): entri receipt_line + record dibentuk ulang', () => {
    const d = detail('record_receipt_line_corrected');
    const lines = historyLines(d.record, d.history);
    const line = lines.find((l) => l.entity === 'receipt_line')!;
    expect(line.changes).toEqual(['total baris: Rp90.000 → Rp88.000']);
    expect(lines.some((l) => l.changes.includes('harga efektif: Rp42.500 → Rp41.500'))).toBe(true);
    expect(lines.some((l) => l.changes.includes('produk'))).toBe(true);
  });

  it('batalkan + info tambahan; kolom turunan (updated_at, unit_price) tidak ditampilkan', () => {
    const d = detail('record_shopee_void');
    const changes = d.history.flatMap((h: AuditEntry) => auditChanges(h));
    expect(changes).toEqual(['info tambahan', 'status: aktif → dibatalkan']);
  });
});
