#!/usr/bin/env bash
# Pemeriksaan rahasia sederhana untuk CI (docs/05 §7.7). Memindai file yang dilacak git.
# Gagal jika menemukan: JWT/kunci Supabase, kunci API Anthropic, kunci privat, nilai env rahasia
# yang terisi, kunci service role yang diberi prefix NEXT_PUBLIC_, atau file gambar di luar folder
# fixture/aset yang diizinkan (F-117: foto struk asli berisi PII tidak boleh masuk riwayat git).
set -euo pipefail
cd "$(dirname "$0")/.."
fail=0
check() {  # check <deskripsi> <regex>
  local hits
  hits=$(git ls-files -z | xargs -0 grep -I -n -E "$2" -- 2>/dev/null | grep -v -E '^(pnpm-lock\.yaml|scripts/check-secrets\.sh):' || true)
  if [[ -n "$hits" ]]; then echo "GAGAL: $1"; echo "$hits" | cut -c1-160; fail=1; fi
}
check 'JWT / kunci Supabase'           'eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}'
check 'kunci Supabase format baru'     'sb_(secret|publishable)_[A-Za-z0-9_-]{20,}'
check 'kunci API Anthropic'            'sk-ant-[A-Za-z0-9_-]{20,}'
check 'kunci privat'                   '-----BEGIN [A-Z ]*PRIVATE KEY-----'
check 'nilai env rahasia terisi'       '^(SUPABASE_SERVICE_ROLE_KEY|GOOGLE_OAUTH_SECRET|ANTHROPIC_API_KEY)=[^ #<]+'
check 'service role diberi NEXT_PUBLIC' 'NEXT_PUBLIC_[A-Z_]*SERVICE_ROLE'
if git ls-files | grep -E '(^|/)\.env($|\.local$|\.production$)' ; then echo "GAGAL: file .env dilacak git"; fail=1; fi
# F-117 (docs/08 §4.2): gambar hanya boleh di folder fixture sintetis dan aset aplikasi.
IMAGE_ALLOWED='^(apps/worker/test/fixtures/|apps/web/test/fixtures/|apps/web/e2e/fixtures/|apps/web/public/icons/|docs/wireframes/)'
images=$(git ls-files | grep -i -E '\.(jpe?g|png|heic|heif|webp|gif|avif)$' | grep -v -E "$IMAGE_ALLOWED" || true)
if [[ -n "$images" ]]; then echo "GAGAL: file gambar di luar folder yang diizinkan (F-117)"; echo "$images"; fail=1; fi
[[ $fail -eq 0 ]] && echo "ok  : tidak ada rahasia di repo"
exit $fail
