import { Link } from 'react-router-dom';
import { useQueries, useQuery } from '@tanstack/react-query';
import { ArrowRight, Banknote, Layers, PackageCheck, ShieldCheck, Tag } from 'lucide-react';
import {
  fetchPublicBanners,
  fetchPublicBrands,
  fetchPublicCategories,
  fetchPublicProducts,
} from '@/lib/api';
import { usePageTitle } from '@/lib/use-page-title';
import { Button } from '@/components/ui/button';
import { BrandCard } from '@/components/commerce/brand-card';
import { EmptyState } from '@/components/commerce/empty-state';
import { ErrorState } from '@/components/commerce/error-state';
import { HeroBanner, PromoBannerCard } from '@/components/commerce/hero-banner';
import {
  BannerSkeleton,
  BrandGridSkeleton,
  ProductGridSkeleton,
} from '@/components/commerce/loading-skeleton';
import { ProductCard } from '@/components/commerce/product-card';

const SERVICE_HIGHLIGHTS = [
  {
    icon: Banknote,
    title: 'Thanh toán COD khi nhận hàng',
    description: 'Kiểm tra đơn hàng rõ ràng trước khi thanh toán tiền mặt cho đơn vị giao nhận.',
  },
  {
    icon: PackageCheck,
    title: 'Tồn kho thực tế theo SKU',
    description: 'Số lượng hiển thị gắn với từng biến thể kích cỡ, màu sắc hoặc dung tích.',
  },
  {
    icon: Tag,
    title: 'Giá minh bạch theo biến thể',
    description: 'Áp dụng bảng giá công khai và lưu nguyên giá lịch sử trên từng hóa đơn.',
  },
  {
    icon: ShieldCheck,
    title: 'Theo dõi trạng thái đơn trực tiếp',
    description: 'Cập nhật từng bước từ chờ xác nhận, vận chuyển đến giao hàng hoàn tất.',
  },
] as const;

export function HomePage() {
  usePageTitle('Trang chủ');
  const bannersQuery = useQuery({
    queryKey: ['public', 'banners'],
    queryFn: () => fetchPublicBanners(),
    staleTime: 60_000,
    retry: false,
  });

  const categoriesQuery = useQuery({
    queryKey: ['public', 'categories'],
    queryFn: () => fetchPublicCategories(1, 20),
    staleTime: 60_000,
    retry: false,
  });

  const brandsQuery = useQuery({
    queryKey: ['public', 'brands'],
    queryFn: () => fetchPublicBrands(1, 10),
    staleTime: 60_000,
    retry: false,
  });

  // 9. New arrivals
  const newArrivalsQuery = useQuery({
    queryKey: ['public', 'products', 'home-newest'],
    queryFn: () => fetchPublicProducts({ page: 1, page_size: 8, sort: 'newest' }),
    staleTime: 30_000,
    retry: false,
  });

  // 10. Best-selling / featured in-stock selection (no fabricated sales counts per UI_DESIGN_SPEC §5)
  const featuredLineupQuery = useQuery({
    queryKey: ['public', 'products', 'home-featured'],
    queryFn: () => fetchPublicProducts({ page: 1, page_size: 4, in_stock: true, sort: 'price_desc' }),
    staleTime: 30_000,
    retry: false,
  });

  // 11. Promotional / value picks selection
  const promoPicksQuery = useQuery({
    queryKey: ['public', 'products', 'home-promo-picks'],
    queryFn: () => fetchPublicProducts({ page: 1, page_size: 4, in_stock: true, sort: 'price_asc' }),
    staleTime: 30_000,
    retry: false,
  });

  const allBanners = bannersQuery.data?.data.items ?? [];
  const heroBanners = allBanners.filter((b) => b.placement === 'HERO');
  const promoBanners = allBanners.filter((b) => b.placement === 'PROMO');
  const categories = categoriesQuery.data?.data.items ?? [];
  const brands = brandsQuery.data?.data.items ?? [];
  const topCategories = categories.slice(0, 3);

  // 12. Product sections by category
  const categoryProductQueries = useQueries({
    queries: topCategories.map((cat) => ({
      queryKey: ['public', 'products', 'home-category', cat.id],
      queryFn: () => fetchPublicProducts({ category_id: cat.id, page: 1, page_size: 4, sort: 'newest' }),
      staleTime: 30_000,
      retry: false,
    })),
  });

  const newArrivals = newArrivalsQuery.data?.data.items ?? [];
  const featuredProducts = featuredLineupQuery.data?.data.items ?? [];
  const promoProducts = promoPicksQuery.data?.data.items ?? [];

  return (
    <div className="space-y-12 py-6 sm:py-8">
      {bannersQuery.isPending || heroBanners.length > 0 ? (
        <h1 className="sr-only">Cửa hàng thời trang đa thương hiệu</h1>
      ) : null}

      {/* 6. Hero Banners */}
      {bannersQuery.isPending ? (
        <BannerSkeleton />
      ) : heroBanners.length > 0 ? (
        <HeroBanner banners={heroBanners} />
      ) : (
        <section className="rounded-lg border border-border bg-surface px-6 py-10 sm:px-10 sm:py-12">
          <div className="max-w-2xl space-y-4">
            <span className="inline-block rounded-sm bg-brand-red px-2.5 py-1 text-xs font-semibold uppercase tracking-wider text-white">
              Multi-Brand Commerce
            </span>
            <h1 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
              Cửa hàng thời trang đa thương hiệu
            </h1>
            <p className="text-base leading-relaxed text-muted-foreground">
              Khám phá trang phục, giày dép, túi xách, đồng hồ, phụ kiện và nước hoa với giá bán rõ ràng theo từng biến thể SKU.
            </p>
            <div className="flex flex-wrap gap-3 pt-1">
              <Button asChild variant="brand">
                <Link to="/products">
                  <span>Khám phá Catalog</span>
                  <ArrowRight aria-hidden="true" />
                </Link>
              </Button>
              <Button asChild variant="outline">
                <Link to="/design-system">
                  <Layers aria-hidden="true" />
                  <span>Design System</span>
                </Link>
              </Button>
            </div>
          </div>
        </section>
      )}

      {/* 7. Featured Brands */}
      <section aria-labelledby="home-brands-heading" className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <h2 id="home-brands-heading" className="text-xl font-semibold tracking-tight text-foreground">
            Thương hiệu nổi bật
          </h2>
          <Link to="/brands" className="text-sm font-medium text-brand-red hover:underline">
            Xem tất cả
          </Link>
        </div>

        {brandsQuery.isPending ? (
          <BrandGridSkeleton count={5} />
        ) : brandsQuery.isError ? (
          <ErrorState
            message="Không thể tải danh sách thương hiệu."
            onRetry={() => void brandsQuery.refetch()}
          />
        ) : brands.length === 0 ? (
          <EmptyState
            variant="catalog"
            title="Chưa có thương hiệu công khai"
            description="Thương hiệu đang hoạt động sẽ hiển thị tại đây."
          />
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">
            {brands.slice(0, 5).map((brand) => (
              <BrandCard key={brand.id} brand={brand} />
            ))}
          </div>
        )}
      </section>

      {/* 8. Featured Categories */}
      {categories.length > 0 ? (
        <section aria-labelledby="home-categories-heading" className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <h2 id="home-categories-heading" className="text-xl font-semibold tracking-tight text-foreground">
              Danh mục sản phẩm
            </h2>
            <Link to="/products" className="text-sm font-medium text-brand-red hover:underline">
              Tất cả sản phẩm
            </Link>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {categories.slice(0, 6).map((cat) => (
              <Link
                key={cat.id}
                to={`/categories/${cat.slug}`}
                className="flex min-h-16 flex-col items-center justify-center gap-1 rounded-lg border border-border bg-card px-3 py-3 text-center transition-colors hover:border-brand-red-border hover:bg-surface-elevated hover:text-brand-red"
              >
                <span className="text-sm font-semibold text-foreground">{cat.name}</span>
                {cat.description ? (
                  <span className="line-clamp-1 text-[11px] text-muted-foreground">{cat.description}</span>
                ) : null}
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {/* 9. New Arrivals */}
      <section aria-labelledby="home-new-arrivals-heading" className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <h2 id="home-new-arrivals-heading" className="text-xl font-semibold tracking-tight text-foreground">
            Hàng mới về
          </h2>
          <Link to="/products?sort=newest" className="text-sm font-medium text-brand-red hover:underline">
            Xem tất cả
          </Link>
        </div>

        {newArrivalsQuery.isPending ? (
          <ProductGridSkeleton count={8} />
        ) : newArrivalsQuery.isError ? (
          <ErrorState
            message="Không thể tải danh sách sản phẩm mới."
            onRetry={() => void newArrivalsQuery.refetch()}
          />
        ) : newArrivals.length === 0 ? (
          <EmptyState
            variant="catalog"
            title="Chưa có sản phẩm công khai"
            description="Sản phẩm đang hoạt động kèm biến thể và ảnh hợp lệ sẽ xuất hiện tại đây."
          />
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4">
            {newArrivals.map((product) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </div>
        )}
      </section>

      {/* 11 (Part A). Promo Banner if active */}
      {promoBanners.length > 0 ? (
        <section aria-label="Banner khuyến mãi" className="space-y-4">
          {promoBanners.slice(0, 1).map((promo) => (
            <PromoBannerCard key={promo.id} banner={promo} />
          ))}
        </section>
      ) : null}

      {/* 10. Best-selling / Featured In-Stock Selection */}
      {featuredLineupQuery.isPending ? (
        <section aria-labelledby="home-featured-heading" className="space-y-4">
          <h2 id="home-featured-heading" className="text-xl font-semibold tracking-tight text-foreground">
            Sản phẩm nổi bật sẵn hàng
          </h2>
          <ProductGridSkeleton count={4} />
        </section>
      ) : featuredProducts.length > 0 ? (
        <section aria-labelledby="home-featured-heading" className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <h2 id="home-featured-heading" className="text-xl font-semibold tracking-tight text-foreground">
              Sản phẩm nổi bật sẵn hàng
            </h2>
            <Link
              to="/products?in_stock=true&sort=price_desc"
              className="text-sm font-medium text-brand-red hover:underline"
            >
              Xem thêm
            </Link>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4">
            {featuredProducts.map((product) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </div>
        </section>
      ) : null}

      {/* 11 (Part B). Promotional / Good-Value Products */}
      {promoPicksQuery.isPending ? (
        <section aria-labelledby="home-promo-heading" className="space-y-4">
          <h2 id="home-promo-heading" className="text-xl font-semibold tracking-tight text-foreground">
            Lựa chọn giá tốt
          </h2>
          <ProductGridSkeleton count={4} />
        </section>
      ) : promoProducts.length > 0 ? (
        <section aria-labelledby="home-promo-heading" className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <h2 id="home-promo-heading" className="text-xl font-semibold tracking-tight text-foreground">
              Lựa chọn giá tốt
            </h2>
            <Link
              to="/products?in_stock=true&sort=price_asc"
              className="text-sm font-medium text-brand-red hover:underline"
            >
              Xem thêm
            </Link>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4">
            {promoProducts.map((product) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </div>
        </section>
      ) : null}

      {/* 12. Product Sections by Category */}
      {topCategories.map((cat, idx) => {
        const catQuery = categoryProductQueries[idx];
        const catItems = catQuery?.data?.data.items ?? [];
        if (catQuery?.isPending) {
          return (
            <section key={cat.id} className="space-y-4">
              <h2 className="text-xl font-semibold tracking-tight text-foreground">{cat.name}</h2>
              <ProductGridSkeleton count={4} />
            </section>
          );
        }
        if (catItems.length === 0) return null;

        return (
          <section key={cat.id} aria-labelledby={`home-cat-${cat.id}`} className="space-y-4">
            <div className="flex items-center justify-between gap-4">
              <h2 id={`home-cat-${cat.id}`} className="text-xl font-semibold tracking-tight text-foreground">
                {cat.name}
              </h2>
              <Link to={`/categories/${cat.slug}`} className="text-sm font-medium text-brand-red hover:underline">
                Xem {cat.name}
              </Link>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4">
              {catItems.map((product) => (
                <ProductCard key={product.id} product={product} />
              ))}
            </div>
          </section>
        );
      })}

      {/* 13. Customer Service Highlights */}
      <section aria-labelledby="home-service-heading" className="space-y-4 border-t border-border pt-8">
        <h2 id="home-service-heading" className="text-xl font-semibold tracking-tight text-foreground">
          Cam kết vận hành minh bạch
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {SERVICE_HIGHLIGHTS.map((item) => {
            const Icon = item.icon;
            return (
              <div
                key={item.title}
                className="flex items-start gap-3 rounded-lg border border-border bg-surface-elevated p-4"
              >
                <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-brand-red-soft text-brand-red">
                  <Icon className="size-5" aria-hidden="true" />
                </div>
                <div className="space-y-1">
                  <h3 className="text-sm font-semibold text-foreground">{item.title}</h3>
                  <p className="text-xs leading-relaxed text-muted-foreground">{item.description}</p>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
