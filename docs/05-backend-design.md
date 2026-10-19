# Tahap 4a — Desain Backend

> Status: **Draft untuk review.** Belum ada kode implementasi. Tahap 4b dimulai setelah dokumen ini disetujui.
> Dasar: `PROJECT.md` (D-01 s/d D-60), `docs/02-domain-model.md`, `docs/03-database-design.md`, `db/schema.sql`, `db/tests/`, `docs/04-wireframe.md`.
> Rujukan `§` tanpa nama dokumen mengacu ke `PROJECT.md`. "Desain fisik §n" mengacu ke `docs/03-database-design.md`. "Wireframe §n" mengacu ke `docs/04-wireframe.md`.

Dokumen ini tidak mengubah requirement atau keputusan. Setiap celah, bug di skema, atau perubahan yang belum diputuskan ditulis sebagai **temuan (F-xx)** dan **pertanyaan (Q-xx)** dengan usulan default. Perubahan skema yang belum diputuskan diberi tanda **⚑ perlu persetujuan**.

---

## Daftar Isi

0. [Ringkasan dan Temuan](#0-ringkasan-dan-temuan)
1. [Arsitektur dan Pilihan Teknologi](#1-arsitektur-dan-pilihan-teknologi)
2. [Rencana Migration](#2-rencana-migration)
3. [Kontrak API per Layar](#3-kontrak-api-per-layar)
4. [Alur Tulis yang Tidak Atomik](#4-alur-tulis-yang-tidak-atomik)
5. [Pipeline Capture](#5-pipeline-capture)
6. [Definisi Tools AI](#6-definisi-tools-ai)
7. [Keamanan dan PII](#7-keamanan-dan-pii)
8. [Strategi Test](#8-strategi-test)
9. [Pertanyaan untuk Didiskusikan](#9-pertanyaan-untuk-didiskusikan)

---

## 0. Ringkasan dan Temuan

### 0.1 Ringkasan rancangan

| Aspek | Usulan |
|---|---|
| API | Klien memanggil Supabase langsung dengan JWT user: **PostgREST untuk CRUD sederhana, RPC PostgreSQL untuk operasi bisnis**. Next.js Route Handler hanya untuk operasi yang butuh rahasia (hapus akun; nanti endpoint Tanya di Tahap 6). |
| Logika tulis | Di **fungsi PostgreSQL** (RPC). Satu operasi bisnis = satu transaksi database. Invariant ditegakkan oleh constraint dan trigger, bukan oleh kode TypeScript. |
| Worker | **Proses Node.js (TypeScript)** yang terhubung langsung ke Postgres. Mengerjakan pipeline capture dan job yang butuh Storage/AI. |
| Penjadwalan | **pg_cron** untuk job yang murni SQL (antrean ringkasan, jendela waktu, promosi alias, reaper). Worker untuk job yang butuh Storage/AI. |
| OCR/AI | Antarmuka `CaptureExtractor` + `AiMatcher` dengan **implementasi stub deterministik** (fixture per hash gambar). |
| Repo | Monorepo pnpm: `supabase/` (migration), `apps/web` (scaffold Next.js), `apps/worker`, `packages/contracts`, `packages/ai-tools`, `db/tests` (harness SQL). |
| Test | Harness SQL di PostgreSQL biasa (diperluas dari `db/tests/`), test TypeScript untuk worker dan tools, dan uji opsional di Supabase CLI lokal. |
| Jumlah RPC | 21 baca, 18 tulis (bagian 3.2), dan 1 Route Handler. |

### 0.2 Temuan saat menganalisis skema (F-xx)

Temuan F-01 sampai F-04 sudah **direproduksi** terhadap `db/schema.sql` di PostgreSQL 16 (database uji smoke test).

| # | Temuan | Dampak | Usulan | Ke |
|---|---|---|---|---|
| **F-01** | **Merge produk privat ke produk global mengubah barcode privat menjadi barcode global.** `merge_product` memindahkan `barcode_assignment.product_id`, lalu trigger `barcode_copy_owner` (SECURITY DEFINER) menyalin `household_id = NULL` dari produk target. *Terverifikasi: barcode `89999999` milik household B menjadi global setelah merge.* | Melanggar D-29 (user tidak boleh membuat data global). Barcode salah dari satu user bisa memengaruhi matching tier 1 semua user. Merge juga bisa gagal karena constraint `EXCLUDE` jika kode yang sama sudah ada di produk global. | Pada merge privat → global, barcode privat **tidak dipindah**. Barcode itu tetap menempel di produk lama (`merged`), dan matching mengikuti `merged_into_id`. | Q-05 |
| **F-02** | **Menghapus `price_record` publik meninggalkan fakta publik yatim.** FK `app.public_price_source.price_record_id ... on delete cascade` dijalankan oleh trigger internal yang berjalan **sebelum** `price_record_sync_public`, jadi saat trigger sinkronisasi berjalan, tautannya sudah hilang. *Terverifikasi: setelah `DELETE` record publik, `public_price_fact` tetap 1 baris.* | Bertentangan dengan desain fisik §7.3 ("saat hapus, salinannya dihapus"). Hal yang sama terjadi saat household dihapus. Fakta tetap ada, tetapi hanya karena **kebetulan urutan trigger**, bukan karena dirancang. | Bagian hapus dipindah ke trigger `BEFORE DELETE`. Perilaku saat hapus akun dibuat **eksplisit** (Q-06). | Q-05, Q-06 |
| **F-03** | **`receipt.pii` terbaca lewat PostgREST**, dan **ikut tersalin ke `audit_log.before/after`** setiap kali header struk dikoreksi (`to_jsonb(old)`). *Terverifikasi: entri audit struk memuat kunci `pii`.* | Wireframe S-10 menyatakan PII "tidak pernah ditampilkan", tetapi klien yang menulis `select=*` tetap menerimanya. Audit menyimpan salinan PII yang tidak ikut terhapus saat PII disamarkan. | Hak kolom: `pii` tidak bisa di-`SELECT` oleh `authenticated`. `audit_row` membuang kunci `pii` dari snapshot. | Q-04 |
| **F-04** | **`processing_run` bisa dibaca dan ditulis penuh oleh `authenticated`** (pola HOUSEHOLD CRUD), termasuk `raw_ocr_text` dan `raw_ai_output`. *Terverifikasi: `has_table_privilege(..., 'INSERT') = true`.* | User bisa membaca teks OCR mentah yang belum disamarkan, atau memalsukan run. | `authenticated` hanya boleh `SELECT` kolom non-mentah. Tulis hanya oleh worker (service role). | Q-04 |
| F-05 | **D-23 (Price Record diturunkan satu arah dari Receipt Line) tidak ditegakkan di database.** Harga di `price_record` sumber struk bisa diubah langsung, dan perubahan `receipt_line` tidak memperbarui record-nya. | Data struk dan histori harga bisa tidak sinkron. Ini tepat jenis kerusakan yang ingin dicegah prinsip "invariant di database". | Trigger turunan + trigger konsistensi (bagian 4.3). | Q-03 |
| F-06 | **FK komposit `(branch_id, store_id)` memakai `MATCH SIMPLE`.** Jika `store_id` NULL, FK tidak diperiksa sama sekali, sehingga `branch_id` boleh menunjuk cabang mana pun. Saat ini aman karena `receipt.store_id` NOT NULL. Setelah D-49 (store boleh NULL saat draft), celah ini terbuka. Celah yang sama sudah ada di `capture`. | Draft struk atau capture bisa merujuk cabang yang tidak cocok dengan tokonya. | `CHECK (store_id IS NOT NULL OR branch_id IS NULL)` di `receipt`, `capture`, dan `capture_item`. | Q-09 |
| F-07 | **`price_summary` tidak memperhatikan mata uang.** `refresh_price_summary` mengambil `min(unit_price)` dari semua record, termasuk mata uang berbeda. | Bertentangan dengan domain model §2.6 ("perbandingan lintas mata uang ditolak"). Untuk MVP (IDR saja) belum berdampak. | Ringkasan hanya menghitung record dengan `currency = household.default_currency`. | Q-15 |
| F-08 | **Query §9 no. 6 mengelompokkan per *nama* toko dan cabang.** Toko global "AEON" dan toko privat bernama "AEON" (keduanya terlihat oleh user) akan tergabung jadi satu baris. | Angka "lebih hemat di mana" salah. | Kelompokkan per `store_id`, `branch_id`, lalu join nama. | §3.4 |
| F-09 | **Supabase memberi hak default ke `anon` dan `authenticated`** untuk setiap tabel dan fungsi baru di schema `public` (`ALTER DEFAULT PRIVILEGES`). `schema.sql` hanya mencabutnya sekali di akhir file. Tabel, view, atau RPC yang dibuat di migration berikutnya otomatis terbuka. | Tabel baru (mis. `capture_item`) bisa terbaca oleh `anon` jika lupa `REVOKE`. | Setiap migration wajib `REVOKE` eksplisit. Stub test meniru default privileges Supabase. Ada test inventaris hak akses (bagian 8). | §2.4 |
| F-10 | `app.config_int()` meng-cast ke integer. Kunci D-50 `auto_save_min_confidence = 0.90` tidak bisa dibaca. | — | Tambah `app.config_numeric()`. | §2.2 |
| F-11 | **Keanggotaan program member tidak punya histori.** `household_program_membership` hanya punya `created_at`, dan keluar dari program berarti barisnya dihapus. | D-26 berlaku "pada tanggal observasi". Saat harga observasi lama dikoreksi (S-16), sistem tidak bisa tahu apakah household *waktu itu* member. | Simpan snapshot kelayakan member di `price_record.extra.member_eligible` saat record dibuat (bagian 2.3). | Q-07 |
| F-12 | **`current_date` di database Supabase memakai UTC**, sedangkan household memakai `Asia/Jakarta`. Antara pukul 00:00 dan 07:00 WIB, "hari ini" di database masih kemarin. Contoh jadwal `'5 0 * * *'` di desain fisik §7.2 berarti 07:05 WIB. | Jendela 90 hari dan tren bergeser hingga 7 jam. Tanggal default label foto dini hari bisa salah satu hari. | Tanggal default dihitung dengan `household.timezone`. Job harian dijadwalkan 17:05 UTC (00:05 WIB). | Q-16 |
| F-13 | **Operator trigram `%`** (`similarity`) memberi skor rendah untuk kata kunci pendek terhadap nama panjang. Contohnya "milo" terhadap "milo original 200". | Search §9 no. 1 bisa tidak menemukan produk yang jelas cocok. | Pakai `word_similarity` (operator `<%`), yang juga didukung index GIN trigram yang sudah ada. | §3.4 |
| F-14 | Policy Storage §6.4 memakai `for all`, sehingga user bisa **menimpa atau menghapus** gambar bukti. Selain itu, `::uuid` gagal dengan error jika nama folder bukan UUID. | Gambar sumber bisa diganti setelah diproses. Hash di `capture_image` tidak lagi cocok dengan file-nya. | Pisahkan policy: `SELECT` dan `INSERT` saja untuk user. Hapus hanya oleh service role. Bandingkan sebagai teks. | Q-10 |
| F-15 | **`capture.status` bisa diubah klien ke nilai apa pun** (RLS mengizinkan update). | Klien yang salah bisa menandai capture `done` tanpa diproses. | Trigger penjaga transisi status (bagian 5.3). | Q-04 |
| F-16 | **Satu household bisa punya beberapa sesi belanja aktif.** Sesi yang kedaluwarsa juga tetap `ended_at IS NULL`. | Banner sesi (wireframe §5.6) menjadi ambigu. | `start_shopping_session` mengakhiri sesi aktif lain lebih dulu. Tidak perlu index baru. | Q-24 |

---

## 1. Arsitektur dan Pilihan Teknologi

### 1.1 Gambaran

```
 ┌──────────────── Klien (Next.js PWA, Tahap 5) ────────────────┐
 │  supabase-js + JWT user                                       │
 │   ├─ PostgREST: CRUD sederhana (tabel/view yang di-whitelist) │
 │   ├─ RPC: operasi bisnis (public.*, SECURITY INVOKER)         │
 │   ├─ Storage: unggah/baca gambar (bucket privat `captures`)   │
 │   └─ Auth: email OTP + Google (D-60)                          │
 └───────┬──────────────────────────────┬───────────────────────┘
         │ fetch                         │ fetch (hanya operasi bersecret)
         ▼                               ▼
 ┌──────────────── Supabase ───────────┐  ┌── Next.js Route Handler ──┐
 │ PostgREST ─┐                        │  │ POST /api/account/delete  │
 │ Storage   ─┼─> PostgreSQL           │  │ (service role, server-only)│
 │ Auth      ─┘    ├ public: tabel+RLS │  └────────────┬──────────────┘
 │                 ├ public: RPC/view  │               │
 │                 ├ app: job, config, │<──────────────┘
 │                 │  helper (privat)  │
 │                 └ pg_cron           │
 └──────────────▲──────────────────────┘
                │ koneksi Postgres langsung (service role) + LISTEN
 ┌──────────────┴──────── Worker (Node.js) ────────────────────────┐
 │ capture pipeline: claim → unduh gambar → Extractor (stub) →      │
 │   matching (SQL tier 1–3, AiMatcher stub tier 4) → apply (1 tx)  │
 │ job: purge_images, redact_ocr, delete_household, orphan sweep    │
 └──────────────────────────────────────────────────────────────────┘
```

### 1.2 Di mana API berjalan

| Opsi | Kelebihan | Kekurangan |
|---|---|---|
| **A. Langsung PostgREST + RPC** dari klien dengan JWT user | RLS menjadi satu-satunya mekanisme otorisasi. Tidak ada lapisan tengah yang bisa salah memakai service role. Latensi paling rendah (penting di toko, §9.3). Cocok untuk PWA offline (D-59): klien bisa mengulang request yang sama. Logika tulis di SQL berarti transaksi dan invariant berada di tempat yang sama. | Skema database menjadi kontrak publik. Logika bisnis ditulis dalam PL/pgSQL, yang lebih sulit di-unit-test dibanding TypeScript. Versioning API lebih sulit. |
| B. Next.js Route Handler / Server Action sebagai BFF | Kontrak API bebas dari bentuk skema. TypeScript di semua lapisan. | Setiap request melewati satu hop lagi. Server harus meneruskan JWT user dengan benar. Godaan memakai service role di server untuk "memudahkan" adalah risiko utama terhadap D-30 dan desain fisik §6.3. Logika transaksi tersebar antara TypeScript dan SQL. |
| C. Supabase Edge Functions (Deno) | Dekat dengan database, deploy satu paket dengan Supabase. | Runtime terpisah (Deno) dari Next.js dan worker. Ada cold start dan batas waktu eksekusi. Untuk CRUD, tidak memberi nilai tambah dibanding A. |

**Rekomendasi: A, dengan dua batasan.**

1. **Permukaan API dibatasi secara eksplisit.** Klien hanya boleh memakai RPC dan view yang tercantum di bagian 3, ditambah tabel yang ditandai "PostgREST langsung". Tabel lain tetap dilindungi RLS, tetapi bukan bagian dari kontrak. Dengan begitu, skema boleh berubah selama kontraknya tetap.
2. **Route Handler Next.js hanya untuk operasi yang butuh rahasia**: hapus akun (Admin API Auth). Di Tahap 6, endpoint Tanya juga di sini karena butuh API key Claude. Server Actions tidak dipakai untuk menulis data.

**Aturan RPC:**
- Default `SECURITY INVOKER`, sehingga RLS tetap berlaku di dalam fungsi. `SECURITY DEFINER` hanya jika fungsi harus menyentuh schema `app` atau tabel yang tidak boleh ditulis user. Fungsi semacam itu wajib memeriksa household secara eksplisit (pola `merge_product`).
- `set search_path = ''`, dan semua nama ditulis lengkap dengan schema.
- `REVOKE EXECUTE ... FROM public, anon` di setiap RPC (F-09).

### 1.3 Di mana worker berjalan

| Opsi | Kelebihan | Kekurangan |
|---|---|---|
| **A. Proses Node.js long-running** (container), koneksi Postgres langsung | Bisa memakai transaksi dan `FOR UPDATE SKIP LOCKED` secara langsung. Bisa `LISTEN/NOTIFY` untuk latensi rendah. Tanpa batas waktu (penting untuk struk multi-gambar dengan AI di Tahap 6). SDK Claude untuk Node tersedia. Bisa dijalankan dan diuji terhadap PostgreSQL biasa tanpa Supabase. | Satu komponen lagi yang harus di-deploy dan dipantau (Tahap 7). |
| B. Edge Function dipicu Database Webhook / pg_net | Tanpa server tambahan. | Ada batas waktu eksekusi. Tidak bisa memegang transaksi lintas langkah. Retry dan lease harus dibangun di atas HTTP. Sulit diuji tanpa Supabase. |
| C. Next.js (Vercel) cron / background | Satu deploy dengan web. | Fungsi serverless juga punya batas waktu. Pemrosesan antrean tidak cocok di sini. |

**Rekomendasi: A.** Kode pipeline ditulis sebagai modul yang tidak bergantung pada runtime (`apps/worker/src/pipeline`), dengan adapter untuk database dan penyimpanan. Jika nanti ingin pindah ke Edge Function, cukup adapternya yang berganti. Pilihan hosting (Fly, Render, Railway, VM) ditunda ke Tahap 7 (Q-17).

Catatan Supabase: `LISTEN` butuh koneksi sesi (port 5432 langsung atau *session pooler*). *Transaction pooler* (6543) tidak mendukung `LISTEN`. Worker juga selalu melakukan polling setiap 5 detik sebagai cadangan.

### 1.4 Penjadwalan job

| Job | Jenis | Dijalankan oleh | Jadwal |
|---|---|---|---|
| `app.process_summary_queue(500)` | SQL | pg_cron | tiap 10 detik |
| `app.enqueue_time_based_refresh()` | SQL | pg_cron | harian 17:05 UTC = 00:05 WIB (F-12) |
| `app.promote_aliases()` | SQL | pg_cron | harian 17:20 UTC |
| `app.run_sql_jobs(50)`: `recompute_unit_price`, `share_existing_prices` | SQL | pg_cron | tiap 1 menit |
| `app.reap_stale_runs()`: lease capture yang macet | SQL | pg_cron | tiap 1 menit |
| `app.enqueue_retention()`: gambar jatuh tempo, OCR yang perlu disamarkan, household tanpa anggota | SQL (enqueue saja) | pg_cron | harian 17:35 UTC |
| Pemrosesan capture | Storage + AI | worker | event (`NOTIFY`) + polling |
| `purge_images`, `redact_ocr`, `delete_household`, sapuan unggahan yatim | Storage / AI | worker | mengambil dari `app.job` |

**Kenapa dibagi dua:** pg_cron tetap berjalan walaupun worker mati, sehingga ringkasan harga (inti search) tidak ikut basi. Job yang butuh Storage atau AI tidak bisa dijalankan dari SQL tanpa `pg_net` dan rahasia di database, jadi job itu dikerjakan worker.

**Lingkungan lokal tanpa pg_cron** (PostgreSQL biasa + stub): migration pg_cron dilewati jika extension tidak ada. Worker punya mode `--dev-scheduler` yang memanggil fungsi SQL yang sama dengan interval yang sama. Test memanggil fungsinya secara langsung.

### 1.5 Struktur folder repo

```
PriceAtlas/
├─ PROJECT.md
├─ docs/                          # 02–05, wireframes/
├─ supabase/                      # proyek Supabase CLI
│  ├─ config.toml                 # auth: email OTP + Google, storage bucket
│  ├─ migrations/                 # SUMBER KEBENARAN skema (bagian 2)
│  └─ seed.sql                    # katalog contoh untuk dev (bukan seed produksi)
├─ db/
│  ├─ schema.sql                  # snapshot hasil generate dari migration (Q-25)
│  └─ tests/
│     ├─ run.sh                   # stub → migrations → smoke.sql → flows/*.sql
│     ├─ supabase_stub.sql        # + storage schema stub + default privileges ala Supabase
│     ├─ smoke.sql                # 43 test lama, TIDAK diubah
│     └─ flows/                   # test baru per alur (bagian 8)
├─ apps/
│  ├─ web/                        # Next.js. Tahap 4: scaffold + route handler hapus akun saja
│  │  ├─ app/api/account/delete/route.ts
│  │  └─ lib/supabase/{browser,server}.ts
│  └─ worker/
│     ├─ src/pipeline/            # claim, extract, match, apply (tanpa I/O langsung)
│     ├─ src/adapters/            # pg, supabase-storage, local-fs-storage
│     ├─ src/extractors/stub.ts   # CaptureExtractor stub (D-16 → Tahap 6)
│     ├─ src/jobs/                # purge_images, redact_ocr, delete_household
│     └─ test/
├─ packages/
│  ├─ contracts/                  # zod: input/output RPC, kode error, kontrak extra (X-10)
│  ├─ db-types/                   # hasil `supabase gen types typescript`
│  └─ ai-tools/                   # 6 tool (D-57): skema + handler → RPC
├─ .env.example
├─ package.json / pnpm-workspace.yaml
└─ .github/workflows/ci.yml       # harness SQL + test TS
```

Alasan `packages/contracts` terpisah: Tahap 5 (frontend), worker, dan tools AI memakai skema input/output yang sama. Satu definisi zod mencegah ketiganya menyimpang dari RPC.

---

## 2. Rencana Migration

### 2.1 Memecah `db/schema.sql`

| Opsi | Kelebihan | Kekurangan |
|---|---|---|
| **A. Satu migration baseline = `schema.sql` apa adanya**, lalu perubahan Tahap 4 sebagai migration terpisah | Kesetaraan dengan skema yang sudah disetujui mudah dibuktikan (isi file identik). 43 smoke test langsung berlaku. | File baseline besar (±1.270 baris). |
| B. Dipecah per bagian (tenancy, katalog, store, …) | Lebih mudah dibaca per bagian. | Ada ketergantungan urutan yang tersembunyi (mis. FK `barcode_assignment.store_id` ditambahkan setelah `store`). Risiko perbedaan kecil yang sulit terlihat. |

**Rekomendasi: A.** Urutan migration:

| # | File | Isi | Status keputusan |
|---|---|---|---|
| 0 | `20261020000000_baseline.sql` | Salinan persis `db/schema.sql` | Disetujui (Tahap 2) |
| 1 | `…0100_config_helpers.sql` | `app.config_numeric()`, kunci D-50 dan D-55 | D-50, D-55 + F-10 |
| 2 | `…0110_receipt_draft.sql` | D-49 | D-49 |
| 3 | `…0120_capture_item.sql` | D-48 | D-48 (rincian kolom: **⚑ Q-02**) |
| 4 | `…0130_share_public.sql` | D-51 | D-51 (perilaku update: **⚑ Q-08**) |
| 5 | `…0140_price_extra_contract.sql` | X-10 + D-52 | D-52 (kontrak X-10: **⚑ Q-07**) |
| 6 | `…0150_storage.sql` | Bucket `captures` + policy | Desain fisik §6.4 (pengetatan: **⚑ Q-10**) |
| 7 | `…0200_fix_merge_and_public_fact.sql` | F-01, F-02 | **⚑ Q-05, Q-06** |
| 8 | `…0210_receipt_derivation.sql` | F-05: trigger turunan dan konsistensi D-23 | **⚑ Q-03** |
| 9 | `…0220_pii_privileges.sql` | F-03, F-04, F-15 | **⚑ Q-04** |
| 10 | `…0230_hardening.sql` | F-06 (CHECK store/branch), F-07 (mata uang ringkasan) | **⚑ Q-09, Q-15** |
| 11 | `…0240_jobs.sql` | Jenis job baru + kunci config operasional | **⚑ Q-11** |
| 12 | `…0300_rpc_read.sql` | View dan RPC baca (bagian 3) | Kontrak 4a |
| 13 | `…0310_rpc_write.sql` | RPC tulis (bagian 3–4) | Kontrak 4a |
| 14 | `…0320_pipeline.sql` | Fungsi `app.*` untuk worker (bagian 5) | Kontrak 4a |
| 15 | `…0900_cron.sql` | `cron.schedule(...)`, dilewati jika pg_cron tidak ada | Kontrak 4a |

Migration 7–11 hanya diterapkan jika Q-terkait disetujui. Jika ditolak, file itu tidak dibuat dan dampaknya dicatat di bagian 9.

### 2.2 Perubahan yang sudah diputuskan (D-48 s/d D-52, D-55, X-10)

**D-50 dan D-55: kunci `app.config`**

```sql
create function app.config_numeric(p_key text) returns numeric
language sql stable set search_path = ''
as $$ select (value #>> '{}')::numeric from app.config where key = p_key $$;

insert into app.config (key, value, description) values
  ('auto_save_min_confidence', '0.90', 'Ambang auto-save D-12. Nilai final setelah uji OCR (D-16, D-50)'),
  ('near_best_threshold_pct',  '5',    'Batas "mendekati harga terbaik" di Cek harga rak dan sesi (D-55)');
```

**D-49: struk draft**

```sql
alter table public.receipt alter column store_id drop not null;
alter table public.receipt add constraint receipt_store_required
  check (status = 'draft' or store_id is not null);
alter table public.receipt add column field_confidence jsonb not null default '{}'::jsonb;
alter table public.receipt add constraint receipt_field_confidence_shape
  check (app.valid_confidence_map(field_confidence));
```

Kontrak `field_confidence`: objek dengan kunci opsional `store`, `branch`, `date`, `time`, `total`, `subtotal`. Nilainya angka 0..1. Kunci yang tidak ada berarti "tidak dinilai". `app.valid_confidence_map` menolak kunci lain dan nilai di luar 0..1.

Dampak ke objek lain:
- `receipt_fingerprint_idx` tetap dipakai. Draft tanpa toko tidak bisa dibandingkan sidik jarinya, dan ini diperiksa ulang saat konfirmasi (bagian 4.1).
- `propagate_receipt_header`: tidak berubah. Draft tanpa toko belum punya `price_record` (bagian 5.5), jadi tidak ada yang perlu dialirkan.

**D-48: `capture_item`**

Kolom yang disebut D-48: kandidat produk, harga terbaca, confidence, status, rujukan ke `price_record`. Rincian lengkap di bawah ini lebih banyak dari daftar itu, karena S-11 membutuhkannya. **⚑ Q-02** meminta persetujuan rincian ini.

```sql
create table public.capture_item (
  id                    uuid primary key default gen_random_uuid(),
  capture_id            uuid not null,
  household_id          uuid not null,
  position              smallint not null check (position >= 1),       -- "1/3" (S-11)
  image_position        smallint check (image_position >= 1),          -- gambar sumber
  region                jsonb,                                         -- crop {x,y,w,h} 0..1, opsional
  raw_text              text not null,                                 -- teks label / judul listing (calon alias)
  suggested_product_id  uuid references public.product (id),
  candidate_product_ids uuid[] not null default '{}',                  -- X-12, maks 5 (S-14)
  match_tier            text check (match_tier in ('barcode','alias','fuzzy','ai','manual')),
  match_confidence      numeric(4,3) check (match_confidence between 0 and 1),
  store_id              uuid references public.store (id),             -- lokasi terbaca per item (logo, platform)
  branch_id             uuid,
  seller_name           text,                                          -- marketplace: seller terbaca, belum jadi branch
  seller_ref            text,
  transaction_date      date not null,                                 -- default tanggal unggah (zona household), bisa diubah (D-60)
  currency              char(3) not null default 'IDR' check (currency ~ '^[A-Z]{3}$'),
  normal_price          numeric(14,2) check (normal_price >= 0),
  promo_price           numeric(14,2) check (promo_price >= 0),
  promo_min_qty         integer check (promo_min_qty >= 2),
  promo_valid_from      date,
  promo_valid_until     date,
  member_price          numeric(14,2) check (member_price >= 0),
  member_program_id     uuid references public.member_program (id),
  is_bundle             boolean not null default false,
  extra                 jsonb not null default '{}'::jsonb,            -- kontrak X-10 yang sama dengan price_record
  field_confidence      jsonb not null default '{}'::jsonb,            -- per field: product, price, date, store
  status                text not null default 'pending' check (status in ('pending','accepted','rejected')),
  price_record_id       uuid unique references public.price_record (id) on delete set null,
  decided_by            uuid references auth.users (id) on delete set null,
  decided_at            timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (capture_id, position),
  foreign key (capture_id, household_id) references public.capture (id, household_id) on delete cascade,
  foreign key (branch_id, store_id) references public.branch (id, store_id),
  check (store_id is not null or branch_id is null),                  -- F-06
  check (member_price is null or member_program_id is not null),
  check ((status = 'pending') = (decided_at is null)),
  check (cardinality(candidate_product_ids) <= 5)
);
create index capture_item_capture_idx on public.capture_item (capture_id, position);
create index capture_item_pending_idx on public.capture_item (household_id) where status = 'pending';
```

Yang menyertainya: RLS pola HOUSEHOLD (baca untuk anggota), GRANT `select, update` saja untuk `authenticated` (insert hanya oleh worker), trigger `touch_updated_at`, `enforce_ref_visibility('household_id', 'suggested_product_id:product', 'store_id:store', 'branch_id:branch')`, dan trigger yang menolak perubahan setelah `status <> 'pending'` kecuali oleh RPC konfirmasi (bagian 4.2).

Catatan: `candidate_product_ids` tidak bisa diberi FK. Worker hanya mengisinya dengan produk global atau produk milik household itu. RLS tetap menyembunyikan isi produk household lain, jadi yang bisa bocor paling jauh hanya UUID.

**D-51: opt-in berbagi publik**

```sql
alter table public.household add column share_prices_public boolean not null default false;

-- Perilaku default visibility record baru: mengikuti household (D-51).
create function app.default_visibility() returns trigger ...  -- BEFORE INSERT ON price_record
  -- new.visibility := case when (select share_prices_public from public.household
  --                               where id = new.household_id) then 'public' else 'private' end;
```

- **INSERT:** `visibility` selalu diisi trigger dari `household.share_prices_public`, dan nilai dari klien diabaikan. Smoke test tetap lulus, karena semua insert di sana memakai default `private` dan household belum opt-in.
- **UPDATE manual per record** (yang dilakukan smoke test "anon melihat 1 fakta publik"): tetap diizinkan. UI MVP tidak menyediakannya. Lihat **⚑ Q-08**.
- `share_prices_public` **tidak** bisa di-update langsung oleh klien (hak kolom). Perubahan hanya lewat RPC `set_share_prices_public` (bagian 4.6), karena mematikannya harus menarik fakta dalam transaksi yang sama.

**D-52 dan X-10: kontrak `price_record.extra`**

Kontrak yang sama dipakai di `capture_item.extra`. **⚑ Q-07.**

| Kunci | Tipe | Arti | Sumber | Ikut harga efektif? |
|---|---|---|---|---|
| `shipping_fee` | number ≥ 0 | Ongkir (D-36) | marketplace | Tidak |
| `shop_voucher` | number ≥ 0 | Voucher toko/platform di listing | marketplace | Tidak |
| `cashback` | number ≥ 0 | Cashback (D-14) | marketplace, label | Tidak |
| `points` | number ≥ 0 | Poin (D-14) | marketplace, label | Tidak |
| `listing_title` | string ≤ 500 | Judul listing apa adanya | marketplace | — |
| `listing_url` | string ≤ 2000, `https://` | URL listing | marketplace | — |
| `member_note` | string ≤ 200 | Harga member dari program yang tidak ada di katalog, mis. `"Alfagift Rp17.900"` (D-52) | label, marketplace | Tidak |
| `member_eligible` | boolean | Snapshot: apakah harga member berlaku untuk household saat record dibuat (F-11, D-26, D-41) | observasi dengan `member_price` | Menentukan saat koreksi |
| `member_hint` | object `{program_id?: uuid, text: string}` | Struk memuat diskon bertanda member (U-21) | struk | Tidak |
| `note` | string ≤ 500 | Catatan bebas user | semua | — |

Semua nominal memakai mata uang record. Ditegakkan dengan `CHECK (app.valid_price_extra(extra))`, yang **menolak kunci yang tidak dikenal**. Default `'{}'` tetap valid, sehingga smoke test tidak terpengaruh.

### 2.3 Perubahan yang perlu persetujuan (ringkas)

| Migration | Isi | Q |
|---|---|---|
| `0200` | `merge_product`: barcode privat tidak dipindah ke produk global (F-01). `sync_public_fact`: bagian hapus dipindah ke `BEFORE DELETE` (F-02). `app.detach_public_facts(household)` untuk hapus akun. | Q-05, Q-06 |
| `0210` | `app.derive_receipt_price(line_id)`, trigger `receipt_line_derive` (AFTER INSERT/UPDATE/DELETE), dan trigger konsistensi `price_record_receipt_guard` (bagian 4.3) | Q-03 |
| `0220` | Hak kolom `receipt.pii`, `processing_run.raw_*`, dan update `receipt` hanya untuk kolom header. `audit_row` membuang `pii`. Trigger transisi `capture.status`. GRANT `processing_run` menjadi select saja. | Q-04 |
| `0230` | `CHECK (store_id is not null or branch_id is null)` di `receipt` dan `capture`. `refresh_price_summary` menyaring `currency = household.default_currency`. | Q-09, Q-15 |
| `0240` | `app.job.kind` ditambah `delete_household`, `share_existing_prices`, `purge_storage_paths`. Kunci config operasional (bagian 5.6). | Q-11 |

### 2.4 Jaminan 43 smoke test tetap lulus

1. **`db/tests/smoke.sql` tidak diubah sama sekali.** CI memeriksa hash file ini.
2. `run.sh` diubah: setelah stub, jalankan **semua migration secara berurutan** (bukan `schema.sql`), lalu `smoke.sql`, lalu `flows/*.sql`.
3. **Uji kesetaraan baseline:** CI membangun dua database, yaitu (a) stub + `schema.sql` lama (disimpan di `db/tests/fixtures/schema-2b.sql`) dan (b) stub + migration baseline saja. Lalu `pg_dump --schema-only` keduanya harus identik.
4. Setiap perubahan Tahap 4 sudah diperiksa terhadap isi smoke test:

| Perubahan | Kenapa smoke test tetap lulus |
|---|---|
| D-49 store NULL saat draft | Smoke test selalu mengisi store. Struknya `confirmed`. |
| D-51 visibility dari household | Insert di smoke test memakai default `private`. Update manual ke `public` tetap diizinkan (Q-08). |
| X-10 CHECK `extra` | Smoke test tidak mengisi `extra`. Default `{}` valid. |
| F-02 `BEFORE DELETE` | Smoke test opt-out lewat update, bukan delete. Tetap menghapus fakta. |
| F-05 trigger konsistensi | Record struk di smoke test (2 × 19.500, diskon −2.000 → 18.500 promo) **sama persis** dengan hasil turunan. Diskon dimasukkan sebelum record dibuat. Koreksi tanggal header mengalir lewat trigger lama. |
| F-03 hak kolom `pii` | Smoke test memakai `count(*)` dan `update ... where id`. Keduanya tetap jalan dengan hak per kolom. *Terverifikasi: `count(*)` lulus setelah `select` tabel dicabut dan diganti hak per kolom.* Jumlah entri audit tetap 1. |
| F-01 merge barcode | Produk privat yang di-merge di smoke test tidak punya barcode. |
| F-07 mata uang ringkasan | Semua record smoke test memakai IDR = default household. |
| `merge_product` | Tanda tangan `(uuid, uuid)` tetap. Tidak ada parameter wajib baru. |

5. Stub ditambah dengan (a) schema `storage` minimal (`buckets`, `objects`, `foldername()`), dan (b) `ALTER DEFAULT PRIVILEGES` yang meniru Supabase. Penambahan ini tidak memengaruhi smoke test, karena baseline mencabut semua hak di akhir.

### 2.5 Test baru

Daftar per file ada di bagian 8.2. Ringkasnya: perubahan skema D-48 s/d D-52, X-10, turunan struk (D-23), konfirmasi struk dan observasi, koreksi, merge/split, publik, pipeline capture, RPC baca (perbaikan §9), hapus akun, Storage, RLS lintas household (otomatis untuk semua tabel), dan inventaris hak akses.

---

## 3. Kontrak API per Layar

### 3.1 Konvensi

**Transport**

| Jenis | Cara panggil | Otorisasi |
|---|---|---|
| **REST** | PostgREST tabel/view, `supabase.from(...)` | JWT user → RLS + GRANT |
| **RPC** | `supabase.rpc('nama', {...})` → `POST /rest/v1/rpc/nama` | JWT user. Fungsi `SECURITY INVOKER` kecuali disebut lain |
| **Storage** | `supabase.storage.from('captures')` | JWT user → policy `storage.objects` |
| **Route** | `fetch('/api/...')` di Next.js | Cookie sesi Supabase diverifikasi di server |

**Konkurensi optimistik:** RPC koreksi menerima `p_expected_updated_at`. Jika nilainya berbeda dengan `updated_at` di baris, RPC menolak dengan `STALE_WRITE`. REST `PATCH` memakai filter `updated_at=eq.<nilai>`. Jika 0 baris berubah, klien memperlakukannya sebagai konflik.

**Idempotensi:** semua *create* memakai UUID yang dibuat klien (D-59), sehingga pengulangan request menghasilkan konflik PK yang diperlakukan sebagai sukses. RPC tulis bersifat idempoten berdasarkan keadaan (mengulang konfirmasi yang sudah selesai mengembalikan hasil yang sama). Rinciannya di bagian 4.

**Format error.** RPC memakai `raise exception using errcode = 'PTnnn', message = '<KODE>', detail = '<json>', hint = '<pesan Indonesia>'`. PostgREST memetakan SQLSTATE `PTnnn` ke HTTP `nnn`. Error bawaan: `42501` (RLS/hak) → 403, `23505` → 409, `23514` / `23503` → 400.

| Kode | HTTP | Arti |
|---|---|---|
| `NOT_FOUND` | 404 | Tidak ada, atau tidak terlihat oleh user (RLS). Keduanya sengaja tidak dibedakan. |
| `STALE_WRITE` | 409 | `p_expected_updated_at` tidak cocok |
| `INVALID_STATE` | 409 | Status tidak mengizinkan aksi ini (mis. konfirmasi struk `discarded`) |
| `INVALID_TRANSITION` | 409 | Transisi `capture.status` tidak sah |
| `DUPLICATE_DECISION_REQUIRED` | 409 | Struk dicurigai duplikat, dan user belum memilih (D-20) |
| `RECEIPT_STORE_REQUIRED` | 422 | Konfirmasi struk tanpa toko (D-49) |
| `UNDECIDED_LINES` | 422 | Masih ada baris produk tanpa keputusan |
| `STORE_REQUIRED` | 422 | Observasi tanpa toko (D-28) |
| `NO_APPLICABLE_PRICE` | 422 | Observasi tidak punya satu pun harga yang berlaku (Q-19) |
| `USE_RECEIPT_LINE` | 422 | Mengubah angka record struk langsung (D-23). Harus lewat `correct_receipt_line`. |
| `RECEIPT_DERIVED_FIELD` | 422 | Ditolak trigger konsistensi D-23 |
| `INVALID_EXTRA` | 422 | `extra` melanggar kontrak X-10 |
| `CAPTURE_IMAGES_MISSING` | 422 | File belum ada di Storage saat `submit_capture` |
| `BRANCH_CLOSED` | 422 | Memulai sesi di cabang tutup (wireframe S-12) |
| `SESSION_NOT_ACTIVE` | 409 | Perpanjang/akhiri sesi yang sudah berakhir |
| `RECORDS_NOT_OWNED` | 403 | Sebagian `record_id` bukan milik household |
| `MERGE_FORBIDDEN` | 403 | Sumber merge adalah produk global (D-30). Memakai `42501` dari `merge_product`. |
| `REAUTH_REQUIRED` | 401 | Hapus akun tanpa login ulang yang baru |

### 3.2 Katalog RPC dan view

Bentuk data yang dipakai berulang:

**`ProductCard`** (S-01, S-02, S-14, cache offline):
```
product: { id, name, variant, sale_mode, pack_count, content_size, content_unit,
           dimension, base_unit ('g'|'ml'|'pcs'|'m'), is_private, brand_name, category_name }
group:   { id, name, best_by_dimension: { unit_price, product_id } } | null   -- "Paling hemat per gram"
summary: { record_count, last_transaction_date, last_effective_price, last_unit_price,
           best_90d:  PricePoint | null,  best_all: PricePoint,
           trend_direction, trend_pct, refreshed_at } | null                     -- null = belum ada data
hints:   { member_not_counted: { member_price, program_name, store_name } | null,  -- X-07
           bundle_only_count: int }
PricePoint = { record_id, effective_price, unit_price, price_basis, member_program_name,
               date, store: {id, name, channel, is_private}, branch: {id, name, status} | null }
```

**View `price_record_view`** (`security_invoker = true`): semua kolom `price_record` ditambah `store_name`, `store_channel`, `branch_name`, `branch_status`, `member_program_name`, `normal_unit_price` (ƒ `normal_price ÷ ukuran dasar`, D-33), `member_not_counted` (ƒ `member_price IS NOT NULL AND price_basis <> 'member'`), dan `receipt_id`.

| # | RPC / view | Input | Output | Catatan |
|---|---|---|---|---|
| R1 | `get_my_context()` | — | `{ user_id, display_name, household: {id, name, default_currency, timezone, share_prices_public}, role, program_ids[] }` | Dipanggil sekali setelah login |
| R2 | `get_client_config()` | — | `{ best_price_window_days, trend_window_days, trend_min_records_per_window, trend_flat_threshold_pct, auto_save_min_confidence, near_best_threshold_pct, session_extend_hours, image_retention_months }` | DEFINER, hanya kunci whitelist dari `app.config` |
| R3 | `search_products(p_query text, p_limit int = 30)` | kata kunci ≥ 2 huruf | `ProductCard[]` + `match_score` | §3.4. D-53 |
| R4 | `get_product_cards(p_ids uuid[])` | ≤ 50 id | `ProductCard[]` | "Baru dicek" (S-01), mengikuti `merged_into_id` |
| R5 | `get_offline_cache(p_viewed_ids uuid[], p_top int = 50)` | — | `ProductCard[]` | D-60: produk yang pernah dibuka + 50 data terbanyak |
| R6 | `find_product_by_barcode(p_code text, p_store_id uuid = null)` | kode GTIN/PLU | `{ product_id, via_merge boolean } \| null` | D-58. Berlaku pada `current_date` (zona household) |
| R7 | `get_product_detail(p_product_id uuid)` | — | `{ redirect_to?: uuid, card: ProductCard, last_record: {store, branch, date}, trend_windows: {cur_n, prev_n, cur_avg, prev_avg}, group_sizes_count }` | X-06 lewat query. `redirect_to` jika `merged` |
| R8 | `price_history(p_product_id, p_include_void bool = false, p_store_id uuid = null, p_limit int = 50, p_before_date date = null, p_before_id uuid = null)` | cursor | `price_record_view[]` | S-03 histori, S-05 → S-03 filter toko |
| R9 | `price_chart(p_product_id, p_normal_only bool = false)` | — | `[{ date, unit_price, price_basis, record_id }]` | Aktif, non-bundle (D-08, D-33) |
| R10 | `price_trend(p_product_id, p_normal_only bool = false)` | — | `{ cur_avg, cur_n, prev_avg, prev_n, pct, direction, label: 'vs 30 hari sebelumnya', record_count, last_date }` | D-54. Dipakai juga oleh tool AI |
| R11 | `compare_sizes(p_group_id uuid, p_window text = '90d')` | `'90d' \| 'all'` | `[{ product, dimension, currency, unit_price, effective_price, per_pack_price, store, branch, date, last_transaction_date, rank, pct_vs_best, has_data }]` | §3.4 |
| R12 | `where_cheaper(p_product_id uuid = null, p_group_id uuid = null, p_window_days int = 90)` | salah satu id. `p_window_days` null = sepanjang masa | `[{ dimension, currency, store, branch, successor_branch, min_unit_price, avg_unit_price, n, last_date, is_online }]` | §3.4. F-08 |
| R13 | `list_captures(p_limit int = 30, p_before timestamptz = null, p_kind text = null)` | — | `[{ id, kind, status, store_name, branch_name, date, date_is_upload, needs_check_count, saved_count, error_message, attempts }]` | S-08 |
| R14 | `get_capture(p_capture_id)` | — | `{ capture, images: [{position, storage_path, purged_at}], runs: [{status, started_at, finished_at, error_message}], receipt_id?, saved_records: [...] }` | Tanpa kolom `raw_*` |
| R15 | `get_receipt(p_receipt_id)` | — | `{ header (tanpa pii), field_confidence, uploaded_at, images, totals: {lines_sum, total_amount, diff}, duplicate: {receipt_id, store, date, total} \| null, lines: [{ ..., attached: [diskon/void], suggestion: ProductCard-lite, record: price_record_view \| null, needs_check }], adjustments[], member_hint?, membership_known }` | S-10 |
| R16 | `get_capture_items(p_capture_id)` | — | `[{ ...capture_item, suggestion, candidates[], computed: {effective_price, price_basis, member_eligible, reason}, needs_check }]` | S-11. `computed` dihitung **live** dengan keanggotaan saat ini (D-26) |
| R17 | `recent_locations(p_limit int = 10)` | — | `[{ store, branch \| null, last_used }]` | S-12 "Terakhir dipakai" |
| R18 | `get_active_session()` | — | `{ session: {id, started_at, expires_at}, store, branch, labels: [{capture_id, status, product, effective_price, price_basis, vs_best_pct, vs_last_pct}] } \| null` | S-13, banner. Aktif = `ended_at IS NULL AND expires_at > now()` |
| R19 | `merge_product_preview(p_from uuid, p_into uuid)` | — | `{ can_merge, reason?, counts: {price_records, aliases, barcodes, barcodes_kept}, size_mismatch, dimension_mismatch, from, into }` | S-17. U-16 |
| R20 | `price_record_detail(p_id uuid)` | — | `{ record: price_record_view, receipt_line?, receipt_header?, image: {storage_path, position, purged_at} \| null, history: audit_log[] }` | S-16 |
| R21 | `get_my_programs()` | — | `[{ program_id, program_name, store, status, is_member }]` | S-19b, S-00c |

| # | RPC tulis | Bagian |
|---|---|---|
| W1 | `submit_capture(p_capture_id, p_kind, p_images jsonb, p_shopping_session_id = null, p_store_id = null, p_branch_id = null)` | 5.2 |
| W2 | `retry_capture(p_capture_id)` | 5.4 |
| W3 | `delete_capture(p_capture_id)` | 5.4 |
| W4 | `confirm_receipt(p_receipt_id, p_lines jsonb, p_duplicate_decision text = null)` | 4.1 |
| W5 | `confirm_capture_items(p_capture_id, p_items jsonb)` | 4.2 |
| W6 | `correct_price_record(p_id, p_patch jsonb, p_expected_updated_at, p_update_alias bool = false)` | 4.3 |
| W7 | `correct_receipt_line(p_line_id, p_patch jsonb, p_expected_updated_at)` | 4.3 |
| W8 | `create_private_product(p_product jsonb)` | 3.3 S-15 |
| W9 | `move_price_records(p_record_ids uuid[], p_target_product_id, p_alias jsonb = null)` | 4.5 |
| W10 | `merge_product(p_from, p_into)` *(sudah ada)* | 4.4 |
| W11 | `start_shopping_session(p_session_id, p_branch_id)` | 3.3 S-12 |
| W12 | `extend_shopping_session(p_session_id)` | 3.3 S-13 |
| W13 | `end_shopping_session(p_session_id)` | 3.3 S-13 |
| W14 | `set_share_prices_public(p_enabled bool)` | 4.6 |
| W15 | `share_existing_prices()` | 4.6 |
| W16 | `set_program_membership(p_program_id, p_member bool)` | 3.3 S-19b |
| W17 | `create_private_store(p_store jsonb)` / `create_private_branch(p_branch jsonb)` | 3.3 S-12 |
| W18 | `update_capture_item(p_item_id, p_patch jsonb, p_expected_updated_at)` | 4.2 |
| Route | `POST /api/account/delete` | 7.6 |

**REST langsung** (bagian dari kontrak): `profile` (select/update `display_name`), `receipt` (PATCH kolom header saja, dengan filter `updated_at`), `product` (PATCH produk privat sendiri), `member_program` (select), `store` dan `branch` (select dan search), `audit_log` (select), `household_program_membership` (select). Semua tulisan lain lewat RPC.

### 3.3 Kontrak per layar

Kolom **Otorisasi** menyebut syarat di atas RLS dasar ("anggota household"). Semua layar kecuali S-00a/b butuh JWT.

#### S-00a Masuk · S-00b Selamat datang · S-00c Program member (onboarding)

| Operasi | Jenis | Input → Output | Error | Otorisasi |
|---|---|---|---|---|
| Kirim OTP | Auth `signInWithOtp({email})` | email → — | rate limit Auth | publik |
| Verifikasi OTP | Auth `verifyOtp` | email, kode → sesi | `otp_expired`, `invalid` | publik |
| Google | Auth `signInWithOAuth('google')` | — → redirect | — | publik |
| Setelah login | R1 `get_my_context` | — → konteks | — | JWT |
| S-00b | — (status "sudah dilihat" 💾) | — | — | — |
| S-00c | R21 + W16 | lihat S-19b | — | — |

Signup memicu `app.handle_new_user` (sudah ada), yang membuat profile, household, dan membership owner. Konfigurasi provider ada di `supabase/config.toml`. Kunci Google diisi lewat env, tidak masuk repo.

#### S-01 Beranda / Cari

| Elemen | Operasi | Input → Output | Catatan |
|---|---|---|---|
| Baru dicek | R4 `get_product_cards(ids 💾)` | ≤ 5 id → `ProductCard[]` | |
| Harga baru masuk | REST `price_record_view?select=id,product_id,transaction_date,effective_price,price_basis,store_name&status=eq.active&order=transaction_date.desc,created_at.desc&limit=10` + R4 untuk nama produk | — | `price_record_recent_idx` |
| Badge "perlu dicek" | REST `capture?status=eq.needs_confirmation&select=id` dengan `head=true, count=exact` | — → angka | |
| Banner sesi | R18 `get_active_session` | — → sesi \| null | |
| Keadaan kosong | ƒ R1 + jumlah record 0 | — | |
| Offline | R5 (dipanggil periodik saat online, disimpan 💾) | — | D-60 |

#### S-02 Hasil cari

| Operasi | Jenis | Input → Output | Error | Otorisasi |
|---|---|---|---|---|
| Search | R3 `search_products` | `p_query` → `ProductCard[]`, dikelompokkan di klien per `group.id` | `22023` jika `< 2` huruf | RLS: produk global + privat sendiri. Ringkasan sendiri. |
| Scan barcode | R6 `find_product_by_barcode` | kode → id \| null (null → S-14) | — | sama |

Semua keadaan di wireframe S-02 bisa dibentuk dari `ProductCard`: `summary = null` (produk ada, histori kosong), `best_90d = null` (hanya all-time), `trend_direction = null` (tren belum cukup), `branch = null`, `is_private`, `hints.*`, dan `store.channel = 'online'`.

#### S-03 Detail produk

| Elemen | Operasi |
|---|---|
| Header + ringkasan + toko harga terakhir | R7 `get_product_detail`. Jika `redirect_to` terisi, klien pindah ke produk itu dan menampilkan toast. |
| Grafik + toggle "hanya normal" | R9 `price_chart` |
| Lebih hemat di mana (3 teratas) | R12 `where_cheaper(p_product_id, p_window_days => 90)`, klien mengambil 3 teratas |
| Ukuran lain | R11 `compare_sizes(group_id, '90d')` |
| Histori + "tampilkan yang dibatalkan" | R8 `price_history` |
| Menu ⋯ | ƒ dari `card.product.is_private` (Edit/Gabungkan/Hapus untuk privat; Pisahkan untuk semua) |
| Hapus produk privat | REST `PATCH product?id=eq.X` `{status: 'archived'}`. Record tetap ada dan tetap terlihat di histori. |

Error: `NOT_FOUND` (produk tidak terlihat). Otorisasi: RLS.

#### S-03b Cek harga rak

Tidak ada panggilan tulis (D-55). Data diambil dari R7 dan R11 yang sudah dimuat. `near_best_threshold_pct` dari R2. Perhitungan harga per satuan dilakukan di klien dengan rumus yang sama seperti `app.compute_unit_price`. Rumusnya juga dimuat di `packages/contracts` (`unitPrice(product, price)`), dengan test kesetaraan terhadap fungsi SQL.

#### S-04 Bandingkan ukuran

R11 `compare_sizes(p_group_id, p_window)`. Peringkat dihitung **per dimensi dan mata uang**. SKU tanpa data diberi `has_data = false`, ditaruh paling bawah, dan `rank = null`. `last_transaction_date` dipakai untuk catatan shrinkflation. `per_pack_price = effective_price ÷ pack_count` untuk multipack. Error: `NOT_FOUND`.

#### S-05 Lebih hemat di mana

R12 `where_cheaper`, dengan toggle produk/group dan 90 hari/sepanjang masa. Baris dengan `n = 1` tetap ikut urutan (D-60). `successor_branch` diisi jika cabang tutup. Tap baris → S-03 dengan `R8(p_store_id)`.

#### S-06 Pilih jenis foto · S-07 Kamera · S-07b Galeri

| Operasi | Jenis | Catatan |
|---|---|---|
| Konteks sesi | R18 | Urutan tombol (U-08) |
| Cek hash duplikat sebelum unggah | REST `capture_image?select=capture_id,created_at&sha256=in.(...)` | `capture_image_hash_idx`. Dialog "sudah pernah diunggah" (D-20, U-10) |
| Unggah file | Storage `upload('{household_id}/{capture_id}/{position}.{ext}', file, {upsert: false})` | Bagian 5.2 |
| Daftarkan capture | W1 `submit_capture` | Setelah semua file terunggah |
| Scan barcode (mode U-22) | R6 | |

#### S-08 Unggahan · S-09 Detail unggahan

| Operasi | Jenis | Error |
|---|---|---|
| Daftar | R13 `list_captures` | — |
| Detail | R14 `get_capture` | `NOT_FOUND` |
| Gambar | Storage `createSignedUrl(path, 300)` | `purged_at` terisi → tampilkan "Gambar dihapus" |
| Ulangi | W2 `retry_capture` | `INVALID_TRANSITION` jika bukan `failed` |
| Hapus | W3 `delete_capture` | `INVALID_STATE` jika `processing` / `needs_confirmation` / `done` |

Status diperbarui dengan polling R13 setiap 5 detik selama masih ada capture `uploaded`/`processing`, dan saat app kembali fokus. Realtime: Q-26.

#### S-10 Konfirmasi / detail struk

| Operasi | Jenis | Input → Output | Error |
|---|---|---|---|
| Muat | R15 `get_receipt` | id → payload | `NOT_FOUND` |
| Edit header | REST `PATCH receipt?id=eq.X&updated_at=eq.T` (kolom: `store_id, branch_id, transaction_date, transaction_time, total_amount, subtotal_amount, payment_method`) | — | 0 baris → konflik. `23503` jika cabang bukan milik toko. |
| Tandai member (U-21) | W16 | — | — |
| Simpan | W4 `confirm_receipt` | lihat 4.1 → `{ saved_count, cheaper_than_best_count, receipt_status }` | `RECEIPT_STORE_REQUIRED`, `DUPLICATE_DECISION_REQUIRED`, `UNDECIDED_LINES`, `INVALID_STATE` |
| Mode tersimpan: koreksi baris | W7 `correct_receipt_line` | 4.3 | `STALE_WRITE` |

`p_lines` adalah array berisi `{ line_id, action: 'accept'|'replace'|'non_product'|'skip', product_id?, is_bundle? }`. "Benarkan semua saran" = semua `accept`.

#### S-11 Konfirmasi label & screenshot

| Operasi | Jenis | Input → Output | Error |
|---|---|---|---|
| Muat | R16 `get_capture_items` | capture id → item + `computed` | `NOT_FOUND` |
| Edit item (harga, tanggal, lokasi, bundle, produk) | W18 `update_capture_item` | patch → item | `STALE_WRITE`, `INVALID_STATE` (bukan pending), `INVALID_EXTRA` |
| "Saya member" | W16, lalu R16 dimuat ulang | — | — |
| Simpan | W5 `confirm_capture_items` | 4.2 → `{ saved: [{item_id, price_record_id}], remaining_pending }` | `STORE_REQUIRED`, `NO_APPLICABLE_PRICE` |

#### S-12 Pilih toko & cabang

| Operasi | Jenis |
|---|---|
| Terakhir dipakai | R17 |
| Daftar/cari toko | REST `store?select=id,name,channel,household_id&status=eq.active&normalized_name=ilike.*q*&order=name` |
| Daftar cabang | REST `branch?store_id=eq.X&order=status,name` (cabang tutup di bawah) |
| Toko/cabang baru (privat, D-29) | W17. ID dari klien. `household_id` diisi server dari konteks, bukan dari klien. |
| Mode sesi | W11 `start_shopping_session` → `BRANCH_CLOSED` |
| Mode manual | Hanya mengisi state klien. Dikirim lewat W1 (`p_store_id`, `p_branch_id`) atau W18. |

#### S-13 Sesi belanja

| Operasi | Jenis | Error |
|---|---|---|
| Muat | R18 | — |
| Perpanjang +2 jam (D-60) | W12 → `expires_at = expires_at + 2h` | `SESSION_NOT_ACTIVE` |
| Akhiri | W13 → `ended_at = now()` | idempoten: sesi yang sudah berakhir → sukses |
| Kedaluwarsa (D-43) | ƒ `expires_at <= now()`. Tidak ada job, karena status "aktif" dihitung saat query. | — |

`start_shopping_session(p_session_id, p_branch_id)`: memvalidasi `branch.status = 'open'`, lalu menutup sesi aktif lain milik household (`ended_at = least(now(), expires_at)`), lalu insert. Mengulang dengan `p_session_id` yang sama mengembalikan sesi yang sudah ada (F-16).

#### S-14 Pilih produk

R3 `search_products` (prefill dari `raw_text` / judul listing), ditambah saran dan kandidat dari R15/R16. Mode target merge: R3, lalu klien menyaring produk sumber. RLS sudah membatasi ke produk global dan privat sendiri. Peringatan beda ukuran dihitung di klien (bukan blokir).

#### S-15 Produk baru

| Operasi | Jenis | Input → Output | Error |
|---|---|---|---|
| Cek produk serupa | R3 | nama → kandidat | — |
| Buat | W8 `create_private_product` | `{ id, name, variant, brand: {id} \| {new: name}, group: {id} \| {new: name} \| 'same_as_name', category_id, sale_mode, pack_count, content_size, content_unit, barcodes: [{code, code_type, store_id?}] }` → `ProductCard` | `23514` (ukuran wajib untuk kemasan), `23P01` (barcode tumpang tindih), `23505` (brand dobel → pakai yang ada) |
| Edit (privat) | REST `PATCH product?id=eq.X&updated_at=eq.T` | — | Jika ukuran berubah, trigger membuat job `recompute_unit_price` (sudah ada) |

W8 atomik: brand baru → group baru → produk → barcode, dalam satu transaksi. Semua dibuat dengan `household_id` milik user (D-29).

#### S-16 Detail & koreksi harga

| Operasi | Jenis | Error |
|---|---|---|
| Muat | R20 `price_record_detail` | `NOT_FOUND` |
| Ganti produk / bundle / batalkan / extra | W6 `correct_price_record` | `STALE_WRITE`, `INVALID_EXTRA` |
| Ubah harga observasi, tanggal, lokasi | W6 | `NO_APPLICABLE_PRICE` |
| Ubah harga struk | W7 `correct_receipt_line` (W6 menolak dengan `USE_RECEIPT_LINE`) | `STALE_WRITE` |
| Ubah tanggal/toko struk | REST PATCH header `receipt` (lihat S-10) | — |

Setelah simpan, klien menampilkan "Ringkasan diperbarui dalam beberapa detik", lalu memantau `price_summary.refreshed_at` lewat R7.

#### S-17 Gabungkan produk

| Operasi | Jenis | Error |
|---|---|---|
| Pratinjau | R19 `merge_product_preview` | `NOT_FOUND` |
| Gabungkan | W10 `merge_product` | `42501` (produk global, D-30), `P0001` (target tidak aktif / beda household) |
| Pindahkan ke group | REST `PATCH product?id=eq.X` `{product_group_id}` (produk privat) | `23503` (group tidak terlihat) |

#### S-18 Pisahkan produk

W8 (produk baru) atau R3 (produk lain), lalu R8 untuk daftar record, lalu W9 `move_price_records`. Bagian 4.5.

#### S-19 Saya · S-19b Program member · S-19c Berbagi publik

| Operasi | Jenis | Error |
|---|---|---|
| Profil | REST `profile` select/PATCH `display_name` | — |
| Program member | R21, W16 `set_program_membership` | `INVALID_STATE` jika program `discontinued` dan `p_member = true` |
| Berbagi publik | W14 `set_share_prices_public` → `{ enabled, withdrawn_count }` | — |
| Bagikan data lama | W15 `share_existing_prices` → `{ job_id, eligible_count }` | `INVALID_STATE` jika opt-in mati |
| Hapus akun | Route `POST /api/account/delete` | `REAUTH_REQUIRED` |
| Keluar | Auth `signOut` | — |

Semua operasi household butuh peran `owner` (MVP: selalu owner). RPC W14 dan W15 memeriksa `role = 'owner'`.

#### S-20 Tanya

Tidak ada endpoint di Tahap 4. Tools didefinisikan di `packages/ai-tools` (bagian 6). Route `POST /api/ask` dibuat di Tahap 6.

### 3.4 Query inti yang diperbaiki (dari desain fisik §9 + wireframe §8.4)

**Search (§9 no. 1 → R3, D-53, F-13).** Brand ikut dicari lewat join. Produk tanpa histori ikut tampil. Produk merged/archived disaring.

```sql
with q as (select app.normalize_text(p_query) as t),
brand_hit as (
  select b.id from public.brand b, q
   where b.status = 'active' and q.t operator(extensions.<%) b.normalized_name),
hit as (
  select p.id,
         extensions.word_similarity(q.t, p.search_text || ' ' || coalesce(b.normalized_name, '')) as score
    from public.product p
    left join public.brand b on b.id = p.brand_id
    cross join q
   where p.status = 'active'                                   -- merged/archived disaring
     and (q.t operator(extensions.<%) p.search_text            -- index GIN trigram yang ada
          or p.brand_id in (select id from brand_hit)))
select c.*, h.score as match_score
  from hit h
  cross join lateral app.product_card(h.id) c                  -- LEFT JOIN price_summary di dalamnya
 order by (c.summary is not null) desc,                        -- yang punya data dulu (D-53)
          h.score desc, (c.product).name
 limit least(p_limit, 50);
```

**Tren (§9 no. 3 → R10, D-54).** Jendela 30 hari vs 30 hari sebelumnya, bukan bulan kalender.

```sql
select avg(u) filter (where transaction_date >  v_today - v_w)                                  as cur_avg,
       count(*) filter (where transaction_date >  v_today - v_w)                                as cur_n,
       avg(u) filter (where transaction_date <= v_today - v_w and transaction_date > v_today - 2*v_w) as prev_avg,
       count(*) filter (where transaction_date <= v_today - v_w and transaction_date > v_today - 2*v_w) as prev_n
  from (select transaction_date,
               case when p_normal_only then normal_unit_price else unit_price end as u
          from public.price_record_view
         where product_id = p_product_id and status = 'active' and not is_bundle
           and currency = v_currency) r
 where u is not null;
-- direction: sama dengan refresh_price_summary (minimal data per jendela dan ambang stabil dari app.config)
```

`v_today` = tanggal hari ini di `household.timezone` (F-12). `v_w` = `trend_window_days`.

**Bandingkan ukuran (§9 no. 5 → R11).** Peringkat per dimensi dan mata uang. Produk tanpa data diletakkan di bawah.

```sql
select p.*, u.dimension, s.*,
       rank() over (partition by u.dimension order by s.best_90d_unit_price) as rank
  from public.product p
  join public.unit u on u.code = p.content_unit
  left join public.price_summary s on s.product_id = p.id
 where p.product_group_id = p_group_id and p.status = 'active'
 order by u.dimension, (s.best_90d_unit_price is null), s.best_90d_unit_price;
```

Dengan F-07, satu ringkasan hanya berisi satu mata uang (mata uang default household). Produk yang hanya punya record dalam mata uang lain muncul sebagai `has_data = false` dengan catatan "ada data mata uang lain".

**Lebih hemat di mana (§9 no. 6 → R12, F-08, wireframe §8.4 no. 2).** Disaring per dimensi dan mata uang, dikelompokkan per id.

```sql
select u.dimension, pr.currency, pr.store_id, pr.branch_id,
       min(pr.unit_price) as min_unit_price, avg(pr.unit_price) as avg_unit_price,
       count(*) as n, max(pr.transaction_date) as last_date
  from public.price_record pr
  join public.product p on p.id = pr.product_id
  join public.unit u    on u.code = p.content_unit
 where (p_product_id is null or pr.product_id = p_product_id)
   and (p_group_id   is null or p.product_group_id = p_group_id)
   and pr.status = 'active' and not pr.is_bundle
   and (p_window_days is null or pr.transaction_date > v_today - p_window_days)
 group by u.dimension, pr.currency, pr.store_id, pr.branch_id
 order by u.dimension, pr.currency, avg_unit_price;
-- lalu join store/branch untuk nama, channel, status, successor (bukan GROUP BY nama)
```

Semua RPC di atas `SECURITY INVOKER`. Isolasi household datang dari RLS, sama seperti desain fisik §9. Fungsi tidak menambahkan filter `household_id` sendiri.

---

## 4. Alur Tulis yang Tidak Atomik

Prinsip umum:
- **Satu RPC = satu transaksi.** Semua yang harus konsisten bersama (aggregate Receipt, record turunannya, alias, dan status capture) berada di transaksi yang sama.
- **Yang menyusul (eventual):** `price_summary` (antrean + pg_cron, ± 10 detik), `public_price_fact` (trigger, sinkron), job besar (`recompute_unit_price`, `share_existing_prices`).
- **Idempoten berdasarkan keadaan:** RPC selalu membaca keadaan terkini dengan `FOR UPDATE`. Jika pekerjaan sudah selesai, RPC mengembalikan hasil yang sama tanpa menulis ulang. Trigger audit sudah mengabaikan update yang tidak mengubah apa pun.
- **Pulih dari gagal:** karena satu transaksi, kegagalan di tengah berarti *rollback* total. Klien cukup mengulang dengan input yang sama. Satu-satunya keadaan "setengah jadi" ada di alur yang memang terdiri dari beberapa panggilan (split, hapus akun, bagikan data lama), dan untuk alur itu dijelaskan khusus.

### 4.1 Konfirmasi struk (`confirm_receipt`)

**Input:** `p_receipt_id`, `p_lines` (keputusan per baris), `p_duplicate_decision` (`null` | `'distinct'` | `'discard'`).

| # | Langkah | Catatan |
|---|---|---|
| 1 | `select ... from receipt where id = p_receipt_id for update` | RLS: hanya struk sendiri. Tidak ada → `NOT_FOUND`. |
| 2 | `status = 'confirmed'` → kembalikan ringkasan yang ada (**idempoten**). `status = 'discarded'` → `INVALID_STATE`. | |
| 3 | Kecurigaan duplikat dihitung **ulang**: `duplicate_of_receipt_id IS NOT NULL` (diisi worker, bagian 5.5) **atau** ada struk lain milik household yang tidak `discarded` dengan toko + tanggal + total yang sama. | Dihitung ulang karena toko mungkin baru dipilih user (D-49). Kunci advisory `pg_advisory_xact_lock(hash(household, store, date, total))` mencegah dua struk saling lolos. |
| 4 | Jika dicurigai dan `p_duplicate_decision IS NULL` → `DUPLICATE_DECISION_REQUIRED` (detail: id struk lama). | D-20, D-50: user yang memilih. |
| 5a | `'discard'` → `status = 'discarded'`, `duplicate_of_receipt_id = <struk lama>`. Record yang sudah ada (jika ada) → `status = 'void'`. Capture → `done`. **Selesai.** | |
| 5b | `'distinct'` → `duplicate_of_receipt_id = NULL`, lanjut. | Keputusan tidak disimpan terpisah. Jika request gagal, banner muncul lagi. |
| 6 | `store_id IS NULL` → `RECEIPT_STORE_REQUIRED`. | D-49 |
| 7 | Validasi `p_lines`: setiap baris `product` yang belum punya `price_record` harus punya keputusan. Jika tidak → `UNDECIDED_LINES` (detail: daftar `line_id`). | Q-23 |
| 8 | Per keputusan: `accept` → produk = `suggested_product_id`, `match_outcome = 'confirmed'`. `replace` → produk dari input (RLS + `enforce_ref_visibility`), `match_outcome = 'corrected'`. `non_product` → `line_type = 'non_product'` (trigger menghapus record jika ada). `skip` → tidak membuat record. | `match_tier` tetap tier saran asli, supaya metrik tahu tier mana yang salah. |
| 9 | Buat atau perbarui record lewat `app.upsert_receipt_record(line_id, product_id, outcome, is_bundle)`: `insert ... on conflict (receipt_line_id) do update set product_id, is_bundle, match_outcome`. Angka harga **selalu** dari `app.derive_receipt_price` (4.3). | Idempoten oleh `receipt_line_id unique`. |
| 10 | Alias household untuk setiap `accept`/`replace` (§5.9, D-35): `insert into product_alias (household_id, store_id, product_id, alias_text) ... on conflict (store_id, normalized_text, household_id) where status = 'active' do update set product_id = excluded.product_id`. | Baris yang auto-save tidak membuat alias, karena bukan keputusan user. |
| 11 | Hitung `cheaper_than_best_count`: record baru dengan `unit_price < price_summary.best_90d_unit_price` (ringkasan **sebelum** antrean diproses). | Wireframe S-10 "2 lebih murah". |
| 12 | `receipt.status = 'confirmed'`, `confirmed_at = now()`. `capture.status = 'done'` (lewat penjaga transisi). | |
| — | *Commit.* Trigger `price_record` mengantrekan ringkasan dan menyinkronkan fakta publik. | Ringkasan menyusul ± 10 detik. |

**Batas transaksi:** langkah 1–12 dalam satu transaksi. **Pulih:** gagal di langkah mana pun berarti rollback total, lalu klien mengulang. Pilihan user tetap tersimpan di klien (wireframe S-10 "Gagal menyimpan").

### 4.2 Konfirmasi observasi (`confirm_capture_items`, D-48)

**Input:** `p_capture_id`, `p_items`: array `{ item_id, action: 'accept'|'reject', product_id? }`. Edit field dilakukan sebelumnya lewat W18 `update_capture_item`, supaya pratinjau `computed` di R16 selalu sama dengan yang akan disimpan.

| # | Langkah | Catatan |
|---|---|---|
| 1 | Kunci capture `for update`. Status harus `needs_confirmation` (atau `done`, untuk replay). | |
| 2 | Kunci item yang disebut `for update`. Item `accepted` → masukkan ke hasil apa adanya (**idempoten**). `rejected` → abaikan. | |
| 3 | `reject` → `status = 'rejected'`, `decided_at/by`. | "Bukan label harga" |
| 4 | `accept`: tentukan lokasi dengan urutan **item.store/branch → capture.store/branch → sesi (`shopping_session.branch_id` → store)**. Tanpa store → `STORE_REQUIRED` (D-28). | Store wajib, branch opsional. |
| 5 | Marketplace dengan `seller_name` tanpa `branch_id`: cari branch `kind = 'seller'` milik household atau global dengan `(store_id, external_ref)` atau nama ternormalisasi. Jika tidak ada, buat **branch privat** (D-06, D-29). | Bagian dari transaksi yang sama. |
| 6 | Hitung harga efektif: `app.observation_price(household, transaction_date, normal, promo, promo_from, promo_until, member, member_program)` → `(effective_price, price_basis, member_eligible)`. Tidak ada harga berlaku → `NO_APPLICABLE_PRICE`. | Aturan di 5.7. Memakai keanggotaan **saat ini** (D-26). Record yang sudah tersimpan tidak pernah dihitung ulang karena keanggotaan berubah (D-41). |
| 7 | Insert `price_record` (`source_type` = `capture.kind`, `capture_id`, `match_*`, `match_outcome = confirmed/corrected`, `extra` + `member_eligible`). `visibility` diisi trigger D-51. | Item `accepted` + `price_record_id`. |
| 8 | Alias household dari `raw_text` (label) atau `listing_title` (marketplace) untuk store itu. Pola sama dengan 4.1 langkah 10. | |
| 9 | Jika tidak ada lagi item `pending` → `capture.status = 'done'`. | Simpan sebagian diizinkan (S-11 "Simpan N harga"). |

**Batas transaksi:** satu transaksi per panggilan. **Idempotensi:** status item. **Pulih:** rollback, lalu ulangi.

`update_capture_item` hanya mengizinkan item `pending` (trigger menolak perubahan setelah diputuskan), dengan konkurensi optimistik.

### 4.3 Koreksi (D-23, §5.10)

**Aturan turunan struk (`app.derive_receipt_price(line_id)`)**, dipakai oleh penulis dan oleh trigger konsistensi, sehingga keduanya tidak mungkin berbeda:

| Kasus | `quantity` | `actual_weight` | `normal_price` | `effective_price` | `price_basis` / `promo_price` |
|---|---|---|---|---|---|
| Produk `unit` | `L.quantity − Σ void.qty` | — | `coalesce(L.unit_amount, L.line_amount / L.quantity)` | `round((L.line_amount + Σ diskon + Σ void) / quantity, 2)` | `promo` jika ada diskon dan effective < normal (promo_price = effective), selain itu `normal` |
| Produk `weight` | 1 | `L.quantity` (berat) | `L.unit_amount` (per `content_unit`) | `round((L.line_amount + Σ diskon) / berat, 2)` | sama |
| Sisa kuantitas ≤ 0, atau neto ≤ 0 | tidak ada record (record lama dihapus, tercatat di audit) | | | | Q-18 |

- `Σ void.qty` = `coalesce(void.quantity, |void.line_amount| / L.unit_amount)`.
- Struk tidak pernah menghasilkan `price_basis = 'member'` di MVP. Harga yang dibayar adalah harga efektif (D-01). Diskon bertanda member hanya dicatat di `extra.member_hint` (Q-12).
- Header (`transaction_date`, `store_id`, `branch_id`, `currency`) dan `capture_id` diambil dari struk.

**Trigger (⚑ Q-03):**
- `receipt_line_derive` (AFTER INSERT/UPDATE/DELETE pada `receipt_line`): jika baris produk berubah, atau baris diskon/void yang menempel berubah, record baris produk target dibentuk ulang **jika sudah ada**. Produk pilihan user (`product_id`) dipertahankan. `line_type` berubah dari `product` → record dihapus.
- `price_record_receipt_guard` (BEFORE INSERT/UPDATE pada `price_record`, untuk `source_type = 'receipt'`): menolak dengan `RECEIPT_DERIVED_FIELD` jika kolom harga, kuantitas, atau header berbeda dari hasil `app.derive_receipt_price`. Kolom yang **boleh** diubah langsung: `product_id`, `is_bundle`, `status`, `visibility`, `extra`, `match_outcome`.

**`correct_receipt_line(p_line_id, p_patch, p_expected_updated_at)`:**

| # | Langkah |
|---|---|
| 1 | Kunci struk (induk) lalu baris `for update`. Struk `discarded` → `INVALID_STATE`. |
| 2 | `updated_at ≠ p_expected_updated_at` → `STALE_WRITE`. Patch sama dengan nilai sekarang → kembalikan apa adanya (idempoten). |
| 3 | Update kolom yang diizinkan: `quantity`, `unit_amount`, `line_amount`, `line_type`, `applies_to_line_id`. Diskon baru = insert baris `discount` (dengan `line_no` berikutnya, unique deferrable). |
| 4 | Trigger `receipt_line_derive` membentuk ulang record. Trigger audit mencatat perubahan `receipt_line` dan `price_record`. Ringkasan masuk antrean. |
| 5 | Kembalikan baris + record terbaru. |

**`correct_price_record(p_id, p_patch, p_expected_updated_at, p_update_alias)`:**

| Sumber | Kunci patch yang diizinkan | Efek |
|---|---|---|
| `receipt` | `product_id`, `is_bundle`, `status` (`void`/`active`), `extra` | Angka → `USE_RECEIPT_LINE`. `product_id` → `match_outcome = 'corrected'`. |
| `price_label`, `marketplace` | di atas + `normal_price`, `promo_price`, `promo_min_qty`, `promo_valid_*`, `member_price`, `member_program_id`, `transaction_date`, `store_id`, `branch_id` | Jika input harga berubah, `effective_price`/`price_basis` dihitung ulang dengan `app.observation_price`, memakai `extra.member_eligible` sebagai **snapshot** (bukan keanggotaan saat ini, D-41, F-11). Record lama tanpa snapshot: `member_eligible = (price_basis = 'member')`. |

`p_update_alias = true` dan `product_id` berubah: alias household `(store_id, normalized_text)` yang berasal dari baris struk/item ini dialihkan ke produk baru. Jika hanya ada alias global, dibuat alias household baru yang menang atas alias global (D-35).

Satu transaksi. Konkurensi optimistik. Audit lewat trigger. Ringkasan menyusul.

### 4.4 Merge produk (`merge_product`, D-21, D-30)

RPC sudah ada. Perubahan **⚑ Q-05** (F-01):

| # | Langkah (dalam satu transaksi, sudah begitu sekarang) | Perubahan |
|---|---|---|
| 1 | Kunci kedua produk, cek hak (global hanya oleh sistem) | — |
| 2 | `from.status = 'merged'`, padatkan rantai | — |
| 3 | Pindahkan alias | — |
| 4 | Pindahkan barcode | **Hanya jika `from.household_id = into.household_id`, atau keduanya global.** Barcode privat yang di-merge ke produk global tetap menempel di produk lama. Matching tier 1 mengikuti `merged_into_id` (bagian 5.5). |
| 5 | Pindahkan `price_record` (trigger menghitung ulang `unit_price`. T-9: inilah alasan peringatan ukuran di R19) | — |
| 6 | Hapus ringkasan produk lama. Ringkasan target masuk antrean lewat trigger. | — |
| 7 | Audit `merge` | — |

**Idempotensi:** panggilan kedua gagal karena `from` sudah `merged` (target harus aktif, dan from ≠ target). Klien memperlakukan "sumber sudah merged ke target yang sama" sebagai sukses. R19 menampilkan keadaan ini.
**Pulih:** satu transaksi. Ringkasan menyusul.
**Merge global oleh sistem:** tetap satu transaksi di MVP. Domain model B-3 menyarankan job bertahap. Itu ditunda sampai volume membutuhkannya (Q-22).

### 4.5 Split produk (D-37)

Terdiri dari dua panggilan:

| # | Panggilan | Transaksi |
|---|---|---|
| 1 | (opsional) W8 `create_private_product` → produk baru. ID dari klien. | T1 |
| 2 | W9 `move_price_records(p_record_ids, p_target_product_id, p_alias)` | T2 |

T2:
1. Kunci record `for update`. `count(found) ≠ cardinality(p_record_ids)` → `RECORDS_NOT_OWNED`. Record household lain tidak terlihat oleh RLS, jadi otomatis tidak ditemukan.
2. Target harus aktif dan terlihat (`enforce_ref_visibility`).
3. `update price_record set product_id = target, match_outcome = 'corrected' where id = any(...) and product_id <> target`. Record struk diizinkan, karena koreksi produk dilakukan di Price Record (D-23).
4. `p_alias = { store_id, alias_text }` → alias household dialihkan atau dibuat (4.3). Alias global tidak disentuh.
5. Audit lewat trigger. Ringkasan produk asal dan target masuk antrean.

**Idempotensi:** record yang sudah di target dilewati. **Gagal di antara T1 dan T2:** produk baru ada tanpa record. Ini tidak berbahaya. Klien mengulang T2 dengan ID produk yang sama. Produk kosong tetap bisa diarsipkan user.

### 4.6 Opt-in berbagi publik (D-51)

**`set_share_prices_public(p_enabled)`**, satu transaksi:

| `p_enabled` | Langkah |
|---|---|
| `true` | Cek owner. `update household set share_prices_public = true`. Record baru otomatis `public` (trigger). Data lama **tidak** disentuh. |
| `false` | Cek owner. `update household set share_prices_public = false`. Lalu `update price_record set visibility = 'private' where household_id = ... and visibility = 'public'`. Trigger menghapus fakta per record. Kembalikan `withdrawn_count`. |

Mematikan opt-in dibuat **sinkron** (bukan job), karena penarikan data adalah janji privasi. Volume per household kecil (desain fisik §8.2: ± 2.600 record/tahun).

**`share_existing_prices()`** ("Bagikan juga data lama"):

| # | Langkah | Transaksi |
|---|---|---|
| 1 | Cek owner dan `share_prices_public = true`. Insert `app.job(kind = 'share_existing_prices', payload = {household_id})`, dedup jika sudah ada yang `pending`/`running`. | T1 |
| 2 | pg_cron `app.run_sql_jobs` → `app.share_existing_batch(household, 1000)`: `select share_prices_public from household for share`. Jika `false` → job selesai (dibatalkan). Jika `true` → update 1000 record `private` aktif menjadi `public`. | T2..Tn, satu per batch |
| 3 | Batch mengembalikan 0 → job `done`. | |

**Race dengan opt-out:** `for share` pada baris household membuat batch menunggu transaksi opt-out selesai, lalu membaca `false` dan berhenti. Tidak ada record yang dibuat publik setelah opt-out.
**Idempotensi:** batch hanya mengubah record `private`. **Pulih:** job diulang oleh pg_cron. Batch yang sudah commit tetap berlaku, dan memang itu yang diinginkan.

Hanya record dengan produk, toko, dan cabang global yang benar-benar menjadi fakta (trigger yang ada, D-25). Record lain tetap ditandai `public` tetapi tidak diproyeksikan. Jika nanti produknya masuk katalog global lewat merge, record itu ikut terproyeksi.

---

## 5. Pipeline Capture

### 5.1 Status dan transisi

```
             submit_capture
                  │
                  ▼
   ┌────────── uploaded ◀───────────────┐  retry_capture (user)
   │              │ claim (worker)       │  atau retry otomatis (transient, attempts < max)
   │ delete       ▼                      │
   │         processing ─────────────────┤
   │          │      │   gagal permanen  │
   │          │      └────────────► failed
   │          │ apply
   │          ├── ada item ragu / duplikat / toko kosong ──► needs_confirmation ──(konfirmasi semua)──► done
   │          └── semua auto-save ─────────────────────────────────────────────────────────────────► done
   ▼
 (dihapus)
```

| Dari → ke | Siapa | Fungsi |
|---|---|---|
| (baru) → `uploaded` | user | `submit_capture` |
| `uploaded` → `processing` | worker | `app.claim_next_capture` |
| `processing` → `needs_confirmation` / `done` | worker | `app.apply_extraction` |
| `processing` → `uploaded` (retry otomatis) / `failed` | worker / reaper | `app.fail_run` / `app.reap_stale_runs` |
| `failed` → `uploaded` | user | `retry_capture` |
| `needs_confirmation` → `done` | user | `confirm_receipt` / `confirm_capture_items` |
| `uploaded`, `failed` → (hapus) | user | `delete_capture` |

Trigger `capture_status_guard` (**⚑ Q-04**, F-15) menolak transisi lain dengan `INVALID_TRANSITION`. Untuk role `authenticated`, hanya `failed → uploaded` dan `needs_confirmation → done` (lewat RPC) yang diizinkan.

### 5.2 Unggah (klien) dan pendaftaran

| # | Langkah | Detail |
|---|---|---|
| 1 | Klien membuat `capture_id` (UUID, D-59) dan menghitung `sha256` per gambar. | Offline: semua disimpan di IndexedDB dulu (Tahap 5). |
| 2 | Cek hash duplikat (REST `capture_image?sha256=in.(...)`). Jika ada, tampilkan dialog. User memilih. | D-20 tahap 1 (U-10). |
| 3 | Unggah tiap gambar ke `captures/{household_id}/{capture_id}/{position}.{ext}` dengan `upsert: false`. | Policy Storage 7.3. Mengulang unggahan yang sudah ada → error "already exists", diperlakukan sebagai sukses. |
| 4 | `submit_capture(p_capture_id, p_kind, p_images = [{position, ext, sha256, byte_size}], p_shopping_session_id, p_store_id, p_branch_id)` | Lihat di bawah. |

`submit_capture` (satu transaksi, SECURITY INVOKER):
1. Capture dengan id ini sudah ada → kembalikan apa adanya (**idempoten**, D-59).
2. `household_id` = household user (R1). **Path dibangun server**, tidak diterima dari klien.
3. Setiap path harus ada di `storage.objects` (bucket `captures`). Jika tidak → `CAPTURE_IMAGES_MISSING`. Fungsi helper DEFINER hanya membaca keberadaan path di folder household sendiri.
4. Sesi: jika `p_shopping_session_id` diisi, sesi harus milik household (FK komposit). Sesi yang sudah kedaluwarsa **tetap diterima**, karena foto bisa diambil offline saat sesi masih aktif (D-59). `store_id`/`branch_id` diisi dari cabang sesi jika kosong.
5. Insert `capture` (`uploaded`) dan `capture_image`. `purge_after` default 12 bulan (D-32).
6. `pg_notify('capture_uploaded', capture_id)`.

**Unggahan yatim** (file ada, `submit_capture` tidak pernah dipanggil): sapuan harian oleh worker menghapus objek di bucket yang tidak punya baris `capture_image` dan berumur lebih dari `orphan_upload_ttl_hours` (24 jam).

### 5.3 Klaim, lease, dan retry

```sql
-- app.claim_next_capture(p_worker text) returns (capture_id, run_id, kind, household_id, attempt)
-- 1. pilih: status = 'uploaded' and siap menurut backoff
--      (run gagal terakhir finished_at <= now() - backoff(attempt))
--    order by uploaded_at limit 1 for update skip locked
-- 2. update capture set status = 'processing'
-- 3. insert processing_run (status 'running', ocr_engine, ai_model, prompt_version dari extractor)
```

- **Paralel-aman:** `SKIP LOCKED`. Dua worker tidak pernah mengklaim capture yang sama.
- **Lease:** run `running` yang `started_at` lebih lama dari `capture_processing_timeout_seconds` (300) ditandai `failed` ("timeout") oleh `app.reap_stale_runs()` (pg_cron, tiap menit). Capture kembali ke `uploaded` jika masih ada sisa percobaan.
- **Percobaan:** `attempt = count(processing_run)`. Backoff 30 detik, 2 menit, 10 menit. Lebih dari `capture_max_attempts` (3) → `failed`.
- **Transient vs permanen:** extractor melempar `TransientError` (timeout, 5xx, rate limit) atau `PermanentError` (bukan struk, gambar tidak terbaca, format tidak didukung). Permanen langsung `failed`, dengan `error_message` berbahasa Indonesia untuk UI. Kategori terstruktur (X-08): Q-20.
- **Worker basi:** `apply_extraction` memeriksa bahwa `run_id` adalah run `running` terakhir dan capture masih `processing`. Jika tidak (mis. sudah di-reap), hasil dibuang.

### 5.4 Langkah worker

```
claim
 └─ unduh gambar (BlobStore: Supabase Storage / folder lokal), verifikasi sha256
 └─ CaptureExtractor.extract(images, kind, ctx)              ← STUB di Tahap 4
     → { rawText?, output: ParsedReceipt | ParsedObservation, usage, engine, model, promptVersion }
 └─ app.record_run_output(run, raw_text, raw_output, usage)    [T-a: data mentah selalu disimpan, §3]
 └─ matching per item:
      app.match_products(household, store, items[])            [tier 1–3, SQL, deterministik]
      AiMatcher.match(itemsTanpaHasil, kandidat)               [tier 4, STUB, hanya untuk yang gagal, §5.9]
 └─ app.apply_extraction(capture, run, payload jsonb)          [T-b: satu transaksi, bagian 5.5]
```

**Antarmuka (`apps/worker/src/pipeline/types.ts`):**

```ts
interface CaptureExtractor {
  readonly engine: string; readonly model: string | null; readonly promptVersion: string;
  extract(input: { kind: CaptureKind; images: ImageBlob[]; ctx: ExtractContext }): Promise<Extraction>;
}
// D-16 belum diputuskan. Dua implementasi Tahap 6 sama-sama memenuhi antarmuka ini:
//   VisionExtractor (Claude vision langsung) atau OcrThenParseExtractor (OCR khusus + Claude).

interface AiMatcher {
  match(items: UnmatchedItem[], ctx: MatchContext): Promise<MatchSuggestion[]>;   // tier 4
}

interface BlobStore { get(path: string): Promise<Buffer>; delete(paths: string[]): Promise<void>;
                      list(prefix: string): Promise<string[]>; }
```

**Stub (`StubExtractor`):** deterministik. Fixture JSON di `apps/worker/test/fixtures/<sha256>.json` dipetakan ke gambar lewat hash. Tanpa fixture → `PermanentError('unsupported')`. Fixture bisa memaksa `TransientError` untuk menguji retry. `StubAiMatcher` mengembalikan saran dari fixture, atau kosong. Tidak ada panggilan jaringan (D-16, Batasan).

**Bentuk `ParsedReceipt`** (dikunci di `packages/contracts`): header (toko terbaca, cabang, tanggal, jam, total, subtotal, metode bayar, confidence per field), `pii` (digit kartu, nama/nomor member, HP), `lines[]` (`line_no`, `line_type`, `raw_text`, `quantity`, `unit_amount`, `line_amount`, `applies_to_line_no`, `barcode?`, `parse_confidence`), `adjustments[]`, `member_hint?`.
**Bentuk `ParsedObservation`:** `store_hint?`, `items[]` (`raw_text`, `barcode?`, harga normal/promo/member + program terbaca, `promo_min_qty`, periode, `seller?`, `shipping_fee?`, `shop_voucher?`, `listing_url?`, `region`, `image_position`, confidence per field).

**Matching tier 1–3 (`app.match_products`, DEFINER, household dari capture):**

| Tier | Aturan | Confidence (placeholder, Q-21) |
|---|---|---|
| 1 barcode | `barcode_assignment` berlaku pada tanggal transaksi. GTIN: milik household dulu, lalu global. PLU: wajib store yang sama. Produk `merged` → ikuti `merged_into_id` (F-01). | 1.00 |
| 2 alias | `product_alias` aktif, `(store_id, normalized_text)`: household dulu (D-35), lalu global | 0.98 / 0.95 |
| 2b alias grup | Alias dari store lain dalam `store_group` yang sama → **kandidat saja**, tidak exact (domain model A-6) | maks 0.70 |
| 3 fuzzy | `word_similarity` terhadap `product.search_text` + brand, produk global/milik household yang `active`, ≥ `fuzzy_min_similarity` | = skor similarity |
| 4 AI | Hanya jika tier 1–3 tidak memberi kandidat ≥ ambang | dari model (stub: fixture) |

Lima kandidat teratas disimpan (`candidate_product_ids`), yang terbaik di `suggested_product_id`. **Confidence item** = `min(match_confidence, confidence harga terbaca)`.

### 5.5 `app.apply_extraction` (satu transaksi) dan aturan auto-save

`τ = app.config_numeric('auto_save_min_confidence')` (0,90, D-50).

**Struk:**

| # | Langkah |
|---|---|
| 1 | Resolusi toko: alias nama toko / nama ternormalisasi (global + milik household). Tidak dikenali → `store_id = NULL` (D-49). Cabang: hanya jika cocok dengan store itu. |
| 2 | Insert `receipt` (`draft`, `field_confidence`, `pii`), lalu `receipt_line` (diskon/void ditempelkan lewat `applies_to_line_no` → id), lalu `receipt_adjustment`. |
| 3 | **Kecurigaan duplikat** (di bawah kunci advisory sidik jari): (a) sidik jari toko + tanggal + total sama dengan struk lain yang tidak `discarded`, **atau** (b) salah satu `sha256` gambar sama dengan gambar capture lain milik household. → `duplicate_of_receipt_id` = struk lama (jika ada). |
| 4 | Header layak auto-save jika: **tidak dicurigai duplikat** (D-50) **dan** `store_id IS NOT NULL` **dan** `field_confidence.store ≥ τ` **dan** `field_confidence.date ≥ τ`. Selisih total **tidak** ikut menentukan (D-50). Aturan header ini: Q-13. |
| 5 | Jika header layak: setiap baris `product` dengan confidence ≥ τ dan tanpa tanda bundle → `app.upsert_receipt_record(..., outcome => 'auto')`. Tidak membuat alias. |
| 6 | Semua baris produk punya record → `receipt.status = 'confirmed'` (`confirmed_at`), capture `done`. Selain itu capture `needs_confirmation`. |
| 7 | `processing_run.status = 'succeeded'`, `finished_at`. `capture.processed_at`. |

**Label / screenshot:**

| # | Langkah |
|---|---|
| 1 | Lokasi: sesi → pilihan manual capture → `store_hint` dari AI (logo, platform). |
| 2 | Insert `capture_item` per item. `transaction_date` = tanggal unggah di zona household (D-60, F-12). Screenshot: tanggal dari metadata gambar jika tersedia. |
| 3 | Item di-auto-accept jika: confidence ≥ τ **dan** store diketahui **dan** `app.observation_price` memberi harga **dan** tidak ada tanda bundle **dan** gambar tidak dicurigai duplikat hash. Prosesnya sama dengan 4.2 langkah 4–7, dengan `match_outcome = 'auto'`, tanpa alias. |
| 4 | Ada item `pending` → `needs_confirmation`. Selain itu `done`. |

**Idempotensi:** `receipt.capture_id unique` dan `capture_item (capture_id, position) unique`. Jika apply dijalankan dua kali untuk run yang sama, panggilan kedua ditolak oleh pemeriksaan run terakhir (5.3).

### 5.6 Kunci `app.config` operasional (⚑ Q-11)

| Kunci | Default | Dipakai |
|---|---|---|
| `capture_max_attempts` | 3 | 5.3 |
| `capture_processing_timeout_seconds` | 300 | reaper |
| `capture_retry_backoff_seconds` | `[30, 120, 600]` | claim |
| `fuzzy_min_similarity` | 0.5 | tier 3 |
| `orphan_upload_ttl_hours` | 24 | sapuan |
| `ocr_redact_after_days` | 7 | 7.4 |
| `session_extend_hours` | 2 | D-60 (nilai sudah diputuskan, dijadikan parameter) |

### 5.7 Harga efektif observasi (`app.observation_price`, D-26, D-27, D-41)

Kandidat harga yang **berlaku** pada tanggal observasi `d`:

| Harga | Berlaku jika |
|---|---|
| normal | `normal_price` terisi |
| promo | `promo_price` terisi **dan** `d` berada di `[promo_valid_from, promo_valid_until]`. Batas yang kosong dianggap terbuka. Promo kuantitas (`promo_min_qty`) tetap berlaku (D-34). |
| member | `member_price` terisi **dan** household punya `household_program_membership` untuk `member_program_id` itu **saat record dibuat** (D-27). Hasilnya disimpan sebagai `extra.member_eligible` (F-11). |

- `effective_price` = harga terendah dari yang berlaku. Jika ada yang sama, urutannya normal → promo → member (Q-19), supaya label `PROMO` tidak muncul pada harga yang sama dengan normal.
- Tidak ada satu pun harga yang berlaku → `NO_APPLICABLE_PRICE` (Q-19).
- Harga member dari program yang tidak ada di katalog tidak masuk `member_price`, tetapi ke `extra.member_note` (D-52).
- **D-41:** fungsi ini hanya dipanggil saat record dibuat (4.2, 5.5) dan saat input harga observasi dikoreksi (4.3, dengan snapshot). Mengubah keanggotaan **tidak pernah** memicu hitung ulang record yang tersimpan. R16 menghitung `computed` secara live hanya untuk item `pending`. Inilah perilaku "Saya member" di S-11 (wireframe §8.4 no. 5).

Fungsi yang sama dipakai oleh R16 (pratinjau), W5, W6, dan worker. Tidak ada salinan logika di TypeScript.

---

## 6. Definisi Tools AI

Prinsip (D-05, D-57):
- AI **tidak** pernah menulis SQL. Setiap tool memetakan ke **satu RPC baca** di bagian 3, dan dipanggil dengan **JWT user**. RLS membatasi data, sehingga tool tidak menambahkan filter household (desain fisik §9).
- Parameter divalidasi zod sebelum dipanggil. Teks bebas hanya `kata_kunci` (≤ 100 karakter), dan diteruskan sebagai parameter, tidak pernah disisipkan ke query.
- Semua tool baca saja. Tidak ada tool tulis (D-57).
- Setiap output menyertakan `jumlah_data`, `tanggal_terakhir`, dan `layar` (tautan ke layar sumber, U-18).
- Di Tahap 4, tools berupa `packages/ai-tools`: registry `{ name, description, inputSchema (JSON Schema dari zod), handler(supabaseUserClient, input) }` beserta test terhadap database lokal. Tools belum disambungkan ke Claude.

| Tool | Pertanyaan inti | Parameter | RPC | Output (ringkas) |
|---|---|---|---|---|
| `cari_harga_terbaik` | 1, 2 | `kata_kunci?: string`, `produk_id?: uuid` (salah satu), `batas?: 1..10 = 5` | R3 / R7 | `[{ produk, ukuran, terbaik_90_hari: {harga, label, per_satuan, toko, cabang \| "cabang tidak diketahui", tanggal} \| null, terbaik_sepanjang_masa: {...}, jumlah_data, tanggal_terakhir, layar: {id:'S-03', produk_id} }]`. Lebih dari 1 hasil → AI bertanya "maksudmu …" (wireframe S-20). |
| `tren_harga` | 3 | `produk_id: uuid`, `hanya_normal?: boolean = false` | R10 | `{ arah: 'naik'\|'turun'\|'stabil'\|null, persen, rata2_30_hari, rata2_30_hari_sebelumnya, data_jendela_ini, data_jendela_sebelumnya, minimal_data_per_jendela, label: 'vs 30 hari sebelumnya', jumlah_data, tanggal_terakhir, layar: S-03 }`. `arah = null` → "data belum cukup" (D-15, D-54). |
| `harga_per_satuan` | 4 | `produk_id: uuid`, `harga_rak?: number > 0` | R7 (+ rumus `unitPrice` jika `harga_rak` diisi, tanpa menyimpan, D-55) | `{ satuan_dasar, terbaik_90_hari_per_satuan, terakhir_per_satuan, harga_rak_per_satuan?, selisih_persen_vs_terbaik?, mendekati_terbaik?, jumlah_data, tanggal_terakhir, layar: S-03b }` |
| `bandingkan_ukuran` | 5 | `product_group_id?: uuid`, `produk_id?: uuid` (group diambil dari produk), `jendela?: '90d'\|'all' = '90d'` | R11 | `{ group, per_dimensi: [{ dimensi, mata_uang, baris: [{produk, ukuran, per_satuan, harga, peringkat, selisih_persen}], tanpa_data: [produk] }], layar: S-04 }` |
| `lebih_hemat_di_mana` | 6 | `produk_id?: uuid`, `product_group_id?: uuid`, `jendela_hari?: 30\|90\|365\|null = 90` | R12 | `{ per_dimensi: [{ dimensi, mata_uang, toko: [{toko, cabang, termurah_per_satuan, rata2_per_satuan, jumlah_data, tanggal_terakhir, online, catatan?: "harga belum termasuk ongkir" \| "baru 1 data"}] }], layar: S-05 }` |
| `histori_harga` | pendukung | `produk_id: uuid`, `toko_id?: uuid`, `batas?: 1..50 = 20` | R8 | `[{ tanggal, sumber, toko, cabang, harga_efektif, label, per_satuan, kuantitas, bundle, member_tidak_dihitung }]` + `layar: S-03` |

Pertanyaan di luar enam kemampuan ini (resep, total pengeluaran, harga pasar umum) tidak punya tool. Penolakannya diatur oleh instruksi model di Tahap 6 (D-57).

---

## 7. Keamanan dan PII

### 7.1 RLS

Pola dari desain fisik §6.1 tetap. Tambahan Tahap 4:

| Tabel / objek | Pola | Catatan |
|---|---|---|
| `capture_item` | HOUSEHOLD (select, update) | Insert hanya oleh worker |
| View `price_record_view` | `security_invoker = true` | RLS tabel dasar berlaku |
| RPC `public.*` | INVOKER, kecuali R2 (baca `app.config`), W14/W15 (cek owner), `merge_product` | DEFINER wajib memeriksa household secara eksplisit |
| Fungsi `app.*` untuk worker | DEFINER, dipanggil service role | Household **selalu** diturunkan dari `capture.household_id`, tidak pernah dari output AI. FK komposit dan `enforce_ref_visibility` tetap berlaku untuk service role, karena trigger dan constraint tidak dilewati oleh `bypassrls`. |

**Worker dan service role.** Worker melewati RLS. Pertahanannya ada tiga lapis: (1) semua tulisan worker lewat fungsi `app.*` yang menerima `capture_id`, bukan `household_id`; (2) FK komposit `(parent, household_id)` mencegah baris anak menyeberang household; (3) `enforce_ref_visibility` mencegah rujukan ke produk/toko privat household lain. Test lintas household di bagian 8 mencakup jalur worker.

### 7.2 GRANT (lapis kedua)

Tambahan pada desain fisik §6.2 (**⚑ Q-04**):

| Objek | `authenticated` | `anon` |
|---|---|---|
| `receipt` | `SELECT` semua kolom **kecuali `pii`**. `UPDATE` hanya kolom header (S-10). `INSERT/DELETE` dicabut (insert oleh worker, hapus lewat capture). | — |
| `processing_run` | `SELECT (id, capture_id, household_id, status, started_at, finished_at, error_message)` | — |
| `capture_item` | `SELECT`, `UPDATE` | — |
| `household` | `UPDATE (name, default_currency, timezone)`. `share_prices_public` hanya lewat RPC. | — |
| Semua RPC baru | `EXECUTE` eksplisit | dicabut (F-09) |
| `public_price_fact`, `unit` | tetap | `SELECT` (tetap) |

**Test inventaris** (bagian 8) memeriksa seluruh `has_table_privilege` / `has_function_privilege` untuk `anon` dan `authenticated` terhadap daftar yang diizinkan. Hak baru yang tidak ada di daftar membuat CI gagal.

### 7.3 Storage

```sql
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('captures', 'captures', false, 10485760,
        array['image/jpeg','image/png','image/webp','image/heic']);

create policy captures_read on storage.objects for select to authenticated
  using (bucket_id = 'captures'
         and (storage.foldername(name))[1] in (select app.my_household_ids()::text));
create policy captures_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'captures'
              and (storage.foldername(name))[1] in (select app.my_household_ids()::text)
              and array_length(storage.foldername(name), 1) = 2);
-- Tidak ada policy UPDATE/DELETE untuk authenticated (F-14). Hapus oleh service role:
-- delete_capture → job purge_storage_paths, retensi, hapus akun.
```

- Gambar ditampilkan dengan **signed URL berumur pendek** (5 menit), dibuat oleh klien dengan JWT-nya sendiri.
- Penghapusan file selalu lewat **Storage API** (bukan `DELETE FROM storage.objects`), supaya file di penyimpanan objek ikut terhapus.

### 7.4 `receipt.pii` dan data mentah

| Data | Perlakuan |
|---|---|
| `receipt.pii` | Diisi worker dari hasil parsing. **Tidak bisa dibaca** `authenticated` (hak kolom). Tidak ikut ke `audit_log` (`audit_row` membuang kunci `pii`). Dikosongkan (`'{}'`) bersamaan dengan purge gambar 12 bulan (Q-14). |
| `processing_run.raw_ocr_text`, `raw_ai_output` | Tidak terbaca `authenticated`. Disamarkan oleh job `redact_ocr`: `ocr_redact_after_days` (7) hari setelah capture `done`/`failed` final. Stub redaksi: regex untuk digit kartu, nomor HP Indonesia, dan email. Isi `pii` hasil parsing ikut disamarkan dari teks. Setelah itu `pii_redacted_at` diisi. Redaksi berbasis AI menyusul di Tahap 6. |
| Log worker | Tidak pernah mencetak teks OCR, `pii`, atau gambar. Hanya id, status, dan durasi. |

### 7.5 Retensi gambar (D-32)

pg_cron `app.enqueue_retention()` (harian) mengantrekan job `purge_images` berisi daftar `capture_image` dengan `purge_after < now()` dan `purged_at IS NULL` (batch 500). Worker: hapus file lewat Storage API → `update capture_image set purged_at = now()`. Urutannya hapus file dulu baru tandai, sehingga jika gagal di tengah, job diulang dan menghapus file yang sudah tidak ada itu tidak error (idempoten). Baris `capture_image` dan `sha256` tetap disimpan untuk deteksi duplikat (desain fisik §6.5). UI S-09/S-16 membaca `purged_at`.

### 7.6 Hapus akun (BR-8)

`POST /api/account/delete` (Route Handler Next.js, server-only, memakai `SUPABASE_SERVICE_ROLE_KEY` dari env):

| # | Langkah | Gagal di sini → |
|---|---|---|
| 1 | Verifikasi JWT dari cookie. Wajib login ulang dalam 15 menit terakhir, dan body berisi teks konfirmasi. Jika tidak → `REAUTH_REQUIRED`. | Tidak ada perubahan |
| 2 | `app.begin_account_deletion(user_id)` (satu transaksi): untuk household yang anggotanya hanya user ini → `archived_at = now()` + job `delete_household`. Untuk household lain (pasca-MVP) → hanya hapus membership. | Rollback. User mengulang. |
| 3 | `auth.admin.deleteUser(user_id)` → cascade `profile`, `household_member`. `price_record.created_by`, `capture.uploaded_by` → NULL. | Household sudah diarsipkan dan job sudah antre. User bisa mengulang endpoint (langkah 2 idempoten). |
| 4 | Respons 202. Klien `signOut`. | — |

Job `delete_household` (worker, setiap langkah idempoten):
1. Tunggu sampai household **tidak punya anggota** (artinya langkah 3 sudah berhasil). Jika belum, ulang dengan backoff. Setelah 24 jam, job `failed` untuk ditangani admin.
2. `app.detach_public_facts(household)`: hapus tautan `app.public_price_source` milik record household. **Fakta anonim tetap ada** (desain fisik §6.5, BR-8). ⚑ Q-06.
3. Hapus semua objek Storage di prefix `{household_id}/` (batch).
4. `delete from household where id = ...` → cascade seluruh data household (record, struk, capture, ringkasan, audit, katalog privat).
5. Job `done`.

**Jaring pengaman:** `app.enqueue_retention()` juga mengantrekan `delete_household` untuk household yang tidak punya anggota lebih dari 1 jam. Ini menangkap kasus langkah 2 tidak pernah jalan, atau user dihapus langsung dari dashboard Supabase.

### 7.7 Rahasia

`.env.example` (tanpa nilai):

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=        # server-only: apps/web route handler, apps/worker
DATABASE_URL=                     # worker: koneksi sesi (bukan transaction pooler) untuk LISTEN
STORAGE_BACKEND=supabase          # supabase | local
LOCAL_STORAGE_DIR=./.data/storage # jika STORAGE_BACKEND=local
EXTRACTOR=stub                    # Tahap 6: vision | ocr+parse
GOOGLE_OAUTH_CLIENT_ID=
GOOGLE_OAUTH_SECRET=
```

`SUPABASE_SERVICE_ROLE_KEY` tidak pernah diberi prefix `NEXT_PUBLIC_`. Modul server Next.js yang memakainya diberi `import 'server-only'`. CI menjalankan secret scanning.

---

## 8. Strategi Test

### 8.1 Lapisan

| Lapisan | Alat | Lingkungan | Cakupan |
|---|---|---|---|
| **L1 SQL** | Harness `db/tests` (`test.ok`, `test.expect_error`). Tanpa dependensi, berjalan di PostgreSQL biasa. | PostgreSQL 16 + `supabase_stub.sql` | Skema, invariant, RLS, RPC, fungsi pipeline, job SQL |
| **L2 TypeScript unit** | vitest | tanpa DB | `packages/contracts` (zod, kontrak extra, `unitPrice` = rumus SQL), stub extractor, backoff, klasifikasi error, registry tools |
| **L3 Integrasi TS** | vitest + `pg` ke PostgreSQL lokal (L1 + migration), `LocalBlobStore` | PostgreSQL lokal | Worker end-to-end dengan fixture: unggah → claim → apply → konfirmasi. Konkurensi 2 worker. Crash di tengah (proses dihentikan setelah claim → reaper). Tools AI terhadap data seed dengan JWT simulasi. |
| L4 Supabase CLI (opsional, manual/nightly) | `supabase start` + test TS | Supabase lokal | Policy Storage asli, error PostgREST `PTnnn` → HTTP, Auth OTP (Inbucket), default privileges asli |

### 8.2 File test SQL baru (`db/tests/flows/`)

| File | Isi utama |
|---|---|
| `00_baseline_equivalence.sh` | `pg_dump` schema dari `schema.sql` lama = dari baseline migration |
| `10_schema_changes.sql` | D-49: draft tanpa toko boleh, `confirmed` tanpa toko ditolak, `field_confidence` invalid ditolak. F-06: cabang tanpa toko ditolak. D-48: constraint `capture_item`. D-50/55: kunci config terbaca. X-10: kunci tidak dikenal ditolak, tipe salah ditolak. D-52 `member_note` diterima. |
| `20_receipt_derivation.sql` | Turunan: unit, multipack, timbang, diskon, void penuh/sebagian, neto ≤ 0. Ubah angka record struk langsung → ditolak. Ubah `receipt_line` → record terbentuk ulang. Produk pilihan user dipertahankan. |
| `30_confirm_receipt.sql` | Duplikat tanpa keputusan ditolak. `discard`. `distinct`. Toko kosong ditolak. Baris belum diputuskan ditolak. `accept`/`replace`/`non_product`/`skip`. Alias dibuat. **Panggilan kedua idempoten** (jumlah record dan alias tetap). `cheaper_than_best_count`. |
| `31_confirm_observation.sql` | D-26: promo aktif vs berakhir. D-27: member dihitung hanya jika terdaftar. D-41: daftar member setelah simpan tidak mengubah record. Pratinjau R16 berubah untuk item pending. Seller baru menjadi branch privat. Simpan sebagian. Idempoten. |
| `40_corrections.sql` | Optimistik `STALE_WRITE`. Koreksi observasi memakai snapshot `member_eligible`. `USE_RECEIPT_LINE`. Audit tercatat, tanpa `pii`. Ringkasan masuk antrean. |
| `50_merge_split.sql` | F-01: barcode privat tidak menjadi global. Matching barcode mengikuti merge. Preview `size_mismatch`. Split: record bukan milik → `RECORDS_NOT_OWNED`. Alias dialihkan. Idempoten. |
| `60_public_share.sql` | Insert mengikuti flag. F-02: hapus record publik → fakta hilang. Opt-out menarik semua. Bagikan data lama per batch. Race opt-out vs batch (dua sesi lewat `dblink` atau test L3). |
| `70_capture_pipeline.sql` | `submit_capture` idempoten. File hilang → error. Penjaga transisi status. Claim `SKIP LOCKED`. Reaper. Backoff. Max attempts. **Auto-save: duplikat tidak pernah auto-save (D-50)**, toko kosong tidak auto-save, di bawah τ masuk `needs_confirmation`, selisih total tidak memaksa konfirmasi. |
| `80_read_rpcs.sql` | Search: brand "nestle" menemukan Milo, produk tanpa histori muncul setelah yang punya data, merged/archived tidak muncul, kata kunci pendek (F-13). `where_cheaper`: dimensi/mata uang dipisah, toko sama nama tidak tergabung (F-08). Tren D-54 vs ringkasan konsisten. `compare_sizes` per dimensi. |
| `85_ai_tools.sql` | Setiap RPC yang dipakai tool mengembalikan data household sendiri saja |
| `90_account_deletion.sql` | Fakta publik tetap ada dan tanpa tautan. Seluruh data household terhapus. Data household lain utuh. Sapuan household tanpa anggota. |
| `95_storage_policy.sql` | Stub `storage.objects`: user B tidak bisa membaca/menulis folder household A. Tidak ada update/delete untuk user. Nama folder bukan UUID tidak error. |
| **`98_rls_matrix.sql`** | **Otomatis dari katalog:** untuk *setiap* tabel di `public`, sebagai user B terhadap baris milik A: `select` = 0, `update`/`delete` = 0 baris, `insert` dengan `household_id` A ditolak. Untuk *setiap* RPC baca: hasil saat login sebagai B tidak memuat id milik A. Tabel atau RPC baru otomatis tercakup. |
| **`99_privilege_inventory.sql`** | Daftar hak `anon`/`authenticated` atas tabel, kolom, dan fungsi = whitelist (F-09) |

### 8.3 CI

GitHub Actions: service container `postgres:16`. Langkah: `db/tests/run.sh` (smoke + flows), lalu `pnpm -r test` (L2 + L3). L4 dijalankan manual. Hash `smoke.sql` diperiksa supaya file itu tidak diubah diam-diam.

---

## 9. Pertanyaan untuk Didiskusikan

Setiap pertanyaan punya usulan default. Jawab "setuju semua" jika semua default sudah cocok.

### 9.1 Blocking untuk Tahap 4b

| ID | Pertanyaan | Usulan default |
|---|---|---|
| **Q-01** | **Arsitektur** (bagian 1): klien langsung ke PostgREST + RPC dengan JWT user, Route Handler Next.js hanya untuk operasi bersecret, worker Node.js long-running, pg_cron untuk job SQL, monorepo pnpm sesuai 1.5? | **Ya.** |
| **Q-02** | **Rincian kolom `capture_item`** (2.2). Selain yang disebut D-48, ada `region`, `candidate_product_ids` (X-12), lokasi per item, `seller_name/ref`, `transaction_date`, `currency`, semua field harga, `extra`, `field_confidence`, `decided_by/at`. | **Setuju seperti 2.2.** Tanpa `region`, S-11 tidak bisa menampilkan crop label. Tanpa `candidate_product_ids`, S-14 hanya punya satu saran. |
| **Q-03** | **Menegakkan D-23 di database** (F-05). Pilihan: (a) trigger turunan `receipt_line → price_record` + trigger konsistensi; (b) cabut hak tulis `price_record`/`receipt_line` dari `authenticated` dan wajib lewat RPC (lebih ketat, tetapi ±10 pernyataan di smoke test harus diubah); (c) cukup disiplin RPC. | **(a).** Invariant ada di database, dan smoke test tidak berubah. |
| **Q-04** | **Pengetatan PII dan hak akses** (F-03, F-04, F-15): hak kolom `receipt.pii` dan `processing_run.raw_*`, `audit_row` tanpa `pii`, `processing_run` select saja, `receipt` update hanya header, penjaga transisi `capture.status`. | **Ya, semuanya.** |
| **Q-05** | **Perbaikan bug F-01 dan F-02:** (1) merge privat → global tidak memindahkan barcode privat; matching mengikuti `merged_into_id`. (2) Hapus fakta publik di `BEFORE DELETE`. | **Ya.** Alternatif untuk (1): barcode privat dihapus saat merge. Lebih sederhana, tetapi informasi hilang. |
| **Q-06** | **Fakta publik saat hapus akun.** Desain fisik §6.5 dan BR-8: fakta anonim tetap ada. D-51: mematikan opt-in menarik semua fakta. Keduanya tidak bertentangan, tetapi perilakunya harus eksplisit (F-02). | **Tetap ada** saat hapus akun (tautan dilepas dulu). **Ditarik** saat opt-out. Jika ingin hapus akun juga menarik fakta, cukup ganti langkah 7.6 no. 2. |
| **Q-07** | **Kontrak `price_record.extra`** (X-10, 2.2), termasuk `member_eligible` (snapshot untuk F-11) dan `member_hint` (U-21), dengan validasi ketat (kunci tidak dikenal ditolak). | **Setuju.** |
| **Q-08** | **D-51:** visibility record baru **selalu** mengikuti `household.share_prices_public` (nilai dari klien diabaikan). Update manual per record ke `public` tetap diizinkan walaupun household belum opt-in (dipakai smoke test, tidak dipakai UI). | **Ya.** Jika update manual ingin dilarang, smoke test "anon melihat 1 fakta publik" harus diubah dulu untuk opt-in household. |
| **Q-09** | F-06: `CHECK (store_id IS NOT NULL OR branch_id IS NULL)` di `receipt` dan `capture`. | **Ya.** |
| **Q-10** | **Policy Storage** (F-14): user hanya `SELECT` + `INSERT`. Hapus oleh service role. Batas 10 MB, tipe jpeg/png/webp/heic. Perbandingan folder sebagai teks. | **Ya.** |
| **Q-11** | Jenis `app.job` baru (`delete_household`, `share_existing_prices`, `purge_storage_paths`) dan kunci config operasional (5.6). | **Ya.** Nilai bisa diubah tanpa migration. |

### 9.2 Non-blocking

| ID | Pertanyaan | Usulan default |
|---|---|---|
| Q-12 | Struk dengan diskon member: harga efektif = yang dibayar (D-01), atau hanya dihitung jika household terdaftar (D-27)? | **D-01 untuk struk.** Harga yang benar-benar dibayar adalah fakta. `price_basis = 'promo'`, ditambah `extra.member_hint` untuk ajakan U-21. D-27 berlaku untuk observasi. |
| Q-13 | Auto-save struk juga mensyaratkan confidence **header** (toko, tanggal) ≥ τ, bukan hanya confidence baris? | **Ya.** Tanggal yang salah akan merusak tren semua item. Total tidak ikut (D-50). |
| Q-14 | `receipt.pii` dikosongkan bersamaan dengan purge gambar (12 bulan)? D-32 hanya menyebut gambar dan teks OCR. | **Ya.** Minimisasi data (UU PDP). |
| Q-15 | F-07: ringkasan hanya menghitung mata uang default household? | **Ya.** Record mata uang lain tetap tampil di histori dan di R12 (dipisah per mata uang). |
| Q-16 | F-12: "hari ini" dihitung di `household.timezone`, dan job harian dijadwalkan 17:05 UTC? `refresh_price_summary` memakai `current_date`. Ubah ke zona household, atau set zona waktu database ke `Asia/Jakarta`? | **Zona household di RPC baru. Database diset `Asia/Jakarta` untuk MVP** (satu zona pengguna). Ditinjau ulang jika ada pengguna di zona lain. |
| Q-17 | Hosting worker (Fly / Render / Railway / VM / Edge Function)? | **Ditunda ke Tahap 7.** Tahap 4b hanya lokal. |
| Q-18 | Baris struk dengan neto ≤ 0 (hadiah 100%, void penuh): tanpa `price_record`? | **Ya.** Harga Rp0 akan menjadi "harga terbaik" selamanya. Baris tetap tersimpan di `receipt_line`. |
| Q-19 | Observasi tanpa harga yang berlaku (mis. hanya harga member, user bukan member, tanpa harga normal): ditolak? Urutan seri normal → promo → member? | **Ditolak dengan `NO_APPLICABLE_PRICE`.** S-11 meminta user mengisi harga normal. **Ya** untuk urutan seri. |
| Q-20 | X-08: tambah `capture.error_code` (`blurry`, `not_a_receipt`, `unsupported`, `timeout`)? | **Ya, kecil.** Dibutuhkan untuk membedakan retry otomatis dari kegagalan permanen di UI. Jika ditolak, kodenya disimpan sebagai awalan `error_message`. |
| Q-21 | Nilai confidence per tier (5.4) dan `fuzzy_min_similarity = 0.5`. | **Placeholder.** Dikalibrasi bersama uji OCR (D-16, Tahap 6). |
| Q-22 | Merge global oleh sistem tetap satu transaksi (bukan job bertahap seperti domain model B-3)? | **Ya untuk MVP.** Ditinjau saat satu produk global punya lebih dari ~100 ribu record. |
| Q-23 | Konfirmasi struk: baris yang belum diputuskan wajib diputuskan, dengan opsi "lewati" (tanpa record)? | **Ya.** |
| Q-24 | Satu sesi aktif per household ditegakkan oleh `start_shopping_session` (tanpa unique index)? | **Ya.** |
| Q-25 | Setelah migration ada, `db/schema.sql` dijadikan snapshot hasil generate (CI memeriksa tidak ada drift), atau dihapus? | **Snapshot.** Tetap enak dibaca sebagai satu file. |
| Q-26 | Status unggahan (S-08): polling 5 detik atau Supabase Realtime? | **Polling** di MVP. Realtime butuh publikasi tabel dan pengujian RLS tersendiri. |
| Q-27 | Tambah `capture.captured_at` (jam di perangkat) untuk foto offline yang diunggah keesokan harinya? Tanpa kolom ini, tanggal default label = tanggal unggah. | **Ya, kecil.** D-59 membuat kasus ini nyata. Jika ditolak, user mengubah tanggal di S-11. |
| Q-28 | Teks alias = `receipt_line.raw_text` apa adanya? Kuantitas/harga yang ikut tercetak di baris yang sama akan masuk ke alias. | **Parser wajib memisahkan deskripsi item.** `raw_text` = teks item saja, sedangkan baris asli lengkap ada di `raw_ocr_text`. |
| Q-29 | Duplikat hash yang sudah dipilih "Tetap unggah" di klien tetap dicurigai di S-10 (1 ketukan lagi)? | **Ya.** Pilihan di klien tidak disimpan di server, dan D-50 melarang auto-save struk yang dicurigai duplikat. |
| Q-30 | Ekspor data pribadi (hak akses UU PDP) masuk MVP? Tidak ada di requirement. | **Tidak di MVP.** `receipt.pii` sudah terpisah, sehingga mudah ditambahkan nanti. |

### 9.3 Bagian yang belum bisa dirancang penuh

| Bagian | Yang kurang | Dampak ke 4b |
|---|---|---|
| Kalibrasi confidence dan ambang | Hasil uji OCR (D-16) | Nilai placeholder (Q-21). Struktur kode tidak berubah. |
| Kualitas redaksi PII | Engine OCR/AI final (Tahap 6) | Stub regex di 4b |
| Deploy worker dan pg_cron produksi | Hosting (Tahap 7) | Hanya lokal di 4b |
| Household multi-anggota | Pasca-MVP (D-04) | RPC mengasumsikan satu household per user. Jika user masuk ke lebih dari 1 household, `get_my_context` dan RPC tulis butuh parameter household eksplisit. Ini dicatat, tidak dibangun. |

---

Setelah draft ini disetujui (atau dikoreksi), Tahap 4b dimulai: migration, RPC, worker dengan stub, tools, test, dan instruksi menjalankan secara lokal.
