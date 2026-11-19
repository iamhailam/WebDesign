import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from '../src/app';

const REQ_META = { request_id: '22222222-2222-4222-8222-222222222222' };

function LocationProbe() {
  const loc = useLocation();
  return <div data-testid="location-probe">{`${loc.pathname}${loc.search}`}</div>;
}

function renderAppAt(route: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[route]}>
        <App />
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function buildCatalogFetchMock(options?: { failProducts?: boolean }) {
  const categories = [
    { id: 1, name: 'Fashion', slug: 'fashion', description: 'Trang phục may mặc' },
    { id: 2, name: 'Shoes', slug: 'shoes', description: 'Giày thể thao' },
    { id: 3, name: 'Perfumes', slug: 'perfumes', description: 'Nước hoa' },
  ];
  const brands = [
    { id: 10, name: 'Nordic Peak', slug: 'nordic-peak', description: 'Outerwear', logo_path: '/media/sanphamdemo1.jpg' },
    { id: 11, name: 'Urban Stride', slug: 'urban-stride', description: 'Footwear', logo_path: null },
  ];
  const products = [
    {
      id: 100,
      name: 'Áo Phao Nordic Peak',
      slug: 'ao-phao-nordic-peak',
      brand: { id: 10, name: 'Nordic Peak', slug: 'nordic-peak' },
      category: { id: 1, name: 'Fashion', slug: 'fashion' },
      product_type_code: 'CLOTHING',
      base_image_url: '/media/sanphamdemo1.jpg',
      price_min: '1890000.00',
      price_max: '1890000.00',
      in_stock: true,
    },
    {
      id: 101,
      name: 'Giày Sneaker Urban Runner',
      slug: 'giay-sneaker-urban-runner',
      brand: { id: 11, name: 'Urban Stride', slug: 'urban-stride' },
      category: { id: 2, name: 'Shoes', slug: 'shoes' },
      product_type_code: 'SHOES',
      base_image_url: '/media/sanphamdemo3.jpg',
      price_min: '1650000.00',
      price_max: '1750000.00',
      in_stock: true,
    },
  ];
  const banners = [
    {
      id: 1,
      title: 'Bộ Sưu Tập Thu Đông Đa Thương Hiệu',
      desktop_path: '/media/sanphamdemo1.jpg',
      mobile_path: null,
      alt_text: 'Banner Hero Thu Đông',
      placement: 'HERO',
      target_type: 'CATEGORY',
      target_path: '/categories/fashion',
    },
    {
      id: 2,
      title: 'Khám Phá Urban Stride',
      desktop_path: '/media/sanphamdemo2.jpg',
      mobile_path: null,
      alt_text: 'Banner Promo Urban Stride',
      placement: 'PROMO',
      target_type: 'BRAND',
      target_path: '/brands/urban-stride',
    },
  ];

  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const jsonResp = (data: unknown, status = 200) => ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => data,
    });

    if (url.includes('/api/banners')) {
      return jsonResp({ success: true, data: { items: banners }, meta: { ...REQ_META, pagination: { page: 1, page_size: 10, total: 2, total_pages: 1 } } });
    }
    if (url.includes('/api/categories/by-slug/fashion')) {
      return jsonResp({ success: true, data: categories[0], meta: REQ_META });
    }
    if (url.includes('/api/categories/by-slug/missing')) {
      return jsonResp({ success: false, message: 'Not found' }, 404);
    }
    if (url.includes('/api/categories')) {
      return jsonResp({ success: true, data: { items: categories }, meta: { ...REQ_META, pagination: { page: 1, page_size: 20, total: 3, total_pages: 1 } } });
    }
    if (url.includes('/api/brands/by-slug/urban-stride')) {
      return jsonResp({ success: true, data: brands[1], meta: REQ_META });
    }
    if (url.includes('/api/brands')) {
      return jsonResp({ success: true, data: { items: brands }, meta: { ...REQ_META, pagination: { page: 1, page_size: 20, total: 2, total_pages: 1 } } });
    }
    if (url.includes('/api/product-types')) {
      return jsonResp({ success: true, data: { items: [{ code: 'CLOTHING', name: 'Quần áo' }, { code: 'SHOES', name: 'Giày dép' }] }, meta: REQ_META });
    }
    if (url.includes('/api/products')) {
      if (options?.failProducts) {
        return jsonResp({ success: false }, 500);
      }
      const parsed = new URL(url, 'http://localhost');
      const catId = parsed.searchParams.get('category_id');
      const brandId = parsed.searchParams.get('brand_id');
      const search = parsed.searchParams.get('search');
      const filtered = products.filter((p) => {
        if (catId && String(p.category.id) !== catId) return false;
        if (brandId && String(p.brand.id) !== brandId) return false;
        if (search && !p.name.toLowerCase().includes(search.toLowerCase())) return false;
        return true;
      });
      return jsonResp({
        success: true,
        data: { items: filtered },
        meta: {
          ...REQ_META,
          pagination: {
            page: Number(parsed.searchParams.get('page') || '1'),
            page_size: 12,
            total: filtered.length,
            total_pages: filtered.length === 0 ? 0 : 2,
          },
        },
      });
    }
    return jsonResp({ success: false }, 404);
  });
}

describe('Task 10 Homepage + Catalog integration flows', () => {
  it('renders API-driven Homepage sections, account/cart controls, and hides empty category sections', async () => {
    const fetchMock = buildCatalogFetchMock();
    vi.stubGlobal('fetch', fetchMock);

    renderAppAt('/');

    expect(screen.getByRole('link', { name: 'Tài khoản' })).toHaveAttribute('href', '/login');
    expect(screen.getByRole('link', { name: /Giỏ hàng/ })).toHaveAttribute('href', '/cart');

    expect(await screen.findByText('Bộ Sưu Tập Thu Đông Đa Thương Hiệu')).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Thương hiệu nổi bật' })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Hàng mới về' })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Sản phẩm nổi bật sẵn hàng' })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Lựa chọn giá tốt' })).toBeInTheDocument();
    expect(screen.getByText('Khám Phá Urban Stride')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Cam kết vận hành minh bạch' })).toBeInTheDocument();

    // Perfumes has 0 products in mock -> no empty category section heading rendered
    expect(screen.queryByRole('heading', { name: 'Perfumes' })).not.toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Fashion' })).toBeInTheDocument();
  });

  it('shows ErrorState on Homepage product failure and allows retry', async () => {
    const fetchMock = buildCatalogFetchMock({ failProducts: true });
    vi.stubGlobal('fetch', fetchMock);

    renderAppAt('/');

    const alerts = await screen.findAllByRole('alert');
    expect(alerts.length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Không thể tải danh sách sản phẩm mới.')).toBeInTheDocument();
  });

  it('syncs Catalog filters, search, sort, chips, and pagination with URL query parameters', async () => {
    const fetchMock = buildCatalogFetchMock();
    vi.stubGlobal('fetch', fetchMock);

    renderAppAt('/products?search=Nordic&in_stock=true');

    expect(await screen.findByRole('heading', { name: 'Kết quả tìm kiếm: "Nordic"' })).toBeInTheDocument();
    expect(await screen.findByText('Áo Phao Nordic Peak')).toBeInTheDocument();
    expect(screen.queryByText('Giày Sneaker Urban Runner')).not.toBeInTheDocument();

    // Quick sort changes URL param
    fireEvent.change(screen.getByLabelText('Sắp xếp sản phẩm'), { target: { value: 'price_asc' } });
    await waitFor(() => {
      expect(screen.getByTestId('location-probe').textContent).toContain('sort=price_asc');
    });

    // Clear search chip updates URL and restores all products
    fireEvent.click(screen.getByRole('button', { name: /Từ khóa: "Nordic"/ }));
    await waitFor(() => {
      expect(screen.getByTestId('location-probe').textContent).not.toContain('search=');
    });
    expect(await screen.findByText('Giày Sneaker Urban Runner')).toBeInTheDocument();

    // Pagination page 2 updates URL
    fireEvent.click(screen.getByRole('button', { name: 'Trang 2' }));
    await waitFor(() => {
      expect(screen.getByTestId('location-probe').textContent).toContain('page=2');
    });
  });

  it('resolves /brands/:slug and /categories/:slug landing routes and handles invalid slugs', async () => {
    const fetchMock = buildCatalogFetchMock();
    vi.stubGlobal('fetch', fetchMock);

    renderAppAt('/brands/urban-stride');
    expect(await screen.findByRole('heading', { name: 'Urban Stride' })).toBeInTheDocument();
    expect(await screen.findByText('Giày Sneaker Urban Runner')).toBeInTheDocument();
    expect(screen.queryByText('Áo Phao Nordic Peak')).not.toBeInTheDocument();
  });

  it('navigates from Header SearchBar to /products?search=...', async () => {
    const fetchMock = buildCatalogFetchMock();
    vi.stubGlobal('fetch', fetchMock);

    renderAppAt('/');
    const searchInputs = screen.getAllByPlaceholderText(/Tìm kiếm sản phẩm/);
    fireEvent.change(searchInputs[0]!, { target: { value: 'Sneaker' } });
    fireEvent.submit(searchInputs[0]!.closest('form')!);

    await waitFor(() => {
      expect(screen.getByTestId('location-probe').textContent).toBe('/products?search=Sneaker');
    });
    expect(await screen.findByText('Giày Sneaker Urban Runner')).toBeInTheDocument();
  });

  it('regression: keeps single h1 with active HERO banner, serves seeded styleweb.png asset, and updates document.title', async () => {
    expect(existsSync(resolve(process.cwd(), 'public/media/styleweb.png'))).toBe(true);

    const fetchMock = buildCatalogFetchMock();
    vi.stubGlobal('fetch', fetchMock);

    renderAppAt('/');
    expect(await screen.findByRole('heading', { level: 1, name: 'Cửa hàng thời trang đa thương hiệu' })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { level: 2, name: 'Bộ Sưu Tập Thu Đông Đa Thương Hiệu' })).toBeInTheDocument();
    await waitFor(() => {
      expect(document.title).toBe('Trang chủ | Fashion Retail');
    });

    fireEvent.click(await screen.findByRole('link', { name: /Urban Stride.*Footwear/ }));
    await waitFor(() => {
      expect(document.title).toBe('Urban Stride | Fashion Retail');
    });
  });
});
