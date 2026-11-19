import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Lock, Plus, Search, TicketPercent } from 'lucide-react';
import { z } from 'zod';
import { ApiClientError } from '@/lib/api';
import {
  createVoucherApi,
  fetchAdminVoucherByIdApi,
  fetchAdminVouchersApi,
  fetchVoucherUsagesApi,
  updateVoucherApi,
  type AdminVoucherDto,
  type VoucherUsageDto,
} from '@/lib/admin-api';
import {
  formatAdminDateTime,
  localDateTimeToIso,
  toDateTimeLocalValue,
} from '@/lib/admin-navigation';
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
import { AdminLayout } from '@/components/layout/admin-layout';
import { DataTable, type DataTableColumn } from '@/components/admin/data-table';

const voucherCodeRegex = /^[A-Z0-9]+(-[A-Z0-9]+)*$/;
const moneyRegex = /^(0|[1-9][0-9]{0,9})(\.[0-9]{1,2})?$/;

function toFixedTwoDecimals(value: string): string {
  const trimmed = value.trim();
  const [whole, frac = ''] = trimmed.split('.');
  return `${whole}.${frac.padEnd(2, '0')}`;
}

const createVoucherFormSchema = z
  .object({
    code: z
      .string()
      .trim()
      .transform((v) => v.toUpperCase())
      .refine((v) => v.length >= 1 && v.length <= 40 && voucherCodeRegex.test(v), {
        message: 'Mã voucher chỉ gồm A-Z, 0-9 và dấu gạch nối đơn.',
      }),
    discount_type: z.enum(['FIXED', 'PERCENT']),
    discount_value: z.string().trim().regex(moneyRegex, 'Giá trị giảm không hợp lệ.'),
    max_discount_amount: z.string().trim().optional(),
    min_order_amount: z.string().trim().regex(moneyRegex, 'Đơn tối thiểu không hợp lệ.'),
    usage_limit: z.number({ message: 'Nhập số lượt hợp lệ.' }).int('Số lượt phải là số nguyên.').min(1, 'Tối thiểu 1 lượt.'),
    start_date_local: z.string().min(1, 'Chọn thời gian bắt đầu.'),
    end_date_local: z.string().min(1, 'Chọn thời gian kết thúc.'),
    is_active: z.boolean(),
  })
  .superRefine((v, ctx) => {
    const val = Number(v.discount_value);
    if (v.discount_type === 'FIXED') {
      if (val <= 0 || !Number.isInteger(val)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Voucher FIXED phải là số nguyên VND > 0.',
          path: ['discount_value'],
        });
      }
    } else {
      if (val <= 0 || val > 100) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Voucher PERCENT phải nằm trong khoảng (0, 100].',
          path: ['discount_value'],
        });
      }
      if (
        v.max_discount_amount &&
        (!moneyRegex.test(v.max_discount_amount) || Number(v.max_discount_amount) <= 0)
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Giảm tối đa phải là số > 0.',
          path: ['max_discount_amount'],
        });
      }
    }
    if (Date.parse(v.end_date_local) <= Date.parse(v.start_date_local)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Thời gian kết thúc phải sau thời gian bắt đầu.',
        path: ['end_date_local'],
      });
    }
  });

type CreateVoucherFormValues = z.infer<typeof createVoucherFormSchema>;

const editVoucherFormSchema = z.object({
  discount_type: z.enum(['FIXED', 'PERCENT']),
  discount_value: z.string().trim().regex(moneyRegex, 'Giá trị giảm không hợp lệ.'),
  max_discount_amount: z.string().trim().optional(),
  min_order_amount: z.string().trim().regex(moneyRegex, 'Đơn tối thiểu không hợp lệ.'),
  usage_limit: z.number({ message: 'Nhập số lượt hợp lệ.' }).int().min(1),
  start_date_local: z.string().min(1),
  end_date_local: z.string().min(1),
  is_active: z.boolean(),
});

type EditVoucherFormValues = z.infer<typeof editVoucherFormSchema>;

function defaultVoucherWindow(): { start: string; end: string } {
  const now = new Date();
  const nextMonth = new Date(now.getTime() + 30 * 86_400_000);
  return {
    start: toDateTimeLocalValue(now.toISOString()),
    end: toDateTimeLocalValue(nextMonth.toISOString()),
  };
}

export function AdminVouchersPage() {
  const { token } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState('');
  const [createOpen, setCreateOpen] = useState(false);

  const vouchersQuery = useQuery({
    queryKey: ['admin-vouchers', page, appliedSearch, activeFilter],
    queryFn: () =>
      fetchAdminVouchersApi(token ?? '', {
        page,
        page_size: 20,
        ...(appliedSearch ? { search: appliedSearch } : {}),
        ...(activeFilter === 'true'
          ? { is_active: true }
          : activeFilter === 'false'
            ? { is_active: false }
            : {}),
      }),
    enabled: Boolean(token),
  });

  const windowDefaults = defaultVoucherWindow();
  const form = useForm<CreateVoucherFormValues>({
    resolver: zodResolver(createVoucherFormSchema),
    defaultValues: {
      code: '',
      discount_type: 'FIXED',
      discount_value: '50000',
      max_discount_amount: '',
      min_order_amount: '300000',
      usage_limit: 50,
      start_date_local: windowDefaults.start,
      end_date_local: windowDefaults.end,
      is_active: true,
    },
  });

  const watchedType = useWatch({ control: form.control, name: 'discount_type' });

  const createMutation = useMutation({
    mutationFn: (values: CreateVoucherFormValues) =>
      createVoucherApi(token ?? '', {
        code: values.code,
        discount_type: values.discount_type,
        discount_value: toFixedTwoDecimals(values.discount_value),
        max_discount_amount:
          values.discount_type === 'PERCENT' && values.max_discount_amount?.trim()
            ? toFixedTwoDecimals(values.max_discount_amount)
            : null,
        min_order_amount: toFixedTwoDecimals(values.min_order_amount),
        usage_limit: values.usage_limit,
        start_date: localDateTimeToIso(values.start_date_local),
        end_date: localDateTimeToIso(values.end_date_local),
        is_active: values.is_active,
      }),
    onSuccess: (res) => {
      setCreateOpen(false);
      form.reset();
      void queryClient.invalidateQueries({ queryKey: ['admin-vouchers'] });
      toast({
        variant: 'success',
        title: `Đã tạo voucher ${res.data.code}`,
      });
    },
    onError: (err) => {
      toast({
        variant: 'error',
        title: 'Tạo voucher thất bại',
        description: err instanceof ApiClientError ? err.message : 'Vui lòng kiểm tra thông số.',
      });
    },
  });

  const columns: DataTableColumn<AdminVoucherDto>[] = [
    {
      key: 'code',
      header: 'Mã Voucher',
      render: (row) => (
        <Link
          to={`/admin/vouchers/${row.id}`}
          className="font-mono text-sm font-bold text-brand-red hover:underline"
        >
          {row.code}
        </Link>
      ),
    },
    {
      key: 'terms',
      header: 'Ưu đãi & Điều kiện',
      render: (row) => (
        <div className="text-xs">
          <p className="font-semibold text-foreground">
            {row.discount_type === 'FIXED'
              ? `Giảm ${formatVnd(row.discount_value)}`
              : `Giảm ${Number(row.discount_value)}%${
                  row.max_discount_amount ? ` (tối đa ${formatVnd(row.max_discount_amount)})` : ''
                }`}
          </p>
          <p className="text-muted-foreground">Đơn tối thiểu {formatVnd(row.min_order_amount)}</p>
        </div>
      ),
    },
    {
      key: 'usage',
      header: 'Lượt sử dụng',
      render: (row) => {
        const pct =
          row.usage_limit > 0
            ? Math.min(100, Math.round((row.used_count / row.usage_limit) * 100))
            : 0;
        return (
          <div className="w-36 space-y-1">
            <div className="flex justify-between text-xs tabular-nums-vnd">
              <span className="font-semibold">{row.used_count}</span>
              <span className="text-muted-foreground">/ {row.usage_limit}</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-surface">
              <div className="h-full bg-brand-red" style={{ width: `${pct}%` }} />
            </div>
          </div>
        );
      },
    },
    {
      key: 'window',
      header: 'Hiệu lực',
      render: (row) => (
        <div className="text-xs text-muted-foreground">
          <p>{formatAdminDateTime(row.start_date)}</p>
          <p>→ {formatAdminDateTime(row.end_date)}</p>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Trạng thái',
      render: (row) => (
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant={row.is_active ? 'success' : 'neutral'}>
            {row.is_active ? 'Hoạt động' : 'Tạm ngưng'}
          </Badge>
          {row.used_count > 0 ? (
            <Badge variant="warning">
              <Lock className="mr-1 size-3" aria-hidden="true" />
              Đã khóa terms
            </Badge>
          ) : null}
        </div>
      ),
    },
    {
      key: 'actions',
      header: 'Thao tác',
      align: 'right',
      render: (row) => (
        <Button asChild variant="outline" size="sm">
          <Link to={`/admin/vouchers/${row.id}`}>Chi tiết</Link>
        </Button>
      ),
    },
  ];

  const items = vouchersQuery.data?.data.items ?? [];
  const pagination = vouchersQuery.data?.meta.pagination;

  return (
    <AdminLayout
      title="Quản lý Voucher khuyến mãi"
      description="Tạo mã giảm giá, theo dõi lượt sử dụng và quản lý điều khoản (MARKETING / ADMIN)."
      breadcrumbs={[{ label: 'Back-Office', to: '/admin/dashboard' }, { label: 'Vouchers' }]}
      actions={
        <Button
          type="button"
          variant="brand"
          onClick={() => {
            const win = defaultVoucherWindow();
            form.reset({
              code: '',
              discount_type: 'FIXED',
              discount_value: '50000',
              max_discount_amount: '',
              min_order_amount: '300000',
              usage_limit: 50,
              start_date_local: win.start,
              end_date_local: win.end,
              is_active: true,
            });
            setCreateOpen(true);
          }}
        >
          <Plus className="size-4" aria-hidden="true" />
          <span>Tạo Voucher mới</span>
        </Button>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setPage(1);
          setAppliedSearch(searchInput.trim());
        }}
        className="grid grid-cols-1 gap-3 rounded-lg border border-border bg-card p-4 sm:grid-cols-4 sm:items-end"
      >
        <FormField label="Tìm mã voucher" htmlFor="voucher-search">
          {(fieldProps) => (
            <Input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="VD: SALE10..."
              {...fieldProps}
            />
          )}
        </FormField>

        <FormField label="Trạng thái" htmlFor="voucher-active">
          {(fieldProps) => (
            <Select
              value={activeFilter}
              onChange={(e) => {
                setActiveFilter(e.target.value);
                setPage(1);
              }}
              {...fieldProps}
            >
              <option value="">Tất cả</option>
              <option value="true">Đang hoạt động</option>
              <option value="false">Tạm ngưng</option>
            </Select>
          )}
        </FormField>

        <Button type="submit" variant="brand">
          <Search className="size-4" aria-hidden="true" />
          <span>Tìm kiếm</span>
        </Button>

        <Button
          type="button"
          variant="outline"
          onClick={() => {
            setSearchInput('');
            setAppliedSearch('');
            setActiveFilter('');
            setPage(1);
          }}
        >
          Đặt lại
        </Button>
      </form>

      <DataTable
        columns={columns}
        rows={items}
        rowKey={(row) => row.id}
        isLoading={vouchersQuery.isPending}
        isError={vouchersQuery.isError}
        errorMessage="Không thể tải danh sách voucher."
        onRetry={() => void vouchersQuery.refetch()}
        emptyTitle="Chưa có voucher phù hợp"
        caption="Danh sách voucher khuyến mãi"
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

      <Dialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        title="Tạo Voucher khuyến mãi mới"
        description="Quy tắc giảm giá được kiểm tra cả ở giao diện và hàm PostgreSQL."
        size="md"
      >
        <form onSubmit={form.handleSubmit((values) => createMutation.mutate(values))} className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FormField label="Mã Voucher" htmlFor="new-v-code" required error={form.formState.errors.code?.message}>
              {(fieldProps) => (
                <Input placeholder="VD: SUMMER20" {...fieldProps} {...form.register('code')} />
              )}
            </FormField>
            <FormField label="Loại chiết khấu" htmlFor="new-v-type" required>
              {(fieldProps) => (
                <Select {...fieldProps} {...form.register('discount_type')}>
                  <option value="FIXED">FIXED (Giảm tiền cố định VND)</option>
                  <option value="PERCENT">PERCENT (Giảm theo %)</option>
                </Select>
              )}
            </FormField>
            <FormField
              label={watchedType === 'PERCENT' ? 'Phần trăm giảm (1..100)' : 'Số tiền giảm (VND)'}
              htmlFor="new-v-val"
              required
              error={form.formState.errors.discount_value?.message}
            >
              {(fieldProps) => <Input {...fieldProps} {...form.register('discount_value')} />}
            </FormField>
            {watchedType === 'PERCENT' ? (
              <FormField
                label="Giảm tối đa (VND, tùy chọn)"
                htmlFor="new-v-max"
                error={form.formState.errors.max_discount_amount?.message}
              >
                {(fieldProps) => (
                  <Input placeholder="100000" {...fieldProps} {...form.register('max_discount_amount')} />
                )}
              </FormField>
            ) : (
              <FormField label="Giảm tối đa" htmlFor="new-v-max-disabled">
                {(fieldProps) => (
                  <Input value="Không áp dụng cho FIXED" disabled {...fieldProps} />
                )}
              </FormField>
            )}
            <FormField
              label="Đơn tối thiểu (VND)"
              htmlFor="new-v-min"
              required
              error={form.formState.errors.min_order_amount?.message}
            >
              {(fieldProps) => <Input {...fieldProps} {...form.register('min_order_amount')} />}
            </FormField>
            <FormField
              label="Giới hạn lượt dùng"
              htmlFor="new-v-limit"
              required
              error={form.formState.errors.usage_limit?.message}
            >
              {(fieldProps) => (
                <Input
                  type="number"
                  min={1}
                  {...fieldProps}
                  {...form.register('usage_limit', { valueAsNumber: true })}
                />
              )}
            </FormField>
            <FormField
              label="Bắt đầu"
              htmlFor="new-v-start"
              required
              error={form.formState.errors.start_date_local?.message}
            >
              {(fieldProps) => (
                <Input type="datetime-local" {...fieldProps} {...form.register('start_date_local')} />
              )}
            </FormField>
            <FormField
              label="Kết thúc"
              htmlFor="new-v-end"
              required
              error={form.formState.errors.end_date_local?.message}
            >
              {(fieldProps) => (
                <Input type="datetime-local" {...fieldProps} {...form.register('end_date_local')} />
              )}
            </FormField>
          </div>

          <label className="inline-flex min-h-10 cursor-pointer items-center gap-2 text-sm">
            <input type="checkbox" className="size-4 accent-brand-red" {...form.register('is_active')} />
            <span>Kích hoạt voucher ngay</span>
          </label>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>
              Hủy
            </Button>
            <Button type="submit" variant="brand" disabled={createMutation.isPending}>
              <TicketPercent className="size-4" aria-hidden="true" />
              <span>Tạo Voucher</span>
            </Button>
          </div>
        </form>
      </Dialog>
    </AdminLayout>
  );
}

export function AdminVoucherDetailPage() {
  const { id } = useParams();
  const voucherId = Number(id);
  const { token } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [usagePage, setUsagePage] = useState(1);
  const [usageStatus, setUsageStatus] = useState('');

  const detailQuery = useQuery({
    queryKey: ['admin-voucher-detail', voucherId],
    queryFn: () => fetchAdminVoucherByIdApi(token ?? '', voucherId),
    enabled: Boolean(token && Number.isInteger(voucherId) && voucherId > 0),
  });

  const usagesQuery = useQuery({
    queryKey: ['admin-voucher-usages', voucherId, usagePage, usageStatus],
    queryFn: () =>
      fetchVoucherUsagesApi(token ?? '', voucherId, {
        page: usagePage,
        page_size: 20,
        ...(usageStatus ? { status: usageStatus } : {}),
      }),
    enabled: Boolean(token && Number.isInteger(voucherId) && voucherId > 0),
  });

  const voucher = detailQuery.data?.data;
  const termsLocked = Boolean(voucher && voucher.used_count > 0);

  const form = useForm<EditVoucherFormValues>({
    resolver: zodResolver(editVoucherFormSchema),
    defaultValues: {
      discount_type: 'FIXED',
      discount_value: '0',
      max_discount_amount: '',
      min_order_amount: '0',
      usage_limit: 1,
      start_date_local: '',
      end_date_local: '',
      is_active: true,
    },
  });

  const watchedType = useWatch({ control: form.control, name: 'discount_type' });

  useEffect(() => {
    if (voucher) {
      form.reset({
        discount_type: voucher.discount_type,
        discount_value: voucher.discount_value,
        max_discount_amount: voucher.max_discount_amount ?? '',
        min_order_amount: voucher.min_order_amount,
        usage_limit: voucher.usage_limit,
        start_date_local: toDateTimeLocalValue(voucher.start_date),
        end_date_local: toDateTimeLocalValue(voucher.end_date),
        is_active: voucher.is_active,
      });
    }
  }, [voucher, form]);

  const updateMutation = useMutation({
    mutationFn: (values: EditVoucherFormValues) => {
      if (!voucher) throw new Error('Voucher missing');
      if (termsLocked) {
        if (values.usage_limit < voucher.used_count) {
          throw new ApiClientError(
            400,
            'VALIDATION_ERROR',
            `usage_limit không thể nhỏ hơn số lượt đã dùng (${voucher.used_count}).`,
          );
        }
        return updateVoucherApi(token ?? '', voucherId, {
          discount_type: voucher.discount_type,
          discount_value: voucher.discount_value,
          max_discount_amount: voucher.max_discount_amount,
          min_order_amount: voucher.min_order_amount,
          usage_limit: values.usage_limit,
          start_date: voucher.start_date,
          end_date: voucher.end_date,
          is_active: values.is_active,
        });
      }
      return updateVoucherApi(token ?? '', voucherId, {
        discount_type: values.discount_type,
        discount_value: toFixedTwoDecimals(values.discount_value),
        max_discount_amount:
          values.discount_type === 'PERCENT' && values.max_discount_amount?.trim()
            ? toFixedTwoDecimals(values.max_discount_amount)
            : null,
        min_order_amount: toFixedTwoDecimals(values.min_order_amount),
        usage_limit: values.usage_limit,
        start_date: localDateTimeToIso(values.start_date_local),
        end_date: localDateTimeToIso(values.end_date_local),
        is_active: values.is_active,
      });
    },
    onSuccess: (res) => {
      queryClient.setQueryData(['admin-voucher-detail', voucherId], res);
      void queryClient.invalidateQueries({ queryKey: ['admin-vouchers'] });
      toast({ variant: 'success', title: 'Đã cập nhật voucher' });
    },
    onError: (err) => {
      if (err instanceof ApiClientError && err.code === 'VOUCHER_TERMS_LOCKED') {
        void queryClient.invalidateQueries({ queryKey: ['admin-voucher-detail', voucherId] });
      }
      toast({
        variant: 'error',
        title: 'Cập nhật voucher thất bại',
        description: err instanceof ApiClientError ? err.message : 'Vui lòng kiểm tra dữ liệu.',
      });
    },
  });

  const usageColumns: DataTableColumn<VoucherUsageDto>[] = [
    {
      key: 'used_at',
      header: 'Thời gian dùng',
      render: (row) => (
        <span className="text-xs text-muted-foreground">{formatAdminDateTime(row.used_at)}</span>
      ),
    },
    {
      key: 'order_code',
      header: 'Mã đơn hàng',
      render: (row) => <span className="font-mono text-xs font-semibold">{row.order_code}</span>,
    },
    {
      key: 'customer',
      header: 'Khách hàng (Email đã che)',
      render: (row) => (
        <div className="text-xs">
          <p className="font-medium text-foreground">{row.user_display_name}</p>
          <p className="font-mono text-muted-foreground">{row.email_masked}</p>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Trạng thái lượt',
      render: (row) => (
        <Badge variant={row.status === 'APPLIED' ? 'success' : 'neutral'}>{row.status}</Badge>
      ),
    },
  ];

  const usages = usagesQuery.data?.data.items ?? [];
  const usagesPagination = usagesQuery.data?.meta.pagination;

  return (
    <AdminLayout
      title={voucher ? `Voucher ${voucher.code}` : `Voucher #${id ?? ''}`}
      description="Điều chỉnh trạng thái / hạn mức và xem lịch sử lượt áp dụng (che email PII)."
      breadcrumbs={[
        { label: 'Back-Office', to: '/admin/dashboard' },
        { label: 'Vouchers', to: '/admin/vouchers' },
        { label: voucher?.code ?? `#${id ?? ''}` },
      ]}
      actions={
        <Button asChild variant="outline" size="sm">
          <Link to="/admin/vouchers">Quay lại danh sách</Link>
        </Button>
      }
    >
      {detailQuery.isPending ? (
        <Skeleton className="h-80 w-full rounded-lg" />
      ) : detailQuery.isError || !voucher ? (
        <ErrorState
          message="Không thể tải chi tiết voucher."
          onRetry={() => void detailQuery.refetch()}
        />
      ) : (
        <div className="space-y-6">
          {termsLocked ? (
            <div
              role="status"
              className="flex items-start gap-2.5 rounded-lg border border-warning/40 bg-warning-soft/70 p-4 text-sm text-foreground"
            >
              <Lock className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
              <div>
                <p className="font-semibold">
                  Điều khoản chiết khấu đã khóa (used_count = {voucher.used_count})
                </p>
                <p className="text-xs text-muted-foreground">
                  Theo quy tắc chống sai lệch đối soát, voucher đã có lượt dùng chỉ cho phép thay đổi trạng thái và tăng usage_limit (≥ {voucher.used_count}).
                </p>
              </div>
            </div>
          ) : null}

          <section className="rounded-lg border border-border bg-card p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-base font-bold text-foreground">Cấu hình Voucher</h2>
              <Badge variant={voucher.is_active ? 'success' : 'neutral'}>
                Đã dùng {voucher.used_count} / {voucher.usage_limit} lượt
              </Badge>
            </div>

            <form
              onSubmit={form.handleSubmit((values) => updateMutation.mutate(values))}
              className="space-y-4"
            >
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <FormField label="Loại chiết khấu" htmlFor="edit-v-type">
                  {(fieldProps) => (
                    <Select disabled={termsLocked} {...fieldProps} {...form.register('discount_type')}>
                      <option value="FIXED">FIXED</option>
                      <option value="PERCENT">PERCENT</option>
                    </Select>
                  )}
                </FormField>

                <FormField label="Giá trị giảm" htmlFor="edit-v-val">
                  {(fieldProps) => (
                    <Input disabled={termsLocked} {...fieldProps} {...form.register('discount_value')} />
                  )}
                </FormField>

                <FormField label="Giảm tối đa (PERCENT)" htmlFor="edit-v-max">
                  {(fieldProps) => (
                    <Input
                      disabled={termsLocked || watchedType === 'FIXED'}
                      {...fieldProps}
                      {...form.register('max_discount_amount')}
                    />
                  )}
                </FormField>

                <FormField label="Đơn tối thiểu (VND)" htmlFor="edit-v-min">
                  {(fieldProps) => (
                    <Input disabled={termsLocked} {...fieldProps} {...form.register('min_order_amount')} />
                  )}
                </FormField>

                <FormField
                  label={`Giới hạn lượt dùng (tối thiểu ${Math.max(1, voucher.used_count)})`}
                  htmlFor="edit-v-limit"
                  error={form.formState.errors.usage_limit?.message}
                >
                  {(fieldProps) => (
                    <Input
                      type="number"
                      min={Math.max(1, voucher.used_count)}
                      {...fieldProps}
                      {...form.register('usage_limit', { valueAsNumber: true })}
                    />
                  )}
                </FormField>

                <FormField label="Bắt đầu" htmlFor="edit-v-start">
                  {(fieldProps) => (
                    <Input
                      type="datetime-local"
                      disabled={termsLocked}
                      {...fieldProps}
                      {...form.register('start_date_local')}
                    />
                  )}
                </FormField>

                <FormField label="Kết thúc" htmlFor="edit-v-end">
                  {(fieldProps) => (
                    <Input
                      type="datetime-local"
                      disabled={termsLocked}
                      {...fieldProps}
                      {...form.register('end_date_local')}
                    />
                  )}
                </FormField>
              </div>

              <label className="inline-flex min-h-10 cursor-pointer items-center gap-2 text-sm font-medium">
                <input
                  type="checkbox"
                  className="size-4 accent-brand-red"
                  {...form.register('is_active')}
                />
                <span>Cho phép áp dụng voucher này</span>
              </label>

              <div className="flex justify-end">
                <Button type="submit" variant="brand" disabled={updateMutation.isPending}>
                  Lưu cấu hình Voucher
                </Button>
              </div>
            </form>
          </section>

          <section className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold text-foreground">Chi tiết lượt áp dụng</h2>
                <p className="text-xs text-muted-foreground">
                  Email khách hàng được che ẩn theo chính sách bảo mật dữ liệu MARKETING.
                </p>
              </div>
              <Select
                aria-label="Lọc trạng thái lượt dùng"
                value={usageStatus}
                onChange={(e) => {
                  setUsageStatus(e.target.value);
                  setUsagePage(1);
                }}
                className="w-44"
              >
                <option value="">Tất cả trạng thái</option>
                <option value="APPLIED">APPLIED (Đã áp dụng)</option>
                <option value="RELEASED">RELEASED (Đã hoàn)</option>
              </Select>
            </div>

            <DataTable
              columns={usageColumns}
              rows={usages}
              rowKey={(row) => row.id}
              isLoading={usagesQuery.isPending}
              isError={usagesQuery.isError}
              errorMessage="Không thể tải lịch sử sử dụng voucher."
              onRetry={() => void usagesQuery.refetch()}
              emptyTitle="Chưa có lượt sử dụng nào"
              emptyDescription="Khi khách đặt đơn với mã này, lượt sử dụng sẽ hiển thị tại đây."
              caption="Chi tiết sử dụng voucher"
              pagination={
                usagesPagination
                  ? {
                      page: usagesPagination.page,
                      totalPages: usagesPagination.total_pages,
                      total: usagesPagination.total,
                      onPageChange: setUsagePage,
                    }
                  : undefined
              }
            />
          </section>
        </div>
      )}
    </AdminLayout>
  );
}
