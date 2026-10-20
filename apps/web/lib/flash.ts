'use client';
// Toast yang tetap tampil walau navigasi berikutnya menjadi muat ulang penuh (mis. offline: payload
// RSC tidak tersedia sehingga Next memuat dokumen dari cache service worker). Disimpan sebentar di
// sessionStorage dan ditampilkan sekali oleh FlashToast di dokumen baru (U-11).
import { useEffect } from 'react';
import { toast } from 'sonner';

const KEY = 'priceatlas:flash';
const TTL_MS = 10_000;

type Flash = { kind: 'success' | 'warning'; message: string; at: number };

export function flashToast(kind: Flash['kind'], message: string): void {
  toast[kind](message);
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ kind, message, at: Date.now() } satisfies Flash));
    // Navigasi klien: dokumen sama, toast sudah tampil → hapus.
    setTimeout(() => sessionStorage.removeItem(KEY), 3_000);
  } catch {
    // sessionStorage tidak tersedia: toast di dokumen ini saja.
  }
}

export function FlashToast() {
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(KEY);
      if (!raw) return;
      sessionStorage.removeItem(KEY);
      const f = JSON.parse(raw) as Flash;
      if (Date.now() - f.at < TTL_MS) toast[f.kind](f.message);
    } catch {
      // abaikan
    }
  }, []);
  return null;
}
