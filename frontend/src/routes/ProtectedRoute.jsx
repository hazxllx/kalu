import { Navigate, Outlet, useLocation } from 'react-router-dom';

import { useAuth } from '@/context/AuthContext';
import { FullPageSkeleton } from '@/components/common/Skeleton';

/**
 * Route guard.
 *
 * Enforces, in order:
 *   1. authentication  — must have a session/user, else redirect to /login
 *   2. authorization    — the user's role must be in `allow`, else /unauthorized
 *
 * This is the FRONTEND layer of RBAC. It is a UX guard only; the backend
 * (`authenticate` + `authorize`) and Supabase RLS are the layers that actually
 * protect data. Wrap a group of routes:
 *
 *   <Route element={<ProtectedRoute allow={['bhw']} />}>
 *     <Route path="/app/bhw" element={<DashboardLayout roleKey="bhw" />}>...</Route>
 *   </Route>
 *
 * While the session is being restored (and the account profile/role resolved
 * through the backend) the guard renders the page skeleton rather than a blank
 * screen, so the shell never flashes empty or unstyled.
 */
export default function ProtectedRoute({ allow = [] }) {
  const { isAuthenticated, isLoadingAuth, authChecked, role } = useAuth();
  const location = useLocation();

  if (isLoadingAuth || !authChecked) {
    return <FullPageSkeleton />;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  if (allow.length > 0 && !allow.includes(role)) {
    return <Navigate to="/unauthorized" replace />;
  }

  return <Outlet />;
}
