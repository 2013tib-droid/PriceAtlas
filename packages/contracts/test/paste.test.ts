import { describe, expect, it } from 'vitest';
import { GEMINI_RECEIPT_PROMPT, PASTE_MAX_CHARS, extractJsonText, parsePastedReceipt, pastedTotalMatches } from '../src/index.ts';

const sample = {
  format: 'priceatlas-struk-v1',
  store: { name: 'Alfamart', branch: 'Sudirman' },
  date: '2026-10-30',
  time: '14:05',
  total: 41100,
  subtotal: null,
  payment_method: 'qris',
  lines: [
    { type: 'product', text: 'INDOMIE GORENG', quantity: 2, unit_price: 3100, amount: 6200, applies_to: null, barcode: null, member_discount: false },
    { type: 'product', text: 'MILO 1L', quantity: 1, unit_price: 36900, amount: 36900, applies_to: null, barcode: null, member_discount: false },
    { type: 'discount', text: 'DISC MEMBER', quantity: null, unit_price: null, amount: -2000, applies_to: 2, barcode: null, member_discount: true },
  ],
  adjustments: [],
  member: null,
};

describe('struk tempelan Gemini (D-100)', () => {
  it('JSON polos', () => {
    const r = parsePastedReceipt(JSON.stringify(sample));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.lines).toHaveLength(3);
      expect(pastedTotalMatches(r.data)).toBe(true);
    }
  });

  it('dibungkus ```json dan kalimat pembuka', () => {
    const text = `Berikut hasilnya:\n\`\`\`json\n${JSON.stringify(sample, null, 2)}\n\`\`\`\nSemoga membantu!`;
    expect(parsePastedReceipt(text).ok).toBe(true);
    expect(extractJsonText(text)?.startsWith('{')).toBe(true);
  });

  it('angka sebagai teks rupiah dan field opsional tidak ditulis', () => {
    const r = parsePastedReceipt(
      JSON.stringify({ total: 'Rp 15.900', lines: [{ text: 'GULA 1KG', amount: '15.900', quantity: '1' }, { text: 'TIMBANG', amount: '12.345,00', quantity: '0,512' }] }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.total).toBe(15900);
      expect(r.data.lines[0]!.type).toBe('product');
      expect(r.data.lines[1]!.amount).toBe(12345);
      expect(r.data.lines[1]!.quantity).toBe(0.512);
      expect(pastedTotalMatches(r.data)).toBe(false);
    }
  });

  it('diskon positif dinormalkan negatif untuk cek total; voucher diperhitungkan', () => {
    const r = parsePastedReceipt(
      JSON.stringify({
        total: 9000,
        lines: [{ text: 'A', amount: 12000 }, { type: 'discount', text: 'D', amount: 2000, applies_to: 1 }],
        adjustments: [{ kind: 'voucher', amount: 1000 }],
      }),
    );
    expect(r.ok && pastedTotalMatches(r.data)).toBe(true);
  });

  it('ditolak: kosong, terlalu panjang, bukan JSON, tanpa baris, format lain', () => {
    expect(parsePastedReceipt('  ')).toEqual({ ok: false, error: 'empty' });
    expect(parsePastedReceipt('x'.repeat(PASTE_MAX_CHARS + 1))).toEqual({ ok: false, error: 'too_long' });
    expect(parsePastedReceipt('Maaf, saya tidak bisa membaca gambar ini.')).toEqual({ ok: false, error: 'not_json' });
    expect(parsePastedReceipt('{ "lines": [ }')).toEqual({ ok: false, error: 'not_json' });
    const noLines = parsePastedReceipt(JSON.stringify({ total: 1, lines: [] }));
    expect(noLines.ok === false && noLines.error).toBe('invalid');
    expect(parsePastedReceipt(JSON.stringify({ ...sample, format: 'lain' })).ok).toBe(false);
    expect(parsePastedReceipt(JSON.stringify({ lines: [{ text: 'A', amount: 'gratis' }] })).ok).toBe(false);
  });

  it('contoh di prompt Gemini sendiri lolos parser (bentuk prompt = skema)', () => {
    const example = extractJsonText(GEMINI_RECEIPT_PROMPT.split('Aturan:')[0]!)!
      .replace('"cash | debit | credit | qris | ewallet | other | null"', '"qris"');
    expect(parsePastedReceipt(example).ok).toBe(true);
    expect(GEMINI_RECEIPT_PROMPT).toContain('JANGAN tulis nomor kartu');
  });
});
