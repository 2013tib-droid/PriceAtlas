// ocr-eval (docs/08 §4): harness uji OCR D-16. LOKAL dan MANUAL, tidak pernah di CI.
//   pnpm --filter @priceatlas/worker ocr-eval init [--seed N]                     foto inbox → manifest + split
//   pnpm --filter @priceatlas/worker ocr-eval init --synthetic [--from-fixtures]  set sintetis (tanpa data asli)
//   pnpm --filter @priceatlas/worker ocr-eval annotate [--prefill <arm>] [--no-prefill-first 5] [--port 4317]
//   pnpm --filter @priceatlas/worker ocr-eval run --set dev|test|all --arms all|a,b [--repeat 2]
//        [--mode batch|realtime|latency] [--budget 75] [--client live|fake] [--resume <folder run>]
//   pnpm --filter @priceatlas/worker ocr-eval score                               skor per capture (tanpa teks)
//   pnpm --filter @priceatlas/worker ocr-eval report                              reports/<waktu>.md + .agg.json
// Env: OCR_EVAL_DIR (default .data/ocr-eval), ANTHROPIC_API_KEY (run live), GOOGLE_VISION_API_KEY (arm ocr).
// Pengaman: folder data di dalam repo wajib di-ignore git (F-117); buku biaya kumulatif + --budget.
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createClaudeClient } from '../src/ai/claude.ts';
import { GoogleVisionOcr } from '../src/extractors/ocr/google-vision.ts';
import { prepareImages } from '../src/images/prepare.ts';
import type { OcrEngine } from '../src/extractors/ocr-parse.ts';
import { ARMS, resolveArms } from './arms.ts';
import { ANNOTATE_PORT, startAnnotate } from './annotate/server.ts';
import { FakeEvalClient, FakeOcr, sha } from './fake.ts';
import { initFromInbox, initSynthetic } from './init.ts';
import { ensureDirs, evalPaths, type EvalPaths } from './paths.ts';
import { buildReport, latestRecords, toMarkdown, writeReport } from './report.ts';
import { Budget, DEFAULT_BUDGET_USD, collectBatch, runBatch, runDir, runRealtime, type BatchClient } from './run.ts';
import { scoreCapture } from './score.ts';
import { readManifest, readTruth, type ManifestEntry, type Truth } from './truth.ts';

export function parseArgs(argv: string[]): { cmd: string; flags: Record<string, string | true> } {
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

export const stamp = (d = new Date()) => d.toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');

/** Latensi realtime (§4.6): 10 struk + 5 label per arm dari split test. */
export function latencySubset(entries: ManifestEntry[]): ManifestEntry[] {
  const test = entries.filter((e) => e.split === 'test');
  return [...test.filter((e) => e.kind === 'receipt').slice(0, 10), ...test.filter((e) => e.kind === 'price_label').slice(0, 5)];
}

async function fakeDeps(paths: EvalPaths, entries: ManifestEntry[]): Promise<{ client: BatchClient; ocr: OcrEngine }> {
  const truths = new Map<string, Truth>();
  const byImage = new Map<string, string>();
  for (const e of entries) {
    const t = readTruth(paths, e.id);
    if (!t) throw new Error(`--client fake butuh ground truth untuk ${e.id}`);
    truths.set(e.id, t);
    const blobs = e.images.map((f, i) => ({ position: i + 1, storagePath: f, sha256: '', data: readFileSync(join(paths.images, f)) }));
    for (const p of await prepareImages(blobs)) byImage.set(sha(p.data.toString('base64')), e.id);
  }
  return {
    client: new FakeEvalClient(truths, byImage),
    ocr: new FakeOcr((img) => byImage.get(sha(img.data.toString('base64')))),
  };
}

/** Jenis klien (live/fake) dari run.json setiap run. */
export function runClients(paths: EvalPaths): string[] {
  if (!existsSync(paths.runs)) return [];
  const out = new Set<string>();
  for (const d of readdirSync(paths.runs)) {
    const f = join(paths.runs, d, 'run.json');
    if (existsSync(f)) out.add((JSON.parse(readFileSync(f, 'utf8')) as { client?: string }).client ?? '?');
  }
  return [...out].sort();
}

export async function main(argv = process.argv.slice(2), out: (s: string) => void = console.log): Promise<number> {
  const { cmd, flags } = parseArgs(argv);
  const paths = evalPaths(typeof flags.dir === 'string' ? flags.dir : undefined);
  const str = (k: string, d: string) => (typeof flags[k] === 'string' ? (flags[k] as string) : d);

  switch (cmd) {
    case 'init': {
      ensureDirs(paths);
      if (flags.synthetic) {
        const r = await initSynthetic(paths, { fromFixtures: !!flags['from-fixtures'], seed: Number(str('seed', '16')) });
        out(`Set sintetis: ${r.added} capture → ${paths.root}`);
      } else {
        const r = initFromInbox(paths, { seed: Number(str('seed', '16')) });
        out(`${r.added} capture baru dari ${paths.inbox} (total ${r.total}).`);
      }
      return 0;
    }
    case 'annotate': {
      ensureDirs(paths);
      const prefill = typeof flags.prefill === 'string' ? flags.prefill : null;
      if (prefill) resolveArms(prefill);
      const port = Number(str('port', String(ANNOTATE_PORT)));
      await startAnnotate(paths, { prefillArm: prefill, noPrefillFirst: Number(str('no-prefill-first', '5')) }, port);
      out(`Alat anotasi: http://localhost:${port} (Ctrl+C untuk berhenti). Hanya terbuka di mesin ini.`);
      if (prefill && !latestRecords(paths).some((r) => r.arm === prefill)) {
        out(`Belum ada run ${prefill}: jalankan dulu "ocr-eval run --set all --arms ${prefill} --repeat 1" untuk pra-isi.`);
      }
      await new Promise(() => {});
      return 0;
    }
    case 'run': {
      ensureDirs(paths);
      const set = str('set', 'test');
      const mode = str('mode', 'batch');
      const manifest = readManifest(paths);
      let entries = manifest.entries.filter((e) => set === 'all' || e.split === set);
      if (mode === 'latency') entries = latencySubset(manifest.entries);
      const arms = resolveArms(str('arms', 'all'));
      const repeat = mode === 'latency' ? 1 : Number(str('repeat', set === 'test' ? '2' : '1'));
      const live = str('client', 'live') === 'live';
      // Klien palsu punya buku biaya sendiri: biaya "palsu" tidak boleh memakan batas US$ sungguhan.
      const budget = new Budget(live ? paths.ledger : paths.ledger.replace(/\.json$/, '.fake.json'), Number(str('budget', String(DEFAULT_BUDGET_USD))));
      let client: BatchClient;
      let ocr: OcrEngine | undefined;
      if (live) {
        if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY wajib untuk --client live (atau pakai --client fake)');
        client = createClaudeClient() as unknown as BatchClient;
        if (arms.some((a) => a.source === 'ocr')) {
          const key = process.env.GOOGLE_VISION_API_KEY;
          if (!key) throw new Error('GOOGLE_VISION_API_KEY wajib untuk arm ocr-gcv+opus-low');
          ocr = new GoogleVisionOcr(key);
        }
      } else ({ client, ocr } = await fakeDeps(paths, entries));
      const label = typeof flags.resume === 'string' ? flags.resume : `${stamp()}-${mode}${live ? '' : '-fake'}`;
      const plan = { arms, entries, repeat, client, ocr, budget, label, pollMs: live ? 60_000 : 1, log: out };
      if (typeof flags.resume === 'string') {
        // Batch yang terputus (mis. laptop tidur): ambil hasil dari batch.json tanpa mengirim ulang.
        const recs = await collectBatch(paths, plan, join(paths.runs, label));
        out(`Dilanjutkan: ${recs.length} hasil.`);
        return 0;
      }
      writeFileSync(
        join(runDir(paths, label), 'run.json'),
        `${JSON.stringify({ set, mode, repeat, arms: arms.map((a) => a.name), client: live ? 'live' : 'fake', ids: entries.map((e) => e.id), started_at: new Date().toISOString() }, null, 2)}\n`,
      );
      const recs = mode === 'batch' ? await runBatch(paths, { ...plan, mode: 'batch' }) : await runRealtime(paths, { ...plan, mode: 'realtime' });
      const failed = recs.filter((r) => !r.ok).length;
      out(`Run ${label}: ${recs.length} hasil (${failed} gagal), biaya kumulatif US$${budget.spent.toFixed(4)} / batas US$${budget.limitUsd}.`);
      return 0;
    }
    case 'score': {
      const records = latestRecords(paths);
      const scores = records.flatMap((r) => {
        const t = readTruth(paths, r.id);
        return t && (t.verified || t.synthetic) ? [scoreCapture(t, r)] : [];
      });
      const file = join(paths.reports, `${stamp()}.scores.json`);
      // Per capture: id acak + hitungan, tanpa teks struk.
      writeFileSync(file, `${JSON.stringify(scores, null, 2)}\n`);
      out(`${scores.length} skor → ${file}`);
      return 0;
    }
    case 'report': {
      const r = buildReport(paths, { client: runClients(paths) });
      const files = writeReport(paths, r, stamp());
      out(toMarkdown(r));
      out(`Laporan: ${files.md}\nAgregat (boleh di-commit/dikirim): ${files.agg}`);
      return 0;
    }
    default:
      out(
        [
          'ocr-eval <perintah> (docs/08 §4)',
          '  init [--synthetic [--from-fixtures]] [--seed N]',
          '  annotate [--prefill <arm>] [--no-prefill-first 5] [--port 4317]',
          '  run --set dev|test|all --arms all|<arm,arm> [--repeat N] [--mode batch|realtime|latency] [--budget 75] [--client live|fake] [--resume <run>]',
          '  score',
          '  report',
          `Arm: ${ARMS.map((a) => a.name).join(', ')}`,
        ].join('\n'),
      );
      return cmd === 'help' ? 0 : 1;
  }
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  main().then(
    (code) => process.exit(code),
    (e) => {
      console.error(e instanceof Error ? e.message : e);
      process.exit(1);
    },
  );
}
