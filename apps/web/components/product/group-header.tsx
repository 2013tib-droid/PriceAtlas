'use client';
// Header group di hasil cari (U-03): "Paling hemat per gram: 200 g (Rp90/g)" + "Bandingkan ukuran".
import type { ProductCard } from '@priceatlas/contracts';
import { ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { fill, SEARCH_COPY } from '@/lib/copy/id';
import { formatSize, formatUnitPrice } from '@/lib/format';
import { PER_UNIT_WORD } from '@/lib/format/unit';

export interface GroupBest {
  dimension: string;
  baseUnit: string;
  unitPrice: number;
  productId: string;
  /** Ukuran SKU termurah jika ada di hasil; null jika tidak ikut tampil. */
  size: string | null;
}

/** Termurah per dimensi dari `group.best_by_dimension` setiap kartu (dimensi kartu itu). */
export function groupBests(cards: readonly ProductCard[]): GroupBest[] {
  const out = new Map<string, GroupBest>();
  for (const c of cards) {
    const b = c.group?.best_by_dimension;
    if (!b || out.has(c.product.dimension)) continue;
    const owner = cards.find((x) => x.product.id === b.product_id);
    out.set(c.product.dimension, {
      dimension: c.product.dimension,
      baseUnit: c.product.base_unit,
      unitPrice: b.unit_price,
      productId: b.product_id,
      size: owner ? formatSize(owner.product) : null,
    });
  }
  return [...out.values()];
}

export function groupSizesHref(groupId: string): string {
  return `/produk/ukuran?group=${encodeURIComponent(groupId)}`;
}

export function GroupHeader({ group, cards }: { group: { id: string; name: string }; cards: readonly ProductCard[] }) {
  const bests = groupBests(cards);
  return (
    <header className="flex flex-col gap-1 px-1">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">{group.name}</h2>
        <Link
          href={groupSizesHref(group.id)}
          className="inline-flex h-touch shrink-0 items-center gap-1 text-sm font-medium underline-offset-2 hover:underline"
        >
          {SEARCH_COPY.compareSizes}
          <ChevronRight aria-hidden className="size-4" />
        </Link>
      </div>
      {bests.map((b) => (
        <p key={b.dimension} className="text-sm">
          {fill(SEARCH_COPY.groupBest, {
            per: PER_UNIT_WORD[b.baseUnit] ?? `per ${b.baseUnit}`,
            size: b.size ?? formatUnitPrice(b.unitPrice, b.baseUnit),
          })}
          {b.size ? ` ${fill(SEARCH_COPY.groupBestPrice, { price: formatUnitPrice(b.unitPrice, b.baseUnit) })}` : ''}
        </p>
      ))}
    </header>
  );
}

export interface ResultSection {
  key: string;
  group: { id: string; name: string } | null;
  cards: ProductCard[];
}

/** Kelompokkan hasil R3 per Product Group di klien (docs/05 §3.3 S-02), urutan server dipertahankan. */
export function groupResults(cards: readonly ProductCard[]): ResultSection[] {
  const sections: ResultSection[] = [];
  const byGroup = new Map<string, ResultSection>();
  for (const c of cards) {
    if (!c.group) {
      sections.push({ key: `p-${c.product.id}`, group: null, cards: [c] });
      continue;
    }
    let s = byGroup.get(c.group.id);
    if (!s) {
      s = { key: `g-${c.group.id}`, group: { id: c.group.id, name: c.group.name }, cards: [] };
      byGroup.set(c.group.id, s);
      sections.push(s);
    }
    s.cards.push(c);
  }
  return sections;
}
