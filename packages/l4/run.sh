#!/usr/bin/env bash
# Test L4 (docs/05 §8.1, docs/07 §11.4, D-78) terhadap Supabase CLI lokal yang sudah berjalan
# (`supabase start`). Dipakai job CI `supabase-e2e` dan bisa dijalankan manual (docs/06 §3.6).
#   1. SQL: inventaris hak akses (99_privilege_inventory) terhadap DB Supabase asli + cek
#      lingkungan Supabase (role worker F-22, zona waktu, Storage, pg_cron, trigger signup).
#   2. HTTP: OTP lewat Mailpit, PTnnn → HTTP lewat PostgREST, policy Storage asli,
#      pipeline worker dengan WORKER_DB_ROLE=service_role.
# Env: SUPABASE_DB_URL (default postgresql://postgres:postgres@127.0.0.1:54322/postgres),
#      NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, MAILPIT_URL.
set -euo pipefail
cd "$(dirname "$0")"
ROOT=$(cd ../.. && pwd)
DB_URL="${SUPABASE_DB_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"
PSQL=(psql -X -v ON_ERROR_STOP=1 -q -d "$DB_URL")

reset_test_schema() { "${PSQL[@]}" -c 'drop schema if exists test cascade' >/dev/null 2>&1; }
run_sql() {  # run_sql <file> <label>
  local log; log=$(mktemp)
  reset_test_schema
  if ! "${PSQL[@]}" -f "$1" >"$log" 2>&1; then cat "$log"; echo "GAGAL: $2"; exit 1; fi
  grep -E 'ok  :' "$log" | sed 's/^.*NOTICE:  //'
  printf '  %-40s %3d ok\n' "$2" "$(grep -c 'ok  :' "$log")"
  reset_test_schema
}

echo "== L4 SQL (database Supabase) =="
run_sql "$ROOT/db/tests/flows/99_privilege_inventory.sql" 99_privilege_inventory
run_sql sql/l4_supabase.sql l4_supabase

echo "== L4 HTTP (PostgREST, Auth, Storage, worker) =="
pnpm exec vitest run
