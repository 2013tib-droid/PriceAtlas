// Kompresi di Web Worker + OffscreenCanvas, cadangan thread utama (docs/07 §6.2).
import { compressOnMainThread, DecodeError, type CompressOptions, type CompressResult } from './compress-core';

let worker: Worker | null | undefined;
let seq = 0;
const pending = new Map<number, { resolve: (r: CompressResult) => void; reject: (e: unknown) => void }>();

function getWorker(): Worker | null {
  if (worker !== undefined) return worker;
  try {
    worker = new Worker(new URL('./compress.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (ev: MessageEvent<{ id: number; result?: CompressResult; error?: string }>) => {
      const p = pending.get(ev.data.id);
      if (!p) return;
      pending.delete(ev.data.id);
      if (ev.data.result) p.resolve(ev.data.result);
      else p.reject(new WorkerFailure(ev.data.error ?? 'unsupported'));
    };
    worker.onerror = () => {
      for (const p of pending.values()) p.reject(new WorkerFailure('crashed'));
      pending.clear();
      worker?.terminate();
      worker = null;
    };
  } catch {
    worker = null;
  }
  return worker;
}

class WorkerFailure extends Error {}

function viaWorker(w: Worker, blob: Blob, opts: CompressOptions): Promise<CompressResult> {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    w.postMessage({ id, blob, opts });
  });
}

/**
 * Kompres ke JPEG. Gagal decode di worker dicoba sekali lagi di thread utama (elemen <img> bisa
 * mendekode format yang tidak bisa dibaca createImageBitmap di worker, mis. HEIC di Safari lama).
 * Melempar DecodeError jika browser tidak bisa mendekode file sama sekali.
 */
export async function compressImage(blob: Blob, opts: CompressOptions): Promise<CompressResult> {
  const w = typeof Worker !== 'undefined' ? getWorker() : null;
  if (w) {
    try {
      return await viaWorker(w, blob, opts);
    } catch (e) {
      if (!(e instanceof WorkerFailure)) throw e;
    }
  }
  return compressOnMainThread(blob, opts);
}

export { DecodeError };
