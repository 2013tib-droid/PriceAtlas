// Pemetaan error §8.2 untuk S-15 edit, S-16, S-17, S-18 (docs/07 §8.1–§8.2): pesan (lib/copy) + aksi
// layar. Logika tanpa React supaya diuji unit (L5a). Kode tidak dikenal → hint server → cadangan umum.
import { CATALOG_COPY, ERROR_COPY, SQLSTATE_COPY } from '@/lib/copy/id';
import { errorCopy, toAppError } from '@/lib/data/errors';

export type RecordErrorAction =
  | { kind: 'reload' }
  | { kind: 'focus-normal' }
  | { kind: 'focus-extra' }
  | { kind: 'edit-line' }
  | { kind: 'back' }
  | { kind: 'none' };

/** W6 / W7 / PATCH receipt di S-16. */
export function recordError(e: unknown): { message: string; action: RecordErrorAction } {
  const err = toAppError(e);
  switch (err.code) {
    case 'STALE_WRITE':
      return { message: ERROR_COPY.STALE_WRITE.message, action: { kind: 'reload' } };
    case 'NO_APPLICABLE_PRICE':
      return { message: ERROR_COPY.NO_APPLICABLE_PRICE.message, action: { kind: 'focus-normal' } };
    case 'INVALID_EXTRA':
      return { message: ERROR_COPY.INVALID_EXTRA.message, action: { kind: 'focus-extra' } };
    case 'USE_RECEIPT_LINE':
      return { message: ERROR_COPY.USE_RECEIPT_LINE.message, action: { kind: 'edit-line' } };
    case 'RECEIPT_DERIVED_FIELD':
      return { message: ERROR_COPY.RECEIPT_DERIVED_FIELD.message, action: { kind: 'edit-line' } };
    case 'NOT_FOUND':
      return { message: ERROR_COPY.NOT_FOUND.message, action: { kind: 'back' } };
    case 'INVALID_STATE':
      return { message: CATALOG_COPY.record.receiptDiscarded, action: { kind: 'reload' } };
    default:
      return { message: errorCopy(e, 'S-16').message, action: { kind: 'none' } };
  }
}

/** W10 / R19 / PATCH product (pindah group) di S-17. */
export function mergeError(e: unknown): string {
  const err = toAppError(e);
  if (err.code === 'MERGE_FORBIDDEN' || err.rpc?.sqlstate === '42501') return ERROR_COPY.MERGE_FORBIDDEN.message;
  if (err.rpc?.sqlstate === 'P0001') return SQLSTATE_COPY.P0001!.message;
  if (err.code === 'NOT_FOUND') return CATALOG_COPY.merge.notFound;
  return errorCopy(e, 'S-17').message;
}

export type SplitErrorAction = { kind: 'reload-records' } | { kind: 'retry' } | { kind: 'pick-target' };

/** W8 (T1) / W9 (T2) di S-18. Gagal jaringan di T2 → ulangi dengan id produk yang sama (§4.5). */
export function splitError(e: unknown): { message: string; action: SplitErrorAction } {
  const err = toAppError(e);
  if (err.code === 'RECORDS_NOT_OWNED')
    return { message: ERROR_COPY.RECORDS_NOT_OWNED.message, action: { kind: 'reload-records' } };
  if (err.code === 'NOT_FOUND') return { message: CATALOG_COPY.split.targetGone, action: { kind: 'pick-target' } };
  return { message: errorCopy(e, 'S-18').message, action: { kind: 'retry' } };
}

export type ProductEditField = 'name' | 'content_size' | 'product_group_id' | null;

/** REST PATCH product di S-15 edit / arsip: 0 baris = STALE_WRITE, 23514 ukuran, 23503 referensi. */
export function productEditError(e: unknown): { message: string; field: ProductEditField; stale: boolean } {
  const err = toAppError(e);
  if (err.code === 'STALE_WRITE') return { message: ERROR_COPY.STALE_WRITE.message, field: null, stale: true };
  const sqlstate = err.rpc?.sqlstate;
  if (sqlstate === '23514') return { message: SQLSTATE_COPY['23514']!.message, field: 'content_size', stale: false };
  if (sqlstate === '23503') return { message: CATALOG_COPY.edit.refGone, field: 'product_group_id', stale: false };
  if (sqlstate === '42501') return { message: CATALOG_COPY.edit.notOwned, field: null, stale: false };
  return { message: errorCopy(e, 'S-15').message, field: null, stale: false };
}
