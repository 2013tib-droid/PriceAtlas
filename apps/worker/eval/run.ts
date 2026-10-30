// `ocr-eval run` (docs/08 §4.6): arm × capture × ulangan → runs/<waktu>-<arm>/<id>.r<n>.json.
//   * batch (Message Batches API, diskon 50 %, tanpa `fallbacks`, F-116): akurasi + biaya. custom_id =
//     `<arm.slug>__<id>__r<n>` (F-148: custom_id hanya huruf/angka/_/-, jadi bukan `<arm>:<id>:<n>`).
//   * realtime: panggilan biasa (dengan fallbacks, sama dengan produksi), latensi diukur dari
//     prepareImages sampai respons lengkap (§4.6). Mode `both` (default): batch untuk semua + subset
//     realtime 10 struk + 5 label + 5 screenshot per arm untuk latensi (Q-122/D-93: p95 struk > 60 dtk → streaming).
//   * Anggaran: batas keras kumulatif US$75 (§12.2) di spend.json + `--budget` per run. Sebelum setiap
//     panggilan/batch biaya diperkirakan (§12.1); jika melewati sisa anggaran, run berhenti.
// Kode extractor/konverter sama dengan worker (VisionExtractor, OcrThenParseExtractor, convert.ts).
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { BetaMessage, MessageCreateParamsNonStreaming } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import type { CaptureKind, ParsedOutput } from '@priceatlas/contracts';
import { BATCH_PRICE_FACTOR, priceOf } from '@priceatlas/ai-tools/pricing';
import { buildBatchParams, interpretMessage, type ClaudeClient, type StructuredRequest } from '../src/ai/claude.ts';
import type { LlmOutput } from '../src/extractors/llm-schema.ts';
import type { OcrEngine, OcrResult } from '../src/extractors/ocr-parse.ts';
import { OcrThenParseExtractor } from '../src/extractors/ocr-parse.ts';
import { GCV_PRICE_PER_IMAGE_USD } from '../src/extractors/ocr/google-vision.ts';
import type { ExtractInput } from '../src/extractors/vision.ts';
import { prepareImages } from '../src/images/prepare.ts';
import { PermanentError, TransientError, type ImageBlob, type RunOutput } from '../src/pipeline/types.ts';
import { buildExtractor, type Arm } from './arms.ts';
import { readJson, readManifest, writeJson, type ManifestEntry, type Split } from './data.ts';

/** Batas keras kumulatif uji OCR (docs/08 §12.2). */
export const HARD_CAP_USD = 75;
/** Subset realtime per arm untuk latensi (§4.6). */
export const LATENCY_SUBSET = { receipt: 10, price_label: 5, marketplace: 5 } as const;
/** Tenggat per capture = lease − 30 dtk (sama dengan worker, F-107). */
const DEADLINE_MS = 270_000;

export interface BatchApi {
  create(params: { requests: { custom_id: string; params: MessageCreateParamsNonStreaming }[] }): PromiseLike<{ id: string; processing_status: string }>;
  retrieve(id: string): PromiseLike<{ id: string; processing_status: string; request_counts?: Record<string, number> }>;
  results(id: string): PromiseLike<AsyncIterable<BatchResultLine>>;
}

export type BatchResultLine = {
  custom_id: string;
  result:
    | { type: 'succeeded'; message: BetaMessage }
    | { type: 'errored'; error: { type?: string; error?: { type?: string; message?: string } } }
    | { type: 'canceled' }
    | { type: 'expired' };
};

/** Klien yang dipakai harness: Messages (realtime) + Message Batches. Anthropic SDK memenuhi bentuk ini. */
export interface EvalClient extends ClaudeClient {
  beta: ClaudeClient['beta'] & { messages: ClaudeClient['beta']['messages'] & { batches: BatchApi } };
}

/** accuracy/both: dinilai akurasinya; latency/both/prefill: latensi realtime; prefill = pra-isi anotasi. */
export type Purpose = 'accuracy' | 'latency' | 'both' | 'prefill';

export function countsForAccuracy(p: Purpose): boolean {
  return p === 'accuracy' || p === 'both';
}

export interface RunRecord {
  id: string;
  kind: CaptureKind;
  arm: string;
  repeat: number;
  mode: 'realtime' | 'batch';
  purpose: Purpose;
  ok: boolean;
  error: { code: string; message: string; transient: boolean } | null;
  output: ParsedOutput | null;
  /** Transkripsi model / teks OCR vendor (berisi PII; tetap di folder data). */
  raw_text: string | null;
  llm: unknown;
  meta: Record<string, unknown> | null;
  input_tokens: number | null;
  output_tokens: number | null;
  /** Biaya yang benar-benar ditagih (batch = × BATCH_PRICE_FACTOR), termasuk OCR. */
  cost_usd: number | null;
  ocr_cost_usd: number | null;
  latency_ms: number | null;
  attempts: number;
  at: string;
}

// ---------------------------------------------------------------------------- anggaran

interface Ledger {
  hard_cap_usd: number;
  total_usd: number;
  entries: { at: string; run: string; arm: string; mode: string; cost_usd: number }[];
}

export class BudgetExceeded extends Error {
  override name = 'BudgetExceeded';
}

export class Budget {
  private ledger: Ledger;
  private spentThisRun = 0;

  /** `persist: false` (klien palsu): biaya tiruan tidak pernah masuk buku biaya uji sungguhan. */
  constructor(
    private readonly dir: string,
    readonly perRunUsd: number,
    private readonly opts: { persist?: boolean } = {},
  ) {
    const p = join(dir, 'spend.json');
    this.ledger = existsSync(p) ? readJson<Ledger>(p) : { hard_cap_usd: HARD_CAP_USD, total_usd: 0, entries: [] };
    if (opts.persist === false) this.ledger = { hard_cap_usd: HARD_CAP_USD, total_usd: 0, entries: [] };
  }

  get spent(): number {
    return this.spentThisRun;
  }

  get total(): number {
    return this.ledger.total_usd;
  }

  remaining(): number {
    return Math.max(0, Math.min(this.perRunUsd - this.spentThisRun, HARD_CAP_USD - this.ledger.total_usd));
  }

  /** Tolak sebelum memanggil jika perkiraan biaya melewati sisa anggaran. */
  check(estimateUsd: number, what: string): void {
    if (estimateUsd > this.remaining() + 1e-9) {
      throw new BudgetExceeded(
        `Anggaran habis untuk ${what}: perkiraan US$${estimateUsd.toFixed(4)} > sisa US$${this.remaining().toFixed(4)} ` +
          `(run ${this.spentThisRun.toFixed(4)}/${this.perRunUsd}, total ${this.ledger.total_usd.toFixed(4)}/${HARD_CAP_USD}).`,
      );
    }
  }

  charge(costUsd: number | null, entry: { run: string; arm: string; mode: string }): void {
    const c = costUsd ?? 0;
    if (c <= 0) return;
    this.spentThisRun += c;
    this.ledger.total_usd = Math.round((this.ledger.total_usd + c) * 1e6) / 1e6;
    this.ledger.entries.push({ at: new Date().toISOString(), ...entry, cost_usd: Math.round(c * 1e6) / 1e6 });
    if (this.opts.persist !== false) writeJson(join(this.dir, 'spend.json'), this.ledger);
  }
}

/** Perkiraan biaya satu capture (asumsi token §12.1), untuk cek anggaran sebelum memanggil. */
export function estimateCostUsd(arm: Arm, kind: CaptureKind, parts: number, mode: 'realtime' | 'batch'): number {
  const p = priceOf(arm.model);
  if (!p) return 0;
  const perImage = kind === 'receipt' ? 3800 : kind === 'price_label' ? 4200 : 2600;
  const inputTokens = 2500 + parts * (arm.engine === 'ocr' ? 1500 : perImage);
  const effort = kind === 'receipt' ? arm.effortReceipt : arm.effortObservation;
  const outputTokens = kind === 'receipt' ? (effort === 'low' ? 3400 : 4600) : 1400;
  const claude = ((inputTokens * p.input + outputTokens * p.output) / 1e6) * (mode === 'batch' ? BATCH_PRICE_FACTOR : 1);
  const ocr = arm.engine === 'ocr' ? parts * GCV_PRICE_PER_IMAGE_USD : 0;
  return claude + ocr;
}

// ---------------------------------------------------------------------------- input

export function loadImages(dir: string, entry: ManifestEntry): ImageBlob[] {
  return entry.images.map((file, i) => {
    const data = readFileSync(join(dir, 'images', file));
    return { position: i + 1, storagePath: file, sha256: createHash('sha256').update(data).digest('hex'), data };
  });
}

function extractInput(entry: ManifestEntry, images: ImageBlob[], attempt: number, signal?: AbortSignal): ExtractInput {
  return {
    kind: entry.kind,
    images,
    ctx: { captureId: entry.id, householdId: 'ocr-eval', attempt, uploadedAt: new Date(entry.uploaded_at), capturedAt: null, signal },
  };
}

export function selectCaptures(dir: string, set: Split | 'all', ids?: string[]): ManifestEntry[] {
  const m = readManifest(dir);
  return m.captures.filter((c) => (set === 'all' || c.split === set) && (!ids || ids.includes(c.id)));
}

/** Subset latensi: N pertama per jenis (urut manifest). */
export function latencySubset(entries: ManifestEntry[]): ManifestEntry[] {
  const count: Record<string, number> = {};
  return entries.filter((e) => {
    count[e.kind] = (count[e.kind] ?? 0) + 1;
    return count[e.kind]! <= LATENCY_SUBSET[e.kind];
  });
}

function stamp(d = new Date()): string {
  return d.toISOString().replace(/[-:]/g, '').replace(/\..+/, 'Z');
}

function recordPath(runDir: string, id: string, repeat: number): string {
  return join(runDir, `${id}.r${repeat}.json`);
}

function failure(
  base: Omit<RunRecord, 'ok' | 'error' | 'output' | 'raw_text' | 'llm' | 'meta' | 'input_tokens' | 'output_tokens' | 'cost_usd' | 'ocr_cost_usd'>,
  e: unknown,
  costFactor: number,
): RunRecord {
  const ro: RunOutput | undefined = e instanceof PermanentError || e instanceof TransientError ? e.runOutput : undefined;
  const raw = ro?.rawOutput as { llm?: unknown; meta?: Record<string, unknown> } | undefined;
  const code = e instanceof PermanentError ? e.code : e instanceof TransientError ? 'transient' : 'other';
  const claude = ro?.usage?.costUsd ?? null;
  return {
    ...base,
    ok: false,
    error: { code, message: e instanceof Error ? e.message : String(e), transient: e instanceof TransientError },
    output: null,
    raw_text: ro?.rawText ?? null,
    llm: raw?.llm ?? null,
    meta: raw?.meta ?? null,
    input_tokens: ro?.usage?.inputTokens ?? null,
    output_tokens: ro?.usage?.outputTokens ?? null,
    cost_usd: claude === null ? null : claude * costFactor,
    ocr_cost_usd: null,
  };
}

function success(
  base: Omit<RunRecord, 'ok' | 'error' | 'output' | 'raw_text' | 'llm' | 'meta' | 'input_tokens' | 'output_tokens' | 'cost_usd' | 'ocr_cost_usd'>,
  ex: Awaited<ReturnType<ReturnType<typeof buildExtractor>['extract']>>,
  claudeCostFactor: number,
  ocrCost: number | null,
): RunRecord {
  const raw = ex.rawOutput as { llm?: unknown; meta?: Record<string, unknown> } | undefined;
  const total = ex.usage?.costUsd ?? null;
  // OcrThenParseExtractor: usage.costUsd = Claude + OCR; diskon batch hanya untuk bagian Claude.
  const claude = total === null ? null : total - (ocrCost ?? 0);
  return {
    ...base,
    ok: true,
    error: null,
    output: ex.output,
    raw_text: ex.rawText ?? null,
    llm: raw?.llm ?? null,
    meta: raw?.meta ?? null,
    input_tokens: ex.usage?.inputTokens ?? null,
    output_tokens: ex.usage?.outputTokens ?? null,
    cost_usd: claude === null ? null : Math.round((claude * claudeCostFactor + (ocrCost ?? 0)) * 1e6) / 1e6,
    ocr_cost_usd: ocrCost,
  };
}

// ---------------------------------------------------------------------------- realtime

export interface RunOptions {
  dir: string;
  arms: Arm[];
  entries: ManifestEntry[];
  repeat: number;
  client: EvalClient;
  ocr?: OcrEngine | null;
  budget: Budget;
  purpose?: Purpose;
  /** Detik antar polling batch. */
  pollSeconds?: number;
  log?: (msg: string) => void;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
}

export interface RunSummary {
  runDirs: string[];
  records: number;
  failed: number;
  costUsd: number;
  stoppedByBudget: string | null;
}

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Satu capture realtime, dengan percobaan ulang seperti pipeline (D-70 dipersingkat; max_tokens → × 2). */
async function realtimeOne(
  arm: Arm,
  entry: ManifestEntry,
  images: ImageBlob[],
  opts: RunOptions,
  repeat: number,
  purpose: Purpose,
  runName: string,
): Promise<RunRecord> {
  const extractor = buildExtractor(arm, { claude: opts.client, ocr: opts.ocr });
  const sleep = opts.sleep ?? realSleep;
  const t0 = performance.now();
  let attempt = 1;
  for (;;) {
    const ac = AbortSignal.timeout(DEADLINE_MS);
    const base = {
      id: entry.id, kind: entry.kind, arm: arm.id, repeat, mode: 'realtime' as const, purpose,
      latency_ms: null as number | null, attempts: attempt, at: (opts.now?.() ?? new Date()).toISOString(),
    };
    try {
      for (const img of images) delete img.prepared;
      const prepared = await prepareImages(images);
      for (const p of prepared) images.find((i) => i.position === p.position)!.prepared = p;
      const ex = await extractor.extract(extractInput(entry, images, attempt, ac));
      const ocrCost = extractor instanceof OcrThenParseExtractor ? ((ex.rawOutput as { meta?: { ocr_cost_usd?: number | null } })?.meta?.ocr_cost_usd ?? null) : null;
      const rec = success({ ...base, latency_ms: Math.round(performance.now() - t0) }, ex, 1, ocrCost);
      opts.budget.charge(rec.cost_usd, { run: runName, arm: arm.id, mode: 'realtime' });
      return rec;
    } catch (e) {
      const rec = failure(base, e, 1);
      opts.budget.charge(rec.cost_usd, { run: runName, arm: arm.id, mode: 'realtime' });
      if (e instanceof TransientError && attempt < 3) {
        attempt++;
        await sleep(attempt === 2 ? 2_000 : 8_000);
        continue;
      }
      return { ...rec, latency_ms: null };
    }
  }
}

export async function runRealtime(opts: RunOptions, purpose: Purpose = opts.purpose ?? 'both'): Promise<RunSummary> {
  const log = opts.log ?? (() => undefined);
  const summary: RunSummary = { runDirs: [], records: 0, failed: 0, costUsd: 0, stoppedByBudget: null };
  const ts = stamp(opts.now?.());
  for (const arm of opts.arms) {
    const runName = `${ts}-${arm.slug}${purpose === 'latency' || purpose === 'prefill' ? `-${purpose}` : ''}`;
    const runDir = join(opts.dir, 'runs', runName);
    summary.runDirs.push(runDir);
    for (const entry of opts.entries) {
      for (let r = 1; r <= opts.repeat; r++) {
        try {
          opts.budget.check(estimateCostUsd(arm, entry.kind, entry.images.length, 'realtime'), `${arm.id} ${entry.id}`);
        } catch (e) {
          if (e instanceof BudgetExceeded) {
            summary.stoppedByBudget = e.message;
            log(e.message);
            return summary;
          }
          throw e;
        }
        const before = opts.budget.spent;
        const rec = await realtimeOne(arm, entry, loadImages(opts.dir, entry), opts, r, purpose, runName);
        writeJson(recordPath(runDir, entry.id, r), rec);
        summary.records++;
        if (!rec.ok) summary.failed++;
        summary.costUsd += opts.budget.spent - before;
        log(`${arm.id} ${entry.id} r${r}: ${rec.ok ? 'ok' : `gagal (${rec.error?.code})`} ${rec.latency_ms ?? '-'} ms`);
      }
    }
  }
  return summary;
}

// ---------------------------------------------------------------------------- batch

interface PendingItem {
  customId: string;
  entry: ManifestEntry;
  repeat: number;
  input: ExtractInput;
  request: StructuredRequest<LlmOutput>;
  ocr: OcrResult | null;
}

/** Item batch `errored` → kelas pipeline (aturan §5.4: 400 gambar → unsupported; 400 lain = konfigurasi, sementara). */
export function mapBatchError(err: { type?: string; error?: { type?: string; message?: string } }): Error {
  const type = err.error?.type ?? err.type ?? 'api_error';
  const message = err.error?.message ?? type;
  if (type === 'invalid_request_error' && /\bimage\b/i.test(message)) return new PermanentError('unsupported', 'Format gambar ini belum didukung.');
  return new TransientError(`batch: ${type}`);
}

export function customId(arm: Arm, id: string, repeat: number): string {
  return `${arm.slug}__${id}__r${repeat}`;
}

export async function runBatch(opts: RunOptions): Promise<RunSummary> {
  const log = opts.log ?? (() => undefined);
  const sleep = opts.sleep ?? realSleep;
  const summary: RunSummary = { runDirs: [], records: 0, failed: 0, costUsd: 0, stoppedByBudget: null };
  const ts = stamp(opts.now?.());
  for (const arm of opts.arms) {
    const runName = `${ts}-${arm.slug}`;
    const runDir = join(opts.dir, 'runs', runName);
    summary.runDirs.push(runDir);
    const extractor = buildExtractor(arm, { claude: opts.client, ocr: opts.ocr });

    // Perkiraan seluruh batch dulu (+ OCR realtime untuk arm OCR).
    const estimate = opts.entries.reduce((s, e) => s + estimateCostUsd(arm, e.kind, e.images.length, 'batch'), 0) * opts.repeat;
    try {
      opts.budget.check(estimate, `batch ${arm.id} (${opts.entries.length} × ${opts.repeat})`);
    } catch (e) {
      if (e instanceof BudgetExceeded) {
        summary.stoppedByBudget = e.message;
        log(e.message);
        return summary;
      }
      throw e;
    }

    const pending: PendingItem[] = [];
    for (const entry of opts.entries) {
      const images = loadImages(opts.dir, entry);
      for (let r = 1; r <= opts.repeat; r++) {
        const base = { id: entry.id, kind: entry.kind, arm: arm.id, repeat: r, mode: 'batch' as const, purpose: 'accuracy' as const, latency_ms: null, attempts: 1, at: new Date().toISOString() };
        try {
          const prepared = await prepareImages(images);
          const imgs = images.map((i) => ({ ...i, prepared: prepared.find((p) => p.position === i.position) }));
          const input = extractInput(entry, imgs, 1);
          let ocr: OcrResult | null = null;
          let request: StructuredRequest<LlmOutput>;
          if (extractor instanceof OcrThenParseExtractor) {
            ocr = await extractor.recognize(input);
            opts.budget.charge(ocr.costUsd, { run: runName, arm: arm.id, mode: 'ocr' });
            request = extractor.request(input, ocr);
          } else {
            request = extractor.request(input);
          }
          pending.push({ customId: customId(arm, entry.id, r), entry, repeat: r, input, request, ocr });
        } catch (e) {
          // Gambar tidak bisa didekode / OCR gagal: tidak dikirim ke batch.
          const rec = failure(base, e, 1);
          writeJson(recordPath(runDir, entry.id, r), rec);
          summary.records++;
          summary.failed++;
        }
      }
    }
    if (!pending.length) continue;

    const batch = await opts.client.beta.messages.batches.create({
      requests: pending.map((p) => ({ custom_id: p.customId, params: buildBatchParams(p.request) })),
    });
    writeJson(join(runDir, 'batch.json'), { batch_id: batch.id, arm: arm.id, created_at: new Date().toISOString(), custom_ids: pending.map((p) => p.customId) });
    log(`${arm.id}: batch ${batch.id} (${pending.length} permintaan) dikirim`);
    for (;;) {
      const b = await opts.client.beta.messages.batches.retrieve(batch.id);
      if (b.processing_status === 'ended') break;
      log(`${arm.id}: batch ${b.processing_status} ${JSON.stringify(b.request_counts ?? {})}`);
      await sleep((opts.pollSeconds ?? 60) * 1000);
    }

    const byId = new Map(pending.map((p) => [p.customId, p]));
    const retry: PendingItem[] = [];
    for await (const line of await opts.client.beta.messages.batches.results(batch.id)) {
      const p = byId.get(line.custom_id);
      if (!p) continue;
      byId.delete(line.custom_id);
      const base = { id: p.entry.id, kind: p.entry.kind, arm: arm.id, repeat: p.repeat, mode: 'batch' as const, purpose: 'accuracy' as const, latency_ms: null, attempts: 1, at: new Date().toISOString() };
      let rec: RunRecord;
      if (line.result.type === 'succeeded') {
        try {
          const res = interpretMessage(p.request, line.result.message);
          const ex = extractor instanceof OcrThenParseExtractor ? extractor.finish(p.input, p.ocr!, res) : extractor.finish(p.input, res);
          rec = success(base, ex, BATCH_PRICE_FACTOR, p.ocr?.costUsd ?? null);
          // OCR sudah ditagih saat recognize; yang ditagih di sini hanya Claude.
          opts.budget.charge((rec.cost_usd ?? 0) - (p.ocr?.costUsd ?? 0), { run: runName, arm: arm.id, mode: 'batch' });
        } catch (e) {
          rec = failure(base, e, BATCH_PRICE_FACTOR);
          opts.budget.charge(rec.cost_usd, { run: runName, arm: arm.id, mode: 'batch' });
          // max_tokens di percobaan 1 → ulang realtime dengan batas × 2 (F-128).
          if (e instanceof TransientError) retry.push(p);
        }
      } else if (line.result.type === 'errored') {
        const mapped = mapBatchError(line.result.error);
        rec = failure(base, mapped, BATCH_PRICE_FACTOR);
        if (mapped instanceof TransientError) retry.push(p);
      } else {
        rec = failure(base, new TransientError(`batch: ${line.result.type}`), BATCH_PRICE_FACTOR);
        retry.push(p);
      }
      if (!rec.ok && p.ocr) {
        // OCR sudah terpakai walaupun parse gagal: biaya capture tetap memuatnya.
        rec = { ...rec, ocr_cost_usd: p.ocr.costUsd, cost_usd: (rec.cost_usd ?? 0) + (p.ocr.costUsd ?? 0) };
      }
      writeJson(recordPath(runDir, p.entry.id, p.repeat), rec);
      summary.records++;
      if (!rec.ok && !retry.includes(p)) summary.failed++;
    }
    for (const p of byId.values()) {
      retry.push(p); // tidak ada di hasil (seharusnya tidak terjadi)
    }

    // Percobaan ulang realtime (attempt 2) untuk yang gagal sementara di batch.
    for (const p of retry) {
      try {
        opts.budget.check(estimateCostUsd(arm, p.entry.kind, p.entry.images.length, 'realtime'), `ulang ${arm.id} ${p.entry.id}`);
      } catch (e) {
        if (e instanceof BudgetExceeded) {
          summary.stoppedByBudget = e.message;
          summary.failed++;
          continue;
        }
        throw e;
      }
      const rec = await realtimeOne(arm, p.entry, loadImages(opts.dir, p.entry), { ...opts, sleep }, p.repeat, 'accuracy', runName);
      const merged: RunRecord = { ...rec, mode: 'batch', attempts: rec.attempts + 1, latency_ms: null };
      writeJson(recordPath(runDir, p.entry.id, p.repeat), merged);
      if (!merged.ok) summary.failed++;
    }
    summary.costUsd = opts.budget.spent;
  }
  summary.costUsd = opts.budget.spent;
  return summary;
}

// ---------------------------------------------------------------------------- baca hasil

/** Semua catatan run (opsional: hanya folder tertentu). */
export function readRecords(dir: string, runDirs?: string[]): RunRecord[] {
  const root = join(dir, 'runs');
  if (!existsSync(root)) return [];
  const dirs = runDirs ?? readdirSync(root).map((d) => join(root, d));
  const out: RunRecord[] = [];
  for (const d of dirs) {
    if (!existsSync(d)) continue;
    for (const f of readdirSync(d).filter((x) => /\.r\d+\.json$/.test(x)).sort()) out.push(readJson<RunRecord>(join(d, f)));
  }
  return out;
}
