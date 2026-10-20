'use client';
// Baris "Lebih hemat di mana" (S-05, 3 teratas di S-03): toko · cabang, termurah, rata-rata,
// jumlah data, tanggal terakhir; cabang tidak diketahui, tutup → penerus, online, "baru 1 data".
import { BASE_UNIT, type Dimension, type WhereCheaperRow } from '@priceatlas/contracts';
import Link from 'next/link';
import { PriceLabel } from '@/components/price/price';
import { CHEAPER_COPY, fill, PRICE_COPY } from '@/lib/copy/id';
import { formatTransactionDate, formatUnitPrice } from '@/lib/format';
import { displayUnitPrice, type UnitProduct } from '@/lib/format/unit';
import { useTimeZone } from '@/lib/hooks/use-time-zone';

export function storeRankName(row: WhereCheaperRow): string {
  if (!row.branch) return `${row.store.name} · ${PRICE_COPY.noBranch}`;
  if (row.branch.status === 'closed' && row.successor_branch)
    return `${row.store.name} · ${fill(CHEAPER_COPY.successor, { from: row.branch.name, to: row.successor_branch.name })}`;
  return `${row.store.name} · ${row.branch.name}${row.branch.status === 'closed' ? ` ${PRICE_COPY.closed}` : ''}`;
}

export function StoreRankRow({
  row,
  rank,
  product,
  href,
}: {
  row: WhereCheaperRow;
  rank: number;
  /** Produk (mode produk): satuan tampilan mengikuti produk (timbang per kg). Group: satuan dasar. */
  product?: UnitProduct;
  href?: string;
}) {
  const tz = useTimeZone();
  const unitOf = (v: number) => {
    const d = product
      ? displayUnitPrice(product, v)
      : { value: v, unit: BASE_UNIT[row.dimension as Dimension] ?? row.dimension };
    return formatUnitPrice(d.value, d.unit);
  };
  const body = (
    <>
      <span className="flex items-baseline gap-2 font-medium">
        <span className="text-muted-foreground tabular-nums">{rank}.</span>
        <span>{storeRankName(row)}</span>
      </span>
      <span className="flex flex-wrap gap-x-2 text-sm">
        <span className="font-semibold tabular-nums">
          {fill(CHEAPER_COPY.min, { price: unitOf(row.min_unit_price) })}
        </span>
        <span className="tabular-nums">{fill(CHEAPER_COPY.avg, { price: unitOf(row.avg_unit_price) })}</span>
      </span>
      <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
        <span>{row.n === 1 ? CHEAPER_COPY.oneData : fill(CHEAPER_COPY.count, { n: row.n })}</span>
        <span>{fill(CHEAPER_COPY.last, { date: formatTransactionDate(row.last_date, tz) })}</span>
        {row.is_online ? <PriceLabel tone="muted">{PRICE_COPY.onlineLong}</PriceLabel> : null}
      </span>
    </>
  );
  const cls = 'flex min-h-touch flex-col gap-0.5 rounded-lg border border-divider px-3 py-2';
  return (
    <li data-testid="store-rank-row">
      {href ? (
        <Link href={href} className={cls}>
          {body}
        </Link>
      ) : (
        <div className={cls}>{body}</div>
      )}
    </li>
  );
}
