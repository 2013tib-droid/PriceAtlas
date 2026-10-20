'use client';
// Toggle dua/tiga pilihan (90 hari / sepanjang masa, produk / group). Radio group asli: bisa
// dipakai keyboard dan pembaca layar tanpa pustaka tambahan.
import { useId } from 'react';
import { cn } from '@/lib/utils';

export function Segmented<V extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: V;
  onChange: (value: V) => void;
  options: readonly { value: V; label: string; disabled?: boolean }[];
}) {
  const name = useId();
  return (
    <fieldset className="flex flex-col gap-1">
      <legend className="sr-only">{label}</legend>
      <div className="flex rounded-lg border border-border p-0.5">
        {options.map((o) => (
          <label
            key={o.value}
            className={cn(
              'flex h-touch flex-1 cursor-pointer items-center justify-center rounded-md px-2 text-sm font-medium has-focus-visible:outline-2 has-focus-visible:outline-focus',
              value === o.value ? 'bg-primary text-primary-foreground' : 'text-foreground',
              o.disabled && 'cursor-not-allowed opacity-60',
            )}
          >
            <input
              type="radio"
              name={name}
              value={o.value}
              checked={value === o.value}
              disabled={o.disabled}
              onChange={() => onChange(o.value)}
              className="sr-only"
            />
            {o.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
