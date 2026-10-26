// Barcode/PLU produk privat yang sudah ada di S-15 edit (D-89, Q-85, F-69, F-55): REST langsung
// `barcode_assignment` select + insert (RLS: household_id disalin trigger dari produk; check
// `plu ⇒ store_id`, format GTIN, exclusion constraint periode). Tanpa update/delete di MVP.
// Aturan form sama dengan S-15 baru (lib/confirm/product-form.ts). Logika tanpa React (L5a).
import { z } from 'zod';
import { GTIN_RE, PLU_RE } from '@/lib/confirm/product-form';
import { CATALOG_COPY, NEW_PRODUCT_COPY as N, SQLSTATE_COPY } from '@/lib/copy/id';
import { errorCopy, toAppError } from '@/lib/data/errors';
import type { BarcodeRow } from '@/lib/data/rest-schemas';

const B = CATALOG_COPY.barcodes;

export const barcodeFormSchema = z
  .object({ code_type: z.enum(['gtin', 'plu']), code: z.string(), store_id: z.string() })
  .superRefine((v, ctx) => {
    const code = v.code.trim();
    if (v.code_type === 'plu') {
      if (!PLU_RE.test(code)) ctx.addIssue({ code: 'custom', path: ['code'], message: N.pluErrors.code });
      if (!v.store_id) ctx.addIssue({ code: 'custom', path: ['store_id'], message: N.pluErrors.store });
    } else if (!GTIN_RE.test(code)) ctx.addIssue({ code: 'custom', path: ['code'], message: N.errors.barcode });
  });
export type BarcodeFormValues = z.input<typeof barcodeFormSchema>;

/** PLU hanya untuk produk timbang (sama dengan S-15 baru). */
export function defaultBarcodeForm(saleMode: 'unit' | 'weight'): BarcodeFormValues {
  return { code_type: saleMode === 'weight' ? 'plu' : 'gtin', code: '', store_id: '' };
}

export type BarcodeInsert = {
  id: string;
  product_id: string;
  code: string;
  code_type: 'gtin' | 'plu';
  store_id: string | null;
};

/** Baris insert dengan id dari klien: kirim ulang → 23505 = sudah tersimpan (idempoten, docs/05 §3.1). */
export function toBarcodeInsert(v: BarcodeFormValues, productId: string, id: string): BarcodeInsert {
  const plu = v.code_type === 'plu';
  return { id, product_id: productId, code: v.code.trim(), code_type: v.code_type, store_id: plu ? v.store_id : null };
}

/** Kode yang sama sudah aktif di produk ini (exclusion constraint juga menolak, tetapi pesannya lain). */
export function alreadyListed(v: BarcodeFormValues, rows: readonly BarcodeRow[]): boolean {
  const code = v.code.trim();
  return rows.some(
    (r) =>
      r.valid_until == null &&
      r.code === code &&
      r.code_type === v.code_type &&
      (v.code_type === 'gtin' || r.store_id === v.store_id),
  );
}

/** Kode aktif dulu, terbaru di atas. */
export function sortBarcodes(rows: readonly BarcodeRow[]): BarcodeRow[] {
  return [...rows].sort(
    (a, b) =>
      Number(a.valid_until != null) - Number(b.valid_until != null) ||
      b.valid_from.localeCompare(a.valid_from) ||
      a.code.localeCompare(b.code),
  );
}

/** Insert `barcode_assignment`: 23P01 (dipakai produk lain di periode sama), 23514 (format), 42501. */
export function barcodeError(e: unknown): { message: string; field: 'code' | 'store_id' | null } {
  const err = toAppError(e);
  const sqlstate = err.rpc?.sqlstate;
  if (sqlstate === '23P01') return { message: SQLSTATE_COPY['23P01']!.message, field: 'code' };
  if (sqlstate === '23514') return { message: N.errors.barcode, field: 'code' };
  if (sqlstate === '23503') return { message: B.storeGone, field: 'store_id' };
  if (sqlstate === '42501') return { message: CATALOG_COPY.edit.notOwned, field: null };
  return { message: errorCopy(e, 'S-15').message, field: null };
}
