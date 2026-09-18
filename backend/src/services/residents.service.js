/**
 * Resident record service (authorized health staff).
 *
 * Used by the PHN during processing and by authorized staff for record
 * maintenance. The intake path (search/prefill) lives in `intake.service.js`;
 * these endpoints operate on the master resident record.
 *
 * Enforced here:
 *   - directory reads are limited to PHN / Health Supervisor / MHO,
 *   - profile corrections may be made by the PHN / Health Supervisor only,
 *   - a finalized referral keeps its own frozen snapshot, so editing a profile
 *     never silently rewrites an already-printed referral.
 */
import ApiError from '../utils/apiError.js';
import repository from '../repositories/index.js';
import { assignedBarangay } from '../config/scope.js';

const EDITABLE_RESIDENT_KEYS = [
  'suffix',
  'birthPlace',
  'civilStatus',
  'religion',
  'employmentStatus',
  'fatherName',
  'motherName',
  'is4PsMember',
  'philhealthNo',
  'currentAddress',
  'permanentAddress',
  'cellphoneNo',
  'identityNo',
  'barangay',
];

const isReadRole = (user) => ['phn', 'health_supervisor', 'mho'].includes(user?.role);
const isEditRole = (user) => ['phn', 'health_supervisor'].includes(user?.role);
const isCreateRole = (user) => ['phn', 'health_supervisor', 'mho'].includes(user?.role);

const VALID_SEX = Object.freeze(['Male', 'Female']);

const parsePositiveInt = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

/**
 * Scope-aware directory listing for authorized staff.
 *
 *   - A barangay-scoped caller (Health Supervisor) only ever sees their own
 *     barangay; requesting another one is rejected with 403.
 *   - Municipality-wide callers (PHN / MHO) see their municipality and may
 *     drill down with ?barangay=.
 *
 * The repository additionally filters on municipality_id, and Supabase RLS
 * re-checks the same scope at the database level.
 */
export const listResidents = async ({ user, q = '', barangay = '', limit = 50, offset = 0 } = {}) => {
  const scope = assignedBarangay(user);
  const requested = String(barangay || '').trim();
  if (scope && requested && requested.toLowerCase() !== scope.toLowerCase()) {
    throw ApiError.forbidden('Your account is assigned to Barangay ' + scope + ' only');
  }
  const effectiveBarangay = scope || requested || null;
  const parsedLimit = Math.min(parsePositiveInt(limit, 50), 100);
  const parsedOffset = Math.max(Number.parseInt(offset, 10) || 0, 0);

  return repository.listResidents({
    q: String(q || '').trim(),
    limit: parsedLimit,
    offset: parsedOffset,
    barangay: effectiveBarangay,
    municipalityId: user?.municipalityId || null,
  });
};

/**
 * Register a new resident record. Identity fields are validated (422), the
 * barangay must exist within the caller's scope, and an identical
 * name + birth-date record in the same barangay is rejected with 409.
 */
export const createResident = async ({ user, payload = {} }) => {
  if (!isCreateRole(user)) {
    throw ApiError.forbidden('Your role is not permitted to register residents');
  }

  const text = (value) => String(value ?? '').trim();
  const firstName = text(payload.firstName);
  const middleName = text(payload.middleName);
  const lastName = text(payload.lastName);
  const suffix = text(payload.suffix);
  const birthDate = text(payload.birthDate);
  const sex = text(payload.sex);
  const barangay = text(payload.barangay);

  const errors = [];
  if (!firstName) errors.push('First name is required.');
  if (!lastName) errors.push('Last name is required.');
  if (!birthDate) errors.push('Date of birth is required.');
  else {
    const dob = new Date(birthDate);
    if (Number.isNaN(dob.getTime())) errors.push('Date of birth is invalid.');
    else if (dob.getTime() > Date.now()) errors.push('Date of birth cannot be in the future.');
  }
  if (!sex) errors.push('Sex is required.');
  else if (!VALID_SEX.includes(sex)) errors.push('Sex must be "Male" or "Female".');
  if (!barangay) errors.push('Barangay is required.');
  if (errors.length) {
    throw ApiError.unprocessable('Please correct the highlighted fields.', errors);
  }

  // Barangay must be within the caller's assignment / municipality.
  const scope = assignedBarangay(user);
  if (scope && barangay.toLowerCase() !== scope.toLowerCase()) {
    throw ApiError.forbidden('Your account is assigned to Barangay ' + scope + ' only');
  }
  const barangayRow = await repository.findBarangayByName(barangay, user?.municipalityId || null);
  if (!barangayRow) {
    throw ApiError.unprocessable(`Unknown barangay: ${barangay}. It must belong to your municipality.`);
  }

  // Duplicate guard: identical identity in the same barangay is a conflict.
  // (The same person moving barangays is a legitimate transfer, not a duplicate.)
  const duplicate = await repository.findResidentByIdentity({ lastName, firstName, middleName, birthDate });
  if (duplicate && String(duplicate.barangay || '').toLowerCase() === barangay.toLowerCase()) {
    throw ApiError.conflict(
      `A resident with the same name and date of birth is already registered in ${barangay} (${duplicate.healthRecordNo || duplicate.id}).`,
    );
  }

  const ids = await repository.nextResidentIds();
  return repository.insertResident({
    ...ids,
    firstName,
    middleName,
    lastName,
    suffix,
    birthDate,
    birthPlace: text(payload.birthPlace),
    sex,
    civilStatus: text(payload.civilStatus),
    religion: text(payload.religion),
    employmentStatus: text(payload.employmentStatus),
    fatherName: text(payload.fatherName),
    motherName: text(payload.motherName),
    is4PsMember: Boolean(payload.is4PsMember),
    philhealthNo: text(payload.philhealthNo),
    currentAddress: text(payload.currentAddress),
    permanentAddress: text(payload.permanentAddress),
    cellphoneNo: text(payload.cellphoneNo),
    identityNo: text(payload.identityNo),
    barangay: barangayRow.name,
    createdById: user?.id || '',
    createdByRole: user?.role || '',
  });
};

/**
 * Barangay guard: a barangay-scoped caller (e.g. a Health Supervisor assigned
 * to San Isidro) may only read or write residents of their own barangay.
 * Out-of-scope records read as "not found" so the API never confirms the
 * existence of another barangay's data.
 */
const assertWithinScope = (user, resident) => {
  const scope = assignedBarangay(user);
  if (!scope) return;
  if (String(resident?.barangay ?? '').trim().toLowerCase() !== scope.toLowerCase()) {
    throw ApiError.notFound('Resident record not found');
  }
};

export const getResident = async ({ id, user }) => {
  if (!isReadRole(user)) throw ApiError.notFound('Resident record not found');
  const resident = await repository.getResident(id);
  if (!resident) throw ApiError.notFound('Resident record not found');
  assertWithinScope(user, resident);
  return resident;
};

export const updateResident = async ({ id, patch = {}, user }) => {
  if (!isEditRole(user)) throw ApiError.forbidden('Your role is not permitted to edit resident records');

  const existing = await repository.getResident(id);
  if (!existing) throw ApiError.notFound('Resident record not found');
  assertWithinScope(user, existing);

  const updates = {};
  for (const key of EDITABLE_RESIDENT_KEYS) {
    if (patch[key] !== undefined) updates[key] = patch[key];
  }
  updates.barangay = String(patch.barangay ?? existing.barangay ?? '').trim();

  // A barangay-scoped caller cannot move a resident into another barangay —
  // that would either hide the record or claim it for another area.
  const scope = assignedBarangay(user);
  if (scope && updates.barangay.toLowerCase() !== scope.toLowerCase()) {
    throw ApiError.forbidden('Your account is assigned to Barangay ' + scope + ' only');
  }

  updates.currentAddress = String(patch.currentAddress ?? existing.currentAddress ?? '').trim();
  updates.permanentAddress = String(patch.permanentAddress ?? existing.permanentAddress ?? '').trim();
  updates.cellphoneNo = String(patch.cellphoneNo ?? existing.cellphoneNo ?? '').trim();
  updates.philhealthNo = String(patch.philhealthNo ?? existing.philhealthNo ?? '').trim();

  // Identity keys (name, DOB) are not editable here to avoid silently
  // splitting a resident's health record; corrections go through an admin.
  return repository.updateResident(id, updates);
};

export default { getResident, updateResident };
