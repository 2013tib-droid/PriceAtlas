'use client';
// Komponen harga bersama (docs/07 §7.2): PriceText, UnitPrice, PriceLabel, TrendText, DataCount,
// StoreLine. Semua angka lewat lib/format; label selalu teks (U-15), warna hanya penguat.
import type { ComponentProps } from 'react';
import { fill, PRICE_COPY } from '@/lib/copy/id';
import { formatPercent, formatRupiah, formatTransactionDate, formatUnitPrice, spokenUnitPrice } from '@/lib/format';
import { displayUnitPrice, type UnitProduct } from '@/lib/format/unit';
import { useTimeZone } from '@/lib/hooks/use-time-zone';
import { cn } from '@/lib/utils';

export function PriceText({ value, className, ...props }: { value: number } & ComponentProps<'span'>) {
  return (
    <span className={cn('tabular-nums', className)} {...props}>
      {formatRupiah(value)}
    </span>
  );
}

/** Rp97,5/g dengan aria-label "97,5 rupiah per gram" (§10.1). Produk timbang per content_unit. */
export function UnitPrice({
  product,
  value,
  className,
}: {
  product: UnitProduct;
  /** Harga per satuan dasar (kolom unit_price). */
  value: number;
  className?: string;
}) {
  const d = displayUnitPrice(product, value);
  return (
    <span className={cn('tabular-nums', className)} aria-label={spokenUnitPrice(d.value, d.unit)}>
      {formatUnitPrice(d.value, d.unit)}
    </span>
  );
}

export type PriceBasis = 'normal' | 'promo' | 'member';

/** Teks label harga §5.2: PROMO, NORMAL, MEMBER · AEON Member, PROMO 2+. */
export function basisText(basis: PriceBasis, program?: string | null, promoMinQty?: number | null): string {
  if (basis === 'member') return program ? fill(PRICE_COPY.memberWithProgram, { program }) : PRICE_COPY.basis.member;
  if (basis === 'promo' && promoMinQty && promoMinQty >= 2) return fill(PRICE_COPY.promoQty, { n: promoMinQty });
  return PRICE_COPY.basis[basis];
}

const TONE = {
  promo: 'border-success text-success',
  member: 'border-primary text-primary',
  normal: 'border-border text-muted-foreground',
  muted: 'border-divider text-muted-foreground',
  private: 'border-primary text-primary',
} as const;

/** Label teks berbingkai. Warna hanya penguat (U-15). */
export function PriceLabel({
  children,
  tone = 'normal',
  className,
}: {
  children: string;
  tone?: keyof typeof TONE;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded border px-1.5 py-0.5 text-xs leading-none font-semibold tracking-wide',
        TONE[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function BasisLabel({
  basis,
  program,
  promoMinQty,
}: {
  basis: PriceBasis;
  program?: string | null;
  promoMinQty?: number | null;
}) {
  return <PriceLabel tone={basis}>{basisText(basis, program, promoMinQty)}</PriceLabel>;
}

export function PrivateBadge() {
  return <PriceLabel tone="private">{PRICE_COPY.private}</PriceLabel>;
}

/** U-05: tren selalu dengan teks. null → "Tren: data belum cukup". */
export function TrendText({
  direction,
  pct,
  className,
}: {
  direction: 'up' | 'down' | 'flat' | null;
  pct: number | null;
  className?: string;
}) {
  if (!direction) return <span className={cn('text-muted-foreground', className)}>{PRICE_COPY.trend.notEnough}</span>;
  const p = formatPercent(pct ?? 0);
  return (
    <span
      className={cn(direction === 'down' ? 'text-success' : direction === 'up' ? 'text-danger' : '', className)}
      aria-label={fill(PRICE_COPY.trendSpoken[direction], { pct: p.replace('%', '') })}
    >
      {fill(PRICE_COPY.trend[direction], { pct: p })}
    </span>
  );
}

/** D-15: "9 data · terakhir 3 hari lalu". */
export function DataCount({ count, lastDate, className }: { count: number; lastDate: string; className?: string }) {
  const tz = useTimeZone();
  return (
    <span className={cn('text-muted-foreground', className)}>
      {fill(PRICE_COPY.dataCount, { n: count, date: formatTransactionDate(lastDate, tz) })}
    </span>
  );
}

export interface StoreRef {
  name: string;
  channel?: 'offline' | 'online';
}
export interface BranchRef {
  name: string;
  status?: 'open' | 'closed' | null;
}

/** "AEON · AEON BSD · 12 Okt 2026"; cabang kosong → "cabang tidak diketahui" (D-28). */
export function storeText(store: StoreRef, branch: BranchRef | null): string {
  const b = branch ? `${branch.name}${branch.status === 'closed' ? ` ${PRICE_COPY.closed}` : ''}` : PRICE_COPY.noBranch;
  return `${store.name} · ${b}`;
}

export function StoreLine({
  store,
  branch,
  date,
  className,
}: {
  store: StoreRef;
  branch: BranchRef | null;
  date?: string | null;
  className?: string;
}) {
  const tz = useTimeZone();
  return (
    <span className={className}>
      {storeText(store, branch)}
      {date ? ` · ${formatTransactionDate(date, tz)}` : ''}
      {store.channel === 'online' ? ` · ${PRICE_COPY.online}` : ''}
    </span>
  );
}
