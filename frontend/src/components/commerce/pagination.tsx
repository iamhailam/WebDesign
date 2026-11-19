import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

export interface PaginationProps {
  page: number;
  totalPages: number;
  totalItems?: number | undefined;
  onPageChange: (nextPage: number) => void;
  className?: string | undefined;
}

function getPageTokens(current: number, total: number): Array<number | 'ellipsis-left' | 'ellipsis-right'> {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }
  const tokens: Array<number | 'ellipsis-left' | 'ellipsis-right'> = [1];
  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);

  if (start > 2) tokens.push('ellipsis-left');
  for (let p = start; p <= end; p++) tokens.push(p);
  if (end < total - 1) tokens.push('ellipsis-right');
  tokens.push(total);
  return tokens;
}

export function Pagination({ page, totalPages, totalItems, onPageChange, className }: PaginationProps) {
  if (totalPages <= 1) return null;

  const tokens = getPageTokens(page, totalPages);

  return (
    <nav
      aria-label="Phân trang"
      data-slot="pagination"
      className={cn('flex flex-col items-center justify-between gap-3 pt-4 sm:flex-row', className)}
    >
      <p className="text-sm text-muted-foreground">
        Trang <span className="font-semibold text-foreground">{page}</span> / {totalPages}
        {totalItems !== undefined ? ` (${totalItems} mục)` : ''}
      </p>

      <div className="flex flex-wrap items-center justify-center gap-1.5">
        <Button
          variant="outline"
          size="sm"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          aria-label="Trang trước"
          className="min-w-11"
        >
          <ChevronLeft className="size-4" aria-hidden="true" />
          <span className="hidden sm:inline">Trước</span>
        </Button>

        {tokens.map((token) =>
          typeof token === 'number' ? (
            <Button
              key={token}
              variant={token === page ? 'brand' : 'outline'}
              size="sm"
              aria-current={token === page ? 'page' : undefined}
              aria-label={`Trang ${token}`}
              onClick={() => {
                if (token !== page) onPageChange(token);
              }}
              className="min-w-11 px-3"
            >
              {token}
            </Button>
          ) : (
            <span key={token} aria-hidden="true" className="px-2 text-sm text-muted-foreground">
              …
            </span>
          ),
        )}

        <Button
          variant="outline"
          size="sm"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
          aria-label="Trang sau"
          className="min-w-11"
        >
          <span className="hidden sm:inline">Sau</span>
          <ChevronRight className="size-4" aria-hidden="true" />
        </Button>
      </div>
    </nav>
  );
}
