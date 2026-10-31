'use client';
// S-21 Tempel struk dari Gemini (D-100, docs/08 §23). Langkah: salin prompt tetap → foto struk di Gemini
// → tempel jawaban. Jawaban diperiksa di klien dengan parser yang sama dengan worker (Q-149: format
// salah ditolak di sini, tidak dikirim); pratinjau toko/tanggal/baris/total + peringatan total.
// Kirim = W1b submit_text_capture (butuh online, tanpa antrean), lalu S-09 detail unggahan; worker
// memproses tanpa AI dan struk masuk konfirmasi S-10 seperti foto.
import {
  GEMINI_RECEIPT_PROMPT,
  parsePastedReceipt,
  pastedTotalMatches,
  type PasteParseResult,
} from '@priceatlas/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { ClipboardCopy, Send } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useDeferredValue, useId, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { fill, PASTE_COPY } from '@/lib/copy/id';
import { invalidateCaptures } from '@/lib/data/captures';
import { rpcCall } from '@/lib/data/rpc';
import { errorCopy } from '@/lib/data/errors';
import { formatTransactionDate } from '@/lib/format';
import { formatRupiah } from '@/lib/format/money';
import { useOnline } from '@/lib/hooks/use-online';
import { useTimeZone } from '@/lib/hooks/use-time-zone';
import { newCaptureId } from '@/lib/media/capture-id';

/** Pesan UI untuk hasil parser (tanpa isi struk). */
export function pasteErrorText(r: PasteParseResult): string | null {
  if (r.ok) return null;
  if (r.error === 'invalid') return fill(PASTE_COPY.errors.invalid, { detail: r.detail ?? '-' });
  return PASTE_COPY.errors[r.error];
}

function Preview({ result }: { result: Extract<PasteParseResult, { ok: true }> }) {
  const tz = useTimeZone();
  const r = result.data;
  const products = r.lines.filter((l) => l.type === 'product').length;
  const store = [r.store?.name, r.store?.branch].filter(Boolean).join(' · ');
  const matches = pastedTotalMatches(r);
  const row = (label: string, value: string) => (
    <div className="flex justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium">{value}</dd>
    </div>
  );
  return (
    <section
      aria-labelledby="judul-pratinjau"
      className="flex flex-col gap-2 rounded-lg border border-border p-4"
      data-testid="paste-preview"
    >
      <h2 id="judul-pratinjau" className="text-lg font-semibold">
        {PASTE_COPY.preview}
      </h2>
      <dl className="flex flex-col gap-1 text-base">
        {row(PASTE_COPY.previewStore, store || PASTE_COPY.unknown)}
        {row(
          PASTE_COPY.previewDate,
          r.date && /^\d{4}-\d{2}-\d{2}$/.test(r.date) ? formatTransactionDate(r.date, tz) : PASTE_COPY.unknown,
        )}
        {row(PASTE_COPY.previewItems, fill(PASTE_COPY.itemsCount, { n: products, m: r.lines.length - products }))}
        {row(PASTE_COPY.previewTotal, r.total == null ? PASTE_COPY.unknown : formatRupiah(r.total))}
      </dl>
      {matches === false ? (
        <p className="text-sm text-warning-foreground" role="status">
          {PASTE_COPY.totalMismatch}
        </p>
      ) : null}
    </section>
  );
}

export function PasteScreen() {
  const router = useRouter();
  const qc = useQueryClient();
  const online = useOnline();
  const inputId = useId();
  const helpId = useId();
  const errorId = useId();
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const deferred = useDeferredValue(text);
  const result = parsePastedReceipt(deferred);
  const touched = deferred.trim().length > 0;
  const error = touched ? pasteErrorText(result) : null;

  const copyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(GEMINI_RECEIPT_PROMPT);
      toast.success(PASTE_COPY.copied);
    } catch {
      toast.error(PASTE_COPY.copyFailed);
    }
  };

  const submit = async () => {
    // Periksa teks terbaru (bukan nilai tertunda) tepat sebelum kirim.
    const now = parsePastedReceipt(text);
    if (!now.ok || !online || sending) return;
    setSending(true);
    setSubmitError(null);
    const id = newCaptureId();
    try {
      await rpcCall('submit_text_capture', { p_capture_id: id, p_kind: 'receipt', p_text: text });
      await invalidateCaptures(qc);
      toast.success(PASTE_COPY.sent);
      router.push(`/unggahan/detail?id=${id}`);
    } catch (e) {
      setSubmitError(errorCopy(e).message || PASTE_COPY.submitFailed);
      setSending(false);
    }
  };

  return (
    <section className="flex flex-col gap-4 p-4" aria-labelledby="judul-layar">
      <h1 id="judul-layar" tabIndex={-1} className="text-2xl font-semibold">
        {PASTE_COPY.title}
      </h1>
      <p className="text-base text-muted-foreground">{PASTE_COPY.intro}</p>
      <ol className="flex list-decimal flex-col gap-1 pl-6 text-base">
        {PASTE_COPY.steps.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ol>
      <Button variant="secondary" size="action" onClick={() => void copyPrompt()} className="self-start">
        <ClipboardCopy aria-hidden />
        {PASTE_COPY.copyPrompt}
      </Button>
      <details className="rounded-lg border border-border p-3">
        <summary className="cursor-pointer text-base">{PASTE_COPY.showPrompt}</summary>
        <pre className="mt-2 text-sm break-words whitespace-pre-wrap" data-testid="gemini-prompt">
          {GEMINI_RECEIPT_PROMPT}
        </pre>
      </details>

      <div className="flex flex-col gap-1">
        <label htmlFor={inputId} className="text-base font-medium">
          {PASTE_COPY.inputLabel}
        </label>
        <p id={helpId} className="text-sm text-muted-foreground">
          {PASTE_COPY.inputHelp}
        </p>
        <textarea
          id={inputId}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setSubmitError(null);
          }}
          rows={10}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          aria-describedby={error ? `${helpId} ${errorId}` : helpId}
          aria-invalid={error ? true : undefined}
          className="w-full rounded-lg border border-border bg-surface p-3 font-mono text-sm text-foreground aria-invalid:border-danger"
        />
        {error ? (
          <p id={errorId} className="text-sm text-danger" role="alert">
            {error}
          </p>
        ) : null}
      </div>

      {touched && result.ok ? <Preview result={result} /> : null}

      {!online ? <p className="text-sm text-muted-foreground">{PASTE_COPY.offline}</p> : null}
      {submitError ? (
        <p className="text-sm text-danger" role="alert">
          {submitError}
        </p>
      ) : null}
      <Button
        size="action"
        onClick={() => void submit()}
        disabled={!result.ok || !online || sending || deferred !== text}
      >
        <Send aria-hidden />
        {sending ? PASTE_COPY.submitting : PASTE_COPY.submit}
      </Button>
    </section>
  );
}
