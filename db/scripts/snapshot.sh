#!/usr/bin/env bash
# db/schema.sql = snapshot hasil generate dari supabase/migrations (D-72, Q-25).
#   db/scripts/snapshot.sh          tulis ulang db/schema.sql
#   db/scripts/snapshot.sh --check  gagal jika db/schema.sql berbeda (drift), dipakai CI
# Isi: pg_dump --schema-only schema public + app, lalu data referensi (app.config,
# public.unit, kategori sistem). Butuh pg_dump versi mayor yang sama dengan CI (17, D-78).
set -euo pipefail
cd "$(dirname "$0")/../.."
DB="${TEST_DB:-priceatlas_snapshot}"
OUT=$(mktemp)

db/tests/build_db.sh "$DB"
strip() { grep -v -E '^(-- Dumped (from|by) |\\(un)?restrict |SET |SELECT pg_catalog\.set_config)' | cat -s; }
{
  cat <<'HDR'
-- =============================================================================
-- PriceAtlas — Snapshot skema (DIBANGKITKAN, JANGAN DIEDIT)
-- =============================================================================
-- Sumber kebenaran: supabase/migrations/ (D-72). File ini dibangkitkan oleh
-- db/scripts/snapshot.sh dan diperiksa CI (tidak boleh ada drift).
-- Desain: docs/03-database-design.md, docs/05-backend-design.md.
-- Skema Tahap 2b yang asli: db/tests/fixtures/schema-2b.sql (= migration baseline).
--
-- Tidak termasuk di sini (lihat migration masing-masing):
--   * trigger on_auth_user_created di auth.users (baseline)
--   * bucket Storage `captures` dan policy storage.objects (…0150_storage.sql)
--   * extension pg_trgm/btree_gist (baseline), jadwal pg_cron (…0900_cron.sql)
--   * zona waktu database Asia/Jakarta (…0230_hardening.sql)
-- =============================================================================

HDR
  pg_dump --schema-only --no-owner -n public -n app -d "$DB" | strip
  echo
  echo '-- Data referensi'
  pg_dump --data-only --no-owner --inserts --rows-per-insert=50 -t app.config -t public.unit -d "$DB" | strip
  psql -X -At -d "$DB" -c "select format('INSERT INTO public.category (slug, name) VALUES (%L, %L);', slug, name)
                           from public.category where household_id is null order by slug"
} > "$OUT"
PGOPTIONS="-c client_min_messages=warning" psql -X -q -d postgres -c "drop database ${DB} with (force)"

if [[ "${1:-}" == "--check" ]]; then
  if ! diff -u db/schema.sql "$OUT"; then
    echo "GAGAL: db/schema.sql tidak sama dengan hasil migration. Jalankan db/scripts/snapshot.sh"
    exit 1
  fi
  echo "ok  : db/schema.sql sama dengan hasil migration"
else
  mv "$OUT" db/schema.sql
  echo "db/schema.sql ditulis ulang ($(wc -l < db/schema.sql) baris)"
fi
