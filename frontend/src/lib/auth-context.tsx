import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { fetchMeApi, loginApi, registerUnauthorizedHandler, type UserSelf } from '@/lib/api';
import { AuthContext, type AuthContextValue } from '@/lib/auth-store';

// In-memory session per UI_DESIGN_SPEC D-10 (no localStorage token persistence)
export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<UserSelf | null>(null);
  const queryClient = useQueryClient();

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
    queryClient.removeQueries({ queryKey: ['cart'] });
    queryClient.removeQueries({ queryKey: ['vouchers'] });
    queryClient.removeQueries({ queryKey: ['orders'] });
    queryClient.removeQueries({
      predicate: (q) => String(q.queryKey[0]).startsWith('admin-'),
    });
  }, [queryClient]);

  useEffect(() => {
    registerUnauthorizedHandler(logout);
    return () => {
      registerUnauthorizedHandler(() => undefined);
    };
  }, [logout]);

  const login = useCallback(async (email: string, password: string) => {
    const res = await loginApi({ email, password });
    setToken(res.data.access_token);
    setUser(res.data.user);
    return res.data.user;
  }, []);

  const refreshMe = useCallback(async () => {
    if (!token) return null;
    try {
      const res = await fetchMeApi(token);
      setUser(res.data);
      return res.data;
    } catch {
      logout();
      return null;
    }
  }, [token, logout]);

  const value = useMemo<AuthContextValue>(
    () => ({
      token,
      user,
      isAuthenticated: Boolean(token && user),
      login,
      logout,
      refreshMe,
    }),
    [token, user, login, logout, refreshMe],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
