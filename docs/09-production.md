# Tahap 7a — Desain Production (pemakaian pribadi tanpa anggaran, D-100)

> Status: **Desain disetujui (D-101, 2026-10-31). Tahap 7b (§12, B1–B7) selesai dan disetujui (D-102, 2026-10-31)** (hasil, penyimpangan, temuan F-198–F-206, pertanyaan Q-164–Q-170: §16). Berikutnya go-live (§13), dijalankan pemilik proyek setelah PR 7b di-merge dan CI hijau. Dokumen ini tidak mengubah keputusan D-01 s/d D-100.
> Rujukan: `PROJECT.md` §8 (D-61, D-68, D-78, D-81, D-86, D-90, D-91, D-95, D-98, D-100), §11 "Cara Kerja Tim"; `docs/05-backend-design.md` §1.2–§1.4, §7; `docs/06-local-dev.md` §2.4, §2.10–§2.12, §3; `docs/07-frontend-design.md` §11.6, F-44, F-86, F-94, F-103; `docs/08-ai-integration.md` §12.3, §19.4 (F-138), §22.4 (F-167, F-170, F-173), §23.

## Daftar Isi

0. [Ringkasan](#0-ringkasan)
1. [Kondisi dan cakupan](#1-kondisi-dan-cakupan)
2. [Temuan (F-183 dst.)](#2-temuan-f-183-dst)
3. [Hosting per komponen](#3-hosting-per-komponen)
4. [Item "ditinjau di Tahap 7"](#4-item-ditinjau-di-tahap-7)
5. [Rahasia dan env produksi](#5-rahasia-dan-env-produksi)
6. [Migrasi ke Supabase hosted](#6-migrasi-ke-supabase-hosted)
7. [Auth dan email OTP produksi](#7-auth-dan-email-otp-produksi)
8. [Backup dan restore](#8-backup-dan-restore)
9. [Domain, HTTPS, dan PWA di HP](#9-domain-https-dan-pwa-di-hp)
10. [Masa kalibrasi di produksi (F-173)](#10-masa-kalibrasi-di-produksi-f-173)
11. [Operasional ringan](#11-operasional-ringan)
12. [Perubahan untuk Tahap 7b](#12-perubahan-untuk-tahap-7b)
13. [Checklist go-live](#13-checklist-go-live)
14. [Pertanyaan (Q-151 dst.)](#14-pertanyaan-q-151-dst)
15. [Bagian yang belum bisa dirancang penuh](#15-bagian-yang-belum-bisa-dirancang-penuh)
16. [Tahap 7b: hasil dan temuan baru (F-198 dst.)](#16-tahap-7b-hasil-dan-temuan-baru-f-198-dst)

---

## 0. Ringkasan

| Aspek | Usulan |
|---|---|
| Target | Satu pemakai (pemilik proyek), mode D-100: foto mati, struk ditempel dari Gemini, `EXTRACTOR=off`, `AI_MATCHER=off`, `ASK_ENGINE=off`. Biaya **US$0/bulan**, tanpa kartu kredit di layanan mana pun. |
| Database, Auth, Storage, pg_cron | **Supabase Free**, satu proyek, region Singapura. Batas utama: proyek di-*pause* setelah ±7 hari tanpa aktivitas, database 500 MB, email bawaan ±2/jam. Semua cukup untuk pemakai tunggal (§3.5). |
| Web (`apps/web`) | **Vercel Hobby** (non-komersial, cocok untuk pemakaian pribadi), domain `*.vercel.app` dengan HTTPS otomatis. Tanpa domain sendiri (berbayar). |
| Worker (`apps/worker`) | **GitHub Actions menjalankan `start --once`**: (1) dipicu dari app setelah struk ditempel (route baru `POST /api/worker/kick` → `workflow_dispatch`), struk siap dikonfirmasi ±1–2 menit kemudian; (2) jadwal harian untuk job retensi, hapus akun, dan sapuan unggahan yatim. Cadangan: worker dijalankan di PC. Worker long-running (VM gratis) tidak dipilih untuk sekarang (§3.3). |
| Koneksi worker | Lewat **Supavisor session pooler** (IPv4), dengan role login khusus `priceatlas_worker` yang otomatis menjadi `service_role` (`ALTER ROLE … SET role`), bukan `postgres` (F-186). |
| Item Tahap 7 dari Decision Log | Wajib sekarang: batas email OTP + tutup pendaftaran (F-86, F-188), template OTP hosted (F-187). Ditunda dengan pemicu jelas: CSP nonce/hash (D-86), F-138, F-170, F-167, F-103, F-94 (§4). |
| Backup | Supabase Free tidak memberi backup yang bisa diunduh: `pg_dump` mingguan lewat GitHub Actions, dienkripsi `age` (kunci privat hanya di PC), simpan 30 hari + salinan bulanan ke PC. Uji restore sekali saat go-live (§8). |
| Kalibrasi | `calibration_started_on` = tanggal transaksi struk tempelan **tertua** yang masuk produksi, karena laporan menyaring `transaction_date`, bukan tanggal unggah (F-192). Diubah lewat SQL Editor setelah struk pertama sampai S-10 (§10). |
| Perubahan kode (7b) | Kecil: migration pembersih `cron.job_run_details` (F-184), flag worker `--sweep` (F-185), workflow `worker.yml` + `backup.yml`, route `/api/worker/kick` + panggilan dari S-21/S-09, `vercel.json` region. Tidak ada perubahan skema data, RLS, RPC, atau kontrak. |

---

## 1. Kondisi dan cakupan

### 1.1 Yang di-hosting

| Komponen | Isi | Kebutuhan runtime |
|---|---|---|
| Supabase | PostgreSQL 17 (D-78), Auth OTP email (D-83), Storage bucket `captures` (D-69; hampir kosong selama foto mati), pg_cron 7 jadwal (`…0900_cron.sql` + `cron-cleanup`, 7b), PostgREST | Selalu hidup; pg_cron berjalan di dalam database |
| `apps/web` | Next.js 16 PWA: shell statis + data di klien (D-79), `proxy.ts`, `/auth/callback`, `POST /api/account/delete` (service role), `POST /api/ask` (`ASK_ENGINE=off` → "Segera hadir") | Fungsi serverless Node untuk 2 route + proxy; sisanya statis |
| `apps/worker` | Capture teks (`TextExtractor`, biaya 0), job `purge_images` / `redact_ocr` / `delete_household` / `purge_storage_paths`, sapuan unggahan yatim | Node ≥ 22, koneksi Postgres sesi; tidak butuh jalan terus (§3.3) |

### 1.2 Asumsi pemakaian

Dari docs/08 §12.2, disesuaikan dengan D-100: ±16 struk tempelan/bulan × ±15 baris, beberapa koreksi, tanpa label/screenshot foto, tanpa Tanya. Satu HP, satu akun, login jarang (sesi diperpanjang refresh token).

### 1.3 Di luar cakupan

Foto + extractor sungguhan, Tanya sungguhan, kunci AI di produksi (menunggu anggaran dan D-16/D-99); multi-user/SaaS (Vercel Pro, Supabase Pro, SMTP sendiri, F-138); domain sendiri; pemantauan berbayar; lingkungan staging (dev = Supabase lokal mode B).

### 1.4 Catatan sumber batas layanan

Batas layanan gratis di dokumen ini dicek lewat pencarian web pada 2026-10-31. Sebagian berasal dari ringkasan pihak ketiga dan ada yang saling bertentangan. Angka bertanda **⚑** wajib dicek di halaman resmi atau dashboard saat go-live (checklist §13 langkah 0). Desain dibuat supaya tetap aman jika angka sebenarnya sedikit berbeda.

---

## 2. Temuan (F-183 dst.)

| # | Temuan | Dampak | Usulan | Q |
|---|---|---|---|---|
| F-183 | **Supabase Free di-*pause* setelah ±7 hari tanpa aktivitas ⚑.** Saat ter-*pause*, pg_cron ikut berhenti; data tetap ada dan proyek dipulihkan manual dari dashboard. | Tidak membuka app selama seminggu (liburan) → app tidak bisa login/memuat data sampai dipulihkan. | Jalankan worker harian (§3.3), yang menjalankan query ke database setiap hari dan kemungkinan besar dihitung sebagai aktivitas ⚑. Jika tetap ter-*pause*: pulihkan dari dashboard (±beberapa menit), dicatat di §11. | Q-161 |
| F-184 | **`cron.job_run_details` tumbuh ±11.500 baris/hari** (`summary-queue` tiap 10 dtk + 2 jadwal tiap menit). Supabase menyimpan riwayat ini tanpa batas. | ±4 juta baris/tahun, ratusan MB, mendekati batas database Free 500 MB, jauh lebih besar dari data app (§3.5). | Migration baru: jadwal pg_cron `cron-cleanup` harian yang menghapus riwayat > 7 hari. Aditif; jumlah jadwal yang dicek L4 menjadi 7. | Q-158 |
| F-185 | **`--once` tidak menjalankan sapuan unggahan yatim.** `sweepOrphans` hanya dijadwalkan di `Worker.start()` (17:50 UTC). | Worker terjadwal tidak pernah menyapu objek Storage yatim. Selama foto mati hampir tidak ada objek, tetapi kebocoran ini muncul lagi saat foto dinyalakan. | Flag `--sweep` (hanya bersama `--once`): sapuan dijalankan setelah antrean kosong. Dipakai oleh run harian. | Q-162 |
| F-186 | **Koneksi database dari luar Supabase.** Koneksi langsung `db.<ref>.supabase.co` hanya IPv6 di Free (IPv4 adalah add-on berbayar ⚑); runner GitHub Actions dan Vercel memakai IPv4. Belum pasti apakah Supavisor meneruskan parameter startup `options=-c role=service_role` (`WORKER_DB_ROLE`, docs/06 §3.2). Selain itu `DATABASE_URL` berisi kata sandi `postgres`, yang bisa mengubah skema. | Worker tidak bisa terhubung, atau diam-diam berjalan sebagai `postgres`/role lain (F-22). Kebocoran rahasia GitHub = akses penuh database. | Worker memakai **session pooler** (port 5432 di host pooler, user `<role>.<ref>`) dengan role login khusus `priceatlas_worker`: `grant service_role` + `alter role … set role service_role`, sehingga sesi langsung menjadi `service_role` tanpa parameter startup dan `WORKER_DB_ROLE` dikosongkan. Diverifikasi dengan `select current_user` lewat pooler (§6.3). Cadangan jika `ALTER ROLE … SET role` tidak berlaku lewat pooler: `SET ROLE` setelah connect di `apps/worker/src/db.ts` (kecil, 7b). | Q-156 |
| F-187 | **Template email di `supabase/config.toml` hanya berlaku lokal.** Proyek hosted memakai template bawaan "Magic Link" yang berisi tautan, bukan `{{ .Token }}`. | Login produksi rusak: app meminta kode 6 digit (D-83), email berisi tautan. | Saat go-live: isi template **Magic Link** dan **Confirm signup** dengan isi `supabase/templates/otp.html` + subjek dari `config.toml` di dashboard, atau `supabase config push` ⚑. Cek panjang OTP 6 dan kedaluwarsa 600 dtk. Tes login sebelum menutup pendaftaran. | Q-157 |
| F-188 | **Pendaftaran terbuka** (`enable_signup = true`). URL `*.vercel.app` bisa ditemukan orang lain. | Akun asing bisa dibuat (jika SMTP mengizinkan), memakai kuota email dan database, dan membuka risiko F-138. | Setelah akun pemilik dibuat dan login berhasil: **matikan "Allow new users to sign up"** di dashboard Auth. Login OTP untuk akun yang sudah ada tetap jalan. Google tetap mati (F-21). | Q-157 |
| F-189 | **Email bawaan Supabase dibatasi ±2 email/jam per proyek ⚑** dan menurut beberapa sumber hanya terkirim ke alamat anggota tim proyek ⚑. | Pemakai tunggal = pemilik proyek, jadi cukup. Menekan "Kirim ulang kode" berkali-kali atau login ulang hapus akun (D-76) bisa terkena batas selama 1 jam. | Tetap SMTP bawaan (US$0). SMTP sendiri ditunda sampai ada user lain: Resend/Brevo gratis butuh domain terverifikasi supaya tidak masuk spam, dan domain berbayar. | Q-157 |
| F-190 | **Supabase Free tidak memberi backup yang bisa diunduh atau PITR ⚑.** | Salah hapus, migration salah, atau akun Supabase bermasalah = data hilang. | Backup sendiri (§8). Isi dump termasuk data pribadi (riwayat belanja, `receipt.pii`), jadi dienkripsi sebelum keluar dari runner. | Q-159 |
| F-191 | **Proses struk tempelan bergantung pada kapan worker jalan.** Dengan worker terjadwal saja, capture tetap "Diproses" sampai run berikutnya. | UX: menempel struk lalu menunggu sampai satu jam atau lebih sebelum S-10. | Pemicu dari app (`POST /api/worker/kick` → `workflow_dispatch`) setelah W1b dan setelah "Ulangi" di S-09. Grup `concurrency` di workflow menggabungkan pemicu beruntun (maks satu run menunggu). | Q-152 |
| F-192 | **Laporan kalibrasi menyaring `transaction_date`**, bukan tanggal unggah (`db/scripts/calibration_report.sql`). Nilai migration `calibration_started_on` = 2026-10-30. | Struk lama yang ditempel belakangan (tanggal transaksi sebelum `calibration_started_on`) tidak ikut laporan, padahal di produksi τ = 1,01 sejak hari pertama sehingga semua baris dicek user. | `calibration_started_on` = tanggal transaksi struk tempelan tertua di produksi, disesuaikan lagi jika ada struk yang lebih lama ditempel. Hitungan "2 minggu" (docs/08 §8.2) dimulai dari tanggal go-live, dicatat di Decision Log (§10). | Q-160 |
| F-193 | **`supabase/seed.sql` adalah katalog contoh dev** (AEON, Alfamart, Milo, …) dan tidak diterapkan `supabase db push`. | Produksi mulai dengan katalog global kosong; data referensi (satuan, kategori sistem) ada di migration. Toko/produk dibuat privat saat konfirmasi S-10/S-12/S-15 (D-29). | Tidak menerapkan seed di produksi. Kurasi katalog global (D-52) ditunda sampai ada user lain. | Q-160 |
| F-194 | **`NEXT_PUBLIC_*` dibaca saat build**, termasuk CSP `connect-src` (`lib/security/csp.ts`) dan saklar foto D-100. | Env yang diubah di Vercel tanpa redeploy tidak berlaku; URL Supabase yang salah saat build = semua panggilan diblokir CSP. | Isi env Vercel sebelum deploy pertama. Setiap perubahan `NEXT_PUBLIC_*` → **Redeploy** (§5.1). | — |
| F-195 | **Menit GitHub Actions.** Repo privat punya kuota menit gratis per bulan (±2.000 ⚑); CI sekarang sudah memakai menit untuk setiap push dan `supabase-e2e` setiap malam. | Worker + backup ikut memakai kuota yang sama. Jika habis, worker berhenti sampai bulan berikutnya. | Perkiraan §3.5: masih di bawah kuota. Pantau di Settings → Billing setiap bulan (§11). Jika mendekati batas: `supabase-e2e` malam → mingguan, bukan worker. | Q-153 |
| F-196 | **Kunci API Supabase generasi baru** (`sb_publishable_…`, `sb_secret_…`) mungkin menjadi default proyek baru ⚑, menggantikan kunci JWT `anon`/`service_role`. | Nama env app (`NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`) tetap; supabase-js menerima keduanya. `auth.admin.deleteUser` dengan kunci rahasia baru perlu dibuktikan. | Pakai kunci yang tersedia; jika hanya kunci baru: publishable → `NEXT_PUBLIC_SUPABASE_ANON_KEY`, secret → `SUPABASE_SERVICE_ROLE_KEY`. Hapus akun diuji dengan akun uji kedua sebelum pendaftaran ditutup (§13 langkah 8). | — |
| F-197 | **Zona waktu dan jadwal.** Migration D-68 memasang zona `Asia/Jakarta` lewat `alter database … set timezone`; pg_cron memakai UTC. Apakah role migration di proyek hosted boleh menjalankan `alter database` belum dibuktikan di sana (L4 hanya Supabase CLI). | Jika gagal, `db push` berhenti di migration `…0230`. Jika berhasil tetapi tidak berlaku, tanggal default dan jendela 90 hari bergeser 7 jam. | Verifikasi `show timezone` setelah push (§6.3). Jadwal pg_cron tetap UTC (sudah sesuai D-68). | — |

---

## 3. Hosting per komponen

### 3.1 Supabase (Free)

| Batas Free ⚑ | Nilai (2026-10) | Dampak untuk pemakai tunggal |
|---|---|---|
| Jumlah proyek aktif | 2 | Satu proyek produksi; dev tetap Supabase lokal (mode B) |
| Pause tanpa aktivitas | ±7 hari | F-183: worker harian + pengingat |
| Database | 500 MB | Data app < 10 MB/tahun; risiko hanya dari `cron.job_run_details` (F-184) |
| Storage | 1 GB | Foto mati; hanya terisi saat foto dinyalakan nanti (±1,5 MB per foto) |
| Egress | 5 GB/bulan (satu sumber: 2 + 2 GB) | Pemakaian ±puluhan MB/bulan |
| MAU Auth | 50.000 | 1 |
| Email bawaan | ±2/jam, mungkin hanya ke anggota tim | F-189 |
| Backup | Tidak bisa diunduh / tanpa PITR | F-190, §8 |
| Edge Functions | ±500.000 pemanggilan/bulan | Tidak dipakai (§3.3 opsi E) |

**Region:** Southeast Asia (Singapore) supaya dekat dari Indonesia. **Versi Postgres:** 17 (D-78); jika proyek baru menawarkan versi lain, pilih 17.

### 3.2 Web: `apps/web`

| Opsi | Biaya | Kelebihan | Kekurangan |
|---|---|---|---|
| **A. Vercel Hobby** | US$0 | Dukungan Next.js 16 paling lengkap (`proxy.ts`, Route Handler Node, Serwist Turbopack). HTTPS + CDN otomatis. Preview deploy per branch. Log fungsi. | Hanya untuk pemakaian pribadi/non-komersial ⚑ (sesuai sekarang). Fungsi maks 60 dtk ⚑ (route kita < 5 dtk). Retensi log singkat. |
| B. Cloudflare Workers (OpenNext) | US$0 | CDN cepat, kuota besar. | Adapter OpenNext untuk Next 16 + Serwist belum diuji di proyek ini; route Node (`@anthropic-ai/sdk`, service role) perlu dicek di runtime Workers. |
| C. Netlify Free | US$0 | Mirip Vercel. | Adapter Next pihak ketiga; fitur Next terbaru biasanya tertinggal. |
| D. Di PC + tunnel (Cloudflare Tunnel) | US$0 | Kontrol penuh. | App mati saat PC mati; PWA di HP butuh server untuk login dan route. |

**Rekomendasi: A.** Pengaturan:
- *Root Directory* `apps/web`; Vercel mengenali pnpm dari `packageManager` root. *Install Command* `pnpm install --frozen-lockfile` (workspace penuh supaya `@priceatlas/contracts`, `ai-tools`, `db-types` tersedia).
- *Function region* Singapura (`sin1`) lewat `apps/web/vercel.json` (`"regions": ["sin1"]`), supaya `/api/*` dan `proxy.ts` dekat dengan Supabase ⚑ (Hobby boleh memilih satu region).
- *Production branch* `master`. Preview deploy memakai env Preview yang sama (tanpa service role; §5.1), atau dimatikan.

### 3.3 Worker: `apps/worker`

Worker dirancang long-running (D-61, docs/05 §1.3). Di mode D-100 pekerjaannya kecil dan deterministik: capture teks (< 1 dtk per struk) dan job harian. Pemrosesan dalam hitungan menit sudah cukup karena struk ditempel setelah belanja, bukan saat berdiri di depan rak.

| Opsi | Biaya | Latensi struk → S-10 | Batas / risiko | Kerja 7b |
|---|---|---|---|---|
| **A. GitHub Actions `--once`: dipicu app + jadwal harian** | US$0 (kuota menit, F-195) | ±1–2 menit (antre runner + install dengan cache + proses) | Jadwal GitHub bisa terlambat ⚑ (tidak masalah untuk job harian). Rahasia DB di GitHub (dibatasi F-186). Butuh token GitHub di Vercel. | `worker.yml`, `--sweep`, route kick + panggilan klien |
| B. GitHub Actions terjadwal saja (tiap 15–30 mnt) | Kuota menit cepat habis di repo privat (±1.500–3.000 mnt/bulan) | 15–60 menit + keterlambatan jadwal | F-195 | `worker.yml`, `--sweep` |
| C. VM gratis selamanya (Oracle Always Free, GCP e2-micro), worker long-running | US$0, tetapi butuh kartu kredit | Detik (LISTEN) | Perawatan OS/Node, keamanan SSH. Oracle bisa mengambil kembali VM yang menganggur ⚑. GCP: IPv4 publik/egress bisa berbayar ⚑. | systemd unit, dokumen |
| D. PaaS (Render, Railway, Fly, Koyeb) | Background worker tidak gratis; layanan web gratis tidur setelah idle ⚑ | — | Tidak memenuhi US$0 untuk proses selalu hidup | — |
| E. Supabase Edge Function dipicu Database Webhook | US$0 | Detik | Pipeline + kontrak harus diport ke Deno, adapter baru, sulit diuji tanpa Supabase (docs/05 §1.3 opsi B) | Besar |
| F. Route Next.js di Vercel yang menjalankan pipeline | US$0 | Detik | Worker masuk ke bundle web (pg, sharp); `DATABASE_URL` di Vercel; melanggar pemisahan D-61 | Sedang |
| G. PC pemilik proyek (`start` saat PC menyala) | US$0 | Detik saat PC menyala; tertunda saat mati | Job harian tidak jalan saat PC mati; pause Supabase tidak tercegah | Tidak ada |

**Rekomendasi: A, dengan G sebagai cadangan.** Alasan: tanpa server yang perlu dirawat, kode pipeline tidak berubah (`--once` sudah ada dan diuji L4), rahasia di GitHub *Environments*, log run tersimpan, dan run harian sekaligus menjaga proyek Supabase tetap aktif (F-183). Route kick sesuai D-61 karena hanya meneruskan operasi bersecret (token GitHub), tidak menulis data. Saat foto dinyalakan lagi, opsi yang sama tetap bisa dipakai (timeout run cukup untuk AI) atau dipindah ke C tanpa mengubah kode.

**Alur A:**

```
S-21 Kirim → W1b submit_text_capture (JWT user, langsung ke Supabase)
          → fetch POST /api/worker/kick (tanpa menunggu hasil; gagal = diabaikan)
              Vercel: getUser() → POST api.github.com/repos/<repo>/actions/workflows/worker.yml/dispatches
          → GitHub Actions worker.yml (concurrency: worker, satu run menunggu)
              pnpm --filter @priceatlas/worker start --once [--sweep pada run terjadwal]
              → TextExtractor → matching tier 1–3 → apply_extraction → keluar
S-09 polling status (sudah ada) → "Perlu dicek" → S-10
Jadwal harian 18:10 UTC (setelah retention 17:35): start --once --sweep
pg_cron (di Supabase): summary-queue, sql-jobs, reap-stale-runs, retention, dst. (tidak berubah)
```

Run yang dimatikan di tengah jalan (timeout runner) meninggalkan lease yang diambil kembali oleh `reap-stale-runs` (pg_cron, tiap menit), sama seperti worker yang mati. Capture yang menunggu backoff (D-70) diproses oleh run berikutnya.

**Cadangan G:** di PC, `.env` produksi terpisah (`.env.production.local`, tidak di-commit), `pnpm --filter @priceatlas/worker start` (long-running, LISTEN lewat session pooler) atau `start --once`. Dipakai jika GitHub Actions bermasalah atau kuota habis.

### 3.4 Gambaran produksi

```
 HP (PWA, Chrome/Safari) ──HTTPS──► Vercel Hobby (sin1)
   │  shell statis (CDN) + proxy.ts + /api/account/delete + /api/ask (off) + /api/worker/kick
   │                                         │ service role (hapus akun)   │ token GitHub (kick)
   │ supabase-js + JWT user                  ▼                             ▼
   └────────────────────────────► Supabase Free (Singapore)          GitHub Actions
                                   PostgREST / RPC / Auth OTP          worker.yml (--once)
                                   Storage (captures)                  backup.yml (mingguan)
                                   Postgres 17 + pg_cron ◄── session pooler (IPv4), role priceatlas_worker
```

### 3.5 Perkiraan pemakaian vs batas

| Sumber daya | Perkiraan per bulan | Batas Free ⚑ |
|---|---|---|
| Database: data app | ±250 baris struk + ±250 `price_record` + ringkasan/audit; < 1 MB/bulan | 500 MB |
| Database: `cron.job_run_details` | Tanpa pembersih ±30 MB/bulan; dengan pembersih 7 hari ±8 MB tetap | (F-184) |
| Email OTP | 1–5 | ±2/jam |
| Vercel fungsi | < 2.000 pemanggilan (proxy + kick + hapus akun) | ±1 juta |
| GitHub Actions: worker | ±(30 harian + ±20 kick) × ±2 mnt ≈ 100 mnt | ±2.000 mnt (repo privat) |
| GitHub Actions: backup | 4–5 × ±2 mnt ≈ 10 mnt | |
| GitHub Actions: CI yang sudah ada | `supabase-e2e` malam (±15–25 mnt × 30) + push | Dipantau (F-195) |

---

## 4. Item "ditinjau di Tahap 7"

| Item | Asal | Untuk pemakai tunggal (D-100) | Usulan | Pemicu peninjauan berikutnya |
|---|---|---|---|---|
| CSP `script-src` nonce/hash (F-44) | D-86 | Risiko XSS kecil: React meng-escape semua teks, termasuk JSON tempelan; tidak ada HTML dari user; CSP lain (`connect-src`, `frame-ancestors`, `object-src`) sudah ketat. Nonce butuh render dinamis yang bertentangan dengan shell statis yang di-precache (D-79); hash butuh langkah build untuk skrip bootstrap Next per build. | **Tunda.** Tetap `'unsafe-inline'`. | Sebelum ada user kedua, atau jika app mulai menampilkan konten dari pihak lain (data publik D-56). |
| Batas email OTP produksi (F-86) | D-90 | Relevan: produksi memakai email sungguhan. | **Wajib sekarang** (§7): SMTP bawaan, tutup pendaftaran (F-188), template OTP (F-187), `max_frequency` 60 dtk (default hosted). | Saat SMTP sendiri dipasang (user lain / domain sendiri). |
| `record_ask_usage` dan DoS anggaran (F-138) | D-95 | Tidak relevan: Tanya mati (`ASK_ENGINE=off`), pendaftaran ditutup, satu-satunya pemanggil adalah pemilik proyek. | **Tunda.** | Sebelum pendaftaran dibuka untuk orang lain **atau** sebelum `ASK_ENGINE=claude` dengan lebih dari satu household: `service_role` khusus route atau anggaran per household. |
| Jeda claim setelah `ai.config_error` (F-170) | D-98 | Tidak relevan: `EXTRACTOR=off`, `AI_MATCHER=off`, tanpa kunci AI di produksi. Dengan worker `--once`, capture yang gagal karena kunci hanya diulang pada run berikutnya. | **Tunda.** | Saat foto dinyalakan dengan kunci worker, terutama jika worker menjadi long-running (opsi C). |
| Kunci per lingkungan (F-167) | D-98 | Tidak ada kunci AI di produksi; tidak ada yang perlu dipisah. | **Tunda**, dengan aturan untuk nanti: satu kunci per lingkungan dan per komponen (`prod-worker`, `prod-web`, `dev`), dibuat di workspace Anthropic terpisah dengan batas belanja; harness `ocr-eval`/`test:live` diganti membaca `OCR_EVAL_ANTHROPIC_API_KEY`. | Saat ada anggaran AI. |
| Status onboarding di server (F-103) | D-91 | Satu HP; S-00b muncul lagi hanya setelah Keluar (1 ketukan "Lewati"). | **Tunda** (tetap per perangkat). | Jika pemakai sering berganti perangkat atau ada user lain. |
| Anggaran JS (F-94) | D-91 | Aset di-precache service worker; biaya hanya pada kunjungan pertama dan versi baru. Vercel mengirim Brotli. | **Tunda.** Tetap peringatan 350 KiB modul di CI. Opsional: catat waktu muat pertama di HP sungguhan setelah go-live. | Jika muat pertama di HP > 3 dtk di 4G, atau sebelum SaaS. |
| Hosting worker (Q-17) | D-61 | — | §3.3 (Q-151). | — |
| Role worker lewat pooler (docs/06 §3.2) | D-78/F-22 | Relevan. | **Wajib sekarang** (F-186, §6.3). | — |

---

## 5. Rahasia dan env produksi

Nilai tidak pernah ditulis di repo, issue, atau log. Tempat simpan utama: password manager pemilik proyek; salinan kerja di dashboard masing-masing layanan.

### 5.1 Vercel (`apps/web`), environment **Production**

| Env | Jenis | Nilai produksi | Catatan |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | publik, build | `https://<ref>.supabase.co` | Juga sumber CSP (F-194) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | publik, build | kunci `anon` atau publishable (F-196) | Aman di klien (RLS) |
| `NEXT_PUBLIC_PHOTO_CAPTURE` | publik, build | `off` | D-100; mengubahnya → redeploy |
| `SUPABASE_SERVICE_ROLE_KEY` | **rahasia**, server | kunci `service_role` atau secret | Tandai *Sensitive*. Hanya `/api/account/delete`. **Jangan** diisi untuk Preview. |
| `ASK_ENGINE` | server | `off` | Tanya "Segera hadir" |
| `GITHUB_DISPATCH_TOKEN` | **rahasia**, server | fine-grained PAT (7b, Q-152) | Hanya repo ini, izin *Actions: read and write*, kedaluwarsa 1 tahun (pengingat rotasi) |
| `GITHUB_DISPATCH_REPO` | server | `2013tib-droid/PriceAtlas` | Kosong → kick = no-op (dev) |
| Tidak diisi | — | `ANTHROPIC_API_KEY`, `ASK_MODEL`, `NEXT_PUBLIC_SW_DEV`, `CI`, `PW_*`, `MAILPIT_URL`, `LIVE_AI`, `GOLDEN_IDS`, `UPDATE_FIXTURES` | Kunci AI hanya saat ada anggaran (§4 F-167) |

### 5.2 GitHub Actions, *Environment* `production` (dipakai `worker.yml` dan `backup.yml`)

Environment dibatasi ke branch `master` (*Deployment branches*), sehingga workflow dari branch lain atau PR tidak bisa membaca rahasianya.

| Nama | Jenis | Isi | Dipakai |
|---|---|---|---|
| `WORKER_DATABASE_URL` | secret | `postgresql://priceatlas_worker.<ref>:<sandi>@<host-pooler>:5432/postgres` (session pooler) | worker → env `DATABASE_URL` |
| `SUPABASE_URL` | variable | `https://<ref>.supabase.co` | worker → `NEXT_PUBLIC_SUPABASE_URL` (Storage API) |
| `SUPABASE_SERVICE_ROLE_KEY` | secret | kunci service role/secret | worker: hapus objek Storage (retensi, hapus akun, sapuan) |
| `BACKUP_DATABASE_URL` | secret | `postgresql://postgres.<ref>:<sandi>@<host-pooler>:5432/postgres` | `backup.yml` (`pg_dump` butuh baca semua schema) |
| `BACKUP_AGE_RECIPIENT` | variable | kunci publik `age1…` | Enkripsi dump; kunci privat hanya di PC |
| `WORKER_DB_ROLE`, `WORKER_DB_ROLE_MODE` | variable | **kosong**; cadangan F-186: `service_role` + `set` (docs/06 §5.2) | worker |

Env worker yang ditulis langsung di `worker.yml` (bukan rahasia): `STORAGE_BACKEND=supabase`, `EXTRACTOR=off`, `AI_MATCHER=off`, `WORKER_EXPECT_ROLE=service_role` (worker berhenti jika role efektif lain, F-201). Role dipasang lewat `ALTER ROLE` (F-186). Tidak diisi: `WORKER_ANTHROPIC_API_KEY`, `EXTRACT_*`, `OCR_ENGINE`, `GOOGLE_VISION_API_KEY`, `STUB_FIXTURES_DIR`, `STUB_FALLBACK_FIXTURE` (khusus e2e, jangan pernah di produksi), `CAPTURE_LEASE_SECONDS` (default 300), `AI_DAILY_BUDGET_USD`, `LOCAL_STORAGE_DIR`.

### 5.3 Supabase (dashboard, bukan env)

Kata sandi database (dibuat saat proyek dibuat; dipakai `BACKUP_DATABASE_URL` dan `supabase link`), kata sandi role `priceatlas_worker` (§6.3), kunci API (*Settings → API Keys*), pengaturan Auth §7. Google OAuth tidak diisi (F-21).

### 5.4 PC pemilik proyek

| Nama | Untuk |
|---|---|
| `SUPABASE_ACCESS_TOKEN` (via `supabase login`) | `supabase link`, `db push`, `migration list` |
| Kunci privat `age` (`~/.config/priceatlas/backup.age`) | Membuka backup; simpan juga di password manager |
| `.env.production.local` (opsional, cadangan worker G) | Sama dengan §5.2 + `EXTRACTOR=off AI_MATCHER=off STORAGE_BACKEND=supabase` |
| `.env` dev yang sudah ada | Tetap untuk Supabase lokal; jangan pernah diisi nilai produksi |

### 5.5 Rotasi

| Rahasia | Kapan | Cara |
|---|---|---|
| `GITHUB_DISPATCH_TOKEN` | Tahunan (kedaluwarsa) / bocor | Buat PAT baru → ganti di Vercel → redeploy |
| Sandi `priceatlas_worker` | Bocor / tahunan | `alter role priceatlas_worker password '…'` → ganti `WORKER_DATABASE_URL` |
| Sandi DB `postgres` | Bocor | Dashboard *Database → Reset password* → ganti `BACKUP_DATABASE_URL` |
| Kunci service role / secret | Bocor | Dashboard *API Keys* (rotasi/kunci baru) → Vercel + GitHub → redeploy |

---

## 6. Migrasi ke Supabase hosted

### 6.1 Membuat proyek

Organisasi pribadi (Free), nama `priceatlas`, region Southeast Asia (Singapore), Postgres 17, kata sandi database acak panjang (password manager). *Data API*: schema yang diekspos hanya `public` (sama dengan `config.toml`), `max_rows` 1000.

### 6.2 Menerapkan migration

Dari PC, di root repo pada commit `master` yang akan dirilis:

```bash
supabase login
supabase link --project-ref <ref>            # meminta kata sandi database
supabase db push --dry-run                    # harus menampilkan 21+ migration, tanpa seed
supabase db push                              # seed.sql TIDAK diterapkan (F-193)
supabase migration list                       # kolom Local dan Remote sama
```

Migration berikutnya selalu lewat jalur yang sama (`db push` dari `master` setelah CI hijau). Tidak pernah mengubah skema lewat SQL Editor; perubahan data operasional (`app.config`) boleh lewat SQL Editor dan dicatat (§10, §11).

### 6.3 Verifikasi dan role worker

SQL Editor (sebagai `postgres`):

```sql
show timezone;                                                         -- Asia/Jakarta (F-197)
select jobname, schedule from cron.job order by 1;                     -- 7 jadwal (termasuk cron-cleanup 45 17 * * *, F-184)
select id, public, file_size_limit from storage.buckets;                -- captures, false, 10485760
select extname, extnamespace::regnamespace from pg_extension
 where extname in ('pg_trgm','btree_gist','pg_cron');                  -- pg_trgm/btree_gist di extensions
select key, value from app.config
 where key in ('auto_save_min_confidence','calibration_started_on');   -- 1.01, "2026-10-30"
select count(*) from public.unit;                                       -- data referensi ada (> 0)
```

Role worker (F-186), sekali:

```sql
create role priceatlas_worker login password '<acak panjang>' noinherit;
grant service_role to priceatlas_worker;
alter role priceatlas_worker set role service_role;
```

Lalu dari PC lewat session pooler (string dari dashboard *Connect → Session pooler*, user diganti `priceatlas_worker.<ref>`):

```bash
psql "$WORKER_DATABASE_URL" -c "select current_user, session_user"   # service_role | priceatlas_worker
psql "$WORKER_DATABASE_URL" -c "select app.ai_spend_today()"          # 0 (hak eksekusi service_role)
```

Jika `current_user` bukan `service_role`: pakai cadangan `SET ROLE` setelah connect (7b B2): variable Environment `WORKER_DB_ROLE=service_role` + `WORKER_DB_ROLE_MODE=set` (docs/06 §5.2), lalu jalankan workflow `worker` manual dan pastikan log `worker.db` = `service_role`. Tanpa salah satu dari keduanya worker menolak berjalan (`WORKER_EXPECT_ROLE`, F-201).

Opsional: `pnpm --filter @priceatlas/db-types exec supabase gen types typescript --project-id <ref> --schema public` dibandingkan dengan `packages/db-types` (harus sama).

---

## 7. Auth dan email OTP produksi

| Pengaturan (dashboard *Authentication*) | Nilai | Alasan |
|---|---|---|
| Site URL | `https://<proyek>.vercel.app` | Tautan di email/redirect |
| Redirect URLs | `https://<proyek>.vercel.app/auth/callback` | PKCE (dipakai jika Google dinyalakan nanti) |
| Email provider | aktif; *Confirm email* mati (sama dengan `enable_confirmations = false`) | OTP sekaligus konfirmasi |
| OTP | panjang 6, kedaluwarsa 600 dtk | D-83, `config.toml` |
| Template *Magic Link* dan *Confirm signup* | subjek `Kode masuk PriceAtlas: {{ .Token }}`, isi `supabase/templates/otp.html` | F-187 |
| SMTP | bawaan Supabase | F-189 |
| Rate limits | default hosted (email ±2/jam ⚑, jeda kirim ulang 60 dtk) | F-86 |
| *Allow new users to sign up* | **aktif sampai akun pemilik dibuat, lalu mati** | F-188 |
| Google, provider lain, anonymous sign-in | mati | F-21 |
| JWT expiry / refresh token rotation | 3600 dtk / aktif (default, sama dengan `config.toml`) | Sesi panjang lewat refresh token |

Konsekuensi yang perlu diingat: login hanya bisa ke email pemilik; hapus akun (D-76) meminta kode baru, sehingga dalam satu jam hanya ada ruang ±1 permintaan lain. Setelah hapus akun, pendaftaran harus dibuka lagi untuk membuat akun baru.

---

## 8. Backup dan restore

**Isi:** `pg_dump -Fc` schema `public` dan `app`, ditambah data `auth.users` dan `auth.identities` (household terikat ke `user_id`). Tidak termasuk Storage (foto mati; `pasted_text` ada di database). Ukuran perkiraan < 5 MB.

**Jalur (usulan, Q-159):** workflow `backup.yml`, jadwal mingguan (Minggu 19:23 UTC) + manual:

```
db/scripts/backup_dump.sh (pg_dump 17, BACKUP_DATABASE_URL) → public_app.dump + auth.dump
  → tar | age -r $BACKUP_AGE_RECIPIENT → upload-artifact priceatlas-<waktu>.tar.age (retensi 30 hari)
```

(7b: dua berkas dalam satu tar karena `pg_dump` mengabaikan `--schema` jika ada `--table`; `auth.dump` juga memuat `supabase_migrations.schema_migrations` untuk cek versi saat restore, F-198.)

Isi dump tidak pernah tersimpan tanpa enkripsi di luar runner, dan log hanya mencetak ukuran file. Bulanan: unduh artifact terbaru ke PC (atau drive pribadi) supaya ada salinan di luar GitHub.

**Alternatif:** `pg_dump` manual dari PC tiap minggu (tanpa rahasia DB di GitHub, tetapi mudah terlupa).

**Restore:** ke Supabase lokal (latihan) atau proyek baru: skema dari migration pada versi yang sama → `db/scripts/backup_restore.sh` (satu transaksi: cek versi, `session_replication_role = replica`, `TRUNCATE … CASCADE`, data `auth` → `public` + `app`). Perintah lengkap: docs/06 §5.5; hasil uji 7b: §16.2 (F-199).

---

## 9. Domain, HTTPS, dan PWA di HP

**Domain dan HTTPS:** `https://<proyek>.vercel.app`, sertifikat otomatis dari Vercel. HTTPS memenuhi syarat service worker, `crypto.randomUUID`, dan kamera barcode (P-10). Domain sendiri (±US$10–15/tahun) di luar target US$0; jika ditambahkan nanti: domain di Vercel → Site URL + Redirect URL Supabase → redeploy (CSP tidak berubah karena hanya memuat origin Supabase).

**Memasang PWA:**

| HP | Langkah |
|---|---|
| Android (Chrome) | Buka URL → menu ⋮ → **Instal aplikasi** (atau banner pasang). Login di app yang terpasang. |
| iPhone (Safari) | Buka URL di Safari → Bagikan → **Tambah ke Layar Utama** (ajakan D-81 juga muncul). Buka dari ikon, lalu **login di app yang terpasang**: di iOS penyimpanan app layar utama terpisah dari Safari, jadi sesi Safari tidak terbawa. |

Setelah login: buka satu kali saat online supaya shell dan cache R5 terisi; `storage.persist()` diminta app (D-81). Versi baru tampil sebagai banner "Versi baru tersedia" (P-12) setelah deploy. Scan barcode tetap aktif (Q-148) jika browser mendukung BarcodeDetector (Android Chrome; di iOS ikonnya disembunyikan, D-58).

---

## 10. Masa kalibrasi di produksi (F-173)

**Yang diukur.** Struk tempelan memakai confidence ekstraksi tetap 0,90 (F-176) dan matching tier 1–3 yang sama dengan foto. Jadi masa kalibrasi dengan struk tempelan **valid untuk lapis 2 (matching)**: presisi per tier, `fuzzy_*`, kandidat τ (docs/08 §8.2). Lapis 1 (confidence ekstraksi foto) tetap dari harness D-16 nanti.

**Kapan.** Database produksi mulai dengan τ = 1,01 (migration masa kalibrasi), jadi sejak struk pertama tidak ada auto-save dan semua baris dicek pemilik proyek. Yang perlu disesuaikan hanya tanggalnya, karena laporan menyaring `transaction_date` (F-192):

1. Tempel struk asli pertama di produksi → tunggu sampai S-10 dan konfirmasi.
2. SQL Editor:

   ```sql
   -- tanggal transaksi struk tertua di produksi
   select min(transaction_date) from public.receipt where status <> 'discarded';
   update app.config set value = to_jsonb('<tanggal di atas>'::text) where key = 'calibration_started_on';
   ```

3. Jika kemudian menempel struk dengan tanggal transaksi lebih lama (mengisi histori), ulangi langkah 2.
4. Catat **tanggal go-live** di Decision Log (D-101) sebagai awal hitungan "2 minggu". Masa kalibrasi selesai setelah ≥ 2 minggu sejak go-live **dan** ≥ 150 baris produk dikonfirmasi (dengan ±16 struk × 15 baris, perkiraannya ±3–5 minggu).
5. Laporan dari PC: `psql "$BACKUP_DATABASE_URL" -f db/scripts/calibration_report.sql` (baca saja, agregat). τ dan `match_conf_*` final tetap lewat migration (docs/06 §2.10).

Jangan mengubah τ di produksi selama masa kalibrasi. Struk percobaan saat go-live sebaiknya struk asli; jika memakai struk buatan, hapus dulu (S-10 → hapus struk) sebelum langkah 2.

---

## 11. Operasional ringan

| Kapan | Cek | Cara |
|---|---|---|
| Setelah tempel struk | Struk sampai "Perlu dicek" ≤ 5 menit | S-08/S-09. Jika tidak: GitHub → Actions → `worker` (run terakhir) |
| Mingguan (otomatis) | Backup berhasil | Notifikasi email GitHub jika workflow gagal |
| Bulanan | Pemakaian Supabase (DB, egress), menit GitHub Actions, run worker/backup gagal | Dashboard Supabase *Usage*; GitHub *Settings → Billing* |
| Bulanan | Kesehatan database | `select status, count(*) from public.capture group by 1;` · `select kind, status, count(*) from app.job group by 1,2;` · `select count(*) from cron.job_run_details where status = 'failed' and start_time > now() - interval '30 days';` |
| Bulanan | Unduh backup ke PC | §8 |
| Bulanan | Workflow terjadwal `worker`/`backup` masih aktif dan run terakhir ≤ 1 hari/≤ 7 hari (F-205 ⚑) | GitHub → Actions → workflow → status + run terakhir; jika dinonaktifkan: *Enable workflow* |
| Tahunan | Rotasi token (§5.5) | Pengingat kalender |
| Jika app tidak bisa memuat data | Proyek ter-*pause* (F-183) | Dashboard Supabase → *Restore project*; tunggu sampai aktif; worker berikutnya memproses antrean |

Log: worker hanya id/status/durasi (docs/05 §7.4), tersimpan di run GitHub Actions; Vercel menyimpan log fungsi singkat. Tidak ada log yang berisi isi struk.

---

## 12. Perubahan untuk Tahap 7b

Dikerjakan setelah Q-151 dst. disetujui. Tidak mengubah skema data, RLS, RPC, atau kontrak.

| # | Bagian | Isi | Test |
|---|---|---|---|
| B1 | Migration `…_cron_cleanup.sql` (F-184) | Jadwal pg_cron `cron-cleanup` `'45 17 * * *'`: `delete from cron.job_run_details where end_time < now() - interval '7 days'`. Dilewati tanpa pg_cron (pola 0900). `--dev-scheduler` tidak perlu. | L4 `l4_supabase.sql`: 7 jadwal |
| B2 | Worker | `--sweep` (hanya dengan `--once`): `sweepOrphans` setelah antrean kosong, log `worker.once` + `orphans.swept` (F-185). Cadangan F-186 jika diperlukan: `WORKER_DB_ROLE_MODE=set` → `SET ROLE` di event `connect` pool. | L3 worker: `--once --sweep` menyapu objek yatim; argumen tidak valid ditolak |
| B3 | `.github/workflows/worker.yml` | `on: workflow_dispatch` + `schedule: '10 18 * * *'`; `environment: production`; `concurrency: { group: worker, cancel-in-progress: false }`; `timeout-minutes: 10`; Node 22 + pnpm cache; `pnpm install --frozen-lockfile --filter @priceatlas/worker...`; `start --once` (+ `--sweep` jika `schedule`). | Run manual pertama di go-live (§13) |
| B4 | Route `POST /api/worker/kick` (F-191) | `server-only`, `runtime nodejs`; `getUser()` wajib (401); env kosong → 204 tanpa aksi; GitHub `dispatches` (`ref: master`) dengan timeout 5 dtk; 202/502 tanpa detail. Klien: dipanggil tanpa menunggu setelah W1b di S-21 dan setelah W2 "Ulangi" di S-09; kegagalan diabaikan (worker harian tetap memproses). `check:bundle`: nama token tidak ada di `.next/static`. | L5a route (tanpa sesi 401, env kosong 204, sukses 202, GitHub gagal 502); L5b S-21/S-09 memanggil kick |
| B5 | `.github/workflows/backup.yml` | §8; restore diuji ke Supabase lokal, perintah ditulis di docs/06. | Run manual + latihan restore |
| B6 | `apps/web/vercel.json` | `{"regions": ["sin1"]}` | `next build` |
| B7 | Dokumen | docs/06 §5 "Produksi" (deploy, worker cadangan di PC, restore), `.env.example` (komentar produksi + `GITHUB_DISPATCH_*`), docs/09 §16 hasil 7b, PROJECT/README | — |

---

## 13. Checklist go-live

Dijalankan pemilik proyek setelah PR 7b di-merge ke `master` dan CI hijau. ⚑ = cek angka/nama di layar sebenarnya.

**0. Persiapan**
- [ ] Cek ulang batas Free ⚑ di halaman resmi Supabase, Vercel, GitHub Actions (§3.1, §3.2, F-195). Jika ada yang jauh berbeda, berhenti dan diskusikan.
- [ ] PC: Node ≥ 22, pnpm 10, Supabase CLI terbaru, `psql`/`pg_dump` 17, `age`.
- [ ] Repo GitHub privat (Q-153).
- [ ] `age-keygen -o ~/.config/priceatlas/backup.age`; simpan kunci privat di password manager; catat kunci publik `age1…`.

**1. Supabase**
- [ ] Buat proyek (§6.1), simpan kata sandi database.
- [ ] `supabase link` + `db push --dry-run` + `db push` + `migration list` (§6.2).
- [ ] Jalankan SQL verifikasi §6.3; semua sesuai.
- [ ] Buat role `priceatlas_worker` (§6.3), uji `current_user` lewat session pooler = `service_role`.
- [ ] Auth (§7): Site URL sementara boleh diisi setelah langkah 2; template OTP (F-187); OTP 6 / 600 dtk; Google mati; *sign up* masih aktif.

**2. Vercel**
- [ ] Import repo, Root Directory `apps/web`, Production branch `master`.
- [ ] Env Production §5.1 (tanpa service role di Preview). Token GitHub: buat fine-grained PAT (repo ini, *Actions: read and write*, 1 tahun).
- [ ] Deploy. Catat URL `https://<proyek>.vercel.app`.
- [ ] Supabase Auth: Site URL + Redirect URL = URL itu.
- [ ] Buka `/masuk` di laptop: halaman tampil, DevTools tanpa error CSP.

**3. GitHub Actions**
- [ ] *Settings → Environments → production*: batasi ke `master`; isi secret/variable §5.2.
- [ ] *Actions → worker → Run workflow*: log `worker.ai` menyebut extractor `off`, sources `text`; `worker.db` role `service_role`; `worker.once processed: 0` (docs/06 §5.2).
- [ ] *Actions → backup → Run workflow*: artifact `priceatlas-<waktu>.tar.age` ada; log `public_app.dump` dan `auth.dump` dengan jumlah tabel > 0.
- [ ] *Actions*: workflow `worker` dan `backup` berstatus aktif (jadwal tidak dinonaktifkan, F-205 ⚑).

**4. HP dan akun**
- [ ] Buka URL di HP, pasang PWA (§9), login dengan kode OTP dari email (cek template berisi kode, bukan tautan).
- [ ] Onboarding S-00b/S-00c (program member jika ada).
- [ ] Uji hapus akun dengan **akun uji kedua** dari laptop (email lain hanya bisa jika SMTP mengizinkan; jika tidak, lewati dan catat): 202, job `delete_household` selesai pada run worker berikutnya (F-196).
- [ ] Matikan *Allow new users to sign up* (F-188). Coba daftar dengan email lain → ditolak. Logout-login akun pemilik → tetap bisa.

**5. Struk pertama**
- [ ] Tab tengah → **Tempel struk dari Gemini** → Salin prompt → Gemini + foto struk asli → tempel → Kirim.
- [ ] GitHub Actions: run `worker` (dispatch) muncul dalam ±1 menit; S-09 menjadi "Perlu dicek" dalam ±2–3 menit.
- [ ] S-10: konfirmasi semua baris (toko, cabang, produk baru privat).
- [ ] Cari produk itu di S-01/S-02: harga terbaik tampil (ringkasan dari pg_cron ≤ 10 dtk).
- [ ] `calibration_started_on` (§10 langkah 2); catat tanggal go-live.

**6. Latihan restore**
- [ ] Unduh artifact backup → `age -d` di PC → `supabase start` pada commit dengan migration terakhir yang sama → `db/scripts/backup_restore.sh` (docs/06 §5.5) → login lokal tidak perlu; jumlah `auth.users`/`household`/`receipt`/`price_record`/`capture` yang dicetak sama dengan produksi. Jika gagal karena hak `session_replication_role` atau `TRUNCATE auth.users` (F-199 ⚑), catat pesan errornya.

**7. Pengingat**
- [ ] Kalender: bulanan (§11), tahunan rotasi PAT, "buka app minimal sekali seminggu" (F-183).
- [ ] Laporkan hasil (centang + catatan masalah) untuk dicatat di docs/09 §16 dan Decision Log.

---

## 14. Pertanyaan (Q-151 dst.)

| # | Pertanyaan | Usulan default |
|---|---|---|
| Q-151 | Tempat worker (§3.3)? | **GitHub Actions `--once`** (dipicu app + harian), cadangan PC. VM gratis ditinjau saat foto/AI dinyalakan dan latensi detik dibutuhkan. |
| Q-152 | Route `POST /api/worker/kick` dengan fine-grained PAT GitHub di Vercel (F-191)? | **Ya.** Tanpa route ini struk menunggu run harian. |
| Q-153 | Repo tetap privat; `supabase-e2e` malam tetap, diturunkan ke mingguan hanya jika menit mendekati kuota (F-195)? | **Ya.** Repo publik tidak dipakai karena log run (meski tanpa isi struk) dan riwayat aktivitas jadi terbuka. |
| Q-154 | Web di Vercel Hobby, domain `*.vercel.app`, tanpa domain sendiri? | **Ya.** |
| Q-155 | Supabase region Singapura, fungsi Vercel `sin1`? | **Ya.** |
| Q-156 | Worker memakai role login `priceatlas_worker` (`grant service_role` + `alter role … set role`) lewat session pooler, bukan `postgres` (F-186)? | **Ya**; cadangan `SET ROLE` setelah connect jika verifikasi gagal. |
| Q-157 | Auth produksi: SMTP bawaan, template OTP di-set manual, pendaftaran ditutup setelah akun pemilik dibuat, Google mati (F-187–F-189)? | **Ya.** SMTP sendiri + domain ditunda sampai ada user lain. |
| Q-158 | Migration pembersih `cron.job_run_details` (simpan 7 hari) (F-184)? | **Ya.** |
| Q-159 | Backup mingguan via GitHub Actions, dienkripsi `age`, retensi 30 hari + salinan bulanan ke PC, latihan restore sekali (F-190)? | **Ya.** |
| Q-160 | Produksi tanpa `seed.sql` (katalog global kosong, data dibuat privat saat konfirmasi), dan `calibration_started_on` = tanggal transaksi struk tertua (F-192, F-193)? | **Ya** untuk keduanya. |
| Q-161 | Pencegahan pause: run worker harian + pengingat; jika tetap ter-*pause*, dipulihkan manual (F-183)? | **Ya.** |
| Q-162 | Pembagian item Tahap 7 di §4 (wajib sekarang: F-86/F-187/F-188, role pooler; tunda: CSP D-86, F-138, F-170, F-167, F-103, F-94, dengan pemicu)? | **Ya.** |
| Q-163 | Hapus akun diuji dengan akun kedua saat go-live; jika SMTP bawaan menolak email non-anggota tim, uji ini dilewati dan diganti uji di Supabase lokal (sudah di e2e alur 7)? | **Ya.** |

**Hasil review (2026-10-31):** pemilik proyek menerima semua usulan default Q-151 s/d Q-163 → **D-101**. Berikutnya Tahap 7b (§12); tanggal go-live (awal hitungan masa kalibrasi, §10 langkah 4) dicatat di D-101 saat go-live.

---

## 15. Bagian yang belum bisa dirancang penuh

| Bagian | Alasan | Kapan |
|---|---|---|
| Angka batas layanan ⚑ | Sumber pihak ketiga, sebagian bertentangan | §13 langkah 0 |
| `ALTER ROLE … SET role` lewat Supavisor (F-186) | Belum bisa diuji tanpa proyek hosted (lewat koneksi langsung PostgreSQL 17 lokal: berhasil, §16.2) | §6.3 saat go-live; cadangan B2 siap (`WORKER_DB_ROLE_MODE=set`) |
| Restore ke Supabase (hak `postgres` untuk `session_replication_role` dan `TRUNCATE auth.*`, F-199) | Perintah dirumuskan dan diuji di 7b terhadap PostgreSQL lokal mode A (§16.2); Supabase CLI tidak bisa dijalankan di lingkungan pembuatan 7b | §13 langkah 6 |
| Apakah query worker harian dihitung "aktivitas" oleh Supabase (F-183) | Definisi aktivitas tidak terdokumentasi jelas | Diamati setelah 2–3 minggu pemakaian |
| Kunci API Supabase generasi baru vs lama (F-196) | Tergantung proyek baru | §13 langkah 4 |
| Hosting saat foto/AI dinyalakan | Menunggu anggaran dan D-16/D-99; F-138/F-167/F-170 ditinjau saat itu | Setelah ada anggaran |

---

**Sumber batas layanan (dicek 2026-10-31):** [Supabase Production Checklist](https://supabase.com/docs/guides/deployment/going-into-prod.md), [Vercel Hobby plan](https://vercel.com/docs/plans/hobby), [Vercel limits](https://vercel.com/docs/concepts/limits/overview), [GitHub Actions billing](https://docs.github.com/en/actions/reference/usage-limits-billing-and-administration), ringkasan harga Supabase pihak ketiga ([makerkit](https://makerkit.dev/blog/md/saas/supabase-pricing), [toolradar](https://toolradar.com/blog/supabase-pricing-2026), [metacto](https://www.metacto.com/blogs/the-true-cost-of-supabase-a-comprehensive-guide-to-pricing-integration-and-maintenance)).

---

## 16. Tahap 7b: hasil dan temuan baru (F-198 dst.)

> Status: **selesai dan disetujui (D-102).** Implementasi §12 (B1–B7) sesuai D-101. Tidak mengubah skema data, RLS, RPC, atau kontrak; CI tetap tanpa API berbayar dan tanpa rahasia produksi (workflow produksi hanya membaca Environment `production`, yang tidak dipakai `ci.yml`). Go-live (§13) belum dijalankan.

### 16.1 Yang dibangun

| # | Bagian | Isi |
|---|---|---|
| B1 | `supabase/migrations/20261031000200_cron_cleanup.sql` | Jadwal pg_cron `cron-cleanup` `'45 17 * * *'`: hapus `cron.job_run_details` dengan `end_time` > 7 hari. Dilewati jika extension `pg_cron` tidak terpasang (mode A); `cron.schedule` dengan nama sama memperbarui jadwal (idempoten). L4 `l4_supabase.sql`: 7 jadwal terdaftar, jadwal `cron-cleanup` = `45 17 * * *`, dan perintahnya dijalankan sebagai `postgres` tanpa error hak akses. docs/05 §1.4 dan docs/06 §2.4/§3.6/§5.6 diperbarui. |
| B2 | `apps/worker` | `src/cli.ts`: parser argumen (`--once`, `--sweep` hanya bersama `--once`, `--dev-scheduler` tidak bersama `--once`, `--worker-id <id>`; argumen tidak dikenal/ganda ditolak) dijalankan sebelum koneksi apa pun. `Worker.runOnce({ sweep })`: kuras antrean lalu `sweepOrphans`; log `worker.once { processed, swept }` (+ `orphans.swept` jika ada). `src/db.ts`: `WORKER_DB_ROLE_MODE` = `startup` (default, perilaku lama) \| `set` (cadangan F-186: `SET ROLE` lewat hook `onConnect` pg-pool; gagal → koneksi ditutup) dan `checkDbRole`: worker mencatat `worker.db { role }` saat start dan berhenti jika role efektif ≠ `WORKER_EXPECT_ROLE` (atau `WORKER_DB_ROLE`) (F-201, F-202). |
| B3 | `.github/workflows/worker.yml` | `workflow_dispatch` + `schedule '10 18 * * *'`; `environment: production`; `concurrency: { group: worker, cancel-in-progress: false }`; `timeout-minutes: 10`; `permissions: contents: read`; Node 22 + cache pnpm; `pnpm install --frozen-lockfile --filter @priceatlas/worker...`; `start --once --worker-id gh-<run>-<attempt>` (+ `--sweep` pada `schedule`). Env: `DATABASE_URL` ← secret `WORKER_DATABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL` ← variable `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `STORAGE_BACKEND=supabase`, `EXTRACTOR=off`, `AI_MATCHER=off`, `WORKER_EXPECT_ROLE=service_role`, `WORKER_DB_ROLE`/`_MODE` dari variable (kosong = jalur `ALTER ROLE`). |
| B4 | `POST /api/worker/kick` | Route `app/api/worker/kick/route.ts` (`server-only`, `runtime nodejs`, `force-dynamic`, `Cache-Control: no-store`) + logika `lib/worker/kick-server.ts`: `getUser()` wajib (401) → `GITHUB_DISPATCH_TOKEN`/`GITHUB_DISPATCH_REPO` kosong atau repo tidak berpola `owner/nama` → 204 tanpa aksi → `POST api.github.com/repos/<repo>/actions/workflows/worker.yml/dispatches` `{ref: "master"}` dengan `AbortSignal.timeout(5000)` → 2xx = 202 `{status: "queued"}`, selain itu/timeout/jaringan → 502 `KICK_FAILED` tanpa detail GitHub. Isi respons GitHub tidak dibaca; log `worker.kick { status, ms }`. Klien `lib/worker/kick.ts` (`fetch` `keepalive`, error diabaikan): S-21 setelah W1b berhasil (sebelum pindah ke S-09), dan `useRetryCapture` `onSuccess` (tombol "Ulangi" S-09 dan S-08, F-200). `check:bundle`: nama `GITHUB_DISPATCH_TOKEN`/`_REPO`, `github_pat_`, `api.github.com`, `/dispatches` dan nilai token (jika ada di env) tidak boleh ada di `.next/static`. |
| B5 | Backup + restore | `.github/workflows/backup.yml` (Minggu 19:23 UTC + manual, `environment: production`, `concurrency: backup`, `timeout-minutes: 15`): klien PostgreSQL 17 + `age` → cek pola `BACKUP_AGE_RECIPIENT` → `db/scripts/backup_dump.sh` → `tar` → `age -r` → artifact `priceatlas-<waktu>.tar.age` (retensi 30 hari, `compression-level: 0`, `if-no-files-found: error`); berkas tanpa enkripsi dihapus `trap`, `umask 077`. `db/scripts/backup_dump.sh`: `public_app.dump` (`-Fc --schema=public --schema=app`) + `auth.dump` (`-Fc --data-only` `auth.users`, `auth.identities`, `supabase_migrations.schema_migrations`), log jumlah tabel + ukuran saja (F-198). `db/scripts/backup_restore.sh` (F-199): satu transaksi — cek versi migration, `SET LOCAL session_replication_role = replica`, `TRUNCATE … CASCADE` tabel yang ada di backup, data `auth` → `public` + `app`, cetak jumlah baris; target `*.supabase.co/.com` ditolak kecuali `ALLOW_REMOTE_RESTORE=1`. Perintah di docs/06 §5.4–§5.5. |
| B6 | `apps/web/vercel.json` | `{"regions": ["sin1"]}` (+ `$schema`). |
| B7 | Dokumen dan pengaman | docs/06 §5 "Produksi" (komponen, worker produksi + cadangan PC, pemicu, backup, restore, pembersih pg_cron), §1/§2.4/§3.2/§3.6; docs/05 §1.4; `.env.example` (komentar produksi, `WORKER_DB_ROLE_MODE`, `WORKER_EXPECT_ROLE`, `GITHUB_DISPATCH_*`, `BACKUP_DATABASE_URL`); docs/09 §1.1, §5.2, §6.3, §8, §11, §13, §15, §16; PROJECT.md, README. `.gitignore` + `scripts/check-secrets.sh` diperluas (F-203). |

### 16.2 Hasil test

| Lapisan | Hasil | Catatan |
|---|---|---|
| L1 `bash db/tests/run.sh` | **682 lulus** (smoke 43 + flows 639; tidak berubah) | Tidak ada flow baru: migration B1 dilewati tanpa pg_cron, jadi skema mode A tidak berubah. Dijalankan per file di PostgreSQL 17.10; `00_baseline_equivalence` (butuh `pg_dump` 17) dijalankan di PostgreSQL 16 lokal (F-206). |
| `snapshot.sh --check`, `smoke.sha256` | lulus | `--check` di PostgreSQL 16 (F-206); `db/schema.sql` tidak berubah. |
| B1 dengan `pg_cron` tiruan | lulus | Ekstensi tiruan sementara (`cron.job`, `cron.job_run_details`, `cron.schedule`) di PostgreSQL 17 lokal: build penuh → 7 jadwal, `cron-cleanup` `45 17 * * *`; perintahnya menghapus baris 9 hari dan menyisakan 6 hari; migration dijalankan ulang → tetap 7. Ekstensi tiruan dihapus lagi. L4 sungguhan berjalan di CI `supabase-e2e`. |
| worker | **237 lulus, 1 dilewati** (D-100: 215) | `once.test.ts` 22: parser (5 diterima, 8 ditolak), `parseRoleMode`; mode `set` → dua koneksi paralel sama-sama `service_role` (session_user `postgres`); role tak bisa dipakai → query gagal, tidak berjalan sebagai role login; `checkDbRole` beda → error; `runOnce` tanpa sweep membiarkan objek yatim, dengan sweep menghapus yang > 24 jam dan membiarkan yang baru; `main.ts` sebagai proses: `--sweep` saja → exit 1 sebelum menyentuh DB (tanpa `DATABASE_URL`), argumen salah → exit 1, `WORKER_EXPECT_ROLE` ≠ role → exit 1 tanpa `worker.once`, `--once --sweep` + `set` + `EXTRACTOR=off` → exit 0, `worker.db` `service_role`, `sources: text`, `swept: 1`. Dilewati: HEIC asli (sampel pemilik proyek, sudah ada). |
| web, contracts, ai-tools | **650**, 76, 55 (D-100: 635, 76, 55) | `worker-kick.test.ts` 12 (L5a): config env (kosong, spasi, pola repo); tanpa sesi → 401 tanpa panggilan (juga saat env kosong); env kosong → 204 tanpa panggilan/log; sukses → 202, URL/metode/body `ref: master`/header token/signal; GitHub 200 → 202; 401/403/404/422/500 → 502 tanpa isi GitHub, log tanpa token; jaringan gagal dan timeout → 502. L5b: S-21 memanggil kick tepat sekali setelah W1b dan pindah ke S-09 tanpa menunggu respons; W1b gagal → tanpa kick (`paste.test.tsx` +2); S-09 "Ulangi" berhasil → kick, ditolak → tanpa kick (`uploads.test.tsx` +1). |
| typecheck, lint + format web, `next build`, `check:bundle`, `check-secrets.sh` | lulus | `next build` mendaftarkan `ƒ /api/worker/kick`. `check:bundle` dengan `GITHUB_DISPATCH_TOKEN` palsu di env: lulus; uji negatif (berkas berisi token di `.next/static`) → GAGAL dua kali, sesuai harapan. JS `/` 340 KiB modul. `check-secrets.sh` diuji negatif di repo sementara: token GitHub, kunci age, URL Supabase bersandi, nilai env produksi, `.env.production.local` dan `.dump` yang dilacak → GAGAL. |
| Perintah `worker.yml` (simulasi) | lulus | Salinan bersih repo: `pnpm install --frozen-lockfile --filter @priceatlas/worker...` (141 paket, tanpa `apps/web`), lalu skrip langkah "Worker --once" dengan `GITHUB_EVENT_NAME` `workflow_dispatch` (`swept: null`) dan `schedule` (`swept: 0`), keduanya exit 0. |
| Role `priceatlas_worker` (F-186) | lulus (koneksi langsung) | PostgreSQL 17 lokal: `create role … noinherit; grant service_role; alter role … set role service_role` → `select current_user, session_user` = `service_role \| priceatlas_worker`; worker `--once --sweep` tanpa `WORKER_DB_ROLE` + `WORKER_EXPECT_ROLE=service_role` → exit 0. Lewat Supavisor belum bisa diuji (§15). |
| Backup → `age` → restore (B5) | lulus (PostgreSQL 16 lokal) | Sumber: mode A + seed + `30_confirm_receipt` (3 user, 5 struk, 5 `price_record`) + `supabase_migrations` tiruan. `backup_dump.sh` → 32 + 2 tabel data → `tar` \| `age -r` → `age -d` → `backup_restore.sh` ke DB target berisi seed: **33 tabel identik** (md5 seluruh baris per tabel, termasuk `auth.users`, ringkasan, audit), sequence identity sama, insert baru setelah restore jalan. Negatif: versi migration berbeda → berhenti; host `*.pooler.supabase.com` → ditolak; `public_app.dump` terpotong → exit 1 dan target tidak berubah (rollback). |
| Workflow di GitHub, L4, e2e | **tidak dijalankan** | `worker.yml`/`backup.yml` hanya bisa jalan di GitHub dengan Environment `production` (go-live §13 langkah 3). L4 dan e2e berjalan di CI `supabase-e2e`; lingkungan sesi tanpa Docker/Supabase CLI (F-206). YAML diperiksa dengan parser. |

### 16.3 Penyimpangan dari §12 dan alasannya

| # | §12 | Yang dibuat | Alasan |
|---|---|---|---|
| 1 | B5: artifact `priceatlas-<tanggal>.dump.age` (satu dump) | `priceatlas-<waktu>.tar.age` berisi `public_app.dump` + `auth.dump` | F-198. |
| 2 | B5: restore `pg_restore --data-only` urutan `auth` → `public` → `app` | Skrip satu transaksi dengan `session_replication_role = replica`, `TRUNCATE`, dan cek versi | F-199: target hasil migration sudah berisi data referensi; trigger turunan harus mati. |
| 3 | B4: kick setelah W2 "Ulangi" di S-09 | Di hook `useRetryCapture` (S-09 dan S-08) | F-200. |
| 4 | B2: cadangan `SET ROLE` "jika diperlukan" | Disiapkan sekarang + `WORKER_EXPECT_ROLE` | F-201, F-202. |
| 5 | B2: argumen tidak valid ditolak | Juga `--dev-scheduler` + `--once` dan argumen ganda | Kombinasi itu tidak punya arti; lebih baik gagal jelas. |
| 6 | — | `.gitignore` + `check-secrets.sh` diperluas | F-203. |

### 16.4 Temuan baru

| # | Temuan | Dampak | Penanganan | Pertanyaan |
|---|---|---|---|---|
| F-198 | **`pg_dump` mengabaikan `--schema` jika ada `--table`** (perilaku terdokumentasi: tabel `-t` dipilih tanpa memedulikan `-n`, dan objek non-tabel tidak ikut). | Satu perintah `-n public -n app -t auth.users` hanya akan membackup `auth.users`. | Dua dump dalam satu tar terenkripsi; `auth.dump` juga memuat `supabase_migrations.schema_migrations` (versi). | Q-164 |
| F-199 | **Restore ke database hasil migration butuh lebih dari `pg_restore --data-only`.** Target sudah berisi data referensi (satuan, kategori, `app.config`) dan seed → bentrok kunci; trigger turunan (D-63), audit, dan penjaga status akan menghitung ulang/menolak data; migration target harus sama versinya dengan backup. Supabase memakai `SET session_replication_role = replica` sebagai `postgres` di panduan restore-nya ⚑, tetapi hak itu dan `TRUNCATE auth.users … CASCADE` belum dibuktikan di Supabase di sesi ini. | Tanpa ini restore gagal atau data turunan ganda. | `backup_restore.sh` (§16.1 B5); diuji di PostgreSQL lokal (§16.2). Latihan ke Supabase lokal di §13 langkah 6; jika hak ditolak, catat error dan diskusikan (mis. latihan sebagai `supabase_admin` lokal). | Q-165 |
| F-200 | **"Ulangi" juga ada di S-08 (daftar unggahan)** dengan hook yang sama (`useRetryCapture`). | Memicu dari komponen S-09 saja membuat "Ulangi" di S-08 menunggu run harian. | Kick di `onSuccess` hook: satu tempat untuk S-08 dan S-09; tidak dipanggil jika W2 ditolak. | Q-166 |
| F-201 | **Tidak ada pengaman jika `WORKER_DATABASE_URL` diisi dengan user `postgres`** (mis. salah salin string koneksi dari dashboard). Worker akan berjalan dengan hak penuh tanpa tanda apa pun (F-22). | Bug hak akses tersembunyi di produksi; rahasia GitHub yang bocor memberi akses penuh. | `WORKER_EXPECT_ROLE=service_role` di `worker.yml`: worker mencatat `worker.db { role }` dan berhenti jika berbeda. Opsional di dev. | Q-167 |
| F-202 | **Cadangan `SET ROLE` sebaiknya siap sebelum go-live.** Verifikasi §6.3 baru bisa dilakukan saat go-live; jika `ALTER ROLE … SET role` tidak berlaku lewat Supavisor, worker produksi tertahan sampai ada PR baru. Pola event `connect` + `client.query` memicu peringatan *deprecated* pg (antrean query akan dihapus di pg@9). | Go-live bisa terhenti di tengah. | `WORKER_DB_ROLE_MODE=set` memakai hook `onConnect` pg-pool (ditunggu; gagal → koneksi ditutup dan error diteruskan), diaktifkan cukup lewat variable Environment. Diuji L3 (dua koneksi paralel, role gagal). | Q-168 |
| F-203 | **`.env.production.local` tidak di-gitignore**, padahal docs/09 §5.4 memakainya untuk cadangan worker di PC (`.gitignore` hanya `.env` dan `.env.local`). `check-secrets.sh` juga belum mengenali token GitHub, kunci age, atau URL database bersandi. | Rahasia produksi bisa ikut commit. | `.gitignore`: `.env.*.local`, `.env.production*`, `*.tar.age`, `*.dump`. `check-secrets.sh`: token GitHub (`github_pat_`, `gh[pousr]_`), `AGE-SECRET-KEY-1…`, URL `postgres://…:<sandi>@…supabase.co/.com`, nilai `GITHUB_DISPATCH_TOKEN`/`BACKUP_DATABASE_URL`/`WORKER_DATABASE_URL` terisi, serta `.env*` dan berkas backup yang dilacak. | — |
| F-204 | **Kick tanpa batas laju.** Setiap user yang login bisa memicu `workflow_dispatch` berulang; `concurrency` membatasi menjadi satu run berjalan + satu menunggu, tetapi setiap run tetap memakai ±1–2 menit kuota (F-195). | Untuk pemakai tunggal dengan pendaftaran ditutup (F-188) risikonya hanya dari akun pemilik sendiri. | Diterima untuk sekarang. Sebelum pendaftaran dibuka: kick hanya jika household pemanggil punya capture `uploaded`, atau batas per user (mis. 1 per 30 dtk). | Q-169 |
| F-205 | **GitHub menonaktifkan workflow terjadwal setelah 60 hari tanpa aktivitas repo ⚑** (terdokumentasi untuk repo publik; perlu dicek untuk repo privat). | Run harian (F-183 pencegah pause, retensi, sapuan) dan backup mingguan diam-diam berhenti jika repo lama tidak di-commit. | Cek bulanan di §11 + checklist §13 langkah 3. Pemicu dari app (`workflow_dispatch`) tidak terpengaruh. | Q-170 |
| F-206 | **Lingkungan pembuatan 7b:** tanpa Docker/Supabase CLI, `apt.postgresql.org` diblokir, hanya PostgreSQL 16 terpasang; membangun `pg_dump` 17 dari source ditolak oleh pemeriksa izin sesi. | `00_baseline_equivalence`, `snapshot.sh --check`, dan siklus backup/restore tidak bisa dijalankan dengan versi 17; L4, e2e, dan workflow tidak dijalankan. | Server PostgreSQL 17.10 dari paket npm `@embedded-postgres/linux-x64` untuk L1/L3/L5; tiga pemeriksaan berbasis `pg_dump` di PostgreSQL 16 lokal. CI menjalankan semuanya di 17 (`test`, `supabase-e2e`). Hal yang belum terbukti dicatat di §15 dan diverifikasi di go-live. | — |

### 16.5 Pertanyaan (Q-164 dst.)

| # | Pertanyaan | Usulan default |
|---|---|---|
| Q-164 | Backup sebagai `priceatlas-<waktu>.tar.age` berisi `public_app.dump` + `auth.dump` (dengan versi migration) (F-198)? | **Ya.** |
| Q-165 | Restore lewat `backup_restore.sh` (satu transaksi, `session_replication_role = replica`, `TRUNCATE`, cek versi, target hosted ditolak tanpa `ALLOW_REMOTE_RESTORE=1`); hak di Supabase dibuktikan di latihan §13 langkah 6 (F-199)? | **Ya.** Jika latihan ditolak karena hak, error dicatat dan alternatif dibahas sebelum backup dianggap andal. |
| Q-166 | Kick setelah "Ulangi" berhasil, baik dari S-09 maupun S-08 (F-200)? | **Ya.** |
| Q-167 | `WORKER_EXPECT_ROLE=service_role` tetap di `worker.yml` (worker berhenti jika role lain) (F-201)? | **Ya.** |
| Q-168 | Cadangan `WORKER_DB_ROLE_MODE=set` disiapkan sekarang (bukan setelah verifikasi §6.3 gagal) (F-202)? | **Ya.** Jalur utama tetap `ALTER ROLE … SET role`. |
| Q-169 | Kick tanpa batas laju selama pemakai tunggal; batas ditinjau sebelum pendaftaran dibuka (F-204)? | **Ya.** |
| Q-170 | Cek bulanan "workflow terjadwal masih aktif" ditambahkan ke §11 dan §13 (F-205)? | **Ya.** |

**Hasil review (2026-10-31):** pemilik proyek menerima semua usulan default Q-164 s/d Q-170 → **D-102**. Berikutnya go-live (§13) oleh pemilik proyek; hasilnya (centang + catatan, tanggal go-live untuk §10 langkah 4) dicatat di §17 dan Decision Log.

### 16.6 Berikutnya

1. ~~Pemilik proyek menjawab Q-164 s/d Q-170~~ → D-102 (selesai). PR 7b di-merge ke `master` setelah CI (termasuk `supabase-e2e`: L4 7 jadwal pg_cron) hijau.
2. Go-live sesuai §13, termasuk langkah baru: `worker.db` = `service_role`, workflow terjadwal aktif, dan latihan restore dengan `backup_restore.sh`.
3. Hasil go-live dicatat (§17, D-101 tanggal go-live, temuan baru F-207 dst.).

