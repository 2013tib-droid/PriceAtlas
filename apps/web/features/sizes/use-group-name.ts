'use client';
// Nama group untuk S-04/S-05: R11 tidak mengembalikan nama group, jadi diambil dari kartu (R4)
// SKU pertama group itu (sama dengan tool AI bandingkan_ukuran).
import type { CompareSizesRow } from '@priceatlas/contracts';
import { useProductCards } from '@/lib/data/queries';

export function useGroupName(rows: readonly CompareSizesRow[] | undefined): string | null {
  const first = rows?.[0]?.product.id;
  const cards = useProductCards(first ? [first] : []);
  return cards.data?.[0]?.group?.name ?? null;
}
