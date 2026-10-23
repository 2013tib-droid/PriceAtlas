'use client';
import { usePathname, useSearchParams } from 'next/navigation';
import { useEffect } from 'react';

const LAST_APP_PATH = 'priceatlas:last-app-path';

/** Layar (app) terakhir yang dibuka, untuk "kembali" dari layar penuh (S-07 → layar sebelumnya). */
export function lastAppPath(): string {
  try {
    return sessionStorage.getItem(LAST_APP_PATH) ?? '/';
  } catch {
    return '/';
  }
}

export function useRememberAppPath() {
  const pathname = usePathname();
  const search = useSearchParams();
  useEffect(() => {
    // S-12 hanya pemilih: kembali dari kamera label (mode manual) menuju layar sebelum S-12.
    if (pathname === '/lokasi') return;
    const qs = new URLSearchParams(search?.toString());
    qs.delete('sheet');
    const s = qs.toString();
    try {
      sessionStorage.setItem(LAST_APP_PATH, s ? `${pathname}?${s}` : (pathname ?? '/'));
    } catch {
      // sessionStorage tidak tersedia: kembali ke beranda.
    }
  }, [pathname, search]);
}
