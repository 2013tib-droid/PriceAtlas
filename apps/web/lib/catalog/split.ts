// S-18 Pisahkan produk (docs/07 §7.3, docs/05 §4.5, D-37, wireframe S-18): split dua langkah.
//   T1 (opsional) W8 create_private_product dengan id dari klien; T2 W9 move_price_records.
//   Id produk tujuan disimpan di sessionStorage SEBELUM T1 dikirim, sehingga gagal di antara T1 dan
//   T2 (atau muat ulang halaman) mengulang dengan id yang sama: W8 ulang = 23505 = sukses, W9 ulang =
//   record yang sudah di target dilewati (idempoten). Tidak ada pemindahan otomatis (D-37).
// Logika tanpa React supaya diuji unit (L5a).
import { MovePriceRecordsInput, type PriceRecordView, type RpcInput } from '@priceatlas/contracts';

export type SourceType = PriceRecordView['source_type'];

export interface SplitFilter {
  storeId: string | null;
  source: SourceType | null;
}

export const NO_FILTER: SplitFilter = { storeId: null, source: null };

/** Toko yang ada di daftar (chip filter), urut nama. */
export function storeOptions(rows: readonly PriceRecordView[]): { id: string; name: string }[] {
  const m = new Map<string, string>();
  for (const r of rows) m.set(r.store_id, r.store_name);
  return [...m].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, 'id'));
}

export function sourceOptions(rows: readonly PriceRecordView[]): SourceType[] {
  const order: SourceType[] = ['receipt', 'price_label', 'marketplace'];
  const present = new Set(rows.map((r) => r.source_type));
  return order.filter((s) => present.has(s));
}

export function visibleRows(rows: readonly PriceRecordView[], f: SplitFilter): PriceRecordView[] {
  return rows.filter((r) => (!f.storeId || r.store_id === f.storeId) && (!f.source || r.source_type === f.source));
}

export function toggle(selected: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(selected);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

/** Centang semua yang terlihat; jika semua yang terlihat sudah dicentang, lepaskan semuanya. */
export function toggleAllVisible(selected: ReadonlySet<string>, visible: readonly PriceRecordView[]): Set<string> {
  const next = new Set(selected);
  const all = visible.length > 0 && visible.every((r) => next.has(r.id));
  for (const r of visible) {
    if (all) next.delete(r.id);
    else next.add(r.id);
  }
  return next;
}

/** Pilihan yang masih ada di daftar terbaru (mis. setelah RECORDS_NOT_OWNED → muat ulang). */
export function keepExisting(selected: ReadonlySet<string>, rows: readonly PriceRecordView[]): Set<string> {
  const ids = new Set(rows.map((r) => r.id));
  return new Set([...selected].filter((id) => ids.has(id)));
}

/** Toko alias: toko record terpilih pertama (alias per jaringan toko, D-13). */
export function aliasStore(rows: readonly PriceRecordView[], selected: ReadonlySet<string>) {
  const r = rows.find((x) => selected.has(x.id));
  return r ? { id: r.store_id, name: r.store_name } : null;
}

/** Record struk terpilih pertama: teks barisnya (R20) menjadi isian awal alias. */
export function aliasSourceRecord(rows: readonly PriceRecordView[], selected: ReadonlySet<string>): string | null {
  return rows.find((x) => selected.has(x.id) && x.source_type === 'receipt')?.id ?? null;
}

export function moveInput(
  selected: ReadonlySet<string>,
  targetId: string,
  alias: { store_id: string; alias_text: string } | null,
): RpcInput<'move_price_records'> {
  const input = {
    p_record_ids: [...selected].sort(),
    p_target_product_id: targetId,
    p_alias:
      alias && alias.alias_text.trim() ? { store_id: alias.store_id, alias_text: alias.alias_text.trim() } : null,
  };
  return MovePriceRecordsInput.parse(input);
}

// ---------------------------------------------------------------------------
// Produk tujuan (T1) disimpan per produk asal di sessionStorage.
// ---------------------------------------------------------------------------
export interface SplitTarget {
  id: string;
  name: string;
  /** true = produk baru lewat W8 (T1) yang mungkin belum terkonfirmasi tersimpan. */
  created: boolean;
  /** T1 sudah sukses (W8 / 23505). */
  saved: boolean;
}

const key = (sourceId: string) => `priceatlas:split:${sourceId}`;

export function loadSplitTarget(sourceId: string): SplitTarget | null {
  try {
    const raw = sessionStorage.getItem(key(sourceId));
    return raw ? (JSON.parse(raw) as SplitTarget) : null;
  } catch {
    return null;
  }
}

export function saveSplitTarget(sourceId: string, t: SplitTarget | null): void {
  try {
    if (t) sessionStorage.setItem(key(sourceId), JSON.stringify(t));
    else sessionStorage.removeItem(key(sourceId));
  } catch {
    // tanpa sessionStorage: id tetap di memori selama layar terbuka.
  }
}
