'use client';
// Barcode & PLU di S-15 edit (D-89, Q-85, F-69, F-55): REST `barcode_assignment` dibaca untuk produk
// ini lalu kode baru ditambahkan (insert, id dari klien). PLU hanya untuk produk timbang dan wajib toko
// (check constraint). Tanpa ubah/hapus di MVP. Terpisah dari form produk: menambah kode tidak
// mengubah `product.updated_at` dan tidak menunggu tombol "Simpan perubahan".
import { zodResolver } from '@hookform/resolvers/zod';
import { useId, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { toast } from 'sonner';
import { ErrorState } from '@/components/app/screen-state';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
  alreadyListed,
  barcodeError,
  barcodeFormSchema,
  defaultBarcodeForm,
  sortBarcodes,
  toBarcodeInsert,
  type BarcodeFormValues,
} from '@/lib/catalog/barcodes';
import { CATALOG_COPY, fill, NEW_PRODUCT_COPY as N } from '@/lib/copy/id';
import { useLocationNames, useStores } from '@/lib/data/confirm';
import { toAppError } from '@/lib/data/errors';
import { useAddBarcode, useBarcodes } from '@/lib/data/settings';
import { formatDateAbsolute } from '@/lib/format/date';
import { newCaptureId } from '@/lib/media/capture-id';

const B = CATALOG_COPY.barcodes;

export function BarcodeSection({ productId, saleMode }: { productId: string; saleMode: 'unit' | 'weight' }) {
  const uid = useId();
  const list = useBarcodes(productId);
  const add = useAddBarcode();
  const weight = saleMode === 'weight';
  const stores = useStores('', weight);
  const rows = sortBarcodes(list.data ?? []);
  const names = useLocationNames(
    rows.flatMap((r) => (r.store_id ? [r.store_id] : [])),
    [],
  );
  // Id insert tetap sampai berhasil: kiriman ulang setelah gagal jaringan = 23505 = sukses.
  const [insertId, setInsertId] = useState(newCaptureId);
  const [serverError, setServerError] = useState<string | null>(null);
  const form = useForm<BarcodeFormValues>({
    resolver: zodResolver(barcodeFormSchema),
    defaultValues: defaultBarcodeForm(saleMode),
  });
  const { register, control, handleSubmit, setError, reset, formState } = form;
  const v = useWatch({ control }) as BarcodeFormValues;
  const errors = formState.errors;
  const plu = v.code_type === 'plu';

  const submit = handleSubmit((values) => {
    setServerError(null);
    if (alreadyListed(values, rows)) return setError('code', { message: B.already });
    const row = toBarcodeInsert(values, productId, insertId);
    add.mutate(row, {
      onSuccess: () => {
        toast.success(fill(B.added, { code: row.code }));
        setInsertId(newCaptureId());
        reset({ ...defaultBarcodeForm(saleMode), code_type: values.code_type, store_id: values.store_id });
      },
      onError: (e) => {
        const r = barcodeError(e);
        if (r.field) setError(r.field, { message: r.message });
        else setServerError(r.message);
        // Ditolak server (bukan jaringan): kiriman berikutnya adalah kode lain → id baru.
        if (toAppError(e).kind !== 'network') setInsertId(newCaptureId());
      },
    });
  });

  return (
    <section
      aria-labelledby={`${uid}-title`}
      className="flex flex-col gap-3 rounded-lg border border-border p-3"
      data-testid="barcodes"
    >
      <h2 id={`${uid}-title`} className="text-base font-semibold">
        {B.title}
      </h2>
      {list.isError ? (
        <ErrorState error={list.error} compact onRetry={() => void list.refetch()} />
      ) : !list.data ? (
        <Skeleton className="h-6 w-1/2" />
      ) : rows.length ? (
        <ul className="flex flex-col gap-1" data-testid="barcode-list">
          {rows.map((r) => (
            <li key={r.id} className="text-base">
              <span className="font-mono">{r.code}</span>
              <span className="text-sm text-muted-foreground">
                {' · '}
                {r.code_type === 'plu' ? fill(B.pluAt, { store: names.store(r.store_id)?.name ?? '…' }) : N.gtin}
                {' · '}
                {r.valid_until
                  ? fill(B.ended, { date: formatDateAbsolute(r.valid_until) })
                  : fill(B.since, { date: formatDateAbsolute(r.valid_from) })}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">{B.none}</p>
      )}

      <form onSubmit={submit} noValidate className="flex flex-col gap-2">
        {weight ? (
          <div className="flex flex-col gap-1">
            <Label htmlFor={`${uid}-type`}>{B.type}</Label>
            <select
              id={`${uid}-type`}
              className="h-touch rounded-lg border border-border bg-surface px-3"
              {...register('code_type')}
            >
              <option value="plu">{N.plu}</option>
              <option value="gtin">{N.gtin}</option>
            </select>
            <p className="text-sm text-muted-foreground">{N.pluHelp}</p>
          </div>
        ) : null}
        {plu ? (
          <div className="flex flex-col gap-1">
            <Label htmlFor={`${uid}-store`}>{B.store}</Label>
            <select
              id={`${uid}-store`}
              className="h-touch rounded-lg border border-border bg-surface px-3"
              aria-invalid={Boolean(errors.store_id)}
              {...register('store_id')}
            >
              <option value="">{N.pluStorePick}</option>
              {(stores.data ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                  {s.household_id ? ' · PRIBADI' : ''}
                </option>
              ))}
            </select>
            {errors.store_id ? (
              <p role="alert" className="text-sm text-danger">
                {errors.store_id.message}
              </p>
            ) : null}
          </div>
        ) : null}
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${uid}-code`}>{B.code}</Label>
          <Input
            id={`${uid}-code`}
            inputMode="numeric"
            autoComplete="off"
            aria-invalid={Boolean(errors.code)}
            {...register('code')}
          />
          {errors.code ? (
            <p role="alert" className="text-sm text-danger">
              {errors.code.message}
            </p>
          ) : null}
        </div>
        {serverError ? (
          <p role="alert" className="text-sm text-danger">
            {serverError}
          </p>
        ) : null}
        <Button
          type="submit"
          variant="secondary"
          className="self-start"
          disabled={add.isPending}
          data-testid="barcode-add"
        >
          {add.isPending ? B.adding : B.add}
        </Button>
        <p className="text-sm text-muted-foreground">{B.note}</p>
      </form>
    </section>
  );
}
