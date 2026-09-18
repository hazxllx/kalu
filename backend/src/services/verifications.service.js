/**
 * Resident verification service — manual Health Supervisor review.
 *
 * Workflow:
 *   resident registers            -> verification_status = 'pending'
 *   HS/PHN approves               -> 'approved'  + profiles.status = 'active'
 *   HS/PHN rejects (reason req.)  -> 'rejected'  + profiles.status = 'pending_verification'
 *   HS/PHN requests resubmission  -> 'resubmission_required'
 *   resident resubmits            -> 'pending'
 *
 * Every decision writes an immutable row to `resident_verification_logs`.
 *
 * Barangay scoping is enforced HERE, at the data layer: a Health Supervisor
 * assigned to one barangay only ever sees and decides on that barangay's
 * residents. Out-of-scope references read as "not found" so the API never
 * confirms another barangay's records. The reviewer identity always comes from
 * the authenticated session, never from the request body.
 */
import ApiError from '../utils/apiError.js';
import repository from '../repositories/index.js';
import { assignedBarangay } from '../config/scope.js';

export const VERIFICATION_STATUS = Object.freeze({
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  RESUBMISSION_REQUIRED: 'resubmission_required',
});

export const ALL_VERIFICATION_STATUSES = Object.freeze(Object.values(VERIFICATION_STATUS));

const STAFF_ROLES = Object.freeze(['health_supervisor', 'phn']);
const SELF_ROLES = Object.freeze(['resident', 'resident-limited']);

export const REJECTION_REASONS = Object.freeze([
  'Invalid information',
  'Insufficient proof of residency',
  'Duplicate registration',
  'Information does not match',
  'Other',
]);

const isStaff = (user) => STAFF_ROLES.includes(user?.role);
const isSelf = (user) => SELF_ROLES.includes(user?.role);

const assertStaff = (user) => {
  if (!isStaff(user)) {
    throw ApiError.forbidden('Only a Health Supervisor or PHN may review resident verifications.');
  }
};

const scopeOf = (user) => assignedBarangay(user);

const fullName = (r) =>
  [r?.firstName, r?.middleName, r?.lastName, r?.suffix]
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

const ageFrom = (birthDate) => {
  if (!birthDate) return '';
  const dob = new Date(birthDate);
  if (Number.isNaN(dob.getTime())) return '';
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const m = now.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) age -= 1;
  return age >= 0 ? age : '';
};

/** Domain resident -> verification record returned to the UI. */
const toVerification = (resident) => {
  if (!resident) return null;
  return {
    ref: resident.id,
    id: resident.id,
    name: fullName(resident),
    firstName: resident.firstName || '',
    middleName: resident.middleName || '',
    lastName: resident.lastName || '',
    suffix: resident.suffix || '',
    barangay: resident.barangay || '',
    contactNumber: resident.cellphoneNo || '',
    birthDate: resident.birthDate || '',
    age: ageFrom(resident.birthDate),
    sex: resident.sex || '',
    civilStatus: resident.civilStatus || '',
    address: resident.currentAddress || resident.permanentAddress || '',
    philhealthNo: resident.philhealthNo || '',
    registeredDate: resident.createdAt || null,
    submittedAt: resident.submittedForVerificationAt || resident.createdAt || null,
    status: resident.verificationStatus || VERIFICATION_STATUS.PENDING,
    verifiedBy: resident.verifiedBy || null,
    verifiedAt: resident.verifiedAt || null,
    rejectionReason: resident.rejectionReason || '',
    updatedAt: resident.updatedAt || null,
  };
};

/** Out-of-scope records are indistinguishable from missing ones. */
const assertInScope = (user, resident) => {
  if (!resident) throw ApiError.notFound('Resident record not found');
  const scope = scopeOf(user);
  if (scope) {
    if (String(resident.barangay || '').trim().toLowerCase() !== scope.toLowerCase()) {
      throw ApiError.notFound('Resident record not found');
    }
    return;
  }
  // Municipality-wide staff: enforce the municipality when both sides know it.
  if (user?.municipalityId && resident.municipalityId && resident.municipalityId !== user.municipalityId) {
    throw ApiError.notFound('Resident record not found');
  }
};

const requireResident = async (id) => {
  const resident = await repository.getResident(id);
  if (!resident) throw ApiError.notFound('Resident record not found');
  return resident;
};

const requireStaffResident = async (user, id) => {
  assertStaff(user);
  const resident = await requireResident(id);
  assertInScope(user, resident);
  return resident;
};

const writeLog = async ({ residentId, reviewerId = null, action, reason = '', previousStatus, newStatus }) =>
  repository.insertResidentVerificationLog({
    residentId,
    reviewedBy: reviewerId,
    action,
    reason,
    previousStatus,
    newStatus,
  });

/**
 * Keep the account status in step with the verification outcome. Access is
 * controlled by `profiles.status` (pending_verification -> resident-limited),
 * so an approved resident must be activated and a non-approved resident kept
 * limited. A failure here never rolls back the recorded decision (the audit log
 * is the source of truth) but is surfaced in the server log.
 */
const syncAccountStatus = async (resident, status) => {
  if (!resident?.authUserId) return;
  const profileStatus = status === VERIFICATION_STATUS.APPROVED ? 'active' : 'pending_verification';
  try {
    await repository.setProfileStatus(resident.authUserId, profileStatus);
  } catch (err) {
    console.error(`Resident verification: could not sync profile status for ${resident.id}: ${err.message}`);
  }
};

/**
 * Verification queue for staff, filtered by status and the caller's scope.
 * `status` accepts one of the four statuses, or 'all'.
 */
export const listQueue = async ({ user, status = 'pending', q = '', limit = 100, offset = 0 } = {}) => {
  assertStaff(user);

  const requested = String(status || 'all').trim().toLowerCase();
  let statuses = null;
  if (requested && requested !== 'all') {
    if (!ALL_VERIFICATION_STATUSES.includes(requested)) {
      throw ApiError.badRequest('Unknown verification status filter.');
    }
    statuses = [requested];
  }

  const scope = scopeOf(user);
  const { rows, total } = await repository.listResidentsByVerificationStatus({
    statuses,
    q: String(q || '').trim(),
    barangay: scope,
    municipalityId: user?.municipalityId || null,
    limit: Math.min(Math.max(Number(limit) || 100, 1), 200),
    offset: Math.max(Number(offset) || 0, 0),
  });

  return { rows: rows.map(toVerification), total, status: requested || 'all' };
};

/** Single resident verification record + its audit history (staff, scoped). */
export const getVerification = async ({ user, id }) => {
  const resident = await requireStaffResident(user, id);
  const history = await repository.listResidentVerificationLogs(resident.id, { limit: 100 });
  return { verification: toVerification(resident), history };
};

/** Recent decisions across the caller's scope, for the history table. */
export const listHistory = async ({ user, limit = 100, offset = 0 } = {}) => {
  assertStaff(user);
  const scope = scopeOf(user);
  const { rows, total } = await repository.listRecentResidentVerificationLogs({
    barangay: scope,
    municipalityId: user?.municipalityId || null,
    limit: Math.min(Math.max(Number(limit) || 100, 1), 200),
    offset: Math.max(Number(offset) || 0, 0),
  });
  return { rows, total };
};

/** Approve a pending / resubmission-required resident. */
export const approve = async ({ user, id, remarks = '' } = {}) => {
  const resident = await requireStaffResident(user, id);
  const current = resident.verificationStatus || VERIFICATION_STATUS.PENDING;

  if (current === VERIFICATION_STATUS.APPROVED) {
    throw ApiError.conflict('This resident is already approved.');
  }
  if (current === VERIFICATION_STATUS.REJECTED) {
    throw ApiError.conflict('This resident was rejected. Request resubmission before approving.');
  }

  const updated = await repository.updateResident(resident.id, {
    verificationStatus: VERIFICATION_STATUS.APPROVED,
    verifiedBy: user.id,
    verifiedAt: new Date().toISOString(),
    rejectionReason: '',
  });

  await writeLog({
    residentId: resident.id,
    reviewerId: user.id,
    action: 'approved',
    reason: String(remarks || '').trim(),
    previousStatus: current,
    newStatus: VERIFICATION_STATUS.APPROVED,
  });
  await syncAccountStatus(resident, VERIFICATION_STATUS.APPROVED);

  return toVerification(updated);
};

/** Reject a pending / resubmission-required resident. A reason is required. */
export const reject = async ({ user, id, reason, remarks = '' } = {}) => {
  const resident = await requireStaffResident(user, id);
  const current = resident.verificationStatus || VERIFICATION_STATUS.PENDING;

  if (current === VERIFICATION_STATUS.APPROVED) {
    throw ApiError.conflict('This resident is already approved.');
  }
  if (current === VERIFICATION_STATUS.REJECTED) {
    throw ApiError.conflict('This resident is already rejected.');
  }

  const trimmedReason = String(reason || '').trim();
  if (!trimmedReason) throw ApiError.badRequest('A rejection reason is required.');
  const trimmedRemarks = String(remarks || '').trim();
  if (trimmedReason === 'Other' && !trimmedRemarks) {
    throw ApiError.badRequest('Please provide remarks when choosing "Other".');
  }
  const storedReason = trimmedRemarks ? `${trimmedReason} — ${trimmedRemarks}` : trimmedReason;

  const updated = await repository.updateResident(resident.id, {
    verificationStatus: VERIFICATION_STATUS.REJECTED,
    verifiedBy: user.id,
    verifiedAt: new Date().toISOString(),
    rejectionReason: storedReason,
  });

  await writeLog({
    residentId: resident.id,
    reviewerId: user.id,
    action: 'rejected',
    reason: storedReason,
    previousStatus: current,
    newStatus: VERIFICATION_STATUS.REJECTED,
  });
  await syncAccountStatus(resident, VERIFICATION_STATUS.REJECTED);

  return toVerification(updated);
};

/**
 * Ask the resident to correct/resubmit. Recorded as a 'rejected' audit action
 * (the allowed action set has no dedicated "resubmission requested" value) with
 * new_status 'resubmission_required', so the reason and reviewer are preserved.
 */
export const requestResubmission = async ({ user, id, reason, remarks = '' } = {}) => {
  const resident = await requireStaffResident(user, id);
  const current = resident.verificationStatus || VERIFICATION_STATUS.PENDING;

  if (![VERIFICATION_STATUS.PENDING, VERIFICATION_STATUS.REJECTED].includes(current)) {
    throw ApiError.conflict('Resubmission can only be requested for a pending or rejected registration.');
  }

  const trimmedReason = String(reason || '').trim();
  if (!trimmedReason) throw ApiError.badRequest('A reason is required when requesting resubmission.');
  const trimmedRemarks = String(remarks || '').trim();
  const storedReason = trimmedRemarks ? `${trimmedReason} — ${trimmedRemarks}` : trimmedReason;

  const updated = await repository.updateResident(resident.id, {
    verificationStatus: VERIFICATION_STATUS.RESUBMISSION_REQUIRED,
    verifiedBy: user.id,
    verifiedAt: new Date().toISOString(),
    rejectionReason: storedReason,
  });

  await writeLog({
    residentId: resident.id,
    reviewerId: user.id,
    action: 'rejected',
    reason: storedReason,
    previousStatus: current,
    newStatus: VERIFICATION_STATUS.RESUBMISSION_REQUIRED,
  });
  await syncAccountStatus(resident, VERIFICATION_STATUS.RESUBMISSION_REQUIRED);

  return toVerification(updated);
};

/** Resident resubmits their own rejected / resubmission-required registration. */
export const resubmit = async ({ user, id } = {}) => {
  if (!isSelf(user)) {
    throw ApiError.forbidden('Only the resident may resubmit their own registration.');
  }
  const resident = await repository.getResidentByAuthUserId(user.id);
  if (!resident) throw ApiError.notFound('Your resident record was not found.');
  if (id && String(id) !== String(resident.id)) {
    throw ApiError.forbidden('You can only resubmit your own registration.');
  }

  const current = resident.verificationStatus || VERIFICATION_STATUS.PENDING;
  if (![VERIFICATION_STATUS.REJECTED, VERIFICATION_STATUS.RESUBMISSION_REQUIRED].includes(current)) {
    throw ApiError.conflict('Your registration is not awaiting resubmission.');
  }

  const updated = await repository.updateResident(resident.id, {
    verificationStatus: VERIFICATION_STATUS.PENDING,
    rejectionReason: '',
    submittedForVerificationAt: new Date().toISOString(),
    verifiedBy: null,
    verifiedAt: null,
  });

  await writeLog({
    residentId: resident.id,
    reviewerId: null,
    action: 'resubmitted',
    reason: '',
    previousStatus: current,
    newStatus: VERIFICATION_STATUS.PENDING,
  });
  await syncAccountStatus(resident, VERIFICATION_STATUS.PENDING);

  return toVerification(updated);
};

/** The signed-in resident's own verification status + history. */
export const getMine = async ({ user } = {}) => {
  if (!isSelf(user)) throw ApiError.forbidden('Only a resident may view their own verification status.');
  const resident = await repository.getResidentByAuthUserId(user.id);
  if (!resident) {
    return { hasResidentRecord: false, verification: null, history: [] };
  }
  const history = await repository.listResidentVerificationLogs(resident.id, { limit: 50 });
  return { hasResidentRecord: true, verification: toVerification(resident), history };
};

// ---------------------------------------------------------------------------
// Backward-compatible helpers (existing routes/consumers)
// ---------------------------------------------------------------------------
export const listPending = async ({ user }) => (await listQueue({ user, status: 'pending' })).rows;

export const decide = async ({ ref, decision, reason, remarks, user }) => {
  if (decision === 'approved') return approve({ user, id: ref, remarks });
  if (decision === 'rejected') return reject({ user, id: ref, reason, remarks });
  throw ApiError.badRequest('Decision must be "approved" or "rejected".');
};

export default {
  VERIFICATION_STATUS,
  ALL_VERIFICATION_STATUSES,
  REJECTION_REASONS,
  listQueue,
  listHistory,
  getVerification,
  approve,
  reject,
  requestResubmission,
  resubmit,
  getMine,
  listPending,
  decide,
};
