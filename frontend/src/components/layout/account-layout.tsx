import type { ReactNode } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { LogOut, Package, ShoppingBag, User } from 'lucide-react';
import { useAuth } from '@/lib/auth-store';
import { usePageTitle } from '@/lib/use-page-title';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Breadcrumb, type BreadcrumbItem } from '@/components/commerce/breadcrumb';

export interface AccountLayoutProps {
  title: string;
  description?: string | undefined;
  breadcrumbs: readonly BreadcrumbItem[];
  headerAction?: ReactNode | undefined;
  children: ReactNode;
}

export function AccountLayout({
  title,
  description,
  breadcrumbs,
  headerAction,
  children,
}: AccountLayoutProps) {
  usePageTitle(title);
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const isCustomer = user?.role === 'CUSTOMER';

  return (
    <div className="space-y-6 pb-12">
      <Breadcrumb items={breadcrumbs} />

      <div className="flex flex-col gap-6 md:flex-row md:items-start">
        {/* Account navigation sidebar (desktop) / pill tabs (mobile) */}
        <aside aria-label="Điều hướng tài khoản" className="w-full shrink-0 space-y-3 md:w-64">
          {user ? (
            <div className="rounded-lg border border-border bg-surface-elevated p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="truncate text-sm font-semibold text-foreground">{user.full_name}</p>
                <Badge variant={isCustomer ? 'neutral' : 'red-soft'}>{user.role}</Badge>
              </div>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">{user.email}</p>
            </div>
          ) : null}

          <nav
            aria-label="Menu tài khoản"
            className="flex flex-row gap-1.5 overflow-x-auto rounded-lg border border-border bg-card p-2 md:flex-col"
          >
            <NavLink
              to="/account"
              end
              className={({ isActive }) =>
                cn(
                  'inline-flex min-h-11 shrink-0 items-center gap-2.5 rounded-md px-3 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-brand-red-soft text-brand-red'
                    : 'text-foreground hover:bg-surface',
                )
              }
            >
              <User className="size-4 shrink-0" aria-hidden="true" />
              <span>Thông tin cá nhân</span>
            </NavLink>

            {isCustomer ? (
              <>
                <NavLink
                  to="/account/orders"
                  className={({ isActive }) =>
                    cn(
                      'inline-flex min-h-11 shrink-0 items-center gap-2.5 rounded-md px-3 text-sm font-medium transition-colors',
                      isActive
                        ? 'bg-brand-red-soft text-brand-red'
                        : 'text-foreground hover:bg-surface',
                    )
                  }
                >
                  <Package className="size-4 shrink-0" aria-hidden="true" />
                  <span>Đơn hàng của tôi</span>
                </NavLink>

                <NavLink
                  to="/cart"
                  className={({ isActive }) =>
                    cn(
                      'inline-flex min-h-11 shrink-0 items-center gap-2.5 rounded-md px-3 text-sm font-medium transition-colors',
                      isActive
                        ? 'bg-brand-red-soft text-brand-red'
                        : 'text-foreground hover:bg-surface',
                    )
                  }
                >
                  <ShoppingBag className="size-4 shrink-0" aria-hidden="true" />
                  <span>Giỏ hàng</span>
                </NavLink>
              </>
            ) : null}

            <Button
              variant="ghost"
              onClick={() => {
                logout();
                navigate('/');
              }}
              className="shrink-0 justify-start gap-2.5 px-3 text-muted-foreground hover:text-brand-red md:mt-2 md:border-t md:border-border md:pt-3"
            >
              <LogOut className="size-4 shrink-0" aria-hidden="true" />
              <span>Đăng xuất</span>
            </Button>
          </nav>
        </aside>

        {/* Main account content */}
        <section className="min-w-0 flex-1 space-y-6">
          <header className="flex flex-wrap items-end justify-between gap-3 border-b border-border pb-4">
            <div className="space-y-1">
              <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">{title}</h1>
              {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
            </div>
            {headerAction}
          </header>

          {children}
        </section>
      </div>
    </div>
  );
}
