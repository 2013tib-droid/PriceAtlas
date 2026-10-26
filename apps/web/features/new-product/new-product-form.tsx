'use client';
// S-15 Produk baru (docs/07 §7.3, §4.2, wireframe S-15): react-hook-form + zod (skema diturunkan dari
// CreatePrivateProductInput, lib/confirm/product-form.ts), pratinjau ukuran dengan unitPrice()
// kontrak, kemasan / multipack / timbang, brand & group baru atau yang ada, "Produk serupa sudah
// ada" (R3), W8 dengan id dari klien. Error 23514 (ukuran), 23P01 (barcode), 23505 (= sukses) §8.2.
// Produk timbang: kode PLU dengan pemilih toko (F-55, M5).
// Produk baru selalu PRIBADI (D-29).
import { zodResolver } from '@hookform/resolvers/zod';
import type { ProductCard } from '@priceatlas/contracts';
import { Plus, Trash2 } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { useFieldArray, useForm, useWatch } from 'react-hook-form';
import { PrivateBadge } from '@/components/price/price';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Segmented } from '@/components/ui/segmented';
import { productError } from '@/lib/confirm/errors';
import {
  codeType,
  defaultProductForm,
  parseDecimal,
  previewUnitPrice,
  productFormSchema,
  toProductInput,
  UNIT_OPTIONS,
  WEIGHT_UNIT_OPTIONS,
  type ProductFormValues,
} from '@/lib/confirm/product-form';
import type { ProductLite } from '@/lib/confirm/receipt';
import { fill, NEW_PRODUCT_COPY as C } from '@/lib/copy/id';
import { useCategories, useCreateProduct, useNamedSearch, useStores } from '@/lib/data/confirm';
import { MIN_QUERY, normalizeQuery, useSearch } from '@/lib/data/queries';
import { formatRupiah, formatSize, formatUnitPrice } from '@/lib/format';
import { productTitle } from '@/lib/format/product';
import { newCaptureId } from '@/lib/media/capture-id';
import { cn } from '@/lib/utils';

const BASE: Record<string, string> = { mass: 'gram', volume: 'ml', count: 'buah', length: 'meter' };
const BASE_UNIT: Record<string, string> = { mass: 'g', volume: 'ml', count: 'pcs', length: 'm' };
const DIM: Record<string, string> = {
  mg: 'mass',
  g: 'mass',
  kg: 'mass',
  ml: 'volume',
  l: 'volume',
  pcs: 'count',
  lembar: 'count',
  cm: 'length',
  m: 'length',
};
const EXAMPLE_PRICE = 10_000;

function FieldError({ id, message }: { id: string; message?: string }) {
  return message ? (
    <p id={id} role="alert" className="text-sm text-danger">
      {message}
    </p>
  ) : null;
}

function Preview({ v }: { v: ProductFormValues }) {
  const name = v.name.trim() || C.namePlaceholder;
  if (v.sale_mode === 'weight') return <p>{fill(C.previewWeight, { name, unit: v.content_unit })}</p>;
  const size = parseDecimal(v.content_size);
  const count = Math.max(1, Number(v.pack_count) || 1);
  if (size == null || size <= 0) return <p className="text-muted-foreground">{C.errors.size}</p>;
  const lite = { sale_mode: 'unit' as const, pack_count: count, content_size: size, content_unit: v.content_unit };
  const dim = DIM[v.content_unit] ?? 'mass';
  const unit = previewUnitPrice(v, EXAMPLE_PRICE);
  return (
    <>
      <p>
        {fill(C.previewUnit, { name, size: `${count} × ${formatSize({ ...lite, pack_count: 1 })}`, per: BASE[dim]! })}
      </p>
      {count > 1 ? (
        <p>
          {fill(C.previewMulti, {
            count,
            size: formatSize({ ...lite, pack_count: 1 }),
            total: formatSize({ ...lite, pack_count: 1, content_size: Math.round(count * size * 1000) / 1000 }),
          })}
        </p>
      ) : null}
      {unit != null ? (
        <p className="text-muted-foreground" data-testid="preview-unit-price">
          {fill(C.previewExample, { price: formatRupiah(EXAMPLE_PRICE), unit: formatUnitPrice(unit, BASE_UNIT[dim]!) })}
        </p>
      ) : null}
    </>
  );
}

export function NewProductForm({
  initialName = '',
  initialBarcode,
  initialValues,
  productId: fixedId,
  onCreated,
  onUseExisting,
  onCancel,
  asScreen = false,
}: {
  /** Layar sendiri (`/produk/baru`): judul jadi h1 layar (§10.1); di sheet S-14 tetap h2. */
  asScreen?: boolean;
  initialName?: string;
  initialBarcode?: string;
  /** Isian awal tambahan (S-18: salinan produk asal). */
  initialValues?: Partial<ProductFormValues>;
  /** Id dari pemanggil yang sudah disimpan (S-18 T1: tetap sama walau halaman dimuat ulang). */
  productId?: string;
  onCreated: (card: ProductCard) => void;
  /** "Produk serupa sudah ada" → pakai produk itu (dari S-14); tanpa ini: buka detail. */
  onUseExisting?: (p: ProductLite) => void;
  onCancel?: () => void;
}) {
  const uid = useId();
  // Id dari klien (idempoten): tetap sama saat simpan diulang setelah gagal.
  const [productId] = useState(() => fixedId ?? newCaptureId());
  const create = useCreateProduct();
  const categories = useCategories();
  const [serverError, setServerError] = useState<string | null>(null);
  const form = useForm<ProductFormValues>({
    resolver: zodResolver(productFormSchema),
    defaultValues: { ...defaultProductForm({ name: initialName, barcode: initialBarcode }), ...initialValues },
    mode: 'onTouched',
  });
  const { register, control, handleSubmit, setValue, setError, setFocus, formState } = form;
  const barcodes = useFieldArray({ control, name: 'barcodes' });
  const v = useWatch({ control }) as ProductFormValues;
  const errors = formState.errors;

  // Produk serupa (R3, debounce 400 ms) sebagai pencegah duplikat.
  const [similarQ, setSimilarQ] = useState(initialName);
  useEffect(() => {
    const t = setTimeout(() => setSimilarQ(v.name ?? ''), 400);
    return () => clearTimeout(t);
  }, [v.name]);
  const similar = useSearch(similarQ);
  const similarList = normalizeQuery(similarQ).length >= MIN_QUERY ? (similar.data ?? []).slice(0, 3) : [];

  const brands = useNamedSearch('brand', v.brand ?? '');
  // Toko untuk PLU (F-55): hanya dimuat jika produk timbang.
  const stores = useStores('', v.sale_mode === 'weight');
  const groups = useNamedSearch('product_group', v.groupMode === 'existing' ? (v.name ?? '') : '');

  const submit = handleSubmit((values) => {
    setServerError(null);
    create.mutate(
      { ...toProductInput(values), id: productId },
      {
        onSuccess: (card) => onCreated(card),
        onError: (e) => {
          const { message, field } = productError(e);
          setServerError(message);
          if (field === 'content_size') {
            setError('content_size', { message });
            setFocus('content_size');
          } else if (field === 'barcodes') {
            setError('barcodes.0.code', { message });
            setFocus('barcodes.0.code');
          } else if (field === 'name') setFocus('name');
        },
      },
    );
  });

  const err = (k: string) => `${uid}-${k}-err`;
  const unitOptions = v.sale_mode === 'weight' ? WEIGHT_UNIT_OPTIONS : UNIT_OPTIONS;

  return (
    <form
      onSubmit={submit}
      noValidate
      className="flex flex-col gap-4"
      aria-labelledby={asScreen ? 'judul-layar' : `${uid}-title`}
    >
      <div className="flex items-center gap-2">
        {asScreen ? (
          <h1 id="judul-layar" tabIndex={-1} className="text-2xl font-semibold">
            {C.title}
          </h1>
        ) : (
          <h2 id={`${uid}-title`} className="text-2xl font-semibold">
            {C.title}
          </h2>
        )}
        <PrivateBadge />
      </div>
      <p className="text-sm text-muted-foreground">{C.privateNote}</p>
      {initialBarcode ? (
        <p className="rounded-lg bg-muted p-3 text-sm">{fill(C.fromBarcode, { code: initialBarcode })}</p>
      ) : null}

      <div className="flex flex-col gap-1">
        <Label htmlFor={`${uid}-name`}>{C.name}</Label>
        <Input
          id={`${uid}-name`}
          placeholder={C.namePlaceholder}
          autoComplete="off"
          aria-invalid={Boolean(errors.name)}
          aria-describedby={errors.name ? err('name') : undefined}
          {...register('name')}
        />
        <FieldError id={err('name')} message={errors.name?.message} />
      </div>

      {similarList.length ? (
        <section
          aria-labelledby={`${uid}-similar`}
          className="flex flex-col gap-2 rounded-lg border border-warning-foreground p-3"
          data-testid="similar"
        >
          <h3 id={`${uid}-similar`} className="text-sm font-semibold">
            {C.similar}
          </h3>
          <ul className="flex flex-col gap-1">
            {similarList.map((c) => {
              const t = productTitle(c.product);
              const name = `${t.title} ${t.size}`;
              return (
                <li key={c.product.id} className="flex items-center justify-between gap-2 text-sm">
                  <span>
                    {name} {c.product.is_private ? <PrivateBadge /> : null}
                  </span>
                  {onUseExisting ? (
                    <Button variant="secondary" onClick={() => onUseExisting(c.product)}>
                      {fill(C.similarUse, { name: t.title })}
                    </Button>
                  ) : (
                    <a className="font-medium underline" href={`/produk?id=${c.product.id}`}>
                      {fill(C.similarOpen, { name: t.title })}
                    </a>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      <div className="flex flex-col gap-1">
        <Label htmlFor={`${uid}-variant`}>{C.variant}</Label>
        <Input id={`${uid}-variant`} placeholder={C.variantPlaceholder} autoComplete="off" {...register('variant')} />
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor={`${uid}-brand`}>{C.brand}</Label>
        <Input
          id={`${uid}-brand`}
          placeholder={C.brandPlaceholder}
          autoComplete="off"
          list={`${uid}-brands`}
          {...register('brand')}
        />
        <datalist id={`${uid}-brands`}>
          {(brands.data ?? []).map((b) => (
            <option key={b.id} value={b.name} />
          ))}
        </datalist>
        {v.brand?.trim() && !(brands.data ?? []).some((b) => b.name.toLowerCase() === v.brand!.trim().toLowerCase()) ? (
          <p className="text-sm text-muted-foreground">{fill(C.brandNew, { name: v.brand.trim() })}</p>
        ) : null}
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">{C.group}</legend>
        <Segmented
          label={C.group}
          value={v.groupMode ?? 'same'}
          onChange={(m) => setValue('groupMode', m, { shouldValidate: formState.isSubmitted })}
          options={[
            { value: 'same', label: C.groupSame },
            { value: 'existing', label: C.groupExisting },
            { value: 'new', label: C.groupNew },
          ]}
        />
        {v.groupMode === 'new' ? (
          <div className="flex flex-col gap-1">
            <Label htmlFor={`${uid}-groupName`}>{C.groupNewName}</Label>
            <Input
              id={`${uid}-groupName`}
              aria-invalid={Boolean(errors.groupName)}
              aria-describedby={errors.groupName ? err('groupName') : undefined}
              {...register('groupName')}
            />
            <FieldError id={err('groupName')} message={errors.groupName?.message} />
          </div>
        ) : null}
        {v.groupMode === 'existing' ? (
          <div className="flex flex-col gap-1">
            <Label htmlFor={`${uid}-groupId`}>{C.groupPick}</Label>
            <select
              id={`${uid}-groupId`}
              className="h-touch rounded-lg border border-border bg-surface px-3"
              aria-invalid={Boolean(errors.groupId)}
              {...register('groupId')}
            >
              <option value="">{groups.data?.length ? C.groupPick : C.groupNone}</option>
              {(groups.data ?? []).map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                  {g.household_id ? ' · PRIBADI' : ''}
                </option>
              ))}
            </select>
            <FieldError id={err('groupId')} message={errors.groupId?.message} />
          </div>
        ) : null}
      </fieldset>

      <div className="flex flex-col gap-1">
        <Label htmlFor={`${uid}-category`}>{C.category}</Label>
        <select
          id={`${uid}-category`}
          className="h-touch rounded-lg border border-border bg-surface px-3"
          {...register('category_id')}
        >
          <option value="">{C.categoryNone}</option>
          {(categories.data ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium" id={`${uid}-sale`}>
          {C.saleMode}
        </span>
        <Segmented
          label={C.saleMode}
          value={v.sale_mode ?? 'unit'}
          onChange={(m) => {
            setValue('sale_mode', m, { shouldValidate: formState.isSubmitted });
            // Satuan default per cara jual: kemasan per g, timbang harga per kg (wireframe S-15).
            setValue('content_unit', m === 'weight' ? 'kg' : 'g');
          }}
          options={[
            { value: 'unit', label: C.saleUnit },
            { value: 'weight', label: C.saleWeight },
          ]}
        />
        {v.sale_mode === 'unit' ? (
          <div className="flex items-end gap-2">
            <div className="flex w-20 flex-col gap-1">
              <Label htmlFor={`${uid}-pack`}>{C.packCount}</Label>
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
              <Label htmlFor={`${uid}-size`}>{C.contentSize}</Label>
              <Input
                id={`${uid}-size`}
                inputMode="decimal"
                aria-invalid={Boolean(errors.content_size)}
                aria-describedby={errors.content_size ? err('size') : undefined}
                {...register('content_size')}
              />
            </div>
            <div className="flex w-24 flex-col gap-1">
              <Label htmlFor={`${uid}-unit`}>{C.contentUnit}</Label>
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
            <Label htmlFor={`${uid}-wunit`}>{C.weightUnit}</Label>
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
        <FieldError id={err('size')} message={errors.content_size?.message ?? errors.pack_count?.message} />
      </div>

      <section
        aria-label={C.preview}
        className="flex flex-col gap-1 rounded-lg bg-muted p-3 text-sm"
        data-testid="preview"
      >
        <Preview v={v} />
      </section>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">{C.barcodes}</legend>
        {v.sale_mode === 'weight' ? <p className="text-sm text-muted-foreground">{C.pluHelp}</p> : null}
        {barcodes.fields.map((f, i) => {
          const plu = codeType(v, v.barcodes?.[i] ?? {}) === 'plu';
          return (
            <div key={f.id} className="flex flex-col gap-1">
              {v.sale_mode === 'weight' ? (
                <div className="flex gap-2">
                  <label htmlFor={`${uid}-bt-${i}`} className="sr-only">
                    {fill(C.codeType, { n: i + 1 })}
                  </label>
                  <select
                    id={`${uid}-bt-${i}`}
                    className="h-touch rounded-lg border border-border bg-surface px-2"
                    {...register(`barcodes.${i}.code_type` as const)}
                  >
                    <option value="gtin">{C.gtin}</option>
                    <option value="plu">{C.plu}</option>
                  </select>
                  {plu ? (
                    <>
                      <label htmlFor={`${uid}-bs-${i}`} className="sr-only">
                        {fill(C.pluStore, { n: i + 1 })}
                      </label>
                      <select
                        id={`${uid}-bs-${i}`}
                        className="h-touch flex-1 rounded-lg border border-border bg-surface px-2"
                        aria-invalid={Boolean(errors.barcodes?.[i]?.store_id)}
                        {...register(`barcodes.${i}.store_id` as const)}
                      >
                        <option value="">{C.pluStorePick}</option>
                        {(stores.data ?? []).map((st) => (
                          <option key={st.id} value={st.id}>
                            {st.name}
                          </option>
                        ))}
                      </select>
                    </>
                  ) : null}
                </div>
              ) : null}
              <div className="flex items-center gap-2">
                <label htmlFor={`${uid}-bc-${i}`} className="sr-only">
                  {fill(C.barcodeLabel, { n: i + 1 })}
                </label>
                <Input
                  id={`${uid}-bc-${i}`}
                  inputMode="numeric"
                  autoComplete="off"
                  aria-invalid={Boolean(errors.barcodes?.[i]?.code)}
                  aria-describedby={errors.barcodes?.[i]?.code ? err(`bc-${i}`) : undefined}
                  {...register(`barcodes.${i}.code` as const)}
                />
                {barcodes.fields.length > 1 ? (
                  <Button variant="ghost" size="icon" onClick={() => barcodes.remove(i)}>
                    <Trash2 aria-hidden />
                    <span className="sr-only">{fill(C.barcodeRemove, { n: i + 1 })}</span>
                  </Button>
                ) : null}
              </div>
              <FieldError
                id={err(`bc-${i}`)}
                message={errors.barcodes?.[i]?.code?.message ?? errors.barcodes?.[i]?.store_id?.message}
              />
            </div>
          );
        })}
        <Button variant="ghost" className="self-start" onClick={() => barcodes.append({ code: '' })}>
          <Plus aria-hidden />
          {C.barcodeAdd}
        </Button>
      </fieldset>

      {serverError ? (
        <p role="alert" className="rounded-lg border border-danger p-3 text-sm" data-testid="product-error">
          {serverError}
        </p>
      ) : null}

      <div className={cn('flex gap-2', onCancel ? '' : 'flex-col')}>
        {onCancel ? (
          <Button variant="secondary" size="action" className="flex-1" onClick={onCancel}>
            {C.cancel}
          </Button>
        ) : null}
        <Button type="submit" size="action" className="flex-1" disabled={create.isPending}>
          {create.isPending ? C.saving : C.save}
        </Button>
      </div>
    </form>
  );
}
