import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from '../src/app';
import { computeDiscountPercent, formatVnd, type CatalogFilterValue } from '../src/lib/commerce-utils';
import { Button } from '../src/components/ui/button';
import { Dialog } from '../src/components/ui/dialog';
import { FormField, Input } from '../src/components/ui/input';
import { ToastProvider } from '../src/components/ui/toast';
import { useToast } from '../src/components/ui/use-toast';
import { BrandCard } from '../src/components/commerce/brand-card';
import { Breadcrumb } from '../src/components/commerce/breadcrumb';
import { DiscountBadge } from '../src/components/commerce/discount-badge';
import { EmptyState } from '../src/components/commerce/empty-state';
import { ErrorState } from '../src/components/commerce/error-state';
import { FilterPanel } from '../src/components/commerce/filter-panel';
import { ProductGridSkeleton } from '../src/components/commerce/loading-skeleton';
import { Pagination } from '../src/components/commerce/pagination';
import { PriceDisplay } from '../src/components/commerce/price-display';
import { ProductCard } from '../src/components/commerce/product-card';

function renderWithProviders(ui: React.ReactNode, route = '/') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[route]}>
        <ToastProvider>{ui}</ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Task 09 Design System components & accessibility', () => {
  it('renders AppLayout navigation, search submission, and mobile menu drawer', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          data: { items: [{ id: 1, name: 'Fashion', slug: 'fashion' }] },
          meta: { request_id: '22222222-2222-4222-8222-222222222222' },
        }),
      }),
    );

    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/']}>
          <App />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(screen.getByRole('link', { name: 'Đến nội dung chính' })).toHaveAttribute('href', '#main-content');
    expect(screen.getAllByRole('search').length).toBeGreaterThanOrEqual(1);

    const menuButton = screen.getByRole('button', { name: 'Mở menu điều hướng' });
    fireEvent.click(menuButton);

    const drawer = await screen.findByRole('dialog', { name: 'Danh mục cửa hàng' });
    expect(within(drawer).getByRole('link', { name: 'Tất cả sản phẩm' })).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('formats VND prices and computes discount badge percentages safely', () => {
    expect(formatVnd('1290000.00')).toMatch(/1\.290\.000/);
    expect(computeDiscountPercent('1290000.00', '1690000.00')).toBe(24);
    expect(computeDiscountPercent('1000000.00', '1000000.00')).toBe(0);
    expect(computeDiscountPercent('1000000.00', null)).toBe(0);

    render(
      <div>
        <PriceDisplay price="1290000.00" listPrice="1690000.00" />
        <DiscountBadge percent={24} />
        <DiscountBadge percent={0} />
      </div>,
    );
    expect(screen.getByLabelText('Giảm 24%')).toHaveTextContent('-24%');
    expect(screen.getByLabelText(/Giá gốc/)).toBeInTheDocument();
  });

  it('renders ProductCard and BrandCard with fallback placeholders and stock states', () => {
    renderWithProviders(
      <div>
        <ProductCard
          product={{
            id: 1,
            name: 'Áo Khoác Test',
            slug: 'ao-khoac-test',
            brand: { id: 2, name: 'Nordic Peak', slug: 'nordic-peak' },
            category: { id: 3, name: 'Fashion', slug: 'fashion' },
            product_type_code: 'CLOTHING',
            base_image_url: null,
            price_min: '890000.00',
            price_max: '1290000.00',
            in_stock: false,
            discount_percent: 15,
          }}
        />
        <BrandCard brand={{ id: 5, name: 'Essence Lab', slug: 'essence-lab', logo_path: null }} />
      </div>,
    );

    expect(screen.getByText('Chưa có ảnh')).toBeInTheDocument();
    expect(screen.getByText('Hết hàng')).toBeInTheDocument();
    expect(screen.getByLabelText('Giảm 15%')).toBeInTheDocument();
    expect(screen.getByText('Essence Lab')).toBeInTheDocument();
  });

  it('validates FilterPanel price range and handles Breadcrumb & Pagination', () => {
    const onApply = vi.fn();
    const onPageChange = vi.fn();
    const baseFilter: CatalogFilterValue = {
      categoryId: '',
      brandId: '',
      productType: '',
      minPrice: '',
      maxPrice: '',
      inStock: false,
      sort: 'newest',
    };

    renderWithProviders(
      <div>
        <Breadcrumb items={[{ label: 'Trang chủ', to: '/' }, { label: 'Sản phẩm' }]} />
        <FilterPanel
          value={baseFilter}
          categories={[{ value: '1', label: 'Fashion' }]}
          brands={[{ value: '1', label: 'Nordic Peak' }]}
          productTypes={[{ value: 'CLOTHING', label: 'Quần áo' }]}
          onApply={onApply}
          onReset={vi.fn()}
        />
        <Pagination page={2} totalPages={9} totalItems={100} onPageChange={onPageChange} />
      </div>,
    );

    expect(screen.getByText('Sản phẩm')).toHaveAttribute('aria-current', 'page');

    fireEvent.click(screen.getByRole('button', { name: 'Trang 3' }));
    expect(onPageChange).toHaveBeenCalledWith(3);

    const minInput = screen.getByPlaceholderText('Từ (₫)');
    const maxInput = screen.getByPlaceholderText('Đến (₫)');
    fireEvent.change(minInput, { target: { value: '500000' } });
    fireEvent.change(maxInput, { target: { value: '100000' } });

    expect(screen.getByRole('alert')).toHaveTextContent('Giá tối thiểu không được lớn hơn giá tối đa.');
    expect(screen.getByRole('button', { name: 'Áp dụng bộ lọc' })).toBeDisabled();
  });

  it('supports accessible Dialog, FormField errors, Toast live notifications, and loading/empty/error states', () => {
    function Harness() {
      const { toast } = useToast();
      return (
        <div>
          <Button onClick={() => toast({ title: 'Thông báo lỗi mẫu', variant: 'error', duration: 0 })}>
            Trigger Toast
          </Button>
          <Dialog open onOpenChange={vi.fn()} title="Xác nhận mẫu">
            <FormField label="Email" error="Email không hợp lệ.">
              {(props) => <Input {...props} defaultValue="bad" error="Email không hợp lệ." />}
            </FormField>
          </Dialog>
          <ProductGridSkeleton count={2} />
          <EmptyState title="Trống" description="Không có dữ liệu." />
          <ErrorState message="Lỗi kết nối." code="ERR_TEST" onRetry={vi.fn()} />
        </div>
      );
    }

    renderWithProviders(<Harness />);

    expect(screen.getByRole('dialog', { name: 'Xác nhận mẫu' })).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('status', { name: 'Đang tải danh sách sản phẩm' })).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByText('ERR_TEST')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Trigger Toast' }));
    expect(screen.getByText('Thông báo lỗi mẫu')).toBeInTheDocument();
  });

  it('renders /design-system route cleanly', async () => {
    renderWithProviders(<App />, '/design-system');
    expect(
      await screen.findByRole('heading', { name: 'Hệ thống Thiết kế Giao diện Thương mại' }),
    ).toBeInTheDocument();
  });
});
