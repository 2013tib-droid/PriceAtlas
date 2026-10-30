// `ocr-eval score` (docs/08 §4.7): catatan run × ground truth terverifikasi → skor per capture.
// Penyelarasan baris: algoritma Hungaria, biaya = 1 − similarity(raw_text) + penalti nominal berbeda;
// pasangan dengan similarity < 0,4 DAN nominal berbeda dianggap tidak berpasangan.
// Setiap metrik disimpan sebagai pembilang/penyebut (n/d) supaya bisa dijumlahkan per arm, jenis,
// kategori toko, dan kondisi (report.ts). Capture yang gagal dihitung salah di semua metrik akurasinya.
import type { ParsedObservation, ParsedObservationItem, ParsedReceipt, ParsedReceiptLine } from '@priceatlas/contracts';
import { piiStrings, redactText } from '../src/jobs/redact.ts';
import type { Truth } from './data.ts';
import { countsForAccuracy, type RunRecord } from './run.ts';
import { cer, hungarian, normText, similarity, type ConfPoint } from './stats.ts';

export type Counter = { n: number; d: number };
export type Counters = Record<string, Counter>;

export interface CaptureScore {
  id: string;
  kind: Truth['kind'];
  arm: string;
  repeat: number;
  split: Truth['split'];
  store_category: Truth['store_category'];
  conditions: string[];
  purpose: RunRecord['purpose'];
  ok: boolean;
  failure: 'refusal' | 'schema' | 'timeout' | 'unsupported' | 'unreadable' | 'other' | null;
  counters: Counters;
  conf: ConfPoint[];
  cost_usd: number | null;
  latency_ms: number | null;
  /** Nilai field kanonik (untuk stabilitas antar-ulangan); tetap di memori, tidak masuk laporan agregat. */
  fields: Record<string, string>;
  pii_leaks: number;
  prefilled: boolean | null;
}

/** Pasangan baris: indeks kebenaran → indeks prediksi. */
export const PAIR_MIN_SIMILARITY = 0.4;
const AMOUNT_PENALTY = 0.5;
const CER_OK = 0.1;
const TIME_TOLERANCE_MIN = 1;

function add(c: Counters, key: string, ok: boolean, weight = 1): void {
  const cur = (c[key] ??= { n: 0, d: 0 });
  cur.d += weight;
  if (ok) cur.n += weight;
}

function eqNum(a: number | null | undefined, b: number | null | undefined): boolean {
  if (a == null || b == null) return a == null && b == null;
  return Math.abs(a - b) < 0.005;
}

function tokens(s: string | null | undefined): string[] {
  return (s ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/** Nama jaringan sama (§4.7 "toko"): "AEON" = "AEON BSD", "Super Indo" = "SUPERINDO". */
export function storeMatches(truth: string | null | undefined, pred: string | null | undefined, predBranch?: string | null): boolean {
  const t = tokens(truth).join('');
  const name = tokens(pred).join('');
  const full = tokens(`${pred ?? ''} ${predBranch ?? ''}`).join('');
  if (!t || !full) return false;
  return full.includes(t) || (name.length >= 3 && t.includes(name));
}

/** Token cabang kebenaran terkandung di prediksi (nama + cabang). */
export function branchMatches(truth: string | null | undefined, predName?: string | null, predBranch?: string | null): boolean {
  const t = tokens(truth);
  if (!t.length) return false;
  const p = new Set(tokens(`${predName ?? ''} ${predBranch ?? ''}`));
  return t.every((x) => p.has(x));
}

/** Metode bayar ternormalisasi ke enum skema LLM (§4.7 "enum ternormalisasi"): "TUNAI" = cash, dst. */
export function normalizePayment(v: string | null | undefined): string {
  const t = (v ?? '').toLowerCase().trim();
  if (!t) return '';
  if (/^(cash|tunai|kontan)/.test(t)) return 'cash';
  if (/debit|debet|atm/.test(t)) return 'debit';
  if (/kredit|credit|cc\b|visa|master/.test(t)) return 'credit';
  if (/qris/.test(t)) return 'qris';
  if (/ovo|gopay|dana|shopeepay|linkaja|e-?wallet|flazz|e-?money|brizzi|tapcash/.test(t)) return 'ewallet';
  return 'other';
}

function minutes(t: string | null | undefined): number | null {
  const m = t?.match(/^(\d{2}):(\d{2})/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

export function classifyFailure(rec: RunRecord): CaptureScore['failure'] {
  if (rec.ok) return null;
  const stop = (rec.meta as { stop_reason?: string } | null)?.stop_reason;
  if (stop === 'refusal') return 'refusal';
  if (rec.error?.transient) return 'timeout';
  if (rec.error?.code === 'unsupported' && /tidak valid/.test(rec.error.message)) return 'schema';
  if (rec.error?.code === 'blurry' || rec.error?.code === 'not_a_receipt') return 'unreadable';
  if (rec.error?.code === 'unsupported') return 'unsupported';
  return 'other';
}

// ---------------------------------------------------------------------------- struk

/** Penyelarasan baris (Hungaria) → untuk setiap baris kebenaran, indeks baris prediksi atau -1. */
export function alignLines(pred: Pick<ParsedReceiptLine, 'raw_text' | 'line_amount'>[], truth: Pick<ParsedReceiptLine, 'raw_text' | 'line_amount'>[]): number[] {
  const cost = pred.map((p) =>
    truth.map((t) => 1 - similarity(p.raw_text, t.raw_text) + (eqNum(p.line_amount, t.line_amount) ? 0 : AMOUNT_PENALTY)),
  );
  const assign = hungarian(cost); // pred → truth
  const truthToPred = new Array(truth.length).fill(-1);
  assign.forEach((ti, pi) => {
    if (ti < 0) return;
    const p = pred[pi]!;
    const t = truth[ti]!;
    if (similarity(p.raw_text, t.raw_text) < PAIR_MIN_SIMILARITY && !eqNum(p.line_amount, t.line_amount)) return;
    truthToPred[ti] = pi;
  });
  return truthToPred;
}

function receiptFields(r: ParsedReceipt): Record<string, string> {
  const f: Record<string, string> = {
    store: normText(r.store_hint?.name),
    branch: normText(r.store_hint?.branch_name),
    date: r.header.transaction_date ?? '',
    time: r.header.transaction_time ?? '',
    total: String(r.header.total_amount ?? ''),
    payment: normalizePayment(r.header.payment_method),
  };
  for (const l of r.lines) f[`L${l.line_no}`] = `${l.line_type}|${normText(l.raw_text)}|${l.line_amount}|${l.quantity ?? ''}|${l.unit_amount ?? ''}`;
  return f;
}

export function scoreReceipt(truth: Truth, rec: RunRecord): Omit<CaptureScore, keyof ReturnType<typeof baseOf>> {
  const c: Counters = {};
  const conf: ConfPoint[] = [];
  const exp = truth.expected as ParsedReceipt;
  const pred = rec.ok && rec.output?.kind === 'receipt' ? (rec.output as ParsedReceipt) : null;
  const ann = truth.annotations.lines;
  const truthLines = exp.lines.filter((l) => !ann[String(l.line_no)]?.unreadable);
  const products = truthLines.filter((l) => l.line_type === 'product');

  // Header.
  const h = exp.header;
  if (exp.store_hint?.name) add(c, 'store', !!pred && storeMatches(exp.store_hint.name, pred.store_hint?.name, pred.store_hint?.branch_name));
  if (exp.store_hint?.branch_name)
    add(c, 'branch', !!pred && branchMatches(exp.store_hint.branch_name, pred.store_hint?.name, pred.store_hint?.branch_name));
  if (h.transaction_date) add(c, 'date', !!pred && pred.header.transaction_date === h.transaction_date);
  if (h.transaction_time) {
    const a = minutes(h.transaction_time);
    const b = minutes(pred?.header.transaction_time);
    add(c, 'time', a !== null && b !== null && Math.abs(a - b) <= TIME_TOLERANCE_MIN);
  }
  if (h.total_amount != null) add(c, 'total', !!pred && eqNum(pred.header.total_amount, h.total_amount));
  if (h.subtotal_amount != null) add(c, 'subtotal', !!pred && eqNum(pred.header.subtotal_amount, h.subtotal_amount));
  if (h.payment_method) add(c, 'payment', !!pred && normalizePayment(pred.header.payment_method) === normalizePayment(h.payment_method));

  // Baris.
  const predLines = pred?.lines ?? [];
  const t2p = pred ? alignLines(predLines, truthLines) : new Array(truthLines.length).fill(-1);
  const p2t = new Map<number, number>();
  t2p.forEach((pi, ti) => pi >= 0 && p2t.set(pi, ti));
  const truthNoToIdx = new Map(truthLines.map((l, i) => [l.line_no, i]));

  let allProductsOk = true;
  let corrections = 0;
  truthLines.forEach((t, ti) => {
    const pi = t2p[ti]!;
    const p = pi >= 0 ? predLines[pi]! : null;
    const a = ann[String(t.line_no)] ?? {};
    if (p) {
      add(c, 'line.type', p.line_type === t.line_type);
      add(c, 'line.text', cer(p.raw_text, t.raw_text) <= CER_OK);
      if (p.line_type !== t.line_type) corrections++;
    }
    if (t.line_type === 'product') {
      add(c, 'line.recall', !!p && p.line_type === 'product');
      const amountOk = !!p && eqNum(p.line_amount, t.line_amount);
      add(c, 'line.amount', amountOk);
      if (t.quantity != null) add(c, 'line.quantity', !!p && eqNum(p.quantity, t.quantity));
      if (t.unit_amount != null) add(c, 'line.unit', !!p && eqNum(p.unit_amount, t.unit_amount));
      if (!p) corrections++;
      else if (!amountOk) corrections++;
      if (!p || !amountOk) allProductsOk = false;
    }
    if (t.line_type === 'discount' || t.line_type === 'void') {
      const target = t.applies_to_line_no != null ? truthNoToIdx.get(t.applies_to_line_no) : undefined;
      const targetPred = target !== undefined ? t2p[target]! : -1;
      const ok =
        !!p && p.line_type === t.line_type && targetPred >= 0 && p.applies_to_line_no === predLines[targetPred]!.line_no;
      add(c, t.line_type === 'discount' ? 'line.discount' : 'line.void', ok);
      if (a.member_discount !== undefined || t.line_type === 'discount') {
        const truthMember = a.member_discount === true;
        const predMember = p?.member_discount === true;
        if (truthMember) {
          add(c, 'member.recall', predMember);
          // D-74: regex teks diskon memuat "member" (pada teks baris yang dibaca model) — Q-34/Q-110.
          add(c, 'member.regex_recall', !!p && /member/i.test(p.raw_text));
        }
        if (predMember) add(c, 'member.precision', truthMember);
      }
    }
    if (t.line_type === 'non_product') add(c, 'line.non_product', !!p && p.line_type === 'non_product');
    if (a.weighed) {
      add(
        c,
        'line.weighed',
        !!p && eqNum(p.quantity, t.quantity) && eqNum(p.unit_amount, t.unit_amount) && eqNum(p.line_amount, t.line_amount),
      );
    }
  });
  predLines.forEach((p, pi) => {
    if (p.line_type !== 'product') return;
    const ti = p2t.get(pi);
    const t = ti !== undefined ? truthLines[ti]! : null;
    add(c, 'line.precision', !!t && t.line_type === 'product');
    if (!t) corrections++;
    // Confidence (§4.7, §8.1): baris benar = semua angkanya benar.
    const ok =
      !!t &&
      t.line_type === 'product' &&
      eqNum(p.line_amount, t.line_amount) &&
      (t.quantity == null || eqNum(p.quantity, t.quantity)) &&
      (t.unit_amount == null || eqNum(p.unit_amount, t.unit_amount));
    conf.push({ c: p.parse_confidence ?? 0, ok });
  });

  const storeOk = !exp.store_hint?.name || c.store?.n === 1;
  const dateOk = !h.transaction_date || c.date?.n === 1;
  const totalOk = h.total_amount == null || c.total?.n === 1;
  if (!storeOk) corrections++;
  if (!dateOk) corrections++;
  if (!totalOk) corrections++;
  add(c, 'perfect', !!pred && storeOk && dateOk && totalOk && allProductsOk);
  if (pred) {
    c['corrections'] = { n: corrections, d: 1 };
    const flags = ((rec.meta as { flags?: string[] } | null)?.flags ?? []) as string[];
    if (pred.header.total_amount != null) add(c, 'sum_equals_total', !flags.includes('total_mismatch'));
  }

  // PII (§4.7, §9): recall nilai PII terstruktur; kebocoran di transkripsi setelah redaksi.
  let leaks = 0;
  const piiTruth = truth.annotations.transcript_pii;
  if (piiTruth.length) {
    const predPii = Object.values(pred?.pii ?? {}).map((v) => tokens(v).join(''));
    for (const v of piiTruth) add(c, 'pii.recall', predPii.some((p) => p.length >= 3 && (p.includes(tokens(v).join('')) || tokens(v).join('').includes(p))));
    if (rec.raw_text) {
      const redacted = redactText(rec.raw_text, piiStrings(pred?.pii ?? {})).toLowerCase();
      for (const v of piiTruth) {
        const leak = redacted.includes(v.toLowerCase());
        add(c, 'pii.no_leak', !leak);
        if (leak) leaks++;
      }
    }
  }

  return { counters: c, conf, fields: pred ? receiptFields(pred) : {}, pii_leaks: leaks };
}

// ---------------------------------------------------------------------------- label / screenshot

function itemText(i: ParsedObservationItem): string {
  return i.raw_text || i.listing_title || '';
}

function itemFields(o: ParsedObservation): Record<string, string> {
  const f: Record<string, string> = { store: normText(o.store_hint?.name) };
  o.items.forEach((i, k) => {
    f[`I${k + 1}`] = [normText(i.raw_text), i.normal_price, i.promo_price, i.member_price, i.promo_min_qty, i.promo_valid_from, i.promo_valid_until]
      .map((x) => x ?? '')
      .join('|');
  });
  return f;
}

export function scoreObservation(truth: Truth, rec: RunRecord): Omit<CaptureScore, keyof ReturnType<typeof baseOf>> {
  const c: Counters = {};
  const conf: ConfPoint[] = [];
  const exp = truth.expected as ParsedObservation;
  const pred = rec.ok && rec.output && rec.output.kind !== 'receipt' ? (rec.output as ParsedObservation) : null;
  const ann = truth.annotations.lines;
  const truthItems = exp.items.filter((_, k) => !ann[String(k + 1)]?.unreadable);
  const predItems = pred?.items ?? [];
  const cost = predItems.map((p) =>
    truthItems.map((t) => 1 - similarity(itemText(p), itemText(t)) + (eqNum(p.normal_price ?? p.promo_price, t.normal_price ?? t.promo_price) ? 0 : AMOUNT_PENALTY)),
  );
  const assign = hungarian(cost);
  const t2p = new Array(truthItems.length).fill(-1);
  assign.forEach((ti, pi) => {
    if (ti < 0) return;
    if (similarity(itemText(predItems[pi]!), itemText(truthItems[ti]!)) < PAIR_MIN_SIMILARITY) return;
    t2p[ti] = pi;
  });
  const paired = new Set(t2p.filter((x) => x >= 0));

  let allOk = true;
  truthItems.forEach((t, ti) => {
    const p = t2p[ti]! >= 0 ? predItems[t2p[ti]!]! : null;
    add(c, 'item.recall', !!p);
    if (!p) allOk = false;
    let priceOk = true;
    for (const k of ['normal_price', 'promo_price', 'member_price'] as const) {
      if (t[k] == null && p?.[k] == null) continue;
      const ok = !!p && eqNum(p[k], t[k]);
      add(c, `price.${k.replace('_price', '')}`, ok);
      add(c, 'price', ok);
      if (!ok) priceOk = false;
    }
    if (t.promo_min_qty != null || p?.promo_min_qty != null) add(c, 'promo_min_qty', !!p && p.promo_min_qty === t.promo_min_qty);
    if (t.promo_valid_from || t.promo_valid_until || p?.promo_valid_from || p?.promo_valid_until) {
      add(c, 'promo_period', !!p && (p.promo_valid_from ?? null) === (t.promo_valid_from ?? null) && (p.promo_valid_until ?? null) === (t.promo_valid_until ?? null));
    }
    if (t.member_program_name) add(c, 'member_program', !!p && normText(p.member_program_name) === normText(t.member_program_name));
    if (t.image_position != null) add(c, 'image_position', !!p && p.image_position === t.image_position);
    add(c, 'product.text', !!p && cer(itemText(p), itemText(t)) <= CER_OK);
    if (t.listing_title) add(c, 'listing_title', !!p && cer(p.listing_title, t.listing_title) <= CER_OK);
    if (t.shipping_fee != null) add(c, 'shipping_fee', !!p && eqNum(p.shipping_fee, t.shipping_fee));
    if (!priceOk) allOk = false;
    if (p) conf.push({ c: p.field_confidence?.price ?? 0, ok: priceOk });
  });
  predItems.forEach((p, pi) => {
    add(c, 'item.precision', paired.has(pi));
    if (!paired.has(pi)) conf.push({ c: p.field_confidence?.price ?? 0, ok: false });
  });
  if (exp.store_hint?.name) add(c, 'store', !!pred && storeMatches(exp.store_hint.name, pred.store_hint?.name, pred.store_hint?.branch_name));
  add(c, 'perfect', !!pred && allOk && predItems.length === truthItems.length);
  return { counters: c, conf, fields: pred ? itemFields(pred) : {}, pii_leaks: 0 };
}

// ---------------------------------------------------------------------------- satu capture

function baseOf(truth: Truth, rec: RunRecord) {
  return {
    id: truth.id,
    kind: truth.kind,
    arm: rec.arm,
    repeat: rec.repeat,
    split: truth.split,
    store_category: truth.store_category,
    conditions: truth.conditions,
    purpose: rec.purpose,
    ok: rec.ok,
    failure: classifyFailure(rec),
    cost_usd: rec.cost_usd,
    latency_ms: rec.latency_ms,
    prefilled: truth.verified ? truth.verified.prefill !== null : null,
  };
}

export function scoreCapture(truth: Truth, rec: RunRecord): CaptureScore {
  const base = baseOf(truth, rec);
  if (truth.expected === null) {
    // Gambar memang tidak terbaca: benar jika ditolak blurry/not_a_receipt/unsupported (bukan isi karangan).
    const c: Counters = {};
    add(c, 'unreadable_detected', !rec.ok && ['blurry', 'not_a_receipt', 'unsupported'].includes(rec.error?.code ?? ''));
    return { ...base, failure: base.failure === 'unreadable' ? null : base.failure, counters: c, conf: [], fields: {}, pii_leaks: 0 };
  }
  const s = truth.kind === 'receipt' ? scoreReceipt(truth, rec) : scoreObservation(truth, rec);
  return { ...base, ...s };
}

/** Skor semua catatan yang punya ground truth TERVERIFIKASI (draf dilewati). */
export function scoreAll(truths: Truth[], records: RunRecord[], opts: { includeUnverified?: boolean } = {}): CaptureScore[] {
  const byId = new Map(truths.filter((t) => opts.includeUnverified || t.verified).map((t) => [t.id, t]));
  return records.flatMap((r) => {
    const t = byId.get(r.id);
    return t ? [scoreCapture(t, r)] : [];
  });
}

/** Persentase field berbeda antar-ulangan per (arm, id) (§4.7 stabilitas). */
export function stability(scores: CaptureScore[]): Map<string, Counter> {
  const groups = new Map<string, CaptureScore[]>();
  for (const s of scores) {
    if (!s.ok || !countsForAccuracy(s.purpose)) continue;
    const k = `${s.arm}\u0000${s.id}`;
    groups.set(k, [...(groups.get(k) ?? []), s]);
  }
  const out = new Map<string, Counter>();
  for (const [k, list] of groups) {
    if (list.length < 2) continue;
    const arm = k.split('\u0000')[0]!;
    const [a, b] = [list[0]!.fields, list[1]!.fields];
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    const cur = out.get(arm) ?? { n: 0, d: 0 };
    for (const key of keys) {
      cur.d++;
      if (a[key] !== b[key]) cur.n++;
    }
    out.set(arm, cur);
  }
  return out;
}
