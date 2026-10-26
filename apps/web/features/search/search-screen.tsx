'use client';
// S-02 Hasil cari (docs/07 §7.3): R3 dari `q` URL (≥ 2 huruf, debounce di SearchLayout),
// dikelompokkan per Product Group di klien, baris "Tanya: …" → S-20 (kerangka, D-57). Offline tanpa
// hasil R3 tersimpan: cari di kartu R5 (`offline_cards`, D-60, §5.6) dengan label "data tersimpan".
import type { ProductCard as Card } from '@priceatlas/contracts';
import type { UseQueryResult } from '@tanstack/react-query';
import { ChevronRight, MessageCircleQuestion } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { QueryState } from '@/components/app/screen-state';
import { GroupHeader, groupResults } from '@/components/product/group-header';
import { ProductCard } from '@/components/product/product-card';
import { Skeleton } from '@/components/ui/skeleton';
import { fill, SEARCH_COPY, STATE_COPY } from '@/lib/copy/id';
import { toAppError } from '@/lib/data/errors';
import { useOfflineSearch } from '@/lib/data/offline-cache';
import { MIN_QUERY, normalizeQuery, useSearch } from '@/lib/data/queries';
import { useOnline } from '@/lib/hooks/use-online';
import { askHref } from '@/lib/ask/ask';
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

/** Baris "Tanya: …" (U-18) → S-20. Jawaban sungguhan di Tahap 6 (D-57); M7 hanya kerangka. */
function AskRow({ q }: { q: string }) {
  return (
    <Link
      href={askHref(q)}
      className="flex min-h-touch items-center gap-2 rounded-lg border border-dashed border-border px-3 text-sm"
    >
      <MessageCircleQuestion aria-hidden className="size-5 shrink-0" />
      <span className="flex-1">{fill(SEARCH_COPY.ask, { q })}</span>
      <span className="text-xs text-muted-foreground">{SEARCH_COPY.askHint}</span>
      <ChevronRight aria-hidden className="size-4 shrink-0" />
    </Link>
  );
}

export function SearchScreen() {
  const params = useSearchParams();
  const raw = params?.get('q') ?? '';
  const q = normalizeQuery(raw);
  const search = useSearch(q);
  const online = useOnline();
  const { remember } = useSearchDock();
  // Offline (atau jaringan gagal) dan R3 untuk kata ini belum tersimpan → kartu R5 (§5.6).
  // Hasil kata kunci sebelumnya (placeholderData) bukan hasil kata ini.
  const noResultForQ = search.data === undefined || search.isPlaceholderData;
  const local = noResultForQ && (!online || (search.isError && toAppError(search.error).kind === 'network'));
  const offlineSearch = useOfflineSearch(q, local);
  type Results = Pick<UseQueryResult<Card[]>, 'data' | 'error' | 'isError' | 'isPending' | 'refetch'>;
  // Belum ada kartu tersimpan sama sekali: keadaan seperti sebelumnya (offline / "Tidak ada sinyal").
  const results: Results = local
    ? {
        data: offlineSearch.data?.stored ? offlineSearch.data.results : undefined,
        error: search.error,
        isError: search.isError,
        isPending: offlineSearch.isPending,
        refetch: search.refetch as Results['refetch'],
      }
    : search;

  return (
    <section className="flex flex-col gap-4 p-4" aria-labelledby="judul-layar">
      <h1 id="judul-layar" tabIndex={-1} className="sr-only">
        {SEARCH_COPY.title}
      </h1>
      {q.length < MIN_QUERY ? (
        <p className="text-base text-muted-foreground">{SEARCH_COPY.minChars}</p>
      ) : (
        <QueryState
          query={results}
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
                {fill(local ? SEARCH_COPY.offlineNotFound : SEARCH_COPY.notFound, { q })}
              </p>
              <AskRow q={q} />
            </div>
          }
        >
          {(cards) => (
            <>
              <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
                {fill(SEARCH_COPY.resultCount, { n: cards.length, q })}
                {!online || local ? ` · ${STATE_COPY.cachedLabel}` : ''}
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
