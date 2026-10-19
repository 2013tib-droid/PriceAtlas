#!/usr/bin/env bash
# Cetak inventaris hak akses dari database hasil migration, dalam format daftar
# yang ditempel di db/tests/flows/99_privilege_inventory.sql setelah ditinjau.
set -euo pipefail
cd "$(dirname "$0")/../.."
DB="${TEST_DB:-priceatlas_inventory}"
db/tests/build_db.sh "$DB"
psql -X -q -v ON_ERROR_STOP=1 -d "$DB" -c "create schema test" -f db/tests/lib/privilege_inventory.sql >/dev/null
psql -X -At -d "$DB" -c "select format('  (%L, %L, %L, %L),', role, kind, obj, privs) from test.privilege_inventory order by 1"
PGOPTIONS="-c client_min_messages=warning" psql -X -q -d postgres -c "drop database ${DB} with (force)"
