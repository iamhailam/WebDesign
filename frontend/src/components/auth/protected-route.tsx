import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import type { Role } from '@/lib/api';
import { useAuth } from '@/lib/auth-store';
import { ForbiddenPage } from '@/components/auth/forbidden-page';

export interface ProtectedRouteProps {
  children: ReactNode;
  allowedRoles?: readonly Role[] | undefined;
}

/**
 * Client-side route UX guard; all authorization and resource ownership checks
 * are still enforced authoritatively on the backend PostgreSQL/Express layer.
 */
export function ProtectedRoute({ children, allowedRoles }: ProtectedRouteProps) {
  const { user, token } = useAuth();
  const location = useLocation();

  if (!user || !token) {
    const returnTo = `${location.pathname}${location.search}`;
    return <Navigate to={`/login?return_to=${encodeURIComponent(returnTo)}`} replace />;
  }

  if (allowedRoles && !allowedRoles.includes(user.role)) {
    return <ForbiddenPage />;
  }

  return <>{children}</>;
}
