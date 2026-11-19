import { cn } from '@/lib/utils';

export interface DiscountBadgeProps {
  percent: number;
  className?: string | undefined;
}

export function DiscountBadge({ percent, className }: DiscountBadgeProps) {
  if (!Number.isFinite(percent) || percent <= 0) return null;
  const rounded = Math.min(99, Math.max(1, Math.round(percent)));

  return (
    <span
      data-slot="discount-badge"
      aria-label={`Giảm ${rounded}%`}
      className={cn(
        'inline-flex items-center rounded-sm bg-brand-red px-2 py-0.5 text-xs font-bold tracking-tight text-white tabular-nums-vnd',
        className,
      )}
    >
      -{rounded}%
    </span>
  );
}
