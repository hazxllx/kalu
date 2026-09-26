import { Navigate, Outlet, useLocation } from 'react-router-dom';

import { useAuth } from '@/context/AuthContext';
import { homeForRole } from '@/lib/roles';
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
  const { isAuthenticated, isLoadingAuth, authChecked, isResolvingProfile, role } = useAuth();
  const location = useLocation();

  // Wait for the initial session restore AND for any in-flight resolution of a
  // freshly-established session's authoritative role (e.g. right after a new
  // resident registers). Rejecting before the role is resolved is what caused
  // a valid resident to land on /unauthorized.
  if (isLoadingAuth || !authChecked || isResolvingProfile) {
    return <FullPageSkeleton />;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  if (allow.length > 0 && !allow.includes(role)) {
    // An authenticated user whose role doesn't match this area is sent to their
    // OWN dashboard rather than a dead /unauthorized page. This is what makes a
    // post-approval refresh unlock the resident: once the session role has been
    // re-resolved to 'resident' (profiles.status = 'active'), a refresh landing
    // on the old /app/resident-limited URL is redirected to /app/resident, the
    // same destination a fresh login uses. Falls back to /unauthorized only when
    // the role has no home (e.g. unresolved).
    const home = homeForRole(role);
    if (home && home !== '/login') {
      return <Navigate to={home} replace />;
    }
    return <Navigate to="/unauthorized" replace />;
  }

  return <Outlet />;
}
