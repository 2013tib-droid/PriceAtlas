#!/usr/bin/env bash
# Baseline migration = schema.sql Tahap 2b (§2.4 no. 3).
#  1. Isi file identik byte demi byte.
#  2. pg_dump --schema-only dari (a) stub + schema-2b.sql dan (b) stub + baseline identik.
set -euo pipefail
cd "$(dirname "$0")/../../.."
DB="${TEST_DB:-priceatlas_test_flow}"
OUT=$(mktemp -d)

cmp db/tests/fixtures/schema-2b.sql supabase/migrations/20261020000000_baseline.sql
echo "ok  : file baseline identik dengan schema.sql Tahap 2b"

db/tests/build_db.sh "${DB}_a" --schema-file db/tests/fixtures/schema-2b.sql
db/tests/build_db.sh "${DB}_b" --baseline-only
for x in a b; do
  pg_dump --schema-only --no-owner -d "${DB}_$x" | grep -v -E '^(-- Dumped (from|by)|\\(un)?restrict )' > "$OUT/$x.sql"
done
diff -u "$OUT/a.sql" "$OUT/b.sql"
echo "ok  : pg_dump schema identik ($(wc -l < "$OUT/a.sql") baris)"
PGOPTIONS="-c client_min_messages=warning" psql -X -q -d postgres -c "drop database ${DB}_a with (force)" -c "drop database ${DB}_b with (force)"
