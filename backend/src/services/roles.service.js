/**
 * Role & permission matrix service (BUG-011).
 *
 * The authoritative access-control configuration lives in PostgreSQL
 * (public.role_permissions), NOT in the browser. This service reads the matrix
 * for the signed-in user's role (admins can read the full matrix) and lets ONLY
 * an administrator change it. Every change is written to the health audit log.
 *
 * FEATURE_ROLES and RLS remain the coarse server-side security boundary.
 * Routes that opt in to fine-grained permission checks use this persisted
 * matrix as an additional restriction; roles without a saved matrix retain
 * their existing feature-role behavior until configured by an administrator.
 */
import ApiError from '../utils/apiError.js';
import { getServiceClient } from '../config/supabase.js';
import { ROLES } from '../config/roles.js';

const TABLE = 'role_permissions';

// Roles whose permissions may be managed from the matrix. 'resident-limited' is
// a transient sub-state of a resident account, not a managed role.
const MANAGED_ROLES = new Set([
  ROLES.ADMIN,
  ROLES.MHO,
  ROLES.PHN,
  ROLES.HEALTH_SUPERVISOR,
  ROLES.RHU_PERSONNEL,
  ROLES.BHW,
  ROLES.RESIDENT,
]);

const assertAdmin = (user) => {
  if (user?.role !== ROLES.ADMIN) {
    throw ApiError.forbidden('Only an administrator may manage role permissions.');
  }
};

const throwOnError = (error, message) => {
  if (error) throw Object.assign(new Error(error.message || message), { statusCode: 500, details: error });
};

/**
 * The full matrix as { [role]: { [permissionId]: granted } }. Only stored
 * overrides are returned; the frontend merges these over its permission
 * catalogue defaults.
 */
export const getPermissionMatrix = async ({ user, supabase = getServiceClient() }) => {
  if (!user?.id) throw ApiError.unauthorized('Not authenticated.');
  const permissionRole = user.role === ROLES.RESIDENT_LIMITED ? ROLES.RESIDENT : user.role;
  let query = supabase.from(TABLE).select('role, permission_id, granted');
  if (user.role !== ROLES.ADMIN) query = query.eq('role', permissionRole);
  const { data, error } = await query;
  throwOnError(error, 'Could not load the permission matrix');
  const matrix = {};
  for (const row of data || []) {
    if (!matrix[row.role]) matrix[row.role] = {};
    matrix[row.role][row.permission_id] = Boolean(row.granted);
  }
  return matrix;
};

/**
 * Check configured permissions for a role. A null result means no persisted
 * matrix exists yet and lets existing feature-role authorization remain the
 * bootstrap behavior until an administrator saves that role's matrix.
 */
export const hasAnyConfiguredPermission = async ({
  role,
  permissionIds,
  supabase = getServiceClient(),
}) => {
  if (!role || !Array.isArray(permissionIds) || permissionIds.length === 0) return false;
  const { data, error } = await supabase
    .from(TABLE)
    .select('permission_id, granted')
    .eq('role', role);
  throwOnError(error, 'Could not verify role permissions');

  if (!data?.length) return null;
  return data.some((row) => permissionIds.includes(row.permission_id) && Boolean(row.granted));
};

export const hasAllConfiguredPermissions = async ({
  role,
  permissionIds,
  supabase = getServiceClient(),
}) => {
  if (!role || !Array.isArray(permissionIds) || permissionIds.length === 0) return false;
  const { data, error } = await supabase
    .from(TABLE)
    .select('permission_id, granted')
    .eq('role', role);
  throwOnError(error, 'Could not verify role permissions');

  if (!data?.length) return null;
  const granted = new Set(data.filter((row) => Boolean(row.granted)).map((row) => row.permission_id));
  return permissionIds.every((permissionId) => granted.has(permissionId));
};

/**
 * Replace one role's permission overrides. Admin-only (also enforced by RLS).
 * `permissions` is a { [permissionId]: boolean } map. Returns the persisted map
 * for that role and records an audit entry per changed permission.
 */
export const updateRolePermissions = async ({ user, role, permissions, supabase = getServiceClient() }) => {
  assertAdmin(user);
  if (!MANAGED_ROLES.has(role)) throw ApiError.badRequest(`Unknown or unmanaged role: ${role}`);
  if (!permissions || typeof permissions !== 'object' || Array.isArray(permissions)) {
    throw ApiError.badRequest('A permissions map is required.');
  }
  if (Object.values(permissions).some((granted) => typeof granted !== 'boolean')) {
    throw ApiError.badRequest('Permission values must be true or false.');
  }
  if (role === ROLES.ADMIN && permissions['accounts.roles.manage'] === false) {
    throw ApiError.conflict('The administrator role must retain permission management access.');
  }

  const { data, error } = await supabase.rpc('admin_save_role_permissions', {
    p_actor_id: user.id, p_role: role, p_permissions: permissions,
  });
  if (error?.code === '42501') throw ApiError.forbidden('You do not have permission to manage role permissions.');
  throwOnError(error, 'Could not save role permissions and audit records');
  return data;
};

export default { getPermissionMatrix, updateRolePermissions };
