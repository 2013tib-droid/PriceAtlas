'use client';
// Baris SKU per dimensi dan mata uang (R11, S-04; "Ukuran lain" di S-03). Peringkat dari server
// (per dimensi + mata uang); tanpa data di bawah, tanpa peringkat.
import type { CompareSizesRow } from '@priceatlas/contracts';
import Link from 'next/link';
import { BasisLabel, PriceLabel, PrivateBadge, StoreLine, UnitPrice } from '@/components/price/price';
import { ShortPrice } from '@/components/product/main-price';
import { productHref } from '@/components/product/product-card';
import { fill, PRICE_COPY, PRODUCT_COPY, SIZES_COPY } from '@/lib/copy/id';
import { daysBetween, formatMonthYear, formatPercent, formatRupiah, formatSize, todayInZone } from '@/lib/format';
import { useTimeZone } from '@/lib/hooks/use-time-zone';
import { cn } from '@/lib/utils';

export interface SizeSection {
  key: string;
  dimension: string;
  currency: string;
  rows: CompareSizesRow[];
}

/** Urutan server dipertahankan (dimensi, ada data dulu, harga per satuan). */
export function sizeSections(rows: readonly CompareSizesRow[]): SizeSection[] {
  const out: SizeSection[] = [];
  for (const r of rows) {
    const key = `${r.dimension}:${r.currency}`;
    let s = out.find((x) => x.key === key);
    if (!s) {
      s = { key, dimension: r.dimension, currency: r.currency, rows: [] };
      out.push(s);
    }
    s.rows.push(r);
  }
  return out;
}

export function SizeRow({
  row,
  currentId,
  windowDays,
}: {
  row: CompareSizesRow;
  /** Produk yang sedang dibuka (S-03): ditandai "ini". */
  currentId?: string;
  /** best_price_window_days (R2): SKU tanpa data selama ini diberi "data terakhir Mar 2026" (D-18). */
  windowDays: number;
}) {
  const tz = useTimeZone();
  const p = row.product;
  const old =
    row.last_transaction_date != null && daysBetween(todayInZone(tz), row.last_transaction_date) >= windowDays;
  return (
    <li data-testid="size-row">
      <Link
        href={productHref(p.id)}
        aria-current={currentId === p.id ? 'page' : undefined}
        className={cn(
          'flex min-h-touch flex-col gap-0.5 rounded-lg border border-divider px-3 py-2',
          currentId === p.id && 'border-border',
        )}
      >
        <span className="flex flex-wrap items-baseline gap-x-2">
          {row.rank != null ? <span className="text-muted-foreground tabular-nums">{row.rank}.</span> : null}
          <span className="font-semibold">{formatSize(p)}</span>
          <span className="text-sm text-muted-foreground">{p.name}</span>
          {p.is_private ? <PrivateBadge /> : null}
          {currentId === p.id ? <PriceLabel tone="muted">{PRODUCT_COPY.thisProduct}</PriceLabel> : null}
        </span>
        {row.has_data && row.unit_price != null && row.effective_price != null ? (
          <>
            <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <ShortPrice product={p} point={{ effective_price: row.effective_price, unit_price: row.unit_price }} />
              {row.price_basis ? <BasisLabel basis={row.price_basis} /> : null}
              <UnitPrice product={p} value={row.unit_price} className="font-semibold" />
              {row.rank === 1 ? (
                <PriceLabel tone="promo">{SIZES_COPY.best}</PriceLabel>
              ) : row.pct_vs_best != null ? (
                <span className="text-sm tabular-nums">+{formatPercent(row.pct_vs_best)}</span>
              ) : null}
            </span>
            <span className="flex flex-wrap gap-x-2 text-sm text-muted-foreground">
              {row.store ? <StoreLine store={row.store} branch={row.branch} date={row.date} /> : null}
              {row.per_pack_price != null ? (
                <span>{fill(PRICE_COPY.perPack, { price: formatRupiah(row.per_pack_price) })}</span>
              ) : null}
            </span>
          </>
        ) : (
          <span className="text-sm text-muted-foreground">
            {row.other_currency ? SIZES_COPY.otherCurrency : SIZES_COPY.noData}
          </span>
        )}
        {old && row.last_transaction_date ? (
          <span className="text-sm text-muted-foreground">
            {fill(SIZES_COPY.oldSku, { date: formatMonthYear(row.last_transaction_date) })}
          </span>
        ) : null}
      </Link>
    </li>
  );
}
