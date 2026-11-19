import type { ComponentProps } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean | undefined;
}

export interface SelectProps extends ComponentProps<'select'> {
  options?: readonly SelectOption[] | undefined;
  error?: string | undefined;
}

export function Select({ className, options, children, error, ...props }: SelectProps) {
  return (
    <div className="relative w-full">
      <select
        data-slot="select"
        aria-invalid={error ? true : props['aria-invalid']}
        className={cn(
          'flex min-h-11 w-full appearance-none rounded-md border border-input bg-background py-2 pr-10 pl-3.5 text-sm text-foreground transition-colors focus-visible:border-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:bg-surface disabled:opacity-60',
          error && 'border-brand-red focus-visible:border-brand-red',
          className,
        )}
        {...props}
      >
        {options
          ? options.map((opt) => (
              <option key={opt.value} value={opt.value} disabled={opt.disabled}>
                {opt.label}
              </option>
            ))
          : children}
      </select>
      <ChevronDown
        className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden="true"
      />
    </div>
  );
}
