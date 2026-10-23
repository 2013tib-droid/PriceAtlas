import type { ReactNode } from 'react';

/**
 * Aksi utama menempel di bawah, di atas tab bar (U-07, zona jempol §5.1). Layar yang memakainya
 * memberi ruang bawah `pb-sticky` supaya konten terakhir tidak tertutup.
 */
export function StickyAction({ children }: { children: ReactNode }) {
  return (
    <div className="fixed inset-x-0 bottom-[calc(var(--bottom-bars)+env(safe-area-inset-bottom))] z-20 border-t border-divider bg-surface/95 px-4 py-2 backdrop-blur">
      <div className="mx-auto flex max-w-xl gap-2">{children}</div>
    </div>
  );
}
