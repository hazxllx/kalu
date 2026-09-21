/**
 * Household Profiling service (BHW collection -> HS verification -> risk).
 *
 * Scope rules (mirrored by the database RLS policies):
 *   - barangay-scoped callers (BHW, Health Supervisor) only ever see their own
 *     barangay's households; anything else is a 404 (out of scope) or 403
 *     (explicit cross-barangay request);
 *   - PHN sees the municipality and may drill down by barangay;
 *   - residents have no household access at all.
 *
 * The risk classification is recomputed server-side on every write from the
 * ported household-risk rules (utils/householdRisk.js) — a score sent by the
 * client is never stored. Verification outcomes are Health-Supervisor-only
 * (additionally guarded by a database trigger).
 */
import ApiError from '../utils/apiError.js';
import repository from '../repositories/index.js';
import { computeHouseholdRisk, householdFlags } from '../utils/householdRisk.js';
import { assignedBarangay } from '../config/scope.js';

const READ_ROLES = ['bhw', 'health_supervisor', 'phn'];
const WRITE_ROLES = ['bhw', 'health_supervisor', 'phn'];
const VERIFY_ROLES = ['health_supervisor'];

const HH_STATUSES = [
  'Pending', 'Ongoing', 'Submitted', 'Needs Update', 'Approved', 'Refused',
  'For Masterlist Update', 'Non-Eligible', 'Duplicate', 'Migrated', 'Other',
];
const APPROVAL_STATUSES = ['Not yet approved', 'Approved', 'Needs revision'];
const WATER_SOURCES = ['level1', 'level2', 'level3', 'unimproved'];
const TOILET_TYPES = ['ws_own', 'ws_shared', 'open_pit', 'antipolo', 'none'];
const VERIFICATION_STATUSES = ['Pending Verification', 'Verified', 'Returned for Correction'];

const text = (value) => String(value ?? '').trim();

/** True when the household is outside the caller's scope (treated as absent). */
const outOfScope = (household, user) => {
  const scope = assignedBarangay(user);
  if (scope) return (household.barangay || '').toLowerCase() !== scope.toLowerCase();
  return Boolean(user?.municipalityId) && household.municipalityId !== user.municipalityId;
};

const VERIFICATION_FIELDS = ['verificationStatus', 'verifiedBy', 'verifiedAt', 'correctionReason'];

/** Load a household and enforce scope; throws 404 when out of scope/absent. */
const getScopedHousehold = async (id, user) => {
  const household = await repository.getHousehold(id);
  if (!household || outOfScope(household, user)) {
    throw ApiError.notFound('Household not found');
  }
  return household;
};

/** Re-run the server-side risk classification from stored + patched data. */
const recomputeRisk = (household, patch = {}, members) => {
  const roster = members || household.members || [];
  const computed = computeHouseholdRisk({
    waterSource: patch.waterSource ?? household.waterSource,
    toilet: patch.toiletType ?? household.toiletType,
    sanitationAccess: patch.sanitationAccess ?? household.sanitationAccess,
    members: roster.map((m) => ({ classification: m.classification, pwd: m.isPwd ?? m.pwd, name: m.name, age: m.age, philhealth: m.philhealth })),
    income: patch.monthlyIncome ?? household.monthlyIncome,
  });
  const flags = householdFlags({
    waterSource: patch.waterSource ?? household.waterSource,
    toilet: patch.toiletType ?? household.toiletType,
    members: roster.map((m) => ({ name: m.name, age: m.age, philhealth: m.philhealth })),
  });
  return { riskScore: computed.score, riskLevel: computed.level, riskFactors: computed.factors, flags };
};

/** Validate + normalize members attached to a create/update payload. */
export const normalizeMembers = (members) => {
  if (members === undefined || members === null) return { members: undefined, errors: [] };
  if (!Array.isArray(members)) return { members: undefined, errors: ['Members must be a list.'] };
  const errors = [];
  const normalized = members.map((m, i) => {
    const name = text(m.name);
    if (!name) errors.push(`Member ${i + 1}: name is required.`);
    const age = m.age === '' || m.age === null || m.age === undefined ? null : Number(m.age);
    if (age !== null && (!Number.isFinite(age) || age < 0 || age > 120)) {
      errors.push(`Member ${i + 1}: age must be between 0 and 120.`);
    }
    return {
      name,
      birthday: text(m.birthday),
      age,
      sex: m.sex === 'Male' || m.sex === 'Female' ? m.sex : '',
      classification: text(m.classification),
      relationship: text(m.relationship),
      contact: text(m.contact) || null,
      isPwd: Boolean(m.isPwd ?? m.pwd),
      philhealth: m.philhealth === 'member' || m.philhealth === 'non-member' ? m.philhealth : '',
      fpMethod: text(m.fpMethod),
      quarterStatus: text(m.quarterStatus),
      isHead: text(m.relationship) === 'Head' || Boolean(m.isHead),
    };
  });
  return { members: normalized, errors };
};

export const listHouseholds = async ({ user, q = '', barangay = '', limit = 50, offset = 0 } = {}) => {
  const scope = assignedBarangay(user);
  const requested = text(barangay);
  if (scope && requested && requested.toLowerCase() !== scope.toLowerCase()) {
    throw ApiError.forbidden('Your account is assigned to Barangay ' + scope + ' only');
  }
  const parsedLimit = Math.min(Math.max(Number.parseInt(limit, 10) || 50, 1), 100);
  const parsedOffset = Math.max(Number.parseInt(offset, 10) || 0, 0);
  return repository.listHouseholds({
    q: text(q),
    limit: parsedLimit,
    offset: parsedOffset,
    barangay: scope || requested || null,
    municipalityId: user?.municipalityId || null,
  });
};

export const getHousehold = async ({ id, user }) => {
  return getScopedHousehold(id, user);
};

export const createHousehold = async ({ user, payload = {} }) => {
  if (!READ_ROLES.includes(user?.role)) throw ApiError.forbidden();

  const barangayName = text(payload.barangay);
  const errors = [];
  const headName = text(payload.headName ?? payload.head);
  const purok = text(payload.purok);
  const streetAddress = text(payload.streetAddress);
  const families = payload.families === undefined || payload.families === '' ? 1 : Number(payload.families);
  const waterSource = text(payload.waterSource);
  const toiletType = text(payload.toiletType ?? payload.toilet);

  if (!headName) errors.push('Household head name is required.');
  if (!purok) errors.push('Purok/Zone is required.');
  if (!streetAddress) errors.push('Street address / sitio is required.');
  if (!barangayName) errors.push('Barangay is required.');
  if (!Number.isFinite(families) || families < 1) errors.push('There must be at least 1 family.');
  if (waterSource && !WATER_SOURCES.includes(waterSource)) errors.push('Invalid water source.');
  if (toiletType && !TOILET_TYPES.includes(toiletType)) errors.push('Invalid toilet facility type.');
  const { members, errors: memberErrors } = normalizeMembers(payload.members);
  errors.push(...memberErrors);
  if (errors.length) throw ApiError.unprocessable('Please complete the required household fields.', errors);

  // Barangay must exist and be inside the caller's scope — never trusted.
  const scope = assignedBarangay(user);
  if (scope && barangayName.toLowerCase() !== scope.toLowerCase()) {
    throw ApiError.forbidden('Your account is assigned to Barangay ' + scope + ' only');
  }
  const barangayRow = await repository.findBarangayByName(barangayName, user?.municipalityId || null);
  if (!barangayRow) {
    throw ApiError.unprocessable(`Unknown barangay: ${barangayName}. It must belong to your municipality.`);
  }

  // Duplicate guard: same head + purok + street address within the barangay.
  const duplicate = await repository.findHouseholdDuplicate({
    barangayId: barangayRow.id,
    headName,
    purok,
    streetAddress,
  });
  if (duplicate) {
    throw ApiError.conflict(`A household for ${headName} at that address is already registered (${duplicate.id}).`);
  }

  const ids = await repository.nextHouseholdId();
  const memberRows = members || [];
  const risk = recomputeRisk(
    { waterSource, toiletType, sanitationAccess: text(payload.sanitationAccess), monthlyIncome: payload.monthlyIncome, members: [] },
    {},
    memberRows,
  );

  const household = await repository.insertHousehold({
    id: ids.id,
    municipalityId: barangayRow.municipalityId,
    barangayId: barangayRow.id,
    headName,
    purok,
    streetAddress,
    contact: text(payload.contact),
    families,
    monthlyIncome: payload.monthlyIncome === '' || payload.monthlyIncome === undefined ? null : Number(payload.monthlyIncome) || null,
    hhStatus: HH_STATUSES.includes(payload.hhStatus) ? payload.hhStatus : 'Pending',
    approvalStatus: APPROVAL_STATUSES.includes(payload.approvalStatus) ? payload.approvalStatus : 'Not yet approved',
    respondentLast: text(payload.respondentLast),
    respondentFirst: text(payload.respondentFirst),
    respondentMaiden: text(payload.respondentMaiden),
    nhts: text(payload.nhts),
    ip: text(payload.ip),
    philhealthMember: Boolean(payload.philhealthMember),
    philhealthId: text(payload.philhealthId),
    philhealthCategory: text(payload.philhealthCategory),
    waterSource,
    waterType: text(payload.waterType),
    waterDistance: text(payload.waterDistance),
    waterAvailability: text(payload.waterAvailability),
    waterTreated: Boolean(payload.waterTreated),
    treatmentMethods: Array.isArray(payload.treatmentMethods) ? payload.treatmentMethods : [],
    toiletType,
    sanitationAccess: text(payload.sanitationAccess),
    wasteDisposal: text(payload.wasteDisposal),
    wasteSegregation: text(payload.wasteSegregation),
    quarterVisits: payload.quarterVisits && typeof payload.quarterVisits === 'object' ? payload.quarterVisits : {},
    ...risk,
    collectorId: user?.id || null,
    collectorName: text(payload.collectorName ?? payload.collector) || user?.name || user?.email || '',
    createdBy: user?.id || null,
  });

  for (const member of memberRows) {
    await repository.addHouseholdMember(household.id, {
      ...member,
      // Link the member to a resident record when one already exists for the
      // exact identity — roster entries never create residents implicitly.
      residentId: member.residentId || null,
    });
  }

  return repository.getHousehold(household.id);
};

export const updateHousehold = async ({ id, user, patch = {} }) => {
  if (!WRITE_ROLES.includes(user?.role)) throw ApiError.forbidden();
  const household = await getScopedHousehold(id, user);

  // Verification outcomes belong to the Health Supervisor only.
  const touchesVerification = VERIFICATION_FIELDS.some((f) => patch[f] !== undefined);
  if (touchesVerification && !VERIFY_ROLES.includes(user?.role)) {
    throw ApiError.forbidden('Verification outcomes can only be set by the Health Supervisor.');
  }
  // The reviewer identity and timestamp always come from the authenticated
  // session — never from the client. A returned-for-correction outcome requires
  // a correction reason.
  if (patch.verificationStatus !== undefined) {
    patch.verifiedBy = user.id;
    patch.verifiedAt = new Date().toISOString();
    if (patch.verificationStatus === 'Returned for Correction' && !text(patch.correctionReason)) {
      throw ApiError.unprocessable('A correction reason is required when returning a household.');
    }
    if (patch.verificationStatus !== 'Returned for Correction') {
      patch.correctionReason = '';
    }
  }

  const errors = [];
  if (patch.hhStatus !== undefined && !HH_STATUSES.includes(patch.hhStatus)) {
    errors.push('Invalid household status.');
  }
  if (patch.approvalStatus !== undefined && !APPROVAL_STATUSES.includes(patch.approvalStatus)) {
    errors.push('Invalid approval status.');
  }
  if (patch.verificationStatus !== undefined && !VERIFICATION_STATUSES.includes(patch.verificationStatus)) {
    errors.push('Invalid verification status.');
  }
  if (patch.waterSource !== undefined && patch.waterSource !== '' && !WATER_SOURCES.includes(patch.waterSource)) {
    errors.push('Invalid water source.');
  }
  if (patch.toiletType !== undefined && patch.toiletType !== '' && !TOILET_TYPES.includes(patch.toiletType)) {
    errors.push('Invalid toilet facility type.');
  }
  if (errors.length) throw ApiError.unprocessable('Please correct the highlighted fields.', errors);

  // Never persist a client-supplied risk classification — recompute it.
  const { members, errors: memberErrors } = normalizeMembers(patch.members);
  if (memberErrors.length) throw ApiError.unprocessable('Please correct the member details.', memberErrors);

  const nextPatch = { ...patch };
  delete nextPatch.riskScore;
  delete nextPatch.riskLevel;
  delete nextPatch.riskFactors;
  delete nextPatch.flags;
  delete nextPatch.id;
  delete nextPatch.municipalityId;
  delete nextPatch.barangayId;
  delete nextPatch.members;

  const risk = recomputeRisk(household, nextPatch, members === undefined ? undefined : members);
  const updated = await repository.updateHousehold(id, { ...nextPatch, ...risk });
  if (!updated) throw ApiError.notFound('Household not found');
  return repository.getHousehold(id);
};

export const addHouseholdMember = async ({ id, user, member = {} }) => {
  if (!WRITE_ROLES.includes(user?.role)) throw ApiError.forbidden();
  const household = await getScopedHousehold(id, user);

  const { members: normalized, errors } = normalizeMembers([member]);
  if (errors.length) throw ApiError.unprocessable('Please complete the member details.', errors);
  const [newMember] = normalized;

  // Optional link to an existing resident — must exist AND belong to the same
  // barangay as the household (so a roster never mixes municipalities).
  let resident = null;
  if (member.residentId) {
    resident = await repository.getResident(member.residentId);
    if (!resident) throw ApiError.notFound('Resident not found');
    if ((resident.barangay || '').toLowerCase() !== (household.barangay || '').toLowerCase()) {
      throw ApiError.unprocessable('That resident belongs to a different barangay than the household.');
    }
    // Duplicate membership check before hitting the unique constraint.
    if ((household.members || []).some((m) => m.residentId === member.residentId)) {
      throw ApiError.conflict('That resident is already a member of this household.');
    }
  }

  const created = await repository.addHouseholdMember(household.id, {
    ...newMember,
    residentId: member.residentId || null,
  });
  return { member: created, household: await repository.getHousehold(household.id) };
};

export const removeHouseholdMember = async ({ id, memberId, user }) => {
  if (!WRITE_ROLES.includes(user?.role)) throw ApiError.forbidden();
  const household = await getScopedHousehold(id, user);
  const member = (household.members || []).find((m) => m.id === memberId);
  if (!member) throw ApiError.notFound('Household member not found');
  const removed = await repository.removeHouseholdMember(household.id, memberId);
  if (!removed) throw ApiError.notFound('Household member not found');
  return { success: true, household: await repository.getHousehold(household.id) };
};

export default {
  listHouseholds,
  getHousehold,
  createHousehold,
  updateHousehold,
  addHouseholdMember,
  removeHouseholdMember,
};
