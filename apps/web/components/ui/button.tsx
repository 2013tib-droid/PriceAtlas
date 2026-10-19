import { cva, type VariantProps } from 'class-variance-authority';
import { Slot } from 'radix-ui';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

// Target sentuh ≥ 44 px (h-touch); aksi utama ≥ 48 px dan lebar penuh (h-action) (docs/07 §10.1).
export const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 rounded-lg text-base font-medium whitespace-nowrap transition-colors disabled:pointer-events-none disabled:opacity-60 [&_svg]:size-5 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        primary: 'bg-primary text-primary-foreground hover:bg-primary/90',
        secondary: 'border border-border bg-surface text-foreground hover:bg-muted',
        ghost: 'text-foreground hover:bg-muted',
        link: 'text-foreground underline underline-offset-4',
        danger: 'bg-danger text-primary-foreground hover:bg-danger/90',
      },
      size: {
        default: 'h-touch px-4',
        action: 'h-action w-full px-4',
        icon: 'size-touch',
      },
    },
    defaultVariants: { variant: 'primary', size: 'default' },
  },
);

export interface ButtonProps extends ComponentProps<'button'>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export function Button({ className, variant, size, asChild = false, type, ...props }: ButtonProps) {
  const Comp = asChild ? Slot.Root : 'button';
  return (
    <Comp
      className={cn(buttonVariants({ variant, size }), className)}
      {...(asChild ? {} : { type: type ?? 'button' })}
      {...props}
    />
  );
}
