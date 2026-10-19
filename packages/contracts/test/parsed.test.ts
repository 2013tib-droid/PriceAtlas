import { describe, expect, it } from 'vitest';
import { ParsedObservationSchema, ParsedReceiptSchema } from '../src/index.ts';

describe('kontrak ParsedReceipt / ParsedObservation (§5.4)', () => {
  it('struk valid dengan diskon menempel', () => {
    const r = ParsedReceiptSchema.parse({
      kind: 'receipt',
      header: { transaction_date: '2026-10-18', total_amount: 37000, field_confidence: { store: 0.95, date: 0.99 } },
      lines: [
        { line_no: 1, line_type: 'product', raw_text: 'MILO', quantity: 2, unit_amount: 19500, line_amount: 39000 },
        { line_no: 2, line_type: 'discount', raw_text: 'DISC', line_amount: -2000, applies_to_line_no: 1 },
      ],
    });
    expect(r.pii).toEqual({});
    expect(r.adjustments).toEqual([]);
  });
  it('diskon tanpa baris induk ditolak', () => {
    const r = ParsedReceiptSchema.safeParse({
      kind: 'receipt', header: {},
      lines: [{ line_no: 2, line_type: 'discount', raw_text: 'DISC', line_amount: -1, applies_to_line_no: 9 }],
    });
    expect(r.success).toBe(false);
  });
  it('line_no ganda ditolak', () => {
    const line = { line_no: 1, line_type: 'product', raw_text: 'X', line_amount: 1 };
    expect(ParsedReceiptSchema.safeParse({ kind: 'receipt', header: {}, lines: [line, line] }).success).toBe(false);
  });
  it('confidence di luar 0..1 ditolak', () => {
    expect(ParsedReceiptSchema.safeParse({ kind: 'receipt', header: { field_confidence: { date: 1.2 } }, lines: [] }).success).toBe(false);
  });
  it('observasi marketplace', () => {
    const o = ParsedObservationSchema.parse({
      kind: 'marketplace', store_hint: { name: 'Shopee' },
      items: [{ raw_text: 'Milo', normal_price: 46000, shipping_fee: 9000, listing_url: 'https://shopee.co.id/x', seller_name: 'Toko' }],
    });
    expect(o.items[0]?.field_confidence).toEqual({});
  });
  it('listing_url non-https ditolak', () => {
    expect(ParsedObservationSchema.safeParse({ kind: 'marketplace', items: [{ raw_text: 'x', listing_url: 'http://x' }] }).success).toBe(false);
  });
});
