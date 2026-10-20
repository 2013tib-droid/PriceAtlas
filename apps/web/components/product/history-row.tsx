'use client';
// Baris histori `price_record_view` (S-03; dipakai juga S-16/S-18 nanti, docs/07 §7.2).
import type { PriceRecordView } from '@priceatlas/contracts';
import { BasisLabel, PriceLabel, PriceText, storeText, UnitPrice } from '@/components/price/price';
import { fill, PRICE_COPY, PRODUCT_COPY } from '@/lib/copy/id';
import { formatQuantity, formatRupiah, formatTransactionDate } from '@/lib/format';
import type { UnitProduct } from '@/lib/format/unit';
import { useTimeZone } from '@/lib/hooks/use-time-zone';
import { cn } from '@/lib/utils';

export function HistoryRow({ record: r, product }: { record: PriceRecordView; product: UnitProduct }) {
  const tz = useTimeZone();
  const weight = product.sale_mode === 'weight';
  const muted = r.is_bundle || r.status === 'void';
  const shipping = typeof r.extra.shipping_fee === 'number' ? r.extra.shipping_fee : null;
  return (
    <li
      data-testid="history-row"
      className={cn('flex flex-col gap-0.5 border-b border-divider py-2', muted && 'text-muted-foreground')}
    >
      <span className="flex flex-wrap items-baseline justify-between gap-x-2 text-sm">
        <span>
          {formatTransactionDate(r.transaction_date, tz)} · {PRODUCT_COPY.source[r.source_type]}
        </span>
        <span>
          {storeText({ name: r.store_name }, r.branch_name ? { name: r.branch_name, status: r.branch_status } : null)}
        </span>
      </span>
      <span className={cn('flex flex-wrap items-baseline gap-x-2 gap-y-1', r.status === 'void' && 'line-through')}>
        {weight ? (
          <UnitPrice product={product} value={r.unit_price} className="font-semibold" />
        ) : (
          <PriceText value={r.effective_price} className="font-semibold" />
        )}
        <BasisLabel basis={r.price_basis} program={r.member_program_name} promoMinQty={r.promo_min_qty} />
        {weight ? null : <UnitPrice product={product} value={r.unit_price} className="text-sm" />}
        {r.price_basis !== 'normal' && r.normal_price != null ? (
          <span className="text-sm text-muted-foreground">
            {fill(PRODUCT_COPY.normalWas, { price: formatRupiah(r.normal_price) })}
          </span>
        ) : null}
      </span>
      <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        {weight && r.actual_weight != null ? (
          <span>
            {formatQuantity(r.actual_weight, product.content_unit)} ·{' '}
            {formatRupiah(r.actual_weight * r.effective_price)}
          </span>
        ) : null}
        {!weight && r.quantity > 1 ? (
          <span>{fill(PRODUCT_COPY.quantity, { qty: r.quantity, price: formatRupiah(r.effective_price) })}</span>
        ) : null}
        {r.member_not_counted && r.member_price != null ? (
          <PriceLabel tone="muted">
            {fill(PRICE_COPY.memberNotCountedPrice, { price: formatRupiah(r.member_price) })}
          </PriceLabel>
        ) : null}
        {r.is_bundle ? <PriceLabel tone="muted">{PRICE_COPY.bundle}</PriceLabel> : null}
        {r.status === 'void' ? <PriceLabel tone="muted">{PRODUCT_COPY.voided}</PriceLabel> : null}
        {shipping != null ? <span>{fill(PRODUCT_COPY.shipping, { price: formatRupiah(shipping) })}</span> : null}
        {r.store_channel === 'online' ? <span>{PRICE_COPY.online}</span> : null}
      </span>
    </li>
  );
}
