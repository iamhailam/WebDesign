import { useState, type ReactNode } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import {
  BarChart3,
  Boxes,
  ClipboardList,
  ExternalLink,
  FolderTree,
  History,
  Image,
  LogOut,
  Menu,
  Package,
  ShieldCheck,
  Tag,
  TicketPercent,
  Users,
} from 'lucide-react';
import { useAuth } from '@/lib/auth-store';
import { usePageTitle } from '@/lib/use-page-title';
import {
  ADMIN_GROUP_LABELS,
  getAdminHomeForRole,
  getAdminNavItemsForRole,
  type AdminNavItem,
} from '@/lib/admin-navigation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Breadcrumb, type BreadcrumbItem } from '@/components/commerce/breadcrumb';
import { cn } from '@/lib/utils';

function NavIcon({ id }: { id: AdminNavItem['id'] }) {
  const cls = 'size-4 shrink-0';
  switch (id) {
    case 'dashboard':
      return <BarChart3 className={cls} aria-hidden="true" />;
    case 'orders':
      return <ClipboardList className={cls} aria-hidden="true" />;
    case 'inventory':
      return <Boxes className={cls} aria-hidden="true" />;
    case 'inventory-transactions':
      return <History className={cls} aria-hidden="true" />;
    case 'products':
      return <Package className={cls} aria-hidden="true" />;
    case 'categories':
      return <FolderTree className={cls} aria-hidden="true" />;
    case 'brands':
      return <Tag className={cls} aria-hidden="true" />;
    case 'vouchers':
      return <TicketPercent className={cls} aria-hidden="true" />;
    case 'banners':
      return <Image className={cls} aria-hidden="true" />;
    case 'users':
      return <Users className={cls} aria-hidden="true" />;
    case 'audit':
      return <ShieldCheck className={cls} aria-hidden="true" />;
    default:
      return <Package className={cls} aria-hidden="true" />;
  }
}

export interface AdminLayoutProps {
  title: string;
  description?: string | undefined;
  breadcrumbs?: readonly BreadcrumbItem[] | undefined;
  actions?: ReactNode | undefined;
  children: ReactNode;
}

export function AdminLayout({ title, description, breadcrumbs, actions, children }: AdminLayoutProps) {
  usePageTitle(`${title} | Back-Office`);
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [drawerOpen, setDrawerOpen] = useState(false);

  const navItems = user ? getAdminNavItemsForRole(user.role) : [];
  const groups = (['overview', 'operations', 'catalog', 'system'] as const).filter((group) =>
    navItems.some((item) => item.group === group),
  );
  const homeLink = user ? getAdminHomeForRole(user.role) : '/admin';

  function handleLogout() {
    logout();
    navigate('/login');
  }

  function renderNavList(onItemClick?: () => void) {
    return (
      <nav aria-label="Điều hướng Back-Office" className="space-y-5">
        {groups.map((group) => (
          <div key={group} className="space-y-1">
            <p className="px-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              {ADMIN_GROUP_LABELS[group]}
            </p>
            {navItems
              .filter((item) => item.group === group)
              .map((item) => (
                <NavLink
                  key={item.id}
                  to={item.to}
                  end={item.to === '/admin/inventory' || item.to === '/admin/dashboard'}
                  onClick={onItemClick}
                  className={({ isActive }) =>
                    cn(
                      'flex min-h-11 items-center gap-2.5 rounded-md px-3 text-sm font-medium transition-colors',
                      isActive
                        ? 'bg-brand-red-soft text-brand-red'
                        : 'text-foreground hover:bg-surface',
                    )
                  }
                >
                  <NavIcon id={item.id} />
                  <span>{item.label}</span>
                </NavLink>
              ))}
          </div>
        ))}
      </nav>
    );
  }

  return (
    <div className="min-h-screen bg-surface text-foreground lg:flex">
      {/* Desktop Sidebar */}
      <aside className="hidden w-64 shrink-0 border-r border-border bg-background lg:flex lg:flex-col">
        <div className="flex h-16 items-center justify-between border-b border-border px-4">
          <Link to={homeLink} className="flex items-center gap-2 font-bold tracking-tight text-foreground">
            <span className="inline-flex size-7 items-center justify-center rounded bg-neutral-900 text-xs font-bold text-white">
              FR
            </span>
            <span>Back-Office</span>
          </Link>
          {user ? <Badge variant="red-soft">{user.role}</Badge> : null}
        </div>
        <div className="flex-1 overflow-y-auto px-3 py-4">{renderNavList()}</div>
        <div className="border-t border-border p-3 text-xs text-muted-foreground">
          <Link
            to="/"
            className="flex min-h-10 items-center justify-between rounded-md px-3 font-medium text-foreground hover:bg-surface"
          >
            <span>Về Storefront</span>
            <ExternalLink className="size-3.5 text-muted-foreground" aria-hidden="true" />
          </Link>
        </div>
      </aside>

      {/* Main Column */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-3 border-b border-border bg-background px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Mở menu quản trị"
              aria-expanded={drawerOpen}
              onClick={() => setDrawerOpen(true)}
              className="lg:hidden"
            >
              <Menu className="size-5" aria-hidden="true" />
            </Button>
            <Link
              to={homeLink}
              className="truncate text-sm font-bold text-foreground lg:hidden"
            >
              Fashion Retail Back-Office
            </Link>
            <span className="hidden text-xs font-medium text-muted-foreground lg:inline">
              Hệ thống quản trị vận hành · DB-Centric RBAC
            </span>
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            <Link
              to="/"
              className="inline-flex min-h-10 items-center gap-1.5 rounded-md border border-border px-3 text-xs font-medium text-foreground hover:bg-surface lg:hidden"
            >
              <span>Storefront</span>
              <ExternalLink className="size-3.5" aria-hidden="true" />
            </Link>
            {user ? (
              <div className="hidden items-center gap-2 text-right sm:flex">
                <div>
                  <p className="max-w-[160px] truncate text-sm font-semibold text-foreground">
                    {user.full_name}
                  </p>
                  <p className="text-xs text-muted-foreground">{user.role}</p>
                </div>
              </div>
            ) : null}
            <Button type="button" variant="outline" size="sm" onClick={handleLogout}>
              <LogOut className="size-4" aria-hidden="true" />
              <span className="hidden sm:inline">Đăng xuất</span>
            </Button>
          </div>
        </header>

        <main id="admin-main-content" className="mx-auto w-full max-w-7xl flex-1 space-y-6 px-4 py-6 sm:px-6">
          {breadcrumbs && breadcrumbs.length > 0 ? <Breadcrumb items={breadcrumbs} /> : null}

          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-4">
            <div className="space-y-1">
              <h1 className="text-2xl font-bold tracking-tight text-foreground">{title}</h1>
              {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
            </div>
            {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
          </div>

          {children}
        </main>
      </div>

      {/* Mobile Sidebar Drawer */}
      <Dialog
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        title="Menu Back-Office"
        description={user ? `Vai trò hiện tại: ${user.role}` : undefined}
        size="drawer"
      >
        <div className="space-y-4">
          {renderNavList(() => setDrawerOpen(false))}
          <div className="border-t border-border pt-3">
            <Link
              to="/"
              onClick={() => setDrawerOpen(false)}
              className="flex min-h-11 items-center justify-between rounded-md px-3 text-sm font-medium text-foreground hover:bg-surface"
            >
              <span>Mở Storefront</span>
              <ExternalLink className="size-4 text-muted-foreground" aria-hidden="true" />
            </Link>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
