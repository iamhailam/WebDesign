import type { ReactNode } from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

export interface ErrorStateProps {
  title?: string | undefined;
  message: string;
  code?: string | undefined;
  onRetry?: (() => void) | undefined;
  action?: ReactNode | undefined;
  className?: string | undefined;
}

export function ErrorState({
  title = 'Đã xảy ra sự cố khi tải dữ liệu',
  message,
  code,
  onRetry,
  action,
  className,
}: ErrorStateProps) {
  return (
    <section
      role="alert"
      data-slot="error-state"
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-lg border border-brand-red-border bg-brand-red-soft/50 px-6 py-10 text-center',
        className,
      )}
    >
      <div className="flex size-12 items-center justify-center rounded-full bg-brand-red/10 text-brand-red">
        <AlertCircle className="size-6" aria-hidden="true" />
      </div>
      <div className="max-w-md space-y-1.5">
        <div className="flex flex-wrap items-center justify-center gap-2">
          <h3 className="text-base font-semibold text-foreground">{title}</h3>
          {code ? <Badge variant="red-soft">{code}</Badge> : null}
        </div>
        <p className="text-sm text-muted-foreground">{message}</p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-3 pt-1">
        {onRetry ? (
          <Button variant="brand" onClick={onRetry}>
            <RefreshCw className="size-4" aria-hidden="true" />
            <span>Thử lại</span>
          </Button>
        ) : null}
        {action}
      </div>
    </section>
  );
}
