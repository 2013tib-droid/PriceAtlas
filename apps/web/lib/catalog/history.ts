// Riwayat S-16 (R20 `history` = audit_log price_record + receipt_line record ini, §5.10). Audit hanya
// mencatat UPDATE/DELETE oleh user (app.audit_row) dan merge; pembuatan record tidak diaudit, sehingga
// baris pertama riwayat diambil dari `created_at` record (F-68). Logika tanpa React (L5a).
import type { AuditEntry, PriceRecordFull } from '@priceatlas/contracts';
import { CATALOG_COPY, fill } from '@/lib/copy/id';
import { formatDateAbsolute, formatRupiah } from '@/lib/format';

const H = CATALOG_COPY.history;

/** Kolom yang ditampilkan (yang lain, mis. updated_at/unit_price/match_outcome, adalah turunan). */
const FIELD_LABEL: Record<string, string> = H.fields;
const MONEY = new Set(['normal_price', 'promo_price', 'member_price', 'effective_price', 'line_amount', 'unit_amount']);

export interface HistoryLine {
  at: string;
  kind: 'created' | 'changed' | 'merged' | 'deleted';
  /** Perubahan yang bisa dibaca: "harga normal: Rp19.500 → Rp19.900". */
  changes: string[];
  /** Sumber perubahan: record harga atau baris struk ("mengubah baris struk"). */
  entity: 'price_record' | 'receipt_line' | 'other';
}

function valueText(field: string, v: unknown): string {
  if (v == null || v === '') return H.empty;
  if (MONEY.has(field) && typeof v === 'number') return formatRupiah(v);
  if (field === 'transaction_date' && typeof v === 'string') return formatDateAbsolute(v);
  if (field === 'status') return v === 'void' ? H.statusVoid : H.statusActive;
  if (field === 'is_bundle') return v ? H.yes : H.no;
  if (typeof v === 'object') return H.changedValue;
  return String(v);
}

export function auditChanges(e: Pick<AuditEntry, 'before' | 'after'>): string[] {
  const before = e.before ?? {};
  const after = e.after ?? {};
  const out: string[] = [];
  for (const field of Object.keys(FIELD_LABEL)) {
    const a = before[field];
    const b = after[field];
    if (JSON.stringify(a ?? null) === JSON.stringify(b ?? null)) continue;
    // Id (produk, toko, cabang, program) dan extra: cukup nama kolomnya.
    const plain = field.endsWith('_id') || field === 'extra';
    out.push(
      plain
        ? FIELD_LABEL[field]!
        : fill(H.change, { field: FIELD_LABEL[field]!, from: valueText(field, a), to: valueText(field, b) }),
    );
  }
  return out;
}

/** Riwayat terbaru di atas, ditutup baris "Dibuat" dari record. */
export function historyLines(
  record: Pick<PriceRecordFull, 'created_at'>,
  history: readonly AuditEntry[],
): HistoryLine[] {
  const lines: HistoryLine[] = history.map((e) => ({
    at: e.created_at,
    kind: e.action === 'merge' ? 'merged' : e.action === 'delete' ? 'deleted' : 'changed',
    changes: auditChanges(e),
    entity: e.entity_type === 'price_record' || e.entity_type === 'receipt_line' ? e.entity_type : 'other',
  }));
  lines.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  lines.push({ at: record.created_at, kind: 'created', changes: [], entity: 'price_record' });
  return lines;
}
