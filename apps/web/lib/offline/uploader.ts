// State machine antrean foto (docs/07 §5.4, D-59, F-24, P-09). Logika murni dengan dependensi
// yang disuntikkan (Storage, RPC, REST, sesi), sehingga diuji unit dengan fake-indexeddb.
//
//   captured ──► uploading(i/n) ──► submitting ──► submitted
//      │              │                  │
//      │              └─ jaringan / 5xx ─► waiting_network ─(online/fokus/timer)─► uploading
//      │                                 └─ CAPTURE_IMAGES_MISSING ─► unggah ulang semua bagian
//      └─ gagal permanen (4xx yang tidak dikenal) ─► error (S-08: "Coba lagi" / "Hapus")
import type { RpcInput } from '@priceatlas/contracts';
import {
  storagePath,
  type DuplicateMatch,
  type OutboxErrorKind,
  type OutboxItem,
  type OutboxStore,
} from './outbox-store';

/** Backoff antrean selama app terbuka (§5.4): 5 dtk, 30 dtk, 2 mnt, 10 mnt. */
export const BACKOFF_MS = [5_000, 30_000, 120_000, 600_000] as const;

export function backoffDelay(attempts: number): number {
  return BACKOFF_MS[Math.min(Math.max(attempts, 1), BACKOFF_MS.length) - 1]!;
}

export type StepOutcome =
  | { ok: true }
  | {
      ok: false;
      kind: 'network' | 'auth' | 'transient' | 'missing' | 'permanent';
      code?: string | null;
      message?: string | null;
    };

export interface UploaderDeps {
  store: Pick<OutboxStore, 'put' | 'getBlob' | 'deleteBlobs'>;
  /** Storage upload `upsert: false`; "sudah ada" harus dikembalikan sebagai ok (§5.2 backend). */
  upload(path: string, blob: Blob, contentType: string): Promise<StepOutcome>;
  submit(input: RpcInput<'submit_capture'>): Promise<StepOutcome>;
  /** REST capture_image?sha256=in.(…) tanpa capture_id ini; null = gagal (jaringan). */
  findDuplicates(sha256s: string[], excludeCaptureId: string): Promise<DuplicateMatch[] | null>;
  /** Segarkan sesi (P-09). true jika berhasil. */
  refreshSession(): Promise<boolean>;
  householdId(): Promise<string | null>;
  isOnline(): boolean;
  now(): number;
  onChange?(item: OutboxItem): void;
  /** true setelah antrean dihentikan (keluar akun): langkah yang sedang berjalan tidak menulis lagi. */
  stopped?(): boolean;
}

export class OutboxStoppedError extends Error {
  constructor() {
    super('outbox stopped');
    this.name = 'OutboxStoppedError';
  }
}

/** Item yang boleh diproses runner. `force` (online/fokus/foto baru) mengabaikan jadwal backoff. */
export function isEligible(item: OutboxItem, now: number, force: boolean): boolean {
  if (item.duplicate.status === 'found') return false;
  if (item.state === 'submitted' || item.state === 'error') return false;
  return force || item.next_attempt_at <= now;
}

/** Item ditahan dialog duplikat U-10. */
export function isHeld(item: OutboxItem): boolean {
  return item.duplicate.status === 'found' && item.state !== 'submitted';
}

async function save(deps: UploaderDeps, item: OutboxItem, patch: Partial<OutboxItem>): Promise<OutboxItem> {
  if (deps.stopped?.()) throw new OutboxStoppedError();
  const next = { ...item, ...patch };
  await deps.store.put(next);
  deps.onChange?.(next);
  return next;
}

function errorKindOf(o: Exclude<StepOutcome, { ok: true }>, step: 'upload' | 'submit'): OutboxErrorKind {
  if (o.kind === 'network' || o.kind === 'transient') return 'network';
  if (o.kind === 'auth') return 'auth';
  if (o.kind === 'missing') return 'missing';
  return step === 'upload' ? 'storage' : 'rpc';
}

/** Gagal sementara → waiting_network + jadwal backoff. */
function waiting(
  deps: UploaderDeps,
  item: OutboxItem,
  o: Exclude<StepOutcome, { ok: true }>,
  step: 'upload' | 'submit',
) {
  const attempts = item.attempts + 1;
  return save(deps, item, {
    state: 'waiting_network',
    attempts,
    next_attempt_at: deps.now() + backoffDelay(attempts),
    last_error: { kind: errorKindOf(o, step), code: o.code ?? null, message: o.message ?? null },
  });
}

function failed(
  deps: UploaderDeps,
  item: OutboxItem,
  kind: OutboxErrorKind,
  code: string | null,
  message: string | null,
) {
  return save(deps, item, { state: 'error', last_error: { kind, code, message } });
}

/** Satu langkah dengan 401 → refresh sesi → coba sekali lagi (P-09). */
async function withAuthRetry(deps: UploaderDeps, step: () => Promise<StepOutcome>): Promise<StepOutcome> {
  const first = await step();
  if (first.ok || first.kind !== 'auth') return first;
  if (!(await deps.refreshSession())) return first;
  return step();
}

/**
 * Proses satu item sampai selesai atau berhenti (menunggu sinyal, ditahan duplikat, gagal).
 * Idempoten: aman diulang dari keadaan mana pun (upload "sudah ada" = sukses, W1 idempoten).
 */
export async function processItem(deps: UploaderDeps, input: OutboxItem): Promise<OutboxItem> {
  let item = input;
  if (item.state === 'submitted' || item.state === 'error' || item.duplicate.status === 'found') return item;
  if (!deps.isOnline()) return waiting(deps, item, { ok: false, kind: 'network' }, 'upload');

  // §5.4 langkah 2: cek hash yang ditunda (offline saat foto diambil).
  if (item.duplicate.status === 'pending') {
    const matches = await deps.findDuplicates(
      item.parts.map((p) => p.sha256),
      item.capture_id,
    );
    if (matches === null) return waiting(deps, item, { ok: false, kind: 'network' }, 'upload');
    item = await save(deps, item, {
      duplicate: matches.length ? { status: 'found', matches } : { status: 'clear', matches: [] },
    });
    if (matches.length) return item;
  }

  const householdId = item.household_id ?? (await deps.householdId());
  if (!householdId) return waiting(deps, item, { ok: false, kind: 'network' }, 'upload');
  if (!item.household_id) item = await save(deps, item, { household_id: householdId });

  // Paling banyak satu kali "unggah ulang semua bagian" per putaran (F-24).
  for (let round = 0; round < 2; round++) {
    // §5.4 langkah 3: unggah per bagian.
    for (const part of item.parts) {
      if (item.uploaded.includes(part.position)) continue;
      item = await save(deps, item, { state: 'uploading' });
      const blob = await deps.store.getBlob(item.capture_id, part.position);
      if (!blob) return failed(deps, item, 'blob_missing', null, null);
      const path = storagePath(householdId, item.capture_id, part);
      const r = await withAuthRetry(deps, () => deps.upload(path, blob, part.content_type));
      if (!r.ok) {
        if (r.kind === 'permanent') return failed(deps, item, 'storage', r.code ?? null, r.message ?? null);
        return waiting(deps, item, r, 'upload');
      }
      item = await save(deps, item, { uploaded: [...item.uploaded, part.position] });
    }

    // §5.4 langkah 4: W1 submit_capture, idempoten berdasarkan id.
    item = await save(deps, item, { state: 'submitting' });
    const r = await withAuthRetry(deps, () =>
      deps.submit({
        p_capture_id: item.capture_id,
        p_kind: item.kind,
        p_images: item.parts.map((p) => ({
          position: p.position,
          ext: p.ext,
          sha256: p.sha256,
          byte_size: p.byte_size,
        })),
        p_shopping_session_id: item.shopping_session_id,
        p_store_id: item.store_id,
        p_branch_id: item.branch_id,
        p_captured_at: item.captured_at,
      }),
    );
    if (r.ok) {
      // §5.4 langkah 5: byte lokal dihapus; item dihapus setelah R13 memuat capture ini.
      await deps.store.deleteBlobs(item.capture_id);
      return save(deps, item, { state: 'submitted', attempts: 0, last_error: null });
    }
    if (r.kind === 'missing' && round === 0) {
      // F-24: file sudah disapu (unggahan yatim 24 jam) → unggah ulang SEMUA bagian lalu daftar ulang.
      item = await save(deps, item, { uploaded: [] });
      continue;
    }
    if (r.kind === 'permanent') return failed(deps, item, 'rpc', r.code ?? null, r.message ?? null);
    return waiting(deps, item, r, 'submit');
  }
  return item;
}

/** User memilih "Coba lagi" pada item error: mulai lagi dari awal backoff. */
export function resetForRetry(item: OutboxItem, now: number): OutboxItem {
  return { ...item, state: 'captured', attempts: 0, next_attempt_at: now, last_error: null };
}

/** User memilih "Tetap unggah" pada dialog duplikat (U-10). */
export function keepDuplicate(item: OutboxItem, now: number): OutboxItem {
  return { ...item, duplicate: { ...item.duplicate, status: 'keep' }, next_attempt_at: now };
}

/** Waktu paling awal sebuah item menunggu backoff (untuk timer runner). */
export function nextWake(items: OutboxItem[]): number | null {
  const ts = items.filter((i) => i.state === 'waiting_network' && !isHeld(i)).map((i) => i.next_attempt_at);
  return ts.length ? Math.min(...ts) : null;
}
