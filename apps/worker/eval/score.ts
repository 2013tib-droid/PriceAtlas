// Penilaian uji OCR (docs/08 §4.7) dan kriteria keputusan D-16 (§4.8).
//   * Penyelarasan baris: algoritma Hungaria, biaya = 1 − similarity(raw_text) + penalti nominal beda.
//     Pasangan dengan similarity < 0,4 DAN nominal beda dianggap tidak berpasangan.
//   * Semua metrik berupa hitungan (hit/total) supaya bisa dijumlah per arm, jenis, kategori, kondisi.
//   * Agregat TIDAK memuat teks struk (hanya angka, nama arm, kategori jenis toko, kondisi).
import type { ParsedObservation, ParsedObservationItem, ParsedOutput, ParsedReceipt, ParsedReceiptLine } from '@priceatlas/contracts';
import { piiStrings, redactText } from '../src/jobs/redact.ts';
import { readableLineNos, type Truth } from './truth.ts';

// ------------------------------------------------------------------ catatan run

export interface RunError {
  code: string;
  message: string;
  transient: boolean;
}

/** Satu (arm, capture, ulangan). Disimpan di runs/<waktu>-<mode>/<arm>/<id>-r<n>.json. */
export interface RunRecord {
  id: string;
  arm: string;
  repeat: number;
  mode: 'batch' | 'realtime';
  ok: boolean;
  output?: ParsedOutput;
  rawText?: string | null;
  error?: RunError;
  cost_usd: number | null;
  latency_ms: number | null;
  served_model?: string | null;
  fallback_used?: boolean;
  prompt_version?: string;
}

// ------------------------------------------------------------------ teks

export function normText(s: string | null | undefined): string {
  return (s ?? '').toUpperCase().replace(/\s+/g, ' ').trim();
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length]!;
}

/** Character error rate terhadap ground truth (spasi dinormalkan). */
export function cer(pred: string | null | undefined, truth: string | null | undefined): number {
  const t = normText(truth);
  return levenshtein(normText(pred), t) / Math.max(1, t.length);
}

export function similarity(a: string | null | undefined, b: string | null | undefined): number {
  const x = normText(a);
  const y = normText(b);
  return 1 - levenshtein(x, y) / Math.max(1, x.length, y.length);
}

/** Nama jaringan: kata pertama setelah normalisasi (`AEON BSD` → `AEON`, `ALFAMART SERPONG` → `ALFAMART`). */
export function chainOf(name: string | null | undefined): string {
  return normText(name).replace(/[^A-Z0-9 ]/g, '').split(' ')[0] ?? '';
}

// ------------------------------------------------------------------ Hungaria

/** Penugasan biaya minimum untuk matriks n×m (persegi diisi biaya `pad`). Kembali: kolom per baris (−1 = tidak ada). */
export function hungarian(cost: number[][], pad = 1e6): number[] {
  const n0 = cost.length;
  const m0 = n0 ? cost[0]!.length : 0;
  const n = Math.max(n0, m0);
  if (n === 0) return [];
  const a = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i < n0 && j < m0 ? cost[i]![j]! : pad)));
  const u = new Array(n + 1).fill(0);
  const v = new Array(n + 1).fill(0);
  const p = new Array(n + 1).fill(0);
  const way = new Array(n + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Array(n + 1).fill(Infinity);
    const used = new Array(n + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = p[j0];
      let delta = Infinity;
      let j1 = 0;
      for (let j = 1; j <= n; j++) {
        if (used[j]) continue;
        const cur = a[i0 - 1]![j - 1]! - u[i0] - v[j];
        if (cur < minv[j]) {
          minv[j] = cur;
          way[j] = j0;
        }
        if (minv[j] < delta) {
          delta = minv[j];
          j1 = j;
        }
      }
      for (let j = 0; j <= n; j++) {
        if (used[j]) {
          u[p[j]] += delta;
          v[j] -= delta;
        } else minv[j] -= delta;
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do {
      const j1 = way[j0];
      p[j0] = p[j1];
      j0 = j1;
    } while (j0);
  }
  const out = new Array(n0).fill(-1);
  for (let j = 1; j <= n; j++) if (p[j] - 1 < n0 && j - 1 < m0) out[p[j] - 1] = j - 1;
  return out;
}

export const MIN_PAIR_SIMILARITY = 0.4;
const AMOUNT_PENALTY = 0.5;

/** Pasangan (indeks truth → indeks prediksi). */
export function alignLines(truth: ParsedReceiptLine[], pred: ParsedReceiptLine[]): Map<number, number> {
  const cost = truth.map((t) =>
    pred.map((p) => 1 - similarity(t.raw_text, p.raw_text) + (t.line_amount === p.line_amount ? 0 : AMOUNT_PENALTY)),
  );
  const asg = hungarian(cost);
  const pairs = new Map<number, number>();
  asg.forEach((j, i) => {
    if (j < 0) return;
    const t = truth[i]!;
    const p = pred[j]!;
    if (similarity(t.raw_text, p.raw_text) < MIN_PAIR_SIMILARITY && t.line_amount !== p.line_amount) return;
    pairs.set(i, j);
  });
  return pairs;
}

const itemText = (i: ParsedObservationItem) => i.listing_title || i.raw_text;

export function alignItems(truth: ParsedObservationItem[], pred: ParsedObservationItem[]): Map<number, number> {
  const price = (i: ParsedObservationItem) => i.promo_price ?? i.normal_price ?? i.member_price;
  const cost = truth.map((t) =>
    pred.map(
      (p) =>
        1 -
        similarity(itemText(t), itemText(p)) +
        (price(t) === price(p) ? 0 : AMOUNT_PENALTY) +
        ((t.image_position ?? 1) === (p.image_position ?? 1) ? 0 : 0.25),
    ),
  );
  const pairs = new Map<number, number>();
  hungarian(cost).forEach((j, i) => {
    if (j < 0) return;
    if (similarity(itemText(truth[i]!), itemText(pred[j]!)) < MIN_PAIR_SIMILARITY && price(truth[i]!) !== price(pred[j]!)) return;
    pairs.set(i, j);
  });
  return pairs;
}

// ------------------------------------------------------------------ hitungan

export type Tally = Record<string, [hit: number, total: number]>;

export function add(t: Tally, key: string, hit: boolean | number, total = 1): void {
  const cur = t[key] ?? [0, 0];
  cur[0] += typeof hit === 'boolean' ? (hit ? 1 : 0) : hit;
  cur[1] += total;
  t[key] = cur;
}

export function merge(into: Tally, from: Tally): Tally {
  for (const [k, [h, n]] of Object.entries(from)) add(into, k, h, n);
  return into;
}

export const rate = (t: Tally, key: string): number | null => {
  const v = t[key];
  return v && v[1] > 0 ? v[0] / v[1] : null;
};

/** Titik kalibrasi: confidence gabungan baris/item dan apakah semua field angkanya benar. */
export interface ConfPoint {
  conf: number;
  correct: boolean;
}

export interface CaptureScore {
  id: string;
  arm: string;
  repeat: number;
  kind: Truth['kind'];
  split: Truth['split'];
  store_category: string | null;
  conditions: string[];
  tally: Tally;
  conf: ConfPoint[];
  /** Jumlah field yang harus diubah user di S-10/S-11 (proksi beban UX). */
  corrections: number;
  cost_usd: number | null;
  latency_ms: number | null;
  mode: RunRecord['mode'];
}

const MEMBER_REGEX = /member/i; // D-74: baris diskon yang memuat "member"

function failureKind(e: RunError): 'refusal' | 'schema' | 'timeout' | 'read' | 'other' {
  if (e.transient) return 'timeout';
  if (e.code === 'other' && /tidak bisa diproses/i.test(e.message)) return 'refusal';
  if (e.code === 'unsupported' && /tidak valid/i.test(e.message)) return 'schema';
  if (e.code === 'blurry' || e.code === 'not_a_receipt') return 'read';
  return 'other';
}

/** Nilai satu run terhadap ground truth. */
export function scoreCapture(truth: Truth, rec: RunRecord): CaptureScore {
  const base: CaptureScore = {
    id: truth.id,
    arm: rec.arm,
    repeat: rec.repeat,
    kind: truth.kind,
    split: truth.split,
    store_category: truth.store_category,
    conditions: truth.conditions,
    tally: {},
    conf: [],
    corrections: 0,
    cost_usd: rec.cost_usd,
    latency_ms: rec.latency_ms,
    mode: rec.mode,
  };
  const t = base.tally;

  // Tidak terbaca oleh manusia: yang benar adalah gagal `blurry`/`unsupported`, bukan menebak.
  if (!truth.expected) {
    add(t, 'unreadable.rejected', !rec.ok);
    return base;
  }
  // Gagal operasional (refusal, skema, timeout) dan gagal baca pada gambar yang terbaca.
  const fk = rec.ok ? null : failureKind(rec.error ?? { code: 'other', message: '', transient: false });
  add(t, 'ops.failure', fk !== null && fk !== 'read');
  for (const k of ['refusal', 'schema', 'timeout'] as const) add(t, `ops.failure.${k}`, fk === k);
  add(t, 'ops.read_failure', fk === 'read');
  if (!rec.ok || !rec.output) {
    // Semua metrik dihitung salah (denominator tetap) supaya arm yang sering gagal tidak terlihat akurat.
    if (truth.expected.kind === 'receipt') scoreReceipt(truth, truth.expected, null, rec, base);
    else scoreObservation(truth.expected, null, base);
    return base;
  }
  if (truth.expected.kind === 'receipt') {
    scoreReceipt(truth, truth.expected, rec.output.kind === 'receipt' ? rec.output : null, rec, base);
  } else {
    scoreObservation(truth.expected, rec.output.kind !== 'receipt' ? rec.output : null, base);
  }
  return base;
}

function scoreReceipt(truth: Truth, exp: ParsedReceipt, pred: ParsedReceipt | null, rec: RunRecord, s: CaptureScore): void {
  const t = s.tally;
  const readable = readableLineNos(truth);
  const tLines = exp.lines.filter((l) => readable.has(l.line_no));
  const pLines = pred?.lines ?? [];
  const pairs = alignLines(tLines, pLines);
  const byTruthNo = new Map<number, ParsedReceiptLine | undefined>(tLines.map((l, i) => [l.line_no, pairs.has(i) ? pLines[pairs.get(i)!] : undefined]));
  const ph = pred?.header;
  const eh = exp.header;

  // Header.
  const storeOk = !!pred && chainOf(pred.store_hint?.name) !== '' && chainOf(pred.store_hint?.name) === chainOf(exp.store_hint?.name);
  if (exp.store_hint?.name) add(t, 'header.store', storeOk);
  if (exp.store_hint?.branch_name) {
    const hay = normText(`${pred?.store_hint?.name ?? ''} ${pred?.store_hint?.branch_name ?? ''}`);
    add(t, 'header.branch', normText(exp.store_hint.branch_name).split(' ').every((tok) => hay.includes(tok)));
  }
  const dateOk = !!ph && ph.transaction_date === eh.transaction_date;
  if (eh.transaction_date) add(t, 'header.date', dateOk);
  if (eh.transaction_time) add(t, 'header.time', !!ph?.transaction_time && Math.abs(minutes(ph.transaction_time) - minutes(eh.transaction_time)) <= 1);
  const totalOk = !!ph && ph.total_amount === eh.total_amount;
  if (eh.total_amount != null) add(t, 'header.total', totalOk);
  if (eh.subtotal_amount != null) add(t, 'header.subtotal', ph?.subtotal_amount === eh.subtotal_amount);
  if (eh.payment_method) add(t, 'header.payment', paymentOf(ph?.payment_method) === paymentOf(eh.payment_method));

  // Baris.
  let allProductsOk = true;
  let corrections = (exp.store_hint?.name && !storeOk ? 1 : 0) + (eh.transaction_date && !dateOk ? 1 : 0) + (eh.total_amount != null && !totalOk ? 1 : 0);
  tLines.forEach((tl, i) => {
    const p = pairs.has(i) ? pLines[pairs.get(i)!]! : null;
    const ann = truth.annotations.lines[String(tl.line_no)] ?? {};
    if (tl.line_type === 'product') {
      add(t, 'lines.recall', !!p);
      const amountOk = !!p && p.line_amount === tl.line_amount;
      if (!amountOk) allProductsOk = false;
      if (!p) corrections += 1;
      else {
        if (!amountOk) corrections += 1;
        if (cer(p.raw_text, tl.raw_text) > 0.1) corrections += 1;
      }
      add(t, 'lines.amount', amountOk);
      if (tl.quantity != null) add(t, 'lines.quantity', p?.quantity === tl.quantity);
      if (tl.unit_amount != null) add(t, 'lines.unit', p?.unit_amount === tl.unit_amount);
      add(t, 'lines.text', !!p && cer(p.raw_text, tl.raw_text) <= 0.1);
      if (ann.weighed) {
        add(t, 'lines.weighed', !!p && p.quantity === tl.quantity && p.unit_amount === tl.unit_amount && p.line_amount === tl.line_amount);
      }
    }
    if (p) add(t, 'lines.type', p.line_type === tl.line_type);
    if (tl.line_type === 'discount' || tl.line_type === 'void') {
      const target = tl.applies_to_line_no != null ? byTruthNo.get(tl.applies_to_line_no) : undefined;
      add(t, `lines.${tl.line_type}`, !!p && p.line_type === tl.line_type && !!target && p.applies_to_line_no === target.line_no);
    }
    if (tl.line_type === 'non_product') add(t, 'lines.non_product', !!p && p.line_type === 'non_product');
    // Member (Q-34): konverter (member_discount) vs regex D-74, pada baris diskon ground truth.
    if (tl.line_type === 'discount') {
      const truthMember = ann.member_discount ?? false;
      const conv = !!p?.member_discount;
      const rx = !!p && MEMBER_REGEX.test(p.raw_text);
      if (truthMember) {
        add(t, 'member.converter_recall', conv);
        add(t, 'member.regex_recall', rx);
      }
      if (conv) add(t, 'member.converter_precision', truthMember);
      if (rx) add(t, 'member.regex_precision', truthMember);
    }
  });
  // Presisi: baris produk prediksi yang berpasangan dengan baris ground truth.
  const pairedPred = new Set(pairs.values());
  pLines.forEach((pl, j) => {
    if (pl.line_type !== 'product') return;
    add(t, 'lines.precision', pairedPred.has(j));
    if (!pairedPred.has(j)) corrections += 1; // baris karangan → user menghapus
  });

  add(t, 'receipt.perfect', storeOk && dateOk && totalOk && allProductsOk && !!pred);
  if (pred && ph?.total_amount != null) {
    const sum = pred.lines.filter((l) => l.line_type !== 'other').reduce((a, l) => a + l.line_amount, 0);
    add(t, 'receipt.sum_total', sum === ph.total_amount);
  }
  s.corrections = pred ? corrections : tLines.length + 3;

  // Confidence gabungan per baris produk prediksi (§8.1): min(parse_confidence, confidence tanggal).
  if (pred) {
    const truthByPred = new Map([...pairs].map(([ti, pj]) => [pj, tLines[ti]!]));
    const dateConf = ph?.field_confidence?.date ?? 0;
    pLines.forEach((pl, j) => {
      if (pl.line_type !== 'product') return;
      const tl = truthByPred.get(j);
      const correct =
        !!tl &&
        dateOk &&
        pl.line_amount === tl.line_amount &&
        (tl.quantity == null || pl.quantity === tl.quantity) &&
        (tl.unit_amount == null || pl.unit_amount === tl.unit_amount);
      s.conf.push({ conf: Math.min(pl.parse_confidence ?? 0, dateConf), correct });
    });
  }

  // PII: tertangkap di `pii`, dan tidak bocor ke transkripsi setelah redaksi lapis 2 (§9).
  const values = truth.annotations.transcript_pii.filter((v) => v.trim().length >= 4);
  const caught = pred ? piiStrings(pred.pii).map(digitsOrText) : [];
  const redacted = rec.rawText != null ? redactText(rec.rawText, pred ? piiStrings(pred.pii) : []) : '';
  for (const v of values) {
    add(t, 'pii.recall', caught.some((c) => c.includes(digitsOrText(v)) || digitsOrText(v).includes(c)));
    add(t, 'pii.leak', rec.rawText != null && normText(redacted).includes(normText(v)));
  }
}

function scoreObservation(exp: ParsedObservation, pred: ParsedObservation | null, s: CaptureScore): void {
  const t = s.tally;
  const pItems = pred?.items ?? [];
  const pairs = alignItems(exp.items, pItems);
  let corrections = 0;
  exp.items.forEach((ti, i) => {
    const p = pairs.has(i) ? pItems[pairs.get(i)!]! : null;
    add(t, 'obs.item_recall', !!p);
    if (!p) corrections += 1;
    const priceFields = ['normal_price', 'promo_price', 'member_price'] as const;
    let pricesOk = !!p;
    for (const f of priceFields) {
      if (ti[f] == null && (p?.[f] ?? null) == null) continue;
      const ok = !!p && p[f] === ti[f];
      add(t, 'obs.price', ok);
      add(t, `obs.${f}`, ok);
      if (!ok) {
        pricesOk = false;
        if (p) corrections += 1;
      }
    }
    if (ti.promo_min_qty != null) add(t, 'obs.promo_min_qty', p?.promo_min_qty === ti.promo_min_qty);
    if (ti.promo_valid_from || ti.promo_valid_until) {
      add(t, 'obs.period', !!p && (p.promo_valid_from ?? null) === (ti.promo_valid_from ?? null) && (p.promo_valid_until ?? null) === (ti.promo_valid_until ?? null));
    }
    if (ti.member_program_name) add(t, 'obs.program', !!p && chainOf(p.member_program_name) === chainOf(ti.member_program_name));
    if (ti.shipping_fee != null) add(t, 'obs.shipping', p?.shipping_fee === ti.shipping_fee);
    if (ti.seller_name) add(t, 'obs.seller', !!p && similarity(p.seller_name, ti.seller_name) >= 0.9);
    if (ti.image_position != null) add(t, 'obs.image_position', p?.image_position === ti.image_position);
    add(t, 'obs.product', !!p && cer(itemText(p), itemText(ti)) <= 0.1);
    if (pred && p) {
      s.conf.push({ conf: Math.min(p.field_confidence?.price ?? 0, p.field_confidence?.product ?? 0), correct: pricesOk });
    }
  });
  const paired = new Set(pairs.values());
  pItems.forEach((pi, j) => {
    add(t, 'obs.item_precision', paired.has(j));
    if (!paired.has(j)) {
      corrections += 1;
      s.conf.push({ conf: Math.min(pi.field_confidence?.price ?? 0, pi.field_confidence?.product ?? 0), correct: false });
    }
  });
  s.corrections = pred ? corrections : exp.items.length;
}

/** Metode bayar ternormalisasi ke enum skema LLM (struk mencetak TUNAI, DEBET, GOPAY, …). */
export function paymentOf(v: string | null | undefined): string {
  const x = normText(v);
  if (!x) return '';
  if (/TUNAI|CASH/.test(x)) return 'cash';
  if (/DEBIT|DEBET/.test(x)) return 'debit';
  if (/KREDIT|CREDIT|VISA|MASTER/.test(x)) return 'credit';
  if (/QRIS/.test(x)) return 'qris';
  if (/EWALLET|E-WALLET|GOPAY|OVO|DANA|SHOPEEPAY|LINKAJA/.test(x)) return 'ewallet';
  return x === 'OTHER' ? 'other' : x;
}

function minutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

function digitsOrText(v: string): string {
  const d = v.replace(/\D/g, '');
  return d.length >= 4 ? d : normText(v);
}

// ------------------------------------------------------------------ stabilitas

/** Field datar (tanpa confidence/region) untuk membandingkan ulangan. */
export function flatFields(o: ParsedOutput | undefined): Map<string, string> {
  const m = new Map<string, string>();
  if (!o) return m;
  if (o.kind === 'receipt') {
    m.set('store', chainOf(o.store_hint?.name));
    for (const [k, v] of Object.entries(o.header)) if (k !== 'field_confidence') m.set(`h.${k}`, String(v ?? ''));
    o.lines.forEach((l, i) => {
      for (const k of ['line_type', 'raw_text', 'quantity', 'unit_amount', 'line_amount', 'applies_to_line_no'] as const) {
        m.set(`l${i}.${k}`, String(l[k] ?? ''));
      }
    });
  } else {
    o.items.forEach((it, i) => {
      for (const k of ['raw_text', 'normal_price', 'promo_price', 'member_price', 'promo_valid_until', 'shipping_fee'] as const) {
        m.set(`i${i}.${k}`, String(it[k] ?? ''));
      }
    });
  }
  return m;
}

/** Persentase field yang berbeda antara dua ulangan (gabungan kunci keduanya). */
export function instability(a: RunRecord, b: RunRecord): [diff: number, total: number] {
  const fa = flatFields(a.output);
  const fb = flatFields(b.output);
  const keys = new Set([...fa.keys(), ...fb.keys()]);
  let diff = 0;
  for (const k of keys) if (fa.get(k) !== fb.get(k)) diff += 1;
  return [diff, keys.size];
}

// ------------------------------------------------------------------ kalibrasi

export interface AutoSave {
  tau: number;
  precision: number | null;
  coverage: number | null;
}

export function autoSaveAt(points: ConfPoint[], tau: number): AutoSave {
  const above = points.filter((p) => p.conf >= tau);
  return {
    tau,
    precision: above.length ? above.filter((p) => p.correct).length / above.length : null,
    coverage: points.length ? above.length / points.length : null,
  };
}

/** τ terkecil (kisi 0,50–1,00 langkah 0,01) yang memberi presisi ≥ target. null jika tidak ada. */
export function tauFor(points: ConfPoint[], target = 0.98): AutoSave | null {
  for (let i = 50; i <= 100; i++) {
    const r = autoSaveAt(points, i / 100);
    if (r.precision !== null && r.precision >= target) return r;
  }
  return null;
}

/** Expected calibration error, 10 rentang. */
export function ece(points: ConfPoint[], bins = 10): number | null {
  if (!points.length) return null;
  let sum = 0;
  for (let b = 0; b < bins; b++) {
    const lo = b / bins;
    const hi = (b + 1) / bins;
    const inBin = points.filter((p) => p.conf >= lo && (b === bins - 1 ? p.conf <= hi : p.conf < hi));
    if (!inBin.length) continue;
    const acc = inBin.filter((p) => p.correct).length / inBin.length;
    const conf = inBin.reduce((a, p) => a + p.conf, 0) / inBin.length;
    sum += (inBin.length / points.length) * Math.abs(acc - conf);
  }
  return sum;
}

export function percentile(values: number[], q: number): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const idx = Math.min(s.length - 1, Math.max(0, Math.ceil(q * s.length) - 1));
  return s[idx]!;
}

// ------------------------------------------------------------------ agregat dan kriteria

export interface Group {
  captures: number;
  rates: Record<string, { rate: number | null; hit: number; total: number }>;
  auto_save: { at_tau: AutoSave[]; tau_98: AutoSave | null; ece: number | null; points: number };
  corrections_mean: number | null;
  cost_usd_mean: number | null;
  cost_usd_total: number;
  latency_ms: { p50: number | null; p95: number | null; n: number };
  instability: { rate: number | null; diff: number; total: number };
}

const TAUS = [0.8, 0.85, 0.9, 0.95, 0.98];

export function summarize(scores: CaptureScore[], instab: [number, number] = [0, 0]): Group {
  const tally: Tally = {};
  for (const s of scores) merge(tally, s.tally);
  const conf = scores.flatMap((s) => s.conf);
  const costs = scores.map((s) => s.cost_usd).filter((c): c is number => c != null);
  const lat = scores.filter((s) => s.mode === 'realtime').map((s) => s.latency_ms).filter((c): c is number => c != null);
  return {
    captures: scores.length,
    rates: Object.fromEntries(
      Object.keys(tally)
        .sort()
        .map((k) => [k, { rate: rate(tally, k), hit: tally[k]![0], total: tally[k]![1] }]),
    ),
    auto_save: { at_tau: TAUS.map((x) => autoSaveAt(conf, x)), tau_98: tauFor(conf), ece: ece(conf), points: conf.length },
    corrections_mean: scores.length ? scores.reduce((a, s) => a + s.corrections, 0) / scores.length : null,
    cost_usd_mean: costs.length ? costs.reduce((a, c) => a + c, 0) / costs.length : null,
    cost_usd_total: costs.reduce((a, c) => a + c, 0),
    latency_ms: { p50: percentile(lat, 0.5), p95: percentile(lat, 0.95), n: lat.length },
    instability: { rate: instab[1] ? instab[0] / instab[1] : null, diff: instab[0], total: instab[1] },
  };
}

export interface Criterion {
  name: string;
  value: number | null;
  op: '>=' | '<=' | '=';
  target: number;
  pass: boolean;
}

const crit = (name: string, value: number | null, op: Criterion['op'], target: number): Criterion => ({
  name,
  value,
  op,
  target,
  pass: value !== null && (op === '>=' ? value >= target : op === '<=' ? value <= target : value === target),
});

/** §4.8 butir 1: batas minimum struk (split test). */
export function receiptCriteria(g: Group): Criterion[] {
  const r = (k: string) => g.rates[k]?.rate ?? null;
  const tau = g.auto_save.tau_98;
  return [
    crit('presisi auto-save ≥ 98 % (τ ditemukan)', tau ? tau.precision : null, '>=', 0.98),
    crit('coverage @τ', tau ? tau.coverage : null, '>=', 0.6),
    crit('nominal baris produk', r('lines.amount'), '>=', 0.97),
    crit('recall baris produk', r('lines.recall'), '>=', 0.97),
    crit('tanggal', r('header.date'), '>=', 0.98),
    crit('total', r('header.total'), '>=', 0.98),
    crit('toko', r('header.store'), '>=', 0.95),
    crit('kebocoran PII (jumlah)', g.rates['pii.leak']?.hit ?? 0, '=', 0),
    crit('kegagalan (refusal + skema + timeout)', r('ops.failure'), '<=', 0.02),
  ];
}

/** §4.8 butir 4: label/screenshot dinilai terpisah (harga ≥ 97 %, kegagalan sama). */
export function observationCriteria(g: Group): Criterion[] {
  const r = (k: string) => g.rates[k]?.rate ?? null;
  return [
    crit('harga (normal/promo/member)', r('obs.price'), '>=', 0.97),
    crit('recall item', r('obs.item_recall'), '>=', 0.97),
    crit('kegagalan (refusal + skema + timeout)', r('ops.failure'), '<=', 0.02),
  ];
}
