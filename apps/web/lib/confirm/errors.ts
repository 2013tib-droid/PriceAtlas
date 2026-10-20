// Pemetaan error §8.2 untuk S-10, S-11, S-12, S-15 (docs/07 §8.1–§8.2): pesan (lib/copy) + aksi
// layar. Logika tanpa React supaya diuji unit (L5a).
import type { ReceiptDetail } from '@priceatlas/contracts';
import { ERROR_COPY, fill, NEW_PRODUCT_COPY, SQLSTATE_COPY } from '@/lib/copy/id';
import { errorCopy, toAppError } from '@/lib/data/errors';
import { formatDateAbsolute, formatRupiah } from '@/lib/format';

export type ReceiptErrorAction =
  | { kind: 'duplicate'; duplicateOf: string | null }
  | { kind: 'scroll-line'; lineId: string | null; count: number }
  | { kind: 'pick-store' }
  | { kind: 'view-upload' }
  | { kind: 'reload' }
  | { kind: 'none' };

/** W4 / PATCH header / W7 di S-10 → pesan + aksi. */
export function receiptError(e: unknown, r?: ReceiptDetail | null): { message: string; action: ReceiptErrorAction } {
  const err = toAppError(e);
  const detail = err.rpc?.detail ?? {};
  switch (err.code) {
    case 'DUPLICATE_DECISION_REQUIRED': {
      const d = r?.duplicate;
      return {
        message: fill(ERROR_COPY.DUPLICATE_DECISION_REQUIRED.message, {
          toko: d?.store?.name ?? '',
          tanggal: d?.date ? formatDateAbsolute(d.date) : '',
          total: d?.total != null ? formatRupiah(d.total) : '–',
        }).replace(/\s{2,}/g, ' '),
        action: {
          kind: 'duplicate',
          duplicateOf: typeof detail.duplicate_of === 'string' ? detail.duplicate_of : null,
        },
      };
    }
    case 'UNDECIDED_LINES': {
      const ids = Array.isArray(detail.line_ids) ? (detail.line_ids as string[]) : [];
      return {
        message: fill(ERROR_COPY.UNDECIDED_LINES.message, { n: ids.length || 1 }),
        action: { kind: 'scroll-line', lineId: ids[0] ?? null, count: ids.length },
      };
    }
    case 'RECEIPT_STORE_REQUIRED':
      return { message: ERROR_COPY.RECEIPT_STORE_REQUIRED.message, action: { kind: 'pick-store' } };
    case 'INVALID_STATE':
      return { message: errorCopy(e, 'S-10').message, action: { kind: 'view-upload' } };
    case 'STALE_WRITE':
      return { message: ERROR_COPY.STALE_WRITE.message, action: { kind: 'reload' } };
    case 'NOT_FOUND':
      return { message: ERROR_COPY.NOT_FOUND.message, action: { kind: 'reload' } };
    default:
      return { message: errorCopy(e, 'S-10').message, action: { kind: 'none' } };
  }
}

export type ItemsErrorAction =
  | { kind: 'pick-store'; itemId: string | null }
  | { kind: 'focus-normal'; itemId: string | null }
  | { kind: 'focus-extra'; itemId: string | null }
  | { kind: 'reload' }
  | { kind: 'none' };

/** W5 / W18 di S-11 → pesan + aksi. */
export function itemsError(e: unknown): { message: string; action: ItemsErrorAction } {
  const err = toAppError(e);
  const itemId = typeof err.rpc?.detail.item_id === 'string' ? err.rpc.detail.item_id : null;
  switch (err.code) {
    case 'STORE_REQUIRED':
      return { message: ERROR_COPY.STORE_REQUIRED.message, action: { kind: 'pick-store', itemId } };
    case 'NO_APPLICABLE_PRICE':
      return { message: ERROR_COPY.NO_APPLICABLE_PRICE.message, action: { kind: 'focus-normal', itemId } };
    case 'INVALID_EXTRA':
      return { message: ERROR_COPY.INVALID_EXTRA.message, action: { kind: 'focus-extra', itemId } };
    case 'INVALID_STATE':
    case 'STALE_WRITE':
    case 'NOT_FOUND':
      return { message: errorCopy(e, 'S-11').message, action: { kind: 'reload' } };
    default:
      return { message: errorCopy(e, 'S-11').message, action: { kind: 'none' } };
  }
}

/** create dengan id dari klien: 23505 = sudah tersimpan = sukses (docs/05 §3.1, §8.2). */
export function isAlreadyCreated(e: unknown): boolean {
  return toAppError(e).rpc?.sqlstate === '23505';
}

export type ProductFormField = 'name' | 'content_size' | 'barcodes' | null;

/** W8 di S-15: 23514 → ukuran, 23P01 → barcode (§8.2). */
export function productError(e: unknown): { message: string; field: ProductFormField } {
  const sqlstate = toAppError(e).rpc?.sqlstate;
  if (sqlstate === '23514') {
    const msg = toAppError(e).rpc?.message ?? '';
    // check gtin (barcode_assignment) juga 23514.
    if (/barcode/.test(msg)) return { message: NEW_PRODUCT_COPY.errors.barcode, field: 'barcodes' };
    return { message: SQLSTATE_COPY['23514']!.message, field: 'content_size' };
  }
  if (sqlstate === '23P01') return { message: SQLSTATE_COPY['23P01']!.message, field: 'barcodes' };
  if (toAppError(e).code === 'INVALID_INPUT') return { message: errorCopy(e, 'S-15').message, field: 'name' };
  return { message: errorCopy(e, 'S-15').message, field: null };
}

/** W17 / REST di S-12. */
export function locationError(e: unknown): string {
  return errorCopy(e, 'S-12').message;
}
