// Frame jendela bidik → foto label (docs/07 §6.2 "File/Frame", D-82, P-18): frame video digambar ke
// canvas dengan sisi panjang ≤ 2048 px (label), dikodekan JPEG 0,85, lalu masuk pipeline gambar M2
// (prepareImage: aturan lewati §6.3 → kompresi jika perlu → sha256 byte final). Browser-only (L5c);
// dimuat lewat dynamic import dari kamera label, tidak masuk bundle halaman lain.
import { IMAGE_LIMITS, maxSideFor } from './image-plan';
import { prepareImage, type PreparedImage } from './prepare';

export const FRAME_MAX_SIDE = maxSideFor('price_label');
export const FRAME_QUALITY = IMAGE_LIMITS.quality.other;

/** Ukuran canvas: skala turun (tidak pernah naik) sampai sisi panjang ≤ maxSide. */
export function frameSize(width: number, height: number, maxSide = FRAME_MAX_SIDE): { width: number; height: number } {
  if (!(width > 0 && height > 0)) throw new FrameNotReadyError();
  const scale = Math.min(1, maxSide / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** Video belum punya frame (kamera baru menyala). */
export class FrameNotReadyError extends Error {
  constructor() {
    super('frame not ready');
    this.name = 'FrameNotReadyError';
  }
}

/** Ambil frame saat ini sebagai JPEG. */
export async function grabFrame(
  video: HTMLVideoElement,
  opts: { maxSide?: number; quality?: number } = {},
): Promise<Blob> {
  // HAVE_CURRENT_DATA (2): ada frame untuk digambar.
  if (video.readyState < 2) throw new FrameNotReadyError();
  const { width, height } = frameSize(video.videoWidth, video.videoHeight, opts.maxSide ?? FRAME_MAX_SIDE);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d tidak tersedia');
  ctx.drawImage(video, 0, 0, width, height);
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('toBlob gagal'))),
      'image/jpeg',
      opts.quality ?? FRAME_QUALITY,
    ),
  );
}

/** Frame → pipeline M2 sebagai foto kamera (p_captured_at = saat ini, §6.2). */
export async function prepareLabelFrame(video: HTMLVideoElement, now = new Date()): Promise<PreparedImage> {
  const blob = await grabFrame(video);
  const file = new File([blob], 'label.jpg', { type: 'image/jpeg', lastModified: now.getTime() });
  return prepareImage(file, { kind: 'price_label', source: 'camera', now });
}

/** File dari galeri (alternatif kamera, §10.1) → pipeline M2. */
export function prepareLabelFile(file: File): Promise<PreparedImage> {
  return prepareImage(file, { kind: 'price_label', source: 'gallery' });
}
