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
