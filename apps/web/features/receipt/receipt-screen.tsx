'use client';
// S-10 Konfirmasi / detail struk (docs/07 §7.3, wireframe S-10, docs/05 §3.3 S-10, §4.1):
// R15 get_receipt (staleTime 0, tidak di-persist), header ✎ lewat REST PATCH receipt (filter
// updated_at; 0 baris = STALE_WRITE), NeedsCheckList + "Benarkan semua saran" (≥ 3, U-12), lipatan,
// TotalsCheck (selisih = peringatan saja, D-50), field ragu (< τ R2), DuplicateBanner (D-20, D-74),
// toko belum dikenali → S-12 (D-49), MemberHintBox → W16 (U-21), "Simpan N harga" → W4.
// Mode tersimpan (status confirmed): tampilan + koreksi baris W7; baris di-tap → S-16 (M5, F-52, D-87).
// Pilihan user disimpan di memori + sessionStorage selama belum tersimpan (keadaan gagal §7.3).
import type { ReceiptDetail, ReceiptLine } from '@priceatlas/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { ErrorState, LoadingState } from '@/components/app/screen-state';
import { recordHref } from '@/components/product/history-row';
import { StickyAction } from '@/components/app/sticky-action';
import { SummaryUpdating } from '@/components/app/summary-updating';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { ProductPicker, PICKER_KEYS } from '@/features/picker/product-picker';
import { receiptError, type ReceiptErrorAction } from '@/lib/confirm/errors';
import { openLocationHref, takeLocationPick } from '@/lib/confirm/location-handoff';
import {
  acceptAll,
  acceptAllTargets,
  affectedProductIds,
  canAcceptAll,
  clearReceiptState,
  doubtfulFields,
  groupLines,
  loadReceiptState,
  saveReceiptState,
  savedCountAfter,
  toPLines,
  type Decisions,
  type LineDecision,
} from '@/lib/confirm/receipt';
import { CONFIRM_COPY, ERROR_COPY, fill, RECEIPT_COPY as C } from '@/lib/copy/id';
import { detailHref } from '@/features/uploads/capture-rows';
import {
  invalidateAfterPriceWrite,
  receiptKey,
  useConfirmReceipt,
  useCorrectReceiptLine,
  usePatchReceiptHeader,
  useReceipt,
  useSetMembership,
  type ReceiptHeaderPatch,
} from '@/lib/data/confirm';
import { errorCopy, toAppError } from '@/lib/data/errors';
import { useClientConfig } from '@/lib/data/queries';
import { formatRupiah } from '@/lib/format';
import { flashToast } from '@/lib/flash';
import { useLayer } from '@/lib/hooks/use-layer';
import { useTimeZone } from '@/lib/hooks/use-time-zone';
import { LineEditDialog } from './line-edit-dialog';
import {
  AdjustmentsList,
  AutoSavedRow,
  DuplicateBanner,
  Fold,
  MemberHintBox,
  NeedsCheckRow,
  ReceiptHeader,
  ReceiptImages,
  TotalsCheck,
} from './receipt-parts';

type SaveError = { message: string; action: ReceiptErrorAction };

function HeaderDialog({
  r,
  open,
  onOpenChange,
  onPickStore,
  pending,
  error,
  onSave,
}: {
  r: ReceiptDetail;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onPickStore: () => void;
  pending: boolean;
  error: string | null;
  onSave: (patch: ReceiptHeaderPatch) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {/* Form dipasang ulang setiap kali dibuka: isi awal = header terbaru. */}
        <HeaderForm
          r={r}
          onOpenChange={onOpenChange}
          onPickStore={onPickStore}
          pending={pending}
          error={error}
          onSave={onSave}
        />
      </DialogContent>
    </Dialog>
  );
}

function HeaderForm({
  r,
  onOpenChange,
  onPickStore,
  pending,
  error,
  onSave,
}: Omit<Parameters<typeof HeaderDialog>[0], 'open'>) {
  const h = r.header;
  const [date, setDate] = useState(h.transaction_date ?? '');
  const [time, setTime] = useState(h.transaction_time?.slice(0, 5) ?? '');
  const [total, setTotal] = useState(h.total_amount != null ? String(h.total_amount) : '');
  const [payment, setPayment] = useState(h.payment_method ?? '');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const patch: ReceiptHeaderPatch = {};
    if (date && date !== h.transaction_date) patch.transaction_date = date;
    if ((time || null) !== (h.transaction_time?.slice(0, 5) ?? null)) patch.transaction_time = time || null;
    const n = Number(total.replace(/\./g, '').replace(',', '.'));
    if (total && Number.isFinite(n) && n !== h.total_amount) patch.total_amount = n;
    if ((payment.trim() || null) !== (h.payment_method ?? null)) patch.payment_method = payment.trim() || null;
    if (!Object.keys(patch).length) return onOpenChange(false);
    onSave(patch);
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <DialogTitle>{C.editHeaderTitle}</DialogTitle>
      <DialogDescription className="sr-only">{C.editHeader}</DialogDescription>
      <div className="flex flex-col gap-1">
        <span className="text-sm font-medium">{C.fieldStore}</span>
        <p className="text-sm">{h.store ? `${h.store.name} · ${h.branch?.name ?? C.branchUnknown}` : C.storeUnknown}</p>
        <Button variant="secondary" className="self-start" onClick={onPickStore}>
          {C.changeLocation}
        </Button>
      </div>
      <div className="flex gap-2">
        <div className="flex flex-1 flex-col gap-1">
          <Label htmlFor="struk-tanggal">{C.fieldDate}</Label>
          <Input id="struk-tanggal" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="flex w-28 flex-col gap-1">
          <Label htmlFor="struk-jam">{C.fieldTime}</Label>
          <Input id="struk-jam" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="struk-total">{C.fieldTotal}</Label>
        <Input id="struk-total" inputMode="numeric" value={total} onChange={(e) => setTotal(e.target.value)} />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="struk-bayar">{C.fieldPayment}</Label>
        <Input id="struk-bayar" value={payment} onChange={(e) => setPayment(e.target.value)} />
      </div>
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
          {C.saveHeader}
        </Button>
      </div>
    </form>
  );
}

export function ReceiptScreen() {
  const router = useRouter();
  const qc = useQueryClient();
  const tz = useTimeZone();
  const layer = useLayer();
  const params = layer.params;
  const id = params?.get('id') ?? null;
  const q = useReceipt(id);
  const r = q.data;
  const { config } = useClientConfig();
  const tau = config.auto_save_min_confidence;
  const confirm = useConfirmReceipt();
  const patchHeader = usePatchReceiptHeader(id);
  const correctLine = useCorrectReceiptLine(id);
  const membership = useSetMembership();
  const target = `receipt:${id ?? ''}`;

  const [decisions, setDecisions] = useState<Decisions>({});
  const [bundles, setBundles] = useState<Record<string, boolean>>({});
  const [dupChoice, setDupChoice] = useState<'distinct' | null>(null);
  const [saveError, setSaveError] = useState<SaveError | null>(null);
  const [headerOpen, setHeaderOpen] = useState(false);
  const [headerError, setHeaderError] = useState<string | null>(null);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [editLine, setEditLine] = useState<ReceiptLine | null>(null);
  const [lineError, setLineError] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ ids: string[]; at: number } | null>(null);
  const [memberDone, setMemberDone] = useState(false);

  // Pilihan tersimpan (sessionStorage) dimuat sekali per struk.
  const loadedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!id || loadedFor.current === id) return;
    loadedFor.current = id;
    const s = loadReceiptState(id);
    setDecisions(s.decisions);
    setBundles(
      Object.fromEntries(
        Object.entries(s.decisions)
          .filter(([, d]) => d.is_bundle)
          .map(([k]) => [k, true]),
      ),
    );
    setDupChoice(s.duplicate);
  }, [id]);
  // Simpan pilihan setiap berubah (selama struk masih draft).
  useEffect(() => {
    if (!id || loadedFor.current !== id || r?.header.status !== 'draft') return;
    const merged: Decisions = Object.fromEntries(
      Object.entries(decisions).map(([k, d]) => [k, { ...d, is_bundle: Boolean(bundles[k]) }]),
    );
    saveReceiptState(id, { decisions: merged, duplicate: dupChoice });
  }, [id, decisions, bundles, dupChoice, r?.header.status]);
  // Keputusan untuk baris yang sudah tidak ada / bukan produk lagi diabaikan oleh toPLines dan
  // savedCountAfter (hanya baris produk R15 terbaru yang dibaca).

  // Hasil S-12 (`kembali=`): PATCH toko/cabang struk.
  const applyPatch = useCallback(
    (patch: ReceiptHeaderPatch, after?: () => void) => {
      if (!r) return;
      setHeaderError(null);
      patchHeader.mutate(
        { updatedAt: r.header.updated_at, patch },
        {
          onSuccess: () => {
            toast.success(C.headerSaved);
            after?.();
          },
          onError: (e) => {
            const msg =
              toAppError(e).rpc?.sqlstate === '23503' ? errorCopy(e, 'S-10').message : receiptError(e, r).message;
            setHeaderError(msg);
            setSaveError({ message: msg, action: { kind: 'none' } });
          },
        },
      );
    },
    [patchHeader, r],
  );
  useEffect(() => {
    if (!r || r.header.status !== 'draft') return;
    const picked = takeLocationPick(target);
    // Sinkron dengan sessionStorage (hasil S-12): satu PATCH lalu data dimuat ulang.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (picked) applyPatch({ store_id: picked.store.id, branch_id: picked.branch?.id ?? null });
  }, [r, target, applyPatch]);

  const pickerFor = params?.get('pilih') === 'produk' ? (params.get('untuk') ?? '') : null;
  const pickerLine = pickerFor ? r?.lines.find((l) => `line:${l.id}` === pickerFor) : undefined;

  const pickStore = () => {
    const back = `/struk?id=${id}`;
    router.push(openLocationHref('koreksi', target, back));
  };

  const decide = (lineId: string, d: LineDecision) => {
    setSaveError(null);
    setDecisions((prev) => ({ ...prev, [lineId]: d }));
  };
  const undo = (lineId: string) =>
    setDecisions((prev) => {
      const next = { ...prev };
      delete next[lineId];
      return next;
    });

  const doAction = (a: ReceiptErrorAction) => {
    if (a.kind === 'duplicate') {
      void q.refetch().then(() => document.getElementById('banner-duplikat')?.focus());
    } else if (a.kind === 'scroll-line' && a.lineId) {
      const el = document.getElementById(`line-${a.lineId}`);
      el?.scrollIntoView({ block: 'center' });
      el?.focus();
    } else if (a.kind === 'reload') {
      void q.refetch();
    }
  };

  const save = () => {
    if (!r || !id) return;
    setSaveError(null);
    if (r.duplicate && !dupChoice) {
      const err = {
        message: C.duplicateRequired,
        action: { kind: 'duplicate' as const, duplicateOf: r.duplicate.receipt_id },
      };
      setSaveError(err);
      document.getElementById('banner-duplikat')?.focus();
      return;
    }
    if (!r.header.store) {
      setSaveError({ message: C.storeRequired, action: { kind: 'pick-store' } });
      return;
    }
    const merged: Decisions = Object.fromEntries(
      Object.entries(decisions).map(([k, d]) => [k, { ...d, is_bundle: Boolean(bundles[k]) }]),
    );
    const ids = affectedProductIds(r, merged);
    const at = Date.now();
    confirm.mutate(
      { p_receipt_id: id, p_lines: toPLines(r, merged), p_duplicate_decision: r.duplicate ? dupChoice : null },
      {
        onSuccess: (res) => {
          clearReceiptState(id);
          setSaved({ ids, at });
          toast.success(
            res.cheaper_than_best_count > 0
              ? fill(CONFIRM_COPY.savedCheaper, { n: res.saved_count, m: res.cheaper_than_best_count })
              : fill(CONFIRM_COPY.savedToast, { n: res.saved_count }),
          );
          void invalidateAfterPriceWrite(qc, ids);
          void qc.invalidateQueries({ queryKey: receiptKey(id) });
        },
        onError: (e) => {
          const err = receiptError(e, r);
          setSaveError(err);
          doAction(err.action);
        },
      },
    );
  };

  const discard = () => {
    if (!id) return;
    confirm.mutate(
      { p_receipt_id: id, p_lines: [], p_duplicate_decision: 'discard' },
      {
        onSuccess: () => {
          clearReceiptState(id);
          setDiscardOpen(false);
          void invalidateAfterPriceWrite(qc, []);
          flashToast('success', C.discarded);
          router.replace('/unggahan');
        },
        onError: (e) => {
          setDiscardOpen(false);
          setSaveError(receiptError(e, r));
        },
      },
    );
  };

  const groups = useMemo(() => (r ? groupLines(r) : null), [r]);

  const back = (
    <Button variant="ghost" size="icon" onClick={() => router.back()}>
      <ArrowLeft aria-hidden />
      <span className="sr-only">{CONFIRM_COPY.backToUploads}</span>
    </Button>
  );

  if (!id || (q.isError && !r)) {
    const notFound = !id || toAppError(q.error).code === 'NOT_FOUND';
    return (
      <section className="flex flex-col gap-3 p-4">
        <ErrorState
          error={q.error}
          screen="S-10"
          message={notFound ? ERROR_COPY.NOT_FOUND.message : undefined}
          onRetry={notFound ? undefined : () => void q.refetch()}
        />
        <Button variant="secondary" asChild className="self-start">
          <Link href="/unggahan">{CONFIRM_COPY.backToUploads}</Link>
        </Button>
      </section>
    );
  }
  if (!r || !groups) {
    return (
      <section className="flex flex-col gap-3 p-4">
        <LoadingState>
          <Skeleton className="h-8 w-2/3" />
          <Skeleton className="h-5 w-1/2" />
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-28 w-full" />
        </LoadingState>
      </section>
    );
  }

  const status = r.header.status;
  const draft = status === 'draft';
  const doubt = doubtfulFields(r.field_confidence, tau);
  const storeName = r.header.store?.name ?? null;
  const n = savedCountAfter(r, decisions);
  const dupBlocking = draft && Boolean(r.duplicate) && !dupChoice;
  const showMember =
    draft && !memberDone && r.member_hint?.program_id && !r.membership_known && Boolean(r.header.store);

  const openPicker = (line: ReceiptLine) => layer.open({ pilih: 'produk', untuk: `line:${line.id}` });

  return (
    <section
      className="flex flex-col gap-4 p-4 pb-[calc(var(--bottom-bars)+6rem)]"
      aria-labelledby="judul-layar"
      data-testid="receipt-screen"
      data-status={status}
    >
      <div className="flex items-center gap-2">
        {back}
        <h1 id="judul-layar" tabIndex={-1} className="text-2xl font-semibold">
          {draft ? C.title : status === 'confirmed' ? C.titleSaved : C.titleDiscarded}
        </h1>
      </div>
      {q.isError ? <ErrorState error={q.error} onRetry={() => void q.refetch()} compact /> : null}

      {draft && r.duplicate ? (
        <DuplicateBanner
          dup={r.duplicate}
          chosen={dupChoice}
          pending={confirm.isPending}
          onView={() => router.push(`/struk?id=${r.duplicate!.receipt_id}`)}
          onDistinct={() => {
            setSaveError(null);
            setDupChoice('distinct');
          }}
          onUndo={() => setDupChoice(null)}
          onDiscard={() => setDiscardOpen(true)}
        />
      ) : null}

      <ReceiptHeader
        r={r}
        tz={tz}
        doubt={doubt}
        editable={status !== 'discarded'}
        onPickStore={pickStore}
        onEdit={() => {
          setHeaderError(null);
          setHeaderOpen(true);
        }}
      />
      <TotalsCheck r={r} doubtTotal={doubt.has('total')} />
      <ReceiptImages images={r.images} />

      {status === 'discarded' ? <p className="rounded-lg bg-muted p-4">{C.discardedBody}</p> : null}

      {showMember ? (
        <MemberHintBox
          storeName={storeName}
          pending={membership.isPending}
          onYes={() =>
            membership.mutate(r.member_hint!.program_id!, {
              onSuccess: () => {
                setMemberDone(true);
                toast.success(C.memberDone);
              },
              onError: (e) => toast.error(errorCopy(e, 'S-10').message),
            })
          }
        />
      ) : null}

      {saved ? <SummaryUpdating productIds={saved.ids} since={saved.at} /> : null}

      {draft ? (
        <section aria-labelledby="judul-perlu-dicek" className="flex flex-col gap-2">
          <h2 id="judul-perlu-dicek" className="text-lg font-semibold">
            {fill(C.needsCheck, { n: groups.needsCheck.length })}
          </h2>
          {groups.needsCheck.length === 0 ? (
            <p className="rounded-lg bg-muted p-3" data-testid="all-recognized">
              {C.allRecognized}
            </p>
          ) : (
            <>
              {canAcceptAll(r) && acceptAllTargets(r, decisions).length ? (
                <Button variant="secondary" onClick={() => setDecisions((d) => acceptAll(r, d))}>
                  {fill(C.acceptAll, { n: acceptAllTargets(r, decisions).length })}
                </Button>
              ) : null}
              <ul className="flex flex-col">
                {groups.needsCheck.map((l) => (
                  <NeedsCheckRow
                    key={l.id}
                    line={l}
                    tau={tau}
                    decision={decisions[l.id]}
                    bundle={Boolean(bundles[l.id])}
                    storeName={storeName}
                    onDecide={(d) => decide(l.id, d)}
                    onReplace={() => openPicker(l)}
                    onBundle={(v) => setBundles((b) => ({ ...b, [l.id]: v }))}
                    onUndo={() => undo(l.id)}
                  />
                ))}
              </ul>
            </>
          )}
        </section>
      ) : null}

      {groups.autoSaved.length ? (
        <Fold
          title={draft ? C.autoSaved : C.savedLines}
          count={draft ? groups.autoSaved.length : undefined}
          testId="fold-auto"
          defaultOpen={!draft}
        >
          <ul>
            {groups.autoSaved.map((l) => (
              <AutoSavedRow
                key={l.id}
                line={l}
                decision={draft ? decisions[l.id] : undefined}
                editable={draft}
                onReplace={() => openPicker(l)}
                onNonProduct={() => decide(l.id, { action: 'non_product' })}
                onUndo={() => undo(l.id)}
                href={status === 'confirmed' && l.record ? recordHref(l.record.id) : undefined}
                onEdit={
                  status === 'confirmed' && l.record
                    ? () => {
                        setLineError(null);
                        setEditLine(l);
                      }
                    : undefined
                }
              />
            ))}
          </ul>
        </Fold>
      ) : null}

      {groups.nonProduct.length ? (
        <Fold title={C.nonProduct} count={groups.nonProduct.length} testId="fold-nonproduct">
          <ul className="flex flex-col gap-1 text-sm">
            {groups.nonProduct.map((l) => (
              <li key={l.id} className="flex items-center justify-between gap-2">
                <span>
                  <span className="font-mono">{l.raw_text}</span> · {formatRupiah(l.line_amount)}
                </span>
                {draft && l.line_type === 'non_product' ? (
                  <Button
                    variant="ghost"
                    disabled={correctLine.isPending}
                    onClick={() =>
                      correctLine.mutate(
                        { p_line_id: l.id, p_patch: { line_type: 'product' }, p_expected_updated_at: l.updated_at },
                        { onError: (e) => toast.error(receiptError(e, r).message) },
                      )
                    }
                  >
                    {C.makeProduct}
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        </Fold>
      ) : null}

      {r.adjustments.length ? (
        <Fold title={C.adjustments} testId="fold-adjustments">
          <AdjustmentsList adjustments={r.adjustments} />
        </Fold>
      ) : null}

      <p className="text-sm text-muted-foreground">{CONFIRM_COPY.pii}</p>

      {saveError ? (
        <div role="alert" className="flex flex-col gap-2 rounded-lg border border-danger p-3" data-testid="save-error">
          <p className="text-sm">{saveError.message}</p>
          {draft ? <p className="text-sm text-muted-foreground">{CONFIRM_COPY.failedKeep}</p> : null}
          {saveError.action.kind === 'pick-store' ? (
            <Button variant="secondary" className="self-start" onClick={pickStore}>
              {C.pickStore}
            </Button>
          ) : null}
          {saveError.action.kind === 'view-upload' && r.header.capture_id ? (
            <Button variant="secondary" asChild className="self-start">
              <Link href={detailHref(r.header.capture_id)}>{CONFIRM_COPY.viewUpload}</Link>
            </Button>
          ) : null}
        </div>
      ) : null}

      {draft ? (
        <StickyAction>
          <Button
            size="action"
            onClick={save}
            disabled={confirm.isPending || dupBlocking}
            aria-describedby={dupBlocking ? 'judul-duplikat' : undefined}
            data-testid="save-receipt"
          >
            {confirm.isPending ? CONFIRM_COPY.saving : n > 0 ? fill(CONFIRM_COPY.saveN, { n }) : CONFIRM_COPY.saveNone}
          </Button>
        </StickyAction>
      ) : null}

      <HeaderDialog
        r={r}
        open={headerOpen}
        onOpenChange={setHeaderOpen}
        pending={patchHeader.isPending}
        error={headerError}
        onPickStore={() => {
          setHeaderOpen(false);
          pickStore();
        }}
        onSave={(patch) => applyPatch(patch, () => setHeaderOpen(false))}
      />
      <LineEditDialog
        line={editLine}
        onClose={() => setEditLine(null)}
        pending={correctLine.isPending}
        error={lineError}
        onSave={(patch) =>
          editLine &&
          correctLine.mutate(
            { p_line_id: editLine.id, p_patch: patch, p_expected_updated_at: editLine.updated_at },
            {
              onSuccess: () => {
                setEditLine(null);
                toast.success(C.lineSaved);
                const pid = editLine.record?.product_id;
                setSaved({ ids: pid ? [pid] : [], at: Date.now() });
                void invalidateAfterPriceWrite(qc, pid ? [pid] : []);
              },
              onError: (e) => {
                setLineError(receiptError(e, r).message);
                if (toAppError(e).code === 'STALE_WRITE') void q.refetch();
              },
            },
          )
        }
      />
      <Dialog open={discardOpen} onOpenChange={setDiscardOpen}>
        <DialogContent>
          <div className="flex flex-col gap-4">
            <DialogTitle>{C.discardTitle}</DialogTitle>
            <DialogDescription>{C.discardBody}</DialogDescription>
            <div className="flex gap-2">
              <Button variant="secondary" className="flex-1" onClick={() => setDiscardOpen(false)}>
                {C.cancel}
              </Button>
              <Button variant="danger" className="flex-1" onClick={discard} disabled={confirm.isPending}>
                {C.discardConfirm}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      <ProductPicker
        open={Boolean(pickerLine)}
        onClose={() => layer.close(PICKER_KEYS)}
        initialQuery={pickerLine?.raw_text ?? ''}
        contextText={pickerLine?.raw_text}
        suggestion={pickerLine?.suggestion}
        onPick={(p) => {
          if (pickerLine) decide(pickerLine.id, { action: 'replace', product: p });
          layer.clear(PICKER_KEYS);
        }}
        createOpen={params?.get('baru') === '1'}
        onCreateOpen={() => layer.open({ baru: '1' })}
        onCreateClose={() => layer.close(['baru'])}
      />
    </section>
  );
}
