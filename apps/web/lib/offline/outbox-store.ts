// Antrean foto di IndexedDB (docs/07 §5.3–§5.4, D-59, U-17): store `outbox` (item + status) dan
// `outbox_blobs` (byte gambar final per bagian). Byte disimpan sampai submit_capture sukses (F-24).
// Setiap item punya schemaVersion (P-12): item versi lama dimigrasi saat dibaca.
import type { CaptureKind } from '@/lib/media/image-plan';
import { openUserDb, type UserDb } from './db';

export const OUTBOX_SCHEMA_VERSION = 1;

/** captured → uploading(i/n) → submitting → submitted; waiting_network / error (§5.4). */
export type OutboxState = 'captured' | 'uploading' | 'submitting' | 'submitted' | 'waiting_network' | 'error';

export interface OutboxPart {
  position: number;
  ext: 'jpg' | 'jpeg' | 'png' | 'webp' | 'heic';
  content_type: string;
  sha256: string;
  byte_size: number;
}

export type OutboxErrorKind = 'network' | 'auth' | 'missing' | 'storage' | 'rpc' | 'blob_missing' | 'unknown';

export interface DuplicateMatch {
  capture_id: string;
  created_at: string;
}

export interface OutboxItem {
  schemaVersion: typeof OUTBOX_SCHEMA_VERSION;
  capture_id: string;
  kind: CaptureKind;
  /** Diisi dari R1 saat foto diambil; jika belum ada (offline pertama kali), diisi saat unggah. */
  household_id: string | null;
  shopping_session_id: string | null;
  store_id: string | null;
  branch_id: string | null;
  captured_at: string | null;
  created_at: number;
  parts: OutboxPart[];
  /** Posisi yang sudah ada di Storage. */
  uploaded: number[];
  state: OutboxState;
  /** Kegagalan beruntun (dasar backoff 5 dtk / 30 dtk / 2 mnt / 10 mnt). */
  attempts: number;
  next_attempt_at: number;
  last_error: { kind: OutboxErrorKind; code: string | null; message: string | null } | null;
  /**
   * Cek hash U-10 (§5.4 langkah 2): pending (belum dicek, mis. offline) → clear / found (ditahan,
   * user memilih di S-07/S-08) → keep (user memilih "Tetap unggah").
   */
  duplicate: { status: 'pending' | 'clear' | 'found' | 'keep'; matches: DuplicateMatch[] };
}

export type NewOutboxItem = Pick<
  OutboxItem,
  'capture_id' | 'kind' | 'household_id' | 'shopping_session_id' | 'store_id' | 'branch_id' | 'captured_at' | 'parts'
> & { created_at?: number };

export function newItem(n: NewOutboxItem, now = Date.now()): OutboxItem {
  return {
    schemaVersion: OUTBOX_SCHEMA_VERSION,
    ...n,
    created_at: n.created_at ?? now,
    uploaded: [],
    state: 'captured',
    attempts: 0,
    next_attempt_at: now,
    last_error: null,
    duplicate: { status: 'pending', matches: [] },
  };
}

/**
 * Migrasi item lama ke versi sekarang (P-12). Versi 1 adalah versi pertama; item tanpa
 * schemaVersion atau dari versi yang lebih baru (app lebih lama dari data) tidak disentuh dan
 * ditandai `null` supaya tidak diproses, tetapi tetap tampil dan bisa dihapus.
 */
export function migrateItem(raw: unknown): OutboxItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const v = (raw as { schemaVersion?: unknown }).schemaVersion;
  if (v === OUTBOX_SCHEMA_VERSION) return raw as OutboxItem;
  return null;
}

export class OutboxStore {
  constructor(private readonly db: () => Promise<UserDb>) {}

  static forUser(userId: string): OutboxStore {
    return new OutboxStore(() => openUserDb(userId));
  }

  /** Item + byte disimpan dalam satu transaksi, sebelum apa pun dikirim (§5.4 langkah 1). */
  async add(item: OutboxItem, blobs: Map<number, Blob>): Promise<void> {
    const db = await this.db();
    const tx = db.transaction(['outbox', 'outbox_blobs'], 'readwrite');
    await tx.objectStore('outbox').put(item as never);
    for (const [position, blob] of blobs)
      await tx.objectStore('outbox_blobs').put({ capture_id: item.capture_id, position, blob });
    await tx.done;
  }

  /** Semua item (terlama dulu). Item yang tidak bisa dimigrasi dikembalikan terpisah. */
  async list(): Promise<{ items: OutboxItem[]; unreadable: string[] }> {
    const db = await this.db();
    const raw = await db.getAll('outbox');
    const items: OutboxItem[] = [];
    const unreadable: string[] = [];
    for (const r of raw) {
      const m = migrateItem(r);
      if (m) items.push(m);
      else unreadable.push(String((r as { capture_id?: unknown }).capture_id));
    }
    items.sort((a, b) => a.created_at - b.created_at);
    return { items, unreadable };
  }

  async get(captureId: string): Promise<OutboxItem | null> {
    const db = await this.db();
    return migrateItem(await db.get('outbox', captureId));
  }

  async put(item: OutboxItem): Promise<void> {
    const db = await this.db();
    await db.put('outbox', item as never);
  }

  async getBlob(captureId: string, position: number): Promise<Blob | null> {
    const db = await this.db();
    return (await db.get('outbox_blobs', [captureId, position]))?.blob ?? null;
  }

  async deleteBlobs(captureId: string): Promise<void> {
    const db = await this.db();
    const tx = db.transaction('outbox_blobs', 'readwrite');
    let cur = await tx.store.openCursor(IDBKeyRange.bound([captureId, 0], [captureId, Infinity]));
    while (cur) {
      await cur.delete();
      cur = await cur.continue();
    }
    await tx.done;
  }

  /** Hapus item + byte (aksi user "Hapus", atau setelah R13 memuat capture yang sudah dikirim). */
  async remove(captureId: string): Promise<void> {
    await this.deleteBlobs(captureId);
    const db = await this.db();
    await db.delete('outbox', captureId);
  }

  /** Total byte gambar yang masih di perangkat (peringatan > 50 MB, D-81). */
  async totalBytes(): Promise<number> {
    const { items } = await this.list();
    return items
      .filter((i) => i.state !== 'submitted')
      .reduce((n, i) => n + i.parts.reduce((m, p) => m + p.byte_size, 0), 0);
  }
}

export const QUEUE_WARN_BYTES = 50 * 1024 * 1024;
/** Teks "buka app untuk mengunggah" jika antrean lebih tua dari 1 jam (§5.8). */
export const QUEUE_STALE_MS = 60 * 60_000;

/** Jalur Storage `{household_id}/{capture_id}/{position}.{ext}` (D-69, policy captures_insert). */
export function storagePath(
  householdId: string,
  captureId: string,
  part: Pick<OutboxPart, 'position' | 'ext'>,
): string {
  return `${householdId}/${captureId}/${part.position}.${part.ext}`;
}
