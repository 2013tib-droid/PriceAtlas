# Menjalankan PriceAtlas Secara Lokal (backend Tahap 4b, frontend Tahap 5b, AI Tahap 6b)

> Dasar: `docs/05-backend-design.md` (§1.4 penjadwalan, §1.5 struktur repo, §5 pipeline, §7.7 rahasia, §8 test).
> Dua mode: **A** (PostgreSQL biasa + stub, tanpa Supabase) dan **B** (Supabase CLI).
> Extractor dan matcher AI worker masih **stub berbasis fixture** (extractor sungguhan di 6b M2). Uji OCR D-16 (harness `ocr-eval`, 6b M1) dijalankan pemilik proyek di mesinnya: §2.8; uji live sintetis: §2.9. Tanya (`/api/ask`, 6b M5) memakai Claude jika `ANTHROPIC_API_KEY` web diisi, atau `ASK_ENGINE=stub` tanpa kunci: §4.11. Frontend (`apps/web`, Tahap 5b) butuh mode B: lihat §4.

---

## 0. Prasyarat

| Alat | Versi | Mode |
|---|---|---|
| PostgreSQL server + klien (`psql`, `pg_dump`) | **17** (D-78; paket contrib, untuk `pg_trgm`, `btree_gist`, `dblink`). `pg_dump` harus versi mayor yang sama dengan server (snapshot dan `00_baseline_equivalence`). | A |
| Node.js | ≥ 22 | A, B |
| pnpm | 10 (`corepack enable`) | A, B |
| Supabase CLI + Docker | terbaru | B |
| `sharp` (libvips prebuilt, lewat paket npm `@img/*`) dan `heic-decode` (libheif WASM, LGPL-3.0) | dipasang `pnpm install` (dependensi worker, 6b M0) | A, B |
| Playwright + Chromium | hanya untuk membangkitkan ulang fixture sintetis (§2.6); bukan dependensi worker | — |

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
  src/images/          prepareImages: dekode + EXIF + resize sebelum extractor (docs/08 §6)
  src/ai/, extractors/ klien Claude, harga, skema LLM, prompt v1, konverter, VisionExtractor (belum dipasang, M2)
  eval/synthetic/      generator gambar sintetis (HTML → JPEG lewat Playwright)
apps/web/              PWA Next.js 16 (Tahap 5b): /masuk, layout (app), service worker; POST /api/account/delete, POST /api/ask
packages/contracts/    zod: input/output RPC, kode error, kontrak extra, unitPrice()
packages/ai-tools/     6 tool AI (skema + handler ke RPC), loop Tanya `src/ask.ts` (server), tabel harga `src/pricing.ts`
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

Sejak 6b M0 setiap gambar melewati `prepareImages` (docs/08 §6) sebelum extractor, termasuk stub. Karena itu file gambar fixture harus **JPEG/PNG/WebP/HEIC sungguhan** dengan sisi pendek ≥ 200 px; byte acak gagal sebagai `unsupported` ("Gambar tidak bisa dibuka. Coba foto ulang atau pilih foto lain."). Gambar fixture adalah **JPEG sintetis** (F-118, Q-72): struk/label/screenshot buatan dari template HTML, tanpa data pribadi, isinya sama dengan `raw_text`/`output` JSON-nya.

| Fixture | Jenis | Hasil yang diharapkan |
|---|---|---|
| `struk-aeon` | struk AEON BSD | `needs_confirmation`: Milo (barcode) auto-save dengan diskon member → promo + `member_hint`; Indomie dan SNACK (saran AI tier 4) perlu konfirmasi; pii terpisah |
| `label-milo` | label harga | Milo 200 g (barcode, promo aktif) auto-accept jika toko diketahui (sesi/manual); Milo 3in1 harga member menunggu konfirmasi |
| `shopee-milo` | screenshot marketplace | toko Shopee dari `store_hint`, seller global "Nestle Official Store", ongkir di `extra`; tier fuzzy confidence 1 → **auto-save** (`done`). Unggahan kedua file yang sama = duplikat hash → `needs_confirmation` (D-71) |
| `shopee-milo-uht` | screenshot marketplace (6b M4, Q-78) | confidence harga 0,7 < τ → **`needs_confirmation` dari unggahan pertama** (e2e alur 5); saran Milo UHT 180 ml, ongkir Rp5.000 |
| `label-indomie` | label harga (6b M1) | satu label promo berperiode; label kedua untuk uji live §2.9 |
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

Gambar tanpa fixture → `PermanentError('unsupported')`. Direktori lain bisa dipakai lewat `STUB_FIXTURES_DIR`. Subfolder (mis. `heic/`) diabaikan oleh registry fixture.

**`STUB_FALLBACK_FIXTURE` (KHUSUS worker e2e, Q-82/Q-118):** nama fixture yang dipakai untuk gambar yang tidak dikenal (mis. frame kamera palsu Chromium yang sha256-nya tidak pernah sama dengan fixture, F-63), **hanya jika jenis capture sama** dengan jenis output fixture itu (`label-milo` → hanya capture label). Nama yang tidak ada → worker gagal start. Tidak pernah default; jangan diisi di dev/produksi. Job CI `supabase-e2e` menjalankan worker dengan `STUB_FALLBACK_FIXTURE=label-milo`. Mencoba lokal:

```bash
STUB_FALLBACK_FIXTURE=label-milo pnpm --filter @priceatlas/worker dev   # foto kamera label apa pun → isi label-milo
```

**Membuat atau mengubah gambar fixture** (generator `apps/worker/eval/synthetic/`, spesifikasi per fixture di `specs.ts`):

```bash
pnpm --filter @priceatlas/worker synthetic                          # tulis ulang semua gambar fixture (worker + web)
CHROMIUM_PATH=/opt/pw-browsers/chromium pnpm --filter @priceatlas/worker synthetic   # jika versi Playwright ≠ browser terpasang
pnpm --filter @priceatlas/worker synthetic --out .data/ocr-eval-synthetic           # set uji sintetis: <nama>.jpg + <nama>.truth.json (§2.8)
pnpm --filter @priceatlas/worker synthetic --only shopee-milo-uht   # hanya fixture ini; gambar lain tidak dirender ulang (F-132)
```

Generator memakai Playwright yang sudah terpasang di lingkungan (jangan `playwright install`); CI tidak menjalankannya. Hasil render bergantung pada font mesin, jadi menjalankan ulang mengubah sha256. Setelah gambar berubah: perbarui nilai `sha256` di `apps/web/test/fixtures/rpc.json` (ganti hash lama dengan yang baru; tidak perlu bangkitkan ulang seluruh file) dan konstanta `STRUK_AEON_SHA` di `apps/web/test/browser/media.browser.test.ts`. Fixture baru: tambah entri di `specs.ts` (termasuk `storeCategory` dan anotasi uji untuk harness), jalankan generator dengan `--only <nama>`, lalu tulis JSON dengan `images` menunjuk file itu.

**Sampel HEIC:** test dekode HEIC asli (`apps/worker/test/images.test.ts`) dilewati sampai `apps/worker/test/fixtures/heic/sample.heic` ada (foto polos dari iPhone tanpa data pribadi, lokasi mati; docs/08 §15 no. 8). libheif di Node tidak punya encoder, jadi sampel tidak bisa dibuat sendiri.

**Gambar di repo (F-117):** `scripts/check-secrets.sh` menolak file gambar yang dilacak di luar `apps/worker/test/fixtures/`, `apps/web/test/fixtures/`, `apps/web/e2e/fixtures/`, `apps/web/public/icons/`, dan `docs/wireframes/`, serta pola kunci `sk-ant-…`. Foto asli untuk uji OCR hanya di `.data/ocr-eval/` (di-gitignore).

### 2.7 Test

```bash
bash db/tests/run.sh                  # L1: smoke (43, tidak diubah) + flows/*, satu DB baru per file
bash db/tests/run.sh 70_              # hanya flow yang namanya memuat "70_"
pnpm -r --workspace-concurrency=1 test   # L2 + L3 + L5a/L5b web (membangun DB uji sendiri: priceatlas_l2_*, priceatlas_l3_*)
                                         # worker 6b M0: images/ai/convert (L2), vision-pipeline (L3, klien Claude palsu)
                                         # 6b M5: ai-tools ask (loop Tanya, klien Claude palsu), web test/ask (route, S-20, set emas)
                                         # 6b M1: worker eval-score / eval-harness (harness uji OCR, klien palsu, tanpa jaringan)
                                         # test/live/* TIDAK ikut (hanya `test:live`, §2.9)
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

Tanpa PostgreSQL 17 lokal, `snapshot.sh` dengan `pg_dump` 16 menghasilkan berkas yang identik untuk skema ini (diperiksa di 6b M5 dan M4, `docs/08` §19, §20); CI tetap memeriksa dengan 17.

Perubahan RPC yang **menambah field** keluaran (mis. 6b M4: R18, R20): `UPDATE_FIXTURES=fields pnpm --filter @priceatlas/web test fixtures` menambahkan field baru ke `apps/web/test/fixtures/rpc.json` tanpa mengubah nilai lama (tanggal relatif dan jam sesi yang dipakai test tetap, F-75/F-125). Nilai yang berubah karena perilaku baru disalin dari keluaran server secara terarah, lalu `prettier --write`.

Test L1 `60_public_share.sql`, `70_capture_pipeline.sql`, dan `86_ask_quota.sql` membuka sesi kedua lewat `dblink` ke database yang sama (`dbname=… user=postgres`, koneksi socket lokal). Server harus mengizinkan koneksi lokal itu tanpa kata sandi (default image Docker `postgres` dan paket Ubuntu dengan `peer` untuk user `postgres`). Socket dicari di direktori default libpq server itu: jika biner PostgreSQL berasal dari paket lain (mis. biner portabel yang memakai `/tmp`), jalankan server dengan `-k /var/run/postgresql,/tmp`.

### 2.8 Uji OCR D-16: harness `ocr-eval` (6b M1, dijalankan pemilik proyek)

Desain: `docs/08` §4 (data §4.2, ground truth §4.3, arm §4.5, metrik §4.7, kriteria §4.8); hasil pembangunan: `docs/08` §20. Harness dijalankan **di mesin pemilik proyek** (Q-105 → D-92): foto asli dan ground truth tidak pernah masuk repo atau sesi cloud. Yang dikirim balik hanya laporan **agregat**.

**Persiapan (sekali).**

| Butuh | Isi |
|---|---|
| Repo + `pnpm install` | Node 22. PostgreSQL/Supabase **tidak** dibutuhkan. |
| `ANTHROPIC_API_KEY` | Kunci **worker** (docs/08 §15 no. 5), workspace dengan batas pengeluaran. Diisi di shell, bukan di file yang di-commit. |
| `GOOGLE_VISION_API_KEY` | Hanya untuk arm `ocr-gcv+opus-low` (§15 no. 6): kunci API dibatasi ke Vision API. Tanpa kunci ini, jalankan `--arms` tanpa arm OCR. |
| Folder data | `.data/ocr-eval/` (di-gitignore). Folder lain lewat `OCR_EVAL_DIR`; harness **menolak berjalan** jika folder datanya di dalam repo git dan tidak di-ignore (F-117). |
| Uji live sekali | `test:live` (§2.9, ±US$0,40) untuk memastikan kunci, model, dan pola error (Q-138). |

```bash
export ANTHROPIC_API_KEY=sk-ant-…            # kunci worker
export GOOGLE_VISION_API_KEY=…               # arm OCR saja
alias ocr-eval='pnpm --filter @priceatlas/worker ocr-eval'
```

**Lima langkah** (docs/08 §4.2):

| # | Langkah | Perintah |
|---|---|---|
| 1 | Salin foto apa adanya (HEIC boleh, jangan disunting) ke `.data/ocr-eval/inbox/`, dikelompokkan per jenis dan kategori toko (lihat di bawah). | — |
| 2 | Buat manifest: id acak, nama file standar, split dev 30 % / test 70 % berstrata per kategori. Aman dijalankan ulang (hanya foto baru yang ditambah). | `ocr-eval init` |
| 3 | Anotasi: pra-isi dari `vision-opus-medium` (dijalankan otomatis untuk foto yang belum punya hasil, ±US$6, dengan anggaran), lalu buka `http://localhost:4317`. 5 struk pertama tanpa pra-isi (ukur bias). Field kuning = belum diperiksa: ubah nilainya atau tekan ✓. "Simpan terverifikasi" hanya jika semua field sudah diperiksa; "Simpan draf" untuk melanjutkan nanti. Ctrl+C untuk berhenti. | `ocr-eval annotate --prefill vision-opus-medium` |
| 4 | Jalankan semua arm pada split test: batch (diskon 50 %, hasil bisa sampai 24 jam; biarkan terminal terbuka) + subset realtime untuk latensi. Cek perkiraan dulu. | `ocr-eval run --set test --arms all --repeat 2 --estimate` lalu tanpa `--estimate` |
| 5 | Buat laporan dan kirim **hanya** `reports/<waktu>.agg.json` (cara kirim di bawah). | `ocr-eval report` |

Susunan `inbox/`:

```
.data/ocr-eval/inbox/
  struk/minimarket/IMG_0101.HEIC            satu foto = satu capture
  struk/supermarket/IMG_0110.jpg
  struk/supermarket/panjang-1/IMG_0120.jpg   folder = struk panjang multi-bagian (urut nama file)
  struk/supermarket/panjang-1/IMG_0121.jpg
  struk/apotek/…   struk/lokal/…   struk/hypermarket/…   struk/IMG_0130.jpg (tanpa kategori = bebas)
  label/supermarket/IMG_0200.jpg             label harga
  screenshot/IMG_0300.PNG                    screenshot belanja online (kategori marketplace)
```

Nama folder jenis: `struk`/`receipt`, `label`/`price_label`, `screenshot`/`marketplace`. Kategori: `minimarket`, `supermarket`, `hypermarket`, `apotek`, `lokal`, `marketplace`, `bebas` (kategori dan kondisi bisa diubah di alat anotasi). Nama file/folder asli tidak disimpan di manifest; jangan memakai nama toko di nama file pun tidak masalah, tetapi tetap disarankan.

**Opsi lain.**

```bash
ocr-eval run --set dev --arms vision-opus-medium            # iterasi prompt di split dev (split test dikunci, §4.4)
ocr-eval run --set all --arms vision-opus-medium --repeat 1 # sekali di dev+test: dibutuhkan untuk ukuran bias pra-isi (§4.2)
ocr-eval run … --mode batch | realtime | both               # default both
ocr-eval run … --budget 20                                  # batas per run (US$); batas keras kumulatif US$75 di spend.json
ocr-eval run … --ids r-7f3a,l-02c1                          # capture tertentu
ocr-eval score --set test                                   # skor per capture (lokal, berisi id) → reports/<waktu>.scores.json
ocr-eval report --set test --tau 0.9                        # laporan; --prefill-arm untuk ukuran bias
ocr-eval annotate --no-run                                  # tanpa menjalankan pra-isi
```

Run yang terputus (mis. batch belum selesai): status batch tersimpan di `runs/<run>/batch.json`; jalankan ulang `run` untuk capture yang belum punya hasil (`--ids`). Biaya yang sudah terpakai tercatat di `spend.json` dan dihitung terhadap batas US$75.

**Isi folder data** (semuanya tetap di mesin): `manifest.json`, `images/`, `truth/`, `runs/<waktu>-<arm>/<id>.r<n>.json` (output mentah, transkripsi, usage, biaya, latensi), `reports/` (`*.agg.json` agregat, `*.md` ringkasan agregat, `*.scores.json` per capture), `spend.json`.

**Mengirim laporan agregat.** Hanya `reports/<waktu>.agg.json` (dan boleh `.md` pasangannya). File ini hanya berisi angka per metrik/arm/jenis/kategori/kondisi: tanpa teks struk, nama toko, PII, id capture, atau path; `report` menolak menulis jika ada teks dari ground truth yang lolos. Cara kirim (pilih satu): lampirkan file itu di percakapan sesi berikutnya, atau commit ke `docs/ocr-eval/<tanggal>.agg.json` di branch baru dan buka PR. **Jangan** mengirim `truth/`, `images/`, `runs/`, `*.scores.json`, atau `manifest.json`.

**Mencoba harness tanpa data asli dan tanpa kunci** (set sintetis + klien palsu; hasilnya **bukan** hasil model):

```bash
export OCR_EVAL_DIR=$PWD/.data/ocr-eval-demo
pnpm --filter @priceatlas/worker synthetic --out .data/ocr-eval-synthetic     # atau set dari fixture: lihat eval/synthetic/set.ts
ocr-eval init --synthetic .data/ocr-eval-synthetic
ocr-eval run --set all --arms all --repeat 2 --client fake --poll 0
ocr-eval report --set all
ocr-eval annotate --prefill vision-opus-medium --client fake                 # alat anotasi dengan pra-isi palsu
```

Contoh keluaran dari set sintetis: `apps/worker/eval/examples/report-synthetic.md`.

### 2.9 Uji live sintetis (`test:live`, manual)

`VisionExtractor` sungguhan pada set sintetis (3 struk + 2 label + 1 screenshot) + satu gambar rusak yang sengaja dikirim ke API (400 harus terbaca sebagai `unsupported`, F-131). Tidak pernah di CI (`vitest.config.ts` mengecualikan `test/live/`).

```bash
LIVE_AI=1 ANTHROPIC_API_KEY=sk-ant-… pnpm --filter @priceatlas/worker test:live              # ±US$0,40 (Opus 5.5)
SYNTHETIC_DIR=.data/ocr-eval-synthetic LIVE_AI=1 ANTHROPIC_API_KEY=… pnpm --filter @priceatlas/worker test:live
LIVE_MODEL=claude-haiku-5-5 LIVE_EFFORT=medium LIVE_AI=1 ANTHROPIC_API_KEY=… pnpm --filter @priceatlas/worker test:live
```

Set dari `synthetic --out` jika ada (default `.data/ocr-eval-synthetic`), selain itu salinan fixture yang di-commit (keluaran generator yang sama). Ringkasan token, biaya, dan latensi per kasus (tanpa teks) → `.data/live/<waktu>.json`. Tanpa `LIVE_AI=1` atau kunci, semua kasus dilewati.

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
ANTHROPIC_API_KEY=<kunci "web" Anthropic>        # opsional, hanya Route Handler /api/ask (Tanya, §4.11)
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
LIVE_AI=1 ANTHROPIC_API_KEY=… pnpm --filter @priceatlas/web test:live-ask   # set pertanyaan emas Tanya (manual, berbayar, §4.11)
```

e2e memakai `next start` (Playwright menyalakannya, dengan `ASK_ENGINE=stub` kecuali di-set lain), env `NEXT_PUBLIC_SUPABASE_*` dan `SUPABASE_SERVICE_ROLE_KEY` (hanya proses test, untuk `auth.admin.generateLink`), dan `MAILPIT_URL`. Tanpa `SUPABASE_SERVICE_ROLE_KEY`, test yang butuh Supabase dilewati; yang tetap jalan tanpa Supabase: shell offline tanpa sesi, axe di S-00a + `/offline`, dan cek PWA bisa dipasang (`e2e/a11y.spec.ts`, M7). Browser lain: `PW_CHROMIUM_PATH=<path chromium>`.

Tanpa Supabase sama sekali, `next build`/`next start` tetap butuh nilai `NEXT_PUBLIC_SUPABASE_URL` dan `NEXT_PUBLIC_SUPABASE_ANON_KEY` (boleh tiruan, mis. `http://127.0.0.1:54321` + `dummy`); tanpa itu `proxy.ts` membalas 500.

`check:bundle` juga gagal jika `.next/static` memuat nama/nilai `ANTHROPIC_API_KEY`, `sk-ant-`, atau penanda SDK Anthropic (`anthropic-version`, `server-side-fallback-`): kunci dan SDK hanya di bundle server `/api/ask`. Lalu mencetak JS halaman `/` gzip (modul; polyfill `noModule` hanya dimuat browser lama, ditampilkan terpisah). Dasar ukur = modul saja; **peringatan** jika > 350 KiB, target 200 KiB (D-91; hasil ukur M7: `docs/07` §1.11, F-94).

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
| `app/(onboarding)/selamat-datang`, `features/onboarding` | M6 (grup tanpa tab bar sejak D-91): S-00b `/selamat-datang?next=` (semua login lewat sini; diteruskan jika sudah onboarded), S-00c `/selamat-datang/member` |
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

**Alur** (`docs/07` §1.8): tab Belanja (S-13) → "Mulai belanja" → S-12 mode sesi (`/lokasi?mode=sesi`: toko → cabang; cabang tutup tidak bisa dipilih, tanpa "Tidak tahu cabangnya", "+ Cabang baru" cepat) → W11 → S-13 aktif + banner "● Belanja di AEON BSD · 0m · 0 label [Foto label]" di semua layar (app). "Foto label" (banner, S-13, atau sheet foto yang kini menaruh "Label harga" di atas) → kamera label `/kamera?jenis=label`: jendela bidik tetap terbuka, setiap shutter = satu capture label dengan `shopping_session_id` sesi aktif → antrean → W1. S-13 menampilkan kartu per foto dan, sejak 6b M4, **per item** dengan thumbnail foto (diproses / gagal dibaca / item perlu dicek → S-11 / item tersimpan dengan harga, label, dan pembanding `vs_best_pct` terhadap termurah 90 hari tanpa record sesi ini), "Perpanjang" saat sisa < 30 mnt (W12, +2 jam), "Akhiri sesi" (W13). Tanpa sesi, "Label harga" di sheet → S-12 mode manual (`untuk=label`) → kamera label dengan lokasi manual (`toko`, `cabang`).

**Mencoba (mode B):** jalankan Supabase + worker stub + web seperti §4.5. Kamera butuh secure context: `localhost` di desktop, atau HTTPS di HP (§4.1). Di desktop tanpa kamera: izin ditolak / kamera tidak ada → "Pilih dari galeri"; pilih `apps/worker/test/fixtures/label-milo.jpg` → dalam beberapa detik kartu "perlu dicek" (Milo 200 g tersimpan otomatis karena lokasi dari sesi, Milo 3in1 menunggu konfirmasi) → S-11 → Simpan → kartu tersimpan. Foto kamera sungguhan tidak punya fixture stub → "gagal dibaca" (`unsupported`), kecuali worker dijalankan dengan `STUB_FALLBACK_FIXTURE=label-milo` (§2.6): foto label apa pun lalu dibaca sebagai label-milo. Kamera palsu Chromium untuk mencoba jendela bidik:

```bash
node --experimental-strip-types -e "import('./apps/web/e2e/support/fake-camera.ts').then(m => console.log(m.writeFakeCameraFile()))"
chromium --use-fake-device-for-media-stream --use-fake-ui-for-media-stream \
  --use-file-for-fake-video-capture=<path .y4m di atas> http://localhost:3000/belanja
```

"Hampir kedaluwarsa" tanpa menunggu 3,5 jam (data lokal saja): `update public.shopping_session set expires_at = now() + interval '20 minutes' where id = '<id>';` lalu buka ulang tab Belanja (S-13 selalu memuat ulang R18 saat dibuka). Sesi kedaluwarsa: set `expires_at` ke masa lalu → banner hilang dalam ≤ 15 dtk, S-13 menulis "Sesi di … berakhir otomatis pukul …".

**Fixture R18/W11/W12/W13.** `apps/web/test/fixtures/scenario.ts` (`collectSessions`, user Ani, dijalankan paling akhir supaya fixture M1–M3 tidak berubah): tanpa sesi, W11 `BRANCH_CLOSED` (AEON Lama), mulai + ulang id yang sama, label-milo dengan sesi lewat pipeline worker asli (uploaded → needs_confirmation), label-milo lagi (duplikat hash) diterima → done, gambar tanpa fixture → failed, satu capture diklaim → processing, R18 sebelum dan sesudah antrean ringkasan (F-60), hampir kedaluwarsa (`expires_at` dimajukan, data test), W12, W13 (+ ulang), `SESSION_NOT_ACTIVE` setelah berakhir dan setelah kedaluwarsa. Dibangkitkan ulang seperti §4.4.

**e2e.** `e2e/session.spec.ts` (alur 4) di job `supabase-e2e`. Chromium memakai kamera palsu: `playwright.config.ts` membangkitkan file Y4M 1280×720 (`e2e/support/fake-camera.ts`, sisi test, tidak di-commit sebagai biner) dan memberi `--use-fake-device-for-media-stream --use-fake-ui-for-media-stream --use-file-for-fake-video-capture=…` + izin `camera`. Frame kamera palsu diperiksa sampai capture terdaftar dengan sesi yang benar (JPEG ≤ 2048 px, sha256 cocok); sejak 6b M4 worker e2e memakai `STUB_FALLBACK_FIXTURE=label-milo`, sehingga frame itu dibaca sebagai label-milo dan kartu S-13 (per item, thumbnail, pembanding) berasal dari foto kamera itu sendiri (Q-82). WebKit tidak punya kamera palsu: label-milo lewat galeri di kamera label yang sama (F-64). Helper `e2e/support/session.ts` (service role di proses test) membaca sesi/capture/gambar dan memajukan `expires_at` untuk "Perpanjang"; migration, RPC, dan logika worker tidak diubah.

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

**S-20 Tanya.** Kerangka M7; sejak 6b M5 aktif lewat `POST /api/ask` (§4.11).

**Ajakan pasang iOS (Q-62).** Saat antrean pertama kali berisi foto: `navigator.storage.persist()` diminta (semua platform) dan, di iOS yang belum dipasang ke layar utama, kartu "Pasang PriceAtlas ke layar utama" tampil sekali (tutup = `install_prompt: dismissed` di prefs). Mencoba di desktop: DevTools → mode perangkat iPhone (UA iOS) → foto pertama. Mengulang: hapus kunci `install_prompt` di `prefs`.

**Pembaruan service worker (P-12).** Build baru → buka app lama: banner "Versi baru tersedia · Muat ulang"; selama antrean foto belum kosong: "Versi baru siap. Dipasang setelah semua foto terunggah." tanpa tombol. Mencoba: build + start, buka app, ubah satu teks, build + start lagi, kembali ke tab (atau DevTools → Application → Service Workers → Update).

**Audit a11y.** `test/m7/a11y.test.tsx` menjalankan jest-axe di setiap layar S-xx (data fixture asli); hanya dampak serious/critical yang gagal. Ringkasan dampak lebih kecil per layar: `A11Y_REPORT=1 pnpm --filter @priceatlas/web exec vitest run test/m7/a11y.test.tsx`. Kontras warna tidak bisa dihitung di jsdom, jadi `e2e/a11y.spec.ts` menjalankan `@axe-core/playwright` (WCAG 2.1 A/AA) di browser sungguhan (Chromium + WebKit) untuk layar utama setelah login. Cek manual VoiceOver/TalkBack: daftar di `docs/07` §1.11.

**PWA bisa dipasang.** Lighthouse 12 tidak lagi punya kategori PWA (F-95). Penggantinya `e2e/a11y.spec.ts` "PWA bisa dipasang": profil Chromium persisten (konteks biasa Playwright = penyamaran, `in-incognito`) → service worker siap → CDP `Page.getInstallabilityErrors` harus kosong. Jalan tanpa Supabase.

**Fixture R5.** `apps/web/test/fixtures/scenario.ts` (`collectOffline`, paling akhir, hanya baca): `offline_cache` (Ani: pernah dibuka Milo UHT, Gula, produk duplikat yang sudah digabung + 50 teratas), `offline_cache_archived` (Citra: produk arsip M5), `offline_cache_empty` (Budi). Ditambahkan dengan `UPDATE_FIXTURES=new` (§4.4).

**e2e.** `e2e/offline.spec.ts` "M7: cache produk R5" (Chromium, service worker) dan `e2e/a11y.spec.ts` (axe, installable, S-02 → S-20) di job `supabase-e2e`.

### 4.11 Tanya (S-20, Tahap 6b M5)

Arsitektur: `docs/08` §10, hasil M5: `docs/08` §19. `POST /api/ask` (Route Handler Node, `import 'server-only'`) memakai cookie sesi user: `begin_ask()` (kuota 30/hari, 300/bulan per household, anggaran AI harian global) → loop Claude ⇄ 6 tool `packages/ai-tools` dengan JWT user (RLS) → `record_ask_usage()` → `{ reply, tools_used }`. Tanpa service role.

| Env (server, `apps/web/.env.local`) | Nilai |
|---|---|
| `ANTHROPIC_API_KEY` | Kunci **web** (terpisah dari kunci worker, docs/08 §15 no. 5). Kosong → 503 `AI_UNAVAILABLE` (`disabled`), S-20 menampilkan "Segera hadir". Tidak pernah `NEXT_PUBLIC_`. |
| `ASK_ENGINE` | `claude` (default), `stub` (e2e/CI: pola pertanyaan → tool sungguhan, tanpa Claude, biaya 0), `off` |
| `ASK_MODEL` | Opsional, default `claude-opus-5-5`. Model lain hanya untuk dibandingkan dengan set pertanyaan emas (Q-115). |

Kuota dan anggaran diubah tanpa migration: `update app.config set value = '…' where key in ('ask_daily_limit', 'ask_monthly_limit', 'ai_daily_budget_usd')`. Pemakaian per household per hari: `select * from app.ask_usage order by day desc` (sebagai `postgres`); biaya AI hari ini: `select app.ai_spend_today()`.

**Mencoba tanpa kunci (mode B):** `ASK_ENGINE=stub pnpm --filter @priceatlas/web dev`, login dengan histori harga (§4.4), cari "milo" → "Tanya: milo" → pilih produk → jawaban dengan "Dijawab dengan: cari_harga_terbaik(…)" dan tautan ke S-03. "harga per gram Milo Original 200 g?" → tautan "Buka Cek harga rak" (S-03b, F-113). "total belanjaku bulan ini" → di luar kemampuan. Offline (DevTools) → Kirim nonaktif. Riwayat 20 tanya-jawab terakhir: IndexedDB `priceatlas:<user_id>` → `prefs` → `ask_history` (terhapus saat Keluar).

**Dengan Claude:** isi `ANTHROPIC_API_KEY` lalu `pnpm --filter @priceatlas/web dev`. Log server (stdout, JSON satu baris) hanya memuat hash id user, durasi, token, biaya, nama tool, `kind`, dan `ask.unsupported_number`; teks pertanyaan/jawaban tidak dicatat.

**Set pertanyaan emas (§13.3, manual, berbayar ±US$1–2 per putaran):**

```bash
export PGHOST=localhost PGUSER=postgres PGPASSWORD=postgres     # PostgreSQL lokal (mode A cukup)
LIVE_AI=1 ANTHROPIC_API_KEY=sk-ant-… pnpm --filter @priceatlas/web test:live-ask
GOLDEN_IDS=1,13,25 LIVE_AI=1 ANTHROPIC_API_KEY=… pnpm --filter @priceatlas/web test:live-ask   # sebagian
ASK_MODEL=claude-sonnet-5-5 LIVE_AI=1 ANTHROPIC_API_KEY=… pnpm --filter @priceatlas/web test:live-ask   # model lain
```

Database uji `priceatlas_live_ask` dibangun dari migration + katalog contoh + histori sintetis (`apps/web/test/live/ask-golden.ts`). Setiap pertanyaan dicetak satu baris (kind, tool, tanda ✗); ringkasan + laporan agregat tanpa teks jawaban di `.data/ask-golden/<waktu>.json` (di-gitignore). Target: 100 % menolak di luar kemampuan, ≥ 90 % tool benar; test juga memastikan Tanya tidak menulis data.

**Test:** `packages/ai-tools/test/ask.test.ts` (loop, pemetaan, error, fallback, F-122, stub), `apps/web/test/ask/` (route L3 dengan DB uji + klien Claude palsu, S-20 L5b, logika, set emas offline), `db/tests/flows/86_ask_quota.sql` (L1), `packages/l4` (429 lewat PostgREST), `apps/web/e2e/ask.spec.ts` (e2e dengan `ASK_ENGINE=stub`).
