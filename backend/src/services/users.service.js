/**
 * Admin User Management service.
 *
 * The `profiles` table is the single server-side source of truth for a user's
 * application role, account status and coverage assignment. These functions run
 * only after `authenticate` + `authorize(FEATURE_ROLES.users)` (admin-only), so
 * the caller is always a verified administrator; the role is never trusted from
 * the client.
 *
 * Scope of this endpoint (matches the documented system design — accounts are
 * created in Supabase Auth, and an administrator then sets role/status/scope):
 *   - list / read user accounts,
 *   - update display fields (full name, contact, position, license no),
 *   - change application role,
 *   - activate / deactivate (status).
 *
 * NOT handled here (by design): creating or deleting Supabase Auth accounts and
 * changing credentials — those belong to the Supabase Auth lifecycle. `email`
 * is intentionally read-only because it is owned by `auth.users`; editing it on
 * `profiles` alone would desync the two.
 */
import ApiError from '../utils/apiError.js';
import repository from '../repositories/index.js';
import { ROLES, isValidRole } from '../config/roles.js';

const VALID_STATUSES = Object.freeze(['active', 'pending_verification', 'disabled']);

// Roles an administrator may assign. `resident-limited` is a computed
// verification sub-state, never directly assignable.
const ASSIGNABLE_ROLES = Object.freeze([
  ROLES.ADMIN,
  ROLES.MHO,
  ROLES.PHN,
  ROLES.HEALTH_SUPERVISOR,
  ROLES.RHU_PERSONNEL,
  ROLES.BHW,
  ROLES.RESIDENT,
]);

// Roles that are pinned to a single barangay; every other role must not carry
// a barangay assignment.
const BARANGAY_SCOPED_ROLES = Object.freeze([ROLES.HEALTH_SUPERVISOR, ROLES.BHW]);

const parsePositiveInt = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

export const listUsers = async ({ q = '', role = null, status = null, limit = 50, offset = 0 } = {}) => {
  const roleFilter = role ? String(role).trim() : null;
  if (roleFilter && !isValidRole(roleFilter)) {
    throw ApiError.badRequest(`Unknown role filter: ${roleFilter}`);
  }
  const statusFilter = status ? String(status).trim() : null;
  if (statusFilter && !VALID_STATUSES.includes(statusFilter)) {
    throw ApiError.badRequest(`Unknown status filter: ${statusFilter}`);
  }
  const parsedLimit = Math.min(parsePositiveInt(limit, 50), 100);
  const parsedOffset = Math.max(Number.parseInt(offset, 10) || 0, 0);
  return repository.listProfiles({
    q: String(q || '').trim(),
    role: roleFilter,
    status: statusFilter,
    limit: parsedLimit,
    offset: parsedOffset,
  });
};

export const getUser = async ({ id } = {}) => {
  const user = await repository.getProfileById(id);
  if (!user) throw ApiError.notFound('User account not found');
  return user;
};

/**
 * Update an account's profile fields, role and/or status.
 *
 * Safeguards:
 *   - role must be one of the assignable canonical roles,
 *   - status must be one of active / pending_verification / disabled,
 *   - barangay-scoped roles keep/require a barangay; non-scoped roles are
 *     cleared to no barangay,
 *   - the LAST active administrator cannot be demoted or disabled,
 *   - email is never modified here (owned by Supabase Auth).
 */
export const updateUser = async ({ id, patch = {} } = {}) => {
  const existing = await repository.getProfileById(id);
  if (!existing) throw ApiError.notFound('User account not found');

  const fields = {};
  const errors = [];

  if (patch.name !== undefined || patch.fullName !== undefined) {
    fields.full_name = String(patch.fullName ?? patch.name ?? '').trim();
  }
  if (patch.contact !== undefined) fields.contact = String(patch.contact ?? '').trim();
  if (patch.position !== undefined) fields.position = String(patch.position ?? '').trim();
  if (patch.licenseNo !== undefined) fields.license_no = String(patch.licenseNo ?? '').trim();

  let nextRole = existing.role;
  if (patch.role !== undefined && patch.role !== null && String(patch.role).trim() !== existing.role) {
    const role = String(patch.role).trim();
    if (!ASSIGNABLE_ROLES.includes(role)) {
      errors.push(`Role must be one of: ${ASSIGNABLE_ROLES.join(', ')}.`);
    } else {
      nextRole = role;
      fields.role = role;
    }
  }

  let nextStatus = existing.status;
  if (patch.status !== undefined && patch.status !== null && String(patch.status).trim() !== existing.status) {
    const status = String(patch.status).trim();
    if (!VALID_STATUSES.includes(status)) {
      errors.push(`Status must be one of: ${VALID_STATUSES.join(', ')}.`);
    } else {
      nextStatus = status;
      fields.status = status;
    }
  }

  // Barangay assignment: only accepted for scoped roles; cleared otherwise.
  const scoped = BARANGAY_SCOPED_ROLES.includes(nextRole);
  if (patch.barangayId !== undefined) {
    const barangayId = patch.barangayId ? String(patch.barangayId).trim() : null;
    if (barangayId && !scoped) {
      errors.push('Only Health Supervisor / Barangay Health Worker accounts may be assigned to a barangay.');
    } else if (scoped) {
      fields.barangay_id = barangayId;
    }
  }
  // When a role changes to a non-scoped role, drop any stale barangay pin.
  if (fields.role && !scoped && existing.barangayId) {
    fields.barangay_id = null;
  }

  if (errors.length) throw ApiError.unprocessable('Please correct the highlighted fields.', errors);

  // Last-admin safeguard: never leave the system with zero active admins.
  const demotingAdmin = existing.role === ROLES.ADMIN && (nextRole !== ROLES.ADMIN || nextStatus === 'disabled');
  if (demotingAdmin) {
    const otherActiveAdmins = await repository.countActiveAdmins({ excludeId: id });
    if (otherActiveAdmins < 1) {
      throw ApiError.conflict(
        'Cannot demote or deactivate the last active administrator. Assign another administrator first.',
      );
    }
  }

  if (Object.keys(fields).length === 0) return existing;

  const updated = await repository.updateProfileFields(id, fields);
  if (!updated) throw ApiError.notFound('User account not found');
  return updated;
};

export default { listUsers, getUser, updateUser };
