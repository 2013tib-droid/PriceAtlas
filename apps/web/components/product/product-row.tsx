'use client';
// Baris ringkas produk (S-01 "Baru dicek", ukuran lain di S-03): nama + angka utama.
import type { ProductCard } from '@priceatlas/contracts';
import Link from 'next/link';
import { BasisLabel, PrivateBadge, UnitPrice } from '@/components/price/price';
import { PRICE_COPY } from '@/lib/copy/id';
import { productTitle } from '@/lib/format/product';
import { ShortPrice } from './main-price';
import { productHref } from './product-card';

export function ProductRow({ card }: { card: ProductCard }) {
  const { product: p, summary: s } = card;
  const { title, size } = productTitle(p);
  const point = s ? (s.best_90d ?? s.best_all) : null;
  return (
    <li>
      <Link
        href={productHref(p.id)}
        className="flex min-h-touch flex-col gap-0.5 rounded-lg border border-divider px-3 py-2"
      >
        <span className="flex items-center gap-2 font-medium">
          {title} <span className="font-normal text-muted-foreground">{size}</span>
          {p.is_private ? <PrivateBadge /> : null}
        </span>
        {point ? (
          <span className="flex flex-wrap items-baseline gap-x-2 text-sm">
            <ShortPrice product={p} point={point} />
            <BasisLabel basis={point.price_basis} program={point.member_program_name} />
            <UnitPrice product={p} value={point.unit_price} className="text-muted-foreground" />
          </span>
        ) : (
          <span className="text-sm text-muted-foreground">{PRICE_COPY.noHistory}</span>
        )}
      </Link>
    </li>
  );
}
