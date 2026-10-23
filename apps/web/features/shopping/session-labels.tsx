'use client';
// Kartu label sesi (wireframe S-13, docs/07 §7.3): per foto (capture) R18 + foto yang masih di HP.
//   uploaded/processing → "diproses…"; failed → "gagal dibaca ›" (S-09);
//   needs_confirmation → produk + "perlu dicek ›" (S-11); done → produk, harga + label, pembanding
//   vs_best_pct ("12% lebih murah dari biasanya" / "setara harga terbaikmu", W-08).
// R18 tidak membawa status per item (F-61), jadi "perlu dicek" berlaku untuk satu foto.
import type { SessionLabel } from '@priceatlas/contracts';
import { ChevronRight, Tag } from 'lucide-react';
import Link from 'next/link';
import { BasisLabel, PriceText } from '@/components/price/price';
import { fill, SHOPPING_COPY as C } from '@/lib/copy/id';
import { formatPercent } from '@/lib/format';
import { productTitle } from '@/lib/format/product';
import type { OutboxItem } from '@/lib/offline/outbox-store';
import { labelComparison, localLabelState, type LocalLabelState, type SessionCapture } from '@/lib/session/session';
import { cn } from '@/lib/utils';

const LOCAL_TEXT: Record<LocalLabelState, string> = {
  waiting: C.status.waiting,
  uploading: C.status.uploading,
  held: C.status.held,
  error: C.status.error,
};

function nameOf(l: SessionLabel): string {
  if (!l.product) return C.unknownProduct;
  const t = productTitle(l.product);
  return `${t.title} ${t.size}`;
}

/** Teks pembanding (wireframe S-13, W-08); null jika belum ada data 90 hari. */
export function comparisonText(pct: number | null | undefined, nearPct: number): string | null {
  const c = labelComparison(pct, nearPct);
  if (!c) return null;
  return c.kind === 'same' ? C.compare.same : fill(C.compare[c.kind], { pct: formatPercent(c.pct) });
}

export function ComparisonText({ pct, nearPct }: { pct: number | null; nearPct: number }) {
  const text = comparisonText(pct, nearPct);
  const kind = labelComparison(pct, nearPct)?.kind;
  if (!text) return null;
  return (
    <span className={cn('text-sm', kind === 'cheaper' ? 'text-success' : kind === 'pricier' ? 'text-danger' : '')}>
      {text}
    </span>
  );
}

function Row({ children, testId }: { children: React.ReactNode; testId: string }) {
  return (
    <li
      data-testid={testId}
      className="flex min-h-touch items-start gap-3 border-b border-divider py-2 last:border-b-0"
    >
      <Tag aria-hidden className="mt-1 size-5 shrink-0 text-muted-foreground" />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">{children}</div>
    </li>
  );
}

const linkClass = 'inline-flex min-h-touch items-center gap-1 self-start font-medium underline underline-offset-4';

export function CaptureLabels({ c, nearPct }: { c: SessionCapture; nearPct: number }) {
  if (c.status === 'uploaded' || c.status === 'processing')
    return (
      <Row testId="session-label">
        <span className="font-medium">{C.localLabel}</span>
        <span className="text-sm text-muted-foreground">{C.status.processing}</span>
      </Row>
    );
  if (c.status === 'failed')
    return (
      <Row testId="session-label">
        <span className="font-medium">{C.localLabel}</span>
        <Link href={`/unggahan/detail?id=${c.capture_id}`} className={linkClass} aria-label={C.openFailed}>
          {C.status.failed}
          <ChevronRight aria-hidden className="size-4" />
        </Link>
      </Row>
    );
  if (c.status === 'needs_confirmation') {
    const names = c.items.map(nameOf);
    return (
      <Row testId="session-label">
        {names.length ? (
          names.map((n, i) => (
            <span key={`${c.capture_id}-${i}`} className="font-medium">
              {n}
            </span>
          ))
        ) : (
          <span className="font-medium">{C.unknownProduct}</span>
        )}
        <Link
          href={`/konfirmasi?capture=${c.capture_id}`}
          className={linkClass}
          aria-label={fill(C.openCheck, { what: names.join(', ') || C.localLabel })}
        >
          {C.status.needsCheck}
          <ChevronRight aria-hidden className="size-4" />
        </Link>
      </Row>
    );
  }
  // done: satu baris per harga tersimpan.
  return (
    <>
      {c.items.map((l, i) => (
        <Row key={`${c.capture_id}-${l.item_id ?? i}`} testId="session-label">
          <span className="font-medium">{nameOf(l)}</span>
          <span className="flex flex-wrap items-center gap-2">
            {l.effective_price != null ? <PriceText value={l.effective_price} className="font-semibold" /> : null}
            {l.price_basis ? <BasisLabel basis={l.price_basis} /> : null}
          </span>
          <ComparisonText pct={l.vs_best_pct} nearPct={nearPct} />
        </Row>
      ))}
    </>
  );
}

export function LocalLabel({ item, online }: { item: OutboxItem; online: boolean }) {
  const state = localLabelState(item, online);
  return (
    <Row testId="session-label-local">
      <span className="font-medium">{C.localLabel}</span>
      {state === 'held' || state === 'error' ? (
        <Link href="/unggahan" className={linkClass}>
          {LOCAL_TEXT[state]}
          <ChevronRight aria-hidden className="size-4" />
        </Link>
      ) : (
        <span className="text-sm text-muted-foreground">{LOCAL_TEXT[state]}</span>
      )}
    </Row>
  );
}
