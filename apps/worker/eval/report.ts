// Laporan uji OCR (docs/08 §4.7, §4.8, Lampiran A). Dua keluaran:
//   reports/<waktu>.md          : tabel lengkap, untuk dibaca pemilik proyek (lokal).
//   reports/<waktu>.agg.json    : AGREGAT saja (angka per metrik/arm/jenis/kategori/kondisi), tanpa
//                                 teks struk, nama toko, atau id capture → satu-satunya yang boleh
//                                 di-commit / dikirim (§4.2, F-117).
import { readdirSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ARMS } from './arms.ts';
import type { EvalPaths } from './paths.ts';
import { readRecords } from './run.ts';
import {
  instability,
  observationCriteria,
  receiptCriteria,
  scoreCapture,
  summarize,
  type CaptureScore,
  type Criterion,
  type Group,
  type RunRecord,
} from './score.ts';
import { readManifest, readTruth, type Truth } from './truth.ts';

export interface ArmReport {
  arm: string;
  model: string;
  effort: string;
  source: string;
  test: Partial<Record<'receipt' | 'price_label' | 'marketplace' | 'observation', Group>>;
  dev: Partial<Record<'receipt' | 'observation', Group>>;
  receipt_by_category: Record<string, Group>;
  receipt_by_condition: Record<string, Group>;
  realtime: Group | null;
  criteria: { receipt: Criterion[]; observation: Criterion[]; receipt_pass: boolean; observation_pass: boolean };
}

export interface AggregateReport {
  version: 1;
  generated_at: string;
  synthetic: boolean;
  client: string[];
  prompt_versions: string[];
  sample: Record<string, Record<string, number>>;
  annotation: { truths: number; verified: number; prefilled: number; prefill_changed_fields_mean: number | null; no_prefill: number };
  arms: ArmReport[];
  decision: { receipt: Decision; observation: Decision };
}

export interface Decision {
  passing: string[];
  chosen: string | null;
  rule: string;
}

/** Semua run (semua folder), satu catatan terbaru per (mode, arm, id, ulangan). */
export function latestRecords(paths: EvalPaths): RunRecord[] {
  if (!existsSync(paths.runs)) return [];
  const dirs = readdirSync(paths.runs, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
  const map = new Map<string, RunRecord>();
  for (const d of dirs) for (const r of readRecords(join(paths.runs, d))) map.set(`${r.mode}:${r.arm}:${r.id}:${r.repeat}`, r);
  return [...map.values()];
}

export function buildReport(paths: EvalPaths, opts: { client?: string[]; requireVerified?: boolean } = {}): AggregateReport {
  const manifest = readManifest(paths);
  const truths = new Map<string, Truth>();
  let prefilled = 0;
  let noPrefill = 0;
  const changed: number[] = [];
  for (const e of manifest.entries) {
    const t = readTruth(paths, e.id);
    if (!t) continue;
    const usable = t.synthetic || t.verified || opts.requireVerified === false;
    if (!usable) continue;
    truths.set(e.id, t);
    if (t.verified?.prefill) {
      prefilled += 1;
      if (t.verified.prefill_changed_fields != null) changed.push(t.verified.prefill_changed_fields);
    } else if (t.verified) noPrefill += 1;
  }

  const records = latestRecords(paths).filter((r) => truths.has(r.id));
  const scores = records.map((r) => scoreCapture(truths.get(r.id)!, r));

  const sample: AggregateReport['sample'] = {};
  for (const t of truths.values()) {
    const k = `${t.kind}/${t.split}`;
    sample[k] ??= {};
    const cat = t.store_category ?? 'tanpa_kategori';
    sample[k]![cat] = (sample[k]![cat] ?? 0) + 1;
  }

  const armNames = [...new Set(records.map((r) => r.arm))].sort((a, b) => ARMS.findIndex((x) => x.name === a) - ARMS.findIndex((x) => x.name === b));
  const arms = armNames.map((name) => armReport(name, scores, records));

  return {
    version: 1,
    generated_at: new Date().toISOString(),
    // Klien palsu juga membuat angka tidak sah untuk D-16.
    synthetic: [...truths.values()].every((t) => t.synthetic) || (opts.client ?? []).includes('fake'),
    client: opts.client ?? [],
    prompt_versions: [...new Set(records.map((r) => r.prompt_version).filter((v): v is string => !!v))].sort(),
    sample,
    annotation: {
      truths: manifest.entries.length,
      verified: [...truths.values()].filter((t) => t.verified).length,
      prefilled,
      prefill_changed_fields_mean: changed.length ? changed.reduce((a, b) => a + b, 0) / changed.length : null,
      no_prefill: noPrefill,
    },
    arms,
    decision: { receipt: decide(arms, 'receipt'), observation: decide(arms, 'observation') },
  };
}

function instab(records: RunRecord[]): [number, number] {
  const by = new Map<string, RunRecord[]>();
  for (const r of records) {
    const k = `${r.mode}:${r.arm}:${r.id}`;
    by.set(k, [...(by.get(k) ?? []), r]);
  }
  let d = 0;
  let n = 0;
  for (const rs of by.values()) {
    const ok = rs.filter((r) => r.ok).sort((a, b) => a.repeat - b.repeat);
    if (ok.length < 2) continue;
    const [x, y] = instability(ok[0]!, ok[1]!);
    d += x;
    n += y;
  }
  return [d, n];
}

function armReport(name: string, all: CaptureScore[], records: RunRecord[]): ArmReport {
  const arm = ARMS.find((a) => a.name === name);
  const mine = all.filter((s) => s.arm === name);
  // Akurasi dari batch jika ada (mode utama §4.6), selain itu realtime.
  const accMode = mine.some((s) => s.mode === 'batch') ? 'batch' : 'realtime';
  const acc = mine.filter((s) => s.mode === accMode);
  const recs = records.filter((r) => r.arm === name && r.mode === accMode);
  const pick = (split: string, kinds: string[]) => acc.filter((s) => s.split === split && kinds.includes(s.kind));
  const recsOf = (split: string, kinds: string[]) => {
    const ids = new Set(pick(split, kinds).map((s) => s.id));
    return recs.filter((r) => ids.has(r.id));
  };
  const group = (split: string, kinds: string[]) => (pick(split, kinds).length ? summarize(pick(split, kinds), instab(recsOf(split, kinds))) : undefined);

  const test: ArmReport['test'] = {};
  for (const [k, kinds] of [
    ['receipt', ['receipt']],
    ['price_label', ['price_label']],
    ['marketplace', ['marketplace']],
    ['observation', ['price_label', 'marketplace']],
  ] as const) {
    const g = group('test', [...kinds]);
    if (g) test[k] = g;
  }
  const dev: ArmReport['dev'] = {};
  const dr = group('dev', ['receipt']);
  if (dr) dev.receipt = dr;
  const dob = group('dev', ['price_label', 'marketplace']);
  if (dob) dev.observation = dob;

  const testReceipts = pick('test', ['receipt']);
  const byKey = (keyOf: (s: CaptureScore) => string[]) => {
    const m: Record<string, CaptureScore[]> = {};
    for (const s of testReceipts) for (const k of keyOf(s)) (m[k] ??= []).push(s);
    return Object.fromEntries(Object.entries(m).sort().map(([k, v]) => [k, summarize(v)]));
  };
  const rt = mine.filter((s) => s.mode === 'realtime');
  const rc = test.receipt ? receiptCriteria(test.receipt) : [];
  const oc = test.observation ? observationCriteria(test.observation) : [];
  return {
    arm: name,
    model: arm?.model ?? '?',
    effort: arm?.effort ?? '?',
    source: arm?.source ?? '?',
    test,
    dev,
    receipt_by_category: byKey((s) => [s.store_category ?? 'tanpa_kategori']),
    receipt_by_condition: byKey((s) => (s.conditions.length ? s.conditions : ['normal'])),
    realtime: rt.length ? summarize(rt) : null,
    criteria: { receipt: rc, observation: oc, receipt_pass: rc.length > 0 && rc.every((c) => c.pass), observation_pass: oc.length > 0 && oc.every((c) => c.pass) },
  };
}

/** §4.8 butir 2–5. Keputusan model tetap milik pemilik proyek (Q-102); ini hanya usulan dari angka. */
export function decide(arms: ArmReport[], which: 'receipt' | 'observation'): Decision {
  const g = (a: ArmReport) => a.test[which];
  const passing = arms.filter((a) => (which === 'receipt' ? a.criteria.receipt_pass : a.criteria.observation_pass));
  const cost = (a: ArmReport) => g(a)?.cost_usd_mean ?? Infinity;
  if (passing.length) {
    const sorted = [...passing].sort((a, b) => cost(a) - cost(b));
    let chosen = sorted[0]!;
    let rule = '§4.8.2 lolos batas minimum, biaya per capture terendah';
    if (which === 'receipt' && chosen.source !== 'vision') {
      const perfect = (a: ArmReport) => g(a)?.rates['receipt.perfect']?.rate ?? 0;
      const vision = sorted.find((a) => a.source === 'vision' && Math.abs(perfect(a) - perfect(chosen)) < 0.01);
      if (vision) {
        chosen = vision;
        rule = '§4.8.3 selisih "struk sempurna" < 1 poin → vision';
      }
    }
    return { passing: passing.map((a) => a.arm), chosen: chosen.arm, rule };
  }
  const prec = (a: ArmReport) => g(a)?.auto_save.at_tau.at(-1)?.precision ?? -1;
  const best = [...arms].filter((a) => g(a)).sort((a, b) => prec(b) - prec(a))[0];
  return {
    passing: [],
    chosen: best?.arm ?? null,
    rule: '§4.8.5 tidak ada yang lolos: presisi auto-save tertinggi, τ dinaikkan sampai ≥ 98 % (dicatat sebagai risiko)',
  };
}

// ------------------------------------------------------------------ markdown

const pct = (v: number | null | undefined) => (v == null ? '—' : `${(v * 100).toFixed(1)} %`);
const usd = (v: number | null | undefined) => (v == null ? '—' : `$${v.toFixed(4)}`);
const ms = (v: number | null | undefined) => (v == null ? '—' : `${Math.round(v)} ms`);

const RECEIPT_ROWS: [string, string][] = [
  ['header.store', 'Toko'], ['header.branch', 'Cabang'], ['header.date', 'Tanggal'], ['header.time', 'Jam'], ['header.total', 'Total'],
  ['header.payment', 'Metode bayar'], ['lines.recall', 'Recall baris produk'], ['lines.precision', 'Presisi baris produk'],
  ['lines.amount', 'Nominal baris'], ['lines.quantity', 'Kuantitas'], ['lines.unit', 'Harga satuan'], ['lines.text', 'Teks item (CER ≤ 0,1)'],
  ['lines.type', 'line_type'], ['lines.discount', 'Diskon + menempel benar'], ['lines.void', 'Void'], ['lines.non_product', 'Non-produk'],
  ['lines.weighed', 'Item timbang'], ['member.converter_recall', 'Member (konverter) recall'], ['member.converter_precision', 'Member (konverter) presisi'],
  ['member.regex_recall', 'Member (regex D-74) recall'], ['member.regex_precision', 'Member (regex D-74) presisi'],
  ['receipt.perfect', 'Struk sempurna'], ['receipt.sum_total', 'Σ baris = total'], ['pii.recall', 'PII tertangkap'],
  ['ops.failure', 'Kegagalan (refusal+skema+timeout)'], ['ops.read_failure', 'Gagal baca (buram/bukan struk)'], ['unreadable.rejected', 'Gambar tak terbaca ditolak'],
];
const OBS_ROWS: [string, string][] = [
  ['obs.price', 'Harga (semua)'], ['obs.normal_price', 'Harga normal'], ['obs.promo_price', 'Harga promo'], ['obs.member_price', 'Harga member'],
  ['obs.promo_min_qty', 'Min. qty promo'], ['obs.period', 'Periode promo'], ['obs.program', 'Program member'], ['obs.shipping', 'Ongkir'],
  ['obs.seller', 'Seller'], ['obs.product', 'Produk (CER ≤ 0,1)'], ['obs.item_recall', 'Recall item'], ['obs.item_precision', 'Presisi item'],
  ['obs.image_position', 'image_position'], ['ops.failure', 'Kegagalan'],
];

function table(arms: ArmReport[], get: (a: ArmReport) => Group | undefined, rows: [string, string][]): string {
  const head = `| Metrik | ${arms.map((a) => a.arm).join(' | ')} |\n|---|${arms.map(() => '---:').join('|')}|`;
  const body = rows
    .filter(([k]) => arms.some((a) => get(a)?.rates[k]))
    .map(([k, label]) => `| ${label} | ${arms.map((a) => (get(a)?.rates[k] ? `${pct(get(a)!.rates[k]!.rate)} (${get(a)!.rates[k]!.total})` : '—')).join(' | ')} |`);
  const extra = [
    `| PII bocor setelah redaksi (jumlah) | ${arms.map((a) => String(get(a)?.rates['pii.leak']?.hit ?? '—')).join(' | ')} |`,
    `| τ untuk presisi ≥ 98 % | ${arms.map((a) => (get(a)?.auto_save.tau_98 ? get(a)!.auto_save.tau_98!.tau.toFixed(2) : '—')).join(' | ')} |`,
    `| Coverage @τ | ${arms.map((a) => pct(get(a)?.auto_save.tau_98?.coverage)).join(' | ')} |`,
    `| ECE | ${arms.map((a) => (get(a)?.auto_save.ece == null ? '—' : get(a)!.auto_save.ece!.toFixed(3))).join(' | ')} |`,
    `| Koreksi user / capture | ${arms.map((a) => (get(a)?.corrections_mean == null ? '—' : get(a)!.corrections_mean!.toFixed(2))).join(' | ')} |`,
    `| Biaya / capture | ${arms.map((a) => usd(get(a)?.cost_usd_mean)).join(' | ')} |`,
    `| Ketidakstabilan antar-ulangan | ${arms.map((a) => pct(get(a)?.instability.rate)).join(' | ')} |`,
  ];
  return [head, ...body, ...extra].join('\n');
}

export function toMarkdown(r: AggregateReport): string {
  const arms = r.arms;
  const out: string[] = [];
  out.push(`# Laporan uji OCR (D-16) — ${r.generated_at}`);
  if (r.synthetic) out.push('\n> **Data sintetis** (dan/atau klien palsu). Angka ini menguji harness, BUKAN hasil uji D-16.');
  out.push(`\nKlien: ${r.client.join(', ') || '—'} · Prompt: ${r.prompt_versions.join(', ') || '—'}`);
  out.push('\n## Sampel\n');
  out.push('| Jenis/split | Kategori | Jumlah |\n|---|---|---:|');
  for (const [k, cats] of Object.entries(r.sample).sort()) for (const [c, n] of Object.entries(cats)) out.push(`| ${k} | ${c} | ${n} |`);
  out.push(
    `\nAnotasi: ${r.annotation.verified}/${r.annotation.truths} diverifikasi · pra-isi ${r.annotation.prefilled} (rata-rata field diubah ${r.annotation.prefill_changed_fields_mean?.toFixed(2) ?? '—'}) · tanpa pra-isi ${r.annotation.no_prefill}`,
  );
  out.push('\n## Struk (split test)\n');
  out.push(table(arms, (a) => a.test.receipt, RECEIPT_ROWS));
  out.push('\n### Presisi/coverage auto-save per τ (struk, test)\n');
  out.push(`| τ | ${arms.map((a) => a.arm).join(' | ')} |\n|---|${arms.map(() => '---').join('|')}|`);
  for (let i = 0; i < 5; i++) {
    const tau = arms.find((a) => a.test.receipt)?.test.receipt?.auto_save.at_tau[i]?.tau;
    if (tau == null) break;
    out.push(`| ${tau.toFixed(2)} | ${arms.map((a) => { const x = a.test.receipt?.auto_save.at_tau[i]; return x ? `${pct(x.precision)} / ${pct(x.coverage)}` : '—'; }).join(' | ')} |`);
  }
  out.push('\n## Label + screenshot (split test)\n');
  out.push(table(arms, (a) => a.test.observation, OBS_ROWS));
  out.push('\n## Latensi realtime\n');
  out.push(`| Arm | n | p50 | p95 |\n|---|---:|---:|---:|`);
  for (const a of arms) out.push(`| ${a.arm} | ${a.realtime?.latency_ms.n ?? 0} | ${ms(a.realtime?.latency_ms.p50)} | ${ms(a.realtime?.latency_ms.p95)} |`);
  out.push('\n## Struk per kategori toko dan kondisi (test, "struk sempurna" / nominal)\n');
  const keys = [...new Set(arms.flatMap((a) => [...Object.keys(a.receipt_by_category).map((k) => `kategori:${k}`), ...Object.keys(a.receipt_by_condition).map((k) => `kondisi:${k}`)]))].sort();
  out.push(`| Kelompok | ${arms.map((a) => a.arm).join(' | ')} |\n|---|${arms.map(() => '---').join('|')}|`);
  for (const k of keys) {
    const [type, name] = k.split(':') as ['kategori' | 'kondisi', string];
    out.push(`| ${k} | ${arms.map((a) => { const g = (type === 'kategori' ? a.receipt_by_category : a.receipt_by_condition)[name]; return g ? `${pct(g.rates['receipt.perfect']?.rate)} / ${pct(g.rates['lines.amount']?.rate)}` : '—'; }).join(' | ')} |`);
  }
  out.push('\n## Kriteria §4.8\n');
  for (const a of arms) {
    out.push(`### ${a.arm} (${a.model}, effort ${a.effort})\n`);
    for (const c of [...a.criteria.receipt.map((x) => ({ ...x, name: `struk: ${x.name}` })), ...a.criteria.observation.map((x) => ({ ...x, name: `label/screenshot: ${x.name}` }))]) {
      const v = c.name.includes('jumlah') ? String(c.value ?? '—') : pct(c.value);
      out.push(`- ${c.pass ? '✅' : '❌'} ${c.name}: ${v} (${c.op} ${c.name.includes('jumlah') ? c.target : pct(c.target)})`);
    }
    out.push('');
  }
  out.push('## Usulan dari angka (keputusan tetap pemilik proyek, Q-102)\n');
  out.push(`- Struk: lolos = ${r.decision.receipt.passing.join(', ') || '—'} → **${r.decision.receipt.chosen ?? '—'}** (${r.decision.receipt.rule})`);
  out.push(`- Label/screenshot: lolos = ${r.decision.observation.passing.join(', ') || '—'} → **${r.decision.observation.chosen ?? '—'}** (${r.decision.observation.rule})`);
  return `${out.join('\n')}\n`;
}

export function writeReport(paths: EvalPaths, r: AggregateReport, stamp: string): { md: string; agg: string } {
  const md = join(paths.reports, `${stamp}.md`);
  const agg = join(paths.reports, `${stamp}.agg.json`);
  writeFileSync(md, toMarkdown(r));
  writeFileSync(agg, `${JSON.stringify(r, null, 2)}\n`);
  return { md, agg };
}
