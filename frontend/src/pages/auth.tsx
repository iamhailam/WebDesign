import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { ShieldAlert, UserCheck } from 'lucide-react';
import { z } from 'zod';
import { ApiClientError, fetchMeApi, registerCustomerApi } from '@/lib/api';
import { sanitizeReturnTo, useAuth } from '@/lib/auth-store';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { FormField, Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/use-toast';
import { Breadcrumb } from '@/components/commerce/breadcrumb';
import { ErrorState } from '@/components/commerce/error-state';
import { AccountLayout } from '@/components/layout/account-layout';

const loginSchema = z.object({
  email: z.string().trim().min(1, 'Vui lòng nhập email.').email('Email không hợp lệ.').max(254),
  password: z.string().min(1, 'Vui lòng nhập mật khẩu.').max(128),
});

type LoginFormValues = z.infer<typeof loginSchema>;

const registerSchema = z.object({
  full_name: z.string().trim().min(1, 'Vui lòng nhập họ và tên.').max(120, 'Họ tên tối đa 120 ký tự.'),
  email: z.string().trim().min(1, 'Vui lòng nhập email.').email('Email không hợp lệ.').max(254),
  phone: z
    .string()
    .trim()
    .refine((v) => v === '' || /^\+?[0-9]{8,15}$/.test(v), 'Số điện thoại 8–15 chữ số.'),
  password: z.string().min(12, 'Mật khẩu tối thiểu 12 ký tự.').max(128, 'Mật khẩu tối đa 128 ký tự.'),
});

type RegisterFormValues = z.infer<typeof registerSchema>;

export function LoginPage() {
  const { login, user } = useAuth();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [serverError, setServerError] = useState<string | null>(null);

  const returnTo = sanitizeReturnTo(searchParams.get('return_to'));

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });

  async function onSubmit(values: LoginFormValues) {
    setServerError(null);
    try {
      const signedInUser = await login(values.email.trim(), values.password);
      toast({ title: `Xin chào, ${signedInUser.full_name}`, variant: 'success' });
      navigate(returnTo, { replace: true });
    } catch (err) {
      setServerError(err instanceof ApiClientError ? err.message : 'Đăng nhập thất bại. Vui lòng thử lại.');
    }
  }

  return (
    <div className="mx-auto max-w-md space-y-6 py-8 sm:py-12">
      <Breadcrumb items={[{ label: 'Trang chủ', to: '/' }, { label: 'Đăng nhập' }]} />

      <section className="space-y-6 rounded-lg border border-border bg-card p-6">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Đăng nhập tài khoản</h1>
          <p className="text-sm text-muted-foreground">
            Sử dụng tài khoản khách hàng để thêm giỏ hàng, áp dụng voucher và đặt hàng COD.
          </p>
        </div>

        {user ? (
          <div className="space-y-3 rounded-md border border-border bg-surface p-4 text-sm">
            <p className="font-medium text-foreground">
              Bạn đang đăng nhập với tài khoản <span className="font-semibold">{user.email}</span> ({user.role}).
            </p>
            <Button asChild variant="brand" className="w-full">
              <Link to={returnTo !== '/login' ? returnTo : '/account'}>Tiếp tục</Link>
            </Button>
          </div>
        ) : (
          <form onSubmit={(e) => void handleSubmit(onSubmit)(e)} className="space-y-4" noValidate>
            {serverError ? (
              <div
                role="alert"
                className="rounded-md border border-brand-red-border bg-brand-red-soft px-3.5 py-2.5 text-sm font-medium text-brand-red"
              >
                {serverError}
              </div>
            ) : null}

            <FormField label="Email" required error={errors.email?.message}>
              {(props) => (
                <Input
                  {...props}
                  type="email"
                  autoComplete="email"
                  placeholder="khachhang@example.com"
                  error={errors.email?.message}
                  {...register('email')}
                />
              )}
            </FormField>

            <FormField label="Mật khẩu" required error={errors.password?.message}>
              {(props) => (
                <Input
                  {...props}
                  type="password"
                  autoComplete="current-password"
                  placeholder="••••••••••••"
                  error={errors.password?.message}
                  {...register('password')}
                />
              )}
            </FormField>

            <Button type="submit" variant="brand" className="w-full" disabled={isSubmitting}>
              {isSubmitting ? 'Đang đăng nhập…' : 'Đăng nhập'}
            </Button>
          </form>
        )}

        <p className="text-center text-sm text-muted-foreground">
          Chưa có tài khoản?{' '}
          <Link
            to={returnTo !== '/' ? `/register?return_to=${encodeURIComponent(returnTo)}` : '/register'}
            className="font-medium text-brand-red hover:underline"
          >
            Đăng ký khách hàng
          </Link>
        </p>
      </section>
    </div>
  );
}

export function RegisterPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { toast } = useToast();
  const returnTo = sanitizeReturnTo(searchParams.get('return_to'));
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<RegisterFormValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: { full_name: '', email: '', phone: '', password: '' },
  });

  async function onSubmit(values: RegisterFormValues) {
    setServerError(null);
    try {
      await registerCustomerApi({
        full_name: values.full_name.trim(),
        email: values.email.trim(),
        password: values.password,
        phone: values.phone.trim() || null,
      });
      toast({ title: 'Đăng ký thành công', description: 'Vui lòng đăng nhập để mua sắm.', variant: 'success' });
      navigate(returnTo !== '/' ? `/login?return_to=${encodeURIComponent(returnTo)}` : '/login', {
        replace: true,
      });
    } catch (err) {
      setServerError(err instanceof ApiClientError ? err.message : 'Đăng ký thất bại. Vui lòng thử lại.');
    }
  }

  return (
    <div className="mx-auto max-w-md space-y-6 py-8 sm:py-12">
      <Breadcrumb items={[{ label: 'Trang chủ', to: '/' }, { label: 'Đăng ký' }]} />

      <section className="space-y-6 rounded-lg border border-border bg-card p-6">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Đăng ký tài khoản khách hàng</h1>
          <p className="text-sm text-muted-foreground">Mọi tài khoản đăng ký mới được cấp quyền CUSTOMER.</p>
        </div>

        <form onSubmit={(e) => void handleSubmit(onSubmit)(e)} className="space-y-4" noValidate>
          {serverError ? (
            <div
              role="alert"
              className="rounded-md border border-brand-red-border bg-brand-red-soft px-3.5 py-2.5 text-sm font-medium text-brand-red"
            >
              {serverError}
            </div>
          ) : null}

          <FormField label="Họ và tên" required error={errors.full_name?.message}>
            {(props) => (
              <Input
                {...props}
                autoComplete="name"
                error={errors.full_name?.message}
                {...register('full_name')}
              />
            )}
          </FormField>

          <FormField label="Email" required error={errors.email?.message}>
            {(props) => (
              <Input
                {...props}
                type="email"
                autoComplete="email"
                error={errors.email?.message}
                {...register('email')}
              />
            )}
          </FormField>

          <FormField label="Số điện thoại" hint="Tùy chọn, 8–15 chữ số." error={errors.phone?.message}>
            {(props) => (
              <Input
                {...props}
                type="tel"
                autoComplete="tel"
                error={errors.phone?.message}
                {...register('phone')}
              />
            )}
          </FormField>

          <FormField label="Mật khẩu" hint="Tối thiểu 12 ký tự." required error={errors.password?.message}>
            {(props) => (
              <Input
                {...props}
                type="password"
                autoComplete="new-password"
                error={errors.password?.message}
                {...register('password')}
              />
            )}
          </FormField>

          <Button type="submit" variant="brand" className="w-full" disabled={isSubmitting}>
            {isSubmitting ? 'Đang tạo tài khoản…' : 'Đăng ký'}
          </Button>
        </form>

        <p className="text-center text-sm text-muted-foreground">
          Đã có tài khoản?{' '}
          <Link to="/login" className="font-medium text-brand-red hover:underline">
            Đăng nhập
          </Link>
        </p>
      </section>
    </div>
  );
}

export function AccountPage() {
  const { user, token } = useAuth();

  const meQuery = useQuery({
    queryKey: ['auth', 'me', user?.id],
    queryFn: () => {
      if (!token) throw new ApiClientError(401, 'INVALID_TOKEN', 'Vui lòng đăng nhập.');
      return fetchMeApi(token);
    },
    enabled: Boolean(token),
    staleTime: 30_000,
    retry: false,
  });

  const profile = meQuery.data?.data ?? user;

  return (
    <AccountLayout
      title="Thông tin tài khoản"
      description="Thông tin hồ sơ được đọc trực tiếp từ phiên xác thực hiện hành."
      breadcrumbs={[{ label: 'Trang chủ', to: '/' }, { label: 'Tài khoản' }]}
    >
      {meQuery.isPending && !profile ? (
        <Skeleton className="h-48 w-full rounded-lg" />
      ) : meQuery.isError && !profile ? (
        <ErrorState message="Không thể tải thông tin tài khoản." onRetry={() => void meQuery.refetch()} />
      ) : profile ? (
        <section className="space-y-5 rounded-lg border border-border bg-card p-6">
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-4">
            <div className="flex items-center gap-3">
              <div className="flex size-11 items-center justify-center rounded-full bg-surface text-foreground">
                <UserCheck className="size-5" aria-hidden="true" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-foreground">{profile.full_name}</h2>
                <p className="text-sm text-muted-foreground">{profile.email}</p>
              </div>
            </div>
            <Badge variant={profile.role === 'CUSTOMER' ? 'neutral' : 'red-soft'}>{profile.role}</Badge>
          </div>

          <dl className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground">Số điện thoại</dt>
              <dd className="font-medium text-foreground">{profile.phone || 'Chưa cập nhật'}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Trạng thái tài khoản</dt>
              <dd className="font-medium text-foreground">{profile.is_active ? 'Đang hoạt động' : 'Ngưng kích hoạt'}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Ngày tham gia</dt>
              <dd className="font-medium text-foreground">
                {new Date(profile.created_at).toLocaleDateString('vi-VN')}
              </dd>
            </div>
          </dl>

          {profile.role !== 'CUSTOMER' ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-surface p-3 text-xs text-muted-foreground">
              <span>
                Tài khoản nhân viên ({profile.role}) không kế thừa giỏ hàng hoặc lịch sử mua cá nhân của CUSTOMER.
              </span>
              <Button asChild size="sm" variant="brand">
                <Link to="/admin">Vào Back-Office (/admin)</Link>
              </Button>
            </div>
          ) : null}
        </section>
      ) : null}
    </AccountLayout>
  );
}

export function ForbiddenPage() {
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
