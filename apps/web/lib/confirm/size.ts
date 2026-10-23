// Peringatan beda ukuran di klien, bukan blokir (wireframe S-11 "Judul menyebut 500G, produk yang
// dipilih 200 g", S-14 "Teks struk menyebut 200G, produk ini 500 g"; docs/05 §3.3 S-14).
// Ukuran dibaca dari teks bebas (raw_text struk/label, judul listing) lalu dibandingkan dalam satuan
// dasar dimensi yang sama (UNITS kontrak). Teks tanpa ukuran atau beda dimensi → tidak ada peringatan.
import { UNITS, type Dimension, type UnitCode } from '@priceatlas/contracts';

export interface TextSize {
  /** Total dalam satuan dasar (g, ml, pcs, m). */
  base: number;
  dimension: Dimension;
  /** Potongan teks aslinya, mis. "500G", "10X35G". */
  text: string;
}

const UNIT_ALIASES: Record<string, UnitCode> = {
  mg: 'mg',
  g: 'g',
  gr: 'g',
  gram: 'g',
  grm: 'g',
  kg: 'kg',
  kilo: 'kg',
  ml: 'ml',
  l: 'l',
  lt: 'l',
  ltr: 'l',
  liter: 'l',
  litre: 'l',
  pcs: 'pcs',
  pc: 'pcs',
  cm: 'cm',
  m: 'm',
  meter: 'm',
};

// "10X35G", "10 x 35 g", "2 × 1L", "500G", "1,5 L", "0.5kg". Satuan harus diikuti batas kata.
const SIZE_RE =
  /(?:(\d+)\s*[x×]\s*)?(\d+(?:[.,]\d+)?)\s*(mg|kg|kilo|grm|gram|gr|g|ml|ltr|liter|litre|lt|l|pcs|pc|cm|meter|m)(?![a-z])/gi;

/** Ukuran pertama yang terbaca di teks, atau null. */
export function parseTextSize(text: string | null | undefined): TextSize | null {
  if (!text) return null;
  SIZE_RE.lastIndex = 0;
  const m = SIZE_RE.exec(text);
  if (!m) return null;
  const count = m[1] ? Number(m[1]) : 1;
  const size = Number(m[2]!.replace(',', '.'));
  const code = UNIT_ALIASES[m[3]!.toLowerCase()];
  if (!code || !Number.isFinite(size) || size <= 0) return null;
  const u = UNITS[code];
  return { base: count * size * u.toBaseFactor, dimension: u.dimension, text: m[0].trim() };
}

export interface SizedLite {
  sale_mode: 'unit' | 'weight';
  pack_count: number;
  content_size: number | null;
  content_unit: string;
}

/** Ukuran total produk dalam satuan dasar; null untuk produk timbang. */
export function productBaseSize(p: SizedLite): { base: number; dimension: Dimension } | null {
  if (p.sale_mode !== 'unit' || p.content_size == null) return null;
  const u = UNITS[p.content_unit as UnitCode];
  if (!u) return null;
  return { base: p.pack_count * p.content_size * u.toBaseFactor, dimension: u.dimension };
}

/** Toleransi pembulatan (mis. "1,5 L" vs 1500 ml). */
const TOLERANCE = 0.005;

/** Teks ukuran yang tidak cocok dengan produk, atau null jika cocok / tidak bisa dibandingkan. */
export function sizeMismatch(text: string | null | undefined, p: SizedLite | null | undefined): string | null {
  if (!p) return null;
  const t = parseTextSize(text);
  const s = productBaseSize(p);
  if (!t || !s || t.dimension !== s.dimension) return null;
  return Math.abs(t.base - s.base) / s.base > TOLERANCE ? t.text : null;
}
