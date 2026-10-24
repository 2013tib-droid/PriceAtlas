'use client';
// ConfirmTwice (docs/07 §7.2): aksi berisiko yang harus ditekan dua kali (merge beda ukuran U-16).
// Tekan pertama hanya "mempersenjatai" tombol dan menampilkan alasannya (aria-live); tekan kedua
// menjalankan aksi. Kembali ke awal jika `resetKey` berubah (mis. produk tujuan diganti).
import { useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';

export function ConfirmTwice({
  label,
  armedLabel,
  help,
  onConfirm,
  disabled,
  resetKey,
  testId,
}: {
  label: ReactNode;
  armedLabel: ReactNode;
  help: string;
  onConfirm: () => void;
  disabled?: boolean;
  resetKey?: string;
  testId?: string;
}) {
  const [armed, setArmed] = useState<string | null>(null);
  const key = resetKey ?? '';
  const isArmed = armed === key;
  return (
    <div className="flex flex-1 flex-col gap-1">
      {isArmed ? (
        <p role="status" className="text-sm text-danger">
          {help}
        </p>
      ) : null}
      <Button
        size="action"
        variant={isArmed ? 'danger' : 'primary'}
        disabled={disabled}
        data-testid={testId}
        data-armed={isArmed}
        onClick={() => (isArmed ? onConfirm() : setArmed(key))}
      >
        {isArmed ? armedLabel : label}
      </Button>
    </div>
  );
}
