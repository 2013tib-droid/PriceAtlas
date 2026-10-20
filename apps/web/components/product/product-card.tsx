'use client';
// Kartu hasil cari (S-02, docs/07 §7.2): menjawab 6 pertanyaan inti tanpa membuka detail (§7
// PROJECT, wireframe §8.1). Semua keadaan wireframe S-02 dibentuk dari ProductCard kontrak.
import type { ProductCard as Card } from '@priceatlas/contracts';
import { Calculator } from 'lucide-react';
import Link from 'next/link';
import { BasisLabel, DataCount, PrivateBadge, StoreLine, TrendText } from '@/components/price/price';
import { fill, PRICE_COPY } from '@/lib/copy/id';
import { formatAge, formatRupiah } from '@/lib/format';
import { productTitle } from '@/lib/format/product';
import { useTimeZone } from '@/lib/hooks/use-time-zone';
import { cn } from '@/lib/utils';
import { MainPrice, ShortPrice } from './main-price';

export function productHref(id: string, extra?: Record<string, string>): string {
  const qs = new URLSearchParams({ id, ...extra });
  return `/produk?${qs.toString()}`;
}

export function ProductCard({
  card,
  onOpen,
  headingLevel = 3,
}: {
  card: Card;
  /** Dipanggil saat kartu dibuka (mis. simpan pencarian terakhir). */
  onOpen?: () => void;
  headingLevel?: 2 | 3;
}) {
  const tz = useTimeZone();
  const { product: p, summary: s, hints } = card;
  const { title, size } = productTitle(p);
  const H = headingLevel === 2 ? 'h2' : 'h3';
  const headingId = `kartu-${p.id}`;
  const main = s ? (s.best_90d ?? s.best_all) : null;

  return (
    <article
      aria-labelledby={headingId}
      data-testid="product-card"
      className={cn('relative flex flex-col gap-1.5 rounded-lg border border-divider bg-surface p-3', !s && 'py-2.5')}
    >
      <div className="flex items-start justify-between gap-2">
        <H id={headingId} className="text-base leading-snug font-semibold">
          <Link
            href={productHref(p.id)}
            onClick={onOpen}
            className="after:absolute after:inset-0 after:rounded-lg focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-focus"
          >
            {title} <span className="font-normal text-muted-foreground">{size}</span>
          </Link>
        </H>
        {p.is_private ? <PrivateBadge /> : null}
      </div>

      {s && main ? (
        <>
          {s.best_90d ? null : <p className="text-sm text-muted-foreground">{PRICE_COPY.no90}</p>}
          <MainPrice product={p} point={main} />
          <p className="text-sm">
            <StoreLine store={main.store} branch={main.branch} date={main.date} />
            {s.best_90d ? null : (
              <span className="text-muted-foreground">
                {' · '}
                {fill(PRICE_COPY.lastRecorded, { age: formatAge(s.last_transaction_date, tz) })}
              </span>
            )}
          </p>
          {s.best_90d ? (
            <p className="flex flex-wrap items-baseline gap-x-1.5 text-sm text-muted-foreground">
              <span>{PRICE_COPY.bestAll}:</span>
              <ShortPrice product={p} point={s.best_all} />
              <BasisLabel basis={s.best_all.price_basis} program={s.best_all.member_program_name} />
              <StoreLine store={s.best_all.store} branch={s.best_all.branch} date={s.best_all.date} />
            </p>
          ) : null}
          <p className="flex flex-wrap gap-x-3 gap-y-0.5 text-sm">
            <TrendText direction={s.trend_direction} pct={s.trend_pct} />
            <DataCount count={s.record_count} lastDate={s.last_transaction_date} />
          </p>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">
          {hints.bundle_only_count > 0
            ? fill(PRICE_COPY.bundleOnly, { n: hints.bundle_only_count })
            : PRICE_COPY.noHistory}
        </p>
      )}

      {hints.member_not_counted ? (
        <p className="relative z-10 text-sm text-muted-foreground">
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

      <Link
        href={productHref(p.id, { sheet: 'cek-harga' })}
        aria-label={fill(PRICE_COPY.shelfCheckFor, { name: `${title} ${size}` })}
        className="relative z-10 inline-flex h-touch items-center gap-2 self-start rounded-lg border border-border px-3 text-sm font-medium"
      >
        <Calculator aria-hidden className="size-4" />
        {PRICE_COPY.shelfCheck}
      </Link>
    </article>
  );
}
