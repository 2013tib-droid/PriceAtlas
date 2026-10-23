// L5c M4 (docs/07 §11.1): frame jendela bidik → canvas → JPEG → pipeline gambar M2 di Chromium
// sungguhan. Sumber video = canvas.captureStream() (pengganti kamera; getUserMedia memberi
// MediaStream yang sama bentuknya), sehingga <video>, drawImage dari video, toBlob JPEG, aturan lewati
// §6.3, dan sha256 crypto.subtle berjalan seperti di HP.
import { afterEach, describe, expect, it } from 'vitest';
import { FrameNotReadyError, grabFrame, prepareLabelFrame } from '@/lib/media/frame';
import { readImageMeta } from '@/lib/media/image-meta';
import { sha256Hex } from '@/lib/media/sha256';

const cleanups: (() => void)[] = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
});

/** <video> yang memutar canvas berukuran w×h (teks label + derau supaya JPEG tidak trivial). */
async function videoOf(w: number, h: number): Promise<HTMLVideoElement> {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  const paint = (t: number) => {
    ctx.fillStyle = '#fafafa';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#111';
    ctx.font = `${Math.round(h / 10)}px sans-serif`;
    ctx.fillText('MILO ORIGINAL 200G', w * 0.05, h * 0.3);
    ctx.fillText(`Rp17.500 PROMO ${t}`, w * 0.05, h * 0.6);
  };
  paint(0);
  const stream = canvas.captureStream(30);
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.srcObject = stream;
  document.body.append(video);
  let t = 0;
  const timer = setInterval(() => paint(++t), 30);
  cleanups.push(() => {
    clearInterval(timer);
    stream.getTracks().forEach((tr) => tr.stop());
    video.remove();
  });
  await video.play();
  await new Promise<void>((resolve) => {
    const ready = () => (video.readyState >= 2 && video.videoWidth > 0 ? resolve() : requestAnimationFrame(ready));
    ready();
  });
  return video;
}

async function dims(blob: Blob) {
  const b = await createImageBitmap(blob);
  return { width: b.width, height: b.height };
}

describe('frame kamera → foto label (Chromium)', () => {
  it('frame 2560×1440 diskalakan ke sisi panjang 2048 px, JPEG tanpa EXIF', async () => {
    const video = await videoOf(2560, 1440);
    const blob = await grabFrame(video);
    expect(blob.type).toBe('image/jpeg');
    expect(await dims(blob)).toEqual({ width: 2048, height: 1152 });
    const meta = readImageMeta(new Uint8Array(await blob.arrayBuffer()));
    expect(meta.sniffed).toBe('image/jpeg');
    expect(meta.hasGps).toBe(false);
  });

  it('frame kecil tidak diperbesar', async () => {
    const video = await videoOf(640, 480);
    expect(await dims(await grabFrame(video))).toEqual({ width: 640, height: 480 });
  });

  it('prepareLabelFrame: pipeline M2 (aturan lewati: JPEG kecil apa adanya), sha256 byte final, captured_at kamera', async () => {
    const video = await videoOf(1920, 1080);
    const now = new Date('2026-10-23T08:05:00Z');
    const p = await prepareLabelFrame(video, now);
    expect(p.contentType).toBe('image/jpeg');
    expect(p.ext).toBe('jpg');
    expect(p.how).toBe('kept');
    expect(p.byteSize).toBeLessThanOrEqual(1.5 * 1024 * 1024);
    expect(p.sha256).toBe(await sha256Hex(new Uint8Array(await p.blob.arrayBuffer())));
    expect(Date.parse(p.capturedAt!)).toBe(now.getTime());
    expect(await dims(p.blob)).toEqual({ width: 1920, height: 1080 });
  });

  it('video belum punya frame → FrameNotReadyError', async () => {
    const video = document.createElement('video');
    await expect(grabFrame(video)).rejects.toBeInstanceOf(FrameNotReadyError);
  });
});
