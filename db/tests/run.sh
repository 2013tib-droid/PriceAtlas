#!/usr/bin/env bash
# Harness SQL (lapisan L1, docs/05-backend-design.md §8).
#   PGHOST=... PGPORT=... PGUSER=postgres db/tests/run.sh [pola_flow]
# Urutan: cek hash smoke → stub + migration → smoke.sql → flows/* (tiap file DB baru).
set -euo pipefail
cd "$(dirname "$0")/../.."

DB="${TEST_DB:-priceatlas_test}"
FILTER="${1:-}"
LOG_DIR="${TEST_LOG_DIR:-$(mktemp -d)}"
PSQL=(psql -X -v ON_ERROR_STOP=1 -q -o /dev/null)

# smoke.sql tidak boleh diubah (§2.4).
sha256sum --quiet -c db/tests/smoke.sha256

total=0
run_sql() {  # run_sql <db> <file> <label>
  local log="$LOG_DIR/$3.log"
  if ! "${PSQL[@]}" -d "$1" -f "$2" >"$log" 2>&1; then
    cat "$log"; echo "GAGAL: $3"; exit 1
  fi
  local n; n=$(grep -c 'NOTICE:  ok  :' "$log" || true)
  total=$((total + n))
  printf '  %-34s %4d ok\n' "$3" "$n"
}

echo "== smoke =="
db/tests/build_db.sh "$DB"
run_sql "$DB" db/tests/smoke.sql smoke

echo "== flows =="
for f in db/tests/flows/*; do
  name=$(basename "$f")
  [[ -n "$FILTER" && "$name" != *"$FILTER"* ]] && continue
  case "$f" in
    *.sh)
      log="$LOG_DIR/$name.log"
      if ! TEST_DB="${DB}_flow" bash "$f" >"$log" 2>&1; then cat "$log"; echo "GAGAL: $name"; exit 1; fi
      n=$(grep -c '^ok  :' "$log" || true); total=$((total + n))
      printf '  %-34s %4d ok\n' "$name" "$n" ;;
    *.sql)
      db/tests/build_db.sh "${DB}_flow"
      run_sql "${DB}_flow" "$f" "$name" ;;
  esac
done
echo "SEMUA TEST SQL LULUS: $total pengecekan"
