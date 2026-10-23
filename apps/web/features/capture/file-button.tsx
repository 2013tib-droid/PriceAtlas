'use client';
// Tombol pilih file (<label> + <input type=file>, aktivasi asli; kamera bawaan dengan `capture`).
// Dipakai S-07 struk/screenshot dan kamera label (galeri).
import { useId, type ChangeEvent, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function FileButton({
  children,
  capture,
  multiple,
  disabled,
  onFiles,
  className,
  testId,
}: {
  children: ReactNode;
  capture?: boolean;
  multiple?: boolean;
  disabled?: boolean;
  onFiles: (files: File[]) => void;
  className?: string;
  testId: string;
}) {
  const id = useId();
  const onChange = (e: ChangeEvent<HTMLInputElement>) => {
    const files = [...(e.target.files ?? [])];
    e.target.value = '';
    if (files.length) onFiles(files);
  };
  return (
    <label
      htmlFor={id}
      aria-disabled={disabled || undefined}
      className={cn(
        'flex cursor-pointer flex-col items-center justify-center gap-1 text-sm font-medium has-focus-visible:outline-2 has-focus-visible:outline-focus',
        disabled && 'pointer-events-none opacity-50',
        className,
      )}
    >
      {children}
      <input
        id={id}
        type="file"
        accept="image/*"
        className="sr-only"
        disabled={disabled}
        data-testid={testId}
        {...(capture ? { capture: 'environment' as const } : {})}
        multiple={multiple}
        onChange={onChange}
      />
    </label>
  );
}
