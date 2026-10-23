// S-16 Detail & koreksi harga (docs/07 §7.3, docs/05 §4.3, wireframe S-16): isian form ↔ p_patch W6
// correct_price_record. Logika tanpa React supaya diuji unit (L5a).
//   - Hanya kunci yang BERUBAH yang dikirim (patch sama = idempoten di server, tetapi tetap lebih jelas).
//   - Record struk: RECEIPT_LOCKED_KEYS (angka, tanggal, lokasi) tidak pernah dikirim (USE_RECEIPT_LINE,
//     D-23); angka diubah lewat baris struk (W7), tanggal/toko lewat header struk (S-10).
//   - `extra` dikirim UTUH (W6 mengganti seluruh extra) tanpa kunci sistem (member_eligible,
//     member_hint dipertahankan server, D-66); kunci yang dikosongkan dihapus.
//   - Skema patch = CorrectPriceRecordInput kontrak (validasi yang sama dengan rpcCall).
import {
  CorrectPriceRecordInput,
  PriceExtraSchema,
  RECEIPT_LOCKED_KEYS,
  SYSTEM_EXTRA_KEYS,
  type PriceExtra,
  type PriceRecordFull,
  type RpcInput,
} from '@priceatlas/contracts';
import { parsePrice, priceInputText } from '@/lib/format';

export type RecordPatch = RpcInput<'correct_price_record'>['p_patch'];

/** Isian teks S-16 (harga dan extra sebagai teks input; tanggal YYYY-MM-DD). */
export interface RecordFormValues {
  normal_price: string;
  promo_price: string;
  promo_min_qty: string;
  promo_valid_from: string;
  promo_valid_until: string;
  member_price: string;
  member_program_id: string;
  transaction_date: string;
  is_bundle: boolean;
  shipping_fee: string;
  shop_voucher: string;
  cashback: string;
  points: string;
  note: string;
  listing_title: string;
  listing_url: string;
}

/** Pilihan di luar isian teks: produk (S-14) dan lokasi (S-12 mode koreksi). */
export interface RecordPicks {
  product?: { id: string } | null;
  location?: { store_id: string; branch_id: string | null } | null;
}

export const EXTRA_NUMBER_KEYS = ['shipping_fee', 'shop_voucher', 'cashback', 'points'] as const;
export const EXTRA_TEXT_KEYS = ['note', 'listing_title', 'listing_url'] as const;

export function isReceiptRecord(r: Pick<PriceRecordFull, 'source_type'>): boolean {
  return r.source_type === 'receipt';
}

export function recordFormFrom(r: PriceRecordFull): RecordFormValues {
  const x = r.extra;
  const t = (v: string | undefined) => v ?? '';
  return {
    normal_price: priceInputText(r.normal_price),
    promo_price: priceInputText(r.promo_price),
    promo_min_qty: r.promo_min_qty == null ? '' : String(r.promo_min_qty),
    promo_valid_from: r.promo_valid_from ?? '',
    promo_valid_until: r.promo_valid_until ?? '',
    member_price: priceInputText(r.member_price),
    member_program_id: r.member_program_id ?? '',
    transaction_date: r.transaction_date,
    is_bundle: r.is_bundle,
    shipping_fee: priceInputText(x.shipping_fee),
    shop_voucher: priceInputText(x.shop_voucher),
    cashback: priceInputText(x.cashback),
    points: x.points == null ? '' : String(x.points),
    note: t(x.note),
    listing_title: t(x.listing_title),
    listing_url: t(x.listing_url),
  };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** extra baru dari isian: kunci user D-66 (tanpa kunci sistem); kosong = dihapus. */
export function extraFromForm(v: RecordFormValues, current: PriceExtra): PriceExtra {
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(current))
    if (!(SYSTEM_EXTRA_KEYS as readonly string[]).includes(k)) out[k] = val;
  for (const k of EXTRA_NUMBER_KEYS) {
    const n = parsePrice(v[k]);
    if (n == null) delete out[k];
    else out[k] = n;
  }
  for (const k of EXTRA_TEXT_KEYS) {
    const s = v[k].trim();
    if (!s) delete out[k];
    else out[k] = s;
  }
  return out as PriceExtra;
}

/** extra record tanpa kunci sistem (pembanding perubahan). */
function userExtra(x: PriceExtra): PriceExtra {
  const out: Record<string, unknown> = { ...x };
  for (const k of SYSTEM_EXTRA_KEYS) delete out[k];
  return out as PriceExtra;
}

/**
 * Isian + pilihan → p_patch W6 (hanya yang berubah). Record struk: kunci terkunci diabaikan
 * (ditampilkan baca saja di UI, diubah lewat baris/header struk).
 */
export function toRecordPatch(r: PriceRecordFull, v: RecordFormValues, picks: RecordPicks = {}): RecordPatch {
  const patch: Record<string, unknown> = {};
  if (picks.product && picks.product.id !== r.product_id) patch.product_id = picks.product.id;
  if (v.is_bundle !== r.is_bundle) patch.is_bundle = v.is_bundle;
  const extra = extraFromForm(v, r.extra);
  if (!same(sortKeys(extra), sortKeys(userExtra(r.extra)))) patch.extra = extra;
  if (!isReceiptRecord(r)) {
    const num = (k: 'normal_price' | 'promo_price' | 'member_price') => {
      const n = parsePrice(v[k]);
      if (!same(n, r[k])) patch[k] = n;
    };
    num('normal_price');
    num('promo_price');
    num('member_price');
    const qty = v.promo_min_qty.trim() ? Number(v.promo_min_qty.replace(/\D/g, '')) : null;
    if (!same(qty, r.promo_min_qty)) patch.promo_min_qty = qty;
    for (const k of ['promo_valid_from', 'promo_valid_until'] as const) {
      const d = v[k] || null;
      if (!same(d, r[k])) patch[k] = d;
    }
    const program = v.member_program_id || null;
    if (!same(program, r.member_program_id)) patch.member_program_id = program;
    if (v.transaction_date && v.transaction_date !== r.transaction_date) patch.transaction_date = v.transaction_date;
    const loc = picks.location;
    if (loc && (loc.store_id !== r.store_id || loc.branch_id !== r.branch_id)) {
      patch.store_id = loc.store_id;
      patch.branch_id = loc.branch_id;
    }
  }
  return patch as RecordPatch;
}

function sortKeys(x: object): Record<string, unknown> {
  return Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b)));
}

/** Kunci terkunci yang ada di patch (record struk). Dipakai sebagai pengaman sebelum kirim. */
export function lockedKeysIn(r: Pick<PriceRecordFull, 'source_type'>, patch: RecordPatch): string[] {
  if (!isReceiptRecord(r)) return [];
  return Object.keys(patch).filter((k) => (RECEIPT_LOCKED_KEYS as readonly string[]).includes(k));
}

export type RecordPatchIssue = { field: keyof RecordFormValues | 'extra' | 'patch'; kind: 'extra' | 'invalid' };

/** Validasi kontrak (CorrectPriceRecordInput, PriceExtraSchema D-66) sebelum kirim. */
export function checkRecordPatch(patch: RecordPatch): RecordPatchIssue | null {
  if (patch.extra && !PriceExtraSchema.safeParse(patch.extra).success) return { field: 'extra', kind: 'extra' };
  const r = CorrectPriceRecordInput.shape.p_patch.safeParse(patch);
  if (r.success) return null;
  const key = String(r.error.issues[0]?.path[0] ?? 'patch');
  if (key === 'extra') return { field: 'extra', kind: 'extra' };
  return { field: (key in EMPTY_FORM ? key : 'patch') as RecordPatchIssue['field'], kind: 'invalid' };
}

const EMPTY_FORM: RecordFormValues = {
  normal_price: '',
  promo_price: '',
  promo_min_qty: '',
  promo_valid_from: '',
  promo_valid_until: '',
  member_price: '',
  member_program_id: '',
  transaction_date: '',
  is_bundle: false,
  shipping_fee: '',
  shop_voucher: '',
  cashback: '',
  points: '',
  note: '',
  listing_title: '',
  listing_url: '',
};

/**
 * STALE_WRITE (§8.2, pola W18 S-11): setelah versi terbaru dimuat, perubahan user yang MASIH berlaku =
 * kunci patch yang nilainya berbeda dari versi terbaru. Isian form dibentuk ulang dari versi terbaru
 * lalu perubahan itu diterapkan lagi, supaya user memeriksa dan menekan simpan lagi.
 */
export function reapplyAfterConflict(
  latest: PriceRecordFull,
  userValues: RecordFormValues,
  original: PriceRecordFull,
): { values: RecordFormValues; changed: (keyof RecordFormValues)[] } {
  const base = recordFormFrom(latest);
  const before = recordFormFrom(original);
  const values = { ...base };
  const changed: (keyof RecordFormValues)[] = [];
  for (const k of Object.keys(base) as (keyof RecordFormValues)[]) {
    // Diubah user (berbeda dari versi yang dibuka) dan masih berbeda dari versi terbaru.
    if (!same(userValues[k], before[k]) && !same(userValues[k], base[k])) {
      (values as Record<string, unknown>)[k] = userValues[k];
      changed.push(k);
    }
  }
  return { values, changed };
}

/** Produk lama + baru (jika diganti) untuk invalidasi dan SummaryUpdating. */
export function affectedProducts(r: Pick<PriceRecordFull, 'product_id'>, patch: RecordPatch): string[] {
  return patch.product_id && patch.product_id !== r.product_id ? [r.product_id, patch.product_id] : [r.product_id];
}

/** Teks alias yang dialihkan W6 p_update_alias: teks baris struk, atau teks item label/judul listing. */
export function aliasText(detail: { receipt_line: { raw_text: string | null } | null }): string | null {
  return detail.receipt_line?.raw_text ?? null;
}

// ---------------------------------------------------------------------------
// Draf S-16 di sessionStorage: isian tetap ada saat membuka S-12 (pindah halaman) lalu kembali.
// Hanya berlaku untuk versi record yang sama (updated_at); versi lain = draf dibuang.
// ---------------------------------------------------------------------------
export interface RecordDraft {
  baseUpdatedAt: string;
  values: RecordFormValues;
  product: { id: string; name: string } | null;
  updateAlias: boolean;
}

const draftKey = (id: string) => `priceatlas:record-draft:${id}`;

export function loadRecordDraft(id: string, updatedAt: string): RecordDraft | null {
  try {
    const raw = sessionStorage.getItem(draftKey(id));
    if (!raw) return null;
    const d = JSON.parse(raw) as RecordDraft;
    return d.baseUpdatedAt === updatedAt ? d : null;
  } catch {
    return null;
  }
}

export function saveRecordDraft(id: string, d: RecordDraft | null): void {
  try {
    if (d) sessionStorage.setItem(draftKey(id), JSON.stringify(d));
    else sessionStorage.removeItem(draftKey(id));
  } catch {
    // tanpa sessionStorage: isian hanya di memori.
  }
}
