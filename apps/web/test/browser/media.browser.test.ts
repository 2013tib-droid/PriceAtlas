// L5c (docs/07 §11.1): pipeline gambar di Chromium sungguhan — kanvas/OffscreenCanvas + Web Worker,
// EXIF (termasuk GPS) dibuang, orientasi diterapkan, sha256 crypto.subtle, aturan lewati (F-23)
// dengan fixture worker, dan IndexedDB nyata untuk antrean.
import { describe, expect, it } from 'vitest';
import { compressImage } from '@/lib/media/compress';
import { readImageMeta } from '@/lib/media/image-meta';
import { prepareImage } from '@/lib/media/prepare';
import { sha256Hex } from '@/lib/media/sha256';
import { deleteUserData } from '@/lib/offline/db';
import { newItem, OutboxStore } from '@/lib/offline/outbox-store';
import { insertExif } from '../m2/images';

/** sha256 fixture apps/worker/test/fixtures/struk-aeon.jpg (StubExtractor memetakan lewat hash ini). */
const STRUK_AEON_SHA = 'a379bc9890e08149a13ee12729115308910433afd49e5951ac2d6a0ce30e6f98';

async function canvasImage(w: number, h: number, type: 'image/jpeg' | 'image/png', quality = 0.9): Promise<Uint8Array> {
  const c = new OffscreenCanvas(w, h);
  const ctx = c.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, '#fff');
  g.addColorStop(1, '#888');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#000';
  ctx.font = `${Math.round(h / 20)}px sans-serif`;
  for (let y = 40; y < h; y += Math.round(h / 15)) ctx.fillText(`MILO ORI 500G 47.500 baris ${y}`, 20, y);
  // Derau supaya JPEG besar (memaksa langkah kualitas/target).
  const img = ctx.getImageData(0, 0, w, Math.min(h, 400));
  for (let i = 0; i < img.data.length; i += 4) img.data[i] = (i * 7919) % 255;
  ctx.putImageData(img, 0, 0);
  const blob = await c.convertToBlob({ type, quality });
  return new Uint8Array(await blob.arrayBuffer());
}

const asFile = (bytes: Uint8Array, name: string, type: string) =>
  new File([bytes as Uint8Array<ArrayBuffer>], name, { type, lastModified: Date.parse('2026-10-19T03:00:00Z') });

async function dims(blob: Blob) {
  const b = await createImageBitmap(blob);
  return { width: b.width, height: b.height };
}

describe('kompresi nyata (§6.2)', () => {
  it('foto struk besar ber-GPS → JPEG ≤ 2560 px, ≤ 1,5 MB, GPS & EXIF hilang, waktu dari EXIF', async () => {
    const raw = insertExif(await canvasImage(4000, 3000, 'image/jpeg', 0.98), {
      orientation: 1,
      date: '2026:10:12 14:05:33',
      offset: '+07:00',
      gps: true,
    });
    expect(readImageMeta(raw).hasGps).toBe(true);
    const out = await prepareImage(asFile(raw, 'struk.jpg', 'image/jpeg'), { kind: 'receipt', source: 'gallery' });
    expect(out.how).toBe('compressed');
    expect(out.contentType).toBe('image/jpeg');
    expect(out.byteSize).toBeLessThanOrEqual(1.5 * 1024 * 1024);
    const bytes = new Uint8Array(await out.blob.arrayBuffer());
    const meta = readImageMeta(bytes);
    expect(meta).toMatchObject({ sniffed: 'image/jpeg', hasGps: false, dateTimeOriginal: null, orientation: null });
    expect(Math.max(meta.width!, meta.height!)).toBe(2560);
    expect(out.capturedAt).toBe('2026-10-12T14:05:33+07:00');
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
    expect(out.sha256).toBe([...digest].map((x) => x.toString(16).padStart(2, '0')).join(''));
  });

  it('label/screenshot: sisi panjang 2048', async () => {
    const raw = await canvasImage(2600, 1200, 'image/jpeg', 0.8);
    const out = await prepareImage(asFile(raw, 'label.jpg', 'image/jpeg'), { kind: 'price_label', source: 'gallery' });
    expect(out.how).toBe('compressed');
    expect(await dims(out.blob)).toEqual({ width: 2048, height: 945 });
  });

  it('Orientation EXIF diterapkan saat menulis ulang (foto HP tegak)', async () => {
    const raw = insertExif(await canvasImage(400, 200, 'image/jpeg'), { orientation: 6, gps: true });
    const out = await prepareImage(asFile(raw, 'tegak.jpg', 'image/jpeg'), { kind: 'receipt', source: 'camera' });
    expect(out.how).toBe('compressed');
    expect(await dims(out.blob)).toEqual({ width: 200, height: 400 });
  });

  it('Web Worker + OffscreenCanvas tersedia dan dipakai', async () => {
    expect(typeof OffscreenCanvas).toBe('function');
    const raw = await canvasImage(3000, 1000, 'image/jpeg');
    const r = await compressImage(new Blob([raw as Uint8Array<ArrayBuffer>], { type: 'image/jpeg' }), {
      maxSide: 1500,
      quality: 0.85,
    });
    expect({ w: r.width, h: r.height }).toEqual({ w: 1500, h: 500 });
  });
});

describe('aturan lewati kompresi §6.3 (F-23)', () => {
  it('JPEG kecil tanpa GPS, sisi ≤ batas → byte asli (hash sama)', async () => {
    const raw = await canvasImage(800, 600, 'image/jpeg');
    const out = await prepareImage(asFile(raw, 'kecil.jpg', 'image/jpeg'), { kind: 'receipt', source: 'gallery' });
    expect(out.how).toBe('kept');
    expect(new Uint8Array(await out.blob.arrayBuffer())).toEqual(raw);
    expect(out.sha256).toBe(await sha256Hex(raw));
  });

  it('screenshot PNG tinggi ≤ 1,5 MB tetap PNG', async () => {
    const raw = await canvasImage(1080, 2400, 'image/png');
    const out = await prepareImage(asFile(raw, 's.png', 'image/png'), { kind: 'marketplace', source: 'gallery' });
    expect(out).toMatchObject({ how: 'kept', contentType: 'image/png', ext: 'png' });
  });

  it('fixture worker struk-aeon.jpg (JPEG sintetis kecil, F-118) → aturan lewati: byte apa adanya, sha256 = fixture stub', async () => {
    const res = await fetch(new URL('../../../worker/test/fixtures/struk-aeon.jpg', import.meta.url));
    const raw = new Uint8Array(await res.arrayBuffer());
    const out = await prepareImage(asFile(raw, 'struk-aeon.jpg', 'image/jpeg'), { kind: 'receipt', source: 'gallery' });
    expect(out.how).toBe('kept');
    expect(out.ext).toBe('jpg');
    expect(out.sha256).toBe(STRUK_AEON_SHA);
    expect(new Uint8Array(await out.blob.arrayBuffer())).toEqual(raw);
  });
});

describe('IndexedDB nyata (antrean)', () => {
  it('byte gambar disimpan dan dibaca kembali utuh; hapus menghapus byte', async () => {
    const user = 'browser-test-user';
    await deleteUserData(user);
    const store = OutboxStore.forUser(user);
    const raw = await canvasImage(300, 200, 'image/jpeg');
    const item = newItem({
      capture_id: crypto.randomUUID(),
      kind: 'receipt',
      household_id: null,
      shopping_session_id: null,
      store_id: null,
      branch_id: null,
      captured_at: null,
      parts: [
        { position: 1, ext: 'jpg', content_type: 'image/jpeg', sha256: await sha256Hex(raw), byte_size: raw.length },
      ],
    });
    await store.add(item, new Map([[1, new Blob([raw as Uint8Array<ArrayBuffer>], { type: 'image/jpeg' })]]));
    const back = await store.getBlob(item.capture_id, 1);
    expect(back).toBeInstanceOf(Blob);
    expect(await sha256Hex(await back!.arrayBuffer())).toBe(item.parts[0]!.sha256);
    await store.remove(item.capture_id);
    expect(await store.getBlob(item.capture_id, 1)).toBeNull();
    await deleteUserData(user);
  });
});
