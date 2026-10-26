'use client';
// S-19 Privasi & data (`/saya/privasi`, docs/07 §3.5, §7.3, §8.2; docs/05 §7.6; D-32, D-76, Q-61):
// info retensi 12 bulan, lalu hapus akun dalam tiga langkah di halaman yang sama:
//   1. login ulang OTP ke email akun (memperbarui last_sign_in_at; route mewajibkan ≤ 15 menit),
//   2. ketik `HAPUS AKUN` (ACCOUNT_DELETE_CONFIRMATION),
//   3. ConfirmTwice → `POST /api/account/delete` (route server satu-satunya yang menulis, D-76).
// 202 → keluar + hapus semua data lokal → /masuk. REAUTH_REQUIRED → kembali ke langkah 1.
// DELETE_FAILED / DELETE_INCOMPLETE → "Coba lagi" (langkah server idempoten).
import { ACCOUNT_DELETE_CONFIRMATION } from '@priceatlas/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useState } from 'react';
import { ConfirmTwice } from '@/components/app/confirm-twice';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { authErrorMessage, RESEND_COOLDOWN_SECONDS } from '@/lib/auth/otp-errors';
import { signOutAndClear, useAuth } from '@/lib/auth/session';
import { AUTH_COPY, fill, GENERIC_COPY, SETTINGS_COPY } from '@/lib/copy/id';
import { requestAccountDeletion } from '@/lib/data/settings';
import { flashToast } from '@/lib/flash';
import { useOnline } from '@/lib/hooks/use-online';
import { useOutboxItems } from '@/lib/offline/outbox-context';
import { deleteOutcome, isDeleteConfirmed, signOutWarning, unsentPhotoCount } from '@/lib/settings/account';
import { getSupabaseBrowserClient } from '@/lib/supabase/browser';
import { SubScreen } from './sub-screen';

const C = SETTINGS_COPY.privacy;

export function PrivacyScreen() {
  return (
    <SubScreen title={C.title}>
      <section aria-labelledby="retensi" className="flex flex-col gap-1">
        <h2 id="retensi" className="text-base font-semibold">
          {C.retentionTitle}
        </h2>
        <ul className="list-disc pl-5 text-base">
          {C.retention.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      </section>
      <DeleteAccount />
    </SubScreen>
  );
}

type Step = 'start' | 'code' | 'confirm';

function DeleteAccount() {
  const ids = { code: useId(), text: useId() };
  const auth = useAuth();
  const qc = useQueryClient();
  const router = useRouter();
  const online = useOnline();
  const { items } = useOutboxItems();
  const email = auth.user?.email ?? null;
  const [step, setStep] = useState<Step>('start');
  const [code, setCode] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState<null | 'send' | 'verify' | 'delete'>(null);
  const [error, setError] = useState<string | null>(null);
  const [sentAt, setSentAt] = useState<number | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const warning = signOutWarning(unsentPhotoCount(items));

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  async function sendCode() {
    if (!email) return;
    setError(null);
    setBusy('send');
    // Akun sudah ada: shouldCreateUser false supaya salah ketik tidak membuat user baru.
    const { error: err } = await getSupabaseBrowserClient().auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false },
    });
    setBusy(null);
    if (err) return setError(authErrorMessage(err, { step: 'send' }));
    setSentAt(Date.now());
    setCooldown(RESEND_COOLDOWN_SECONDS);
    setCode('');
    setStep('code');
  }

  async function verify() {
    if (!email) return;
    setError(null);
    const token = code.replace(/\D/g, '');
    if (token.length !== 6) return setError(AUTH_COPY.codeInvalidFormat);
    setBusy('verify');
    const { error: err } = await getSupabaseBrowserClient().auth.verifyOtp({ email, token, type: 'email' });
    setBusy(null);
    if (err) return setError(authErrorMessage(err, { step: 'verify', sentAt }));
    setStep('confirm');
  }

  async function remove() {
    setError(null);
    setBusy('delete');
    let outcome;
    try {
      const res = await requestAccountDeletion(ACCOUNT_DELETE_CONFIRMATION);
      outcome = deleteOutcome(res.status, res.body);
    } catch {
      outcome = { kind: 'retry' as const, message: GENERIC_COPY.network.message };
    }
    if (outcome.kind === 'done') {
      await signOutAndClear(auth.user?.id ?? null, qc);
      flashToast('success', C.done);
      router.replace('/masuk');
      return;
    }
    setBusy(null);
    setError(outcome.message);
    setAttempt((n) => n + 1);
    if (outcome.kind === 'reauth') {
      setText('');
      setStep('start');
    }
  }

  return (
    <section aria-labelledby="hapus-akun" className="flex flex-col gap-3 rounded-lg border border-danger p-3">
      <h2 id="hapus-akun" className="text-base font-semibold">
        {C.deleteTitle}
      </h2>
      <p className="text-base">{C.deleteBody}</p>
      {warning ? (
        <p className="rounded-lg bg-warning p-3 text-sm text-warning-foreground" data-testid="delete-queue-warning">
          {warning}
        </p>
      ) : null}
      <div role="alert" aria-live="assertive" className="min-h-0 text-base text-danger" data-testid="delete-error">
        {!online ? GENERIC_COPY.network.message : error}
      </div>

      {!email ? <p className="text-sm">{C.noEmail}</p> : null}

      {email && step === 'start' ? (
        <>
          <p className="text-base">{fill(C.step1, { email })}</p>
          <Button variant="secondary" size="action" disabled={busy !== null || !online} onClick={() => void sendCode()}>
            {busy === 'send' ? C.sending : C.sendCode}
          </Button>
        </>
      ) : null}

      {email && step === 'code' ? (
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void verify();
          }}
        >
          <p className="text-base">{fill(AUTH_COPY.codeSentTo, { email })}</p>
          <div className="flex flex-col gap-1">
            <Label htmlFor={ids.code}>{C.codeLabel}</Label>
            <Input
              id={ids.code}
              name="otp"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]*"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              className="text-center text-2xl tracking-[0.5em]"
            />
          </div>
          <Button type="submit" size="action" disabled={busy !== null || !online}>
            {busy === 'verify' ? C.verifying : C.verify}
          </Button>
          <Button variant="ghost" disabled={busy !== null || cooldown > 0 || !online} onClick={() => void sendCode()}>
            {cooldown > 0 ? fill(C.resendIn, { s: cooldown }) : C.resend}
          </Button>
        </form>
      ) : null}

      {email && step === 'confirm' ? (
        <div className="flex flex-col gap-3">
          <p className="text-base font-medium">{C.verified}</p>
          <div className="flex flex-col gap-1">
            <Label htmlFor={ids.text}>{C.typeLabel}</Label>
            <Input
              id={ids.text}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              value={text}
              onChange={(e) => setText(e.target.value)}
              aria-describedby={`${ids.text}-help`}
            />
            <p id={`${ids.text}-help`} className="text-sm text-muted-foreground">
              {C.typeHelp}
            </p>
          </div>
          <ConfirmTwice
            label={busy === 'delete' ? C.deleting : C.delete}
            armedLabel={busy === 'delete' ? C.deleting : C.deleteArmed}
            help={C.deleteArmedHelp}
            disabled={!isDeleteConfirmed(text) || busy !== null || !online}
            resetKey={`${text}:${attempt}`}
            onConfirm={() => void remove()}
            testId="delete-account"
          />
        </div>
      ) : null}
    </section>
  );
}
