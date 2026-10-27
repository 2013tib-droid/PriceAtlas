// L5a M2: aturan pipeline gambar (docs/07 §6.2–§6.4, F-23) — logika saja; kompresi nyata di L5c.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { uuidV4FromRandom } from '@/lib/media/capture-id';
import { exifDateToIso, readImageMeta, sniffMime } from '@/lib/media/image-meta';
import {
  IMAGE_LIMITS,
  planImage,
  planUndecodable,
  qualitySteps,
  resolveMime,
  scaledSize,
} from '@/lib/media/image-plan';
import { capturedAtFor } from '@/lib/media/prepare';
import { sha256Hex, sha256Js } from '@/lib/media/sha256';
import { jpegWithExif, pngBytes, webpVp8x } from './images';

const MB = 1024 * 1024;
const FIXTURE = resolve(import.meta.dirname, '../../../worker/test/fixtures/struk-aeon.jpg');

describe('pembaca metadata (EXIF kecil buatan sendiri)', () => {
  it('JPEG: ukuran dari SOF, Orientation, DateTimeOriginal + offset, GPS', () => {
    const b = jpegWithExif({
      width: 3000,
      height: 4000,
      orientation: 6,
      date: '2026:10:12 14:05:33',
      offset: '+07:00',
      gps: true,
    });
    expect(readImageMeta(b)).toEqual({
      sniffed: 'image/jpeg',
      width: 3000,
      height: 4000,
      orientation: 6,
      dateTimeOriginal: '2026:10:12 14:05:33',
      offsetTimeOriginal: '+07:00',
      hasGps: true,
    });
  });

  it('JPEG big-endian (MM) tanpa GPS', () => {
    const b = jpegWithExif({ width: 800, height: 600, orientation: 1, date: '2026:01:02 03:04:05', bigEndian: true });
    const m = readImageMeta(b);
    expect(m).toMatchObject({
      width: 800,
      height: 600,
      orientation: 1,
      hasGps: false,
      dateTimeOriginal: '2026:01:02 03:04:05',
    });
  });

  it('PNG (IHDR) dan WebP (VP8X)', () => {
    expect(readImageMeta(pngBytes(1080, 2400))).toMatchObject({ sniffed: 'image/png', width: 1080, height: 2400 });
    expect(readImageMeta(webpVp8x(1500, 900))).toMatchObject({ sniffed: 'image/webp', width: 1500, height: 900 });
  });

  it('fixture worker struk-aeon.jpg = JPEG sintetis kecil (F-118): jenis & ukuran terbaca, tanpa GPS', () => {
    const b = new Uint8Array(readFileSync(FIXTURE));
    expect(sniffMime(b)).toBe('image/jpeg');
    expect(readImageMeta(b)).toMatchObject({ sniffed: 'image/jpeg', width: 492, height: 431, hasGps: false });
  });

  it('data rusak tidak melempar', () => {
    const b = jpegWithExif({ width: 10, height: 10 }).slice(0, 30);
    expect(() => readImageMeta(b)).not.toThrow();
  });
});

describe('aturan lewati kompresi §6.3 + rencana §6.2', () => {
  const base = {
    mime: 'image/jpeg' as const,
    size: MB,
    width: 2000,
    height: 1500,
    hasGps: false,
    kind: 'receipt' as const,
  };

  it('JPEG ≤ 1,5 MB, sisi ≤ batas, tanpa GPS → apa adanya', () => {
    expect(planImage(base)).toEqual({ action: 'keep', reason: 'small' });
    expect(planImage({ ...base, mime: 'image/webp', width: 2560 })).toEqual({ action: 'keep', reason: 'small' });
  });

  it('salah satu syarat gagal → kompres (GPS, > 1,5 MB, sisi > batas, ukuran tidak terbaca)', () => {
    expect(planImage({ ...base, hasGps: true })).toMatchObject({ action: 'compress' });
    expect(planImage({ ...base, size: IMAGE_LIMITS.targetBytes + 1 })).toMatchObject({ action: 'compress' });
    expect(planImage({ ...base, width: 2561 })).toMatchObject({ action: 'compress', maxSide: 2560, quality: 0.88 });
    expect(planImage({ ...base, width: null, height: null })).toMatchObject({ action: 'compress' });
  });

  it('batas sisi: struk 2560, label/screenshot 2048; kualitas 0,88 / 0,85', () => {
    expect(planImage({ ...base, kind: 'price_label', width: 2049 })).toEqual({
      action: 'compress',
      maxSide: 2048,
      quality: 0.85,
    });
    expect(planImage({ ...base, kind: 'price_label', width: 2048 })).toEqual({ action: 'keep', reason: 'small' });
  });

  it('screenshot PNG ≤ 1,5 MB tetap PNG walau tinggi; > 1,5 MB → JPEG 0,9', () => {
    const png = { ...base, mime: 'image/png' as const, kind: 'marketplace' as const, width: 1080, height: 2400 };
    expect(planImage(png)).toEqual({ action: 'keep', reason: 'screenshot_png' });
    expect(planImage({ ...png, size: 2 * MB })).toEqual({ action: 'compress', maxSide: 2048, quality: 0.9 });
  });

  it('HEIC selalu dicoba didekode; gagal decode → apa adanya ≤ 10 MB, selain itu ditolak (P-07)', () => {
    expect(planImage({ ...base, mime: 'image/heic', width: null, height: null })).toMatchObject({ action: 'compress' });
    expect(planUndecodable('image/heic', 9 * MB)).toEqual({ action: 'keep', reason: 'small' });
    expect(planUndecodable('image/heic', 11 * MB)).toEqual({ action: 'reject', reason: 'heic_too_big' });
    expect(planUndecodable('image/jpeg', 11 * MB)).toEqual({ action: 'reject', reason: 'too_big' });
  });

  it('format tidak didukung / kosong ditolak; jenis dari magic bytes lalu file.type', () => {
    expect(planImage({ ...base, mime: null })).toEqual({ action: 'reject', reason: 'type' });
    expect(planImage({ ...base, size: 0 })).toEqual({ action: 'reject', reason: 'empty' });
    expect(resolveMime({ sniffed: null }, 'image/gif')).toBeNull();
    expect(resolveMime({ sniffed: null }, 'image/jpeg')).toBe('image/jpeg');
    expect(resolveMime({ sniffed: null }, 'image/heif')).toBe('image/heic');
    expect(resolveMime({ sniffed: 'image/png' }, 'image/jpeg')).toBe('image/png');
  });

  it('skala tidak memperbesar; langkah kualitas sampai 0,65', () => {
    expect(scaledSize(4000, 3000, 2560)).toEqual({ width: 2560, height: 1920 });
    expect(scaledSize(800, 600, 2560)).toEqual({ width: 800, height: 600 });
    expect(qualitySteps(0.88)).toEqual([0.88, 0.8, 0.72]);
  });
});

describe('p_captured_at (§6.2)', () => {
  const now = new Date('2026-10-20T05:00:00Z');
  it('kamera → waktu sekarang; galeri → EXIF → lastModified → kosong', () => {
    expect(
      new Date(
        capturedAtFor('camera', { dateTimeOriginal: '2020:01:01 00:00:00', offsetTimeOriginal: null }, 1, now)!,
      ).getTime(),
    ).toBe(now.getTime());
    expect(
      capturedAtFor('gallery', { dateTimeOriginal: '2026:10:12 14:05:33', offsetTimeOriginal: '+07:00' }, 1, now),
    ).toBe('2026-10-12T14:05:33+07:00');
    const lm = Date.parse('2026-10-11T01:00:00Z');
    expect(
      new Date(capturedAtFor('gallery', { dateTimeOriginal: null, offsetTimeOriginal: null }, lm, now)!).getTime(),
    ).toBe(lm);
    expect(capturedAtFor('gallery', { dateTimeOriginal: null, offsetTimeOriginal: null }, undefined, now)).toBeNull();
  });
  it('EXIF tanpa offset = zona perangkat; tanggal kosong/0000 → null', () => {
    const iso = exifDateToIso('2026:10:12 14:05:33', null)!;
    expect(iso).toMatch(/^2026-10-12T14:05:33[+-]\d{2}:\d{2}$/);
    expect(exifDateToIso('0000:00:00 00:00:00', null)).toBeNull();
    expect(exifDateToIso(null, null)).toBeNull();
  });
});

describe('sha256 dan capture_id', () => {
  it('sha256Hex = node crypto; cadangan JS sama', async () => {
    const data = new Uint8Array(readFileSync(FIXTURE));
    const expected = createHash('sha256').update(data).digest('hex');
    expect(await sha256Hex(data)).toBe(expected);
    expect(Buffer.from(sha256Js(data)).toString('hex')).toBe(expected);
    const big = new Uint8Array(200_000).map((_, i) => i * 7);
    expect(Buffer.from(sha256Js(big)).toString('hex')).toBe(createHash('sha256').update(big).digest('hex'));
  });
  it('UUID v4 cadangan tanpa secure context (P-10)', () => {
    const id = uuidV4FromRandom((b) => b.fill(0xff));
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
