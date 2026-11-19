import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowRight, Minus, Package, Plus, Trash2 } from 'lucide-react';
import { ApiClientError, fetchCartApi, removeCartItemApi, updateCartItemApi } from '@/lib/api';
import { useAuth } from '@/lib/auth-store';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/use-toast';
import { Breadcrumb } from '@/components/commerce/breadcrumb';
import { EmptyState } from '@/components/commerce/empty-state';
import { ErrorState } from '@/components/commerce/error-state';
import { PriceDisplay } from '@/components/commerce/price-display';
import { ForbiddenPage } from '@/pages/auth';

export function CartPage() {
  const { user, token } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [mutationError, setMutationError] = useState<string | null>(null);

  const cartQuery = useQuery({
    queryKey: ['cart', user?.id],
    queryFn: () => {
      if (!token) throw new ApiClientError(401, 'INVALID_TOKEN', 'Vui lòng đăng nhập.');
      return fetchCartApi(token);
    },
    enabled: Boolean(token && user?.role === 'CUSTOMER'),
    staleTime: 10_000,
    retry: false,
  });

  const updateMutation = useMutation({
    mutationFn: ({ variantId, quantity }: { variantId: number; quantity: number }) => {
      if (!token) throw new ApiClientError(401, 'INVALID_TOKEN', 'Vui lòng đăng nhập.');
      return updateCartItemApi(token, variantId, quantity);
    },
    onSuccess: (res) => {
      setMutationError(null);
      queryClient.setQueryData(['cart', user?.id], res);
    },
    onError: (err) => {
      const msg = err instanceof ApiClientError ? err.message : 'Không thể cập nhật số lượng.';
      setMutationError(msg);
      toast({ title: 'Cập nhật giỏ hàng thất bại', description: msg, variant: 'error' });
    },
  });

  const removeMutation = useMutation({
    mutationFn: (variantId: number) => {
      if (!token) throw new ApiClientError(401, 'INVALID_TOKEN', 'Vui lòng đăng nhập.');
      return removeCartItemApi(token, variantId);
    },
    onSuccess: (res) => {
      setMutationError(null);
      queryClient.setQueryData(['cart', user?.id], res);
      toast({ title: 'Đã xóa sản phẩm khỏi giỏ', variant: 'default' });
    },
    onError: (err) => {
      const msg = err instanceof ApiClientError ? err.message : 'Không thể xóa sản phẩm khỏi giỏ.';
      setMutationError(msg);
      toast({ title: 'Xóa sản phẩm thất bại', description: msg, variant: 'error' });
    },
  });

  if (!user || !token) {
    return (
      <div className="mx-auto max-w-lg space-y-4 py-12 text-center">
        <h1 className="text-2xl font-bold text-foreground">Đăng nhập để xem giỏ hàng</h1>
        <p className="text-sm text-muted-foreground">Giỏ hàng được lưu theo tài khoản khách hàng trên máy chủ.</p>
        <Button asChild variant="brand">
          <Link to="/login?return_to=/cart">Đăng nhập</Link>
        </Button>
      </div>
    );
  }

  if (user.role !== 'CUSTOMER') {
    return <ForbiddenPage />;
  }

  const cart = cartQuery.data?.data;
  const hasBlockingIssues = Boolean(cart?.has_stock_issues || cart?.has_unavailable_items);
  const isMutating = updateMutation.isPending || removeMutation.isPending;

  return (
    <div className="space-y-6 pb-12">
      <Breadcrumb items={[{ label: 'Trang chủ', to: '/' }, { label: 'Giỏ hàng' }]} />

      <header className="flex flex-wrap items-end justify-between gap-3 border-b border-border pb-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">Giỏ hàng của bạn</h1>
          <p className="text-sm text-muted-foreground">
            Giá và tồn kho luôn được đối chiếu trực tiếp từ hệ thống. Giỏ hàng không giữ chỗ tồn kho.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void cartQuery.refetch()} disabled={cartQuery.isFetching}>
          Làm mới giá &amp; tồn
        </Button>
      </header>

      {mutationError ? (
        <div
          role="alert"
          className="rounded-md border border-brand-red-border bg-brand-red-soft px-4 py-3 text-sm font-medium text-brand-red"
        >
          {mutationError}
        </div>
      ) : null}

      {cartQuery.isPending ? (
        <div className="space-y-3" role="status" aria-busy="true">
          <Skeleton className="h-28 w-full rounded-lg" />
          <Skeleton className="h-28 w-full rounded-lg" />
        </div>
      ) : cartQuery.isError || !cart ? (
        <ErrorState message="Không thể tải giỏ hàng lúc này." onRetry={() => void cartQuery.refetch()} />
      ) : cart.items.length === 0 ? (
        <EmptyState
          variant="cart"
          title="Giỏ hàng đang trống"
          description="Hãy chọn sản phẩm phù hợp từ danh mục cửa hàng."
          action={
            <Button asChild variant="brand">
              <Link to="/products">Khám phá sản phẩm</Link>
            </Button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-12">
          <section aria-label="Danh sách sản phẩm trong giỏ" className="space-y-4 lg:col-span-8">
            {cart.items.map((item) => {
              const isOos = item.issue_code === 'OUT_OF_STOCK' || item.quantity > item.stock_quantity;
              const isUnavailable = item.issue_code === 'ITEM_UNAVAILABLE' || !item.available;
              const maxAllowed = item.stock_quantity > 0 ? Math.min(999, item.stock_quantity) : item.quantity;

              return (
                <article
                  key={item.variant_id}
                  className={`flex flex-col gap-4 rounded-lg border bg-card p-4 sm:flex-row sm:items-center ${
                    isOos || isUnavailable ? 'border-brand-red bg-brand-red-soft/20' : 'border-border'
                  }`}
                >
                  <Link
                    to={`/products/${item.product_slug}`}
                    className="size-24 shrink-0 overflow-hidden rounded-md border border-border bg-surface p-2"
                  >
                    {item.image_url ? (
                      <img src={item.image_url} alt={item.product_name} className="h-full w-full object-contain" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                        <Package className="size-6" aria-hidden="true" />
                      </div>
                    )}
                  </Link>

                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0 space-y-0.5">
                        <Link
                          to={`/products/${item.product_slug}`}
                          className="line-clamp-2 text-base font-semibold text-foreground hover:text-brand-red"
                        >
                          {item.product_name}
                        </Link>
                        <p className="font-mono text-xs text-muted-foreground">SKU: {item.sku}</p>
                      </div>
                      <PriceDisplay price={item.unit_price} listPrice={item.list_price} size="sm" />
                    </div>

                    {item.options.length > 0 ? (
                      <div className="flex flex-wrap gap-1.5">
                        {item.options.map((opt) => (
                          <Badge key={opt.attribute_id} variant="neutral">
                            {opt.label}: {opt.value_label}
                          </Badge>
                        ))}
                      </div>
                    ) : null}

                    {isUnavailable ? (
                      <p role="alert" className="flex items-center gap-1.5 text-xs font-semibold text-brand-red">
                        <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
                        <span>Sản phẩm hoặc biến thể này đã ngừng kinh doanh. Vui lòng xóa khỏi giỏ hàng.</span>
                      </p>
                    ) : isOos ? (
                      <p role="alert" className="flex items-center gap-1.5 text-xs font-semibold text-brand-red">
                        <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
                        <span>
                          Số lượng vượt tồn kho hiện tại (tồn khả dụng: {item.stock_quantity}). Vui lòng giảm số lượng hoặc xóa.
                        </span>
                      </p>
                    ) : null}

                    <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                      <div className="flex items-center rounded-md border border-border-strong bg-background">
                        <button
                          type="button"
                          aria-label={`Giảm số lượng ${item.sku}`}
                          disabled={isMutating || item.quantity <= 1}
                          onClick={() =>
                            updateMutation.mutate({ variantId: item.variant_id, quantity: Math.max(1, item.quantity - 1) })
                          }
                          className="inline-flex min-h-11 min-w-11 items-center justify-center hover:bg-surface disabled:opacity-40"
                        >
                          <Minus className="size-4" aria-hidden="true" />
                        </button>
                        <span className="min-w-10 px-2 text-center text-sm font-medium tabular-nums-vnd">
                          {item.quantity}
                        </span>
                        <button
                          type="button"
                          aria-label={`Tăng số lượng ${item.sku}`}
                          disabled={isMutating || isUnavailable || item.quantity >= maxAllowed}
                          onClick={() =>
                            updateMutation.mutate({
                              variantId: item.variant_id,
                              quantity: Math.min(maxAllowed, item.quantity + 1),
                            })
                          }
                          className="inline-flex min-h-11 min-w-11 items-center justify-center hover:bg-surface disabled:opacity-40"
                        >
                          <Plus className="size-4" aria-hidden="true" />
                        </button>
                      </div>

                      <div className="flex items-center gap-4">
                        <div className="text-right">
                          <span className="block text-[11px] text-muted-foreground">Thành tiền</span>
                          <PriceDisplay price={item.line_amount} size="sm" />
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Xóa ${item.product_name}`}
                          disabled={isMutating}
                          onClick={() => removeMutation.mutate(item.variant_id)}
                          className="text-muted-foreground hover:text-brand-red"
                        >
                          <Trash2 className="size-4" aria-hidden="true" />
                        </Button>
                      </div>
                    </div>
                  </div>
                </article>
              );
            })}
          </section>

          <aside className="lg:col-span-4">
            <div className="sticky top-28 space-y-4 rounded-lg border border-border bg-surface-elevated p-5">
              <h2 className="border-b border-border pb-3 text-base font-semibold text-foreground">Tóm tắt giỏ hàng</h2>

              <div className="flex items-baseline justify-between gap-2">
                <span className="text-sm text-muted-foreground">Tạm tính ({cart.items.length} dòng SKU)</span>
                <PriceDisplay price={cart.subtotal_amount} size="lg" />
              </div>

              {hasBlockingIssues ? (
                <div
                  role="alert"
                  className="rounded-md border border-brand-red-border bg-brand-red-soft p-3 text-xs font-medium text-brand-red"
                >
                  Có sản phẩm vượt tồn kho hoặc đã ngừng bán. Vui lòng điều chỉnh trước khi thanh toán.
                </div>
              ) : null}

              {hasBlockingIssues || isMutating ? (
                <Button variant="brand" size="lg" className="w-full" disabled>
                  <span>Tiến hành đặt hàng COD</span>
                  <ArrowRight aria-hidden="true" />
                </Button>
              ) : (
                <Button asChild variant="brand" size="lg" className="w-full">
                  <Link to="/checkout">
                    <span>Tiến hành đặt hàng COD</span>
                    <ArrowRight aria-hidden="true" />
                  </Link>
                </Button>
              )}

              <Button asChild variant="outline" className="w-full">
                <Link to="/products">Tiếp tục mua sắm</Link>
              </Button>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
