import { Link } from 'react-router-dom';
import { ShieldAlert } from 'lucide-react';
import { useAuth } from '@/lib/auth-store';
import { usePageTitle } from '@/lib/use-page-title';
import { Button } from '@/components/ui/button';

export function ForbiddenPage() {
  usePageTitle('Không có quyền truy cập (403)');
  const { user } = useAuth();
  return (
    <section className="mx-auto max-w-lg space-y-4 px-4 py-12 text-center">
      <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-brand-red-soft text-brand-red">
        <ShieldAlert className="size-6" aria-hidden="true" />
      </div>
      <h1 className="text-2xl font-bold text-foreground">Không có quyền truy cập (403)</h1>
      <p className="text-sm text-muted-foreground">
        {user
          ? `Tài khoản vai trò ${user.role} không có quyền truy cập chức năng hoặc trang này.`
          : 'Bạn không có quyền truy cập trang này.'}
      </p>
      <div className="flex flex-wrap justify-center gap-3">
        {user && user.role !== 'CUSTOMER' ? (
          <Button asChild variant="brand">
            <Link to="/admin">Về Back-Office</Link>
          </Button>
        ) : (
          <Button asChild variant="brand">
            <Link to="/products">Tiếp tục xem sản phẩm</Link>
          </Button>
        )}
        <Button asChild variant="outline">
          <Link to="/">Về trang chủ</Link>
        </Button>
      </div>
    </section>
  );
}
