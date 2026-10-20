// Kapan antrean diproses (docs/07 §5.4): app dibuka, event `online`, `visibilitychange` ke
// terlihat, setelah foto baru, dan timer backoff selama app terbuka. Satu tab saja yang memproses
// (Web Locks; cadangan BroadcastChannel). Background Sync tidak dipakai (P-03).
import type { OutboxItem, OutboxStore } from './outbox-store';
import { isEligible, nextWake, OutboxStoppedError, processItem, type UploaderDeps } from './uploader';

export type Trigger = 'open' | 'online' | 'visible' | 'enqueued' | 'timer' | 'manual';

/** Pemicu yang mengabaikan jadwal backoff (sinyal kembali / user aktif). */
export function isForced(t: Trigger): boolean {
  return t !== 'timer';
}

type Lock = <T>(fn: () => Promise<T>) => Promise<T | undefined>;

/**
 * Kunci satu tab: Web Locks `ifAvailable` (tab lain sedang memproses → lewati; tab itu yang
 * mengunggah). Cadangan tanpa Web Locks: BroadcastChannel "busy" berkala. Balapan di cadangan
 * tidak berbahaya karena unggah (`upsert: false`, "sudah ada" = sukses) dan W1 idempoten.
 */
export function createTabLock(name: string): Lock {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  if (locks?.request) {
    return (fn) =>
      locks.request(name, { ifAvailable: true }, async (lock) => (lock ? fn() : undefined)) as Promise<never>;
  }
  const bc = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(`${name}:lock`) : null;
  let peerBusyAt = 0;
  bc?.addEventListener('message', (e: MessageEvent) => {
    if (e.data === 'busy') peerBusyAt = Date.now();
  });
  return async (fn) => {
    if (Date.now() - peerBusyAt < 5_000) return undefined;
    bc?.postMessage('busy');
    const beat = setInterval(() => bc?.postMessage('busy'), 2_000);
    try {
      return await fn();
    } finally {
      clearInterval(beat);
    }
  };
}

export interface RunnerOptions {
  store: Pick<OutboxStore, 'list'>;
  deps: UploaderDeps;
  lock: Lock;
  /** Dipanggil setelah putaran (mis. muat ulang daftar UI). */
  onIdle?(items: OutboxItem[]): void;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (t: unknown) => void;
}

export class OutboxRunner {
  private running = false;
  private again: Trigger | null = null;
  private timer: unknown = null;
  private stopped = false;
  private readonly setTimer: NonNullable<RunnerOptions['setTimer']>;
  private readonly clearTimer: NonNullable<RunnerOptions['clearTimer']>;

  constructor(private readonly o: RunnerOptions) {
    this.setTimer = o.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = o.clearTimer ?? ((t) => clearTimeout(t as ReturnType<typeof setTimeout>));
  }

  /** Jalankan satu putaran sekarang (atau setelah putaran yang sedang berjalan). */
  async kick(trigger: Trigger): Promise<void> {
    if (this.stopped) return;
    if (this.running) {
      if (!this.again || isForced(trigger)) this.again = trigger;
      return;
    }
    this.running = true;
    try {
      let t: Trigger | null = trigger;
      while (t && !this.stopped) {
        this.again = null;
        await this.o.lock(() => this.round(isForced(t!)));
        t = this.again;
      }
    } finally {
      this.running = false;
    }
    await this.schedule();
  }

  private async round(force: boolean): Promise<void> {
    const { items } = await this.o.store.list();
    for (const item of items) {
      if (this.stopped || !isEligible(item, this.o.deps.now(), force)) continue;
      try {
        await processItem(this.o.deps, item);
      } catch (e) {
        if (e instanceof OutboxStoppedError) return;
        throw e;
      }
      if (!this.o.deps.isOnline()) force = false;
    }
  }

  private async schedule(): Promise<void> {
    if (this.timer) this.clearTimer(this.timer);
    this.timer = null;
    if (this.stopped) return;
    const { items } = await this.o.store.list();
    this.o.onIdle?.(items);
    const at = nextWake(items);
    if (at === null) return;
    this.timer = this.setTimer(() => void this.kick('timer'), Math.max(0, at - this.o.deps.now()));
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) this.clearTimer(this.timer);
    this.timer = null;
  }
}

/** Pasang pemicu browser (online, visibilitychange). Mengembalikan fungsi lepas. */
export function attachBrowserTriggers(runner: Pick<OutboxRunner, 'kick'>): () => void {
  const onOnline = () => void runner.kick('online');
  const onVisible = () => {
    if (document.visibilityState === 'visible') void runner.kick('visible');
  };
  window.addEventListener('online', onOnline);
  document.addEventListener('visibilitychange', onVisible);
  return () => {
    window.removeEventListener('online', onOnline);
    document.removeEventListener('visibilitychange', onVisible);
  };
}
