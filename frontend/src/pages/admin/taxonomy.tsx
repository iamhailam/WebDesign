import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Search } from 'lucide-react';
import { z } from 'zod';
import { ApiClientError, type BrandDto, type CategoryDto } from '@/lib/api';
import {
  createBrandApi,
  createCategoryApi,
  fetchAdminBrandsApi,
  fetchAdminCategoriesApi,
  updateBrandApi,
  updateCategoryApi,
} from '@/lib/admin-api';
import { useAuth } from '@/lib/auth-store';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { FormField, Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import { AdminLayout } from '@/components/layout/admin-layout';
import { DataTable, type DataTableColumn } from '@/components/admin/data-table';

const slugRegex = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const assetPathRegex = /^\/(images|media)\/[A-Za-z0-9/_-]+\.(png|jpg|jpeg|webp|avif|svg)$/;

function slugifyText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}

const categoryFormSchema = z.object({
  name: z.string().trim().min(1, 'Nhập tên danh mục.').max(120),
  slug: z
    .string()
    .trim()
    .min(1, 'Nhập slug.')
    .max(160)
    .regex(slugRegex, 'Slug chỉ gồm a-z, 0-9 và dấu gạch nối.'),
  description: z.string().max(10000).optional(),
  is_active: z.boolean(),
});

type CategoryFormValues = z.infer<typeof categoryFormSchema>;

const brandFormSchema = z.object({
  name: z.string().trim().min(1, 'Nhập tên thương hiệu.').max(120),
  slug: z
    .string()
    .trim()
    .min(1, 'Nhập slug.')
    .max(160)
    .regex(slugRegex, 'Slug chỉ gồm a-z, 0-9 và dấu gạch nối.'),
  description: z.string().max(10000).optional(),
  logo_path: z
    .string()
    .trim()
    .optional()
    .refine(
      (v) => !v || assetPathRegex.test(v),
      'Logo phải là đường dẫn /media/... hoặc /images/... (.png, .jpg, .webp, .svg).',
    ),
  is_active: z.boolean(),
});

type BrandFormValues = z.infer<typeof brandFormSchema>;

export function AdminCategoriesPage() {
  const { token } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState('');

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<CategoryDto | null>(null);

  const form = useForm<CategoryFormValues>({
    resolver: zodResolver(categoryFormSchema),
    defaultValues: { name: '', slug: '', description: '', is_active: true },
  });

  const watchedActive = useWatch({ control: form.control, name: 'is_active' });

  const query = useQuery({
    queryKey: ['admin-categories', page, appliedSearch, activeFilter],
    queryFn: () =>
      fetchAdminCategoriesApi(token ?? '', {
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

  const saveMutation = useMutation({
    mutationFn: (values: CategoryFormValues) =>
      editing
        ? updateCategoryApi(token ?? '', editing.id, {
            name: values.name,
            description: values.description?.trim() ? values.description.trim() : null,
            is_active: values.is_active,
          })
        : createCategoryApi(token ?? '', {
            name: values.name,
            slug: values.slug,
            description: values.description?.trim() ? values.description.trim() : null,
            is_active: values.is_active,
          }),
    onSuccess: () => {
      setModalOpen(false);
      setEditing(null);
      void queryClient.invalidateQueries({ queryKey: ['admin-categories'] });
      void queryClient.invalidateQueries({ queryKey: ['admin-categories-all'] });
      toast({
        variant: 'success',
        title: editing ? 'Đã cập nhật danh mục' : 'Đã tạo danh mục mới',
      });
    },
    onError: (err) => {
      toast({
        variant: 'error',
        title: 'Lưu danh mục thất bại',
        description: err instanceof ApiClientError ? err.message : 'Vui lòng kiểm tra dữ liệu.',
      });
    },
  });

  function openCreate() {
    setEditing(null);
    form.reset({ name: '', slug: '', description: '', is_active: true });
    setModalOpen(true);
  }

  function openEdit(cat: CategoryDto) {
    setEditing(cat);
    form.reset({
      name: cat.name,
      slug: cat.slug,
      description: cat.description ?? '',
      is_active: cat.is_active ?? true,
    });
    setModalOpen(true);
  }

  const columns: DataTableColumn<CategoryDto>[] = [
    {
      key: 'name',
      header: 'Tên danh mục',
      render: (row) => (
        <div>
          <p className="font-semibold text-foreground">{row.name}</p>
          <p className="font-mono text-xs text-muted-foreground">/{row.slug}</p>
        </div>
      ),
    },
    {
      key: 'description',
      header: 'Mô tả',
      render: (row) => (
        <span className="line-clamp-2 max-w-md text-xs text-muted-foreground">
          {row.description || '—'}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Trạng thái',
      render: (row) => (
        <Badge variant={row.is_active ? 'success' : 'neutral'}>
          {row.is_active ? 'Hiển thị' : 'Đang ẩn'}
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

  const items = query.data?.data.items ?? [];
  const pagination = query.data?.meta.pagination;

  return (
    <AdminLayout
      title="Quản lý danh mục"
      description="Tạo mới và cập nhật danh mục sản phẩm (slug bất biến sau tạo)."
      breadcrumbs={[{ label: 'Back-Office', to: '/admin/dashboard' }, { label: 'Danh mục' }]}
      actions={
        <Button type="button" variant="brand" onClick={openCreate}>
          <Plus className="size-4" aria-hidden="true" />
          <span>Thêm danh mục</span>
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
        <FormField label="Tìm danh mục" htmlFor="cat-search">
          {(fieldProps) => (
            <Input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Nhập tên..."
              {...fieldProps}
            />
          )}
        </FormField>

        <FormField label="Trạng thái" htmlFor="cat-active">
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
              <option value="true">Đang hiển thị</option>
              <option value="false">Đang ẩn</option>
            </Select>
          )}
        </FormField>

        <Button type="submit" variant="brand">
          <Search className="size-4" aria-hidden="true" />
          <span>Lọc</span>
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
        isLoading={query.isPending}
        isError={query.isError}
        errorMessage="Không thể tải danh mục."
        onRetry={() => void query.refetch()}
        emptyTitle="Chưa có danh mục phù hợp"
        caption="Danh sách danh mục"
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
        title={editing ? `Sửa danh mục: ${editing.name}` : 'Thêm danh mục mới'}
        description={editing ? 'Slug được giữ cố định để bảo toàn liên kết SEO.' : undefined}
        size="sm"
      >
        <form onSubmit={form.handleSubmit((values) => saveMutation.mutate(values))} className="space-y-4">
          <FormField
            label="Tên danh mục"
            htmlFor="cat-name"
            required
            error={form.formState.errors.name?.message}
          >
            {(fieldProps) => (
              <Input
                {...fieldProps}
                {...form.register('name', {
                  onChange: (e) => {
                    if (!editing && !form.formState.dirtyFields.slug) {
                      form.setValue('slug', slugifyText(String(e.target.value)));
                    }
                  },
                })}
              />
            )}
          </FormField>

          <FormField label="Slug" htmlFor="cat-slug" required error={form.formState.errors.slug?.message}>
            {(fieldProps) => (
              <Input disabled={Boolean(editing)} {...fieldProps} {...form.register('slug')} />
            )}
          </FormField>

          <FormField label="Mô tả" htmlFor="cat-desc">
            {(fieldProps) => (
              <textarea
                rows={3}
                className="w-full rounded-md border border-border-strong bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red"
                {...fieldProps}
                {...form.register('description')}
              />
            )}
          </FormField>

          <label className="inline-flex min-h-10 cursor-pointer items-center gap-2 text-sm">
            <input type="checkbox" className="size-4 accent-brand-red" {...form.register('is_active')} />
            <span>Hiển thị trên Storefront</span>
          </label>

          {editing && !watchedActive ? (
            <p className="rounded-md bg-warning-soft/70 px-3 py-2 text-xs text-foreground">
              Lưu ý: Ẩn danh mục sẽ làm các sản phẩm thuộc danh mục này không hiển thị trên Storefront công khai.
            </p>
          ) : null}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setModalOpen(false)}>
              Hủy
            </Button>
            <Button type="submit" variant="brand" disabled={saveMutation.isPending}>
              {editing ? 'Lưu thay đổi' : 'Tạo danh mục'}
            </Button>
          </div>
        </form>
      </Dialog>
    </AdminLayout>
  );
}

export function AdminBrandsPage() {
  const { token } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState('');

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<BrandDto | null>(null);

  const form = useForm<BrandFormValues>({
    resolver: zodResolver(brandFormSchema),
    defaultValues: { name: '', slug: '', description: '', logo_path: '', is_active: true },
  });

  const watchedActive = useWatch({ control: form.control, name: 'is_active' });

  const query = useQuery({
    queryKey: ['admin-brands', page, appliedSearch, activeFilter],
    queryFn: () =>
      fetchAdminBrandsApi(token ?? '', {
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

  const saveMutation = useMutation({
    mutationFn: (values: BrandFormValues) =>
      editing
        ? updateBrandApi(token ?? '', editing.id, {
            name: values.name,
            description: values.description?.trim() ? values.description.trim() : null,
            logo_path: values.logo_path?.trim() ? values.logo_path.trim() : null,
            is_active: values.is_active,
          })
        : createBrandApi(token ?? '', {
            name: values.name,
            slug: values.slug,
            description: values.description?.trim() ? values.description.trim() : null,
            logo_path: values.logo_path?.trim() ? values.logo_path.trim() : null,
            is_active: values.is_active,
          }),
    onSuccess: () => {
      setModalOpen(false);
      setEditing(null);
      void queryClient.invalidateQueries({ queryKey: ['admin-brands'] });
      void queryClient.invalidateQueries({ queryKey: ['admin-brands-all'] });
      toast({
        variant: 'success',
        title: editing ? 'Đã cập nhật thương hiệu' : 'Đã tạo thương hiệu mới',
      });
    },
    onError: (err) => {
      toast({
        variant: 'error',
        title: 'Lưu thương hiệu thất bại',
        description: err instanceof ApiClientError ? err.message : 'Vui lòng kiểm tra dữ liệu.',
      });
    },
  });

  function openCreate() {
    setEditing(null);
    form.reset({ name: '', slug: '', description: '', logo_path: '', is_active: true });
    setModalOpen(true);
  }

  function openEdit(brand: BrandDto) {
    setEditing(brand);
    form.reset({
      name: brand.name,
      slug: brand.slug,
      description: brand.description ?? '',
      logo_path: brand.logo_path ?? '',
      is_active: brand.is_active ?? true,
    });
    setModalOpen(true);
  }

  const columns: DataTableColumn<BrandDto>[] = [
    {
      key: 'name',
      header: 'Thương hiệu',
      render: (row) => (
        <div className="flex items-center gap-3">
          {row.logo_path ? (
            <img
              src={row.logo_path}
              alt={row.name}
              className="size-9 shrink-0 rounded border border-border object-contain p-1"
            />
          ) : null}
          <div>
            <p className="font-semibold text-foreground">{row.name}</p>
            <p className="font-mono text-xs text-muted-foreground">/{row.slug}</p>
          </div>
        </div>
      ),
    },
    {
      key: 'description',
      header: 'Giới thiệu',
      render: (row) => (
        <span className="line-clamp-2 max-w-md text-xs text-muted-foreground">
          {row.description || '—'}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Trạng thái',
      render: (row) => (
        <Badge variant={row.is_active ? 'success' : 'neutral'}>
          {row.is_active ? 'Hiển thị' : 'Đang ẩn'}
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

  const items = query.data?.data.items ?? [];
  const pagination = query.data?.meta.pagination;

  return (
    <AdminLayout
      title="Quản lý thương hiệu"
      description="Thêm và cập nhật thương hiệu đối tác (slug bất biến sau tạo)."
      breadcrumbs={[{ label: 'Back-Office', to: '/admin/dashboard' }, { label: 'Thương hiệu' }]}
      actions={
        <Button type="button" variant="brand" onClick={openCreate}>
          <Plus className="size-4" aria-hidden="true" />
          <span>Thêm thương hiệu</span>
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
        <FormField label="Tìm thương hiệu" htmlFor="brand-search">
          {(fieldProps) => (
            <Input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Nhập tên..."
              {...fieldProps}
            />
          )}
        </FormField>

        <FormField label="Trạng thái" htmlFor="brand-active">
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
              <option value="true">Đang hiển thị</option>
              <option value="false">Đang ẩn</option>
            </Select>
          )}
        </FormField>

        <Button type="submit" variant="brand">
          <Search className="size-4" aria-hidden="true" />
          <span>Lọc</span>
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
        isLoading={query.isPending}
        isError={query.isError}
        errorMessage="Không thể tải thương hiệu."
        onRetry={() => void query.refetch()}
        emptyTitle="Chưa có thương hiệu phù hợp"
        caption="Danh sách thương hiệu"
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
        title={editing ? `Sửa thương hiệu: ${editing.name}` : 'Thêm thương hiệu mới'}
        description={editing ? 'Slug được giữ cố định sau khi tạo.' : undefined}
        size="sm"
      >
        <form onSubmit={form.handleSubmit((values) => saveMutation.mutate(values))} className="space-y-4">
          <FormField
            label="Tên thương hiệu"
            htmlFor="brand-name"
            required
            error={form.formState.errors.name?.message}
          >
            {(fieldProps) => (
              <Input
                {...fieldProps}
                {...form.register('name', {
                  onChange: (e) => {
                    if (!editing && !form.formState.dirtyFields.slug) {
                      form.setValue('slug', slugifyText(String(e.target.value)));
                    }
                  },
                })}
              />
            )}
          </FormField>

          <FormField label="Slug" htmlFor="brand-slug" required error={form.formState.errors.slug?.message}>
            {(fieldProps) => (
              <Input disabled={Boolean(editing)} {...fieldProps} {...form.register('slug')} />
            )}
          </FormField>

          <FormField
            label="Logo (/media/... hoặc /images/...)"
            htmlFor="brand-logo"
            error={form.formState.errors.logo_path?.message}
          >
            {(fieldProps) => (
              <Input placeholder="/media/brands/logo.svg" {...fieldProps} {...form.register('logo_path')} />
            )}
          </FormField>

          <FormField label="Mô tả" htmlFor="brand-desc">
            {(fieldProps) => (
              <textarea
                rows={3}
                className="w-full rounded-md border border-border-strong bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red"
                {...fieldProps}
                {...form.register('description')}
              />
            )}
          </FormField>

          <label className="inline-flex min-h-10 cursor-pointer items-center gap-2 text-sm">
            <input type="checkbox" className="size-4 accent-brand-red" {...form.register('is_active')} />
            <span>Hiển thị trên Storefront</span>
          </label>

          {editing && !watchedActive ? (
            <p className="rounded-md bg-warning-soft/70 px-3 py-2 text-xs text-foreground">
              Lưu ý: Ẩn thương hiệu sẽ ẩn toàn bộ sản phẩm của thương hiệu này trên Storefront.
            </p>
          ) : null}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setModalOpen(false)}>
              Hủy
            </Button>
            <Button type="submit" variant="brand" disabled={saveMutation.isPending}>
              {editing ? 'Lưu thay đổi' : 'Tạo thương hiệu'}
            </Button>
          </div>
        </form>
      </Dialog>
    </AdminLayout>
  );
}
