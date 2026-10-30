'use client';
// Kartu label sesi (wireframe S-13, docs/07 §7.3): per item R18 + foto yang masih di HP.
//   uploaded/processing → "diproses…"; failed → "gagal dibaca ›" (S-09);
//   item pending → produk + "perlu dicek ›" (S-11); item tersimpan → produk, harga + label, pembanding
//   vs_best_pct ("12% lebih murah dari biasanya" / "setara harga terbaikmu", W-08).
// 6b M4: status per item (Q-81) dan thumbnail foto (Q-97): satu panggilan createSignedUrls untuk
// semua label (D-79); foto yang sudah di-purge atau gagal ditandatangani → ikon label.
import type { SessionLabel } from '@priceatlas/contracts';
import { ChevronRight, Tag } from 'lucide-react';
import Link from 'next/link';
import { BasisLabel, PriceText } from '@/components/price/price';
import { useSignedUrls } from '@/lib/data/captures';
import { fill, SHOPPING_COPY as C } from '@/lib/copy/id';
import { formatPercent } from '@/lib/format';
import { productTitle } from '@/lib/format/product';
import type { OutboxItem } from '@/lib/offline/outbox-store';
import {
  itemNeedsCheck,
  labelComparison,
  localLabelState,
  type LocalLabelState,
  type SessionCapture,
} from '@/lib/session/session';
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
        // Foto label (dekoratif: nama produk ada di teks kartu). Signed URL Storage, tanpa optimizer.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={thumb}
          alt=""
          data-testid="label-thumbnail"
          className="size-12 shrink-0 rounded-md border border-divider bg-muted object-cover"
        />
      ) : (
        <Tag aria-hidden className="mt-1 size-5 shrink-0 text-muted-foreground" />
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">{children}</div>
    </li>
  );
}

const linkClass = 'inline-flex min-h-touch items-center gap-1 self-start font-medium underline underline-offset-4';

export function CaptureLabels({ c, nearPct, thumb }: { c: SessionCapture; nearPct: number; thumb?: string | null }) {
  if (c.status === 'uploaded' || c.status === 'processing')
    return (
      <Row testId="session-label" thumb={thumb}>
        <span className="font-medium">{C.localLabel}</span>
        <span className="text-sm text-muted-foreground">{C.status.processing}</span>
      </Row>
    );
  if (c.status === 'failed')
    return (
      <Row testId="session-label" thumb={thumb}>
        <span className="font-medium">{C.localLabel}</span>
        <Link href={`/unggahan/detail?id=${c.capture_id}`} className={linkClass} aria-label={C.openFailed}>
          {C.status.failed}
          <ChevronRight aria-hidden className="size-4" />
        </Link>
      </Row>
    );
  if (c.items.length === 0)
    return (
      <Row testId="session-label" thumb={thumb}>
        <span className="font-medium">{C.unknownProduct}</span>
        {c.status === 'needs_confirmation' ? <CheckLink c={c} what={C.localLabel} /> : null}
      </Row>
    );
  // Satu baris per item: tersimpan (harga + pembanding) atau perlu dicek (Q-81).
  return (
    <>
      {c.items.map((l, i) => (
        <Row key={`${c.capture_id}-${l.item_id ?? i}`} testId="session-label" thumb={thumb}>
          <span className="font-medium">{nameOf(l)}</span>
          {itemNeedsCheck(c, l) ? (
            <CheckLink c={c} what={nameOf(l)} />
          ) : (
            <>
              <span className="flex flex-wrap items-center gap-2">
                {l.effective_price != null ? <PriceText value={l.effective_price} className="font-semibold" /> : null}
                {l.price_basis ? <BasisLabel basis={l.price_basis} /> : null}
              </span>
              <ComparisonText pct={l.vs_best_pct} nearPct={nearPct} />
            </>
          )}
        </Row>
      ))}
    </>
  );
}

function CheckLink({ c, what }: { c: SessionCapture; what: string }) {
  return (
    <Link href={`/konfirmasi?capture=${c.capture_id}`} className={linkClass} aria-label={fill(C.openCheck, { what })}>
      {C.status.needsCheck}
      <ChevronRight aria-hidden className="size-4" />
    </Link>
  );
}

/** Daftar label sesi: foto di HP dulu, lalu foto R18 dengan thumbnail (satu panggilan Storage). */
export function SessionLabelList({
  groups,
  local,
  online,
  nearPct,
}: {
  groups: SessionCapture[];
  local: OutboxItem[];
  online: boolean;
  nearPct: number;
}) {
  const urls = useSignedUrls(groups.flatMap((c) => (c.thumbnail_path ? [c.thumbnail_path] : [])));
  return (
    <ul className="flex flex-col">
      {local.map((i) => (
        <LocalLabel key={i.capture_id} item={i} online={online} />
      ))}
      {groups.map((c) => (
        <CaptureLabels
          key={c.capture_id}
          c={c}
          nearPct={nearPct}
          thumb={c.thumbnail_path ? (urls.data?.[c.thumbnail_path] ?? null) : null}
        />
      ))}
    </ul>
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
