import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Package, XCircle } from 'lucide-react';
import { z } from 'zod';
import {
  ApiClientError,
  cancelOrderApi,
  fetchMyOrdersApi,
  fetchOrderDetailApi,
  type OrderDetailDto,
} from '@/lib/api';
import {
  ORDER_STATUS_LABELS as STATUS_LABELS,
  orderStatusBadgeVariant as statusVariant,
} from '@/lib/admin-navigation';
import { useAuth } from '@/lib/auth-store';
import { formatVnd } from '@/lib/commerce-utils';
import { usePageTitle } from '@/lib/use-page-title';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { FormField, Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/use-toast';
import { EmptyState } from '@/components/commerce/empty-state';
import { ErrorState } from '@/components/commerce/error-state';
import { OrderStatusTimeline } from '@/components/commerce/order-status';
import { Pagination } from '@/components/commerce/pagination';
import { PriceDisplay } from '@/components/commerce/price-display';
import { AccountLayout } from '@/components/layout/account-layout';

export { OrderStatusTimeline };

const cancelReasonSchema = z.object({
  reason: z.string().trim().min(1, 'Vui lòng nhập lý do hủy đơn.').max(500, 'Lý do tối đa 500 ký tự.'),
});

type CancelReasonValues = z.infer<typeof cancelReasonSchema>;

function OrderInvoiceView({ order }: { order: OrderDetailDto }) {
  return (
    <div className="space-y-6 rounded-lg border border-border bg-card p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-4">
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">Mã đơn hàng</p>
          <p className="font-mono text-xl font-bold text-foreground">{order.order_code}</p>
          <p className="text-xs text-muted-foreground">
            Đặt lúc: {new Date(order.created_at).toLocaleString('vi-VN')}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={statusVariant(order.status)}>{STATUS_LABELS[order.status] ?? order.status}</Badge>
          <Badge variant="outline">
            {order.payment_method} · {order.payment_status}
          </Badge>
        </div>
      </div>

      <OrderStatusTimeline status={order.status} deliveredAt={order.delivered_at} />

      <dl className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-muted-foreground">Người nhận</dt>
          <dd className="font-medium text-foreground">{order.recipient_name}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Số điện thoại</dt>
          <dd className="font-medium text-foreground">{order.recipient_phone}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Địa chỉ giao nhận</dt>
          <dd className="font-medium text-foreground">{order.shipping_address}</dd>
        </div>
      </dl>

      <div className="space-y-3 border-t border-border pt-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-foreground">Chi tiết sản phẩm</h3>
          <span className="text-xs text-muted-foreground">Giá lưu tại thời điểm đặt hàng</span>
        </div>
        <div className="divide-y divide-border rounded-md border border-border">
          {order.items.map((item) => (
            <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 p-3.5 text-sm">
              <div className="min-w-0 space-y-1">
                <p className="font-semibold text-foreground">
                  {item.brand_name} — {item.product_name}
                </p>
                <p className="font-mono text-xs text-muted-foreground">
                  SKU: {item.sku} · SL: {item.quantity}
                </p>
                {item.options_snapshot.length > 0 ? (
                  <p className="text-xs text-muted-foreground">
                    {item.options_snapshot.map((o) => `${o.label}: ${o.value_label}`).join(' · ')}
                  </p>
                ) : null}
              </div>
              <div className="text-right">
                <PriceDisplay price={item.unit_price} listPrice={item.list_unit_price} size="sm" />
                <p className="text-xs font-medium text-muted-foreground tabular-nums-vnd">
                  Thành tiền: {formatVnd(item.line_amount)}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="ml-auto max-w-xs space-y-2 border-t border-border pt-4 text-sm">
        <div className="flex justify-between">
          <span className="text-muted-foreground">Tạm tính</span>
          <span className="tabular-nums-vnd">{formatVnd(order.subtotal_amount)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">
            Giảm giá {order.voucher_code ? `(${order.voucher_code})` : ''}
          </span>
          <span className="text-brand-red tabular-nums-vnd">-{formatVnd(order.discount_amount)}</span>
        </div>
        <div className="flex items-baseline justify-between border-t border-border pt-2">
          <span className="font-semibold text-foreground">Tổng thanh toán</span>
          <PriceDisplay price={order.final_amount} size="lg" />
        </div>
      </div>
    </div>
  );
}

export function OrderSuccessPage() {
  usePageTitle('Đặt hàng thành công');
  const { orderId = '' } = useParams<{ orderId: string }>();
  const { user, token } = useAuth();
  const numericId = Number(orderId);

  const orderQuery = useQuery({
    queryKey: ['orders', 'detail', numericId, user?.id],
    queryFn: () => {
      if (!token) throw new ApiClientError(401, 'INVALID_TOKEN', 'Vui lòng đăng nhập.');
      return fetchOrderDetailApi(token, numericId);
    },
    enabled: Boolean(token && user?.role === 'CUSTOMER' && Number.isSafeInteger(numericId) && numericId > 0),
    retry: false,
  });

  return (
    <div className="mx-auto max-w-3xl space-y-6 py-8">
      <div className="flex items-start gap-3 rounded-lg border border-success/30 bg-success-soft p-5 text-success">
        <CheckCircle2 className="mt-0.5 size-6 shrink-0" aria-hidden="true" />
        <div className="space-y-1">
          <h1 className="text-xl font-bold sm:text-2xl">Đặt hàng thành công</h1>
          <p className="text-sm">
            Đơn hàng đã được ghi nhận vào hệ thống theo phương thức COD (chưa thanh toán cho đến khi giao hàng thành công).
          </p>
        </div>
      </div>

      {orderQuery.isPending ? (
        <Skeleton className="h-72 w-full rounded-lg" />
      ) : orderQuery.isError || !orderQuery.data ? (
        <ErrorState message="Không thể tải chi tiết đơn hàng vừa tạo." onRetry={() => void orderQuery.refetch()} />
      ) : (
        <OrderInvoiceView order={orderQuery.data.data} />
      )}

      <div className="flex flex-wrap gap-3">
        <Button asChild variant="brand">
          <Link to="/account/orders">Xem lịch sử đơn hàng</Link>
        </Button>
        <Button asChild variant="outline">
          <Link to="/products">Tiếp tục mua sắm</Link>
        </Button>
      </div>
    </div>
  );
}

export function MyOrdersPage() {
  const { user, token } = useAuth();
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);

  const ordersQuery = useQuery({
    queryKey: ['orders', 'my-orders', user?.id, { page, statusFilter }],
    queryFn: () => {
      if (!token) throw new ApiClientError(401, 'INVALID_TOKEN', 'Vui lòng đăng nhập.');
      return fetchMyOrdersApi(token, { page, page_size: 10, status: statusFilter || undefined });
    },
    enabled: Boolean(token && user?.role === 'CUSTOMER'),
    retry: false,
  });

  const items = ordersQuery.data?.data.items ?? [];
  const pagination = ordersQuery.data?.meta.pagination ?? { page, page_size: 10, total: 0, total_pages: 0 };

  return (
    <AccountLayout
      title="Đơn hàng của tôi"
      description="Theo dõi trạng thái, hóa đơn snapshot tại thời điểm mua và hủy đơn khi còn hiệu lực."
      breadcrumbs={[
        { label: 'Trang chủ', to: '/' },
        { label: 'Tài khoản', to: '/account' },
        { label: 'Đơn hàng của tôi' },
      ]}
    >
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Lọc theo trạng thái đơn hàng">
        {[
          { value: '', label: 'Tất cả' },
          { value: 'PENDING', label: 'Chờ xác nhận' },
          { value: 'CONFIRMED', label: 'Đã xác nhận' },
          { value: 'SHIPPING', label: 'Đang giao' },
          { value: 'DELIVERED', label: 'Đã giao' },
          { value: 'CANCELLED', label: 'Đã hủy' },
        ].map((tab) => {
          const active = statusFilter === tab.value;
          return (
            <Button
              key={tab.value || 'ALL'}
              role="tab"
              aria-selected={active}
              variant={active ? 'brand' : 'outline'}
              size="sm"
              onClick={() => {
                setStatusFilter(tab.value);
                setPage(1);
              }}
            >
              {tab.label}
            </Button>
          );
        })}
      </div>

      {ordersQuery.isPending ? (
        <div className="space-y-3" role="status" aria-busy="true">
          <Skeleton className="h-32 w-full rounded-lg" />
          <Skeleton className="h-32 w-full rounded-lg" />
        </div>
      ) : ordersQuery.isError ? (
        <ErrorState message="Không thể tải danh sách đơn hàng." onRetry={() => void ordersQuery.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState
          variant="orders"
          title="Chưa có đơn hàng nào"
          description="Các đơn hàng bạn đã đặt sẽ hiển thị đầy đủ tại đây."
          action={
            <Button asChild variant="brand">
              <Link to="/products">Mua sắm ngay</Link>
            </Button>
          }
        />
      ) : (
        <div className="space-y-4">
          {items.map((order) => (
            <article key={order.id} className="space-y-3 rounded-lg border border-border bg-card p-4 sm:p-5">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-3">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="font-mono font-bold text-foreground">{order.order_code}</span>
                  <Badge variant={statusVariant(order.status)}>{STATUS_LABELS[order.status] ?? order.status}</Badge>
                </div>
                <span className="text-xs text-muted-foreground">
                  {new Date(order.created_at).toLocaleString('vi-VN')}
                </span>
              </div>

              <div className="space-y-1 text-xs text-muted-foreground">
                {order.items.slice(0, 2).map((line) => (
                  <p key={line.id} className="truncate">
                    {line.product_name} ({line.sku}) × {line.quantity} — {formatVnd(line.unit_price)}
                  </p>
                ))}
                {order.items.length > 2 ? <p>và {order.items.length - 2} sản phẩm khác…</p> : null}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-4 pt-1">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Package className="size-4" aria-hidden="true" />
                  <span>{order.items.length} dòng sản phẩm</span>
                </div>
                <div className="flex items-center gap-4">
                  <PriceDisplay price={order.final_amount} size="sm" />
                  <Button asChild variant="outline" size="sm">
                    <Link to={`/account/orders/${order.id}`}>Xem chi tiết</Link>
                  </Button>
                </div>
              </div>
            </article>
          ))}

          <Pagination
            page={pagination.page}
            totalPages={pagination.total_pages}
            totalItems={pagination.total}
            onPageChange={setPage}
          />
        </div>
      )}
    </AccountLayout>
  );
}

export function OrderDetailPage() {
  const { orderId = '' } = useParams<{ orderId: string }>();
  const { user, token } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const numericId = Number(orderId);

  const [cancelOpen, setCancelOpen] = useState(false);
  const [serverCancelError, setServerCancelError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<CancelReasonValues>({
    resolver: zodResolver(cancelReasonSchema),
    defaultValues: { reason: '' },
  });

  const detailQuery = useQuery({
    queryKey: ['orders', 'detail', numericId, user?.id],
    queryFn: () => {
      if (!token) throw new ApiClientError(401, 'INVALID_TOKEN', 'Vui lòng đăng nhập.');
      return fetchOrderDetailApi(token, numericId);
    },
    enabled: Boolean(token && user?.role === 'CUSTOMER' && Number.isSafeInteger(numericId) && numericId > 0),
    retry: false,
  });

  const cancelMutation = useMutation({
    mutationFn: (reason: string) => {
      if (!token) throw new ApiClientError(401, 'INVALID_TOKEN', 'Vui lòng đăng nhập.');
      return cancelOrderApi(token, numericId, reason);
    },
    onSuccess: (res) => {
      setCancelOpen(false);
      reset();
      setServerCancelError(null);
      queryClient.setQueryData(['orders', 'detail', numericId, user?.id], res);
      queryClient.invalidateQueries({ queryKey: ['orders', 'my-orders'] }).catch(() => undefined);
      toast({ title: 'Đã hủy đơn hàng thành công', variant: 'success' });
    },
    onError: (err) => {
      const msg = err instanceof ApiClientError ? err.message : 'Không thể hủy đơn hàng.';
      setServerCancelError(msg);
      if (err instanceof ApiClientError && err.code === 'ORDER_NOT_CANCELLABLE') {
        void detailQuery.refetch();
      }
      toast({ title: 'Hủy đơn thất bại', description: msg, variant: 'error' });
    },
  });

  const order = detailQuery.data?.data;
  const canCancel = Boolean(order && (order.status === 'PENDING' || order.status === 'CONFIRMED'));

  return (
    <AccountLayout
      title={order ? `Đơn hàng ${order.order_code}` : `Đơn hàng #${orderId}`}
      breadcrumbs={[
        { label: 'Trang chủ', to: '/' },
        { label: 'Đơn hàng của tôi', to: '/account/orders' },
        { label: order?.order_code ?? `#${orderId}` },
      ]}
      headerAction={
        canCancel ? (
          <Button
            variant="outline"
            onClick={() => {
              setServerCancelError(null);
              reset();
              setCancelOpen(true);
            }}
            className="border-brand-red text-brand-red"
          >
            <XCircle aria-hidden="true" />
            <span>Hủy đơn hàng</span>
          </Button>
        ) : undefined
      }
    >
      {detailQuery.isPending ? (
        <Skeleton className="h-80 w-full rounded-lg" />
      ) : detailQuery.isError || !order ? (
        <ErrorState
          title="Không tìm thấy đơn hàng"
          message="Đơn hàng không tồn tại hoặc bạn không có quyền xem đơn hàng này."
          action={
            <Button asChild variant="outline">
              <Link to="/account/orders">Quay lại danh sách</Link>
            </Button>
          }
        />
      ) : (
        <>
          <OrderInvoiceView order={order} />

          <Dialog
            open={cancelOpen}
            onOpenChange={setCancelOpen}
            title={`Hủy đơn hàng ${order.order_code}`}
            description="Tồn kho và lượt dùng voucher (nếu có) sẽ được hoàn lại tự động."
            footer={
              <>
                <Button variant="outline" onClick={() => setCancelOpen(false)} disabled={cancelMutation.isPending}>
                  Đóng
                </Button>
                <Button
                  type="submit"
                  form="cancel-order-form"
                  variant="brand"
                  disabled={cancelMutation.isPending}
                >
                  {cancelMutation.isPending ? 'Đang hủy…' : 'Xác nhận hủy đơn'}
                </Button>
              </>
            }
          >
            <form
              id="cancel-order-form"
              onSubmit={(e) => void handleSubmit((vals) => cancelMutation.mutate(vals.reason))(e)}
              className="space-y-3"
              noValidate
            >
              {serverCancelError ? (
                <div
                  role="alert"
                  className="rounded-md border border-brand-red-border bg-brand-red-soft px-3 py-2 text-xs font-medium text-brand-red"
                >
                  {serverCancelError}
                </div>
              ) : null}

              <FormField label="Lý do hủy đơn" required error={errors.reason?.message}>
                {(props) => (
                  <Input
                    {...props}
                    placeholder="Ví dụ: Đổi kích cỡ / thay đổi địa chỉ…"
                    error={errors.reason?.message}
                    {...register('reason')}
                  />
                )}
              </FormField>
            </form>
          </Dialog>
        </>
      )}
    </AccountLayout>
  );
}
