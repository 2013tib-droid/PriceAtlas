// Pipeline gambar di klien (docs/07 §6.2): baca EXIF → aturan lewati (§6.3) → kompresi (worker,
// cadangan thread utama) → sha256 byte final. Dimuat lewat dynamic import dari S-07 supaya tidak
// membesarkan bundle halaman lain.
import { compressImage, DecodeError } from './compress';
import { exifDateToIso, readImageMeta, toIsoWithOffset } from './image-meta';
import {
  EXT_OF,
  planImage,
  planUndecodable,
  resolveMime,
  type CaptureKind,
  type ImagePlan,
  type RejectReason,
} from './image-plan';
import { sha256Hex } from './sha256';

export type ImageSource = 'camera' | 'gallery';

export interface PreparedImage {
  blob: Blob;
  contentType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/heic';
  ext: 'jpg' | 'png' | 'webp' | 'heic';
  sha256: string;
  byteSize: number;
  /** ISO dengan offset, atau null (§6.2 `p_captured_at`). */
  capturedAt: string | null;
  /** Mengapa byte ini yang dipakai (untuk test/debug). */
  how: 'kept' | 'compressed' | 'undecodable';
}

export class ImageRejectedError extends Error {
  constructor(readonly reason: RejectReason) {
    super(`image rejected: ${reason}`);
    this.name = 'ImageRejectedError';
  }
}

/** §6.2: kamera → saat ini; galeri → EXIF DateTimeOriginal → file.lastModified → kosong. */
export function capturedAtFor(
  source: ImageSource,
  exif: { dateTimeOriginal: string | null; offsetTimeOriginal: string | null },
  lastModified: number | undefined,
  now: Date,
): string | null {
  if (source === 'camera') return toIsoWithOffset(now);
  const fromExif = exifDateToIso(exif.dateTimeOriginal, exif.offsetTimeOriginal);
  if (fromExif) return fromExif;
  return lastModified ? toIsoWithOffset(new Date(lastModified)) : null;
}

export async function prepareImage(
  file: File | Blob,
  opts: { kind: CaptureKind; source: ImageSource; now?: Date },
): Promise<PreparedImage> {
  const buf = new Uint8Array(await file.arrayBuffer());
  const meta = readImageMeta(buf);
  const mime = resolveMime(meta, file.type);
  const capturedAt = capturedAtFor(
    opts.source,
    meta,
    'lastModified' in file ? file.lastModified : undefined,
    opts.now ?? new Date(),
  );
  let plan: ImagePlan = planImage({
    mime,
    size: buf.byteLength,
    width: meta.width,
    height: meta.height,
    hasGps: meta.hasGps,
    kind: opts.kind,
  });

  if (plan.action === 'compress') {
    try {
      const r = await compressImage(new Blob([buf], { type: mime ?? '' }), plan);
      const out = new Uint8Array(await r.blob.arrayBuffer());
      return {
        blob: new Blob([out], { type: 'image/jpeg' }),
        contentType: 'image/jpeg',
        ext: 'jpg',
        sha256: await sha256Hex(out),
        byteSize: out.byteLength,
        capturedAt,
        how: 'compressed',
      };
    } catch (e) {
      if (!(e instanceof DecodeError)) throw e;
      plan = planUndecodable(mime!, buf.byteLength);
      if (plan.action === 'keep') return keep(buf, mime!, capturedAt, 'undecodable');
    }
  }
  if (plan.action === 'reject') throw new ImageRejectedError(plan.reason);
  return keep(buf, mime!, capturedAt, 'kept');
}

async function keep(
  buf: Uint8Array,
  mime: NonNullable<ReturnType<typeof resolveMime>>,
  capturedAt: string | null,
  how: PreparedImage['how'],
): Promise<PreparedImage> {
  return {
    blob: new Blob([buf as Uint8Array<ArrayBuffer>], { type: mime }),
    contentType: mime,
    ext: EXT_OF[mime],
    sha256: await sha256Hex(buf),
    byteSize: buf.byteLength,
    capturedAt,
    how,
  };
}
