#!/usr/bin/env bash
# Validasi db/schema.sql di PostgreSQL lokal (>= 15) tanpa Supabase.
#   PGHOST=... PGPORT=... PGUSER=postgres db/tests/run.sh
set -euo pipefail
cd "$(dirname "$0")/../.."

DB="${TEST_DB:-priceatlas_test}"
PSQL=(psql -v ON_ERROR_STOP=1 -q -o /dev/null)

"${PSQL[@]}" -d postgres -c "drop database if exists ${DB}" -c "create database ${DB}"
"${PSQL[@]}" -d "$DB" -f db/tests/supabase_stub.sql
"${PSQL[@]}" -d "$DB" -f db/schema.sql
"${PSQL[@]}" -d "$DB" -f db/tests/smoke.sql
