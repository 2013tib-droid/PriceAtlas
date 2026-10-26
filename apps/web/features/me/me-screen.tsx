'use client';
// S-19 Saya (`/saya`, docs/07 §7.3, wireframe S-19): profil (nama tampilan, REST PATCH profile),
// Program member (ringkasan R21) → S-19b, Berbagi harga publik (R1) → S-19c, Privasi & data (retensi
// 12 bulan D-32, hapus akun) → /saya/privasi, Keluar (Q-61: peringatan jika antrean foto belum kosong,
// lalu semua data lokal dihapus). Sengaja tanpa total pengeluaran/anggaran (wireframe §1).
import { useQueryClient } from '@tanstack/react-query';
import { ChevronRight, LogOut } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useId, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useMyContext } from '@/lib/auth/context';
import { signOutAndClear, useAuth } from '@/lib/auth/session';
import { APP_COPY, fill, SETTINGS_COPY } from '@/lib/copy/id';
import { useMyPrograms } from '@/lib/data/confirm';
import { errorCopy } from '@/lib/data/errors';
import { usePatchDisplayName } from '@/lib/data/settings';
import { useOutboxItems } from '@/lib/offline/outbox-context';
import { signOutWarning, unsentPhotoCount } from '@/lib/settings/account';
import { memberSummary } from '@/lib/settings/programs';

const C = SETTINGS_COPY;
export const DISPLAY_NAME_MAX = 50;

export function MeScreen() {
  const auth = useAuth();
  const ctx = useMyContext();
  const programs = useMyPrograms();
  const share = ctx.data?.household.share_prices_public;
  return (
    <section className="flex flex-col gap-4 p-4 pb-8" aria-labelledby="judul-layar">
      <h1 id="judul-layar" tabIndex={-1} className="text-2xl font-semibold">
        {C.me.title}
      </h1>
      <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3">
        {auth.user?.email ? (
          <p className="text-base" data-testid="signed-in-as">
            {fill(APP_COPY.signedInAs, { email: auth.user.email })}
            {ctx.data ? ` · ${ctx.data.household.name}` : ''}
          </p>
        ) : null}
        {ctx.data ? <DisplayName current={ctx.data.display_name} /> : <Skeleton className="h-6 w-1/2" />}
      </div>

      <nav aria-labelledby="bagian-harga" className="flex flex-col gap-1">
        <h2 id="bagian-harga" className="text-sm font-medium text-muted-foreground">
          {C.me.pricesSection}
        </h2>
        <ul className="flex flex-col divide-y divide-divider rounded-lg border border-border bg-surface">
          <RowLink href="/saya/member" title={C.me.member} testId="me-member">
            {programs.data ? memberSummary(programs.data) : programs.isError ? null : <Skeleton className="h-4 w-32" />}
          </RowLink>
          <RowLink href="/saya/berbagi" title={C.me.share} testId="me-share">
            {share == null ? <Skeleton className="h-4 w-16" /> : share ? C.me.shareOn : C.me.shareOff}
          </RowLink>
        </ul>
      </nav>

      <nav aria-labelledby="bagian-privasi" className="flex flex-col gap-1">
        <h2 id="bagian-privasi" className="text-sm font-medium text-muted-foreground">
          {C.me.privacy}
        </h2>
        <ul className="flex flex-col divide-y divide-divider rounded-lg border border-border bg-surface">
          <li className="px-3 py-2 text-sm text-muted-foreground">{C.me.retention}</li>
          <RowLink href="/saya/privasi" title={C.me.deleteLink} testId="me-privacy" />
        </ul>
      </nav>

      <SignOutButton />
    </section>
  );
}

function RowLink({
  href,
  title,
  children,
  testId,
}: {
  href: string;
  title: string;
  children?: ReactNode;
  testId: string;
}) {
  return (
    <li>
      <Link href={href} className="flex min-h-touch items-center gap-3 px-3 py-2" data-testid={testId}>
        <span className="flex flex-1 flex-col">
          <span className="text-base font-medium">{title}</span>
          {children ? <span className="text-sm text-muted-foreground">{children}</span> : null}
        </span>
        <ChevronRight aria-hidden className="size-5 text-muted-foreground" />
      </Link>
    </li>
  );
}

function DisplayName({ current }: { current: string | null }) {
  const id = useId();
  const patch = usePatchDisplayName();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(current ?? '');
  const [error, setError] = useState<string | null>(null);
  if (!editing) {
    return (
      <div className="flex items-center gap-2">
        <p className="flex-1 text-base" data-testid="display-name">
          <span className="sr-only">{`${C.me.nameLabel}: `}</span>
          {current || <span className="text-muted-foreground">{C.me.nameEmpty}</span>}
        </p>
        <Button
          variant="ghost"
          onClick={() => {
            setValue(current ?? '');
            setError(null);
            setEditing(true);
          }}
        >
          {C.me.nameEdit}
        </Button>
      </div>
    );
  }
  const save = () => {
    if (value.trim().length > DISPLAY_NAME_MAX) return setError(C.me.nameTooLong);
    setError(null);
    patch.mutate(value, {
      onSuccess: () => {
        setEditing(false);
        toast.success(C.me.nameSaved);
      },
      onError: (e) => setError(errorCopy(e, 'S-19').message),
    });
  };
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <Label htmlFor={id}>{C.me.nameLabel}</Label>
      <Input
        id={id}
        autoComplete="nickname"
        value={value}
        maxLength={DISPLAY_NAME_MAX + 10}
        aria-invalid={Boolean(error)}
        onChange={(e) => setValue(e.target.value)}
      />
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      <div className="flex gap-2">
        <Button variant="secondary" onClick={() => setEditing(false)}>
          {C.me.nameCancel}
        </Button>
        <Button type="submit" disabled={patch.isPending}>
          {C.me.nameSave}
        </Button>
      </div>
    </form>
  );
}

/** Keluar (Q-61): antrean belum kosong → dialog peringatan dengan jumlah foto; lalu data lokal dihapus. */
export function SignOutButton() {
  const auth = useAuth();
  const qc = useQueryClient();
  const router = useRouter();
  const { items } = useOutboxItems();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const warning = signOutWarning(unsentPhotoCount(items));
  const run = async () => {
    setBusy(true);
    await signOutAndClear(auth.user?.id ?? null, qc);
    router.replace('/masuk');
  };
  return (
    <>
      <Button variant="secondary" size="action" disabled={busy} onClick={() => (warning ? setOpen(true) : void run())}>
        <LogOut aria-hidden />
        {busy ? C.signOut.busy : C.signOut.label}
      </Button>
      <Dialog open={open} onOpenChange={(v) => !busy && setOpen(v)}>
        <DialogContent>
          <div className="flex flex-col gap-4">
            <DialogTitle>{C.signOut.title}</DialogTitle>
            <DialogDescription data-testid="signout-warning">{warning}</DialogDescription>
            <p className="text-sm text-muted-foreground">{C.signOut.body}</p>
            <div className="flex gap-2">
              <Button variant="secondary" className="flex-1" onClick={() => setOpen(false)}>
                {C.signOut.cancel}
              </Button>
              <Button variant="danger" className="flex-1" disabled={busy} onClick={() => void run()}>
                {C.signOut.confirm}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
