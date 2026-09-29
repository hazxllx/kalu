/**
 * Role & permission matrix service (BUG-011).
 *
 * The authoritative access-control configuration lives in PostgreSQL
 * (public.role_permissions), NOT in the browser. This service reads the matrix
 * for any authenticated staff member (it drives UI affordances) and lets ONLY
 * an administrator change it. Every change is written to the health audit log.
 *
 * Server-side authorization for actual API access remains FEATURE_ROLES +
 * authorize() middleware + RLS; this matrix configures UI/permission display
 * and is enforced admin-only at the API and database layers so a non-admin can
 * never grant themselves anything by manipulating browser storage.
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
  const { data, error } = await supabase.from(TABLE).select('role, permission_id, granted');
  throwOnError(error, 'Could not load the permission matrix');
  const matrix = {};
  for (const row of data || []) {
    if (!matrix[row.role]) matrix[row.role] = {};
    matrix[row.role][row.permission_id] = Boolean(row.granted);
  }
  return matrix;
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

  // Current values so we only audit actual changes.
  const { data: current, error: readError } = await supabase
    .from(TABLE)
    .select('permission_id, granted')
    .eq('role', role);
  throwOnError(readError, 'Could not load current permissions');
  const previous = new Map((current || []).map((r) => [r.permission_id, Boolean(r.granted)]));

  const now = new Date().toISOString();
  const rows = Object.entries(permissions).map(([permission_id, granted]) => ({
    role,
    permission_id,
    granted: Boolean(granted),
    updated_by: user.id,
    updated_at: now,
  }));

  if (rows.length) {
    const { error: upsertError } = await supabase
      .from(TABLE)
      .upsert(rows, { onConflict: 'role,permission_id' });
    throwOnError(upsertError, 'Could not save role permissions');
  }

  // Audit only the permissions whose value actually changed.
  const auditRows = rows
    .filter((r) => previous.get(r.permission_id) !== r.granted)
    .map((r) => ({
      actor_id: user.id,
      action: r.granted ? 'permission.grant' : 'permission.revoke',
      entity_type: 'role_permissions',
      entity_id: role,
      metadata: {
        role,
        permissionId: r.permission_id,
        previousValue: previous.get(r.permission_id) ?? null,
        newValue: r.granted,
      },
    }));
  if (auditRows.length) {
    const { error: auditError } = await supabase.from('health_audit_logs').insert(auditRows);
    // Auditing must not lose the change; surface a failure rather than silently drop it.
    throwOnError(auditError, 'Could not record the permission-change audit entry');
  }

  const result = {};
  for (const r of rows) result[r.permission_id] = r.granted;
  return { role, permissions: result, changed: auditRows.length };
};

export default { getPermissionMatrix, updateRolePermissions };
