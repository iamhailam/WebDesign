import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

export interface SearchBarProps {
  initialValue?: string | undefined;
  onSearch?: ((query: string) => void) | undefined;
  placeholder?: string | undefined;
  className?: string | undefined;
}

export function SearchBar({
  initialValue = '',
  onSearch,
  placeholder = 'Tìm kiếm sản phẩm thời trang, giày, đồng hồ, nước hoa…',
  className,
}: SearchBarProps) {
  const [query, setQuery] = useState(initialValue);
  const navigate = useNavigate();

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const trimmed = query.trim();
    if (onSearch) {
      onSearch(trimmed);
      return;
    }
    const target = trimmed ? `/products?search=${encodeURIComponent(trimmed)}` : '/products';
    navigate(target);
  }

  return (
    <form
      role="search"
      aria-label="Tìm kiếm sản phẩm"
      onSubmit={handleSubmit}
      className={cn(
        'flex w-full items-center overflow-hidden rounded-md border border-border-strong bg-background transition-colors focus-within:border-foreground focus-within:ring-2 focus-within:ring-ring/20',
        className,
      )}
    >
      <label htmlFor="store-search-input" className="sr-only">
        Từ khóa tìm kiếm sản phẩm
      </label>
      <input
        id="store-search-input"
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={placeholder}
        maxLength={100}
        className="min-h-11 min-w-0 flex-1 bg-transparent px-3.5 py-2 text-sm text-foreground placeholder:text-muted-foreground outline-none"
      />
      {query ? (
        <button
          type="button"
          onClick={() => setQuery('')}
          aria-label="Xóa từ khóa tìm kiếm"
          className="inline-flex min-h-11 min-w-11 items-center justify-center text-muted-foreground hover:text-foreground"
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      ) : null}
      <Button
        type="submit"
        variant="brand"
        size="sm"
        aria-label="Tìm kiếm"
        className="min-h-11 rounded-none border-l border-brand-red px-4"
      >
        <Search className="size-4" aria-hidden="true" />
        <span className="hidden sm:inline">Tìm</span>
      </Button>
    </form>
  );
}
