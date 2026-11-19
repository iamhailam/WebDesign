import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Minus, Package, Plus, ShoppingBag } from 'lucide-react';
import {
  ApiClientError,
  addCartItemApi,
  fetchProductBySlug,
  fetchPublicProducts,
  type ProductVariantDto,
} from '@/lib/api';
import { useAuth } from '@/lib/auth-store';
import { computeDiscountPercent } from '@/lib/commerce-utils';
import { usePageTitle } from '@/lib/use-page-title';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/use-toast';
import { Breadcrumb } from '@/components/commerce/breadcrumb';
import { DiscountBadge } from '@/components/commerce/discount-badge';
import { ErrorState } from '@/components/commerce/error-state';
import { PriceDisplay } from '@/components/commerce/price-display';
import { ProductCard } from '@/components/commerce/product-card';

const COLOR_SWATCH_HEX: Readonly<Record<string, string>> = {
  black: '#171717',
  white: '#ffffff',
  red: '#b91c1c',
  burgundy: '#7f1d1d',
  navy: '#1e3a8a',
  blue: '#2563eb',
  silver: '#d4d4d8',
  gold: '#d97706',
  brown: '#78350f',
  beige: '#e7e5e4',
  cream: '#fef3c7',
  green: '#166534',
};

export function ProductDetailPage() {
  const { slug = '' } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const { user, token } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const detailQuery = useQuery({
    queryKey: ['public', 'product-detail', slug],
    queryFn: () => fetchProductBySlug(slug),
    enabled: Boolean(slug),
    staleTime: 30_000,
    retry: false,
  });

  const product = detailQuery.data?.data;
  usePageTitle(product ? `${product.name} — ${product.brand.name}` : 'Chi tiết sản phẩm');

  const relatedQuery = useQuery({
    queryKey: ['public', 'products', 'related', product?.category.id],
    queryFn: () => fetchPublicProducts({ category_id: product?.category.id, page: 1, page_size: 5 }),
    enabled: Boolean(product?.category.id),
    staleTime: 30_000,
    retry: false,
  });

  const [manualSelection, setManualSelection] = useState<Record<number, number>>({});
  const [selectedImageId, setSelectedImageId] = useState<number | null>(null);
  const [failedImages, setFailedImages] = useState<Record<number, boolean>>({});
  const [quantity, setQuantity] = useState(1);
  const [cartFeedback, setCartFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Derive active option axes actually used by variants of this product
  const activeAxes = useMemo(() => {
    if (!product) return [];
    const usedValueIdsByAttr = new Map<number, Set<number>>();
    for (const v of product.variants) {
      for (const opt of v.options) {
        const set = usedValueIdsByAttr.get(opt.attribute_id) ?? new Set<number>();
        set.add(opt.value_id);
        usedValueIdsByAttr.set(opt.attribute_id, set);
      }
    }
    return product.option_schema
      .map((axis) => {
        const usedIds = usedValueIdsByAttr.get(axis.attribute_id);
        if (!usedIds || usedIds.size === 0) return null;
        return {
          ...axis,
          values: axis.values.filter((val) => usedIds.has(val.id)),
        };
      })
      .filter((axis): axis is NonNullable<typeof axis> => axis !== null && axis.values.length > 0);
  }, [product]);

  // Auto-select single-option axes only; keep multi-option axes explicit per UI_DESIGN_SPEC §6
  const effectiveSelection = useMemo(() => {
    const resolved: Record<number, number> = { ...manualSelection };
    for (const axis of activeAxes) {
      if (resolved[axis.attribute_id] === undefined && axis.values.length === 1) {
        resolved[axis.attribute_id] = axis.values[0]!.id;
      }
    }
    return resolved;
  }, [activeAxes, manualSelection]);

  const missingAxes = useMemo(
    () => activeAxes.filter((axis) => effectiveSelection[axis.attribute_id] === undefined),
    [activeAxes, effectiveSelection],
  );

  const selectedVariant: ProductVariantDto | null = useMemo(() => {
    if (!product || product.variants.length === 0) return null;
    if (activeAxes.length === 0) return product.variants[0] ?? null;
    if (missingAxes.length > 0) return null;

    return (
      product.variants.find((variant) =>
        activeAxes.every((axis) => {
          const chosenVal = effectiveSelection[axis.attribute_id];
          return variant.options.some((o) => o.attribute_id === axis.attribute_id && o.value_id === chosenVal);
        }),
      ) ?? null
    );
  }, [product, activeAxes, missingAxes.length, effectiveSelection]);

  function isOptionCompatible(attrId: number, valId: number): boolean {
    if (!product) return false;
    return product.variants.some((variant) => {
      if (!variant.options.some((o) => o.attribute_id === attrId && o.value_id === valId)) {
        return false;
      }
      return Object.entries(effectiveSelection).every(([otherAttrStr, otherValId]) => {
        const otherAttrId = Number(otherAttrStr);
        if (otherAttrId === attrId) return true;
        return variant.options.some((o) => o.attribute_id === otherAttrId && o.value_id === otherValId);
      });
    });
  }

  // Prioritize selected variant's gallery images before general product gallery
  const galleryImages = useMemo(() => {
    if (!product) return [];
    const variantImgs = selectedVariant?.images ?? [];
    const productImgs = product.images.filter((i) => i.variant_id === null);
    const merged = [...variantImgs, ...productImgs];
    if (merged.length > 0) return merged;
    return product.images;
  }, [product, selectedVariant]);

  const activeImage =
    galleryImages.find((img) => img.id === selectedImageId) ??
    galleryImages.find((img) => img.is_primary) ??
    galleryImages[0] ??
    null;

  const maxOrderQty = selectedVariant ? Math.min(999, Math.max(0, selectedVariant.stock_quantity)) : 1;
  const clampedQuantity = selectedVariant && maxOrderQty > 0 ? Math.min(Math.max(1, quantity), maxOrderQty) : 1;

  const addCartMutation = useMutation({
    mutationFn: async (input: { variant_id: number; quantity: number }) => {
      if (!token) throw new ApiClientError(401, 'INVALID_TOKEN', 'Vui lòng đăng nhập.');
      return addCartItemApi(token, input);
    },
    onSuccess: (res) => {
      queryClient.setQueryData(['cart', user?.id], res);
      setCartFeedback({
        type: 'success',
        message: 'Đã thêm sản phẩm vào giỏ hàng.',
      });
      toast({
        title: 'Đã thêm vào giỏ hàng',
        description: `${product?.name ?? ''} (${selectedVariant?.sku ?? ''}) × ${clampedQuantity}`,
        variant: 'success',
      });
    },
    onError: (err) => {
      const msg = err instanceof ApiClientError ? err.message : 'Không thể thêm vào giỏ hàng. Vui lòng thử lại.';
      setCartFeedback({ type: 'error', message: msg });
      toast({ title: 'Không thể thêm vào giỏ', description: msg, variant: 'error' });
    },
  });

  function handleAddToCart() {
    setCartFeedback(null);
    if (!product) return;

    if (!user || !token) {
      navigate(`/login?return_to=${encodeURIComponent(`/products/${product.slug}`)}`);
      return;
    }
    if (user.role !== 'CUSTOMER') return;
    if (!selectedVariant || selectedVariant.stock_quantity <= 0) return;

    addCartMutation.mutate({ variant_id: selectedVariant.id, quantity: clampedQuantity });
  }

  if (detailQuery.isPending) {
    return (
      <div className="space-y-8 py-6">
        <Skeleton className="h-6 w-64" />
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-12">
          <div className="lg:col-span-7">
            <Skeleton className="aspect-square w-full rounded-lg" />
          </div>
          <div className="space-y-4 lg:col-span-5">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-9 w-3/4" />
            <Skeleton className="h-8 w-44" />
            <Skeleton className="h-28 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        </div>
      </div>
    );
  }

  if (detailQuery.isError || !product) {
    return (
      <div className="py-10">
        <ErrorState
          title="Không tìm thấy sản phẩm"
          message="Sản phẩm này không tồn tại hoặc hiện đã ngừng kinh doanh."
          action={
            <Button asChild variant="outline">
              <Link to="/products">Quay lại Catalog</Link>
            </Button>
          }
        />
      </div>
    );
  }

  const relatedProducts = (relatedQuery.data?.data.items ?? []).filter((p) => p.id !== product.id).slice(0, 4);
  const discountPct = selectedVariant
    ? computeDiscountPercent(selectedVariant.price, selectedVariant.list_price)
    : 0;

  return (
    <div className="space-y-12 pb-12">
      <Breadcrumb
        items={[
          { label: 'Trang chủ', to: '/' },
          { label: product.category.name, to: `/categories/${product.category.slug}` },
          { label: product.name },
        ]}
      />

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-12">
        {/* Left column (~55% desktop): Image gallery */}
        <section aria-label="Thư viện ảnh sản phẩm" className="space-y-3 lg:col-span-7">
          <div className="relative aspect-square w-full overflow-hidden rounded-lg border border-border bg-surface p-4">
            {activeImage && !failedImages[activeImage.id] ? (
              <img
                src={activeImage.asset_path}
                alt={activeImage.alt_text}
                onError={() => setFailedImages((prev) => ({ ...prev, [activeImage.id]: true }))}
                className="h-full w-full object-contain"
              />
            ) : (
              <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-muted-foreground">
                <Package className="size-12 stroke-[1.5]" aria-hidden="true" />
                <span className="text-sm">Chưa có hình ảnh khả dụng</span>
              </div>
            )}

            {discountPct > 0 ? (
              <div className="absolute top-3 right-3">
                <DiscountBadge percent={discountPct} />
              </div>
            ) : null}
          </div>

          {galleryImages.length > 1 ? (
            <div className="flex flex-wrap gap-2.5" role="list" aria-label="Chọn ảnh xem trước">
              {galleryImages.map((img) => {
                const isSelected = activeImage?.id === img.id;
                return (
                  <button
                    key={img.id}
                    type="button"
                    aria-label={img.alt_text}
                    aria-current={isSelected ? 'true' : undefined}
                    onClick={() => setSelectedImageId(img.id)}
                    className={`size-18 overflow-hidden rounded-md border bg-surface p-1 transition-colors ${
                      isSelected ? 'border-brand-red ring-2 ring-brand-red/20' : 'border-border hover:border-border-strong'
                    }`}
                  >
                    {!failedImages[img.id] ? (
                      <img
                        src={img.asset_path}
                        alt=""
                        onError={() => setFailedImages((prev) => ({ ...prev, [img.id]: true }))}
                        className="h-full w-full object-contain"
                      />
                    ) : (
                      <span className="text-[10px] text-muted-foreground">Ảnh</span>
                    )}
                  </button>
                );
              })}
            </div>
          ) : null}
        </section>

        {/* Right column (~45% desktop): Info, SKU selector, stock, Add to Cart */}
        <section aria-label="Thông tin và tùy chọn mua hàng" className="space-y-6 lg:col-span-5">
          <div className="space-y-2 border-b border-border pb-4">
            <Link
              to={`/brands/${product.brand.slug}`}
              className="inline-block text-xs font-semibold uppercase tracking-widest text-muted-foreground hover:text-brand-red"
            >
              {product.brand.name}
            </Link>
            <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">{product.name}</h1>

            {selectedVariant ? (
              <div className="flex flex-wrap items-center gap-3 pt-1">
                <PriceDisplay price={selectedVariant.price} listPrice={selectedVariant.list_price} size="lg" />
                {discountPct > 0 ? <DiscountBadge percent={discountPct} /> : null}
              </div>
            ) : (
              <div className="pt-1">
                <PriceDisplay priceMin={product.price_min} priceMax={product.price_max} size="lg" />
              </div>
            )}
          </div>

          {/* 6-type SKU variant options */}
          {activeAxes.length > 0 ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-foreground">Chọn phân loại</h2>
                {Object.keys(manualSelection).length > 0 ? (
                  <button
                    type="button"
                    onClick={() => {
                      setManualSelection({});
                      setSelectedImageId(null);
                      setCartFeedback(null);
                    }}
                    className="text-xs font-medium text-brand-red hover:underline"
                  >
                    Đặt lại tùy chọn
                  </button>
                ) : null}
              </div>

              {activeAxes.map((axis) => {
                const chosenValueId = effectiveSelection[axis.attribute_id];
                const isColorAxis = axis.code === 'color' || axis.code === 'strap_color';

                return (
                  <div key={axis.attribute_id} className="space-y-2">
                    <span className="block text-sm font-medium text-foreground">{axis.label}</span>
                    <div
                      role="radiogroup"
                      aria-label={axis.label}
                      className="flex flex-wrap gap-2"
                    >
                      {axis.values.map((val) => {
                        const checked = chosenValueId === val.id;
                        const compatible = isOptionCompatible(axis.attribute_id, val.id);
                        const swatchHex = isColorAxis ? COLOR_SWATCH_HEX[val.code] : undefined;

                        return (
                          <button
                            key={val.id}
                            type="button"
                            role="radio"
                            aria-checked={checked}
                            disabled={!compatible}
                            title={!compatible ? 'Không có tổ hợp này' : val.label}
                            onClick={() => {
                              setManualSelection((prev) => {
                                const next = { ...prev };
                                if (checked && axis.values.length > 1) {
                                  delete next[axis.attribute_id];
                                } else {
                                  next[axis.attribute_id] = val.id;
                                }
                                return next;
                              });
                              setSelectedImageId(null);
                              setQuantity(1);
                              setCartFeedback(null);
                            }}
                            className={`inline-flex min-h-11 items-center gap-2 rounded-full border px-4 py-1.5 text-sm font-medium transition-colors ${
                              checked
                                ? 'border-brand-red bg-brand-red-soft text-brand-red ring-1 ring-brand-red'
                                : compatible
                                  ? 'border-border-strong bg-background text-foreground hover:border-foreground'
                                  : 'cursor-not-allowed border-border bg-surface text-muted-foreground/50 line-through'
                            }`}
                          >
                            {swatchHex ? (
                              <span
                                aria-hidden="true"
                                className="size-3.5 shrink-0 rounded-full border border-neutral-300"
                                style={{ backgroundColor: swatchHex }}
                              />
                            ) : null}
                            <span>{val.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : null}

          {/* Selected SKU metadata + stock status */}
          <div className="rounded-lg border border-border bg-surface-elevated p-4 text-sm">
            {missingAxes.length > 0 ? (
              <p className="font-medium text-muted-foreground">
                Chọn {missingAxes.map((a) => a.label.toLowerCase()).join(' và ')} để xem mã SKU và tồn kho chính xác.
              </p>
            ) : selectedVariant ? (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="space-y-0.5">
                  <p className="text-xs text-muted-foreground">Mã SKU</p>
                  <p className="font-mono text-sm font-semibold text-foreground">{selectedVariant.sku}</p>
                </div>
                {selectedVariant.stock_quantity > 0 ? (
                  <Badge variant="success">Còn {selectedVariant.stock_quantity} sản phẩm</Badge>
                ) : (
                  <Badge variant="red-soft">Hết hàng</Badge>
                )}
              </div>
            ) : (
              <p className="font-medium text-brand-red">Không có tổ hợp biến thể phù hợp.</p>
            )}
          </div>

          {/* Quantity & Add to cart CTA */}
          {user && user.role !== 'CUSTOMER' ? (
            <div className="rounded-md border border-border bg-surface px-4 py-3 text-sm text-muted-foreground">
              Tài khoản nhân viên ({user.role}) không dùng tính năng thêm vào giỏ hàng.
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center rounded-md border border-border-strong bg-background">
                  <button
                    type="button"
                    aria-label="Giảm số lượng"
                    disabled={!selectedVariant || selectedVariant.stock_quantity <= 0 || clampedQuantity <= 1}
                    onClick={() => setQuantity(Math.max(1, clampedQuantity - 1))}
                    className="inline-flex min-h-11 min-w-11 items-center justify-center text-foreground hover:bg-surface disabled:opacity-40"
                  >
                    <Minus className="size-4" aria-hidden="true" />
                  </button>
                  <label htmlFor="pdp-qty" className="sr-only">
                    Số lượng
                  </label>
                  <input
                    id="pdp-qty"
                    type="number"
                    min={1}
                    max={Math.max(1, maxOrderQty)}
                    disabled={!selectedVariant || selectedVariant.stock_quantity <= 0}
                    value={clampedQuantity}
                    onChange={(e) => {
                      const val = Number(e.target.value);
                      if (!Number.isFinite(val)) return;
                      setQuantity(Math.max(1, Math.min(maxOrderQty || 1, Math.floor(val))));
                    }}
                    className="min-h-11 w-14 border-x border-border bg-transparent text-center text-sm font-medium text-foreground outline-none tabular-nums-vnd"
                  />
                  <button
                    type="button"
                    aria-label="Tăng số lượng"
                    disabled={!selectedVariant || selectedVariant.stock_quantity <= 0 || clampedQuantity >= maxOrderQty}
                    onClick={() => setQuantity(Math.min(maxOrderQty, clampedQuantity + 1))}
                    className="inline-flex min-h-11 min-w-11 items-center justify-center text-foreground hover:bg-surface disabled:opacity-40"
                  >
                    <Plus className="size-4" aria-hidden="true" />
                  </button>
                </div>

                <Button
                  variant="brand"
                  size="lg"
                  className="flex-1"
                  disabled={
                    addCartMutation.isPending ||
                    (Boolean(user) && (!selectedVariant || selectedVariant.stock_quantity <= 0))
                  }
                  onClick={handleAddToCart}
                >
                  <ShoppingBag aria-hidden="true" />
                  <span>
                    {addCartMutation.isPending
                      ? 'Đang thêm…'
                      : !user
                        ? 'Đăng nhập để thêm vào giỏ'
                        : selectedVariant && selectedVariant.stock_quantity <= 0
                          ? 'Hết hàng'
                          : 'Thêm vào giỏ hàng'}
                  </span>
                </Button>
              </div>

              {cartFeedback ? (
                <div
                  role={cartFeedback.type === 'error' ? 'alert' : 'status'}
                  className={`flex flex-wrap items-center justify-between gap-2 rounded-md border px-3.5 py-2.5 text-sm ${
                    cartFeedback.type === 'success'
                      ? 'border-success/30 bg-success-soft text-success'
                      : 'border-brand-red-border bg-brand-red-soft text-brand-red'
                  }`}
                >
                  <span className="flex items-center gap-2 font-medium">
                    {cartFeedback.type === 'success' ? <CheckCircle2 className="size-4" aria-hidden="true" /> : null}
                    {cartFeedback.message}
                  </span>
                  {cartFeedback.type === 'success' ? (
                    <Link to="/cart" className="font-semibold underline underline-offset-4">
                      Xem giỏ hàng
                    </Link>
                  ) : null}
                </div>
              ) : null}
            </div>
          )}

          {/* Product description (plain text only) */}
          {product.description ? (
            <div className="space-y-2 border-t border-border pt-4">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground">Mô tả sản phẩm</h2>
              <p className="whitespace-pre-line text-sm leading-relaxed text-muted-foreground">{product.description}</p>
            </div>
          ) : null}
        </section>
      </div>

      {/* Related Products */}
      {relatedProducts.length > 0 ? (
        <section aria-labelledby="related-products-heading" className="space-y-4 border-t border-border pt-8">
          <div className="flex items-center justify-between gap-4">
            <h2 id="related-products-heading" className="text-xl font-semibold tracking-tight text-foreground">
              Sản phẩm cùng danh mục
            </h2>
            <Link to={`/categories/${product.category.slug}`} className="text-sm font-medium text-brand-red hover:underline">
              Xem thêm
            </Link>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-4">
            {relatedProducts.map((rel) => (
              <ProductCard key={rel.id} product={rel} />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
