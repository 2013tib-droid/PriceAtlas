// ocr-eval (docs/08 §3.2, §4.2, §4.6): harness uji OCR D-16. Dijalankan pemilik proyek di mesinnya
// (Q-105 → D-92); data asli tidak pernah masuk repo atau sesi cloud (F-117).
//   pnpm --filter @priceatlas/worker ocr-eval init [--seed N] [--synthetic DIR]
//   pnpm --filter @priceatlas/worker ocr-eval annotate [--prefill ARM] [--no-run] [--blind 5] [--port 4317]
//   pnpm --filter @priceatlas/worker ocr-eval run --set dev|test|all --arms all|a,b [--repeat 1]
//        [--mode both|batch|realtime] [--budget 75] [--ids a,b] [--client real|fake] [--poll 60]
//   pnpm --filter @priceatlas/worker ocr-eval score [--set test]
//   pnpm --filter @priceatlas/worker ocr-eval report [--set test] [--tau 0.9] [--prefill-arm vision-opus-medium]
// Env: OCR_EVAL_DIR (default <repo>/.data/ocr-eval), ANTHROPIC_API_KEY, GOOGLE_VISION_API_KEY (arm OCR).
import { join, resolve } from 'node:path';
import { createClaudeClient } from '../src/ai/claude.ts';
import { setLogSink } from '../src/log.ts';
import type { OcrEngine } from '../src/extractors/ocr-parse.ts';
import { GoogleVisionOcr } from '../src/extractors/ocr/google-vision.ts';
import { ANNOTATE_PORT, BLIND_RECEIPTS, blindIds, createAnnotateServer, latestOk, listen } from './annotate/server.ts';
import { armById, parseArms } from './arms.ts';
import { assertIgnored, dataDir, readAllTruths, readJson, readManifest, writeJson, type Split } from './data.ts';
import { FakeEvalClient, FakeOcr } from './fake-client.ts';
import { importSynthetic, initData } from './init.ts';
import { buildReport, writeReport } from './report.ts';
import {
  Budget,
  HARD_CAP_USD,
  latencySubset,
  readRecords,
  runBatch,
  runRealtime,
  selectCaptures,
  countsForAccuracy,
  type EvalClient,
  type RunOptions,
} from './run.ts';
import { scoreAll } from './score.ts';

export interface Args {
  cmd: string;
  flags: Record<string, string | true>;
}

export function parseArgs(argv: string[]): Args {
  const [cmd = 'help', ...rest] = argv;
  const flags: Record<string, string | true> = {};
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]!;
    if (!a.startsWith('--')) continue;
    const next = rest[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      flags[a.slice(2)] = next;
      i++;
    } else flags[a.slice(2)] = true;
  }
  return { cmd, flags };
}

const str = (f: Args['flags'], k: string, d?: string) => (typeof f[k] === 'string' ? (f[k] as string) : d);
const num = (f: Args['flags'], k: string, d: number) => {
  const v = str(f, k);
  if (v === undefined) return d;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`--${k} harus angka`);
  return n;
};

function setOf(f: Args['flags'], d: Split | 'all'): Split | 'all' {
  const s = str(f, 'set', d);
  if (s !== 'dev' && s !== 'test' && s !== 'all') throw new Error('--set harus dev, test, atau all');
  return s;
}

/** Klien sungguhan (kunci dari env) atau palsu (tanpa jaringan, laporan sintetis). */
async function clients(dir: string, f: Args['flags'], entries: ReturnType<typeof selectCaptures>, needOcr: boolean, env: NodeJS.ProcessEnv) {
  if (str(f, 'client', 'real') === 'fake') {
    const fake = await FakeEvalClient.create(dir, entries, readAllTruths(dir));
    return { client: fake as EvalClient, ocr: new FakeOcr(fake) as OcrEngine };
  }
  if (!env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY belum diisi (kunci "worker", docs/08 §15 no. 5). Atau --client fake untuk uji coba.');
  const client = createClaudeClient({ apiKey: env.ANTHROPIC_API_KEY }) as unknown as EvalClient;
  let ocr: OcrEngine | null = null;
  if (needOcr) {
    if (!env.GOOGLE_VISION_API_KEY) throw new Error('GOOGLE_VISION_API_KEY belum diisi untuk arm ocr-gcv+opus-low (docs/08 §15 no. 6).');
    ocr = new GoogleVisionOcr(env.GOOGLE_VISION_API_KEY);
  }
  return { client, ocr };
}

export async function main(argv: string[], env: NodeJS.ProcessEnv = process.env, out: (s: string) => void = console.log): Promise<number> {
  const { cmd, flags } = parseArgs(argv);
  if (cmd === 'help' || flags.help) {
    out('ocr-eval init | annotate | run | score | report  (docs/08 §4.2, docs/06 §2.9)');
    return 0;
  }
  const dir = dataDir(env);
  assertIgnored(dir); // F-117: sebelum membaca/menulis apa pun.
  // Log worker per gambar hanya dengan --verbose (log tidak pernah berisi teks/PII, §7.4).
  if (!flags.verbose) setLogSink((line) => (/"event":"(ai\.|worker\.)/.test(line) ? out(line) : undefined));

  if (cmd === 'init') {
    const synthetic = str(flags, 'synthetic');
    const r = synthetic
      ? importSynthetic(dir, synthetic, { seed: flags.seed ? num(flags, 'seed', 0) : undefined })
      : initData(dir, { seed: flags.seed ? num(flags, 'seed', 0) : undefined });
    out(`init: +${r.added} capture (${r.duplicates} sudah ada, ${r.skipped} file dilewati); total ${r.total} (dev ${r.bySplit.dev}, test ${r.bySplit.test}) → ${join(dir, 'manifest.json')}`);
    return 0;
  }

  if (cmd === 'run') {
    const set = setOf(flags, 'test');
    const ids = str(flags, 'ids')?.split(',');
    const entries = selectCaptures(dir, set, ids);
    const arms = parseArms(str(flags, 'arms', 'all'));
    const repeat = num(flags, 'repeat', 1);
    const mode = str(flags, 'mode', 'both');
    const fake = str(flags, 'client', 'real') === 'fake';
    const budget = new Budget(dir, num(flags, 'budget', HARD_CAP_USD), { persist: !fake });
    const { client, ocr } = await clients(dir, flags, entries, arms.some((a) => a.engine === 'ocr'), env);
    const opts: RunOptions = { dir, arms, entries, repeat, client, ocr, budget, pollSeconds: num(flags, 'poll', 60), log: out };
    out(`run: ${arms.length} arm × ${entries.length} capture × ${repeat} (${set}, ${mode}); sisa anggaran US$${budget.remaining().toFixed(2)}`);
    const results = [];
    if (mode === 'batch' || mode === 'both') results.push(await runBatch(opts));
    if (mode === 'realtime') results.push(await runRealtime(opts, 'both'));
    if (mode === 'both') results.push(await runRealtime({ ...opts, entries: latencySubset(entries), repeat: 1 }, 'latency'));
    for (const r of results) {
      out(`  ${r.records} catatan, ${r.failed} gagal, US$${r.costUsd.toFixed(4)}${r.stoppedByBudget ? ` — BERHENTI: ${r.stoppedByBudget}` : ''}`);
    }
    out(`biaya run ini US$${budget.spent.toFixed(4)}; kumulatif US$${budget.total.toFixed(4)} / ${HARD_CAP_USD}`);
    return results.some((r) => r.stoppedByBudget) ? 2 : 0;
  }

  if (cmd === 'annotate') {
    const prefill = str(flags, 'prefill') ?? null;
    if (prefill) armById(prefill);
    const blind = num(flags, 'blind', BLIND_RECEIPTS);
    if (prefill && !flags['no-run']) {
      // Pra-isi capture yang belum punya truth dan belum punya output arm itu (realtime, dengan anggaran).
      const m = readManifest(dir);
      const records = readRecords(dir);
      const skip = blindIds(m.captures, blind);
      const truths = new Set(readAllTruths(dir).map((t) => t.id));
      const missing = m.captures.filter((c) => !truths.has(c.id) && !skip.has(c.id) && !latestOk(records, prefill, c.id));
      if (missing.length) {
        const arm = armById(prefill);
        const budget = new Budget(dir, num(flags, 'budget', HARD_CAP_USD), { persist: str(flags, 'client', 'real') !== 'fake' });
        const { client, ocr } = await clients(dir, flags, missing, arm.engine === 'ocr', env);
        out(`pra-isi: ${missing.length} capture dengan ${arm.id}…`);
        const r = await runRealtime({ dir, arms: [arm], entries: missing, repeat: 1, client, ocr, budget, log: out }, 'prefill');
        out(`pra-isi selesai: ${r.records} catatan, US$${r.costUsd.toFixed(4)}`);
      }
    }
    const server = createAnnotateServer({ dir, prefillArm: prefill, blind });
    const port = await listen(server, num(flags, 'port', ANNOTATE_PORT));
    out(`Alat anotasi: http://localhost:${port}  (Ctrl+C untuk berhenti; ${blind} struk pertama tanpa pra-isi)`);
    await new Promise<void>((resolve) => {
      process.once('SIGINT', () => server.close(() => resolve()));
      if (flags['exit-after-listen']) server.close(() => resolve());
    });
    return 0;
  }

  if (cmd === 'score' || cmd === 'report') {
    const set = setOf(flags, 'test');
    const truths = readAllTruths(dir);
    const scores = scoreAll(truths, readRecords(dir));
    if (!scores.length) {
      out('Belum ada catatan run dengan ground truth terverifikasi. Jalankan annotate lalu run.');
      return 1;
    }
    if (cmd === 'score') {
      // Skor per capture (lokal, berisi id acak; TIDAK untuk dikirim): reports/<waktu>.scores.json.
      const path = join(dir, 'reports', `${new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, 'Z')}.scores.json`);
      writeJson(path, scores.map(({ fields: _f, ...s }) => s));
      const byArm = new Map<string, { n: number; ok: number }>();
      for (const s of scores.filter((x) => (set === 'all' || x.split === set) && countsForAccuracy(x.purpose))) {
        const c = byArm.get(s.arm) ?? { n: 0, ok: 0 };
        c.n++;
        if (s.counters.perfect?.n) c.ok++;
        byArm.set(s.arm, c);
      }
      for (const [arm, c] of byArm) out(`  ${arm}: ${c.ok}/${c.n} capture sempurna`);
      out(`skor → ${path}`);
      return 0;
    }
    const spend = (() => {
      try {
        return readJson<{ total_usd: number }>(join(dir, 'spend.json')).total_usd;
      } catch {
        return null;
      }
    })();
    const report = buildReport(scores, truths, { split: set, tau: num(flags, 'tau', 0.9), spendTotalUsd: spend, prefillArm: str(flags, 'prefill-arm', 'vision-opus-medium') });
    const paths = writeReport(dir, report);
    out(`laporan → ${paths.md}\nagregat (boleh dikirim/di-commit) → ${paths.json}`);
    for (const [kind, d] of Object.entries(report.decision)) out(`  ${kind}: ${d.chosen ?? '—'} (${d.reason})`);
    return 0;
  }

  out(`perintah tidak dikenal: ${cmd}`);
  return 1;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e: unknown) => {
      console.error(e instanceof Error ? e.message : e);
      process.exit(1);
    },
  );
}
