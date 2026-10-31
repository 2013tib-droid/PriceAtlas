// Saklar fitur build-time (D-100). Mode pemakaian pribadi tanpa anggaran AI: foto struk/label/screenshot
// dimatikan, struk masuk lewat S-21 `/tempel` (JSON dari Gemini). Kode foto tetap ada dan diuji di CI
// dengan NEXT_PUBLIC_PHOTO_CAPTURE=on; menyalakannya lagi cukup lewat env (+ EXTRACTOR worker).
// `process.env.NEXT_PUBLIC_…` ditulis literal supaya di-inline Next saat build.

/** Foto lewat kamera/galeri aktif hanya jika NEXT_PUBLIC_PHOTO_CAPTURE=on. Default mati. */
export function photoCaptureEnabled(value: string | undefined = process.env.NEXT_PUBLIC_PHOTO_CAPTURE): boolean {
  return value?.trim().toLowerCase() === 'on';
}

/** S-21 Tempel struk dari Gemini (selalu ada; satu-satunya jalan masuk struk saat foto mati). */
export const PASTE_HREF = '/tempel';
