import { Fragment } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface BreadcrumbItem {
  label: string;
  to?: string | undefined;
}

export interface BreadcrumbProps {
  items: readonly BreadcrumbItem[];
  className?: string | undefined;
}

export function Breadcrumb({ items, className }: BreadcrumbProps) {
  if (items.length === 0) return null;

  return (
    <nav aria-label="Breadcrumb" data-slot="breadcrumb" className={cn('py-3', className)}>
      <ol className="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
        {items.map((item, idx) => {
          const isLast = idx === items.length - 1;
          return (
            <Fragment key={`${item.label}-${idx}`}>
              {idx > 0 ? <ChevronRight className="size-3.5 shrink-0 text-neutral-400" aria-hidden="true" /> : null}
              <li className="min-w-0 max-w-full">
                {isLast || !item.to ? (
                  <span
                    aria-current={isLast ? 'page' : undefined}
                    title={item.label}
                    className={cn(
                      'inline-block max-w-[220px] truncate align-bottom sm:max-w-xs',
                      isLast ? 'font-medium text-foreground' : 'text-muted-foreground',
                    )}
                  >
                    {item.label}
                  </span>
                ) : (
                  <Link
                    to={item.to}
                    title={item.label}
                    className="inline-block max-w-[160px] truncate align-bottom transition-colors hover:text-brand-red sm:max-w-none"
                  >
                    {item.label}
                  </Link>
                )}
              </li>
            </Fragment>
          );
        })}
      </ol>
    </nav>
  );
}
