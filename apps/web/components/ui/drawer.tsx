'use client';
// Sheet bawah (S-03b, S-06, menu ⋯) berbasis vaul (Radix Dialog): gesture tarik, fokus terkunci (D-80).
import type { ComponentProps } from 'react';
import { Drawer as Vaul } from 'vaul';
import { cn } from '@/lib/utils';

export const Drawer = Vaul.Root;
export const DrawerTrigger = Vaul.Trigger;
export const DrawerClose = Vaul.Close;

export function DrawerContent({ className, children, ...props }: ComponentProps<typeof Vaul.Content>) {
  return (
    <Vaul.Portal>
      <Vaul.Overlay className="fixed inset-0 z-40 bg-black/40" />
      <Vaul.Content
        className={cn(
          'fixed inset-x-0 bottom-0 z-50 mt-24 flex max-h-[85dvh] flex-col rounded-t-2xl bg-surface pb-[env(safe-area-inset-bottom)]',
          className,
        )}
        {...props}
      >
        <div aria-hidden className="mx-auto mt-3 h-1.5 w-12 rounded-full bg-divider" />
        {children}
      </Vaul.Content>
    </Vaul.Portal>
  );
}

export function DrawerTitle({ className, ...props }: ComponentProps<typeof Vaul.Title>) {
  return <Vaul.Title className={cn('text-lg font-semibold', className)} {...props} />;
}

export function DrawerDescription({ className, ...props }: ComponentProps<typeof Vaul.Description>) {
  return <Vaul.Description className={cn('text-sm text-muted-foreground', className)} {...props} />;
}
