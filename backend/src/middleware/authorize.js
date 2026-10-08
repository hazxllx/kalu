import ApiError from '../utils/apiError.js';
import { isValidRole } from '../config/roles.js';
import { hasAllConfiguredPermissions, hasAnyConfiguredPermission } from '../services/roles.service.js';

/**
 * Authorization (RBAC) middleware factory.
 *
 * Usage:
 *   import { authenticate } from './authenticate.js';
 *   import authorize from './authorize.js';
 *   import { FEATURE_ROLES } from '../config/roles.js';
 *
 *   router.get('/', authenticate, authorize(FEATURE_ROLES.residents), controller.list);
 *
 * MUST run after `authenticate`, which sets `req.user.role`. This enforces
 * roles on the server so a user cannot bypass the frontend and call the API
 * directly with a role they do not hold. Supabase RLS is the additional,
 * database-level layer (see docs/database/README.md).
 */
const authorize = (allowedRoles = [], { permission, anyPermission, allPermissions } = {}) => {
  const allow = Array.isArray(allowedRoles) ? allowedRoles : [allowedRoles];
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
