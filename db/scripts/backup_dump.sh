#!/usr/bin/env bash
# Backup database produksi (Tahap 7b B5, docs/09 §8, D-101 Q-159). Dipakai .github/workflows/backup.yml;
# bisa juga dijalankan manual dari PC (docs/06 §5.4).
#   BACKUP_DATABASE_URL=postgresql://postgres.<ref>:…@<host-pooler>:5432/postgres \
#     db/scripts/backup_dump.sh <dir_keluaran>
# Hasil di <dir_keluaran> (TIDAK terenkripsi; enkripsi `age` dilakukan pemanggil):
#   public_app.dump  pg_dump -Fc schema public + app (skema + data; restore memakai datanya saja)
#   auth.dump        pg_dump -Fc --data-only auth.users, auth.identities, dan
#                    supabase_migrations.schema_migrations (versi migration untuk cek saat restore)
# Dua file karena pg_dump mengabaikan -n jika ada -t. Storage tidak ikut (foto mati, D-100).
# Log hanya jumlah tabel dan ukuran file, tidak pernah isi.
set -euo pipefail
OUT="${1:?pakai: backup_dump.sh <dir_keluaran>}"
URL="${BACKUP_DATABASE_URL:?BACKUP_DATABASE_URL wajib diisi}"
mkdir -p "$OUT"

common=(--format=custom --no-owner --no-privileges --compress=6)

pg_dump "$URL" "${common[@]}" --schema=public --schema=app --file="$OUT/public_app.dump"

auth_tables=(--table=auth.users --table=auth.identities)
# Tabel versi migration milik Supabase CLI; tidak ada di PostgreSQL biasa (mode A).
if [[ "$(psql "$URL" -X -tAq -c "select to_regclass('supabase_migrations.schema_migrations') is not null")" == t ]]; then
  auth_tables+=(--table=supabase_migrations.schema_migrations)
else
  echo "peringatan: supabase_migrations.schema_migrations tidak ada; versi migration tidak dicatat" >&2
fi
pg_dump "$URL" "${common[@]}" --data-only "${auth_tables[@]}" --file="$OUT/auth.dump"

for f in public_app auth; do
  n=$(pg_restore --list "$OUT/$f.dump" | grep -c ' TABLE DATA ' || true)
  printf 'ok  : %-15s %3d tabel data, %s byte\n' "$f.dump" "$n" "$(wc -c < "$OUT/$f.dump")"
  [[ $n -gt 0 ]] || { echo "GAGAL: $f.dump tanpa data tabel"; exit 1; }
done
