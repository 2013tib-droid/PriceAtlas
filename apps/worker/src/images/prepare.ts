// Langkah gambar di worker (docs/08 §6, F-106): setelah verifikasi sha256, sebelum extractor.
//   1. tipe dari magic bytes (ekstensi diabaikan)   4. sisi panjang ≤ 2576 px
//   2. dekode: sharp (JPEG/PNG/WebP), HEIC lewat     5. encode JPEG q90 sRGB (PNG tetap PNG lossless)
//      heic-decode (libheif WASM) → RGBA → sharp     6. validasi: gagal dekode, 0 byte, sisi pendek
//   3. orientasi EXIF, metadata dibuang                 < 200 px → PermanentError('unsupported')
// Hasil hanya di memori. Gambar asli di bucket tidak diubah (D-92, Q-112): sha256 tetap untuk
// deteksi duplikat dan audit.
// Deklarasi tipe heic-decode dirujuk langsung supaya ikut terbaca oleh proyek lain yang mengimpor
// file ini (apps/web: test fixture + next build), bukan hanya tsconfig worker.
/// <reference path="./heic-decode.d.ts" />
import sharp, { type Sharp } from 'sharp';
import heicDecode from 'heic-decode';
import { log } from '../log.ts';
import { PermanentError, type ImageBlob, type PreparedImage } from '../pipeline/types.ts';

export const IMAGE_RULES = {
  /** Batas sisi panjang gambar untuk model (docs/08 §1.3). */
  maxSide: 2576,
  minShortSide: 200,
  /** Pengaman bom dekompresi. */
  maxPixels: 50_000_000,
  /** Pengaman biaya (§5.5): UI maks 10 bagian (D-81). */
  maxImages: 12,
  jpegQuality: 90,
  /** PNG kecil (screenshot) tetap PNG supaya teks UI tajam (§6 langkah 5). */
  pngKeepMaxBytes: 1.5 * 1024 * 1024,
} as const;

export const UNREADABLE_MESSAGE = 'Gambar tidak bisa dibuka. Coba foto ulang atau pilih foto lain.';

export type SourceType = PreparedImage['sourceType'];

const HEIC_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1']);

/** Tipe dari magic bytes. `null` = tidak dikenal. */
export function sniffImageType(b: Uint8Array): SourceType | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return 'png';
  const ascii = (from: number, to: number) => String.fromCharCode(...b.subarray(from, to));
  if (b.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'webp';
  if (b.length >= 12 && ascii(4, 8) === 'ftyp' && HEIC_BRANDS.has(ascii(8, 12).replace(/\0/g, ' ').trim())) return 'heic';
  return null;
}

function unreadable(): PermanentError {
  return new PermanentError('unsupported', UNREADABLE_MESSAGE);
}

/** Satu gambar → turunan bersih untuk model. Melempar PermanentError('unsupported'). */
export async function prepareImage(data: Buffer): Promise<Omit<PreparedImage, 'position'>> {
  if (data.length === 0) throw unreadable();
  const sourceType = sniffImageType(data);
  if (!sourceType) throw unreadable();

  let pipeline: Sharp;
  try {
    if (sourceType === 'heic') {
      // libheif menerapkan rotasi/cermin wadah HEIF (irot/imir) saat dekode, jadi EXIF tidak dipakai lagi.
      const images = await heicDecode.all({ buffer: data });
      try {
        const first = images[0];
        if (!first) throw unreadable();
        if (first.width * first.height > IMAGE_RULES.maxPixels) throw unreadable();
        const raw = await first.decode();
        pipeline = sharp(Buffer.from(raw.data.buffer, raw.data.byteOffset, raw.data.byteLength), {
          raw: { width: raw.width, height: raw.height, channels: 4 },
          limitInputPixels: IMAGE_RULES.maxPixels,
        });
      } finally {
        images.dispose();
      }
    } else {
      // failOn 'error': peringatan kecil dari kamera HP tidak menggagalkan, data rusak tetap gagal.
      pipeline = sharp(data, { limitInputPixels: IMAGE_RULES.maxPixels, failOn: 'error' }).autoOrient();
    }

    // Dekode penuh sekali (sekaligus validasi), ukuran sesudah orientasi.
    const { data: pixels, info } = await pipeline.raw().toBuffer({ resolveWithObject: true });
    if (Math.min(info.width, info.height) < IMAGE_RULES.minShortSide) throw unreadable();

    const base = () =>
      sharp(pixels, { raw: { width: info.width, height: info.height, channels: info.channels } }).resize({
        width: IMAGE_RULES.maxSide,
        height: IMAGE_RULES.maxSide,
        fit: 'inside',
        withoutEnlargement: true,
      });

    const longSide = Math.max(info.width, info.height);
    if (sourceType === 'png' && data.length <= IMAGE_RULES.pngKeepMaxBytes && longSide <= IMAGE_RULES.maxSide) {
      // Encode ulang lossless: piksel sama, chunk metadata (eXIf, tEXt) terbuang.
      const out = await base().png().toBuffer({ resolveWithObject: true });
      return { data: out.data, mediaType: 'image/png', width: out.info.width, height: out.info.height, sourceType };
    }
    const out = await base()
      .flatten({ background: '#ffffff' })
      .toColourspace('srgb')
      .jpeg({ quality: IMAGE_RULES.jpegQuality })
      .toBuffer({ resolveWithObject: true });
    return { data: out.data, mediaType: 'image/jpeg', width: out.info.width, height: out.info.height, sourceType };
  } catch (e) {
    if (e instanceof PermanentError) throw e;
    throw unreadable();
  }
}

/** Semua gambar capture (urut posisi). Satu gagal → seluruh capture `unsupported`. */
export async function prepareImages(images: ImageBlob[]): Promise<PreparedImage[]> {
  if (images.length === 0 || images.length > IMAGE_RULES.maxImages) {
    throw new PermanentError('unsupported', images.length === 0 ? UNREADABLE_MESSAGE : 'Terlalu banyak gambar dalam satu unggahan.');
  }
  const out: PreparedImage[] = [];
  for (const img of [...images].sort((a, b) => a.position - b.position)) {
    const started = Date.now();
    const p = await prepareImage(img.data);
    out.push({ position: img.position, ...p });
    log('image.prepared', { position: img.position, type: p.sourceType, w: p.width, h: p.height, ms: Date.now() - started });
  }
  return out;
}
