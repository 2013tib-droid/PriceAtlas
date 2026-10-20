'use client';
// S-00a Masuk (docs/07 §3.5, §7.3): email → kode OTP 6 digit → R1 get_my_context → tujuan.
// Hanya kode (tanpa magic link, D-83, P-05). Google sebagai opsi kedua (PKCE, /auth/callback).
import { useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { myContextQuery } from '@/lib/auth/context';
import { authErrorMessage, RESEND_COOLDOWN_SECONDS } from '@/lib/auth/otp-errors';
import { safeNext } from '@/lib/auth/redirect';
import { useAuth } from '@/lib/auth/session';
import { AUTH_COPY, fill } from '@/lib/copy/id';
import { errorCopy } from '@/lib/data/errors';
import { useOnline } from '@/lib/hooks/use-online';
import { getSupabaseBrowserClient } from '@/lib/supabase/browser';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function SignInScreen() {
  const router = useRouter();
  const search = useSearchParams();
  const next = safeNext(search?.get('next'));
  const queryClient = useQueryClient();
  const auth = useAuth();
  const online = useOnline();
  const ids = { email: useId(), code: useId(), error: useId() };

  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<null | 'send' | 'verify' | 'context' | 'google'>(null);
  const [error, setError] = useState<string | null>(
    search?.get('error') === 'callback' ? AUTH_COPY.callbackFailed : null,
  );
  const [sentAt, setSentAt] = useState<number | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const codeRef = useRef<HTMLInputElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  // Sudah masuk (mis. tab lain) → langsung ke tujuan.
  useEffect(() => {
    if (auth.status === 'signed-in' && busy === null) router.replace(next);
  }, [auth.status, busy, next, router]);

  useEffect(() => {
    if (step === 'code') codeRef.current?.focus();
    else headingRef.current?.focus();
  }, [step]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  async function sendCode() {
    setError(null);
    if (!EMAIL_RE.test(email.trim())) return setError(AUTH_COPY.emailInvalid);
    setBusy('send');
    const { error: err } = await getSupabaseBrowserClient().auth.signInWithOtp({
      email: email.trim(),
      options: { shouldCreateUser: true },
    });
    setBusy(null);
    if (err) return setError(authErrorMessage(err, { step: 'send' }));
    setSentAt(Date.now());
    setCooldown(RESEND_COOLDOWN_SECONDS);
    setCode('');
    setStep('code');
  }

  async function verify() {
    setError(null);
    const token = code.replace(/\D/g, '');
    if (token.length !== 6) return setError(AUTH_COPY.codeInvalidFormat);
    setBusy('verify');
    const { error: err } = await getSupabaseBrowserClient().auth.verifyOtp({
      email: email.trim(),
      token,
      type: 'email',
    });
    if (err) {
      setBusy(null);
      return setError(authErrorMessage(err, { step: 'verify', sentAt }));
    }
    // R1 setelah login (§3.5): household_id dan timezone dibutuhkan semua layar.
    setBusy('context');
    try {
      await queryClient.fetchQuery(myContextQuery);
    } catch (e) {
      setBusy(null);
      return setError(errorCopy(e, 'S-00a').message);
    }
    router.replace(next);
  }

  async function google() {
    setError(null);
    setBusy('google');
    const { error: err } = await getSupabaseBrowserClient().auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}` },
    });
    if (err) {
      setBusy(null);
      setError(AUTH_COPY.callbackFailed);
    }
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void (step === 'email' ? sendCode() : verify());
  };
  const disabled = busy !== null || !online;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-end gap-6 p-4 pb-[calc(env(safe-area-inset-bottom)+1.5rem)]">
      <header className="flex flex-col gap-2">
        <h1 ref={headingRef} tabIndex={-1} className="text-2xl font-semibold">
          {step === 'email' ? AUTH_COPY.title : AUTH_COPY.codeTitle}
        </h1>
        <p className="text-base text-muted-foreground">
          {step === 'email' ? AUTH_COPY.intro : fill(AUTH_COPY.codeSentTo, { email: email.trim() })}
        </p>
      </header>

      <div role="alert" aria-live="assertive" id={ids.error} className="min-h-6 text-base text-danger">
        {!online ? AUTH_COPY.offline : error}
      </div>

      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        {step === 'email' ? (
          <div className="flex flex-col gap-2">
            <Label htmlFor={ids.email}>{AUTH_COPY.emailLabel}</Label>
            <Input
              id={ids.email}
              type="email"
              inputMode="email"
              autoComplete="email"
              autoCapitalize="none"
              spellCheck={false}
              placeholder={AUTH_COPY.emailPlaceholder}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-invalid={error === AUTH_COPY.emailInvalid || undefined}
              aria-describedby={ids.error}
              required
            />
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <Label htmlFor={ids.code}>{AUTH_COPY.codeLabel}</Label>
            <Input
              ref={codeRef}
              id={ids.code}
              name="otp"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]*"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              aria-describedby={ids.error}
              className="h-action text-center text-2xl tracking-[0.5em]"
              required
            />
          </div>
        )}

        <Button type="submit" size="action" disabled={disabled}>
          {busy === 'send' || busy === 'verify' || busy === 'context' ? (
            <Loader2 aria-hidden className="animate-spin" />
          ) : null}
          {step === 'email'
            ? busy === 'send'
              ? AUTH_COPY.sending
              : AUTH_COPY.sendCode
            : busy === 'verify' || busy === 'context'
              ? AUTH_COPY.verifying
              : AUTH_COPY.verify}
        </Button>
      </form>

      {step === 'code' ? (
        <div className="flex flex-col gap-2">
          <Button variant="secondary" size="action" disabled={disabled || cooldown > 0} onClick={() => void sendCode()}>
            {cooldown > 0 ? fill(AUTH_COPY.resendIn, { s: cooldown }) : AUTH_COPY.resend}
          </Button>
          <Button
            variant="ghost"
            size="action"
            disabled={busy !== null}
            onClick={() => {
              setStep('email');
              setError(null);
            }}
          >
            {AUTH_COPY.changeEmail}
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <p className="text-center text-sm text-muted-foreground">{AUTH_COPY.or}</p>
          <Button variant="secondary" size="action" disabled={disabled} onClick={() => void google()}>
            {AUTH_COPY.google}
          </Button>
          <p className="text-sm text-muted-foreground">{AUTH_COPY.googleNote}</p>
        </div>
      )}
    </main>
  );
}
