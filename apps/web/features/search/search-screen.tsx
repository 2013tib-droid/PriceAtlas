'use client';
// S-02 Hasil cari (docs/07 §7.3): R3 dari `q` URL (≥ 2 huruf, debounce di SearchLayout),
// dikelompokkan per Product Group di klien, baris "Tanya: …" (kerangka, D-57).
import { MessageCircleQuestion } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { QueryState } from '@/components/app/screen-state';
import { GroupHeader, groupResults } from '@/components/product/group-header';
import { ProductCard } from '@/components/product/product-card';
import { Skeleton } from '@/components/ui/skeleton';
import { fill, SEARCH_COPY, STATE_COPY } from '@/lib/copy/id';
import { MIN_QUERY, normalizeQuery, useSearch } from '@/lib/data/queries';
import { useOnline } from '@/lib/hooks/use-online';
import { useSearchDock } from './search-layout';

export function CardSkeleton() {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-divider p-3">
      <Skeleton className="h-5 w-2/3" />
      <Skeleton className="h-7 w-1/2" />
      <Skeleton className="h-4 w-3/4" />
      <Skeleton className="h-4 w-1/2" />
    </div>
  );
}

/** Baris "Tanya: …" (U-18). Pengiriman pertanyaan baru ada di Tahap 6 (D-57); di M1 hanya kerangka. */
function AskRow({ q }: { q: string }) {
  return (
    <p
      aria-disabled="true"
      className="flex min-h-touch items-center gap-2 rounded-lg border border-dashed border-border px-3 text-sm text-muted-foreground"
    >
      <MessageCircleQuestion aria-hidden className="size-5 shrink-0" />
      <span className="flex-1">{fill(SEARCH_COPY.ask, { q })}</span>
      <span className="text-xs">{SEARCH_COPY.askHint}</span>
    </p>
  );
}

export function SearchScreen() {
  const params = useSearchParams();
  const raw = params?.get('q') ?? '';
  const q = normalizeQuery(raw);
  const search = useSearch(q);
  const online = useOnline();
  const { remember } = useSearchDock();

  return (
    <section className="flex flex-col gap-4 p-4" aria-labelledby="judul-layar">
      <h1 id="judul-layar" tabIndex={-1} className="sr-only">
        {SEARCH_COPY.title}
      </h1>
      {q.length < MIN_QUERY ? (
        <p className="text-base text-muted-foreground">{SEARCH_COPY.minChars}</p>
      ) : (
        <QueryState
          query={search}
          skeleton={
            <>
              <CardSkeleton />
              <CardSkeleton />
              <CardSkeleton />
            </>
          }
          isEmpty={(d) => d.length === 0}
          empty={
            <div className="flex flex-col gap-3">
              <p role="status" className="text-base">
                {fill(SEARCH_COPY.notFound, { q })}
              </p>
              <AskRow q={q} />
            </div>
          }
        >
          {(cards) => (
            <>
              <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
                {fill(SEARCH_COPY.resultCount, { n: cards.length, q })}
                {!online ? ` · ${STATE_COPY.cachedLabel}` : ''}
              </p>
              {groupResults(cards).map((s) => (
                <section key={s.key} className="flex flex-col gap-2" aria-label={s.group?.name}>
                  {s.group ? <GroupHeader group={s.group} cards={s.cards} /> : null}
                  {s.cards.map((c) => (
                    <ProductCard
                      key={c.product.id}
                      card={c}
                      headingLevel={s.group ? 3 : 2}
                      onOpen={() => remember(q)}
                    />
                  ))}
                </section>
              ))}
              <AskRow q={q} />
            </>
          )}
        </QueryState>
      )}
    </section>
  );
}
