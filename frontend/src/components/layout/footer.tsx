import { Link } from 'react-router-dom';
import type { NavCategoryItem } from '@/components/layout/category-nav';

export interface FooterProps {
  categories?: readonly NavCategoryItem[] | undefined;
}

export function Footer({ categories = [] }: FooterProps) {
  return (
    <footer className="mt-16 border-t border-border bg-surface text-foreground">
      <div className="mx-auto grid max-w-7xl grid-cols-1 gap-8 px-4 py-12 sm:grid-cols-2 sm:px-6 lg:grid-cols-4 lg:px-8">
        <div className="space-y-3">
          <Link to="/" className="inline-flex items-center gap-2 text-lg font-bold tracking-tight">
            <span className="inline-block size-2.5 rounded-full bg-brand-red" aria-hidden="true" />
            <span>FASHION RETAIL</span>
          </Link>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Nền tảng bán lẻ thời trang đa thương hiệu vận hành trên kho tập trung và thanh toán tiền mặt khi nhận hàng (COD).
          </p>
        </div>

        <div className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground">Danh mục</h2>
          <ul className="space-y-2 text-sm text-muted-foreground">
            <li>
              <Link to="/products" className="hover:text-brand-red">
                Tất cả sản phẩm
              </Link>
            </li>
            <li>
              <Link to="/brands" className="hover:text-brand-red">
                Thương hiệu đối tác
              </Link>
            </li>
            {categories.slice(0, 6).map((cat) => (
              <li key={cat.id}>
                <Link to={`/products?category_id=${cat.id}`} className="hover:text-brand-red">
                  {cat.name}
                </Link>
              </li>
            ))}
          </ul>
        </div>

        <div className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground">Hướng dẫn</h2>
          <ul className="space-y-2 text-sm text-muted-foreground">
            <li>Thanh toán COD khi giao hàng</li>
            <li>Kiểm tra tồn kho theo từng SKU</li>
            <li>Giá và khuyến mãi công khai theo biến thể</li>
          </ul>
        </div>

        <div className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground">Hệ thống</h2>
          <ul className="space-y-2 text-sm text-muted-foreground">
            <li>
              <Link to="/design-system" className="hover:text-brand-red">
                Design System &amp; UI Kit
              </Link>
            </li>
            <li>
              <Link to="/system" className="hover:text-brand-red">
                Trạng thái kết nối API
              </Link>
            </li>
          </ul>
        </div>
      </div>

      <div className="border-t border-border bg-background">
        <div className="mx-auto flex max-w-7xl flex-col items-start justify-between gap-2 px-4 py-4 text-xs text-muted-foreground sm:flex-row sm:items-center sm:px-6 lg:px-8">
          <p>© 2026 Fashion Retail. Hệ thống thương mại điện tử đa thương hiệu.</p>
          <p>Hỗ trợ responsive mobile · tablet · desktop</p>
        </div>
      </div>
    </footer>
  );
}
