'use client';
// SummaryUpdating (docs/07 §7.2, §4.3, wireframe §5.5): setelah tulis harga, ringkasan dihitung
// server (antrean D-31, ± 10 dtk). R4 produk terkait dipantau sampai `summary.refreshed_at` ≥ waktu
// simpan; tanpa optimistic update angka harga.
import { ProductCardSchema, type ProductCard } from '@priceatlas/contracts';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { z } from 'zod';
import { MainPrice } from '@/components/product/main-price';
import { productHref } from '@/components/product/product-card';
import { CONFIRM_COPY, fill, PRICE_COPY, STATE_COPY } from '@/lib/copy/id';
import { qk } from '@/lib/data/query-keys';
import { rpcCall } from '@/lib/data/rpc';
import { productTitle } from '@/lib/format/product';

export const SUMMARY_POLL_MS = 3_000;
/** Berhenti memantau setelah 2 menit (antrean macet: teks tetap "sedang diperbarui"). */
export const SUMMARY_POLL_MAX_MS = 120_000;

export function isSummaryFresh(card: ProductCard, since: number): boolean {
  return card.summary != null && Date.parse(card.summary.refreshed_at) >= since;
}

export function SummaryUpdating({ productIds, since }: { productIds: readonly string[]; since: number }) {
  const input = { p_ids: [...productIds] };
  const cards = useQuery({
    queryKey: [...qk.rpc('get_product_cards', input), 'after', since],
    queryFn: () =>
      rpcCall<'get_product_cards', ProductCard[]>('get_product_cards', input, { output: z.array(ProductCardSchema) }),
    enabled: productIds.length > 0,
    staleTime: 0,
    refetchInterval: (q) =>
      Date.now() - since < SUMMARY_POLL_MAX_MS && !(q.state.data ?? []).every((c) => isSummaryFresh(c, since))
        ? SUMMARY_POLL_MS
        : false,
  });
  const list = cards.data ?? [];
  const fresh = list.length > 0 && list.every((c) => isSummaryFresh(c, since));
  return (
    <section aria-labelledby="judul-tersimpan" className="flex flex-col gap-2" data-testid="summary-updating">
      <h2 id="judul-tersimpan" className="text-lg font-semibold">
        {CONFIRM_COPY.savedTitle}
      </h2>
      <p role="status" className="text-sm text-muted-foreground" data-fresh={fresh}>
        {fresh ? CONFIRM_COPY.summaryDone : STATE_COPY.summaryUpdating}
      </p>
      <ul className="flex flex-col gap-1">
        {list.map((c) => {
          const t = productTitle(c.product);
          const point = c.summary ? (c.summary.best_90d ?? c.summary.best_all) : null;
          return (
            <li key={c.product.id}>
              <Link
                href={productHref(c.product.id)}
                className="flex min-h-touch flex-col rounded-lg border border-divider px-3 py-2"
                aria-label={fill(CONFIRM_COPY.openProduct, { name: `${t.title} ${t.size}` })}
              >
                <span className="font-medium">
                  {t.title} <span className="font-normal text-muted-foreground">{t.size}</span>
                </span>
                {point && isSummaryFresh(c, since) ? (
                  <>
                    <span className="text-sm text-muted-foreground">
                      {c.summary?.best_90d ? PRICE_COPY.best90 : PRICE_COPY.bestAll}
                    </span>
                    <MainPrice product={c.product} point={point} size="md" />
                  </>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
