// Format angka harga (docs/07 §10.3, wireframe §5.3). Semua teks harga lewat modul ini.
//   Rupiah            Rp19.500    — bukan Intl currency (memberi "Rp 19.500" dengan spasi, P-17)
//   Harga per satuan  Rp97,5/g    — maks 1 desimal; 2 desimal jika < Rp1
//   Persen            4%
const INT = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 });
const ONE = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 1 });
const TWO = new Intl.NumberFormat('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Rp19.500. Dibulatkan ke rupiah terdekat. Negatif: "-Rp2.000". */
export function formatRupiah(value: number): string {
  if (!Number.isFinite(value)) return '–';
  const abs = INT.format(Math.abs(Math.round(value)));
  return value < 0 && Math.round(value) !== 0 ? `-Rp${abs}` : `Rp${abs}`;
}

/** Angka harga per satuan tanpa "Rp": 97,5 · 0,85 · 1.250 */
export function formatUnitAmount(value: number): string {
  if (!Number.isFinite(value)) return '–';
  return Math.abs(value) < 1 ? TWO.format(value) : ONE.format(value);
}

/** Rp97,5/g · Rp0,85/ml · Rp45.000/kg */
export function formatUnitPrice(value: number, unit: string): string {
  if (!Number.isFinite(value)) return '–';
  return `Rp${formatUnitAmount(value)}/${unit}`;
}

const UNIT_SPOKEN: Record<string, string> = {
  g: 'gram',
  kg: 'kilogram',
  ml: 'mililiter',
  l: 'liter',
  pcs: 'buah',
  m: 'meter',
};

/** Teks untuk pembaca layar (§10.1): "97,5 rupiah per gram". */
export function spokenUnitPrice(value: number, unit: string): string {
  return `${formatUnitAmount(value)} rupiah per ${UNIT_SPOKEN[unit] ?? unit}`;
}

/** 4% (tanpa tanda). Arah naik/turun ditulis oleh pemanggil (U-05, label teks). */
export function formatPercent(value: number): string {
  if (!Number.isFinite(value)) return '–';
  return `${INT.format(Math.abs(value))}%`;
}

const SIZE = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 3 });

export interface SizedProduct {
  sale_mode: 'unit' | 'weight';
  pack_count: number;
  content_size: number | null;
  content_unit: string;
}

/** Ukuran kemasan: "200 g", "10 × 35 g"; produk timbang: "per kg" (§5.1, D-17). */
export function formatSize(p: SizedProduct): string {
  if (p.sale_mode === 'weight' || p.content_size == null) return `per ${p.content_unit}`;
  const size = `${SIZE.format(p.content_size)} ${p.content_unit}`;
  return p.pack_count > 1 ? `${p.pack_count} × ${size}` : size;
}

/** Berat aktual produk timbang: "0,535 kg". */
export function formatQuantity(value: number, unit: string): string {
  return `${SIZE.format(value)} ${unit}`;
}

/** Isian harga: "19.500" / "19500" / "Rp19.500" / "" → 19500 / null (titik = ribuan, koma = desimal). */
export function parsePrice(s: string): number | null {
  const t = s.replace(/[^\d,]/g, '').replace(',', '.');
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** Angka → teks isian yang dibaca ulang parsePrice dengan nilai sama (desimal memakai koma). */
export function priceInputText(v: number | null | undefined): string {
  return v == null ? '' : String(v).replace('.', ',');
}
