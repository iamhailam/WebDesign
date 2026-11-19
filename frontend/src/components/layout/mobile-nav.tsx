import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import type { NavCategoryItem } from '@/components/layout/category-nav';

export interface MobileNavigationProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  categories: readonly NavCategoryItem[];
}

export function MobileNavigation({ open, onOpenChange, categories }: MobileNavigationProps) {
  function close() {
    onOpenChange(false);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Danh mục cửa hàng"
      description="Khám phá sản phẩm theo danh mục và thương hiệu."
      size="drawer"
    >
      <nav aria-label="Menu di động" className="space-y-6">
        <div className="space-y-1">
          <p className="px-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Khám phá</p>
          <Link
            to="/"
            onClick={close}
            className="flex min-h-11 items-center justify-between rounded-md px-3 text-sm font-medium text-foreground hover:bg-surface"
          >
            <span>Trang chủ</span>
            <ChevronRight className="size-4 text-muted-foreground" aria-hidden="true" />
          </Link>
          <Link
            to="/products"
            onClick={close}
            className="flex min-h-11 items-center justify-between rounded-md px-3 text-sm font-medium text-foreground hover:bg-surface"
          >
            <span>Tất cả sản phẩm</span>
            <ChevronRight className="size-4 text-muted-foreground" aria-hidden="true" />
          </Link>
          <Link
            to="/brands"
            onClick={close}
            className="flex min-h-11 items-center justify-between rounded-md px-3 text-sm font-medium text-foreground hover:bg-surface"
          >
            <span>Thương hiệu đối tác</span>
            <ChevronRight className="size-4 text-muted-foreground" aria-hidden="true" />
          </Link>
        </div>

        {categories.length > 0 ? (
          <div className="space-y-1 border-t border-border pt-4">
            <p className="px-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Danh mục</p>
            {categories.map((category) => (
              <Link
                key={category.id}
                to={`/products?category_id=${category.id}`}
                onClick={close}
                className="flex min-h-11 items-center justify-between rounded-md px-3 text-sm text-foreground hover:bg-surface hover:text-brand-red"
              >
                <span>{category.name}</span>
                <ChevronRight className="size-4 text-muted-foreground" aria-hidden="true" />
              </Link>
            ))}
          </div>
        ) : null}

        <div className="space-y-1 border-t border-border pt-4">
          <p className="px-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Tài khoản &amp; Hệ thống</p>
          <Link
            to="/login"
            onClick={close}
            className="flex min-h-11 items-center justify-between rounded-md px-3 text-sm text-foreground hover:bg-surface"
          >
            <span>Đăng nhập / Tài khoản</span>
            <ChevronRight className="size-4 text-muted-foreground" aria-hidden="true" />
          </Link>
          <Link
            to="/cart"
            onClick={close}
            className="flex min-h-11 items-center justify-between rounded-md px-3 text-sm text-foreground hover:bg-surface"
          >
            <span>Giỏ hàng</span>
            <ChevronRight className="size-4 text-muted-foreground" aria-hidden="true" />
          </Link>
          <Link
            to="/design-system"
            onClick={close}
            className="flex min-h-11 items-center justify-between rounded-md px-3 text-sm text-muted-foreground hover:bg-surface hover:text-foreground"
          >
            <span>Design System</span>
            <ChevronRight className="size-4" aria-hidden="true" />
          </Link>
          <Link
            to="/system"
            onClick={close}
            className="flex min-h-11 items-center justify-between rounded-md px-3 text-sm text-muted-foreground hover:bg-surface hover:text-foreground"
          >
            <span>Trạng thái kết nối</span>
            <ChevronRight className="size-4" aria-hidden="true" />
          </Link>
        </div>
      </nav>
    </Dialog>
  );
}
