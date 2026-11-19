import { useState } from 'react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';

export interface BrandCardItem {
  id: number;
  name: string;
  slug: string;
  description?: string | null | undefined;
  logo_path?: string | null | undefined;
}

export interface BrandCardProps {
  brand: BrandCardItem;
  className?: string | undefined;
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

export function BrandCard({ brand, className }: BrandCardProps) {
  const [logoError, setLogoError] = useState(false);
  const showLogo = Boolean(brand.logo_path) && !logoError;

  return (
    <Link
      data-slot="brand-card"
      to={`/brands/${brand.slug}`}
      className={cn(
        'group flex flex-col items-center justify-center gap-2.5 rounded-lg border border-border bg-card p-4 text-center transition-colors hover:border-brand-red-border hover:bg-surface-elevated',
        className,
      )}
    >
      <div className="flex h-14 w-full items-center justify-center overflow-hidden rounded-md bg-surface px-3">
        {showLogo ? (
          <img
            src={brand.logo_path ?? ''}
            alt={`Logo thương hiệu ${brand.name}`}
            loading="lazy"
            onError={() => setLogoError(true)}
            className="max-h-11 w-auto object-contain"
          />
        ) : (
          <span
            aria-hidden="true"
            className="text-base font-bold tracking-widest text-foreground group-hover:text-brand-red"
          >
            {getInitials(brand.name)}
          </span>
        )}
      </div>
      <div className="min-w-0 w-full space-y-0.5">
        <p className="truncate text-sm font-semibold text-foreground group-hover:text-brand-red">{brand.name}</p>
        {brand.description ? (
          <p className="truncate text-xs text-muted-foreground">{brand.description}</p>
        ) : null}
      </div>
    </Link>
  );
}
