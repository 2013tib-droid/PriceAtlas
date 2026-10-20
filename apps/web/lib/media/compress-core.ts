// Inti kompresi (docs/07 §6.2), dipakai di Web Worker (OffscreenCanvas) dan thread utama.
// createImageBitmap + kanvas menulis ulang piksel, sehingga EXIF (termasuk GPS) tidak ikut (P-08).
import { IMAGE_LIMITS, qualitySteps, scaledSize } from './image-plan';

export interface CompressOptions {
  maxSide: number;
  quality: number;
}

export interface CompressResult {
  blob: Blob;
  width: number;
  height: number;
}

export class DecodeError extends Error {
  constructor(message = 'decode') {
    super(message);
    this.name = 'DecodeError';
  }
}

type Drawable = ImageBitmap | HTMLImageElement;

/** Orientasi EXIF diterapkan saat decode (`from-image`); browser lama menolak nilai itu → tanpa opsi. */
export async function decodeBitmap(blob: Blob): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(blob, { imageOrientation: 'from-image' });
  } catch (e) {
    if (e instanceof TypeError) {
      try {
        return await createImageBitmap(blob);
      } catch {
        throw new DecodeError();
      }
    }
    throw new DecodeError();
  }
}

async function encode(src: Drawable, w: number, h: number, quality: number, useOffscreen: boolean): Promise<Blob> {
  if (useOffscreen) {
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new DecodeError('no-context');
    ctx.drawImage(src, 0, 0, w, h);
    return canvas.convertToBlob({ type: 'image/jpeg', quality });
  }
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new DecodeError('no-context');
  ctx.drawImage(src, 0, 0, w, h);
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new DecodeError('encode'))), 'image/jpeg', quality),
  );
}

/** Skala + JPEG, turunkan kualitas (lalu skala 0,75×) sampai ≤ 1,5 MB. */
export async function compressDrawable(
  src: Drawable,
  srcW: number,
  srcH: number,
  opts: CompressOptions,
  useOffscreen: boolean,
): Promise<CompressResult> {
  let { width, height } = scaledSize(srcW, srcH, opts.maxSide);
  let last: Blob | null = null;
  for (let round = 0; round < 2; round++) {
    for (const q of qualitySteps(opts.quality)) {
      last = await encode(src, width, height, q, useOffscreen);
      if (last.size <= IMAGE_LIMITS.targetBytes) return { blob: last, width, height };
    }
    ({ width, height } = scaledSize(width, height, Math.round(Math.max(width, height) * 0.75)));
  }
  return { blob: last!, width, height };
}

/** Versi Web Worker / OffscreenCanvas. */
export async function compressWithOffscreen(blob: Blob, opts: CompressOptions): Promise<CompressResult> {
  const bmp = await decodeBitmap(blob);
  try {
    return await compressDrawable(bmp, bmp.width, bmp.height, opts, true);
  } finally {
    bmp.close();
  }
}

/** Cadangan thread utama: createImageBitmap jika ada, selain itu elemen <img> (orientasi dari browser). */
export async function compressOnMainThread(blob: Blob, opts: CompressOptions): Promise<CompressResult> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bmp = await decodeBitmap(blob);
      try {
        return await compressDrawable(bmp, bmp.width, bmp.height, opts, false);
      } finally {
        bmp.close();
      }
    } catch (e) {
      if (!(e instanceof DecodeError)) throw e;
    }
  }
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    try {
      await img.decode();
    } catch {
      throw new DecodeError();
    }
    if (!img.naturalWidth) throw new DecodeError();
    return await compressDrawable(img, img.naturalWidth, img.naturalHeight, opts, false);
  } finally {
    URL.revokeObjectURL(url);
  }
}
