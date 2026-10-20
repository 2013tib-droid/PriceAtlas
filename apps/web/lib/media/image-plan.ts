// Aturan pipeline gambar (docs/07 §6.1–§6.4, D-82): logika murni, diuji unit (L5a).
import type { ImageMeta, ImageMime } from './image-meta';

export type CaptureKind = 'receipt' | 'price_label' | 'marketplace';

const MB = 1024 * 1024;
export const IMAGE_LIMITS = {
  /** Bucket `captures` + SubmitCaptureInput (D-69). */
  maxBytes: 10 * MB,
  /** Target per gambar setelah kompresi dan batas aturan lewati (§6.3). */
  targetBytes: 1.5 * MB,
  maxSide: { receipt: 2560, other: 2048 },
  quality: { receipt: 0.88, other: 0.85, screenshotPng: 0.9 },
  /** Kualitas terendah saat mengejar target ≤ 1,5 MB. */
  minQuality: 0.65,
} as const;

export const ALLOWED_MIME: readonly ImageMime[] = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'];

export const EXT_OF: Record<ImageMime, 'jpg' | 'png' | 'webp' | 'heic'> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
};

export function maxSideFor(kind: CaptureKind): number {
  return kind === 'receipt' ? IMAGE_LIMITS.maxSide.receipt : IMAGE_LIMITS.maxSide.other;
}

/**
 * Jenis file: magic bytes, lalu `file.type` dari browser (ekstensi). `image/heif` disamakan dengan
 * HEIC (wadah sama; bucket hanya menerima `image/heic`).
 */
export function resolveMime(meta: Pick<ImageMeta, 'sniffed'>, fileType: string): ImageMime | null {
  if (meta.sniffed) return meta.sniffed;
  const t = fileType.toLowerCase();
  if (t === 'image/jpg' || t === 'image/pjpeg') return 'image/jpeg';
  if (t === 'image/heif') return 'image/heic';
  return (ALLOWED_MIME as readonly string[]).includes(t) ? (t as ImageMime) : null;
}

export type RejectReason = 'type' | 'empty' | 'too_big' | 'heic_too_big';

export type ImagePlan =
  | { action: 'keep'; reason: 'small' | 'screenshot_png' }
  | { action: 'compress'; maxSide: number; quality: number }
  | { action: 'reject'; reason: RejectReason };

export interface PlanInput {
  mime: ImageMime | null;
  size: number;
  width: number | null;
  height: number | null;
  hasGps: boolean;
  kind: CaptureKind;
}

/**
 * §6.3 (F-23) aturan lewati: JPEG/PNG/WebP, ≤ 1,5 MB, sisi panjang ≤ batas, tanpa blok EXIF GPS
 * → byte asli (hash tetap). Ukuran piksel yang tidak terbaca = syarat tidak terpenuhi.
 * §6.2 screenshot PNG ≤ 1,5 MB dibiarkan PNG (teks UI lebih tajam).
 * Selain itu dikompres ke JPEG; file di atas 10 MB tetap dicoba dikompres (hasil akhir ≤ 10 MB).
 */
export function planImage(i: PlanInput): ImagePlan {
  if (!i.mime) return { action: 'reject', reason: 'type' };
  if (i.size <= 0) return { action: 'reject', reason: 'empty' };
  const maxSide = maxSideFor(i.kind);
  const small = i.size <= IMAGE_LIMITS.targetBytes && !i.hasGps;
  if (i.mime !== 'image/heic' && small) {
    const long = i.width && i.height ? Math.max(i.width, i.height) : null;
    if (long !== null && long <= maxSide) return { action: 'keep', reason: 'small' };
    if (i.kind === 'marketplace' && i.mime === 'image/png') return { action: 'keep', reason: 'screenshot_png' };
  }
  const quality =
    i.kind === 'receipt'
      ? IMAGE_LIMITS.quality.receipt
      : i.kind === 'marketplace' && i.mime === 'image/png'
        ? IMAGE_LIMITS.quality.screenshotPng
        : IMAGE_LIMITS.quality.other;
  return { action: 'compress', maxSide, quality };
}

/**
 * Browser tidak bisa mendekode file (HEIC di Chrome/Firefox, P-07, atau file rusak/bukan gambar):
 * unggah apa adanya jika ≤ 10 MB (§6.4; worker yang menilai, mis. `unsupported`). Lihat F-40.
 */
export function planUndecodable(mime: ImageMime, size: number): ImagePlan {
  if (size <= IMAGE_LIMITS.maxBytes) return { action: 'keep', reason: 'small' };
  return { action: 'reject', reason: mime === 'image/heic' ? 'heic_too_big' : 'too_big' };
}

/** Ukuran target setelah skala: sisi panjang ≤ maxSide, tidak pernah diperbesar. */
export function scaledSize(width: number, height: number, maxSide: number): { width: number; height: number } {
  const k = Math.min(1, maxSide / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * k)), height: Math.max(1, Math.round(height * k)) };
}

/** Urutan kualitas yang dicoba sampai hasil ≤ 1,5 MB. */
export function qualitySteps(start: number): number[] {
  const out: number[] = [];
  for (let q = start; q >= IMAGE_LIMITS.minQuality - 1e-9; q -= 0.08) out.push(Math.round(q * 100) / 100);
  return out;
}
