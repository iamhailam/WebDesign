import { NavLink } from 'react-router-dom';
import { cn } from '@/lib/utils';

export interface NavCategoryItem {
  id: number;
  name: string;
  slug: string;
}

export interface CategoryNavProps {
  categories: readonly NavCategoryItem[];
  className?: string | undefined;
}

export function CategoryNav({ categories, className }: CategoryNavProps) {
  return (
    <nav
      aria-label="Danh mục sản phẩm"
      className={cn('hidden border-b border-border bg-surface-elevated md:block', className)}
    >
      <div className="mx-auto flex max-w-7xl items-center gap-1 overflow-x-auto px-4 sm:px-6 lg:px-8">
        <NavLink
          to="/products"
          end
          className={({ isActive }) =>
            cn(
              'inline-flex min-h-11 shrink-0 items-center border-b-2 px-3 text-sm font-medium transition-colors',
              isActive
                ? 'border-brand-red text-brand-red'
                : 'border-transparent text-foreground hover:text-brand-red',
            )
          }
        >
          Tất cả sản phẩm
        </NavLink>

        <NavLink
          to="/brands"
          className={({ isActive }) =>
            cn(
              'inline-flex min-h-11 shrink-0 items-center border-b-2 px-3 text-sm font-medium transition-colors',
              isActive
                ? 'border-brand-red text-brand-red'
                : 'border-transparent text-foreground hover:text-brand-red',
            )
          }
        >
          Thương hiệu
        </NavLink>

        {categories.map((category) => (
          <NavLink
            key={category.id}
            to={`/categories/${category.slug}`}
            className={({ isActive }) =>
              cn(
                'inline-flex min-h-11 shrink-0 items-center border-b-2 px-3 text-sm transition-colors',
                isActive
                  ? 'border-brand-red font-medium text-brand-red'
                  : 'border-transparent text-muted-foreground hover:text-brand-red',
              )
            }
          >
            {category.name}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
