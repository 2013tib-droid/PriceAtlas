'use client';
// Lapisan yang dibuka lewat parameter query (docs/07 §3.3: `?pilih=produk&untuk=…`, `?sheet=…`),
// supaya tombol kembali Android menutup lapisan, bukan meninggalkan layar. Pola sama dengan S-03b.
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useRef } from 'react';

export function useLayer() {
  const router = useRouter();
  const pathname = usePathname() ?? '/';
  const params = useSearchParams();
  const pushed = useRef(0);

  const open = useCallback(
    (set: Record<string, string>) => {
      const qs = new URLSearchParams(params?.toString());
      for (const [k, v] of Object.entries(set)) qs.set(k, v);
      pushed.current += 1;
      router.push(`${pathname}?${qs.toString()}`, { scroll: false });
    },
    [params, pathname, router],
  );

  /** Tutup lapisan teratas: kembali jika dibuka dari layar ini, selain itu hapus parameternya. */
  const close = useCallback(
    (keys: string[]) => {
      if (pushed.current > 0) {
        pushed.current -= 1;
        router.back();
        return;
      }
      const qs = new URLSearchParams(params?.toString());
      for (const k of keys) qs.delete(k);
      const s = qs.toString();
      router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false });
    },
    [params, pathname, router],
  );

  /** Tutup semua lapisan tanpa kembali (mis. setelah memilih produk). */
  const clear = useCallback(
    (keys: string[]) => {
      const qs = new URLSearchParams(params?.toString());
      for (const k of keys) qs.delete(k);
      const s = qs.toString();
      const n = pushed.current;
      pushed.current = 0;
      if (n > 0 && typeof window !== 'undefined') {
        // Kembali ke entri sebelum lapisan dibuka, supaya riwayat tidak menumpuk.
        window.history.go(-n);
        return;
      }
      router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false });
    },
    [params, pathname, router],
  );

  return { params, open, close, clear };
}
