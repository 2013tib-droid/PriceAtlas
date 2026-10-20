'use client';
import type { ProductCard } from '@priceatlas/contracts';
import { BasisLabel, PriceText, UnitPrice } from '@/components/price/price';
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
