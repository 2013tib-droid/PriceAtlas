'use client';
// Komponen S-20 (docs/07 §9, docs/08 §10.3): AskMessage (pertanyaan + balasan per keadaan wireframe),
// ToolSource ("Dijawab dengan: tool(…)" + tautan ke layar sumber), ExampleChips. Tautan dan dasar
// jawaban selalu dari output tool (server), tidak dari teks model.
import { ChevronRight, RotateCcw } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { DataCount } from '@/components/price/price';
import { Button } from '@/components/ui/button';
import { ASK_COPY, fill } from '@/lib/copy/id';
import { screenHref, toolLabel, type AskBasis, type AskReply, type AskScreenRef, type AskToolRef } from '@/lib/ask/ask';

export function ToolSource({ tool, screen }: { tool?: AskToolRef | null; screen?: AskScreenRef | null }) {
  const href = screen ? screenHref(screen) : null;
  if (!tool && !href) return null;
  return (
    <div className="flex flex-col gap-1">
      {href && screen ? (
        <Link href={href} className="inline-flex h-touch items-center gap-1 self-start text-sm font-medium">
          {ASK_COPY.screens[screen.id]}
          <ChevronRight aria-hidden className="size-4" />
        </Link>
      ) : null}
      {tool ? (
        <p className="text-xs text-muted-foreground">
          {ASK_COPY.answeredWith} <code className="font-mono">{toolLabel(tool)}</code>
        </p>
      ) : null}
    </div>
  );
}

function Basis({ basis }: { basis: AskBasis }) {
  if (basis.tanggal_terakhir) {
    return <DataCount count={basis.jumlah_data} lastDate={basis.tanggal_terakhir} className="text-sm" />;
  }
  return <span className="text-sm text-muted-foreground">{fill(ASK_COPY.basisCount, { n: basis.jumlah_data })}</span>;
}

export function ExampleChips({
  examples,
  onPick,
  title = ASK_COPY.examplesTitle,
  disabled = false,
}: {
  examples: readonly { label: string; question: string }[];
  onPick: (question: string) => void;
  title?: string;
  disabled?: boolean;
}) {
  return (
    <section aria-label={title} className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold text-muted-foreground">{title}</h2>
      <ul className="flex flex-wrap gap-2">
        {examples.map((e) => (
          <li key={e.question}>
            <button
              type="button"
              disabled={disabled}
              onClick={() => onPick(e.question)}
              className="inline-flex h-touch items-center rounded-full border border-border px-3 text-sm disabled:opacity-50"
            >
              {e.label}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ReplyBody({ reply, onPick, onRetry, comingSoonExtra, pickDisabled }: AskMessageProps) {
  switch (reply.kind) {
    case 'loading':
      return (
        <p role="status" className="text-base text-muted-foreground">
          {ASK_COPY.loading}
        </p>
      );
    case 'coming_soon':
      return (
        <>
          <p className="text-base">{ASK_COPY.comingSoon}</p>
          {comingSoonExtra}
        </>
      );
    case 'out_of_scope':
      return <p className="text-base">{ASK_COPY.outOfScope}</p>;
    case 'answer':
      return (
        <>
          <p className="text-base font-semibold">{reply.text}</p>
          <Basis basis={reply.basis} />
          <ToolSource tool={reply.tool} screen={reply.screen} />
        </>
      );
    case 'not_enough':
      return (
        <>
          <p className="text-base">{reply.text}</p>
          <ToolSource tool={reply.tool} screen={reply.screen} />
        </>
      );
    case 'ambiguous':
      return (
        <ExampleChips
          title={ASK_COPY.ambiguous}
          examples={reply.options}
          onPick={(q) => onPick?.(q)}
          disabled={pickDisabled}
        />
      );
    case 'quota':
      return <p className="text-base">{ASK_COPY.quota[reply.reason ?? 'other']}</p>;
    case 'failed':
      return (
        <>
          <p className="text-base">{ASK_COPY.failed}</p>
          {onRetry ? (
            <Button variant="secondary" className="self-start" onClick={onRetry} disabled={pickDisabled}>
              <RotateCcw aria-hidden />
              {ASK_COPY.retry}
            </Button>
          ) : null}
          {comingSoonExtra}
        </>
      );
  }
}

type AskMessageProps = {
  question: string;
  reply: AskReply;
  /** Chip produk ambigu dipilih. */
  onPick?: (question: string) => void;
  /** "Coba lagi" setelah gagal. */
  onRetry?: () => void;
  /** Chip/tombol nonaktif (offline atau sedang menunggu jawaban lain). */
  pickDisabled?: boolean;
  /** Isi tambahan di bawah "Segera hadir"/"Gagal" (tautan ke layar yang sudah ada). */
  comingSoonExtra?: ReactNode;
};

/** Satu giliran tanya-jawab (wireframe S-20: "Kamu: …" lalu balasan). */
export function AskMessage(props: AskMessageProps) {
  return (
    <li className="flex flex-col gap-3 border-b border-divider pb-4">
      <p className="text-base">
        <span className="font-semibold">{ASK_COPY.you}:</span> {props.question}
      </p>
      <div className="flex flex-col gap-2 rounded-lg bg-muted p-3">
        <p className="sr-only">{ASK_COPY.app}:</p>
        <ReplyBody {...props} />
      </div>
    </li>
  );
}
