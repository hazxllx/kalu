import { Link } from 'react-router-dom';

import { useAuth } from '@/context/AuthContext';
import { homeForRole } from '@/lib/roles';

/**
 * 403 page shown when an authenticated user reaches an area their role is not
 * permitted to access. It links back to that role's own dashboard rather than
 * exposing navigation to restricted areas.
 */
export default function UnauthorizedPage() {
  const { role } = useAuth();
  const home = homeForRole(role);

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-slate-50">
      <div className="max-w-md w-full text-center space-y-6">
        <div className="space-y-2">
          <h1 className="text-7xl font-light text-slate-300">403</h1>
          <div className="h-0.5 w-16 bg-slate-200 mx-auto" />
        </div>
        <div className="space-y-3">
          <h2 className="text-2xl font-medium text-slate-800">Access Restricted</h2>
          <p className="text-slate-600 leading-relaxed">
            Your account role does not have permission to view this page.
          </p>
        </div>
        <div className="pt-6">
          <Link
            to={home}
            className="inline-flex items-center px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 hover:border-slate-300 transition-colors"
          >
            Back to my dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
