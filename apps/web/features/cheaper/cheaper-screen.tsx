'use client';
// S-05 Lebih hemat di mana (docs/07 §7.3, D-39): R12 per produk atau per Product Group, 90 hari
// atau sepanjang masa. Per dimensi + mata uang. Tap baris (mode produk) → S-03 dengan histori
// difilter ke toko itu (R8 p_store_id).
import { BASE_UNIT, type Dimension } from '@priceatlas/contracts';
import { useRouter, useSearchParams } from 'next/navigation';
import { ErrorState, QueryState } from '@/components/app/screen-state';
import { productHref } from '@/components/product/product-card';
import { Segmented } from '@/components/ui/segmented';
import { Skeleton } from '@/components/ui/skeleton';
import { CHEAPER_COPY, PRODUCT_COPY, SIZES_COPY } from '@/lib/copy/id';
import { toAppError } from '@/lib/data/errors';
import { useCompareSizes, useProductDetail, useWhereCheaper } from '@/lib/data/queries';
import { productTitle } from '@/lib/format/product';
import { PER_UNIT_WORD } from '@/lib/format/unit';
import { useGroupName } from '@/features/sizes/use-group-name';
import { StoreRankRow } from './store-rank-row';

export function CheaperScreen() {
  const router = useRouter();
  const params = useSearchParams();
  const id = params?.get('id') ?? null;
  const detail = useProductDetail(id);
  const groupId = params?.get('group') ?? detail.data?.card.group?.id ?? null;
  const scope: 'product' | 'group' = !id || params?.get('lingkup') === 'group' ? 'group' : 'product';
  const allTime = params?.get('jendela') === 'semua';
  const productId = detail.data?.card.product.id ?? id;
  const q = useWhereCheaper(scope === 'product' ? { productId } : { groupId }, allTime ? null : 90);
  const sizes = useCompareSizes(scope === 'group' && !id ? groupId : null, 'all');
  const groupName = useGroupName(sizes.data) ?? detail.data?.card.group?.name ?? null;

  const set = (key: string, value: string | null) => {
    const qs = new URLSearchParams(params?.toString());
    if (value == null) qs.delete(key);
    else qs.set(key, value);
    if (groupId) qs.set('group', groupId);
    router.replace(`/produk/hemat?${qs.toString()}`, { scroll: false });
  };

  const subject =
    scope === 'product' && detail.data
      ? `${productTitle(detail.data.card.product).title} ${productTitle(detail.data.card.product).size}`
      : groupName;
  const product = scope === 'product' ? detail.data?.card.product : undefined;

  return (
    <section className="flex flex-col gap-4 p-4" aria-labelledby="judul-layar">
      <header className="flex flex-col gap-1">
        <h1 id="judul-layar" tabIndex={-1} className="text-2xl font-semibold">
          {CHEAPER_COPY.title}
        </h1>
        {subject ? <p className="text-sm text-muted-foreground">{subject}</p> : null}
      </header>
      <Segmented
        label={CHEAPER_COPY.scopeLabel}
        value={scope}
        onChange={(v) => set('lingkup', v === 'group' ? 'group' : null)}
        options={[
          { value: 'product', label: CHEAPER_COPY.scopeProduct, disabled: !id },
          { value: 'group', label: CHEAPER_COPY.scopeGroup, disabled: !groupId },
        ]}
      />
      <Segmented
        label={SIZES_COPY.windowLabel}
        value={allTime ? 'all' : '90d'}
        onChange={(v) => set('jendela', v === 'all' ? 'semua' : null)}
        options={[
          { value: '90d', label: SIZES_COPY.window90 },
          { value: 'all', label: SIZES_COPY.windowAll },
        ]}
      />
      {!id && !groupId ? (
        <ErrorState error={null} message={PRODUCT_COPY.notFound} />
      ) : detail.isError && scope === 'product' ? (
        <ErrorState
          error={detail.error}
          message={toAppError(detail.error).code === 'NOT_FOUND' ? PRODUCT_COPY.notFound : undefined}
          onRetry={() => void detail.refetch()}
        />
      ) : (
        <QueryState
          query={q}
          errorMessage={(e) => (toAppError(e).code === 'NOT_FOUND' ? PRODUCT_COPY.notFound : undefined)}
          skeleton={
            <>
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </>
          }
          isEmpty={(rows) => rows.length === 0}
          empty={
            <div className="flex flex-col items-start gap-2 rounded-lg bg-muted p-4">
              <p className="text-base">{allTime ? CHEAPER_COPY.emptyAll : CHEAPER_COPY.empty90}</p>
              {allTime ? null : (
                <button type="button" className="h-touch font-medium underline" onClick={() => set('jendela', 'semua')}>
                  {CHEAPER_COPY.seeAllTime}
                </button>
              )}
            </div>
          }
        >
          {(rows) => {
            const sections: { key: string; dimension: string; rows: typeof rows }[] = [];
            for (const r of rows) {
              const key = `${r.dimension}:${r.currency}`;
              const s = sections.find((x) => x.key === key);
              if (s) s.rows.push(r);
              else sections.push({ key, dimension: r.dimension, rows: [r] });
            }
            return (
              <div className="flex flex-col gap-4">
                <p className="text-sm text-muted-foreground">{CHEAPER_COPY.sortedBy}</p>
                {sections.map((s) => {
                  const base = BASE_UNIT[s.dimension as Dimension] ?? s.dimension;
                  return (
                    <section key={s.key} className="flex flex-col gap-2" aria-label={PER_UNIT_WORD[base] ?? base}>
                      {sections.length > 1 ? (
                        <h2 className="text-sm font-semibold text-muted-foreground">{PER_UNIT_WORD[base] ?? base}</h2>
                      ) : null}
                      <ol className="flex flex-col gap-2">
                        {s.rows.map((r, i) => (
                          <StoreRankRow
                            key={`${r.store.id}:${r.branch?.id ?? '-'}`}
                            row={r}
                            rank={i + 1}
                            product={product}
                            href={
                              productId && scope === 'product'
                                ? productHref(productId, { toko: r.store.id })
                                : undefined
                            }
                          />
                        ))}
                      </ol>
                    </section>
                  );
                })}
              </div>
            );
          }}
        </QueryState>
      )}
    </section>
  );
}
