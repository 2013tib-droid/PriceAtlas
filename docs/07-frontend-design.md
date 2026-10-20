# Tahap 5a — Desain Frontend

> **Status: disetujui (2026-10-19).** Semua default Q-43 s/d Q-64 diterima dan dicatat sebagai D-78 s/d D-83. **Tahap 5b M0 selesai dan disetujui** (hasil dan temuan F-25 s/d F-30: §1.4; Q-65 s/d Q-67 diputuskan sebagai D-84: §13.4). **Tahap 5b M1 selesai, menunggu review** (hasil, temuan F-31 s/d F-39: §1.5; pertanyaan Q-68 s/d Q-71: §13.5, diputuskan sebagai D-85).
> Dasar: `PROJECT.md` (D-01 s/d D-77, terutama D-57–D-61 dan D-73–D-77), `docs/04-wireframe.md` + `docs/wireframes/index.html` (S-00a s/d S-20, alur 1–8, W-xx), `docs/05-backend-design.md` (R1–R21, W1–W18, §3.1, §4, §5, §7, §10), `docs/06-local-dev.md`, `packages/contracts`, `apps/web`.

Dokumen ini tidak mengubah requirement, keputusan, skema, maupun RPC. Temuan baru ditulis sebagai **F-xx** (melanjutkan F-16 di `docs/05` §0.2), potensi masalah sebagai **P-xx**, dan pertanyaan sebagai **Q-43** dst. Setiap pertanyaan punya usulan default.

---

## Daftar Isi

0. [Ringkasan](#0-ringkasan)
1. [Langkah Awal: Mode B, L4, dan `db-types`](#1-langkah-awal-mode-b-l4-dan-db-types)
2. [Analisis dan Potensi Masalah](#2-analisis-dan-potensi-masalah)
3. [Arsitektur](#3-arsitektur)
4. [Stack UI](#4-stack-ui)
5. [PWA dan Offline](#5-pwa-dan-offline)
6. [Unggah ke Bucket `captures`](#6-unggah-ke-bucket-captures)
7. [Pemetaan Layar](#7-pemetaan-layar)
8. [Pemetaan Kode Error ke Pesan UI](#8-pemetaan-kode-error-ke-pesan-ui)
9. [S-20 Tanya (Kerangka)](#9-s-20-tanya-kerangka)
10. [Aksesibilitas dan i18n](#10-aksesibilitas-dan-i18n)
11. [Strategi Test dan CI](#11-strategi-test-dan-ci)
12. [Rencana Milestone 5b](#12-rencana-milestone-5b)
13. [Pertanyaan untuk Didiskusikan](#13-pertanyaan-untuk-didiskusikan)

---

## 0. Ringkasan

| | |
|---|---|
| Bentuk aplikasi | PWA mobile-first di Next.js 16 (App Router), sudah ada di `apps/web` (Next 16.4, React 19.3, `@supabase/ssr` 0.12, `supabase-js` 2.118) |
| Pola data | **Shell statis + data di klien.** Halaman dirender sebagai kerangka statis; data diambil di browser lewat supabase-js dengan JWT user (D-61). Server Next.js hanya untuk auth callback, `proxy.ts`, dan Route Handler bersecret. |
| Rekomendasi stack (perlu persetujuan, §4) | Tailwind CSS v4 + komponen berbasis Radix (pola shadcn/ui) + lucide-react; TanStack Query v5 (+ persist ke IndexedDB); react-hook-form + zod dari `packages/contracts`; Serwist untuk service worker |
| Offline | Antrean foto di IndexedDB dengan `capture_id` dari klien (D-59), diunggah dari halaman (bukan dari service worker); cache produk R5 (D-60); polling R13 tiap 5 detik (D-61) |
| Layar | 27 layar S-xx dipetakan ke 25 route halaman + 4 lapisan (sheet/overlay) (§7) |
| Milestone 5b | M0 fondasi → M1 cari & detail → M2 unggah struk → M3 konfirmasi → M4 sesi belanja → M5 koreksi & katalog → M6 pengaturan & onboarding → M7 offline penuh, kerangka Tanya, audit (§12) |
| Temuan baru | F-17 s/d F-24 (§1.3). **F-17 menghalangi mode B sama sekali** (versi PostgreSQL). |
| Pertanyaan | Q-43 s/d Q-64. **Blocking untuk 5b: Q-43, Q-44, Q-45, Q-47, Q-48, Q-50** (§13.1) |

**Prinsip yang dipegang:** angka paling besar di layar selalu harga terbaik dan harga per satuan; tidak ada total pengeluaran di mana pun; label harga selalu teks (U-15); aksi utama di sepertiga bawah layar (U-01, U-02); RLS adalah satu-satunya otorisasi, UI hanya menyembunyikan aksi yang pasti ditolak.

---

## 1. Langkah Awal: Mode B, L4, dan `db-types`

D-77 dan Q-42 meminta mode B (Supabase CLI) dan test L4 manual dijalankan di awal Tahap 5. Hasilnya:

### 1.1 Yang dicoba

| Langkah | Hasil |
|---|---|
| Docker | Klien ada, daemon tidak berjalan. `dockerd` berhasil dinyalakan manual (root, cgroup v1). |
| Supabase CLI | Tidak terpasang. Dipasang dari npm (`supabase@2.121.0`) di folder sementara, tidak masuk repo. |
| `supabase start` (config apa adanya) | **Gagal sebelum menarik image:** `Invalid db.major_version: 16`. Lihat **F-17**. |
| `supabase start` (sementara diubah ke 17, lalu dikembalikan) | **Gagal menarik image.** Semua registry ditolak proxy jaringan lingkungan ini (HTTP 403): Docker Hub (`production.cloudfront.docker.com`), ECR Public (`public.ecr.aws` → CloudFront), GHCR (`ghcr.io`). |
| Mode A (PostgreSQL 16 lokal) sebagai pembanding | `bash db/tests/run.sh`: **semua lulus, 569 pengecekan** (smoke 43 + flows). Baseline backend utuh. |

**Kesimpulan: mode B dan test L4 tidak bisa dijalankan di lingkungan ini.** Penyebabnya dua: (1) F-17, masalah repo yang perlu keputusan (Q-43); (2) kebijakan jaringan lingkungan cloud ini memblokir registry container. Penyebab kedua bukan masalah repo. Pemilik lingkungan bisa membukanya lewat pengaturan *Network access* (izinkan `registry-1.docker.io`, `production.cloudfront.docker.com`, `public.ecr.aws`), atau L4 dijalankan di CI GitHub Actions yang punya Docker (usulan Q-44).

### 1.2 Pemeriksaan statis butir L4

Karena tidak bisa dijalankan, setiap butir L4 diperiksa dari kode dan dokumentasi. Status "belum terverifikasi" berarti harus dibuktikan saat mode B pertama kali jalan (M0, §12).

| Butir L4 / Q-42 | Pemeriksaan statis | Status |
|---|---|---|
| Policy `storage.objects` (0150) | `create policy ... on storage.objects` oleh role `postgres` adalah cara yang didokumentasikan Supabase. Policy memanggil `app.my_household_ids()`; `authenticated` punya `USAGE` schema `app` dan `EXECUTE` fungsi itu (baseline baris 23, 100). Bucket juga dideklarasikan di `config.toml`; migration memakai `on conflict do update`. | Kemungkinan aman. Belum terverifikasi. |
| `ALTER DATABASE … SET timezone` (0230) | Dijalankan lewat `execute format(... current_database())`. Butuh pemilik database. Di Supabase, `postgres` adalah pemilik database `postgres`, dan dokumentasi Supabase sendiri memakai `alter database postgres set timezone`. | Kemungkinan aman. Belum terverifikasi. |
| `WORKER_DB_ROLE` untuk role `postgres` Supabase | `.env` mode B di `docs/06` §3.2 **tidak** mengisi `WORKER_DB_ROLE`, jadi worker berjalan sebagai `postgres` (pemilik objek), bukan `service_role` seperti mode A. Startup parameter `-c role=...` juga belum tentu diteruskan oleh Supavisor di produksi. | Ada celah. Lihat F-22. |
| Error `PTnnn` → HTTP lewat PostgREST | `app.err()` memakai `errcode = 'PTnnn'`, `message = <KODE>`, `detail = json`, `hint`. PostgREST memetakan SQLSTATE `PTxyz` ke HTTP `xyz` dan meneruskan `message/details/hint`. supabase-js mengembalikan `{ code: 'PT409', message: 'STALE_WRITE', details, hint }`, persis bentuk yang diharapkan `parseRpcError()`. | Konsisten. Belum terverifikasi end-to-end. |
| Login OTP lewat Inbucket | CLI 2.121 menandai `[inbucket]` usang (diganti `[local_smtp]`, Mailpit). Template email bawaan belum tentu memuat kode 6 digit (`{{ .Token }}`). | Ada celah. Lihat F-18, F-20. |
| Default privileges asli + `99_privilege_inventory.sql` | Tidak bisa dijalankan tanpa database Supabase. | Belum terverifikasi. |

### 1.3 Temuan baru (F-xx)

| # | Temuan | Dampak | Usulan | Ke |
|---|---|---|---|---|
| **F-17** | **`supabase/config.toml` memakai `db.major_version = 16`, yang ditolak Supabase CLI 2.121** (`Invalid db.major_version: 16`). Supabase hanya menyediakan image PostgreSQL 15 dan 17. Mode A dan CI memakai PostgreSQL 16. | Mode B tidak bisa dinyalakan sama sekali. Produksi Supabase (proyek baru: PostgreSQL 17) akan berbeda versi dengan semua test L1–L3. | Pindah ke **17 di semua tempat**: `config.toml`, image CI `postgres:17`, prasyarat mode A. Jalankan L1–L3 di 17 sebagai bagian M0. | **Q-43** |
| F-18 | `[inbucket]` di `config.toml` sudah usang di CLI 2.121 (peringatan saat start). Penggantinya `[local_smtp]` (Mailpit). `docs/06` §3.1 masih menyebut Inbucket. | Peringatan saja sekarang. Akan gagal di CLI v3. Test e2e yang membaca email harus memakai API Mailpit. | Ganti ke `[local_smtp]` di M0, perbarui `docs/06`. | M0 |
| F-19 | **`packages/db-types` tidak bisa dibangkitkan** (`supabase gen types --local` butuh Supabase lokal yang berjalan). Placeholder masih `Record<string, never>`. | Panggilan REST (`from('store')`) di frontend tidak bertipe. | Bangkitkan di CI (job Supabase CLI) atau oleh pemilik proyek secara lokal, lalu commit + cek drift. Sampai itu, tipe RPC dari `packages/contracts` (zod). | **Q-44** |
| F-20 | Login OTP butuh template email berisi **kode** (`{{ .Token }}`). Repo belum punya `supabase/templates/`. Template bawaan berbahasa Inggris dan menonjolkan magic link. | Magic link di iOS membuka Safari, bukan PWA yang terpasang (penyimpanan terpisah), sehingga user "masuk" di tempat yang salah. Lihat P-05. | Template Indonesia hanya dengan kode 6 digit, untuk `magic_link` dan `confirmation`, di `supabase/templates/` + `config.toml`. | **Q-55** |
| F-21 | `config.toml` mengaktifkan Google dengan `client_id = "env(GOOGLE_OAUTH_CLIENT_ID)"`. Jika env tidak diisi (kebanyakan developer lokal dan CI), perilaku `supabase start` belum diketahui (bisa gagal atau provider rusak diam-diam). | e2e di CI bisa gagal karena Google, padahal Google tidak dites. | `enabled = "env(GOOGLE_OAUTH_ENABLED)"` atau default mati di lokal, verifikasi di M0. | M0 |
| F-22 | **Worker mode B berjalan sebagai `postgres`**, bukan `service_role` (§1.2). Selain itu, belum terbukti bahwa `postgres` di Supabase bisa `SET ROLE service_role` dan bahwa Supavisor meneruskan `options=-c role=…`. | Hak yang diuji di mode A (service_role) berbeda dengan yang dipakai di mode B/produksi. Bug hak akses worker bisa lolos. | Isi `WORKER_DB_ROLE=service_role` di `.env` mode B. Jika startup parameter tidak diteruskan pooler, ganti ke `SET ROLE` setelah connect. Verifikasi di M0. | M0 |
| F-23 | **Stub extractor memetakan fixture lewat sha256 gambar.** Frontend mengompres gambar di klien (§6), sehingga byte yang diunggah berbeda dari file fixture dan stub mengembalikan `unsupported`. | e2e unggah → konfirmasi tidak bisa memakai fixture yang ada. | Aturan "lewati kompresi" (§6.3): file JPEG ≤ 1,5 MB, sisi panjang ≤ batas, tanpa EXIF GPS diunggah apa adanya. Fixture memenuhi aturan itu. | §6.3 |
| F-24 | **Sapuan unggahan yatim (24 jam) bisa menghapus gambar milik antrean offline yang belum selesai.** Contoh: bagian 1 dari 3 terunggah, HP mati, dibuka lagi 2 hari kemudian. `submit_capture` lalu gagal `CAPTURE_IMAGES_MISSING`. | Foto bisa "hilang" di server walaupun antrean klien masih memegangnya. | Klien menyimpan semua byte sampai `submit_capture` sukses. Saat `CAPTURE_IMAGES_MISSING`, unggah ulang semua bagian lalu ulangi submit (§5.4). Tidak perlu perubahan backend. | §5.4 |

### 1.4 Tahap 5b M0: hasil dan temuan baru (F-25 dst.)

**Lingkungan pembuatan M0.** `supabase start` dicoba lagi dan tetap gagal: layer image dari `production.cloudfront.docker.com` ditolak proxy (403) dan Docker Hub membalas 429. Mode B, L4, `db-types`, dan e2e login karena itu **diverifikasi di job CI `supabase-e2e`**. PostgreSQL 17 lokal untuk L1–L3 diambil dari paket npm `@embedded-postgres/linux-x64` 17.10 (server) dan `pg_dump` 17.11 dibangun dari sumber, karena `apt.postgresql.org` juga diblokir. Ini hanya soal lingkungan, bukan repo.

| Butir §1.2 | Hasil M0 |
|---|---|
| PostgreSQL 17 (F-17) | L1 569 pengecekan, L2+L3, `snapshot.sh --check`, dan whitelist hak akses **tanpa perubahan** di 17 (lokal). CI `test` memakai `postgres:17`. |
| F-18 Mailpit | `[local_smtp]`; CLI 2.121 tidak lagi memberi peringatan. |
| F-20 template OTP | `supabase/templates/otp.html` untuk `magic_link` dan `confirmation`; L4 + e2e memeriksa isi email lewat API Mailpit. |
| F-21 Google tanpa env | Diverifikasi dengan CLI 2.121: `enabled = true` + env kosong **tidak** membuat CLI gagal (provider rusak diam-diam); `enabled = "env(X)"` gagal parse jika env kosong (F-25). Jadi `enabled = false` + override env. |
| F-22 role worker | `.env` mode B mengisi `WORKER_DB_ROLE=service_role`; L4 memeriksa keanggotaan role dan menjalankan worker terhadap Supabase sampai `needs_confirmation`. |
| Storage, `PTnnn`, OTP, inventaris hak | Diotomasi di `packages/l4` (docs/06 §3.6). **Lulus di CI** (Supabase CLI 2.121, PostgreSQL 17): inventaris hak 6 ok dan cek lingkungan 10 ok terhadap DB Supabase asli (default privileges asli tidak menambah hak di luar whitelist); 10 test HTTP: OTP Mailpit, `PT404/409/422` → HTTP, policy Storage, worker `service_role` sampai `needs_confirmation`. Butir "belum terverifikasi" di §1.2 kini terverifikasi. |
| `db-types` (F-19) | Dibangkitkan di CI dan di-commit (28 tabel/view + semua RPC). Hasil `gen` dinormalkan Prettier sebelum dicek drift. |
| Serwist (Q-50/D-81) | **Spike berhasil** dengan `@serwist/turbopack` 9.5.13 di Next 16.4 (Turbopack, tanpa `--webpack`). Cadangan tidak dipakai. |

| # | Temuan | Dampak | Penanganan / usulan | Ke |
|---|---|---|---|---|
| F-25 | `env(...)` di `config.toml` tidak bisa dipakai untuk nilai boolean: env kosong → `CliConfigParseError`. Override `SUPABASE_<SECTION>_<KEY>` (mis. `SUPABASE_AUTH_EXTERNAL_GOOGLE_ENABLED=true`) bekerja. | Usulan F-21 (`enabled = "env(GOOGLE_OAUTH_ENABLED)"`) tidak bisa dipakai. | `enabled = false` + override env, dicatat di `config.toml` dan `docs/06` §3.1. | selesai |
| F-26 | **Emulasi offline Playwright (`context.setOffline`) tidak berlaku untuk service worker yang dimulai ulang browser** (juga setelah `reload()`): request SW tetap sampai ke server dan mendapat redirect `proxy.ts`. | Test "shell terbuka offline" bisa lulus/gagal palsu. | e2e memakai proxy TCP kecil yang diputus (`e2e/support/cut-proxy.ts`) + `setOffline` (untuk `navigator.onLine`). | selesai |
| F-27 | **JS halaman `/` ≈ 335 KiB gzip**, di atas anggaran 200 kB (§11.4). Terbesar: zod v4 penuh (semua skema `RPC_INPUTS` dari `packages/contracts`) + supabase-js. | Muat pertama lebih lambat di sinyal lemah (hanya sekali; aset di-precache SW). | CI memberi peringatan, tidak gagal. Lihat **Q-65**. | Q-65 |
| F-28 | GoTrue mengembalikan `otp_expired` untuk kode **salah** maupun **kedaluwarsa** (dicek L4). | Pesan §8.2 "Kode salah" vs "Kode sudah kedaluwarsa" tidak bisa dibedakan dari kode error. | Klien membedakan dari waktu kirim: < `otp_expiry` (10 mnt) → "Kode salah", selain itu "kedaluwarsa" (`lib/auth/otp-errors.ts`). | selesai |
| F-29 | `onAuthStateChange('SIGNED_OUT')` juga terjadi saat refresh token gagal, bukan hanya saat user menekan Keluar. §3.5 menulis "SIGNED_OUT → bersihkan cache query + data lokal". | Menghapus IndexedDB pada event ini bisa membuang antrean foto offline (D-59) tanpa peringatan Q-61. | Event `SIGNED_OUT` hanya membersihkan cache query di memori; data lokal dihapus hanya lewat aksi Keluar/hapus akun (`signOutAndClear`). Lihat **Q-66**. | Q-66 |
| F-30 | Precache SW mengambil HTML shell lewat `fetch` saat install. Jika `proxy.ts` mengalihkan semua permintaan tanpa sesi, shell `/`, `/unggahan`, … tersimpan sebagai halaman `/masuk`. | Shell offline salah isi untuk user yang memasang PWA sebelum login. | `proxy.ts` hanya mengalihkan **navigasi dokumen** (`Sec-Fetch-Mode: navigate`); fetch lain mendapat shell statis (tanpa data user). Penjaga sesi di klien menangani navigasi klien dan offline. | selesai |

**Penyimpangan kecil dari dokumen ini (implementasi M0):**

| Bagian | Dokumen | Implementasi | Alasan |
|---|---|---|---|
| §7.3 S-00a `OtpForm` | "6 kotak, tempel otomatis" | Satu kolom `inputmode="numeric"`, `autocomplete="one-time-code"`, maks 6 angka, huruf diberi jarak | Satu kolom bekerja dengan autofill iOS/Android dan pembaca layar tanpa logika fokus antar kotak. Tampilan bisa diganti tanpa mengubah alur. Lihat Q-67. |
| §5.2 navigasi shell | Precache HTML shell; network-first | Aset `/_next/static` + ikon di precache; HTML shell diisi ke cache `shell-<versi>` saat install lalu network-first (3 dtk) → cache → `/offline` | Precache Serwist selalu *cache-first*; cara ini menjaga network-first sesuai tabel. |
| §11.6 CSP | Header CSP | Belum. `Referrer-Policy`, `Permissions-Policy`, `nosniff` sudah | CSP butuh daftar domain Storage dan nonce skrip Next; dibuat bersama unggahan di M2. |
| §11.4 job `browser` (L5c) | Job baru | Belum dibuat | Belum ada kode browser-only (kompresi, EXIF) sampai M2. |
| §4.3 kunci query | `['rpc', name, input]` | Sama; `RPC_INPUTS` (skema input semua RPC) ditambahkan ke `packages/contracts` dan dicek terhadap argumen fungsi SQL di L2 | Satu pintu validasi input untuk `rpcCall`. |

### 1.5 Tahap 5b M1: hasil dan temuan baru (F-31 dst.)

**Dasar.** PR #8 (D-84) belum di-merge saat M1 dikerjakan, jadi branch M1 dibangun di atas `claude/priceatlas-5b-m0-decisions` dan ikut memuat commit D-84. Tidak ada perubahan skema, RPC, migration, atau `db/tests/smoke.sql`.

**Yang dibangun** (§7, §12 baris M1):

| Bagian | Isi |
|---|---|
| Komponen | `SearchDock` (U-02, ikon scan hanya jika BarcodeDetector + `ean_13`, D-58), `ProductCard` (semua keadaan S-02), `GroupHeader` ("Paling hemat per gram: 200 g (Rp90/g)", per dimensi, U-03), `PriceText`/`UnitPrice` (aria-label "90 rupiah per gram")/`PriceLabel`/`BasisLabel`/`TrendText` (teks + aria-label)/`DataCount`/`StoreLine`, `QueryState` + `LoadingState`/`EmptyState`/`ErrorState`/`OfflineState`, `StickyAction`, `HistoryRow`, `Segmented` (radio asli) |
| Layar | S-01 `/`, S-02 `/cari?q=`, S-03 `/produk?id=` (+ `&toko=` filter histori dari S-05, + S-03b `&sheet=cek-harga`), S-04 `/produk/ukuran?group=` (`&jendela=semua`), S-05 `/produk/hemat?id=\|group=` (`&lingkup=group`, `&jendela=semua`), scan `/kamera?jenis=barcode` |
| Data | Hook per RPC di `lib/data/queries.ts` (kunci `qk.rpc`, staleTime/persist §4.3, output divalidasi skema kontrak di dev/test). R8 memakai `useInfiniteQuery` dengan cursor `(transaction_date, id)`, 20 baris per halaman. REST S-01 di `lib/data/rest.ts`. 💾 `prefs`: pencarian terakhir (8), baru dicek (150, siap untuk R5 di M7), toggle "Hanya harga normal". |
| Kontrak | Skema output baru di `packages/contracts`: `ChartPointSchema` (R9), `ClientConfigSchema` (R2), `BarcodeHitSchema` (R6); field yang dipakai UI ditambahkan ke skema yang ada (`product.status/product_group_id`, `last_record.effective_price/price_basis`, `price_record_view.actual_weight/promo_*/store_channel/branch_status/created_at`, `compare_sizes.price_basis`). Semua dicek terhadap keluaran RPC asli (lihat test di bawah). |
| Shell offline | `/cari` dan `/produk` masuk `SHELL_ROUTES` (§7.1 kolom Offline). Data saat offline: cache persist TanStack (yang pernah dimuat) + label "data tersimpan, mungkin tidak terbaru"; cache R5 + search offline tetap M7. |
| Test | L5a/L5b: `test/m1/*` (81 test) untuk setiap layar di setiap keadaan §7.3, fixture `test/fixtures/rpc.json` = keluaran RPC **asli** mode A (`test/fixtures/scenario.ts`) yang divalidasi zod kontrak; `test/fixtures.l3.test.ts` gagal jika bentuk keluaran server menyimpang dari fixture. e2e `e2e/search-detail.spec.ts` (alur 1–2, Chromium + WebKit di `supabase-e2e`). |

**Enam pertanyaan inti (wireframe §8.1) di UI M1** — semuanya diperiksa e2e alur 1–2:

| # | Pertanyaan | Jawaban di UI | Ketukan |
|---|---|---|---|
| 1 | Termurah? | Kartu S-02: "Rp18.000 PROMO" (90 hari) + "Termurah sepanjang masa: …" | ketik → 0 |
| 2 | Toko & cabang? | Kartu: "Alfamart · cabang tidak diketahui · 10 Okt 2026" (D-28) | 0 |
| 3 | Naik/turun? | Kartu: "↓ turun 9% vs 30 hari sebelumnya" atau "Tren: data belum cukup" + "5 data · terakhir 3 hari lalu" (D-15, D-44, D-54); S-03 grafik + penjelasan jendela | 0 (+1) |
| 4 | Per gram? | Kartu: "Rp90/g"; harga di rak: S-03b | 0 (+1) |
| 5 | 500 g vs 200 g? | Header group S-02 "Paling hemat per gram: 200 g (Rp90/g)"; S-04 peringkat + "+6%" | 0 / 1 |
| 6 | Lebih hemat di mana? | S-03 "Lebih hemat di mana" 3 teratas; S-05 lengkap, toggle produk/group (D-39) | 1 / 2 |

| # | Temuan | Dampak | Penanganan / usulan | Ke |
|---|---|---|---|---|
| F-31 | `PgRpcClient` (`packages/testkit`) mengembalikan baris RPC `RETURNS TABLE` (R9 `price_chart`) sebagai teks, bukan objek seperti PostgREST. | Fixture/test L3 untuk R9 tidak sama dengan produksi. | Diperbaiki di testkit (kode test saja): fungsi dengan argmode `t` dibentuk seperti tipe komposit. | selesai |
| F-32 | `supabase/seed.sql` hanya katalog; tidak ada histori harga untuk user e2e. Ringkasan harga baru ada setelah antrean pg_cron (≤ 10 dtk). | e2e alur 1–2 butuh histori, tren, beberapa toko. | `e2e/support/seed.ts`: record harga untuk household user e2e lewat service role **di proses test**, lalu menunggu `price_summary`. Migration dan seed tidak diubah. | selesai |
| F-33 | R11 `compare_sizes` tidak mengembalikan nama group. | S-04 (dan S-05 mode group tanpa `id`) butuh satu panggilan R4 tambahan untuk judul. | Diambil dari kartu SKU pertama (sama seperti tool AI `bandingkan_ukuran`). Lihat **Q-70**. | Q-70 |
| F-34 | "Ringkasan sedang diperbarui" (§7.2 `SummaryUpdating`) didesain untuk setelah mutasi; M1 belum punya mutasi. | Keadaan khusus S-03 tetap perlu terlihat jika antrean D-31 belum jalan. | S-03 membandingkan `updated_at` histori halaman pertama dengan `summary.refreshed_at`. Komponen mutasi (M3/M5) memakai pola yang sama. | selesai |
| F-35 | Beberapa tujuan tautan M1 baru dibuat di milestone lain: S-14 (barcode tidak dikenal → produk baru, M3), S-16 (tap baris histori, M5), S-19b (`Atur` member, M6), S-20 (`Tanya: …`, M7), kamera struk/label (M2/M4), menu ⋯ (M5). | Tautan ke 404 membingungkan. | Barcode tidak dikenal: pesan + "Scan lagi"/"Cari dengan mengetik". Baris histori tidak bisa di-tap. `/saya/member` placeholder. Baris Tanya tampil nonaktif "Segera hadir". `/kamera?jenis=struk\|label` placeholder. Menu ⋯ berisi aksi nonaktif (+ teks D-30 untuk produk global). Lihat **Q-71**. | Q-71 |
| F-36 | JS halaman `/` 347 KiB gzip (M0: 335 KiB). | Masih di atas 200 kB. | Tetap peringatan sampai M7 (D-84). Tidak ada dependensi baru selain `zod` langsung (versi sama dengan `packages/contracts`, satu salinan di bundle) dan `@priceatlas/db-types` (tipe saja). | D-84 |
| F-37 | `interactive-widget=resizes-content` (supaya SearchDock tetap di atas keyboard virtual) didukung Chrome Android, tetapi tidak Safari iOS. | Di iPhone keyboard bisa menutupi kolom search di bawah (U-02). | Diuji di perangkat sungguhan; jika perlu, posisi dock mengikuti `visualViewport`. Lihat **Q-69**. | Q-69 |
| F-38 | BarcodeDetector tidak ada di Chromium Linux maupun WebKit (runner CI). | Scan barcode tidak bisa diuji e2e; ikon scan tersembunyi di e2e (sesuai D-58). | L5b dengan BarcodeDetector + `getUserMedia` tiruan (terbaca, `via_merge`, tidak dikenal, izin ditolak, tidak didukung). Kamera palsu e2e (`--use-file-for-fake-video-capture`) di M4. | M4 |
| F-39 | Lingkungan pembuatan M1: `supabase start` tetap tidak bisa (CDN image). | e2e tidak bisa dijalankan apa adanya di sini. | e2e dicoba lokal terhadap database mode A lewat Supabase tiruan kecil (auth OTP + PostgREST RPC/REST, tidak di-commit): login, shell offline, dan alur 1–2 lulus di Chromium. WebKit dan Supabase asli diverifikasi di job `supabase-e2e`. | selesai |

**Penyimpangan kecil dari dokumen ini (implementasi M1):**

| Bagian | Dokumen | Implementasi | Alasan |
|---|---|---|---|
| §7.1 route `/` dan `/cari` | Dua layar | Dua route dalam grup `(app)/(cari)` dengan layout bersama `SearchLayout` | SearchDock tidak di-mount ulang saat beranda → hasil cari, sehingga fokus dan keyboard tidak hilang. Debounce 250 ms dilakukan saat menulis `q` ke URL (`router.replace`), S-02 membaca `q` dari URL. |
| §7.1 `/kamera` | Layar penuh tanpa tab bar | Grup `(fullscreen)` dengan penjaga sesi yang sama (`AuthGate`) | Sesuai tabel; M1 hanya `jenis=barcode`. |
| §11.1 L5b `jest-axe` | Dipakai di test komponen | Belum ditambahkan; aturan a11y dicek lewat query peran/label Testing Library (heading, region, dialog, `aria-label` harga/tren) | Menghindari dependensi baru; audit axe ada di M7. |
| §3.3 S-05 → S-03 | "histori difilter ke toko itu" | Parameter `&toko=<store_id>` di `/produk` + chip "Hanya AEON · Tampilkan semua toko" | Slug Indonesia (D-79). |
| S-04/S-05 parameter | `?group=` / `?id=` | Ditambah `jendela=semua`, `lingkup=group` (diganti lewat `router.replace`) | Toggle bisa dibagikan/kembali tanpa menumpuk riwayat. |

---

## 2. Analisis dan Potensi Masalah

| # | Potensi masalah | Dampak | Penanganan di desain ini |
|---|---|---|---|
| P-01 | **SSR berbenturan dengan offline.** Halaman yang dirender di server per request (cookie, data user) tidak bisa disajikan saat offline tanpa menyimpan HTML berisi data pribadi di cache. | Tab Cari, kamera, dan antrean tidak terbuka di basement (T-12). | Shell statis + data di klien (§3.2). HTML tidak pernah berisi data user, jadi aman di-cache service worker. |
| P-02 | **Route dinamis (`/produk/[id]`) tidak bisa di-precache** untuk semua id. Menyajikan HTML id lain untuk id berbeda membuat state router salah. | Detail produk dari cache offline tidak bisa dibuka. | Layar yang perlu offline memakai route statis + query (`/produk?id=…`) (§3.3, Q-46). |
| P-03 | **Service worker tidak bisa membaca sesi Supabase.** `@supabase/ssr` menyimpan token di cookie dokumen; Background Sync juga tidak ada di iOS Safari dan Firefox. | Unggah dari service worker tidak andal dan butuh token tersendiri. | Antrean diunggah dari halaman (saat app dibuka, saat `online`, saat `visibilitychange`). Background Sync tidak dipakai (§5.4). |
| P-04 | **iOS Safari menghapus IndexedDB** situs yang tidak dibuka 7 hari, kecuali PWA dipasang ke layar utama. Kuota juga lebih ketat. | Foto offline bisa hilang di iOS jika tidak dipasang. | Minta `navigator.storage.persist()`, ajakan "Pasang ke layar utama" di iOS setelah foto pertama, dan antrean tidak disimpan lebih lama dari perlu (§5.8, Q-62). |
| P-05 | **Magic link di iOS PWA** dibuka di Safari, yang penyimpanannya terpisah dari PWA terpasang. OAuth Google di mode standalone iOS juga punya riwayat bermasalah. | User masuk di Safari, PWA tetap minta login. | OTP **kode saja** (diketik di app), Google sebagai opsi kedua (D-60, F-20, Q-55). |
| P-06 | **Kompresi di klien mengubah sha256.** Deteksi duplikat hash (U-10) dan worker memakai hash byte yang diunggah. | Foto yang sama dari galeri, diunggah lewat browser berbeda, bisa lolos cek hash tahap 1. | Hash dihitung dari byte final (wajib, karena worker memverifikasi). Tahap 2 (sidik jari struk) tetap menangkap duplikat. Kompresi deterministik per browser (§6). |
| P-07 | **HEIC tidak bisa didekode di Chrome/Android** (canvas gagal). Claude vision (Tahap 6) juga tidak menerima HEIC; worker belum mendekode gambar. | Gambar HEIC lolos ke bucket tanpa kompresi, lalu bermasalah di Tahap 6. | Safari mendekode HEIC sendiri → dikompres ke JPEG. Di browser lain, HEIC diunggah apa adanya (≤ 10 MB, D-69) dan dicatat sebagai pekerjaan Tahap 6 (konversi di worker) (§6.4). |
| P-08 | **EXIF menyimpan lokasi GPS** (PII, UU PDP) dan juga tanggal foto (dibutuhkan W-24, Q-27). | Lokasi rumah/toko user ikut tersimpan 12 bulan. | Klien membaca `DateTimeOriginal` untuk `p_captured_at`, lalu menulis ulang gambar tanpa EXIF (§6.2). |
| P-09 | **Token kedaluwarsa saat antrean offline diunggah.** JWT berumur 1 jam (`jwt_expiry = 3600`). | Unggah pertama setelah offline lama gagal 401. | supabase-js menyegarkan token sebelum request jika online; antrean menunggu `getSession()` selesai, dan 401 dicoba sekali lagi setelah refresh. |
| P-10 | **`crypto.randomUUID()`, kamera, dan service worker butuh secure context.** Membuka `http://192.168.x.x:3000` dari HP saat pengembangan tidak memenuhi syarat itu. | Developer tidak bisa menguji di HP sungguhan. | `next dev --experimental-https` atau tunnel HTTPS; fallback UUID v4 dari `crypto.getRandomValues` (§11.5). |
| P-11 | **Sesi belanja kedaluwarsa saat foto masih di antrean.** | Label masuk ke sesi yang sudah berakhir. | Sudah ditangani backend: `submit_capture` menerima sesi kedaluwarsa (§5.2). Klien tetap mengirim `shopping_session_id` saat foto diambil. Memulai sesi butuh online (Q-54). |
| P-12 | **Antrean berbeda versi setelah deploy.** User offline dengan item antrean format lama, lalu app diperbarui. | Item lama gagal dibaca. | Setiap item antrean punya `schemaVersion`; migrasi kecil saat membaca. SW baru tidak mengambil alih sampai antrean kosong atau user setuju (§5.3). |
| P-13 | **Data pribadi tertinggal di perangkat bersama.** IndexedDB berisi foto struk dan cache produk. | User berikutnya di HP yang sama bisa melihat data. | Data lokal dikunci per `user_id`. Keluar dan hapus akun menghapus IndexedDB + Cache Storage, dengan peringatan jika antrean belum kosong (Q-61). |
| P-14 | **Gambar struk di Cache Storage** (signed URL 5 menit) bertentangan dengan janji PII (D-64). | Gambar struk tersimpan di luar retensi 12 bulan. | Service worker **tidak** meng-cache respons Storage atau REST/RPC. Cache offline hanya lewat IndexedDB yang dikelola app (R5) (§5.2). |
| P-15 | **Polling R13 tiap 5 detik di banyak tab** menghabiskan kuota dan baterai. | Biaya request dan baterai di toko. | Polling hanya jika ada capture `uploaded`/`processing` **dan** tab terlihat. Satu tab pemimpin via `BroadcastChannel` (§5.5). |
| P-16 | **Tanggal relatif dihitung dengan zona perangkat**, bukan zona household (F-12). | "Hari ini" bisa berbeda dengan database antara 00:00–07:00 WIB jika perangkat memakai UTC. | Semua "hari ini" memakai `household.timezone` dari R1 lewat `Intl` (§10.3). |
| P-17 | **`Intl.NumberFormat` gaya `currency` untuk IDR menghasilkan `Rp 19.500`** (dengan spasi tak-putus), sedangkan wireframe §5.3 meminta `Rp19.500`. | Format tidak konsisten antar browser. | Formatter sendiri: `'Rp' + Intl.NumberFormat('id-ID').format(n)`, diuji unit (§10.3). |
| P-18 | **Kamera `getUserMedia` mengambil frame video**, bukan foto penuh. Resolusi video (1080p–4K) bisa kurang tajam untuk struk panjang, dan `ImageCapture.takePhoto()` hanya ada di Chromium. | Kualitas OCR struk turun. | Struk memakai kamera bawaan lewat `<input capture>` (kualitas foto penuh), label dan barcode memakai jendela bidik di app (cepat, tetap terbuka) (Q-51). |
| P-19 | **BarcodeDetector tidak ada di iOS Safari dan Firefox.** | Fitur scan (D-58) tidak ada untuk pengguna iPhone. | Sesuai D-58: ikon disembunyikan. Polyfill WASM sebagai opsi (Q-52). |
| P-20 | **Next.js 16 mengganti `middleware.ts` menjadi `proxy.ts`** dan `next build` memakai Turbopack secara default. Banyak contoh `@supabase/ssr` dan plugin PWA masih memakai pola lama. | Contoh dari internet tidak langsung jalan. | Desain memakai `proxy.ts` (terverifikasi ada di Next 16.4.2 `node_modules`) dan Serwist versi Turbopack (`@serwist/turbopack` 9.5.13 tersedia), dengan spike di M0 (Q-50). |

---

## 3. Arsitektur

### 3.1 Gambaran

```
 Browser (PWA)
 ┌──────────────────────────────────────────────────────────────────────────────┐
 │ App Router (shell statis, Client Components)                                 │
 │   ├─ TanStack Query ──► supabase-js (JWT user) ──► PostgREST: RPC R*/W*, REST │
 │   │      └─ persist ──► IndexedDB "qcache" (data terakhir dimuat)             │
 │   ├─ Antrean foto ────► IndexedDB "outbox" ──► Storage `captures` + W1        │
 │   ├─ Cache offline ───► IndexedDB "offline" (R5, D-60)                        │
 │   └─ Auth ────────────► supabase-js (cookie via @supabase/ssr)                │
 │ Service worker (Serwist): precache shell + aset, fallback offline.            │
 │   Tidak meng-cache /rest, /storage, /auth (P-14).                             │
 └───────────────┬───────────────────────────────────────┬──────────────────────┘
                 │ navigasi / aset                        │ fetch langsung
                 ▼                                        ▼
 ┌─────────── Next.js server ──────────────┐   ┌──────── Supabase ────────┐
 │ proxy.ts: segarkan cookie sesi,          │   │ PostgREST, Storage, Auth │
 │   arahkan ke /masuk jika belum login     │   │ RLS = otorisasi tunggal  │
 │ GET /auth/callback (PKCE Google, Q-53)   │   └──────────────────────────┘
 │ POST /api/account/delete (ada, D-61)     │
 │ POST /api/ask (Tahap 6, D-57)            │
 └──────────────────────────────────────────┘
```

### 3.2 Server Component vs Client Component

| Bagian | Jenis | Alasan |
|---|---|---|
| `app/layout.tsx` (root): `<html lang="id">`, font, manifest, meta viewport/theme | Server, **statis** | Tidak membaca cookie, sehingga bisa di-prerender dan di-precache. |
| Layout grup `(app)`: tab bar, banner sesi, strip offline | Server (kerangka) + Client (isi dinamis) | Kerangka statis; banner sesi dan badge dibaca di klien (R18, hitung `needs_confirmation`). |
| Setiap layar S-xx (`page.tsx`) | Server tipis yang me-render satu Client Component layar | Data per user dan harus jalan offline (P-01). Tidak ada `cookies()`/`headers()` di halaman, sehingga halaman tetap statis. |
| `/auth/callback/route.ts` | Route Handler | Tukar kode PKCE Google menjadi cookie sesi (pola baku `@supabase/ssr`). Tidak memakai service role (Q-53). |
| `proxy.ts` | Proxy (Next 16, pengganti middleware) | Menyegarkan cookie sesi dan mengalihkan ke `/masuk`. **Bukan otorisasi** (RLS yang menolak). |
| `/api/account/delete` | Route Handler (sudah ada) | Butuh service role (D-61). |

**Rekomendasi (Q-45): shell statis + data di klien.**

| Opsi | Kelebihan | Kekurangan |
|---|---|---|
| **A. Shell statis + data di klien** (direkomendasikan) | Bisa di-precache dan dibuka offline (P-01). Satu jalur data (supabase-js di browser) untuk semua layar dan mutasi; tidak ada JWT yang harus diteruskan di server. Cocok dengan D-61 (klien langsung ke Supabase). Hosting sederhana (Tahap 7). | First paint menampilkan skeleton, bukan data (dapat diterima: wireframe §5.5 memang memakai skeleton). Tidak ada SEO (tidak relevan, semua di balik login). |
| B. Server Component mengambil data (SSR per request) | Data tampil di HTML pertama. | Tidak bisa offline tanpa meng-cache HTML berisi data pribadi (P-14). Dua jalur data (server dan klien) untuk layar yang sama. Setiap navigasi butuh round-trip ke server Next.js, lalu ke Supabase (lebih lambat di toko). |
| C. Campuran (SSR untuk layar online-saja seperti S-16, S-17) | Data awal lebih cepat di layar tertentu. | Dua pola untuk dipelihara dan diuji. Manfaatnya kecil karena layar itu jarang. |

### 3.3 Route dan parameter

Semua layar yang harus bisa dibuka offline memakai **route statis + query string** untuk id (P-02, Q-46): `/produk?id=…`, bukan `/produk/[id]`. Layar yang hanya online boleh memakai pola yang sama demi konsistensi. Slug route berbahasa Indonesia (Q-58).

Lapisan seperti sheet dan pemilih (S-03b, S-06, S-07b, S-14 sebagai pemilih) dibuka lewat parameter query (`?sheet=cek-harga`, `?pilih=produk`), sehingga tombol kembali Android menutup lapisan, bukan meninggalkan layar.

### 3.4 Memanggil Supabase (D-61)

| Jenis | Cara | Catatan |
|---|---|---|
| RPC | `rpcCall(name, input)` di `apps/web/lib/data/rpc.ts`: validasi `input` dengan skema zod `packages/contracts` (mis. `SubmitCaptureInput.parse`), lalu `supabase.rpc(name, input)`. Error → `parseRpcError()` → `AppError`. | Satu pintu untuk semua RPC. Nama RPC dibatasi `RPC_NAMES` (kontrak). Output divalidasi zod **di development dan test** saja (biaya parse di produksi). |
| REST | `supabase.from(...)` hanya untuk tabel di daftar "REST langsung" `docs/05` §3.2. Tipe dari `packages/db-types` (Q-44). | PATCH memakai filter `updated_at=eq.T`. 0 baris = konflik (`STALE_WRITE` di sisi klien). |
| Storage | `supabase.storage.from('captures').upload(path, blob, { upsert: false, contentType })` | `upsert: true` butuh policy UPDATE yang memang tidak ada (D-69). |
| Auth | `supabase.auth.*` | §3.5 |

Klien supabase browser dibuat sekali (singleton) dari `lib/supabase/browser.ts` yang sudah ada. **Service role tidak pernah di-import di kode klien** (`import 'server-only'` sudah dipakai di `admin.ts`). CI menambah pengecekan bahwa bundle klien tidak memuat `SUPABASE_SERVICE_ROLE_KEY` (§11.6).

### 3.5 Auth (D-60) dan sesi

**Alur email OTP (utama):**

```
/masuk  ─ketik email─► signInWithOtp({ email, options: { shouldCreateUser: true } })
        ─► layar kode (6 digit, inputmode="numeric", autocomplete="one-time-code")
        ─► verifyOtp({ email, token, type: 'email' })
        ─► sesi tersimpan di cookie (@supabase/ssr)
        ─► R1 get_my_context ─► simpan konteks (household_id, timezone) di memori + IndexedDB
        ─► pertama kali? /selamat-datang : tujuan semula (?next=…)
```

- Template email hanya berisi kode (F-20, Q-55). Magic link tidak dipakai karena masalah iOS PWA (P-05).
- Rate limit Auth dan `otp_expired` dipetakan ke pesan di §8.2.
- **Google:** `signInWithOAuth({ provider: 'google', options: { redirectTo: origin + '/auth/callback?next=…' } })`. Route `/auth/callback` memanggil `exchangeCodeForSession(code)`. Di iOS standalone, tombol Google tetap ada tetapi diberi catatan kecil jika gagal kembali ke app (diuji di M0).

**Penanganan sesi:**

| Bagian | Perilaku |
|---|---|
| `proxy.ts` | Membuat server client dengan cookie request/response, memanggil `supabase.auth.getClaims()` (verifikasi JWT; menyegarkan token jika perlu). Belum login dan route di grup `(app)` → redirect `/masuk?next=…`. Sudah login dan membuka `/masuk` → redirect `/`. Matcher mengecualikan `/_next`, aset, `sw.js`, `manifest.webmanifest`, `/auth/callback`, `/api`. |
| Klien | `onAuthStateChange`: `SIGNED_OUT` → bersihkan cache query + data lokal user itu (Q-61), arahkan ke `/masuk`. `TOKEN_REFRESHED` → tidak ada aksi. |
| Offline | Proxy tidak berjalan (service worker menyajikan shell dari cache). Klien membaca sesi dari cookie; jika tidak ada sesi sama sekali, layar offline menampilkan "Masuk butuh sinyal". |
| Hapus akun (D-76) | Layar meminta login ulang lewat OTP di halaman yang sama (memperbarui `last_sign_in_at`), lalu meminta mengetik `HAPUS AKUN` (`ACCOUNT_DELETE_CONFIRMATION`), lalu `POST /api/account/delete`. 202 → `signOut` + bersihkan data lokal. |

Konteks user (R1) dan konfigurasi (R2) dimuat sekali setelah login, disimpan di IndexedDB untuk offline (household_id dibutuhkan untuk path Storage, timezone untuk tanggal).

---

## 4. Stack UI

Setiap baris adalah **rekomendasi**, bukan keputusan. Persetujuan di Q-47 s/d Q-50.

### 4.1 Styling dan komponen (Q-47)

| Opsi | Kelebihan | Kekurangan |
|---|---|---|
| **A. Tailwind CSS v4 + primitif Radix dengan pola shadcn/ui** (kode komponen disalin ke repo) | Primitif Radix sudah aksesibel (Dialog, Popover, Tabs, Switch, fokus, ARIA). Kode komponen milik repo, bisa disesuaikan untuk label teks (U-15) dan zona jempol. CSS kecil (hanya kelas yang dipakai). Token desain lewat CSS variables. | Kelas utilitas panjang di JSX. Komponen yang disalin harus dirawat sendiri (tidak ada update otomatis). |
| B. CSS Modules + Radix | CSS biasa, mudah dibaca. | Token, spacing, dan responsif ditulis manual. Lebih lambat untuk 27 layar. |
| C. Pustaka lengkap (Mantine, Chakra, MUI) | Komponen siap pakai paling banyak. | Bundle lebih besar (penting di jaringan toko). Gaya default sulit disesuaikan dengan wireframe (aksi di bawah, kartu besar). Sebagian butuh runtime CSS-in-JS. |

**Rekomendasi: A.** Tambahan:

| Kebutuhan | Pilihan | Catatan |
|---|---|---|
| Ikon | `lucide-react` | Tree-shakable, lisensi ISC. Ikon selalu disertai teks atau `aria-label`. |
| Sheet bawah (S-03b, S-06, menu ⋯) | `vaul` (drawer berbasis Radix Dialog) | Gesture tarik ke bawah, fokus terkunci. |
| Toast | `sonner` | Ada `aria-live`. |
| Grafik S-03 | **SVG sendiri** (Q-59) | Hanya titik per tanggal + garis harga terbaik. Pustaka grafik (Recharts ±100 kB) tidak sebanding. Disertai tabel alternatif untuk pembaca layar. |
| Keypad S-03b | Komponen sendiri | Tombol besar, setengah bawah layar (wireframe). |

### 4.2 Form dan validasi (Q-49)

| Opsi | Kelebihan | Kekurangan |
|---|---|---|
| **A. react-hook-form + `@hookform/resolvers/zod`** | Paling umum, re-render minimal, mendukung zod v4 (dipakai `packages/contracts`). | Satu dependensi lagi. |
| B. TanStack Form | Tipe sangat ketat. | Lebih baru, contoh lebih sedikit. |
| C. State React biasa | Tanpa dependensi. | Validasi, error per field, dan dirty state ditulis ulang di S-11, S-15, S-16. |

**Rekomendasi: A.** Aturan: skema form **diturunkan** dari skema kontrak (`CreatePrivateProductInput.shape.p_product`, `CaptureItemPatch`, dll.) lalu ditambah pesan Indonesia, bukan ditulis ulang. Validasi klien hanya untuk umpan balik cepat; server tetap penentu (constraint + RPC).

### 4.3 Data dan cache (Q-48)

| Opsi | Kelebihan | Kekurangan |
|---|---|---|
| **A. TanStack Query v5** + `persistQueryClient` ke IndexedDB | `refetchInterval` kondisional (polling D-61), `networkMode` offline, mutasi dengan retry, invalidasi per kunci, devtools. Persist memberi "konten terakhir tetap tampil" (wireframe §5.5) tanpa kode tambahan. | ±13 kB gzip. Konsep cache perlu dipahami tim. |
| B. SWR | Lebih kecil. | Mutasi, persist, dan offline lebih lemah; banyak ditulis sendiri. |
| C. Fetch manual + context | Tanpa dependensi. | Polling, dedup, retry, invalidasi semua ditulis sendiri. |

**Rekomendasi: A.** Kunci query mengikuti nama RPC: `['rpc', 'search_products', { p_query }]`. Aturan cache:

| Data | `staleTime` | Persist ke IndexedDB | Invalidasi |
|---|---|---|---|
| R1 konteks, R2 config | 1 jam | ya | login, W14, W16 |
| R3 search, R4 kartu, R7–R12 detail | 30 dtk | ya (D-60, data harga milik sendiri) | setelah W4/W5/W6/W7/W9/W10 untuk produk terkait, dan saat `refreshed_at` berubah |
| R13 daftar unggahan, R14 detail | 0 (polling) | ya | setelah W1/W2/W3/W4/W5 |
| R15 struk, R16 item, R20 detail record | 0 | **tidak** (isi struk, P-13/P-14) | setelah mutasi terkait |
| R18 sesi | 30 dtk | ya | W11/W12/W13 |

Mutasi tidak memakai *optimistic update* untuk angka harga (ringkasan dihitung server, menyusul ± 10 detik). Setelah mutasi, UI menampilkan "Ringkasan diperbarui dalam beberapa detik" dan memantau `summary.refreshed_at` (pola §5.5 wireframe).

### 4.4 Struktur folder `apps/web`

```
apps/web/
├─ app/
│  ├─ layout.tsx                 # root statis: lang="id", manifest, theme
│  ├─ (auth)/masuk/page.tsx      # S-00a
│  ├─ (app)/layout.tsx           # tab bar, banner sesi, strip offline
│  ├─ (app)/…/page.tsx           # satu folder per route §7.1
│  ├─ auth/callback/route.ts     # PKCE Google
│  ├─ api/account/delete/route.ts  (sudah ada)
│  ├─ manifest.ts                # Web App Manifest
│  └─ sw.ts                      # sumber service worker (Serwist)
├─ components/ui/                # primitif (button, sheet, dialog, toggle…)
├─ components/price/             # PriceText, UnitPrice, PriceLabel (PROMO/NORMAL/MEMBER…), TrendText
├─ features/<layar>/             # komponen per layar + hooks data
├─ lib/data/                     # rpcCall, queryKeys, hooks R*/W*
├─ lib/offline/                  # outbox (IndexedDB), uploader, offline cache R5
├─ lib/media/                    # kompresi, EXIF, sha256, kamera, barcode
├─ lib/format/                   # Rupiah, harga per satuan, tanggal (zona household)
├─ lib/copy/id.ts                # semua teks UI + pemetaan error §8
├─ lib/supabase/                 # browser.ts, server.ts, admin.ts (sudah ada)
├─ proxy.ts
└─ test/ e2e/
```

---

## 5. PWA dan Offline

### 5.1 Manifest

`app/manifest.ts`: `name: "PriceAtlas"`, `short_name`, `lang: "id"`, `start_url: "/"`, `scope: "/"`, `display: "standalone"`, `orientation: "portrait"`, `background_color`/`theme_color` dari token, ikon 192/512 + `maskable`, `shortcuts` ("Foto struk" → `/kamera?jenis=struk`, "Mulai belanja" → `/belanja`). Meta `apple-mobile-web-app-capable` + ikon `apple-touch-icon` untuk iOS.

### 5.2 Service worker (Q-50)

| Opsi | Kelebihan | Kekurangan |
|---|---|---|
| **A. Serwist** (`@serwist/turbopack` / `@serwist/next`, penerus next-pwa, berbasis Workbox) | Manifest precache dibangkitkan dari output build (aset ber-hash). Strategi runtime Workbox. Mendukung Next 16 + Turbopack (versi 9.5.13 tersedia). | Dependensi build tambahan. Integrasi Turbopack masih baru: perlu spike di M0. |
| B. Service worker tulisan sendiri + `workbox-build injectManifest` di skrip pasca-build | Kontrol penuh, tidak bergantung plugin Next. | Daftar aset dan pembaruan versi ditulis sendiri. Risiko salah cache lebih besar. |
| C. Tanpa service worker (hanya manifest) | Paling sederhana. | Tidak bisa dibuka offline (T-12, D-59 gagal). |

**Rekomendasi: A**, dengan B sebagai cadangan jika spike M0 gagal (fallback: `next build --webpack` + `@serwist/next`).

Aturan cache:

| Permintaan | Strategi |
|---|---|
| Aset `/_next/static/*`, font, ikon | Precache (ber-hash) |
| Navigasi ke route shell (§7.1) | Precache HTML shell; *network-first* dengan fallback ke cache (timeout 3 dtk) |
| Navigasi lain saat offline | Halaman `/offline` |
| `*.supabase.co/rest/*`, `/storage/*`, `/auth/*`, `/api/*` | **Tidak pernah di-cache** (P-14). Data offline lewat IndexedDB yang dikelola app. |

**Pembaruan versi:** SW baru menunggu (`waiting`). Banner kecil "Versi baru tersedia · Muat ulang". Jika antrean foto tidak kosong, pembaruan ditunda sampai antrean kosong (P-12).

### 5.3 Penyimpanan di perangkat (IndexedDB)

Satu database per user: `priceatlas:<user_id>`. Pustaka: `idb` (pembungkus Promise ±1 kB).

| Store | Isi | Batas |
|---|---|---|
| `outbox` | Item antrean foto (§5.4) dengan `schemaVersion` | Tidak dibatasi jumlah; peringatan jika > 50 MB |
| `outbox_blobs` | Byte gambar terkompresi per `(capture_id, position)` | Dihapus setelah `submit_capture` sukses |
| `offline_cards` | `ProductCard` dari R5 + waktu sinkron | ±200 kartu (50 teratas + yang pernah dibuka, cap 150) |
| `qcache` | Persist TanStack Query (§4.3) | Kedaluwarsa 7 hari |
| `prefs` | Pencarian terakhir, baru dicek, onboarding dilihat, toggle tampilan (💾 wireframe §8.3) | Kecil |
| `context` | R1 + R2 terakhir | — |

### 5.4 Antrean foto offline (D-59, U-17)

**Status item (di klien):**

```
captured ──► uploading(i/n) ──► submitting ──► submitted ──(hapus lokal)
   │              │                  │
   │              └─ gagal jaringan / 5xx ─► waiting_network ─(online/fokus/timer)─► uploading
   │                                 └─ CAPTURE_IMAGES_MISSING (F-24) ─► uploading (semua bagian)
   └─ gagal permanen (4xx selain 401/409/422 yang dikenal) ─► error (tampil di S-08 + "Coba lagi"/"Hapus")
```

| # | Langkah | Detail |
|---|---|---|
| 1 | Saat foto diambil (online atau offline) | `capture_id = crypto.randomUUID()` (D-59). Kompres (§6), hitung `sha256` dari byte final, simpan item + byte di IndexedDB **sebelum** apa pun dikirim. Item menyimpan `kind`, `shopping_session_id` (sesi aktif saat foto diambil), `store_id/branch_id` (mode manual), `captured_at`, `household_id`. |
| 2 | Cek duplikat hash (online) | REST `capture_image?select=capture_id,created_at&sha256=in.(…)`. Jika ada → dialog U-10 sebelum unggah. Saat offline, cek ditunda ke langkah 3 dan dialog muncul di S-08 ("Foto ini sepertinya pernah diunggah"). |
| 3 | Unggah | Per bagian: `upload('{household_id}/{capture_id}/{position}.{ext}', blob, { upsert: false, contentType })`. Error "sudah ada" (409/`Duplicate`) = sukses (§5.2 backend). |
| 4 | Daftarkan | W1 `submit_capture({ p_capture_id, p_kind, p_images, p_shopping_session_id, p_store_id, p_branch_id, p_captured_at })`. Idempoten berdasarkan id (D-59). |
| 5 | Selesai | Hapus byte lokal, item ditandai `submitted` lalu dihapus setelah R13 memuat capture itu. |

**Kapan antrean diproses:** saat app dibuka, event `online`, `visibilitychange` ke terlihat, setelah foto baru, dan timer *backoff* (5 dtk, 30 dtk, 2 mnt, 10 mnt) selama app terbuka. Satu tab saja yang memproses (Web Locks API `navigator.locks.request('outbox')`; fallback `BroadcastChannel`). Background Sync tidak dipakai (P-03).

**Di UI:** S-08 bagian paling atas "Menunggu sinyal (3)"; S-07 toast "Foto disimpan di HP. Akan diunggah saat ada sinyal."; S-13 kartu "menunggu sinyal". Item antrean bisa dihapus user sebelum terunggah (lokal saja).

### 5.5 Status unggahan: polling (D-61)

- R13 `list_captures` dengan `refetchInterval: 5000` **hanya jika** ada capture `uploaded`/`processing` di hasil terakhir **dan** `document.visibilityState === 'visible'`. Selain itu tanpa polling; dimuat ulang saat fokus.
- Badge tab Unggahan: `count` capture `needs_confirmation` (REST `head=true, count=exact`, `docs/05` §3.3 S-01), dimuat bersama R13 yang sama saat polling aktif, dan tiap 60 dtk saat tidak.
- Perubahan status penting (selesai diproses, perlu dicek, gagal) diumumkan lewat `aria-live="polite"` dan toast tanpa memblokir (U-11).
- S-13 (sesi aktif) memakai R18 dengan aturan polling yang sama untuk kartu label.

### 5.6 Cache produk offline (D-60, W-22)

- R5 `get_offline_cache(p_viewed_ids, 50)` dipanggil saat online: setelah login, saat app dibuka jika sinkron terakhir > 6 jam, dan setelah konfirmasi struk. `p_viewed_ids` = daftar "pernah dibuka" dari `prefs` (cap 150).
- Saat offline, S-01/S-02 mencari di `offline_cards` dengan normalisasi yang sama dengan `app.normalize_text` (huruf kecil, tanpa diakritik, spasi tunggal) dan pencocokan kata. Hasil diberi label "data tersimpan, mungkin tidak terbaru" (wireframe S-02).
- S-03 offline menampilkan ringkasan dari kartu tersimpan saja (tanpa grafik/histori), dengan teks "Detail lengkap butuh sinyal".

### 5.7 Scan barcode (D-58)

- Deteksi dukungan: `'BarcodeDetector' in window` **dan** `BarcodeDetector.getSupportedFormats()` memuat `ean_13`. Jika tidak, ikon scan disembunyikan (D-58).
- Format: `ean_13`, `ean_8`, `upc_a`, `upc_e` (GTIN) dan `code_128` (PLU/internal).
- Jendela bidik `getUserMedia({ video: { facingMode: 'environment' } })`, deteksi tiap ±150 ms di `requestAnimationFrame`, berhenti saat terbaca. Hasil → R6 `find_product_by_barcode(code, sesi?.store_id)` → S-03 (`via_merge` → toast) atau S-14 dengan kode terisi.
- Tanpa izin kamera → pesan + kembali ke search.

### 5.8 Batasan iOS Safari (ringkas)

| Batasan | Dampak | Penanganan |
|---|---|---|
| Tidak ada `BarcodeDetector` | Scan tidak tersedia | Disembunyikan (D-58); opsi polyfill Q-52 |
| Tidak ada Background Sync / Periodic Sync | Antrean hanya jalan saat app terbuka | Diproses saat dibuka/fokus (§5.4); teks "buka app untuk mengunggah" di S-08 jika antrean > 1 jam |
| IndexedDB dihapus setelah 7 hari tanpa interaksi (tidak berlaku untuk PWA terpasang) | Foto offline bisa hilang | `storage.persist()`, ajakan pasang ke layar utama (Q-62) |
| Tidak ada prompt instal otomatis (`beforeinstallprompt`) | User tidak tahu bisa dipasang | Petunjuk manual "Bagikan → Tambah ke Layar Utama" |
| Magic link dan OAuth membuka Safari, bukan PWA | Sesi di tempat salah | OTP kode (P-05) |
| HEIC dari galeri | Kompresi butuh decoding | Safari mendekode HEIC; `accept="image/*"` umumnya memberi JPEG (§6.4) |
| `getUserMedia` di standalone PWA (iOS lama) | Kamera di app bisa gagal | Fallback `<input capture>` |
| Tidak ada notifikasi push sebelum iOS 16.4 | — | Tidak relevan, push tidak di MVP (D-60) |

---

## 6. Unggah ke Bucket `captures`

### 6.1 Aturan dari backend (D-69, `docs/05` §5.2, §7.3)

| Aturan | Nilai |
|---|---|
| Path | `{household_id}/{capture_id}/{position}.{ext}` (tepat 2 folder; policy `captures_insert`) |
| Ukuran | Maks 10 MB per file (bucket + `SubmitCaptureInput`) |
| Tipe | `image/jpeg`, `image/png`, `image/webp`, `image/heic`; `ext` ∈ `jpg, jpeg, png, webp, heic` |
| Upsert | `false` (tidak ada policy UPDATE) |
| Hash | `sha256` byte yang diunggah, huruf kecil hex; diverifikasi worker |
| Baca | Signed URL 300 dtk, dibuat klien dengan JWT sendiri; tidak di-cache (P-14) |

### 6.2 Pipeline gambar di klien (Q-56)

```
File/Frame ─► baca EXIF (DateTimeOriginal, Orientation, ada GPS?) ─► perlu kompres? (§6.3)
   ├─ tidak ─► byte asli
   └─ ya ─► createImageBitmap(file, { imageOrientation: 'from-image' })
            ─► OffscreenCanvas (atau canvas) skala sisi panjang ≤ batas
            ─► convertToBlob({ type: 'image/jpeg', quality })   # EXIF tidak ikut (P-08)
─► sha256 (crypto.subtle.digest) ─► simpan ke outbox
```

| Parameter | Usulan | Alasan |
|---|---|---|
| Sisi panjang maks — struk (per bagian) | 2560 px | Teks struk kecil; struk panjang sudah dipecah per bagian (S-07). |
| Sisi panjang maks — label, screenshot | 2048 px | Cukup untuk harga dan judul listing. |
| Kualitas JPEG | 0,85 (struk 0,88) | Ukuran ±300–900 kB, teks tetap tajam. |
| Target | ≤ 1,5 MB per gambar | Unggah cepat di sinyal lemah; jauh di bawah 10 MB. |
| Screenshot PNG | Dikonversi ke JPEG 0,9, kecuali ≤ 1,5 MB (dibiarkan PNG) | Teks UI marketplace lebih tajam di PNG kecil. |
| `p_captured_at` | Kamera di app: `new Date()`. Galeri: EXIF `DateTimeOriginal` → `file.lastModified` → kosong. | W-24, Q-27. Dikirim sebagai ISO dengan offset. |
| Kompresi berjalan di | Web Worker (`OffscreenCanvas`), fallback thread utama | Tidak membekukan kamera saat foto berturut-turut. |

### 6.3 Aturan "lewati kompresi" (F-23)

File diunggah apa adanya jika **semua** benar: tipe JPEG/PNG/WebP, ukuran ≤ 1,5 MB, sisi panjang ≤ batas, dan **tidak** ada blok EXIF GPS. Aturan ini menghindari kompresi ganda, menjaga hash file yang sudah kecil (fixture e2e), dan tetap membuang lokasi.

### 6.4 HEIC (P-07)

| Browser | Perilaku |
|---|---|
| Safari iOS/macOS | `createImageBitmap` mendekode HEIC → dikompres ke JPEG. File input `accept="image/*"` umumnya sudah memberi JPEG. |
| Chrome/Android, Firefox | Decoding gagal → jika ≤ 10 MB, unggah HEIC apa adanya (`ext: 'heic'`, D-69), EXIF tetap ada (catatan risiko P-08). Jika > 10 MB → pesan "Format foto ini terlalu besar. Ubah kamera ke JPEG/‘Most Compatible’ atau ambil foto dari app." |

**Catatan Tahap 6:** worker belum mendekode gambar dan Claude vision tidak menerima HEIC. Konversi HEIC → JPEG (dan pembuangan EXIF untuk HEIC) di worker dicatat sebagai pekerjaan Tahap 6.

### 6.5 Multi-gambar (S-07, S-07b)

- Struk panjang: satu `capture_id`, `position` 1..n sesuai urutan bagian. Urutan bisa diubah sebelum "Selesai" (drag atau tombol naik/turun).
- Galeri > 1 gambar: dialog U-09 ("5 struk berbeda" / "1 struk panjang" / "Atur sendiri"). Screenshot default "beberapa screenshot berbeda".
- Batas praktis: 10 bagian per struk (tidak ada batas di backend; mencegah antrean raksasa). Dicatat sebagai default UI, bukan aturan data.

---

## 7. Pemetaan Layar

### 7.1 Route

| Route | Layar | Grup | Offline |
|---|---|---|---|
| `/masuk` | S-00a | `(auth)` | Pesan "butuh sinyal" |
| `/auth/callback` | — (PKCE) | Route Handler | — |
| `/selamat-datang` | S-00b | `(app)` | ya |
| `/selamat-datang/member` | S-00c | `(app)` | tidak |
| `/` | S-01 Beranda / Cari | `(app)` tab Cari | ya (cache) |
| `/cari?q=` | S-02 Hasil cari | `(app)` | ya (cache) |
| `/produk?id=` (+ `?sheet=cek-harga`) | S-03, S-03b | `(app)` | sebagian (§5.6) |
| `/produk/ukuran?group=` | S-04 | `(app)` | tidak |
| `/produk/hemat?id=` / `?group=` | S-05 | `(app)` | tidak |
| sheet global `?sheet=foto` | S-06 | lapisan di layout | ya |
| `/kamera?jenis=struk\|label\|screenshot\|barcode` | S-07 (+ dialog S-07b) | layar penuh, tanpa tab bar | ya |
| `/unggahan` | S-08 | `(app)` tab Unggahan | ya (antrean lokal + cache) |
| `/unggahan/detail?id=` | S-09 | `(app)` | sebagian |
| `/struk?id=` | S-10 | `(app)` | tidak |
| `/konfirmasi?capture=` | S-11 | `(app)` | tidak |
| `/lokasi?mode=sesi\|manual\|koreksi&kembali=` | S-12 | `(app)` | tidak |
| `/belanja` | S-13 | `(app)` tab Belanja | ya (sesi dari cache) |
| lapisan `?pilih=produk&untuk=…` | S-14 | overlay | tidak |
| `/produk/baru` (+ lapisan dari S-14), `/produk/edit?id=` | S-15 | `(app)` | tidak |
| `/harga?id=` | S-16 | `(app)` | tidak |
| `/produk/gabung?id=` | S-17 | `(app)` | tidak |
| `/produk/pisah?id=` | S-18 | `(app)` | tidak |
| `/saya` | S-19 | `(app)` tab Saya | ya |
| `/saya/member` | S-19b | `(app)` | tidak |
| `/saya/berbagi` | S-19c | `(app)` | tidak |
| `/saya/privasi` | S-19 "Privasi & data", hapus akun | `(app)` | tidak |
| `/tanya?q=` | S-20 (kerangka) | `(app)` | tidak |
| `/offline` | fallback SW | statis | ya |

### 7.2 Komponen bersama

| Komponen | Isi | Dipakai di |
|---|---|---|
| `TabBar` | 4 tab + tombol kamera tengah (U-01), badge Unggahan | layout `(app)` |
| `SearchDock` | Kolom search di bawah (U-02), ikon scan (D-58) | S-01, S-02, S-14 |
| `SessionBanner` | "● Belanja di AEON BSD · 1j 12m · 4 label [📷 Foto label]" (U-13) | layout `(app)` |
| `OfflineStrip` | "Offline. Foto tetap tersimpan dan diunggah otomatis." | layout |
| `ProductCard` | Kartu S-02 dari `ProductCard` kontrak; semua keadaan wireframe S-02 | S-01, S-02, S-14 |
| `GroupHeader` | "Paling hemat per gram: 500g" + "Bandingkan ukuran" (U-03) | S-02 |
| `PriceText`, `UnitPrice`, `PriceLabel`, `TrendText`, `DataCount` | Format §10.3; label §5.2 wireframe; tren U-05; "9 data · terakhir 3 hari lalu" (D-15) | semua |
| `HistoryRow` | Baris histori `price_record_view` | S-03, S-16, S-18 |
| `CaptureRow` | Baris S-08 per status | S-08, S-13 |
| `ScreenState` | Pola memuat (skeleton) / kosong / gagal + "Coba lagi" / offline (wireframe §5.5) | semua |
| `SummaryUpdating` | "Ringkasan sedang diperbarui…" saat `refreshed_at` < waktu mutasi terakhir | S-02, S-03, S-16 |
| `StickyAction` | Tombol aksi utama menempel di bawah (U-07, zona jempol) | S-03, S-10, S-11, S-16 |
| `ConfirmTwice` | Konfirmasi dua langkah (merge beda ukuran U-16, hapus akun) | S-17, S-19 |

### 7.3 Per layar

Keterangan: **Data** = RPC/tabel (`docs/05` §3.2–3.3). **Keadaan** = memuat / kosong / gagal plus keadaan khusus dari wireframe. Pesan error lengkap di §8.

| Layar | Komponen utama | Data | Memuat | Kosong | Gagal / keadaan khusus |
|---|---|---|---|---|---|
| **S-00a** Masuk | `EmailForm`, `OtpForm` (6 kotak, tempel otomatis), `GoogleButton` | Auth `signInWithOtp`, `verifyOtp`, `signInWithOAuth`; lalu R1 | Tombol "Mengirim…" / "Memeriksa…" | — | Kode salah/kedaluwarsa, rate limit, offline (§8.2) |
| **S-00b** Selamat datang | Teks nilai produk, "Mulai", "Lewati" | 💾 `prefs.onboarded` | — | — | — |
| **S-00c** Member (onboarding) | `ProgramList` (sama dengan S-19b) + "Lewati" | R21, W16 | skeleton daftar | "Belum ada program di katalog" | `INVALID_STATE` (program dihentikan) |
| **S-01** Beranda | `SearchDock`, `RecentSearches`, `RecentlyViewed`, `NewPrices`, badge perlu dicek, `SessionBanner` | R4 (≤ 5 id 💾), REST `price_record_view` 10 terbaru + R4, REST `capture` count, R18, R5 (offline) | skeleton "Harga baru masuk" | U-19: tiga kartu ajakan (foto struk, mulai sesi, coba cari) | Gagal: konten terakhir tetap + "Coba lagi". Offline: strip + cari di cache |
| **S-02** Hasil cari | `GroupSection` → `GroupHeader` + `ProductCard`[], baris "Tanya: …" | R3 (debounce 250 ms, ≥ 2 huruf), dikelompokkan per `group.id` di klien; R6 dari scan | 3 kartu skeleton | "Tidak ada produk 'milo actv'. Coba kata lain, scan barcode, atau foto labelnya." + baris Tanya | Tren belum cukup, hanya all-time, cabang tidak diketahui, PRIBADI, member tidak dihitung (→ S-19b), hanya bundle, produk tanpa histori, online "belum termasuk ongkir", offline "data tersimpan" |
| **S-03** Detail produk | `ProductHeader`, `SummaryBlock`, `PriceChart` (+ toggle "Hanya harga normal"), `WhereCheaperTop3`, `OtherSizes`, `HistoryList` (cursor), `MoreMenu` (bawah), `StickyAction` "Cek harga rak" | R7 (redirect_to → `router.replace` + toast), R9, R12 (3 teratas), R11, R8; REST `PATCH product` (arsip privat) | skeleton per bagian | "Foto label atau struk yang memuat produk ini." | `NOT_FOUND` ("Produk tidak ditemukan atau bukan milikmu"), produk merged → alih, global (Gabungkan nonaktif + teks D-30), tren belum cukup (teks D-44), baris bundle/member/void/cabang tidak diketahui, timbang, ringkasan diperbarui |
| **S-03b** Cek harga rak | `Keypad`, `ShelfResult` | Data R7 + R11 yang sudah dimuat, R2 `near_best_threshold_pct`, `unitPrice()` kontrak | — | "Belum ada pembanding di historimu." (hanya harga per satuan) | Lebih murah / mendekati (≤ 5%) / lebih mahal; timbang = input per kg. Tanpa tulis (D-55). "Foto labelnya untuk disimpan" → `/kamera?jenis=label` |
| **S-04** Bandingkan ukuran | `SizeTable` per dimensi & mata uang, toggle 90 hari/sepanjang masa | R11 | skeleton baris | "Baru ada satu ukuran di group ini." | Sebagian tanpa data (bawah, tanpa peringkat), dimensi beda ("Tidak dibandingkan: satuan berbeda"), mata uang beda, SKU lama "data terakhir Mar 2026", PRIBADI, `NOT_FOUND` |
| **S-05** Lebih hemat di mana | toggle produk/group, toggle 90 hari/sepanjang masa, `StoreRankRow` | R12 → tap → S-03 dengan R8 `p_store_id` | skeleton | "Belum ada histori 90 hari. Lihat sepanjang masa?" | Cabang tidak diketahui (baris terpisah), online "harga belum termasuk ongkir", tutup → penerus, "baru 1 data" (D-60) |
| **S-06** Pilih jenis foto | Sheet 3 tombol + "Pilih dari galeri" | R18 (urutan U-08, teks "Label harga akan masuk ke AEON BSD") | — | — | Tanpa sesi: Label → S-12 manual |
| **S-07** Kamera | `Viewfinder` (label/barcode), `NativeCapture` (struk, Q-51), `ThumbStrip`, `ShutterBar` (bawah) | Lokal (§5.4, §6); REST cek hash; W1 lewat antrean | — | — | Izin ditolak → "Pilih dari galeri"; duplikat hash (dialog U-10); offline (toast); panduan kualitas; "Selesai" → kembali + toast (U-11) |
| **S-07b** Galeri | Dialog U-09 | Lokal | — | — | Gambar > 10 MB / format tidak didukung (§6.4) |
| **S-08** Unggahan | Bagian: Menunggu sinyal (lokal), Perlu dicek, Sedang diproses, Selesai, Gagal; filter jenis | Outbox lokal + R13 (polling §5.5) | skeleton | "Belum ada unggahan. Foto struk pertamamu untuk mulai mengisi histori." + tombol kamera | Semua beres: "Semua sudah dicek". Gagal: `error_code` → teks §8.3 + "Ulangi" (W2) |
| **S-09** Detail unggahan | `ImageCarousel` (signed URL), `StatusTimeline`, aksi per status | R14, Storage `createSignedUrl(path, 300)`, W2, W3 | skeleton | — | `uploaded` (Hapus), `processing` (bilah tak tentu), `needs_confirmation` (Cek sekarang → S-10/S-11), `done` (daftar ringkas), `failed` (Ulangi / Foto ulang / Hapus), gambar dihapus retensi, `INVALID_TRANSITION`/`INVALID_STATE` |
| **S-10** Konfirmasi / detail struk | `DuplicateBanner`, `ReceiptHeader` (✎), `TotalsCheck`, `NeedsCheckList` (Benar / Ganti / Bukan produk / ⋯ bundle / lewati), lipatan Tersimpan otomatis / Bukan produk / Voucher & poin, `MemberHintBox`, `StickyAction` "Simpan N harga" | R15; REST `PATCH receipt` (filter `updated_at`); W16; W4; W7 (mode tersimpan) | skeleton | "Semua item sudah dikenali." | Duplikat (simpan nonaktif sampai memilih), toko belum dikenali (→ S-12), field ragu (`field_confidence` < τ diberi teks "ragu"), total tidak cocok (peringatan), cabang tidak diketahui, multi-gambar, kuantitas, void dicoret, timbang, menyimpan, gagal (pilihan dipertahankan di memori + `sessionStorage`) |
| **S-11** Konfirmasi label/screenshot | `ObservationItem` (crop dari `region`), editor harga, "Dihitung untukmu" (`computed`), `LocationRow`, `DateRow`, toggle bundle, `StickyAction` | R16; W18 per perubahan (debounce, `p_expected_updated_at`); W16 lalu muat ulang R16; W5 | skeleton | — | Member belum berlaku, cabang/toko tidak diketahui (`STORE_REQUIRED` → S-12), promo kuantitas, bundle, judul listing beda ukuran (peringatan klien), beberapa label "1/3", produk tidak dikenali, promo berakhir, `NO_APPLICABLE_PRICE` |
| **S-12** Pilih toko & cabang | Langkah 1 toko (terakhir dipakai di bawah, search), langkah 2 cabang, "+ Toko baru", "+ Cabang baru", "Tidak tahu cabangnya" (manual saja) | R17; REST `store`, `branch`; W17; W11 (mode sesi) | skeleton | "Belum ada toko terakhir" | Cabang tutup (bawah, tidak bisa untuk sesi; `BRANCH_CLOSED`), mode sesi tanpa "Tidak tahu" |
| **S-13** Sesi belanja | `SessionHeader` (mulai, berakhir otomatis), `SessionLabels`, "Akhiri sesi" (kecil, kiri), "Foto label" (besar, kanan) | R18 (polling saat ada label diproses); W12, W13; antrean lokal | skeleton | Tanpa sesi: ajakan + "Mulai belanja" → S-12 + sesi terakhir (R17). Aktif tanpa label: "Foto label harga pertama." | Hampir kedaluwarsa < 30 mnt ("Perpanjang", W12), kedaluwarsa (D-43, teks ringkasan), `SESSION_NOT_ACTIVE`, offline (kartu menunggu sinyal) |
| **S-14** Pilih produk | `SearchDock` (prefill `raw_text`/judul), `Suggestion`, `Candidates` (≤ 5), hasil R3, "+ Buat produk baru" | R3; saran/kandidat dari R15/R16 | skeleton | "Tidak ditemukan · Buat produk baru" | Peringatan beda ukuran (klien), mode target merge (sembunyikan sumber; global/privat sendiri) |
| **S-15** Produk baru / edit | Form (react-hook-form + zod dari `CreatePrivateProductInput`), pratinjau ukuran, "Produk serupa sudah ada" (R3) | W8; REST `PATCH product` (edit, filter `updated_at`) | — | — | Kemasan / multipack / timbang; validasi; `23514`, `23P01` (barcode tumpang tindih); edit ukuran → teks hitung ulang |
| **S-16** Detail & koreksi harga | Field record, gambar sumber, info matching, riwayat (audit), `StickyAction` "Simpan perubahan" | R20; W6 (`p_update_alias` ditawarkan); W7 (record struk); REST `PATCH receipt` (tanggal/toko struk) | skeleton | — | Dari label / struk ("mengubah baris struk") / screenshot (ongkir), gambar dihapus, produk global, `STALE_WRITE`, `USE_RECEIPT_LINE`, `NO_APPLICABLE_PRICE`, ringkasan diperbarui |
| **S-17** Gabungkan | Pilih target (S-14 mode merge) → `MergePreview` → `ConfirmTwice` jika beda ukuran | R19; W10; REST `PATCH product` (pindah group) | skeleton | — | Global tidak bisa memulai (D-30), beda ukuran/dimensi (U-16), sudah merged ke target sama = sukses (§4.4), `42501`, `P0001` |
| **S-18** Pisahkan | Langkah: produk tujuan (S-15/S-14) → centang record (filter toko & sumber) → opsi alias → konfirmasi | W8 / R3; R8; W9 | skeleton | Tombol nonaktif sampai ada yang dicentang | `RECORDS_NOT_OWNED`; gagal di antara T1 dan T2 → ulangi T2 dengan id sama (§4.5) |
| **S-19** Saya | Profil (nama), Program member, Berbagi publik, Privasi & data, Keluar | REST `profile`; R1; Auth `signOut` | skeleton | — | Keluar dengan antrean belum kosong → peringatan (Q-61) |
| **S-19b** Program member | `ProgramList` per toko dengan toggle + kalimat wajib D-27/D-41 | R21, W16 | skeleton | "Program belum ada di katalog" (W-05) | Program dihentikan (toggle nonaktif + label), `INVALID_STATE` |
| **S-19c** Berbagi publik | Toggle (default mati), penjelasan apa yang dibagikan/tidak, "Bagikan juga data lama" | R1 (`share_prices_public`); W14 → `withdrawn_count`; W15 → `eligible_count` | — | — | Mematikan → konfirmasi "Harga yang sudah dibagikan akan ditarik"; `FORBIDDEN` (bukan owner); `INVALID_STATE` (W15 saat mati) |
| **S-19 Privasi** | Info retensi 12 bulan (D-32), hapus akun (login ulang OTP + ketik `HAPUS AKUN`) | Auth OTP; `POST /api/account/delete` | — | — | `REAUTH_REQUIRED`, `DELETE_FAILED`, `DELETE_INCOMPLETE` |
| **S-20** Tanya | Kerangka saja (§9) | — (Tahap 6) | — | — | — |

---

## 8. Pemetaan Kode Error ke Pesan UI

### 8.1 Mekanisme

1. Semua error RPC lewat `parseRpcError()` (`packages/contracts`) → `{ code, sqlstate, http, detail, hint }`.
2. `lib/copy/id.ts` memetakan `code` (atau `sqlstate` untuk error bawaan) ke **pesan + aksi**. Pesan boleh berbeda per layar (konteks), dengan pesan umum sebagai cadangan.
3. Jika kode tidak dikenal: pakai `hint` dari server (sudah berbahasa Indonesia, `app.err()`), lalu cadangan umum.
4. Error jaringan (`TypeError: Failed to fetch`, timeout) dibedakan dari error server: pesan "Tidak ada sinyal" + data terakhir tetap tampil (wireframe §5.5).
5. Test unit memastikan **setiap** `ErrorCode` di `ERROR_HTTP` punya entri pesan (test gagal jika kode baru ditambah tanpa pesan).

### 8.2 Tabel pesan

| Kode (HTTP) | Layar utama | Pesan UI | Aksi |
|---|---|---|---|
| `NOT_FOUND` (404) | S-03, S-09, S-10, S-11, S-16 | "Data ini tidak ditemukan. Mungkin sudah dihapus." | "Kembali" |
| `STALE_WRITE` (409) | S-10, S-11, S-15, S-16 | "Data ini baru saja berubah di tempat lain. Kami muat ulang versi terbaru; periksa lagi lalu simpan." | Muat ulang otomatis, perubahan user ditampilkan ulang di form jika masih berlaku |
| `INVALID_STATE` (409) | S-09 hapus | "Unggahan yang sedang diproses atau sudah selesai tidak bisa dihapus." | — |
| | S-10 | "Struk ini sudah dibuang, jadi tidak bisa disimpan." | "Lihat unggahan" |
| | S-11 | "Item ini sudah diputuskan sebelumnya." | Muat ulang |
| | S-19b | "Program ini sudah dihentikan dan tidak bisa ditandai." | — |
| | S-19c | "Nyalakan berbagi harga dulu sebelum membagikan data lama." | — |
| `INVALID_TRANSITION` (409) | S-09 ulangi | "Unggahan ini tidak sedang gagal, jadi tidak perlu diulang." | Muat ulang status |
| `DUPLICATE_DECISION_REQUIRED` (409) | S-10 | "Struk ini mirip struk {toko} {tanggal}, total {total}. Pilih dulu: simpan sebagai struk berbeda, atau buang yang ini." | Fokus ke banner duplikat (`detail` = id struk lama) |
| `SESSION_NOT_ACTIVE` (409) | S-13 | "Sesi belanja ini sudah berakhir. Mulai sesi baru untuk lanjut." | "Mulai sesi baru" |
| `RECEIPT_STORE_REQUIRED` (422) | S-10 | "Pilih toko untuk struk ini sebelum menyimpan." | Buka S-12 |
| `UNDECIDED_LINES` (422) | S-10 | "Masih ada {n} barang yang belum diputuskan. Pilih Benar, Ganti, Bukan produk, atau Lewati." | Gulir ke baris pertama (`detail.line_ids`) |
| `STORE_REQUIRED` (422) | S-11 | "Pilih toko untuk harga ini. Cabangnya boleh tidak diisi." | Buka S-12 mode koreksi |
| `NO_APPLICABLE_PRICE` (422) | S-11, S-16 | "Belum ada harga yang berlaku untukmu di tanggal ini. Isi harga normal, atau tandai keanggotaan member jika kamu member." | Fokus ke field harga normal |
| `USE_RECEIPT_LINE` (422) | S-16 | "Harga dari struk diubah lewat baris struknya." | Buka editor baris struk (W7) |
| `RECEIPT_DERIVED_FIELD` (422) | S-16 | "Angka ini dihitung dari baris struk dan tidak bisa diubah langsung." | Sama |
| `INVALID_EXTRA` (422) | S-11, S-16 | "Info tambahan (ongkir, voucher, catatan) tidak valid. Periksa lagi isiannya." | Fokus ke bagian info tambahan |
| `CAPTURE_IMAGES_MISSING` (422) | antrean (tidak tampil) | Ditangani otomatis: unggah ulang semua bagian lalu daftar ulang (F-24). Jika tetap gagal: "Sebagian foto belum terunggah. Kami coba lagi otomatis." | "Coba lagi" di S-08 |
| `BRANCH_CLOSED` (422) | S-12 sesi | "Cabang ini sudah tutup. Pilih cabang lain atau tambah cabang baru." | — |
| `RECORDS_NOT_OWNED` (403) | S-18 | "Sebagian data yang dipilih bukan milikmu. Muat ulang daftar lalu pilih lagi." | Muat ulang R8 |
| `MERGE_FORBIDDEN` / `42501` (403) | S-17 | "Produk katalog umum hanya bisa digabung oleh kurator." (D-30) | — |
| `FORBIDDEN` (403) | S-19c, umum | "Kamu tidak punya izin untuk aksi ini." | — |
| `INVALID_INPUT` (400) | umum | "Isian tidak valid. Periksa lagi lalu coba simpan." (bug klien; dicatat ke log) | — |
| `REAUTH_REQUIRED` (401) | S-19 Privasi | "Untuk menghapus akun, masuk ulang dulu (kode dikirim ke emailmu), lalu ketik HAPUS AKUN." | Mulai login ulang OTP |
| `22023` (400) | S-02 | Tidak tampil: search hanya dipanggil jika ≥ 2 huruf. | — |
| `23503` (400) | S-10 header, S-17 pindah group | "Cabang ini bukan cabang dari toko yang dipilih." / "Group ini tidak tersedia." | — |
| `23505` (409) | create dengan id klien | Diperlakukan sebagai sukses (idempoten, `docs/05` §3.1) | — |
| `23514` (400) | S-15 | "Isi ukuran kemasan untuk produk yang dijual per kemasan." | Fokus ke field ukuran |
| `23P01` (409) | S-15 | "Barcode ini sudah dipakai produk lain di periode yang sama." | — |
| `P0001` (400/500) | S-17 | "Produk tujuan tidak aktif atau bukan milikmu. Pilih produk lain." | — |
| Route `DELETE_FAILED` (500) | S-19 Privasi | "Gagal memulai penghapusan akun. Tidak ada yang berubah; coba lagi." | "Coba lagi" |
| Route `DELETE_INCOMPLETE` (500) | S-19 Privasi | "Penghapusan belum selesai. Coba lagi." | "Coba lagi" |
| Auth `otp_expired` | S-00a | "Kode sudah kedaluwarsa. Kirim kode baru." | "Kirim ulang" (jeda 60 dtk) |
| Auth kode salah | S-00a | "Kode salah. Periksa 6 angka di emailmu." | — |
| Auth rate limit (429) | S-00a | "Terlalu sering meminta kode. Tunggu sebentar lalu coba lagi." | Hitung mundur |
| Storage > 10 MB / tipe ditolak | S-07, S-07b | "Foto terlalu besar atau formatnya tidak didukung (JPG, PNG, WebP, HEIC, maks 10 MB)." | — |
| Jaringan | semua | "Tidak ada sinyal. Data yang terakhir dimuat tetap ditampilkan." | "Coba lagi" |
| Tidak dikenal (5xx) | semua | `hint` server, atau "Terjadi kesalahan. Coba lagi sebentar lagi." | "Coba lagi" |

### 8.3 Alasan gagal proses (`capture.error_code`, D-71) di S-08/S-09

| `error_code` | Teks | Aksi utama |
|---|---|---|
| `blurry` | "Gambar buram atau terpotong." | "Foto ulang" |
| `not_a_receipt` | "Ini sepertinya bukan struk atau label harga." | "Foto ulang" / "Hapus" |
| `unsupported` | "Format gambar ini belum bisa dibaca." | "Foto ulang" |
| `timeout` | "Pemrosesan terlalu lama. Coba ulangi." | "Ulangi" (W2) |
| `other` / null | `error_message` dari server, atau "Gambar tidak terbaca." | "Ulangi" |

---

## 9. S-20 Tanya (Kerangka)

Sesuai D-57: hanya kerangka di Tahap 5, integrasi AI di Tahap 6.

| Bagian | Tahap 5 | Tahap 6 |
|---|---|---|
| Route `/tanya?q=` dan baris "Tanya: …" di S-02 | Ya. Baris tampil di bawah hasil search dan di keadaan "Tidak ditemukan". | — |
| Tata letak (pertanyaan, jawaban, "Dijawab dengan: tool(…)", tautan ke layar sumber, chip contoh pertanyaan) | Ya, dengan komponen `AskMessage`, `ToolSource`, `ExampleChips` | Diisi jawaban sungguhan |
| Keadaan memuat ("Mencari di historimu…"), di luar kemampuan, data kurang, produk ambigu (chip) | Komponen dibuat, diuji dengan data contoh di test komponen | Dipakai |
| Pengiriman pertanyaan | Tombol kirim nonaktif + teks "Segera hadir. Untuk sekarang, pakai hasil cari, Bandingkan ukuran, dan Lebih hemat di mana." | `POST /api/ask` (D-61) memakai `packages/ai-tools` |
| Riwayat percakapan | — | 💾 di perangkat (wireframe), tidak di DB |

Tahap 5 **tidak** menambah dependensi Claude atau API key di `apps/web`.

---

## 10. Aksesibilitas dan i18n

### 10.1 Target dan aturan

Target **WCAG 2.1 AA** (U-15). Aturan yang dicek di review dan test:

| Aturan | Penerapan |
|---|---|
| Label tidak hanya warna (U-15) | `PriceLabel` selalu teks (`PROMO`, `NORMAL`, `MEMBER · …`, `BUNDLE · tidak dihitung`, `ragu`). Warna hanya penguat. |
| Target sentuh | ≥ 44 × 44 px; aksi utama ≥ 48 px tinggi, lebar penuh di bawah |
| Kontras | Teks ≥ 4,5:1, teks besar/ikon ≥ 3:1; diperiksa axe (§11) |
| Bahasa | `<html lang="id">`; istilah asing (mis. "PROMO") tetap dibaca wajar |
| Angka dibacakan | `UnitPrice` memberi `aria-label` "97,5 rupiah per gram"; tren "turun 4 persen dibanding 30 hari sebelumnya" |
| Fokus | Sheet/dialog (Radix) mengunci dan mengembalikan fokus; navigasi antar route memindahkan fokus ke judul layar |
| Status asinkron | `aria-live="polite"` untuk hasil unggah, ringkasan diperbarui, jumlah hasil search; `assertive` hanya untuk error simpan |
| Kamera | Selalu ada alternatif "Pilih dari galeri"; tombol shutter berlabel |
| Grafik | Tabel alternatif (tanggal, harga per satuan, label) bisa dibuka |
| Gerak | Hormati `prefers-reduced-motion` (sheet tanpa animasi pegas) |
| Zoom | Tidak memblokir pinch-zoom (`maximum-scale` tidak dipakai); tata letak tetap jalan di 200% |
| Keyboard (desktop) | Semua aksi bisa dijangkau Tab; keypad S-03b menerima ketikan angka |

### 10.2 i18n (Q-57)

MVP hanya **id-ID**. Tidak memakai pustaka i18n; semua teks di `lib/copy/id.ts` (satu tempat, bisa diterjemahkan nanti). Kode, nama komponen, dan identifier tetap berbahasa Inggris; teks UI dan slug route berbahasa Indonesia (Q-58). Pustaka seperti `next-intl` ditunda sampai ada bahasa kedua.

### 10.3 Format (wireframe §5.3)

| Format | Aturan | Contoh |
|---|---|---|
| Rupiah | `'Rp' + Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 })` (P-17) | `Rp19.500` |
| Harga per satuan | Koma desimal, maks 1 desimal; 2 desimal jika < Rp1; satuan dasar `g/ml/pcs/m` | `Rp97,5/g`, `Rp0,85/ml` |
| Produk timbang | Harga per `content_unit` sebagai angka utama | `Rp45.000/kg`, baris "0,535 kg · Rp24.075" |
| Persen | `Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 })` + "%" | `↓ 4% vs 30 hari sebelumnya` |
| Tanggal transaksi (`date`, tanpa jam) | Relatif jika < 7 hari dari **hari ini di zona household** ("hari ini", "kemarin", "3 hari lalu"); selain itu `12 Okt 2026` (`Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })`) | `3 hari lalu`, `12 Okt 2026` |
| Waktu (`timestamptz`: unggah, sesi) | Ditampilkan di `household.timezone` (R1), bukan zona perangkat (P-16) | `14:05`, `diunggah 2 menit lalu` |
| Durasi sesi | `1j 12m` | banner sesi |

Tanggal transaksi adalah tipe `date` (string `YYYY-MM-DD`) dan **tidak pernah** diubah menjadi `Date` lalu diformat dengan zona waktu (menghindari geser satu hari). Semua formatter diuji unit, termasuk batas tengah malam WIB vs UTC.

---

## 11. Strategi Test dan CI

### 11.1 Lapisan

| Lapisan | Alat | Lingkungan | Cakupan |
|---|---|---|---|
| **L5a Unit** | vitest | Node / jsdom | Formatter (§10.3), pemetaan error (§8, lengkap untuk semua `ErrorCode`), state machine outbox (dengan `fake-indexeddb`), aturan kompresi/lewati (§6.3, logika saja), normalisasi search offline, query keys, penurunan skema form dari kontrak |
| **L5b Komponen** | vitest + Testing Library + jsdom; fixture data | tanpa jaringan | Setiap layar S-xx di setiap keadaan tabel §7.3 (memuat, kosong, gagal, keadaan khusus). Fixture divalidasi zod kontrak **dan** sebagian diambil dari keluaran RPC asli (L3 mode A) supaya tidak menyimpang dari server. `jest-axe` untuk pelanggaran a11y dasar. |
| **L5c Browser-only** | vitest browser mode (Playwright provider) | Chromium headless | Kompresi gambar nyata (canvas/OffscreenCanvas), sha256, EXIF dibuang, IndexedDB nyata |
| **L5d e2e** | Playwright | **Supabase CLI** (`supabase start`) + worker stub (`EXTRACTOR=stub`) + `next build && next start` | Alur 1–8 (§11.3) di profil mobile Chromium (Pixel 7) dan WebKit (iPhone 14) |
| L1–L4 (ada) | — | — | Tetap; L4 diotomasi di job e2e yang sama (§11.4) |

### 11.2 Login di e2e

Tanpa membaca email: setup test memakai service role untuk `auth.admin.generateLink({ type: 'magiclink', email })`, mengambil `email_otp`, lalu UI memasukkan kode di S-00a. Satu test khusus memakai API Mailpit (F-18) untuk membuktikan template berisi kode (F-20). Google tidak dites e2e (butuh akun sungguhan); hanya `/auth/callback` diuji unit dengan klien tiruan.

### 11.3 Skenario e2e (urut menurut alur)

| # | Alur | Skenario |
|---|---|---|
| 1 | Cari | Seed → cari "milo" → kartu menampilkan harga 90 hari, label, per gram, tren/teks data belum cukup, jumlah data |
| 2 | Detail | Kartu → S-03 → grafik, 3 toko teratas, Cek harga rak (lebih murah / mendekati / lebih mahal) → S-04 → S-05 |
| 3 | Struk | Galeri fixture `struk-aeon.jpg` → antrean → W1 → worker stub → polling S-08 → "perlu dicek" → S-10 → Benar/Ganti/Bukan produk → Simpan → "N harga baru tersimpan" |
| 3b | Duplikat | Unggah file yang sama → dialog hash; konfirmasi → banner duplikat → buang |
| 4 | Sesi | Mulai sesi (S-12) → banner → foto label fixture (kamera palsu Chromium `--use-file-for-fake-video-capture`) → S-13 kartu → perpanjang → akhiri |
| 5 | Screenshot | `shopee-milo` → S-11 → ongkir sebagai info → simpan |
| 6 | Koreksi | S-16 ubah harga observasi; record struk → editor baris; `STALE_WRITE` (dua tab) |
| 7 | Pengaturan | Member on → S-11 `computed` berubah; berbagi publik on/off; hapus akun (login ulang + teks) |
| 8 | Onboarding | Login OTP pertama → S-00b → S-00c → S-01 keadaan kosong |
| O | Offline | `context.setOffline(true)` → foto masuk antrean → S-08 "Menunggu sinyal" → online → terunggah; cari di cache R5; buka shell offline |
| G | Gagal | `struk-buram` → S-09 "Gambar buram" + Ulangi; `struk-alfamart-timeout` → retry otomatis |

### 11.4 CI (GitHub Actions)

| Job | Kapan | Isi |
|---|---|---|
| `test` (ada) | setiap push/PR | Ditambah: lint (ESLint flat + `eslint-plugin-jsx-a11y`, Q-63), typecheck web, L5a–L5b, `next build`, cek bundle klien tidak memuat service role key, anggaran ukuran JS halaman utama (≤ 200 kB gzip, peringatan) |
| `browser` (baru) | setiap PR | L5c (Chromium dari `playwright install --with-deps chromium`) |
| `supabase-e2e` (baru) | setiap PR ke `master` + nightly | `supabase start` (Docker tersedia di runner) → L4 otomatis (policy Storage, `PTnnn` → HTTP, OTP via Mailpit, `99_privilege_inventory` terhadap DB Supabase) → `supabase gen types` + **cek drift `packages/db-types`** (F-19) → worker stub → L5d Playwright (Chromium + WebKit). Image Docker di-cache. |

Jika Q-43 disetujui, job `test` pindah ke service `postgres:17`.

### 11.5 Pengembangan di HP sungguhan

`pnpm --filter @priceatlas/web dev --experimental-https` (sertifikat lokal) atau tunnel HTTPS, supaya kamera, `crypto.randomUUID`, dan service worker aktif (P-10). Service worker dimatikan di `next dev` secara default (cache membingungkan saat develop), dinyalakan lewat env `NEXT_PUBLIC_SW_DEV=1`.

### 11.6 Pengaman

- `scripts/check-secrets.sh` (ada) + cek bahwa `.next/static/**` tidak memuat `SUPABASE_SERVICE_ROLE_KEY`/`service_role`.
- Header keamanan dari `next.config.ts`: CSP (`connect-src` ke URL Supabase, `img-src 'self' blob: data:` + domain Storage), `Referrer-Policy: same-origin`, `Permissions-Policy: camera=(self)`.

---

## 12. Rencana Milestone 5b

Urutan mengikuti alur paling penting: **cari & detail harga → unggah struk → konfirmasi → sesi belanja → pengaturan**. Setiap milestone berakhir dengan test hijau, layar diperiksa di HP (Chromium Android + Safari iOS jika tersedia), dan commit terpisah.

| M | Nama | Isi | Layar | Selesai jika |
|---|---|---|---|---|
| **M0** | Fondasi | Keputusan Q-43 (PG17) diterapkan + L1–L3 hijau; `config.toml` diperbaiki (F-17, F-18, F-21); `.env` mode B (F-22); `supabase/templates` (F-20); job CI `supabase-e2e` dengan L4 + `db-types` (F-19); Tailwind + primitif UI + token; `proxy.ts`; `/auth/callback`; S-00a; layout `(app)` + `TabBar` + `OfflineStrip`; `rpcCall` + `parseRpcError` → `lib/copy`; formatter §10.3; TanStack Query + persist; spike Serwist (Q-50); Playwright kerangka + login e2e | S-00a | Login OTP e2e lulus di Supabase lokal (CI); L4 lulus; `db-types` terbangkit; shell terbuka offline |
| **M1** | Cari & detail harga | `SearchDock`, `ProductCard` (semua keadaan S-02), `GroupHeader`, S-01 (normal + kosong U-19), S-02, S-03 (+ grafik SVG, histori cursor), S-03b, S-04, S-05, scan barcode (D-58), `prefs` (pencarian terakhir, baru dicek) | S-01, S-02, S-03, S-03b, S-04, S-05 | e2e alur 1–2 lulus; 6 pertanyaan inti terjawab sesuai wireframe §8.1 |
| **M2** | Unggah struk | S-06, S-07 (struk via kamera bawaan, Q-51), S-07b, pipeline gambar (§6), outbox IndexedDB + uploader (§5.4, F-24), cek hash U-10, S-08 (polling D-61), S-09 (signed URL, Ulangi/Hapus), manifest + service worker produksi | S-06, S-07, S-07b, S-08, S-09 | e2e alur 3 sampai `needs_confirmation`; skenario offline O (antrean) lulus; G lulus |
| **M3** | Konfirmasi | S-10 (semua keadaan, header edit, duplikat, member hint), S-11 (W18 + `computed`), S-12 mode manual/koreksi, S-14, S-15 | S-10, S-11, S-12, S-14, S-15 | e2e alur 3, 3b, 5 lulus |
| **M4** | Sesi belanja | S-12 mode sesi, S-13, `SessionBanner` di semua layar, kamera label (viewfinder tetap terbuka), kartu label + `vs_best_pct` | S-12, S-13, S-07 label | e2e alur 4 lulus (kamera palsu) |
| **M5** | Koreksi & katalog | S-16 (W6/W7, alias), S-17 (preview, U-16), S-18 (split dua langkah), edit produk privat, arsip produk | S-16, S-17, S-18, S-15 edit | e2e alur 6 lulus |
| **M6** | Pengaturan & onboarding | S-00b, S-00c, S-19, S-19b, S-19c, Privasi & hapus akun (D-76), keluar + bersihkan data lokal (Q-61) | S-00b, S-00c, S-19, S-19b, S-19c | e2e alur 7–8 lulus |
| **M7** | Offline penuh, Tanya, audit | Cache produk R5 + search offline (D-60), S-20 kerangka (§9), ajakan pasang PWA iOS (Q-62), audit a11y (axe + manual VoiceOver/TalkBack), anggaran performa, pembaruan SW (P-12), `docs/06` diperbarui untuk frontend | S-20 + semua | Semua e2e (Chromium + WebKit) lulus; axe tanpa pelanggaran serius; Lighthouse PWA installable |

Estimasi kasar (satu developer): M0 3–4 hari, M1 4–5, M2 5–6, M3 5–6, M4 3, M5 4, M6 3, M7 3–4.

---

## 13. Pertanyaan untuk Didiskusikan

Setiap pertanyaan punya usulan default. Jawab "setuju semua" jika semua default sudah cocok.

### 13.1 Blocking untuk Tahap 5b

| ID | Pertanyaan | Usulan default |
|---|---|---|
| **Q-43** | **Versi PostgreSQL** (F-17). Supabase hanya menyediakan 15 dan 17; repo memakai 16 (mode A, CI, `config.toml`). Pindah ke 17 di semua tempat, atau tetap 16 untuk mode A/CI dan 17 hanya untuk Supabase? | **17 di semua tempat** (M0). Menjalankan test di versi yang sama dengan produksi. Risiko kecil: perbedaan `pg_dump` (sudah ditangani untuk `\restrict`, §10.3 no. 18 `docs/05`). |
| **Q-44** | **`packages/db-types` dan L4** (F-19, D-77) tidak bisa dijalankan di lingkungan ini (registry container diblokir). Bangkitkan di mana? | **Job CI `supabase-e2e`** (Docker tersedia di GitHub Actions): `supabase start` → L4 otomatis → `gen types` + cek drift (pola sama dengan `db/schema.sql`). File hasil di-commit. Alternatif: pemilik proyek menjalankan sekali di lokal, atau jaringan lingkungan cloud dibuka untuk registry. |
| **Q-45** | **Strategi render** (§3.2): shell statis + data di klien, SSR per request, atau campuran? | **Shell statis + data di klien.** Satu jalur data (D-61), bisa offline (D-59/D-60), HTML tanpa data pribadi. |
| **Q-47** | **Styling dan komponen** (§4.1). | **Tailwind CSS v4 + primitif Radix (pola shadcn/ui), lucide-react, vaul, sonner.** |
| **Q-48** | **Manajemen data/cache** (§4.3). | **TanStack Query v5 + persist ke IndexedDB**, aturan cache §4.3 (data struk tidak di-persist). |
| **Q-50** | **Service worker** (§5.2). | **Serwist** (Turbopack), spike di M0. Cadangan: `@serwist/next` dengan `next build --webpack`, lalu SW tulisan sendiri + `workbox-build`. SW tidak meng-cache REST/Storage/Auth. |

### 13.2 Non-blocking

| ID | Pertanyaan | Usulan default |
|---|---|---|
| Q-46 | Id entitas di query string (`/produk?id=`) untuk layar yang perlu offline, bukan segmen dinamis (`/produk/[id]`)? (P-02) | **Ya**, untuk semua layar demi konsistensi. |
| Q-49 | Form dan validasi (§4.2). | **react-hook-form + zod resolver**, skema diturunkan dari `packages/contracts`. |
| Q-51 | **Kamera** (P-18): kamera bawaan (`<input capture>`) untuk struk, jendela bidik di app untuk label dan barcode? | **Ya.** Struk butuh kualitas foto penuh; label butuh kecepatan dan kamera tetap terbuka (U-07). "Tambah bagian" membuka kamera bawaan lagi (+1 ketukan per bagian). Opsi di S-19: "Pakai kamera di app untuk struk". |
| Q-52 | Scan barcode di iOS (P-19): sembunyikan (D-58) atau polyfill WASM (`barcode-detector` berbasis zxing-wasm, ±1 MB, dimuat saat ikon diketuk)? | **Sembunyikan sesuai D-58** di MVP. Polyfill ditinjau setelah ada data pengguna iOS. |
| Q-53 | Route Handler `/auth/callback` (PKCE Google) dan `proxy.ts` (segarkan cookie) di server Next.js. Keduanya tidak memakai service role. Dianggap sesuai D-61 ("Route Handler hanya untuk operasi bersecret")? | **Ya, sebagai pengecualian auth** yang dicatat di D-61. Tidak ada penulisan data lewat server Next.js. |
| Q-54 | Memulai sesi belanja saat offline (antre `start_shopping_session` dengan id klien)? | **Tidak di MVP.** Mulai sesi butuh sinyal (biasanya ada di pintu masuk). Foto label setelah itu tetap bisa offline. Antrean berurutan (sesi → capture) menambah kompleksitas. |
| Q-55 | **Login hanya dengan kode OTP 6 digit** (tanpa magic link), template email Indonesia di `supabase/templates/` (F-20, P-05)? | **Ya.** |
| Q-56 | Parameter kompresi gambar (§6.2): sisi panjang 2560 px struk / 2048 px lainnya, JPEG 0,85–0,88, target ≤ 1,5 MB, EXIF dibuang, aturan lewati §6.3, HEIC apa adanya di browser non-Safari. | **Setuju**, dikalibrasi ulang bersama uji OCR (D-16, Tahap 6). Konversi HEIC di worker dicatat untuk Tahap 6. |
| Q-57 | i18n: id-ID saja, tanpa pustaka, teks terpusat di `lib/copy/id.ts`? | **Ya.** |
| Q-58 | Slug route berbahasa Indonesia (`/cari`, `/unggahan`, `/belanja`, `/saya`)? | **Ya.** Identifier kode tetap bahasa Inggris. |
| Q-59 | Grafik S-03 dengan SVG sendiri (bukan pustaka grafik)? | **Ya.** Satu jenis grafik sederhana + tabel alternatif. |
| Q-60 | e2e Playwright memakai Supabase CLI (bukan mock) di CI, dengan profil Chromium dan WebKit? | **Ya.** Mode A (tanpa PostgREST/Auth/Storage) tidak cukup untuk e2e. |
| Q-61 | Keluar dan hapus akun menghapus semua data lokal (IndexedDB, Cache Storage). Jika antrean foto belum kosong, tampilkan "3 foto belum terunggah dan akan dihapus. Tetap keluar?" | **Ya.** |
| Q-62 | Ajakan "Pasang ke layar utama" di iOS setelah foto pertama + `navigator.storage.persist()` (P-04)? | **Ya**, sekali, bisa ditutup. Di Android memakai prompt bawaan browser. |
| Q-63 | Lint dan format: ESLint (flat config + `eslint-plugin-jsx-a11y`) + Prettier, atau Biome? | **ESLint + jsx-a11y + Prettier.** Aturan a11y JSX lebih lengkap. `next lint` sudah tidak ada di Next 16, jadi ESLint dijalankan langsung. |
| Q-64 | Batas UI 10 bagian per struk dan peringatan antrean > 50 MB (§5.3, §6.5)? | **Ya**, sebagai default UI (bukan aturan data). |

### 13.4 Pertanyaan baru dari M0

| ID | Pertanyaan | Usulan default |
|---|---|---|
| Q-65 | Anggaran JS 200 kB (F-27): halaman `/` 335 KiB gzip. Tindak lanjut? | **Tetap peringatan sampai M7** (anggaran performa ada di M7). Di M7 diukur ulang; kandidat: validasi input `rpcCall` memakai `zod/mini` atau skema dimuat per layar. Tidak mengubah kontrak. |
| Q-66 | Data lokal saat sesi berakhir tanpa aksi Keluar (F-29). | **Hanya aksi Keluar/hapus akun yang menghapus IndexedDB** (dengan peringatan antrean, Q-61). Sesi kedaluwarsa: cache di memori dibersihkan, antrean foto tetap, user diminta login lagi. |
| Q-67 | Input kode OTP: satu kolom (implementasi M0) atau 6 kotak (§7.3)? | **Satu kolom** (autofill + a11y lebih andal). |

**Hasil review M0 (2026-10-20):** pemilik proyek menyerahkan ketiga pertanyaan ke usulan default. Q-65, Q-66, Q-67 → **D-84**.

### 13.5 Pertanyaan baru dari M1

| ID | Pertanyaan | Usulan default |
|---|---|---|
| Q-68 | Kartu S-02 dan S-03 selalu menampilkan baris "Termurah sepanjang masa", juga saat record-nya sama dengan termurah 90 hari (teks berulang). Tetap, atau diringkas (mis. "= termurah sepanjang masa")? | **Tetap tampil** (D-02 harfiah: dua angka selalu terlihat). Ditinjau di audit M7 bersama tata letak kartu. |
| Q-69 | SearchDock di iOS Safari bisa tertutup keyboard (F-37). | **Uji di iPhone sungguhan**; jika tertutup, dock mengikuti `visualViewport` (tanpa pustaka) di M7. |
| Q-70 | R11 tidak memuat nama group (F-33). Tetap R4 tambahan di klien, atau tambah `group_name` ke keluaran R11? | **Tetap di klien** (tanpa ubah RPC). Satu panggilan kecil, di-cache 30 dtk. Ditinjau ulang jika S-04 terasa lambat. |
| Q-71 | Tujuan yang belum ada (F-35): barcode tidak dikenal, baris histori, "Atur" member, "Tanya", kamera label. | **Seperti implementasi M1** (pesan/placeholder/nonaktif, tanpa 404); tiap milestone menyambungkan tautannya: S-14 dengan kode barcode terisi (M3), S-16 (M5), S-19b (M6), S-20 (M7), kamera (M2/M4). |

**Hasil review M1 (2026-10-20):** pemilik proyek menyetujui semua usulan default Q-68 s/d Q-71 → **D-85**.

### 13.3 Bagian yang belum bisa dirancang penuh

| Bagian | Yang kurang | Dampak ke 5b |
|---|---|---|
| Verifikasi mode B / L4 | Jaringan lingkungan ini memblokir registry (§1.1) | Dikerjakan di M0 lewat CI (Q-44). Temuan baru ditambahkan sebagai F-xx. |
| Tipe REST dari `db-types` | F-19 | Sampai M0 selesai, REST memakai tipe tulisan tangan minimal untuk tabel "REST langsung". |
| Konversi HEIC dan kualitas gambar untuk OCR | Uji OCR (D-16, Tahap 6) | Parameter §6 adalah awal; dikalibrasi di Tahap 6. |
| Warna, tipografi, ikon aplikasi | Belum ada desain visual (wireframe grayscale) | M0 memakai token netral yang memenuhi kontras AA; desain visual bisa diganti lewat token tanpa mengubah komponen. |
| Hosting web | Tahap 7 | Shell statis + Route Handler kecil cocok untuk Vercel atau Node biasa. |

---

**Hasil review (2026-10-19):** semua default disetujui.

| Pertanyaan | Keputusan |
|---|---|
| Q-43, Q-44 | D-78 |
| Q-45, Q-46, Q-53, Q-58 | D-79 |
| Q-47, Q-48, Q-49, Q-59, Q-63 | D-80 |
| Q-50, Q-54, Q-61, Q-62, Q-64 | D-81 |
| Q-51, Q-52, Q-56 | D-82 |
| Q-55, Q-57, Q-60 | D-83 |

**Catatan mode B (setelah review):** jaringan lingkungan dibuka untuk registry, dan `registry-1.docker.io` serta `public.ecr.aws` kini terjangkau. `supabase start` tetap gagal karena host CDN tempat layer image diunduh (`production.cloudfront.docker.com` untuk Docker Hub, `*.cloudfront.net` untuk ECR Public) masih ditolak proxy. Verifikasi L4 dan `db-types` tetap dijadwalkan di M0 (D-78).
