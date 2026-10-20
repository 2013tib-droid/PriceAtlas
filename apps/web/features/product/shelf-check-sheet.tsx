'use client';
// S-03b Cek harga rak (sheet, ?sheet=cek-harga): keypad besar di setengah bawah, hasil langsung
// saat mengetik. Tidak menulis data (D-55). Produk timbang: input harga per content_unit.
import type { CompareSizesRow, ProductDetail } from '@priceatlas/contracts';
import { Camera, Delete } from 'lucide-react';
import Link from 'next/link';
import { useState, type KeyboardEvent } from 'react';
import { BasisLabel, PriceText, storeText, UnitPrice } from '@/components/price/price';
import { ShortPrice } from '@/components/product/main-price';
import { Button } from '@/components/ui/button';
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from '@/components/ui/drawer';
import { fill, PRICE_COPY, SHELF_COPY } from '@/lib/copy/id';
import { formatPercent, formatRupiah, formatSize, formatTransactionDate, formatUnitPrice } from '@/lib/format';
import { displayUnitPrice } from '@/lib/format/unit';
import { useTimeZone } from '@/lib/hooks/use-time-zone';
import { checkShelfPrice, keypadInput } from '@/lib/shelf';
import { cn } from '@/lib/utils';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '000', '0', 'back'] as const;
const UNIT_WORD: Record<string, string> = { g: 'gram', ml: 'ml', pcs: 'buah', m: 'meter' };

function ShelfResultView({
  detail,
  price,
  nearPct,
  sizes,
}: {
  detail: ProductDetail;
  price: number;
  nearPct: number;
  sizes?: readonly CompareSizesRow[];
}) {
  const tz = useTimeZone();
  const r = checkShelfPrice({ detail, price, nearPct, sizes });
  if (!r) return null;
  const p = detail.card.product;
  return (
    <div className="flex flex-col gap-2 text-base" data-testid="shelf-result">
      <p>
        → <UnitPrice product={p} value={r.unit} className="font-semibold" />
        {p.sale_mode === 'weight' ? (
          <span className="text-sm text-muted-foreground"> ({formatUnitPrice(r.unit, p.base_unit)})</span>
        ) : null}
      </p>
      {r.best ? (
        <p className={cn('font-semibold', r.best.verdict === 'pricier' ? 'text-danger' : 'text-success')}>
          {r.best.verdict === 'cheaper'
            ? r.best.window === '90d'
              ? SHELF_COPY.cheaper
              : SHELF_COPY.cheaperAll
            : r.best.verdict === 'near'
              ? SHELF_COPY.near
              : fill(r.best.window === '90d' ? SHELF_COPY.pricier : SHELF_COPY.pricierAll, {
                  pct: formatPercent(r.best.pct),
                })}
        </p>
      ) : (
        <p className="text-muted-foreground">{SHELF_COPY.noComparison}</p>
      )}
      {r.best ? (
        <p className="flex flex-wrap items-baseline gap-x-1.5 text-sm text-muted-foreground">
          <span>{r.best.window === '90d' ? PRICE_COPY.best90 : PRICE_COPY.bestAll}:</span>
          <ShortPrice product={p} point={r.best.point} />
          <BasisLabel basis={r.best.point.price_basis} program={r.best.point.member_program_name} />
          <span>
            {storeText(r.best.point.store, r.best.point.branch)} · {formatTransactionDate(r.best.point.date, tz)}
          </span>
        </p>
      ) : null}
      {r.last ? (
        <p className="text-sm">
          {r.last.pct > 0
            ? fill(SHELF_COPY.vsLastPricier, { pct: formatPercent(r.last.pct) })
            : r.last.pct < 0
              ? fill(SHELF_COPY.vsLastCheaper, { pct: formatPercent(r.last.pct) })
              : SHELF_COPY.vsLastSame}{' '}
          <span className="text-muted-foreground">
            ({formatRupiah(r.last.price)}
            {r.last.record ? ` · ${r.last.record.store.name} · ${formatTransactionDate(r.last.record.date, tz)}` : ''})
          </span>
        </p>
      ) : null}
      {r.otherSize && r.otherSize.row.unit_price != null ? (
        <p className="text-sm">
          {fill(SHELF_COPY.otherSize, {
            size: formatSize(r.otherSize.row.product),
            price: formatUnitPrice(
              displayUnitPrice(p, r.otherSize.row.unit_price).value,
              displayUnitPrice(p, r.otherSize.row.unit_price).unit,
            ),
            pct: formatPercent(r.otherSize.savingPct),
            unit: UNIT_WORD[p.base_unit] ?? p.base_unit,
          })}
        </p>
      ) : null}
    </div>
  );
}

export function ShelfCheckSheet({
  open,
  onOpenChange,
  detail,
  sizes,
  nearPct,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  detail: ProductDetail;
  sizes?: readonly CompareSizesRow[];
  nearPct: number;
}) {
  const [digits, setDigits] = useState('');
  const price = digits ? Number(digits) : 0;
  const p = detail.card.product;
  const label =
    p.sale_mode === 'weight' ? fill(SHELF_COPY.inputLabelWeight, { unit: p.content_unit }) : SHELF_COPY.inputLabel;
  const press = (key: string) => setDigits((d) => keypadInput(d, key));
  // §10.1: keypad juga menerima ketikan angka di desktop.
  const onKeyDown = (e: KeyboardEvent) => {
    if (/^\d$/.test(e.key)) press(e.key);
    else if (e.key === 'Backspace') press('back');
    else if (e.key === 'Escape') return;
    else return;
    e.preventDefault();
  };

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent onKeyDown={onKeyDown} aria-describedby="cek-harga-desc">
        <div className="flex flex-col gap-3 overflow-y-auto p-4">
          <DrawerTitle>{SHELF_COPY.title}</DrawerTitle>
          <DrawerDescription id="cek-harga-desc">{SHELF_COPY.description}</DrawerDescription>
          <p className="flex items-baseline justify-between gap-2">
            <span className="text-sm text-muted-foreground" id="harga-rak-label">
              {label}
            </span>
            <output aria-labelledby="harga-rak-label" className="text-3xl font-bold tabular-nums">
              {price ? <PriceText value={price} /> : SHELF_COPY.placeholder}
            </output>
          </p>
          <div aria-live="polite" className="min-h-24">
            {price > 0 ? <ShelfResultView detail={detail} price={price} nearPct={nearPct} sizes={sizes} /> : null}
          </div>
          <div className="grid grid-cols-3 gap-2">
            {KEYS.map((k) => (
              <Button
                key={k}
                variant="secondary"
                className="h-14 text-xl"
                onClick={() => press(k)}
                aria-label={k === 'back' ? SHELF_COPY.backspace : k}
              >
                {k === 'back' ? <Delete aria-hidden /> : k}
              </Button>
            ))}
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" className="flex-1" onClick={() => press('clear')} disabled={!digits}>
              {SHELF_COPY.clear}
            </Button>
            <Button asChild variant="secondary" className="flex-1">
              <Link href="/kamera?jenis=label">
                <Camera aria-hidden />
                {SHELF_COPY.saveLabel}
              </Link>
            </Button>
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
