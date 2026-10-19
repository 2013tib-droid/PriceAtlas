// Semua teks UI (id-ID saja, D-83, docs/07 §10.2) dan pemetaan kode error → pesan (§8).
// Test test/copy.test.ts gagal jika ada ErrorCode di @priceatlas/contracts tanpa pesan.
import type { ErrorCode } from '@priceatlas/contracts';

/** Layar yang punya pesan khusus (§8.2 kolom "Layar utama"). */
export type Screen =
  | 'S-00a'
  | 'S-03'
  | 'S-07'
  | 'S-08'
  | 'S-09'
  | 'S-10'
  | 'S-11'
  | 'S-12'
  | 'S-13'
  | 'S-15'
  | 'S-16'
  | 'S-17'
  | 'S-18'
  | 'S-19'
  | 'S-19b'
  | 'S-19c';

export interface ErrorCopy {
  /** Pesan umum (cadangan untuk layar yang tidak disebut di `byScreen`). */
  message: string;
  byScreen?: Partial<Record<Screen, string>>;
  /** Label tombol aksi, jika ada. */
  action?: string;
}

/** §8.2 — kode bisnis RPC (app.err) dan Route hapus akun. */
export const ERROR_COPY: Record<ErrorCode, ErrorCopy> = {
  NOT_FOUND: { message: 'Data ini tidak ditemukan. Mungkin sudah dihapus.', action: 'Kembali' },
  STALE_WRITE: {
    message: 'Data ini baru saja berubah di tempat lain. Kami muat ulang versi terbaru; periksa lagi lalu simpan.',
  },
  INVALID_STATE: {
    message: 'Aksi ini tidak bisa dilakukan pada keadaan data saat ini. Muat ulang lalu coba lagi.',
    byScreen: {
      'S-09': 'Unggahan yang sedang diproses atau sudah selesai tidak bisa dihapus.',
      'S-10': 'Struk ini sudah dibuang, jadi tidak bisa disimpan.',
      'S-11': 'Item ini sudah diputuskan sebelumnya.',
      'S-19b': 'Program ini sudah dihentikan dan tidak bisa ditandai.',
      'S-19c': 'Nyalakan berbagi harga dulu sebelum membagikan data lama.',
    },
  },
  INVALID_TRANSITION: { message: 'Unggahan ini tidak sedang gagal, jadi tidak perlu diulang.', action: 'Muat ulang' },
  DUPLICATE_DECISION_REQUIRED: {
    message:
      'Struk ini mirip struk {toko} {tanggal}, total {total}. Pilih dulu: simpan sebagai struk berbeda, atau buang yang ini.',
  },
  SESSION_NOT_ACTIVE: {
    message: 'Sesi belanja ini sudah berakhir. Mulai sesi baru untuk lanjut.',
    action: 'Mulai sesi baru',
  },
  RECEIPT_STORE_REQUIRED: { message: 'Pilih toko untuk struk ini sebelum menyimpan.', action: 'Pilih toko' },
  UNDECIDED_LINES: {
    message: 'Masih ada {n} barang yang belum diputuskan. Pilih Benar, Ganti, Bukan produk, atau Lewati.',
  },
  STORE_REQUIRED: { message: 'Pilih toko untuk harga ini. Cabangnya boleh tidak diisi.', action: 'Pilih toko' },
  NO_APPLICABLE_PRICE: {
    message:
      'Belum ada harga yang berlaku untukmu di tanggal ini. Isi harga normal, atau tandai keanggotaan member jika kamu member.',
  },
  USE_RECEIPT_LINE: { message: 'Harga dari struk diubah lewat baris struknya.', action: 'Ubah baris struk' },
  RECEIPT_DERIVED_FIELD: {
    message: 'Angka ini dihitung dari baris struk dan tidak bisa diubah langsung.',
    action: 'Ubah baris struk',
  },
  INVALID_EXTRA: { message: 'Info tambahan (ongkir, voucher, catatan) tidak valid. Periksa lagi isiannya.' },
  CAPTURE_IMAGES_MISSING: {
    message: 'Sebagian foto belum terunggah. Kami coba lagi otomatis.',
    action: 'Coba lagi',
  },
  BRANCH_CLOSED: { message: 'Cabang ini sudah tutup. Pilih cabang lain atau tambah cabang baru.' },
  RECORDS_NOT_OWNED: {
    message: 'Sebagian data yang dipilih bukan milikmu. Muat ulang daftar lalu pilih lagi.',
    action: 'Muat ulang',
  },
  MERGE_FORBIDDEN: { message: 'Produk katalog umum hanya bisa digabung oleh kurator.' },
  REAUTH_REQUIRED: {
    message: 'Untuk menghapus akun, masuk ulang dulu (kode dikirim ke emailmu), lalu ketik HAPUS AKUN.',
    action: 'Kirim kode',
  },
  FORBIDDEN: { message: 'Kamu tidak punya izin untuk aksi ini.' },
  INVALID_INPUT: { message: 'Isian tidak valid. Periksa lagi lalu coba simpan.' },
};

/** §8.2 — error Postgres bawaan (SQLSTATE). 23505 pada create dengan id klien = sukses (idempoten). */
export const SQLSTATE_COPY: Record<string, ErrorCopy> = {
  '42501': {
    message: 'Kamu tidak punya izin untuk aksi ini.',
    byScreen: { 'S-17': 'Produk katalog umum hanya bisa digabung oleh kurator.' },
  },
  '22023': { message: 'Ketik minimal 2 huruf.' },
  '23503': {
    message: 'Data yang dipilih tidak tersedia.',
    byScreen: { 'S-10': 'Cabang ini bukan cabang dari toko yang dipilih.', 'S-17': 'Group ini tidak tersedia.' },
  },
  '23505': { message: 'Data ini sudah tersimpan.' },
  '23514': { message: 'Isi ukuran kemasan untuk produk yang dijual per kemasan.' },
  '23P01': { message: 'Barcode ini sudah dipakai produk lain di periode yang sama.' },
  P0001: { message: 'Produk tujuan tidak aktif atau bukan milikmu. Pilih produk lain.' },
};

/** Route Handler hapus akun (selain REAUTH_REQUIRED yang ada di ERROR_COPY). */
export const ROUTE_ERROR_COPY = {
  DELETE_FAILED: { message: 'Gagal memulai penghapusan akun. Tidak ada yang berubah; coba lagi.', action: 'Coba lagi' },
  DELETE_INCOMPLETE: { message: 'Penghapusan belum selesai. Coba lagi.', action: 'Coba lagi' },
} as const satisfies Record<string, ErrorCopy>;

export const GENERIC_COPY = {
  network: { message: 'Tidak ada sinyal. Data yang terakhir dimuat tetap ditampilkan.', action: 'Coba lagi' },
  unknown: { message: 'Terjadi kesalahan. Coba lagi sebentar lagi.', action: 'Coba lagi' },
  storageRejected: {
    message: 'Foto terlalu besar atau formatnya tidak didukung (JPG, PNG, WebP, HEIC, maks 10 MB).',
  },
} as const satisfies Record<string, ErrorCopy>;

/** §8.3 — alasan gagal proses (capture.error_code, D-71) di S-08/S-09. */
export const CAPTURE_ERROR_COPY: Record<'blurry' | 'not_a_receipt' | 'unsupported' | 'timeout' | 'other', ErrorCopy> = {
  blurry: { message: 'Gambar buram atau terpotong.', action: 'Foto ulang' },
  not_a_receipt: { message: 'Ini sepertinya bukan struk atau label harga.', action: 'Foto ulang' },
  unsupported: { message: 'Format gambar ini belum bisa dibaca.', action: 'Foto ulang' },
  timeout: { message: 'Pemrosesan terlalu lama. Coba ulangi.', action: 'Ulangi' },
  other: { message: 'Gambar tidak terbaca.', action: 'Ulangi' },
};

/** S-00a Masuk (§3.5, §8.2 baris Auth). */
export const AUTH_COPY = {
  title: 'Masuk ke PriceAtlas',
  intro: 'Histori harga pribadimu, untuk tahu murah atau mahal sebelum membeli.',
  emailLabel: 'Email',
  emailPlaceholder: 'nama@contoh.com',
  emailInvalid: 'Tulis alamat email yang valid.',
  sendCode: 'Kirim kode',
  sending: 'Mengirim…',
  codeTitle: 'Masukkan kode',
  codeSentTo: 'Kode 6 angka sudah dikirim ke {email}.',
  codeLabel: 'Kode 6 angka',
  codeInvalidFormat: 'Kode terdiri dari 6 angka.',
  verify: 'Masuk',
  verifying: 'Memeriksa…',
  resend: 'Kirim ulang kode',
  resendIn: 'Kirim ulang dalam {s} dtk',
  changeEmail: 'Ganti email',
  or: 'atau',
  google: 'Masuk dengan Google',
  googleNote: 'Jika setelah memilih akun Google kamu tidak kembali ke aplikasi, pakai kode email.',
  codeExpired: 'Kode sudah kedaluwarsa. Kirim kode baru.',
  codeWrong: 'Kode salah. Periksa 6 angka di emailmu.',
  rateLimited: 'Terlalu sering meminta kode. Tunggu sebentar lalu coba lagi.',
  offline: 'Masuk butuh sinyal. Coba lagi saat online.',
  callbackFailed: 'Masuk dengan Google gagal. Coba lagi, atau pakai kode email.',
  loadingContext: 'Menyiapkan datamu…',
} as const;

/** Layout (app): tab bar, strip offline, placeholder layar M0. */
export const APP_COPY = {
  appName: 'PriceAtlas',
  tabs: { search: 'Cari', uploads: 'Unggahan', shopping: 'Belanja', me: 'Saya', camera: 'Foto' },
  cameraLabel: 'Foto struk, label, atau screenshot',
  offlineStrip: 'Offline. Foto tetap tersimpan dan diunggah otomatis.',
  skipToContent: 'Langsung ke konten',
  photoSheetTitle: 'Foto apa?',
  photoSheetSoon: 'Kamera dibuat di milestone berikutnya (M2).',
  photoOptions: {
    receipt: 'Struk',
    label: 'Label harga',
    screenshot: 'Screenshot marketplace',
    gallery: 'Pilih dari galeri',
  },
  close: 'Tutup',
  comingSoon: 'Segera hadir',
  placeholders: {
    search: { title: 'Cari harga', body: 'Cari produk untuk melihat harga terbaik 90 hari dan sepanjang masa (M1).' },
    uploads: { title: 'Unggahan', body: 'Daftar foto struk, label, dan screenshot yang sedang diproses (M2).' },
    shopping: { title: 'Sesi belanja', body: 'Mulai belanja di satu cabang lalu foto label harga (M4).' },
    me: { title: 'Saya', body: 'Profil, program member, berbagi publik, dan privasi (M6).' },
  },
  signedInAs: 'Masuk sebagai {email}',
  signOut: 'Keluar',
  offlinePage: {
    title: 'Halaman ini butuh sinyal',
    body: 'Halaman ini belum tersimpan di HP. Buka lagi saat online, atau kembali ke beranda.',
    home: 'Ke beranda',
  },
} as const;

/** Mengisi {nama} di teks. Nilai yang tidak ada dibiarkan apa adanya. */
export function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}
