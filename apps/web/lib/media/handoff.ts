// Serah-terima file dari sheet S-06 ke layar kamera S-07 (di memori, satu kali pakai). File dipilih
// di sheet supaya kamera bawaan/galeri terbuka dengan satu ketukan (U-08); jika halaman dimuat
// ulang sebelum diambil, file hilang dan user memotret lagi (belum ada yang tersimpan).
import type { CaptureKind } from './image-plan';
import type { ImageSource } from './prepare';

export interface PendingFiles {
  kind: CaptureKind;
  source: ImageSource;
  files: File[];
}

let pending: PendingFiles | null = null;

export function setPendingFiles(p: PendingFiles): void {
  pending = p;
}

export function takePendingFiles(kind: CaptureKind): PendingFiles | null {
  const p = pending;
  pending = null;
  return p && p.kind === kind ? p : null;
}
