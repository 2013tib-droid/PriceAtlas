// Menjalankan arm × capture × ulangan (docs/08 §4.6).
//   * batch    : Message Batches API (diskon 50 %), TANPA `betas`/`fallbacks` (F-116; refusal tetap
//                terhitung sebagai kegagalan). Hasil dipetakan lewat custom_id `<arm>:<id>:<ulangan>`.
//   * realtime : panggilan biasa (dengan fallback seperti produksi), latensi diukur dari prepareImages
//                sampai output terkonversi (p50/p95).
// Kedua mode memakai extractor produksi yang sama. Batch: extractor dijalankan dua kali, sekali
// dengan klien perekam (mengambil parameter permintaan) dan sekali dengan klien pemutar (hasil batch).
// Batas biaya keras: buku biaya kumulatif `spend.json`; permintaan yang melewati `--budget` ditolak.
import { mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { BetaMessage, MessageCreateParamsNonStreaming } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import type { ClaudeClient } from '../src/ai/claude.ts';
import { priceOf } from '../src/ai/pricing.ts';
import type { OcrEngine, OcrPage } from '../src/extractors/ocr-parse.ts';
import { prepareImages } from '../src/images/prepare.ts';
import { PermanentError, TransientError, type ExtractContext, type ImageBlob, type PreparedImage } from '../src/pipeline/types.ts';
import { extractorFor, type Arm } from './arms.ts';
import type { EvalPaths } from './paths.ts';
import type { RunRecord } from './score.ts';
import type { ManifestEntry } from './truth.ts';

export const DEFAULT_BUDGET_USD = 75;
export const BATCH_DISCOUNT = 0.5;

/** Bagian SDK yang dipakai harness (Anthropic asli memenuhinya; klien palsu juga). */
export interface BatchClient extends ClaudeClient {
  beta: ClaudeClient['beta'] & {
    messages: ClaudeClient['beta']['messages'] & {
      batches: {
        create(body: { requests: { custom_id: string; params: MessageCreateParamsNonStreaming }[] }): PromiseLike<{ id: string; processing_status: string }>;
        retrieve(id: string): PromiseLike<{ id: string; processing_status: string; request_counts: Record<string, number> }>;
        results(id: string): PromiseLike<AsyncIterable<{ custom_id: string; result: BatchResult }>>;
      };
    };
  };
}

type BatchResult =
  | { type: 'succeeded'; message: BetaMessage }
  | { type: 'errored'; error: { error?: { type?: string; message?: string }; type?: string } }
  | { type: 'canceled' }
  | { type: 'expired' };

// ------------------------------------------------------------------ buku biaya

interface Ledger {
  total_usd: number;
  entries: { at: string; run: string; usd: number; note?: string }[];
}

export class BudgetExceededError extends Error {}

export class Budget {
  private ledger: Ledger;
  constructor(
    private readonly file: string,
    readonly limitUsd: number,
  ) {
    this.ledger = existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as Ledger) : { total_usd: 0, entries: [] };
  }
  get spent(): number {
    return this.ledger.total_usd;
  }
  /** Tolak sebelum memanggil API jika perkiraan melewati batas. */
  reserve(estimateUsd: number, what: string): void {
    if (this.ledger.total_usd + estimateUsd > this.limitUsd) {
      throw new BudgetExceededError(
        `Batas biaya US$${this.limitUsd} akan terlewati (terpakai US$${this.spent.toFixed(4)}, perkiraan ${what} US$${estimateUsd.toFixed(4)}). ` +
          'Naikkan --budget dengan sadar atau kurangi arm/set.',
      );
    }
  }
  record(usd: number, run: string, note?: string): void {
    if (!usd) return;
    this.ledger.total_usd = Math.round((this.ledger.total_usd + usd) * 1e6) / 1e6;
    this.ledger.entries.push({ at: new Date().toISOString(), run, usd: Math.round(usd * 1e6) / 1e6, ...(note ? { note } : {}) });
    writeFileSync(this.file, `${JSON.stringify(this.ledger, null, 2)}\n`);
  }
}

/** Perkiraan konservatif biaya satu permintaan (token gambar ≈ w×h/750, teks ≈ karakter/3, output 4K). */
export function estimateUsd(params: MessageCreateParamsNonStreaming, prepared: PreparedImage[], batch: boolean): number {
  const p = priceOf(params.model);
  if (!p) return 0.5; // model tak dikenal: angka besar supaya batas tetap terasa
  const systemChars = Array.isArray(params.system) ? params.system.reduce((a, b) => a + b.text.length, 0) : String(params.system ?? '').length;
  const content = params.messages[0]?.content;
  const textChars = Array.isArray(content) ? content.reduce((a, b) => a + (b.type === 'text' ? b.text.length : 0), 0) : 0;
  const imageTokens = prepared.reduce((a, img) => a + Math.ceil((img.width * img.height) / 750), 0);
  const input = imageTokens + Math.ceil((systemChars + textChars) / 3) + 1500; // + skema output
  const usd = (input * p.input + 4000 * p.output) / 1_000_000;
  return batch ? usd * BATCH_DISCOUNT : usd;
}

// ------------------------------------------------------------------ gambar dan konteks

export async function loadImages(paths: EvalPaths, entry: ManifestEntry): Promise<ImageBlob[]> {
  const blobs: ImageBlob[] = entry.images.map((file, i) => ({
    position: i + 1,
    storagePath: file,
    sha256: '',
    data: readFileSync(join(paths.images, file)),
  }));
  const prepared = await prepareImages(blobs);
  for (const b of blobs) b.prepared = prepared.find((p) => p.position === b.position);
  return blobs;
}

export function ctxFor(entry: ManifestEntry, attempt = 1): ExtractContext {
  return { captureId: entry.id, householdId: 'ocr-eval', attempt, uploadedAt: new Date(entry.uploaded_at), capturedAt: null };
}

function errorOf(e: unknown): RunRecord['error'] {
  if (e instanceof PermanentError) return { code: e.code, message: e.message, transient: false };
  if (e instanceof TransientError) return { code: 'transient', message: e.message, transient: true };
  return { code: 'crash', message: e instanceof Error ? e.message : String(e), transient: true };
}

function costOfError(e: unknown): number | null {
  const run = e instanceof PermanentError || e instanceof TransientError ? e.runOutput : undefined;
  return run?.usage?.costUsd ?? null;
}

function metaOf(raw: unknown): { served_model?: string | null; fallback_used?: boolean; prompt_version?: string; llm_cost?: number | null } {
  const m = (raw as { meta?: Record<string, unknown> } | undefined)?.meta ?? {};
  return {
    served_model: (m.served_model as string | undefined) ?? null,
    fallback_used: !!m.fallback_used,
    prompt_version: m.prompt_version as string | undefined,
    llm_cost: (m.cost_usd as number | null | undefined) ?? null,
  };
}

// ------------------------------------------------------------------ penyimpanan run

export interface RunPlan {
  arms: Arm[];
  entries: ManifestEntry[];
  repeat: number;
  mode: 'batch' | 'realtime';
  client: BatchClient;
  ocr?: OcrEngine;
  budget: Budget;
  label: string;
  /** Batch: jeda polling (ms). */
  pollMs?: number;
  log?: (msg: string) => void;
}

export function runDir(paths: EvalPaths, label: string): string {
  const dir = join(paths.runs, label);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeRecord(dir: string, r: RunRecord): void {
  const d = join(dir, r.arm);
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, `${r.id}-r${r.repeat}.json`), `${JSON.stringify(r, null, 2)}\n`);
}

export function readRecords(dir: string): RunRecord[] {
  const out: RunRecord[] = [];
  for (const arm of readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory())) {
    for (const f of readdirSync(join(dir, arm.name)).filter((f) => f.endsWith('.json'))) {
      out.push(JSON.parse(readFileSync(join(dir, arm.name, f), 'utf8')) as RunRecord);
    }
  }
  return out;
}

// ------------------------------------------------------------------ realtime

export async function runRealtime(paths: EvalPaths, plan: RunPlan): Promise<RunRecord[]> {
  const dir = runDir(paths, plan.label);
  const out: RunRecord[] = [];
  for (const arm of plan.arms) {
    const extractor = extractorFor(arm, plan.client, arm.source === 'ocr' ? plan.ocr : undefined);
    for (const entry of plan.entries) {
      for (let rep = 1; rep <= plan.repeat; rep++) {
        const t0 = performance.now();
        let rec: RunRecord;
        try {
          const images = await loadImages(paths, entry);
          const prepared = images.map((i) => i.prepared!);
          // Perkiraan kasar sebelum memanggil (parameter persis baru ada di dalam extractor).
          plan.budget.reserve(estimateUsd({ model: arm.model, max_tokens: 0, messages: [] } as MessageCreateParamsNonStreaming, prepared, false) + 0.02, `${arm.name}/${entry.id}`);
          const x = await extractor.extract({ kind: entry.kind, images, ctx: ctxFor(entry) });
          const m = metaOf(x.rawOutput);
          rec = {
            id: entry.id, arm: arm.name, repeat: rep, mode: 'realtime', ok: true, output: x.output, rawText: x.rawText ?? null,
            cost_usd: x.usage?.costUsd ?? null, latency_ms: Math.round(performance.now() - t0),
            served_model: m.served_model, fallback_used: m.fallback_used, prompt_version: m.prompt_version,
          };
        } catch (e) {
          if (e instanceof BudgetExceededError) throw e;
          rec = {
            id: entry.id, arm: arm.name, repeat: rep, mode: 'realtime', ok: false, error: errorOf(e),
            cost_usd: costOfError(e), latency_ms: Math.round(performance.now() - t0),
          };
        }
        plan.budget.record(rec.cost_usd ?? 0, plan.label, `${arm.name}/${entry.id}`);
        writeRecord(dir, rec);
        out.push(rec);
        plan.log?.(`${arm.name} ${entry.id} r${rep}: ${rec.ok ? 'ok' : rec.error?.code} ${rec.latency_ms} ms`);
      }
    }
  }
  return out;
}

// ------------------------------------------------------------------ batch

class Captured extends Error {}

/** Klien perekam: menyimpan parameter permintaan, lalu menghentikan extractor. */
class RecordingClient implements ClaudeClient {
  params: MessageCreateParamsNonStreaming | null = null;
  beta = {
    messages: {
      create: async (params: MessageCreateParamsNonStreaming): Promise<BetaMessage> => {
        this.params = params;
        throw new Captured('captured');
      },
    },
  };
}

/** Klien pemutar: mengembalikan hasil batch untuk satu permintaan. */
class ReplayClient implements ClaudeClient {
  constructor(private readonly result: BatchResult) {}
  beta = {
    messages: {
      create: async (): Promise<BetaMessage> => {
        if (this.result.type === 'succeeded') return this.result.message;
        // Error batch → kelas pipeline: kedaluwarsa/dibatalkan/server = sementara; permintaan tidak valid = permanen.
        if (this.result.type === 'errored' && this.result.error?.error?.type === 'invalid_request_error') {
          throw new PermanentError('unsupported', `batch: ${this.result.error.error.message ?? 'permintaan tidak valid'}`);
        }
        throw new TransientError(`batch: ${this.result.type}`);
      },
    },
  };
}

/** OCR yang direkam saat menyusun batch, diputar ulang saat membaca hasil (tanpa memanggil vendor lagi). */
class CachedOcr implements OcrEngine {
  constructor(
    readonly name: string,
    readonly costPerImageUsd: number,
    private readonly pages: OcrPage[],
  ) {}
  async recognize(): Promise<OcrPage[]> {
    return this.pages;
  }
}

interface BatchState {
  batch_id: string;
  requests: Record<string, { arm: string; id: string; repeat: number; ocr_pages?: OcrPage[] }>;
  /** custom_id yang gagal sebelum dikirim (mis. gambar rusak): langsung dicatat. */
  created_at: string;
}

export const customId = (arm: string, id: string, rep: number) => `${arm}:${id}:${rep}`;

export async function runBatch(paths: EvalPaths, plan: RunPlan): Promise<RunRecord[]> {
  const dir = runDir(paths, plan.label);
  const stateFile = join(dir, 'batch.json');
  const records: RunRecord[] = [];
  const requests: { custom_id: string; params: MessageCreateParamsNonStreaming }[] = [];
  const state: BatchState = { batch_id: '', requests: {}, created_at: new Date().toISOString() };
  let estimate = 0;

  // 1. Susun permintaan lewat extractor produksi (klien perekam).
  for (const arm of plan.arms) {
    for (const entry of plan.entries) {
      for (let rep = 1; rep <= plan.repeat; rep++) {
        const cid = customId(arm.name, entry.id, rep);
        const rec = new RecordingClient();
        let pages: OcrPage[] | undefined;
        const ocr = arm.source === 'ocr' && plan.ocr ? recordingOcr(plan.ocr, (p) => (pages = p)) : undefined;
        try {
          const images = await loadImages(paths, entry);
          try {
            await extractorFor(arm, rec, ocr).extract({ kind: entry.kind, images, ctx: ctxFor(entry) });
          } catch (e) {
            if (!rec.params) throw e;
          }
          const params = { ...rec.params! };
          // F-116: fallbacks tidak didukung di Batches API.
          delete params.betas;
          delete (params as { fallbacks?: unknown }).fallbacks;
          estimate += estimateUsd(params, images.map((i) => i.prepared!), true);
          requests.push({ custom_id: cid, params });
          state.requests[cid] = { arm: arm.name, id: entry.id, repeat: rep, ...(pages ? { ocr_pages: pages } : {}) };
        } catch (e) {
          const r: RunRecord = { id: entry.id, arm: arm.name, repeat: rep, mode: 'batch', ok: false, error: errorOf(e), cost_usd: null, latency_ms: null };
          writeRecord(dir, r);
          records.push(r);
        }
      }
    }
  }
  if (!requests.length) return records;
  plan.budget.reserve(estimate, `batch ${requests.length} permintaan`);

  // 2. Kirim dan simpan status (bisa dilanjutkan dengan `run --resume`).
  const batch = await plan.client.beta.messages.batches.create({ requests });
  state.batch_id = batch.id;
  writeFileSync(stateFile, `${JSON.stringify(state)}\n`);
  plan.log?.(`batch ${batch.id}: ${requests.length} permintaan, perkiraan US$${estimate.toFixed(4)}`);
  return [...records, ...(await collectBatch(paths, plan, dir))];
}

function recordingOcr(inner: OcrEngine, keep: (p: OcrPage[]) => void): OcrEngine {
  return {
    name: inner.name,
    costPerImageUsd: inner.costPerImageUsd,
    recognize: async (images, signal) => {
      const p = await inner.recognize(images, signal);
      keep(p);
      return p;
    },
  };
}

/** Tunggu batch selesai, lalu putar ulang setiap hasil lewat extractor yang sama. */
export async function collectBatch(paths: EvalPaths, plan: Pick<RunPlan, 'arms' | 'client' | 'budget' | 'label' | 'pollMs' | 'log' | 'ocr'>, dir: string): Promise<RunRecord[]> {
  const state = JSON.parse(readFileSync(join(dir, 'batch.json'), 'utf8')) as BatchState;
  for (;;) {
    const b = await plan.client.beta.messages.batches.retrieve(state.batch_id);
    if (b.processing_status === 'ended') break;
    plan.log?.(`batch ${state.batch_id}: ${b.processing_status} ${JSON.stringify(b.request_counts)}`);
    await new Promise((r) => setTimeout(r, plan.pollMs ?? 60_000));
  }
  const manifest = new Map<string, ManifestEntry>();
  const { readManifest } = await import('./truth.ts');
  for (const e of readManifest(paths).entries) manifest.set(e.id, e);
  const armByName = new Map(plan.arms.map((a) => [a.name, a]));
  const { ARMS } = await import('./arms.ts');
  for (const a of ARMS) if (!armByName.has(a.name)) armByName.set(a.name, a);

  const out: RunRecord[] = [];
  let spent = 0;
  for await (const res of await plan.client.beta.messages.batches.results(state.batch_id)) {
    const req = state.requests[res.custom_id];
    if (!req) continue;
    const arm = armByName.get(req.arm)!;
    const entry = manifest.get(req.id)!;
    const ocr = req.ocr_pages ? new CachedOcr(arm.ocr ?? 'gcv', plan.ocr?.costPerImageUsd ?? 0.0015, req.ocr_pages) : undefined;
    let rec: RunRecord;
    try {
      const images = await loadImages(paths, entry);
      const x = await extractorFor(arm, new ReplayClient(res.result as BatchResult), ocr).extract({ kind: entry.kind, images, ctx: ctxFor(entry) });
      const m = metaOf(x.rawOutput);
      rec = {
        id: entry.id, arm: arm.name, repeat: req.repeat, mode: 'batch', ok: true, output: x.output, rawText: x.rawText ?? null,
        cost_usd: batchCost(x.usage?.costUsd ?? null, m.llm_cost ?? null), latency_ms: null,
        served_model: m.served_model, fallback_used: m.fallback_used, prompt_version: m.prompt_version,
      };
    } catch (e) {
      const run = e instanceof PermanentError || e instanceof TransientError ? e.runOutput : undefined;
      rec = {
        id: entry.id, arm: arm.name, repeat: req.repeat, mode: 'batch', ok: false, error: errorOf(e),
        cost_usd: batchCost(costOfError(e), metaOf(run?.rawOutput).llm_cost ?? null), latency_ms: null,
      };
    }
    spent += rec.cost_usd ?? 0;
    writeRecord(dir, rec);
    out.push(rec);
  }
  plan.budget.record(spent, plan.label, `batch ${state.batch_id}`);
  return out;
}

/** Diskon batch hanya untuk bagian Claude; biaya OCR vendor tetap. */
export function batchCost(total: number | null, llm: number | null): number | null {
  if (total == null) return null;
  const l = llm ?? total;
  return Math.round((total - l * BATCH_DISCOUNT) * 1e6) / 1e6;
}
