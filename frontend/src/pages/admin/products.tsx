import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertCircle,
  CheckCircle2,
  ImagePlus,
  Pencil,
  Plus,
  Search,
  Star,
  Trash2,
} from 'lucide-react';
import { z } from 'zod';
import {
  ApiClientError,
  fetchProductTypes,
  type ProductVariantDto,
} from '@/lib/api';
import {
  addProductImageApi,
  createProductApi,
  createVariantApi,
  deleteProductImageApi,
  fetchAdminBrandsApi,
  fetchAdminCategoriesApi,
  fetchAdminProductDetailApi,
  fetchAdminProductsApi,
  updateProductApi,
  updateProductImageApi,
  updateVariantApi,
  type AdminProductCardDto,
} from '@/lib/admin-api';
import { formatOptionsSummary } from '@/lib/admin-navigation';
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

const slugRegex = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const skuRegex = /^[A-Z0-9]+(-[A-Z0-9]+)*$/;
const assetPathRegex = /^\/(images|media)\/[A-Za-z0-9/_-]+\.(png|jpg|jpeg|webp|avif|svg)$/;
const moneyRegex = /^(0|[1-9][0-9]{0,9})(\.[0-9]{1,2})?$/;

const PRODUCT_TYPE_CODES = [
  'CLOTHING',
  'SHOES',
  'BAGS',
  'WATCHES',
  'ACCESSORIES',
  'PERFUME',
] as const;

function slugifyTitle(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}

const createProductSchema = z.object({
  name: z.string().trim().min(1, 'Vui lòng nhập tên sản phẩm.').max(200),
  slug: z
    .string()
    .trim()
    .min(1, 'Vui lòng nhập slug.')
    .max(220)
    .regex(slugRegex, 'Slug chỉ gồm a-z, 0-9 và dấu gạch nối.'),
  category_id: z.number().int().min(1, 'Chọn danh mục.'),
  brand_id: z.number().int().min(1, 'Chọn thương hiệu.'),
  product_type_code: z.enum(PRODUCT_TYPE_CODES),
  description: z.string().max(20000).optional(),
});

type CreateProductValues = z.infer<typeof createProductSchema>;

const editProductSchema = z.object({
  name: z.string().trim().min(1, 'Vui lòng nhập tên sản phẩm.').max(200),
  category_id: z.number().int().min(1, 'Chọn danh mục.'),
  brand_id: z.number().int().min(1, 'Chọn thương hiệu.'),
  description: z.string().max(20000).optional(),
  is_active: z.boolean(),
});

type EditProductValues = z.infer<typeof editProductSchema>;

const editVariantSchema = z
  .object({
    price: z.string().trim().regex(moneyRegex, 'Giá bán không hợp lệ (VD: 499000 hoặc 499000.00).'),
    list_price: z.string().trim().optional(),
    is_active: z.boolean(),
  })
  .refine(
    (v) => !v.list_price || (moneyRegex.test(v.list_price) && Number(v.list_price) >= Number(v.price)),
    { message: 'Giá niêm yết phải hợp lệ và lớn hơn hoặc bằng giá bán.', path: ['list_price'] },
  );

type EditVariantValues = z.infer<typeof editVariantSchema>;

const createImageSchema = z.object({
  asset_path: z
    .string()
    .trim()
    .regex(
      assetPathRegex,
      'Đường dẫn phải bắt đầu bằng /media/... hoặc /images/... và kết thúc .png/.jpg/.webp/.avif/.svg.',
    ),
  alt_text: z.string().trim().min(1, 'Nhập mô tả ảnh (alt text).').max(200),
  sort_order: z.number({ message: 'Nhập thứ tự hợp lệ.' }).int().min(0),
  is_primary: z.boolean(),
});

type CreateImageValues = z.infer<typeof createImageSchema>;

export function AdminProductsPage() {
  const { token } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [createOpen, setCreateOpen] = useState(false);

  const productsQuery = useQuery({
    queryKey: ['admin-products', page, appliedSearch, activeFilter, typeFilter],
    queryFn: () =>
      fetchAdminProductsApi(token ?? '', {
        page,
        page_size: 20,
        ...(appliedSearch ? { search: appliedSearch } : {}),
        ...(typeFilter ? { product_type: typeFilter } : {}),
        ...(activeFilter === 'true'
          ? { is_active: true }
          : activeFilter === 'false'
            ? { is_active: false }
            : {}),
      }),
    enabled: Boolean(token),
  });

  const brandsQuery = useQuery({
    queryKey: ['admin-brands-all'],
    queryFn: () => fetchAdminBrandsApi(token ?? '', { page: 1, page_size: 100 }),
    enabled: Boolean(token),
  });

  const categoriesQuery = useQuery({
    queryKey: ['admin-categories-all'],
    queryFn: () => fetchAdminCategoriesApi(token ?? '', { page: 1, page_size: 100 }),
    enabled: Boolean(token),
  });

  const productTypesQuery = useQuery({
    queryKey: ['product-types'],
    queryFn: () => fetchProductTypes(),
  });

  const createForm = useForm<CreateProductValues>({
    resolver: zodResolver(createProductSchema),
    defaultValues: {
      name: '',
      slug: '',
      category_id: 1,
      brand_id: 1,
      product_type_code: 'CLOTHING',
      description: '',
    },
  });

  const createMutation = useMutation({
    mutationFn: (values: CreateProductValues) =>
      createProductApi(token ?? '', {
        name: values.name,
        slug: values.slug,
        category_id: values.category_id,
        brand_id: values.brand_id,
        product_type_code: values.product_type_code,
        description: values.description?.trim() ? values.description.trim() : null,
        is_active: false,
      }),
    onSuccess: (res) => {
      setCreateOpen(false);
      createForm.reset();
      void queryClient.invalidateQueries({ queryKey: ['admin-products'] });
      toast({
        variant: 'success',
        title: 'Đã tạo sản phẩm nháp',
        description: 'Hãy thêm ít nhất 1 SKU đang hoạt động và 1 ảnh trước khi xuất bản.',
      });
      navigate(`/admin/products/${res.data.id}`);
    },
    onError: (err) => {
      toast({
        variant: 'error',
        title: 'Tạo sản phẩm thất bại',
        description: err instanceof ApiClientError ? err.message : 'Vui lòng kiểm tra dữ liệu.',
      });
    },
  });

  const columns: DataTableColumn<AdminProductCardDto>[] = [
    {
      key: 'name',
      header: 'Sản phẩm',
      render: (row) => (
        <div className="flex items-center gap-3">
          {row.base_image_url ? (
            <img
              src={row.base_image_url}
              alt={row.name}
              className="size-10 shrink-0 rounded border border-border object-cover"
            />
          ) : (
            <div className="flex size-10 shrink-0 items-center justify-center rounded border border-border bg-surface text-[10px] text-muted-foreground">
              No img
            </div>
          )}
          <div className="min-w-0">
            <Link
              to={`/admin/products/${row.id}`}
              className="block truncate font-semibold text-foreground hover:text-brand-red hover:underline"
            >
              {row.name}
            </Link>
            <p className="truncate font-mono text-xs text-muted-foreground">/{row.slug}</p>
          </div>
        </div>
      ),
    },
    {
      key: 'taxonomy',
      header: 'Danh mục & Thương hiệu',
      render: (row) => (
        <div className="text-xs">
          <p className="font-medium text-foreground">{row.brand.name}</p>
          <p className="text-muted-foreground">{row.category.name}</p>
        </div>
      ),
    },
    {
      key: 'type',
      header: 'Nhóm thuộc tính',
      render: (row) => <Badge variant="neutral">{row.product_type_code}</Badge>,
    },
    {
      key: 'price',
      header: 'Khoảng giá',
      align: 'right',
      render: (row) => (
        <span className="tabular-nums-vnd text-xs font-semibold text-foreground">
          {row.price_min === row.price_max
            ? formatVnd(row.price_min)
            : `${formatVnd(row.price_min)} – ${formatVnd(row.price_max)}`}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Trạng thái',
      render: (row) => (
        <Badge variant={row.is_active ? 'success' : 'warning'}>
          {row.is_active ? 'Đang mở bán' : 'Bản nháp'}
        </Badge>
      ),
    },
    {
      key: 'actions',
      header: 'Thao tác',
      align: 'right',
      render: (row) => (
        <Button asChild variant="outline" size="sm">
          <Link to={`/admin/products/${row.id}`}>
            <Pencil className="size-3.5" aria-hidden="true" />
            <span>Quản lý</span>
          </Link>
        </Button>
      ),
    },
  ];

  const items = productsQuery.data?.data.items ?? [];
  const pagination = productsQuery.data?.meta.pagination;
  const brands = brandsQuery.data?.data.items ?? [];
  const categories = categoriesQuery.data?.data.items ?? [];
  const productTypes = productTypesQuery.data?.data.items ?? [];

  return (
    <AdminLayout
      title="Quản lý sản phẩm"
      description="Danh sách toàn bộ sản phẩm (bao gồm bản nháp), tạo mới nháp và quản lý SKU / ảnh."
      breadcrumbs={[{ label: 'Back-Office', to: '/admin/dashboard' }, { label: 'Sản phẩm' }]}
      actions={
        <Button
          type="button"
          variant="brand"
          onClick={() => {
            createForm.reset({
              name: '',
              slug: '',
              category_id: categories[0]?.id ?? 1,
              brand_id: brands[0]?.id ?? 1,
              product_type_code: 'CLOTHING',
              description: '',
            });
            setCreateOpen(true);
          }}
        >
          <Plus className="size-4" aria-hidden="true" />
          <span>Tạo sản phẩm nháp</span>
        </Button>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setPage(1);
          setAppliedSearch(searchInput.trim());
        }}
        className="grid grid-cols-1 gap-3 rounded-lg border border-border bg-card p-4 sm:grid-cols-2 lg:grid-cols-5 lg:items-end"
      >
        <FormField label="Tìm tên sản phẩm" htmlFor="prod-search">
          {(fieldProps) => (
            <Input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Nhập tên hoặc slug..."
              {...fieldProps}
            />
          )}
        </FormField>

        <FormField label="Loại sản phẩm" htmlFor="prod-type">
          {(fieldProps) => (
            <Select
              value={typeFilter}
              onChange={(e) => {
                setTypeFilter(e.target.value);
                setPage(1);
              }}
              {...fieldProps}
            >
              <option value="">Tất cả 6 nhóm</option>
              {PRODUCT_TYPE_CODES.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </Select>
          )}
        </FormField>

        <FormField label="Trạng thái" htmlFor="prod-active">
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
              <option value="true">Đang mở bán</option>
              <option value="false">Bản nháp / Ẩn</option>
            </Select>
          )}
        </FormField>

        <Button type="submit" variant="brand">
          <Search className="size-4" aria-hidden="true" />
          <span>Tìm sản phẩm</span>
        </Button>

        <Button
          type="button"
          variant="outline"
          onClick={() => {
            setSearchInput('');
            setAppliedSearch('');
            setActiveFilter('');
            setTypeFilter('');
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
        isLoading={productsQuery.isPending}
        isError={productsQuery.isError}
        errorMessage="Không thể tải danh sách sản phẩm."
        onRetry={() => void productsQuery.refetch()}
        emptyTitle="Chưa có sản phẩm phù hợp"
        emptyDescription="Tạo sản phẩm nháp mới hoặc đặt lại bộ lọc."
        caption="Danh sách sản phẩm quản trị"
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
        title="Tạo sản phẩm mới (Bản nháp)"
        description="Sản phẩm mới luôn được khởi tạo ở trạng thái nháp cho đến khi có đủ SKU và ảnh."
        size="md"
      >
        <form
          onSubmit={createForm.handleSubmit((values) => createMutation.mutate(values))}
          className="space-y-4"
        >
          <FormField
            label="Tên sản phẩm"
            htmlFor="create-prod-name"
            required
            error={createForm.formState.errors.name?.message}
          >
            {(fieldProps) => (
              <Input
                {...fieldProps}
                {...createForm.register('name', {
                  onChange: (e) => {
                    const nextName = String(e.target.value);
                    if (!createForm.formState.dirtyFields.slug) {
                      createForm.setValue('slug', slugifyTitle(nextName));
                    }
                  },
                })}
              />
            )}
          </FormField>

          <FormField
            label="Slug URL (bất biến sau tạo)"
            htmlFor="create-prod-slug"
            required
            error={createForm.formState.errors.slug?.message}
          >
            {(fieldProps) => <Input {...fieldProps} {...createForm.register('slug')} />}
          </FormField>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <FormField label="Danh mục" htmlFor="create-prod-cat" required>
              {(fieldProps) => (
                <Select
                  {...fieldProps}
                  {...createForm.register('category_id', { valueAsNumber: true })}
                >
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              )}
            </FormField>

            <FormField label="Thương hiệu" htmlFor="create-prod-brand" required>
              {(fieldProps) => (
                <Select
                  {...fieldProps}
                  {...createForm.register('brand_id', { valueAsNumber: true })}
                >
                  {brands.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </Select>
              )}
            </FormField>

            <FormField label="Nhóm sản phẩm" htmlFor="create-prod-type" required>
              {(fieldProps) => (
                <Select {...fieldProps} {...createForm.register('product_type_code')}>
                  {(productTypes.length > 0
                    ? productTypes
                    : PRODUCT_TYPE_CODES.map((code) => ({ code, name: code }))
                  ).map((pt) => (
                    <option key={pt.code} value={pt.code}>
                      {pt.name} ({pt.code})
                    </option>
                  ))}
                </Select>
              )}
            </FormField>
          </div>

          <FormField label="Mô tả sản phẩm" htmlFor="create-prod-desc">
            {(fieldProps) => (
              <textarea
                rows={3}
                className="w-full rounded-md border border-border-strong bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red"
                {...fieldProps}
                {...createForm.register('description')}
              />
            )}
          </FormField>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>
              Hủy
            </Button>
            <Button type="submit" variant="brand" disabled={createMutation.isPending}>
              Lưu bản nháp &amp; Cấu hình SKU
            </Button>
          </div>
        </form>
      </Dialog>
    </AdminLayout>
  );
}

export function AdminProductDetailPage() {
  const { id } = useParams();
  const productId = Number(id);
  const { token } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [publishChecklistError, setPublishChecklistError] = useState<string | null>(null);
  const [editingVariant, setEditingVariant] = useState<ProductVariantDto | null>(null);
  const [createSkuOpen, setCreateSkuOpen] = useState(false);
  const [createImgOpen, setCreateImgOpen] = useState(false);

  const [newSkuCode, setNewSkuCode] = useState('');
  const [newSkuPrice, setNewSkuPrice] = useState('');
  const [newSkuListPrice, setNewSkuListPrice] = useState('');
  const [newSkuActive, setNewSkuActive] = useState(true);
  const [selectedOptions, setSelectedOptions] = useState<Record<number, number>>({});
  const [skuFormError, setSkuFormError] = useState<string | null>(null);

  const detailQuery = useQuery({
    queryKey: ['admin-product-detail', productId],
    queryFn: () => fetchAdminProductDetailApi(token ?? '', productId),
    enabled: Boolean(token && Number.isInteger(productId) && productId > 0),
  });

  const brandsQuery = useQuery({
    queryKey: ['admin-brands-all'],
    queryFn: () => fetchAdminBrandsApi(token ?? '', { page: 1, page_size: 100 }),
    enabled: Boolean(token),
  });

  const categoriesQuery = useQuery({
    queryKey: ['admin-categories-all'],
    queryFn: () => fetchAdminCategoriesApi(token ?? '', { page: 1, page_size: 100 }),
    enabled: Boolean(token),
  });

  const productTypesQuery = useQuery({
    queryKey: ['product-types'],
    queryFn: () => fetchProductTypes(),
  });

  const product = detailQuery.data?.data;

  const productForm = useForm<EditProductValues>({
    resolver: zodResolver(editProductSchema),
    defaultValues: {
      name: '',
      category_id: 1,
      brand_id: 1,
      description: '',
      is_active: false,
    },
  });

  useEffect(() => {
    if (product) {
      productForm.reset({
        name: product.name,
        category_id: product.category.id,
        brand_id: product.brand.id,
        description: product.description ?? '',
        is_active: product.is_active,
      });
    }
  }, [product, productForm]);

  const variantForm = useForm<EditVariantValues>({
    resolver: zodResolver(editVariantSchema),
    defaultValues: { price: '', list_price: '', is_active: true },
  });

  const imageForm = useForm<CreateImageValues>({
    resolver: zodResolver(createImageSchema),
    defaultValues: { asset_path: '/media/', alt_text: '', sort_order: 0, is_primary: false },
  });

  const updateProductMutation = useMutation({
    mutationFn: (values: EditProductValues) =>
      updateProductApi(token ?? '', productId, {
        name: values.name,
        category_id: values.category_id,
        brand_id: values.brand_id,
        description: values.description?.trim() ? values.description.trim() : null,
        is_active: values.is_active,
      }),
    onSuccess: (res) => {
      setPublishChecklistError(null);
      queryClient.setQueryData(['admin-product-detail', productId], res);
      void queryClient.invalidateQueries({ queryKey: ['admin-products'] });
      toast({ variant: 'success', title: 'Đã lưu thông tin sản phẩm' });
    },
    onError: (err) => {
      if (err instanceof ApiClientError && err.code === 'PRODUCT_NOT_PUBLISHABLE') {
        setPublishChecklistError(err.message);
        productForm.setValue('is_active', false);
        toast({
          variant: 'warning',
          title: 'Chưa đủ điều kiện xuất bản',
          description: err.message,
        });
        return;
      }
      toast({
        variant: 'error',
        title: 'Cập nhật sản phẩm thất bại',
        description: err instanceof ApiClientError ? err.message : 'Vui lòng thử lại.',
      });
    },
  });

  const createVariantMutation = useMutation({
    mutationFn: (payload: {
      sku: string;
      price: string;
      list_price: string | null;
      options: Array<{ attribute_id: number; value_id: number }>;
      is_active: boolean;
    }) => createVariantApi(token ?? '', productId, payload),
    onSuccess: () => {
      setCreateSkuOpen(false);
      setSkuFormError(null);
      void queryClient.invalidateQueries({ queryKey: ['admin-product-detail', productId] });
      toast({ variant: 'success', title: 'Đã tạo SKU mới' });
    },
    onError: (err) => {
      const msg = err instanceof ApiClientError ? err.message : 'Tạo SKU thất bại.';
      setSkuFormError(msg);
      toast({ variant: 'error', title: 'Không thể tạo SKU', description: msg });
    },
  });

  const updateVariantMutation = useMutation({
    mutationFn: (payload: { variantId: number; price: string; list_price: string | null; is_active: boolean }) =>
      updateVariantApi(token ?? '', payload.variantId, {
        price: payload.price,
        list_price: payload.list_price,
        is_active: payload.is_active,
      }),
    onSuccess: () => {
      setEditingVariant(null);
      void queryClient.invalidateQueries({ queryKey: ['admin-product-detail', productId] });
      toast({ variant: 'success', title: 'Đã cập nhật giá & trạng thái SKU' });
    },
    onError: (err) => {
      toast({
        variant: 'error',
        title: 'Cập nhật SKU thất bại',
        description: err instanceof ApiClientError ? err.message : 'Vui lòng thử lại.',
      });
    },
  });

  const addImageMutation = useMutation({
    mutationFn: (values: CreateImageValues) =>
      addProductImageApi(token ?? '', productId, {
        variant_id: null,
        asset_path: values.asset_path,
        alt_text: values.alt_text,
        sort_order: values.sort_order,
        is_primary: values.is_primary,
      }),
    onSuccess: () => {
      setCreateImgOpen(false);
      imageForm.reset({ asset_path: '/media/', alt_text: '', sort_order: 0, is_primary: false });
      void queryClient.invalidateQueries({ queryKey: ['admin-product-detail', productId] });
      toast({ variant: 'success', title: 'Đã thêm ảnh sản phẩm' });
    },
    onError: (err) => {
      toast({
        variant: 'error',
        title: 'Thêm ảnh thất bại',
        description: err instanceof ApiClientError ? err.message : 'Vui lòng kiểm tra đường dẫn ảnh.',
      });
    },
  });

  const setPrimaryImageMutation = useMutation({
    mutationFn: (img: { id: number; asset_path: string; alt_text: string; sort_order: number }) =>
      updateProductImageApi(token ?? '', img.id, {
        asset_path: img.asset_path,
        alt_text: img.alt_text,
        sort_order: img.sort_order,
        is_primary: true,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-product-detail', productId] });
      toast({ variant: 'success', title: 'Đã đổi ảnh đại diện chính' });
    },
    onError: (err) => {
      toast({
        variant: 'error',
        title: 'Đổi ảnh chính thất bại',
        description: err instanceof ApiClientError ? err.message : 'Vui lòng thử lại.',
      });
    },
  });

  const deleteImageMutation = useMutation({
    mutationFn: (imageId: number) => deleteProductImageApi(token ?? '', imageId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-product-detail', productId] });
      toast({ variant: 'success', title: 'Đã xóa ảnh sản phẩm' });
    },
    onError: (err) => {
      toast({
        variant: 'error',
        title:
          err instanceof ApiClientError && err.code === 'LAST_PRODUCT_IMAGE'
            ? 'Không thể xóa ảnh cuối cùng của sản phẩm đang mở bán'
            : 'Xóa ảnh thất bại',
        description: err instanceof ApiClientError ? err.message : 'Vui lòng thử lại.',
      });
    },
  });

  const typeMeta = product
    ? productTypesQuery.data?.data.items.find((pt) => pt.code === product.product_type_code)
    : undefined;
  const typeAttributes = typeMeta?.attributes ?? [];

  function openCreateSkuModal() {
    const initialSelections: Record<number, number> = {};
    for (const attr of typeAttributes) {
      if (attr.is_required && attr.values[0]) {
        initialSelections[attr.id] = attr.values[0].id;
      }
    }
    setSelectedOptions(initialSelections);
    setNewSkuCode('');
    setNewSkuPrice('');
    setNewSkuListPrice('');
    setNewSkuActive(true);
    setSkuFormError(null);
    setCreateSkuOpen(true);
  }

  function handleCreateSkuSubmit(event: React.FormEvent) {
    event.preventDefault();
    const normalizedSku = newSkuCode.trim().toUpperCase();
    if (!skuRegex.test(normalizedSku)) {
      setSkuFormError('Mã SKU chỉ gồm chữ in hoa A-Z, số 0-9 và dấu gạch nối đơn.');
      return;
    }
    if (!moneyRegex.test(newSkuPrice.trim())) {
      setSkuFormError('Giá bán phải là chuỗi số hợp lệ (VD: 590000).');
      return;
    }
    const listTrimmed = newSkuListPrice.trim();
    if (listTrimmed && (!moneyRegex.test(listTrimmed) || Number(listTrimmed) < Number(newSkuPrice.trim()))) {
      setSkuFormError('Giá niêm yết phải hợp lệ và lớn hơn hoặc bằng giá bán.');
      return;
    }
    for (const attr of typeAttributes) {
      if (attr.is_required && !selectedOptions[attr.id]) {
        setSkuFormError(`Vui lòng chọn giá trị cho thuộc tính bắt buộc: ${attr.name}.`);
        return;
      }
    }
    const options = Object.entries(selectedOptions)
      .filter(([, valueId]) => Number.isInteger(valueId) && valueId > 0)
      .map(([attributeId, valueId]) => ({
        attribute_id: Number(attributeId),
        value_id: valueId,
      }));

    setSkuFormError(null);
    createVariantMutation.mutate({
      sku: normalizedSku,
      price: newSkuPrice.trim(),
      list_price: listTrimmed ? listTrimmed : null,
      options,
      is_active: newSkuActive,
    });
  }

  const brands = brandsQuery.data?.data.items ?? [];
  const categories = categoriesQuery.data?.data.items ?? [];
  const hasActiveSku = Boolean(product?.variants.some((v) => v.is_active));
  const hasImage = Boolean(product && product.images.length > 0);

  return (
    <AdminLayout
      title={product ? product.name : `Sản phẩm #${id ?? ''}`}
      description="Chỉnh sửa thông tin, xuất bản, quản lý SKU biến thể và thư viện ảnh."
      breadcrumbs={[
        { label: 'Back-Office', to: '/admin/dashboard' },
        { label: 'Sản phẩm', to: '/admin/products' },
        { label: product?.name ?? `#${id ?? ''}` },
      ]}
      actions={
        <Button asChild variant="outline" size="sm">
          <Link to="/admin/products">Quay lại danh sách</Link>
        </Button>
      }
    >
      {detailQuery.isPending ? (
        <Skeleton className="h-96 w-full rounded-lg" />
      ) : detailQuery.isError || !product ? (
        <ErrorState
          message="Không thể tải chi tiết sản phẩm."
          onRetry={() => void detailQuery.refetch()}
        />
      ) : (
        <div className="space-y-6">
          {/* Publish checklist alert */}
          <section className="rounded-lg border border-border bg-card p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <span className="font-semibold text-foreground">Điều kiện xuất bản:</span>
                <span className="inline-flex items-center gap-1.5">
                  {hasActiveSku ? (
                    <CheckCircle2 className="size-4 text-success" aria-hidden="true" />
                  ) : (
                    <AlertCircle className="size-4 text-warning" aria-hidden="true" />
                  )}
                  <span>Tối thiểu 1 SKU đang hoạt động</span>
                </span>
                <span className="inline-flex items-center gap-1.5">
                  {hasImage ? (
                    <CheckCircle2 className="size-4 text-success" aria-hidden="true" />
                  ) : (
                    <AlertCircle className="size-4 text-warning" aria-hidden="true" />
                  )}
                  <span>Tối thiểu 1 hình ảnh</span>
                </span>
              </div>
              <Badge variant={product.is_active ? 'success' : 'warning'}>
                {product.is_active ? 'Đang mở bán' : 'Bản nháp'}
              </Badge>
            </div>
            {publishChecklistError ? (
              <p role="alert" className="mt-2 text-xs font-medium text-brand-red">
                {publishChecklistError}
              </p>
            ) : null}
          </section>

          {/* Product Details Form */}
          <section className="rounded-lg border border-border bg-card p-5">
            <h2 className="mb-4 text-base font-bold text-foreground">Thông tin sản phẩm</h2>
            <form
              onSubmit={productForm.handleSubmit((values) => updateProductMutation.mutate(values))}
              className="space-y-4"
            >
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <FormField
                  label="Tên sản phẩm"
                  htmlFor="edit-prod-name"
                  required
                  error={productForm.formState.errors.name?.message}
                >
                  {(fieldProps) => <Input {...fieldProps} {...productForm.register('name')} />}
                </FormField>

                <FormField label="Slug & Nhóm sản phẩm (Bất biến)" htmlFor="edit-prod-slug">
                  {(fieldProps) => (
                    <Input
                      value={`${product.slug} · ${product.product_type_code}`}
                      disabled
                      {...fieldProps}
                    />
                  )}
                </FormField>

                <FormField label="Danh mục" htmlFor="edit-prod-cat" required>
                  {(fieldProps) => (
                    <Select
                      {...fieldProps}
                      {...productForm.register('category_id', { valueAsNumber: true })}
                    >
                      {categories.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </Select>
                  )}
                </FormField>

                <FormField label="Thương hiệu" htmlFor="edit-prod-brand" required>
                  {(fieldProps) => (
                    <Select
                      {...fieldProps}
                      {...productForm.register('brand_id', { valueAsNumber: true })}
                    >
                      {brands.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name}
                        </option>
                      ))}
                    </Select>
                  )}
                </FormField>
              </div>

              <FormField label="Mô tả" htmlFor="edit-prod-desc">
                {(fieldProps) => (
                  <textarea
                    rows={3}
                    className="w-full rounded-md border border-border-strong bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red"
                    {...fieldProps}
                    {...productForm.register('description')}
                  />
                )}
              </FormField>

              <label className="inline-flex min-h-10 cursor-pointer items-center gap-2 text-sm font-medium text-foreground">
                <input
                  type="checkbox"
                  className="size-4 accent-brand-red"
                  {...productForm.register('is_active')}
                />
                <span>Xuất bản sản phẩm (hiển thị trên Storefront)</span>
              </label>

              <div className="flex justify-end">
                <Button type="submit" variant="brand" disabled={updateProductMutation.isPending}>
                  Lưu thông tin sản phẩm
                </Button>
              </div>
            </form>
          </section>

          {/* SKU Variants */}
          <section className="space-y-4 rounded-lg border border-border bg-card p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-base font-bold text-foreground">
                  Biến thể SKU ({product.variants.length})
                </h2>
                <p className="text-xs text-muted-foreground">
                  Mã SKU và tổ hợp thuộc tính là bất biến sau khi tạo; sửa giá trực tiếp trên từng SKU.
                </p>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={openCreateSkuModal}>
                <Plus className="size-4" aria-hidden="true" />
                <span>Thêm SKU mới</span>
              </Button>
            </div>

            {product.variants.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Chưa có SKU nào. Thêm ít nhất 1 SKU để có thể xuất bản sản phẩm.
              </p>
            ) : (
              <div className="overflow-x-auto rounded-md border border-border">
                <table className="w-full border-collapse text-left text-sm">
                  <thead className="border-b border-border bg-surface text-xs font-semibold uppercase text-muted-foreground">
                    <tr>
                      <th scope="col" className="px-4 py-2.5">SKU</th>
                      <th scope="col" className="px-4 py-2.5">Thuộc tính</th>
                      <th scope="col" className="px-4 py-2.5 text-right">Giá bán</th>
                      <th scope="col" className="px-4 py-2.5 text-right">Giá niêm yết</th>
                      <th scope="col" className="px-4 py-2.5 text-right">Tồn kho</th>
                      <th scope="col" className="px-4 py-2.5">Trạng thái</th>
                      <th scope="col" className="px-4 py-2.5 text-right">Sửa giá</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border bg-background">
                    {product.variants.map((variant) => (
                      <tr key={variant.id}>
                        <td className="px-4 py-2.5 font-mono text-xs font-semibold">{variant.sku}</td>
                        <td className="px-4 py-2.5 text-xs text-muted-foreground">
                          {formatOptionsSummary(variant.options)}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums-vnd font-semibold">
                          {formatVnd(variant.price)}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums-vnd text-muted-foreground">
                          {variant.list_price ? formatVnd(variant.list_price) : '—'}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums-vnd">
                          {variant.stock_quantity}
                        </td>
                        <td className="px-4 py-2.5">
                          <Badge variant={variant.is_active ? 'success' : 'neutral'}>
                            {variant.is_active ? 'Đang bán' : 'Tạm ngưng'}
                          </Badge>
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              variantForm.reset({
                                price: variant.price,
                                list_price: variant.list_price ?? '',
                                is_active: variant.is_active,
                              });
                              setEditingVariant(variant);
                            }}
                          >
                            Sửa SKU
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Product Images */}
          <section className="space-y-4 rounded-lg border border-border bg-card p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-base font-bold text-foreground">
                  Thư viện hình ảnh ({product.images.length})
                </h2>
                <p className="text-xs text-muted-foreground">
                  Dùng đường dẫn tài nguyên nội bộ đã phê duyệt (`/media/...` hoặc `/images/...`).
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  imageForm.reset({
                    asset_path: '/media/',
                    alt_text: product.name,
                    sort_order: product.images.length,
                    is_primary: product.images.length === 0,
                  });
                  setCreateImgOpen(true);
                }}
              >
                <ImagePlus className="size-4" aria-hidden="true" />
                <span>Thêm đường dẫn ảnh</span>
              </Button>
            </div>

            {product.images.length === 0 ? (
              <p className="text-sm text-muted-foreground">Chưa có hình ảnh nào.</p>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {product.images.map((img) => (
                  <div
                    key={img.id}
                    className="flex flex-col justify-between gap-3 rounded-md border border-border bg-background p-3"
                  >
                    <div className="flex items-start gap-3">
                      <img
                        src={img.asset_path}
                        alt={img.alt_text}
                        className="size-16 shrink-0 rounded border border-border object-cover"
                      />
                      <div className="min-w-0 flex-1 space-y-1">
                        {img.is_primary ? <Badge variant="red-soft">Ảnh chính</Badge> : null}
                        <p className="truncate font-mono text-xs text-foreground">{img.asset_path}</p>
                        <p className="truncate text-xs text-muted-foreground">{img.alt_text}</p>
                      </div>
                    </div>
                    <div className="flex items-center justify-end gap-2">
                      {!img.is_primary ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => setPrimaryImageMutation.mutate(img)}
                          disabled={setPrimaryImageMutation.isPending}
                        >
                          <Star className="size-3.5" aria-hidden="true" />
                          <span>Đặt ảnh chính</span>
                        </Button>
                      ) : null}
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        aria-label={`Xóa ảnh ${img.alt_text}`}
                        onClick={() => deleteImageMutation.mutate(img.id)}
                        disabled={deleteImageMutation.isPending}
                      >
                        <Trash2 className="size-3.5 text-brand-red" aria-hidden="true" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      )}

      {/* Edit Variant Modal */}
      <Dialog
        open={Boolean(editingVariant)}
        onOpenChange={(open) => {
          if (!open) setEditingVariant(null);
        }}
        title={editingVariant ? `Cập nhật SKU ${editingVariant.sku}` : 'Cập nhật SKU'}
        description="Mã SKU và tổ hợp thuộc tính giữ nguyên bất biến."
        size="sm"
      >
        <form
          onSubmit={variantForm.handleSubmit((values) => {
            if (!editingVariant) return;
            updateVariantMutation.mutate({
              variantId: editingVariant.id,
              price: values.price,
              list_price: values.list_price?.trim() ? values.list_price.trim() : null,
              is_active: values.is_active,
            });
          })}
          className="space-y-4"
        >
          <FormField
            label="Giá bán (VND)"
            htmlFor="edit-sku-price"
            required
            error={variantForm.formState.errors.price?.message}
          >
            {(fieldProps) => <Input {...fieldProps} {...variantForm.register('price')} />}
          </FormField>

          <FormField
            label="Giá niêm yết gốc (tùy chọn)"
            htmlFor="edit-sku-list-price"
            error={variantForm.formState.errors.list_price?.message}
          >
            {(fieldProps) => <Input {...fieldProps} {...variantForm.register('list_price')} />}
          </FormField>

          <label className="inline-flex min-h-10 cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4 accent-brand-red"
              {...variantForm.register('is_active')}
            />
            <span>Mở bán SKU này</span>
          </label>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setEditingVariant(null)}>
              Hủy
            </Button>
            <Button type="submit" variant="brand" disabled={updateVariantMutation.isPending}>
              Lưu SKU
            </Button>
          </div>
        </form>
      </Dialog>

      {/* Create SKU Modal */}
      <Dialog
        open={createSkuOpen}
        onOpenChange={setCreateSkuOpen}
        title={`Thêm SKU cho ${product?.product_type_code ?? ''}`}
        description="Thuộc tính lấy động từ /api/product-types theo loại sản phẩm."
        size="md"
      >
        <form onSubmit={handleCreateSkuSubmit} className="space-y-4">
          <FormField label="Mã SKU (IN HOA)" htmlFor="new-sku-code" required>
            {(fieldProps) => (
              <Input
                value={newSkuCode}
                onChange={(e) => setNewSkuCode(e.target.value)}
                placeholder="VD: AO-POLO-DEN-L"
                {...fieldProps}
              />
            )}
          </FormField>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FormField label="Giá bán (VND)" htmlFor="new-sku-price" required>
              {(fieldProps) => (
                <Input
                  value={newSkuPrice}
                  onChange={(e) => setNewSkuPrice(e.target.value)}
                  placeholder="499000"
                  {...fieldProps}
                />
              )}
            </FormField>
            <FormField label="Giá niêm yết (tùy chọn)" htmlFor="new-sku-list-price">
              {(fieldProps) => (
                <Input
                  value={newSkuListPrice}
                  onChange={(e) => setNewSkuListPrice(e.target.value)}
                  placeholder="599000"
                  {...fieldProps}
                />
              )}
            </FormField>
          </div>

          {typeAttributes.length > 0 ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {typeAttributes.map((attr) => (
                <FormField
                  key={attr.id}
                  label={`${attr.name}${attr.unit ? ` (${attr.unit})` : ''}`}
                  htmlFor={`sku-attr-${attr.id}`}
                  required={attr.is_required}
                >
                  {(fieldProps) => (
                    <Select
                      value={selectedOptions[attr.id] ? String(selectedOptions[attr.id]) : ''}
                      onChange={(e) => {
                        const val = Number(e.target.value);
                        setSelectedOptions((prev) => {
                          const next = { ...prev };
                          if (val > 0) {
                            next[attr.id] = val;
                          } else {
                            delete next[attr.id];
                          }
                          return next;
                        });
                      }}
                      {...fieldProps}
                    >
                      {!attr.is_required ? <option value="">Không chọn</option> : null}
                      {attr.values.map((val) => (
                        <option key={val.id} value={val.id}>
                          {val.label} ({val.code})
                        </option>
                      ))}
                    </Select>
                  )}
                </FormField>
              ))}
            </div>
          ) : null}

          <label className="inline-flex min-h-10 cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4 accent-brand-red"
              checked={newSkuActive}
              onChange={(e) => setNewSkuActive(e.target.checked)}
            />
            <span>Kích hoạt SKU ngay</span>
          </label>

          {skuFormError ? (
            <p role="alert" className="text-xs font-medium text-brand-red">
              {skuFormError}
            </p>
          ) : null}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setCreateSkuOpen(false)}>
              Hủy
            </Button>
            <Button type="submit" variant="brand" disabled={createVariantMutation.isPending}>
              Tạo SKU
            </Button>
          </div>
        </form>
      </Dialog>

      {/* Add Image Modal */}
      <Dialog
        open={createImgOpen}
        onOpenChange={setCreateImgOpen}
        title="Thêm ảnh sản phẩm"
        description="Nhập đường dẫn nội bộ /media/... hoặc /images/..."
        size="sm"
      >
        <form
          onSubmit={imageForm.handleSubmit((values) => addImageMutation.mutate(values))}
          className="space-y-4"
        >
          <FormField
            label="Đường dẫn ảnh"
            htmlFor="new-img-path"
            required
            error={imageForm.formState.errors.asset_path?.message}
          >
            {(fieldProps) => (
              <Input
                placeholder="/media/products/sample.webp"
                {...fieldProps}
                {...imageForm.register('asset_path')}
              />
            )}
          </FormField>

          <FormField
            label="Mô tả thay thế (Alt text)"
            htmlFor="new-img-alt"
            required
            error={imageForm.formState.errors.alt_text?.message}
          >
            {(fieldProps) => <Input {...fieldProps} {...imageForm.register('alt_text')} />}
          </FormField>

          <FormField
            label="Thứ tự hiển thị"
            htmlFor="new-img-order"
            error={imageForm.formState.errors.sort_order?.message}
          >
            {(fieldProps) => (
              <Input
                type="number"
                min={0}
                {...fieldProps}
                {...imageForm.register('sort_order', { valueAsNumber: true })}
              />
            )}
          </FormField>

          <label className="inline-flex min-h-10 cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4 accent-brand-red"
              {...imageForm.register('is_primary')}
            />
            <span>Đặt làm ảnh chính</span>
          </label>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setCreateImgOpen(false)}>
              Hủy
            </Button>
            <Button type="submit" variant="brand" disabled={addImageMutation.isPending}>
              Thêm ảnh
            </Button>
          </div>
        </form>
      </Dialog>
    </AdminLayout>
  );
}
