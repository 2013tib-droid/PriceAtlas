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
  | 'S-14'
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
  photoSheetDescription: 'Pilih jenis foto. Foto tetap tersimpan di HP saat tidak ada sinyal.',
  photoOptions: {
    receipt: 'Struk',
    label: 'Label harga',
    screenshot: 'Screenshot marketplace',
    gallery: 'Pilih dari galeri',
  },
  photoOptionHints: {
    receipt: 'barang yang sudah dibeli',
    label: 'harga di rak toko',
    screenshot: 'Shopee, Tokopedia, dll.',
  },
  labelNeedsLocation:
    'Label harga butuh kamera label dan sesi belanja, yang dibuat di milestone berikutnya. Untuk sekarang foto struk atau screenshot.',
  close: 'Tutup',
  comingSoon: 'Segera hadir',
  placeholders: {
    search: { title: 'Cari harga', body: 'Cari produk untuk melihat harga terbaik 90 hari dan sepanjang masa (M1).' },
    shopping: { title: 'Sesi belanja', body: 'Mulai belanja di satu cabang lalu foto label harga (M4).' },
    me: { title: 'Saya', body: 'Profil, program member, berbagi publik, dan privasi (M6).' },
    member: {
      title: 'Program member',
      body: 'Tandai program member yang kamu ikuti supaya harga member ikut dihitung (M6).',
    },
  },
  signedInAs: 'Masuk sebagai {email}',
  signOut: 'Keluar',
  uploadsBadge: '{n} perlu dicek',
  update: {
    available: 'Versi baru tersedia',
    reload: 'Muat ulang',
    waitQueue: 'Versi baru siap. Dipasang setelah semua foto terunggah.',
  },
  offlinePage: {
    title: 'Halaman ini butuh sinyal',
    body: 'Halaman ini belum tersimpan di HP. Buka lagi saat online, atau kembali ke beranda.',
    home: 'Ke beranda',
  },
} as const;

/** Label dan teks harga bersama (wireframe §5.2, §5.3, U-05, U-15, D-15). */
export const PRICE_COPY = {
  basis: { normal: 'NORMAL', promo: 'PROMO', member: 'MEMBER' },
  memberWithProgram: 'MEMBER · {program}',
  memberNotCounted: 'MEMBER · tidak dihitung',
  memberNotCountedPrice: 'MEMBER {price} · tidak dihitung',
  bundle: 'BUNDLE · tidak dihitung',
  promoQty: 'PROMO {n}+',
  private: 'PRIBADI',
  closed: '(tutup)',
  noBranch: 'cabang tidak diketahui',
  trend: {
    down: '↓ turun {pct} vs 30 hari sebelumnya',
    up: '↑ naik {pct} vs 30 hari sebelumnya',
    flat: '→ stabil vs 30 hari sebelumnya',
    notEnough: 'Tren: data belum cukup',
  },
  trendSpoken: {
    down: 'turun {pct} persen dibanding 30 hari sebelumnya',
    up: 'naik {pct} persen dibanding 30 hari sebelumnya',
    flat: 'stabil dibanding 30 hari sebelumnya',
  },
  dataCount: '{n} data · terakhir {date}',
  best90: 'Termurah 90 hari',
  bestAll: 'Termurah sepanjang masa',
  no90: 'Belum ada harga 90 hari terakhir',
  lastRecorded: 'terakhir dicatat {age}',
  online: 'belum termasuk ongkir',
  onlineLong: 'harga belum termasuk ongkir',
  memberHint: 'Ada harga member {store} {price} · tidak dihitung karena kamu belum terdaftar',
  memberHintAction: 'Atur',
  bundleOnly: 'Hanya ada {n} data bundle · tidak dipakai untuk harga terbaik',
  noHistory: 'Belum ada data harga di historimu',
  shelfCheck: 'Cek harga rak',
  shelfCheckFor: 'Cek harga rak {name}',
  perPack: '{price}/isi',
} as const;

/** Keadaan standar (wireframe §5.5, docs/07 §7.2 ScreenState). */
export const STATE_COPY = {
  loading: 'Memuat…',
  retry: 'Coba lagi',
  offlineNoData: 'Tidak ada sinyal, dan data ini belum tersimpan di HP. Buka lagi saat online.',
  cachedLabel: 'data tersimpan, mungkin tidak terbaru',
  back: 'Kembali',
  summaryUpdating: 'Ringkasan sedang diperbarui…',
} as const;

/** SearchDock (U-02, D-58) dan S-02 Hasil cari. */
export const SEARCH_COPY = {
  label: 'Cari produk',
  placeholder: 'Cari produk, mis. milo',
  scan: 'Scan barcode',
  clear: 'Hapus kata kunci',
  minChars: 'Ketik minimal 2 huruf.',
  title: 'Hasil cari',
  resultCount: '{n} produk untuk "{q}"',
  notFound: 'Tidak ada produk "{q}". Coba kata lain, scan barcode, atau foto labelnya.',
  ask: 'Tanya: {q}',
  askHint: 'Segera hadir',
  groupBest: 'Paling hemat {per}: {size}',
  groupBestPrice: '({price})',
  compareSizes: 'Bandingkan ukuran',
  ungrouped: 'Produk lain',
} as const;

/** S-01 Beranda (U-19). */
export const HOME_COPY = {
  title: 'Cari harga',
  recentSearches: 'Pencarian terakhir',
  recentlyViewed: 'Baru dicek',
  newPrices: 'Harga baru masuk',
  needsCheck: '{n} perlu dicek',
  emptyTitle: 'Histori harga masih kosong',
  emptyBody: 'Setiap struk yang kamu foto menambah data pembanding.',
  emptyCards: {
    receipt: {
      title: 'Foto struk belanja terakhirmu',
      body: 'Cara tercepat mengisi histori: satu struk berisi banyak harga.',
    },
    session: { title: 'Lagi di toko? Mulai sesi belanja', body: 'Foto label harga, semua masuk ke cabang yang sama.' },
    search: { title: 'Coba cari produk', body: 'Lihat produk di katalog dan cek harga rak.' },
  },
  newPricesFailed: 'Harga baru belum bisa dimuat.',
} as const;

/** S-03 Detail produk. */
export const PRODUCT_COPY = {
  notFound: 'Produk tidak ditemukan atau bukan milikmu.',
  mergedToast: 'Produk ini sudah digabung ke {name}. Kami buka produk penggantinya.',
  summary: 'Ringkasan harga',
  lastPrice: 'Harga terakhir',
  noData: 'Foto label atau struk yang memuat produk ini.',
  trendHelp:
    'Tren muncul setelah ada minimal {min} data di 30 hari terakhir dan {min} data di 30 hari sebelumnya. Sekarang: {cur} dan {prev}.',
  chart: 'Grafik harga per satuan',
  chartNormalOnly: 'Hanya harga normal',
  chartEmpty: 'Belum ada titik harga untuk grafik.',
  chartEmptyNormal: 'Belum ada harga normal untuk grafik.',
  chartBestLine: 'garis putus-putus = termurah 90 hari',
  chartTable: 'Lihat sebagai tabel',
  chartTableCaption: 'Harga per satuan per tanggal transaksi',
  chartSpoken: 'Grafik {n} harga per satuan dari {from} sampai {to}, terendah {min}, tertinggi {max}.',
  colDate: 'Tanggal',
  colUnit: 'Per satuan',
  colLabel: 'Label',
  whereCheaper: 'Lebih hemat di mana',
  seeAll: 'Lihat semua',
  otherSizes: 'Ukuran lain di group ini',
  compare: 'Bandingkan',
  thisProduct: 'ini',
  history: 'Histori',
  showVoid: 'Tampilkan yang dibatalkan',
  filteredByStore: 'Hanya {store}',
  clearFilter: 'Tampilkan semua toko',
  loadMore: 'Muat lebih banyak',
  historyEmpty: 'Belum ada histori.',
  voided: 'dibatalkan',
  source: { receipt: 'Struk', price_label: 'Label', marketplace: 'Screenshot' },
  shipping: 'ongkir {price} (info)',
  quantity: '{qty} × {price}',
  normalWas: 'normal {price}',
  more: 'Lainnya',
  moreTitle: 'Aksi produk',
  menu: { edit: 'Edit produk', merge: 'Gabungkan', split: 'Pisahkan', archive: 'Hapus produk' },
  mergeGlobal: 'Produk katalog umum hanya bisa digabung oleh kurator.',
  soonM5: 'Segera hadir',
  offlineDetail: 'Detail lengkap butuh sinyal.',
} as const;

/** S-03b Cek harga rak (D-55, U-06). */
export const SHELF_COPY = {
  title: 'Cek harga rak',
  description: 'Ketik harga di label rak. Tidak disimpan.',
  inputLabel: 'Harga di rak',
  inputLabelWeight: 'Harga per {unit} di rak',
  placeholder: 'Rp0',
  backspace: 'Hapus satu angka',
  clear: 'Kosongkan',
  cheaper: 'Lebih murah dari semua harga di historimu 90 hari terakhir.',
  cheaperAll: 'Lebih murah dari semua harga di historimu.',
  near: 'Mendekati harga terbaikmu.',
  pricier: '{pct} lebih mahal dari termurahmu 90 hari',
  pricierAll: '{pct} lebih mahal dari termurahmu sepanjang masa',
  same: 'Sama dengan termurahmu 90 hari',
  vsLastPricier: '{pct} lebih mahal dari harga terakhir',
  vsLastCheaper: '{pct} lebih murah dari harga terakhir',
  vsLastSame: 'Sama dengan harga terakhir',
  otherSize: 'Ukuran {size} di historimu: {price} ({pct} lebih hemat per {unit})',
  noComparison: 'Belum ada pembanding di historimu.',
  saveLabel: 'Foto labelnya untuk disimpan',
  close: 'Tutup',
} as const;

/** S-04 Bandingkan ukuran. */
export const SIZES_COPY = {
  title: 'Bandingkan ukuran',
  subtitle: 'Harga terbaik per satuan',
  window90: '90 hari',
  windowAll: 'Sepanjang masa',
  windowLabel: 'Jendela waktu',
  best: 'paling hemat',
  perDimension: { mass: 'per gram', volume: 'per ml', count: 'per buah', length: 'per meter' },
  noData: 'Belum ada harga di historimu',
  otherCurrency: 'ada data mata uang lain',
  differentUnits: 'Tidak dibandingkan: satuan berbeda ({units})',
  onlyOne: 'Baru ada satu ukuran di group ini.',
  oldSku: 'data terakhir {date}',
  empty90: 'Belum ada harga 90 hari terakhir untuk group ini.',
  seeAllTime: 'Lihat sepanjang masa',
} as const;

/** S-05 Lebih hemat di mana (D-39). */
export const CHEAPER_COPY = {
  title: 'Lebih hemat di mana',
  scopeLabel: 'Cakupan',
  scopeProduct: 'Produk ini',
  scopeGroup: 'Semua ukuran',
  min: 'termurah {price}',
  avg: 'rata-rata {price}',
  count: '{n} data',
  oneData: 'baru 1 data',
  last: 'terakhir {date}',
  successor: '{from} (tutup) → {to}',
  empty90: 'Belum ada histori 90 hari.',
  emptyAll: 'Belum ada histori di toko mana pun.',
  seeAllTime: 'Lihat sepanjang masa?',
  sortedBy: 'Diurutkan menurut rata-rata harga per satuan.',
} as const;

/** Scan barcode (D-58, docs/07 §5.7). */
export const SCAN_COPY = {
  title: 'Scan barcode',
  hint: 'Arahkan kamera ke barcode di kemasan.',
  starting: 'Menyalakan kamera…',
  denied: 'Izin kamera ditolak. Izinkan kamera di pengaturan browser, atau cari dengan mengetik.',
  unsupported: 'Browser ini belum bisa membaca barcode. Cari dengan mengetik.',
  looking: 'Mencari produk {code}…',
  notFound: 'Barcode {code} belum dikenal di katalogmu. Cari namanya atau buat produk baru.',
  pickProduct: 'Pilih atau buat produk',
  viaMerge: 'Barcode ini milik produk yang sudah digabung. Kami buka produk penggantinya.',
  searchInstead: 'Cari dengan mengetik',
  scanAgain: 'Scan lagi',
  cameraSoon: 'Kamera untuk {kind} dibuat di milestone berikutnya.',
} as const;

/** S-07 Kamera struk/screenshot (D-82, U-07, U-11) dan S-07b galeri (U-09). */
export const CAMERA_COPY = {
  titleReceipt: 'Foto struk',
  titleScreenshot: 'Screenshot marketplace',
  guide: 'Pastikan seluruh struk terlihat dan tidak terlipat.',
  longHint: 'Struk panjang? Foto per bagian, lalu ketuk Tambah bagian.',
  screenshotHint: 'Pilih screenshot halaman produk atau pesanan dari galeri.',
  empty: 'Belum ada foto.',
  shutter: 'Ambil foto',
  addPart: 'Tambah bagian',
  gallery: 'Galeri',
  pickScreenshot: 'Pilih screenshot',
  done: 'Selesai',
  saving: 'Menyimpan…',
  parts: 'Bagian struk',
  part: 'Bagian {n}',
  moveUp: 'Pindahkan bagian {n} ke depan',
  moveDown: 'Pindahkan bagian {n} ke belakang',
  remove: 'Hapus bagian {n}',
  maxParts: 'Maksimal 10 bagian per struk.',
  preparing: 'Menyiapkan foto…',
  prepared: 'Siap',
  rejected: 'Foto terlalu besar atau formatnya tidak didukung (JPG, PNG, WebP, HEIC, maks 10 MB).',
  heicTooBig: 'Format foto ini terlalu besar. Ubah kamera ke JPEG/‘Most Compatible’ atau ambil foto dari app.',
  toastReceipt: 'Struk diunggah. Kami kabari kalau perlu dicek.',
  toastReceipts: '{n} struk diunggah. Kami kabari kalau perlu dicek.',
  toastScreenshot: 'Screenshot diunggah. Kami kabari kalau perlu dicek.',
  toastScreenshots: '{n} screenshot diunggah. Kami kabari kalau perlu dicek.',
  toastOffline: 'Foto disimpan di HP. Akan diunggah saat ada sinyal.',
  saveFailed: 'Foto belum bisa disimpan di HP. Coba lagi.',
  queueWarn: 'Antrean foto di HP sudah {size}. Buka app saat ada sinyal supaya foto terunggah dan memori HP lega.',
  back: 'Kembali',
  galleryTitle: '{n} gambar dipilih',
  galleryQuestionReceipt: 'Ini {n} struk berbeda atau 1 struk panjang?',
  galleryQuestionScreenshot: 'Ini {n} screenshot berbeda atau 1 screenshot panjang?',
  galleryDistinctReceipt: '{n} struk berbeda',
  galleryDistinctScreenshot: '{n} screenshot berbeda',
  gallerySingleReceipt: '1 struk panjang',
  gallerySingleScreenshot: '1 screenshot panjang',
  galleryManual: 'Atur sendiri',
  galleryManualHint: 'Pilih nomor untuk setiap gambar. Gambar dengan nomor sama digabung menjadi satu, urut dari atas.',
  galleryGroupLabel: 'Kelompok untuk gambar {n}',
  galleryGroupOption: 'Nomor {n}',
  gallerySave: 'Simpan',
  galleryCancel: 'Batal',
  gallerySkipped: '{n} gambar dilewati.',
  imageAlt: 'Foto bagian {n}',
} as const;

/** Dialog duplikat hash (U-10, D-20 tahap 1) di S-07 dan S-08. */
export const DUPLICATE_COPY = {
  title: 'Foto ini sudah pernah diunggah',
  body: 'Foto yang sama sudah diunggah {date}. Tetap unggah, atau lihat yang lama?',
  /** Q-74/D-86: nama toko dari R13 di cache jika ada. */
  dateWithStore: '{date} (struk {store})',
  view: 'Lihat yang lama',
  keep: 'Tetap unggah',
  inQueue: 'Foto ini sepertinya pernah diunggah ({date}).',
} as const;

/** S-08 Unggahan (wireframe S-08, D-61, U-11, U-17, §5.8). */
export const UPLOADS_COPY = {
  title: 'Unggahan',
  filter: 'Jenis',
  filterAll: 'Semua',
  kind: { receipt: 'Struk', price_label: 'Label', marketplace: 'Screenshot' },
  kindLong: { receipt: 'Struk', price_label: 'Label harga', marketplace: 'Screenshot marketplace' },
  sectionLocalOffline: 'Menunggu sinyal ({n})',
  sectionLocal: 'Belum terunggah ({n})',
  sectionNeedsCheck: 'Perlu dicek ({n})',
  sectionProcessing: 'Sedang diproses ({n})',
  sectionDone: 'Selesai',
  sectionFailed: 'Gagal ({n})',
  uploadedAgo: 'diunggah {ago}',
  needsCheckCount: '{n} item perlu dicek',
  needsCheckSome: 'Perlu dicek',
  queued: 'Menunggu antrean',
  processing: 'Diproses…',
  saved: '{n} harga tersimpan',
  savedNone: 'Tidak ada harga tersimpan',
  retry: 'Ulangi',
  retried: 'Unggahan diulang. Kami kabari hasilnya.',
  local: {
    captured: 'Siap diunggah',
    waiting_network: 'Menunggu sinyal',
    uploading: 'Mengunggah {i}/{n}…',
    submitting: 'Mendaftarkan…',
    submitted: 'Terunggah',
    error: 'Gagal diunggah',
  },
  localParts: '{n} bagian',
  localAuth: 'Sesi masuk perlu disegarkan. Kami coba lagi otomatis.',
  localRetry: 'Coba lagi',
  localRemove: 'Hapus',
  localRemoveTitle: 'Hapus foto ini dari HP?',
  localRemoveBody: 'Foto ini belum terunggah dan akan hilang.',
  localUnreadable: 'Foto antrean dari versi app lain belum bisa dibaca.',
  cancel: 'Batal',
  stale: 'Foto di HP hanya terunggah saat app ini dibuka. Buka app saat ada sinyal untuk mengunggah.',
  empty: 'Belum ada unggahan. Foto struk pertamamu untuk mulai mengisi histori.',
  emptyAction: 'Foto struk',
  emptyFiltered: 'Belum ada unggahan jenis ini.',
  allChecked: 'Semua sudah dicek',
  announceNeeds: '{what} perlu dicek.',
  announceDone: '{what} selesai diproses: {n} harga tersimpan.',
  announceFailed: '{what} gagal diproses: {reason}',
  open: 'Buka detail {what}',
} as const;

/** S-09 Detail unggahan (wireframe S-09, D-32, §8.2). */
export const UPLOAD_DETAIL_COPY = {
  title: 'Detail unggahan',
  images: 'Foto',
  image: 'Foto bagian {n} dari {total}',
  imagePurged: 'Gambar dihapus setelah 12 bulan. Data harga tetap ada.',
  imageFailed: 'Gambar belum bisa dimuat.',
  info: 'Info',
  kind: 'Jenis',
  location: 'Lokasi',
  capturedAt: 'Difoto',
  uploadedAt: 'Diunggah',
  noLocation: 'belum diketahui',
  timeline: 'Status',
  stepUploaded: 'Diunggah',
  stepAttempt: 'Percobaan ke-{n}',
  runRunning: 'sedang dibaca',
  runSucceeded: 'berhasil dibaca',
  runFailed: 'gagal',
  stepProcessed: 'Selesai diproses',
  status: {
    uploaded: 'Menunggu antrean',
    processing: 'Sedang dibaca…',
    done: '{n} harga tersimpan',
  },
  needsCheckCount: '{n} item perlu dicek',
  needsCheckSome: 'Ada item yang perlu dicek',
  attempt: 'Percobaan ke-{n}',
  processingLabel: 'Sedang dibaca',
  leaveOk: 'Boleh ditinggal. Kami kabari kalau sudah selesai.',
  checkNow: 'Cek sekarang',
  viewReceipt: 'Lihat struk',
  viewItems: 'Lihat harga',
  retry: 'Ulangi',
  retake: 'Foto ulang',
  delete: 'Hapus',
  deleteTitle: 'Hapus unggahan ini?',
  deleteBody: 'Foto dan statusnya dihapus dan tidak bisa dikembalikan.',
  deleted: 'Unggahan dihapus.',
  savedList: 'Harga tersimpan',
  back: 'Kembali ke Unggahan',
} as const;

/** Label confidence dan ringkasan bersama S-10/S-11 (U-12, U-15). */
export const CONFIRM_COPY = {
  doubt: 'ragu',
  doubtSpoken: 'ragu, periksa lagi',
  saving: 'Menyimpan…',
  saveN: 'Simpan {n} harga',
  saveNone: 'Simpan',
  savedToast: '{n} harga baru tersimpan',
  savedCheaper: '{n} harga baru tersimpan · {m} lebih murah dari harga terbaikmu sebelumnya',
  savedNone: 'Tidak ada harga baru yang disimpan.',
  aliasLearned: "Selanjutnya '{text}' di {store} dikenali otomatis.",
  aliasLearnedNoStore: "Selanjutnya '{text}' dikenali otomatis.",
  summaryFor: 'Ringkasan {name}',
  summaryDone: 'Ringkasan sudah diperbarui.',
  savedTitle: 'Harga tersimpan',
  openProduct: 'Lihat {name}',
  pii: 'Nomor kartu dan data pribadi di struk disamarkan.',
  failedKeep: 'Pilihanmu tidak hilang. Coba simpan lagi.',
  retrySave: 'Coba lagi',
  backToUploads: 'Kembali ke Unggahan',
  viewUpload: 'Lihat unggahan',
} as const;

/** S-10 Konfirmasi / detail struk (wireframe S-10, U-12, U-21, D-20, D-49, D-50). */
export const RECEIPT_COPY = {
  title: 'Cek struk',
  titleSaved: 'Struk',
  titleDiscarded: 'Struk dibuang',
  discardedBody: 'Struk ini sudah dibuang, jadi tidak ada harga yang disimpan.',
  uploadedToday: 'diunggah {when}',
  storeUnknown: 'Toko belum dikenali',
  pickStore: 'Pilih toko',
  branchUnknown: 'cabang tidak diketahui',
  pickBranch: 'Pilih',
  editHeader: 'Ubah info struk',
  editHeaderTitle: 'Info struk',
  fieldStore: 'Toko & cabang',
  fieldDate: 'Tanggal transaksi',
  fieldTime: 'Jam',
  fieldTotal: 'Total struk',
  fieldPayment: 'Metode bayar',
  changeLocation: 'Ubah toko',
  saveHeader: 'Simpan info',
  cancel: 'Batal',
  headerSaved: 'Info struk diperbarui.',
  dateMissing: 'tanggal belum terbaca',
  totalMatch: 'Total struk {total} · jumlah item {sum} ✓',
  totalMismatch: 'Jumlah item {sum} · total struk {total} · selisih {diff}. Mungkin ada baris yang terlewat.',
  totalUnknown: 'Jumlah item {sum} · total struk belum terbaca',
  viewImage: 'Lihat gambar',
  images: 'Gambar struk',
  imagePart: 'bagian {n}/{total}',
  duplicate: 'Mungkin duplikat: struk {store} {date}, total {total} sudah ada.',
  duplicateNoStore: 'Mungkin duplikat: struk {date}, total {total} sudah ada.',
  duplicateView: 'Lihat',
  duplicateDistinct: 'Ini struk berbeda',
  duplicateDiscard: 'Buang yang ini',
  duplicateChosenDistinct: 'Disimpan sebagai struk berbeda.',
  duplicateUndo: 'Batalkan',
  duplicateRequired: 'Pilih dulu: struk berbeda, atau buang yang ini.',
  discardTitle: 'Buang struk ini?',
  discardBody: 'Struk ini tidak disimpan, dan harga dari struk ini tidak dipakai.',
  discardConfirm: 'Buang',
  discarded: 'Struk dibuang.',
  needsCheck: 'Perlu dicek ({n})',
  allRecognized: 'Semua item sudah dikenali.',
  acceptAll: 'Benarkan semua saran ({n})',
  suggestion: '→ {name}?',
  noSuggestion: 'Produk belum dikenali',
  accept: 'Benar',
  replace: 'Ganti produk',
  replaceShort: 'Ganti',
  notProduct: 'Bukan produk',
  skip: 'Lewati',
  more: 'Lainnya untuk {text}',
  bundle: 'Tandai bundle',
  unbundle: 'Bukan bundle',
  bundleNote: 'BUNDLE · tidak dihitung',
  undo: 'Ubah pilihan',
  decided: {
    accept: 'Benar: {name}',
    replace: 'Diganti: {name}',
    non_product: 'Bukan produk',
    skip: 'Dilewati (tidak disimpan)',
  },
  quantity: '{qty} × {price}',
  weight: '{qty} × {price}/{unit} = {total}',
  discount: 'diskon {amount}',
  voided: 'dibatalkan di struk',
  netPromo: '= {price}',
  autoSaved: 'Tersimpan otomatis ({n})',
  nonProduct: 'Bukan produk ({n})',
  adjustments: 'Voucher & poin',
  adjustmentsNote: '(info, tidak mengurangi harga item)',
  voucher: 'Voucher {amount}',
  cashback: 'Cashback {amount}',
  points: 'Poin +{n}',
  shipping: 'Ongkir {amount}',
  otherAdj: '{text} {amount}',
  makeProduct: 'Ini produk',
  memberHint: 'Struk ini memakai harga member {store}. Kamu member {store}?',
  memberHintNoStore: 'Struk ini memakai harga member. Kamu member di toko ini?',
  memberYes: 'Ya, tandai',
  memberDone: 'Keanggotaan ditandai. Harga lain yang sudah tersimpan tidak berubah.',
  savedLines: 'Baris struk',
  editLine: 'Koreksi {text}',
  editLineTitle: 'Koreksi baris',
  lineQty: 'Jumlah',
  lineAmount: 'Total baris (Rp)',
  lineDiscount: 'Tambah diskon (Rp)',
  lineSave: 'Simpan koreksi',
  lineSaved: 'Baris diperbarui. Ringkasan menyusul dalam beberapa detik.',
  lineDetailLater: 'Detail dan koreksi lain per harga ada di halaman detail harga (segera hadir).',
  storeRequired: 'Pilih toko untuk struk ini sebelum menyimpan.',
} as const;

/** S-11 Konfirmasi label & screenshot (wireframe S-11, D-26, D-27, D-34, D-36, D-41, D-66). */
export const ITEMS_COPY = {
  titleLabel: 'Cek label harga',
  titleScreenshot: 'Cek screenshot',
  titleDone: 'Harga dari foto',
  counter: '{i}/{n}',
  itemHeading: 'Item {i} dari {n}',
  crop: 'Potongan foto item {i}',
  cropMissing: 'Potongan foto belum tersedia.',
  noProduct: 'Produk belum dikenali',
  pickProduct: 'Pilih produk',
  createProduct: 'Buat produk baru',
  replace: 'Ganti',
  normal: 'Harga normal',
  promo: 'Harga promo',
  promoMinQty: 'Minimal beli (promo kuantitas)',
  promoFrom: 'Promo mulai',
  promoUntil: 'Promo sampai',
  promoQtyText: '{price} untuk {n} pcs (min. {n})',
  member: 'Harga member',
  memberProgram: 'Program member',
  memberNoProgram: 'Program belum dipilih',
  memberNote: 'Catatan member: {note} (program belum ada di katalog, tidak dihitung)',
  computed: '→ Dihitung untukmu:',
  computing: 'Menghitung…',
  noApplicable: 'Belum ada harga yang berlaku untukmu di tanggal ini.',
  memberNotCounted: 'Harga member tidak dihitung: kamu belum terdaftar {program}.',
  memberNotCountedGeneric: 'Harga member tidak dihitung: kamu belum terdaftar program member ini.',
  iAmMember: 'Saya member',
  memberMarked:
    'Keanggotaan ditandai. Hanya item di layar ini yang dihitung ulang; harga yang sudah tersimpan tidak berubah.',
  promoEnded: 'Promo sudah berakhir. Dihitung harga normal.',
  location: 'Lokasi',
  locationFromSession: '{loc} (dari sesi)',
  locationUnknown: 'Toko belum diketahui',
  sessionLocation: 'dari sesi belanja',
  change: 'Ubah',
  pickBranch: 'Pilih cabang',
  seller: 'Seller: {name}',
  date: 'Tanggal',
  bundle: 'Ini bundle (paket campuran)',
  bundleNote: 'tidak dipakai untuk harga terbaik dan tren',
  listingTitle: 'Judul listing',
  sizeMismatch: 'Judul menyebut {text}, produk yang dipilih {size}.',
  sizeMismatchLabel: 'Teks label menyebut {text}, produk yang dipilih {size}.',
  shipping: 'Ongkir {amount}',
  shopVoucher: 'Voucher toko {amount}',
  cashback: 'Cashback {amount}',
  points: 'Poin +{n}',
  extraInfo: '(info, tidak mengubah harga)',
  onlineNote: 'harga belum termasuk ongkir',
  reject: 'Bukan label harga',
  rejectScreenshot: 'Bukan harga produk',
  rejected: 'Tidak disimpan',
  undoReject: 'Batalkan',
  accepted: 'Tersimpan',
  storeRequired: 'Pilih toko untuk harga ini. Cabangnya boleh tidak diisi.',
  allDone: 'Semua item sudah diputuskan.',
  pendingLeft: '{n} item belum disimpan (belum ada produk).',
  rupiah: 'Rp',
} as const;

/** S-12 Pilih toko & cabang (wireframe S-12, U-14, D-28, D-29). */
export const LOCATION_COPY = {
  titleManual: 'Label ini dari mana?',
  titleKoreksi: 'Pilih toko & cabang',
  titleSession: 'Kamu belanja di mana?',
  sessionLater: 'Memulai sesi belanja dibuat di milestone berikutnya (M4).',
  stepStore: 'Langkah 1 dari 2 · Toko',
  stepBranch: 'Langkah 2 dari 2 · Cabang di {store}',
  recent: 'Terakhir dipakai',
  recentEmpty: 'Belum ada toko terakhir.',
  allStores: 'Semua toko',
  searchLabel: 'Cari toko',
  searchPlaceholder: 'Cari toko, mis. aeon',
  noStores: 'Toko "{q}" belum ada. Tambahkan sebagai toko baru.',
  newStore: '+ Toko baru',
  newStoreTitle: 'Toko baru',
  newStoreName: 'Nama toko',
  newStoreChannel: 'Jenis',
  channel: { offline: 'Toko fisik', online: 'Online / marketplace' },
  newStoreSave: 'Tambah toko',
  privateNote: 'Toko dan cabang baru hanya terlihat olehmu (PRIBADI).',
  branches: 'Cabang',
  branchesEmpty: 'Belum ada cabang untuk toko ini.',
  sellers: 'Seller',
  unknownBranch: 'Tidak tahu cabangnya',
  unknownBranchHint: 'Harga tetap dipakai, dengan label "cabang tidak diketahui".',
  newBranch: '+ Cabang baru',
  newSeller: '+ Seller baru',
  newBranchTitle: 'Cabang baru',
  newBranchName: 'Nama cabang',
  newBranchCity: 'Kota (opsional)',
  newBranchSave: 'Tambah cabang',
  closed: '(tutup)',
  back: 'Ganti toko',
  cancel: 'Batal',
  required: 'Tulis namanya dulu.',
  online: 'online',
} as const;

/** S-14 Pilih produk (wireframe S-14). */
export const PICKER_COPY = {
  title: 'Pilih produk',
  close: 'Tutup',
  forText: 'Untuk "{text}"',
  barcode: 'Barcode {code} belum dikenal. Cari produknya, atau buat produk baru dengan barcode ini.',
  suggestion: 'Saran',
  candidates: 'Kandidat lain',
  results: 'Hasil cari',
  searching: 'Mencari…',
  minChars: 'Ketik minimal 2 huruf untuk mencari.',
  notFound: 'Tidak ditemukan',
  create: '+ Buat produk baru',
  sizeMismatch: 'Teks menyebut {text}, produk ini {size}.',
  choose: 'Pilih {name}',
  open: 'Buka {name}',
} as const;

/** S-15 Produk baru (wireframe S-15, D-17, D-29). */
export const NEW_PRODUCT_COPY = {
  title: 'Produk baru',
  privateNote: 'Produk baru selalu PRIBADI: hanya terlihat olehmu.',
  name: 'Nama',
  namePlaceholder: 'mis. Milo Original',
  variant: 'Varian (opsional)',
  variantPlaceholder: 'mis. Cokelat',
  brand: 'Brand (opsional)',
  brandPlaceholder: 'Pilih atau tulis brand baru',
  brandNew: 'Brand baru "{name}" dibuat sebagai PRIBADI.',
  group: 'Group (keluarga ukuran)',
  groupSame: 'Sama dengan nama',
  groupExisting: 'Group yang ada',
  groupNew: 'Group baru',
  groupNewName: 'Nama group',
  groupPick: 'Pilih group',
  groupNone: 'Belum ada group yang cocok.',
  category: 'Kategori (opsional)',
  categoryNone: 'Tanpa kategori',
  saleMode: 'Cara jual',
  saleUnit: 'Per kemasan',
  saleWeight: 'Timbang',
  packCount: 'Jumlah isi',
  contentSize: 'Ukuran per isi',
  contentUnit: 'Satuan',
  weightUnit: 'Harga per',
  barcodes: 'Barcode (opsional)',
  barcodeLabel: 'Barcode {n}',
  barcodeAdd: '+ barcode lain',
  barcodeRemove: 'Hapus barcode {n}',
  preview: 'Pratinjau',
  previewUnit: '{name} · {size} · harga per {per} akan dihitung',
  previewMulti: '{count} × {size} = {total}',
  previewExample: 'Contoh: {price} → {unit}',
  previewWeight: '{name} · dijual per {unit} · harga utama per {unit}',
  similar: 'Produk serupa sudah ada:',
  similarUse: 'Pakai {name}',
  similarOpen: 'Lihat {name}',
  save: 'Simpan produk',
  saving: 'Menyimpan…',
  cancel: 'Batal',
  created: 'Produk {name} dibuat (PRIBADI).',
  errors: {
    name: 'Tulis nama produk.',
    size: 'Isi ukuran kemasan untuk produk yang dijual per kemasan.',
    packCount: 'Jumlah isi minimal 1.',
    unit: 'Pilih satuan.',
    barcode: 'Barcode berisi 8–14 angka.',
    groupName: 'Tulis nama group baru.',
    groupPick: 'Pilih group.',
  },
  fromBarcode: 'Barcode {code} diisi dari hasil scan.',
} as const;

/** Mengisi {nama} di teks. Nilai yang tidak ada dibiarkan apa adanya. */
export function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}
