// Harga per satuan dasar (§5.4, D-17, D-33). Rumus yang sama dengan
// app.compute_unit_price / app.unit_price_for di SQL:
//   unit   : harga / (pack_count × content_size × to_base_factor)
//   weight : harga / to_base_factor   (harga per 1 content_unit, mis. per kg)
// Dipakai klien untuk Cek harga rak (S-03b, D-55) tanpa menyimpan data.

export type Dimension = 'mass' | 'volume' | 'count' | 'length';

/** Salinan tabel public.unit (data referensi sistem, baseline migration). */
export const UNITS = {
  mg: { dimension: 'mass', toBaseFactor: 0.001 },
  g: { dimension: 'mass', toBaseFactor: 1 },
  kg: { dimension: 'mass', toBaseFactor: 1000 },
  ml: { dimension: 'volume', toBaseFactor: 1 },
  l: { dimension: 'volume', toBaseFactor: 1000 },
  pcs: { dimension: 'count', toBaseFactor: 1 },
  lembar: { dimension: 'count', toBaseFactor: 1 },
  cm: { dimension: 'length', toBaseFactor: 0.01 },
  m: { dimension: 'length', toBaseFactor: 1 },
} as const satisfies Record<string, { dimension: Dimension; toBaseFactor: number }>;

export type UnitCode = keyof typeof UNITS;

export const BASE_UNIT: Record<Dimension, 'g' | 'ml' | 'pcs' | 'm'> = {
  mass: 'g',
  volume: 'ml',
  count: 'pcs',
  length: 'm',
};

export interface UnitPriceProduct {
  sale_mode: 'unit' | 'weight';
  pack_count: number;
  content_size: number | null;
  content_unit: string;
}

/** Harga per satuan dasar. Presisi sama dengan kolom SQL numeric(18,6). */
export function unitPrice(product: UnitPriceProduct, price: number): number {
  const unit = UNITS[product.content_unit as UnitCode];
  if (!unit) throw new Error(`Satuan tidak dikenal: ${product.content_unit}`);
  let raw: number;
  if (product.sale_mode === 'unit') {
    if (product.content_size == null || product.content_size <= 0) {
      throw new Error('Produk kemasan wajib punya content_size');
    }
    raw = price / (product.pack_count * product.content_size * unit.toBaseFactor);
  } else {
    raw = price / unit.toBaseFactor;
  }
  return round(raw, 6);
}

/** Selisih persen terhadap harga acuan, 1 desimal (pct_vs_best di R11, vs_best_pct di R18). */
export function pctVs(value: number, reference: number): number {
  return round(((value - reference) / reference) * 100, 1);
}

/** Pembulatan half-away-from-zero seperti numeric Postgres. */
export function round(x: number, digits: number): number {
  const f = 10 ** digits;
  const v = Math.abs(x) * f;
  // Koreksi galat biner kecil sebelum membulatkan (mis. 2.675 * 100 = 267.49999…).
  const r = Math.round(Number(v.toPrecision(15)));
  return (Math.sign(x) * r) / f;
}
