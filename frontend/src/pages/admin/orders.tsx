import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, CheckCircle2, Search, XCircle } from 'lucide-react';
import { z } from 'zod';
import { ApiClientError } from '@/lib/api';
import {
  cancelAdminOrderApi,
  fetchAdminOrderDetailApi,
  fetchAdminOrdersApi,
  transitionOrderStatusApi,
  type AdminOrderSummaryDto,
} from '@/lib/admin-api';
import { ORDER_STATUS_LABELS, formatAdminDateTime } from '@/lib/admin-navigation';
import { useAuth } from '@/lib/auth-store';
import { formatVnd } from '@/lib/commerce-utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { FormField, Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/use-toast';
import { ErrorState } from '@/components/commerce/error-state';
import { OrderStatusBadge, OrderStatusTimeline } from '@/components/commerce/order-status';
import { AdminLayout } from '@/components/layout/admin-layout';
import { DataTable, type DataTableColumn } from '@/components/admin/data-table';

type TransitionTarget = 'CONFIRMED' | 'SHIPPING' | 'DELIVERED';

function getNextStatus(current: string): TransitionTarget | null {
  switch (current) {
    case 'PENDING':
      return 'CONFIRMED';
    case 'CONFIRMED':
      return 'SHIPPING';
    case 'SHIPPING':
      return 'DELIVERED';
    default:
      return null;
  }
}

const TRANSITION_LABELS: Record<TransitionTarget, string> = {
  CONFIRMED: 'Xác nhận đơn hàng',
  SHIPPING: 'Chuyển sang Đang giao hàng',
  DELIVERED: 'Xác nhận Đã giao & Thu COD',
};

const cancelSchema = z.object({
  reason: z.string().trim().min(1, 'Vui lòng nhập lý do hủy đơn.').max(500, 'Lý do tối đa 500 ký tự.'),
});

type CancelValues = z.infer<typeof cancelSchema>;

export function AdminOrdersPage() {
  const { token } = useAuth();
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('');
  const [orderCodeInput, setOrderCodeInput] = useState('');
  const [userIdInput, setUserIdInput] = useState('');
  const [appliedFilters, setAppliedFilters] = useState<{
    order_code?: string | undefined;
    user_id?: number | undefined;
  }>({});

  const ordersQuery = useQuery({
    queryKey: [
      'admin-orders',
      page,
      statusFilter,
      appliedFilters.order_code ?? '',
      appliedFilters.user_id ?? '',
    ],
    queryFn: () =>
      fetchAdminOrdersApi(token ?? '', {
        page,
        page_size: 20,
        ...(statusFilter ? { status: statusFilter } : {}),
        ...(appliedFilters.order_code ? { order_code: appliedFilters.order_code } : {}),
        ...(appliedFilters.user_id ? { user_id: appliedFilters.user_id } : {}),
      }),
    enabled: Boolean(token),
  });

  function handleSearch(event: React.FormEvent) {
    event.preventDefault();
    const trimmedCode = orderCodeInput.trim();
    const parsedUserId = /^[1-9][0-9]*$/.test(userIdInput.trim())
      ? Number(userIdInput.trim())
      : undefined;
    setPage(1);
    setAppliedFilters({
      ...(trimmedCode ? { order_code: trimmedCode } : {}),
      ...(parsedUserId ? { user_id: parsedUserId } : {}),
    });
  }

  function handleReset() {
    setOrderCodeInput('');
    setUserIdInput('');
    setStatusFilter('');
    setAppliedFilters({});
    setPage(1);
  }

  const columns: DataTableColumn<AdminOrderSummaryDto>[] = [
    {
      key: 'order_code',
      header: 'Mã đơn hàng',
      render: (row) => (
        <Link
          to={`/admin/orders/${row.id}`}
          className="font-mono text-xs font-semibold text-brand-red hover:underline"
        >
          {row.order_code}
        </Link>
      ),
    },
    {
      key: 'recipient',
      header: 'Người nhận / Khách',
      render: (row) => (
        <div>
          <p className="font-medium text-foreground">{row.recipient_name}</p>
          <p className="text-xs text-muted-foreground">User ID #{row.user_id}</p>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Trạng thái',
      render: (row) => <OrderStatusBadge status={row.status} />,
    },
    {
      key: 'payment',
      header: 'COD',
      render: (row) => (
        <Badge variant="neutral">
          {row.payment_method} · {row.payment_status}
        </Badge>
      ),
    },
    {
      key: 'total',
      header: 'Tổng thu',
      align: 'right',
      render: (row) => (
        <div>
          <p className="tabular-nums-vnd font-semibold text-foreground">
            {formatVnd(row.final_amount)}
          </p>
          {row.voucher_code ? (
            <p className="text-[11px] text-muted-foreground">Voucher: {row.voucher_code}</p>
          ) : null}
        </div>
      ),
    },
    {
      key: 'created_at',
      header: 'Thời gian đặt',
      render: (row) => (
        <span className="text-xs text-muted-foreground">{formatAdminDateTime(row.created_at)}</span>
      ),
    },
    {
      key: 'actions',
      header: 'Thao tác',
      align: 'right',
      render: (row) => (
        <Button asChild variant="outline" size="sm">
          <Link to={`/admin/orders/${row.id}`}>Chi tiết</Link>
        </Button>
      ),
    },
  ];

  const items = ordersQuery.data?.data.items ?? [];
  const pagination = ordersQuery.data?.meta.pagination;

  return (
    <AdminLayout
      title="Quản lý đơn hàng"
      description="Theo dõi, xác nhận từng bước và hủy đơn hàng đủ điều kiện (SALES / ADMIN)."
      breadcrumbs={[{ label: 'Back-Office', to: '/admin/orders' }, { label: 'Đơn hàng' }]}
    >
      <form
        onSubmit={handleSearch}
        className="grid grid-cols-1 gap-3 rounded-lg border border-border bg-card p-4 sm:grid-cols-2 lg:grid-cols-5 lg:items-end"
      >
        <FormField label="Tìm mã đơn" htmlFor="filter-order-code">
          {(fieldProps) => (
            <Input
              value={orderCodeInput}
              onChange={(e) => setOrderCodeInput(e.target.value)}
              placeholder="VD: ORD-2026..."
              {...fieldProps}
            />
          )}
        </FormField>

        <FormField label="Trạng thái" htmlFor="filter-order-status">
          {(fieldProps) => (
            <Select
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value);
                setPage(1);
              }}
              {...fieldProps}
            >
              <option value="">Tất cả trạng thái</option>
              {Object.entries(ORDER_STATUS_LABELS).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </Select>
          )}
        </FormField>

        <FormField label="User ID" htmlFor="filter-order-user-id">
          {(fieldProps) => (
            <Input
              inputMode="numeric"
              value={userIdInput}
              onChange={(e) => setUserIdInput(e.target.value)}
              placeholder="Tùy chọn"
              {...fieldProps}
            />
          )}
        </FormField>

        <Button type="submit" variant="brand">
          <Search className="size-4" aria-hidden="true" />
          <span>Tìm kiếm</span>
        </Button>

        <Button type="button" variant="outline" onClick={handleReset}>
          Đặt lại
        </Button>
      </form>

      <DataTable
        columns={columns}
        rows={items}
        rowKey={(row) => row.id}
        isLoading={ordersQuery.isPending}
        isError={ordersQuery.isError}
        errorMessage="Không thể tải danh sách đơn hàng."
        onRetry={() => void ordersQuery.refetch()}
        emptyTitle="Chưa có đơn hàng phù hợp"
        emptyDescription="Thử thay đổi bộ lọc trạng thái hoặc mã đơn hàng."
        caption="Danh sách đơn hàng quản trị"
        pagination={
          pagination
            ? {
                page: pagination.page,
                totalPages: pagination.total_pages,
                total: pagination.total,
                onPageChange: setPage,
              }
            : undefined
        }
      />
    </AdminLayout>
  );
}

export function AdminOrderDetailPage() {
  const { id } = useParams();
  const orderId = Number(id);
  const { token } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [pendingTarget, setPendingTarget] = useState<TransitionTarget | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);

  const detailQuery = useQuery({
    queryKey: ['admin-order-detail', orderId],
    queryFn: () => fetchAdminOrderDetailApi(token ?? '', orderId),
    enabled: Boolean(token && Number.isInteger(orderId) && orderId > 0),
  });

  const cancelForm = useForm<CancelValues>({
    resolver: zodResolver(cancelSchema),
    defaultValues: { reason: '' },
  });

  const transitionMutation = useMutation({
    mutationFn: (input: {
      expected_status: 'PENDING' | 'CONFIRMED' | 'SHIPPING' | 'DELIVERED' | 'CANCELLED';
      target_status: TransitionTarget;
    }) => transitionOrderStatusApi(token ?? '', orderId, input),
    onSuccess: (res) => {
      setPendingTarget(null);
      queryClient.setQueryData(['admin-order-detail', orderId], res);
      void queryClient.invalidateQueries({ queryKey: ['admin-orders'] });
      toast({
        variant: 'success',
        title: `Đã chuyển sang ${ORDER_STATUS_LABELS[res.data.status] ?? res.data.status}`,
        description: `Đơn ${res.data.order_code} đã được cập nhật.`,
      });
    },
    onError: (err) => {
      setPendingTarget(null);
      if (
        err instanceof ApiClientError &&
        (err.code === 'STALE_ORDER_STATUS' || err.code === 'INVALID_STATUS_TRANSITION')
      ) {
        void queryClient.invalidateQueries({ queryKey: ['admin-order-detail', orderId] });
        void queryClient.invalidateQueries({ queryKey: ['admin-orders'] });
        toast({
          variant: 'warning',
          title: 'Trạng thái đơn vừa thay đổi từ phiên khác',
          description: `${err.message} Dữ liệu đơn đã được làm mới.`,
        });
        return;
      }
      toast({
        variant: 'error',
        title: 'Chuyển trạng thái thất bại',
        description: err instanceof ApiClientError ? err.message : 'Vui lòng thử lại.',
      });
    },
  });

  const cancelMutation = useMutation({
    mutationFn: (values: CancelValues) => cancelAdminOrderApi(token ?? '', orderId, values.reason),
    onSuccess: (res) => {
      setCancelOpen(false);
      cancelForm.reset();
      queryClient.setQueryData(['admin-order-detail', orderId], res);
      void queryClient.invalidateQueries({ queryKey: ['admin-orders'] });
      toast({
        variant: 'success',
        title: 'Đã hủy đơn hàng',
        description: 'Tồn kho và lượt voucher (nếu có) đã được hoàn trả atomic.',
      });
    },
    onError: (err) => {
      void queryClient.invalidateQueries({ queryKey: ['admin-order-detail', orderId] });
      toast({
        variant: 'error',
        title: 'Không thể hủy đơn hàng',
        description: err instanceof ApiClientError ? err.message : 'Vui lòng kiểm tra trạng thái đơn.',
      });
    },
  });

  const order = detailQuery.data?.data;
  const nextStatus = order ? getNextStatus(order.status) : null;
  const canCancel = order?.status === 'PENDING' || order?.status === 'CONFIRMED';

  return (
    <AdminLayout
      title={order ? `Đơn hàng ${order.order_code}` : `Chi tiết đơn #${id ?? ''}`}
      description="Thông tin hóa đơn lịch sử, địa chỉ giao COD và chuyển trạng thái một chiều."
      breadcrumbs={[
        { label: 'Back-Office', to: '/admin/orders' },
        { label: 'Đơn hàng', to: '/admin/orders' },
        { label: order?.order_code ?? `#${id ?? ''}` },
      ]}
      actions={
        <Button asChild variant="outline" size="sm">
          <Link to="/admin/orders">Quay lại danh sách</Link>
        </Button>
      }
    >
      {detailQuery.isPending ? (
        <Skeleton className="h-96 w-full rounded-lg" />
      ) : detailQuery.isError || !order ? (
        <ErrorState
          message="Không tìm thấy đơn hàng hoặc không đủ quyền truy cập."
          onRetry={() => void detailQuery.refetch()}
        />
      ) : (
        <div className="space-y-6">
          {/* Action Banner */}
          <section className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-border bg-card p-5">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="font-mono text-lg font-bold text-foreground">{order.order_code}</span>
                <OrderStatusBadge status={order.status} />
              </div>
              <p className="text-xs text-muted-foreground">
                Đặt lúc {formatAdminDateTime(order.created_at)} · Cập nhật {formatAdminDateTime(order.updated_at)}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {nextStatus ? (
                <Button
                  type="button"
                  variant="brand"
                  onClick={() => setPendingTarget(nextStatus)}
                  disabled={transitionMutation.isPending}
                >
                  <span>{TRANSITION_LABELS[nextStatus]}</span>
                  <ArrowRight className="size-4" aria-hidden="true" />
                </Button>
              ) : null}

              {canCancel ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setCancelOpen(true)}
                  disabled={cancelMutation.isPending}
                >
                  <XCircle className="size-4 text-brand-red" aria-hidden="true" />
                  <span>Hủy đơn hàng</span>
                </Button>
              ) : null}
            </div>
          </section>

          <OrderStatusTimeline status={order.status} deliveredAt={order.delivered_at} />

          {/* Delivery & Payment Grid */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <section className="space-y-2 rounded-lg border border-border bg-card p-5 text-sm">
              <h2 className="font-semibold text-foreground">Thông tin người nhận</h2>
              <p>
                <span className="text-muted-foreground">Khách hàng (User ID #{order.user_id}): </span>
                <span className="font-medium text-foreground">{order.recipient_name}</span>
              </p>
              <p>
                <span className="text-muted-foreground">Số điện thoại: </span>
                <span className="font-medium text-foreground">{order.recipient_phone}</span>
              </p>
              <p>
                <span className="text-muted-foreground">Địa chỉ giao hàng: </span>
                <span className="font-medium text-foreground">{order.shipping_address}</span>
              </p>
            </section>

            <section className="space-y-2 rounded-lg border border-border bg-card p-5 text-sm">
              <h2 className="font-semibold text-foreground">Thanh toán &amp; Đối soát</h2>
              <p className="flex justify-between">
                <span className="text-muted-foreground">Phương thức</span>
                <span className="font-medium text-foreground">
                  {order.payment_method} ({order.payment_status})
                </span>
              </p>
              <p className="flex justify-between">
                <span className="text-muted-foreground">Tạm tính (snapshot)</span>
                <span className="tabular-nums-vnd">{formatVnd(order.subtotal_amount)}</span>
              </p>
              <p className="flex justify-between">
                <span className="text-muted-foreground">
                  Giảm giá {order.voucher_code ? `(${order.voucher_code})` : ''}
                </span>
                <span className="tabular-nums-vnd text-brand-red">
                  -{formatVnd(order.discount_amount)}
                </span>
              </p>
              <p className="flex justify-between border-t border-border pt-2 text-base font-bold text-foreground">
                <span>Tổng thu COD</span>
                <span className="tabular-nums-vnd text-brand-red">
                  {formatVnd(order.final_amount)}
                </span>
              </p>
            </section>
          </div>

          {/* Snapshot Items */}
          <section className="overflow-x-auto rounded-lg border border-border bg-card">
            <table className="w-full border-collapse text-left text-sm">
              <thead className="border-b border-border bg-surface text-xs font-semibold uppercase text-muted-foreground">
                <tr>
                  <th scope="col" className="px-4 py-3">SKU</th>
                  <th scope="col" className="px-4 py-3">Sản phẩm &amp; Thuộc tính snapshot</th>
                  <th scope="col" className="px-4 py-3 text-right">Đơn giá lúc mua</th>
                  <th scope="col" className="px-4 py-3 text-right">SL</th>
                  <th scope="col" className="px-4 py-3 text-right">Thành tiền</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border bg-background">
                {order.items.map((item) => (
                  <tr key={item.id}>
                    <td className="px-4 py-3 font-mono text-xs">{item.sku}</td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-foreground">{item.product_name}</p>
                      <p className="text-xs text-muted-foreground">
                        {item.brand_name}
                        {item.options_snapshot.length > 0
                          ? ` · ${item.options_snapshot.map((o) => `${o.label}: ${o.value_label}`).join(', ')}`
                          : ''}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums-vnd">
                      {formatVnd(item.unit_price)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums-vnd">{item.quantity}</td>
                    <td className="px-4 py-3 text-right font-semibold tabular-nums-vnd">
                      {formatVnd(item.line_amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </div>
      )}

      {/* Confirmation dialog for sequential state transition */}
      <Dialog
        open={Boolean(pendingTarget && order)}
        onOpenChange={(open) => {
          if (!open) setPendingTarget(null);
        }}
        title={pendingTarget ? TRANSITION_LABELS[pendingTarget] : 'Xác nhận chuyển trạng thái'}
        description={
          order && pendingTarget
            ? `Xác nhận chuyển đơn ${order.order_code} từ ${ORDER_STATUS_LABELS[order.status]} sang ${ORDER_STATUS_LABELS[pendingTarget]}. Hành động này không thể hoàn tác.`
            : undefined
        }
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setPendingTarget(null)}>
              Đóng
            </Button>
            <Button
              type="button"
              variant="brand"
              disabled={transitionMutation.isPending}
              onClick={() => {
                if (order && pendingTarget) {
                  transitionMutation.mutate({
                    expected_status: order.status,
                    target_status: pendingTarget,
                  });
                }
              }}
            >
              <CheckCircle2 className="size-4" aria-hidden="true" />
              <span>Xác nhận chuyển</span>
            </Button>
          </div>
        }
      >
        {pendingTarget === 'DELIVERED' ? (
          <p className="text-sm text-muted-foreground">
            Khi đánh dấu DELIVERED, hệ thống ghi nhận thu tiền COD thành công và khóa hoàn toàn mọi chỉnh sửa trên đơn hàng này.
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            Máy chủ kiểm tra expected_status nhằm tránh xung đột nếu nhân viên khác vừa thao tác trên cùng đơn hàng.
          </p>
        )}
      </Dialog>

      {/* Cancel dialog */}
      <Dialog
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        title="Hủy đơn hàng"
        description={
          order
            ? `Hủy đơn ${order.order_code}. Tồn kho và lượt sử dụng voucher sẽ được hoàn trả.`
            : undefined
        }
        size="sm"
      >
        <form
          onSubmit={cancelForm.handleSubmit((values) => cancelMutation.mutate(values))}
          className="space-y-4"
        >
          <FormField
            label="Lý do hủy đơn"
            htmlFor="admin-cancel-reason"
            required
            error={cancelForm.formState.errors.reason?.message}
          >
            {(fieldProps) => (
              <Input
                placeholder="VD: Khách yêu cầu đổi địa chỉ / hết thời hạn xác nhận"
                {...fieldProps}
                {...cancelForm.register('reason')}
              />
            )}
          </FormField>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setCancelOpen(false)}>
              Giữ lại
            </Button>
            <Button type="submit" variant="brand" disabled={cancelMutation.isPending}>
              Xác nhận hủy đơn
            </Button>
          </div>
        </form>
      </Dialog>
    </AdminLayout>
  );
}
