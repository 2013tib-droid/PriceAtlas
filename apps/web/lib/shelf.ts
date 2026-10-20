// Cek harga rak (S-03b, D-55, U-06): murni di klien, tidak menulis data. Rumus harga per satuan
// sama dengan app.compute_unit_price (unitPrice kontrak). Ambang "mendekati" dari R2
// near_best_threshold_pct (≤ 5%, W-08).
import { pctVs, unitPrice, type CompareSizesRow, type ProductCard, type ProductDetail } from '@priceatlas/contracts';

export type ShelfVerdict = 'cheaper' | 'near' | 'pricier';

type Point = NonNullable<ProductCard['summary']>['best_all'];

export interface ShelfResult {
  /** Harga per satuan dasar dari harga yang diketik. */
  unit: number;
  best: { verdict: ShelfVerdict; pct: number; point: Point; window: '90d' | 'all' } | null;
  last: { pct: number; price: number; record: NonNullable<ProductDetail['last_record']> | null } | null;
  /** Ukuran lain di group dengan harga per satuan lebih rendah dari harga rak (termurah). */
  otherSize: { row: CompareSizesRow; savingPct: number } | null;
}

export function checkShelfPrice(input: {
  detail: ProductDetail;
  price: number;
  nearPct: number;
  sizes?: readonly CompareSizesRow[];
}): ShelfResult | null {
  const { detail, price, nearPct } = input;
  if (!(price > 0)) return null;
  const p = detail.card.product;
  const unit = unitPrice(p, price);
  const s = detail.card.summary;

  let best: ShelfResult['best'] = null;
  const ref = s?.best_90d ?? s?.best_all ?? null;
  if (s && ref) {
    const pct = pctVs(unit, ref.unit_price);
    const verdict: ShelfVerdict = unit < ref.unit_price ? 'cheaper' : pct <= nearPct ? 'near' : 'pricier';
    best = { verdict, pct, point: ref, window: s.best_90d ? '90d' : 'all' };
  }

  const last =
    s && s.last_unit_price > 0
      ? { pct: pctVs(unit, s.last_unit_price), price: s.last_effective_price, record: detail.last_record }
      : null;

  let otherSize: ShelfResult['otherSize'] = null;
  for (const row of input.sizes ?? []) {
    if (row.product.id === p.id || !row.has_data || row.unit_price == null) continue;
    if (row.dimension !== p.dimension || row.unit_price >= unit) continue;
    if (!otherSize || row.unit_price < otherSize.row.unit_price!) {
      otherSize = { row, savingPct: ((unit - row.unit_price) / unit) * 100 };
    }
  }
  return { unit, best, last, otherSize };
}

/** Keypad: tambah digit ke harga (maks 9 digit), "000", hapus satu. */
export function keypadInput(current: string, key: string): string {
  if (key === 'back') return current.slice(0, -1);
  if (key === 'clear') return '';
  if (!/^\d+$/.test(key)) return current;
  const next = (current + key).replace(/^0+/, '');
  return next.length > 9 ? current : next;
}
