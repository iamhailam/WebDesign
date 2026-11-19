import { lazy, Suspense } from 'react';
import { Link, Navigate, Route, Routes, useLocation, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { fetchPublicCategories } from '@/lib/api';
import { getAdminHomeForRole } from '@/lib/admin-navigation';
import { AuthProvider } from '@/lib/auth-context';
import { useAuth } from '@/lib/auth-store';
import { ToastProvider } from '@/components/ui/toast';
import { ProtectedRoute } from '@/components/auth/protected-route';
import { AppLayout } from '@/components/layout/app-layout';
import { ProductGridSkeleton } from '@/components/commerce/loading-skeleton';
import { HomePage } from '@/pages/home';

const SystemPage = lazy(() => import('@/pages/system').then((m) => ({ default: m.SystemPage })));
const ProductsPage = lazy(() => import('@/pages/products').then((m) => ({ default: m.ProductsPage })));
const BrandsPage = lazy(() => import('@/pages/products').then((m) => ({ default: m.BrandsPage })));
const ProductDetailPage = lazy(() => import('@/pages/product-detail').then((m) => ({ default: m.ProductDetailPage })));
const CartPage = lazy(() => import('@/pages/cart').then((m) => ({ default: m.CartPage })));
const CheckoutPage = lazy(() => import('@/pages/checkout').then((m) => ({ default: m.CheckoutPage })));
const OrderSuccessPage = lazy(() => import('@/pages/orders').then((m) => ({ default: m.OrderSuccessPage })));
const MyOrdersPage = lazy(() => import('@/pages/orders').then((m) => ({ default: m.MyOrdersPage })));
const OrderDetailPage = lazy(() => import('@/pages/orders').then((m) => ({ default: m.OrderDetailPage })));
const LoginPage = lazy(() => import('@/pages/auth').then((m) => ({ default: m.LoginPage })));
const RegisterPage = lazy(() => import('@/pages/auth').then((m) => ({ default: m.RegisterPage })));
const AccountPage = lazy(() => import('@/pages/auth').then((m) => ({ default: m.AccountPage })));
const ForbiddenPage = lazy(() => import('@/pages/auth').then((m) => ({ default: m.ForbiddenPage })));
const DesignSystemPage = lazy(() => import('@/pages/design-system').then((m) => ({ default: m.DesignSystemPage })));

// Back-Office Lazy Pages
const AdminDashboardPage = lazy(() =>
  import('@/pages/admin/dashboard').then((m) => ({ default: m.AdminDashboardPage })),
);
const AdminOrdersPage = lazy(() =>
  import('@/pages/admin/orders').then((m) => ({ default: m.AdminOrdersPage })),
);
const AdminOrderDetailPage = lazy(() =>
  import('@/pages/admin/orders').then((m) => ({ default: m.AdminOrderDetailPage })),
);
const AdminInventoryPage = lazy(() =>
  import('@/pages/admin/inventory').then((m) => ({ default: m.AdminInventoryPage })),
);
const AdminInventoryTransactionsPage = lazy(() =>
  import('@/pages/admin/inventory').then((m) => ({ default: m.AdminInventoryTransactionsPage })),
);
const AdminProductsPage = lazy(() =>
  import('@/pages/admin/products').then((m) => ({ default: m.AdminProductsPage })),
);
const AdminProductDetailPage = lazy(() =>
  import('@/pages/admin/products').then((m) => ({ default: m.AdminProductDetailPage })),
);
const AdminCategoriesPage = lazy(() =>
  import('@/pages/admin/taxonomy').then((m) => ({ default: m.AdminCategoriesPage })),
);
const AdminBrandsPage = lazy(() =>
  import('@/pages/admin/taxonomy').then((m) => ({ default: m.AdminBrandsPage })),
);
const AdminVouchersPage = lazy(() =>
  import('@/pages/admin/vouchers').then((m) => ({ default: m.AdminVouchersPage })),
);
const AdminVoucherDetailPage = lazy(() =>
  import('@/pages/admin/vouchers').then((m) => ({ default: m.AdminVoucherDetailPage })),
);
const AdminUsersPage = lazy(() =>
  import('@/pages/admin/users-banners').then((m) => ({ default: m.AdminUsersPage })),
);
const AdminBannersPage = lazy(() =>
  import('@/pages/admin/users-banners').then((m) => ({ default: m.AdminBannersPage })),
);
const AdminAuditEventsPage = lazy(() =>
  import('@/pages/admin/users-banners').then((m) => ({ default: m.AdminAuditEventsPage })),
);

function LoadingFallback() {
  return (
    <p className="px-4 py-12 text-sm text-muted-foreground" role="status">
      Đang tải…
    </p>
  );
}

function AdminIndexRedirect() {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  return <Navigate to={getAdminHomeForRole(user.role)} replace />;
}

function AppRoutes() {
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const isAdminRoute =
    location.pathname === '/admin' || location.pathname.startsWith('/admin/');

  const categoriesQuery = useQuery({
    queryKey: ['public', 'categories', 'nav'],
    queryFn: () => fetchPublicCategories(1, 20),
    enabled: !isAdminRoute,
    staleTime: 60_000,
    retry: false,
  });

  if (isAdminRoute) {
    return (
      <Suspense fallback={<LoadingFallback />}>
        <Routes>
          <Route
            path="/admin"
            element={
              <ProtectedRoute allowedRoles={['SALES', 'WAREHOUSE', 'MARKETING', 'ADMIN']}>
                <AdminIndexRedirect />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/dashboard"
            element={
              <ProtectedRoute allowedRoles={['MARKETING', 'ADMIN']}>
                <AdminDashboardPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/orders"
            element={
              <ProtectedRoute allowedRoles={['SALES', 'ADMIN']}>
                <AdminOrdersPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/orders/:id"
            element={
              <ProtectedRoute allowedRoles={['SALES', 'ADMIN']}>
                <AdminOrderDetailPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/inventory"
            element={
              <ProtectedRoute allowedRoles={['WAREHOUSE', 'ADMIN']}>
                <AdminInventoryPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/inventory/transactions"
            element={
              <ProtectedRoute allowedRoles={['WAREHOUSE', 'ADMIN']}>
                <AdminInventoryTransactionsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/products"
            element={
              <ProtectedRoute allowedRoles={['ADMIN']}>
                <AdminProductsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/products/:id"
            element={
              <ProtectedRoute allowedRoles={['ADMIN']}>
                <AdminProductDetailPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/categories"
            element={
              <ProtectedRoute allowedRoles={['ADMIN']}>
                <AdminCategoriesPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/brands"
            element={
              <ProtectedRoute allowedRoles={['ADMIN']}>
                <AdminBrandsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/vouchers"
            element={
              <ProtectedRoute allowedRoles={['MARKETING', 'ADMIN']}>
                <AdminVouchersPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/vouchers/:id"
            element={
              <ProtectedRoute allowedRoles={['MARKETING', 'ADMIN']}>
                <AdminVoucherDetailPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/users"
            element={
              <ProtectedRoute allowedRoles={['ADMIN']}>
                <AdminUsersPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/banners"
            element={
              <ProtectedRoute allowedRoles={['ADMIN']}>
                <AdminBannersPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/audit-events"
            element={
              <ProtectedRoute allowedRoles={['ADMIN']}>
                <AdminAuditEventsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/*"
            element={
              <ProtectedRoute allowedRoles={['SALES', 'WAREHOUSE', 'MARKETING', 'ADMIN']}>
                <AdminIndexRedirect />
              </ProtectedRoute>
            }
          />
        </Routes>
      </Suspense>
    );
  }

  const navCategories = categoriesQuery.data?.data.items ?? [];
  const searchQuery = searchParams.get('search') ?? '';

  return (
    <AppLayout categories={navCategories} searchQuery={searchQuery}>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route
          path="/products"
          element={
            <Suspense fallback={<div className="py-8"><ProductGridSkeleton count={8} /></div>}>
              <ProductsPage />
            </Suspense>
          }
        />
        <Route
          path="/products/:slug"
          element={
            <Suspense fallback={<LoadingFallback />}>
              <ProductDetailPage />
            </Suspense>
          }
        />
        <Route
          path="/categories/:slug"
          element={
            <Suspense fallback={<div className="py-8"><ProductGridSkeleton count={8} /></div>}>
              <ProductsPage />
            </Suspense>
          }
        />
        <Route
          path="/brands"
          element={
            <Suspense fallback={<LoadingFallback />}>
              <BrandsPage />
            </Suspense>
          }
        />
        <Route
          path="/brands/:slug"
          element={
            <Suspense fallback={<div className="py-8"><ProductGridSkeleton count={8} /></div>}>
              <ProductsPage />
            </Suspense>
          }
        />
        <Route
          path="/cart"
          element={
            <Suspense fallback={<LoadingFallback />}>
              <ProtectedRoute allowedRoles={['CUSTOMER']}>
                <CartPage />
              </ProtectedRoute>
            </Suspense>
          }
        />
        <Route
          path="/checkout"
          element={
            <Suspense fallback={<LoadingFallback />}>
              <ProtectedRoute allowedRoles={['CUSTOMER']}>
                <CheckoutPage />
              </ProtectedRoute>
            </Suspense>
          }
        />
        <Route
          path="/checkout/success/:orderId"
          element={
            <Suspense fallback={<LoadingFallback />}>
              <ProtectedRoute allowedRoles={['CUSTOMER']}>
                <OrderSuccessPage />
              </ProtectedRoute>
            </Suspense>
          }
        />
        <Route
          path="/login"
          element={
            <Suspense fallback={<LoadingFallback />}>
              <LoginPage />
            </Suspense>
          }
        />
        <Route
          path="/register"
          element={
            <Suspense fallback={<LoadingFallback />}>
              <RegisterPage />
            </Suspense>
          }
        />
        <Route
          path="/account"
          element={
            <Suspense fallback={<LoadingFallback />}>
              <ProtectedRoute>
                <AccountPage />
              </ProtectedRoute>
            </Suspense>
          }
        />
        <Route
          path="/account/orders"
          element={
            <Suspense fallback={<LoadingFallback />}>
              <ProtectedRoute allowedRoles={['CUSTOMER']}>
                <MyOrdersPage />
              </ProtectedRoute>
            </Suspense>
          }
        />
        <Route
          path="/account/orders/:orderId"
          element={
            <Suspense fallback={<LoadingFallback />}>
              <ProtectedRoute allowedRoles={['CUSTOMER']}>
                <OrderDetailPage />
              </ProtectedRoute>
            </Suspense>
          }
        />
        <Route
          path="/403"
          element={
            <Suspense fallback={<LoadingFallback />}>
              <ForbiddenPage />
            </Suspense>
          }
        />
        <Route
          path="/design-system"
          element={
            <Suspense fallback={<LoadingFallback />}>
              <DesignSystemPage />
            </Suspense>
          }
        />
        <Route
          path="/system"
          element={
            <Suspense fallback={<LoadingFallback />}>
              <SystemPage />
            </Suspense>
          }
        />
        <Route
          path="*"
          element={
            <section className="space-y-4 py-12">
              <h1 className="text-3xl font-semibold">Không tìm thấy trang</h1>
              <p className="text-sm text-muted-foreground">Đường dẫn bạn truy cập không tồn tại hoặc đã được di chuyển.</p>
              <Link to="/" className="inline-block text-sm font-medium text-brand-red underline underline-offset-4">
                Về trang chủ
              </Link>
            </section>
          }
        />
      </Routes>
    </AppLayout>
  );
}

export function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <AppRoutes />
      </ToastProvider>
    </AuthProvider>
  );
}
