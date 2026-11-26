// backend/src/services/users.service.js
/**
 * User and personnel account management service.
 *
 * The `profiles` table is the single server-side source of truth for a user's
 * application role, account status and coverage assignment. These functions run
 * after server-side authentication and personnel-management authorization.
 * Administrators retain their existing permissions; PHNs and Health Supervisors
 * receive only the scoped capabilities defined below. Caller roles and coverage
 * are never trusted from the client.
 *
 * Auth owns account identities and credentials; profiles owns application
 * roles, status and scope. Managed creation reserves a stable Auth identity
 * and creates it silently; credentials are chosen only by the account owner.
 * Approval, activation intent, profile writes, actor-attributed audits and the
 * email outbox are committed atomically by the account-lifecycle functions.
 */
import ApiError from '../utils/apiError.js';
import repository from '../repositories/supabaseRepository.js';
import { randomUUID } from 'node:crypto';
import { processPersonnelNotifications } from './personnelNotifications.service.js';
import { ROLES, isValidRole } from '../config/roles.js';
import { RHU_STATION_VALUES, STATION_ASSIGNED_ROLES, normalizeStations, stationLabel } from '../config/rhuStations.js';
import { isEmail, isStrictMobile, isUuid, isValidPersonName } from '../validators/common.js';
import { createUserValidator, updateUserValidator, userQueryValidator, personnelLifecycleValidator } from '../validators/users.validators.js';
import { getAccountRequestHistory } from './staffAccounts.service.js';
import { encryptTemporaryPassword, generateTemporaryPassword } from '../utils/temporaryPassword.js';

const VALID_STATUSES = Object.freeze(['active', 'pending_verification', 'disabled']);

// Roles administrators may assign. `resident-limited` is a computed
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
const DELEGATED_TARGETS = Object.freeze({
  [ROLES.PHN]: [ROLES.HEALTH_SUPERVISOR, ROLES.RHU_PERSONNEL],
  [ROLES.HEALTH_SUPERVISOR]: [ROLES.BHW],
});

const delegatedRole = (actor) => Object.hasOwn(DELEGATED_TARGETS, actor?.role);
const manageableRoles = (actor) => DELEGATED_TARGETS[actor?.role] || [];
const canManageTarget = (actor, target) => {
  if (!actor || !target) return false;
  if (actor.role === ROLES.ADMIN) return true;
  if (actor.role === ROLES.PHN) {
    return manageableRoles(actor).includes(target.role)
      && Boolean(actor.municipalityId)
      && target.municipalityId === actor.municipalityId;
  }
  if (actor.role === ROLES.HEALTH_SUPERVISOR) {
    return target.role === ROLES.BHW && Boolean(actor.barangayId)
      && target.barangayId === actor.barangayId;
  }
  return false;
};

const assertCanManageTarget = (actor, target) => {
  if (!canManageTarget(actor, target)) throw ApiError.notFound('Personnel account not found in your authorized scope.');
};

const parsePositiveInt = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const validated = (validator, input) => {
  const result = validator(input);
  if (result.error) throw ApiError.badRequest('Validation failed', result.error);
  return result.value;
};

export const listUsers = async ({
  actor = null,
  q = '',
  role = null,
  status = null,
  municipalityId = null,
  barangayId = null,
  facilityId = null,
  rhuStation = null,
  personnelOnly = false,
  approvalStatus = null,
  lifecycleState = null,
  limit = 50,
  offset = 0,
} = {}) => {
  ({ personnelOnly, approvalStatus, lifecycleState } = validated(userQueryValidator, {
    personnelOnly, approvalStatus, lifecycleState, municipalityId, barangayId, facilityId,
  }));
  const roleFilter = role ? String(role).trim() : null;
  if (roleFilter && !isValidRole(roleFilter)) {
    throw ApiError.badRequest(`Unknown role filter: ${roleFilter}`);
  }
  const statusFilter = status ? String(status).trim() : null;
  if (statusFilter && !VALID_STATUSES.includes(statusFilter)) {
    throw ApiError.badRequest(`Unknown status filter: ${statusFilter}`);
  }
  if (delegatedRole(actor)) {
    const allowed = manageableRoles(actor);
    if (roleFilter && !allowed.includes(roleFilter)) throw ApiError.forbidden('You cannot view accounts for that role.');
    role = roleFilter || null;
    personnelOnly = true;
    if (actor.role === ROLES.PHN) {
      if (!actor.municipalityId) throw ApiError.forbidden('Your account has no authorized municipality assignment.');
      municipalityId = actor.municipalityId;
      barangayId = barangayId ? String(barangayId).trim() : null;
      if (facilityId) {
        const options = await repository.getAccountAssignmentOptions();
        const facility = options.facilities.find((item) => item.id === String(facilityId).trim());
        if (!facility || facility.municipalityId !== actor.municipalityId) throw ApiError.forbidden('That facility is outside your authorized municipality.');
      }
    } else {
      if (!actor.barangayId) throw ApiError.forbidden('Your account has no assigned barangay.');
      barangayId = actor.barangayId;
      municipalityId = actor.municipalityId || null;
    }
  }
  const parsedLimit = Math.min(parsePositiveInt(limit, 50), 100);
  const parsedOffset = Math.max(Number.parseInt(offset, 10) || 0, 0);
  return repository.listProfiles({
    q: String(q || '').trim(),
    role: role || roleFilter,
    status: statusFilter,
    municipalityId: municipalityId ? String(municipalityId).trim() : null,
    barangayId: barangayId ? String(barangayId).trim() : null,
    facilityId: facilityId ? String(facilityId).trim() : null,
    rhuStation: rhuStation || null,
    roles: delegatedRole(actor) ? manageableRoles(actor) : null,
    personnelOnly,
    approvalStatus,
    lifecycleState,
    limit: parsedLimit,
    offset: parsedOffset,
  });
};

export const getAccountOptions = async (actor = null) => {
  const options = {
    roles: [
      { id: ROLES.ADMIN, name: 'Administrator' },
      { id: ROLES.MHO, name: 'Municipal Health Office' },
      { id: ROLES.PHN, name: 'Public Health Nurse' },
      { id: ROLES.HEALTH_SUPERVISOR, name: 'Health Supervisor' },
      { id: ROLES.RHU_PERSONNEL, name: 'RHU Personnel' },
      { id: ROLES.BHW, name: 'Barangay Health Worker' },
      { id: ROLES.RESIDENT, name: 'Resident' },
    ],
    rhuStations: RHU_STATION_VALUES.map((id) => ({ id, name: stationLabel(id) })),
    ...(await repository.getAccountAssignmentOptions()),
  };
  if (!delegatedRole(actor)) return options;
  return {
    ...options,
    roles: manageableRoles(actor).map((id) => options.roles.find((item) => item.id === id)).filter(Boolean),
    municipalities: options.municipalities.filter((item) => item.id === actor.municipalityId),
    barangays: actor.role === ROLES.HEALTH_SUPERVISOR
      ? options.barangays.filter((item) => item.id === actor.barangayId)
      : options.barangays.filter((item) => item.municipalityId === actor.municipalityId),
    facilities: options.facilities.filter((item) => item.municipalityId === actor.municipalityId),
  };
};

/**
 * Real account totals for the admin summary cards (All / Active / Pending
 * verification / Deactivated). Sourced from `public.profiles`, never hardcoded.
 */
export const getAccountSummary = async (filters = {}, actor = null) => {
  const parsed = validated(userQueryValidator, filters);
  if (delegatedRole(actor)) {
    parsed.personnelOnly = true;
    parsed.roles = manageableRoles(actor);
    if (actor.role === ROLES.PHN) {
      parsed.municipalityId = actor.municipalityId;
      if (!actor.municipalityId) throw ApiError.forbidden('Your account has no authorized municipality assignment.');
    } else {
      parsed.municipalityId = actor.municipalityId;
      parsed.barangayId = actor.barangayId;
      if (!actor.barangayId) throw ApiError.forbidden('Your account has no assigned barangay.');
    }
  }
  return repository.getAccountSummary(parsed);
};

export const getUser = async ({ id, actor = null } = {}) => {
  const user = await repository.getProfileById(id);
  if (!user) throw ApiError.notFound('User account not found');
  if (delegatedRole(actor)) assertCanManageTarget(actor, user);
  return user;
};

const normalizeOptionalText = (value) => String(value ?? '').trim();

export const makeProfileAssignment = async ({
  role, municipalityId, barangayId, facilityId, allowResident, assignmentOptions = null,
}) => {
  if (role === ROLES.ADMIN) {
    return { municipality_id: null, barangay_id: null, facility_id: null };
  }

  if (role === ROLES.RESIDENT) {
    if (!allowResident) {
      throw ApiError.unprocessable('Resident accounts must use the resident registration workflow.');
    }
    if (!barangayId) {
      return { municipality_id: municipalityId || null, barangay_id: null, facility_id: null };
    }
    const options = assignmentOptions || await repository.getAccountAssignmentOptions();
    const barangay = options.barangays.find((item) => item.id === barangayId);
    if (!barangay) {
      throw ApiError.unprocessable('Select an approved active barangay for this resident.');
    }
    if (municipalityId && municipalityId !== barangay.municipalityId) {
      throw ApiError.unprocessable('The selected barangay does not belong to the selected municipality.');
    }
    return {
      municipality_id: barangay.municipalityId,
      barangay_id: barangay.id,
      facility_id: null,
    };
  }

  const options = assignmentOptions || await repository.getAccountAssignmentOptions();
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

const makeStationAssignment = (role, input = []) => {
  if (!Array.isArray(input) || input.some((station) => typeof station !== 'string'
      || !RHU_STATION_VALUES.includes(station.trim().toLowerCase()))) {
    throw ApiError.unprocessable('Choose only supported RHU stations.');
  }
  const stations = normalizeStations(input);
  if (role === ROLES.RHU_PERSONNEL && stations.length === 0) {
    throw ApiError.unprocessable('Assign at least one valid RHU station to RHU Personnel.');
  }
  if (!STATION_ASSIGNED_ROLES.includes(role) && stations.length) {
    throw ApiError.unprocessable('This role cannot hold an RHU station assignment.');
  }
  return stations;
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

const requireInvitationDelivery = (user) => {
  if (user?.notification?.status === 'sent') return user;
  const status = String(user?.notification?.status || '').toLowerCase();
  const rawDeliveryCode = String(user?.notification?.lastErrorCode || status || '').toUpperCase();
  const deliveryCode = /^[A-Z0-9_]{1,64}$/.test(rawDeliveryCode) ? rawDeliveryCode : 'DELIVERY_UNCONFIRMED';
  const guidance = rawDeliveryCode === 'WORKER_ENVIRONMENT_NOT_ALLOWED'
    ? 'This local server cannot send notification jobs for the hosted project. Open the deployed KALUSAGAP site and resend the existing invitation.'
    : ['delivery_unknown', 'sending'].includes(status)
    ? 'Check Brevo delivery logs before resending to avoid a duplicate email.'
    : status === 'failed'
      ? 'Use the account’s Resend invitation action after correcting the email configuration.'
      : 'Retry this same account request with its saved operation reference.';
  throw new ApiError(503, `The account was created, but its invitation email was not confirmed (${deliveryCode}). ${guidance} Do not create another account.`)
    .withCode('ACCOUNT_CREATED_EMAIL_FAILED');
};

export const createUser = async ({ actor, actorId = actor?.id, input = {}, notificationProcessor = processPersonnelNotifications } = {}) => {
  input = validated(createUserValidator, input);
  const email = String(input.email ?? '').trim().toLowerCase();
  const fullName = String(input.fullName ?? input.name ?? '').trim();
  const firstName = String(input.firstName ?? '').trim();
  const role = String(input.role ?? '').trim();
  if (delegatedRole(actor) && !manageableRoles(actor).includes(role)) {
    throw ApiError.forbidden('You are not authorized to create an account for that role.');
  }
  const errors = [];
  if (email.length > 254 || !isEmail(email)) errors.push('Enter a valid email address.');
  if (!fullName || fullName.length > 120) errors.push('Name must be between 1 and 120 characters.');
  if (firstName && (role !== ROLES.BHW || firstName.length > 80 || !isValidPersonName(firstName))) {
    errors.push('Enter a valid BHW first name of at most 80 characters.');
  }
  if (!ASSIGNABLE_ROLES.includes(role) || role === ROLES.RESIDENT) {
    errors.push('Choose an assignable staff role. Resident accounts must use resident registration.');
  }
  const isHealthPersonnel = ['mho', 'phn', 'health_supervisor', 'rhu_personnel', 'bhw'].includes(role);
  if (isHealthPersonnel && !isStrictMobile(String(input.contact ?? ''))) {
    errors.push('Enter an 11-digit mobile number starting with 09 (e.g. 09171234567).');
  }
  if (errors.length) throw ApiError.unprocessable('Please correct the highlighted fields.', errors);

  const status = accountStatus(input.status, 'active');
  const approvalStatus = isHealthPersonnel ? 'approved' : input.approvalStatus;
  const activate = isHealthPersonnel ? true : input.activate ?? (status === 'active');
  const temporaryPassword = isHealthPersonnel ? generateTemporaryPassword() : null;
  const temporaryPasswordCiphertext = temporaryPassword ? encryptTemporaryPassword(temporaryPassword) : null;
  const assignmentOptions = isHealthPersonnel ? await repository.getAccountAssignmentOptions() : null;
  const piliMunicipality = assignmentOptions?.municipalities.find(
    (municipality) => municipality.name.trim().toLowerCase() === 'pili',
  );
  const authorizedMunicipality = delegatedRole(actor)
    ? assignmentOptions?.municipalities.find((municipality) => municipality.id === actor.municipalityId)
    : piliMunicipality;
  if (isHealthPersonnel && !authorizedMunicipality) {
    throw ApiError.unprocessable(delegatedRole(actor)
      ? 'Your assigned municipality is unavailable. Health personnel accounts cannot be created.'
      : 'The active Pili municipality is unavailable. Health personnel accounts cannot be created.');
  }
  if (delegatedRole(actor) && actor.role === ROLES.PHN && !actor.municipalityId) {
    throw ApiError.forbidden('Your account has no authorized municipality assignment.');
  }
  if (delegatedRole(actor) && actor.role === ROLES.HEALTH_SUPERVISOR && !actor.barangayId) {
    throw ApiError.forbidden('Your account has no assigned barangay.');
  }
  if (actor?.role === ROLES.HEALTH_SUPERVISOR && input.barangayId
      && String(input.barangayId).trim() !== actor.barangayId) {
    throw ApiError.unprocessable('BHW accounts must be assigned to your barangay.');
  }
  if (isHealthPersonnel && input.municipalityId && input.municipalityId !== authorizedMunicipality.id) {
    throw ApiError.unprocessable(delegatedRole(actor)
      ? 'Personnel accounts must remain within your assigned municipality.'
      : 'Health personnel accounts must be assigned to Pili.');
  }
  const scopedMunicipalityId = authorizedMunicipality?.id;
  const scopedBarangayId = actor?.role === ROLES.HEALTH_SUPERVISOR ? actor.barangayId : input.barangayId;
  const assignment = await makeProfileAssignment({
    role,
    municipalityId: isHealthPersonnel ? scopedMunicipalityId : input.municipalityId ? String(input.municipalityId).trim() : null,
    barangayId: scopedBarangayId ? String(scopedBarangayId).trim() : null,
    facilityId: input.facilityId ? String(input.facilityId).trim() : null,
    allowResident: false,
    assignmentOptions,
  });
  const profile = {
    email,
    full_name: fullName,
    ...(role === ROLES.BHW ? { first_name: firstName } : {}),
    role,
    status: approvalStatus === 'pending' ? 'pending_verification' : 'disabled',
    approval_status: approvalStatus,
    activation_requested: activate,
    must_change_password: Boolean(temporaryPassword),
    rhu_stations: makeStationAssignment(role, input.rhuStations),
    contact: normalizeOptionalText(input.contact),
    position: normalizeOptionalText(input.position),
    license_no: normalizeOptionalText(input.licenseNo),
    ...assignment,
  };

  const operationId = input.operationId;
  const reservation = await repository.reservePersonnelAccount({ actorId, operationId, profile, delegated: delegatedRole(actor) });
  if (!reservation?.target_id || !isUuid(reservation.target_id)) {
    throw new ApiError(503, 'Account reservation could not be confirmed. Retry with the same operation reference.');
  }
  if (!reservation.completed) {
    const createdId = await repository.createManagedAuthAccount({
      id: reservation.target_id,
      email,
      fullName,
      ...(temporaryPassword ? { temporaryPassword } : {}),
    });
    if (createdId !== reservation.target_id) throw new ApiError(502, 'Auth did not confirm the reserved account identity.');
  }
  // The SQL transaction records approval and an encrypted, durable email job.
  const user = await repository.createPersonnelAccountProfile({
    actorId,
    operationId,
    profile,
    temporaryPasswordCiphertext,
    delegated: delegatedRole(actor),
  });
  if (!user?.id || user.id !== reservation.target_id) {
    throw new ApiError(503, 'Account provisioning could not be confirmed. Retry with the same operation reference.');
  }
  if (role === ROLES.BHW && firstName) {
    await repository.updateBhwProfileFirstName({ id: user.id, actorId, firstName });
  }
  let createdUser = (await repository.getProfileById(user.id)) || user;
  const shouldSendCreationNotification = isHealthPersonnel
    || (role === ROLES.ADMIN && approvalStatus !== 'pending');
  if (shouldSendCreationNotification) {
    await notificationProcessor({ targetId: user.id });
    createdUser = (await repository.getProfileById(user.id)) || createdUser;
    requireInvitationDelivery(createdUser);
  }
  return createdUser;
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
export const updateUser = async ({ id, actor = null, actorId = actor?.id ?? null, patch = {} } = {}) => {
  patch = validated(updateUserValidator, patch);
  const existing = await repository.getProfileById(id);
  if (!existing) throw ApiError.notFound('User account not found');
  const nextRoleName = String(patch.role ?? existing.role).trim();
  const firstName = patch.firstName === undefined ? undefined : String(patch.firstName).trim();
  if (firstName !== undefined && (nextRoleName !== ROLES.BHW || (firstName && (firstName.length > 80 || !isValidPersonName(firstName))))) {
    throw ApiError.unprocessable('Enter a valid BHW first name of at most 80 characters.');
  }
  if (delegatedRole(actor)) {
    assertCanManageTarget(actor, existing);
    const assignmentFields = ['role', 'municipalityId', 'barangayId', 'facilityId', 'rhuStations', 'email', 'approvalStatus'];
    if (assignmentFields.some((field) => Object.hasOwn(patch, field))) {
      throw ApiError.forbidden('Delegated managers cannot change role, facility, station, or barangay assignments.');
    }
    const profile = {};
    if (patch.name !== undefined || patch.fullName !== undefined) {
      const name = String(patch.fullName ?? patch.name ?? '').trim();
      if (!name || name.length > 120) throw ApiError.unprocessable('Name must be between 1 and 120 characters.');
      profile.full_name = name;
    }
    if (patch.contact !== undefined) {
      const contact = normalizeOptionalText(patch.contact);
      if (contact && !isStrictMobile(contact)) throw ApiError.unprocessable('Enter an 11-digit mobile number starting with 09.');
      profile.contact = contact;
    }
    if (patch.position !== undefined) profile.position = normalizeOptionalText(patch.position);
    if (patch.licenseNo !== undefined) profile.license_no = normalizeOptionalText(patch.licenseNo);
    if (patch.status !== undefined) {
      const status = accountStatus(patch.status, existing.status);
      if (!['active', 'disabled'].includes(status)) throw ApiError.unprocessable('Choose Active or Deactivated.');
      if (status === 'active' && existing.approvalStatus !== 'approved') {
        throw ApiError.conflict('Approve this account before requesting activation.');
      }
      profile.status = status;
    }
    Object.assign(profile, {
      role: existing.role,
      municipality_id: existing.municipalityId,
      barangay_id: existing.barangayId,
      facility_id: existing.facilityId,
      rhu_stations: existing.rhuStations || [],
      expected_version: existing.lifecycleVersion,
    });
    if (!Object.keys(profile).length) throw ApiError.unprocessable('Provide at least one permitted profile change.');
    const updated = await repository.updatePersonnelAccountProfile({
      id,
      actorId,
      profile,
      operationId: patch.operationId ?? randomUUID(),
      delegated: true,
    });
    if (!updated) throw ApiError.notFound('Personnel account not found in your authorized scope.');
    if (firstName !== undefined) {
      await repository.updateBhwProfileFirstName({ id, actorId, firstName });
    }
    return (await repository.getProfileById(updated.id)) || updated;
  }

  const isResident = [ROLES.RESIDENT, ROLES.RESIDENT_LIMITED].includes(existing.role);
  const fields = {};
  const errors = [];

  let nextRole = existing.role;

  if (patch.name !== undefined || patch.fullName !== undefined) {
    const name = String(patch.fullName ?? patch.name ?? '').trim();
    if (!name || name.length > 120) errors.push('Name must be between 1 and 120 characters.');
    else fields.full_name = name;
  }
  if (firstName !== undefined) fields.first_name = firstName;
  if (patch.contact !== undefined) fields.contact = normalizeOptionalText(patch.contact);
  if (patch.position !== undefined) fields.position = normalizeOptionalText(patch.position);
  if (patch.licenseNo !== undefined) fields.license_no = normalizeOptionalText(patch.licenseNo);

  if (patch.role !== undefined && patch.role !== null && String(patch.role).trim() !== existing.role) {
    const role = String(patch.role).trim();
    if (!ASSIGNABLE_ROLES.includes(role)) {
      errors.push(`Role must be one of: ${ASSIGNABLE_ROLES.join(', ')}.`);
    } else {
      nextRole = role;
      fields.role = role;
    }
  }

  if (patch.contact !== undefined
      && ['mho', 'phn', 'health_supervisor', 'rhu_personnel', 'bhw'].includes(nextRole)
      && !isStrictMobile(normalizeOptionalText(patch.contact))) {
    errors.push('Enter an 11-digit mobile number starting with 09.');
  }

  let nextStatus = existing.status;
  if (patch.status !== undefined && patch.status !== null && String(patch.status).trim() !== '') {
    try {
      nextStatus = accountStatus(patch.status, existing.status, true);
      fields.status = nextStatus;
    } catch (error) {
      errors.push(error.message);
    }
  }

  if (errors.length) throw ApiError.unprocessable('Please correct the highlighted fields.', errors);

  if ([ROLES.RESIDENT, ROLES.RESIDENT_LIMITED].includes(nextRole) !== isResident) {
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
      && patch.facilityId === undefined
      && patch.rhuStations === undefined
      && firstName === undefined) return existing;

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
    if (!BARANGAY_SCOPED_ROLES.includes(nextRole) && !isResident) requestedBarangay = null;
    if (nextRole !== ROLES.RHU_PERSONNEL) requestedFacility = null;
    if (nextRole === ROLES.ADMIN) requestedMunicipality = null;
  }
  const assignmentChanged = nextRole !== existing.role
    || requestedMunicipality !== existing.municipalityId
    || requestedBarangay !== existing.barangayId
    || requestedFacility !== existing.facilityId;
  const assignment = assignmentChanged
    ? await makeProfileAssignment({
      role: nextRole === ROLES.RESIDENT_LIMITED ? ROLES.RESIDENT : nextRole,
      municipalityId: requestedMunicipality,
      barangayId: requestedBarangay,
      facilityId: requestedFacility,
      allowResident: isResident,
    })
    : {
      municipality_id: existing.municipalityId,
      barangay_id: existing.barangayId,
      facility_id: existing.facilityId,
    };
  const profile = {
    email: existing.email,
    full_name: fields.full_name ?? existing.name,
    ...(firstName !== undefined ? { first_name: firstName } : {}),
    contact: fields.contact ?? existing.contact,
    position: fields.position ?? existing.position,
    license_no: fields.license_no ?? existing.licenseNo,
    role: nextRole,
    ...(fields.status !== undefined ? { status: nextStatus } : {}),
    ...(!isResident ? { expected_version: existing.lifecycleVersion } : {}),
    rhu_stations: existing.rhuStations ?? [],
    ...assignment,
  };
  const stationsChanged = patch.rhuStations !== undefined
    && JSON.stringify(patch.rhuStations) !== JSON.stringify(existing.rhuStations ?? []);
  if (stationsChanged || nextRole !== existing.role || (assignmentChanged && nextRole === ROLES.RHU_PERSONNEL)) {
    const requestedStations = patch.rhuStations === undefined
      ? (STATION_ASSIGNED_ROLES.includes(nextRole) ? existing.rhuStations ?? [] : [])
      : patch.rhuStations;
    profile.rhu_stations = makeStationAssignment(nextRole, requestedStations);
  }
  if (patch.suspensionReason !== undefined) profile.suspension_reason = normalizeOptionalText(patch.suspensionReason);
  if (!isResident && nextStatus === 'active'
      && nextStatus !== existing.status && existing.approvalStatus !== 'approved') {
    throw ApiError.conflict('Approve this account before requesting activation.');
  }
  const updated = isResident
    ? await repository.updateAdminAccountProfile({ id, actorId, profile })
    : await repository.updatePersonnelAccountProfile({ id, actorId, profile, operationId: patch.operationId ?? randomUUID() });
  if (!updated) throw ApiError.notFound('User account not found');
  if (firstName !== undefined) {
    await repository.updateBhwProfileFirstName({ id, actorId, firstName });
  }
  return (await repository.getProfileById(updated.id)) || updated;
};

export const transitionUserLifecycle = async ({ id, actor = null, actorId = actor?.id, input = {} } = {}) => {
  if (typeof id !== 'string' || !isUuid(id)) throw ApiError.badRequest('Use a valid account UUID.');
  const action = validated(personnelLifecycleValidator, input);
  if (delegatedRole(actor) || (actor?.role === ROLES.ADMIN && action.action === 'invite')) {
    if (action.action !== 'invite') throw ApiError.forbidden('Only password setup invitations are available to delegated account managers.');
    const target = await repository.getProfileById(id);
    if (!target) throw ApiError.notFound('Personnel account not found in your authorized scope.');
    assertCanManageTarget(actor, target);
    const invited = await repository.resendScopedPersonnelInvitation({ id, actorId, operationId: action.operationId });
    if (!invited) throw ApiError.notFound('Personnel account not found in your authorized scope.');
    await processPersonnelNotifications({ targetId: id });
    return requireInvitationDelivery((await repository.getProfileById(id)) || invited);
  }
  if (actorId === id && ['approve', 'reject', 'suspend', 'reactivate'].includes(action.action)) {
    throw ApiError.conflict('You cannot approve or change your own administrator access.');
  }
  const user = await repository.transitionPersonnelAccount({ id, actorId, ...action });
  if (!user) throw ApiError.notFound('User account not found');
  return (await repository.getProfileById(user.id)) || user;
};

export const getUserHistory = async ({ id, actor = null } = {}) => {
  await getUser({ id, actor });
  const request = await getAccountRequestHistory({ accountId: id });
  const history = await repository.getPersonnelAccountHistory({ id, requestId: request?.id });
  return { ...history, ...(request ? { request } : {}) };
};

export const resetUserAccess = async ({ id, actorId, operationId } = {}) => {
  const user = await repository.getProfileById(id);
  if (!user) throw ApiError.notFound('User account not found');
  if (user.setupRequired && user.lifecycleVersion !== null) {
    const updated = await transitionUserLifecycle({ id, actorId, input: { action: 'invite', operationId: operationId ?? randomUUID() } });
    return { sent: false, queued: true, user: updated };
  }
  await repository.sendAccountRecoveryEmail({ user, actorId });
  return { requested: true, deliveryStatus: 'unverified' };
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
 * Health personnel use suspension instead: their historical requests,
 * documents and assignments have cascading Auth foreign keys. General account
 * deletion keeps its existing cascade behavior. The database preflight lock
 * ends before the separate Auth call; it is not a cross-service transaction.
 * The deletion audit is written only after Auth confirms success.
 */
export const deleteUser = async ({ id, actorId, confirmEmail } = {}) => {
  const targetId = String(id ?? '').trim();
  if (!targetId) throw ApiError.badRequest('A target account id is required.');

  const existing = await repository.getProfileById(targetId);
  if (!existing) throw ApiError.notFound('User account not found');

  const healthRoles = [ROLES.MHO, ROLES.PHN, ROLES.HEALTH_SUPERVISOR, ROLES.RHU_PERSONNEL, ROLES.BHW];
  if (healthRoles.includes(existing.role)) {
    throw ApiError.conflict('Health personnel accounts must be suspended, not permanently deleted, so their requests, documents and operational history are preserved.');
  }

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
  if (healthRoles.includes(snapshot?.role)) {
    throw ApiError.conflict('This account is now health personnel. Suspend access to preserve its operational history.');
  }

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
  makeProfileAssignment,
  transitionUserLifecycle,
  getUserHistory,
  resetUserAccess,
  deleteUser,
};
