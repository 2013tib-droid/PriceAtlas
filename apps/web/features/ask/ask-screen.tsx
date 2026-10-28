'use client';
// S-20 Tanya (docs/07 §9, docs/08 §10, wireframe S-20, U-18, D-57). Dibuka dari baris "Tanya: …" di
// S-02 (`/tanya?q=`): pertanyaan dari URL langsung dikirim sekali (jika online), lalu URL dibersihkan
// supaya muat ulang tidak mengirim lagi. POST /api/ask tanpa streaming; keadaan "Mencari di
// historimu…" selama menunggu. Riwayat 20 tanya-jawab terakhir di IndexedDB user (💾), terhapus saat
// Keluar (D-84). Offline: kirim nonaktif + petunjuk, riwayat tetap terbaca, tidak ada antrean (§10.5).
import { ArrowLeft, ChevronRight, Send } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { StickyAction } from '@/components/app/sticky-action';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ASK_COPY, CATALOG_COPY, fill } from '@/lib/copy/id';
import {
  ASK_MAX_LENGTH,
  exampleQuestion,
  historyForRequest,
  postAsk,
  pushTurn,
  screenHref,
  type AskReply,
  type AskTurn,
} from '@/lib/ask/ask';
import { usePref } from '@/lib/hooks/use-pref';
import { useOnline } from '@/lib/hooks/use-online';
import { newCaptureId } from '@/lib/media/capture-id';
import { PREF_KEYS } from '@/lib/offline/prefs';
import { AskMessage, ExampleChips } from './ask-parts';

/** Teks yang diumumkan pembaca layar saat balasan datang (aria-live, docs/07 §1.11 no. 10). */
export function announcement(reply: AskTurn['reply']): string {
  switch (reply.kind) {
    case 'answer':
      return fill(ASK_COPY.answered, { text: reply.text });
    case 'not_enough':
      return reply.text;
    case 'out_of_scope':
      return ASK_COPY.outOfScope;
    case 'ambiguous':
      return `${ASK_COPY.ambiguous} ${reply.options.map((o) => o.label).join(', ')}`;
    case 'quota':
      return ASK_COPY.quota[reply.reason ?? 'other'];
    case 'failed':
      return ASK_COPY.failed;
    case 'coming_soon':
      return ASK_COPY.comingSoon;
  }
}

function SearchLink({ q }: { q: string }) {
  return (
    <Link
      href={screenHref({ id: 'S-02', kata_kunci: q }) ?? '/cari'}
      className="inline-flex h-touch items-center gap-1 self-start text-sm font-medium"
    >
      {fill(ASK_COPY.searchFor, { q })}
      <ChevronRight aria-hidden className="size-4" />
    </Link>
  );
}

export function AskScreen() {
  const router = useRouter();
  const params = useSearchParams();
  const q = (params?.get('q') ?? '').trim().slice(0, ASK_MAX_LENGTH);
  const online = useOnline();
  const history = usePref<AskTurn[]>(PREF_KEYS.askHistory, []);
  const [text, setText] = useState(q);
  const [pending, setPending] = useState<{ id: string; question: string } | null>(null);
  const [live, setLive] = useState('');
  const hintId = useId();
  const autoSent = useRef(false);
  const busy = useRef(false);
  const endRef = useRef<HTMLDivElement>(null);
  const turns = history.value;
  const examples = ASK_COPY.examples.map((e) => ({ label: e, question: exampleQuestion(q, e) }));

  const send = useCallback(
    async (raw: string) => {
      const question = raw.trim().slice(0, ASK_MAX_LENGTH);
      if (!question || busy.current || !navigator.onLine) return;
      busy.current = true;
      const id = newCaptureId();
      setPending({ id, question });
      setText('');
      setLive('');
      try {
        const reply = await postAsk(question, historyForRequest(history.value, ASK_COPY));
        await history.update((list) => pushTurn(list, { id, question, reply, at: Date.now() }));
        setLive(announcement(reply));
      } finally {
        busy.current = false;
        setPending(null);
      }
    },
    [history],
  );

  // Pertanyaan dari S-02: kirim sekali saat riwayat sudah terbaca dan online.
  useEffect(() => {
    if (!q || autoSent.current || !history.ready || !online) return;
    autoSent.current = true;
    router.replace('/tanya');
    void send(q);
  }, [q, history.ready, online, router, send]);

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: 'end' });
  }, [turns.length, pending]);

  const canSend = online && !pending && text.trim().length > 0;

  return (
    <section className="flex flex-col gap-4 p-4 pb-40" aria-labelledby="judul-layar">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={() => router.back()}>
          <ArrowLeft aria-hidden />
          <span className="sr-only">{CATALOG_COPY.record.back}</span>
        </Button>
        <h1 id="judul-layar" tabIndex={-1} className="text-2xl font-semibold">
          {ASK_COPY.title}
        </h1>
      </div>
      <p className="text-base text-muted-foreground">{ASK_COPY.intro}</p>

      {turns.length || pending ? (
        <ul className="flex flex-col gap-4" aria-label={ASK_COPY.conversation}>
          {turns.map((t) => (
            <AskMessage
              key={t.id}
              question={t.question}
              reply={t.reply}
              pickDisabled={!online || Boolean(pending)}
              onPick={(question) => void send(question)}
              onRetry={() => void send(t.question)}
              comingSoonExtra={t.reply.kind === 'coming_soon' ? <SearchLink q={t.question} /> : null}
            />
          ))}
          {pending ? <AskMessage question={pending.question} reply={{ kind: 'loading' } satisfies AskReply} /> : null}
        </ul>
      ) : null}
      <div ref={endRef} />
      {/* Jawaban baru diumumkan tanpa memindahkan fokus; riwayat yang dimuat tidak diumumkan. */}
      <p aria-live="polite" className="sr-only">
        {live}
      </p>

      {!turns.length && !pending ? <ExampleChips examples={examples} onPick={setText} /> : null}

      <StickyAction>
        <form
          className="flex w-full flex-col gap-1"
          onSubmit={(e) => {
            e.preventDefault();
            if (canSend) void send(text);
          }}
        >
          <label htmlFor="tanya-input" className="sr-only">
            {ASK_COPY.inputLabel}
          </label>
          <div className="flex gap-2">
            <Input
              id="tanya-input"
              type="text"
              enterKeyHint="send"
              maxLength={ASK_MAX_LENGTH}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={ASK_COPY.placeholder}
              aria-describedby={hintId}
              className="min-w-0 flex-1"
            />
            <Button type="submit" disabled={!canSend} aria-describedby={hintId}>
              <Send aria-hidden />
              {ASK_COPY.send}
            </Button>
          </div>
          <p id={hintId} className="text-xs text-muted-foreground">
            {online ? ASK_COPY.inputHint : ASK_COPY.offlineHint}
          </p>
        </form>
      </StickyAction>
    </section>
  );
}
