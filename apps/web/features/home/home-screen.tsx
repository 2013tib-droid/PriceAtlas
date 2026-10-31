'use client';
// S-01 Beranda / Cari (docs/07 §7.3, wireframe S-01): pencarian terakhir + baru dicek (prefs
// IndexedDB, R4), harga baru masuk (REST price_record_view + R4), badge perlu dicek, keadaan kosong
// U-19. Kolom search ada di SearchLayout. Offline tanpa R4 tersimpan: "Baru dicek" dari kartu R5
// (`offline_cards`, D-60, §5.6).
import { Camera, ClipboardPaste, Clock, Search, ShoppingBasket } from 'lucide-react';
import Link from 'next/link';
import { usePhotoSheet } from '@/components/app/photo-sheet';
import { ErrorState, LoadingState, OfflineState } from '@/components/app/screen-state';
import { BasisLabel, PriceText } from '@/components/price/price';
import { productHref } from '@/components/product/product-card';
import { ProductRow } from '@/components/product/product-row';
import { Skeleton } from '@/components/ui/skeleton';
import { fill, HOME_COPY, PASTE_COPY } from '@/lib/copy/id';
import { photoCaptureEnabled } from '@/lib/features';
import { useOfflineCardsByIds } from '@/lib/data/offline-cache';
import { useNeedsCheckCount, useProductCards, useRecentPrices } from '@/lib/data/queries';
import { formatTransactionDate } from '@/lib/format';
import { productTitle } from '@/lib/format/product';
import { useOnline } from '@/lib/hooks/use-online';
import { usePref } from '@/lib/hooks/use-pref';
import { useTimeZone } from '@/lib/hooks/use-time-zone';
import { PREF_KEYS } from '@/lib/offline/prefs';
import { searchHref, useSearchDock } from '@/features/search/search-layout';

export const RECENTLY_VIEWED_SHOWN = 5;

function EmptyHome({ onPhoto }: { onPhoto: () => void }) {
  const { focus } = useSearchDock();
  const c = HOME_COPY.emptyCards;
  const cardClass = 'flex w-full items-start gap-3 rounded-lg border border-border p-4 text-left';
  return (
    <section aria-labelledby="kosong" className="flex flex-col gap-3">
      <h2 id="kosong" className="text-lg font-semibold">
        {HOME_COPY.emptyTitle}
      </h2>
      <p className="text-base text-muted-foreground">{HOME_COPY.emptyBody}</p>
      <ul className="flex flex-col gap-2">
        <li>
          <button type="button" onClick={onPhoto} className={cardClass}>
            {photoCaptureEnabled() ? (
              <Camera aria-hidden className="mt-0.5 size-6 shrink-0" />
            ) : (
              <ClipboardPaste aria-hidden className="mt-0.5 size-6 shrink-0" />
            )}
            <span className="flex flex-col">
              <span className="font-semibold">
                {photoCaptureEnabled() ? c.receipt.title : PASTE_COPY.homeCardTitle}
              </span>
              <span className="text-sm text-muted-foreground">{c.receipt.body}</span>
            </span>
          </button>
        </li>
        <li>
          <Link href="/belanja" className={cardClass}>
            <ShoppingBasket aria-hidden className="mt-0.5 size-6 shrink-0" />
            <span className="flex flex-col">
              <span className="font-semibold">{c.session.title}</span>
              <span className="text-sm text-muted-foreground">{c.session.body}</span>
            </span>
          </Link>
        </li>
        <li>
          <button type="button" onClick={focus} className={cardClass}>
            <Search aria-hidden className="mt-0.5 size-6 shrink-0" />
            <span className="flex flex-col">
              <span className="font-semibold">{c.search.title}</span>
              <span className="text-sm text-muted-foreground">{c.search.body}</span>
            </span>
          </button>
        </li>
      </ul>
    </section>
  );
}

function NewPrices() {
  const tz = useTimeZone();
  const recent = useRecentPrices();
  const ids = [...new Set((recent.data ?? []).map((r) => r.product_id))];
  const cards = useProductCards(ids);
  const byId = new Map((cards.data ?? []).map((c) => [c.product.id, c.product]));
  if (!recent.data) {
    if (recent.isError) return <ErrorState error={recent.error} onRetry={() => void recent.refetch()} />;
    return (
      <LoadingState>
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </LoadingState>
    );
  }
  return (
    <>
      {recent.isError ? <ErrorState error={recent.error} onRetry={() => void recent.refetch()} compact /> : null}
      <ul className="flex flex-col gap-2">
        {recent.data.map((r) => {
          const p = byId.get(r.product_id);
          const name = p ? productTitle(p) : null;
          return (
            <li key={r.id}>
              <Link
                href={productHref(r.product_id)}
                className="flex min-h-touch flex-col gap-0.5 rounded-lg border border-divider px-3 py-2"
              >
                <span className="font-medium">
                  {name ? (
                    <>
                      {name.title} <span className="font-normal text-muted-foreground">{name.size}</span>
                    </>
                  ) : (
                    <Skeleton className="inline-block h-4 w-32 align-middle" />
                  )}
                </span>
                <span className="flex flex-wrap items-baseline gap-x-2 text-sm">
                  <PriceText value={r.effective_price} className="font-semibold" />
                  <BasisLabel basis={r.price_basis} />
                  <span className="text-muted-foreground">
                    {r.store_name} · {formatTransactionDate(r.transaction_date, tz)}
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </>
  );
}

export function HomeScreen() {
  const photo = usePhotoSheet();
  const recentSearches = usePref<string[]>(PREF_KEYS.recentSearches, []);
  const viewed = usePref<string[]>(PREF_KEYS.viewed, []);
  const viewedIds = viewed.value.slice(0, RECENTLY_VIEWED_SHOWN);
  const viewedCards = useProductCards(viewedIds);
  const online = useOnline();
  const viewedOffline = !online && viewedCards.data === undefined;
  const offlineViewed = useOfflineCardsByIds(viewedIds, viewedOffline);
  const viewedData = viewedCards.data ?? (viewedOffline ? offlineViewed.data : undefined);
  const recent = useRecentPrices();
  const needsCheck = useNeedsCheckCount();
  const isEmpty = recent.data?.length === 0 && viewedIds.length === 0;

  return (
    <section className="flex flex-col gap-5 p-4" aria-labelledby="judul-layar">
      <div className="flex items-center justify-between gap-2">
        <h1 id="judul-layar" tabIndex={-1} className="text-2xl font-semibold">
          {HOME_COPY.title}
        </h1>
        {needsCheck.data ? (
          <Link
            href="/unggahan"
            className="inline-flex h-touch items-center rounded-full bg-warning px-3 text-sm font-semibold text-warning-foreground"
          >
            {fill(HOME_COPY.needsCheck, { n: needsCheck.data })}
          </Link>
        ) : null}
      </div>

      {recentSearches.value.length > 0 ? (
        <section aria-labelledby="pencarian-terakhir" className="flex flex-col gap-2">
          <h2 id="pencarian-terakhir" className="text-sm font-semibold text-muted-foreground">
            {HOME_COPY.recentSearches}
          </h2>
          <ul className="flex flex-wrap gap-2">
            {recentSearches.value.map((q) => (
              <li key={q}>
                <Link
                  href={searchHref(q)}
                  className="inline-flex h-touch items-center gap-1.5 rounded-full border border-border px-3 text-sm"
                >
                  <Clock aria-hidden className="size-4" />
                  {q}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {isEmpty ? (
        <EmptyHome onPhoto={photo.open} />
      ) : (
        <>
          {viewedIds.length > 0 ? (
            <section aria-labelledby="baru-dicek" className="flex flex-col gap-2">
              <h2 id="baru-dicek" className="text-lg font-semibold">
                {HOME_COPY.recentlyViewed}
              </h2>
              {viewedData && (viewedData.length > 0 || !viewedOffline) ? (
                <ul className="flex flex-col gap-2">
                  {viewedData.map((c) => (
                    <ProductRow key={c.product.id} card={c} />
                  ))}
                </ul>
              ) : viewedData ? (
                <OfflineState />
              ) : viewedCards.isError ? (
                <ErrorState error={viewedCards.error} onRetry={() => void viewedCards.refetch()} />
              ) : (
                <LoadingState>
                  <Skeleton className="h-14 w-full" />
                </LoadingState>
              )}
            </section>
          ) : null}
          {recent.data?.length !== 0 ? (
            <section aria-labelledby="harga-baru" className="flex flex-col gap-2">
              <h2 id="harga-baru" className="text-lg font-semibold">
                {HOME_COPY.newPrices}
              </h2>
              <NewPrices />
            </section>
          ) : null}
        </>
      )}
    </section>
  );
}
