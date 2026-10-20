'use client';
// S-08 Unggahan (docs/07 §7.3, wireframe S-08): Menunggu sinyal (antrean lokal, U-17), Perlu dicek,
// Sedang diproses, Selesai, Gagal; filter jenis (`?jenis=struk|label|screenshot`). R13 dipolling
// 5 dtk hanya jika ada uploaded/processing dan tab terlihat (D-61, P-15). Antrean > 1 jam → teks
// "buka app untuk mengunggah" (§5.8); antrean > 50 MB → peringatan (D-81).
import type { CaptureListItem } from '@priceatlas/contracts';
import { Camera } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { ReactNode } from 'react';
import { usePhotoSheet } from '@/components/app/photo-sheet';
import { EmptyState, QueryState } from '@/components/app/screen-state';
import { Button } from '@/components/ui/button';
import { Segmented } from '@/components/ui/segmented';
import { Skeleton } from '@/components/ui/skeleton';
import { CAMERA_COPY, fill, UPLOADS_COPY } from '@/lib/copy/id';
import { useCaptures, type CaptureKind } from '@/lib/data/captures';
import { formatBytes } from '@/lib/format';
import { useNow } from '@/lib/hooks/use-now';
import { useOnline } from '@/lib/hooks/use-online';
import { useTimeZone } from '@/lib/hooks/use-time-zone';
import { useOutboxItems } from '@/lib/offline/outbox-context';
import { QUEUE_STALE_MS, QUEUE_WARN_BYTES, type OutboxItem } from '@/lib/offline/outbox-store';
import { CaptureRow, LocalRow } from './capture-rows';

const KIND_PARAM: Record<string, CaptureKind> = { struk: 'receipt', label: 'price_label', screenshot: 'marketplace' };
type Filter = 'semua' | keyof typeof KIND_PARAM;

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-1">
      <h2 id={id} className="text-sm font-semibold tracking-wide text-muted-foreground uppercase">
        {title}
      </h2>
      <ul className="flex flex-col">{children}</ul>
    </section>
  );
}

/** Bagi R13 per bagian wireframe (Perlu dicek selalu di atas). */
export function partitionCaptures(list: readonly CaptureListItem[]) {
  return {
    needs: list.filter((c) => c.status === 'needs_confirmation'),
    processing: list.filter((c) => c.status === 'uploaded' || c.status === 'processing'),
    done: list.filter((c) => c.status === 'done'),
    failed: list.filter((c) => c.status === 'failed'),
  };
}

/** Item lokal yang tampil: belum terdaftar, atau terdaftar tetapi belum muncul di R13. */
export function visibleLocal(items: readonly OutboxItem[], listed: ReadonlySet<string>, kind: CaptureKind | null) {
  return items.filter((i) => !(i.state === 'submitted' && listed.has(i.capture_id)) && (!kind || i.kind === kind));
}

export function UploadsScreen() {
  const router = useRouter();
  const pathname = usePathname() ?? '/unggahan';
  const params = useSearchParams();
  const filter = (params?.get('jenis') ?? 'semua') as Filter;
  const kind = KIND_PARAM[filter] ?? null;
  const tz = useTimeZone();
  const online = useOnline();
  const photo = usePhotoSheet();
  const captures = useCaptures(kind);
  const { outbox, items, ready } = useOutboxItems();
  const listed = new Set((captures.data ?? []).map((c) => c.id));
  const local = visibleLocal(items, listed, kind);
  const pending = items.filter((i) => i.state !== 'submitted');
  const bytes = pending.reduce((n, i) => n + i.parts.reduce((m, p) => m + p.byte_size, 0), 0);
  const now = useNow();
  const stale = pending.some((i) => now - i.created_at > QUEUE_STALE_MS);

  const setFilter = (f: Filter) => {
    const qs = new URLSearchParams(params?.toString());
    if (f === 'semua') qs.delete('jenis');
    else qs.set('jenis', f);
    const s = qs.toString();
    router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false });
  };

  const empty = (
    <EmptyState
      message={kind ? UPLOADS_COPY.emptyFiltered : UPLOADS_COPY.empty}
      action={
        kind ? undefined : (
          <Button onClick={photo.open}>
            <Camera aria-hidden />
            {UPLOADS_COPY.emptyAction}
          </Button>
        )
      }
    />
  );

  return (
    <section className="flex flex-col gap-4 p-4" aria-labelledby="judul-layar">
      <h1 id="judul-layar" tabIndex={-1} className="text-2xl font-semibold">
        {UPLOADS_COPY.title}
      </h1>
      <Segmented<Filter>
        label={UPLOADS_COPY.filter}
        value={filter in KIND_PARAM ? filter : 'semua'}
        onChange={setFilter}
        options={[
          { value: 'semua', label: UPLOADS_COPY.filterAll },
          { value: 'struk', label: UPLOADS_COPY.kind.receipt },
          { value: 'label', label: UPLOADS_COPY.kind.price_label },
          { value: 'screenshot', label: UPLOADS_COPY.kind.marketplace },
        ]}
      />

      {outbox && local.length > 0 ? (
        <div className="flex flex-col gap-2 rounded-lg bg-warning/50 p-3">
          <Section
            id="bagian-lokal"
            title={fill(online ? UPLOADS_COPY.sectionLocal : UPLOADS_COPY.sectionLocalOffline, { n: local.length })}
          >
            {local.map((i) => (
              <LocalRow key={i.capture_id} item={i} outbox={outbox} timeZone={tz} />
            ))}
          </Section>
          {stale ? <p className="text-sm">{UPLOADS_COPY.stale}</p> : null}
          {bytes > QUEUE_WARN_BYTES ? (
            <p className="text-sm">{fill(CAMERA_COPY.queueWarn, { size: formatBytes(bytes) })}</p>
          ) : null}
        </div>
      ) : null}

      <QueryState
        query={captures}
        screen="S-08"
        skeleton={
          <>
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
          </>
        }
        isEmpty={(d) => d.length === 0}
        empty={ready && local.length === 0 ? empty : null}
      >
        {(list) => {
          const p = partitionCaptures(list);
          return (
            <div className="flex flex-col gap-5">
              {p.needs.length ? (
                <Section id="bagian-perlu-dicek" title={fill(UPLOADS_COPY.sectionNeedsCheck, { n: p.needs.length })}>
                  {p.needs.map((c) => (
                    <CaptureRow key={c.id} c={c} timeZone={tz} />
                  ))}
                </Section>
              ) : (
                <p className="rounded-lg bg-muted p-3 text-base" data-testid="all-checked">
                  {UPLOADS_COPY.allChecked}
                </p>
              )}
              {p.processing.length ? (
                <Section id="bagian-diproses" title={fill(UPLOADS_COPY.sectionProcessing, { n: p.processing.length })}>
                  {p.processing.map((c) => (
                    <CaptureRow key={c.id} c={c} timeZone={tz} />
                  ))}
                </Section>
              ) : null}
              {p.done.length ? (
                <Section id="bagian-selesai" title={UPLOADS_COPY.sectionDone}>
                  {p.done.map((c) => (
                    <CaptureRow key={c.id} c={c} timeZone={tz} />
                  ))}
                </Section>
              ) : null}
              {p.failed.length ? (
                <Section id="bagian-gagal" title={fill(UPLOADS_COPY.sectionFailed, { n: p.failed.length })}>
                  {p.failed.map((c) => (
                    <CaptureRow key={c.id} c={c} timeZone={tz} />
                  ))}
                </Section>
              ) : null}
            </div>
          );
        }}
      </QueryState>
    </section>
  );
}
