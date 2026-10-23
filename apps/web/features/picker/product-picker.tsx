'use client';
// S-14 Pilih produk (docs/07 §7.3, wireframe S-14, docs/05 §3.3 S-14): lapisan `?pilih=produk&untuk=…`
// di atas S-10/S-11/S-15. SearchDock terisi raw_text / judul listing, saran + kandidat (≤ 5) dari
// R15/R16, hasil R3, "+ Buat produk baru" → S-15 (lapisan `&baru=1`). Peringatan beda ukuran dihitung
// di klien dan tidak memblokir. RLS sudah membatasi ke produk global + privat sendiri.
// Mode target merge (S-17) / tujuan split (S-18): judul sendiri, produk sumber disembunyikan
// (`exclude`), tanpa "+ Buat produk baru" jika `allowCreate` false.
import { ArrowLeft, Plus } from 'lucide-react';
import dynamic from 'next/dynamic';
import { useEffect, useRef, useState } from 'react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import { SearchDock } from '@/components/app/search-dock';
import { LoadingState } from '@/components/app/screen-state';
import { PrivateBadge } from '@/components/price/price';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import type { ProductLite } from '@/lib/confirm/receipt';
import { sizeMismatch } from '@/lib/confirm/size';
import { fill, PICKER_COPY } from '@/lib/copy/id';
import { errorCopy } from '@/lib/data/errors';
import { MIN_QUERY, normalizeQuery, useSearch } from '@/lib/data/queries';
import { formatSize } from '@/lib/format';
import { productTitle } from '@/lib/format/product';

// S-15 hanya dimuat saat dibuka (react-hook-form tidak masuk bundle S-10/S-11 sampai diperlukan).
const NewProductForm = dynamic(() => import('@/features/new-product/new-product-form').then((m) => m.NewProductForm), {
  loading: () => (
    <LoadingState>
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-10 w-full" />
    </LoadingState>
  ),
});

export const PICKER_KEYS = ['pilih', 'untuk', 'baru'];
export const MAX_CANDIDATES = 5;

function PickRow({
  product,
  contextText,
  onPick,
  testId,
}: {
  product: ProductLite;
  contextText?: string | null;
  onPick: (p: ProductLite) => void;
  testId: string;
}) {
  const { title, size } = productTitle(product);
  const mismatch = sizeMismatch(contextText, product);
  return (
    <li data-testid={testId}>
      <button
        type="button"
        onClick={() => onPick(product)}
        aria-label={fill(PICKER_COPY.choose, { name: `${title} ${size}` })}
        className="flex min-h-action w-full flex-col items-start gap-0.5 rounded-lg border border-divider px-3 py-2 text-left hover:bg-muted"
      >
        <span className="flex w-full items-start justify-between gap-2">
          <span className="font-medium">
            {title} <span className="font-normal text-muted-foreground">{size}</span>
          </span>
          {product.is_private ? <PrivateBadge /> : null}
        </span>
        {product.brand_name ? <span className="text-sm text-muted-foreground">{product.brand_name}</span> : null}
        {mismatch ? (
          <span className="text-sm text-warning-foreground" data-testid="size-mismatch">
            {fill(PICKER_COPY.sizeMismatch, { text: mismatch, size: formatSize(product) })}
          </span>
        ) : null}
      </button>
    </li>
  );
}

export interface ProductPickerProps {
  open: boolean;
  onClose: () => void;
  /** Teks awal kolom search (raw_text struk/label atau judul listing). */
  initialQuery: string;
  /** Teks sumber untuk peringatan beda ukuran. */
  contextText?: string | null;
  /** Barcode dari scan yang tidak dikenal (D-85) → diteruskan ke S-15. */
  barcode?: string | null;
  suggestion?: ProductLite | null;
  candidates?: readonly ProductLite[];
  onPick: (p: ProductLite) => void;
  /** Judul lapisan (default "Pilih produk"). */
  title?: string;
  /** Produk yang tidak boleh dipilih (mode target merge: produk sumber). */
  exclude?: readonly string[];
  /** "+ Buat produk baru" (default ada). */
  allowCreate?: boolean;
  /** Lapisan S-15 (`&baru=1`). */
  createOpen: boolean;
  onCreateOpen: () => void;
  onCreateClose: () => void;
}

export function ProductPicker(props: ProductPickerProps) {
  return (
    <DialogPrimitive.Root open={props.open} onOpenChange={(v) => (v ? undefined : props.onClose())}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Content
          className="fixed inset-0 z-50 flex flex-col overflow-y-auto bg-background"
          aria-describedby={undefined}
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          {/* Isi dipasang ulang setiap kali dibuka: prefill raw_text baris/item yang dipilih. */}
          <PickerBody {...props} />
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function PickerBody(props: ProductPickerProps) {
  const { onClose, initialQuery, contextText, barcode, candidates = [], onPick } = props;
  const exclude = new Set(props.exclude ?? []);
  const allowCreate = props.allowCreate ?? true;
  const suggestion = props.suggestion && !exclude.has(props.suggestion.id) ? props.suggestion : null;
  const [value, setValue] = useState(initialQuery);
  const [query, setQuery] = useState(initialQuery);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!props.createOpen) inputRef.current?.focus();
  }, [props.createOpen]);
  useEffect(() => {
    const t = setTimeout(() => setQuery(value), 250);
    return () => clearTimeout(t);
  }, [value]);

  const search = useSearch(query);
  const q = normalizeQuery(query);
  const others = candidates.filter((c) => c.id !== suggestion?.id && !exclude.has(c.id)).slice(0, MAX_CANDIDATES);
  const results = (search.data ?? []).map((r) => r.product).filter((p) => !exclude.has(p.id));

  return (
    <>
      <header className="sticky top-0 z-10 flex items-center gap-2 border-b border-divider bg-surface px-2 py-2">
        <Button variant="ghost" size="icon" onClick={props.createOpen && allowCreate ? props.onCreateClose : onClose}>
          <ArrowLeft aria-hidden />
          <span className="sr-only">{PICKER_COPY.close}</span>
        </Button>
        <DialogPrimitive.Title className="text-lg font-semibold">
          {props.createOpen && allowCreate ? null : (props.title ?? PICKER_COPY.title)}
        </DialogPrimitive.Title>
      </header>
      {props.createOpen && allowCreate ? (
        <div className="mx-auto w-full max-w-xl p-4">
          <NewProductForm
            initialName={q || contextText || ''}
            initialBarcode={barcode ?? undefined}
            onCreated={(card) => onPick(card.product)}
            onUseExisting={onPick}
            onCancel={props.onCreateClose}
          />
        </div>
      ) : (
        <div className="mx-auto flex w-full max-w-xl flex-col gap-4 p-4 pb-32" data-testid="product-picker">
          {barcode ? (
            <p className="rounded-lg bg-muted p-3 text-sm">{fill(PICKER_COPY.barcode, { code: barcode })}</p>
          ) : contextText ? (
            <p className="text-sm text-muted-foreground">{fill(PICKER_COPY.forText, { text: contextText })}</p>
          ) : null}
          {suggestion ? (
            <section aria-labelledby="pick-saran" className="flex flex-col gap-2">
              <h2 id="pick-saran" className="text-base font-semibold">
                {PICKER_COPY.suggestion}
              </h2>
              <ul className="flex flex-col gap-2">
                <PickRow product={suggestion} contextText={contextText} onPick={onPick} testId="pick-suggestion" />
              </ul>
            </section>
          ) : null}
          {others.length ? (
            <section aria-labelledby="pick-kandidat" className="flex flex-col gap-2">
              <h2 id="pick-kandidat" className="text-base font-semibold">
                {PICKER_COPY.candidates}
              </h2>
              <ul className="flex flex-col gap-2">
                {others.map((c) => (
                  <PickRow key={c.id} product={c} contextText={contextText} onPick={onPick} testId="pick-candidate" />
                ))}
              </ul>
            </section>
          ) : null}
          <section aria-labelledby="pick-hasil" className="flex flex-col gap-2" aria-busy={search.isFetching}>
            <h2 id="pick-hasil" className="text-base font-semibold">
              {PICKER_COPY.results}
            </h2>
            {q.length < MIN_QUERY ? (
              <p className="text-sm text-muted-foreground">{PICKER_COPY.minChars}</p>
            ) : search.isError && !search.data ? (
              <p role="alert" className="text-sm">
                {errorCopy(search.error).message}
              </p>
            ) : search.isPending ? (
              <LoadingState label={PICKER_COPY.searching}>
                <Skeleton className="h-14 w-full" />
                <Skeleton className="h-14 w-full" />
              </LoadingState>
            ) : results.length === 0 ? (
              <p className="text-sm" data-testid="pick-empty">
                {PICKER_COPY.notFound}
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {results.map((p) => (
                  <PickRow key={p.id} product={p} contextText={contextText} onPick={onPick} testId="pick-result" />
                ))}
              </ul>
            )}
            {allowCreate ? (
              <Button variant="secondary" size="action" onClick={props.onCreateOpen}>
                <Plus aria-hidden />
                {PICKER_COPY.create}
              </Button>
            ) : null}
          </section>
          <SearchDock
            id="picker-search"
            value={value}
            onChange={setValue}
            onSubmit={(v) => setQuery(v)}
            inputRef={inputRef}
            placement="bottom"
            showScan={false}
          />
        </div>
      )}
    </>
  );
}
