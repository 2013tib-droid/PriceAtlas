'use client';
// S-18 Pisahkan produk (docs/07 §7.3, wireframe S-18, docs/05 §3.3 S-18, §4.5, D-37): `/produk/pisah?id=`.
// Langkah: (1) produk tujuan — S-15 baru (W8 = T1, isian salinan produk asal) atau S-14 produk lain;
// (2) centang record (R8, filter toko & sumber); (3) opsi alias household; (4) konfirmasi → W9 (T2).
// Id produk tujuan disimpan sebelum T2 (lib/catalog/split.ts): gagal di antara T1 dan T2 → "Coba lagi"
// mengulang T2 dengan id yang sama. RECORDS_NOT_OWNED → daftar dimuat ulang, pilih lagi. Produk global
// boleh dipisah: hanya record milik household yang dipindah. Tidak ada pemindahan otomatis.
import { ArrowLeft } from 'lucide-react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ErrorState, LoadingState } from '@/components/app/screen-state';
import { StickyAction } from '@/components/app/sticky-action';
import { PrivateBadge } from '@/components/price/price';
import { HistoryRow } from '@/components/product/history-row';
import { productHref } from '@/components/product/product-card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { ProductPicker, PICKER_KEYS } from '@/features/picker/product-picker';
import { splitError } from '@/lib/catalog/errors';
import {
  aliasSourceRecord,
  aliasStore,
  keepExisting,
  loadSplitTarget,
  moveInput,
  NO_FILTER,
  saveSplitTarget,
  sourceOptions,
  storeOptions,
  toggle,
  toggleAllVisible,
  visibleRows,
  type SplitFilter,
  type SplitTarget,
} from '@/lib/catalog/split';
import { CATALOG_COPY, fill, PRODUCT_COPY } from '@/lib/copy/id';
import { useMoveRecords, useRecordDetail } from '@/lib/data/catalog';
import { toAppError } from '@/lib/data/errors';
import { usePriceHistory, useProductDetail } from '@/lib/data/queries';
import { flashToast } from '@/lib/flash';
import { formatRupiah, formatTransactionDate } from '@/lib/format';
import { productTitle } from '@/lib/format/product';
import { useLayer } from '@/lib/hooks/use-layer';
import { newCaptureId } from '@/lib/media/capture-id';
import { useTimeZone } from '@/lib/hooks/use-time-zone';
import { cn } from '@/lib/utils';

const S = CATALOG_COPY.split;

// S-15 hanya dimuat saat "Buat produk baru" dipilih (react-hook-form di chunk sendiri).
const NewProductForm = dynamic(() => import('@/features/new-product/new-product-form').then((m) => m.NewProductForm), {
  loading: () => (
    <LoadingState>
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-10 w-full" />
    </LoadingState>
  ),
});

type Step = 1 | 2 | 3 | 4;

function Chip({ pressed, onClick, children }: { pressed: boolean; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        'min-h-touch rounded-full border px-3 text-sm',
        pressed ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-surface',
      )}
    >
      {children}
    </button>
  );
}

export function SplitScreen() {
  const router = useRouter();
  const tz = useTimeZone();
  const layer = useLayer();
  const params = layer.params;
  const sourceId = params?.get('id') ?? null;
  const source = useProductDetail(sourceId);
  const history = usePriceHistory(source.data?.card.product.id ?? null);
  const move = useMoveRecords(sourceId);
  // Tujuan tersimpan dari percobaan sebelumnya (T1 sudah jalan) → langsung ke langkah 2.
  const [target, setTargetState] = useState<SplitTarget | null>(() => (sourceId ? loadSplitTarget(sourceId) : null));
  const [step, setStep] = useState<Step>(() => (target?.saved ? 2 : 1));
  const [creating, setCreating] = useState(() => Boolean(target && target.created && !target.saved));
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<SplitFilter>(NO_FILTER);
  const [aliasOn, setAliasOn] = useState(false);
  const [aliasEdit, setAliasEdit] = useState<string | null>(null);
  const [error, setError] = useState<ReturnType<typeof splitError> | null>(null);
  const pickerOpen = params?.get('pilih') === 'produk' && params.get('untuk') === 'split';

  const rows = history.data?.pages.flat() ?? [];
  const aliasRecord = aliasSourceRecord(rows, selected);
  const aliasDetail = useRecordDetail(step >= 3 ? aliasRecord : null);
  const aliasDefault = aliasDetail.data?.receipt_line?.raw_text ?? '';
  const aliasValue = aliasEdit ?? aliasDefault;
  const store = aliasStore(rows, selected);

  const setTarget = (t: SplitTarget | null) => {
    setTargetState(t);
    if (sourceId) saveSplitTarget(sourceId, t);
  };

  const header = (
    <div className="flex items-center gap-2">
      <Button variant="ghost" size="icon" onClick={() => (step > 1 ? setStep((s) => (s - 1) as Step) : router.back())}>
        <ArrowLeft aria-hidden />
        <span className="sr-only">{S.back}</span>
      </Button>
      <h1 id="judul-layar" tabIndex={-1} className="text-2xl font-semibold">
        {S.title}
      </h1>
    </div>
  );

  if (!sourceId || (source.isError && !source.data)) {
    const notFound = !sourceId || toAppError(source.error).code === 'NOT_FOUND';
    return (
      <section className="flex flex-col gap-3 p-4" aria-labelledby="judul-layar">
        {header}
        <ErrorState
          error={source.error}
          message={notFound ? PRODUCT_COPY.notFound : undefined}
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
  const fromTitle = productTitle(from);
  const visible = visibleRows(rows, filter);
  const n = selected.size;

  const runMove = () => {
    if (!target || n === 0) return;
    setError(null);
    const alias = aliasOn && store ? { store_id: store.id, alias_text: aliasValue } : null;
    move.mutate(moveInput(selected, target.id, alias), {
      onSuccess: () => {
        setTarget(null);
        flashToast('success', fill(S.done, { n, name: target.name }));
        router.replace(productHref(target.id));
      },
      onError: async (e) => {
        const err = splitError(e);
        setError(err);
        if (err.action.kind === 'reload-records') {
          const res = await history.refetch();
          setSelected((sel) => keepExisting(sel, res.data?.pages.flat() ?? []));
          setStep(2);
        } else if (err.action.kind === 'pick-target') {
          setTarget(null);
          setStep(1);
        }
      },
    });
  };

  return (
    <section
      className="flex flex-col gap-4 p-4 pb-[calc(var(--bottom-bars)+6rem)]"
      aria-labelledby="judul-layar"
      data-testid="split-screen"
      data-step={step}
    >
      {header}
      <p>
        {fill(S.intro, { name: `${fromTitle.title} ${fromTitle.size}` })} {from.is_private ? <PrivateBadge /> : null}
      </p>
      {from.is_private ? null : <p className="text-sm text-muted-foreground">{S.globalNote}</p>}
      <p className="text-sm text-muted-foreground" aria-live="polite">
        {fill(S.step, { i: step })}
      </p>

      {target && step > 1 ? (
        <p className="flex flex-wrap items-center gap-2 rounded-lg bg-muted p-3 text-sm" data-testid="split-target">
          {fill(S.target, { name: target.name })}
          {step < 4 ? (
            <Button variant="link" className="h-auto p-0" onClick={() => setStep(1)}>
              {S.changeTarget}
            </Button>
          ) : null}
        </p>
      ) : null}

      {step === 1 ? (
        <section aria-labelledby="judul-tujuan" className="flex flex-col gap-3">
          <h2 id="judul-tujuan" className="text-lg font-semibold">
            {S.step1}
          </h2>
          {target?.saved && target.created ? <p className="text-sm">{S.createdPending}</p> : null}
          {creating && target && !target.saved ? (
            <NewProductForm
              productId={target.id}
              initialName={from.name}
              initialValues={{
                variant: from.variant ?? '',
                sale_mode: from.sale_mode,
                pack_count: String(from.pack_count),
                content_size: from.content_size == null ? '' : String(from.content_size).replace('.', ','),
                content_unit: from.content_unit,
              }}
              onCreated={(card) => {
                const t = productTitle(card.product);
                setTarget({ id: card.product.id, name: `${t.title} ${t.size}`, created: true, saved: true });
                setCreating(false);
                setStep(2);
              }}
              onUseExisting={(p) => {
                const t = productTitle(p);
                setTarget({ id: p.id, name: `${t.title} ${t.size}`, created: false, saved: true });
                setCreating(false);
                setStep(2);
              }}
              onCancel={() => {
                setCreating(false);
                setTarget(null);
              }}
            />
          ) : (
            <div className="flex flex-col gap-2">
              <Button
                variant="secondary"
                size="action"
                onClick={() => {
                  // Id produk baru disimpan SEBELUM W8 (T1): mengulang setelah muat ulang = id sama (23505 = sukses).
                  if (!target || target.saved || !target.created)
                    setTarget({ id: newCaptureId(), name: '', created: true, saved: false });
                  setCreating(true);
                }}
                data-testid="split-create"
              >
                {S.createNew}
              </Button>
              <Button
                variant="secondary"
                size="action"
                onClick={() => layer.open({ pilih: 'produk', untuk: 'split' })}
                data-testid="split-pick"
              >
                {S.pickOther}
              </Button>
              {target?.saved ? (
                <Button variant="ghost" onClick={() => setStep(2)}>
                  {S.next}
                </Button>
              ) : null}
            </div>
          )}
        </section>
      ) : null}

      {step === 2 ? (
        <section aria-labelledby="judul-pilih" className="flex flex-col gap-3">
          <h2 id="judul-pilih" className="text-lg font-semibold">
            {S.step2}
          </h2>
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2" role="group" aria-label={S.filterStore}>
              <span className="text-sm font-medium">{S.filterStore}</span>
              <Chip pressed={!filter.storeId} onClick={() => setFilter((f) => ({ ...f, storeId: null }))}>
                {S.all}
              </Chip>
              {storeOptions(rows).map((o) => (
                <Chip
                  key={o.id}
                  pressed={filter.storeId === o.id}
                  onClick={() => setFilter((f) => ({ ...f, storeId: o.id }))}
                >
                  {o.name}
                </Chip>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2" role="group" aria-label={S.filterSource}>
              <span className="text-sm font-medium">{S.filterSource}</span>
              <Chip pressed={!filter.source} onClick={() => setFilter((f) => ({ ...f, source: null }))}>
                {S.all}
              </Chip>
              {sourceOptions(rows).map((o) => (
                <Chip key={o} pressed={filter.source === o} onClick={() => setFilter((f) => ({ ...f, source: o }))}>
                  {PRODUCT_COPY.source[o]}
                </Chip>
              ))}
            </div>
          </div>
          {history.data ? (
            rows.length === 0 ? (
              <p className="text-sm text-muted-foreground">{S.empty}</p>
            ) : (
              <>
                <Button
                  variant="ghost"
                  className="self-start"
                  onClick={() => setSelected((s) => toggleAllVisible(s, visible))}
                >
                  {S.selectAll}
                </Button>
                <ul data-testid="split-records">
                  {visible.map((r) => (
                    <HistoryRow
                      key={r.id}
                      record={r}
                      product={from}
                      select={{
                        checked: selected.has(r.id),
                        onChange: () => setSelected((s) => toggle(s, r.id)),
                        label: fill(S.choose, {
                          date: formatTransactionDate(r.transaction_date, tz),
                          store: r.store_name,
                          price: formatRupiah(r.effective_price),
                        }),
                      }}
                    />
                  ))}
                </ul>
                {history.hasNextPage ? (
                  <Button
                    variant="secondary"
                    onClick={() => void history.fetchNextPage()}
                    disabled={history.isFetchingNextPage}
                  >
                    {PRODUCT_COPY.loadMore}
                  </Button>
                ) : null}
              </>
            )
          ) : history.isError ? (
            <ErrorState error={history.error} onRetry={() => void history.refetch()} />
          ) : (
            <LoadingState>
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </LoadingState>
          )}
          <p className="text-sm" aria-live="polite" data-testid="split-count">
            {n ? fill(S.selected, { n }) : S.none}
          </p>
        </section>
      ) : null}

      {step === 3 ? (
        <section aria-labelledby="judul-alias" className="flex flex-col gap-3">
          <h2 id="judul-alias" className="text-lg font-semibold">
            {S.step3}
          </h2>
          {store ? (
            <>
              <label className="flex min-h-touch items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-0.5 size-5 shrink-0"
                  checked={aliasOn}
                  onChange={(e) => setAliasOn(e.target.checked)}
                />
                <span>
                  {aliasValue
                    ? fill(S.alias, { text: aliasValue, store: store.name })
                    : fill(S.aliasNoText, { store: store.name })}
                  <span className="block text-muted-foreground">{S.aliasHelp}</span>
                </span>
              </label>
              {aliasOn ? (
                <div className="flex flex-col gap-1">
                  <Label htmlFor="split-alias">{S.aliasText}</Label>
                  <Input id="split-alias" value={aliasValue} onChange={(e) => setAliasEdit(e.target.value)} />
                </div>
              ) : null}
            </>
          ) : null}
        </section>
      ) : null}

      {step === 4 && target ? (
        <section aria-labelledby="judul-konfirmasi" className="flex flex-col gap-2">
          <h2 id="judul-konfirmasi" className="text-lg font-semibold">
            {S.step4}
          </h2>
          <p data-testid="split-summary">
            {fill(S.summary, { n, from: `${fromTitle.title} ${fromTitle.size}`, to: target.name })}
          </p>
          {aliasOn && store && aliasValue.trim() ? (
            <p className="text-sm">{fill(S.alias, { text: aliasValue.trim(), store: store.name })}</p>
          ) : null}
        </section>
      ) : null}

      {error ? (
        <div role="alert" className="flex flex-col gap-2 rounded-lg border border-danger p-3" data-testid="split-error">
          <p className="text-sm">{error.message}</p>
        </div>
      ) : null}

      {step > 1 ? (
        <StickyAction>
          {step < 4 ? (
            <Button
              size="action"
              onClick={() => setStep((s) => (s + 1) as Step)}
              disabled={step === 2 && n === 0}
              data-testid="split-next"
            >
              {S.next}
            </Button>
          ) : (
            <Button size="action" onClick={runMove} disabled={move.isPending || n === 0} data-testid="split-move">
              {move.isPending ? S.moving : error?.action.kind === 'retry' ? S.retry : fill(S.move, { n })}
            </Button>
          )}
        </StickyAction>
      ) : null}

      <ProductPicker
        open={pickerOpen}
        onClose={() => layer.close(PICKER_KEYS)}
        title={S.pickOther}
        initialQuery={from.name}
        contextText={null}
        exclude={[from.id]}
        allowCreate={false}
        onPick={(p) => {
          const t = productTitle(p);
          setTarget({ id: p.id, name: `${t.title} ${t.size}`, created: false, saved: true });
          setStep(2);
          layer.clear(PICKER_KEYS);
        }}
        createOpen={false}
        onCreateOpen={() => undefined}
        onCreateClose={() => undefined}
      />
    </section>
  );
}
