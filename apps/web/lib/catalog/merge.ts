// S-17 Gabungkan produk (docs/07 §7.3, docs/05 §4.4, wireframe S-17, U-16): R19 → keadaan layar.
// Logika tanpa React supaya diuji unit (L5a).
//   - `already_merged` = sukses (docs/05 §4.4: "sumber sudah merged ke target yang sama").
//   - Beda ukuran atau dimensi → ConfirmTwice + opsi "Pindahkan ke group" (U-16, T-9).
//   - Barcode privat tidak pindah ke produk global (F-01, D-65): `barcodes_kept`.
import type { MergePreview, MergeReason } from '@priceatlas/contracts';
import { CATALOG_COPY, fill } from '@/lib/copy/id';
import { formatSize } from '@/lib/format';

export type MergeView =
  | { kind: 'done' }
  | { kind: 'blocked'; reason: MergeReason; message: string }
  | {
      kind: 'ready';
      /** Konfirmasi dua kali (U-16): ukuran atau dimensi berbeda. */
      twice: boolean;
      mismatch: string | null;
      counts: MergePreview['counts'];
      /** Opsi "Pindahkan ke group" (produk privat, target punya group lain). */
      canMoveGroup: boolean;
    };

const M = CATALOG_COPY.merge;

export function reasonMessage(reason: MergeReason): string {
  return M.reasons[reason];
}

/** "200 g vs 500 g" / "200 g vs 500 ml (satuan berbeda)". Null jika ukurannya sama. */
export function mismatchText(p: Pick<MergePreview, 'from' | 'into' | 'size_mismatch' | 'dimension_mismatch'>) {
  if (!p.size_mismatch && !p.dimension_mismatch) return null;
  const vs = fill(M.sizeVs, { from: sizeOf(p.from), into: sizeOf(p.into) });
  return p.dimension_mismatch ? fill(M.dimensionVs, { vs }) : vs;
}

function sizeOf(p: MergePreview['from']): string {
  return p.sale_mode === 'weight' ? fill(M.perUnit, { unit: p.content_unit }) : formatSize(p);
}

export function canMoveToGroup(p: Pick<MergePreview, 'from' | 'into'>): boolean {
  return p.from.is_private && p.into.product_group_id != null && p.into.product_group_id !== p.from.product_group_id;
}

export function mergeView(p: MergePreview): MergeView {
  if (p.reason === 'already_merged') return { kind: 'done' };
  if (!p.can_merge || p.reason) {
    const reason = p.reason ?? 'source_not_active';
    return { kind: 'blocked', reason, message: reasonMessage(reason) };
  }
  const mismatch = mismatchText(p);
  return { kind: 'ready', twice: mismatch != null, mismatch, counts: p.counts, canMoveGroup: canMoveToGroup(p) };
}

/** "Pindah: 6 harga · 2 alias · 1 barcode" (+ catatan barcode privat yang tetap, F-01). */
export function countsText(c: MergePreview['counts']): string {
  const moved = c.barcodes - c.barcodes_kept;
  return fill(M.counts, { records: c.price_records, aliases: c.aliases, barcodes: moved });
}

/** Produk sumber yang boleh memulai merge (D-30): privat, aktif. */
export function canStartMerge(p: Pick<MergePreview['from'], 'is_private' | 'status'>): boolean {
  return p.is_private && p.status === 'active';
}
