import type { ComponentProps } from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-md text-sm font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/90',
        brand: 'bg-brand-red text-white hover:bg-brand-red-hover',
        outline: 'border border-border-strong bg-background text-foreground hover:bg-surface',
        secondary: 'bg-surface text-foreground hover:bg-secondary',
        ghost: 'text-foreground hover:bg-surface',
        destructive: 'bg-destructive text-white hover:bg-brand-red-hover',
        link: 'min-h-0 px-0 text-foreground underline-offset-4 hover:text-brand-red hover:underline',
      },
      size: {
        default: 'px-4 py-2.5',
        sm: 'min-h-11 px-3 py-2 text-xs sm:text-sm',
        lg: 'min-h-12 px-6 py-3 text-base',
        icon: 'min-h-11 min-w-11 p-2.5',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

export type ButtonProps = ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  };

export function Button({ className, variant, size, asChild = false, ...props }: ButtonProps) {
  const Component = asChild ? Slot : 'button';
  return (
    <Component
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...(!asChild && { type: 'button' })}
      {...props}
    />
  );
}
