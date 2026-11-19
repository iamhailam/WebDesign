import { useMemo } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { X } from 'lucide-react';
import {
  fetchBrandBySlug,
  fetchCategoryBySlug,
  fetchProductTypes,
  fetchPublicBrands,
  fetchPublicCategories,
  fetchPublicProducts,
} from '@/lib/api';
import { formatVnd, type CatalogFilterValue } from '@/lib/commerce-utils';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { BrandCard } from '@/components/commerce/brand-card';
import { Breadcrumb } from '@/components/commerce/breadcrumb';
import { EmptyState } from '@/components/commerce/empty-state';
import { ErrorState } from '@/components/commerce/error-state';
import { FilterPanel } from '@/components/commerce/filter-panel';
import { BrandGridSkeleton, ProductGridSkeleton } from '@/components/commerce/loading-skeleton';
import { Pagination } from '@/components/commerce/pagination';
import { ProductCard } from '@/components/commerce/product-card';

export function ProductsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { slug } = useParams<{ slug?: string }>();
  const location = useLocation();
  const navigate = useNavigate();

  const isBrandLanding = Boolean(slug) && location.pathname.startsWith('/brands/');
  const isCategoryLanding = Boolean(slug) && location.pathname.startsWith('/categories/');

  const brandSlugQuery = useQuery({
    queryKey: ['public', 'brand-by-slug', slug],
    queryFn: () => fetchBrandBySlug(slug ?? ''),
    enabled: isBrandLanding && Boolean(slug),
    staleTime: 60_000,
    retry: false,
  });

  const categorySlugQuery = useQuery({
    queryKey: ['public', 'category-by-slug', slug],
    queryFn: () => fetchCategoryBySlug(slug ?? ''),
    enabled: isCategoryLanding && Boolean(slug),
    staleTime: 60_000,
    retry: false,
  });

  const categoriesQuery = useQuery({
    queryKey: ['public', 'categories'],
    queryFn: () => fetchPublicCategories(1, 50),
    staleTime: 60_000,
    retry: false,
  });

  const brandsQuery = useQuery({
    queryKey: ['public', 'brands'],
    queryFn: () => fetchPublicBrands(1, 50),
    staleTime: 60_000,
    retry: false,
  });

  const typesQuery = useQuery({
    queryKey: ['public', 'product-types'],
    queryFn: () => fetchProductTypes(),
    staleTime: 300_000,
    retry: false,
  });

  const categories = useMemo(() => categoriesQuery.data?.data.items ?? [], [categoriesQuery.data]);
  const brands = useMemo(() => brandsQuery.data?.data.items ?? [], [brandsQuery.data]);
  const productTypes = useMemo(() => typesQuery.data?.data.items ?? [], [typesQuery.data]);

  const resolvedBrand = brandSlugQuery.data?.data;
  const resolvedCategory = categorySlugQuery.data?.data;

  const page = Math.max(1, Number(searchParams.get('page') || '1') || 1);
  const search = searchParams.get('search') || '';
  const filterValue: CatalogFilterValue = {
    categoryId: searchParams.get('category_id') || (resolvedCategory ? String(resolvedCategory.id) : ''),
    brandId: searchParams.get('brand_id') || (resolvedBrand ? String(resolvedBrand.id) : ''),
    productType: searchParams.get('product_type') || '',
    minPrice: searchParams.get('min_price') || '',
    maxPrice: searchParams.get('max_price') || '',
    inStock: searchParams.get('in_stock') === 'true',
    sort: (searchParams.get('sort') as CatalogFilterValue['sort'] | null) || 'newest',
  };

  const waitingSlugResolution =
    (isBrandLanding && brandSlugQuery.isPending) || (isCategoryLanding && categorySlugQuery.isPending);
  const slugNotFound =
    (isBrandLanding && brandSlugQuery.isError) || (isCategoryLanding && categorySlugQuery.isError);

  const productsQuery = useQuery({
    queryKey: ['public', 'products', { page, search, filterValue }],
    queryFn: () =>
      fetchPublicProducts({
        page,
        page_size: 12,
        category_id: filterValue.categoryId ? Number(filterValue.categoryId) : undefined,
        brand_id: filterValue.brandId ? Number(filterValue.brandId) : undefined,
        product_type: filterValue.productType || undefined,
        search: search || undefined,
        min_price: filterValue.minPrice || undefined,
        max_price: filterValue.maxPrice || undefined,
        in_stock: filterValue.inStock || undefined,
        sort: filterValue.sort,
      }),
    enabled: !waitingSlugResolution && !slugNotFound,
    staleTime: 15_000,
    retry: false,
  });

  function pushParams(next: CatalogFilterValue, nextSearch = search, resetPage = true) {
    const params = new URLSearchParams();
    if (nextSearch) params.set('search', nextSearch);
    if (next.categoryId && (!resolvedCategory || next.categoryId !== String(resolvedCategory.id))) {
      params.set('category_id', next.categoryId);
    }
    if (next.brandId && (!resolvedBrand || next.brandId !== String(resolvedBrand.id))) {
      params.set('brand_id', next.brandId);
    }
    if (next.productType) params.set('product_type', next.productType);
    if (next.minPrice) params.set('min_price', next.minPrice);
    if (next.maxPrice) params.set('max_price', next.maxPrice);
    if (next.inStock) params.set('in_stock', 'true');
    if (next.sort !== 'newest') params.set('sort', next.sort);
    if (!resetPage && page > 1) params.set('page', String(page));
    setSearchParams(params);
  }

  function resetAllFilters() {
    if (isBrandLanding || isCategoryLanding) {
      navigate('/products');
      return;
    }
    setSearchParams({});
  }

  function changePage(nextPage: number) {
    const params = new URLSearchParams(searchParams);
    params.set('page', String(nextPage));
    setSearchParams(params);
  }

  if (slugNotFound) {
    return (
      <div className="py-10">
        <ErrorState
          title="Không tìm thấy danh mục hoặc thương hiệu"
          message="Đường dẫn này không tồn tại hoặc hiện đã tạm ngưng hiển thị."
          action={
            <Button asChild variant="outline">
              <Link to="/products">Xem tất cả sản phẩm</Link>
            </Button>
          }
        />
      </div>
    );
  }

  const pagination = productsQuery.data?.meta.pagination ?? {
    page,
    page_size: 12,
    total: 0,
    total_pages: 0,
  };
  const products = productsQuery.data?.data.items ?? [];

  const activeCategoryName = categories.find((c) => String(c.id) === filterValue.categoryId)?.name;
  const activeBrandName = brands.find((b) => String(b.id) === filterValue.brandId)?.name;
  const activeTypeName = productTypes.find((t) => t.code === filterValue.productType)?.name;

  const chips: Array<{ key: string; label: string; onClear: () => void }> = [];
  if (search) {
    chips.push({ key: 'search', label: `Từ khóa: "${search}"`, onClear: () => pushParams(filterValue, '') });
  }
  if (activeCategoryName) {
    chips.push({
      key: 'category',
      label: `Danh mục: ${activeCategoryName}`,
      onClear: () => {
        if (isCategoryLanding) navigate('/products');
        else pushParams({ ...filterValue, categoryId: '' });
      },
    });
  }
  if (activeBrandName) {
    chips.push({
      key: 'brand',
      label: `Thương hiệu: ${activeBrandName}`,
      onClear: () => {
        if (isBrandLanding) navigate('/products');
        else pushParams({ ...filterValue, brandId: '' });
      },
    });
  }
  if (activeTypeName) {
    chips.push({
      key: 'type',
      label: `Loại: ${activeTypeName}`,
      onClear: () => pushParams({ ...filterValue, productType: '' }),
    });
  }
  if (filterValue.minPrice || filterValue.maxPrice) {
    const minTxt = filterValue.minPrice ? formatVnd(filterValue.minPrice) : '0 ₫';
    const maxTxt = filterValue.maxPrice ? formatVnd(filterValue.maxPrice) : '∞';
    chips.push({
      key: 'price',
      label: `Giá: ${minTxt} – ${maxTxt}`,
      onClear: () => pushParams({ ...filterValue, minPrice: '', maxPrice: '' }),
    });
  }
  if (filterValue.inStock) {
    chips.push({
      key: 'in_stock',
      label: 'Chỉ còn hàng',
      onClear: () => pushParams({ ...filterValue, inStock: false }),
    });
  }

  const pageTitle = resolvedBrand
    ? resolvedBrand.name
    : resolvedCategory
      ? resolvedCategory.name
      : search
        ? `Kết quả tìm kiếm: "${search}"`
        : 'Tất cả sản phẩm';

  const pageSubtitle =
    resolvedBrand?.description ||
    resolvedCategory?.description ||
    'Lọc nhanh theo thương hiệu, danh mục, ngành hàng, khoảng giá và tình trạng tồn kho.';

  return (
    <div className="space-y-6 pb-8">
      <Breadcrumb
        items={[
          { label: 'Trang chủ', to: '/' },
          ...(isBrandLanding ? [{ label: 'Thương hiệu', to: '/brands' }] : []),
          { label: pageTitle },
        ]}
      />

      <header className="flex flex-col justify-between gap-4 border-b border-border pb-4 sm:flex-row sm:items-end">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">{pageTitle}</h1>
          <p className="text-sm text-muted-foreground">{pageSubtitle}</p>
        </div>

        <div className="flex items-center gap-3 self-start sm:self-auto">
          <span className="text-sm text-muted-foreground tabular-nums-vnd whitespace-nowrap">
            {pagination.total} sản phẩm
          </span>
          <div className="w-44">
            <label htmlFor="catalog-quick-sort" className="sr-only">
              Sắp xếp sản phẩm
            </label>
            <Select
              id="catalog-quick-sort"
              value={filterValue.sort}
              onChange={(e) => pushParams({ ...filterValue, sort: e.target.value as CatalogFilterValue['sort'] })}
              options={[
                { value: 'newest', label: 'Mới nhất' },
                { value: 'price_asc', label: 'Giá thấp đến cao' },
                { value: 'price_desc', label: 'Giá cao đến thấp' },
                { value: 'name_asc', label: 'Tên A – Z' },
              ]}
            />
          </div>
        </div>
      </header>

      {/* Active filter chips */}
      {chips.length > 0 ? (
        <div aria-label="Bộ lọc đang áp dụng" className="flex flex-wrap items-center gap-2">
          {chips.map((chip) => (
            <button
              key={chip.key}
              type="button"
              onClick={chip.onClear}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-border-strong bg-surface px-3 py-1 text-xs font-medium text-foreground transition-colors hover:border-brand-red-border hover:text-brand-red"
            >
              <span>{chip.label}</span>
              <X className="size-3.5" aria-hidden="true" />
            </button>
          ))}
          <button
            type="button"
            onClick={resetAllFilters}
            className="px-2 text-xs font-semibold text-brand-red hover:underline"
          >
            Xóa tất cả
          </button>
        </div>
      ) : null}

      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        <FilterPanel
          key={JSON.stringify(filterValue)}
          value={filterValue}
          categories={categories.map((c) => ({ value: String(c.id), label: c.name }))}
          brands={brands.map((b) => ({ value: String(b.id), label: b.name }))}
          productTypes={productTypes.map((t) => ({ value: t.code, label: t.name }))}
          onApply={(next) => pushParams(next)}
          onReset={resetAllFilters}
        />

        <div className="min-w-0 flex-1 space-y-6">
          {waitingSlugResolution || productsQuery.isPending ? (
            <ProductGridSkeleton count={8} />
          ) : productsQuery.isError ? (
            <ErrorState
              message="Không thể tải danh mục sản phẩm lúc này."
              onRetry={() => void productsQuery.refetch()}
            />
          ) : products.length === 0 ? (
            <EmptyState
              variant="filter"
              title="Không tìm thấy sản phẩm phù hợp"
              description="Thử xóa bớt bộ lọc hoặc thay đổi từ khóa tìm kiếm."
              action={
                <Button variant="outline" onClick={resetAllFilters}>
                  Xóa bộ lọc
                </Button>
              }
            />
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 xl:grid-cols-4">
                {products.map((product) => (
                  <ProductCard key={product.id} product={product} />
                ))}
              </div>

              <Pagination
                page={pagination.page}
                totalPages={pagination.total_pages}
                totalItems={pagination.total}
                onPageChange={changePage}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export function BrandsPage() {
  const brandsQuery = useQuery({
    queryKey: ['public', 'brands', 'all'],
    queryFn: () => fetchPublicBrands(1, 50),
    staleTime: 60_000,
    retry: false,
  });

  const brands = brandsQuery.data?.data.items ?? [];

  return (
    <div className="space-y-6 pb-8">
      <Breadcrumb
        items={[
          { label: 'Trang chủ', to: '/' },
          { label: 'Thương hiệu' },
        ]}
      />
      <div className="space-y-1 border-b border-border pb-4">
        <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">Thương hiệu đối tác</h1>
        <p className="text-sm text-muted-foreground">Khám phá bộ sưu tập từ các thương hiệu đang kinh doanh tại cửa hàng.</p>
      </div>

      {brandsQuery.isPending ? (
        <BrandGridSkeleton count={8} />
      ) : brandsQuery.isError ? (
        <ErrorState message="Không thể tải danh sách thương hiệu." onRetry={() => void brandsQuery.refetch()} />
      ) : brands.length === 0 ? (
        <EmptyState
          variant="catalog"
          title="Chưa có thương hiệu nào được công khai"
          description="Danh sách thương hiệu hoạt động sẽ hiển thị tại đây."
        />
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {brands.map((brand) => (
            <BrandCard key={brand.id} brand={brand} />
          ))}
        </div>
      )}
    </div>
  );
}
