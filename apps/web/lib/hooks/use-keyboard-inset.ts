'use client';
// Bilah bawah yang memuat kolom ketik (SearchDock, StickyAction) mengikuti keyboard virtual
// (D-91, Q-96, F-100). iOS Safari tidak mengecilkan layout viewport saat keyboard muncul, jadi
// `position: fixed; bottom` tertutup keyboard; `visualViewport` memberi tinggi area yang terlihat.
// Android/desktop: selisihnya 0, tidak ada perubahan. Tanpa pustaka.
import { useEffect, useState, type RefObject } from 'react';

/** Tinggi bagian bawah layout viewport yang tertutup (keyboard), dalam px; 0 jika tidak ada. */
export function keyboardInset(
  innerHeight: number,
  viewport: { height: number; offsetTop: number } | null | undefined,
): number {
  if (!viewport) return 0;
  const inset = Math.round(innerHeight - viewport.height - viewport.offsetTop);
  // Selisih kecil (bilah alamat browser) bukan keyboard.
  return inset > 80 ? inset : 0;
}

/**
 * Inset keyboard selama fokus ada di dalam `container` (keyboard dari kolom lain tidak menggeser
 * bilah ini). Dipakai sebagai `style={{ bottom: inset }}` saat > 0.
 */
export function useKeyboardInset(container: RefObject<HTMLElement | null>): number {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    const vv = typeof window === 'undefined' ? undefined : window.visualViewport;
    if (!vv) return;
    const update = () => {
      const el = container.current;
      const focused = el != null && document.activeElement != null && el.contains(document.activeElement);
      setInset(focused ? keyboardInset(window.innerHeight, vv) : 0);
    };
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    document.addEventListener('focusin', update);
    document.addEventListener('focusout', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
      document.removeEventListener('focusin', update);
      document.removeEventListener('focusout', update);
    };
  }, [container]);
  return inset;
}
