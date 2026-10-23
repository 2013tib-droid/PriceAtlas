'use client';
// S-16 Detail & koreksi harga (docs/07 §7.3, wireframe S-16, docs/05 §3.3 S-16, §4.3): R20
// price_record_detail (staleTime 0, tidak di-persist), field record, gambar sumber (signed URL; purged →
// "Gambar dihapus"), info pengenalan, riwayat audit. "Simpan perubahan" → W6 correct_price_record dengan
// p_expected_updated_at; STALE_WRITE → muat ulang + perubahan yang masih berlaku ditampilkan lagi (pola W18
// S-11). Ganti produk lewat S-14 (+ tawaran p_update_alias). Record struk: angka/tanggal/lokasi terkunci
// (D-23) → "Ubah baris struk" (W7) / "Buka struk" (header S-10). "Batalkan data ini" = status void.
// Setelah tulis: invalidasi produk lama + baru dan SummaryUpdating (tanpa optimistic update, §4.3).
import type { MyProgram, PriceRecordDetail, PriceRecordFull } from '@priceatlas/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { ErrorState, LoadingState } from '@/components/app/screen-state';
import { StickyAction } from '@/components/app/sticky-action';
import { SummaryUpdating } from '@/components/app/summary-updating';
import { BasisLabel, PriceLabel, PriceText, PrivateBadge, UnitPrice } from '@/components/price/price';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { ProductPicker, PICKER_KEYS } from '@/features/picker/product-picker';
import { LineEditDialog } from '@/features/receipt/line-edit-dialog';
import { recordError, type RecordErrorAction } from '@/lib/catalog/errors';
import { historyLines } from '@/lib/catalog/history';
import {
  affectedProducts,
  aliasText,
  checkRecordPatch,
  isReceiptRecord,
  loadRecordDraft,
  reapplyAfterConflict,
  recordFormFrom,
  saveRecordDraft,
  toRecordPatch,
  type RecordFormValues,
} from '@/lib/catalog/record-form';
import { openLocationHref, takeLocationPick, type PickedLocation } from '@/lib/confirm/location-handoff';
import type { ProductLite } from '@/lib/confirm/receipt';
import { CATALOG_COPY, ERROR_COPY, fill, PRICE_COPY, RECEIPT_COPY } from '@/lib/copy/id';
import { invalidateAfterPriceWrite, useCorrectReceiptLine, useMyPrograms } from '@/lib/data/confirm';
import { recordKey, useCorrectRecord, useRecordDetail } from '@/lib/data/catalog';
import { useSignedUrl } from '@/lib/data/captures';
import { toAppError } from '@/lib/data/errors';
import { useProductCards } from '@/lib/data/queries';
import { formatQuantity, formatRupiah, formatTime, formatTransactionDate, todayInZone } from '@/lib/format';
import { productTitle } from '@/lib/format/product';
import { useLayer } from '@/lib/hooks/use-layer';
import { useTimeZone } from '@/lib/hooks/use-time-zone';

const C = CATALOG_COPY.record;
const H = CATALOG_COPY.history;

export const recordTarget = (id: string) => `record:${id}`;

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2">
      <h2 id={id} className="text-lg font-semibold">
        {title}
      </h2>
      {children}
    </section>
  );
}

function MoneyField({
  id,
  label,
  value,
  onChange,
  invalid,
  readOnly,
}: {
  id: string;
  label: string;
  value: string;
  onChange?: (s: string) => void;
  invalid?: boolean;
  readOnly?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <span
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground"
        >
          Rp
        </span>
        <Input
          id={id}
          inputMode="numeric"
          autoComplete="off"
          value={value}
          readOnly={readOnly}
          aria-invalid={invalid}
          onChange={(e) => onChange?.(e.target.value)}
          className="pl-10 tabular-nums"
        />
      </div>
    </div>
  );
}

function SourceImage({ image }: { image: PriceRecordDetail['image'] }) {
  const live = image && !image.purged_at ? image.storage_path : null;
  const url = useSignedUrl(live);
  if (!image) return <p className="text-sm text-muted-foreground">{C.imageNone}</p>;
  if (image.purged_at)
    return (
      <p className="rounded-lg bg-muted p-3 text-sm" data-testid="image-purged">
        {C.imagePurged}
      </p>
    );
  if (!url.data) return <Skeleton className="h-48 w-full" />;
  // eslint-disable-next-line @next/next/no-img-element -- signed URL Supabase (origin lain, tidak dioptimasi Next)
  return <img src={url.data} alt={C.imageAlt} className="max-h-80 w-full rounded-lg bg-muted object-contain" />;
}

function Matching({ r }: { r: PriceRecordFull }) {
  const parts = [
    r.match_tier ? C.tier[r.match_tier] : null,
    r.match_outcome ? C.outcome[r.match_outcome] : null,
    r.match_confidence != null && r.match_tier !== 'manual'
      ? fill(C.confidence, { pct: `${Math.round(r.match_confidence * 100)}%` })
      : null,
  ].filter(Boolean);
  if (!parts.length) return null;
  return (
    <Section id="judul-pengenalan" title={C.matching}>
      <p className="text-sm" data-testid="matching">
        {parts.join(' · ')}
      </p>
    </Section>
  );
}

function History({ detail }: { detail: PriceRecordDetail }) {
  const tz = useTimeZone();
  const lines = historyLines(detail.record, detail.history);
  return (
    <Section id="judul-riwayat" title={C.history}>
      <ol className="flex flex-col gap-2" data-testid="history">
        {lines.map((l, i) => (
          <li key={`${l.at}-${i}`} className="flex flex-col gap-0.5 border-l-2 border-divider pl-3 text-sm">
            <span className="font-medium">
              {H[l.kind]}
              {l.entity === 'receipt_line' ? ` · ${H.receiptLine}` : ''}
            </span>
            <span className="text-muted-foreground">
              {formatTransactionDate(todayInZone(tz, new Date(l.at)), tz)} · {formatTime(l.at, tz)}
            </span>
            {l.changes.length ? <span>{l.changes.join('; ')}</span> : null}
          </li>
        ))}
      </ol>
    </Section>
  );
}

/** Ringkas angka tersimpan: harga efektif + label + per satuan (+ kuantitas / berat). */
function SavedPrice({ r, product }: { r: PriceRecordFull; product: ProductLite | undefined }) {
  return (
    <div className="flex flex-col gap-1" data-testid="saved-price">
      <p
        className={
          r.status === 'void'
            ? 'flex flex-wrap items-baseline gap-2 line-through'
            : 'flex flex-wrap items-baseline gap-2'
        }
      >
        <PriceText value={r.effective_price} className="text-2xl font-bold" />
        <BasisLabel basis={r.price_basis} program={r.member_program_name} promoMinQty={r.promo_min_qty} />
        {product ? <UnitPrice product={product} value={r.unit_price} className="font-semibold" /> : null}
      </p>
      <p className="flex flex-wrap gap-2 text-sm">
        {r.quantity > 1 ? (
          <span>{fill(C.quantity, { qty: r.quantity, price: formatRupiah(r.effective_price) })}</span>
        ) : null}
        {r.actual_weight != null && product ? (
          <span>
            {fill(C.weight, {
              weight: formatQuantity(r.actual_weight, product.content_unit),
              total: formatRupiah(r.actual_weight * r.effective_price),
            })}
          </span>
        ) : null}
        {r.is_bundle ? <PriceLabel tone="muted">{PRICE_COPY.bundle}</PriceLabel> : null}
        {r.status === 'void' ? <PriceLabel tone="muted">{C.voided}</PriceLabel> : null}
      </p>
    </div>
  );
}

export function RecordScreen() {
  const router = useRouter();
  const layer = useLayer();
  const id = layer.params?.get('id') ?? null;
  const q = useRecordDetail(id);
  const back = (
    <Button variant="ghost" size="icon" onClick={() => router.back()}>
      <ArrowLeft aria-hidden />
      <span className="sr-only">{C.back}</span>
    </Button>
  );
  if (!id || (q.isError && !q.data)) {
    const notFound = !id || toAppError(q.error).code === 'NOT_FOUND';
    return (
      <section className="flex flex-col gap-3 p-4">
        <ErrorState
          error={q.error}
          screen="S-16"
          message={notFound ? ERROR_COPY.NOT_FOUND.message : undefined}
          onRetry={notFound ? undefined : () => void q.refetch()}
        />
        <Button variant="secondary" onClick={() => router.back()} className="self-start">
          {C.back}
        </Button>
      </section>
    );
  }
  if (!q.data) {
    return (
      <section className="flex flex-col gap-3 p-4">
        <LoadingState>
          <Skeleton className="h-8 w-2/3" />
          <Skeleton className="h-10 w-1/2" />
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-24 w-full" />
        </LoadingState>
      </section>
    );
  }
  // Form dipasang per record; versi baru dari server (muat ulang) diserap lewat `latest`.
  return <RecordForm key={q.data.record.id} detail={q.data} back={back} refetch={() => q.refetch()} />;
}

type Picked = { product: ProductLite | { id: string; name: string } | null; location: PickedLocation | null };

function RecordForm({
  detail,
  back,
  refetch,
}: {
  detail: PriceRecordDetail;
  back: ReactNode;
  refetch: () => Promise<{ data?: PriceRecordDetail }>;
}) {
  const uid = useId();
  const router = useRouter();
  const qc = useQueryClient();
  const tz = useTimeZone();
  const layer = useLayer();
  const params = layer.params;
  const record = detail.record;
  const receipt = isReceiptRecord(record);
  const target = recordTarget(record.id);

  // Versi record yang sedang diedit (berubah setelah simpan / konflik), isian, dan pilihan.
  const [original, setOriginal] = useState<PriceRecordFull>(record);
  const [values, setValues] = useState<RecordFormValues>(
    () => loadRecordDraft(record.id, record.updated_at)?.values ?? recordFormFrom(record),
  );
  const [picked, setPicked] = useState<Picked>(() => ({
    product: loadRecordDraft(record.id, record.updated_at)?.product ?? null,
    location: null,
  }));
  const [updateAlias, setUpdateAlias] = useState(
    () => loadRecordDraft(record.id, record.updated_at)?.updateAlias ?? false,
  );
  const [error, setError] = useState<{ message: string; action: RecordErrorAction } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ ids: string[]; at: number } | null>(null);
  const [voidOpen, setVoidOpen] = useState(false);
  const [lineOpen, setLineOpen] = useState(false);
  const [lineError, setLineError] = useState<string | null>(null);
  const correct = useCorrectRecord();
  const correctLine = useCorrectReceiptLine(detail.receipt_header?.id ?? null);
  const programs = useMyPrograms();
  const cards = useProductCards([original.product_id]);
  const card = cards.data?.find((c) => c.product.id === original.product_id);
  const product = card?.product;

  // Hasil S-12 (mode koreksi): lokasi baru untuk record observasi (D-28: cabang boleh kosong).
  useEffect(() => {
    if (receipt) return;
    const pick = takeLocationPick(target);
    // Sinkron dengan sessionStorage (hasil S-12), sekali saat kembali ke layar ini.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (pick) setPicked((p) => ({ ...p, location: pick }));
  }, [receipt, target]);

  const location = picked.location
    ? { store_id: picked.location.store.id, branch_id: picked.location.branch?.id ?? null }
    : null;
  const patch = toRecordPatch(original, values, { product: picked.product, location });
  const dirty = Object.keys(patch).length > 0;

  // Draf isian (bertahan saat membuka S-12 lalu kembali).
  useEffect(() => {
    saveRecordDraft(
      record.id,
      dirty
        ? {
            baseUpdatedAt: original.updated_at,
            values,
            product: picked.product ? { id: picked.product.id, name: pickedName(picked.product) } : null,
            updateAlias,
          }
        : null,
    );
  }, [record.id, dirty, original.updated_at, values, picked.product, updateAlias]);

  const set = <K extends keyof RecordFormValues>(k: K, v: RecordFormValues[K]) => {
    setNotice(null);
    setValues((x) => ({ ...x, [k]: v }));
  };

  const focus = (field: string) => document.getElementById(`${uid}-${field}`)?.focus();

  const onError = async (e: unknown) => {
    const err = recordError(e);
    setError(err);
    if (err.action.kind === 'reload') {
      const res = await refetch();
      const latest = res.data?.record;
      if (!latest) return;
      const again = reapplyAfterConflict(latest, values, original);
      setOriginal(latest);
      setValues(again.values);
      // Pilihan produk/lokasi tetap jika masih berbeda dari versi terbaru.
      setPicked((p) => ({
        product: p.product && p.product.id !== latest.product_id ? p.product : null,
        location:
          p.location &&
          (p.location.store.id !== latest.store_id || (p.location.branch?.id ?? null) !== latest.branch_id)
            ? p.location
            : null,
      }));
      const fields = [...again.changed.map((k) => k), ...(picked.product ? ['product_id'] : [])];
      if (fields.length) setNotice(fill(C.conflictKept, { fields: fields.map(fieldLabel).join(', ') }));
    } else if (err.action.kind === 'focus-normal') focus('normal');
    else if (err.action.kind === 'focus-extra') focus('note');
    else if (err.action.kind === 'edit-line' && detail.receipt_line) setLineOpen(true);
  };

  const afterWrite = (result: PriceRecordFull, ids: string[], resetForm: boolean) => {
    setOriginal(result);
    if (resetForm) {
      setValues(recordFormFrom(result));
      setPicked({ product: null, location: null });
      setUpdateAlias(false);
    }
    setSaved({ ids, at: Date.now() });
    void invalidateAfterPriceWrite(qc, ids);
    void qc.invalidateQueries({ queryKey: recordKey(record.id) });
  };

  const save = () => {
    setError(null);
    setNotice(null);
    if (!dirty) return;
    const issue = checkRecordPatch(patch);
    if (issue) {
      setError({
        message: issue.kind === 'extra' ? ERROR_COPY.INVALID_EXTRA.message : ERROR_COPY.INVALID_INPUT.message,
        action: { kind: issue.kind === 'extra' ? 'focus-extra' : 'none' },
      });
      if (issue.kind === 'extra') focus('note');
      return;
    }
    const ids = affectedProducts(original, patch);
    correct.mutate(
      {
        p_id: original.id,
        p_patch: patch,
        p_expected_updated_at: original.updated_at,
        p_update_alias: Boolean(patch.product_id) && updateAlias,
      },
      {
        onSuccess: (result) => {
          toast.success(C.saved);
          saveRecordDraft(record.id, null);
          afterWrite(result, ids, true);
        },
        onError: (e) => void onError(e),
      },
    );
  };

  const setStatus = (status: 'active' | 'void') => {
    setError(null);
    correct.mutate(
      { p_id: original.id, p_patch: { status }, p_expected_updated_at: original.updated_at },
      {
        onSuccess: (result) => {
          setVoidOpen(false);
          toast.success(status === 'void' ? C.voidedToast : C.restoredToast);
          // Perubahan lain yang belum disimpan tetap di isian (dibandingkan dengan versi baru).
          afterWrite(result, [original.product_id], false);
        },
        onError: (e) => {
          setVoidOpen(false);
          void onError(e);
        },
      },
    );
  };

  const storePrograms: MyProgram[] = (programs.data ?? []).filter(
    (p) => p.store.id === (location?.store_id ?? original.store_id),
  );
  const storeName = picked.location?.store.name ?? original.store_name;
  const branchName = picked.location ? (picked.location.branch?.name ?? null) : original.branch_name;
  const alias = aliasText(detail);
  const pickerOpen = params?.get('pilih') === 'produk' && params.get('untuk') === target;
  const title = product ? productTitle(product) : null;
  const pricesDirty = [
    'normal_price',
    'promo_price',
    'member_price',
    'promo_valid_from',
    'promo_valid_until',
    'transaction_date',
  ].some((k) => k in patch);

  return (
    <article
      className="flex flex-col gap-5 p-4 pb-[calc(var(--bottom-bars)+6rem)]"
      aria-labelledby="judul-layar"
      data-testid="record-screen"
      data-source={original.source_type}
    >
      <div className="flex items-center gap-2">
        {back}
        <div className="flex flex-col">
          <h1 id="judul-layar" tabIndex={-1} className="text-2xl font-semibold">
            {C.title}
          </h1>
          <p className="text-sm text-muted-foreground">{C.source[original.source_type]}</p>
        </div>
      </div>

      <SavedPrice r={original} product={product} />
      {saved ? <SummaryUpdating productIds={saved.ids} since={saved.at} /> : null}

      <Section id="judul-produk" title={C.product}>
        {title ? (
          <p className="flex flex-wrap items-center gap-2">
            <Link href={`/produk?id=${original.product_id}`} className="font-medium underline underline-offset-2">
              {title.title} <span className="font-normal text-muted-foreground">{title.size}</span>
            </Link>
            {product?.is_private ? <PrivateBadge /> : null}
          </p>
        ) : (
          <Skeleton className="h-6 w-1/2" />
        )}
        {product && !product.is_private ? <p className="text-sm text-muted-foreground">{C.productGlobal}</p> : null}
        {picked.product ? (
          <div className="flex flex-col gap-2 rounded-lg border border-divider p-3" data-testid="picked-product">
            <p className="text-sm font-medium">{fill(C.newProduct, { name: pickedName(picked.product) })}</p>
            <label className="flex min-h-touch items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-0.5 size-5 shrink-0"
                checked={updateAlias}
                onChange={(e) => setUpdateAlias(e.target.checked)}
              />
              <span>
                {alias ? fill(C.alias, { text: alias, store: storeName }) : fill(C.aliasNoText, { store: storeName })}
                <span className="block text-muted-foreground">{C.aliasHelp}</span>
              </span>
            </label>
            <Button
              variant="ghost"
              className="self-start"
              onClick={() => {
                setPicked((p) => ({ ...p, product: null }));
                setUpdateAlias(false);
              }}
            >
              {C.undoProduct}
            </Button>
          </div>
        ) : null}
        <Button
          variant="secondary"
          className="self-start"
          onClick={() => layer.open({ pilih: 'produk', untuk: target })}
        >
          {C.changeProduct}
        </Button>
      </Section>

      <Section id="judul-lokasi" title={C.location}>
        <p className="text-sm">
          {storeName} · {branchName ?? C.branchUnknown}
          {' · '}
          {formatTransactionDate(values.transaction_date || original.transaction_date, tz)}
        </p>
        {receipt ? null : (
          <>
            <div className="flex flex-col gap-1">
              <Label htmlFor={`${uid}-date`}>{C.date}</Label>
              <Input
                id={`${uid}-date`}
                type="date"
                value={values.transaction_date}
                onChange={(e) => set('transaction_date', e.target.value)}
                className="w-48"
              />
            </div>
            <Button
              variant="secondary"
              className="self-start"
              onClick={() =>
                router.push(openLocationHref('koreksi', target, `/harga?id=${encodeURIComponent(original.id)}`))
              }
            >
              {C.changeLocation}
            </Button>
          </>
        )}
      </Section>

      <Section id="judul-harga" title={C.prices}>
        {receipt ? (
          <div className="flex flex-col gap-2" data-testid="receipt-locked">
            <div className="grid grid-cols-2 gap-3">
              <MoneyField id={`${uid}-normal`} label={C.normal} value={values.normal_price} readOnly />
              <MoneyField id={`${uid}-promo`} label={C.promo} value={values.promo_price} readOnly />
            </div>
            <p className="text-sm text-muted-foreground">{C.receiptLocked}</p>
            {detail.receipt_line ? (
              <p className="text-sm">
                {C.receiptLine}: <span className="font-mono">{detail.receipt_line.raw_text}</span> ·{' '}
                {formatRupiah(detail.receipt_line.line_amount)}
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              {detail.receipt_line && detail.receipt_header?.status !== 'discarded' ? (
                <Button
                  variant="secondary"
                  onClick={() => {
                    setLineError(null);
                    setLineOpen(true);
                  }}
                >
                  {C.editLine}
                </Button>
              ) : null}
              {original.receipt_id ? (
                <Button variant="ghost" asChild>
                  <Link href={`/struk?id=${original.receipt_id}`}>{C.openReceipt}</Link>
                </Button>
              ) : null}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <MoneyField
                id={`${uid}-normal`}
                label={C.normal}
                value={values.normal_price}
                onChange={(s) => set('normal_price', s)}
                invalid={error?.action.kind === 'focus-normal'}
              />
              <MoneyField
                id={`${uid}-promo`}
                label={C.promo}
                value={values.promo_price}
                onChange={(s) => set('promo_price', s)}
              />
            </div>
            {values.promo_price ? (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="flex flex-col gap-1">
                  <Label htmlFor={`${uid}-qty`}>{C.promoMinQty}</Label>
                  <Input
                    id={`${uid}-qty`}
                    inputMode="numeric"
                    value={values.promo_min_qty}
                    onChange={(e) => set('promo_min_qty', e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <Label htmlFor={`${uid}-from`}>{C.promoFrom}</Label>
                  <Input
                    id={`${uid}-from`}
                    type="date"
                    value={values.promo_valid_from}
                    onChange={(e) => set('promo_valid_from', e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <Label htmlFor={`${uid}-until`}>{C.promoUntil}</Label>
                  <Input
                    id={`${uid}-until`}
                    type="date"
                    value={values.promo_valid_until}
                    onChange={(e) => set('promo_valid_until', e.target.value)}
                  />
                </div>
              </div>
            ) : null}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <MoneyField
                id={`${uid}-member`}
                label={C.member}
                value={values.member_price}
                onChange={(s) => set('member_price', s)}
              />
              <div className="flex flex-col gap-1">
                <Label htmlFor={`${uid}-program`}>{C.memberProgram}</Label>
                <select
                  id={`${uid}-program`}
                  className="h-touch rounded-lg border border-border bg-surface px-3"
                  value={values.member_program_id}
                  onChange={(e) => set('member_program_id', e.target.value)}
                >
                  <option value="">{C.memberProgramNone}</option>
                  {storePrograms.map((p) => (
                    <option key={p.program_id} value={p.program_id}>
                      {p.program_name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {original.extra.member_note ? (
              <p className="text-sm">{fill(C.memberNote, { note: original.extra.member_note })}</p>
            ) : null}
            <p className="text-sm text-muted-foreground" data-testid="member-rule">
              {C.memberRule}{' '}
              <Link href="/saya/member" className="font-medium text-foreground underline underline-offset-2">
                {C.memberManage}
              </Link>
            </p>
            {pricesDirty ? <p className="text-sm">{C.effectiveAfterSave}</p> : null}
          </div>
        )}
        <label className="flex min-h-touch items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-5"
            checked={values.is_bundle}
            onChange={(e) => set('is_bundle', e.target.checked)}
          />
          {C.bundle}
        </label>
      </Section>

      <Section id="judul-info" title={C.extra}>
        <p className="text-sm text-muted-foreground">{C.extraHelp}</p>
        {original.source_type === 'marketplace' ? (
          <div className="grid grid-cols-2 gap-3">
            <MoneyField
              id={`${uid}-shipping`}
              label={C.shipping}
              value={values.shipping_fee}
              onChange={(s) => set('shipping_fee', s)}
            />
            <MoneyField
              id={`${uid}-voucher`}
              label={C.shopVoucher}
              value={values.shop_voucher}
              onChange={(s) => set('shop_voucher', s)}
            />
            <MoneyField
              id={`${uid}-cashback`}
              label={C.cashback}
              value={values.cashback}
              onChange={(s) => set('cashback', s)}
            />
            <div className="flex flex-col gap-1">
              <Label htmlFor={`${uid}-points`}>{C.points}</Label>
              <Input
                id={`${uid}-points`}
                inputMode="numeric"
                value={values.points}
                onChange={(e) => set('points', e.target.value)}
              />
            </div>
            <div className="col-span-2 flex flex-col gap-1">
              <Label htmlFor={`${uid}-title`}>{C.listingTitle}</Label>
              <Input
                id={`${uid}-title`}
                value={values.listing_title}
                onChange={(e) => set('listing_title', e.target.value)}
              />
            </div>
            <div className="col-span-2 flex flex-col gap-1">
              <Label htmlFor={`${uid}-url`}>{C.listingUrl}</Label>
              <Input
                id={`${uid}-url`}
                inputMode="url"
                value={values.listing_url}
                onChange={(e) => set('listing_url', e.target.value)}
              />
            </div>
          </div>
        ) : null}
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${uid}-note`}>{C.note}</Label>
          <Input
            id={`${uid}-note`}
            value={values.note}
            aria-invalid={error?.action.kind === 'focus-extra'}
            onChange={(e) => set('note', e.target.value)}
          />
        </div>
      </Section>

      <Section id="judul-gambar" title={C.image}>
        <SourceImage image={detail.image} />
      </Section>
      <Matching r={original} />
      <History detail={detail} />

      <section className="flex flex-col gap-2" aria-label={C.void}>
        {original.status === 'void' ? (
          <Button
            variant="secondary"
            className="self-start"
            disabled={correct.isPending}
            onClick={() => setStatus('active')}
          >
            {C.restore}
          </Button>
        ) : (
          <>
            <Button variant="secondary" className="self-start text-danger" onClick={() => setVoidOpen(true)}>
              {C.void}
            </Button>
            <p className="text-sm text-muted-foreground">{C.voidHelp}</p>
          </>
        )}
      </section>

      {notice ? (
        <p role="status" className="rounded-lg bg-muted p-3 text-sm" data-testid="conflict-notice">
          {notice}
        </p>
      ) : null}
      {error ? (
        <div
          role="alert"
          className="flex flex-col gap-2 rounded-lg border border-danger p-3"
          data-testid="record-error"
        >
          <p className="text-sm">{error.message}</p>
          {error.action.kind === 'edit-line' && detail.receipt_line ? (
            <Button variant="secondary" className="self-start" onClick={() => setLineOpen(true)}>
              {C.editLine}
            </Button>
          ) : null}
        </div>
      ) : null}

      <StickyAction>
        <Button size="action" onClick={save} disabled={!dirty || correct.isPending} data-testid="save-record">
          {correct.isPending ? C.saving : dirty ? C.save : C.noChanges}
        </Button>
      </StickyAction>

      <Dialog open={voidOpen} onOpenChange={setVoidOpen}>
        <DialogContent>
          <div className="flex flex-col gap-4">
            <DialogTitle>{C.voidTitle}</DialogTitle>
            <DialogDescription>{C.voidBody}</DialogDescription>
            <div className="flex gap-2">
              <Button variant="secondary" className="flex-1" onClick={() => setVoidOpen(false)}>
                {C.cancel}
              </Button>
              <Button
                variant="danger"
                className="flex-1"
                disabled={correct.isPending}
                onClick={() => setStatus('void')}
                data-testid="void-confirm"
              >
                {C.voidConfirm}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      <LineEditDialog
        line={lineOpen ? detail.receipt_line : null}
        onClose={() => setLineOpen(false)}
        pending={correctLine.isPending}
        error={lineError}
        onSave={(p) =>
          detail.receipt_line &&
          correctLine.mutate(
            { p_line_id: detail.receipt_line.id, p_patch: p, p_expected_updated_at: detail.receipt_line.updated_at },
            {
              onSuccess: () => {
                setLineOpen(false);
                toast.success(RECEIPT_COPY.lineSaved);
                setSaved({ ids: [original.product_id], at: Date.now() });
                void invalidateAfterPriceWrite(qc, [original.product_id]);
                // Record dibentuk ulang trigger (D-23): muat ulang lalu jadikan versi dasar isian.
                void refetch().then((res) => {
                  if (!res.data) return;
                  setOriginal(res.data.record);
                  setValues(recordFormFrom(res.data.record));
                });
              },
              onError: (e) => {
                setLineError(recordError(e).message);
                if (toAppError(e).code === 'STALE_WRITE') void refetch();
              },
            },
          )
        }
      />
      <ProductPicker
        open={pickerOpen}
        onClose={() => layer.close(PICKER_KEYS)}
        initialQuery={alias ?? title?.title ?? ''}
        contextText={alias}
        onPick={(p) => {
          if (p.id !== original.product_id) setPicked((x) => ({ ...x, product: p }));
          layer.clear(PICKER_KEYS);
        }}
        createOpen={params?.get('baru') === '1'}
        onCreateOpen={() => layer.open({ baru: '1' })}
        onCreateClose={() => layer.close(['baru'])}
      />
    </article>
  );
}

function pickedName(p: ProductLite | { id: string; name: string }): string {
  return 'sale_mode' in p ? `${productTitle(p).title} ${productTitle(p).size}` : p.name;
}

function fieldLabel(k: string): string {
  const map: Record<string, string> = {
    normal_price: C.normal,
    promo_price: C.promo,
    promo_min_qty: C.promoMinQty,
    promo_valid_from: C.promoFrom,
    promo_valid_until: C.promoUntil,
    member_price: C.member,
    member_program_id: C.memberProgram,
    transaction_date: C.date,
    is_bundle: 'bundle',
    shipping_fee: C.shipping,
    shop_voucher: C.shopVoucher,
    cashback: C.cashback,
    points: C.points,
    note: C.note,
    listing_title: C.listingTitle,
    listing_url: C.listingUrl,
    product_id: C.product,
  };
  return (map[k] ?? k).toLowerCase();
}
