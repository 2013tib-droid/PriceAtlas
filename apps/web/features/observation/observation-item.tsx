'use client';
// Satu item S-11 (wireframe S-11): crop dari region (signed URL, P-14), produk + "ragu" + Ganti,
// editor harga normal/promo/member + promo kuantitas, "Dihitung untukmu" dari computed R16 (D-26,
// live), harga member belum berlaku + "Saya member" (D-27, D-41), promo berakhir, lokasi (→ S-12),
// tanggal, bundle (D-08), screenshot: judul listing, ongkir/voucher sebagai info (D-36, D-66).
import type { CaptureItem, MyProgram } from '@priceatlas/contracts';
import { useEffect, useId, useState, type ReactNode } from 'react';
import { BasisLabel, PriceLabel, PriceText, PrivateBadge, UnitPrice } from '@/components/price/price';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import type { ItemPatch } from '@/lib/confirm/item-patch';
import { isDoubtfulMatch } from '@/lib/confirm/receipt';
import { sizeMismatch } from '@/lib/confirm/size';
import { CONFIRM_COPY, fill, ITEMS_COPY as C, PRICE_COPY } from '@/lib/copy/id';
import { useSignedUrl } from '@/lib/data/captures';
import { formatRupiah, formatSize, formatTransactionDate, parsePrice } from '@/lib/format';
import { productTitle } from '@/lib/format/product';
import { cn } from '@/lib/utils';

type Region = NonNullable<CaptureItem['region']>;

/** Potongan gambar sesuai region (fraksi 0–1) tanpa canvas: img diperbesar dan digeser di wadah. */
export function CropImage({ path, region, label }: { path: string | null; region: Region | null; label: string }) {
  const url = useSignedUrl(path);
  const [ratio, setRatio] = useState<number | null>(null);
  if (!path) return <p className="rounded-lg bg-muted p-3 text-sm">{C.cropMissing}</p>;
  if (!url.data) return <Skeleton className="h-28 w-full" aria-label={label} />;
  const r = region ?? { x: 0, y: 0, w: 1, h: 1 };
  return (
    <div
      className="relative w-full overflow-hidden rounded-lg bg-muted"
      style={{ aspectRatio: ratio ? String(ratio) : '3 / 1' }}
      data-testid="item-crop"
      role="img"
      aria-label={label}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- signed URL Storage, tidak lewat optimizer */}
      <img
        src={url.data}
        alt=""
        onLoad={(e) => {
          const img = e.currentTarget;
          if (img.naturalWidth && img.naturalHeight) setRatio((r.w * img.naturalWidth) / (r.h * img.naturalHeight));
        }}
        className="absolute max-w-none"
        style={{
          width: `${100 / r.w}%`,
          height: `${100 / r.h}%`,
          left: `${(-r.x / r.w) * 100}%`,
          top: `${(-r.y / r.h) * 100}%`,
        }}
      />
    </div>
  );
}

type PriceField = 'normal_price' | 'promo_price' | 'member_price';

const toText = (v: number | null | undefined) => (v == null ? '' : String(v));
export { parsePrice };

function PriceInput({
  id,
  label,
  value,
  onChange,
  describedBy,
  invalid,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (s: string) => void;
  describedBy?: string;
  invalid?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <span
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground"
        >
          {C.rupiah}
        </span>
        <Input
          id={id}
          inputMode="numeric"
          autoComplete="off"
          value={value}
          aria-invalid={invalid}
          aria-describedby={describedBy}
          onChange={(e) => onChange(e.target.value)}
          className="pl-10 tabular-nums"
        />
      </div>
    </div>
  );
}

export interface ItemLocation {
  storeName: string | null;
  branchName: string | null;
  fromSession: boolean;
  online: boolean;
}

export function ObservationItem({
  item,
  index,
  total,
  kind,
  tau,
  timeZone,
  imagePath,
  location,
  programs,
  computing,
  rejected,
  focusNormal,
  onPatch,
  onReplace,
  onCreate,
  onReject,
  onPickLocation,
  onMember,
  memberPending,
  memberMarked,
}: {
  item: CaptureItem;
  index: number;
  total: number;
  kind: 'price_label' | 'marketplace';
  tau: number;
  timeZone: string;
  imagePath: string | null;
  location: ItemLocation;
  programs: readonly MyProgram[];
  computing: boolean;
  rejected: boolean;
  focusNormal: boolean;
  onPatch: (patch: ItemPatch) => void;
  onReplace: () => void;
  onCreate: () => void;
  onReject: (v: boolean) => void;
  onPickLocation: () => void;
  onMember: (programId: string) => void;
  memberPending: boolean;
  memberMarked: boolean;
}) {
  const uid = useId();
  const pending = item.status === 'pending';
  const p = item.suggestion;
  // Teks yang diketik user ditampilkan selama ada; selain itu nilai server (W18 / muat ulang).
  const [edits, setEdits] = useState<Partial<Record<PriceField, string>>>({});
  const text = (f: PriceField) => edits[f] ?? toText(item[f]);
  useEffect(() => {
    if (focusNormal) document.getElementById(`${uid}-normal`)?.focus();
  }, [focusNormal, uid]);

  const setPrice = (f: PriceField, s: string) => {
    setEdits((t) => ({ ...t, [f]: s }));
    onPatch({ [f]: parsePrice(s) } as ItemPatch);
  };

  const c = item.computed;
  const program = programs.find((x) => x.program_id === item.member_program_id);
  const storePrograms = programs.filter(
    (x) => x.status === 'active' && (!item.store_id || x.store.id === item.store_id),
  );
  const mismatchText = kind === 'marketplace' ? (item.extra.listing_title ?? item.raw_text) : item.raw_text;
  const mismatch = sizeMismatch(mismatchText, p);
  const doubtful = p
    ? isDoubtfulMatch(item.match_confidence, tau) || (item.field_confidence?.product ?? 1) < tau
    : false;
  const promoEnded =
    item.promo_price != null &&
    c?.price_basis === 'normal' &&
    ((item.promo_valid_until && item.transaction_date > item.promo_valid_until) ||
      (item.promo_valid_from && item.transaction_date < item.promo_valid_from));
  const heading = total > 1 ? fill(C.itemHeading, { i: index + 1, n: total }) : null;

  let computedLine: ReactNode;
  if (pending && computing) computedLine = <span className="text-muted-foreground">{C.computing}</span>;
  else if (!c || c.reason === 'no_applicable_price' || c.effective_price == null)
    computedLine = <span className="text-danger">{C.noApplicable}</span>;
  else
    computedLine = (
      <span className="flex flex-wrap items-baseline gap-x-2">
        <span>{C.computed}</span>
        <PriceText value={c.effective_price} className="text-lg font-bold" />
        {c.price_basis ? (
          <BasisLabel
            basis={c.price_basis}
            program={c.price_basis === 'member' ? program?.program_name : null}
            promoMinQty={c.price_basis === 'promo' ? item.promo_min_qty : null}
          />
        ) : null}
        {p && c.unit_price != null ? <UnitPrice product={p} value={c.unit_price} className="text-sm" /> : null}
      </span>
    );

  return (
    <article
      id={`item-${item.id}`}
      tabIndex={-1}
      aria-label={heading ?? undefined}
      data-testid="observation-item"
      data-status={rejected ? 'rejected' : item.status}
      className={cn('flex flex-col gap-3 rounded-lg border border-divider p-3', rejected && 'opacity-70')}
    >
      {total > 1 ? (
        <p className="text-sm font-semibold text-muted-foreground" aria-hidden>
          {fill(C.counter, { i: index + 1, n: total })}
        </p>
      ) : null}
      {kind === 'price_label' || item.region ? (
        <CropImage path={imagePath} region={item.region} label={fill(C.crop, { i: index + 1 })} />
      ) : null}

      {kind === 'marketplace' && item.extra.listing_title ? (
        <p className="text-sm">
          <span className="text-muted-foreground">{C.listingTitle}: </span>&quot;{item.extra.listing_title}&quot;
        </p>
      ) : item.raw_text ? (
        <p className="font-mono text-sm">&quot;{item.raw_text}&quot;</p>
      ) : null}

      <div className="flex items-start justify-between gap-2">
        {p ? (
          <p className="font-semibold">
            → {productTitle(p).title} <span className="font-normal">{productTitle(p).size}</span>?
            {doubtful ? (
              <PriceLabel tone="muted" className="ml-1">
                {CONFIRM_COPY.doubt}
              </PriceLabel>
            ) : null}
            {p.is_private ? <PrivateBadge /> : null}
          </p>
        ) : (
          <p className="font-semibold" data-testid="no-product">
            {C.noProduct}
          </p>
        )}
        {pending && !rejected && p ? (
          <Button variant="secondary" onClick={onReplace}>
            {C.replace}
          </Button>
        ) : null}
      </div>
      {mismatch && p ? (
        <p className="rounded-lg bg-warning p-2 text-sm text-warning-foreground" data-testid="size-mismatch">
          {fill(kind === 'marketplace' ? C.sizeMismatch : C.sizeMismatchLabel, { text: mismatch, size: formatSize(p) })}
        </p>
      ) : null}
      {pending && !rejected && !p ? (
        <div className="flex flex-wrap gap-2">
          <Button onClick={onReplace}>{C.pickProduct}</Button>
          <Button variant="secondary" onClick={onCreate}>
            {C.createProduct}
          </Button>
        </div>
      ) : null}

      {kind === 'marketplace' ? (
        <p className="text-sm">
          {location.storeName ?? C.locationUnknown}
          {item.seller_name || location.branchName
            ? ` · ${fill(C.seller, { name: location.branchName ?? item.seller_name ?? '' })}`
            : ''}
        </p>
      ) : null}

      {pending && !rejected ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <PriceInput
            id={`${uid}-normal`}
            label={C.normal}
            value={text('normal_price')}
            onChange={(s) => setPrice('normal_price', s)}
            invalid={focusNormal}
          />
          <PriceInput
            id={`${uid}-promo`}
            label={C.promo}
            value={text('promo_price')}
            onChange={(s) => setPrice('promo_price', s)}
          />
          {item.promo_price != null ? (
            <>
              <div className="flex flex-col gap-1">
                <Label htmlFor={`${uid}-qty`}>{C.promoMinQty}</Label>
                <Input
                  id={`${uid}-qty`}
                  inputMode="numeric"
                  defaultValue={toText(item.promo_min_qty)}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    onPatch({ promo_min_qty: e.target.value && Number.isInteger(n) && n >= 2 ? n : null });
                  }}
                />
              </div>
              <div className="flex gap-2">
                <div className="flex flex-1 flex-col gap-1">
                  <Label htmlFor={`${uid}-from`}>{C.promoFrom}</Label>
                  <Input
                    id={`${uid}-from`}
                    type="date"
                    defaultValue={item.promo_valid_from ?? ''}
                    onChange={(e) => onPatch({ promo_valid_from: e.target.value || null })}
                  />
                </div>
                <div className="flex flex-1 flex-col gap-1">
                  <Label htmlFor={`${uid}-until`}>{C.promoUntil}</Label>
                  <Input
                    id={`${uid}-until`}
                    type="date"
                    defaultValue={item.promo_valid_until ?? ''}
                    onChange={(e) => onPatch({ promo_valid_until: e.target.value || null })}
                  />
                </div>
              </div>
            </>
          ) : null}
          <PriceInput
            id={`${uid}-member`}
            label={C.member}
            value={text('member_price')}
            onChange={(s) => setPrice('member_price', s)}
          />
          {item.member_price != null ? (
            <div className="flex flex-col gap-1">
              <Label htmlFor={`${uid}-program`}>{C.memberProgram}</Label>
              <select
                id={`${uid}-program`}
                className="h-touch rounded-lg border border-border bg-surface px-3"
                value={item.member_program_id ?? ''}
                onChange={(e) => onPatch({ member_program_id: e.target.value || null })}
              >
                <option value="">{C.memberNoProgram}</option>
                {storePrograms.map((x) => (
                  <option key={x.program_id} value={x.program_id}>
                    {x.store.name} · {x.program_name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
        </div>
      ) : null}

      {item.promo_price != null && item.promo_min_qty && !pending ? (
        <p className="text-sm">
          {fill(C.promoQtyText, { price: formatRupiah(item.promo_price), n: item.promo_min_qty })}
        </p>
      ) : null}

      {rejected ? null : (
        <div className="flex flex-col gap-1 rounded-lg bg-muted p-3" data-testid="computed" aria-live="polite">
          {computedLine}
          {item.member_price != null && c?.member_eligible === false && !memberMarked ? (
            <p className="flex flex-wrap items-center gap-2 text-sm">
              {program ? fill(C.memberNotCounted, { program: program.program_name }) : C.memberNotCountedGeneric}
              {pending && item.member_program_id ? (
                <Button variant="secondary" onClick={() => onMember(item.member_program_id!)} disabled={memberPending}>
                  {C.iAmMember}
                </Button>
              ) : null}
            </p>
          ) : null}
          {memberMarked ? <p className="text-sm">{C.memberMarked}</p> : null}
          {promoEnded ? <p className="text-sm">{C.promoEnded}</p> : null}
          {item.extra.member_note ? (
            <p className="text-sm">{fill(C.memberNote, { note: item.extra.member_note })}</p>
          ) : null}
        </div>
      )}

      {kind === 'marketplace' &&
      (item.extra.shipping_fee != null ||
        item.extra.shop_voucher != null ||
        item.extra.cashback != null ||
        item.extra.points != null) ? (
        <p className="text-sm" data-testid="marketplace-extra">
          {[
            item.extra.shipping_fee != null
              ? fill(C.shipping, { amount: formatRupiah(item.extra.shipping_fee) })
              : null,
            item.extra.shop_voucher != null
              ? fill(C.shopVoucher, { amount: formatRupiah(-item.extra.shop_voucher) })
              : null,
            item.extra.cashback != null ? fill(C.cashback, { amount: formatRupiah(item.extra.cashback) }) : null,
            item.extra.points != null ? fill(C.points, { n: item.extra.points }) : null,
          ]
            .filter(Boolean)
            .join(' · ')}{' '}
          <span className="text-muted-foreground">{C.extraInfo}</span>
        </p>
      ) : null}
      {kind === 'marketplace' ? <p className="text-sm text-muted-foreground">{PRICE_COPY.onlineLong}</p> : null}

      {kind === 'price_label' || !location.storeName ? (
        <div className="flex items-center justify-between gap-2 text-sm">
          <p>
            <span className="text-muted-foreground">{C.location}: </span>
            {location.storeName ? (
              <>
                {location.fromSession ? fill(C.locationFromSession, { loc: location.storeName }) : location.storeName}
                {' · '}
                {location.branchName ?? PRICE_COPY.noBranch}
              </>
            ) : location.fromSession ? (
              C.sessionLocation
            ) : (
              <span className="font-medium text-danger" data-testid="store-missing">
                {C.locationUnknown}
              </span>
            )}
          </p>
          {pending && !rejected ? (
            <Button variant="secondary" onClick={onPickLocation}>
              {location.storeName && !location.branchName ? C.pickBranch : C.change}
            </Button>
          ) : null}
        </div>
      ) : null}

      <div className="flex items-center justify-between gap-2 text-sm">
        <Label htmlFor={`${uid}-date`}>
          <span className="text-muted-foreground">{C.date}: </span>
          {formatTransactionDate(item.transaction_date, timeZone)}
        </Label>
        {pending && !rejected ? (
          <Input
            id={`${uid}-date`}
            type="date"
            className="w-40"
            defaultValue={item.transaction_date}
            onChange={(e) => e.target.value && onPatch({ transaction_date: e.target.value })}
          />
        ) : null}
      </div>

      {pending && !rejected ? (
        <label className="flex min-h-touch items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-5"
            checked={item.is_bundle}
            onChange={(e) => onPatch({ is_bundle: e.target.checked })}
          />
          {C.bundle}
        </label>
      ) : null}
      {item.is_bundle ? <p className="text-sm text-muted-foreground">{C.bundleNote}</p> : null}

      {item.status === 'accepted' ? (
        <p className="font-semibold" data-testid="item-accepted">
          {C.accepted}
        </p>
      ) : item.status === 'rejected' ? (
        <p className="font-semibold">{C.rejected}</p>
      ) : (
        <Button variant="ghost" className="self-start" onClick={() => onReject(!rejected)}>
          {rejected ? C.undoReject : kind === 'marketplace' ? C.rejectScreenshot : C.reject}
        </Button>
      )}
    </article>
  );
}
