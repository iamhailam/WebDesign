import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Search, Shield } from 'lucide-react';
import { z } from 'zod';
import {
  ApiClientError,
  type BannerDto,
  type Role,
  type UserSelf,
} from '@/lib/api';
import {
  createBannerApi,
  fetchAdminBannersApi,
  fetchAdminBrandsApi,
  fetchAdminCategoriesApi,
  fetchAdminProductsApi,
  fetchAdminUsersApi,
  fetchAuditEventsApi,
  updateAdminUserApi,
  updateBannerApi,
  type AuditEventDto,
} from '@/lib/admin-api';
import {
  formatAdminDateTime,
  localDateTimeToIso,
  toDateTimeLocalValue,
} from '@/lib/admin-navigation';
import { useAuth } from '@/lib/auth-store';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { FormField, Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import { AdminLayout } from '@/components/layout/admin-layout';
import { DataTable, type DataTableColumn } from '@/components/admin/data-table';

const ALL_ROLES: readonly Role[] = ['CUSTOMER', 'SALES', 'WAREHOUSE', 'MARKETING', 'ADMIN'];
const assetPathRegex = /^\/(images|media)\/[A-Za-z0-9/_-]+\.(png|jpg|jpeg|webp|avif|svg)$/;

const editUserSchema = z.object({
  full_name: z.string().trim().min(1, 'Nhập họ tên.').max(120),
  phone: z
    .string()
    .trim()
    .optional()
    .refine(
      (v) => !v || /^\+?[0-9]{8,15}$/.test(v),
      'Số điện thoại gồm 8–15 chữ số (có thể bắt đầu bằng +).',
    ),
  role: z.enum(['CUSTOMER', 'SALES', 'WAREHOUSE', 'MARKETING', 'ADMIN']),
  is_active: z.boolean(),
});

type EditUserValues = z.infer<typeof editUserSchema>;

const bannerFormSchema = z
  .object({
    title: z.string().trim().min(1, 'Nhập tiêu đề banner.').max(160),
    desktop_path: z
      .string()
      .trim()
      .regex(assetPathRegex, 'Đường dẫn ảnh phải bắt đầu bằng /media/... hoặc /images/...'),
    mobile_path: z
      .string()
      .trim()
      .optional()
      .refine(
        (v) => !v || assetPathRegex.test(v),
        'Ảnh mobile phải thuộc /media/... hoặc /images/...',
      ),
    alt_text: z.string().trim().min(1, 'Nhập alt text cho banner.').max(200),
    placement: z.enum(['HERO', 'PROMO']),
    target_type: z.enum(['NONE', 'PRODUCT', 'CATEGORY', 'BRAND']),
    target_id: z.string().optional(),
    starts_at_local: z.string().min(1, 'Chọn thời gian bắt đầu.'),
    ends_at_local: z.string().min(1, 'Chọn thời gian kết thúc.'),
    sort_order: z.number({ message: 'Nhập thứ tự.' }).int().min(0),
    is_active: z.boolean(),
  })
  .superRefine((v, ctx) => {
    if (Date.parse(v.ends_at_local) <= Date.parse(v.starts_at_local)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Thời gian kết thúc phải sau bắt đầu.',
        path: ['ends_at_local'],
      });
    }
    if (v.target_type !== 'NONE' && (!v.target_id || !/^[1-9][0-9]*$/.test(v.target_id))) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Vui lòng chọn đối tượng đích.',
        path: ['target_id'],
      });
    }
  });

type BannerFormValues = z.infer<typeof bannerFormSchema>;

export function AdminUsersPage() {
  const { token, user: currentUser, refreshMe } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<Role | ''>('');
  const [activeFilter, setActiveFilter] = useState('');
  const [editingUser, setEditingUser] = useState<UserSelf | null>(null);

  const form = useForm<EditUserValues>({
    resolver: zodResolver(editUserSchema),
    defaultValues: { full_name: '', phone: '', role: 'CUSTOMER', is_active: true },
  });

  const usersQuery = useQuery({
    queryKey: ['admin-users', page, appliedSearch, roleFilter, activeFilter],
    queryFn: () =>
      fetchAdminUsersApi(token ?? '', {
        page,
        page_size: 20,
        ...(appliedSearch ? { search: appliedSearch } : {}),
        ...(roleFilter ? { role: roleFilter } : {}),
        ...(activeFilter === 'true'
          ? { is_active: true }
          : activeFilter === 'false'
            ? { is_active: false }
            : {}),
      }),
    enabled: Boolean(token),
  });

  const updateMutation = useMutation({
    mutationFn: (values: EditUserValues) => {
      if (!editingUser) throw new Error('No user selected');
      return updateAdminUserApi(token ?? '', editingUser.id, {
        full_name: values.full_name,
        phone: values.phone?.trim() ? values.phone.trim() : null,
        role: values.role,
        is_active: values.is_active,
      });
    },
    onSuccess: async (res) => {
      const updatedId = res.data.id;
      setEditingUser(null);
      void queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      toast({
        variant: 'success',
        title: `Đã cập nhật tài khoản ${res.data.email}`,
        description: 'Phiên đăng nhập cũ (nếu đổi quyền/trạng thái) đã được thu hồi.',
      });
      if (currentUser && updatedId === currentUser.id) {
        await refreshMe();
      }
    },
    onError: (err) => {
      toast({
        variant: 'error',
        title:
          err instanceof ApiClientError && err.code === 'LAST_ADMIN_PROTECTED'
            ? 'Không thể hạ quyền hoặc khóa ADMIN cuối cùng'
            : 'Cập nhật tài khoản thất bại',
        description: err instanceof ApiClientError ? err.message : 'Vui lòng kiểm tra dữ liệu.',
      });
    },
  });

  function openEdit(target: UserSelf) {
    setEditingUser(target);
    form.reset({
      full_name: target.full_name,
      phone: target.phone ?? '',
      role: target.role,
      is_active: target.is_active,
    });
  }

  const columns: DataTableColumn<UserSelf>[] = [
    {
      key: 'user',
      header: 'Người dùng',
      render: (row) => (
        <div>
          <p className="font-semibold text-foreground">{row.full_name}</p>
          <p className="text-xs text-muted-foreground">{row.email}</p>
        </div>
      ),
    },
    {
      key: 'phone',
      header: 'Điện thoại',
      render: (row) => <span className="text-xs">{row.phone || '—'}</span>,
    },
    {
      key: 'role',
      header: 'Vai trò',
      render: (row) => (
        <Badge
          variant={
            row.role === 'ADMIN' ? 'red-soft' : row.role === 'CUSTOMER' ? 'neutral' : 'warning'
          }
        >
          {row.role}
        </Badge>
      ),
    },
    {
      key: 'status',
      header: 'Trạng thái',
      render: (row) => (
        <Badge variant={row.is_active ? 'success' : 'neutral'}>
          {row.is_active ? 'Hoạt động' : 'Đã khóa'}
        </Badge>
      ),
    },
    {
      key: 'created_at',
      header: 'Ngày tạo',
      render: (row) => (
        <span className="text-xs text-muted-foreground">{formatAdminDateTime(row.created_at)}</span>
      ),
    },
    {
      key: 'actions',
      header: 'Thao tác',
      align: 'right',
      render: (row) => (
        <Button type="button" variant="outline" size="sm" onClick={() => openEdit(row)}>
          <Shield className="size-3.5" aria-hidden="true" />
          <span>Phân quyền</span>
        </Button>
      ),
    },
  ];

  const items = usersQuery.data?.data.items ?? [];
  const pagination = usersQuery.data?.meta.pagination;

  return (
    <AdminLayout
      title="Người dùng & Phân quyền"
      description="Quản lý vai trò RBAC (CUSTOMER, SALES, WAREHOUSE, MARKETING, ADMIN) và kích hoạt tài khoản."
      breadcrumbs={[{ label: 'Back-Office', to: '/admin/dashboard' }, { label: 'Người dùng' }]}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setPage(1);
          setAppliedSearch(searchInput.trim());
        }}
        className="grid grid-cols-1 gap-3 rounded-lg border border-border bg-card p-4 sm:grid-cols-2 lg:grid-cols-5 lg:items-end"
      >
        <FormField label="Tìm tên / email" htmlFor="user-search">
          {(fieldProps) => (
            <Input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Nhập email hoặc tên..."
              {...fieldProps}
            />
          )}
        </FormField>

        <FormField label="Vai trò" htmlFor="user-role">
          {(fieldProps) => (
            <Select
              value={roleFilter}
              onChange={(e) => {
                setRoleFilter(e.target.value as Role | '');
                setPage(1);
              }}
              {...fieldProps}
            >
              <option value="">Tất cả vai trò</option>
              {ALL_ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </Select>
          )}
        </FormField>

        <FormField label="Trạng thái" htmlFor="user-active">
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
              <option value="true">Hoạt động</option>
              <option value="false">Đã khóa</option>
            </Select>
          )}
        </FormField>

        <Button type="submit" variant="brand">
          <Search className="size-4" aria-hidden="true" />
          <span>Tìm người dùng</span>
        </Button>

        <Button
          type="button"
          variant="outline"
          onClick={() => {
            setSearchInput('');
            setAppliedSearch('');
            setRoleFilter('');
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
        isLoading={usersQuery.isPending}
        isError={usersQuery.isError}
        errorMessage="Không thể tải danh sách người dùng."
        onRetry={() => void usersQuery.refetch()}
        emptyTitle="Không tìm thấy tài khoản phù hợp"
        caption="Danh sách người dùng hệ thống"
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
        open={Boolean(editingUser)}
        onOpenChange={(open) => {
          if (!open) setEditingUser(null);
        }}
        title={editingUser ? `Phân quyền: ${editingUser.email}` : 'Cập nhật tài khoản'}
        description="Không được phép hạ quyền hoặc vô hiệu hóa quản trị viên ADMIN cuối cùng."
        size="sm"
      >
        <form
          onSubmit={form.handleSubmit((values) => updateMutation.mutate(values))}
          className="space-y-4"
        >
          <FormField
            label="Họ và tên"
            htmlFor="edit-user-name"
            required
            error={form.formState.errors.full_name?.message}
          >
            {(fieldProps) => <Input {...fieldProps} {...form.register('full_name')} />}
          </FormField>

          <FormField
            label="Số điện thoại"
            htmlFor="edit-user-phone"
            error={form.formState.errors.phone?.message}
          >
            {(fieldProps) => (
              <Input placeholder="0901234567" {...fieldProps} {...form.register('phone')} />
            )}
          </FormField>

          <FormField label="Vai trò RBAC" htmlFor="edit-user-role" required>
            {(fieldProps) => (
              <Select {...fieldProps} {...form.register('role')}>
                {ALL_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </Select>
            )}
          </FormField>

          <label className="inline-flex min-h-10 cursor-pointer items-center gap-2 text-sm">
            <input type="checkbox" className="size-4 accent-brand-red" {...form.register('is_active')} />
            <span>Tài khoản đang hoạt động</span>
          </label>

          <p className="rounded-md bg-surface px-3 py-2 text-[11px] text-muted-foreground">
            Khi thay đổi vai trò hoặc khóa tài khoản, hệ thống tự động thu hồi token phiên đăng nhập cũ.
          </p>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setEditingUser(null)}>
              Hủy
            </Button>
            <Button type="submit" variant="brand" disabled={updateMutation.isPending}>
              Lưu thay đổi
            </Button>
          </div>
        </form>
      </Dialog>
    </AdminLayout>
  );
}

function defaultBannerDates() {
  const now = new Date();
  const later = new Date(now.getTime() + 30 * 86_400_000);
  return {
    start: toDateTimeLocalValue(now.toISOString()),
    end: toDateTimeLocalValue(later.toISOString()),
  };
}

export function AdminBannersPage() {
  const { token } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [page, setPage] = useState(1);
  const [placementFilter, setPlacementFilter] = useState<'HERO' | 'PROMO' | ''>('');
  const [activeFilter, setActiveFilter] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<BannerDto | null>(null);

  const bannersQuery = useQuery({
    queryKey: ['admin-banners', page, placementFilter, activeFilter],
    queryFn: () =>
      fetchAdminBannersApi(token ?? '', {
        page,
        page_size: 20,
        ...(placementFilter ? { placement: placementFilter } : {}),
        ...(activeFilter === 'true'
          ? { is_active: true }
          : activeFilter === 'false'
            ? { is_active: false }
            : {}),
      }),
    enabled: Boolean(token),
  });

  const productsQuery = useQuery({
    queryKey: ['admin-products-banner-options'],
    queryFn: () => fetchAdminProductsApi(token ?? '', { page: 1, page_size: 100 }),
    enabled: Boolean(token && modalOpen),
  });

  const categoriesQuery = useQuery({
    queryKey: ['admin-categories-all'],
    queryFn: () => fetchAdminCategoriesApi(token ?? '', { page: 1, page_size: 100 }),
    enabled: Boolean(token && modalOpen),
  });

  const brandsQuery = useQuery({
    queryKey: ['admin-brands-all'],
    queryFn: () => fetchAdminBrandsApi(token ?? '', { page: 1, page_size: 100 }),
    enabled: Boolean(token && modalOpen),
  });

  const initialDates = defaultBannerDates();
  const form = useForm<BannerFormValues>({
    resolver: zodResolver(bannerFormSchema),
    defaultValues: {
      title: '',
      desktop_path: '/media/banners/',
      mobile_path: '',
      alt_text: '',
      placement: 'HERO',
      target_type: 'NONE',
      target_id: '',
      starts_at_local: initialDates.start,
      ends_at_local: initialDates.end,
      sort_order: 0,
      is_active: true,
    },
  });

  const watchedTargetType = useWatch({ control: form.control, name: 'target_type' });

  const saveMutation = useMutation({
    mutationFn: (values: BannerFormValues) => {
      const targetIdNum = values.target_id ? Number(values.target_id) : null;
      const payload = {
        title: values.title,
        desktop_path: values.desktop_path,
        mobile_path: values.mobile_path?.trim() ? values.mobile_path.trim() : null,
        alt_text: values.alt_text,
        placement: values.placement,
        target_type: values.target_type,
        product_id: values.target_type === 'PRODUCT' ? targetIdNum : null,
        category_id: values.target_type === 'CATEGORY' ? targetIdNum : null,
        brand_id: values.target_type === 'BRAND' ? targetIdNum : null,
        starts_at: localDateTimeToIso(values.starts_at_local),
        ends_at: localDateTimeToIso(values.ends_at_local),
        sort_order: values.sort_order,
        is_active: values.is_active,
      };
      return editing
        ? updateBannerApi(token ?? '', editing.id, payload)
        : createBannerApi(token ?? '', payload);
    },
    onSuccess: () => {
      setModalOpen(false);
      setEditing(null);
      void queryClient.invalidateQueries({ queryKey: ['admin-banners'] });
      toast({
        variant: 'success',
        title: editing ? 'Đã cập nhật banner' : 'Đã tạo banner mới',
      });
    },
    onError: (err) => {
      toast({
        variant: 'error',
        title: 'Lưu banner thất bại',
        description: err instanceof ApiClientError ? err.message : 'Vui lòng kiểm tra thông tin.',
      });
    },
  });

  function openCreate() {
    const win = defaultBannerDates();
    setEditing(null);
    form.reset({
      title: '',
      desktop_path: '/media/banners/',
      mobile_path: '',
      alt_text: '',
      placement: 'HERO',
      target_type: 'NONE',
      target_id: '',
      starts_at_local: win.start,
      ends_at_local: win.end,
      sort_order: 0,
      is_active: true,
    });
    setModalOpen(true);
  }

  function openEdit(banner: BannerDto) {
    setEditing(banner);
    const targetId =
      banner.target_type === 'PRODUCT'
        ? banner.product_id
        : banner.target_type === 'CATEGORY'
          ? banner.category_id
          : banner.target_type === 'BRAND'
            ? banner.brand_id
            : null;
    form.reset({
      title: banner.title,
      desktop_path: banner.desktop_path,
      mobile_path: banner.mobile_path ?? '',
      alt_text: banner.alt_text,
      placement: banner.placement,
      target_type: banner.target_type,
      target_id: targetId ? String(targetId) : '',
      starts_at_local: toDateTimeLocalValue(banner.starts_at),
      ends_at_local: toDateTimeLocalValue(banner.ends_at),
      sort_order: banner.sort_order ?? 0,
      is_active: banner.is_active ?? true,
    });
    setModalOpen(true);
  }

  const columns: DataTableColumn<BannerDto>[] = [
    {
      key: 'banner',
      header: 'Banner',
      render: (row) => (
        <div className="flex items-center gap-3">
          <img
            src={row.desktop_path}
            alt={row.alt_text}
            className="h-10 w-20 shrink-0 rounded border border-border object-cover"
          />
          <div>
            <p className="font-semibold text-foreground">{row.title}</p>
            <p className="font-mono text-[11px] text-muted-foreground">{row.desktop_path}</p>
          </div>
        </div>
      ),
    },
    {
      key: 'placement',
      header: 'Vị trí & Đích',
      render: (row) => (
        <div className="text-xs">
          <Badge variant="neutral">{row.placement}</Badge>
          <p className="mt-1 text-muted-foreground">
            {row.target_type}
            {row.target_path ? ` → ${row.target_path}` : ''}
          </p>
        </div>
      ),
    },
    {
      key: 'schedule',
      header: 'Lịch hiển thị',
      render: (row) => (
        <div className="text-xs text-muted-foreground">
          <p>{formatAdminDateTime(row.starts_at)}</p>
          <p>→ {formatAdminDateTime(row.ends_at)}</p>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Trạng thái',
      render: (row) => (
        <Badge variant={row.is_active ? 'success' : 'neutral'}>
          {row.is_active ? 'Đang bật' : 'Đang tắt'}
        </Badge>
      ),
    },
    {
      key: 'actions',
      header: 'Thao tác',
      align: 'right',
      render: (row) => (
        <Button type="button" variant="outline" size="sm" onClick={() => openEdit(row)}>
          <Pencil className="size-3.5" aria-hidden="true" />
          <span>Sửa</span>
        </Button>
      ),
    },
  ];

  const items = bannersQuery.data?.data.items ?? [];
  const pagination = bannersQuery.data?.meta.pagination;

  const targetOptions =
    watchedTargetType === 'PRODUCT'
      ? (productsQuery.data?.data.items ?? []).map((p) => ({ id: p.id, label: p.name }))
      : watchedTargetType === 'CATEGORY'
        ? (categoriesQuery.data?.data.items ?? []).map((c) => ({ id: c.id, label: c.name }))
        : watchedTargetType === 'BRAND'
          ? (brandsQuery.data?.data.items ?? []).map((b) => ({ id: b.id, label: b.name }))
          : [];

  return (
    <AdminLayout
      title="Quản lý Banner trang chủ"
      description="Cấu hình HERO / PROMO banner, đường dẫn đích nội bộ và lịch hiển thị [starts_at, ends_at)."
      breadcrumbs={[{ label: 'Back-Office', to: '/admin/dashboard' }, { label: 'Banners' }]}
      actions={
        <Button type="button" variant="brand" onClick={openCreate}>
          <Plus className="size-4" aria-hidden="true" />
          <span>Tạo Banner mới</span>
        </Button>
      }
    >
      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-card p-4">
        <FormField label="Vị trí" htmlFor="banner-placement" className="w-44">
          {(fieldProps) => (
            <Select
              value={placementFilter}
              onChange={(e) => {
                setPlacementFilter(e.target.value as 'HERO' | 'PROMO' | '');
                setPage(1);
              }}
              {...fieldProps}
            >
              <option value="">Tất cả vị trí</option>
              <option value="HERO">HERO</option>
              <option value="PROMO">PROMO</option>
            </Select>
          )}
        </FormField>

        <FormField label="Trạng thái" htmlFor="banner-active" className="w-44">
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
              <option value="true">Đang bật</option>
              <option value="false">Đang tắt</option>
            </Select>
          )}
        </FormField>
      </div>

      <DataTable
        columns={columns}
        rows={items}
        rowKey={(row) => row.id}
        isLoading={bannersQuery.isPending}
        isError={bannersQuery.isError}
        errorMessage="Không thể tải danh sách banner."
        onRetry={() => void bannersQuery.refetch()}
        emptyTitle="Chưa có banner nào"
        caption="Danh sách banner quản trị"
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
        open={modalOpen}
        onOpenChange={setModalOpen}
        title={editing ? `Cập nhật banner: ${editing.title}` : 'Tạo banner trang chủ'}
        size="md"
      >
        <form onSubmit={form.handleSubmit((values) => saveMutation.mutate(values))} className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FormField label="Tiêu đề" htmlFor="bn-title" required error={form.formState.errors.title?.message}>
              {(fieldProps) => <Input {...fieldProps} {...form.register('title')} />}
            </FormField>
            <FormField label="Vị trí" htmlFor="bn-placement" required>
              {(fieldProps) => (
                <Select {...fieldProps} {...form.register('placement')}>
                  <option value="HERO">HERO</option>
                  <option value="PROMO">PROMO</option>
                </Select>
              )}
            </FormField>
            <FormField
              label="Ảnh Desktop (/media/...)"
              htmlFor="bn-desktop"
              required
              error={form.formState.errors.desktop_path?.message}
            >
              {(fieldProps) => <Input {...fieldProps} {...form.register('desktop_path')} />}
            </FormField>
            <FormField
              label="Ảnh Mobile (tùy chọn)"
              htmlFor="bn-mobile"
              error={form.formState.errors.mobile_path?.message}
            >
              {(fieldProps) => <Input {...fieldProps} {...form.register('mobile_path')} />}
            </FormField>
            <FormField label="Alt text" htmlFor="bn-alt" required error={form.formState.errors.alt_text?.message}>
              {(fieldProps) => <Input {...fieldProps} {...form.register('alt_text')} />}
            </FormField>
            <FormField label="Thứ tự sắp xếp" htmlFor="bn-order">
              {(fieldProps) => (
                <Input
                  type="number"
                  min={0}
                  {...fieldProps}
                  {...form.register('sort_order', { valueAsNumber: true })}
                />
              )}
            </FormField>
            <FormField label="Loại đích chuyển hướng" htmlFor="bn-target-type">
              {(fieldProps) => (
                <Select
                  {...fieldProps}
                  {...form.register('target_type', {
                    onChange: () => form.setValue('target_id', ''),
                  })}
                >
                  <option value="NONE">NONE (Không liên kết)</option>
                  <option value="PRODUCT">PRODUCT (Sản phẩm)</option>
                  <option value="CATEGORY">CATEGORY (Danh mục)</option>
                  <option value="BRAND">BRAND (Thương hiệu)</option>
                </Select>
              )}
            </FormField>
            {watchedTargetType !== 'NONE' ? (
              <FormField
                label="Đối tượng đích"
                htmlFor="bn-target-id"
                required
                error={form.formState.errors.target_id?.message}
              >
                {(fieldProps) => (
                  <Select {...fieldProps} {...form.register('target_id')}>
                    <option value="">Chọn đối tượng...</option>
                    {targetOptions.map((opt) => (
                      <option key={opt.id} value={opt.id}>
                        {opt.label} (#{opt.id})
                      </option>
                    ))}
                  </Select>
                )}
              </FormField>
            ) : (
              <FormField label="Đối tượng đích" htmlFor="bn-target-none">
                {(fieldProps) => <Input value="Không áp dụng" disabled {...fieldProps} />}
              </FormField>
            )}
            <FormField
              label="Bắt đầu hiển thị"
              htmlFor="bn-start"
              required
              error={form.formState.errors.starts_at_local?.message}
            >
              {(fieldProps) => (
                <Input type="datetime-local" {...fieldProps} {...form.register('starts_at_local')} />
              )}
            </FormField>
            <FormField
              label="Kết thúc hiển thị"
              htmlFor="bn-end"
              required
              error={form.formState.errors.ends_at_local?.message}
            >
              {(fieldProps) => (
                <Input type="datetime-local" {...fieldProps} {...form.register('ends_at_local')} />
              )}
            </FormField>
          </div>

          <label className="inline-flex min-h-10 cursor-pointer items-center gap-2 text-sm">
            <input type="checkbox" className="size-4 accent-brand-red" {...form.register('is_active')} />
            <span>Kích hoạt banner</span>
          </label>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setModalOpen(false)}>
              Hủy
            </Button>
            <Button type="submit" variant="brand" disabled={saveMutation.isPending}>
              {editing ? 'Lưu banner' : 'Tạo banner'}
            </Button>
          </div>
        </form>
      </Dialog>
    </AdminLayout>
  );
}

export function AdminAuditEventsPage() {
  const { token } = useAuth();
  const [page, setPage] = useState(1);
  const [entityType, setEntityType] = useState('');
  const [actionFilter, setActionFilter] = useState('');

  const auditQuery = useQuery({
    queryKey: ['admin-audit-events', page, entityType, actionFilter],
    queryFn: () =>
      fetchAuditEventsApi(token ?? '', {
        page,
        page_size: 20,
        ...(entityType ? { entity_type: entityType } : {}),
        ...(actionFilter ? { action: actionFilter } : {}),
      }),
    enabled: Boolean(token),
  });

  const columns: DataTableColumn<AuditEventDto>[] = [
    {
      key: 'created_at',
      header: 'Thời gian',
      render: (row) => (
        <span className="text-xs text-muted-foreground">{formatAdminDateTime(row.created_at)}</span>
      ),
    },
    {
      key: 'action',
      header: 'Hành động',
      render: (row) => <Badge variant="neutral">{row.action}</Badge>,
    },
    {
      key: 'entity',
      header: 'Đối tượng',
      render: (row) => (
        <span className="font-mono text-xs">
          {row.entity_type} #{row.entity_id}
        </span>
      ),
    },
    {
      key: 'actor',
      header: 'Tác nhân',
      render: (row) => (
        <span className="text-xs">
          {row.actor_kind} {row.actor_id ? `#${row.actor_id}` : ''}
        </span>
      ),
    },
    {
      key: 'changes',
      header: 'Chi tiết thay đổi',
      render: (row) => (
        <code className="block max-w-md truncate rounded bg-surface px-2 py-1 text-[11px] text-muted-foreground">
          {JSON.stringify(row.changes)}
        </code>
      ),
    },
  ];

  const items = auditQuery.data?.data.items ?? [];
  const pagination = auditQuery.data?.meta.pagination;

  return (
    <AdminLayout
      title="Nhật ký kiểm toán (Audit Events)"
      description="Nhật ký chỉ đọc toàn bộ biến cố quan trọng từ PostgreSQL."
      breadcrumbs={[{ label: 'Back-Office', to: '/admin/dashboard' }, { label: 'Audit Events' }]}
    >
      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-card p-4">
        <FormField label="Loại đối tượng" htmlFor="audit-entity" className="w-48">
          {(fieldProps) => (
            <Select
              value={entityType}
              onChange={(e) => {
                setEntityType(e.target.value);
                setPage(1);
              }}
              {...fieldProps}
            >
              <option value="">Tất cả đối tượng</option>
              {[
                'ORDER',
                'INVENTORY',
                'VOUCHER',
                'PRODUCT',
                'VARIANT',
                'BRAND',
                'CATEGORY',
                'BANNER',
                'USER',
              ].map((eType) => (
                <option key={eType} value={eType}>
                  {eType}
                </option>
              ))}
            </Select>
          )}
        </FormField>

        <FormField label="Hành động" htmlFor="audit-action" className="w-56">
          {(fieldProps) => (
            <Select
              value={actionFilter}
              onChange={(e) => {
                setActionFilter(e.target.value);
                setPage(1);
              }}
              {...fieldProps}
            >
              <option value="">Tất cả hành động</option>
              {[
                'ORDER_PLACED',
                'ORDER_CANCELLED',
                'ORDER_STATUS_CHANGED',
                'INVENTORY_IMPORTED',
                'PRICE_CHANGED',
                'ROLE_CHANGED',
                'CONTENT_CHANGED',
              ].map((act) => (
                <option key={act} value={act}>
                  {act}
                </option>
              ))}
            </Select>
          )}
        </FormField>
      </div>

      <DataTable
        columns={columns}
        rows={items}
        rowKey={(row) => row.id}
        isLoading={auditQuery.isPending}
        isError={auditQuery.isError}
        errorMessage="Không thể tải nhật ký kiểm toán."
        onRetry={() => void auditQuery.refetch()}
        emptyTitle="Chưa có bản ghi kiểm toán nào"
        caption="Nhật ký kiểm toán hệ thống"
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
