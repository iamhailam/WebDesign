import { createContext, useContext } from 'react';

export type ToastVariant = 'default' | 'success' | 'warning' | 'error';

export interface ToastInput {
  title: string;
  description?: string | undefined;
  variant?: ToastVariant | undefined;
  duration?: number | undefined;
}

export interface ToastContextValue {
  toast: (input: ToastInput) => string;
  dismiss: (id: string) => void;
}

export const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast must be used within ToastProvider');
  }
  return ctx;
}
