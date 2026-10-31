'use client';
// Klien: picu worker produksi tanpa menunggu (docs/09 §3.3, F-191). Dipanggil setelah W1b
// submit_text_capture (S-21) dan W2 retry_capture ("Ulangi" di S-09/S-08). Semua kegagalan diabaikan:
// worker harian tetap memproses capture, dan S-09 sudah polling status (P-15). `keepalive` supaya
// permintaan tetap terkirim walau layar langsung berpindah.
export const KICK_PATH = '/api/worker/kick';

export function kickWorker(): void {
  try {
    void fetch(KICK_PATH, { method: 'POST', keepalive: true, credentials: 'same-origin' }).catch(() => undefined);
  } catch {
    // fetch tidak tersedia / dilempar sinkron: abaikan.
  }
}
