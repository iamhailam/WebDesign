import { XCircle } from 'lucide-react';
import { ORDER_STATUS_LABELS, orderStatusBadgeVariant } from '@/lib/admin-navigation';
import { Badge } from '@/components/ui/badge';

const PROGRESS_STEPS = ['PENDING', 'CONFIRMED', 'SHIPPING', 'DELIVERED'] as const;

export function OrderStatusBadge({ status }: { status: string }) {
  return <Badge variant={orderStatusBadgeVariant(status)}>{ORDER_STATUS_LABELS[status] ?? status}</Badge>;
}

export function OrderStatusTimeline({
  status,
  deliveredAt,
}: {
  status: string;
  deliveredAt?: string | null | undefined;
}) {
  if (status === 'CANCELLED') {
    return (
      <div
        role="status"
        className="flex items-center gap-2 rounded-md border border-brand-red-border bg-brand-red-soft px-4 py-3 text-sm font-medium text-brand-red"
      >
        <XCircle className="size-4 shrink-0" aria-hidden="true" />
        <span>Đơn hàng đã bị hủy. Tồn kho và lượt dùng voucher (nếu có) đã được hoàn lại.</span>
      </div>
    );
  }

  const currentIndex = PROGRESS_STEPS.indexOf(status as (typeof PROGRESS_STEPS)[number]);

  return (
    <ol
      aria-label="Tiến trình trạng thái đơn hàng"
      className="grid grid-cols-2 gap-2 rounded-md border border-border bg-surface-elevated p-3 sm:grid-cols-4"
    >
      {PROGRESS_STEPS.map((step, idx) => {
        const completed = currentIndex >= idx;
        return (
          <li
            key={step}
            className={`flex items-center gap-2 rounded-md px-2.5 py-2 text-xs font-medium ${
              completed ? 'bg-background text-foreground shadow-xs' : 'text-muted-foreground'
            }`}
          >
            <span
              aria-hidden="true"
              className={`size-2.5 shrink-0 rounded-full ${
                completed ? (step === 'DELIVERED' ? 'bg-success' : 'bg-brand-red') : 'bg-neutral-300'
              }`}
            />
            <div className="min-w-0">
              <span className="block truncate">{ORDER_STATUS_LABELS[step]}</span>
              {step === 'DELIVERED' && deliveredAt ? (
                <span className="block text-[10px] text-muted-foreground">
                  {new Date(deliveredAt).toLocaleDateString('vi-VN')}
                </span>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
