'use client';
import { useRef, type ReactNode } from 'react';
import { useKeyboardInset } from '@/lib/hooks/use-keyboard-inset';

/**
 * Aksi utama menempel di bawah, di atas tab bar (U-07, zona jempol §5.1). Layar yang memakainya
 * memberi ruang bawah `pb-sticky` supaya konten terakhir tidak tertutup. Jika memuat kolom ketik
 * yang sedang fokus (S-20), bilah menempel di atas keyboard virtual (D-91, Q-96).
 */
export function StickyAction({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const inset = useKeyboardInset(ref);
  return (
    <div
      ref={ref}
      style={inset > 0 ? { bottom: inset } : undefined}
      className="fixed inset-x-0 bottom-[calc(var(--bottom-bars)+env(safe-area-inset-bottom))] z-20 border-t border-divider bg-surface/95 px-4 py-2 backdrop-blur"
    >
      <div className="mx-auto flex max-w-xl gap-2">{children}</div>
    </div>
  );
}
