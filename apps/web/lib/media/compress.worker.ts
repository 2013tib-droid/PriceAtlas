/// <reference lib="webworker" />
// Web Worker kompresi (docs/07 §6.2): kamera tidak membeku saat foto berturut-turut.
import { compressWithOffscreen, DecodeError, type CompressOptions } from './compress-core';

type Req = { id: number; blob: Blob; opts: CompressOptions };

self.onmessage = async (ev: MessageEvent<Req>) => {
  const { id, blob, opts } = ev.data;
  if (typeof OffscreenCanvas === 'undefined' || typeof createImageBitmap !== 'function') {
    self.postMessage({ id, error: 'unsupported' });
    return;
  }
  try {
    const r = await compressWithOffscreen(blob, opts);
    self.postMessage({ id, result: r });
  } catch (e) {
    self.postMessage({ id, error: e instanceof DecodeError ? 'decode' : 'unsupported' });
  }
};
