'use client';
// S-11 Konfirmasi label & screenshot (docs/07 §7.3, wireframe S-11, docs/05 §3.3 S-11, §4.2):
// R16 get_capture_items (computed live, D-26; staleTime 0, tidak di-persist), crop dari region
// (signed URL R14), W18 update_capture_item per perubahan (debounce + p_expected_updated_at,
// STALE_WRITE → muat ulang + kirim ulang perubahan yang masih berlaku: lib/confirm/item-patch.ts),
// "Saya member" → W16 lalu R16 dimuat ulang, lokasi → S-12 koreksi, Simpan → W5 (accept/reject per
// item). Error §8.2: STORE_REQUIRED (→ S-12), NO_APPLICABLE_PRICE (fokus harga normal), INVALID_EXTRA,
// INVALID_STATE.
import type { CaptureItem } from '@priceatlas/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { ErrorState, LoadingState } from '@/components/app/screen-state';
import { StickyAction } from '@/components/app/sticky-action';
import { SummaryUpdating } from '@/components/app/summary-updating';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ProductPicker, PICKER_KEYS } from '@/features/picker/product-picker';
import { itemsError, type ItemsErrorAction } from '@/lib/confirm/errors';
import { ItemPatchQueue, type ItemPatch } from '@/lib/confirm/item-patch';
import { openLocationHref, takeLocationPick } from '@/lib/confirm/location-handoff';
import { CONFIRM_COPY, ERROR_COPY, fill, ITEMS_COPY as C } from '@/lib/copy/id';
import { useCapture } from '@/lib/data/captures';
import {
  fetchCaptureItems,
  invalidateAfterPriceWrite,
  itemsKey,
  putCaptureItem,
  updateCaptureItem,
  useCaptureItems,
  useConfirmCaptureItems,
  useLocationNames,
  useMyPrograms,
  useSetMembership,
} from '@/lib/data/confirm';
import { errorCopy, toAppError } from '@/lib/data/errors';
import { useClientConfig } from '@/lib/data/queries';
import { useLayer } from '@/lib/hooks/use-layer';
import { useTimeZone } from '@/lib/hooks/use-time-zone';
import { ObservationItem, type ItemLocation } from './observation-item';

type SaveError = { message: string; action: ItemsErrorAction };

export function ItemsScreen() {
  const router = useRouter();
  const qc = useQueryClient();
  const tz = useTimeZone();
  const layer = useLayer();
  const params = layer.params;
  const captureId = params?.get('capture') ?? null;
  const q = useCaptureItems(captureId);
  const capture = useCapture(captureId);
  const programs = useMyPrograms();
  const { config } = useClientConfig();
  const confirm = useConfirmCaptureItems();
  const membership = useSetMembership();
  const items = useMemo(() => q.data ?? [], [q.data]);
  const c = capture.data?.capture;
  const kind = c?.kind === 'marketplace' ? 'marketplace' : 'price_label';
  const target = `items:${captureId ?? ''}`;

  const [computing, setComputing] = useState<Record<string, boolean>>({});
  const [rejected, setRejected] = useState<Record<string, boolean>>({});
  const [saveError, setSaveError] = useState<SaveError | null>(null);
  const [saved, setSaved] = useState<{ ids: string[]; at: number } | null>(null);
  const [memberMarked, setMemberMarked] = useState(false);

  const [queue] = useState(
    () =>
      new ItemPatchQueue({
        send: updateCaptureItem,
        reload: async (itemId) => {
          if (!captureId) return undefined;
          const list = await fetchCaptureItems(captureId);
          qc.setQueryData(itemsKey(captureId), list);
          return list.find((i) => i.id === itemId);
        },
        onItem: (item) => putCaptureItem(qc, item),
        onError: (_id, e, kind) => {
          if (kind === 'conflict') toast(ERROR_COPY.STALE_WRITE.message);
          else setSaveError(itemsError(e));
        },
        onPending: (id, pending) => setComputing((m) => ({ ...m, [id]: pending })),
      }),
  );
  useEffect(() => () => queue.dispose(), [queue]);

  const patch = (item: CaptureItem, p: ItemPatch) => {
    setSaveError(null);
    queue.set(item, p);
  };

  // Hasil S-12: lokasi berlaku untuk semua item yang belum disimpan (satu foto = satu tempat).
  useEffect(() => {
    if (!items.length) return;
    const picked = takeLocationPick(target);
    if (!picked) return;
    for (const i of items)
      if (i.status === 'pending') {
        queue.set(i, { store_id: picked.store.id, branch_id: picked.branch?.id ?? null });
        void queue.flush(i.id);
      }
  }, [items, target, queue]);

  const names = useLocationNames(
    [...items.map((i) => i.store_id), c?.store_id].filter((x): x is string => Boolean(x)),
    [...items.map((i) => i.branch_id), c?.branch_id].filter((x): x is string => Boolean(x)),
  );
  const locationOf = (i: CaptureItem): ItemLocation => {
    const storeId = i.store_id ?? c?.store_id ?? null;
    const branchId = i.store_id ? i.branch_id : (c?.branch_id ?? null);
    const fromSession = !storeId && Boolean(c?.shopping_session_id);
    const s = names.store(storeId);
    return {
      storeName: s?.name ?? null,
      branchName: names.branch(branchId)?.name ?? null,
      fromSession,
      online: s?.channel === 'online',
    };
  };

  const pickerFor = params?.get('pilih') === 'produk' ? (params.get('untuk') ?? '') : null;
  const pickerItem = pickerFor ? items.find((i) => `item:${i.id}` === pickerFor) : undefined;
  const focusItem = saveError?.action.kind === 'focus-normal' ? saveError.action.itemId : null;

  const pending = items.filter((i) => i.status === 'pending');
  const toAccept = pending.filter((i) => !rejected[i.id] && i.suggestion);
  const toReject = pending.filter((i) => rejected[i.id]);

  const pickLocation = () => {
    if (!captureId) return;
    router.push(openLocationHref('koreksi', target, `/konfirmasi?capture=${captureId}`));
  };

  const doAction = (a: ItemsErrorAction) => {
    if (a.kind === 'pick-store') pickLocation();
    else if (a.kind === 'reload') void q.refetch();
    else if ((a.kind === 'focus-normal' || a.kind === 'focus-extra') && a.itemId)
      document.getElementById(`item-${a.itemId}`)?.scrollIntoView({ block: 'center' });
  };

  const save = async () => {
    if (!captureId) return;
    setSaveError(null);
    await queue.flush();
    const ids = [...new Set(toAccept.map((i) => i.suggestion!.id))];
    // eslint-disable-next-line react-hooks/purity -- handler onClick (setelah await), bukan saat render
    const at = Date.now();
    confirm.mutate(
      {
        p_capture_id: captureId,
        p_items: [
          ...toAccept.map((i) => ({ item_id: i.id, action: 'accept' as const })),
          ...toReject.map((i) => ({ item_id: i.id, action: 'reject' as const })),
        ],
      },
      {
        onSuccess: (res) => {
          setRejected({});
          if (res.saved.length) {
            setSaved({ ids, at });
            toast.success(fill(CONFIRM_COPY.savedToast, { n: res.saved.length }));
          } else toast(CONFIRM_COPY.savedNone);
          void invalidateAfterPriceWrite(qc, ids);
          void qc.invalidateQueries({ queryKey: itemsKey(captureId) });
        },
        onError: (e) => {
          const err = itemsError(e);
          setSaveError(err);
          if (err.action.kind !== 'pick-store') doAction(err.action);
          void qc.invalidateQueries({ queryKey: itemsKey(captureId) });
        },
      },
    );
  };

  if (!captureId || (q.isError && !q.data)) {
    const notFound = !captureId || toAppError(q.error).code === 'NOT_FOUND';
    return (
      <section className="flex flex-col gap-3 p-4">
        <ErrorState
          error={q.error}
          screen="S-11"
          message={notFound ? ERROR_COPY.NOT_FOUND.message : undefined}
          onRetry={notFound ? undefined : () => void q.refetch()}
        />
        <Button variant="secondary" asChild className="self-start">
          <Link href="/unggahan">{CONFIRM_COPY.backToUploads}</Link>
        </Button>
      </section>
    );
  }
  if (!q.data) {
    return (
      <section className="flex flex-col gap-3 p-4">
        <LoadingState>
          <Skeleton className="h-8 w-2/3" />
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-40 w-full" />
        </LoadingState>
      </section>
    );
  }

  const imagePath = (i: CaptureItem) => {
    const imgs = capture.data?.images ?? [];
    const img = imgs.find((x) => x.position === (i.image_position ?? 1)) ?? imgs[0];
    return img && !img.purged_at ? img.storage_path : null;
  };
  const allDecided = pending.length === 0;
  const busy = confirm.isPending || Object.values(computing).some(Boolean);
  const n = toAccept.length;

  return (
    <section
      className="flex flex-col gap-4 p-4 pb-[calc(var(--bottom-bars)+6rem)]"
      aria-labelledby="judul-layar"
      data-testid="items-screen"
    >
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={() => router.back()}>
          <ArrowLeft aria-hidden />
          <span className="sr-only">{CONFIRM_COPY.backToUploads}</span>
        </Button>
        <h1 id="judul-layar" tabIndex={-1} className="text-2xl font-semibold">
          {allDecided ? C.titleDone : kind === 'marketplace' ? C.titleScreenshot : C.titleLabel}
        </h1>
      </div>
      {q.isError ? <ErrorState error={q.error} onRetry={() => void q.refetch()} compact /> : null}
      {saved ? <SummaryUpdating productIds={saved.ids} since={saved.at} /> : null}
      {allDecided ? <p className="rounded-lg bg-muted p-3">{C.allDone}</p> : null}

      <ol className="flex flex-col gap-4">
        {items.map((i, idx) => (
          <li key={i.id}>
            <ObservationItem
              item={i}
              index={idx}
              total={items.length}
              kind={kind}
              tau={config.auto_save_min_confidence}
              timeZone={tz}
              imagePath={imagePath(i)}
              location={locationOf(i)}
              programs={programs.data ?? []}
              computing={Boolean(computing[i.id])}
              rejected={Boolean(rejected[i.id])}
              focusNormal={focusItem === i.id}
              onPatch={(p) => patch(i, p)}
              onReplace={() => layer.open({ pilih: 'produk', untuk: `item:${i.id}` })}
              onCreate={() => layer.open({ pilih: 'produk', untuk: `item:${i.id}`, baru: '1' })}
              onReject={(v) => setRejected((m) => ({ ...m, [i.id]: v }))}
              onPickLocation={pickLocation}
              memberPending={membership.isPending}
              memberMarked={memberMarked}
              onMember={(programId) =>
                membership.mutate(programId, {
                  onSuccess: () => setMemberMarked(true),
                  onError: (e) => toast.error(errorCopy(e, 'S-11').message),
                })
              }
            />
          </li>
        ))}
      </ol>

      {!allDecided && pending.some((i) => !i.suggestion && !rejected[i.id]) ? (
        <p className="text-sm text-muted-foreground">
          {fill(C.pendingLeft, { n: pending.filter((i) => !i.suggestion && !rejected[i.id]).length })}
        </p>
      ) : null}

      {saveError ? (
        <div role="alert" className="flex flex-col gap-2 rounded-lg border border-danger p-3" data-testid="save-error">
          <p className="text-sm">{saveError.message}</p>
          {saveError.action.kind === 'pick-store' ? (
            <Button variant="secondary" className="self-start" onClick={pickLocation}>
              {C.change}
            </Button>
          ) : null}
        </div>
      ) : null}

      {!allDecided ? (
        <StickyAction>
          <Button
            size="action"
            onClick={() => void save()}
            disabled={busy || n + toReject.length === 0}
            data-testid="save-items"
          >
            {confirm.isPending ? CONFIRM_COPY.saving : n > 0 ? fill(CONFIRM_COPY.saveN, { n }) : CONFIRM_COPY.saveNone}
          </Button>
        </StickyAction>
      ) : null}

      <ProductPicker
        open={Boolean(pickerItem)}
        onClose={() => layer.close(PICKER_KEYS)}
        initialQuery={(kind === 'marketplace' ? pickerItem?.extra.listing_title : null) ?? pickerItem?.raw_text ?? ''}
        contextText={(kind === 'marketplace' ? pickerItem?.extra.listing_title : null) ?? pickerItem?.raw_text}
        suggestion={pickerItem?.suggestion}
        candidates={pickerItem?.candidates}
        onPick={(p) => {
          if (pickerItem) {
            queue.set(pickerItem, { product_id: p.id });
            void queue.flush(pickerItem.id);
          }
          layer.clear(PICKER_KEYS);
        }}
        createOpen={params?.get('baru') === '1'}
        onCreateOpen={() => layer.open({ baru: '1' })}
        onCreateClose={() => layer.close(['baru'])}
      />
    </section>
  );
}
