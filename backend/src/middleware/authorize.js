// backend/src/middleware/authorize.js
import ApiError from '../utils/apiError.js';
import { isValidRole } from '../config/roles.js';
import { hasAllConfiguredPermissions, hasAnyConfiguredPermission } from '../services/roles.service.js';

/**
 * @module middleware/authorize
 *
 * Role-Based Access Control (RBAC) and configurable permission middleware factory
 * for KALUSAGAP.
 * Position in request pipeline:
 *   `route -> authenticate -> authorize -> authorizeStation/barangayScope -> controller -> service -> repository/Supabase`
 *
 * Usage:
 *   import { authenticate } from './authenticate.js';
 *   import authorize from './authorize.js';
 *   import { FEATURE_ROLES } from '../config/roles.js';
 *
 *   router.get('/', authenticate, authorize(FEATURE_ROLES.residents), controller.list);
 *
 * MUST run after `authenticate`, which sets `req.user.role` from the server-side
 * `profiles` table. This enforces roles and fine-grained role permissions on the
 * server so a caller cannot bypass the frontend and invoke API endpoints directly
 * with privileges they do not hold. Supabase RLS provides the additional
 * database-level boundary (see docs/database/README.md).
 */

/**
 * Creates an Express middleware enforcing allowed roles and optional granular
 * permission grants configured via `roles.service.js`.
 *
 * @param {string|Array<string>} [allowedRoles=[]] - Role or list of roles allowed to access
 *   the route. When empty, any recognized KALUSAGAP role passes the role gate and
 *   access is governed by the configured permission options.
 * @param {Object} [options={}] - Optional fine-grained permission requirements.
 * @param {string|Function} [options.permission] - Single permission ID, or a resolver
 *   `(req) => Array<string>` returning permission IDs where holding at least one suffices.
 * @param {Array<string>} [options.anyPermission] - Permission IDs where holding at least
 *   one grants access.
 * @param {Array<string>|Function} [options.allPermissions] - Permission IDs (or resolver
 *   `(req) => Array<string>`) where the caller's role must hold every listed permission.
 * @returns {Function} Express middleware `(req, res, next)`.
 */
const authorize = (allowedRoles = [], { permission, anyPermission, allPermissions } = {}) => {
  const allow = Array.isArray(allowedRoles) ? allowedRoles : [allowedRoles];
  // Support both static permission arrays declared at route registration time
  // and dynamic per-request resolvers (e.g. varying required permission by HTTP param/body).
  const permissionResolver = typeof permission === 'function' ? permission : null;
  const allPermissionResolver = typeof allPermissions === 'function' ? allPermissions : null;
  const requiredAllPermissions = allPermissions && !allPermissionResolver ? allPermissions : [];
  const requiredPermissions = anyPermission || (permission && !permissionResolver ? [permission] : []);

  return (req, res, next) => {
    const role = req.user?.role;

    if (!req.user) {
      return next(ApiError.unauthorized());
    }
    if (!role || !isValidRole(role)) {
      return next(ApiError.forbidden('Your account has no valid role assigned'));
    }
    if (allow.length > 0 && !allow.includes(role)) {
      return next(ApiError.forbidden('Your role is not permitted to perform this action'));
    }

    // Evaluate dynamic or static fine-grained permissions against the role matrix
    // when configured; otherwise complete synchronously.
    const permissionsForRequest = permissionResolver ? permissionResolver(req) : requiredPermissions;
    const allPermissionsForRequest = allPermissionResolver
      ? allPermissionResolver(req)
      : requiredAllPermissions;
    if (permissionsForRequest.length > 0 || allPermissionsForRequest.length > 0) {
      Promise.resolve()
        .then(async () => {
          const [anyGranted, allGranted] = await Promise.all([
            permissionsForRequest.length
              ? hasAnyConfiguredPermission({ role, permissionIds: permissionsForRequest })
              : true,
            allPermissionsForRequest.length
              ? hasAllConfiguredPermissions({ role, permissionIds: allPermissionsForRequest })
              : true,
          ]);
          if (anyGranted === false || allGranted === false) {
            next(ApiError.forbidden('Your role does not have the required permission'));
            return;
          }
          next();
        })
        .catch(next);
      return;
    }
    return next();
  };
};

export default authorize;
