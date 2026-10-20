'use client';
// Pola keadaan standar (wireframe §5.5, docs/07 §7.2): memuat (skeleton, tanpa spinner tengah) /
// kosong (satu kalimat + satu aksi) / gagal (pesan + "Coba lagi", konten terakhir tetap) / offline.
import type { UseQueryResult } from '@tanstack/react-query';
import { RefreshCw, WifiOff } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { STATE_COPY, type Screen } from '@/lib/copy/id';
import { errorCopy } from '@/lib/data/errors';
import { useOnline } from '@/lib/hooks/use-online';
import { cn } from '@/lib/utils';

export function LoadingState({ children, label = STATE_COPY.loading }: { children: ReactNode; label?: string }) {
  return (
    <div aria-busy="true" className="flex flex-col gap-3">
      <span className="sr-only" role="status">
        {label}
      </span>
      {children}
    </div>
  );
}

export function EmptyState({
  message,
  action,
  className,
}: {
  message: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-start gap-3 rounded-lg bg-muted p-4', className)}>
      <p className="text-base">{message}</p>
      {action}
    </div>
  );
}

export function ErrorState({
  error,
  onRetry,
  screen,
  message,
  compact = false,
}: {
  error: unknown;
  onRetry?: () => void;
  screen?: Screen;
  /** Pesan khusus layar (mis. NOT_FOUND di S-03). */
  message?: string;
  /** Baris kecil di atas konten terakhir (gagal muat ulang). */
  compact?: boolean;
}) {
  const copy = errorCopy(error, screen);
  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col items-start gap-3 rounded-lg border border-danger p-4',
        compact && 'flex-row items-center justify-between gap-2 p-3 text-sm',
      )}
    >
      <p className={compact ? 'text-sm' : 'text-base'}>{message ?? copy.message}</p>
      {onRetry ? (
        <Button variant="secondary" onClick={onRetry} className={compact ? 'shrink-0' : undefined}>
          <RefreshCw aria-hidden />
          {STATE_COPY.retry}
        </Button>
      ) : null}
    </div>
  );
}

export function OfflineState({ message = STATE_COPY.offlineNoData }: { message?: string }) {
  return (
    <div className="flex items-start gap-3 rounded-lg bg-warning p-4 text-warning-foreground">
      <WifiOff aria-hidden className="mt-0.5 size-5 shrink-0" />
      <p className="text-base">{message}</p>
    </div>
  );
}

/**
 * Satu pintu keadaan untuk satu query. Data yang sudah ada (termasuk dari cache persist) selalu
 * ditampilkan; gagal memuat ulang menjadi baris kecil di atasnya.
 */
export function QueryState<T>({
  query,
  skeleton,
  isEmpty,
  empty,
  screen,
  errorMessage,
  children,
}: {
  query: Pick<UseQueryResult<T>, 'data' | 'error' | 'isError' | 'isPending' | 'refetch'>;
  skeleton: ReactNode;
  isEmpty?: (data: T) => boolean;
  empty?: ReactNode;
  screen?: Screen;
  errorMessage?: (error: unknown) => string | undefined;
  children: (data: T) => ReactNode;
}) {
  const online = useOnline();
  const retry = () => void query.refetch();
  if (query.data !== undefined) {
    return (
      <>
        {query.isError ? <ErrorState error={query.error} onRetry={retry} screen={screen} compact /> : null}
        {isEmpty?.(query.data) ? empty : children(query.data)}
      </>
    );
  }
  if (query.isError)
    return <ErrorState error={query.error} onRetry={retry} screen={screen} message={errorMessage?.(query.error)} />;
  if (!online) return <OfflineState />;
  if (query.isPending) return <LoadingState>{skeleton}</LoadingState>;
  return null;
}
