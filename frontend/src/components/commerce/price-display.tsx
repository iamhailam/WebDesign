import { formatVnd } from '@/lib/commerce-utils';
import { cn } from '@/lib/utils';

export interface PriceDisplayProps {
  price?: string | undefined;
  priceMin?: string | undefined;
  priceMax?: string | undefined;
  listPrice?: string | null | undefined;
  size?: 'sm' | 'md' | 'lg' | undefined;
  className?: string | undefined;
}

export function PriceDisplay({
  price,
  priceMin,
  priceMax,
  listPrice,
  size = 'md',
  className,
}: PriceDisplayProps) {
  const sizeClass =
    size === 'lg' ? 'text-xl sm:text-2xl' : size === 'sm' ? 'text-sm' : 'text-base sm:text-[17px]';

  if (price !== undefined) {
    const priceNum = Number(price);
    const listNum = listPrice !== null && listPrice !== undefined ? Number(listPrice) : null;
    const hasCompare = listNum !== null && Number.isFinite(listNum) && listNum > priceNum;

    return (
      <div data-slot="price-display" className={cn('tabular-nums-vnd flex flex-wrap items-baseline gap-2', className)}>
        <span className={cn('font-semibold text-brand-red', sizeClass)}>{formatVnd(priceNum)}</span>
        {hasCompare ? (
          <span className="text-xs text-muted-foreground line-through sm:text-sm" aria-label={`Giá gốc ${formatVnd(listNum)}`}>
            {formatVnd(listNum)}
          </span>
        ) : null}
      </div>
    );
  }

  const minVal = priceMin ?? '0.00';
  const maxVal = priceMax ?? minVal;
  const isRange = Number(maxVal) > Number(minVal);

  return (
    <div data-slot="price-display" className={cn('tabular-nums-vnd flex flex-wrap items-baseline gap-1.5', className)}>
      <span className={cn('font-semibold text-brand-red', sizeClass)}>
        {isRange ? `${formatVnd(minVal)} – ${formatVnd(maxVal)}` : formatVnd(minVal)}
      </span>
    </div>
  );
}
