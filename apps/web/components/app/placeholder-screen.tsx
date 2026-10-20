import type { ReactNode } from 'react';

/** Layar sementara M0: judul (fokus navigasi, §10.1) + penjelasan milestone. */
export function PlaceholderScreen({ title, body, children }: { title: string; body: string; children?: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 p-4" aria-labelledby="judul-layar">
      <h1 id="judul-layar" tabIndex={-1} className="text-2xl font-semibold">
        {title}
      </h1>
      <p className="text-base text-muted-foreground">{body}</p>
      {children}
    </section>
  );
}
