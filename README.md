# PriceAtlas

Histori harga pribadi untuk memutuskan murah atau mahal **sebelum membeli**. Requirement dan
keputusan: [`PROJECT.md`](PROJECT.md).

| Tahap | Dokumen |
|---|---|
| 2 Database | [`docs/02-domain-model.md`](docs/02-domain-model.md), [`docs/03-database-design.md`](docs/03-database-design.md) |
| 3 Wireframe | [`docs/04-wireframe.md`](docs/04-wireframe.md) |
| 4 Backend | [`docs/05-backend-design.md`](docs/05-backend-design.md) (desain + implementasi 4b), [`docs/06-local-dev.md`](docs/06-local-dev.md) (menjalankan lokal) |
| 5 Frontend | [`docs/07-frontend-design.md`](docs/07-frontend-design.md) (desain 5a, draft) |

## Isi repo (Tahap 4b)

- `supabase/migrations/` — sumber kebenaran skema; `db/schema.sql` adalah snapshot hasil generate (D-72).
- `db/tests/` — harness SQL: `smoke.sql` (43 test Tahap 2, tidak diubah) + `flows/*` per alur.
- `apps/worker` — worker pipeline capture dan job (stub OCR/AI berbasis fixture).
- `apps/web` — scaffold Next.js, hanya `POST /api/account/delete`.
- `packages/contracts` (zod), `packages/ai-tools` (6 tool AI), `packages/testkit` (utilitas test).

## Mulai cepat (mode A: PostgreSQL 16 lokal, tanpa Supabase)

```bash
pnpm install
export PGHOST=localhost PGUSER=postgres PGPASSWORD=postgres
bash db/tests/run.sh                         # semua test SQL
pnpm -r --workspace-concurrency=1 test       # test TypeScript
db/scripts/dev-db.sh                         # database dev + user uji + katalog contoh
```

Langkah lengkap (worker, fixture, mode B Supabase CLI): [`docs/06-local-dev.md`](docs/06-local-dev.md).
