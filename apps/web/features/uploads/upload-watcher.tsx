'use client';
// Pemantau status unggahan di semua layar (U-11, docs/07 §5.5): perubahan penting (perlu dicek,
// selesai, gagal) diumumkan lewat aria-live="polite" + toast tanpa memblokir. R13 yang sama dengan
// S-08 ("Semua"), sehingga polling 5 dtk hanya satu. Item antrean lokal yang sudah terdaftar dihapus
// setelah R13 memuatnya (§5.4 langkah 5).
import type { CaptureListItem } from '@priceatlas/contracts';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useCaptures } from '@/lib/data/captures';
import { useOutboxItems } from '@/lib/offline/outbox-context';
import { statusAnnouncement } from './capture-text';

export function UploadWatcher() {
  const captures = useCaptures(null);
  const { outbox, items } = useOutboxItems();
  const prev = useRef<Map<string, CaptureListItem['status']> | null>(null);
  const [message, setMessage] = useState('');

  useEffect(() => {
    const data = captures.data;
    if (!data) return;
    const before = prev.current;
    prev.current = new Map(data.map((c) => [c.id, c.status]));
    if (!before) return; // muat pertama: tidak ada yang diumumkan
    const said = data.map((c) => statusAnnouncement(before.get(c.id), c)).filter((m): m is string => Boolean(m));
    if (said.length === 0) return;
    for (const m of said) toast(m);
    // Teks live region mengikuti data dari server (sistem luar).
    setMessage(said.join(' '));
  }, [captures.data]);

  useEffect(() => {
    if (!outbox || !captures.data) return;
    const listed = new Set(captures.data.map((c) => c.id));
    for (const i of items) if (i.state === 'submitted' && listed.has(i.capture_id)) void outbox.remove(i.capture_id);
  }, [outbox, items, captures.data]);

  return (
    <div role="status" aria-live="polite" className="sr-only" data-testid="upload-announcer">
      {message}
    </div>
  );
}
