import type { ComponentProps } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold leading-5 whitespace-nowrap',
  {
    variants: {
      variant: {
        neutral: 'border-border bg-surface text-foreground',
        outline: 'border-border-strong bg-background text-muted-foreground',
        red: 'border-transparent bg-brand-red text-white',
        'red-soft': 'border-brand-red-border bg-brand-red-soft text-brand-red',
        success: 'border-transparent bg-success-soft text-success',
        warning: 'border-transparent bg-warning-soft text-warning',
      },
    },
    defaultVariants: {
      variant: 'neutral',
    },
  },
);

export type BadgeProps = ComponentProps<'span'> & VariantProps<typeof badgeVariants>;

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span data-slot="badge" className={cn(badgeVariants({ variant, className }))} {...props} />;
}
