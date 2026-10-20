'use client';
// Bagian S-10 (docs/07 §7.3, wireframe S-10): DuplicateBanner, ReceiptHeader (✎), TotalsCheck, baris
// perlu dicek (Benar / Ganti / Bukan produk / ⋯ bundle / Lewati), lipatan Tersimpan otomatis / Bukan
// produk / Voucher & poin, MemberHintBox (U-21). Label selalu teks (U-15).
import type { ReceiptDetail, ReceiptLine } from '@priceatlas/contracts';
import { Check, MoreHorizontal, Pencil } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';
import { BasisLabel, PriceLabel, PriceText, PrivateBadge } from '@/components/price/price';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { attachedTotals, isDoubtfulMatch, type HeaderField, type LineDecision } from '@/lib/confirm/receipt';
import { CONFIRM_COPY, fill, PRICE_COPY, RECEIPT_COPY as C } from '@/lib/copy/id';
import { useSignedUrl } from '@/lib/data/captures';
import { formatDateAbsolute, formatQuantity, formatRupiah, formatTransactionDate, todayInZone } from '@/lib/format';
import { productTitle } from '@/lib/format/product';
import { cn } from '@/lib/utils';

export function Doubt({ show }: { show: boolean }) {
  return show ? (
    <PriceLabel tone="muted" className="ml-1">
      {CONFIRM_COPY.doubt}
    </PriceLabel>
  ) : null;
}

export const lineName = (p: { name: string; variant: string | null } & Parameters<typeof productTitle>[0]) => {
  const t = productTitle(p);
  return `${t.title} ${t.size}`;
};

// ---------------------------------------------------------------------------
export function DuplicateBanner({
  dup,
  chosen,
  onView,
  onDistinct,
  onUndo,
  onDiscard,
  pending,
}: {
  dup: NonNullable<ReceiptDetail['duplicate']>;
  chosen: 'distinct' | null;
  onView: () => void;
  onDistinct: () => void;
  onUndo: () => void;
  onDiscard: () => void;
  pending: boolean;
}) {
  const text = fill(dup.store ? C.duplicate : C.duplicateNoStore, {
    store: dup.store?.name ?? '',
    date: dup.date ? formatDateAbsolute(dup.date) : '',
    total: dup.total != null ? formatRupiah(dup.total) : '–',
  });
  return (
    <section
      id="banner-duplikat"
      tabIndex={-1}
      aria-labelledby="judul-duplikat"
      data-testid="duplicate-banner"
      data-chosen={chosen ?? ''}
      className="flex flex-col gap-3 rounded-lg border-2 border-warning-foreground bg-warning p-3 text-warning-foreground"
    >
      <p id="judul-duplikat" className="font-semibold">
        ⚠ {text}
      </p>
      {chosen === 'distinct' ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Check aria-hidden className="size-4" />
          <span>{C.duplicateChosenDistinct}</span>
          <Button variant="link" onClick={onUndo}>
            {C.duplicateUndo}
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={onView}>
            {C.duplicateView}
          </Button>
          <Button variant="secondary" onClick={onDistinct}>
            {C.duplicateDistinct}
          </Button>
          <Button variant="danger" onClick={onDiscard} disabled={pending}>
            {C.duplicateDiscard}
          </Button>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
export function ReceiptHeader({
  r,
  tz,
  doubt,
  onPickStore,
  onEdit,
  editable,
}: {
  r: ReceiptDetail;
  tz: string;
  doubt: Set<HeaderField>;
  onPickStore: () => void;
  onEdit: () => void;
  editable: boolean;
}) {
  const h = r.header;
  const time = h.transaction_time ? h.transaction_time.slice(0, 5) : null;
  const uploaded = r.uploaded_at ? formatTransactionDate(todayInZone(tz, new Date(r.uploaded_at)), tz) : null;
  return (
    <section aria-label={C.editHeaderTitle} className="flex flex-col gap-1" data-testid="receipt-header">
      <div className="flex items-start justify-between gap-2">
        {h.store ? (
          <p className="text-lg font-semibold">
            {h.store.name}
            <Doubt show={doubt.has('store')} />
            {h.store.is_private ? <PrivateBadge /> : null}
            {' · '}
            {h.branch ? (
              <span>
                {h.branch.name}
                {h.branch.status === 'closed' ? ` ${PRICE_COPY.closed}` : ''}
                <Doubt show={doubt.has('branch')} />
              </span>
            ) : (
              <span className="font-normal">
                {C.branchUnknown}
                {editable ? (
                  <>
                    {' · '}
                    <Button variant="link" className="h-auto p-0 text-base" onClick={onPickStore}>
                      {C.pickBranch}
                    </Button>
                  </>
                ) : null}
              </span>
            )}
          </p>
        ) : (
          <p className="flex flex-wrap items-center gap-2 text-lg font-semibold" data-testid="store-unknown">
            {C.storeUnknown}
            {editable ? (
              <Button variant="secondary" onClick={onPickStore}>
                {C.pickStore}
              </Button>
            ) : null}
          </p>
        )}
        {editable ? (
          <Button variant="ghost" size="icon" onClick={onEdit}>
            <Pencil aria-hidden />
            <span className="sr-only">{C.editHeader}</span>
          </Button>
        ) : null}
      </div>
      <p>
        {h.transaction_date ? (
          <span className="font-medium">
            {formatTransactionDate(h.transaction_date, tz)}
            <Doubt show={doubt.has('date')} />
          </span>
        ) : (
          <span>{C.dateMissing}</span>
        )}
        {time ? (
          <>
            {' · '}
            {time}
            <Doubt show={doubt.has('time')} />
          </>
        ) : null}
        {uploaded ? (
          <span className="text-sm text-muted-foreground"> ({fill(C.uploadedToday, { when: uploaded })})</span>
        ) : null}
      </p>
    </section>
  );
}

export function TotalsCheck({ r, doubtTotal }: { r: ReceiptDetail; doubtTotal: boolean }) {
  const t = r.totals;
  const sum = formatRupiah(t.lines_sum);
  if (t.total_amount == null) return <p className="text-sm">{fill(C.totalUnknown, { sum })}</p>;
  const total = formatRupiah(t.total_amount);
  const ok = !t.diff;
  return (
    <p
      className={cn('text-sm', ok ? '' : 'rounded-lg bg-warning p-2 text-warning-foreground')}
      data-testid="totals-check"
      data-match={ok}
      role={ok ? undefined : 'note'}
    >
      {ok
        ? fill(C.totalMatch, { total, sum })
        : fill(C.totalMismatch, { sum, total, diff: formatRupiah(Math.abs(t.diff!)) })}
      <Doubt show={doubtTotal} />
    </p>
  );
}

function ThumbImage({ path, n, total }: { path: string; n: number; total: number }) {
  const url = useSignedUrl(path);
  const label = fill(C.imagePart, { n, total });
  return (
    <li className="flex flex-col items-center gap-1">
      {url.data ? (
        <a href={url.data} target="_blank" rel="noreferrer" aria-label={`${C.viewImage} ${label}`}>
          {/* eslint-disable-next-line @next/next/no-img-element -- signed URL Storage, tidak lewat optimizer */}
          <img src={url.data} alt="" className="h-20 w-16 rounded border border-divider bg-muted object-cover" />
        </a>
      ) : (
        <Skeleton className="h-20 w-16" />
      )}
      <span className="text-xs text-muted-foreground">{label}</span>
    </li>
  );
}

export function ReceiptImages({ images }: { images: ReceiptDetail['images'] }) {
  const live = images.filter((i) => !i.purged_at);
  if (!live.length) return null;
  return (
    <section aria-label={C.images}>
      <ul className="flex gap-2 overflow-x-auto">
        {live.map((i) => (
          <ThumbImage key={i.position} path={i.storage_path} n={i.position} total={images.length} />
        ))}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------------------
/** "2 × Rp45.000 · diskon −Rp5.000 = Rp42.500" / timbang "0,535 kg × Rp45.000/kg = Rp24.075". */
export function LineAmounts({ line, weight }: { line: ReceiptLine; weight: boolean }) {
  const a = attachedTotals(line);
  const qty = line.quantity ?? 1;
  const unit = line.unit_amount ?? (qty ? line.line_amount / qty : line.line_amount);
  return (
    <p className={cn('text-sm', a.voided && 'line-through')}>
      {weight
        ? `${formatQuantity(qty, 'kg')} × ${formatRupiah(unit)}/kg = ${formatRupiah(line.line_amount)}`
        : fill(C.quantity, { qty, price: formatRupiah(unit) })}
      {a.discount ? <> · {fill(C.discount, { amount: formatRupiah(a.discount) })}</> : null}
      {a.discount || a.voided ? <> {fill(C.netPromo, { price: formatRupiah(a.net) })}</> : null}
      {a.voided ? <span className="ml-1 no-underline">({C.voided})</span> : null}
    </p>
  );
}

export function NeedsCheckRow({
  line,
  tau,
  decision,
  bundle,
  storeName,
  onDecide,
  onReplace,
  onBundle,
  onUndo,
}: {
  line: ReceiptLine;
  tau: number;
  decision: LineDecision | undefined;
  bundle: boolean;
  storeName: string | null;
  onDecide: (d: LineDecision) => void;
  onReplace: () => void;
  onBundle: (v: boolean) => void;
  onUndo: () => void;
}) {
  const [more, setMore] = useState(false);
  const moreId = useId();
  const s = line.suggestion;
  const weight = (decision?.product ?? s)?.sale_mode === 'weight';
  let decided: ReactNode = null;
  if (decision) {
    const name =
      decision.action === 'accept' && s
        ? lineName(s)
        : decision.action === 'replace' && decision.product
          ? lineName(decision.product)
          : '';
    decided = (
      <div className="flex flex-col gap-1" data-testid="line-decided" data-action={decision.action}>
        <p className="font-medium">
          <Check aria-hidden className="mr-1 inline size-4" />
          {fill(C.decided[decision.action], { name })}
          {bundle && (decision.action === 'accept' || decision.action === 'replace') ? (
            <PriceLabel tone="muted" className="ml-2">
              {C.bundleNote}
            </PriceLabel>
          ) : null}
        </p>
        {decision.action === 'accept' || decision.action === 'replace' ? (
          <p className="text-sm text-muted-foreground" data-testid="alias-learned">
            {storeName
              ? fill(CONFIRM_COPY.aliasLearned, { text: line.raw_text ?? '', store: storeName })
              : fill(CONFIRM_COPY.aliasLearnedNoStore, { text: line.raw_text ?? '' })}
          </p>
        ) : null}
        <Button variant="link" className="h-auto self-start p-0" onClick={onUndo}>
          {C.undo}
        </Button>
      </div>
    );
  }
  return (
    <li
      id={`line-${line.id}`}
      tabIndex={-1}
      data-testid="needs-check-line"
      data-line-id={line.id}
      className="flex flex-col gap-2 border-b border-divider py-3"
    >
      <p className="font-mono text-sm">&quot;{line.raw_text}&quot;</p>
      <p className="font-semibold">
        {s ? fill(C.suggestion, { name: lineName(s) }) : C.noSuggestion}
        {s ? <Doubt show={isDoubtfulMatch(line.match_confidence, tau)} /> : null}
        {s?.is_private ? <PrivateBadge /> : null}
      </p>
      <LineAmounts line={line} weight={weight} />
      {decided ?? (
        <div className="flex flex-col gap-2">
          {s ? (
            <Button size="action" onClick={() => onDecide({ action: 'accept' })}>
              {C.accept}
            </Button>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button variant={s ? 'secondary' : 'primary'} onClick={onReplace}>
              {C.replace}
            </Button>
            <Button variant="secondary" onClick={() => onDecide({ action: 'non_product' })}>
              {C.notProduct}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-expanded={more}
              aria-controls={moreId}
              onClick={() => setMore((v) => !v)}
            >
              <MoreHorizontal aria-hidden />
              <span className="sr-only">{fill(C.more, { text: line.raw_text ?? '' })}</span>
            </Button>
          </div>
          {more ? (
            <div id={moreId} className="flex flex-wrap gap-2">
              <Button variant="secondary" aria-pressed={bundle} onClick={() => onBundle(!bundle)}>
                {bundle ? C.unbundle : C.bundle}
              </Button>
              <Button variant="secondary" onClick={() => onDecide({ action: 'skip' })}>
                {C.skip}
              </Button>
            </div>
          ) : null}
          {bundle ? <p className="text-sm text-muted-foreground">{PRICE_COPY.bundle}</p> : null}
        </div>
      )}
    </li>
  );
}

export function AutoSavedRow({
  line,
  decision,
  onReplace,
  onNonProduct,
  onUndo,
  editable,
  onEdit,
}: {
  line: ReceiptLine;
  decision: LineDecision | undefined;
  onReplace?: () => void;
  onNonProduct?: () => void;
  onUndo?: () => void;
  editable: boolean;
  onEdit?: () => void;
}) {
  const rec = line.record;
  const p = decision?.product ?? line.suggestion;
  return (
    <li className="flex flex-col gap-1 border-b border-divider py-2" data-testid="saved-line">
      <p className="text-sm">
        <span className="font-mono">{line.raw_text}</span>
        {p ? <span className="font-medium"> → {lineName(p)}</span> : null}
      </p>
      {rec ? (
        <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
          <PriceText value={rec.effective_price} className="font-semibold" />
          <BasisLabel basis={rec.price_basis} promoMinQty={rec.promo_min_qty} />
          {rec.is_bundle ? <PriceLabel tone="muted">{PRICE_COPY.bundle}</PriceLabel> : null}
          {rec.status === 'void' ? <PriceLabel tone="muted">{C.voided}</PriceLabel> : null}
        </p>
      ) : (
        <LineAmounts line={line} weight={p?.sale_mode === 'weight'} />
      )}
      {decision ? (
        <p className="text-sm">
          {fill(C.decided[decision.action], { name: decision.product ? lineName(decision.product) : '' })}{' '}
          <Button variant="link" className="h-auto p-0" onClick={onUndo}>
            {C.undo}
          </Button>
        </p>
      ) : editable && onReplace ? (
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onReplace}>
            {C.replaceShort}
          </Button>
          <Button variant="ghost" onClick={onNonProduct}>
            {C.notProduct}
          </Button>
        </div>
      ) : onEdit ? (
        <Button variant="ghost" className="self-start" onClick={onEdit}>
          {fill(C.editLine, { text: '' }).trim()}
        </Button>
      ) : null}
    </li>
  );
}

export function Fold({
  title,
  count,
  children,
  testId,
  defaultOpen = false,
}: {
  title: string;
  count?: number;
  children: ReactNode;
  testId: string;
  defaultOpen?: boolean;
}) {
  return (
    <details className="rounded-lg border border-divider px-3" data-testid={testId} open={defaultOpen}>
      <summary className="flex min-h-touch cursor-pointer items-center font-semibold">
        {count === undefined ? title : fill(title, { n: count })}
      </summary>
      <div className="pb-2">{children}</div>
    </details>
  );
}

export function AdjustmentsList({ adjustments }: { adjustments: ReceiptDetail['adjustments'] }) {
  return (
    <ul className="flex flex-col gap-1 text-sm">
      {adjustments.map((a) => {
        const amount = a.amount != null ? formatRupiah(-Math.abs(a.amount)) : '';
        const text =
          a.kind === 'voucher'
            ? fill(C.voucher, { amount })
            : a.kind === 'cashback'
              ? fill(C.cashback, { amount: a.amount != null ? formatRupiah(Math.abs(a.amount)) : '' })
              : a.kind === 'points'
                ? fill(C.points, { n: a.points ?? 0 })
                : a.kind === 'shipping'
                  ? fill(C.shipping, { amount: a.amount != null ? formatRupiah(a.amount) : '' })
                  : fill(C.otherAdj, { text: a.description ?? '', amount });
        return <li key={a.id}>{text}</li>;
      })}
      <li className="text-muted-foreground">{C.adjustmentsNote}</li>
    </ul>
  );
}

export function MemberHintBox({
  storeName,
  pending,
  onYes,
}: {
  storeName: string | null;
  pending: boolean;
  onYes: () => void;
}) {
  return (
    <section className="flex flex-col gap-2 rounded-lg bg-muted p-3" data-testid="member-hint">
      <p>{storeName ? fill(C.memberHint, { store: storeName }) : C.memberHintNoStore}</p>
      <Button variant="secondary" className="self-start" onClick={onYes} disabled={pending}>
        {C.memberYes}
      </Button>
    </section>
  );
}
