'use client';
// S-03 Detail produk (docs/07 §7.3, wireframe S-03): R7 (redirect_to → router.replace + toast),
// ringkasan, grafik R9 + toggle "Hanya harga normal", 3 toko teratas R12, ukuran lain R11, histori
// R8 (cursor; baris di-tap → S-16 `/harga?id=`, M5), "Cek harga rak" menempel di bawah → S-03b
// (?sheet=cek-harga), menu ⋯ (M5: S-15 edit, S-17, S-18, arsip).
import type { ProductDetail } from '@priceatlas/contracts';
import { Calculator, ChevronRight, MoreHorizontal } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { ErrorState, LoadingState, OfflineState, QueryState } from '@/components/app/screen-state';
import { StickyAction } from '@/components/app/sticky-action';
import { BasisLabel, DataCount, PriceText, PrivateBadge, StoreLine, TrendText } from '@/components/price/price';
import { HistoryRow, recordHref } from '@/components/product/history-row';
import { MainPrice, ShortPrice } from '@/components/product/main-price';
import { productHref } from '@/components/product/product-card';
import { Button } from '@/components/ui/button';
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from '@/components/ui/drawer';
import { Skeleton } from '@/components/ui/skeleton';
import { CHEAPER_COPY, fill, PRICE_COPY, PRODUCT_COPY, STATE_COPY } from '@/lib/copy/id';
import {
  useClientConfig,
  useCompareSizes,
  usePriceChart,
  usePriceHistory,
  useProductDetail,
  useWhereCheaper,
} from '@/lib/data/queries';
import { toAppError } from '@/lib/data/errors';
import { formatAge, formatRupiah } from '@/lib/format';
import { productTitle } from '@/lib/format/product';
import { useOnline } from '@/lib/hooks/use-online';
import { usePref } from '@/lib/hooks/use-pref';
import { useTimeZone } from '@/lib/hooks/use-time-zone';
import { PREF_KEYS, pushViewed } from '@/lib/offline/prefs';
import { ArchiveDialog } from '@/features/catalog/archive-dialog';
import { StoreRankRow } from '@/features/cheaper/store-rank-row';
import { SizeRow } from '@/features/sizes/size-rows';
import { PriceChart } from './price-chart';
import { ShelfCheckSheet } from './shelf-check-sheet';

export const SHEET_SHELF = 'cek-harga';
export const WHERE_TOP = 3;

export function cheaperHref(params: { id?: string; group?: string }): string {
  const qs = new URLSearchParams();
  if (params.id) qs.set('id', params.id);
  if (params.group) qs.set('group', params.group);
  return `/produk/hemat?${qs.toString()}`;
}

function SectionTitle({ id, children, action }: { id: string; children: string; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <h2 id={id} className="text-lg font-semibold">
        {children}
      </h2>
      {action}
    </div>
  );
}

function MoreLink({ href, children }: { href: string; children: string }) {
  return (
    <Link href={href} className="inline-flex h-touch shrink-0 items-center gap-1 text-sm font-medium">
      {children}
      <ChevronRight aria-hidden className="size-4" />
    </Link>
  );
}

function SummaryBlock({ detail, updating }: { detail: ProductDetail; updating: boolean }) {
  const tz = useTimeZone();
  const { config } = useClientConfig();
  const { product: p, summary: s, hints } = detail.card;
  if (!s) {
    return (
      <div className="flex flex-col gap-2 rounded-lg bg-muted p-4">
        <p className="text-base">{PRODUCT_COPY.noData}</p>
        {hints.bundle_only_count > 0 ? (
          <p className="text-sm text-muted-foreground">{fill(PRICE_COPY.bundleOnly, { n: hints.bundle_only_count })}</p>
        ) : null}
      </div>
    );
  }
  const main = s.best_90d ?? s.best_all;
  const tw = detail.trend_windows;
  const min = config.trend_min_records_per_window;
  return (
    <div className="flex flex-col gap-2" data-testid="summary">
      <p className="text-sm text-muted-foreground">{s.best_90d ? PRICE_COPY.best90 : PRICE_COPY.no90}</p>
      <MainPrice product={p} point={main} />
      <p className="text-sm">
        <StoreLine store={main.store} branch={main.branch} date={main.date} />
        {s.best_90d ? null : ` · ${fill(PRICE_COPY.lastRecorded, { age: formatAge(s.last_transaction_date, tz) })}`}
      </p>
      {s.best_90d ? (
        <p className="flex flex-wrap items-baseline gap-x-1.5 text-sm text-muted-foreground">
          <span>{PRICE_COPY.bestAll}:</span>
          <ShortPrice product={p} point={s.best_all} />
          <BasisLabel basis={s.best_all.price_basis} program={s.best_all.member_program_name} />
          <StoreLine store={s.best_all.store} branch={s.best_all.branch} date={s.best_all.date} />
        </p>
      ) : null}
      {detail.last_record ? (
        <p className="flex flex-wrap items-baseline gap-x-1.5 text-sm">
          <span>{PRODUCT_COPY.lastPrice}:</span>
          {p.sale_mode === 'weight' ? (
            <ShortPrice
              product={p}
              point={{ effective_price: s.last_effective_price, unit_price: s.last_unit_price }}
            />
          ) : (
            <PriceText value={s.last_effective_price} />
          )}
          <BasisLabel basis={detail.last_record.price_basis} />
          <StoreLine
            store={detail.last_record.store}
            branch={detail.last_record.branch}
            date={detail.last_record.date}
          />
        </p>
      ) : null}
      <p className="flex flex-wrap gap-x-3 text-sm">
        <TrendText direction={s.trend_direction} pct={s.trend_pct} />
        <DataCount count={s.record_count} lastDate={s.last_transaction_date} />
      </p>
      {s.trend_direction ? null : (
        <p className="rounded-lg bg-muted p-3 text-sm">
          {fill(PRODUCT_COPY.trendHelp, { min, cur: tw.cur_n, prev: tw.prev_n })}
        </p>
      )}
      {hints.member_not_counted ? (
        <p className="text-sm text-muted-foreground">
          {fill(PRICE_COPY.memberHint, {
            store: hints.member_not_counted.store_name,
            price: formatRupiah(hints.member_not_counted.member_price),
          })}
          {' · '}
          <Link href="/saya/member" className="font-medium text-foreground underline underline-offset-2">
            {PRICE_COPY.memberHintAction}
          </Link>
        </p>
      ) : null}
      {updating ? (
        <p role="status" className="text-sm text-muted-foreground">
          {STATE_COPY.summaryUpdating}
        </p>
      ) : null}
    </div>
  );
}

function ChartSection({ detail }: { detail: ProductDetail }) {
  const pref = usePref<boolean>(PREF_KEYS.chartNormalOnly, false);
  const normalOnly = pref.value;
  const chart = usePriceChart(detail.card.product.id, normalOnly);
  return (
    <section aria-labelledby="grafik" className="flex flex-col gap-2">
      <SectionTitle id="grafik">{PRODUCT_COPY.chart}</SectionTitle>
      <label className="flex min-h-touch items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="size-5"
          checked={normalOnly}
          onChange={(e) => void pref.update(() => e.target.checked)}
        />
        {PRODUCT_COPY.chartNormalOnly}
      </label>
      <QueryState query={chart} skeleton={<Skeleton className="h-40 w-full" />}>
        {(points) => (
          <PriceChart
            points={points}
            product={detail.card.product}
            best90={detail.card.summary?.best_90d?.unit_price ?? null}
            normalOnly={normalOnly}
          />
        )}
      </QueryState>
    </section>
  );
}

function WhereCheaperTop({ detail }: { detail: ProductDetail }) {
  const p = detail.card.product;
  const q = useWhereCheaper({ productId: p.id }, 90);
  return (
    <section aria-labelledby="hemat" className="flex flex-col gap-2">
      <SectionTitle id="hemat" action={<MoreLink href={cheaperHref({ id: p.id })}>{PRODUCT_COPY.seeAll}</MoreLink>}>
        {PRODUCT_COPY.whereCheaper}
      </SectionTitle>
      <QueryState
        query={q}
        skeleton={<Skeleton className="h-16 w-full" />}
        isEmpty={(rows) => rows.length === 0}
        empty={<p className="text-sm text-muted-foreground">{CHEAPER_COPY.empty90}</p>}
      >
        {(rows) => (
          <ol className="flex flex-col gap-2">
            {rows.slice(0, WHERE_TOP).map((r, i) => (
              <StoreRankRow
                key={`${r.store.id}:${r.branch?.id ?? '-'}`}
                row={r}
                rank={i + 1}
                product={p}
                href={productHref(p.id, { toko: r.store.id })}
              />
            ))}
          </ol>
        )}
      </QueryState>
    </section>
  );
}

function OtherSizes({ detail }: { detail: ProductDetail }) {
  const group = detail.card.group;
  const { config } = useClientConfig();
  const q = useCompareSizes(group?.id ?? null, '90d');
  if (!group || detail.group_sizes_count < 2) return null;
  return (
    <section aria-labelledby="ukuran" className="flex flex-col gap-2">
      <SectionTitle
        id="ukuran"
        action={
          <MoreLink href={`/produk/ukuran?group=${encodeURIComponent(group.id)}`}>{PRODUCT_COPY.compare}</MoreLink>
        }
      >
        {PRODUCT_COPY.otherSizes}
      </SectionTitle>
      <QueryState query={q} skeleton={<Skeleton className="h-14 w-full" />}>
        {(rows) => (
          <ul className="flex flex-col gap-2">
            {rows.map((r) => (
              <SizeRow
                key={r.product.id}
                row={r}
                currentId={detail.card.product.id}
                windowDays={config.best_price_window_days}
              />
            ))}
          </ul>
        )}
      </QueryState>
    </section>
  );
}

function HistorySection({
  detail,
  storeId,
  history,
  includeVoid,
  setIncludeVoid,
}: {
  detail: ProductDetail;
  storeId: string | null;
  history: ReturnType<typeof usePriceHistory>;
  includeVoid: boolean;
  setIncludeVoid: (v: boolean) => void;
}) {
  const p = detail.card.product;
  const rows = history.data?.pages.flat() ?? [];
  const storeName = storeId ? (rows.find((r) => r.store_id === storeId)?.store_name ?? null) : null;
  return (
    <section aria-labelledby="histori" className="flex scroll-mt-4 flex-col gap-2" id="bagian-histori">
      <SectionTitle id="histori">{PRODUCT_COPY.history}</SectionTitle>
      {storeId ? (
        <p className="flex flex-wrap items-center gap-2 text-sm">
          <span className="rounded-full bg-muted px-3 py-1">
            {fill(PRODUCT_COPY.filteredByStore, { store: storeName ?? '…' })}
          </span>
          <Link href={productHref(p.id)} replace className="inline-flex h-touch items-center font-medium underline">
            {PRODUCT_COPY.clearFilter}
          </Link>
        </p>
      ) : null}
      <label className="flex min-h-touch items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="size-5"
          checked={includeVoid}
          onChange={(e) => setIncludeVoid(e.target.checked)}
        />
        {PRODUCT_COPY.showVoid}
      </label>
      {history.data ? (
        <>
          {history.isError ? <ErrorState error={history.error} onRetry={() => void history.refetch()} compact /> : null}
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">{PRODUCT_COPY.historyEmpty}</p>
          ) : (
            <ul>
              {rows.map((r) => (
                <HistoryRow key={r.id} record={r} product={p} href={recordHref(r.id)} />
              ))}
            </ul>
          )}
          {history.hasNextPage ? (
            <Button
              variant="secondary"
              onClick={() => void history.fetchNextPage()}
              disabled={history.isFetchingNextPage}
            >
              {PRODUCT_COPY.loadMore}
            </Button>
          ) : null}
        </>
      ) : history.isError ? (
        <ErrorState error={history.error} onRetry={() => void history.refetch()} />
      ) : (
        <LoadingState>
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </LoadingState>
      )}
    </section>
  );
}

/**
 * Menu ⋯ di bawah (bukan pojok kanan atas, wireframe S-03; docs/05 §3.3 S-03). Produk privat: Edit (S-15),
 * Gabungkan (S-17), Pisahkan (S-18), Hapus (arsip lewat REST PATCH). Produk global: Pisahkan saja; Edit
 * dan Gabungkan nonaktif dengan teks D-38/D-30.
 */
function MoreMenu({ detail }: { detail: ProductDetail }) {
  const [open, setOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const p = detail.card.product;
  const priv = p.is_private;
  const m = PRODUCT_COPY.menu;
  const q = `?id=${encodeURIComponent(p.id)}`;
  const link = (href: string, label: string) => (
    <Button key={label} variant="secondary" size="action" className="justify-start" asChild>
      <Link href={href}>{label}</Link>
    </Button>
  );
  const disabled = (label: string, why: string) => (
    <div key={label} className="flex flex-col gap-1">
      <Button variant="secondary" size="action" disabled className="justify-start">
        {label}
      </Button>
      <p className="text-sm text-muted-foreground">{why}</p>
    </div>
  );
  return (
    <>
      <Button variant="ghost" onClick={() => setOpen(true)} className="self-start">
        <MoreHorizontal aria-hidden />
        {PRODUCT_COPY.more}
      </Button>
      <Drawer open={open} onOpenChange={setOpen}>
        <DrawerContent>
          <div className="flex flex-col gap-2 p-4">
            <DrawerTitle>{PRODUCT_COPY.moreTitle}</DrawerTitle>
            <DrawerDescription>{PRODUCT_COPY.moreDescription}</DrawerDescription>
            {priv ? link(`/produk/edit${q}`, m.edit) : disabled(m.edit, PRODUCT_COPY.editGlobal)}
            {priv ? link(`/produk/gabung${q}`, m.merge) : disabled(m.merge, PRODUCT_COPY.mergeGlobal)}
            {link(`/produk/pisah${q}`, m.split)}
            {priv ? (
              <Button
                variant="secondary"
                size="action"
                className="justify-start text-danger"
                onClick={() => {
                  setOpen(false);
                  setArchiveOpen(true);
                }}
              >
                {m.archive}
              </Button>
            ) : null}
          </div>
        </DrawerContent>
      </Drawer>
      {priv ? (
        <ArchiveDialog productId={p.id} name={productTitle(p).title} open={archiveOpen} onOpenChange={setArchiveOpen} />
      ) : null}
    </>
  );
}

function DetailSkeleton() {
  return (
    <LoadingState>
      <Skeleton className="h-8 w-2/3" />
      <Skeleton className="h-10 w-1/2" />
      <Skeleton className="h-4 w-3/4" />
      <Skeleton className="h-40 w-full" />
      <Skeleton className="h-16 w-full" />
    </LoadingState>
  );
}

export function ProductScreen() {
  const router = useRouter();
  const pathname = usePathname() ?? '/produk';
  const params = useSearchParams();
  const id = params?.get('id') ?? null;
  const storeId = params?.get('toko') ?? null;
  const sheetOpen = params?.get('sheet') === SHEET_SHELF;
  const online = useOnline();
  const { config } = useClientConfig();
  const detail = useProductDetail(id);
  const d = detail.data;
  const [includeVoid, setIncludeVoid] = useState(false);
  const productId = d?.card.product.id ?? null;
  const history = usePriceHistory(productId, { storeId, includeVoid });
  const sizes = useCompareSizes(d?.card.group?.id ?? null, '90d');
  const viewed = usePref<string[]>(PREF_KEYS.viewed, []);
  const pushedSheet = useRef(false);

  // Produk sudah digabung (R7 redirect_to): alih ke produk pengganti + toast (wireframe S-03).
  const redirected = useRef<string | null>(null);
  useEffect(() => {
    if (!d?.redirect_to || redirected.current === d.redirect_to) return;
    redirected.current = d.redirect_to;
    const extra: Record<string, string> = {};
    if (sheetOpen) extra.sheet = SHEET_SHELF;
    router.replace(productHref(d.redirect_to, extra));
    toast(fill(PRODUCT_COPY.mergedToast, { name: productTitle(d.card.product).title }));
  }, [d, router, sheetOpen]);

  // "Baru dicek" (S-01) dan daftar R5 (💾, D-60).
  const { update: updateViewed } = viewed;
  useEffect(() => {
    if (productId) void updateViewed((list) => pushViewed(list, productId));
  }, [productId, updateViewed]);

  // Dari S-05 (filter toko): gulir ke histori.
  useEffect(() => {
    if (storeId && history.data) document.getElementById('bagian-histori')?.scrollIntoView();
  }, [storeId, history.data]);

  const setSheet = (open: boolean) => {
    const qs = new URLSearchParams(params?.toString());
    if (open) {
      qs.set('sheet', SHEET_SHELF);
      pushedSheet.current = true;
      router.push(`${pathname}?${qs.toString()}`, { scroll: false });
    } else if (pushedSheet.current) {
      pushedSheet.current = false;
      router.back();
    } else {
      qs.delete('sheet');
      router.replace(`${pathname}?${qs.toString()}`, { scroll: false });
    }
  };

  if (!id) return <ErrorState error={null} message={PRODUCT_COPY.notFound} />;
  if (!d) {
    if (detail.isError) {
      const notFound = toAppError(detail.error).code === 'NOT_FOUND';
      return (
        <section className="flex flex-col gap-3 p-4">
          <ErrorState
            error={detail.error}
            message={notFound ? PRODUCT_COPY.notFound : undefined}
            onRetry={notFound ? undefined : () => void detail.refetch()}
          />
          <Button variant="secondary" onClick={() => router.back()} className="self-start">
            {STATE_COPY.back}
          </Button>
        </section>
      );
    }
    return <section className="p-4">{online ? <DetailSkeleton /> : <OfflineState />}</section>;
  }

  const p = d.card.product;
  const { title, size } = productTitle(p);
  const firstPage = history.data?.pages[0] ?? [];
  const refreshedAt = d.card.summary ? Date.parse(d.card.summary.refreshed_at) : null;
  const updating = refreshedAt != null && firstPage.some((r) => Date.parse(r.updated_at) > refreshedAt);

  return (
    <article className="flex flex-col gap-6 p-4 pb-24" aria-labelledby="judul-layar">
      <header className="flex flex-col gap-1">
        <h1 id="judul-layar" tabIndex={-1} className="text-2xl font-semibold">
          {title} <span className="font-normal text-muted-foreground">{size}</span>
        </h1>
        <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          {[p.brand_name, p.category_name, d.card.group?.name].filter(Boolean).join(' · ')}
          {p.is_private ? <PrivateBadge /> : null}
        </p>
      </header>

      {detail.isError ? <ErrorState error={detail.error} onRetry={() => void detail.refetch()} compact /> : null}
      <section aria-label={PRODUCT_COPY.summary}>
        <SummaryBlock detail={d} updating={updating} />
        {!online ? <p className="mt-2 text-sm text-muted-foreground">{PRODUCT_COPY.offlineDetail}</p> : null}
      </section>

      {d.card.summary ? <ChartSection detail={d} /> : null}
      {d.card.summary ? <WhereCheaperTop detail={d} /> : null}
      <OtherSizes detail={d} />
      <HistorySection
        detail={d}
        storeId={storeId}
        history={history}
        includeVoid={includeVoid}
        setIncludeVoid={setIncludeVoid}
      />
      <MoreMenu detail={d} />

      <StickyAction>
        <Button size="action" onClick={() => setSheet(true)}>
          <Calculator aria-hidden />
          {PRICE_COPY.shelfCheck}
        </Button>
      </StickyAction>
      <ShelfCheckSheet
        open={sheetOpen}
        onOpenChange={setSheet}
        detail={d}
        sizes={sizes.data}
        nearPct={config.near_best_threshold_pct}
      />
    </article>
  );
}
