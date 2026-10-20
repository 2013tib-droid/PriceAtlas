'use client';
// Layout bersama S-01 (/) dan S-02 (/cari): SearchDock tetap terpasang saat berpindah dari beranda
// ke hasil cari, sehingga fokus dan keyboard tidak hilang. Kata kunci ditulis ke URL setelah
// jeda 250 ms (R3 debounce, docs/07 §7.3); S-02 membaca `q` dari URL.
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { SearchDock } from '@/components/app/search-dock';
import { normalizeQuery, MIN_QUERY } from '@/lib/data/queries';
import { usePref } from '@/lib/hooks/use-pref';
import { PREF_KEYS, pushRecentSearch } from '@/lib/offline/prefs';

export const SEARCH_DEBOUNCE_MS = 250;

interface SearchCtx {
  focus: () => void;
  /** Simpan kata kunci ke "Pencarian terakhir" (💾). */
  remember: (q: string) => void;
}
const Ctx = createContext<SearchCtx>({ focus: () => undefined, remember: () => undefined });
export const useSearchDock = () => useContext(Ctx);

export function searchHref(q: string): string {
  return `/cari?q=${encodeURIComponent(q)}`;
}

export function SearchLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname() ?? '/';
  const params = useSearchParams();
  const urlQ = pathname === '/cari' ? (params?.get('q') ?? '') : '';
  const [text, setText] = useState(urlQ);
  const synced = useRef(urlQ);
  const inputRef = useRef<HTMLInputElement>(null);
  const recent = usePref<string[]>(PREF_KEYS.recentSearches, []);

  // URL berubah dari luar (kembali, tap pencarian terakhir): isi kolom mengikuti.
  useEffect(() => {
    if (urlQ !== synced.current) {
      synced.current = urlQ;
      setText(urlQ);
    }
  }, [urlQ]);

  const navigate = useCallback(
    (q: string) => {
      synced.current = q;
      if (!q.trim()) {
        if (pathname === '/cari') router.replace('/', { scroll: false });
        return;
      }
      if (pathname === '/cari') router.replace(searchHref(q), { scroll: false });
      else router.push(searchHref(q));
    },
    [pathname, router],
  );

  useEffect(() => {
    if (text === synced.current) return;
    const t = setTimeout(() => navigate(text), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [text, navigate]);

  const { update } = recent;
  const remember = useCallback(
    (q: string) => {
      if (normalizeQuery(q).length >= MIN_QUERY) void update((list) => pushRecentSearch(list, q));
    },
    [update],
  );

  const ctx = useMemo<SearchCtx>(() => ({ focus: () => inputRef.current?.focus(), remember }), [remember]);

  return (
    <Ctx.Provider value={ctx}>
      <div className="pb-20">{children}</div>
      <SearchDock
        value={text}
        onChange={setText}
        inputRef={inputRef}
        onSubmit={(q) => {
          remember(q);
          if (q !== synced.current || pathname !== '/cari') navigate(q);
          inputRef.current?.blur();
        }}
      />
    </Ctx.Provider>
  );
}
