#!/usr/bin/env bash
# Pengaman bundle klien (docs/07 §11.4, §11.6). Dijalankan setelah `next build`.
#   1. .next/static tidak memuat nama/nilai kunci service role (D-61), kunci Anthropic, SDK
#      Anthropic (Tanya, docs/08 §3.1), atau token/endpoint dispatch GitHub (Tahap 7b B4,
#      /api/worker/kick). GAGAL jika ada.
#   2. Anggaran JS halaman utama (gzip, modul saja; polyfill noModule ditampilkan terpisah, D-91):
#      PERINGATAN jika > 350 KiB; 200 KiB tetap target. Tidak pernah gagal.
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

# Tanya (docs/08 §3.1): kunci Anthropic dan SDK hanya di route server /api/ask.
afail=0
if grep -rIl -E 'ANTHROPIC_API_KEY|sk-ant-|anthropic-version|server-side-fallback-' .next/static; then
  echo "GAGAL: bundle klien memuat nama kunci/SDK Anthropic"; afail=1
fi
if [[ -n "${ANTHROPIC_API_KEY:-}" ]] && grep -rIlF -- "$ANTHROPIC_API_KEY" .next/static; then
  echo "GAGAL: bundle klien memuat NILAI ANTHROPIC_API_KEY"; afail=1
fi
[[ $afail -eq 0 ]] && echo "ok  : bundle klien tanpa kunci/SDK Anthropic"
fail=$((fail | afail))

# Pemicu worker (docs/09 §3.3, §5.1): token GitHub dan panggilan dispatch hanya di route server.
gfail=0
if grep -rIl -E 'GITHUB_DISPATCH_TOKEN|GITHUB_DISPATCH_REPO|github_pat_|api\.github\.com|/dispatches' .next/static; then
  echo "GAGAL: bundle klien memuat nama token/endpoint dispatch GitHub"; gfail=1
fi
if [[ -n "${GITHUB_DISPATCH_TOKEN:-}" ]] && grep -rIlF -- "$GITHUB_DISPATCH_TOKEN" .next/static; then
  echo "GAGAL: bundle klien memuat NILAI GITHUB_DISPATCH_TOKEN"; gfail=1
fi
[[ $gfail -eq 0 ]] && echo "ok  : bundle klien tanpa token/endpoint dispatch GitHub"
fail=$((fail | gfail))

limit=$((350 * 1024))
target=$((200 * 1024))
html=.next/server/app/index.html
if [[ -f $html ]]; then
  # Polyfill `noModule` hanya dimuat browser lama: tidak dihitung, ditampilkan terpisah (D-91, F-94).
  nomodule=$(grep -oE '<script src="/_next/static/chunks/[^"]*\.js" noModule' "$html" | grep -oE '/_next/static/chunks/[^"]*\.js' | sort -u || true)
  modules=0
  legacy=0
  for f in $(grep -o '/_next/static/chunks/[^"]*\.js' "$html" | sort -u); do
    size=$(gzip -c ".next/${f#/_next/}" | wc -c)
    if grep -qxF "$f" <<<"$nomodule"; then legacy=$((legacy + size)); else modules=$((modules + size)); fi
  done
  kib=$((modules / 1024))
  detail="polyfill noModule $((legacy / 1024)) KiB tidak dihitung"
  if (( modules > limit )); then
    msg="JS halaman / = ${kib} KiB gzip (modul; ${detail}), melebihi batas peringatan 350 KiB; target 200 KiB (D-91)"
    [[ -n "${GITHUB_ACTIONS:-}" ]] && echo "::warning::$msg" || echo "PERINGATAN: $msg"
  elif (( modules > target )); then
    echo "ok  : JS halaman / = ${kib} KiB gzip (modul; ${detail}), di bawah batas 350 KiB; target 200 KiB belum tercapai (D-91)"
  else
    echo "ok  : JS halaman / = ${kib} KiB gzip (modul; ${detail}; target 200 KiB)"
  fi
fi
exit $fail
