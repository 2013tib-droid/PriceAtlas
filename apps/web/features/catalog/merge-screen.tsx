'use client';
// S-17 Gabungkan produk (docs/07 §7.3, wireframe S-17, docs/05 §3.3 S-17, §4.4): `/produk/gabung?id=`
// (+ `&ke=` tujuan). Pilih tujuan lewat S-14 mode target merge (produk sumber disembunyikan; RLS
// membatasi ke global + privat sendiri) → R19 MergePreview (jumlah harga/alias/barcode; barcode privat
// tidak pindah ke global, F-01/D-65) → ConfirmTwice jika beda ukuran/dimensi (U-16) dengan opsi
// "Pindahkan ke group" (REST PATCH product) → W10. Produk global tidak bisa memulai (D-30, 42501);
// sumber yang sudah digabung ke tujuan yang sama = sukses; P0001 → pesan §8.2.
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { ConfirmTwice } from '@/components/app/confirm-twice';
import { ErrorState, LoadingState } from '@/components/app/screen-state';
import { StickyAction } from '@/components/app/sticky-action';
import { PrivateBadge } from '@/components/price/price';
import { productHref } from '@/components/product/product-card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ProductPicker, PICKER_KEYS } from '@/features/picker/product-picker';
import { mergeError, productEditError } from '@/lib/catalog/errors';
import { canStartMerge, countsText, mergeView } from '@/lib/catalog/merge';
import { CATALOG_COPY, fill } from '@/lib/copy/id';
import { useMergePreview, useMergeProduct, usePatchProduct, useProductRow } from '@/lib/data/catalog';
import { toAppError } from '@/lib/data/errors';
import { useProductDetail } from '@/lib/data/queries';
import { flashToast } from '@/lib/flash';
import { productTitle } from '@/lib/format/product';
import { useLayer } from '@/lib/hooks/use-layer';

const M = CATALOG_COPY.merge;

type Lite = { name: string; variant: string | null; is_private: boolean } & Parameters<typeof productTitle>[0];

function ProductName({ p }: { p: Lite }) {
  const t = productTitle(p);
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <span className="font-medium">
        {t.title} <span className="font-normal text-muted-foreground">{t.size}</span>
      </span>
      {p.is_private ? <PrivateBadge /> : null}
    </span>
  );
}

export function MergeScreen() {
  const router = useRouter();
  const qc = useQueryClient();
  const layer = useLayer();
  const params = layer.params;
  const fromId = params?.get('id') ?? null;
  const [into, setInto] = useState<string | null>(params?.get('ke') ?? null);
  const source = useProductDetail(fromId);
  const preview = useMergePreview(fromId, into);
  const merge = useMergeProduct();
  const fromRow = useProductRow(fromId);
  const patch = usePatchProduct();
  const [error, setError] = useState<string | null>(null);
  const [groupMoved, setGroupMoved] = useState(false);
  const pickerOpen = params?.get('pilih') === 'produk' && params.get('untuk') === 'merge';

  const back = (
    <Button variant="ghost" size="icon" onClick={() => router.back()}>
      <ArrowLeft aria-hidden />
      <span className="sr-only">{CATALOG_COPY.record.back}</span>
    </Button>
  );
  const header = (
    <div className="flex items-center gap-2">
      {back}
      <h1 id="judul-layar" tabIndex={-1} className="text-2xl font-semibold">
        {M.title}
      </h1>
    </div>
  );

  if (!fromId || (source.isError && !source.data)) {
    const notFound = !fromId || toAppError(source.error).code === 'NOT_FOUND';
    return (
      <section className="flex flex-col gap-3 p-4" aria-labelledby="judul-layar">
        {header}
        <ErrorState
          error={source.error}
          message={notFound ? M.notFound : undefined}
          onRetry={notFound ? undefined : () => void source.refetch()}
        />
      </section>
    );
  }
  if (!source.data) {
    return (
      <section className="flex flex-col gap-3 p-4" aria-labelledby="judul-layar">
        {header}
        <LoadingState>
          <Skeleton className="h-6 w-2/3" />
          <Skeleton className="h-24 w-full" />
        </LoadingState>
      </section>
    );
  }

  const from = source.data.card.product;
  const fromName = productTitle(from).title;
  // Produk katalog umum tidak bisa memulai merge (D-30): tanpa pemilih, hanya teks.
  if (!from.is_private) {
    return (
      <section className="flex flex-col gap-3 p-4" aria-labelledby="judul-layar" data-testid="merge-screen">
        {header}
        <p>
          <ProductName p={from} />
        </p>
        <p role="alert" className="rounded-lg bg-muted p-3" data-testid="merge-global">
          {M.globalSource}
        </p>
      </section>
    );
  }

  const done = (target: { id: string; name: string }, already: boolean) => {
    void qc.invalidateQueries({ queryKey: ['rpc', 'merge_product_preview'] });
    flashToast('success', fill(already ? M.already : M.done, { from: fromName, into: target.name }));
    router.replace(productHref(target.id));
  };

  const view = preview.data ? mergeView(preview.data) : null;
  const intoName = preview.data ? productTitle(preview.data.into).title : '';

  const runMerge = () => {
    if (!into || !preview.data) return;
    setError(null);
    merge.mutate(
      { p_from: fromId, p_into: into },
      {
        onSuccess: () => done({ id: into, name: intoName }, false),
        onError: async (e) => {
          // Pengulangan setelah sukses yang responsnya hilang: sumber sudah digabung ke tujuan ini.
          const again = await preview.refetch();
          if (again.data?.reason === 'already_merged') return done({ id: into, name: intoName }, true);
          setError(mergeError(e));
        },
      },
    );
  };

  const moveGroup = () => {
    if (!preview.data?.into.product_group_id || !fromRow.data) return;
    setError(null);
    patch.mutate(
      {
        id: fromId,
        updatedAt: fromRow.data.updated_at,
        patch: { product_group_id: preview.data.into.product_group_id },
        alsoInvalidate: [preview.data.into.id],
      },
      {
        onSuccess: () => {
          setGroupMoved(true);
          toast.success(fill(M.moveGroupDone, { name: fromName }));
          void preview.refetch();
        },
        onError: (e) => {
          const r = productEditError(e);
          setError(toAppError(e).rpc?.sqlstate === '23503' ? mergeError(e) : r.message);
          if (r.stale) void fromRow.refetch();
        },
      },
    );
  };

  return (
    <section
      className="flex flex-col gap-4 p-4 pb-[calc(var(--bottom-bars)+6rem)]"
      aria-labelledby="judul-layar"
      data-testid="merge-screen"
    >
      {header}
      {canStartMerge(from) ? null : (
        <p role="alert" className="rounded-lg bg-muted p-3">
          {M.reasons.source_not_active}
        </p>
      )}
      <p>{fill(M.intro, { name: fromName })}</p>

      {into ? (
        <section aria-labelledby="judul-pratinjau" className="flex flex-col gap-3 rounded-lg border border-divider p-3">
          <h2 id="judul-pratinjau" className="text-lg font-semibold">
            {M.preview}
          </h2>
          {preview.data && view ? (
            <>
              <p className="flex flex-wrap items-center gap-2" data-testid="merge-pair">
                <ProductName p={preview.data.from} />
                <ArrowRight aria-hidden className="size-4" />
                <span className="sr-only">{M.to}</span>
                <ProductName p={preview.data.into} />
                {preview.data.into.is_private ? null : (
                  <span className="text-sm text-muted-foreground">{M.catalogTag}</span>
                )}
              </p>
              {view.kind === 'done' ? (
                <p role="status" data-testid="merge-already">
                  {fill(M.already, { from: fromName, into: intoName })}{' '}
                  <Link href={productHref(into)} className="font-medium underline underline-offset-2">
                    {intoName}
                  </Link>
                </p>
              ) : view.kind === 'blocked' ? (
                <p role="alert" className="text-danger" data-testid="merge-blocked">
                  {view.message}
                </p>
              ) : (
                <>
                  <p data-testid="merge-counts">{countsText(view.counts)}</p>
                  {view.counts.barcodes_kept > 0 ? (
                    <p className="text-sm text-muted-foreground" data-testid="merge-barcodes-kept">
                      {fill(M.barcodesKept, { n: view.counts.barcodes_kept })}
                    </p>
                  ) : null}
                  {view.mismatch ? (
                    <div className="flex flex-col gap-2 rounded-lg bg-warning p-3 text-warning-foreground" role="note">
                      <p data-testid="merge-mismatch">{fill(M.mismatch, { vs: view.mismatch })}</p>
                      {view.canMoveGroup && !groupMoved ? (
                        <Button
                          variant="secondary"
                          className="self-start"
                          onClick={moveGroup}
                          disabled={!fromRow.data || patch.isPending}
                          data-testid="merge-move-group"
                        >
                          {fill(M.moveGroup, { group: intoName })}
                        </Button>
                      ) : null}
                      {groupMoved && preview.data.into.product_group_id ? (
                        <Link
                          href={`/produk/ukuran?group=${encodeURIComponent(preview.data.into.product_group_id)}`}
                          className="font-medium underline underline-offset-2"
                        >
                          {fill(M.moveGroupDone, { name: fromName })}
                        </Link>
                      ) : null}
                    </div>
                  ) : null}
                  <p className="text-sm text-muted-foreground">{fill(M.irreversible, { name: fromName })}</p>
                </>
              )}
            </>
          ) : preview.isError ? (
            <ErrorState
              error={preview.error}
              message={mergeError(preview.error)}
              onRetry={() => void preview.refetch()}
            />
          ) : (
            <LoadingState>
              <Skeleton className="h-6 w-full" />
              <Skeleton className="h-5 w-2/3" />
            </LoadingState>
          )}
        </section>
      ) : null}

      <Button
        variant="secondary"
        className="self-start"
        onClick={() => layer.open({ pilih: 'produk', untuk: 'merge' })}
        disabled={!canStartMerge(from)}
      >
        {into ? M.changeTarget : M.pick}
      </Button>

      {error ? (
        <p role="alert" className="rounded-lg border border-danger p-3 text-sm" data-testid="merge-error">
          {error}
        </p>
      ) : null}

      {view?.kind === 'ready' ? (
        <StickyAction>
          {view.twice ? (
            <ConfirmTwice
              label={M.confirm}
              armedLabel={merge.isPending ? M.merging : M.confirmTwice}
              help={M.confirmTwiceHelp}
              onConfirm={runMerge}
              disabled={merge.isPending}
              resetKey={into ?? ''}
              testId="merge-confirm"
            />
          ) : (
            <Button size="action" onClick={runMerge} disabled={merge.isPending} data-testid="merge-confirm">
              {merge.isPending ? M.merging : M.confirm}
            </Button>
          )}
        </StickyAction>
      ) : null}

      <ProductPicker
        open={pickerOpen}
        onClose={() => layer.close(PICKER_KEYS)}
        title={M.pickTitle}
        initialQuery={from.name}
        contextText={null}
        exclude={[fromId]}
        allowCreate={false}
        onPick={(p) => {
          setError(null);
          setGroupMoved(false);
          setInto(p.id);
          layer.clear(PICKER_KEYS);
        }}
        createOpen={false}
        onCreateOpen={() => undefined}
        onCreateClose={() => undefined}
      />
    </section>
  );
}
