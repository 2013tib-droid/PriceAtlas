// L2 harness uji OCR (docs/08 §4.7, §4.8, §13.2): penyelarasan baris, metrik, statistik, keputusan.
// Tanpa jaringan dan tanpa database.
import { describe, expect, it } from 'vitest';
import type { ParsedObservation, ParsedReceipt } from '@priceatlas/contracts';
import type { Truth } from '../eval/data.ts';
import { decide, type KindReport } from '../eval/report.ts';
import type { RunRecord } from '../eval/run.ts';
import { alignLines, branchMatches, normalizePayment, scoreCapture, stability, storeMatches } from '../eval/score.ts';
import { atTau, cer, ece, hungarian, isotonic, minTauFor, percentile, similarity } from '../eval/stats.ts';

const receiptTruth = (): Truth => ({
  id: 'r-0001', kind: 'receipt', images: ['r-0001-1.jpg'], split: 'test', store_category: 'supermarket', conditions: ['member'],
  expected: {
    kind: 'receipt',
    store_hint: { name: 'AEON', branch_name: 'BSD' },
    header: { transaction_date: '2026-10-15', transaction_time: '19:02', total_amount: 114700, payment_method: 'DEBIT', field_confidence: {} },
    pii: {},
    lines: [
      { line_no: 1, line_type: 'product', raw_text: 'MILO ORI 500G', quantity: 2, unit_amount: 45000, line_amount: 90000 },
      { line_no: 2, line_type: 'discount', raw_text: 'DISC MEMBER', line_amount: -5000, applies_to_line_no: 1 },
      { line_no: 3, line_type: 'product', raw_text: 'INDOMIE GRG 85G', quantity: 5, unit_amount: 3500, line_amount: 17500 },
      { line_no: 4, line_type: 'non_product', raw_text: 'KANTONG PLASTIK', line_amount: 200 },
      { line_no: 5, line_type: 'product', raw_text: 'SNACK XYZ', line_amount: 12000 },
    ],
    adjustments: [],
  } as ParsedReceipt,
  annotations: { lines: { '2': { member_discount: true } }, transcript_pii: ['081298765432'], notes: null },
  verified: { by: 'owner', at: '2026-11-05', prefill: null },
});

function rec(output: ParsedReceipt | ParsedObservation | null, over: Partial<RunRecord> = {}): RunRecord {
  return {
    id: 'r-0001', kind: output?.kind ?? 'receipt', arm: 'vision-opus-low', repeat: 1, mode: 'batch', purpose: 'accuracy', ok: !!output,
    error: output ? null : { code: 'blurry', message: 'buram', transient: false }, output, raw_text: null, llm: null, meta: { flags: [] },
    input_tokens: 1, output_tokens: 1, cost_usd: 0.05, ocr_cost_usd: null, latency_ms: null, attempts: 1, at: '2026-11-05T00:00:00Z', ...over,
  };
}

/** Prediksi = kebenaran (+ confidence), lalu diubah per kasus. */
function predFrom(t: Truth, edit?: (p: ParsedReceipt) => void): ParsedReceipt {
  const p = structuredClone(t.expected) as ParsedReceipt;
  p.lines = p.lines.map((l) => ({ ...l, parse_confidence: 0.95, member_discount: l.line_no === 2 ? true : undefined }));
  p.pii = { phone: '081298765432' };
  edit?.(p);
  return p;
}

describe('stats', () => {
  it('Hungaria: penugasan biaya minimum, matriks persegi panjang', () => {
    expect(hungarian([[4, 1, 3], [2, 0, 5], [3, 2, 2]])).toEqual([1, 0, 2]);
    expect(hungarian([[1, 9], [9, 1], [5, 5]])).toEqual([0, 1, -1]);
    expect(hungarian([[3], [1]])).toEqual([-1, 0]);
    expect(hungarian([])).toEqual([]);
  });
  it('teks: CER, similarity; persentil; ECE; isotonic monoton; τ minimum', () => {
    expect(cer('MILO ORI 500G', 'milo  ori 500g')).toBe(0);
    expect(cer('MIL0 ORI 500G', 'MILO ORI 500G')).toBeCloseTo(1 / 13);
    expect(similarity('ABC', 'XYZ')).toBe(0);
    expect(percentile([1, 2, 3, 4, 100], 0.5)).toBe(3);
    expect(percentile([1, 2, 3, 4, 100], 0.95)).toBe(100);
    expect(percentile([], 0.5)).toBeNull();
    const pts = [{ c: 0.95, ok: true }, { c: 0.95, ok: true }, { c: 0.6, ok: false }, { c: 0.9, ok: false }];
    // Rentang 0,9–1,0: conf rata-rata 0,933, akurasi 2/3; rentang 0,6: conf 0,6, akurasi 0.
    expect(ece(pts)).toBeCloseTo((3 / 4) * (2.8 / 3 - 2 / 3) + (1 / 4) * 0.6);
    expect(atTau(pts, 0.9)).toMatchObject({ precision: 2 / 3, coverage: 3 / 4, n: 3 });
    expect(minTauFor(pts, 0.98)).toBe(0.91);
    const iso = isotonic([{ c: 0.5, ok: true }, { c: 0.6, ok: false }, { c: 0.9, ok: true }, { c: 0.95, ok: true }]);
    expect(iso.map((b) => b.p)).toEqual([0.5, 1, 1]);
    for (let i = 1; i < iso.length; i++) expect(iso[i]!.p).toBeGreaterThanOrEqual(iso[i - 1]!.p);
  });
});

describe('penyelarasan dan pencocokan (§4.7)', () => {
  it('baris dipasangkan meski urutan/teks sedikit berbeda; similarity < 0,4 + nominal beda → tidak berpasangan', () => {
    const truth = [
      { raw_text: 'MILO ORI 500G', line_amount: 90000 },
      { raw_text: 'INDOMIE GRG 85G', line_amount: 17500 },
      { raw_text: 'SNACK XYZ', line_amount: 12000 },
    ];
    const pred = [
      { raw_text: 'INDOMIE GRG 85G', line_amount: 17500 },
      { raw_text: 'MIL0 ORI 500G', line_amount: 90000 },
      { raw_text: 'GULA PASIR', line_amount: 16000 },
    ];
    expect(alignLines(pred, truth)).toEqual([1, 0, -1]);
  });
  it('toko, cabang, metode bayar ternormalisasi', () => {
    expect(storeMatches('AEON', 'AEON BSD')).toBe(true);
    expect(storeMatches('Super Indo', 'SUPERINDO')).toBe(true);
    expect(storeMatches('AEON', 'Alfamart')).toBe(false);
    expect(storeMatches('AEON', null)).toBe(false);
    expect(branchMatches('BSD', 'AEON', 'BSD CITY')).toBe(true);
    expect(branchMatches('Serpong', 'AEON', 'BSD')).toBe(false);
    expect(normalizePayment('TUNAI')).toBe('cash');
    expect(normalizePayment('Kartu Debit BCA')).toBe('debit');
    expect(normalizePayment('GoPay')).toBe('ewallet');
    expect(normalizePayment(null)).toBe('');
  });
});

describe('skor struk', () => {
  it('prediksi sempurna: semua metrik 100 %, nol koreksi, confidence benar', () => {
    const t = receiptTruth();
    const s = scoreCapture(t, rec(predFrom(t), { raw_text: 'AEON\nMILO ORI 500G\nHP [REDAKSI]' }));
    for (const k of ['store', 'branch', 'date', 'time', 'total', 'payment', 'line.recall', 'line.precision', 'line.amount', 'line.type', 'line.text', 'line.discount', 'line.non_product', 'member.recall', 'member.regex_recall', 'perfect', 'pii.recall', 'pii.no_leak']) {
      expect(s.counters[k], k).toBeDefined();
      expect(s.counters[k]!.n, k).toBe(s.counters[k]!.d);
    }
    expect(s.counters.corrections).toEqual({ n: 0, d: 1 });
    expect(s.conf).toEqual([{ c: 0.95, ok: true }, { c: 0.95, ok: true }, { c: 0.95, ok: true }]);
    expect(s.pii_leaks).toBe(0);
  });
  it('baris hilang, nominal salah, diskon ke baris salah, PII bocor → dihitung per metrik', () => {
    const t = receiptTruth();
    const pred = predFrom(t, (p) => {
      p.lines = p.lines.filter((l) => l.line_no !== 5); // SNACK hilang
      p.lines[2] = { ...p.lines[2]!, line_amount: 17000 }; // INDOMIE salah
      p.lines[1] = { ...p.lines[1]!, applies_to_line_no: 3 }; // diskon ke baris lain
      p.header.total_amount = 114000;
    });
    const s = scoreCapture(t, rec(pred, { raw_text: 'HP 081298765432', meta: { flags: ['total_mismatch'] } }));
    expect(s.counters['line.recall']).toEqual({ n: 2, d: 3 });
    expect(s.counters['line.amount']).toEqual({ n: 1, d: 3 });
    expect(s.counters['line.discount']).toEqual({ n: 0, d: 1 });
    expect(s.counters.total).toEqual({ n: 0, d: 1 });
    expect(s.counters.perfect).toEqual({ n: 0, d: 1 });
    expect(s.counters.sum_equals_total).toEqual({ n: 0, d: 1 });
    expect(s.counters.corrections!.n).toBe(3); // 2 baris + total
    expect(s.conf.filter((p) => !p.ok)).toHaveLength(1);
    // Nilai di pii disamarkan redaksi lapis 2 → tidak bocor; nilai yang tidak dikenali → bocor.
    expect(s.pii_leaks).toBe(0);
    const s2 = scoreCapture(t, rec({ ...pred, pii: {} }, { raw_text: 'HP 0812 9876 5432 x 081298765432' }));
    expect(s2.counters['pii.recall']).toEqual({ n: 0, d: 1 });
    expect(s2.counters['pii.no_leak']).toEqual({ n: 1, d: 1 }); // pola HP regex menangkapnya
  });
  it('member: regex D-74 dan flag parser dinilai terpisah (Q-34/Q-110)', () => {
    const t = receiptTruth();
    (t.expected as ParsedReceipt).lines[1]!.raw_text = 'POTONGAN KARTU';
    const s = scoreCapture(t, rec(predFrom(t)));
    expect(s.counters['member.recall']).toEqual({ n: 1, d: 1 });
    expect(s.counters['member.regex_recall']).toEqual({ n: 0, d: 1 });
  });
  it('capture gagal: semua metrik akurasi salah; kegagalan diklasifikasi', () => {
    const t = receiptTruth();
    const s = scoreCapture(t, rec(null, { ok: false, error: { code: 'unsupported', message: 'Hasil pembacaan gambar tidak valid.', transient: false } }));
    expect(s.failure).toBe('schema');
    expect(s.counters['line.recall']).toEqual({ n: 0, d: 3 });
    expect(s.counters.perfect).toEqual({ n: 0, d: 1 });
    expect(scoreCapture(t, rec(null, { ok: false, meta: { stop_reason: 'refusal' }, error: { code: 'other', message: 'x', transient: false } })).failure).toBe('refusal');
    expect(scoreCapture(t, rec(null, { ok: false, error: { code: 'transient', message: 'x', transient: true } })).failure).toBe('timeout');
  });
  it('gambar tak terbaca (expected null): benar jika ditolak buram, salah jika model mengarang isi', () => {
    const t = { ...receiptTruth(), expected: null };
    expect(scoreCapture(t, rec(null)).counters.unreadable_detected).toEqual({ n: 1, d: 1 });
    expect(scoreCapture(t, rec(null)).failure).toBeNull();
    expect(scoreCapture(t, rec(predFrom(receiptTruth()))).counters.unreadable_detected).toEqual({ n: 0, d: 1 });
  });
  it('stabilitas: persentase field berbeda antar-ulangan', () => {
    const t = receiptTruth();
    const a = scoreCapture(t, rec(predFrom(t)));
    const b = scoreCapture(t, rec(predFrom(t, (p) => { p.header.total_amount = 1; }), { repeat: 2 }));
    const st = stability([a, b]).get('vision-opus-low')!;
    expect(st.n).toBe(1);
    expect(st.d).toBe(Object.keys(a.fields).length);
  });
});

describe('skor label/screenshot', () => {
  it('item dipasangkan; harga normal/promo/member, periode, program, posisi', () => {
    const t: Truth = {
      id: 'l-0001', kind: 'price_label', images: ['l.jpg'], split: 'test', store_category: 'supermarket', conditions: [],
      expected: {
        kind: 'price_label',
        items: [
          { raw_text: 'MILO ORIGINAL 200G', normal_price: 19500, promo_price: 17500, promo_valid_until: '2099-12-31', image_position: 1, field_confidence: {} },
          { raw_text: 'MILO 3IN1 10X35G', normal_price: 23000, member_price: 21000, member_program_name: 'AEON Member', image_position: 1, field_confidence: {} },
        ],
      } as ParsedObservation,
      annotations: { lines: {}, transcript_pii: [], notes: null },
      verified: { by: 'owner', at: '2026-11-05', prefill: 'vision-opus-medium' },
    };
    const pred = structuredClone(t.expected) as ParsedObservation;
    pred.items = [pred.items[1]!, { ...pred.items[0]!, promo_price: 17000 }].map((i) => ({ ...i, field_confidence: { price: 0.95 } }));
    const s = scoreCapture(t, rec(pred));
    expect(s.counters['item.recall']).toEqual({ n: 2, d: 2 });
    expect(s.counters['price.promo']).toEqual({ n: 0, d: 1 });
    expect(s.counters['price.member']).toEqual({ n: 1, d: 1 });
    expect(s.counters.member_program).toEqual({ n: 1, d: 1 });
    expect(s.counters.perfect).toEqual({ n: 0, d: 1 });
    expect(s.conf.map((p) => p.ok).sort()).toEqual([false, true]);
    expect(s.prefilled).toBe(true);
  });
});

describe('keputusan §4.8', () => {
  const kr = (over: { perfect?: number; cost?: number; precision?: number; amount?: number }): KindReport => ({
    captures: 28, records: 56,
    metrics: {
      'line.amount': { rate: over.amount ?? 0.99, n: 0, d: 1 }, 'line.recall': { rate: 0.99, n: 0, d: 1 }, date: { rate: 0.99, n: 0, d: 1 },
      total: { rate: 0.99, n: 0, d: 1 }, store: { rate: 0.97, n: 0, d: 1 }, perfect: { rate: over.perfect ?? 0.9, n: 0, d: 1 },
      price: { rate: 0.99, n: 0, d: 1 }, 'item.recall': { rate: 1, n: 0, d: 1 },
    },
    confidence: { tau: 0.9, autosave_precision: over.precision ?? 0.99, autosave_coverage: 0.7, ece: 0.02, min_tau_precision_98: 0.85, isotonic_dev: null },
    cost: { mean_per_capture_usd: over.cost ?? 0.1, total_usd: 1 },
    latency: { n: 0, p50_ms: null, p95_ms: null },
    failures: { rate: 0, refusal: 0, schema: 0, timeout: 0, unsupported: 0, other: 0, n: 56 },
    pii_leaks: 0, mean_corrections: 0.2, by_store_category: {}, by_condition: {},
  });
  it('lolos → biaya terendah', () => {
    const d = decide('receipt', { 'vision-opus-medium': kr({ cost: 0.12 }), 'vision-sonnet': kr({ cost: 0.06 }), 'vision-haiku': kr({ cost: 0.003, amount: 0.9 }) });
    expect(d).toMatchObject({ chosen: 'vision-sonnet', passing: ['vision-opus-medium', 'vision-sonnet'] });
    expect(d.checks['vision-haiku']!['line.amount']).toMatchObject({ pass: false, value: 0.9, min: 0.97 });
  });
  it('OCR termurah tetapi selisih "sempurna" < 1 poin → vision', () => {
    const d = decide('receipt', { 'ocr-gcv+opus-low': kr({ cost: 0.05, perfect: 0.905 }), 'vision-opus-low': kr({ cost: 0.08, perfect: 0.9 }) });
    expect(d.chosen).toBe('vision-opus-low');
    expect(d.reason).toMatch(/§4.8 no. 3/);
    const d2 = decide('receipt', { 'ocr-gcv+opus-low': kr({ cost: 0.05, perfect: 0.95 }), 'vision-opus-low': kr({ cost: 0.08, perfect: 0.9 }) });
    expect(d2.chosen).toBe('ocr-gcv+opus-low');
  });
  it('tidak ada yang lolos → presisi auto-save tertinggi + risiko τ', () => {
    const d = decide('receipt', { a: kr({ precision: 0.95 }), 'vision-sonnet': kr({ precision: 0.97 }) });
    expect(d.passing).toEqual([]);
    expect(d.chosen).toBe('vision-sonnet');
    expect(d.risk).toMatch(/τ dinaikkan ke 0.85/);
  });
});
