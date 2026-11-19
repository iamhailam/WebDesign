import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';

export function ProductCardSkeleton() {
  return (
    <div className="flex flex-col overflow-hidden rounded-lg border border-border bg-card">
      <Skeleton className="aspect-square w-full rounded-none" />
      <div className="space-y-2.5 p-3.5">
        <Skeleton className="h-3 w-1/3" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-4/5" />
        <Skeleton className="mt-1 h-5 w-1/2" />
      </div>
    </div>
  );
}

export function ProductGridSkeleton({
  count = 8,
  className,
}: {
  count?: number | undefined;
  className?: string | undefined;
}) {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Đang tải danh sách sản phẩm"
      className={cn('grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4', className)}
    >
      {Array.from({ length: count }, (_, idx) => (
        <ProductCardSkeleton key={idx} />
      ))}
    </div>
  );
}

export function BrandGridSkeleton({ count = 5 }: { count?: number | undefined }) {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Đang tải thương hiệu"
      className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5"
    >
      {Array.from({ length: count }, (_, idx) => (
        <div key={idx} className="space-y-2.5 rounded-lg border border-border p-4">
          <Skeleton className="h-14 w-full" />
          <Skeleton className="mx-auto h-4 w-2/3" />
        </div>
      ))}
    </div>
  );
}

export function BannerSkeleton() {
  return (
    <div role="status" aria-busy="true" aria-label="Đang tải banner">
      <Skeleton className="aspect-[16/9] w-full rounded-lg sm:aspect-[21/9]" />
    </div>
  );
}

export function TableSkeleton({ rows = 5, cols = 5 }: { rows?: number | undefined; cols?: number | undefined }) {
  return (
    <div role="status" aria-busy="true" aria-label="Đang tải dữ liệu bảng" className="space-y-2 rounded-lg border border-border p-4">
      <Skeleton className="h-9 w-full" />
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="grid gap-3" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
          {Array.from({ length: cols }, (_, c) => (
            <Skeleton key={c} className="h-8 w-full" />
          ))}
        </div>
      ))}
    </div>
  );
}
