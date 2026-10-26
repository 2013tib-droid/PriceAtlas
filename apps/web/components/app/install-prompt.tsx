'use client';
// Ajakan "Pasang ke layar utama" di iOS, sekali setelah foto pertama, bisa ditutup (D-81, Q-62,
// P-04). FirstPhotoWatcher terpasang di Providers (juga saat kamera layar penuh terbuka): saat
// antrean pertama kali berisi foto, minta `storage.persist()` dan simpan status di prefs.
import { Share, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { APP_COPY } from '@/lib/copy/id';
import { usePref } from '@/lib/hooks/use-pref';
import {
  firstPhotoPref,
  readInstallEnv,
  requestPersistentStorage,
  shouldShowInstallPrompt,
  type InstallEnv,
  type InstallPromptPref,
} from '@/lib/offline/install';
import { useOutboxItems } from '@/lib/offline/outbox-context';
import { PREF_KEYS } from '@/lib/offline/prefs';

export function FirstPhotoWatcher() {
  const { items, ready } = useOutboxItems();
  const pref = usePref<InstallPromptPref | null>(PREF_KEYS.installPrompt, null);
  const { update } = pref;
  const first = ready && pref.ready && pref.value === null && items.length > 0;
  useEffect(() => {
    if (!first) return;
    void requestPersistentStorage();
    void update((prev) => prev ?? firstPhotoPref(readInstallEnv()));
  }, [first, update]);
  return null;
}

export function InstallPrompt() {
  const pref = usePref<InstallPromptPref | null>(PREF_KEYS.installPrompt, null);
  const [env, setEnv] = useState<InstallEnv | null>(null);
  // navigator hanya ada di browser; shell statis dirender tanpa ajakan.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setEnv(readInstallEnv()), []);
  if (!env || !shouldShowInstallPrompt(pref.value, env)) return null;
  return (
    <aside
      aria-labelledby="ajakan-pasang"
      className="mx-4 mt-3 flex items-start gap-3 rounded-lg border border-border bg-surface p-3"
    >
      <Share aria-hidden className="mt-0.5 size-5 shrink-0" />
      <div className="flex flex-1 flex-col gap-1">
        <h2 id="ajakan-pasang" className="text-base font-semibold">
          {APP_COPY.install.title}
        </h2>
        <p className="text-sm">{APP_COPY.install.body}</p>
      </div>
      <Button variant="ghost" size="icon" onClick={() => void pref.update(() => 'dismissed')}>
        <X aria-hidden />
        <span className="sr-only">{APP_COPY.install.dismiss}</span>
      </Button>
    </aside>
  );
}
