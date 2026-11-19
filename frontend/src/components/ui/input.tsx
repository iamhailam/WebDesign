import { useId, type ComponentProps, type ReactNode } from 'react';
import { AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface InputProps extends ComponentProps<'input'> {
  error?: string | undefined;
}

export function Input({ className, error, ...props }: InputProps) {
  return (
    <input
      data-slot="input"
      aria-invalid={error ? true : props['aria-invalid']}
      className={cn(
        'flex min-h-11 w-full rounded-md border border-input bg-background px-3.5 py-2 text-sm text-foreground placeholder:text-muted-foreground transition-colors focus-visible:border-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:bg-surface disabled:opacity-60',
        error && 'border-brand-red focus-visible:border-brand-red',
        className,
      )}
      {...props}
    />
  );
}

export interface FormFieldProps {
  label: string;
  htmlFor?: string | undefined;
  hint?: string | undefined;
  error?: string | undefined;
  required?: boolean | undefined;
  children: (controlProps: {
    id: string;
    'aria-describedby': string | undefined;
    'aria-invalid': boolean | undefined;
  }) => ReactNode;
  className?: string | undefined;
}

export function FormField({ label, htmlFor, hint, error, required, children, className }: FormFieldProps) {
  const generatedId = useId();
  const fieldId = htmlFor ?? generatedId;
  const hintId = hint ? `${fieldId}-hint` : undefined;
  const errorId = error ? `${fieldId}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;

  return (
    <div className={cn('space-y-1.5', className)}>
      <label htmlFor={fieldId} className="block text-sm font-medium text-foreground">
        {label}
        {required ? (
          <span className="ml-0.5 text-brand-red" aria-hidden="true">
            *
          </span>
        ) : null}
      </label>
      {children({
        id: fieldId,
        'aria-describedby': describedBy,
        'aria-invalid': error ? true : undefined,
      })}
      {hint && !error ? (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} role="alert" className="flex items-center gap-1.5 text-xs font-medium text-brand-red">
          <AlertCircle className="size-3.5 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </p>
      ) : null}
    </div>
  );
}
