import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { AlertCircle, AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ToastContext, type ToastInput, type ToastVariant } from '@/components/ui/use-toast';

interface ToastItem {
  id: string;
  title: string;
  variant: ToastVariant;
  description?: string | undefined;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: string) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const toast = useCallback(
    ({ title, description, variant = 'default', duration = 4500 }: ToastInput) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      setItems((prev) => [...prev.slice(-3), { id, title, description, variant }]);
      if (duration > 0) {
        window.setTimeout(() => dismiss(id), duration);
      }
      return id;
    },
    [dismiss],
  );

  const value = useMemo(() => ({ toast, dismiss }), [toast, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <Toaster items={items} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

function ToastIcon({ variant }: { variant: ToastVariant }) {
  switch (variant) {
    case 'success':
      return <CheckCircle2 className="size-5 shrink-0 text-success" aria-hidden="true" />;
    case 'warning':
      return <AlertTriangle className="size-5 shrink-0 text-warning" aria-hidden="true" />;
    case 'error':
      return <AlertCircle className="size-5 shrink-0 text-brand-red" aria-hidden="true" />;
    default:
      return <Info className="size-5 shrink-0 text-foreground" aria-hidden="true" />;
  }
}

export function Toaster({
  items,
  onDismiss,
}: {
  items: readonly ToastItem[];
  onDismiss: (id: string) => void;
}) {
  return (
    <div
      aria-live="polite"
      aria-atomic="false"
      className="pointer-events-none fixed right-4 bottom-4 left-4 z-50 flex flex-col gap-2 sm:left-auto sm:w-96"
    >
      {items.map((item) => (
        <div
          key={item.id}
          role={item.variant === 'error' ? 'alert' : 'status'}
          className={cn(
            'pointer-events-auto flex items-start gap-3 rounded-lg border bg-background p-4 text-foreground shadow-lg',
            item.variant === 'error' && 'border-brand-red-border bg-brand-red-soft/60',
            item.variant === 'success' && 'border-success/30 bg-success-soft/60',
            item.variant === 'warning' && 'border-warning/30 bg-warning-soft/70',
            item.variant === 'default' && 'border-border-strong',
          )}
        >
          <ToastIcon variant={item.variant} />
          <div className="min-w-0 flex-1 space-y-0.5">
            <p className="text-sm font-semibold">{item.title}</p>
            {item.description ? <p className="text-xs text-muted-foreground">{item.description}</p> : null}
          </div>
          <button
            type="button"
            aria-label="Đóng thông báo"
            onClick={() => onDismiss(item.id)}
            className="-mr-1 -mt-1 inline-flex min-h-11 min-w-11 items-center justify-center rounded-md text-muted-foreground hover:bg-surface hover:text-foreground"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
      ))}
    </div>
  );
}
