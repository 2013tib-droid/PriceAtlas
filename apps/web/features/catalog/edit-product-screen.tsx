'use client';
// S-15 mode edit (`/produk/edit?id=`, docs/07 §7.3, wireframe S-15, docs/05 §3.3 S-15): produk privat
// sendiri. REST `product` dibaca (updated_at) lalu PATCH dengan filter updated_at (0 baris = STALE_WRITE
// → baris terbaru dimuat, perubahan yang masih berlaku ditampilkan lagi). Form react-hook-form + zod dari
// kontrak (lib/catalog/product-edit.ts). Mengubah ukuran → teks "dihitung ulang" (job
// recompute_unit_price). Brand/group: pilih yang ada (REST baca, D-87); yang baru hanya lewat W8.
// Barcode/PLU: REST barcode_assignment select + insert (D-89, BarcodeSection). Hapus produk = arsip
// (REST PATCH status).
import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowLeft } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useId, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { ErrorState, LoadingState } from '@/components/app/screen-state';
import { PrivateBadge } from '@/components/price/price';
import { productHref } from '@/components/product/product-card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Segmented } from '@/components/ui/segmented';
import { Skeleton } from '@/components/ui/skeleton';
import { productEditError } from '@/lib/catalog/errors';
import {
  canEditProduct,
  editFormFrom,
  productEditSchema,
  reapplyProductEdits,
  sizeChanged,
  toProductPatch,
  type ProductEditValues,
} from '@/lib/catalog/product-edit';
import { UNIT_OPTIONS, WEIGHT_UNIT_OPTIONS } from '@/lib/confirm/product-form';
import { CATALOG_COPY, fill, NEW_PRODUCT_COPY as N } from '@/lib/copy/id';
import { fetchProductRow, useNamedById, usePatchProduct, useProductRow } from '@/lib/data/catalog';
import { useCategories, useNamedSearch } from '@/lib/data/confirm';
import type { ProductRow } from '@/lib/data/rest-schemas';
import { flashToast } from '@/lib/flash';
import { ArchiveDialog } from './archive-dialog';
import { BarcodeSection } from './barcode-section';

const E = CATALOG_COPY.edit;

export function EditProductScreen() {
  const router = useRouter();
  const id = useSearchParams()?.get('id') ?? null;
  const row = useProductRow(id);
  const header = (
    <div className="flex items-center gap-2">
      <Button variant="ghost" size="icon" onClick={() => router.back()}>
        <ArrowLeft aria-hidden />
        <span className="sr-only">{CATALOG_COPY.record.back}</span>
      </Button>
      <h1 id="judul-layar" tabIndex={-1} className="text-2xl font-semibold">
        {E.title}
      </h1>
    </div>
  );
  if (!id || row.isError || (row.data === null && !row.isFetching)) {
    return (
      <section className="flex flex-col gap-3 p-4" aria-labelledby="judul-layar">
        {header}
        <ErrorState
          error={row.error}
          message={row.isError ? undefined : E.notOwned}
          onRetry={row.isError ? () => void row.refetch() : undefined}
        />
      </section>
    );
  }
  if (!row.data) {
    return (
      <section className="flex flex-col gap-3 p-4" aria-labelledby="judul-layar">
        {header}
        <LoadingState>
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-24 w-full" />
        </LoadingState>
      </section>
    );
  }
  if (!canEditProduct(row.data)) {
    return (
      <section className="flex flex-col gap-3 p-4" aria-labelledby="judul-layar" data-testid="edit-blocked">
        {header}
        <p role="alert" className="rounded-lg bg-muted p-3">
          {row.data.household_id == null ? E.notPrivate : E.notActive}
        </p>
      </section>
    );
  }
  return (
    <section className="mx-auto flex w-full max-w-xl flex-col gap-4 p-4 pb-8" aria-labelledby="judul-layar">
      {header}
      <EditForm key={row.data.id} row={row.data} />
    </section>
  );
}

function EditForm({ row }: { row: ProductRow }) {
  const uid = useId();
  const router = useRouter();
  const patch = usePatchProduct();
  const categories = useCategories();
  const [base, setBase] = useState<ProductRow>(row);
  const [serverError, setServerError] = useState<string | null>(null);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const form = useForm<ProductEditValues>({
    resolver: zodResolver(productEditSchema),
    defaultValues: editFormFrom(row),
    mode: 'onTouched',
  });
  const { register, control, handleSubmit, setValue, setError, setFocus, reset, getValues, formState } = form;
  const v = useWatch({ control }) as ProductEditValues;
  const errors = formState.errors;
  const brands = useNamedSearch('brand', '');
  const groups = useNamedSearch('product_group', v.name ?? '');
  const current = useNamedById('product_group', [base.product_group_id ?? '']);
  const currentBrand = useNamedById('brand', [base.brand_id ?? '']);
  const groupOptions = mergeOptions(current.data, groups.data);
  const brandOptions = mergeOptions(currentBrand.data, brands.data);

  const pending = toProductPatch(v, base);
  const dirty = Object.keys(pending).length > 0;
  const name = (v.name ?? base.name).trim() || base.name;

  const submit = handleSubmit((values) => {
    setServerError(null);
    const p = toProductPatch(values, base);
    if (!Object.keys(p).length) return;
    patch.mutate(
      { id: base.id, updatedAt: base.updated_at, patch: p },
      {
        onSuccess: (updated) => {
          flashToast('success', fill(E.saved, { name: updated.name }));
          router.replace(productHref(updated.id));
        },
        onError: async (e) => {
          const r = productEditError(e);
          setServerError(r.message);
          if (r.field) {
            setError(r.field, { message: r.message });
            setFocus(r.field === 'product_group_id' ? 'product_group_id' : r.field);
          }
          if (r.stale) {
            const latest = await fetchProductRow(base.id).catch(() => null);
            if (!latest) return;
            const again = reapplyProductEdits(latest, getValues(), base);
            setBase(latest);
            reset(again.values);
            if (again.changed.length) setServerError(E.conflictKept);
          }
        },
      },
    );
  });

  const unitOptions = v.sale_mode === 'weight' ? WEIGHT_UNIT_OPTIONS : UNIT_OPTIONS;

  return (
    <>
      <form onSubmit={submit} noValidate className="flex flex-col gap-4" data-testid="edit-product">
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <PrivateBadge />
          {N.privateNote}
        </p>
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${uid}-name`}>{N.name}</Label>
          <Input id={`${uid}-name`} autoComplete="off" aria-invalid={Boolean(errors.name)} {...register('name')} />
          {errors.name ? (
            <p role="alert" className="text-sm text-danger">
              {errors.name.message}
            </p>
          ) : null}
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${uid}-variant`}>{N.variant}</Label>
          <Input id={`${uid}-variant`} autoComplete="off" {...register('variant')} />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${uid}-brand`}>{E.brand}</Label>
          <select
            id={`${uid}-brand`}
            className="h-touch rounded-lg border border-border bg-surface px-3"
            {...register('brand_id')}
          >
            <option value="">{E.brandNone}</option>
            {brandOptions.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
                {b.household_id ? ' · PRIBADI' : ''}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${uid}-group`}>{E.group}</Label>
          <select
            id={`${uid}-group`}
            className="h-touch rounded-lg border border-border bg-surface px-3"
            aria-invalid={Boolean(errors.product_group_id)}
            {...register('product_group_id')}
          >
            <option value="">{E.groupNone}</option>
            {groupOptions.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
                {g.household_id ? ' · PRIBADI' : ''}
              </option>
            ))}
          </select>
          <p className="text-sm text-muted-foreground">{E.groupHelp}</p>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${uid}-category`}>{N.category}</Label>
          <select
            id={`${uid}-category`}
            className="h-touch rounded-lg border border-border bg-surface px-3"
            {...register('category_id')}
          >
            <option value="">{N.categoryNone}</option>
            {(categories.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium">{N.saleMode}</span>
          <Segmented
            label={N.saleMode}
            value={v.sale_mode ?? 'unit'}
            onChange={(m) => {
              setValue('sale_mode', m, { shouldValidate: formState.isSubmitted });
              setValue('content_unit', m === 'weight' ? 'kg' : 'g');
            }}
            options={[
              { value: 'unit', label: N.saleUnit },
              { value: 'weight', label: N.saleWeight },
            ]}
          />
          {v.sale_mode === 'unit' ? (
            <div className="flex items-end gap-2">
              <div className="flex w-20 flex-col gap-1">
                <Label htmlFor={`${uid}-pack`}>{N.packCount}</Label>
                <Input
                  id={`${uid}-pack`}
                  inputMode="numeric"
                  aria-invalid={Boolean(errors.pack_count)}
                  {...register('pack_count')}
                />
              </div>
              <span aria-hidden className="pb-3">
                ×
              </span>
              <div className="flex flex-1 flex-col gap-1">
                <Label htmlFor={`${uid}-size`}>{N.contentSize}</Label>
                <Input
                  id={`${uid}-size`}
                  inputMode="decimal"
                  aria-invalid={Boolean(errors.content_size)}
                  {...register('content_size')}
                />
              </div>
              <div className="flex w-24 flex-col gap-1">
                <Label htmlFor={`${uid}-unit`}>{N.contentUnit}</Label>
                <select
                  id={`${uid}-unit`}
                  className="h-touch rounded-lg border border-border bg-surface px-2"
                  {...register('content_unit')}
                >
                  {unitOptions.map((u) => (
                    <option key={u} value={u}>
                      {u}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          ) : (
            <div className="flex w-32 flex-col gap-1">
              <Label htmlFor={`${uid}-wunit`}>{N.weightUnit}</Label>
              <select
                id={`${uid}-wunit`}
                className="h-touch rounded-lg border border-border bg-surface px-2"
                {...register('content_unit')}
              >
                {unitOptions.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </select>
            </div>
          )}
          {errors.content_size || errors.pack_count ? (
            <p role="alert" className="text-sm text-danger">
              {errors.content_size?.message ?? errors.pack_count?.message}
            </p>
          ) : null}
          {sizeChanged(pending) ? (
            <p
              role="status"
              className="rounded-lg bg-warning p-3 text-sm text-warning-foreground"
              data-testid="recompute"
            >
              {E.recompute}
            </p>
          ) : null}
        </div>
        {serverError ? (
          <p role="alert" className="rounded-lg border border-danger p-3 text-sm" data-testid="edit-error">
            {serverError}
          </p>
        ) : null}
        <Button type="submit" size="action" disabled={!dirty || patch.isPending} data-testid="edit-save">
          {patch.isPending ? E.saving : dirty ? E.save : E.noChanges}
        </Button>
      </form>
      <BarcodeSection productId={base.id} saleMode={base.sale_mode} />
      <Button variant="secondary" className="self-start text-danger" onClick={() => setArchiveOpen(true)}>
        {E.archive}
      </Button>
      <ArchiveDialog productId={row.id} name={name} open={archiveOpen} onOpenChange={setArchiveOpen} />
    </>
  );
}

type Named = { id: string; name: string; household_id: string | null };

/** Nilai sekarang (by id) + saran (REST), tanpa dobel. */
function mergeOptions(current: readonly Named[] | undefined, more: readonly Named[] | undefined): Named[] {
  const out = new Map<string, Named>();
  for (const x of [...(current ?? []), ...(more ?? [])]) out.set(x.id, x);
  return [...out.values()];
}
