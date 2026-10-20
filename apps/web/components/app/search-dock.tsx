'use client';
// Kolom search di bawah layar, di atas tab bar (U-02, docs/07 §7.2). Ikon scan hanya jika
// BarcodeDetector + ean_13 didukung (D-58).
import { ScanBarcode, Search, X } from 'lucide-react';
import Link from 'next/link';
import type { RefObject } from 'react';
import { SEARCH_COPY } from '@/lib/copy/id';
import { useBarcodeSupport } from '@/lib/media/barcode';

export function SearchDock({
  value,
  onChange,
  onSubmit,
  inputRef,
  placement = 'tabbar',
  showScan = true,
  label = SEARCH_COPY.label,
  id = 'search-dock',
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  inputRef?: RefObject<HTMLInputElement | null>;
  /** `bottom`: di lapisan layar penuh tanpa tab bar (S-14). */
  placement?: 'tabbar' | 'bottom';
  showScan?: boolean;
  label?: string;
  id?: string;
}) {
  const scan = useBarcodeSupport() && showScan;
  return (
    <form
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(value);
      }}
      className={
        placement === 'tabbar'
          ? 'fixed inset-x-0 bottom-[calc(var(--spacing-tabbar)+env(safe-area-inset-bottom))] z-20 border-t border-divider bg-surface px-3 py-2'
          : 'fixed inset-x-0 bottom-0 z-20 border-t border-divider bg-surface px-3 pt-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))]'
      }
    >
      <div className="mx-auto flex max-w-xl items-center gap-2">
        <div className="relative flex-1">
          <label htmlFor={id} className="sr-only">
            {label}
          </label>
          <Search
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2 text-muted-foreground"
          />
          <input
            ref={inputRef}
            id={id}
            type="search"
            inputMode="search"
            enterKeyHint="search"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            placeholder={SEARCH_COPY.placeholder}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="h-action w-full rounded-lg border border-border bg-background pr-11 pl-10 text-base [&::-webkit-search-cancel-button]:hidden"
          />
          {value ? (
            <button
              type="button"
              onClick={() => {
                onChange('');
                inputRef?.current?.focus();
              }}
              aria-label={SEARCH_COPY.clear}
              className="absolute top-1/2 right-0 flex size-touch -translate-y-1/2 items-center justify-center text-muted-foreground"
            >
              <X aria-hidden className="size-5" />
            </button>
          ) : null}
        </div>
        {scan ? (
          <Link
            href="/kamera?jenis=barcode"
            aria-label={SEARCH_COPY.scan}
            className="flex size-action shrink-0 items-center justify-center rounded-lg border border-border"
          >
            <ScanBarcode aria-hidden className="size-6" />
          </Link>
        ) : null}
      </div>
    </form>
  );
}
