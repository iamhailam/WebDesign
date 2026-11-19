import { useState } from 'react';
import { SlidersHorizontal, X } from 'lucide-react';
import { countActiveFilters, type CatalogFilterValue } from '@/lib/commerce-utils';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';

export interface FilterOptionItem {
  value: string;
  label: string;
}

export interface FilterPanelProps {
  value: CatalogFilterValue;
  categories: readonly FilterOptionItem[];
  brands: readonly FilterOptionItem[];
  productTypes: readonly FilterOptionItem[];
  onApply: (next: CatalogFilterValue) => void;
  onReset: () => void;
  className?: string | undefined;
}

function FilterFields({
  draft,
  setDraft,
  categories,
  brands,
  productTypes,
  priceError,
}: {
  draft: CatalogFilterValue;
  setDraft: (next: CatalogFilterValue) => void;
  categories: readonly FilterOptionItem[];
  brands: readonly FilterOptionItem[];
  productTypes: readonly FilterOptionItem[];
  priceError?: string | undefined;
}) {
  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <label htmlFor="filter-category" className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Danh mục
        </label>
        <Select
          id="filter-category"
          value={draft.categoryId}
          onChange={(e) => setDraft({ ...draft, categoryId: e.target.value })}
          options={[{ value: '', label: 'Tất cả danh mục' }, ...categories]}
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="filter-brand" className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Thương hiệu
        </label>
        <Select
          id="filter-brand"
          value={draft.brandId}
          onChange={(e) => setDraft({ ...draft, brandId: e.target.value })}
          options={[{ value: '', label: 'Tất cả thương hiệu' }, ...brands]}
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="filter-type" className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Ngành hàng
        </label>
        <Select
          id="filter-type"
          value={draft.productType}
          onChange={(e) => setDraft({ ...draft, productType: e.target.value })}
          options={[{ value: '', label: 'Tất cả ngành hàng' }, ...productTypes]}
        />
      </div>

      <div className="space-y-2">
        <span className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground">Khoảng giá (VND)</span>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label htmlFor="filter-min-price" className="sr-only">
              Giá tối thiểu
            </label>
            <Input
              id="filter-min-price"
              type="number"
              min={0}
              step={10000}
              inputMode="numeric"
              placeholder="Từ (₫)"
              value={draft.minPrice}
              error={priceError}
              onChange={(e) => setDraft({ ...draft, minPrice: e.target.value })}
            />
          </div>
          <div>
            <label htmlFor="filter-max-price" className="sr-only">
              Giá tối đa
            </label>
            <Input
              id="filter-max-price"
              type="number"
              min={0}
              step={10000}
              inputMode="numeric"
              placeholder="Đến (₫)"
              value={draft.maxPrice}
              error={priceError}
              onChange={(e) => setDraft({ ...draft, maxPrice: e.target.value })}
            />
          </div>
        </div>
        {priceError ? (
          <p role="alert" className="text-xs font-medium text-brand-red">
            {priceError}
          </p>
        ) : null}
      </div>

      <label className="flex min-h-11 cursor-pointer items-center gap-2.5 rounded-md border border-border bg-surface-elevated px-3 py-2 text-sm text-foreground">
        <input
          type="checkbox"
          checked={draft.inStock}
          onChange={(e) => setDraft({ ...draft, inStock: e.target.checked })}
          className="size-4 accent-brand-red"
        />
        <span>Chỉ hiện sản phẩm còn hàng</span>
      </label>

      <div className="space-y-1.5">
        <label htmlFor="filter-sort" className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Sắp xếp
        </label>
        <Select
          id="filter-sort"
          value={draft.sort}
          onChange={(e) => setDraft({ ...draft, sort: e.target.value as CatalogFilterValue['sort'] })}
          options={[
            { value: 'newest', label: 'Mới nhất' },
            { value: 'price_asc', label: 'Giá thấp đến cao' },
            { value: 'price_desc', label: 'Giá cao đến thấp' },
            { value: 'name_asc', label: 'Tên A – Z' },
          ]}
        />
      </div>
    </div>
  );
}

export function FilterPanel({
  value,
  categories,
  brands,
  productTypes,
  onApply,
  onReset,
  className,
}: FilterPanelProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [draft, setDraft] = useState<CatalogFilterValue>(value);
  const activeCount = countActiveFilters(value);

  const minNum = draft.minPrice ? Number(draft.minPrice) : null;
  const maxNum = draft.maxPrice ? Number(draft.maxPrice) : null;
  const priceError =
    minNum !== null && maxNum !== null && Number.isFinite(minNum) && Number.isFinite(maxNum) && minNum > maxNum
      ? 'Giá tối thiểu không được lớn hơn giá tối đa.'
      : undefined;

  function openMobileDrawer() {
    setDraft(value);
    setDrawerOpen(true);
  }

  function handleApply(next: CatalogFilterValue) {
    if (priceError) return;
    onApply(next);
    setDrawerOpen(false);
  }

  return (
    <>
      {/* Mobile drawer trigger */}
      <div className="flex items-center gap-2 lg:hidden">
        <Button variant="outline" onClick={openMobileDrawer} className="gap-2">
          <SlidersHorizontal className="size-4" aria-hidden="true" />
          <span>Bộ lọc</span>
          {activeCount > 0 ? <Badge variant="red">{activeCount}</Badge> : null}
        </Button>
        {activeCount > 0 ? (
          <Button variant="ghost" size="sm" onClick={onReset} className="gap-1 text-muted-foreground">
            <X className="size-3.5" aria-hidden="true" />
            <span>Xóa lọc</span>
          </Button>
        ) : null}
      </div>

      {/* Mobile drawer dialog */}
      <Dialog
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        title="Bộ lọc sản phẩm"
        description="Chọn điều kiện lọc theo biến thể phù hợp."
        size="drawer"
        footer={
          <>
            <Button
              variant="outline"
              onClick={() => {
                onReset();
                setDrawerOpen(false);
              }}
            >
              Xóa bộ lọc
            </Button>
            <Button variant="brand" disabled={Boolean(priceError)} onClick={() => handleApply(draft)}>
              Áp dụng
            </Button>
          </>
        }
      >
        <FilterFields
          draft={draft}
          setDraft={setDraft}
          categories={categories}
          brands={brands}
          productTypes={productTypes}
          priceError={priceError}
        />
      </Dialog>

      {/* Desktop sticky sidebar (240px per UI_DESIGN_SPEC §2) */}
      <aside
        aria-label="Bộ lọc sản phẩm"
        className={cn('hidden w-60 shrink-0 space-y-5 rounded-lg border border-border bg-card p-4 lg:block', className)}
      >
        <div className="flex items-center justify-between border-b border-border pb-3">
          <h2 className="text-sm font-semibold text-foreground">Bộ lọc</h2>
          {activeCount > 0 ? (
            <button
              type="button"
              onClick={onReset}
              className="text-xs font-medium text-brand-red hover:underline"
            >
              Xóa tất cả ({activeCount})
            </button>
          ) : null}
        </div>

        <FilterFields
          draft={draft}
          setDraft={(next) => {
            setDraft(next);
          }}
          categories={categories}
          brands={brands}
          productTypes={productTypes}
          priceError={priceError}
        />

        <Button
          variant="brand"
          className="w-full"
          disabled={Boolean(priceError)}
          onClick={() => handleApply(draft)}
        >
          Áp dụng bộ lọc
        </Button>
      </aside>
    </>
  );
}
