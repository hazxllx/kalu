/**
 * Persistence for the Role & Permission matrix and its audit trail.
 *
 * The matrix is stored as a sparse map of role -> permission id -> boolean and
 * is always merged over the current defaults on read. That merge is what makes
 * the catalogue extensible: a permission added to `@/lib/permissions` later
 * simply picks up its default value for every role instead of reading as
 * "denied", and a permission that is removed from the catalogue is dropped.
 *
 * Storage is `localStorage` today because KALUSAGAP has no access-control
 * endpoint yet. Everything the UI needs goes through the four functions below,
 * so swapping in `PATCH /api/roles/:role/permissions` later is a change to this
 * file only.
 */
import {
  ALL_PERMISSIONS,
  MANAGED_ROLE_IDS,
  defaultPermissionsForRole,
  normalizePermissionValue,
} from '@/lib/permissions';

const MATRIX_KEY = 'kalusagap.access.matrix.v1';
const AUDIT_KEY = 'kalusagap.access.audit.v1';

/** Keep the on-device trail bounded; the server-side trail is authoritative. */
export const AUDIT_LIMIT = 250;

const readJson = (key) => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

const writeJson = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
};

/**
 * Merge stored overrides over the current defaults and re-apply the policy
 * guard-rails, so a tampered or stale payload can never grant something the
 * registry forbids.
 */
export const hydrateMatrix = (stored) => {
  const source = stored && typeof stored === 'object' ? stored : {};

  return MANAGED_ROLE_IDS.reduce((matrix, roleId) => {
    const defaults = defaultPermissionsForRole(roleId);
    const overrides = source[roleId] && typeof source[roleId] === 'object' ? source[roleId] : {};

    matrix[roleId] = ALL_PERMISSIONS.reduce((permissions, perm) => {
      const raw = Object.prototype.hasOwnProperty.call(overrides, perm.id)
        ? overrides[perm.id]
        : defaults[perm.id];
      permissions[perm.id] = normalizePermissionValue(roleId, perm.id, raw);
      return permissions;
    }, {});

    return matrix;
  }, {});
};

export const loadMatrix = () => hydrateMatrix(readJson(MATRIX_KEY));

export const persistMatrix = (matrix) => writeJson(MATRIX_KEY, matrix);

export const loadAuditEntries = () => {
  const stored = readJson(AUDIT_KEY);
  return Array.isArray(stored) ? stored : [];
};

export const persistAuditEntries = (entries) =>
  writeJson(AUDIT_KEY, (Array.isArray(entries) ? entries : []).slice(0, AUDIT_LIMIT));

export default { hydrateMatrix, loadMatrix, persistMatrix, loadAuditEntries, persistAuditEntries };
