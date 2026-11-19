import { useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, Banknote, CheckCircle2, RefreshCw, Tag, X } from 'lucide-react';
import {
  ApiClientError,
  checkoutOrderApi,
  fetchAvailableVouchersApi,
  fetchCartApi,
  previewVoucherApi,
  type CheckoutPayload,
  type VoucherPreviewDto,
} from '@/lib/api';
import { useAuth } from '@/lib/auth-store';
import { formatVnd } from '@/lib/commerce-utils';
import { usePageTitle } from '@/lib/use-page-title';
import { Button } from '@/components/ui/button';
import { FormField, Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/use-toast';
import { Breadcrumb } from '@/components/commerce/breadcrumb';
import { EmptyState } from '@/components/commerce/empty-state';
import { ErrorState } from '@/components/commerce/error-state';
import { PriceDisplay } from '@/components/commerce/price-display';
import { ForbiddenPage } from '@/components/auth/forbidden-page';

const PHONE_REGEX = /^\+?[0-9]{8,15}$/;

export function CheckoutPage() {
  usePageTitle('Thanh toán COD');
  const { user, token } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [recipientName, setRecipientName] = useState(user?.full_name ?? '');
  const [recipientPhone, setRecipientPhone] = useState(user?.phone ?? '');
  const [shippingAddress, setShippingAddress] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const [voucherInput, setVoucherInput] = useState('');
  const [appliedPreview, setAppliedPreview] = useState<VoucherPreviewDto | null>(null);
  const [voucherError, setVoucherError] = useState<string | null>(null);

  const [checkoutBannerError, setCheckoutBannerError] = useState<{
    code: string;
    message: string;
    canRetrySameKey: boolean;
    needsCartRefresh: boolean;
  } | null>(null);

  const nameRef = useRef<HTMLInputElement>(null);
  const phoneRef = useRef<HTMLInputElement>(null);
  const addressRef = useRef<HTMLInputElement>(null);

  // Hold idempotency key + payload signature in memory for safe network retry without creating duplicate orders
  const attemptRef = useRef<{ key: string; signature: string } | null>(null);

  const cartQuery = useQuery({
    queryKey: ['cart', user?.id],
    queryFn: () => {
      if (!token) throw new ApiClientError(401, 'INVALID_TOKEN', 'Vui lòng đăng nhập.');
      return fetchCartApi(token);
    },
    enabled: Boolean(token && user?.role === 'CUSTOMER'),
    staleTime: 0,
    retry: false,
  });

  const vouchersQuery = useQuery({
    queryKey: ['vouchers', 'available', user?.id],
    queryFn: () => {
      if (!token) throw new ApiClientError(401, 'INVALID_TOKEN', 'Vui lòng đăng nhập.');
      return fetchAvailableVouchersApi(token, 1, 20);
    },
    enabled: Boolean(token && user?.role === 'CUSTOMER'),
    staleTime: 15_000,
    retry: false,
  });

  const cart = cartQuery.data?.data;

  // Discard stale preview automatically whenever server cart.version changes
  const activePreview =
    appliedPreview && cart && appliedPreview.cart_version === cart.version ? appliedPreview : null;

  const previewMutation = useMutation({
    mutationFn: async (code: string) => {
      if (!token || !cart) {
        throw new ApiClientError(400, 'VALIDATION_ERROR', 'Giỏ hàng chưa sẵn sàng.');
      }
      return previewVoucherApi(token, {
        voucher_code: code,
        cart_version: cart.version,
        subtotal: cart.subtotal_amount,
      });
    },
    onSuccess: (res) => {
      setVoucherError(null);
      setCheckoutBannerError(null);
      setAppliedPreview(res.data);
      setVoucherInput(res.data.voucher_code);
      attemptRef.current = null;
      toast({
        title: `Đã áp dụng dự kiến mã ${res.data.voucher_code}`,
        description: `Giảm dự kiến ${formatVnd(res.data.discount_amount)}.`,
        variant: 'success',
      });
    },
    onError: (err) => {
      setAppliedPreview(null);
      if (err instanceof ApiClientError) {
        setVoucherError(err.message);
        if (err.code === 'CART_CHANGED' || err.code === 'PRICE_CHANGED') {
          void cartQuery.refetch();
        }
      } else {
        setVoucherError('Không thể kiểm tra mã giảm giá. Vui lòng thử lại.');
      }
    },
  });

  const checkoutMutation = useMutation({
    mutationFn: async ({
      idempotencyKey,
      payload,
    }: {
      idempotencyKey: string;
      payload: CheckoutPayload;
    }) => {
      if (!token) throw new ApiClientError(401, 'INVALID_TOKEN', 'Vui lòng đăng nhập.');
      return checkoutOrderApi(token, idempotencyKey, payload);
    },
    onSuccess: (res) => {
      attemptRef.current = null;
      queryClient.removeQueries({ queryKey: ['cart'] });
      queryClient.invalidateQueries({ queryKey: ['orders'] }).catch(() => undefined);
      toast({
        title: `Đặt hàng thành công (${res.data.order.order_code})`,
        description: res.data.replayed ? 'Đã xác nhận đơn hàng từ yêu cầu trước đó.' : undefined,
        variant: 'success',
      });
      navigate(`/checkout/success/${res.data.order.id}`, { replace: true });
    },
    onError: (err) => {
      if (err instanceof ApiClientError) {
        if (err.code === 'NETWORK_ERROR' || err.status >= 500) {
          setCheckoutBannerError({
            code: err.code,
            message: 'Không rõ trạng thái kết nối khi đặt hàng. Bạn có thể bấm "Thử lại" để gửi tiếp cùng mã yêu cầu tránh trùng đơn.',
            canRetrySameKey: true,
            needsCartRefresh: false,
          });
          return;
        }
        if (err.code === 'PRICE_CHANGED' || err.code === 'CART_CHANGED') {
          attemptRef.current = null;
          setAppliedPreview(null);
          void cartQuery.refetch();
          setCheckoutBannerError({
            code: err.code,
            message: 'Giá sản phẩm hoặc giỏ hàng đã thay đổi trên máy chủ. Hệ thống vừa làm mới giỏ hàng — vui lòng kiểm tra lại trước khi đặt.',
            canRetrySameKey: false,
            needsCartRefresh: true,
          });
          return;
        }
        if (err.code === 'OUT_OF_STOCK' || err.code === 'ITEM_UNAVAILABLE' || err.code === 'CART_EMPTY') {
          attemptRef.current = null;
          void cartQuery.refetch();
          setCheckoutBannerError({
            code: err.code,
            message: err.message,
            canRetrySameKey: false,
            needsCartRefresh: true,
          });
          return;
        }
        if (
          err.code === 'VOUCHER_INVALID' ||
          err.code === 'VOUCHER_EXHAUSTED' ||
          err.code === 'VOUCHER_ALREADY_USED'
        ) {
          attemptRef.current = null;
          setAppliedPreview(null);
          setVoucherError(err.message);
          setCheckoutBannerError({
            code: err.code,
            message: `${err.message} Vui lòng đổi mã khác hoặc bỏ mã trước khi đặt lại.`,
            canRetrySameKey: false,
            needsCartRefresh: false,
          });
          return;
        }
        attemptRef.current = null;
        setCheckoutBannerError({
          code: err.code,
          message: err.message,
          canRetrySameKey: false,
          needsCartRefresh: false,
        });
        return;
      }

      setCheckoutBannerError({
        code: 'NETWORK_ERROR',
        message: 'Mất kết nối trong lúc xác nhận đơn. Bấm "Thử lại" để xác minh cùng mã yêu cầu.',
        canRetrySameKey: true,
        needsCartRefresh: false,
      });
    },
  });

  if (!user || !token) {
    return (
      <div className="mx-auto max-w-lg space-y-4 py-12 text-center">
        <h1 className="text-2xl font-bold text-foreground">Đăng nhập để thanh toán COD</h1>
        <p className="text-sm text-muted-foreground">Chỉ tài khoản khách hàng đã đăng nhập mới có thể đặt hàng.</p>
        <Button asChild variant="brand">
          <Link to="/login?return_to=/checkout">Đăng nhập</Link>
        </Button>
      </div>
    );
  }

  if (user.role !== 'CUSTOMER') {
    return <ForbiddenPage />;
  }

  function validateForm(): Record<string, string> {
    const errs: Record<string, string> = {};
    const nameTrimmed = recipientName.trim();
    const phoneTrimmed = recipientPhone.trim();
    const addrTrimmed = shippingAddress.trim();

    if (nameTrimmed.length < 1 || nameTrimmed.length > 120) {
      errs.recipient_name = 'Vui lòng nhập tên người nhận (1–120 ký tự).';
    }
    if (!PHONE_REGEX.test(phoneTrimmed)) {
      errs.recipient_phone = 'Số điện thoại phải gồm 8–15 chữ số (cho phép dấu + đầu).';
    }
    if (addrTrimmed.length < 10 || addrTrimmed.length > 500) {
      errs.shipping_address = 'Địa chỉ giao hàng cần tối thiểu 10 ký tự (số nhà, đường, quận/huyện).';
    }
    return errs;
  }

  function submitOrder(reuseExistingAttempt = false) {
    if (!cart || cart.items.length === 0 || cart.has_stock_issues || cart.has_unavailable_items) return;
    if (checkoutMutation.isPending) return;

    const errs = validateForm();
    setFieldErrors(errs);
    if (Object.keys(errs).length > 0) {
      if (errs.recipient_name) nameRef.current?.focus();
      else if (errs.recipient_phone) phoneRef.current?.focus();
      else if (errs.shipping_address) addressRef.current?.focus();
      return;
    }

    const payload: CheckoutPayload = {
      recipient_name: recipientName.trim(),
      recipient_phone: recipientPhone.trim(),
      shipping_address: shippingAddress.trim(),
      voucher_code: activePreview ? activePreview.voucher_code : null,
      cart_version: cart.version,
      expected_items: cart.items.map((item) => ({
        variant_id: item.variant_id,
        quantity: item.quantity,
        unit_price: item.unit_price,
      })),
    };

    const signature = JSON.stringify(payload);
    let key: string;
    if (reuseExistingAttempt && attemptRef.current && attemptRef.current.signature === signature) {
      key = attemptRef.current.key;
    } else {
      key = crypto.randomUUID();
      attemptRef.current = { key, signature };
    }

    setCheckoutBannerError(null);
    checkoutMutation.mutate({ idempotencyKey: key, payload });
  }

  function handleFormSubmit(event: FormEvent) {
    event.preventDefault();
    submitOrder(false);
  }

  const availableVouchers = vouchersQuery.data?.data.items ?? [];
  const hasCartBlocking = Boolean(cart?.has_stock_issues || cart?.has_unavailable_items);
  const errorKeys = Object.entries(fieldErrors);

  return (
    <div className="space-y-6 pb-12">
      <Breadcrumb
        items={[
          { label: 'Trang chủ', to: '/' },
          { label: 'Giỏ hàng', to: '/cart' },
          { label: 'Thanh toán COD' },
        ]}
      />

      <header className="border-b border-border pb-4">
        <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">Xác nhận đặt hàng COD</h1>
        <p className="text-sm text-muted-foreground">
          Tổng thanh toán cuối cùng và tồn kho được kiểm tra nguyên tử bởi PostgreSQL khi bạn xác nhận đặt hàng.
        </p>
      </header>

      {cartQuery.isPending ? (
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-12" role="status" aria-busy="true">
          <Skeleton className="h-80 rounded-lg lg:col-span-7" />
          <Skeleton className="h-80 rounded-lg lg:col-span-5" />
        </div>
      ) : cartQuery.isError || !cart ? (
        <ErrorState message="Không thể tải thông tin giỏ hàng để đặt hàng." onRetry={() => void cartQuery.refetch()} />
      ) : cart.items.length === 0 ? (
        <EmptyState
          variant="cart"
          title="Không có sản phẩm nào để thanh toán"
          description="Giỏ hàng hiện đang trống."
          action={
            <Button asChild variant="brand">
              <Link to="/products">Mua sắm ngay</Link>
            </Button>
          }
        />
      ) : (
        <form onSubmit={handleFormSubmit} noValidate className="grid grid-cols-1 gap-8 lg:grid-cols-12">
          {/* Left column: Recipient + COD + Voucher */}
          <div className="space-y-6 lg:col-span-7">
            {errorKeys.length > 0 ? (
              <div
                role="alert"
                className="rounded-md border border-brand-red-border bg-brand-red-soft p-4 text-sm text-brand-red"
              >
                <p className="font-semibold">Vui lòng kiểm tra lại thông tin giao nhận:</p>
                <ul className="mt-1 list-disc pl-5 text-xs">
                  {errorKeys.map(([k, msg]) => (
                    <li key={k}>{msg}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            {checkoutBannerError ? (
              <div
                role="alert"
                className="space-y-3 rounded-lg border border-brand-red-border bg-brand-red-soft p-4 text-sm text-brand-red"
              >
                <div className="flex items-start gap-2.5">
                  <AlertCircle className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
                  <div className="space-y-1">
                    <p className="font-semibold">
                      Không thể hoàn tất đặt hàng ({checkoutBannerError.code})
                    </p>
                    <p>{checkoutBannerError.message}</p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {checkoutBannerError.canRetrySameKey ? (
                    <Button
                      variant="brand"
                      size="sm"
                      disabled={checkoutMutation.isPending}
                      onClick={() => submitOrder(true)}
                    >
                      <RefreshCw aria-hidden="true" />
                      <span>Thử lại với cùng mã yêu cầu</span>
                    </Button>
                  ) : null}
                  {checkoutBannerError.needsCartRefresh ? (
                    <Button asChild variant="outline" size="sm">
                      <Link to="/cart">Quay lại giỏ hàng</Link>
                    </Button>
                  ) : null}
                </div>
              </div>
            ) : null}

            {/* Shipping details */}
            <section className="space-y-4 rounded-lg border border-border bg-card p-5">
              <h2 className="text-lg font-semibold text-foreground">Thông tin người nhận</h2>

              <FormField label="Tên người nhận" required error={fieldErrors.recipient_name}>
                {(props) => (
                  <Input
                    {...props}
                    ref={nameRef}
                    value={recipientName}
                    error={fieldErrors.recipient_name}
                    placeholder="Nguyễn Văn A"
                    onChange={(e) => setRecipientName(e.target.value)}
                  />
                )}
              </FormField>

              <FormField label="Số điện thoại nhận hàng" required error={fieldErrors.recipient_phone}>
                {(props) => (
                  <Input
                    {...props}
                    ref={phoneRef}
                    type="tel"
                    value={recipientPhone}
                    error={fieldErrors.recipient_phone}
                    placeholder="0901234567"
                    onChange={(e) => setRecipientPhone(e.target.value)}
                  />
                )}
              </FormField>

              <FormField
                label="Địa chỉ giao hàng chi tiết"
                hint="Gồm số nhà, tên đường, phường/xã, quận/huyện, tỉnh/thành phố."
                required
                error={fieldErrors.shipping_address}
              >
                {(props) => (
                  <Input
                    {...props}
                    ref={addressRef}
                    value={shippingAddress}
                    error={fieldErrors.shipping_address}
                    placeholder="123 Nguyễn Huệ, Phường Bến Nghé, Quận 1, TP.HCM"
                    onChange={(e) => setShippingAddress(e.target.value)}
                  />
                )}
              </FormField>
            </section>

            {/* Fixed COD info */}
            <section className="space-y-2 rounded-lg border border-border bg-surface-elevated p-5">
              <div className="flex items-center gap-2.5">
                <Banknote className="size-5 text-brand-red" aria-hidden="true" />
                <h2 className="text-base font-semibold text-foreground">Phương thức thanh toán</h2>
              </div>
              <p className="text-sm text-muted-foreground">
                Thanh toán tiền mặt khi nhận hàng (<strong>COD</strong>). Hệ thống không hỗ trợ thanh toán trực tuyến qua thẻ hoặc ví điện tử.
              </p>
            </section>

            {/* Voucher preview */}
            <section className="space-y-4 rounded-lg border border-border bg-card p-5">
              <div className="flex items-center justify-between gap-2">
                <h2 className="flex items-center gap-2 text-base font-semibold text-foreground">
                  <Tag className="size-4 text-brand-red" aria-hidden="true" />
                  <span>Mã giảm giá (tùy chọn)</span>
                </h2>
                {activePreview ? (
                  <button
                    type="button"
                    onClick={() => {
                      setAppliedPreview(null);
                      setVoucherInput('');
                      setVoucherError(null);
                      attemptRef.current = null;
                    }}
                    className="inline-flex items-center gap-1 text-xs font-medium text-brand-red hover:underline"
                  >
                    <X className="size-3.5" aria-hidden="true" />
                    <span>Bỏ mã</span>
                  </button>
                ) : null}
              </div>

              <div className="flex flex-col gap-2 sm:flex-row">
                <div className="flex-1">
                  <label htmlFor="checkout-voucher-code" className="sr-only">
                    Mã giảm giá
                  </label>
                  <Input
                    id="checkout-voucher-code"
                    value={voucherInput}
                    error={voucherError ?? undefined}
                    placeholder="Nhập mã voucher (ví dụ: SAVE100K)…"
                    onChange={(e) => {
                      setVoucherInput(e.target.value.toUpperCase());
                      setVoucherError(null);
                    }}
                  />
                </div>
                <Button
                  type="button"
                  variant="outline"
                  disabled={!voucherInput.trim() || previewMutation.isPending}
                  onClick={() => previewMutation.mutate(voucherInput.trim().toUpperCase())}
                >
                  {previewMutation.isPending ? 'Đang kiểm tra…' : 'Áp dụng'}
                </Button>
              </div>

              {voucherError ? (
                <p role="alert" className="text-xs font-medium text-brand-red">
                  {voucherError}
                </p>
              ) : null}

              {activePreview ? (
                <div
                  role="status"
                  className="flex items-start gap-2 rounded-md border border-success/30 bg-success-soft p-3 text-xs text-success"
                >
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                  <div>
                    <p className="font-semibold">
                      Mã {activePreview.voucher_code}: giảm dự kiến {formatVnd(activePreview.discount_amount)}
                    </p>
                    <p>Mức giảm dự kiến, kiểm tra lại tự động tại bước xác nhận đặt hàng.</p>
                  </div>
                </div>
              ) : null}

              {availableVouchers.length > 0 ? (
                <div className="space-y-2 border-t border-border pt-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Voucher đang mở ({availableVouchers.length})
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {availableVouchers.map((v) => (
                      <button
                        key={v.id}
                        type="button"
                        disabled={!v.eligible_for_cart || previewMutation.isPending}
                        onClick={() => {
                          setVoucherInput(v.code);
                          previewMutation.mutate(v.code);
                        }}
                        title={v.ineligible_reason ? `Chưa đủ điều kiện: ${v.ineligible_reason}` : `Áp dụng ${v.code}`}
                        className={`rounded-md border px-3 py-1.5 text-left text-xs transition-colors ${
                          v.eligible_for_cart
                            ? 'border-border-strong bg-surface hover:border-brand-red hover:text-brand-red'
                            : 'cursor-not-allowed border-border bg-surface/50 text-muted-foreground opacity-60'
                        }`}
                      >
                        <span className="font-mono font-bold">{v.code}</span>{' '}
                        <span>
                          ({v.discount_type === 'FIXED' ? formatVnd(v.discount_value) : `${v.discount_value}%`})
                        </span>
                        {!v.eligible_for_cart && v.ineligible_reason ? (
                          <span className="block text-[10px] text-muted-foreground">{v.ineligible_reason}</span>
                        ) : null}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </section>
          </div>

          {/* Right column: Summary + Confirm Order */}
          <aside className="lg:col-span-5">
            <div className="sticky top-28 space-y-4 rounded-lg border border-border bg-surface-elevated p-5">
              <h2 className="border-b border-border pb-3 text-base font-semibold text-foreground">
                Tóm tắt đơn hàng ({cart.items.length} SKU)
              </h2>

              <ul className="max-h-64 space-y-3 overflow-y-auto pr-1 text-sm">
                {cart.items.map((item) => (
                  <li key={item.variant_id} className="flex items-start justify-between gap-3 border-b border-border/60 pb-2.5">
                    <div className="min-w-0">
                      <p className="line-clamp-1 font-medium text-foreground">{item.product_name}</p>
                      <p className="font-mono text-xs text-muted-foreground">
                        {item.sku} × {item.quantity}
                      </p>
                    </div>
                    <PriceDisplay price={item.line_amount} size="sm" className="shrink-0" />
                  </li>
                ))}
              </ul>

              <div className="space-y-2 border-t border-border pt-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Tạm tính</span>
                  <span className="font-medium tabular-nums-vnd">{formatVnd(cart.subtotal_amount)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">
                    Giảm giá {activePreview ? `(${activePreview.voucher_code})` : ''}
                  </span>
                  <span className="font-medium text-brand-red tabular-nums-vnd">
                    -{formatVnd(activePreview ? activePreview.discount_amount : '0.00')}
                  </span>
                </div>
                <div className="flex items-baseline justify-between border-t border-border pt-3">
                  <span className="font-semibold text-foreground">Tổng thanh toán COD</span>
                  <PriceDisplay
                    price={activePreview ? activePreview.final_amount : cart.subtotal_amount}
                    size="lg"
                  />
                </div>
              </div>

              {hasCartBlocking ? (
                <div
                  role="alert"
                  className="rounded-md border border-brand-red-border bg-brand-red-soft p-3 text-xs font-medium text-brand-red"
                >
                  Giỏ hàng đang có mặt hàng hết hàng hoặc ngừng bán.{' '}
                  <Link to="/cart" className="underline">
                    Quay lại giỏ hàng
                  </Link>
                </div>
              ) : null}

              <Button
                type="submit"
                variant="brand"
                size="lg"
                className="w-full"
                disabled={checkoutMutation.isPending || hasCartBlocking}
              >
                {checkoutMutation.isPending ? 'Đang xử lý đơn hàng…' : 'Đặt hàng COD'}
              </Button>

              <p className="text-center text-xs text-muted-foreground">
                Bằng cách nhấn Đặt hàng COD, tồn kho và lượt voucher sẽ được kiểm tra đồng thời trên máy chủ.
              </p>
            </div>
          </aside>
        </form>
      )}
    </div>
  );
}
