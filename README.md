# PriceAtlas

Histori harga pribadi untuk memutuskan murah atau mahal **sebelum membeli**. Requirement dan
keputusan: [`PROJECT.md`](PROJECT.md).

| Tahap | Dokumen |
|---|---|
| 2 Database | [`docs/02-domain-model.md`](docs/02-domain-model.md), [`docs/03-database-design.md`](docs/03-database-design.md) |
| 3 Wireframe | [`docs/04-wireframe.md`](docs/04-wireframe.md) |
| 4 Backend | [`docs/05-backend-design.md`](docs/05-backend-design.md) (desain + implementasi 4b), [`docs/06-local-dev.md`](docs/06-local-dev.md) (menjalankan lokal) |
| 5 Frontend | [`docs/07-frontend-design.md`](docs/07-frontend-design.md) (desain 5a disetujui; 5b M0 selesai dan disetujui, §1.4; M1 selesai, §1.5; M2 selesai dan disetujui (D-86), §1.6; M3 selesai dan disetujui (D-87), §1.7), [`docs/06-local-dev.md`](docs/06-local-dev.md) §4 (menjalankan frontend) |

## Isi repo (Tahap 5b M3)

- `supabase/migrations/` — sumber kebenaran skema; `db/schema.sql` adalah snapshot hasil generate (D-72).
- `db/tests/` — harness SQL: `smoke.sql` (43 test Tahap 2, tidak diubah) + `flows/*` per alur.
- `apps/worker` — worker pipeline capture dan job (stub OCR/AI berbasis fixture).
- `apps/web` — PWA Next.js 16: login OTP (`/masuk`), layout tab, service worker Serwist, `rpcCall`, formatter, pesan error; `POST /api/account/delete`. M1: beranda + cari (`/`, `/cari`), detail produk + cek harga rak (`/produk`), bandingkan ukuran (`/produk/ukuran`), lebih hemat di mana (`/produk/hemat`), scan barcode (`/kamera?jenis=barcode`). M2: sheet foto (`?sheet=foto`), kamera struk + galeri (`/kamera?jenis=struk|screenshot`), antrean foto offline (IndexedDB), unggahan (`/unggahan`) dan detailnya (`/unggahan/detail`). M3: konfirmasi struk (`/struk`), konfirmasi label/screenshot (`/konfirmasi`), pilih toko & cabang (`/lokasi`), pilih produk (lapisan `?pilih=produk`), produk baru (`/produk/baru`).
- `packages/contracts` (zod), `packages/ai-tools` (6 tool AI), `packages/testkit` (utilitas test),
  `packages/l4` (test terhadap Supabase CLI), `packages/db-types` (hasil `supabase gen types`).
- CI: job `test` (L1–L3, lint, unit/komponen web, build), `browser` (L5c: kompresi gambar nyata di Chromium), dan `supabase-e2e` (Supabase CLI: L4, cek drift `db-types`, worker stub, e2e Playwright: login, shell offline, alur 1–2, alur 3 unggah dan konfirmasi struk, 3b duplikat, 5 screenshot, antrean offline, gagal/ulangi).

## Mulai cepat (mode A: PostgreSQL 17 lokal, tanpa Supabase)

```bash
pnpm install
export PGHOST=localhost PGUSER=postgres PGPASSWORD=postgres
bash db/tests/run.sh                         # semua test SQL
pnpm -r --workspace-concurrency=1 test       # test TypeScript
db/scripts/dev-db.sh                         # database dev + user uji + katalog contoh
```

Frontend (butuh Supabase CLI, mode B):

```bash
supabase start                               # PostgreSQL 17, Mailpit di http://127.0.0.1:54324
# isi apps/web/.env.local dari `supabase status` (docs/06 §4.1)
pnpm --filter @priceatlas/web dev            # http://localhost:3000/masuk
```

Langkah lengkap (worker, fixture, mode B, frontend, L4, e2e): [`docs/06-local-dev.md`](docs/06-local-dev.md).
