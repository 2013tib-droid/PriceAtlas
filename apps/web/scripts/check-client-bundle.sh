#!/usr/bin/env bash
# Pengaman bundle klien (docs/07 §11.4, §11.6). Dijalankan setelah `next build`.
#   1. .next/static tidak memuat nama/nilai kunci service role (D-61). GAGAL jika ada.
#   2. Anggaran JS halaman utama ≤ 200 kB gzip: hanya PERINGATAN.
set -euo pipefail
cd "$(dirname "$0")/.."
[[ -d .next/static ]] || { echo "GAGAL: .next/static tidak ada; jalankan next build dulu"; exit 1; }

fail=0
if grep -rIl -E 'SUPABASE_SERVICE_ROLE_KEY|service_role' .next/static; then
  echo "GAGAL: bundle klien memuat nama service role"; fail=1
fi
if [[ -n "${SUPABASE_SERVICE_ROLE_KEY:-}" ]] && grep -rIlF -- "$SUPABASE_SERVICE_ROLE_KEY" .next/static; then
  echo "GAGAL: bundle klien memuat NILAI SUPABASE_SERVICE_ROLE_KEY"; fail=1
fi
[[ $fail -eq 0 ]] && echo "ok  : bundle klien tanpa service role"

budget=$((200 * 1024))
html=.next/server/app/index.html
if [[ -f $html ]]; then
  # Polyfill `noModule` hanya dimuat browser lama; dihitung di total (dasar anggaran D-84) dan
  # ditampilkan terpisah (docs/07 §1.11, F-94).
  nomodule=$(grep -oE '<script src="/_next/static/chunks/[^"]*\.js" noModule' "$html" | grep -oE '/_next/static/chunks/[^"]*\.js' | sort -u || true)
  total=0
  legacy=0
  for f in $(grep -o '/_next/static/chunks/[^"]*\.js' "$html" | sort -u); do
    size=$(gzip -c ".next/${f#/_next/}" | wc -c)
    total=$((total + size))
    if grep -qxF "$f" <<<"$nomodule"; then legacy=$((legacy + size)); fi
  done
  kib=$((total / 1024))
  detail="modul $(((total - legacy) / 1024)) KiB + polyfill noModule $((legacy / 1024)) KiB"
  if (( total > budget )); then
    msg="JS halaman / = ${kib} KiB gzip (${detail}), melebihi anggaran 200 KiB (docs/07 §11.4, peringatan)"
    [[ -n "${GITHUB_ACTIONS:-}" ]] && echo "::warning::$msg" || echo "PERINGATAN: $msg"
  else
    echo "ok  : JS halaman / = ${kib} KiB gzip (${detail}; anggaran 200 KiB)"
  fi
fi
exit $fail
