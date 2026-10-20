// Logika S-10 tanpa React (docs/07 §7.3, docs/05 §3.3 S-10, §4.1): keputusan per baris → p_lines W4,
// aturan "Benarkan semua saran" (U-12, ≥ 3), field ragu (field_confidence < τ dari R2, U-15),
// pengelompokan baris, dan penyimpanan pilihan di sessionStorage (keadaan gagal, §7.3).
import type { ProductLiteSchema, ReceiptDetail, ReceiptLine, RpcInput } from '@priceatlas/contracts';
import type { z } from 'zod';

export type ProductLite = z.infer<typeof ProductLiteSchema>;
export type LineAction = 'accept' | 'replace' | 'non_product' | 'skip';

export interface LineDecision {
  action: LineAction;
  /** Produk pilihan (replace) untuk tampilan dan p_lines. */
  product?: ProductLite | null;
  is_bundle?: boolean;
}

export type Decisions = Record<string, LineDecision>;

/** U-12: "Benarkan semua saran" hanya jika ada ≥ 3 item perlu dicek yang punya saran. */
export const ACCEPT_ALL_MIN = 3;

export function needsCheckLines(r: ReceiptDetail): ReceiptLine[] {
  return r.lines.filter((l) => l.needs_check);
}

/** Baris perlu dicek yang punya saran dan belum diputuskan (target "Benarkan semua"). */
export function acceptAllTargets(r: ReceiptDetail, d: Decisions): ReceiptLine[] {
  return needsCheckLines(r).filter((l) => l.suggestion && !d[l.id]);
}

export function canAcceptAll(r: ReceiptDetail): boolean {
  return needsCheckLines(r).filter((l) => l.suggestion).length >= ACCEPT_ALL_MIN;
}

export function acceptAll(r: ReceiptDetail, d: Decisions): Decisions {
  const next = { ...d };
  for (const l of acceptAllTargets(r, d)) next[l.id] = { action: 'accept' };
  return next;
}

/** Keputusan sah untuk baris ini? (accept butuh saran, replace butuh produk). */
export function isValidDecision(line: ReceiptLine, dec: LineDecision | undefined): dec is LineDecision {
  if (!dec) return false;
  if (dec.action === 'accept') return Boolean(line.suggestion);
  if (dec.action === 'replace') return Boolean(dec.product?.id);
  return true;
}

/** Baris perlu dicek yang belum diputuskan (urut line_no). */
export function undecidedLines(r: ReceiptDetail, d: Decisions): ReceiptLine[] {
  return needsCheckLines(r).filter((l) => !isValidDecision(l, d[l.id]));
}

/**
 * p_lines W4: setiap baris yang punya keputusan sah (perlu dicek, atau koreksi pada baris yang sudah
 * tersimpan otomatis). Baris lain tidak dikirim; server menolak baris perlu dicek yang terlewat
 * (UNDECIDED_LINES).
 */
export function toPLines(r: ReceiptDetail, d: Decisions): RpcInput<'confirm_receipt'>['p_lines'] {
  const out: RpcInput<'confirm_receipt'>['p_lines'] = [];
  for (const l of r.lines) {
    if (l.line_type !== 'product') continue;
    const dec = d[l.id];
    if (!isValidDecision(l, dec)) continue;
    const item: (typeof out)[number] = { line_id: l.id, action: dec.action };
    if (dec.action === 'replace') item.product_id = dec.product!.id;
    if ((dec.action === 'accept' || dec.action === 'replace') && dec.is_bundle) item.is_bundle = true;
    out.push(item);
  }
  return out;
}

/** Jumlah harga yang akan tersimpan setelah W4 ("Simpan N harga"). */
export function savedCountAfter(r: ReceiptDetail, d: Decisions): number {
  let n = 0;
  for (const l of r.lines) {
    if (l.line_type !== 'product') continue;
    const dec = d[l.id];
    if (isValidDecision(l, dec)) {
      if (dec.action === 'accept' || dec.action === 'replace') n += 1;
    } else if (l.record && l.record.status === 'active') {
      n += 1;
    }
  }
  return n;
}

/** Produk yang harganya berubah karena W4 (invalidasi + SummaryUpdating). */
export function affectedProductIds(r: ReceiptDetail, d: Decisions): string[] {
  const ids = new Set<string>();
  for (const l of r.lines) {
    if (l.record) ids.add(l.record.product_id);
    const dec = d[l.id];
    if (!isValidDecision(l, dec)) continue;
    if (dec.action === 'accept' && l.suggestion) ids.add(l.suggestion.id);
    if (dec.action === 'replace' && dec.product) ids.add(dec.product.id);
  }
  return [...ids];
}

export interface LineGroups {
  needsCheck: ReceiptLine[];
  autoSaved: ReceiptLine[];
  nonProduct: ReceiptLine[];
}

/** Lipatan S-10: perlu dicek di atas, tersimpan otomatis dan bukan produk dilipat (U-12). */
export function groupLines(r: ReceiptDetail): LineGroups {
  return {
    needsCheck: r.lines.filter((l) => l.needs_check),
    autoSaved: r.lines.filter((l) => l.line_type === 'product' && !l.needs_check),
    nonProduct: r.lines.filter((l) => l.line_type !== 'product'),
  };
}

/** Field header yang dicek "ragu" (receipt.field_confidence, D-49). */
export const HEADER_FIELDS = ['store', 'branch', 'date', 'time', 'total', 'subtotal'] as const;
export type HeaderField = (typeof HEADER_FIELDS)[number];

/** Field dengan confidence < τ (R2 auto_save_min_confidence) diberi teks "ragu" (U-15). */
export function doubtfulFields(fc: Record<string, number> | null | undefined, tau: number): Set<HeaderField> {
  const out = new Set<HeaderField>();
  if (!fc) return out;
  for (const k of HEADER_FIELDS) {
    const v = fc[k];
    if (typeof v === 'number' && v < tau) out.add(k);
  }
  return out;
}

/** Saran baris "ragu" jika confidence matching < τ. */
export function isDoubtfulMatch(confidence: number | null | undefined, tau: number): boolean {
  return confidence == null || confidence < tau;
}

/** Diskon dan void yang menempel (dijumlah untuk teks "diskon −3.400 = Rp19.500"). */
export function attachedTotals(l: ReceiptLine): { discount: number; voided: boolean; net: number } {
  let discount = 0;
  let voided = false;
  for (const a of l.attached) {
    if (a.line_type === 'discount') discount += a.line_amount;
    if (a.line_type === 'void') voided = true;
  }
  const voidSum = l.attached.filter((a) => a.line_type === 'void').reduce((s, a) => s + a.line_amount, 0);
  return { discount, voided, net: l.line_amount + discount + voidSum };
}

// ---------------------------------------------------------------------------
// Pilihan user di sessionStorage (§7.3 "pilihan dipertahankan di memori + sessionStorage")
// ---------------------------------------------------------------------------
const KEY = (id: string) => `priceatlas:receipt-decisions:${id}`;

export interface StoredReceiptState {
  decisions: Decisions;
  duplicate: 'distinct' | null;
}

export function loadReceiptState(id: string): StoredReceiptState {
  try {
    const raw = sessionStorage.getItem(KEY(id));
    if (raw) {
      const v = JSON.parse(raw) as Partial<StoredReceiptState>;
      return { decisions: v.decisions ?? {}, duplicate: v.duplicate === 'distinct' ? 'distinct' : null };
    }
  } catch {
    // sessionStorage tidak tersedia: pilihan hanya di memori.
  }
  return { decisions: {}, duplicate: null };
}

export function saveReceiptState(id: string, state: StoredReceiptState): void {
  try {
    sessionStorage.setItem(KEY(id), JSON.stringify(state));
  } catch {
    // abaikan
  }
}

export function clearReceiptState(id: string): void {
  try {
    sessionStorage.removeItem(KEY(id));
  } catch {
    // abaikan
  }
}
