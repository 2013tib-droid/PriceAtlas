'use client';
import { useEffect, useState } from 'react';

/** Waktu sekarang (ms) yang diperbarui tiap `intervalMs`, untuk teks yang bergantung umur data. */
export function useNow(intervalMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}
