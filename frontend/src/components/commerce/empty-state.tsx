import type { ReactNode } from 'react';
import { PackageOpen, SearchX, ShoppingBag } from 'lucide-react';
import { cn } from '@/lib/utils';

export type EmptyStateVariant = 'catalog' | 'filter' | 'cart' | 'orders';

export interface EmptyStateProps {
  variant?: EmptyStateVariant | undefined;
  title: string;
  description: string;
  action?: ReactNode | undefined;
  className?: string | undefined;
}

function EmptyIcon({ variant }: { variant: EmptyStateVariant }) {
  switch (variant) {
    case 'filter':
      return <SearchX className="size-10 text-muted-foreground stroke-[1.5]" aria-hidden="true" />;
    case 'cart':
      return <ShoppingBag className="size-10 text-muted-foreground stroke-[1.5]" aria-hidden="true" />;
    default:
      return <PackageOpen className="size-10 text-muted-foreground stroke-[1.5]" aria-hidden="true" />;
  }
}

export function EmptyState({
  variant = 'catalog',
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <section
      data-slot="empty-state"
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border-strong bg-surface-elevated px-6 py-12 text-center',
        className,
      )}
    >
      <div className="flex size-16 items-center justify-center rounded-full bg-surface">
        <EmptyIcon variant={variant} />
      </div>
      <div className="max-w-md space-y-1.5">
        <h3 className="text-base font-semibold text-foreground">{title}</h3>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      {action ? <div className="pt-2">{action}</div> : null}
    </section>
  );
}
