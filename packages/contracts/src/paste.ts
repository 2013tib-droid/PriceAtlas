import { z } from 'zod';

// Struk tempelan dari Gemini (D-100, docs/08 §23). Pemilik proyek memfoto struk di Gemini dengan
// prompt tetap (GEMINI_RECEIPT_PROMPT), lalu menempel JSON jawabannya di S-21 `/tempel`. Parser ini
// dipakai dua kali: di klien (tolak sebelum kirim, Q-149) dan di worker (TextExtractor, gerbang
// akhir). Tanpa panggilan AI: format tetap, dibaca deterministik.
// Toleran terhadap kebiasaan model obrolan: pembungkus ```json, kalimat di sekitar JSON, angka
// sebagai teks ("6.200", "Rp 6.200"), field opsional yang tidak ditulis.

export const PASTE_FORMAT = 'priceatlas-struk-v1';
/** Batas teks tempelan (karakter). Struk 300 baris ± 60 karakter per baris JSON masih jauh di bawahnya. */
export const PASTE_MAX_CHARS = 50_000;
export const PASTE_MAX_LINES = 300;

/** Nominal rupiah: angka, atau teks berisi digit dengan pemisah ribuan titik/koma, "Rp", minus. */
const Rupiah = z.preprocess((v) => {
  if (typeof v !== 'string') return v;
  const t = v.replace(/rp\.?/gi, '').replace(/\s+/g, '');
  if (!/^[-−]?\d[\d.,]*$/.test(t)) return v;
  // Pecahan sen (",00" / ".00" di ujung) dibuang; sisa titik/koma = pemisah ribuan.
  const neg = /^[-−]/.test(t);
  const digits = t.replace(/^[-−]/, '').replace(/[.,]\d{2}$/, '').replace(/[.,]/g, '');
  return (neg ? -1 : 1) * Number(digits);
}, z.number().finite());

/** Kuantitas: angka, atau teks "2" / "0,512" (koma desimal). */
const Quantity = z.preprocess((v) => {
  if (typeof v !== 'string') return v;
  const t = v.trim().replace(',', '.');
  return /^\d+(\.\d+)?$/.test(t) ? Number(t) : v;
}, z.number().finite());

const Text = z.string().trim();
const OptText = z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), Text.nullish());

export const PASTE_LINE_TYPES = ['product', 'discount', 'void', 'non_product', 'tax', 'other'] as const;
export const PASTE_PAYMENT_METHODS = ['cash', 'debit', 'credit', 'qris', 'ewallet', 'other'] as const;

export const PastedReceiptLineSchema = z.object({
  type: z.preprocess((v) => (v == null ? 'product' : v), z.enum(PASTE_LINE_TYPES)),
  text: Text.min(1),
  quantity: Quantity.nullish(),
  unit_price: Rupiah.nullish(),
  amount: Rupiah,
  /** Nomor urut (1-based) baris produk yang dikenai diskon/void. */
  applies_to: z.number().int().nullish(),
  barcode: OptText,
  member_discount: z.boolean().nullish(),
});

export const PastedReceiptSchema = z.object({
  format: z.literal(PASTE_FORMAT).optional(),
  store: z.object({ name: OptText, branch: OptText }).nullish(),
  date: OptText,
  time: OptText,
  total: Rupiah.nullish(),
  subtotal: Rupiah.nullish(),
  payment_method: z.preprocess(
    (v) => (typeof v === 'string' ? v.trim().toLowerCase() || null : v),
    z.enum(PASTE_PAYMENT_METHODS).nullish(),
  ),
  lines: z.array(PastedReceiptLineSchema).min(1).max(PASTE_MAX_LINES),
  adjustments: z
    .array(
      z.object({
        kind: z.enum(['voucher', 'cashback', 'points', 'other']),
        text: OptText,
        amount: Rupiah.nullish(),
        points: z.number().nullish(),
      }),
    )
    .nullish(),
  member: z.object({ text: Text, program: OptText }).nullish(),
});

export type PastedReceipt = z.infer<typeof PastedReceiptSchema>;
export type PastedReceiptLine = z.infer<typeof PastedReceiptLineSchema>;

export type PasteError = 'empty' | 'too_long' | 'not_json' | 'invalid';

export type PasteParseResult =
  | { ok: true; data: PastedReceipt }
  | { ok: false; error: PasteError; /** Ringkasan masalah pertama, untuk pesan UI dan log (tanpa isi struk). */ detail?: string };

/** Ambil objek JSON dari jawaban Gemini: pembungkus ``` dibuang, lalu `{` pertama s/d `}` terakhir. */
export function extractJsonText(text: string): string | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1]! : text;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  return start >= 0 && end > start ? body.slice(start, end + 1) : null;
}

export function parsePastedReceipt(text: string): PasteParseResult {
  if (!text.trim()) return { ok: false, error: 'empty' };
  if (text.length > PASTE_MAX_CHARS) return { ok: false, error: 'too_long' };
  const json = extractJsonText(text);
  if (!json) return { ok: false, error: 'not_json' };
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    return { ok: false, error: 'not_json' };
  }
  const r = PastedReceiptSchema.safeParse(value);
  if (!r.success) {
    const issue = r.error.issues[0];
    return { ok: false, error: 'invalid', detail: issue ? `${issue.path.join('.') || '(akar)'}: ${issue.message}` : undefined };
  }
  return { ok: true, data: r.data };
}

/**
 * Σ baris (tanpa `other`, diskon/void dinormalkan negatif) = total, atau Σ − voucher = total (F-129,
 * sama dengan cek total worker di convert.ts). Untuk peringatan pratinjau S-21; null jika total kosong.
 */
export function pastedTotalMatches(r: PastedReceipt): boolean | null {
  if (r.total == null) return null;
  const sum = r.lines
    .filter((l) => l.type !== 'other')
    .reduce((s, l) => s + ((l.type === 'discount' || l.type === 'void') && l.amount > 0 ? -l.amount : l.amount), 0);
  const vouchers = (r.adjustments ?? []).filter((a) => a.kind === 'voucher').reduce((s, a) => s + Math.abs(a.amount ?? 0), 0);
  return Math.abs(sum - r.total) <= 1 || Math.abs(sum - vouchers - r.total) <= 1;
}

/** Prompt yang disalin user ke Gemini bersama foto struk (S-21 "Salin prompt"). */
export const GEMINI_RECEIPT_PROMPT = `Baca foto struk belanja ini dan tulis isinya sebagai SATU objek JSON saja, tanpa penjelasan, persis dengan bentuk ini:

{
  "format": "${PASTE_FORMAT}",
  "store": { "name": "nama toko", "branch": "nama cabang atau null" },
  "date": "YYYY-MM-DD",
  "time": "HH:MM",
  "total": 0,
  "subtotal": null,
  "payment_method": "cash | debit | credit | qris | ewallet | other | null",
  "lines": [
    { "type": "product", "text": "nama barang seperti tercetak", "quantity": 1, "unit_price": 0, "amount": 0, "applies_to": null, "barcode": null, "member_discount": false }
  ],
  "adjustments": [],
  "member": null
}

Aturan:
- Satu baris struk = satu item di "lines", urut dari atas ke bawah.
- "type": product (barang), discount (potongan/diskon/promo), void (pembatalan), tax (pajak yang menambah total), non_product (kantong plastik, donasi, biaya layanan), other (lainnya).
- "text": nama barang saja, tanpa kuantitas dan harga.
- "quantity": jumlah atau berat (contoh 2 atau 0.512). "unit_price": harga satuan. "amount": nominal baris. Jika tidak tercetak, isi null (kecuali "amount").
- Diskon dan void: "amount" negatif, "applies_to" = nomor urut (mulai 1) baris product yang dikenai di "lines". "member_discount": true jika diskon karena kartu member.
- Semua uang dalam rupiah sebagai angka bulat tanpa titik/koma/Rp (contoh 15900).
- "total": total yang dibayar. "subtotal": jika tercetak, selain itu null.
- "adjustments": voucher, cashback, atau poin yang dicetak di bawah total, bentuk { "kind": "voucher | cashback | points | other", "text": "...", "amount": 0, "points": null }.
- "member": jika ada keterangan kartu member, { "text": "keterangan", "program": "nama program" }, selain itu null.
- JANGAN tulis nomor kartu, nomor member, nama pelanggan, nomor HP, atau email.
- Bagian yang tidak terbaca: isi null, jangan ditebak.`;
