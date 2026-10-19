#!/usr/bin/env bash
# Mode A (docs/06-local-dev.md): database pengembangan di PostgreSQL biasa.
#   db/scripts/dev-db.sh [nama_db]     (default priceatlas_dev; DIHAPUS lalu dibuat ulang)
# Isi: stub Supabase + semua migration + user uji a/b/c + katalog contoh.
set -euo pipefail
cd "$(dirname "$0")/../.."
DB="${1:-priceatlas_dev}"
db/tests/build_db.sh "$DB"
psql -X -q -v ON_ERROR_STOP=1 -d "$DB" -f db/tests/lib/seed.sql
echo "siap: $DB (user a=00000000-0000-0000-0000-00000000000a, b=…0b, c=…0c)"
