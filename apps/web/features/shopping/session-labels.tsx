'use client';
// Kartu label sesi (wireframe S-13, docs/07 §7.3): per foto (capture) R18 + foto yang masih di HP.
//   uploaded/processing → "diproses…"; failed → "gagal dibaca ›" (S-09);
//   item tersimpan (`item_status` accepted, juga di foto yang masih perlu dicek) → produk, harga + label,
//   pembanding vs_best_pct ("12% lebih murah dari biasanya" / "setara harga terbaikmu", W-08);
//   item pending → nama produk + "perlu dicek ›" (S-11), satu tautan per foto.
// 6b M4 (Q-80, Q-81, Q-97): status per item dan thumbnail dari R18; signed URL semua thumbnail dalam
// satu panggilan (`useSignedUrls`). Tanpa thumbnail (purge, gagal) → ikon label.
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

function Row({ children, testId, thumb }: { children: React.ReactNode; testId: string; thumb?: string | null }) {
  return (
    <li
      data-testid={testId}
      className="flex min-h-touch items-start gap-3 border-b border-divider py-2 last:border-b-0"
    >
      {thumb ? (
        // Foto label dari bucket privat (signed URL 300 dtk); dekoratif karena nama produk ada di baris.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={thumb} alt="" className="size-12 shrink-0 rounded-md object-cover" loading="lazy" />
      ) : (
        <Tag aria-hidden className="mt-1 size-5 shrink-0 text-muted-foreground" />
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">{children}</div>
    </li>
  );
}

function SavedRow({ l, nearPct, thumb }: { l: SessionLabel; nearPct: number; thumb?: string | null }) {
  return (
    <Row testId="session-label" thumb={thumb}>
      <span className="font-medium">{nameOf(l)}</span>
      <span className="flex flex-wrap items-center gap-2">
        {l.effective_price != null ? <PriceText value={l.effective_price} className="font-semibold" /> : null}
        {l.price_basis ? <BasisLabel basis={l.price_basis} /> : null}
      </span>
      <ComparisonText pct={l.vs_best_pct} nearPct={nearPct} />
    </Row>
  );
}

const linkClass = 'inline-flex min-h-touch items-center gap-1 self-start font-medium underline underline-offset-4';

export function CaptureLabels({
  c,
  nearPct,
  thumbs = {},
}: {
  c: SessionCapture;
  nearPct: number;
  /** storage_path → signed URL (useSignedUrls). */
  thumbs?: Record<string, string>;
}) {
  const thumbOf = (l?: SessionLabel) => (l?.thumbnail_path ? (thumbs[l.thumbnail_path] ?? null) : null);
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
  // Item tersimpan (auto/konfirmasi) tampil dengan harga, juga di foto yang masih punya item pending.
  const saved = c.items.filter((l) => l.item_status === 'accepted' || (c.status === 'done' && l.item_status == null));
  const pending = c.status === 'needs_confirmation' ? c.items.filter((l) => !saved.includes(l)) : [];
  const names = pending.map(nameOf);
  return (
    <>
      {saved.map((l, i) => (
        <SavedRow key={`${c.capture_id}-${l.item_id ?? i}`} l={l} nearPct={nearPct} thumb={thumbOf(l)} />
      ))}
      {c.status === 'needs_confirmation' && (pending.length || !saved.length) ? (
        <Row testId="session-label" thumb={thumbOf(pending[0] ?? c.items[0])}>
          {names.length ? (
            names.map((n, i) => (
              <span key={`${c.capture_id}-p${i}`} className="font-medium">
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
      ) : null}
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
