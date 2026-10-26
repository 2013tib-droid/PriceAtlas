# Menjalankan PriceAtlas Secara Lokal (backend Tahap 4b, frontend Tahap 5b)

> Dasar: `docs/05-backend-design.md` (§1.4 penjadwalan, §1.5 struktur repo, §5 pipeline, §7.7 rahasia, §8 test).
> Dua mode: **A** (PostgreSQL biasa + stub, tanpa Supabase) dan **B** (Supabase CLI).
> Tidak ada OCR/AI sungguhan (Tahap 6): extractor dan matcher AI memakai **stub berbasis fixture**. Frontend (`apps/web`, Tahap 5b) butuh mode B: lihat §4.

---

## 0. Prasyarat

| Alat | Versi | Mode |
|---|---|---|
| PostgreSQL server + klien (`psql`, `pg_dump`) | **17** (D-78; paket contrib, untuk `pg_trgm`, `btree_gist`, `dblink`). `pg_dump` harus versi mayor yang sama dengan server (snapshot dan `00_baseline_equivalence`). | A |
| Node.js | ≥ 22 | A, B |
| pnpm | 10 (`corepack enable`) | A, B |
| Supabase CLI + Docker | terbaru | B |

```bash
pnpm install
cp .env.example .env        # isi sesuai mode di bawah; .env tidak pernah di-commit
```

Semua skrip SQL memakai variabel libpq standar: `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`.

```bash
export PGHOST=localhost PGUSER=postgres PGPASSWORD=postgres
```

---

## 1. Peta repo

```
supabase/migrations/   sumber kebenaran skema (baseline = db/schema.sql Tahap 2b, lalu 0100…0900)
supabase/seed.sql      katalog contoh (AEON, Alfamart, Alfamidi, Shopee, Milo, Indomie, …)
db/schema.sql          snapshot hasil generate dari migration (D-72) — jangan diedit
db/tests/              harness SQL (L1): run.sh, build_db.sh, smoke.sql (43 test lama), flows/*
db/scripts/            dev-db.sh, snapshot.sh, privileges.sh, gen_inventory_test.sh
apps/worker/           worker Node.js: pipeline capture + job (stub extractor, fixture di test/fixtures)
apps/web/              PWA Next.js 16 (Tahap 5b): /masuk, layout (app), service worker; POST /api/account/delete
packages/contracts/    zod: input/output RPC, kode error, kontrak extra, unitPrice()
packages/ai-tools/     6 tool AI (skema + handler ke RPC), belum disambungkan ke Claude
packages/testkit/      utilitas test: DB uji + klien RPC ala PostgREST dengan JWT simulasi
packages/l4/           test L4 terhadap Supabase CLI (run.sh): hak akses, Storage, PTnnn → HTTP, OTP, worker
packages/db-types/     tipe database hasil `supabase gen types` (dibangkitkan + dicek drift di CI)
```

---

## 2. Mode A — PostgreSQL biasa + stub

Mode ini meniru Supabase secukupnya untuk menjalankan semua alur:

| Bagian Supabase | Pengganti di mode A |
|---|---|
| Role `anon`, `authenticated`, `service_role`, `auth.users`, `auth.uid()` | `db/tests/supabase_stub.sql` |
| Default privileges Supabase (F-09) | `ALTER DEFAULT PRIVILEGES` di stub |
| Storage (`storage.buckets`, `storage.objects`, `storage.foldername`) | tabel stub + policy asli dari migration 0150; file disimpan di folder lokal (`LocalBlobStore`) |
| PostgREST + JWT user | `PgRpcClient` (`packages/testkit`): transaksi per panggilan, `role = authenticated`, klaim `sub` |
| pg_cron | dilewati otomatis (migration 0900); worker `--dev-scheduler` memanggil fungsi yang sama |

### 2.1 Database pengembangan

```bash
db/scripts/dev-db.sh                 # buat ulang priceatlas_dev: stub + migration + user a/b/c + katalog
```

User uji (signup → household otomatis):

| Kode | User id | Email |
|---|---|---|
| `a` | `00000000-0000-0000-0000-00000000000a` | ani@example.com |
| `b` | `00000000-0000-0000-0000-00000000000b` | budi@example.com |
| `c` | `00000000-0000-0000-0000-00000000000c` | citra@example.com |

### 2.2 `.env` untuk mode A

```bash
DATABASE_URL=postgres://postgres:postgres@localhost:5432/priceatlas_dev
WORKER_DB_ROLE=service_role          # worker berjalan dengan hak yang sama seperti di Supabase
STORAGE_BACKEND=local
LOCAL_STORAGE_DIR=/tmp/priceatlas-storage   # pakai path absolut: skrip dan worker berjalan dari apps/worker
EXTRACTOR=stub
```

Muat ke shell sebelum menjalankan perintah di bawah:

```bash
set -a; source .env; set +a
```

### 2.3 Kirim fixture seolah dari aplikasi

`dev:submit` meniru klien (D-59, §5.2): menulis file ke folder lokal, menyisipkan baris `storage.objects` **sebagai user** (policy Storage ikut diuji), lalu memanggil `submit_capture` dengan JWT simulasi.

```bash
pnpm --filter @priceatlas/worker dev:submit struk-aeon               # user a
pnpm --filter @priceatlas/worker dev:submit shopee-milo --user b
pnpm --filter @priceatlas/worker dev:submit label-milo --session <shopping_session_id>
```

### 2.4 Menjalankan worker

```bash
pnpm --filter @priceatlas/worker start --once             # proses antrean sampai kosong lalu keluar
pnpm --filter @priceatlas/worker dev                      # long-running + --dev-scheduler (pengganti pg_cron)
```

Worker mendengarkan `NOTIFY capture_uploaded` dan polling tiap 5 detik sebagai cadangan. Log hanya berisi id, status, dan durasi (tidak pernah teks OCR, pii, atau gambar).

`--dev-scheduler` menjalankan fungsi SQL yang sama dengan `…0900_cron.sql`:

| Fungsi | Interval |
|---|---|
| `app.process_summary_queue(500)` | 10 detik |
| `app.run_sql_jobs(50)`, `app.reap_stale_runs()` | 1 menit |
| `app.enqueue_time_based_refresh()` | harian 17:05 UTC (00:05 WIB) |
| `app.promote_aliases()` | harian 17:20 UTC |
| `app.enqueue_retention()` | harian 17:35 UTC |

Sapuan unggahan yatim (`app.orphan_storage_objects` → hapus lewat BlobStore) dijalankan worker harian 17:50 UTC di semua mode.

### 2.5 Melihat hasil sebagai user

RPC dipanggil dengan klaim JWT simulasi (sama seperti yang dilakukan PostgREST):

```sql
-- psql -d priceatlas_dev
begin;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a"}', true);
set local role authenticated;
select x ->> 'kind', x ->> 'status', x ->> 'needs_check_count', x ->> 'saved_count' from public.list_captures() x;
select public.get_receipt((select id from public.receipt order by created_at desc limit 1));
commit;
```

Konfirmasi struk (S-10) dari psql, misalnya terima semua saran dan lewati baris tanpa saran:

```sql
begin;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a"}', true);
set local role authenticated;
select public.confirm_receipt(r.id, (
  select jsonb_agg(jsonb_build_object('line_id', l ->> 'id',
                                      'action', case when l -> 'suggestion' = 'null' then 'skip' else 'accept' end))
    from jsonb_array_elements(public.get_receipt(r.id) -> 'lines') l
   where (l ->> 'needs_check')::boolean))
  from public.receipt r order by r.created_at desc limit 1;
commit;
```

Ringkasan harga menyusul lewat antrean (`--dev-scheduler`, atau manual: `select app.process_summary_queue();` sebagai superuser).

Dari UI (M3): S-08 "Perlu dicek" atau S-09 "Cek sekarang" membuka S-10 `/struk?id=` (struk) atau S-11 `/konfirmasi?capture=` (label/screenshot). Butuh mode B (§4); keputusan di UI menghasilkan panggilan yang sama dengan SQL di atas (`confirm_receipt`, `update_capture_item`, `confirm_capture_items`).

### 2.6 Fixture stub

Fixture ada di `apps/worker/test/fixtures/` (dipakai juga oleh test L3). Satu fixture = satu file JSON + file gambar. Gambar dipetakan ke fixture lewat **sha256 gambar posisi 1**, sehingga isi file gambar menentukan hasil "OCR".

| Fixture | Jenis | Hasil yang diharapkan |
|---|---|---|
| `struk-aeon` | struk AEON BSD | `needs_confirmation`: Milo (barcode) auto-save dengan diskon member → promo + `member_hint`; Indomie dan SNACK (saran AI tier 4) perlu konfirmasi; pii terpisah |
| `label-milo` | label harga | Milo 200 g (barcode, promo aktif) auto-accept jika toko diketahui (sesi/manual); Milo 3in1 harga member menunggu konfirmasi |
| `shopee-milo` | screenshot marketplace | toko Shopee dari `store_hint`, seller global "Nestle Official Store", ongkir di `extra`; tier fuzzy confidence 1 → **auto-save** (`done`). Unggahan kedua file yang sama = duplikat hash → `needs_confirmation` (D-71, dipakai e2e alur 5) |
| `struk-buram` | struk | gagal permanen `blurry` |
| `struk-alfamart-timeout` | struk Alfamart Serpong | 2× gagal sementara → retry otomatis dengan backoff (30 dtk, 2 mnt) → sukses dan auto-save penuh |

Bentuk file fixture:

```jsonc
{
  "images": ["struk-aeon.jpg"],          // file di folder yang sama; atau beri nama file JSON = <sha256>.json
  "raw_text": "teks OCR mentah",         // disimpan di processing_run.raw_ocr_text
  "output": { "kind": "receipt", … },    // ParsedReceipt / ParsedObservation (packages/contracts/src/parsed.ts)
  "failures": [{ "type": "transient" }, { "type": "permanent", "code": "blurry" }],   // per percobaan ke-n
  "ai_matches": { "SNACK XYZ": { "product_id": "…", "confidence": 0.62 } },          // tier 4 stub
  "usage": { "inputTokens": 0, "outputTokens": 0, "costUsd": 0 }
}
```

Gambar tanpa fixture → `PermanentError('unsupported')`. Untuk fixture baru: buat file gambar apa saja (isinya harus unik), lalu JSON dengan `images` menunjuk file itu. Direktori lain bisa dipakai lewat `STUB_FIXTURES_DIR`.

### 2.7 Test

```bash
bash db/tests/run.sh                  # L1: smoke (43, tidak diubah) + flows/*, satu DB baru per file
bash db/tests/run.sh 70_              # hanya flow yang namanya memuat "70_"
pnpm -r --workspace-concurrency=1 test   # L2 + L3 + L5a/L5b web (membangun DB uji sendiri: priceatlas_l2_*, priceatlas_l3_*)
pnpm -r typecheck
bash db/scripts/snapshot.sh --check   # db/schema.sql tanpa drift
bash scripts/check-secrets.sh
```

Setelah mengubah migration:

```bash
bash db/scripts/snapshot.sh                 # tulis ulang db/schema.sql
bash db/scripts/gen_inventory_test.sh       # tulis ulang whitelist hak akses 99_*, lalu TINJAU diff-nya
pnpm --filter @priceatlas/db-types gen      # butuh mode B (§3.5); CI memeriksa drift
```

Test L1 `60_public_share.sql` dan `70_capture_pipeline.sql` membuka sesi kedua lewat `dblink` ke database yang sama (`dbname=… user=postgres`, koneksi socket lokal). Server harus mengizinkan koneksi lokal itu tanpa kata sandi (default image Docker `postgres` dan paket Ubuntu dengan `peer` untuk user `postgres`). Socket dicari di direktori default libpq server itu: jika biner PostgreSQL berasal dari paket lain (mis. biner portabel yang memakai `/tmp`), jalankan server dengan `-k /var/run/postgresql,/tmp`.

---

## 3. Mode B — Supabase CLI

> Diverifikasi otomatis oleh job CI `supabase-e2e` (D-78, Tahap 5b M0): `supabase start`, test L4, `supabase gen types` + cek drift, dan e2e Playwright. Lingkungan cloud pembuatan M0 tidak bisa menarik image Docker (CDN registry diblokir), jadi langkah ini belum pernah dijalankan di sana; temuan dari CI dicatat sebagai F-25 dst. di `docs/07-frontend-design.md` §1.4.

### 3.1 Menyalakan Supabase lokal

```bash
supabase start          # PostgreSQL 17 (D-78); menerapkan supabase/migrations/* lalu supabase/seed.sql
supabase status -o env  # API_URL, ANON_KEY, SERVICE_ROLE_KEY, DB_URL
```

Perbedaan dengan mode A:
- Stub **tidak** dipakai: `auth`, `storage`, role, dan default privileges asli dari Supabase.
- `pg_cron` tersedia, jadi migration 0900 membuat jadwal. Worker **tidak** perlu `--dev-scheduler`.
- Bucket `captures` didefinisikan di `supabase/config.toml` dan di migration 0150 (idempoten).
- Login: email OTP berisi **kode 6 digit saja** (template Indonesia `supabase/templates/otp.html`, F-20, D-83). Email lokal ditangkap **Mailpit** (`[local_smtp]`, F-18): UI di `http://127.0.0.1:54324`, API `GET /api/v1/messages`.
- Google **mati** secara default (F-21). Untuk mencobanya: isi `GOOGLE_OAUTH_CLIENT_ID/SECRET`, lalu `SUPABASE_AUTH_EXTERNAL_GOOGLE_ENABLED=true supabase start`. Jangan memakai `env(...)` untuk nilai boolean di `config.toml`: nilai kosong membuat CLI gagal membaca config.

### 3.2 `.env` untuk mode B

```bash
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=<ANON_KEY>
SUPABASE_SERVICE_ROLE_KEY=<SERVICE_ROLE_KEY>      # server-only
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres   # koneksi sesi (LISTEN)
WORKER_DB_ROLE=service_role                        # F-22: hak worker sama dengan mode A dan produksi
STORAGE_BACKEND=supabase
EXTRACTOR=stub
```

`WORKER_DB_ROLE=service_role` membuat worker terhubung sebagai `postgres` lalu berganti role lewat parameter startup `-c role=service_role` (`apps/worker/src/db.ts`). Tanpa itu worker berjalan sebagai pemilik objek dan bug hak akses worker bisa lolos (F-22). Test L4 memeriksa bahwa `postgres` bisa memakai `service_role` di database Supabase. Apakah pooler produksi (Supavisor) meneruskan parameter startup itu diperiksa di Tahap 7; jika tidak, ganti ke `SET ROLE` setelah connect.

### 3.3 Alur manual

1. Daftar user lewat OTP (Studio → Authentication, atau `supabase.auth.signInWithOtp`). Trigger `on_auth_user_created` membuat profile + household.
2. Ambil `household_id` user: `select household_id from household_member where user_id = '<uid>'`.
3. Unggah file fixture (mis. `apps/worker/test/fixtures/struk-aeon.jpg`) ke bucket `captures` di path `{household_id}/{capture_id}/1.jpg` dengan JWT user (Studio, atau `supabase.storage.from('captures').upload(...)`).
4. Panggil `submit_capture` dengan JWT user:

   ```bash
   curl -X POST "$NEXT_PUBLIC_SUPABASE_URL/rest/v1/rpc/submit_capture" \
     -H "apikey: $NEXT_PUBLIC_SUPABASE_ANON_KEY" -H "Authorization: Bearer <access_token user>" \
     -H "Content-Type: application/json" \
     -d '{"p_capture_id":"<uuid>","p_kind":"receipt",
          "p_images":[{"position":1,"ext":"jpg","sha256":"<sha256sum file>","byte_size":<ukuran>}]}'
   ```

5. Jalankan worker: `pnpm --filter @priceatlas/worker start` (tanpa `--dev-scheduler`).
6. Lihat hasil lewat RPC `list_captures`, `get_receipt`, `get_capture_items` dengan JWT user. Error RPC kembali sebagai HTTP sesuai kode (`PT409` → 409, dst.).

### 3.4 Route Handler hapus akun

```bash
pnpm --filter @priceatlas/web dev
# POST http://localhost:3000/api/account/delete  body {"confirm":"HAPUS AKUN"}, cookie sesi user,
# login ≤ 15 menit terakhir → 202; selain itu 401 REAUTH_REQUIRED.
```

Job `delete_household` lalu dikerjakan worker (hapus file Storage, cascade data, fakta publik anonim tetap).

### 3.5 Tipe database

```bash
pnpm --filter @priceatlas/db-types gen     # supabase gen types typescript --local --schema public
```

File hasil di-commit. Job CI `supabase-e2e` membangkitkan ulang dan gagal jika berbeda (F-19, D-78): setelah mengubah migration, jalankan perintah ini lalu commit.

### 3.6 Test L4

Diotomasi di job CI `supabase-e2e` (D-78). Manual, setelah `supabase start`:

```bash
set -a; source <(supabase status -o env); set +a
export NEXT_PUBLIC_SUPABASE_URL=$API_URL NEXT_PUBLIC_SUPABASE_ANON_KEY=$ANON_KEY \
       SUPABASE_SERVICE_ROLE_KEY=$SERVICE_ROLE_KEY SUPABASE_DB_URL=$DB_URL
pnpm --filter @priceatlas/l4 test:l4
```

| Bagian | Isi |
|---|---|
| SQL | `db/tests/flows/99_privilege_inventory.sql` terhadap DB Supabase asli (default privileges asli); `packages/l4/sql/l4_supabase.sql`: `postgres` bisa memakai `service_role` (F-22), zona waktu `Asia/Jakarta`, bucket + policy `captures`, 6 jadwal pg_cron, trigger signup, extension di schema `extensions` |
| HTTP | OTP lewat Mailpit (subjek + isi template, kode salah ditolak, R1 setelah login); `PT404/409/422` → HTTP + `parseRpcError`; anon tidak bisa RPC; policy Storage (folder sendiri/lain, kedalaman path, upsert, baca user lain, signed URL, hapus oleh user, tipe file); worker `--once` dengan `WORKER_DB_ROLE=service_role` sampai `needs_confirmation` |

---

## 4. Frontend (`apps/web`, Tahap 5b)

Frontend butuh Supabase asli (Auth, PostgREST, Storage), jadi jalankan **mode B** dulu (§3). Arsitektur: `docs/07-frontend-design.md` (D-79–D-83).

### 4.1 Menjalankan

```bash
supabase start
cat > apps/web/.env.local <<ENV
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=<ANON_KEY dari supabase status>
SUPABASE_SERVICE_ROLE_KEY=<SERVICE_ROLE_KEY>     # hanya Route Handler /api/account/delete
ENV
pnpm --filter @priceatlas/web dev                # http://localhost:3000 → /masuk
```

Login: ketik email di `/masuk`, ambil kode 6 digit dari Mailpit (`http://127.0.0.1:54324`), ketik di app. User baru otomatis mendapat household (trigger signup). Google mati di lokal kecuali diaktifkan (§3.1).

Service worker **mati** di `next dev` (cache membingungkan saat develop). Untuk mencobanya: `NEXT_PUBLIC_SW_DEV=1 pnpm --filter @priceatlas/web dev`, atau build produksi:

```bash
pnpm --filter @priceatlas/web build && pnpm --filter @priceatlas/web start
```

Menguji di HP sungguhan butuh HTTPS (kamera, `crypto.randomUUID`, service worker; P-10): `pnpm --filter @priceatlas/web dev --experimental-https` atau tunnel HTTPS.

### 4.2 Pemeriksaan

```bash
pnpm --filter @priceatlas/web lint            # ESLint flat + jsx-a11y (D-80)
pnpm --filter @priceatlas/web format:check    # Prettier (format: pnpm --filter @priceatlas/web format)
pnpm --filter @priceatlas/web typecheck       # app + service worker (tsconfig.sw.json)
pnpm --filter @priceatlas/web test            # L5a unit + L5b komponen (vitest, jsdom; termasuk audit axe test/m7/a11y.test.tsx)
pnpm --filter @priceatlas/web test:browser    # L5c browser (vitest browser mode + Chromium Playwright; PW_CHROMIUM_PATH opsional)
pnpm --filter @priceatlas/web build && pnpm --filter @priceatlas/web check:bundle   # tanpa service role, anggaran JS
pnpm --filter @priceatlas/web test:e2e        # Playwright (butuh Supabase lokal + env service role untuk test)
```

e2e memakai `next start` (Playwright menyalakannya), env `NEXT_PUBLIC_SUPABASE_*` dan `SUPABASE_SERVICE_ROLE_KEY` (hanya proses test, untuk `auth.admin.generateLink`), dan `MAILPIT_URL`. Tanpa `SUPABASE_SERVICE_ROLE_KEY`, test yang butuh Supabase dilewati; yang tetap jalan tanpa Supabase: shell offline tanpa sesi, axe di S-00a + `/offline`, dan cek PWA bisa dipasang (`e2e/a11y.spec.ts`, M7). Browser lain: `PW_CHROMIUM_PATH=<path chromium>`.

Tanpa Supabase sama sekali, `next build`/`next start` tetap butuh nilai `NEXT_PUBLIC_SUPABASE_URL` dan `NEXT_PUBLIC_SUPABASE_ANON_KEY` (boleh tiruan, mis. `http://127.0.0.1:54321` + `dummy`); tanpa itu `proxy.ts` membalas 500.

`check:bundle` mencetak JS halaman `/` gzip dengan rincian modul vs polyfill `noModule` (polyfill hanya dimuat browser lama). Anggaran 200 KiB tetap **peringatan** (D-84; hasil ukur M7: `docs/07` §1.11, F-94).

### 4.3 Peta `apps/web`

| Path | Isi |
|---|---|
| `proxy.ts`, `lib/auth/proxy-rules.ts` | Segarkan sesi (`getClaims`), alihkan **navigasi dokumen** tanpa sesi ke `/masuk?next=`. Permintaan non-navigasi (precache service worker) mendapat shell statis apa adanya. |
| `app/auth/callback/route.ts` | PKCE Google (D-79). Tidak memakai service role. |
| `app/(auth)/masuk`, `features/auth` | S-00a: email → kode 6 digit → R1 → `?next` |
| `app/(app)/layout.tsx`, `components/app` | Penjaga sesi di klien, `TabBar`, `OfflineStrip`, sheet foto (kerangka) |
| `lib/data/rpc.ts` | `rpcCall`: validasi input `RPC_INPUTS` (contracts) → `supabase.rpc` → `parseRpcError` → `AppError` |
| `lib/copy/id.ts` | Semua teks UI + pesan untuk setiap `ErrorCode`, SQLSTATE, Route, `capture.error_code` |
| `lib/format` | Rupiah, harga per satuan, tanggal di zona household |
| `lib/data/query-client.ts`, `lib/offline/db.ts` | TanStack Query + persist ke IndexedDB `priceatlas:<user_id>` (data struk tidak di-persist) |
| `app/sw.ts`, `app/serwist/[path]/route.ts`, `lib/offline/sw-rules.ts` | Service worker Serwist (`/serwist/sw.js`): precache aset, shell network-first + `/offline`; Supabase, `/api`, `/auth` tidak pernah di-cache |
| `app/(app)/(cari)`, `features/search`, `features/home` | M1: S-01 + S-02 berbagi `SearchLayout` (SearchDock tetap terpasang; `q` ditulis ke URL setelah 250 ms) |
| `app/(app)/produk/*`, `features/product`, `features/sizes`, `features/cheaper` | M1: S-03 (+ S-03b `?sheet=cek-harga`), S-04 `/produk/ukuran?group=`, S-05 `/produk/hemat?id=\|group=` |
| `app/(fullscreen)/kamera`, `features/scan`, `lib/media/barcode.ts` | Layar penuh tanpa tab bar; M1 hanya `jenis=barcode` (BarcodeDetector, D-58) |
| `lib/data/queries.ts`, `lib/data/rest.ts` | Hook per RPC (`qk.rpc`, skema kontrak di dev/test) dan REST S-01 (`price_record_view`, hitung `capture`) |
| `app/(fullscreen)/kamera` (`jenis=struk\|screenshot`), `features/capture` | M2: S-07 kamera struk (`<input capture>`), ThumbStrip, S-07b galeri, dialog duplikat U-10; sheet S-06 di `components/app/photo-sheet.tsx` (`?sheet=foto`) |
| `lib/media/*` | M2: pipeline gambar §6 (pembaca EXIF/ukuran sendiri, aturan lewati §6.3, kompresi Web Worker/OffscreenCanvas, sha256, `capture_id`). Dimuat lewat dynamic import dari S-07. |
| `lib/offline/outbox*.ts`, `uploader.ts`, `runner.ts` | M2: antrean foto IndexedDB (`outbox`, `outbox_blobs`) + state machine §5.4 + pemicu + kunci satu tab |
| `app/(app)/unggahan`, `features/uploads`, `lib/data/captures.ts` | M2: S-08 (`/unggahan?jenis=`), S-09 (`/unggahan/detail?id=`), pemantau status global, hook R13/R14/W2/W3/signed URL |
| `app/(app)/struk`, `features/receipt` | M3: S-10 konfirmasi / detail struk (`/struk?id=`) |
| `app/(app)/konfirmasi`, `features/observation` | M3: S-11 konfirmasi label & screenshot (`/konfirmasi?capture=`), antrean W18 `lib/confirm/item-patch.ts` |
| `app/(app)/lokasi`, `features/location` | M3: S-12 pilih toko & cabang (`/lokasi?mode=manual\|koreksi&untuk=&kembali=`), hasil lewat `lib/confirm/location-handoff.ts` |
| `features/picker`, `app/(app)/produk/baru`, `features/new-product` | M3: S-14 lapisan `?pilih=produk&untuk=…`, S-15 `/produk/baru` (react-hook-form + zod dari kontrak) |
| `lib/data/confirm.ts`, `lib/confirm/*` | M3: hook R15/R16/R17/R21, W4/W5/W7/W8/W16/W17/W18, REST PATCH receipt + store/branch/category; logika baris, field ragu, beda ukuran, pemetaan error §8.2 |
| `app/(app)/belanja`, `features/shopping`, `components/app/session-banner.tsx` | M4: S-13 sesi belanja (`/belanja`) dan banner sesi di atas tab bar (U-13) |
| `features/capture/label-camera.tsx`, `lib/media/frame.ts` | M4: kamera label `/kamera?jenis=label` (jendela bidik `getUserMedia`, frame → canvas → pipeline §6) |
| `lib/data/session.ts`, `lib/session/*` | M4: hook R18/W11/W12/W13; logika sesi (waktu, label per foto, pembanding `vs_best_pct`, sesi diingat, urutan U-08), error §8.2, sasaran label (sesi / lokasi manual) |
| `app/(app)/harga`, `features/record` | M5: S-16 detail & koreksi harga (`/harga?id=`): R20, W6, editor baris struk W7 (`features/receipt/line-edit-dialog.tsx`) |
| `app/(app)/produk/{gabung,pisah,edit}`, `features/catalog` | M5: S-17 gabungkan (`/produk/gabung?id=&ke=`), S-18 pisahkan (`/produk/pisah?id=`), S-15 edit + hapus produk (`/produk/edit?id=`) |
| `lib/data/catalog.ts`, `lib/catalog/*` | M5: hook R19/R20/W6/W9/W10 + REST `product` (baca + PATCH filter `updated_at`); logika patch S-16, error §8.2, pratinjau merge, split T1/T2, form edit, riwayat audit |
| `app/(app)/selamat-datang`, `features/onboarding` | M6: S-00b `/selamat-datang?next=` (semua login lewat sini; diteruskan jika sudah onboarded), S-00c `/selamat-datang/member` |
| `app/(app)/saya/*`, `features/me` | M6: S-19 `/saya` (nama, ringkasan, Keluar), S-19b `/saya/member`, S-19c `/saya/berbagi`, Privasi & hapus akun `/saya/privasi` |
| `lib/data/settings.ts`, `lib/settings/*`, `lib/catalog/barcodes.ts` | M6: hook W14/W15/W16, REST PATCH `profile`, REST `barcode_assignment` (select + insert, D-89), `POST /api/account/delete`; logika program member, Keluar/hapus akun, onboarding, barcode S-15 edit |
| `lib/offline/prefs.ts`, `lib/hooks/use-pref.ts` | 💾 di IndexedDB `prefs`: pencarian terakhir (8), baru dicek (150, untuk R5), toggle "Hanya harga normal", sesi belanja aktif terakhir (`last_session`, teks "berakhir otomatis" S-13), status onboarding (`onboarded`, M6), ajakan pasang iOS (`install_prompt`, M7) |
| `lib/offline/offline-cards.ts`, `lib/data/offline-cache.ts` | M7: cache produk R5 (`get_offline_cache`) di store `offline_cards` + pencarian offline (normalisasi + pencocokan kata); `OfflineCacheSync` di layout (app) |
| `app/(app)/tanya`, `features/ask`, `lib/ask/ask.ts` | M7: S-20 Tanya kerangka (`/tanya?q=`): `AskMessage`, `ToolSource`, `ExampleChips`; kirim nonaktif sampai Tahap 6 (D-57) |
| `components/app/install-prompt.tsx`, `lib/offline/install.ts` | M7: `storage.persist()` + ajakan "Pasang ke layar utama" iOS setelah foto pertama (Q-62) |
| `components/app/sw-update.tsx`, `lib/offline/sw-rules.ts` | Banner "Versi baru tersedia" (P-12): SW baru menunggu antrean kosong + "Muat ulang"; M7: cek versi saat app kembali terlihat (maks. 1× per jam) |

### 4.4 Fixture dan data e2e (M1)

| Bagian | Isi |
|---|---|
| `apps/web/test/fixtures/rpc.json` | Keluaran RPC **asli** dari database mode A (`test/fixtures/scenario.ts`: katalog seed + record harga Ani, Budi tanpa histori). Dipakai test komponen L5b. `test/fixtures.l3.test.ts` (butuh PostgreSQL, ikut `pnpm -r test`) memeriksa setiap keluaran lolos skema kontrak dan bentuknya sama dengan file yang di-commit. Setelah RPC/kontrak berubah: `UPDATE_FIXTURES=1 pnpm --filter @priceatlas/web exec vitest run test/fixtures.l3.test.ts`, lalu tinjau diff. Untuk **menambah** kunci baru tanpa mengubah nilai yang sudah di-commit (test M4 memakai jam sesi dari fixture, F-75): `UPDATE_FIXTURES=new …`. Setelah itu `pnpm --filter @priceatlas/web exec prettier --write test/fixtures/rpc.json`. |
| `apps/web/e2e/support/seed.ts` | `supabase/seed.sql` hanya katalog. e2e alur 1–2 menambah histori harga untuk household user e2e lewat **service role di proses test** (bukan kode klien, D-61), lalu menunggu `price_summary` dari pg_cron (≤ 10 dtk). Migration tidak diubah. |

### 4.5 Antrean foto, worker di e2e, dan mencoba unggah lokal (M2)

**Alur di klien** (`docs/07` §5.4, §6): foto → `prepareImage` (EXIF → aturan lewati §6.3 → kompresi → sha256) → item + byte disimpan di IndexedDB `priceatlas:<user_id>` (`outbox`, `outbox_blobs`) → cek hash `capture_image` → unggah ke `captures/{household_id}/{capture_id}/{position}.{ext}` (`upsert: false`, JWT user) → `submit_capture` → byte dihapus → item dihapus setelah `list_captures` memuatnya. Antrean diproses saat app dibuka, saat `online`, saat tab kembali terlihat, setelah foto baru, dan dengan backoff 5 dtk / 30 dtk / 2 mnt / 10 mnt selama app terbuka; hanya satu tab (Web Locks). Melihat isi antrean: DevTools → Application → IndexedDB → `priceatlas:<user_id>` → `outbox`.

**Mencoba dengan Supabase lokal (mode B):**

```bash
supabase start
# apps/web/.env.local seperti §4.1
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres WORKER_DB_ROLE=service_role \
STORAGE_BACKEND=supabase EXTRACTOR=stub NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 \
SUPABASE_SERVICE_ROLE_KEY=<SERVICE_ROLE_KEY> pnpm --filter @priceatlas/worker start
pnpm --filter @priceatlas/web dev
```

Lalu di app: tombol kamera → "Pilih dari galeri" → `apps/worker/test/fixtures/struk-aeon.jpg` → Selesai → tab Unggahan: dalam beberapa detik "Perlu dicek (1)". `struk-buram.jpg` → Gagal "Gambar buram atau terpotong."; `struk-alfamart-timeout.jpg` → gagal sementara 2× lalu selesai (backoff 30 dtk + 2 mnt). Fixture ini bukan JPEG sungguhan dan diunggah apa adanya (F-40), sehingga sha256 cocok dengan stub. Foto JPEG/PNG sungguhan tanpa fixture → worker `unsupported` (Gagal "Format gambar ini belum bisa dibaca.").

Offline: DevTools → Network → Offline (atau mode pesawat di HP) → foto → S-08 "Menunggu sinyal" → online → terunggah otomatis. Service worker hanya aktif di build produksi atau `NEXT_PUBLIC_SW_DEV=1` (§4.1).

**Worker di e2e (CI).** Job `supabase-e2e` menyalakan worker stub di latar (`pnpm --filter @priceatlas/worker start`, `EXTRACTOR=stub`, `WORKER_DB_ROLE=service_role`, `STORAGE_BACKEND=supabase`) sebelum Playwright, lalu mencetak log worker. e2e M2: `e2e/upload.spec.ts` (alur 3 sampai `needs_confirmation`, G buram + Ulangi, G timeout → retry otomatis) dan `e2e/offline-queue.spec.ts` (O, Chromium). Helper test `e2e/support/captures.ts` memakai service role **di proses test saja** (membaca capture, memundurkan waktu `processing_run` untuk melewati jeda backoff); migration dan logika worker tidak diubah.

**Fixture R13/R14.** `apps/web/test/fixtures/scenario.ts` menjalankan pipeline worker asli (mode A, `LocalBlobStore`) untuk user Citra sampai setiap status capture, lalu menyimpan keluaran `list_captures`/`get_capture` di `rpc.json` (dibangkitkan ulang seperti §4.4).

**Lingkungan tanpa Docker.** Jika `supabase start` tidak bisa (CDN image diblokir), e2e bisa dicoba terhadap tiruan kecil Supabase (auth OTP, subset PostgREST, Storage) di atas database mode A (`db/scripts/dev-db.sh priceatlas_e2e`) + worker mode A (`STORAGE_BACKEND=local`, `--dev-scheduler`), lalu `PW_NO_SERVER` tidak diisi dan `NEXT_PUBLIC_SUPABASE_*` menunjuk ke tiruan itu. Tiruan ini tidak di-commit (bukan pengganti Supabase asli); verifikasi resmi tetap job `supabase-e2e` (docs/07 §1.6).

### 4.6 Konfirmasi struk dan label dari UI (M3)

**Alur** (`docs/07` §1.7): S-08 "Perlu dicek" → S-10 (struk) / S-11 (label, screenshot). S-10: Benar / Ganti (S-14, lapisan `?pilih=produk`) / Bukan produk / ⋯ bundle / Lewati → "Simpan N harga" (W4) → toast + "Ringkasan sedang diperbarui…" sampai `price_summary.refreshed_at` menyusul (pg_cron, ± 10 dtk). Toko belum dikenali / ubah toko → S-12 → kembali → `PATCH receipt` (filter `updated_at`). S-11: setiap perubahan harga/tanggal/lokasi/produk dikirim lewat W18 (jeda 600 ms) dan "Dihitung untukmu" diperbarui dari R16 `computed`; Simpan → W5.

**Mencoba (mode B):** jalankan Supabase + worker stub + web seperti §4.5, unggah `struk-aeon.jpg` → tab Unggahan → "Perlu dicek" → S-10. Unggah file yang sama lagi → dialog "Foto ini sudah pernah diunggah … (struk AEON BSD)" → "Tetap unggah" → S-10 struk baru menampilkan banner duplikat. `shopee-milo.jpg` pertama tersimpan otomatis; unggah lagi → S-11 dengan ongkir sebagai info. Isi struk (R15) dan item (R16) tidak di-persist ke IndexedDB (DevTools → IndexedDB → `qcache` tidak memuat `get_receipt`/`get_capture_items`).

**Fixture R15/R16/R17.** `apps/web/test/fixtures/scenario.ts` menjalankan pipeline worker asli (mode A) untuk Citra: struk-aeon, struk-aeon lagi (duplikat), struk tanpa toko + field ragu (fixture tambahan khusus web di `apps/web/test/fixtures/worker/`, digabung dengan fixture worker di folder sementara; fixture dan logika worker tidak diubah), label-milo, shopee-milo (auto-save + unggahan kedua), lalu memanggil R15/R16/R17/R21, W4/W5/W8/W17/W18 (sukses dan error) dan REST store/branch/category sebagai user. Dibangkitkan ulang seperti §4.4 (`UPDATE_FIXTURES=1 …`, lalu `prettier --write test/fixtures/rpc.json`).

**e2e.** `e2e/confirm.spec.ts`: alur 3 (S-10 sampai harga tampil di S-02/S-03 dan S-10 mode tersimpan dari S-09), 3b (dialog U-10 → banner → buang), 5 (screenshot → S-11 → simpan). Jalan di job `supabase-e2e` (Chromium + WebKit) bersama worker stub. Data tambahan e2e hanya lewat helper test (`e2e/support/captures.ts`, service role di proses test).

### 4.7 Sesi belanja dan kamera label dari UI (M4)

**Alur** (`docs/07` §1.8): tab Belanja (S-13) → "Mulai belanja" → S-12 mode sesi (`/lokasi?mode=sesi`: toko → cabang; cabang tutup tidak bisa dipilih, tanpa "Tidak tahu cabangnya", "+ Cabang baru" cepat) → W11 → S-13 aktif + banner "● Belanja di AEON BSD · 0m · 0 label [Foto label]" di semua layar (app). "Foto label" (banner, S-13, atau sheet foto yang kini menaruh "Label harga" di atas) → kamera label `/kamera?jenis=label`: jendela bidik tetap terbuka, setiap shutter = satu capture label dengan `shopping_session_id` sesi aktif → antrean → W1. S-13 menampilkan kartu per foto (diproses / gagal dibaca / perlu dicek → S-11 / tersimpan dengan harga, label, dan pembanding `vs_best_pct`), "Perpanjang" saat sisa < 30 mnt (W12, +2 jam), "Akhiri sesi" (W13). Tanpa sesi, "Label harga" di sheet → S-12 mode manual (`untuk=label`) → kamera label dengan lokasi manual (`toko`, `cabang`).

**Mencoba (mode B):** jalankan Supabase + worker stub + web seperti §4.5. Kamera butuh secure context: `localhost` di desktop, atau HTTPS di HP (§4.1). Di desktop tanpa kamera: izin ditolak / kamera tidak ada → "Pilih dari galeri"; pilih `apps/worker/test/fixtures/label-milo.jpg` → dalam beberapa detik kartu "perlu dicek" (Milo 200 g tersimpan otomatis karena lokasi dari sesi, Milo 3in1 menunggu konfirmasi) → S-11 → Simpan → kartu tersimpan. Foto kamera sungguhan tidak punya fixture stub → "gagal dibaca" (`unsupported`). Kamera palsu Chromium untuk mencoba jendela bidik:

```bash
node --experimental-strip-types -e "import('./apps/web/e2e/support/fake-camera.ts').then(m => console.log(m.writeFakeCameraFile()))"
chromium --use-fake-device-for-media-stream --use-fake-ui-for-media-stream \
  --use-file-for-fake-video-capture=<path .y4m di atas> http://localhost:3000/belanja
```

"Hampir kedaluwarsa" tanpa menunggu 3,5 jam (data lokal saja): `update public.shopping_session set expires_at = now() + interval '20 minutes' where id = '<id>';` lalu buka ulang tab Belanja (S-13 selalu memuat ulang R18 saat dibuka). Sesi kedaluwarsa: set `expires_at` ke masa lalu → banner hilang dalam ≤ 15 dtk, S-13 menulis "Sesi di … berakhir otomatis pukul …".

**Fixture R18/W11/W12/W13.** `apps/web/test/fixtures/scenario.ts` (`collectSessions`, user Ani, dijalankan paling akhir supaya fixture M1–M3 tidak berubah): tanpa sesi, W11 `BRANCH_CLOSED` (AEON Lama), mulai + ulang id yang sama, label-milo dengan sesi lewat pipeline worker asli (uploaded → needs_confirmation), label-milo lagi (duplikat hash) diterima → done, gambar tanpa fixture → failed, satu capture diklaim → processing, R18 sebelum dan sesudah antrean ringkasan (F-60), hampir kedaluwarsa (`expires_at` dimajukan, data test), W12, W13 (+ ulang), `SESSION_NOT_ACTIVE` setelah berakhir dan setelah kedaluwarsa. Dibangkitkan ulang seperti §4.4.

**e2e.** `e2e/session.spec.ts` (alur 4) di job `supabase-e2e`. Chromium memakai kamera palsu: `playwright.config.ts` membangkitkan file Y4M 1280×720 (`e2e/support/fake-camera.ts`, sisi test, tidak di-commit sebagai biner) dan memberi `--use-fake-device-for-media-stream --use-fake-ui-for-media-stream --use-file-for-fake-video-capture=…` + izin `camera`. Frame kamera palsu diperiksa sampai capture terdaftar dengan sesi yang benar (JPEG ≤ 2048 px, sha256 cocok) dan tampil "gagal dibaca" (stub memetakan fixture lewat sha256, F-63); isi kartu dari label-milo lewat galeri di kamera label yang sama. WebKit tidak punya kamera palsu: langkah shutter dilewati (F-64). Helper `e2e/support/session.ts` (service role di proses test) membaca sesi/capture/gambar dan memajukan `expires_at` untuk "Perpanjang"; migration, RPC, dan logika worker tidak diubah.

### 4.8 Koreksi & katalog dari UI (M5)

**Alur** (`docs/07` §1.9): detail produk (S-03) → tap baris histori → S-16 `/harga?id=` (juga dari baris struk tersimpan di S-10). Label/screenshot: ubah harga, tanggal, toko/cabang (S-12 mode koreksi), bundle, info tambahan → "Simpan perubahan" (W6 dengan `p_expected_updated_at`) → "Ringkasan sedang diperbarui…" sampai `price_summary.refreshed_at` menyusul (pg_cron). Record struk: angka terkunci; "Ubah baris struk" (W7) atau "Buka struk" (header S-10). "Ganti produk" → S-14 (+ tawaran alias). "Batalkan data ini" = status `void`. Menu ⋯ S-03 (produk privat): Edit (`/produk/edit`), Gabungkan (`/produk/gabung`: pilih tujuan → pratinjau R19 → beda ukuran = tekan dua kali / "Pindahkan ke group" → W10), Pisahkan (`/produk/pisah`: produk tujuan baru/yang ada → centang harga → alias → W9), Hapus produk (arsip). Produk katalog umum: Pisahkan saja.

**Mencoba (mode B):** jalankan Supabase + worker stub + web seperti §4.5. Data contoh cepat untuk user yang sedang login (SQL Studio / psql, data lokal saja):

```sql
-- household user lokal → tiga harga label Milo 200 g (produk katalog seed)
with h as (select household_id as id from public.household_member limit 1)
insert into public.price_record (household_id, product_id, store_id, branch_id, source_type, transaction_date,
                                 normal_price, effective_price, price_basis)
select h.id, '70000000-0000-0000-0000-000000000200', '20000000-0000-0000-0000-000000000001',
       '30000000-0000-0000-0000-000000000001', 'price_label', current_date - d, 19500, 19500, 'normal'
  from h, generate_series(1, 3) d;
```

Lalu buka `/produk?id=70000000-0000-0000-0000-000000000200` → baris histori → S-16. **Konflik dua tab:** buka record yang sama di dua tab, simpan di tab kedua, lalu simpan di tab pertama → "Data ini baru saja berubah di tempat lain…" dan perubahan yang masih berlaku ditampilkan lagi. Detail record (R20) tidak di-persist ke IndexedDB (`qcache` tidak memuat `price_record_detail`).

**Fixture R19/R20/W6/W7/W9/W10 + REST product.** `apps/web/test/fixtures/scenario.ts` (`collectCatalog`, user Citra, dijalankan paling akhir): R20 untuk record label/struk/screenshot, W6/W7 sukses dan setiap error §8.2, gambar dihapus, W8 dengan PLU, W9/W10/R19 (sukses, ulang, `RECORDS_NOT_OWNED`, `42501`, `P0001`, beda ukuran/dimensi, ke katalog), REST `product` (baca, PATCH sukses / 0 baris / `23514` / `23503`, pindah group, arsip). Ditambahkan dengan `UPDATE_FIXTURES=new` (§4.4).

**e2e.** `e2e/correction.spec.ts` (alur 6a/6b/6c) di job `supabase-e2e` (Chromium + WebKit). `STALE_WRITE` "dua tab" = dua page dalam context Playwright yang sama (sesi login sama); RPC tidak diubah. Data tambahan lewat helper test (`e2e/support/seed.ts`, `e2e/support/catalog.ts`, service role di proses test saja).

### 4.9 Pengaturan & onboarding dari UI (M6)

**Alur** (`docs/07` §1.10): login pertama di perangkat → `/selamat-datang` (S-00b) → "Mulai" → `/selamat-datang/member` (S-00c, pilih program → "Simpan & lanjut") → beranda. "Lewati" di salah satu layar menyimpan status 💾 `prefs.onboarded`; login berikutnya di perangkat yang sama langsung ke tujuan. Keluar menghapus IndexedDB, jadi S-00b tampil lagi setelah login ulang (F-80).

Tab Saya (`/saya`): ubah nama tampilan, Program member (`/saya/member`, toggle = W16), Berbagi harga publik (`/saya/berbagi`: nyalakan = W14, "Bagikan juga data lama" = W15, matikan dengan konfirmasi), Privasi & data (`/saya/privasi`), Keluar (dengan peringatan jika antrean foto belum kosong). Edit produk privat (`/produk/edit`) punya bagian "Barcode dan PLU" (tambah saja).

**Mencoba (mode B):** jalankan Supabase + worker stub + web seperti §4.5, lalu:

- **Member → harga dihitung ulang:** mulai sesi belanja di AEON BSD, foto/galeri label `label-milo` (kamera label), buka item "perlu dicek" (S-11): MILO 3IN1 menampilkan Rp23.000 + "Harga member tidak dihitung…". Tandai AEON Member di `/saya/member`, kembali ke S-11 → Rp21.000.
- **"Bagikan juga data lama":** W15 hanya mengantre job; batch dijalankan pg_cron (`app.run_sql_jobs`). Status job: `select status, payload from app.job where kind = 'share_existing_prices' order by id desc limit 5;`.
- **Hapus akun:** di `/saya/privasi` tekan "Kirim kode", ambil kode di Mailpit (http://127.0.0.1:54324), ketik `HAPUS AKUN`, tekan tombol dua kali. Route butuh `SUPABASE_SERVICE_ROLE_KEY` di env server Next (§3.4). Setelah 202: user Auth hilang, `household.archived_at` terisi, job `delete_household` menghapus data (worker).
- **Mengulang onboarding di browser yang sama:** DevTools → Application → IndexedDB → `priceatlas:<user_id>` → `prefs` → hapus kunci `onboarded` (atau Keluar lalu masuk lagi).

**Batas email Auth lokal.** `supabase/config.toml` (lokal/CI saja): `email_sent = 100` per jam dan `max_frequency = "1s"` supaya e2e bisa meminta kode kedua untuk email yang sama (F-86). Ubah `config.toml` → jalankan ulang `supabase stop && supabase start`.

**Fixture W14/W15/W16 + REST profile/barcode.** `apps/web/test/fixtures/scenario.ts` (`collectSettings`, user Citra, dijalankan paling akhir, `UPDATE_FIXTURES=new`, §4.4).

**e2e.** `e2e/settings.spec.ts` (alur 7, 8) di job `supabase-e2e` (Chromium + WebKit). Helper `login()` (`e2e/support/auth.ts`) kini menekan "Lewati" di S-00b untuk alur lain.

### 4.10 Offline penuh, Tanya, audit (M7)

**Cache produk offline (R5, D-60, `docs/07` §5.6, §1.11).** Setelah login, layout (app) memanggil `get_offline_cache(p_viewed_ids = "pernah dibuka" dari prefs (≤ 150), p_top = 50)` dan menyimpan kartunya di IndexedDB `priceatlas:<user_id>` → `offline_cards`. Sinkron ulang saat app dibuka jika sinkron terakhir > 6 jam (meta query di-persist, kartu tidak masuk `qcache`) dan setelah setiap tulis harga (konfirmasi struk/label, koreksi, merge/split). Offline (atau jaringan gagal) dan kata kunci belum pernah dicari online: S-02 mencari di `offline_cards` (huruf kecil, spasi tunggal, tanpa diakritik, setiap kata harus cocok di nama + varian + brand; produk arsip disaring) dengan label "data tersimpan, mungkin tidak terbaru". S-01 "Baru dicek" dan S-03 (ringkasan kartu saja, "Detail lengkap butuh sinyal") memakai kartu yang sama. Keluar/hapus akun menghapus `offline_cards` bersama database user; user dikunci (`lockUserDb`, F-81) sehingga sinkron yang masih berjalan tidak membuat ulang database.

**Mencoba (mode B):** login dengan histori harga (§4.4/§4.8), tunggu beberapa detik, lalu DevTools → Application → IndexedDB → `priceatlas:<user_id>` → `offline_cards` (≤ 200 kartu). Build produksi (service worker aktif, §4.1) → DevTools → Network → Offline → cari kata yang belum pernah dicari (mis. "original") → kartu dari cache. Memaksa sinkron ulang: hapus entri `get_offline_cache` di `qcache` (atau Keluar lalu masuk lagi).

**S-20 Tanya (kerangka, §9).** Baris "Tanya: …" di S-02 → `/tanya?q=`: pertanyaan tampil sebagai "Kamu: …" dengan balasan "Segera hadir" + tautan hasil cari; chip contoh mengisi kolom; tombol Kirim nonaktif. Tidak ada panggilan jaringan, dependensi Claude, atau API key di `apps/web` (Tahap 6: `POST /api/ask`). Keadaan jawaban (jawaban + "Dijawab dengan: tool(…)" + tautan layar sumber, di luar kemampuan, data kurang, ambigu, memuat) diuji dengan data contoh di `test/m7/offline.test.tsx`.

**Ajakan pasang iOS (Q-62).** Saat antrean pertama kali berisi foto: `navigator.storage.persist()` diminta (semua platform) dan, di iOS yang belum dipasang ke layar utama, kartu "Pasang PriceAtlas ke layar utama" tampil sekali (tutup = `install_prompt: dismissed` di prefs). Mencoba di desktop: DevTools → mode perangkat iPhone (UA iOS) → foto pertama. Mengulang: hapus kunci `install_prompt` di `prefs`.

**Pembaruan service worker (P-12).** Build baru → buka app lama: banner "Versi baru tersedia · Muat ulang"; selama antrean foto belum kosong: "Versi baru siap. Dipasang setelah semua foto terunggah." tanpa tombol. Mencoba: build + start, buka app, ubah satu teks, build + start lagi, kembali ke tab (atau DevTools → Application → Service Workers → Update).

**Audit a11y.** `test/m7/a11y.test.tsx` menjalankan jest-axe di setiap layar S-xx (data fixture asli); hanya dampak serious/critical yang gagal. Ringkasan dampak lebih kecil per layar: `A11Y_REPORT=1 pnpm --filter @priceatlas/web exec vitest run test/m7/a11y.test.tsx`. Kontras warna tidak bisa dihitung di jsdom, jadi `e2e/a11y.spec.ts` menjalankan `@axe-core/playwright` (WCAG 2.1 A/AA) di browser sungguhan (Chromium + WebKit) untuk layar utama setelah login. Cek manual VoiceOver/TalkBack: daftar di `docs/07` §1.11.

**PWA bisa dipasang.** Lighthouse 12 tidak lagi punya kategori PWA (F-95). Penggantinya `e2e/a11y.spec.ts` "PWA bisa dipasang": profil Chromium persisten (konteks biasa Playwright = penyamaran, `in-incognito`) → service worker siap → CDP `Page.getInstallabilityErrors` harus kosong. Jalan tanpa Supabase.

**Fixture R5.** `apps/web/test/fixtures/scenario.ts` (`collectOffline`, paling akhir, hanya baca): `offline_cache` (Ani: pernah dibuka Milo UHT, Gula, produk duplikat yang sudah digabung + 50 teratas), `offline_cache_archived` (Citra: produk arsip M5), `offline_cache_empty` (Budi). Ditambahkan dengan `UPDATE_FIXTURES=new` (§4.4).

**e2e.** `e2e/offline.spec.ts` "M7: cache produk R5" (Chromium, service worker) dan `e2e/a11y.spec.ts` (axe, installable, S-02 → S-20) di job `supabase-e2e`.
