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
import { assignedBarangay, organizationScope } from '../config/scope.js';

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
  const resident = await repository.getResident(id, organizationScope(user));
  if (!resident) throw ApiError.notFound('Resident record not found');
  assertWithinScope(user, resident);
  return resident;
};

export const updateResident = async ({ id, patch = {}, user }) => {
  if (!isEditRole(user)) throw ApiError.forbidden('Your role is not permitted to edit resident records');

  const existing = await repository.getResident(id, organizationScope(user));
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
