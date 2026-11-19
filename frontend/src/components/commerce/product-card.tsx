import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Package } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { DiscountBadge } from '@/components/commerce/discount-badge';
import { PriceDisplay } from '@/components/commerce/price-display';

export interface ProductCardItem {
  id: number;
  name: string;
  slug: string;
  brand: { id: number; name: string; slug: string };
  category: { id: number; name: string; slug: string };
  product_type_code: string;
  base_image_url?: string | null | undefined;
  price_min: string;
  price_max: string;
  in_stock: boolean;
  discount_percent?: number | undefined;
}

export interface ProductCardProps {
  product: ProductCardItem;
  className?: string | undefined;
}

export function ProductCard({ product, className }: ProductCardProps) {
  const [imgFailed, setImgFailed] = useState(false);
  const showImage = Boolean(product.base_image_url) && !imgFailed;

  return (
    <article
      data-slot="product-card"
      className={cn(
        'group relative flex h-full flex-col overflow-hidden rounded-lg border border-border bg-card transition-colors hover:border-border-strong',
        className,
      )}
    >
      <Link
        to={`/products/${product.slug}`}
        className="flex flex-1 flex-col outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
        aria-label={`${product.brand.name} - ${product.name}`}
      >
        <div className="relative aspect-square w-full overflow-hidden bg-surface p-3">
          {showImage ? (
            <img
              src={product.base_image_url ?? ''}
              alt={product.name}
              loading="lazy"
              onError={() => setImgFailed(true)}
              className="h-full w-full object-contain transition-transform duration-200 group-hover:scale-[1.03]"
            />
          ) : (
            <div className="flex h-full w-full flex-col items-center justify-center gap-1.5 text-muted-foreground">
              <Package className="size-8 stroke-[1.5]" aria-hidden="true" />
              <span className="text-xs">Chưa có ảnh</span>
            </div>
          )}

          {product.discount_percent && product.discount_percent > 0 ? (
            <div className="absolute top-2.5 right-2.5">
              <DiscountBadge percent={product.discount_percent} />
            </div>
          ) : null}

          {!product.in_stock ? (
            <div className="absolute top-2.5 left-2.5">
              <Badge variant="outline" className="bg-background/95 text-foreground">
                Hết hàng
              </Badge>
            </div>
          ) : null}
        </div>

        <div className="flex flex-1 flex-col justify-between gap-2 p-3.5">
          <div className="space-y-1">
            <p className="truncate text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              {product.brand.name}
            </p>
            <h3
              title={product.name}
              className="line-clamp-2 min-h-[2.5rem] text-sm font-medium leading-5 text-foreground group-hover:text-brand-red"
            >
              {product.name}
            </h3>
          </div>

          <div className="pt-1">
            <PriceDisplay priceMin={product.price_min} priceMax={product.price_max} size="sm" />
          </div>
        </div>
      </Link>
    </article>
  );
}
