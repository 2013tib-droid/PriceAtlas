# Tahap 4b — Menjalankan Backend Secara Lokal

> Dasar: `docs/05-backend-design.md` (§1.4 penjadwalan, §1.5 struktur repo, §5 pipeline, §7.7 rahasia, §8 test).
> Dua mode: **A** (PostgreSQL biasa + stub, tanpa Supabase) dan **B** (Supabase CLI).
> Tidak ada UI (Tahap 5) dan tidak ada OCR/AI sungguhan (Tahap 6): extractor dan matcher AI memakai **stub berbasis fixture**.

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
apps/web/              scaffold Next.js: hanya POST /api/account/delete
packages/contracts/    zod: input/output RPC, kode error, kontrak extra, unitPrice()
packages/ai-tools/     6 tool AI (skema + handler ke RPC), belum disambungkan ke Claude
packages/testkit/      utilitas test: DB uji + klien RPC ala PostgREST dengan JWT simulasi
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

### 2.6 Fixture stub

Fixture ada di `apps/worker/test/fixtures/` (dipakai juga oleh test L3). Satu fixture = satu file JSON + file gambar. Gambar dipetakan ke fixture lewat **sha256 gambar posisi 1**, sehingga isi file gambar menentukan hasil "OCR".

| Fixture | Jenis | Hasil yang diharapkan |
|---|---|---|
| `struk-aeon` | struk AEON BSD | `needs_confirmation`: Milo (barcode) auto-save dengan diskon member → promo + `member_hint`; Indomie dan SNACK (saran AI tier 4) perlu konfirmasi; pii terpisah |
| `label-milo` | label harga | Milo 200 g (barcode, promo aktif) auto-accept jika toko diketahui (sesi/manual); Milo 3in1 harga member menunggu konfirmasi |
| `shopee-milo` | screenshot marketplace | toko Shopee dari `store_hint`, seller global "Nestle Official Store", ongkir di `extra` |
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
pnpm -r --workspace-concurrency=1 test   # L2 + L3 (membangun DB uji sendiri: priceatlas_l2_*, priceatlas_l3_*)
pnpm -r typecheck
bash db/scripts/snapshot.sh --check   # db/schema.sql tanpa drift
bash scripts/check-secrets.sh
```

Setelah mengubah migration:

```bash
bash db/scripts/snapshot.sh                 # tulis ulang db/schema.sql
bash db/scripts/gen_inventory_test.sh       # tulis ulang whitelist hak akses 99_*, lalu TINJAU diff-nya
```

Test L1 `60_public_share.sql` dan `70_capture_pipeline.sql` membuka sesi kedua lewat `dblink` ke database yang sama (`dbname=… user=postgres`, koneksi socket lokal). Server harus mengizinkan koneksi lokal itu tanpa kata sandi (default image Docker `postgres` dan paket Ubuntu dengan `peer` untuk user `postgres`).

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
pnpm --filter @priceatlas/db-types gen     # supabase gen types typescript --local
```

### 3.6 Test L4 (opsional, manual)

Belum diotomasi di Tahap 4b. Yang perlu dicek manual: policy Storage asli (unggah ke folder household lain ditolak, hapus oleh user ditolak), pemetaan error `PTnnn` → HTTP oleh PostgREST, OTP lewat Inbucket, dan default privileges asli (jalankan `db/tests/flows/99_privilege_inventory.sql` terhadap database Supabase lokal setelah `create schema test` + `\i db/tests/lib/privilege_inventory.sql`).
