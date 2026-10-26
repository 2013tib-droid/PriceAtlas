'use client';
// S-20 Tanya, kerangka (docs/07 §9, wireframe S-20, U-18): dibuka dari baris "Tanya: …" di S-02
// (`/tanya?q=`). Pertanyaan dari URL tampil sebagai "Kamu: …" dengan balasan "Segera hadir" dan
// tautan ke layar yang sudah menjawabnya. Tombol kirim nonaktif sampai Tahap 6 (D-57): tidak ada
// panggilan jaringan, dependensi Claude, atau API key di apps/web. Percakapan tidak disimpan.
import { ArrowLeft, ChevronRight, Send } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useId, useState } from 'react';
import { StickyAction } from '@/components/app/sticky-action';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ASK_COPY, CATALOG_COPY, fill } from '@/lib/copy/id';
import { ASK_MAX_LENGTH, exampleQuestion, screenHref } from '@/lib/ask/ask';
import { AskMessage, ExampleChips } from './ask-parts';

export function AskScreen() {
  const router = useRouter();
  const params = useSearchParams();
  const q = (params?.get('q') ?? '').trim().slice(0, ASK_MAX_LENGTH);
  const [text, setText] = useState(q);
  const hintId = useId();
  const examples = ASK_COPY.examples.map((e) => ({ label: e, question: exampleQuestion(q, e) }));

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

      {q ? (
        <ul className="flex flex-col gap-4" aria-live="polite">
          <AskMessage
            question={q}
            reply={{ kind: 'coming_soon' }}
            comingSoonExtra={
              <Link
                href={screenHref({ id: 'S-02', kata_kunci: q }) ?? '/cari'}
                className="inline-flex h-touch items-center gap-1 self-start text-sm font-medium"
              >
                {fill(ASK_COPY.searchFor, { q })}
                <ChevronRight aria-hidden className="size-4" />
              </Link>
            }
          />
        </ul>
      ) : null}

      <ExampleChips examples={examples} onPick={setText} />

      <StickyAction>
        <form
          className="flex w-full flex-col gap-1"
          onSubmit={(e) => {
            // Tahap 6: POST /api/ask (D-61). Di Tahap 5 tidak ada yang dikirim.
            e.preventDefault();
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
            <Button type="submit" disabled aria-describedby={hintId}>
              <Send aria-hidden />
              {ASK_COPY.send}
            </Button>
          </div>
          <p id={hintId} className="text-xs text-muted-foreground">
            {ASK_COPY.comingSoon}
          </p>
        </form>
      </StickyAction>
    </section>
  );
}
