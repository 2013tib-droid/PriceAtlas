// Langkah worker untuk satu capture (docs/05 §5.4):
//   claim → unduh gambar + verifikasi sha256 → prepareImages (docs/08 §6) → extract → record_run_output →
//   lokasi → matching tier 1–3 (SQL) → tier 4 (AiMatcher, hanya tanpa kandidat) →
//   apply_extraction (satu transaksi). Gagal → fail_run (transient/permanen).
// Sebelum claim: anggaran AI harian (docs/08 §12.3). Habis → tidak claim, capture tetap `uploaded`.
import { createHash } from 'node:crypto';
import {
  ParsedOutputSchema,
  type ApplyPayload,
  type MatchResult,
  type ParsedObservation,
  type ParsedReceipt,
} from '@priceatlas/contracts';
import type { Db } from '../db.ts';
import { prepareImages } from '../images/prepare.ts';
import { log } from '../log.ts';
import {
  PermanentError,
  TransientError,
  type AiMatcher,
  type BlobStore,
  type CaptureExtractor,
  type CaptureKind,
  type Extraction,
  type ImageBlob,
  type RunOutput,
  type UnmatchedItem,
} from './types.ts';

/** Lease run default (app.config capture_processing_timeout_seconds, D-70). */
export const DEFAULT_LEASE_SECONDS = 300;
/** Sisa waktu sebelum lease habis yang tidak dipakai panggilan AI (F-107). */
export const DEADLINE_MARGIN_SECONDS = 30;

export interface PipelineDeps {
  db: Db;
  blob: BlobStore;
  extractor: CaptureExtractor;
  ai: AiMatcher;
  workerId: string;
  /** Anggaran AI harian (§12.3). Tanpa gerbang → selalu claim (test). */
  budget?: { allow(): Promise<boolean> };
  /** Lease run dalam detik (default 300). Tenggat AI = lease − 30 dtk dari claim (F-107). */
  leaseSeconds?: number;
  /** Hanya untuk test crash (L3): dipanggil tepat setelah klaim berhasil. */
  hooks?: { afterClaim?: (claim: Claim) => void | Promise<void> };
}

export interface Claim {
  capture_id: string;
  run_id: string;
  kind: CaptureKind;
  household_id: string;
  attempt: number;
  store_id: string | null;
  branch_id: string | null;
  shopping_session_id: string | null;
  uploaded_at: Date;
  captured_at: Date | null;
  images: { position: number; storage_path: string; sha256: string }[];
}

export interface ProcessResult {
  captureId: string;
  runId: string;
  status: string;
  attempt: number;
  ms: number;
}

/** Pesan untuk UI (S-08/S-09) per kategori error (X-08). */
const PERMANENT_MESSAGE: Record<string, string> = {
  blurry: 'Gambar buram atau tidak terbaca. Coba foto ulang.',
  not_a_receipt: 'Gambar ini sepertinya bukan struk atau label harga.',
  unsupported: 'Format gambar ini belum didukung.',
  timeout: 'Waktu pemrosesan habis.',
  other: 'Gambar tidak bisa diproses.',
};

export async function processNextCapture(deps: PipelineDeps): Promise<ProcessResult | null> {
  const { db, extractor } = deps;
  if (deps.budget && !(await deps.budget.allow())) return null;
  const started = Date.now();
  const r = await db.query<Claim>('select * from app.claim_next_capture($1, $2, $3, $4)', [
    deps.workerId,
    extractor.engine,
    extractor.model,
    extractor.promptVersion,
  ]);
  const claim = r.rows[0];
  if (!claim) return null;
  const deadline = createDeadline(started, deps.leaseSeconds ?? DEFAULT_LEASE_SECONDS);
  log('capture.claimed', { capture: claim.capture_id, run: claim.run_id, attempt: claim.attempt, kind: claim.kind });
  await deps.hooks?.afterClaim?.(claim);

  try {
    const status = await runClaim(deps, claim, deadline);
    const ms = Date.now() - started;
    log('capture.applied', { capture: claim.capture_id, run: claim.run_id, status, ms });
    return { captureId: claim.capture_id, runId: claim.run_id, status, attempt: claim.attempt, ms };
  } catch (e) {
    const runOutput = (e as { runOutput?: RunOutput } | null)?.runOutput;
    if (runOutput) await recordRunOutput(db, claim.run_id, runOutput.rawText, runOutput.rawOutput, runOutput.usage);
    const { code, message, transient } = classify(e);
    const fr = await db.query<{ status: string }>('select app.fail_run($1, $2, $3, $4) as status', [
      claim.run_id,
      code,
      message,
      transient,
    ]);
    const status = fr.rows[0]?.status ?? 'stale';
    const ms = Date.now() - started;
    log('capture.failed', { capture: claim.capture_id, run: claim.run_id, code, transient, status, ms });
    return { captureId: claim.capture_id, runId: claim.run_id, status, attempt: claim.attempt, ms };
  } finally {
    deadline.clear();
  }
}

type Usage = NonNullable<Extraction['usage']>;

/** Biaya AI hari ini ≥ anggaran → tidak claim. Log `ai.budget_exhausted` maks sekali per jam. */
export class BudgetGate {
  private lastLog = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly db: Db,
    /** env AI_DAILY_BUDGET_USD; null → app.config ai_daily_budget_usd. */
    private readonly overrideUsd: number | null = null,
    private readonly now: () => number = Date.now,
  ) {}

  async allow(): Promise<boolean> {
    const r = await this.db.query<{ spent: string | null; budget: string | null }>(
      `select app.ai_spend_today() as spent, app.config_numeric('ai_daily_budget_usd') as budget`,
    );
    const spent = Number(r.rows[0]?.spent ?? 0);
    const budget = this.overrideUsd ?? Number(r.rows[0]?.budget ?? 2);
    if (spent < budget) return true;
    const t = this.now();
    if (t - this.lastLog >= 3_600_000) {
      this.lastLog = t;
      log('ai.budget_exhausted', { spent_usd: round4(spent), budget_usd: budget });
    }
    return false;
  }
}

/** Env angka positif opsional (CAPTURE_LEASE_SECONDS, AI_DAILY_BUDGET_USD); kosong → null. */
export function parsePositiveEnv(name: string, value: string | undefined, opts: { integer?: boolean } = {}): number | null {
  if (value === undefined || value.trim() === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0 || (opts.integer && !Number.isInteger(n))) {
    throw new Error(`env ${name} harus angka ${opts.integer ? 'bulat ' : ''}positif: ${value}`);
  }
  return n;
}

/**
 * Lease worker tidak boleh lebih panjang dari timeout reaper (capture_processing_timeout_seconds),
 * dan harus lebih panjang dari margin tenggat (F-107). Dicek sekali saat worker mulai.
 */
export async function checkLeaseSeconds(db: Db, leaseSeconds: number): Promise<void> {
  const r = await db.query<{ t: string | null }>(`select app.config_numeric('capture_processing_timeout_seconds') as t`);
  const timeout = Number(r.rows[0]?.t ?? DEFAULT_LEASE_SECONDS);
  if (leaseSeconds <= DEADLINE_MARGIN_SECONDS) {
    throw new Error(`CAPTURE_LEASE_SECONDS=${leaseSeconds} harus lebih dari ${DEADLINE_MARGIN_SECONDS} (margin tenggat AI, F-107)`);
  }
  if (leaseSeconds > timeout) {
    throw new Error(
      `CAPTURE_LEASE_SECONDS=${leaseSeconds} melebihi capture_processing_timeout_seconds=${timeout}: ` +
        'reaper akan menandai run yang masih berjalan sebagai macet (docs/08 §5.4).',
    );
  }
}

function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}

function addUsage(a: Usage | undefined, b: Usage): Usage {
  if (!a) return b;
  return {
    inputTokens: (a.inputTokens ?? 0) + (b.inputTokens ?? 0),
    outputTokens: (a.outputTokens ?? 0) + (b.outputTokens ?? 0),
    costUsd: a.costUsd == null && b.costUsd == null ? null : (a.costUsd ?? 0) + (b.costUsd ?? 0),
  };
}

export interface Deadline {
  signal: AbortSignal;
  deadlineAt: Date;
  clear(): void;
}

/** Tenggat absolut dari waktu claim: lease − margin. Sudah lewat → signal langsung aborted. */
export function createDeadline(claimedAtMs: number, leaseSeconds: number, marginSeconds = DEADLINE_MARGIN_SECONDS, now = Date.now()): Deadline {
  const deadlineAt = new Date(claimedAtMs + (leaseSeconds - marginSeconds) * 1000);
  const ctl = new AbortController();
  const ms = deadlineAt.getTime() - now;
  let timer: NodeJS.Timeout | undefined;
  if (ms <= 0) ctl.abort(new Error('tenggat lease habis'));
  else {
    timer = setTimeout(() => ctl.abort(new Error('tenggat lease habis')), ms);
    timer.unref();
  }
  return { signal: ctl.signal, deadlineAt, clear: () => clearTimeout(timer) };
}

async function recordRunOutput(db: Db, runId: string, rawText: string | null | undefined, rawOutput: unknown, usage: RunOutput['usage']) {
  await db.query('select app.record_run_output($1, $2, $3, $4, $5, $6)', [
    runId,
    rawText ?? null,
    JSON.stringify(rawOutput),
    usage?.inputTokens ?? null,
    usage?.outputTokens ?? null,
    usage?.costUsd ?? null,
  ]);
}

export function classify(e: unknown): { code: string; message: string; transient: boolean } {
  if (e instanceof PermanentError) {
    return { code: e.code, message: e.message || PERMANENT_MESSAGE[e.code] || PERMANENT_MESSAGE.other!, transient: false };
  }
  if (e instanceof TransientError) {
    return { code: 'other', message: 'Gagal memproses sementara. Akan dicoba lagi.', transient: true };
  }
  // Error tak dikenal (bug, koneksi): dianggap sementara supaya tidak kehilangan data.
  return { code: 'other', message: 'Terjadi kesalahan saat memproses. Akan dicoba lagi.', transient: true };
}

async function runClaim(deps: PipelineDeps, claim: Claim, deadline: Deadline): Promise<string> {
  const { db, blob, extractor, ai } = deps;

  // 1. Unduh gambar + verifikasi sha256.
  const images: ImageBlob[] = [];
  for (const img of claim.images) {
    let data: Buffer;
    try {
      data = await blob.get(img.storage_path);
    } catch {
      throw new TransientError('gambar belum bisa diunduh');
    }
    const sha = createHash('sha256').update(data).digest('hex');
    if (sha !== img.sha256) {
      throw new PermanentError('other', 'Gambar berbeda dengan yang didaftarkan.');
    }
    images.push({ position: img.position, storagePath: img.storage_path, sha256: sha, data });
  }

  // 1b. Dekode + bersihkan untuk model (§6). Gagal → `unsupported`, berlaku juga untuk stub.
  const prepared = await prepareImages(images);
  for (const img of images) img.prepared = prepared.find((p) => p.position === img.position);

  // 2. Extract (stub di Tahap 4) + validasi kontrak.
  const extraction = await extractor.extract({
    kind: claim.kind,
    images,
    ctx: {
      captureId: claim.capture_id,
      householdId: claim.household_id,
      attempt: claim.attempt,
      uploadedAt: claim.uploaded_at,
      capturedAt: claim.captured_at,
      signal: deadline.signal,
      deadlineAt: deadline.deadlineAt,
    },
  });
  const parsed = ParsedOutputSchema.safeParse(extraction.output);

  // 3. Data mentah selalu disimpan, juga jika output tidak valid (audit, proses ulang).
  await recordRunOutput(db, claim.run_id, extraction.rawText, extraction.rawOutput ?? extraction.output, extraction.usage);
  if (!parsed.success) throw new PermanentError('unsupported', 'Hasil pembacaan gambar tidak valid.');
  const output = parsed.data;
  if ((claim.kind === 'receipt') !== (output.kind === 'receipt')) {
    throw new PermanentError(claim.kind === 'receipt' ? 'not_a_receipt' : 'unsupported', PERMANENT_MESSAGE[claim.kind === 'receipt' ? 'not_a_receipt' : 'unsupported']!);
  }

  // 4. Lokasi (sama dengan apply_extraction) → toko untuk alias per toko (D-13).
  const loc = await db.query<{ store_id: string | null }>('select store_id from app.capture_location($1, $2, $3)', [
    claim.capture_id,
    output.store_hint?.name ?? null,
    output.store_hint?.branch_name ?? null,
  ]);
  const storeId = loc.rows[0]?.store_id ?? null;

  // 5. Matching tier 1–3 (SQL, deterministik), lalu tier 4 hanya untuk yang tanpa kandidat.
  //    Screenshot: nama produk dan judul listing, yang lebih kuat menang (Q-133, F-154, F-161).
  const toMatch: UnmatchedItem[] =
    output.kind === 'receipt'
      ? output.lines
          .filter((l) => l.line_type === 'product')
          .map((l) => ({ key: l.line_no, raw_text: l.raw_text, barcode: l.barcode ?? null, amount: l.line_amount, quantity: l.quantity ?? null }))
      : output.items.map((it, i) => ({
          key: i + 1,
          raw_text: it.raw_text,
          barcode: it.barcode ?? null,
          title: it.listing_title?.trim() ? it.listing_title : null,
          amount: it.promo_price ?? it.normal_price ?? null,
          quantity: null,
        }));

  const matched = new Map<number, MatchResult>();
  if (toMatch.length > 0) {
    // Satu panggilan: key positif = nama produk, key negatif = judul listing (jika berbeda).
    const query = toMatch.flatMap((x) => {
      const date = dateOf(output, x.key);
      const rows = [{ key: x.key, raw_text: x.raw_text, barcode: x.barcode, date }];
      if (x.title && x.title !== x.raw_text) rows.push({ key: -x.key, raw_text: x.title, barcode: x.barcode, date });
      return rows;
    });
    const m = await db.query<{ r: (MatchResult & { key: number })[] }>('select app.match_products($1, $2, $3) as r', [
      claim.household_id,
      storeId,
      JSON.stringify(query),
    ]);
    const byKey = new Map<number, MatchResult>();
    for (const row of m.rows[0]?.r ?? []) byKey.set(row.key, row);
    for (const x of toMatch) {
      const best = pickMatch(byKey.get(x.key), byKey.get(-x.key));
      if (best) matched.set(x.key, best);
    }

    const unmatched = toMatch.filter((x) => (matched.get(x.key)?.candidates.length ?? 0) === 0);
    if (unmatched.length > 0) {
      let matchUsage: Usage | undefined;
      const suggestions = await ai.match(unmatched, {
        householdId: claim.household_id,
        storeId,
        storeName: await storeName(db, storeId, output.store_hint?.name ?? null),
        kind: claim.kind,
        imageSha256s: images.map((i) => i.sha256),
        signal: deadline.signal,
        onUsage: (u) => {
          matchUsage = addUsage(matchUsage, u);
        },
      });
      for (const s of suggestions) {
        matched.set(s.key, {
          product_id: s.product_id,
          tier: 'ai',
          confidence: s.confidence,
          candidates: [{ product_id: s.product_id, tier: 'ai', confidence: s.confidence }],
        });
      }
      // Biaya tier 4 masuk biaya run (anggaran harian §12.3 menjumlahkan processing_run.cost_usd).
      if (matchUsage) {
        await recordRunOutput(
          db,
          claim.run_id,
          extraction.rawText,
          extraction.rawOutput ?? extraction.output,
          addUsage(extraction.usage ?? { inputTokens: 0, outputTokens: 0, costUsd: null }, matchUsage),
        );
      }
    }
  }

  // 6. Satu transaksi di database (§5.5).
  const payload: ApplyPayload =
    output.kind === 'receipt'
      ? { ...output, lines: output.lines.map((l) => ({ ...l, match: matched.get(l.line_no) })) }
      : { ...output, items: output.items.map((it, i) => ({ ...it, match: matched.get(i + 1) })) };
  const a = await db.query<{ r: { status: string } }>('select app.apply_extraction($1, $2, $3) as r', [
    claim.capture_id,
    claim.run_id,
    JSON.stringify(payload),
  ]);
  return a.rows[0]?.r.status ?? 'stale';
}

const TIER_RANK: Record<string, number> = { barcode: 1, alias: 2, fuzzy: 3, ai: 4, manual: 5 };

/**
 * Hasil nama produk vs judul listing (Q-133): tier lebih kuat menang, lalu confidence; seri → nama
 * produk. Kandidat pihak yang kalah melengkapi daftar (tanpa duplikat, maks 5).
 */
export function pickMatch(primary: MatchResult | undefined, fallback: MatchResult | undefined): MatchResult | undefined {
  const has = (m: MatchResult | undefined): m is MatchResult => !!m && m.candidates.length > 0;
  if (!has(fallback)) return primary;
  if (!has(primary)) return fallback;
  const rank = (m: MatchResult) => TIER_RANK[m.tier ?? 'manual'] ?? 9;
  const fallbackWins =
    rank(fallback) < rank(primary) || (rank(fallback) === rank(primary) && (fallback.confidence ?? 0) > (primary.confidence ?? 0));
  const [win, lose] = fallbackWins ? [fallback, primary] : [primary, fallback];
  const seen = new Set(win.candidates.map((c) => c.product_id));
  const extra = lose.candidates.filter((c) => !seen.has(c.product_id));
  return { ...win, candidates: [...win.candidates, ...extra].slice(0, 5) };
}

/** Nama toko untuk konteks tier 4: katalog jika toko dikenal, selain itu yang terbaca. */
async function storeName(db: Db, storeId: string | null, hint: string | null): Promise<string | null> {
  if (!storeId) return hint;
  const r = await db.query<{ name: string }>('select name from public.store where id = $1', [storeId]);
  return r.rows[0]?.name ?? hint;
}

function dateOf(output: ParsedReceipt | ParsedObservation, key: number): string | null {
  if (output.kind === 'receipt') return output.header.transaction_date ?? null;
  return output.items[key - 1]?.transaction_date ?? null;
}
