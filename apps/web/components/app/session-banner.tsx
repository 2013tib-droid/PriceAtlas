'use client';
// Banner sesi belanja (U-13, wireframe §5.6, docs/07 §7.2): di atas tab bar di semua layar (app)
// selama ada sesi aktif: "● Belanja di AEON BSD · 1j 12m · 4 label [📷 Foto label]". Foto label
// 1 ketukan dari mana pun. Sesi yang lewat `expires_at` hilang tanpa muat ulang (jam lokal), dan
// sesi terakhir diingat di perangkat untuk teks "berakhir otomatis" di S-13 (D-43).
// Hanya R18 + antrean lokal: tidak memuat kode kamera/kompresi (bundle halaman, D-84).
import type { ActiveSession } from '@priceatlas/contracts';
import { Camera } from 'lucide-react';
import Link from 'next/link';
import { useEffect } from 'react';
import { fill, SESSION_COPY } from '@/lib/copy/id';
import { useActiveSession } from '@/lib/data/session';
import { formatDuration } from '@/lib/format';
import { useNow } from '@/lib/hooks/use-now';
import { usePref } from '@/lib/hooks/use-pref';
import { useOutboxItems } from '@/lib/offline/outbox-context';
import type { OutboxItem } from '@/lib/offline/outbox-store';
import { PREF_KEYS } from '@/lib/offline/prefs';
import { LABEL_CAMERA } from '@/lib/session/label-target';
import {
  activeOrNull,
  localSessionItems,
  rememberSession,
  sessionClock,
  sessionLabelCount,
  sessionPlace,
  type RememberedSession,
} from '@/lib/session/session';

/** Ketukan jam banner: durasi per menit cukup; kedaluwarsa paling lambat 15 dtk terlambat. */
export const BANNER_TICK_MS = 15_000;

/** Ingat sesi aktif terakhir (prefs) supaya S-13 bisa menulis "berakhir otomatis" (D-43). */
function useRememberActiveSession(active: ActiveSession | null, items: readonly OutboxItem[]) {
  const remembered = usePref<RememberedSession | null>(PREF_KEYS.lastSession, null);
  const next = active
    ? rememberSession(active, localSessionItems(items, active.session.id, active.labels).length)
    : null;
  const key = next ? `${next.id}|${next.expires_at}|${next.label_count}` : null;
  const prevKey = remembered.value
    ? `${remembered.value.id}|${remembered.value.expires_at}|${remembered.value.label_count}`
    : null;
  const { update, ready } = remembered;
  useEffect(() => {
    // Disimpan ke IndexedDB (sistem luar); tidak ada state React yang diubah di sini.
    if (ready && next && key !== prevKey) void update(() => next);
  }, [ready, key, prevKey, next, update]);
}

export function SessionBanner() {
  const { data } = useActiveSession();
  const { items } = useOutboxItems();
  const now = useNow(BANNER_TICK_MS);
  const active = activeOrNull(data, now);
  useRememberActiveSession(active, items);
  if (!active) return null;
  const clock = sessionClock(active.session, now);
  const place = sessionPlace(active);
  const n = sessionLabelCount(active.labels, localSessionItems(items, active.session.id, active.labels));
  const duration = formatDuration(clock.elapsedMs);
  return (
    <div
      data-session-banner
      className="flex h-banner items-center gap-2 border-b border-divider bg-muted px-3 text-sm"
      role="region"
      aria-label={fill(SESSION_COPY.banner, { place })}
    >
      <Link
        href="/belanja"
        className="flex min-w-0 flex-1 items-center gap-2"
        aria-label={fill(SESSION_COPY.bannerOpen, { place, duration, n })}
      >
        <span aria-hidden className="size-2 shrink-0 rounded-full bg-success" />
        <span className="truncate">
          <span className="font-semibold">{fill(SESSION_COPY.banner, { place })}</span>
          {` · ${duration} · ${fill(SESSION_COPY.bannerLabels, { n })}`}
        </span>
      </Link>
      <Link
        href={LABEL_CAMERA}
        className="flex h-touch shrink-0 items-center gap-1 rounded-md bg-primary px-3 font-medium text-primary-foreground"
      >
        <Camera aria-hidden className="size-4" />
        {SESSION_COPY.photoLabel}
      </Link>
    </div>
  );
}
