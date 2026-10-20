'use client';
// S-12 Pilih toko & cabang (docs/07 §7.3, wireframe S-12, docs/05 §3.3 S-12), mode manual dan koreksi
// (mode sesi = M4). Langkah 1 toko: "Terakhir dipakai" (R17) di bawah dekat jempol, semua toko + search
// (REST store, normalized_name ilike) di bawahnya. Langkah 2 cabang: REST branch (tutup di bawah),
// "Tidak tahu cabangnya" (U-14), "+ Toko baru" / "+ Cabang baru" (W17, id dari klien, privat D-29,
// 23505 = sukses). Hasil dikembalikan ke layar asal (`kembali=`) lewat lib/confirm/location-handoff.
import { ArrowLeft, Plus } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useId, useState, type FormEvent } from 'react';
import { EmptyState, ErrorState, LoadingState } from '@/components/app/screen-state';
import { PriceLabel, PrivateBadge } from '@/components/price/price';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Segmented } from '@/components/ui/segmented';
import { Skeleton } from '@/components/ui/skeleton';
import { locationError } from '@/lib/confirm/errors';
import {
  completeLocationPick,
  openedFromApp,
  safeBack,
  type LocationMode,
  type PickedLocation,
} from '@/lib/confirm/location-handoff';
import { fill, LOCATION_COPY as C } from '@/lib/copy/id';
import {
  useBranches,
  useCreateBranch,
  useCreateStore,
  useRecentLocations,
  useStores,
  type BranchRow,
} from '@/lib/data/confirm';
import { newCaptureId } from '@/lib/media/capture-id';

type Store = PickedLocation['store'];

function storeOf(row: { id: string; name: string; channel: 'offline' | 'online'; household_id: string | null }): Store {
  return { id: row.id, name: row.name, channel: row.channel, is_private: row.household_id != null };
}

function Row({
  title,
  subtitle,
  badges,
  onClick,
  testId,
  disabled,
}: {
  title: string;
  subtitle?: string | null;
  badges?: React.ReactNode;
  onClick: () => void;
  testId: string;
  disabled?: boolean;
}) {
  return (
    <li data-testid={testId}>
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className="flex min-h-action w-full items-center justify-between gap-2 rounded-lg border border-divider px-3 py-2 text-left hover:bg-muted disabled:opacity-60"
      >
        <span className="flex flex-col">
          <span className="font-medium">{title}</span>
          {subtitle ? <span className="text-sm text-muted-foreground">{subtitle}</span> : null}
        </span>
        <span className="flex shrink-0 gap-1">{badges}</span>
      </button>
    </li>
  );
}

function NewNameDialog({
  open,
  onOpenChange,
  title,
  nameLabel,
  extra,
  saveLabel,
  pending,
  error,
  initialName = '',
  onSave,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  nameLabel: string;
  extra?: (v: { city: string; setCity: (s: string) => void }) => React.ReactNode;
  saveLabel: string;
  pending: boolean;
  error: string | null;
  initialName?: string;
  onSave: (v: { name: string; city: string }) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {/* Form dipasang ulang setiap kali dibuka (isi awal dari initialName). */}
        <NewNameForm {...{ onOpenChange, title, nameLabel, extra, saveLabel, pending, error, initialName, onSave }} />
      </DialogContent>
    </Dialog>
  );
}

function NewNameForm({
  onOpenChange,
  title,
  nameLabel,
  extra,
  saveLabel,
  pending,
  error,
  initialName,
  onSave,
}: Omit<Parameters<typeof NewNameDialog>[0], 'open'>) {
  const uid = useId();
  const [name, setName] = useState(initialName ?? '');
  const [city, setCity] = useState('');
  const [missing, setMissing] = useState(false);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return setMissing(true);
    onSave({ name: name.trim(), city: city.trim() });
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <DialogTitle>{title}</DialogTitle>
      <DialogDescription>{C.privateNote}</DialogDescription>
      <div className="flex flex-col gap-1">
        <Label htmlFor={`${uid}-name`}>{nameLabel}</Label>
        <Input
          id={`${uid}-name`}
          value={name}
          autoComplete="off"
          aria-invalid={missing}
          onChange={(e) => setName(e.target.value)}
        />
        {missing ? (
          <p role="alert" className="text-sm text-danger">
            {C.required}
          </p>
        ) : null}
      </div>
      {extra?.({ city, setCity })}
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      <div className="flex gap-2">
        <Button variant="secondary" className="flex-1" onClick={() => onOpenChange(false)}>
          {C.cancel}
        </Button>
        <Button type="submit" className="flex-1" disabled={pending}>
          {saveLabel}
        </Button>
      </div>
    </form>
  );
}

export function LocationScreen() {
  const router = useRouter();
  const params = useSearchParams();
  const mode = (params?.get('mode') ?? 'koreksi') as LocationMode;
  const target = params?.get('untuk') ?? '';
  const back = safeBack(params?.get('kembali'));
  const recent = useRecentLocations();
  const [q, setQ] = useState('');
  const stores = useStores(q);
  const [store, setStore] = useState<Store | null>(null);
  const branches = useBranches(store?.id ?? null);
  const createStore = useCreateStore();
  const createBranch = useCreateBranch();
  const [newStoreOpen, setNewStoreOpen] = useState(false);
  const [newBranchOpen, setNewBranchOpen] = useState(false);
  const [channel, setChannel] = useState<'offline' | 'online'>('offline');
  const [error, setError] = useState<string | null>(null);

  const finish = (picked: PickedLocation) => {
    const fromApp = openedFromApp(target);
    completeLocationPick(target, picked);
    if (fromApp) router.back();
    else router.replace(back);
  };

  const title = mode === 'manual' ? C.titleManual : mode === 'sesi' ? C.titleSession : C.titleKoreksi;
  const header = (
    <div className="flex items-center gap-2">
      <Button variant="ghost" size="icon" onClick={() => (store ? setStore(null) : router.back())}>
        <ArrowLeft aria-hidden />
        <span className="sr-only">{store ? C.back : C.cancel}</span>
      </Button>
      <h1 id="judul-layar" tabIndex={-1} className="text-2xl font-semibold">
        {title}
      </h1>
    </div>
  );

  if (mode === 'sesi') {
    return (
      <section className="flex flex-col gap-4 p-4" aria-labelledby="judul-layar">
        {header}
        <EmptyState message={C.sessionLater} />
      </section>
    );
  }

  if (store) {
    const list = branches.data ?? [];
    const recentBranches = (recent.data ?? []).filter((r) => r.store.id === store.id && r.branch);
    const seller = store.channel === 'online';
    const branchRow = (b: BranchRow, testId: string) => (
      <Row
        key={`${testId}-${b.id}`}
        testId={testId}
        title={b.name}
        subtitle={[b.city, b.region].filter(Boolean).join(', ') || null}
        badges={
          <>
            {b.household_id ? <PrivateBadge /> : null}
            {b.status === 'closed' ? <PriceLabel tone="muted">{C.closed}</PriceLabel> : null}
          </>
        }
        onClick={() =>
          finish({
            store,
            branch: { id: b.id, name: b.name, status: b.status, kind: b.kind, is_private: b.household_id != null },
          })
        }
      />
    );
    return (
      <section className="flex flex-col gap-4 p-4 pb-8" aria-labelledby="judul-layar">
        {header}
        <p className="text-sm text-muted-foreground">{fill(C.stepBranch, { store: store.name })}</p>
        {branches.isError && !branches.data ? (
          <ErrorState error={branches.error} onRetry={() => void branches.refetch()} />
        ) : branches.isPending ? (
          <LoadingState>
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </LoadingState>
        ) : (
          <section aria-labelledby="judul-cabang" className="flex flex-col gap-2">
            <h2 id="judul-cabang" className="text-lg font-semibold">
              {seller ? C.sellers : C.branches}
            </h2>
            {list.length === 0 ? <p className="text-sm text-muted-foreground">{C.branchesEmpty}</p> : null}
            <ul className="flex flex-col gap-2">
              {list.filter((b) => b.status === 'open').map((b) => branchRow(b, 'branch-row'))}
              {list.filter((b) => b.status === 'closed').map((b) => branchRow(b, 'branch-row'))}
            </ul>
          </section>
        )}
        {recentBranches.length ? (
          <section aria-labelledby="judul-cabang-terakhir" className="flex flex-col gap-2">
            <h2 id="judul-cabang-terakhir" className="text-lg font-semibold">
              {C.recent}
            </h2>
            <ul className="flex flex-col gap-2">
              {recentBranches.map((r) => (
                <Row
                  key={r.branch!.id}
                  testId="recent-branch"
                  title={r.branch!.name}
                  badges={r.branch!.is_private ? <PrivateBadge /> : null}
                  onClick={() => finish({ store, branch: r.branch })}
                />
              ))}
            </ul>
          </section>
        ) : null}
        <div className="flex flex-col gap-2">
          <Button size="action" variant="secondary" onClick={() => finish({ store, branch: null })}>
            {C.unknownBranch}
          </Button>
          <p className="text-sm text-muted-foreground">{C.unknownBranchHint}</p>
          <Button size="action" variant="ghost" onClick={() => setNewBranchOpen(true)}>
            <Plus aria-hidden />
            {seller ? C.newSeller : C.newBranch}
          </Button>
        </div>
        <NewNameDialog
          open={newBranchOpen}
          onOpenChange={setNewBranchOpen}
          title={C.newBranchTitle}
          nameLabel={C.newBranchName}
          saveLabel={C.newBranchSave}
          pending={createBranch.isPending}
          error={error}
          extra={({ city, setCity }) => (
            <div className="flex flex-col gap-1">
              <Label htmlFor="cabang-kota">{C.newBranchCity}</Label>
              <Input id="cabang-kota" value={city} onChange={(e) => setCity(e.target.value)} />
            </div>
          )}
          onSave={({ name, city }) => {
            setError(null);
            createBranch.mutate(
              {
                id: newCaptureId(),
                store_id: store.id,
                kind: seller ? 'seller' : 'physical',
                name,
                city: city || null,
              },
              {
                onSuccess: (b) => {
                  setNewBranchOpen(false);
                  finish({
                    store,
                    branch: { id: b.id, name: b.name, status: b.status, kind: b.kind, is_private: true },
                  });
                },
                onError: (e) => setError(locationError(e)),
              },
            );
          }}
        />
      </section>
    );
  }

  const all = stores.data ?? [];
  return (
    <section className="flex flex-col gap-4 p-4 pb-8" aria-labelledby="judul-layar">
      {header}
      <p className="text-sm text-muted-foreground">{C.stepStore}</p>
      <section aria-labelledby="judul-semua-toko" className="flex flex-col gap-2">
        <h2 id="judul-semua-toko" className="text-lg font-semibold">
          {C.allStores}
        </h2>
        {stores.isError && !stores.data ? (
          <ErrorState error={stores.error} onRetry={() => void stores.refetch()} />
        ) : stores.isPending ? (
          <LoadingState>
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </LoadingState>
        ) : all.length === 0 ? (
          <p className="text-sm">{fill(C.noStores, { q })}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {all.map((s) => (
              <Row
                key={s.id}
                testId="store-row"
                title={s.name}
                subtitle={s.channel === 'online' ? C.online : null}
                badges={s.household_id ? <PrivateBadge /> : null}
                onClick={() => setStore(storeOf(s))}
              />
            ))}
          </ul>
        )}
        <Button size="action" variant="ghost" onClick={() => setNewStoreOpen(true)}>
          <Plus aria-hidden />
          {C.newStore}
        </Button>
      </section>
      {/* "Terakhir dipakai" dekat jempol, search di bawahnya (wireframe S-12 "Satu tangan"). */}
      <section aria-labelledby="judul-terakhir" className="flex flex-col gap-2">
        <h2 id="judul-terakhir" className="text-lg font-semibold">
          {C.recent}
        </h2>
        {recent.isPending ? (
          <LoadingState>
            <Skeleton className="h-12 w-full" />
          </LoadingState>
        ) : (recent.data ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">{C.recentEmpty}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {(recent.data ?? []).map((r) => (
              <Row
                key={`${r.store.id}-${r.branch?.id ?? 'x'}`}
                testId="recent-location"
                title={r.store.name}
                subtitle={r.branch?.name ?? null}
                badges={
                  <>
                    {r.store.is_private || r.branch?.is_private ? <PrivateBadge /> : null}
                    {r.branch?.status === 'closed' ? <PriceLabel tone="muted">{C.closed}</PriceLabel> : null}
                  </>
                }
                onClick={() => (r.branch ? finish({ store: r.store, branch: r.branch }) : setStore(r.store))}
              />
            ))}
          </ul>
        )}
      </section>
      <div className="sticky bottom-[calc(var(--spacing-tabbar)+env(safe-area-inset-bottom))] flex flex-col gap-1 bg-background py-2">
        <label htmlFor="cari-toko" className="sr-only">
          {C.searchLabel}
        </label>
        <Input
          id="cari-toko"
          type="search"
          placeholder={C.searchPlaceholder}
          autoComplete="off"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      <NewNameDialog
        open={newStoreOpen}
        onOpenChange={setNewStoreOpen}
        title={C.newStoreTitle}
        nameLabel={C.newStoreName}
        saveLabel={C.newStoreSave}
        pending={createStore.isPending}
        error={error}
        initialName={q}
        extra={() => (
          <Segmented
            label={C.newStoreChannel}
            value={channel}
            onChange={setChannel}
            options={[
              { value: 'offline', label: C.channel.offline },
              { value: 'online', label: C.channel.online },
            ]}
          />
        )}
        onSave={({ name }) => {
          setError(null);
          createStore.mutate(
            { id: newCaptureId(), name, channel },
            {
              onSuccess: (s) => {
                setNewStoreOpen(false);
                setStore({ id: s.id, name: s.name, channel: s.channel, is_private: s.is_private });
              },
              onError: (e) => setError(locationError(e)),
            },
          );
        }}
      />
    </section>
  );
}
