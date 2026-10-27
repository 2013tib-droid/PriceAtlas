// L2 (docs/08 §13.2): konverter LLM → kontrak, setiap cek deterministik §5.3 + confidence gabungan.
// Semua hasil wajib lolos ParsedOutputSchema (gerbang akhir pipeline).
import { ParsedOutputSchema, type ParsedObservation, type ParsedReceipt } from '@priceatlas/contracts';
import { describe, expect, it } from 'vitest';
import { CAPS, convertOutput, dateInWindow, normalizeDate, type ConvertContext } from '../src/extractors/convert.ts';
import type { LlmObservation, LlmReceipt, LlmReceiptLine } from '../src/extractors/llm-schema.ts';
import { llmLabelMilo, llmStrukAeon } from './claude-fake.ts';

const UPLOADED = new Date('2026-10-16T03:00:00Z'); // 10:00 WIB
const receiptCtx = { kind: 'receipt' as const, uploadedAt: UPLOADED, imageCount: 1 };

function receipt(mut: (r: LlmReceipt) => void = () => {}) {
  const r = llmStrukAeon();
  mut(r);
  const res = convertOutput(r, receiptCtx);
  expect(ParsedOutputSchema.safeParse(res.output).success).toBe(true);
  return { ...res, out: res.output as ParsedReceipt };
}

function line(over: Partial<LlmReceiptLine>): LlmReceiptLine {
  return {
    section: 1, type: 'product', text: 'X', quantity: null, unit_price: null, amount: 1000, applies_to: null,
    barcode: null, member_discount: false, bundle: false, confidence: 0.99, ...over,
  };
}

describe('struk: hasil benar', () => {
  it('struk-aeon → kontrak lengkap, tanpa flag', () => {
    const { out, flags, rawText } = receipt();
    expect(flags).toEqual([]);
    expect(rawText).toContain('[REDAKSI]');
    expect(out).toMatchObject({
      kind: 'receipt',
      store_hint: { name: 'AEON', branch_name: 'BSD' },
      header: {
        transaction_date: '2026-10-15', transaction_time: '19:02', total_amount: 114700, payment_method: 'debit', currency: 'IDR',
        field_confidence: { store: 0.96, branch: 0.96, date: 0.98, time: 0.95, total: 0.99 },
      },
      pii: { card_last4: '4321', card_masked: '****4321', phone: '081298765432' },
      member_hint: { text: 'MEMBER', program_name: null },
    });
    expect(out.lines.map((l) => [l.line_no, l.line_type, l.applies_to_line_no ?? null, l.parse_confidence])).toEqual([
      [1, 'product', null, 0.97],
      [2, 'discount', 1, 0.95],
      [3, 'product', null, 0.96],
      [4, 'non_product', null, 0.9],
      [5, 'product', null, 0.93],
    ]);
    expect(out.lines[1]).toMatchObject({ member_discount: true });
    expect(out.lines[0]).not.toHaveProperty('member_discount');
  });
});

describe('cek deterministik §5.3', () => {
  it('jenis dokumen salah → not_a_receipt (struk) / unsupported (label)', () => {
    const r = llmStrukAeon();
    r.document.type = 'price_label';
    expect(() => convertOutput(r, receiptCtx)).toThrow(expect.objectContaining({ code: 'not_a_receipt' }));
    const l = llmLabelMilo();
    l.document.type = 'receipt';
    expect(() => convertOutput(l, { kind: 'price_label', uploadedAt: UPLOADED, imageCount: 1 })).toThrow(
      expect.objectContaining({ code: 'unsupported' }),
    );
  });

  it('tidak terbaca → blurry', () => {
    const r = llmStrukAeon();
    r.document.readable = false;
    expect(() => convertOutput(r, receiptCtx)).toThrow(expect.objectContaining({ code: 'blurry' }));
  });

  it('diskon tanpa target / target di luar rentang / target bukan produk → other, confidence ≤ 0,5', () => {
    const { out, flags } = receipt((r) => {
      r.lines[1]!.applies_to = null;
      r.lines.push(line({ type: 'void', text: 'VOID', amount: -200, applies_to: 99 }));
      r.lines.push(line({ type: 'discount', text: 'DISC', amount: -100, applies_to: 4 })); // baris 4 = non_product
    });
    expect(out.lines.slice(-2).map((l) => l.line_type)).toEqual(['other', 'other']);
    expect(out.lines[1]).toMatchObject({ line_type: 'other', applies_to_line_no: null, parse_confidence: CAPS.unattached });
    expect(out.lines[1]).not.toHaveProperty('member_discount');
    expect(flags).toEqual(expect.arrayContaining(['unattached:line2', 'unattached:line6', 'unattached:line7']));
  });

  it('diskon/void bernominal positif dibalik jadi negatif', () => {
    const { out } = receipt((r) => {
      r.lines[1]!.amount = 5000;
    });
    expect(out.lines[1]!.line_amount).toBe(-5000);
  });

  it('aritmetika qty × harga ≠ nominal → ≤ 0,6; ± Rp1 lolos', () => {
    const { out, flags } = receipt((r) => {
      r.lines[0]!.amount = 95000;
      r.lines[2]!.amount = 17501;
    });
    expect(out.lines[0]!.parse_confidence).toBe(CAPS.arithmetic);
    expect(out.lines[2]!.parse_confidence).toBe(0.96);
    expect(flags).toContain('arithmetic:line1');
  });

  it('item timbang: toleransi Rp50, berat 3 desimal', () => {
    const { out, flags } = receipt((r) => {
      r.lines = [line({ text: 'APEL FUJI', quantity: 0.4567, unit_price: 45900, amount: 20963 })];
      r.header.total = 20963;
    });
    expect(out.lines[0]).toMatchObject({ quantity: 0.457, unit_amount: 45900, line_amount: 20963, parse_confidence: 0.99 });
    expect(flags).toEqual([]);
    const off = receipt((r) => {
      r.lines = [line({ text: 'APEL FUJI', quantity: 0.457, unit_price: 45900, amount: 21100 })];
      r.header.total = 21100;
    });
    expect(off.out.lines[0]!.parse_confidence).toBe(CAPS.arithmetic);
  });

  it('Σ baris ≠ total → field_confidence.total ≤ 0,7 (tidak memaksa konfirmasi)', () => {
    const { out, flags } = receipt((r) => {
      r.header.total = 120000;
    });
    expect(out.header.field_confidence.total).toBe(CAPS.total);
    expect(flags).toContain('total_mismatch');
  });

  it('Σ baris − voucher = total diterima; baris `other` tidak dihitung', () => {
    const { flags } = receipt((r) => {
      r.adjustments.push({ kind: 'voucher', text: 'VOUCHER', amount: -10000, points: null });
      r.header.total = 104700;
      r.lines.push(line({ type: 'other', text: 'SUBTOTAL', amount: 114700 }));
    });
    expect(flags).toEqual([]);
  });

  it('tanggal di luar [unggah − 400 hari, unggah + 1 hari] → ≤ 0,5', () => {
    expect(receipt((r) => { r.header.date = '2026-10-17'; }).out.header.field_confidence.date).toBe(0.98);
    expect(receipt((r) => { r.header.date = '2026-10-18'; }).out.header.field_confidence.date).toBe(CAPS.date);
    expect(receipt((r) => { r.header.date = '2025-09-11'; }).out.header.field_confidence.date).toBe(0.98);
    expect(receipt((r) => { r.header.date = '2025-09-10'; }).out.header.field_confidence.date).toBe(CAPS.date);
  });

  it('tanggal tahun dua digit dan tanggal tidak valid', () => {
    expect(normalizeDate('26-10-15')).toBe('2026-10-15');
    expect(normalizeDate('2026-2-30')).toBeNull();
    expect(normalizeDate('15/10/26')).toBeNull();
    const salahAbad = receipt((r) => { r.header.date = '1926-10-15'; });
    expect(salahAbad.out.header.transaction_date).toBe('1926-10-15');
    expect(salahAbad.out.header.field_confidence.date).toBe(CAPS.date);
    const dua = receipt((r) => { r.header.date = '26-10-15'; });
    expect(dua.out.header).toMatchObject({ transaction_date: '2026-10-15', field_confidence: { date: 0.98 } });
    const rusak = receipt((r) => { r.header.date = '31/02/2026'; r.header.time = '25:99'; });
    expect(rusak.out.header).toMatchObject({ transaction_date: null, transaction_time: null });
    expect(rusak.out.header.field_confidence).not.toHaveProperty('date');
    expect(rusak.flags).toEqual(expect.arrayContaining(['date_invalid', 'time_invalid']));
  });

  it('batas jendela tanggal memakai hari Asia/Jakarta', () => {
    // 2026-10-16 23:30 WIB = 16:30 UTC → +1 hari = 2026-10-17.
    expect(dateInWindow('2026-10-17', new Date('2026-10-16T16:30:00Z'))).toBe(true);
    // 2026-10-17 00:30 WIB = 2026-10-16 17:30 UTC → +1 hari = 2026-10-18.
    expect(dateInWindow('2026-10-18', new Date('2026-10-16T17:30:00Z'))).toBe(true);
  });

  it('sambungan bagian (F-120): baris identik berurutan di batas bagian → keduanya ≤ 0,6', () => {
    const { out, flags } = receipt((r) => {
      r.lines = [
        line({ section: 1, text: 'TEH BOTOL', amount: 5000 }),
        line({ section: 1, text: 'ROTI TAWAR', amount: 15000 }),
        line({ section: 2, text: 'ROTI TAWAR', amount: 15000 }),
        line({ section: 2, text: 'SUSU UHT', amount: 7000 }),
      ];
      r.header.total = 42000;
    });
    expect(out.lines.map((l) => l.parse_confidence)).toEqual([0.99, CAPS.seam, CAPS.seam, 0.99]);
    expect(flags).toContain('seam:line2');
    // Baris identik di bagian yang sama (beli dua kali) tidak ditandai.
    const sama = receipt((r) => {
      r.lines = [line({ text: 'ROTI TAWAR', amount: 15000 }), line({ text: 'ROTI TAWAR', amount: 15000 })];
      r.header.total = 30000;
    });
    expect(sama.flags).toEqual([]);
  });

  it('nominal pecahan dibulatkan, confidence ≤ 0,8; qty ≤ 0 → null', () => {
    const { out, flags } = receipt((r) => {
      r.lines[4]!.amount = 12000.4;
      r.lines[2]!.quantity = 0;
    });
    expect(out.lines[4]).toMatchObject({ line_amount: 12000, parse_confidence: CAPS.rounded });
    expect(out.lines[2]).toMatchObject({ quantity: null, parse_confidence: CAPS.invalid });
    expect(flags).toEqual(expect.arrayContaining(['rounded:line5.amount', 'quantity:line3']));
  });

  it('confidence model di luar 0–1 dijepit; field kosong tanpa confidence', () => {
    const { out } = receipt((r) => {
      r.lines[0]!.confidence = 1.7;
      r.lines[2]!.confidence = -1;
      r.store = { name: null, branch: null, confidence: 0.9 };
      r.pii = { card_last4: ' ', card_masked: null, phone: null, member_id: null, member_name: null, customer_name: null, email: null };
      r.member = null;
    });
    expect(out.lines[0]!.parse_confidence).toBe(1);
    expect(out.lines[2]!.parse_confidence).toBe(0);
    expect(out.store_hint).toBeUndefined();
    expect(out.header.field_confidence).not.toHaveProperty('store');
    expect(out.pii).toEqual({});
    expect(out).not.toHaveProperty('member_hint');
  });
});

describe('label dan screenshot', () => {
  const labelCtx: ConvertContext = { kind: 'price_label', uploadedAt: UPLOADED, imageCount: 1 };
  function label(mut: (l: LlmObservation) => void = () => {}, ctx = labelCtx) {
    const l = llmLabelMilo();
    mut(l);
    const res = convertOutput(l, ctx);
    expect(ParsedOutputSchema.safeParse(res.output).success).toBe(true);
    return { ...res, out: res.output as ParsedObservation };
  }

  it('label-milo → dua item, promo + member terpisah', () => {
    const { out, flags } = label();
    expect(flags).toEqual([]);
    expect(out.kind).toBe('price_label');
    expect(out.store_hint).toBeUndefined();
    expect(out.items[0]).toMatchObject({
      raw_text: 'MILO ORIGINAL 200G', normal_price: 19500, promo_price: 17500, promo_valid_until: '2099-12-31',
      image_position: 1, field_confidence: { product: 0.98, price: 0.97 },
    });
    expect(out.items[1]).toMatchObject({ member_price: 21000, member_program_name: 'AEON Member', promo_price: null });
  });

  it('promo ≥ normal atau periode terbalik → price ≤ 0,6', () => {
    const a = label((l) => { l.items[0]!.promo_price = 19500; });
    expect(a.out.items[0]!.field_confidence.price).toBe(CAPS.labelPrice);
    const b = label((l) => { l.items[0]!.promo_valid_from = '2026-11-01'; l.items[0]!.promo_valid_until = '2026-10-01'; });
    expect(b.out.items[0]!.field_confidence.price).toBe(CAPS.labelPrice);
    expect(b.flags).toEqual(['period_reversed:item1']);
  });

  it('nilai di luar kontrak dibersihkan (harga negatif, min qty < 2, URL bukan https, region > 1, posisi di luar)', () => {
    const { out, flags } = label((l) => {
      const it = l.items[0]!;
      it.normal_price = -5;
      it.promo_min_qty = 1;
      it.listing_url = 'http://contoh.test/x';
      it.region = { x: 0.5, y: 0.5, w: 1.4, h: 0.2 };
      it.image_position = 3;
    });
    expect(out.items[0]).toMatchObject({ normal_price: null, promo_min_qty: null, listing_url: null, region: null, image_position: null });
    expect(out.items[0]!.field_confidence.price).toBe(CAPS.invalid);
    expect(flags).toContain('negative:item1.normal_price');
  });

  it('screenshot: judul ≤ 500, ongkir/voucher terpisah dari harga, tanggal pesanan dicek', () => {
    const ctx = { kind: 'marketplace' as const, uploadedAt: UPLOADED, imageCount: 1 };
    const { out } = label((l) => {
      l.document.type = 'marketplace';
      l.store = { name: 'Shopee', branch: null, confidence: 0.99 };
      l.items = [{
        ...l.items[0]!, text: 'Milo Original 500 g', listing_title: 'x'.repeat(600), listing_url: 'https://shopee.co.id/milo',
        normal_price: 47000, promo_price: null, promo_valid_until: null, barcode: null, shipping_fee: 9000, shop_voucher: 2000,
        seller_name: 'Nestle Official Store', transaction_date: '2024-01-01', confidence: { product: 0.95, price: 0.99, date: 0.9 },
      }];
    }, ctx);
    expect(out).toMatchObject({ kind: 'marketplace', store_hint: { name: 'Shopee', branch_name: null } });
    expect(out.items[0]).toMatchObject({ normal_price: 47000, shipping_fee: 9000, shop_voucher: 2000, transaction_date: '2024-01-01' });
    expect(out.items[0]!.listing_title).toHaveLength(500);
    expect(out.items[0]!.field_confidence).toMatchObject({ price: 0.99, date: CAPS.date, store: 0.99 });
  });
});
