'use client';
// Toggle (S-00c, S-19b, S-19c) berbasis Radix Switch: role="switch" + aria-checked, target sentuh
// ≥ 44 px (docs/07 §10.1). Status juga ditulis sebagai teks oleh pemanggil (U-15).
import { Switch as SwitchPrimitive } from 'radix-ui';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

export function Switch({ className, ...props }: ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        'relative inline-flex h-touch w-16 shrink-0 cursor-pointer items-center rounded-full p-1.5 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50',
        'before:absolute before:inset-x-1.5 before:inset-y-2.5 before:rounded-full before:bg-muted before:transition-colors data-[state=checked]:before:bg-primary',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb className="relative z-10 block size-6 rounded-full border border-border bg-surface shadow transition-transform data-[state=checked]:translate-x-6" />
    </SwitchPrimitive.Root>
  );
}
