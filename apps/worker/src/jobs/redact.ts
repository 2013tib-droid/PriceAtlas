// Redaksi PII teks OCR mentah dan output AI (docs/05 §7.4, docs/08 §9), dijalankan job redact_ocr.
//   Lapis 1 (di sumber): prompt meminta transkripsi dengan [REDAKSI] (bukan di file ini).
//   Lapis 2 (nilai terstruktur): nilai receipt.pii (kartu, HP, member, nama, email) disamarkan dari
//            teks, tanpa beda huruf besar/kecil dan spasi; nilai angka pendek hanya utuh (bukan bagian harga).
//   Lapis 3 (regex): HP, kartu/NIK, email, plus nilai setelah label baris (NAMA, MEMBER, KARTU, TELP,
//            ALAMAT, PENERIMA, APPR, REF NO, …). Label harus di awal baris dan diikuti pemisah (`:`, `=`,
//            `#`), atau label kode diikuti angka, supaya nama produk/diskon ("DISC MEMBER") tidak terhapus.
// Tanpa panggilan AI tambahan (biaya dobel dan PII terkirim ulang, §9).
export const REDACTED = '[REDAKSI]';

const PATTERNS: RegExp[] = [
  // HP Indonesia: 08…, 628…, +628… (sebelum pola kartu, supaya "+62…" tersamar utuh).
  /(?:\+62|\b62|\b0)8\d(?:[ -]?\d){6,11}\b/g,
  // Nomor kartu 13–19 digit (juga NIK 16 digit), boleh dipisah spasi/strip; juga bentuk tersamar "**** 1234".
  /\b(?:\d[ -]?){12,18}\d\b/g,
  /(?:[*xX#]{4}[ -]?){1,3}\d{4}\b/g,
  // Email
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
];

/** Label baris yang nilainya PII (§9 lapis 3). Dicocokkan tanpa beda huruf besar/kecil. */
const PII_LABEL = String.raw`(?:NAMA(?:[ \t]+(?:PELANGGAN|PENERIMA|MEMBER|CUSTOMER))?|NAME|CUSTOMER(?:[ \t]+NAME)?|PELANGGAN|` +
  String.raw`MEMBER(?:[ \t]+(?:NAME|ID|NO\.?))?|NO\.?[ \t]*MEMBER|ID[ \t]+MEMBER|KARTU|NO\.?[ \t]*KARTU|CARD(?:[ \t]+NO\.?)?|` +
  String.raw`TELP?\.?|TELEPON|PHONE|(?:NO\.?[ \t]*)?HP|ALAMAT(?:[ \t]+PENGIRIMAN)?|PENERIMA|EMAIL|` +
  String.raw`APPR(?:OVAL)?(?:[ \t]+CODE)?|REF(?:\.|ERENCE)?[ \t]*NO\.?)`;
/** Label kode yang sering tanpa pemisah: "NO MEMBER 1234567", "APPR CODE 123456", "REF NO 98765". */
const CODE_LABEL = String.raw`(?:NO\.?[ \t]*MEMBER|ID[ \t]+MEMBER|MEMBER[ \t]+(?:ID|NO\.?)|NO\.?[ \t]*KARTU|` +
  String.raw`APPR(?:OVAL)?(?:[ \t]+CODE)?|REF(?:\.|ERENCE)?[ \t]*NO\.?)`;
/** Nilai yang berupa harga ("Member: Rp21.000" di label rak) bukan PII. */
const NOT_PRICE = String.raw`(?!RP\b|RP\.|RP[ \t]*\d)`;

const LABEL_PATTERNS: RegExp[] = [
  new RegExp(String.raw`^([ \t]*${PII_LABEL}[ \t]*[:=#][ \t]*)${NOT_PRICE}\S[^\n]*$`, 'gimu'),
  new RegExp(String.raw`^([ \t]*${CODE_LABEL}[ \t]+)\d[^\n]*$`, 'gimu'),
];

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Lapis 2: nilai pii → pola tanpa beda huruf besar/kecil dan spasi; angka hanya jika utuh. */
function valuePattern(v: string): RegExp {
  const body = v.trim().split(/\s+/).map(escapeRegExp).join(String.raw`\s+`);
  return /^\d+$/.test(v.trim()) ? new RegExp(String.raw`(?<!\d)${body}(?!\d)`, 'g') : new RegExp(body, 'giu');
}

export function redactText(text: string, piiValues: string[] = []): string {
  let out = text;
  for (const v of piiValues.filter((x) => x.trim().length >= 4).sort((a, b) => b.length - a.length)) {
    out = out.replace(valuePattern(v), REDACTED);
  }
  for (const re of LABEL_PATTERNS) out = out.replace(re, `$1${REDACTED}`);
  for (const re of PATTERNS) out = out.replace(re, REDACTED);
  return out;
}

/** Redaksi semua string di dalam JSON; objek `pii` dikosongkan. */
export function redactJson(value: unknown, piiValues: string[] = []): unknown {
  if (typeof value === 'string') return redactText(value, piiValues);
  if (Array.isArray(value)) return value.map((v) => redactJson(v, piiValues));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, k === 'pii' ? {} : redactJson(v, piiValues)]),
    );
  }
  return value;
}

export function piiStrings(pii: unknown): string[] {
  if (!pii || typeof pii !== 'object') return [];
  return Object.values(pii as Record<string, unknown>).filter((v): v is string => typeof v === 'string');
}
