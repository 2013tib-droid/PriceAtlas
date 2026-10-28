'use client';
// S-13 Sesi belanja `/belanja` (wireframe S-13, docs/07 §7.3, docs/05 §3.3 S-13): R18 (polling saat
// ada label diproses, P-15), W12 perpanjang (+session_extend_hours, W-20), W13 akhiri (idempoten),
// sesi terakhir dari R17 untuk mulai lagi 1 ketukan (W11). Keadaan: memuat, tanpa sesi (ajakan),
// aktif tanpa label, aktif dengan label, hampir kedaluwarsa (< 30 mnt), kedaluwarsa (D-43, teks dari
// sesi yang diingat di perangkat), SESSION_NOT_ACTIVE, offline (sesi dari cache + label di HP).
// "Akhiri sesi" kecil di kiri, "Foto label" besar di kanan (wireframe "Satu tangan").
import { Camera, MapPin, Plus, Search } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { ErrorState, LoadingState, OfflineState } from '@/components/app/screen-state';
import { StickyAction } from '@/components/app/sticky-action';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { fill, SESSION_COPY, SHOPPING_COPY as C } from '@/lib/copy/id';
import { useSignedUrls } from '@/lib/data/captures';
import { useRecentLocations } from '@/lib/data/confirm';
import { useClientConfig } from '@/lib/data/queries';
import { useActiveSession, useEndSession, useExtendSession, useStartSession } from '@/lib/data/session';
import { formatTime } from '@/lib/format';
import { useNow } from '@/lib/hooks/use-now';
import { useOnline } from '@/lib/hooks/use-online';
import { usePref } from '@/lib/hooks/use-pref';
import { useTimeZone } from '@/lib/hooks/use-time-zone';
import { newCaptureId } from '@/lib/media/capture-id';
import { useOutboxItems } from '@/lib/offline/outbox-context';
import { PREF_KEYS } from '@/lib/offline/prefs';
import { sessionError, type SessionErrorAction } from '@/lib/session/errors';
import { LABEL_CAMERA } from '@/lib/session/label-target';
import {
  activeOrNull,
  expiredNotice,
  groupSessionLabels,
  localSessionItems,
  remainingMinutes,
  sessionClock,
  sessionLabelCount,
  sessionPlace,
  type RememberedSession,
} from '@/lib/session/session';
import { CaptureLabels, LocalLabel } from './session-labels';

const START_HREF = '/lokasi?mode=sesi';
/** Ketukan jam S-13: sisa menit dan batas 30 mnt cukup per 15 dtk. */
const TICK_MS = 15_000;

export function ShoppingScreen() {
  const router = useRouter();
  const tz = useTimeZone();
  const online = useOnline();
  const now = useNow(TICK_MS);
  const q = useActiveSession({ refetchOnMount: 'always' });
  const { config } = useClientConfig();
  const { items } = useOutboxItems();
  const remembered = usePref<RememberedSession | null>(PREF_KEYS.lastSession, null);
  const extend = useExtendSession();
  const end = useEndSession();
  const [err, setErr] = useState<{ message: string; action: SessionErrorAction } | null>(null);

  const active = activeOrNull(q.data, now);
  // Thumbnail semua label sesi: satu panggilan createSignedUrls (D-79, Q-97).
  const thumbs = useSignedUrls(
    (active?.labels ?? []).flatMap((l) => (l.thumbnail_path ? [l.thumbnail_path] : [])),
  ).data;
  const notice = expiredNotice(remembered.value, q.data ?? null, now);
  const forget = () => void remembered.update(() => null);

  const heading = (
    <h1 id="judul-layar" tabIndex={-1} className="text-2xl font-semibold">
      {active ? fill(C.activeTitle, { place: sessionPlace(active) }) : C.title}
    </h1>
  );
  const errorBox = err ? (
    <div role="alert" className="flex flex-col items-start gap-2 rounded-lg border border-danger p-3">
      <p className="text-sm">{err.message}</p>
      {err.action.kind === 'start-new' ? (
        <Button variant="secondary" asChild>
          <Link href={START_HREF} onClick={forget}>
            {C.startNew}
          </Link>
        </Button>
      ) : null}
    </div>
  ) : null;

  if (q.data === undefined) {
    return (
      <section className="flex flex-col gap-4 p-4" aria-labelledby="judul-layar">
        {heading}
        {q.isError ? (
          <ErrorState error={q.error} onRetry={() => void q.refetch()} />
        ) : !online ? (
          <OfflineState />
        ) : (
          <LoadingState>
            <Skeleton className="h-6 w-2/3" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </LoadingState>
        )}
      </section>
    );
  }

  if (!active) {
    return (
      <section className="flex flex-col gap-4 p-4 pb-28" aria-labelledby="judul-layar">
        {heading}
        {q.isError ? <ErrorState error={q.error} onRetry={() => void q.refetch()} compact /> : null}
        {notice ? (
          <div role="status" className="flex flex-col items-start gap-2 rounded-lg bg-muted p-4" data-testid="expired">
            <p className="text-base">
              {fill(C.expired, {
                place: notice.place,
                time: formatTime(notice.expires_at, tz),
                n: notice.label_count,
              })}
            </p>
            <p className="text-sm text-muted-foreground">{C.expiredNext}</p>
            <Button variant="ghost" onClick={forget}>
              {C.dismiss}
            </Button>
          </div>
        ) : null}
        {errorBox}
        <p className="text-base">{C.invite}</p>
        {!online ? (
          <p className="rounded-lg bg-warning p-3 text-sm text-warning-foreground">{SESSION_COPY.needsSignal}</p>
        ) : null}
        <RecentSessions onStarted={forget} onError={setErr} />
        <StickyAction>
          <Button size="action" asChild>
            <Link href={START_HREF} onClick={forget}>
              <MapPin aria-hidden />
              {notice ? C.startNew : C.start}
            </Link>
          </Button>
        </StickyAction>
      </section>
    );
  }

  const clock = sessionClock(active.session, now);
  const groups = groupSessionLabels(active.labels);
  const local = localSessionItems(items, active.session.id, active.labels);
  const n = sessionLabelCount(active.labels, local);
  const place = sessionPlace(active);
  const hours = config.session_extend_hours;

  const doExtend = () => {
    setErr(null);
    extend.mutate(active.session.id, {
      onSuccess: (t) => toast.success(fill(SESSION_COPY.extended, { time: formatTime(t.expires_at, tz) })),
      onError: (e) => setErr(sessionError(e, 'S-13')),
    });
  };
  const doEnd = () => {
    setErr(null);
    end.mutate(active.session.id, {
      onSuccess: () => {
        forget();
        toast.success(fill(SESSION_COPY.ended, { place, n }));
      },
      onError: (e) => setErr(sessionError(e, 'S-13')),
    });
  };

  return (
    <section className="flex flex-col gap-4 p-4 pb-28" aria-labelledby="judul-layar">
      <div className="flex flex-col gap-1">
        {heading}
        <p className="text-sm text-muted-foreground">
          {fill(C.times, {
            start: formatTime(active.session.started_at, tz),
            end: formatTime(active.session.expires_at, tz),
          })}
        </p>
      </div>
      {q.isError ? <ErrorState error={q.error} onRetry={() => void q.refetch()} compact /> : null}
      {!online ? <p className="rounded-lg bg-warning p-3 text-sm text-warning-foreground">{C.cached}</p> : null}
      {clock.nearExpiry ? (
        <div
          role="status"
          className="flex items-center justify-between gap-2 rounded-lg bg-warning p-3 text-warning-foreground"
        >
          <p className="text-sm font-medium">{fill(C.nearExpiry, { n: remainingMinutes(clock.remainingMs) })}</p>
          <Button
            variant="secondary"
            onClick={doExtend}
            disabled={extend.isPending || !online}
            aria-describedby="perpanjang-info"
          >
            {C.extend}
          </Button>
          <span id="perpanjang-info" className="sr-only">
            {fill(C.extendHint, { h: hours })}
          </span>
        </div>
      ) : null}
      {errorBox}

      <section aria-labelledby="judul-label" className="flex flex-col gap-1">
        <h2 id="judul-label" className="text-lg font-semibold">
          {fill(C.labelsTitle, { n })}
        </h2>
        {n === 0 ? (
          <p className="rounded-lg bg-muted p-4 text-base">{C.emptyLabels}</p>
        ) : (
          <ul className="flex flex-col">
            {local.map((i) => (
              <LocalLabel key={i.capture_id} item={i} online={online} />
            ))}
            {groups.map((c) => (
              <CaptureLabels key={c.capture_id} c={c} nearPct={config.near_best_threshold_pct} thumbs={thumbs} />
            ))}
          </ul>
        )}
      </section>

      <div className="flex flex-wrap gap-2">
        <Button variant="ghost" asChild>
          <Link href={START_HREF}>
            <MapPin aria-hidden />
            {C.changeBranch}
          </Link>
        </Button>
        <Button variant="ghost" asChild>
          <Link href="/">
            <Search aria-hidden />
            {C.shelfCheck}
          </Link>
        </Button>
      </div>

      <StickyAction>
        <Button variant="secondary" onClick={doEnd} disabled={end.isPending || !online} className="shrink-0">
          {C.end}
        </Button>
        <Button size="action" className="flex-1" onClick={() => router.push(LABEL_CAMERA)}>
          <Camera aria-hidden />
          {C.photoLabel}
        </Button>
      </StickyAction>
    </section>
  );
}

/** Sesi terakhir (R17, cabang buka): mulai lagi dengan 1 ketukan (W11). */
function RecentSessions({
  onStarted,
  onError,
}: {
  onStarted: () => void;
  onError: (e: { message: string; action: SessionErrorAction } | null) => void;
}) {
  const recent = useRecentLocations();
  const start = useStartSession();
  const online = useOnline();
  const ids = useRef(new Map<string, string>());
  const rows = (recent.data ?? []).filter((r) => r.branch && r.branch.status === 'open').slice(0, 3);
  if (rows.length === 0) return null;
  const go = (branchId: string) => {
    onError(null);
    if (!navigator.onLine) return onError({ message: SESSION_COPY.needsSignal, action: { kind: 'none' } });
    const sessionId = ids.current.get(branchId) ?? newCaptureId();
    ids.current.set(branchId, sessionId);
    start.mutate(
      { sessionId, branchId },
      {
        onSuccess: (data) => {
          if (!data) {
            ids.current.delete(branchId);
            return onError({ message: SESSION_COPY.restartEnded, action: { kind: 'none' } });
          }
          onStarted();
          toast.success(fill(SESSION_COPY.started, { place: sessionPlace(data) }));
        },
        onError: (e) => onError(sessionError(e, 'S-12')),
      },
    );
  };
  return (
    <section aria-labelledby="judul-sesi-terakhir" className="flex flex-col gap-2">
      <h2 id="judul-sesi-terakhir" className="text-lg font-semibold">
        {C.recentTitle}
      </h2>
      <p className="text-sm text-muted-foreground">{C.recentHint}</p>
      <ul className="flex flex-col gap-2">
        {rows.map((r) => (
          <li key={r.branch!.id} data-testid="recent-session">
            <button
              type="button"
              disabled={start.isPending || !online}
              onClick={() => go(r.branch!.id)}
              className="flex min-h-action w-full items-center justify-between gap-2 rounded-lg border border-divider px-3 py-2 text-left hover:bg-muted disabled:opacity-60"
            >
              <span className="flex flex-col">
                <span className="font-medium">{r.branch!.name}</span>
                <span className="text-sm text-muted-foreground">{r.store.name}</span>
              </span>
              <Plus aria-hidden className="size-5 shrink-0" />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
