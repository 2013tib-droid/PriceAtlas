#!/usr/bin/env bash
# Bangun satu database uji: stub Supabase + semua migration (urut nama file).
#   db/tests/build_db.sh <nama_db> [--baseline-only | --schema-file <file>]
# Koneksi memakai variabel standar libpq (PGHOST, PGPORT, PGUSER, PGPASSWORD).
set -euo pipefail
cd "$(dirname "$0")/../.."

DB="$1"; shift || true
MODE="${1:-all}"
PSQL=(psql -X -v ON_ERROR_STOP=1 -q -o /dev/null)

PGOPTIONS="-c client_min_messages=warning" "${PSQL[@]}" -d postgres -c "drop database if exists ${DB} with (force)" -c "create database ${DB}"
"${PSQL[@]}" -d "$DB" -f db/tests/supabase_stub.sql 2>/dev/null

case "$MODE" in
  --schema-file)
    "${PSQL[@]}" -d "$DB" -f "$2" ;;
  --baseline-only)
    "${PSQL[@]}" -d "$DB" -f supabase/migrations/20261020000000_baseline.sql ;;
  *)
    for m in supabase/migrations/*.sql; do
      "${PSQL[@]}" -d "$DB" -f "$m" 2> >(grep -v -E '^psql:.*NOTICE' >&2 || true)
    done ;;
esac
