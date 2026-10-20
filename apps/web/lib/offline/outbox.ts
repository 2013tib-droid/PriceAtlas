// Antrean foto per user (docs/07 §5.4): store IndexedDB + runner + kabar perubahan ke UI dan ke
// tab lain (BroadcastChannel), supaya tab yang memegang kunci memproses foto dari tab lain.
import type { OutboxItem } from './outbox-store';
import { OutboxStore } from './outbox-store';
import { attachBrowserTriggers, createTabLock, OutboxRunner, type Trigger } from './runner';
import { keepDuplicate, resetForRetry, type UploaderDeps } from './uploader';

type Listener = () => void;
type Msg = { type: 'changed' } | { type: 'enqueued' };

export interface Outbox {
  readonly userId: string;
  readonly store: OutboxStore;
  enqueue(entries: { item: OutboxItem; blobs: Map<number, Blob> }[]): Promise<void>;
  /** Cek hash U-10 untuk item ini sekarang (S-07, online). Mengembalikan item terbaru. */
  checkDuplicate(captureId: string): Promise<OutboxItem | null>;
  keepDuplicate(captureId: string): Promise<void>;
  retry(captureId: string): Promise<void>;
  remove(captureId: string): Promise<void>;
  kick(trigger: Trigger): Promise<void>;
  subscribe(fn: Listener): () => void;
  stop(): void;
}

export function createOutbox(
  userId: string,
  deps: Omit<UploaderDeps, 'store' | 'onChange'>,
  store = OutboxStore.forUser(userId),
): Outbox {
  const listeners = new Set<Listener>();
  const bc = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(`priceatlas-outbox:${userId}`) : null;
  let closed = false;
  const notify = (broadcast: Msg | null = { type: 'changed' }) => {
    if (closed) return;
    for (const l of listeners) l();
    if (broadcast) bc?.postMessage(broadcast);
  };
  const fullDeps: UploaderDeps = { ...deps, store, onChange: () => notify(), stopped: () => closed };
  const runner = new OutboxRunner({
    store,
    deps: fullDeps,
    lock: createTabLock(`priceatlas-outbox:${userId}`),
    onIdle: () => notify(null),
  });
  bc?.addEventListener('message', (e: MessageEvent<Msg>) => {
    for (const l of listeners) l();
    if (e.data?.type === 'enqueued') void runner.kick('enqueued');
  });
  const detach = typeof window !== 'undefined' ? attachBrowserTriggers(runner) : () => undefined;

  const update = async (id: string, fn: (i: OutboxItem) => OutboxItem) => {
    const item = await store.get(id);
    if (!item) return null;
    const next = fn(item);
    await store.put(next);
    notify();
    return next;
  };

  return {
    userId,
    store,
    async enqueue(entries) {
      for (const { item, blobs } of entries) await store.add(item, blobs);
      notify({ type: 'enqueued' });
      void runner.kick('enqueued');
    },
    async checkDuplicate(id) {
      const item = await store.get(id);
      if (!item || item.duplicate.status !== 'pending' || !deps.isOnline()) return item;
      const matches = await deps.findDuplicates(
        item.parts.map((p) => p.sha256),
        id,
      );
      if (matches === null) return item;
      return update(id, (i) =>
        i.duplicate.status === 'pending'
          ? { ...i, duplicate: matches.length ? { status: 'found', matches } : { status: 'clear', matches: [] } }
          : i,
      );
    },
    async keepDuplicate(id) {
      await update(id, (i) => keepDuplicate(i, deps.now()));
      void runner.kick('manual');
    },
    async retry(id) {
      await update(id, (i) => resetForRetry(i, deps.now()));
      void runner.kick('manual');
    },
    async remove(id) {
      await store.remove(id);
      notify();
    },
    kick: (t) => runner.kick(t),
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    stop() {
      closed = true;
      runner.stop();
      detach();
      bc?.close();
      listeners.clear();
    },
  };
}
