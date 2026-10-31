#!/usr/bin/env bash
# Restore backup (Tahap 7b B5, docs/09 §8, docs/06 §5.5) ke database yang skemanya sudah dibangun
# dari supabase/migrations pada versi yang SAMA dengan backup (Supabase lokal `supabase start`,
# proyek baru setelah `supabase db push`, atau mode A `db/tests/build_db.sh`).
#   db/scripts/backup_restore.sh <dir berisi public_app.dump + auth.dump> <TARGET_URL>
# Langkah (satu transaksi; gagal = tidak ada yang berubah):
#   1. Cek versi migration di backup = di target (jika keduanya punya supabase_migrations).
#   2. SET session_replication_role = replica: trigger turunan (D-63), audit, penjaga status, dan
#      FK tidak berjalan, sehingga data turunan (ringkasan, audit) dipulihkan apa adanya, bukan
#      dihitung ulang/ganda. pg_cron di target tidak melihat apa pun sampai commit.
#   3. TRUNCATE … CASCADE semua tabel yang ada datanya di backup (termasuk data referensi dari
#      migration/seed), lalu data auth → public → app.
# Target produksi (*.supabase.co / *.supabase.com) ditolak kecuali ALLOW_REMOTE_RESTORE=1.
set -euo pipefail
DIR="${1:?pakai: backup_restore.sh <dir> <TARGET_URL>}"
TARGET="${2:?pakai: backup_restore.sh <dir> <TARGET_URL>}"
for f in auth public_app; do [[ -f "$DIR/$f.dump" ]] || { echo "GAGAL: $DIR/$f.dump tidak ada"; exit 1; }; done

if [[ "$TARGET" =~ supabase\.(co|com) && "${ALLOW_REMOTE_RESTORE:-}" != 1 ]]; then
  echo "GAGAL: target terlihat seperti proyek Supabase hosted. Restore ke proyek baru yang kosong saja,"
  echo "       lalu ulangi dengan ALLOW_REMOTE_RESTORE=1. Jangan pernah ke produksi yang sedang dipakai."
  exit 1
fi

PSQL=(psql "$TARGET" -X -v ON_ERROR_STOP=1 -q)

# 1. Versi migration.
dump_versions=$(pg_restore --data-only --table=schema_migrations --schema=supabase_migrations -f - "$DIR/auth.dump" 2>/dev/null \
  | awk '/^COPY supabase_migrations\.schema_migrations /{c=1; next} c && /^\\\.$/{c=0} c{print $1}' | sort | tail -n 1)
target_versions=$("${PSQL[@]}" -tA -c "select case when to_regclass('supabase_migrations.schema_migrations') is null then ''
                                                    else (select max(version) from supabase_migrations.schema_migrations) end")
if [[ -n "$dump_versions" && -n "$target_versions" ]]; then
  if [[ "$dump_versions" != "$target_versions" ]]; then
    echo "GAGAL: migration terakhir backup $dump_versions, target $target_versions."
    echo "       Bangun target dari commit dengan migration terakhir $dump_versions (docs/06 §5.5)."
    exit 1
  fi
  echo "ok  : versi migration sama ($dump_versions)"
else
  echo "peringatan: versi migration tidak bisa dibandingkan (backup: ${dump_versions:-–}, target: ${target_versions:-–})"
fi

# 2–3. Daftar tabel dari TOC kedua backup (schema_migrations tidak di-restore: milik target).
tables=$(for f in auth public_app; do pg_restore --list "$DIR/$f.dump"; done \
  | awk '$4 == "TABLE" && $5 == "DATA" && $6 != "supabase_migrations" {printf "%s\"%s\".\"%s\"", sep, $6, $7; sep=", "}')
[[ -n "$tables" ]] || { echo "GAGAL: backup tanpa data tabel"; exit 1; }

{
  echo "begin;"
  echo "set local session_replication_role = replica;"
  echo "truncate table $tables cascade;"
  pg_restore --data-only --no-owner --no-privileges --exclude-schema=supabase_migrations -f - "$DIR/auth.dump"
  pg_restore --data-only --no-owner --no-privileges -f - "$DIR/public_app.dump"
  echo "commit;"
} | "${PSQL[@]}" -o /dev/null

"${PSQL[@]}" -tA -F ' ' -c "
  select 'auth.users', count(*) from auth.users
  union all select 'household', count(*) from public.household
  union all select 'receipt', count(*) from public.receipt
  union all select 'price_record', count(*) from public.price_record
  union all select 'capture', count(*) from public.capture" | sed 's/^/ok  : /'
echo "ok  : restore selesai"
