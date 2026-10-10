/**
 * Admin User Management service.
 *
 * The `profiles` table is the single server-side source of truth for a user's
 * application role, account status and coverage assignment. These functions run
 * only after `authenticate` + `authorize(FEATURE_ROLES.users)` (admin-only), so
 * the caller is always a verified administrator; the role is never trusted from
 * the client.
 *
 * Auth owns account identities and credentials; profiles owns application
 * roles, status and scope. Account creation uses Auth invitations, while
 * profile writes and actor-attributed audit records are committed atomically
 * by the database account-lifecycle functions.
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
const MUNICIPALITY_SCOPED_ROLES = Object.freeze([ROLES.MHO, ROLES.PHN]);

const parsePositiveInt = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

export const listUsers = async ({
  q = '',
  role = null,
  status = null,
  municipalityId = null,
  barangayId = null,
  limit = 50,
  offset = 0,
} = {}) => {
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
    municipalityId: municipalityId ? String(municipalityId).trim() : null,
    barangayId: barangayId ? String(barangayId).trim() : null,
    limit: parsedLimit,
    offset: parsedOffset,
  });
};

export const getAccountOptions = async () => ({
  roles: [
    { id: ROLES.ADMIN, name: 'Administrator' },
    { id: ROLES.MHO, name: 'Municipal Health Office' },
    { id: ROLES.PHN, name: 'Public Health Nurse' },
    { id: ROLES.HEALTH_SUPERVISOR, name: 'Health Supervisor' },
    { id: ROLES.RHU_PERSONNEL, name: 'RHU Personnel' },
    { id: ROLES.BHW, name: 'Barangay Health Worker' },
    { id: ROLES.RESIDENT, name: 'Resident' },
  ],
  ...(await repository.getAccountAssignmentOptions()),
});

/**
 * Real account totals for the admin summary cards (All / Active / Pending
 * verification / Deactivated). Sourced from `public.profiles`, never hardcoded.
 */
export const getAccountSummary = async () => repository.getAccountSummary();

export const getUser = async ({ id } = {}) => {
  const user = await repository.getProfileById(id);
  if (!user) throw ApiError.notFound('User account not found');
  return user;
};

const normalizeOptionalText = (value) => String(value ?? '').trim();

const makeProfileAssignment = async ({ role, municipalityId, barangayId, facilityId, allowResident }) => {
  if (role === ROLES.ADMIN) {
    return { municipality_id: null, barangay_id: null, facility_id: null };
  }

  if (role === ROLES.RESIDENT) {
    if (!allowResident) {
      throw ApiError.unprocessable('Resident accounts must use the resident registration workflow.');
    }
    return {
      municipality_id: municipalityId || null,
      barangay_id: barangayId || null,
      facility_id: facilityId || null,
    };
  }

  const options = await repository.getAccountAssignmentOptions();
  if (BARANGAY_SCOPED_ROLES.includes(role)) {
    const barangay = options.barangays.find((item) => item.id === barangayId);
    if (!barangay) {
      throw ApiError.unprocessable('Select a valid active barangay for this role.');
    }
    if (municipalityId && municipalityId !== barangay.municipalityId) {
      throw ApiError.unprocessable('The selected barangay does not belong to the selected municipality.');
    }
    if (facilityId) {
      throw ApiError.unprocessable('A barangay-scoped role cannot have a facility assignment.');
    }
    return {
      municipality_id: barangay.municipalityId,
      barangay_id: barangay.id,
      facility_id: null,
    };
  }

  if (role === ROLES.RHU_PERSONNEL) {
    const facility = options.facilities.find((item) => item.id === facilityId);
    if (!facility) {
      throw ApiError.unprocessable('Select a valid RHU facility for this role.');
    }
    if (municipalityId && municipalityId !== facility.municipalityId) {
      throw ApiError.unprocessable('The selected facility does not belong to the selected municipality.');
    }
    if (barangayId) {
      throw ApiError.unprocessable('RHU Personnel use a facility assignment, not a barangay assignment.');
    }
    return {
      municipality_id: facility.municipalityId,
      barangay_id: null,
      facility_id: facility.id,
    };
  }

  if (MUNICIPALITY_SCOPED_ROLES.includes(role)) {
    if (!options.municipalities.some((item) => item.id === municipalityId)) {
      throw ApiError.unprocessable('Select a valid active municipality for this role.');
    }
    if (barangayId || facilityId) {
      throw ApiError.unprocessable('This role uses municipality-wide scope only.');
    }
    return { municipality_id: municipalityId, barangay_id: null, facility_id: null };
  }

  throw ApiError.unprocessable('The selected role cannot be assigned to an account.');
};

const accountStatus = (value, fallback, allowPending = false) => {
  if (value === undefined || value === null || String(value).trim() === '') return fallback;
  const status = String(value).trim();
  const allowed = allowPending ? VALID_STATUSES : ['active', 'disabled'];
  if (!allowed.includes(status)) {
    throw ApiError.unprocessable(`Status must be one of: ${allowed.join(', ')}.`);
  }
  return status;
};

export const createUser = async ({ actorId, input = {} } = {}) => {
  const email = String(input.email ?? '').trim().toLowerCase();
  const fullName = String(input.fullName ?? input.name ?? '').trim();
  const role = String(input.role ?? '').trim();
  const errors = [];
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push('Enter a valid email address.');
  if (!fullName || fullName.length > 120) errors.push('Name must be between 1 and 120 characters.');
  if (!ASSIGNABLE_ROLES.includes(role) || role === ROLES.RESIDENT) {
    errors.push('Choose an assignable staff role. Resident accounts must use resident registration.');
  }
  if (errors.length) throw ApiError.unprocessable('Please correct the highlighted fields.', errors);

  const status = accountStatus(input.status, 'active');
  const assignment = await makeProfileAssignment({
    role,
    municipalityId: input.municipalityId ? String(input.municipalityId).trim() : null,
    barangayId: input.barangayId ? String(input.barangayId).trim() : null,
    facilityId: input.facilityId ? String(input.facilityId).trim() : null,
    allowResident: false,
  });
  const profile = {
    email,
    full_name: fullName,
    role,
    status,
    contact: normalizeOptionalText(input.contact),
    position: normalizeOptionalText(input.position),
    license_no: normalizeOptionalText(input.licenseNo),
    ...assignment,
  };

  let id;
  try {
    id = await repository.inviteAccount({ email, fullName });
  } catch (error) {
    if (/already (?:been )?registered|already exists|user already/i.test(error.message || '')) {
      throw ApiError.conflict('An account with this email already exists.');
    }
    throw error;
  }
  if (!id) throw new ApiError(502, 'The invitation was not created by Supabase Auth.');

  try {
    const user = await repository.provisionAccountProfile({ id, actorId, profile });
    if (!user) throw new ApiError(502, 'The invitation was sent, but its account profile could not be loaded.');
    return user;
  } catch (error) {
    try {
      await repository.removeUnprovisionedAuthUser(id);
    } catch {
      throw new ApiError(500,
        'The invitation could not be provisioned or safely rolled back. Contact a system administrator before retrying.',
      );
    }
    throw error;
  }
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
export const updateUser = async ({ id, actorId = null, patch = {} } = {}) => {
  const existing = await repository.getProfileById(id);
  if (!existing) throw ApiError.notFound('User account not found');

  const fields = {};
  const errors = [];

  if (patch.name !== undefined || patch.fullName !== undefined) {
    const name = String(patch.fullName ?? patch.name ?? '').trim();
    if (!name || name.length > 120) errors.push('Name must be between 1 and 120 characters.');
    else fields.full_name = name;
  }
  if (patch.contact !== undefined) fields.contact = normalizeOptionalText(patch.contact);
  if (patch.position !== undefined) fields.position = normalizeOptionalText(patch.position);
  if (patch.licenseNo !== undefined) fields.license_no = normalizeOptionalText(patch.licenseNo);

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
    try {
      nextStatus = accountStatus(patch.status, existing.status, true);
      fields.status = nextStatus;
    } catch (error) {
      errors.push(error.message);
    }
  }

  if (errors.length) throw ApiError.unprocessable('Please correct the highlighted fields.', errors);

  if ((nextRole === ROLES.RESIDENT) !== (existing.role === ROLES.RESIDENT)) {
    throw ApiError.unprocessable('Resident accounts and staff roles must use their existing registration and linking workflows.');
  }
  if (actorId && actorId === id && (nextRole !== ROLES.ADMIN || nextStatus !== 'active')) {
    throw ApiError.conflict('You cannot change or deactivate your own administrator account.');
  }

  // Last-admin safeguard: never leave the system with zero active admins.
  const demotingAdmin = existing.role === ROLES.ADMIN && (nextRole !== ROLES.ADMIN || nextStatus !== 'active');
  if (demotingAdmin) {
    const otherActiveAdmins = await repository.countActiveAdmins({ excludeId: id });
    if (otherActiveAdmins < 1) {
      throw ApiError.conflict(
        'Cannot demote or deactivate the last active administrator. Assign another administrator first.',
      );
    }
  }

  if (Object.keys(fields).length === 0
      && patch.role === undefined
      && patch.status === undefined
      && patch.municipalityId === undefined
      && patch.barangayId === undefined
      && patch.facilityId === undefined) return existing;

  let requestedMunicipality = patch.municipalityId === undefined
    ? existing.municipalityId
    : (patch.municipalityId ? String(patch.municipalityId).trim() : null);
  let requestedBarangay = patch.barangayId === undefined
    ? existing.barangayId
    : (patch.barangayId ? String(patch.barangayId).trim() : null);
  let requestedFacility = patch.facilityId === undefined
    ? existing.facilityId
    : (patch.facilityId ? String(patch.facilityId).trim() : null);
  if (nextRole !== existing.role) {
    if (!BARANGAY_SCOPED_ROLES.includes(nextRole)) requestedBarangay = null;
    if (nextRole !== ROLES.RHU_PERSONNEL) requestedFacility = null;
    if (nextRole === ROLES.ADMIN) requestedMunicipality = null;
  }
  const assignmentChanged = nextRole !== existing.role
    || patch.municipalityId !== undefined
    || patch.barangayId !== undefined
    || patch.facilityId !== undefined;
  const assignment = assignmentChanged
    ? await makeProfileAssignment({
      role: nextRole,
      municipalityId: requestedMunicipality,
      barangayId: requestedBarangay,
      facilityId: requestedFacility,
      allowResident: existing.role === ROLES.RESIDENT,
    })
    : {
      municipality_id: existing.municipalityId,
      barangay_id: existing.barangayId,
      facility_id: existing.facilityId,
    };
  const profile = {
    full_name: fields.full_name ?? existing.name,
    contact: fields.contact ?? existing.contact,
    position: fields.position ?? existing.position,
    license_no: fields.license_no ?? existing.licenseNo,
    role: nextRole,
    status: nextStatus,
    ...assignment,
  };
  const updated = await repository.updateAdminAccountProfile({ id, actorId, profile });
  if (!updated) throw ApiError.notFound('User account not found');
  return updated;
};

export const resetUserAccess = async ({ id, actorId } = {}) => {
  const user = await repository.getProfileById(id);
  if (!user) throw ApiError.notFound('User account not found');
  await repository.sendAccountRecoveryEmail({ user, actorId });
  return { sent: true };
};

/**
 * Permanently delete an account (Supabase Auth identity + cascaded profile).
 *
 * Safety model (defence in depth; every invariant is also re-checked inside the
 * database under an advisory lock by `admin_assert_account_deletable`):
 *   - the caller is already a verified active admin (authenticate + authorize),
 *   - the target id is validated and must exist,
 *   - an administrator may never delete their OWN account,
 *   - the LAST active administrator can never be deleted,
 *   - an explicit email confirmation must match the target (guards against
 *     deleting the wrong account from the UI or a mistaken API call).
 *
 * Consistency: `public.profiles.id` cascades from `auth.users`, so a single
 * successful `deleteAuthAccount` removes BOTH the auth identity and the profile
 * together — there is no partially-deleted state. Dependent resident /
 * consultation / referral / visit / audit rows reference the account with
 * `on delete set null`, so they are PRESERVED (unlinked), never cascade-deleted.
 * The audit record is written only AFTER a confirmed deletion, so a failed
 * deletion can never leave a false "deleted" entry behind.
 */
export const deleteUser = async ({ id, actorId, confirmEmail } = {}) => {
  const targetId = String(id ?? '').trim();
  if (!targetId) throw ApiError.badRequest('A target account id is required.');

  const existing = await repository.getProfileById(targetId);
  if (!existing) throw ApiError.notFound('User account not found');

  // Fail fast with clear messages before the irreversible step. The database
  // guard RPC re-enforces each of these authoritatively.
  if (actorId && actorId === targetId) {
    throw ApiError.conflict('You cannot delete your own administrator account.');
  }

  const provided = String(confirmEmail ?? '').trim().toLowerCase();
  if (!provided) {
    throw ApiError.unprocessable('Type the account email address to confirm permanent deletion.');
  }
  if (provided !== String(existing.email ?? '').trim().toLowerCase()) {
    throw ApiError.unprocessable('The confirmation email does not match this account.');
  }

  if (existing.role === ROLES.ADMIN && existing.status === 'active') {
    const otherActiveAdmins = await repository.countActiveAdmins({ excludeId: targetId });
    if (otherActiveAdmins < 1) {
      throw ApiError.conflict(
        'Cannot delete the last active administrator. Assign another administrator first.',
      );
    }
  }

  // Authoritative, advisory-locked re-check in the database; returns the snapshot
  // used for the audit record. Raises (mapped to 403/404/409) on any violation.
  const snapshot = await repository.assertAccountDeletable({ id: targetId, actorId });

  // Irreversible: removes the Auth identity and (by cascade) the profile. If this
  // throws, nothing was deleted and no audit entry is written — the caller keeps
  // the account visible and surfaces the error.
  await repository.deleteAuthAccount(targetId);

  // The account is now gone. Record the deletion for the audit trail. A failure
  // here does not resurrect the account, so we must not report failure; we log it
  // server-side instead and still report the (real) successful deletion.
  try {
    await repository.insertHealthAuditLog({
      actorId,
      action: 'ACCOUNT_DELETED',
      entityType: 'profiles',
      entityId: targetId,
      municipalityId: snapshot?.municipality_id || existing.municipalityId || null,
      barangayId: snapshot?.barangay_id || existing.barangayId || null,
      metadata: {
        email: snapshot?.email ?? existing.email,
        full_name: snapshot?.full_name ?? existing.name,
        role: snapshot?.role ?? existing.role,
        status: snapshot?.status ?? existing.status,
        facility_id: snapshot?.facility_id ?? existing.facilityId ?? null,
        outcome: 'deleted',
      },
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[users] ACCOUNT_DELETED audit log failed after deletion', {
      targetId,
      message: error?.message,
    });
  }

  return { deleted: true, id: targetId };
};

export default {
  listUsers,
  getAccountOptions,
  getAccountSummary,
  getUser,
  createUser,
  updateUser,
  resetUserAccess,
  deleteUser,
};
