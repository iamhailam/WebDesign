import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BarChart3, Calendar, PackageCheck, TicketPercent, TrendingUp } from 'lucide-react';
import {
  fetchBestSellersReportApi,
  fetchRevenueReportApi,
  type BestSellerRowDto,
  type RevenuePeriodDto,
} from '@/lib/admin-api';
import { formatDateRangeDefaults } from '@/lib/admin-navigation';
import { useAuth } from '@/lib/auth-store';
import { formatVnd } from '@/lib/commerce-utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { FormField, Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/commerce/empty-state';
import { ErrorState } from '@/components/commerce/error-state';
import { AdminLayout } from '@/components/layout/admin-layout';
import { DataTable, type DataTableColumn } from '@/components/admin/data-table';

function inclusiveDayCount(from: string, to: string): number | null {
  const fromMs = Date.parse(`${from}T00:00:00.000Z`);
  const toMs = Date.parse(`${to}T00:00:00.000Z`);
  if (Number.isNaN(fromMs) || Number.isNaN(toMs)) return null;
  return Math.round((toMs - fromMs) / 86_400_000) + 1;
}

function RevenueBarChart({ items }: { items: readonly RevenuePeriodDto[] }) {
  const maxRevenue = items.reduce((max, row) => {
    const val = Number(row.revenue_amount);
    return Number.isFinite(val) && val > max ? val : max;
  }, 0);

  if (items.length === 0) {
    return (
      <EmptyState
        title="Chưa có dữ liệu doanh thu trong kỳ"
        description="Hệ thống chỉ thống kê các đơn hàng ở trạng thái DELIVERED."
      />
    );
  }

  return (
    <figure
      role="img"
      aria-label="Biểu đồ doanh thu theo kỳ từ các đơn hàng đã giao"
      className="space-y-3 rounded-lg border border-border bg-card p-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <figcaption className="text-sm font-semibold text-foreground">
          Xu hướng doanh thu thực thu (DELIVERED)
        </figcaption>
        <span className="text-xs text-muted-foreground">{items.length} mốc thời gian</span>
      </div>
      <div className="overflow-x-auto pb-2">
        <div className="flex h-52 min-w-[420px] items-end gap-2 border-b border-border pt-4">
          {items.map((item) => {
            const val = Number(item.revenue_amount);
            const pct = maxRevenue > 0 ? Math.max(4, Math.round((val / maxRevenue) * 100)) : 0;
            return (
              <div
                key={item.period_start}
                className="flex min-w-[44px] flex-1 flex-col items-center justify-end gap-1.5"
              >
                <span className="text-[11px] font-medium text-muted-foreground tabular-nums-vnd">
                  {formatVnd(item.revenue_amount)}
                </span>
                <div
                  title={`${item.period_start}: ${formatVnd(item.revenue_amount)} (${item.order_count} đơn)`}
                  style={{ height: `${pct}%` }}
                  className="w-full max-w-10 rounded-t bg-brand-red transition-all"
                />
                <span className="w-full truncate text-center text-[11px] text-muted-foreground">
                  {item.period_start}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </figure>
  );
}

export function AdminDashboardPage() {
  const { token } = useAuth();
  const defaults = useMemo(() => formatDateRangeDefaults(30), []);

  const [draftFrom, setDraftFrom] = useState(defaults.from);
  const [draftTo, setDraftTo] = useState(defaults.to);
  const [groupBy, setGroupBy] = useState<'day' | 'month'>('day');
  const [bestSellerLevel, setBestSellerLevel] = useState<'product' | 'sku'>('product');

  const [appliedRange, setAppliedRange] = useState<{ from: string; to: string }>({
    from: defaults.from,
    to: defaults.to,
  });
  const [rangeError, setRangeError] = useState<string | null>(null);
  const [revenuePage, setRevenuePage] = useState(1);
  const [bestSellerPage, setBestSellerPage] = useState(1);

  const revenueQuery = useQuery({
    queryKey: ['admin-revenue-report', appliedRange.from, appliedRange.to, groupBy, revenuePage],
    queryFn: () =>
      fetchRevenueReportApi(token ?? '', {
        from: appliedRange.from,
        to: appliedRange.to,
        group_by: groupBy,
        page: revenuePage,
        page_size: 100,
      }),
    enabled: Boolean(token),
  });

  const bestSellersQuery = useQuery({
    queryKey: [
      'admin-best-sellers',
      appliedRange.from,
      appliedRange.to,
      bestSellerLevel,
      bestSellerPage,
    ],
    queryFn: () =>
      fetchBestSellersReportApi(token ?? '', {
        from: appliedRange.from,
        to: appliedRange.to,
        level: bestSellerLevel,
        page: bestSellerPage,
        page_size: 10,
      }),
    enabled: Boolean(token),
  });

  function handleApplyFilter(event: React.FormEvent) {
    event.preventDefault();
    if (!draftFrom || !draftTo) {
      setRangeError('Vui lòng chọn đầy đủ ngày bắt đầu và ngày kết thúc.');
      return;
    }
    if (draftFrom > draftTo) {
      setRangeError('Ngày bắt đầu không được lớn hơn ngày kết thúc.');
      return;
    }
    const days = inclusiveDayCount(draftFrom, draftTo);
    if (days === null || days > 366) {
      setRangeError('Khoảng thời gian báo cáo tối đa 366 ngày.');
      return;
    }
    setRangeError(null);
    setRevenuePage(1);
    setBestSellerPage(1);
    setAppliedRange({ from: draftFrom, to: draftTo });
  }

  const revenueColumns: DataTableColumn<RevenuePeriodDto>[] = [
    {
      key: 'period',
      header: 'Kỳ thống kê',
      render: (row) => <span className="font-mono text-xs font-medium">{row.period_start}</span>,
    },
    {
      key: 'orders',
      header: 'Đơn DELIVERED',
      align: 'right',
      render: (row) => <span className="tabular-nums-vnd font-medium">{row.order_count}</span>,
    },
    {
      key: 'gross',
      header: 'Tiền hàng (Gross)',
      align: 'right',
      render: (row) => <span className="tabular-nums-vnd">{formatVnd(row.gross_amount)}</span>,
    },
    {
      key: 'discount',
      header: 'Giảm voucher',
      align: 'right',
      render: (row) => (
        <span className="tabular-nums-vnd text-brand-red">-{formatVnd(row.discount_amount)}</span>
      ),
    },
    {
      key: 'revenue',
      header: 'Doanh thu thuần',
      align: 'right',
      render: (row) => (
        <span className="tabular-nums-vnd font-semibold text-foreground">
          {formatVnd(row.revenue_amount)}
        </span>
      ),
    },
  ];

  const bestSellerColumns: DataTableColumn<BestSellerRowDto>[] = [
    {
      key: 'rank',
      header: '#',
      render: (row) => <Badge variant={row.rank <= 3 ? 'red-soft' : 'neutral'}>#{row.rank}</Badge>,
    },
    {
      key: 'product',
      header: bestSellerLevel === 'sku' ? 'Sản phẩm / SKU' : 'Sản phẩm',
      render: (row) => (
        <div>
          <p className="font-medium text-foreground">{row.product_name}</p>
          {row.sku ? <p className="font-mono text-xs text-muted-foreground">{row.sku}</p> : null}
        </div>
      ),
    },
    {
      key: 'qty',
      header: 'Số lượng bán',
      align: 'right',
      render: (row) => <span className="tabular-nums-vnd font-semibold">{row.quantity_sold}</span>,
    },
    {
      key: 'gross_item',
      header: 'Tiền hàng trước voucher',
      align: 'right',
      render: (row) => <span className="tabular-nums-vnd">{formatVnd(row.gross_item_amount)}</span>,
    },
  ];

  const totals = revenueQuery.data?.data.totals;
  const revenueItems = revenueQuery.data?.data.items ?? [];
  const revenuePagination = revenueQuery.data?.meta.pagination;

  const bestSellerItems = bestSellersQuery.data?.data.items ?? [];
  const bestSellerPagination = bestSellersQuery.data?.meta.pagination;

  return (
    <AdminLayout
      title="Tổng quan doanh thu & Bán chạy"
      description="Số liệu thực tế từ vw_revenue_summary và vw_best_selling_products (chỉ tính đơn DELIVERED)."
      breadcrumbs={[{ label: 'Back-Office', to: '/admin/dashboard' }, { label: 'Tổng quan' }]}
    >
      {/* Filter bar */}
      <form
        onSubmit={handleApplyFilter}
        className="grid grid-cols-1 gap-4 rounded-lg border border-border bg-card p-4 sm:grid-cols-2 lg:grid-cols-4 lg:items-end"
      >
        <FormField label="Từ ngày" htmlFor="report-from" required>
          {(fieldProps) => (
            <Input
              type="date"
              value={draftFrom}
              onChange={(e) => setDraftFrom(e.target.value)}
              {...fieldProps}
            />
          )}
        </FormField>

        <FormField label="Đến ngày" htmlFor="report-to" required>
          {(fieldProps) => (
            <Input
              type="date"
              value={draftTo}
              onChange={(e) => setDraftTo(e.target.value)}
              {...fieldProps}
            />
          )}
        </FormField>

        <FormField label="Nhóm theo" htmlFor="report-group-by">
          {(fieldProps) => (
            <Select
              value={groupBy}
              onChange={(e) => {
                setGroupBy(e.target.value as 'day' | 'month');
                setRevenuePage(1);
              }}
              {...fieldProps}
            >
              <option value="day">Theo ngày</option>
              <option value="month">Theo tháng</option>
            </Select>
          )}
        </FormField>

        <Button type="submit" variant="brand" className="w-full sm:w-auto">
          <Calendar className="size-4" aria-hidden="true" />
          <span>Áp dụng kỳ báo cáo</span>
        </Button>

        {rangeError ? (
          <p role="alert" className="text-xs font-medium text-brand-red sm:col-span-2 lg:col-span-4">
            {rangeError}
          </p>
        ) : null}
      </form>

      {/* KPI Cards */}
      {revenueQuery.isPending ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, idx) => (
            <Skeleton key={idx} className="h-28 rounded-lg" />
          ))}
        </div>
      ) : revenueQuery.isError ? (
        <ErrorState
          message="Không thể tải báo cáo doanh thu."
          onRetry={() => void revenueQuery.refetch()}
        />
      ) : totals ? (
        <section
          aria-label="Chỉ số doanh thu chính"
          className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4"
        >
          <div className="rounded-lg border border-border bg-card p-4">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Đơn hàng DELIVERED</span>
              <PackageCheck className="size-4 text-success" aria-hidden="true" />
            </div>
            <p className="mt-2 text-2xl font-bold text-foreground tabular-nums-vnd">
              {totals.order_count}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">Không tính đơn đang giao hoặc đã hủy</p>
          </div>

          <div className="rounded-lg border border-border bg-card p-4">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Tổng tiền hàng (Gross)</span>
              <BarChart3 className="size-4 text-muted-foreground" aria-hidden="true" />
            </div>
            <p className="mt-2 text-2xl font-bold text-foreground tabular-nums-vnd">
              {formatVnd(totals.gross_amount)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">Giá snapshot tại thời điểm mua</p>
          </div>

          <div className="rounded-lg border border-border bg-card p-4">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Chi phí giảm giá Voucher</span>
              <TicketPercent className="size-4 text-brand-red" aria-hidden="true" />
            </div>
            <p className="mt-2 text-2xl font-bold text-brand-red tabular-nums-vnd">
              -{formatVnd(totals.discount_amount)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">Tổng giá trị voucher đã áp dụng</p>
          </div>

          <div className="rounded-lg border border-brand-red-border bg-brand-red-soft/40 p-4">
            <div className="flex items-center justify-between text-xs font-medium text-brand-red">
              <span>Doanh thu thuần (COD thực thu)</span>
              <TrendingUp className="size-4" aria-hidden="true" />
            </div>
            <p className="mt-2 text-2xl font-bold text-foreground tabular-nums-vnd">
              {formatVnd(totals.revenue_amount)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Kỳ {appliedRange.from} → {appliedRange.to}
            </p>
          </div>
        </section>
      ) : null}

      {/* Revenue Chart + Table */}
      {!revenueQuery.isPending && !revenueQuery.isError ? (
        <section aria-label="Chi tiết doanh thu theo kỳ" className="space-y-4">
          <RevenueBarChart items={revenueItems} />
          <DataTable
            columns={revenueColumns}
            rows={revenueItems}
            rowKey={(r) => r.period_start}
            caption="Bảng doanh thu theo kỳ"
            emptyTitle="Không có đơn DELIVERED trong khoảng ngày đã chọn"
            emptyDescription="Thử mở rộng khoảng ngày để xem thống kê."
            pagination={
              revenuePagination
                ? {
                    page: revenuePagination.page,
                    totalPages: revenuePagination.total_pages,
                    total: revenuePagination.total,
                    onPageChange: setRevenuePage,
                  }
                : undefined
            }
          />
        </section>
      ) : null}

      {/* Best Sellers */}
      <section aria-label="Sản phẩm bán chạy" className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-foreground">Top sản phẩm bán chạy</h2>
            <p className="text-xs text-muted-foreground">
              Cột tiền hàng là doanh thu dòng hàng trước giảm giá voucher (gross_item_amount) của đơn DELIVERED.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <label htmlFor="best-sellers-level" className="text-xs font-medium text-muted-foreground">
              Cấp thống kê
            </label>
            <Select
              id="best-sellers-level"
              value={bestSellerLevel}
              onChange={(e) => {
                setBestSellerLevel(e.target.value as 'product' | 'sku');
                setBestSellerPage(1);
              }}
              className="w-40"
            >
              <option value="product">Theo sản phẩm</option>
              <option value="sku">Theo từng SKU</option>
            </Select>
          </div>
        </div>

        <DataTable
          columns={bestSellerColumns}
          rows={bestSellerItems}
          rowKey={(r) => `${r.rank}-${r.product_id}-${r.variant_id ?? 0}`}
          isLoading={bestSellersQuery.isPending}
          isError={bestSellersQuery.isError}
          errorMessage="Không thể tải danh sách bán chạy."
          onRetry={() => void bestSellersQuery.refetch()}
          emptyTitle="Chưa có sản phẩm bán chạy trong kỳ"
          emptyDescription="Chỉ đơn hàng DELIVERED mới xuất hiện trong báo cáo này."
          pagination={
            bestSellerPagination
              ? {
                  page: bestSellerPagination.page,
                  totalPages: bestSellerPagination.total_pages,
                  total: bestSellerPagination.total,
                  onPageChange: setBestSellerPage,
                }
              : undefined
          }
        />
      </section>
    </AdminLayout>
  );
}
