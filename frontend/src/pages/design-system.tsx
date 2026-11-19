import { useState } from 'react';
import { computeDiscountPercent, type CatalogFilterValue } from '@/lib/commerce-utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { FormField, Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import { BrandCard } from '@/components/commerce/brand-card';
import { Breadcrumb } from '@/components/commerce/breadcrumb';
import { DiscountBadge } from '@/components/commerce/discount-badge';
import { EmptyState } from '@/components/commerce/empty-state';
import { ErrorState } from '@/components/commerce/error-state';
import { FilterPanel } from '@/components/commerce/filter-panel';
import { ProductCardSkeleton } from '@/components/commerce/loading-skeleton';
import { Pagination } from '@/components/commerce/pagination';
import { PriceDisplay } from '@/components/commerce/price-display';
import { ProductCard, type ProductCardItem } from '@/components/commerce/product-card';

const TOKEN_SWATCHES = [
  { name: 'Page Background', hex: '#FFFFFF', className: 'bg-background border border-border-strong' },
  { name: 'Surface Elevated', hex: '#F6F7F8', className: 'bg-surface border border-border-strong' },
  { name: 'Primary Ink', hex: '#171717', className: 'bg-foreground' },
  { name: 'Secondary Text', hex: '#525252', className: 'bg-muted-foreground' },
  { name: 'Primary Accent Red', hex: '#B91C1C', className: 'bg-brand-red' },
  { name: 'Neutral Border', hex: '#D4D4D4', className: 'bg-border-strong' },
  { name: 'Success', hex: '#166534', className: 'bg-success' },
  { name: 'Warning', hex: '#92400E', className: 'bg-warning' },
] as const;

// UI Pattern specimen only — clearly labeled as synthetic preview specimen, not live catalog data
const SPECIMEN_PRODUCT: ProductCardItem = {
  id: 0,
  name: 'UI Specimen — Product Card Typography & Aspect Contain Preview',
  slug: 'design-system',
  brand: { id: 0, name: 'Brand Specimen', slug: 'design-system' },
  category: { id: 0, name: 'Apparel', slug: 'design-system' },
  product_type_code: 'CLOTHING',
  base_image_url: '/media/sanphamdemo1.jpg',
  price_min: '1290000.00',
  price_max: '1590000.00',
  in_stock: true,
  discount_percent: computeDiscountPercent('1290000.00', '1690000.00'),
};

export function DesignSystemPage() {
  const { toast } = useToast();
  const [modalOpen, setModalOpen] = useState(false);
  const [samplePage, setSamplePage] = useState(2);
  const [inputValue, setInputValue] = useState('');
  const [selectValue, setSelectValue] = useState('newest');
  const [filterDemo, setFilterDemo] = useState<CatalogFilterValue>({
    categoryId: '',
    brandId: '',
    productType: '',
    minPrice: '',
    maxPrice: '',
    inStock: false,
    sort: 'newest',
  });

  return (
    <div className="space-y-12 pb-12">
      <Breadcrumb
        items={[
          { label: 'Trang chủ', to: '/' },
          { label: 'Design System' },
        ]}
      />

      <header className="space-y-2 border-b border-border pb-6">
        <Badge variant="red-soft">UI Pattern System · Task 09</Badge>
        <h1 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
          Hệ thống Thiết kế Giao diện Thương mại
        </h1>
        <p className="max-w-2xl text-base text-muted-foreground">
          Bộ token màu sắc, kiểu chữ, thành phần tương tác shadcn/ui và trạng thái tải/rỗng/lỗi dùng chung cho toàn bộ storefront và back-office.
        </p>
      </header>

      {/* 1. Color Tokens */}
      <section aria-labelledby="ds-colors" className="space-y-4">
        <h2 id="ds-colors" className="text-xl font-semibold">
          1. Color Tokens
        </h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {TOKEN_SWATCHES.map((swatch) => (
            <div key={swatch.name} className="space-y-2 rounded-lg border border-border p-3">
              <div className={`h-14 w-full rounded-md ${swatch.className}`} />
              <div className="space-y-0.5">
                <p className="text-sm font-medium text-foreground">{swatch.name}</p>
                <p className="font-mono text-xs text-muted-foreground">{swatch.hex}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* 2. Form Primitives & Buttons */}
      <section aria-labelledby="ds-primitives" className="space-y-4">
        <h2 id="ds-primitives" className="text-xl font-semibold">
          2. Button, Input, Select &amp; Badges
        </h2>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="space-y-4 rounded-lg border border-border p-5">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Buttons</h3>
            <div className="flex flex-wrap gap-3">
              <Button variant="brand">Primary Accent Red</Button>
              <Button variant="default">Action Charcoal</Button>
              <Button variant="outline">Outline</Button>
              <Button variant="secondary">Secondary</Button>
              <Button variant="ghost">Ghost</Button>
              <Button variant="brand" disabled>
                Disabled
              </Button>
            </div>

            <div className="flex flex-wrap items-center gap-2.5 pt-2">
              <DiscountBadge percent={24} />
              <Badge variant="neutral">COD hỗ trợ</Badge>
              <Badge variant="success">Còn hàng</Badge>
              <Badge variant="warning">Tồn thấp</Badge>
              <Badge variant="red-soft">Lỗi kiểm tra</Badge>
            </div>

            <div className="space-y-2 pt-2">
              <PriceDisplay price="1290000.00" listPrice="1690000.00" size="lg" />
              <PriceDisplay priceMin="890000.00" priceMax="1750000.00" size="sm" />
            </div>
          </div>

          <div className="space-y-4 rounded-lg border border-border p-5">
            <FormField label="Tên người nhận (Input mẫu)" hint="Tối thiểu 1 ký tự, không khoảng trắng thừa." required>
              {(props) => (
                <Input
                  {...props}
                  placeholder="Nhập họ tên…"
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                />
              )}
            </FormField>

            <FormField label="Trạng thái Input lỗi" error="Vui lòng nhập số tiền hợp lệ.">
              {(props) => <Input {...props} defaultValue="-500" error="Vui lòng nhập số tiền hợp lệ." />}
            </FormField>

            <div className="space-y-1.5">
              <label htmlFor="ds-select" className="block text-sm font-medium">
                Sắp xếp (Select)
              </label>
              <Select
                id="ds-select"
                value={selectValue}
                onChange={(e) => setSelectValue(e.target.value)}
                options={[
                  { value: 'newest', label: 'Mới nhất' },
                  { value: 'price_asc', label: 'Giá thấp đến cao' },
                  { value: 'price_desc', label: 'Giá cao đến thấp' },
                ]}
              />
            </div>
          </div>
        </div>
      </section>

      {/* 3. Commerce Cards, FilterPanel & Pagination */}
      <section aria-labelledby="ds-commerce" className="space-y-4">
        <h2 id="ds-commerce" className="text-xl font-semibold">
          3. ProductCard, BrandCard, FilterPanel &amp; Pagination
        </h2>
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
          <FilterPanel
            value={filterDemo}
            categories={[{ value: '1', label: 'Fashion' }]}
            brands={[{ value: '1', label: 'Brand Specimen' }]}
            productTypes={[{ value: 'CLOTHING', label: 'Quần áo' }]}
            onApply={(next) => {
              setFilterDemo(next);
              toast({ title: 'Đã áp dụng bộ lọc mẫu', variant: 'success' });
            }}
            onReset={() =>
              setFilterDemo({
                categoryId: '',
                brandId: '',
                productType: '',
                minPrice: '',
                maxPrice: '',
                inStock: false,
                sort: 'newest',
              })
            }
          />

          <div className="min-w-0 flex-1 space-y-6">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <ProductCard product={SPECIMEN_PRODUCT} />
              <ProductCard
                product={{ ...SPECIMEN_PRODUCT, in_stock: false, discount_percent: undefined, base_image_url: null }}
              />
              <BrandCard
                brand={{
                  id: 0,
                  name: 'Maison Specimen',
                  slug: 'design-system',
                  description: 'UI monogram fallback specimen',
                  logo_path: null,
                }}
              />
            </div>

            <Pagination page={samplePage} totalPages={8} totalItems={96} onPageChange={setSamplePage} />
          </div>
        </div>
      </section>

      {/* 4. Interactive Modal/Dialog & Toast + States */}
      <section aria-labelledby="ds-states" className="space-y-4">
        <h2 id="ds-states" className="text-xl font-semibold">
          4. Toast, Modal/Dialog &amp; Loading/Empty/Error States
        </h2>

        <div className="flex flex-wrap gap-3">
          <Button variant="brand" onClick={() => setModalOpen(true)}>
            Mở Modal Dialog
          </Button>
          <Button
            variant="outline"
            onClick={() => toast({ title: 'Thao tác thành công', description: 'Thông báo dạng toast live-region.', variant: 'success' })}
          >
            Toast Success
          </Button>
          <Button
            variant="outline"
            onClick={() => toast({ title: 'Cảnh báo tồn kho', description: 'Sản phẩm chỉ còn 1 đơn vị.', variant: 'warning' })}
          >
            Toast Warning
          </Button>
          <Button
            variant="outline"
            onClick={() => toast({ title: 'Không thể thực hiện', description: 'Dữ liệu đã thay đổi trên máy chủ.', variant: 'error' })}
          >
            Toast Error
          </Button>
        </div>

        <Dialog
          open={modalOpen}
          onOpenChange={setModalOpen}
          title="Xác nhận thao tác mẫu"
          description="Dialog hỗ trợ focus trap, phím Escape để đóng và trả focus về nút kích hoạt."
          footer={
            <>
              <Button variant="outline" onClick={() => setModalOpen(false)}>
                Hủy
              </Button>
              <Button
                variant="brand"
                onClick={() => {
                  setModalOpen(false);
                  toast({ title: 'Đã xác nhận hộp thoại', variant: 'success' });
                }}
              >
                Xác nhận
              </Button>
            </>
          }
        >
          <p className="text-sm text-muted-foreground">
            Thành phần Modal/Dialog được sử dụng chung cho xác nhận hủy đơn, nhập kho và bộ lọc trên thiết bị di động.
          </p>
        </Dialog>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <ProductCardSkeleton />
          <EmptyState
            variant="filter"
            title="Không tìm thấy kết quả"
            description="Empty state chuẩn cho tìm kiếm hoặc bộ lọc không có sản phẩm khớp."
          />
          <ErrorState
            code="OUT_OF_STOCK"
            message="Error state hiển thị mã lỗi an toàn và hành động thử lại."
            onRetry={() => toast({ title: 'Đã kích hoạt thử lại', variant: 'default' })}
          />
        </div>
      </section>
    </div>
  );
}
