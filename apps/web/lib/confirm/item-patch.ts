// Antrean W18 update_capture_item per item (docs/07 §7.3 S-11, docs/05 §4.2): perubahan user
// digabung lalu dikirim setelah jeda (debounce) dengan p_expected_updated_at versi terakhir.
// STALE_WRITE (item diubah di tempat lain) → muat ulang item terbaru, lalu kirim ulang hanya
// perubahan user yang masih berlaku (nilainya berbeda dari versi terbaru) — §8.2 "perubahan user
// ditampilkan ulang di form jika masih berlaku". Satu permintaan per item dalam satu waktu.
import type { CaptureItem, RpcInput } from '@priceatlas/contracts';
import { toAppError } from '@/lib/data/errors';

export type ItemPatch = RpcInput<'update_capture_item'>['p_patch'];

export const PATCH_DEBOUNCE_MS = 600;

export interface ItemPatchDeps {
  send(itemId: string, patch: ItemPatch, expectedUpdatedAt: string): Promise<CaptureItem>;
  /** Versi terbaru item dari server (R16), untuk konflik. */
  reload(itemId: string): Promise<CaptureItem | undefined>;
  /** Item terbaru dari server (hasil W18 atau muat ulang). */
  onItem(item: CaptureItem): void;
  /** conflict: STALE_WRITE (sudah dimuat ulang); error: gagal lain (patch dibuang). */
  onError(itemId: string, error: unknown, kind: 'conflict' | 'error'): void;
  /** Patch berubah: ada/tidak ada perubahan yang belum terkirim (indikator "Menghitung…"). */
  onPending?(itemId: string, pending: boolean): void;
  delayMs?: number;
}

type Entry = {
  updatedAt: string;
  patch: ItemPatch;
  timer: ReturnType<typeof setTimeout> | null;
  inflight: Promise<void> | null;
};

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** Kunci patch yang nilainya masih berbeda dari item terbaru. */
export function stillApplicable(patch: ItemPatch, latest: CaptureItem): ItemPatch {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) {
    const current = k === 'product_id' ? latest.suggested_product_id : (latest as Record<string, unknown>)[k];
    if (!same(v, current)) out[k] = v;
  }
  return out as ItemPatch;
}

export class ItemPatchQueue {
  private entries = new Map<string, Entry>();
  private disposed = false;

  constructor(private readonly deps: ItemPatchDeps) {}

  /** Gabungkan perubahan untuk item (versi yang sedang ditampilkan) dan jadwalkan kirim. */
  set(item: Pick<CaptureItem, 'id' | 'updated_at'>, patch: ItemPatch): void {
    const e = this.entries.get(item.id) ?? { updatedAt: item.updated_at, patch: {}, timer: null, inflight: null };
    // Versi yang ditampilkan lebih baru dari yang dikenal antrean (mis. muat ulang R16).
    if (!e.inflight && Date.parse(item.updated_at) > Date.parse(e.updatedAt)) e.updatedAt = item.updated_at;
    e.patch = { ...e.patch, ...patch };
    this.entries.set(item.id, e);
    this.deps.onPending?.(item.id, true);
    if (e.timer) clearTimeout(e.timer);
    e.timer = setTimeout(() => void this.flush(item.id), this.deps.delayMs ?? PATCH_DEBOUNCE_MS);
  }

  pending(itemId: string): boolean {
    const e = this.entries.get(itemId);
    return Boolean(e && (e.inflight || Object.keys(e.patch).length));
  }

  /** Kirim sekarang (semua item jika tanpa id). Selesai setelah tidak ada lagi yang tertunda. */
  async flush(itemId?: string): Promise<void> {
    if (itemId === undefined) {
      await Promise.all([...this.entries.keys()].map((id) => this.flush(id)));
      return;
    }
    const e = this.entries.get(itemId);
    if (!e) return;
    if (e.timer) {
      clearTimeout(e.timer);
      e.timer = null;
    }
    while (e.inflight) await e.inflight;
    if (!Object.keys(e.patch).length || this.disposed) {
      this.deps.onPending?.(itemId, false);
      return;
    }
    const patch = e.patch;
    e.patch = {};
    e.inflight = this.send(itemId, e, patch).finally(() => {
      e.inflight = null;
    });
    await e.inflight;
    // Perubahan baru selama permintaan berjalan.
    if (Object.keys(e.patch).length) await this.flush(itemId);
    else this.deps.onPending?.(itemId, false);
  }

  private async send(itemId: string, e: Entry, patch: ItemPatch, retried = false): Promise<void> {
    try {
      const item = await this.deps.send(itemId, patch, e.updatedAt);
      e.updatedAt = item.updated_at;
      this.deps.onItem(item);
    } catch (err) {
      const code = toAppError(err).code;
      if (code !== 'STALE_WRITE' || retried) {
        this.deps.onError(itemId, err, 'error');
        return;
      }
      const latest = await this.deps.reload(itemId).catch(() => undefined);
      if (!latest) {
        this.deps.onError(itemId, err, 'error');
        return;
      }
      e.updatedAt = latest.updated_at;
      this.deps.onItem(latest);
      this.deps.onError(itemId, err, 'conflict');
      const again = latest.status === 'pending' ? stillApplicable(patch, latest) : {};
      if (Object.keys(again).length) await this.send(itemId, e, again, true);
    }
  }

  dispose(): void {
    this.disposed = true;
    for (const e of this.entries.values()) if (e.timer) clearTimeout(e.timer);
    this.entries.clear();
  }
}
