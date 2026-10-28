// L2 (docs/08 §6, §13.2): prepareImages — magic bytes, dekode, orientasi EXIF, metadata/GPS
// dibuang, ukuran, validasi, bom piksel. Gambar uji dibuat sharp di memori (sintetis).
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import sharp, { type Sharp } from 'sharp';
import { describe, expect, it } from 'vitest';
import { IMAGE_RULES, UNREADABLE_MESSAGE, prepareImage, prepareImages, sniffImageType } from '../src/images/prepare.ts';
import { PermanentError, type ImageBlob } from '../src/pipeline/types.ts';
import { FIXTURES_DIR } from './helpers.ts';

const HEIC_SAMPLE = resolve(FIXTURES_DIR, 'heic/sample.heic');

/** Kiri merah, kanan biru (untuk memeriksa arah rotasi). */
async function twoTone(
  width: number,
  height: number,
  format: 'jpeg' | 'png' | 'webp',
  exif?: Parameters<Sharp['withExif']>[0],
  orientation?: number,
) {
  const half = Math.floor(width / 2);
  let img = sharp({ create: { width, height, channels: 3, background: '#0000ff' } }).composite([
    { input: { create: { width: half, height, channels: 3, background: '#ff0000' } }, left: 0, top: 0 },
  ]);
  if (exif) img = img.withExif(exif);
  if (orientation) img = img.withMetadata({ orientation });
  return img.toFormat(format).toBuffer();
}

async function pixel(buf: Buffer, x: number, y: number) {
  const { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true });
  const i = (y * info.width + x) * info.channels;
  return [data[i]!, data[i + 1]!, data[i + 2]!];
}

const isRed = ([r, g, b]: number[]) => r! > 200 && g! < 60 && b! < 60;
const isBlue = ([r, g, b]: number[]) => b! > 200 && r! < 60 && g! < 60;

const unsupported = expect.objectContaining({ name: 'PermanentError', code: 'unsupported', message: UNREADABLE_MESSAGE });

describe('magic bytes (ekstensi diabaikan)', () => {
  it('JPEG, PNG, WebP, HEIC; lainnya null', async () => {
    expect(sniffImageType(await twoTone(300, 300, 'jpeg'))).toBe('jpeg');
    expect(sniffImageType(await twoTone(300, 300, 'png'))).toBe('png');
    expect(sniffImageType(await twoTone(300, 300, 'webp'))).toBe('webp');
    const ftyp = (brand: string) => Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from(`ftyp${brand}`), Buffer.alloc(16)]);
    for (const brand of ['heic', 'heix', 'hevc', 'mif1', 'msf1']) expect(sniffImageType(ftyp(brand))).toBe('heic');
    expect(sniffImageType(ftyp('avif'))).toBeNull();
    expect(sniffImageType(Buffer.from('GIF89a......'))).toBeNull();
    expect(sniffImageType(Buffer.from('%PDF-1.7'))).toBeNull();
    expect(sniffImageType(Buffer.alloc(0))).toBeNull();
  });
});

describe('dekode + encode', () => {
  it('JPEG kecil: tetap ukuran, JPEG tanpa metadata', async () => {
    const p = await prepareImage(await twoTone(800, 600, 'jpeg'));
    expect(p).toMatchObject({ mediaType: 'image/jpeg', width: 800, height: 600, sourceType: 'jpeg' });
    const m = await sharp(p.data).metadata();
    expect(m.format).toBe('jpeg');
    expect(m.exif).toBeUndefined();
    expect(m.icc).toBeUndefined();
  });

  it('WebP → JPEG', async () => {
    expect(await prepareImage(await twoTone(640, 480, 'webp'))).toMatchObject({ mediaType: 'image/jpeg', sourceType: 'webp' });
  });

  it('PNG kecil (screenshot) tetap PNG lossless; PNG besar → JPEG', async () => {
    const small = await prepareImage(await twoTone(540, 1170, 'png'));
    expect(small).toMatchObject({ mediaType: 'image/png', width: 540, height: 1170 });
    const noise = randomBytes(1400 * 1400 * 3);
    const big = await sharp(noise, { raw: { width: 1400, height: 1400, channels: 3 } }).png().toBuffer();
    expect(big.length).toBeGreaterThan(IMAGE_RULES.pngKeepMaxBytes);
    expect(await prepareImage(big)).toMatchObject({ mediaType: 'image/jpeg', sourceType: 'png' });
  });

  it('PNG transparan → latar putih saat jadi JPEG', async () => {
    const noise = randomBytes(1300 * 1300 * 4);
    for (let i = 3; i < noise.length; i += 4) noise[i] = 0;
    const png = await sharp(noise, { raw: { width: 1300, height: 1300, channels: 4 } }).png({ compressionLevel: 0 }).toBuffer();
    const p = await prepareImage(png);
    expect(p.mediaType).toBe('image/jpeg');
    expect((await pixel(p.data, 10, 10)).every((c) => c > 240)).toBe(true);
  });

  it('sisi panjang > 2576 dikecilkan, rasio tetap', async () => {
    const p = await prepareImage(await twoTone(4032, 3024, 'jpeg'));
    expect([p.width, p.height]).toEqual([2576, 1932]);
  });
});

describe('orientasi EXIF dan metadata', () => {
  it('Orientation 6 (putar 90° searah jarum jam): kiri jadi atas', async () => {
    const p = await prepareImage(await twoTone(400, 300, 'jpeg', undefined, 6));
    expect([p.width, p.height]).toEqual([300, 400]);
    expect(isRed(await pixel(p.data, 150, 20))).toBe(true);
    expect(isBlue(await pixel(p.data, 150, 380))).toBe(true);
  });

  it('Orientation 8 (putar 90° berlawanan): kiri jadi bawah', async () => {
    const p = await prepareImage(await twoTone(400, 300, 'jpeg', undefined, 8));
    expect([p.width, p.height]).toEqual([300, 400]);
    expect(isBlue(await pixel(p.data, 150, 20))).toBe(true);
    expect(isRed(await pixel(p.data, 150, 380))).toBe(true);
  });

  it('EXIF GPS dibuang (tidak pernah dikirim ke API)', async () => {
    const src = await twoTone(400, 300, 'jpeg', {
      IFD0: { Make: 'Ponsel Uji' },
      IFD3: { GPSLatitudeRef: 'S', GPSLatitude: '6/1 10/1 0/1', GPSLongitudeRef: 'E', GPSLongitude: '106/1 49/1 0/1' },
    });
    expect((await sharp(src).metadata()).exif).toBeDefined();
    const p = await prepareImage(src);
    expect((await sharp(p.data).metadata()).exif).toBeUndefined();
    expect(p.data.includes(Buffer.from('Ponsel Uji'))).toBe(false);
  });
});

describe('validasi → unsupported (F-40)', () => {
  it('0 byte, teks, GIF, JPEG terpotong, header JPEG palsu', async () => {
    const jpeg = await twoTone(800, 600, 'jpeg');
    for (const bad of [
      Buffer.alloc(0),
      Buffer.from('bukan gambar'),
      await sharp({ create: { width: 300, height: 300, channels: 3, background: '#fff' } }).gif().toBuffer(),
      jpeg.subarray(0, Math.floor(jpeg.length / 3)),
      Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]),
    ]) {
      await expect(prepareImage(bad)).rejects.toEqual(unsupported);
    }
  });

  it('sisi pendek < 200 px (juga setelah orientasi)', async () => {
    await expect(prepareImage(await twoTone(1000, 199, 'jpeg'))).rejects.toEqual(unsupported);
    await expect(prepareImage(await twoTone(200, 200, 'png'))).resolves.toMatchObject({ width: 200 });
  });

  it('bom piksel > 50 MP ditolak tanpa didekode penuh', async () => {
    const bomb = await sharp({ create: { width: 8000, height: 7000, channels: 3, background: '#fff' } }).png().toBuffer();
    expect(bomb.length).toBeLessThan(1_000_000);
    await expect(prepareImage(bomb)).rejects.toEqual(unsupported);
  });

  it('HEIC rusak (header ftypheic, isi sampah) → unsupported', async () => {
    const fake = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypheic'), Buffer.alloc(64, 7)]);
    await expect(prepareImage(fake)).rejects.toEqual(unsupported);
  });
});

describe('prepareImages (semua gambar capture)', () => {
  const blob = (position: number, data: Buffer): ImageBlob => ({ position, storagePath: `x/${position}.jpg`, sha256: 'x', data });

  it('urut posisi; satu gagal → seluruh capture unsupported', async () => {
    const ok = await twoTone(400, 300, 'jpeg');
    const out = await prepareImages([blob(2, ok), blob(1, await twoTone(300, 400, 'png'))]);
    expect(out.map((p) => [p.position, p.mediaType])).toEqual([
      [1, 'image/png'],
      [2, 'image/jpeg'],
    ]);
    await expect(prepareImages([blob(1, ok), blob(2, Buffer.from('rusak'))])).rejects.toBeInstanceOf(PermanentError);
  });

  it('> 12 gambar ditolak (pengaman biaya §5.5)', async () => {
    const ok = await twoTone(300, 300, 'jpeg');
    await expect(prepareImages(Array.from({ length: 13 }, (_, i) => blob(i + 1, ok)))).rejects.toMatchObject({ code: 'unsupported' });
  });

  it('fixture sintetis CI semuanya bisa didekode (F-118)', async () => {
    for (const f of ['struk-aeon', 'struk-alfamart-timeout', 'struk-buram', 'label-milo', 'shopee-milo', 'shopee-milo-uht', 'label-indomie']) {
      const p = await prepareImage(readFileSync(resolve(FIXTURES_DIR, `${f}.jpg`)));
      expect(p.sourceType).toBe('jpeg');
      expect(Math.min(p.width, p.height)).toBeGreaterThanOrEqual(IMAGE_RULES.minShortSide);
    }
  });
});

// Belum ada sampel HEIC tanpa data pribadi dari pemilik proyek (docs/08 §15 no. 8, §18): test dilewati
// sampai apps/worker/test/fixtures/heic/sample.heic ada. libheif di Node tidak punya encoder.
describe.skipIf(!existsSync(HEIC_SAMPLE))('HEIC asli (sampel pemilik proyek)', () => {
  it('HEIC → JPEG ≤ 2576 px tanpa metadata, waktu dekode diukur', async () => {
    const started = Date.now();
    const p = await prepareImage(readFileSync(HEIC_SAMPLE));
    const ms = Date.now() - started;
    expect(p).toMatchObject({ sourceType: 'heic', mediaType: 'image/jpeg' });
    expect(Math.max(p.width, p.height)).toBeLessThanOrEqual(IMAGE_RULES.maxSide);
    expect((await sharp(p.data).metadata()).exif).toBeUndefined();
    console.log(`dekode HEIC: ${ms} ms`);
  });
});
