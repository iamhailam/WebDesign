import { useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Menu, ShoppingBag, Tag, User } from 'lucide-react';
import { fetchCartApi } from '@/lib/api';
import { useAuth } from '@/lib/auth-store';
import { Button } from '@/components/ui/button';
import { CategoryNav, type NavCategoryItem } from '@/components/layout/category-nav';
import { MobileNavigation } from '@/components/layout/mobile-nav';
import { SearchBar } from '@/components/layout/search-bar';

export interface HeaderProps {
  categories?: readonly NavCategoryItem[] | undefined;
  searchQuery?: string | undefined;
  cartCount?: number | undefined;
}

function BrandLogoMark() {
  return (
    <svg
      width="28"
      height="28"
      viewBox="0 0 28 28"
      fill="none"
      aria-hidden="true"
      className="shrink-0"
    >
      <rect width="28" height="28" rx="6" fill="#171717" />
      <path d="M8.5 20V8H19.5V10.6H11.5V12.9H18V15.5H11.5V20H8.5Z" fill="#FFFFFF" />
      <circle cx="19.5" cy="18.5" r="2.5" fill="#B91C1C" />
    </svg>
  );
}

export function Header({ categories = [], searchQuery = '', cartCount }: HeaderProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { user, token } = useAuth();

  const cartQuery = useQuery({
    queryKey: ['cart', user?.id],
    queryFn: () => fetchCartApi(token ?? ''),
    enabled: Boolean(token && user?.role === 'CUSTOMER' && cartCount === undefined),
    staleTime: 15_000,
    retry: false,
  });

  const liveCartCount =
    cartCount ?? (cartQuery.data?.data.items.reduce((sum, line) => sum + line.quantity, 0) ?? 0);

  return (
    <header className="sticky top-0 z-40 bg-background">
      {/* 1. Top utility navigation bar */}
      <div className="border-b border-border bg-neutral-900 text-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-1.5 text-xs sm:px-6 lg:px-8">
          <p className="truncate text-neutral-200">
            Thanh toán COD khi nhận hàng · Hệ thống bán lẻ thời trang đa thương hiệu
          </p>
          <div className="hidden shrink-0 items-center gap-4 sm:flex">
            <NavLink to="/brands" className="text-neutral-200 underline-offset-4 hover:text-white hover:underline">
              Thương hiệu
            </NavLink>
            <NavLink to="/design-system" className="text-neutral-200 underline-offset-4 hover:text-white hover:underline">
              Design System
            </NavLink>
            <NavLink to="/system" className="text-neutral-200 underline-offset-4 hover:text-white hover:underline">
              Kết nối API
            </NavLink>
          </div>
        </div>
      </div>

      {/* Main header bar */}
      <div className="border-b border-border bg-background">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8">
          {/* 2. Mobile drawer trigger + Project SVG logo placeholder */}
          <div className="flex min-w-0 items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              aria-label="Mở menu điều hướng"
              aria-expanded={mobileMenuOpen}
              onClick={() => setMobileMenuOpen(true)}
              className="md:hidden"
            >
              <Menu className="size-5" aria-hidden="true" />
            </Button>

            <Link
              to="/"
              className="inline-flex min-h-11 min-w-0 items-center gap-2.5 text-base font-bold tracking-tight text-foreground sm:text-lg"
            >
              <BrandLogoMark />
              <span className="truncate">FASHION RETAIL</span>
            </Link>
          </div>

          {/* 3. Desktop search bar */}
          <div className="hidden max-w-xl flex-1 md:block">
            <SearchBar key={`desktop-${searchQuery}`} initialValue={searchQuery} />
          </div>

          {/* 4. Catalog + Account & Cart controls */}
          <nav aria-label="Điều hướng tài khoản và giỏ hàng" className="flex shrink-0 items-center gap-1 sm:gap-2">
            {user && user.role !== 'CUSTOMER' ? (
              <NavLink
                to="/admin"
                className="hidden min-h-11 items-center gap-1.5 rounded-md border border-brand-red-border bg-brand-red-soft px-2.5 text-sm font-medium text-brand-red transition-colors hover:bg-brand-red hover:text-white lg:inline-flex"
              >
                <span>Back-Office</span>
              </NavLink>
            ) : null}

            <NavLink
              to="/products"
              className={({ isActive }) =>
                `hidden min-h-11 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium transition-colors lg:inline-flex ${
                  isActive ? 'bg-brand-red-soft text-brand-red' : 'text-foreground hover:bg-surface'
                }`
              }
            >
              <Tag className="size-4" aria-hidden="true" />
              <span>Catalog</span>
            </NavLink>

            <NavLink
              to={user ? '/account' : '/login'}
              aria-label={user ? `Tài khoản ${user.full_name}` : 'Tài khoản'}
              className={({ isActive }) =>
                `inline-flex min-h-11 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium transition-colors ${
                  isActive ? 'bg-brand-red-soft text-brand-red' : 'text-foreground hover:bg-surface'
                }`
              }
            >
              <User className="size-4" aria-hidden="true" />
              <span className="hidden max-w-[120px] truncate sm:inline">
                {user ? user.full_name : 'Tài khoản'}
              </span>
            </NavLink>

            <NavLink
              to="/cart"
              aria-label={`Giỏ hàng (${liveCartCount} sản phẩm)`}
              className={({ isActive }) =>
                `inline-flex min-h-11 items-center gap-1.5 rounded-md border px-3 text-sm font-medium transition-colors ${
                  isActive
                    ? 'border-brand-red bg-brand-red-soft text-brand-red'
                    : 'border-border-strong bg-background text-foreground hover:border-brand-red-border hover:text-brand-red'
                }`
              }
            >
              <ShoppingBag className="size-4" aria-hidden="true" />
              <span className="hidden sm:inline">Giỏ hàng</span>
              <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-brand-red px-1.5 py-0.5 text-[11px] font-bold leading-none text-white tabular-nums-vnd">
                {liveCartCount}
              </span>
            </NavLink>
          </nav>
        </div>

        {/* Mobile row 2 search */}
        <div className="border-t border-border px-4 py-2.5 md:hidden">
          <SearchBar key={`mobile-${searchQuery}`} initialValue={searchQuery} />
        </div>
      </div>

      {/* 5. Category navigation */}
      <CategoryNav categories={categories} />
      <MobileNavigation open={mobileMenuOpen} onOpenChange={setMobileMenuOpen} categories={categories} />
    </header>
  );
}
