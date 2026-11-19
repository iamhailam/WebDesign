import { createContext, useContext } from 'react';
import type { UserSelf } from '@/lib/api';

export interface AuthContextValue {
  token: string | null;
  user: UserSelf | null;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<UserSelf>;
  logout: () => void;
  refreshMe: () => Promise<UserSelf | null>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return ctx;
}

export function sanitizeReturnTo(raw: string | null | undefined): string {
  if (!raw) return '/';
  const trimmed = raw.trim();
  if (!trimmed.startsWith('/') || trimmed.startsWith('//')) return '/';
  return trimmed;
}
