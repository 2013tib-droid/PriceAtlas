'use client';
// S-04 Bandingkan ukuran (docs/07 §7.3, wireframe S-04): R11 per dimensi & mata uang, toggle
// 90 hari / sepanjang masa, tanpa data di bawah tanpa peringkat, dimensi berbeda tidak dibandingkan.
import { useRouter, useSearchParams } from 'next/navigation';
import { ErrorState, QueryState } from '@/components/app/screen-state';
import { Segmented } from '@/components/ui/segmented';
import { Skeleton } from '@/components/ui/skeleton';
import { fill, PRODUCT_COPY, SIZES_COPY } from '@/lib/copy/id';
import { toAppError } from '@/lib/data/errors';
import { useClientConfig, useCompareSizes } from '@/lib/data/queries';
import { sizeSections, SizeRow } from './size-rows';
import { useGroupName } from './use-group-name';

const DIM_UNIT: Record<string, string> = { mass: 'g', volume: 'ml', count: 'pcs', length: 'm' };

export function SizesScreen() {
  const router = useRouter();
  const params = useSearchParams();
  const groupId = params?.get('group') ?? null;
  const window = params?.get('jendela') === 'semua' ? 'all' : '90d';
  const q = useCompareSizes(groupId, window);
  const { config } = useClientConfig();
  const name = useGroupName(q.data);

  const setWindow = (w: string) => {
    const qs = new URLSearchParams(params?.toString());
    if (w === 'all') qs.set('jendela', 'semua');
    else qs.delete('jendela');
    router.replace(`/produk/ukuran?${qs.toString()}`, { scroll: false });
  };

  return (
    <section className="flex flex-col gap-4 p-4" aria-labelledby="judul-layar">
      <header className="flex flex-col gap-1">
        <h1 id="judul-layar" tabIndex={-1} className="text-2xl font-semibold">
          {SIZES_COPY.title}
        </h1>
        <p className="text-sm text-muted-foreground">
          {name ? `${name} · ` : ''}
          {SIZES_COPY.subtitle}
        </p>
      </header>
      <Segmented
        label={SIZES_COPY.windowLabel}
        value={window}
        onChange={setWindow}
        options={[
          { value: '90d', label: SIZES_COPY.window90 },
          { value: 'all', label: SIZES_COPY.windowAll },
        ]}
      />
      {!groupId ? (
        <ErrorState error={null} message={PRODUCT_COPY.notFound} />
      ) : (
        <QueryState
          query={q}
          screen="S-03"
          errorMessage={(e) => (toAppError(e).code === 'NOT_FOUND' ? PRODUCT_COPY.notFound : undefined)}
          skeleton={
            <>
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
            </>
          }
        >
          {(rows) => {
            const sections = sizeSections(rows);
            const noneWithData = rows.every((r) => !r.has_data);
            return (
              <div className="flex flex-col gap-4">
                {rows.length === 1 ? <p className="text-base">{SIZES_COPY.onlyOne}</p> : null}
                {noneWithData && window === '90d' && rows.length > 1 ? (
                  <p className="flex flex-wrap items-center gap-2 text-base">
                    {SIZES_COPY.empty90}
                    <button type="button" className="h-touch font-medium underline" onClick={() => setWindow('all')}>
                      {SIZES_COPY.seeAllTime}
                    </button>
                  </p>
                ) : null}
                {sections.length > 1 ? (
                  <p className="text-sm text-muted-foreground">
                    {fill(SIZES_COPY.differentUnits, {
                      units: [...new Set(sections.map((s) => DIM_UNIT[s.dimension] ?? s.dimension))].join(' vs '),
                    })}
                  </p>
                ) : null}
                {sections.map((s) => (
                  <section
                    key={s.key}
                    aria-label={SIZES_COPY.perDimension[s.dimension as keyof typeof SIZES_COPY.perDimension]}
                    className="flex flex-col gap-2"
                  >
                    <h2 className="text-sm font-semibold text-muted-foreground">
                      {SIZES_COPY.perDimension[s.dimension as keyof typeof SIZES_COPY.perDimension] ?? s.dimension}
                      {sections.some((x) => x.currency !== s.currency) ? ` · ${s.currency}` : ''}
                    </h2>
                    <ul className="flex flex-col gap-2">
                      {s.rows.map((r) => (
                        <SizeRow key={r.product.id} row={r} windowDays={config.best_price_window_days} />
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
            );
          }}
        </QueryState>
      )}
    </section>
  );
}
