import ApiError from '../utils/apiError.js';
import { isValidRole } from '../config/roles.js';

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
 * database-level layer (see docs/database and PHASE 11).
 */
const authorize = (allowedRoles = []) => {
  const allow = Array.isArray(allowedRoles) ? allowedRoles : [allowedRoles];

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
    return next();
  };
};

export default authorize;
