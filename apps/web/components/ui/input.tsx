import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

export function Input({ className, ...props }: ComponentProps<'input'>) {
  return (
    <input
      className={cn(
        'h-touch w-full rounded-lg border border-border bg-surface px-3 text-base text-foreground placeholder:text-muted-foreground disabled:opacity-60 aria-invalid:border-danger',
        className,
      )}
      {...props}
    />
  );
}
