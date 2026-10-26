'use client';
import type { ProductCard } from '@priceatlas/contracts';
import { BasisLabel, PriceText, StoreLine, UnitPrice } from '@/components/price/price';
import { PRICE_COPY } from '@/lib/copy/id';
import { formatUnitPrice } from '@/lib/format';
import { cn } from '@/lib/utils';

type Lite = ProductCard['product'];
type Point = NonNullable<ProductCard['summary']>['best_all'];

/**
 * Angka utama (U-04): harga + label + harga per satuan. Produk timbang: harga per content_unit
 * (Rp45.000/kg) sebagai angka utama, harga per satuan dasar sebagai info kedua (U-20).
 */
export function MainPrice({ product, point, size = 'lg' }: { product: Lite; point: Point; size?: 'lg' | 'md' }) {
  const big = size === 'lg' ? 'text-2xl' : 'text-lg';
  if (product.sale_mode === 'weight') {
    return (
      <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <UnitPrice product={product} value={point.unit_price} className={cn(big, 'font-bold')} />
        <BasisLabel basis={point.price_basis} program={point.member_program_name} />
        <span className="text-sm text-muted-foreground">{formatUnitPrice(point.unit_price, product.base_unit)}</span>
      </p>
    );
  }
  return (
    <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
      <PriceText value={point.effective_price} className={cn(big, 'font-bold')} />
      <BasisLabel basis={point.price_basis} program={point.member_program_name} />
      <UnitPrice product={product} value={point.unit_price} className="text-base font-semibold" />
    </p>
  );
}

/** Teks pendek harga (baris all-time, ukuran lain): "Rp18.900" atau "Rp45.000/kg". */
export function ShortPrice({
  product,
  point,
}: {
  product: Lite;
  point: Pick<Point, 'effective_price' | 'unit_price'>;
}) {
  return product.sale_mode === 'weight' ? (
    <UnitPrice product={product} value={point.unit_price} />
  ) : (
    <PriceText value={point.effective_price} />
  );
}

/**
 * Baris "Termurah sepanjang masa" (D-02, pembanding kecil) di S-02 dan S-03. Jika record-nya sama
 * dengan termurah 90 hari, angka yang sama tidak diulang: "sama dengan 90 hari terakhir" (D-91, Q-95).
 */
export function BestAllLine({
  product,
  summary,
}: {
  product: Lite;
  summary: Pick<NonNullable<ProductCard['summary']>, 'best_90d' | 'best_all'>;
}) {
  const all = summary.best_all;
  const same = summary.best_90d?.record_id === all.record_id;
  return (
    <p className="flex flex-wrap items-baseline gap-x-1.5 text-sm text-muted-foreground" data-testid="best-all">
      <span>{PRICE_COPY.bestAll}:</span>
      {same ? (
        <span>{PRICE_COPY.bestAllSame}</span>
      ) : (
        <>
          <ShortPrice product={product} point={all} />
          <BasisLabel basis={all.price_basis} program={all.member_program_name} />
          <StoreLine store={all.store} branch={all.branch} date={all.date} />
        </>
      )}
    </p>
  );
}
