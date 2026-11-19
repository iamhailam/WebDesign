import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, History, PackagePlus, Search } from 'lucide-react';
import { z } from 'zod';
import { ApiClientError } from '@/lib/api';
import {
  fetchAdminInventoryApi,
  fetchInventoryTransactionsApi,
  importInventoryApi,
  type InventoryItemDto,
  type InventoryTransactionDto,
} from '@/lib/admin-api';
import { formatAdminDateTime, formatOptionsSummary } from '@/lib/admin-navigation';
import { useAuth } from '@/lib/auth-store';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { FormField, Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import { AdminLayout } from '@/components/layout/admin-layout';
import { DataTable, type DataTableColumn } from '@/components/admin/data-table';

const importSchema = z.object({
  quantity: z
    .number({ message: 'Vui lòng nhập số lượng.' })
    .int('Số lượng nhập phải là số nguyên.')
    .min(1, 'Số lượng tối thiểu là 1.')
    .max(999999, 'Số lượng tối đa 999.999 mỗi lần nhập.'),
  note: z
    .string()
    .trim()
    .min(1, 'Vui lòng nhập ghi chú phiếu nhập.')
    .max(1000, 'Ghi chú tối đa 1000 ký tự.'),
});

type ImportValues = z.infer<typeof importSchema>;

const TX_TYPE_LABELS: Readonly<
  Record<string, { label: string; variant: 'success' | 'warning' | 'neutral' }>
> = {
  IMPORT: { label: 'Nhập kho', variant: 'success' },
  EXPORT_ORDER: { label: 'Xuất bán đơn', variant: 'warning' },
  RETURN_CANCEL: { label: 'Hoàn hủy đơn', variant: 'neutral' },
};

function generateUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return '00000000-0000-4000-8000-000000000000'.replace(/[0]/g, () =>
    Math.floor(Math.random() * 16).toString(16),
  );
}

export function AdminInventoryPage() {
  const { token } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const [thresholdInput, setThresholdInput] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [appliedThreshold, setAppliedThreshold] = useState<number | undefined>(undefined);

  const [selectedSku, setSelectedSku] = useState<InventoryItemDto | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState('');

  const importForm = useForm<ImportValues>({
    resolver: zodResolver(importSchema),
    defaultValues: { quantity: 10, note: '' },
  });

  const inventoryQuery = useQuery({
    queryKey: ['admin-inventory', page, appliedSearch, appliedThreshold ?? 'all'],
    queryFn: () =>
      fetchAdminInventoryApi(token ?? '', {
        page,
        page_size: 20,
        ...(appliedSearch ? { search: appliedSearch } : {}),
        ...(appliedThreshold !== undefined ? { low_stock_threshold: appliedThreshold } : {}),
      }),
    enabled: Boolean(token),
  });

  const importMutation = useMutation({
    mutationFn: (payload: { variant_id: number; quantity: number; note: string; key: string }) =>
      importInventoryApi(
        token ?? '',
        { variant_id: payload.variant_id, quantity: payload.quantity, note: payload.note },
        payload.key,
      ),
    onSuccess: (res) => {
      setSelectedSku(null);
      setIdempotencyKey('');
      importForm.reset({ quantity: 10, note: '' });
      void queryClient.invalidateQueries({ queryKey: ['admin-inventory'] });
      void queryClient.invalidateQueries({ queryKey: ['admin-inventory-transactions'] });
      toast({
        variant: res.data.replayed ? 'default' : 'success',
        title: res.data.replayed
          ? 'Đã đồng bộ phiếu nhập (Idempotent replay)'
          : `Đã nhập +${res.data.transaction.quantity_change} vào SKU ${res.data.transaction.sku}`,
        description: res.data.replayed
          ? 'Yêu cầu trùng khóa Idempotency-Key đã được ghi nhận trước đó, không cộng tồn kho 2 lần.'
          : undefined,
      });
    },
    onError: (err) => {
      toast({
        variant: 'error',
        title: 'Nhập kho thất bại',
        description:
          err instanceof ApiClientError
            ? `${err.message} Bạn có thể thử gửi lại an toàn với cùng Idempotency-Key.`
            : 'Lỗi mạng. Thử gửi lại để giữ nguyên khóa chống trùng.',
      });
    },
  });

  function openImportModal(item: InventoryItemDto) {
    setIdempotencyKey(generateUuid());
    importForm.reset({ quantity: 10, note: '' });
    setSelectedSku(item);
  }

  function handleFilterSubmit(event: React.FormEvent) {
    event.preventDefault();
    const trimmedThreshold = thresholdInput.trim();
    const parsedThreshold = /^[0-9]+$/.test(trimmedThreshold) ? Number(trimmedThreshold) : undefined;
    setPage(1);
    setAppliedSearch(searchInput.trim());
    setAppliedThreshold(parsedThreshold);
  }

  function handleReset() {
    setSearchInput('');
    setThresholdInput('');
    setAppliedSearch('');
    setAppliedThreshold(undefined);
    setPage(1);
  }

  const alertLimit = appliedThreshold ?? 5;

  const columns: DataTableColumn<InventoryItemDto>[] = [
    {
      key: 'sku',
      header: 'SKU',
      render: (row) => (
        <div>
          <p className="font-mono text-xs font-semibold text-foreground">{row.sku}</p>
          <p className="text-[11px] text-muted-foreground">Variant #{row.variant_id}</p>
        </div>
      ),
    },
    {
      key: 'product',
      header: 'Sản phẩm & Phiên bản',
      render: (row) => (
        <div>
          <p className="font-medium text-foreground">{row.product_name}</p>
          <p className="text-xs text-muted-foreground">{formatOptionsSummary(row.options)}</p>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Trạng thái SKU',
      render: (row) => (
        <Badge variant={row.is_active ? 'success' : 'neutral'}>
          {row.is_active ? 'Đang bán' : 'Ngừng bán'}
        </Badge>
      ),
    },
    {
      key: 'quantity',
      header: 'Tồn kho thực tế',
      align: 'right',
      render: (row) => {
        const isZero = row.quantity === 0;
        const isLow = row.quantity <= alertLimit;
        return (
          <div className="inline-flex items-center gap-2">
            {isZero ? (
              <Badge variant="red-soft">Hết hàng</Badge>
            ) : isLow ? (
              <Badge variant="warning">
                <AlertTriangle className="mr-1 size-3" aria-hidden="true" />
                Sắp hết
              </Badge>
            ) : null}
            <span className="tabular-nums-vnd text-base font-bold text-foreground">
              {row.quantity}
            </span>
          </div>
        );
      },
    },
    {
      key: 'updated_at',
      header: 'Cập nhật gần nhất',
      render: (row) => (
        <span className="text-xs text-muted-foreground">{formatAdminDateTime(row.updated_at)}</span>
      ),
    },
    {
      key: 'actions',
      header: 'Thao tác',
      align: 'right',
      render: (row) => (
        <Button type="button" variant="outline" size="sm" onClick={() => openImportModal(row)}>
          <PackagePlus className="size-4" aria-hidden="true" />
          <span>Nhập kho</span>
        </Button>
      ),
    },
  ];

  const items = inventoryQuery.data?.data.items ?? [];
  const pagination = inventoryQuery.data?.meta.pagination;

  return (
    <AdminLayout
      title="Quản lý tồn kho SKU"
      description="Số lượng tồn kho chỉ thay đổi qua phiếu nhập kho (sp_import_inventory) hoặc đơn hàng."
      breadcrumbs={[{ label: 'Back-Office', to: '/admin/inventory' }, { label: 'Tồn kho SKU' }]}
      actions={
        <Button asChild variant="outline" size="sm">
          <Link to="/admin/inventory/transactions">
            <History className="size-4" aria-hidden="true" />
            <span>Xem sổ kho (Ledger)</span>
          </Link>
        </Button>
      }
    >
      <form
        onSubmit={handleFilterSubmit}
        className="grid grid-cols-1 gap-3 rounded-lg border border-border bg-card p-4 sm:grid-cols-2 lg:grid-cols-4 lg:items-end"
      >
        <FormField label="Tìm SKU / tên sản phẩm" htmlFor="inv-search">
          {(fieldProps) => (
            <Input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Nhập SKU hoặc tên..."
              {...fieldProps}
            />
          )}
        </FormField>

        <FormField label="Lọc dưới ngưỡng tồn" htmlFor="inv-threshold">
          {(fieldProps) => (
            <Input
              inputMode="numeric"
              value={thresholdInput}
              onChange={(e) => setThresholdInput(e.target.value)}
              placeholder="VD: 5 (để trống = tất cả)"
              {...fieldProps}
            />
          )}
        </FormField>

        <Button type="submit" variant="brand">
          <Search className="size-4" aria-hidden="true" />
          <span>Lọc tồn kho</span>
        </Button>

        <Button type="button" variant="outline" onClick={handleReset}>
          Đặt lại
        </Button>
      </form>

      <DataTable
        columns={columns}
        rows={items}
        rowKey={(row) => row.variant_id}
        isLoading={inventoryQuery.isPending}
        isError={inventoryQuery.isError}
        errorMessage="Không thể tải tồn kho."
        onRetry={() => void inventoryQuery.refetch()}
        emptyTitle="Không tìm thấy SKU phù hợp"
        emptyDescription="Thử thay đổi từ khóa tìm kiếm hoặc ngưỡng tồn kho."
        caption="Bảng tồn kho theo từng SKU"
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

      {/* Import Inventory Modal */}
      <Dialog
        open={Boolean(selectedSku)}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedSku(null);
            setIdempotencyKey('');
          }
        }}
        title={selectedSku ? `Nhập kho SKU ${selectedSku.sku}` : 'Nhập kho'}
        description={
          selectedSku
            ? `${selectedSku.product_name} · Tồn hiện tại: ${selectedSku.quantity}`
            : undefined
        }
        size="sm"
      >
        <form
          onSubmit={importForm.handleSubmit((values) => {
            if (!selectedSku) return;
            const key = idempotencyKey || generateUuid();
            if (!idempotencyKey) setIdempotencyKey(key);
            importMutation.mutate({
              variant_id: selectedSku.variant_id,
              quantity: values.quantity,
              note: values.note,
              key,
            });
          })}
          className="space-y-4"
        >
          <FormField
            label="Số lượng nhập thêm"
            htmlFor="import-quantity"
            required
            error={importForm.formState.errors.quantity?.message}
          >
            {(fieldProps) => (
              <Input
                type="number"
                min={1}
                max={999999}
                {...fieldProps}
                {...importForm.register('quantity', {
                  valueAsNumber: true,
                  onChange: () => setIdempotencyKey(generateUuid()),
                })}
              />
            )}
          </FormField>

          <FormField
            label="Ghi chú phiếu nhập"
            htmlFor="import-note"
            required
            error={importForm.formState.errors.note?.message}
          >
            {(fieldProps) => (
              <Input
                placeholder="VD: Nhập lô hàng nhà cung cấp tháng 11"
                {...fieldProps}
                {...importForm.register('note', {
                  onChange: () => setIdempotencyKey(generateUuid()),
                })}
              />
            )}
          </FormField>

          <p className="rounded-md bg-surface px-3 py-2 text-[11px] text-muted-foreground">
            Phiếu nhập dùng khóa Idempotency-Key chống trùng lặp nếu kết nối bị ngắt khi gửi lại.
          </p>

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setSelectedSku(null);
                setIdempotencyKey('');
              }}
            >
              Hủy
            </Button>
            <Button type="submit" variant="brand" disabled={importMutation.isPending}>
              Xác nhận nhập kho
            </Button>
          </div>
        </form>
      </Dialog>
    </AdminLayout>
  );
}

export function AdminInventoryTransactionsPage() {
  const { token } = useAuth();
  const [page, setPage] = useState(1);
  const [typeFilter, setTypeFilter] = useState<'IMPORT' | 'EXPORT_ORDER' | 'RETURN_CANCEL' | ''>('');
  const [variantIdInput, setVariantIdInput] = useState('');
  const [fromInput, setFromInput] = useState('');
  const [toInput, setToInput] = useState('');
  const [applied, setApplied] = useState<{
    variant_id?: number | undefined;
    from?: string | undefined;
    to?: string | undefined;
  }>({});
  const [dateError, setDateError] = useState<string | null>(null);

  const ledgerQuery = useQuery({
    queryKey: [
      'admin-inventory-transactions',
      page,
      typeFilter,
      applied.variant_id ?? '',
      applied.from ?? '',
      applied.to ?? '',
    ],
    queryFn: () =>
      fetchInventoryTransactionsApi(token ?? '', {
        page,
        page_size: 20,
        ...(typeFilter ? { type: typeFilter } : {}),
        ...(applied.variant_id ? { variant_id: applied.variant_id } : {}),
        ...(applied.from ? { from: applied.from } : {}),
        ...(applied.to ? { to: applied.to } : {}),
      }),
    enabled: Boolean(token),
  });

  function handleFilter(event: React.FormEvent) {
    event.preventDefault();
    if (fromInput && toInput && fromInput > toInput) {
      setDateError('Ngày bắt đầu không được lớn hơn ngày kết thúc.');
      return;
    }
    setDateError(null);
    const parsedVariantId = /^[1-9][0-9]*$/.test(variantIdInput.trim())
      ? Number(variantIdInput.trim())
      : undefined;
    setPage(1);
    setApplied({
      ...(parsedVariantId ? { variant_id: parsedVariantId } : {}),
      ...(fromInput ? { from: fromInput } : {}),
      ...(toInput ? { to: toInput } : {}),
    });
  }

  function handleReset() {
    setTypeFilter('');
    setVariantIdInput('');
    setFromInput('');
    setToInput('');
    setApplied({});
    setDateError(null);
    setPage(1);
  }

  const columns: DataTableColumn<InventoryTransactionDto>[] = [
    {
      key: 'created_at',
      header: 'Thời gian',
      render: (row) => (
        <span className="text-xs text-muted-foreground">{formatAdminDateTime(row.created_at)}</span>
      ),
    },
    {
      key: 'sku',
      header: 'SKU / Variant',
      render: (row) => (
        <div>
          <p className="font-mono text-xs font-semibold text-foreground">{row.sku}</p>
          <p className="text-[11px] text-muted-foreground">Variant #{row.variant_id}</p>
        </div>
      ),
    },
    {
      key: 'type',
      header: 'Loại giao dịch',
      render: (row) => {
        const meta = TX_TYPE_LABELS[row.type] ?? { label: row.type, variant: 'neutral' as const };
        return <Badge variant={meta.variant}>{meta.label}</Badge>;
      },
    },
    {
      key: 'qty',
      header: 'Biến động',
      align: 'right',
      render: (row) => (
        <span
          className={`tabular-nums-vnd font-bold ${
            row.quantity_change > 0 ? 'text-success' : 'text-brand-red'
          }`}
        >
          {row.quantity_change > 0 ? `+${row.quantity_change}` : row.quantity_change}
        </span>
      ),
    },
    {
      key: 'reference',
      header: 'Chứng từ tham chiếu',
      render: (row) => (
        <div className="text-xs">
          <span className="font-medium text-foreground">{row.reference_type}</span>
          {row.order_code ? (
            <span className="ml-2 font-mono text-muted-foreground">({row.order_code})</span>
          ) : row.reference_id ? (
            <span className="ml-2 text-muted-foreground">#{row.reference_id}</span>
          ) : null}
        </div>
      ),
    },
    {
      key: 'note',
      header: 'Ghi chú / Người tạo',
      render: (row) => (
        <div className="max-w-xs text-xs">
          <p className="truncate text-foreground">{row.note || '—'}</p>
          <p className="text-[11px] text-muted-foreground">Actor #{row.created_by}</p>
        </div>
      ),
    },
  ];

  const items = ledgerQuery.data?.data.items ?? [];
  const pagination = ledgerQuery.data?.meta.pagination;

  return (
    <AdminLayout
      title="Sổ cái biến động kho (Ledger)"
      description="Lịch sử append-only mọi lần nhập kho, xuất bán và hoàn hủy đơn (không hiển thị PII giao hàng)."
      breadcrumbs={[
        { label: 'Back-Office', to: '/admin/inventory' },
        { label: 'Tồn kho SKU', to: '/admin/inventory' },
        { label: 'Sổ kho' },
      ]}
      actions={
        <Button asChild variant="outline" size="sm">
          <Link to="/admin/inventory">Quay lại tồn kho</Link>
        </Button>
      }
    >
      <form
        onSubmit={handleFilter}
        className="grid grid-cols-1 gap-3 rounded-lg border border-border bg-card p-4 sm:grid-cols-2 lg:grid-cols-6 lg:items-end"
      >
        <FormField label="Loại giao dịch" htmlFor="tx-type">
          {(fieldProps) => (
            <Select
              value={typeFilter}
              onChange={(e) => {
                setTypeFilter(
                  e.target.value as 'IMPORT' | 'EXPORT_ORDER' | 'RETURN_CANCEL' | '',
                );
                setPage(1);
              }}
              {...fieldProps}
            >
              <option value="">Tất cả loại</option>
              <option value="IMPORT">IMPORT (Nhập kho)</option>
              <option value="EXPORT_ORDER">EXPORT_ORDER (Xuất bán)</option>
              <option value="RETURN_CANCEL">RETURN_CANCEL (Hoàn hủy)</option>
            </Select>
          )}
        </FormField>

        <FormField label="Variant ID" htmlFor="tx-variant-id">
          {(fieldProps) => (
            <Input
              inputMode="numeric"
              value={variantIdInput}
              onChange={(e) => setVariantIdInput(e.target.value)}
              placeholder="Tùy chọn"
              {...fieldProps}
            />
          )}
        </FormField>

        <FormField label="Từ ngày" htmlFor="tx-from">
          {(fieldProps) => (
            <Input
              type="date"
              value={fromInput}
              onChange={(e) => setFromInput(e.target.value)}
              {...fieldProps}
            />
          )}
        </FormField>

        <FormField label="Đến ngày" htmlFor="tx-to">
          {(fieldProps) => (
            <Input
              type="date"
              value={toInput}
              onChange={(e) => setToInput(e.target.value)}
              {...fieldProps}
            />
          )}
        </FormField>

        <Button type="submit" variant="brand">
          Lọc sổ kho
        </Button>

        <Button type="button" variant="outline" onClick={handleReset}>
          Đặt lại
        </Button>

        {dateError ? (
          <p role="alert" className="text-xs font-medium text-brand-red sm:col-span-2 lg:col-span-6">
            {dateError}
          </p>
        ) : null}
      </form>

      <DataTable
        columns={columns}
        rows={items}
        rowKey={(row) => row.id}
        isLoading={ledgerQuery.isPending}
        isError={ledgerQuery.isError}
        errorMessage="Không thể tải sổ biến động kho."
        onRetry={() => void ledgerQuery.refetch()}
        emptyTitle="Chưa có giao dịch kho nào"
        emptyDescription="Lịch sử nhập/xuất kho sẽ hiển thị tại đây."
        caption="Sổ cái biến động tồn kho"
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
