// `ocr-eval report` (docs/08 §4.7, §4.8, Lampiran A): skor per capture → laporan AGREGAT.
//   reports/<waktu>.agg.json  satu-satunya file yang boleh dikirim/di-commit: angka per metrik × arm ×
//                             jenis × kategori toko × kondisi. TANPA teks struk, nama toko, id, atau path.
//   reports/<waktu>.md        ringkasan yang sama untuk dibaca (juga tanpa teks).
// Keputusan D-16 (§4.8) dihitung dari split test, struk; label dan screenshot dinilai terpisah.
import { join } from 'node:path';
import { PRICING_AS_OF } from '@priceatlas/ai-tools/pricing';
import { PROMPT_VERSION } from '../src/extractors/prompts/index.ts';
import { ARMS } from './arms.ts';
import type { Truth } from './data.ts';
import { writeJson } from './data.ts';
import { countsForAccuracy } from './run.ts';
import { stability, type CaptureScore, type Counter, type Counters } from './score.ts';
import { atTau, ece, isotonic, minTauFor, percentile, type ConfPoint } from './stats.ts';
import { writeFileSync } from 'node:fs';

export const REPORT_SCHEMA = 'priceatlas.ocr-eval.report/1';
export const DEFAULT_TAU = 0.9;

/** Batas minimum §4.8 (Q-104 → D-92). */
export const CRITERIA = {
  receipt: [
    { key: 'autosave_precision', min: 0.98, label: 'presisi auto-save @τ' },
    { key: 'autosave_coverage', min: 0.6, label: 'coverage @τ' },
    { key: 'line.amount', min: 0.97, label: 'nominal baris produk' },
    { key: 'line.recall', min: 0.97, label: 'recall baris produk' },
    { key: 'date', min: 0.98, label: 'tanggal' },
    { key: 'total', min: 0.98, label: 'total' },
    { key: 'store', min: 0.95, label: 'toko' },
    { key: 'pii_leaks', max: 0, label: 'kebocoran PII' },
    { key: 'failure_rate', max: 0.02, label: 'kegagalan (refusal + skema + timeout)' },
  ],
  // §4.8 no. 4: label/screenshot dinilai terpisah dengan batas yang sama (harga ≥ 97 %).
  observation: [
    { key: 'autosave_precision', min: 0.98, label: 'presisi auto-save @τ' },
    { key: 'autosave_coverage', min: 0.6, label: 'coverage @τ' },
    { key: 'price', min: 0.97, label: 'harga' },
    { key: 'item.recall', min: 0.97, label: 'recall item' },
    { key: 'failure_rate', max: 0.02, label: 'kegagalan (refusal + skema + timeout)' },
  ],
} as const;
/** Selisih "struk sempurna" di bawah ini → pilih vision (§4.8 no. 3). */
export const TIE_POINTS = 0.01;
/** Q-110: regex D-74 cukup jika recall ≥ 95 % pada diskon member asli. */
export const MEMBER_REGEX_MIN_RECALL = 0.95;
/** Q-122/D-93: p95 latensi struk di atas ini → streaming ekstraksi. */
export const STREAMING_P95_MS = 60_000;
/** §4.2: selisih error pra-isi vs tanpa pra-isi > 1 poin → periksa ulang tanpa pra-isi. */
export const PREFILL_BIAS_POINTS = 0.01;

const BREAKDOWN_KEYS = ['perfect', 'line.amount', 'line.recall', 'date', 'total', 'store', 'price', 'item.recall'];
const KINDS = ['receipt', 'price_label', 'marketplace'] as const;

type Rate = { rate: number | null; n: number; d: number };

function rate(c: Counter | undefined): Rate {
  return c && c.d ? { rate: round(c.n / c.d), n: c.n, d: c.d } : { rate: null, n: c?.n ?? 0, d: c?.d ?? 0 };
}

function round(x: number | null | undefined, digits = 4): number | null {
  return x == null || !Number.isFinite(x) ? null : Math.round(x * 10 ** digits) / 10 ** digits;
}

function sum(scores: CaptureScore[]): Counters {
  const out: Counters = {};
  for (const s of scores) {
    for (const [k, v] of Object.entries(s.counters)) {
      const cur = (out[k] ??= { n: 0, d: 0 });
      cur.n += v.n;
      cur.d += v.d;
    }
  }
  return out;
}

export interface KindReport {
  captures: number;
  records: number;
  metrics: Record<string, Rate>;
  confidence: {
    tau: number;
    autosave_precision: number | null;
    autosave_coverage: number | null;
    ece: number | null;
    min_tau_precision_98: number | null;
    /** Pemetaan isotonic dari split dev (§8.1); null jika dev tidak dinilai. */
    isotonic_dev: { from: number; p: number; n: number }[] | null;
  };
  cost: { mean_per_capture_usd: number | null; total_usd: number | null };
  latency: { n: number; p50_ms: number | null; p95_ms: number | null };
  failures: { rate: number | null; refusal: number; schema: number; timeout: number; unsupported: number; other: number; n: number };
  pii_leaks: number;
  mean_corrections: number | null;
  by_store_category: Record<string, Record<string, Rate>>;
  by_condition: Record<string, Record<string, Rate>>;
}

function kindReport(all: CaptureScore[], dev: CaptureScore[], tau: number): KindReport {
  const acc = all.filter((s) => countsForAccuracy(s.purpose));
  const counters = sum(acc);
  const metrics: Record<string, Rate> = {};
  for (const [k, v] of Object.entries(counters)) if (k !== 'corrections') metrics[k] = rate(v);
  const points: ConfPoint[] = acc.flatMap((s) => s.conf);
  const devPoints: ConfPoint[] = dev.filter((s) => countsForAccuracy(s.purpose)).flatMap((s) => s.conf);
  const t = atTau(points, tau);
  const costs = acc.map((s) => s.cost_usd).filter((x): x is number => x != null);
  const lat = all.filter((s) => s.purpose !== 'accuracy' && s.ok && s.latency_ms != null).map((s) => s.latency_ms!);
  const fails = acc.filter((s) => s.failure && s.failure !== 'unreadable');
  const count = (f: string) => fails.filter((s) => s.failure === f).length;
  const breakdown = (key: (s: CaptureScore) => string[]) => {
    const groups = new Map<string, CaptureScore[]>();
    for (const s of acc) for (const g of key(s)) groups.set(g, [...(groups.get(g) ?? []), s]);
    const out: Record<string, Record<string, Rate>> = {};
    for (const [g, list] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
      const c = sum(list);
      out[g] = Object.fromEntries(BREAKDOWN_KEYS.filter((k) => c[k]).map((k) => [k, rate(c[k])]));
    }
    return out;
  };
  const corr = counters.corrections;
  return {
    captures: new Set(acc.map((s) => s.id)).size,
    records: acc.length,
    metrics,
    confidence: {
      tau,
      autosave_precision: round(t.precision),
      autosave_coverage: round(t.coverage),
      ece: round(ece(points)),
      min_tau_precision_98: minTauFor(points, 0.98),
      isotonic_dev: devPoints.length ? isotonic(devPoints) : null,
    },
    cost: {
      mean_per_capture_usd: costs.length ? round(costs.reduce((a, b) => a + b, 0) / costs.length, 6) : null,
      total_usd: costs.length ? round(costs.reduce((a, b) => a + b, 0), 6) : null,
    },
    latency: { n: lat.length, p50_ms: percentile(lat, 0.5), p95_ms: percentile(lat, 0.95) },
    failures: {
      rate: acc.length ? round(fails.filter((s) => ['refusal', 'schema', 'timeout'].includes(s.failure!)).length / acc.length) : null,
      refusal: count('refusal'),
      schema: count('schema'),
      timeout: count('timeout'),
      unsupported: count('unsupported'),
      other: count('other'),
      n: acc.length,
    },
    pii_leaks: acc.reduce((s, x) => s + x.pii_leaks, 0),
    mean_corrections: corr && corr.d ? round(corr.n / corr.d, 2) : null,
    by_store_category: breakdown((s) => [s.store_category]),
    by_condition: breakdown((s) => s.conditions),
  };
}

function criterionValue(k: KindReport, key: string): number | null {
  if (key === 'autosave_precision') return k.confidence.autosave_precision;
  if (key === 'autosave_coverage') return k.confidence.autosave_coverage;
  if (key === 'pii_leaks') return k.pii_leaks;
  if (key === 'failure_rate') return k.failures.rate;
  return k.metrics[key]?.rate ?? null;
}

export interface Check {
  label: string;
  value: number | null;
  min?: number;
  max?: number;
  pass: boolean;
}

export interface KindDecision {
  checks: Record<string, Record<string, Check>>;
  passing: string[];
  chosen: string | null;
  reason: string;
  risk: string | null;
}

/** §4.8: lolos semua batas → biaya per capture terendah; selisih "sempurna" < 1 poin → vision. */
export function decide(kind: (typeof KINDS)[number], perArm: Record<string, KindReport | undefined>): KindDecision {
  const crit = kind === 'receipt' ? CRITERIA.receipt : CRITERIA.observation;
  const checks: KindDecision['checks'] = {};
  const passing: string[] = [];
  for (const [arm, k] of Object.entries(perArm)) {
    if (!k || !k.records) continue;
    const c: Record<string, Check> = {};
    let all = true;
    for (const cr of crit) {
      const value = criterionValue(k, cr.key);
      const pass = value !== null && ('min' in cr ? value >= cr.min : value <= cr.max);
      c[cr.key] = { label: cr.label, value, ...('min' in cr ? { min: cr.min } : { max: cr.max }), pass };
      if (!pass) all = false;
    }
    checks[arm] = c;
    if (all) passing.push(arm);
  }
  const cost = (a: string) => perArm[a]?.cost.mean_per_capture_usd ?? Infinity;
  const perfect = (a: string) => perArm[a]?.metrics.perfect?.rate ?? 0;
  const isVision = (a: string) => ARMS.find((x) => x.id === a)?.engine === 'vision';
  if (passing.length) {
    const cheapest = [...passing].sort((a, b) => cost(a) - cost(b))[0]!;
    if (!isVision(cheapest)) {
      // §4.8 no. 3: arm vision yang selisih "struk sempurna" < 1 poin → vision (satu vendor).
      const vision = passing.filter((a) => isVision(a) && Math.abs(perfect(a) - perfect(cheapest)) < TIE_POINTS).sort((a, b) => cost(a) - cost(b));
      if (vision.length) {
        return { checks, passing, chosen: vision[0]!, reason: `lolos semua batas; selisih "sempurna" < 1 poin dengan ${cheapest} → vision (§4.8 no. 3)`, risk: null };
      }
    }
    return { checks, passing, chosen: cheapest, reason: 'lolos semua batas dan biaya per capture terendah (§4.8 no. 2)', risk: null };
  }
  // §4.8 no. 5: tidak ada yang lolos → presisi auto-save tertinggi; τ dinaikkan sampai presisi ≥ 98 %.
  const ranked = Object.entries(perArm)
    .filter(([, k]) => k && k.records)
    .sort(([, a], [, b]) => (b!.confidence.autosave_precision ?? -1) - (a!.confidence.autosave_precision ?? -1));
  if (!ranked.length) return { checks, passing, chosen: null, reason: 'tidak ada data', risk: null };
  const [arm, k] = ranked[0]!;
  return {
    checks,
    passing,
    chosen: arm,
    reason: 'tidak ada arm yang lolos: presisi auto-save tertinggi (§4.8 no. 5)',
    risk: `τ dinaikkan ke ${k!.confidence.min_tau_precision_98 ?? 'tidak tercapai'} supaya presisi ≥ 98 %; catat sebagai risiko.`,
  };
}

export interface Report {
  schema: string;
  generated_at: string;
  prompt_version: string;
  pricing_as_of: string;
  split: string;
  synthetic: boolean;
  data: { verified_truths: number; by_kind: Record<string, number>; by_store_category: Record<string, number> };
  arms: Record<string, { model: string; engine: string; kinds: Partial<Record<(typeof KINDS)[number], KindReport>>; stability_diff: Rate }>;
  decision: Record<(typeof KINDS)[number], KindDecision>;
  q34_member_regex: { recall: number | null; n: number; recommendation: string };
  q122_streaming: { p95_receipt_ms: number | null; arm: string | null; recommendation: string };
  prefill_bias: { arm: string | null; error_blind: number | null; error_prefilled: number | null; diff_points: number | null; recommendation: string };
  spend_total_usd: number | null;
}

export function buildReport(
  scores: CaptureScore[],
  truths: Truth[],
  opts: { split: 'test' | 'dev' | 'all'; tau?: number; now?: Date; spendTotalUsd?: number | null; prefillArm?: string | null },
): Report {
  const tau = opts.tau ?? DEFAULT_TAU;
  const inSplit = (s: CaptureScore) => opts.split === 'all' || s.split === opts.split;
  const verified = truths.filter((t) => t.verified && (opts.split === 'all' || t.split === opts.split));
  const arms: Report['arms'] = {};
  const stab = stability(scores.filter(inSplit));
  for (const arm of ARMS) {
    const mine = scores.filter((s) => s.arm === arm.id);
    if (!mine.length) continue;
    const kinds: Report['arms'][string]['kinds'] = {};
    for (const kind of KINDS) {
      const k = mine.filter((s) => s.kind === kind);
      const test = k.filter(inSplit);
      if (test.length) kinds[kind] = kindReport(test, k.filter((s) => s.split === 'dev'), tau);
    }
    arms[arm.id] = { model: arm.model, engine: arm.engine, kinds, stability_diff: rate(stab.get(arm.id)) };
  }
  const decision = Object.fromEntries(
    KINDS.map((kind) => [kind, decide(kind, Object.fromEntries(Object.entries(arms).map(([a, r]) => [a, r.kinds[kind]])))]),
  ) as Report['decision'];

  // Q-34/Q-110: recall regex D-74 pada diskon member asli, dari arm yang dipilih untuk struk (atau semua).
  const chosen = decision.receipt.chosen;
  const memberSrc = chosen ? arms[chosen]?.kinds.receipt : undefined;
  const reg = memberSrc?.metrics['member.regex_recall'];
  const q34 = {
    recall: reg?.rate ?? null,
    n: reg?.d ?? 0,
    recommendation:
      reg?.rate == null
        ? 'Belum ada data diskon member di split ini.'
        : reg.rate >= MEMBER_REGEX_MIN_RECALL
          ? 'Regex D-74 cukup (recall ≥ 95 %): kolom receipt_line.is_member_discount tidak dibuat (Q-110).'
          : 'Regex D-74 < 95 %: buat kolom receipt_line.is_member_discount (§11.1 #7), regex jadi cadangan (Q-110).',
  };
  const p95 = chosen ? (arms[chosen]?.kinds.receipt?.latency.p95_ms ?? null) : null;
  const q122 = {
    p95_receipt_ms: p95,
    arm: chosen,
    recommendation:
      p95 == null
        ? 'Latensi belum diukur (jalankan mode realtime/both).'
        : p95 > STREAMING_P95_MS
          ? 'p95 struk > 60 dtk: ekstraksi pakai streaming + timeout per panggilan dinaikkan, tenggat lease tetap (D-93).'
          : 'p95 struk ≤ 60 dtk: tetap tanpa streaming (D-93).',
  };
  // §4.2: error arm pra-isi pada capture tanpa pra-isi vs dengan pra-isi (bias anotator).
  const pa = opts.prefillArm ?? null;
  const errOf = (list: CaptureScore[]) => {
    const c = sum(list);
    let n = 0;
    let d = 0;
    for (const [k, v] of Object.entries(c)) {
      if (k === 'corrections' || k === 'perfect') continue;
      n += v.d - v.n;
      d += v.d;
    }
    return d ? n / d : null;
  };
  const pScores = pa ? scores.filter((s) => s.arm === pa && countsForAccuracy(s.purpose)) : [];
  const blind = errOf(pScores.filter((s) => s.prefilled === false));
  const pref = errOf(pScores.filter((s) => s.prefilled === true));
  const diff = blind !== null && pref !== null ? blind - pref : null;
  const prefill = {
    arm: pa,
    error_blind: round(blind),
    error_prefilled: round(pref),
    diff_points: round(diff),
    recommendation:
      diff === null
        ? 'Belum bisa diukur (butuh capture tanpa pra-isi dan dengan pra-isi).'
        : diff > PREFILL_BIAS_POINTS
          ? 'Error arm pra-isi lebih rendah > 1 poin pada capture yang dipra-isi: periksa ulang semua struk tanpa pra-isi (§4.2).'
          : 'Tidak ada tanda bias pra-isi (≤ 1 poin).',
  };

  const byKind: Record<string, number> = {};
  const byCat: Record<string, number> = {};
  for (const t of verified) {
    byKind[t.kind] = (byKind[t.kind] ?? 0) + 1;
    byCat[t.store_category] = (byCat[t.store_category] ?? 0) + 1;
  }
  return {
    schema: REPORT_SCHEMA,
    generated_at: (opts.now ?? new Date()).toISOString(),
    prompt_version: PROMPT_VERSION,
    pricing_as_of: PRICING_AS_OF,
    split: opts.split,
    synthetic: verified.length > 0 && verified.every((t) => t.synthetic),
    data: { verified_truths: verified.length, by_kind: byKind, by_store_category: byCat },
    arms,
    decision,
    q34_member_regex: q34,
    q122_streaming: q122,
    prefill_bias: prefill,
    spend_total_usd: opts.spendTotalUsd ?? null,
  };
}

// ---------------------------------------------------------------------------- markdown

const pct = (x: number | null | undefined) => (x == null ? '—' : `${(x * 100).toFixed(1)} %`);
const usd = (x: number | null | undefined) => (x == null ? '—' : `US$${x.toFixed(4)}`);
const sec = (x: number | null | undefined) => (x == null ? '—' : `${(x / 1000).toFixed(1)} dtk`);
const KIND_LABEL = { receipt: 'Struk', price_label: 'Label', marketplace: 'Screenshot' } as const;

export function reportMarkdown(r: Report): string {
  const L: string[] = [];
  L.push(`# Laporan uji OCR (D-16) — agregat`, '');
  L.push(`Split **${r.split}** · prompt ${r.prompt_version} · harga per ${r.pricing_as_of} · ${r.data.verified_truths} ground truth terverifikasi${r.synthetic ? ' · **DATA SINTETIS (bukan keputusan D-16)**' : ''}`, '');
  L.push(`Komposisi: ${Object.entries(r.data.by_kind).map(([k, n]) => `${KIND_LABEL[k as keyof typeof KIND_LABEL] ?? k} ${n}`).join(', ') || '—'}; kategori toko: ${Object.entries(r.data.by_store_category).map(([k, n]) => `${k} ${n}`).join(', ') || '—'}.`, '');
  for (const kind of KINDS) {
    const rows = Object.entries(r.arms).filter(([, a]) => a.kinds[kind]);
    if (!rows.length) continue;
    L.push(`## ${KIND_LABEL[kind]}`, '');
    if (kind === 'receipt') {
      L.push('| Arm | Sempurna | Toko | Tanggal | Total | Recall baris | Nominal baris | Teks (CER ≤ 0,1) | Presisi @τ | Coverage @τ | τ min 98 % | ECE | Koreksi/struk | Σ = total | Gagal | Bocor PII | Biaya/struk | p50 | p95 |');
      L.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
      for (const [arm, a] of rows) {
        const k = a.kinds[kind]!;
        const m = k.metrics;
        L.push(`| ${arm} | ${pct(m.perfect?.rate)} | ${pct(m.store?.rate)} | ${pct(m.date?.rate)} | ${pct(m.total?.rate)} | ${pct(m['line.recall']?.rate)} | ${pct(m['line.amount']?.rate)} | ${pct(m['line.text']?.rate)} | ${pct(k.confidence.autosave_precision)} | ${pct(k.confidence.autosave_coverage)} | ${k.confidence.min_tau_precision_98 ?? '—'} | ${k.confidence.ece?.toFixed(3) ?? '—'} | ${k.mean_corrections ?? '—'} | ${pct(m.sum_equals_total?.rate)} | ${pct(k.failures.rate)} | ${k.pii_leaks} | ${usd(k.cost.mean_per_capture_usd)} | ${sec(k.latency.p50_ms)} | ${sec(k.latency.p95_ms)} |`);
      }
      L.push('');
      L.push('| Arm | Diskon | Void | Non-produk | Timbang | Member (recall) | Member (presisi) | Regex D-74 (recall) | Qty | Harga satuan | Stabilitas (field beda) |');
      L.push('|---|---|---|---|---|---|---|---|---|---|---|');
      for (const [arm, a] of rows) {
        const m = a.kinds[kind]!.metrics;
        L.push(`| ${arm} | ${pct(m['line.discount']?.rate)} | ${pct(m['line.void']?.rate)} | ${pct(m['line.non_product']?.rate)} | ${pct(m['line.weighed']?.rate)} | ${pct(m['member.recall']?.rate)} | ${pct(m['member.precision']?.rate)} | ${pct(m['member.regex_recall']?.rate)} | ${pct(m['line.quantity']?.rate)} | ${pct(m['line.unit']?.rate)} | ${pct(a.stability_diff.rate)} |`);
      }
    } else {
      L.push('| Arm | Sempurna | Harga | Normal | Promo | Member | Min qty | Periode | Program | Teks produk | Recall item | Presisi @τ | Gagal | Biaya | p50 | p95 |');
      L.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
      for (const [arm, a] of rows) {
        const k = a.kinds[kind]!;
        const m = k.metrics;
        L.push(`| ${arm} | ${pct(m.perfect?.rate)} | ${pct(m.price?.rate)} | ${pct(m['price.normal']?.rate)} | ${pct(m['price.promo']?.rate)} | ${pct(m['price.member']?.rate)} | ${pct(m.promo_min_qty?.rate)} | ${pct(m.promo_period?.rate)} | ${pct(m.member_program?.rate)} | ${pct(m['product.text']?.rate)} | ${pct(m['item.recall']?.rate)} | ${pct(k.confidence.autosave_precision)} | ${pct(k.failures.rate)} | ${usd(k.cost.mean_per_capture_usd)} | ${sec(k.latency.p50_ms)} | ${sec(k.latency.p95_ms)} |`);
      }
    }
    L.push('');
    const d = r.decision[kind];
    L.push(`**Keputusan §4.8 (${KIND_LABEL[kind].toLowerCase()}):** ${d.chosen ?? '—'} — ${d.reason}.${d.risk ? ` Risiko: ${d.risk}` : ''} Lolos: ${d.passing.join(', ') || 'tidak ada'}.`, '');
    const failed = Object.entries(d.checks).flatMap(([arm, cs]) =>
      Object.values(cs).filter((c) => !c.pass).map((c) => `${arm}: ${c.label} ${c.value === null ? '—' : c.value} (${c.min !== undefined ? `≥ ${c.min}` : `≤ ${c.max}`})`),
    );
    if (failed.length) L.push('Batas yang tidak lolos:', '', ...failed.map((f) => `- ${f}`), '');
  }
  L.push('## Per kategori toko dan kondisi (arm terpilih struk)', '');
  const ch = r.decision.receipt.chosen;
  const kr = ch ? r.arms[ch]?.kinds.receipt : undefined;
  if (kr) {
    for (const [title, table] of [['Kategori', kr.by_store_category], ['Kondisi', kr.by_condition]] as const) {
      L.push(`| ${title} | Sempurna | Nominal baris | Recall baris | Tanggal | Total |`, '|---|---|---|---|---|---|');
      for (const [g, m] of Object.entries(table)) L.push(`| ${g} | ${pct(m.perfect?.rate)} (${m.perfect?.d ?? 0}) | ${pct(m['line.amount']?.rate)} | ${pct(m['line.recall']?.rate)} | ${pct(m.date?.rate)} | ${pct(m.total?.rate)} |`);
      L.push('');
    }
  } else L.push('—', '');
  L.push('## Pertanyaan terbuka yang dijawab data', '');
  L.push(`- **Q-34/Q-110 (member):** recall regex D-74 ${pct(r.q34_member_regex.recall)} dari ${r.q34_member_regex.n} diskon member. ${r.q34_member_regex.recommendation}`);
  L.push(`- **Q-122 (streaming):** p95 struk ${sec(r.q122_streaming.p95_receipt_ms)} (${r.q122_streaming.arm ?? '—'}). ${r.q122_streaming.recommendation}`);
  L.push(`- **Bias pra-isi (§4.2):** error ${r.prefill_bias.arm ?? '—'} tanpa pra-isi ${pct(r.prefill_bias.error_blind)}, dengan pra-isi ${pct(r.prefill_bias.error_prefilled)}. ${r.prefill_bias.recommendation}`);
  L.push(`- **Biaya kumulatif uji:** ${r.spend_total_usd == null ? '— (tidak ada buku biaya; klien palsu tidak mencatat biaya)' : `${usd(r.spend_total_usd)} dari batas US$75`}.`, '');
  return `${L.join('\n')}\n`;
}

export function writeReport(dir: string, report: Report): { json: string; md: string } {
  const ts = report.generated_at.replace(/[-:]/g, '').replace(/\..+/, 'Z');
  const json = join(dir, 'reports', `${ts}.agg.json`);
  const md = join(dir, 'reports', `${ts}.md`);
  writeJson(json, report);
  writeFileSync(md, reportMarkdown(report));
  return { json, md };
}
