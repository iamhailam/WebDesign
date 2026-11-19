import type { ReactNode } from 'react';
import { EmptyState } from '@/components/commerce/empty-state';
import { ErrorState } from '@/components/commerce/error-state';
import { Pagination } from '@/components/commerce/pagination';
import { TableSkeleton } from '@/components/commerce/loading-skeleton';
import { cn } from '@/lib/utils';

export interface DataTableColumn<T> {
  key: string;
  header: string;
  align?: 'left' | 'right' | 'center' | undefined;
  className?: string | undefined;
  render: (row: T) => ReactNode;
}

export interface DataTableProps<T> {
  columns: readonly DataTableColumn<T>[];
  rows: readonly T[];
  rowKey: (row: T) => string | number;
  isLoading?: boolean | undefined;
  isError?: boolean | undefined;
  errorMessage?: string | undefined;
  onRetry?: (() => void) | undefined;
  emptyTitle?: string | undefined;
  emptyDescription?: string | undefined;
  pagination?:
    | {
        page: number;
        totalPages: number;
        total: number;
        onPageChange: (page: number) => void;
      }
    | undefined;
  caption?: string | undefined;
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  isLoading = false,
  isError = false,
  errorMessage,
  onRetry,
  emptyTitle = 'Không có dữ liệu phù hợp',
  emptyDescription = 'Hãy điều chỉnh bộ lọc hoặc từ khóa tìm kiếm.',
  pagination,
  caption,
}: DataTableProps<T>) {
  if (isLoading) {
    return <TableSkeleton rows={6} />;
  }

  if (isError) {
    return (
      <ErrorState
        message={errorMessage ?? 'Không thể tải dữ liệu từ máy chủ.'}
        onRetry={onRetry}
      />
    );
  }

  if (rows.length === 0) {
    return <EmptyState title={emptyTitle} description={emptyDescription} />;
  }

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <table className="w-full border-collapse text-left text-sm">
          {caption ? <caption className="sr-only">{caption}</caption> : null}
          <thead className="border-b border-border bg-surface text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <tr>
              {columns.map((col) => (
                <th
                  key={col.key}
                  scope="col"
                  className={cn(
                    'whitespace-nowrap px-4 py-3',
                    col.align === 'right' && 'text-right',
                    col.align === 'center' && 'text-center',
                    col.className,
                  )}
                >
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border bg-background">
            {rows.map((row) => (
              <tr key={rowKey(row)} className="hover:bg-surface/60">
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={cn(
                      'px-4 py-3 align-middle',
                      col.align === 'right' && 'text-right',
                      col.align === 'center' && 'text-center',
                      col.className,
                    )}
                  >
                    {col.render(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {pagination && pagination.totalPages > 1 ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            Tổng {pagination.total} bản ghi · Trang {pagination.page}/{pagination.totalPages}
          </p>
          <Pagination
            page={pagination.page}
            totalPages={pagination.totalPages}
            onPageChange={pagination.onPageChange}
          />
        </div>
      ) : pagination ? (
        <p className="text-xs text-muted-foreground">Tổng {pagination.total} bản ghi</p>
      ) : null}
    </div>
  );
}
