const vndFormatter = new Intl.NumberFormat('vi-VN', {
  maximumFractionDigits: 0,
});

export function formatVnd(decimalString: string | number): string {
  const num = typeof decimalString === 'number' ? decimalString : Number(decimalString);
  if (!Number.isFinite(num)) return '0 ₫';
  return `${vndFormatter.format(Math.round(num))} ₫`;
}

export function computeDiscountPercent(
  price: string | number,
  listPrice: string | number | null | undefined,
): number {
  if (listPrice === null || listPrice === undefined) return 0;
  const p = Number(price);
  const l = Number(listPrice);
  if (!Number.isFinite(p) || !Number.isFinite(l) || l <= 0 || p >= l) return 0;
  const pct = Math.round(((l - p) / l) * 100);
  return Math.min(99, Math.max(1, pct));
}

export interface CatalogFilterValue {
  categoryId: string;
  brandId: string;
  productType: string;
  minPrice: string;
  maxPrice: string;
  inStock: boolean;
  sort: 'newest' | 'price_asc' | 'price_desc' | 'name_asc';
}

export function countActiveFilters(v: CatalogFilterValue): number {
  let count = 0;
  if (v.categoryId) count += 1;
  if (v.brandId) count += 1;
  if (v.productType) count += 1;
  if (v.minPrice) count += 1;
  if (v.maxPrice) count += 1;
  if (v.inStock) count += 1;
  return count;
}
