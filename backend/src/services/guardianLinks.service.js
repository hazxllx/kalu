/**
 * KALUSAGAP — minor / parent-or-guardian relationship service.
 *
 * Owns the lifecycle of `resident_guardian_links`:
 *   - search eligible guardian candidates (staff, scoped)
 *   - create a link for a MINOR resident (staff or the minor's own account)
 *   - verify / reject / correct a link (authorized staff only)
 *
 * Invariants enforced here (and again by RLS + DB constraints):
 *   - only a minor (age < MINOR_AGE_THRESHOLD) may be the link's minor side;
 *   - the link never points at the minor itself (no self-reference);
 *   - at most one ACTIVE link per minor (a rejected link does not block a
 *     corrected replacement);
 *   - creating or updating a link NEVER changes any resident's verification
 *     status or grants the guardian access to the minor's records
 *     (GUARDIAN_ACCESS_NOT_GRANTED — a pending policy decision).
 */
import ApiError from '../utils/apiError.js';
import repository from '../repositories/index.js';
import {
  MINOR_AGE_THRESHOLD,
  GUARDIAN_RELATIONSHIP_TYPES,
  GUARDIAN_LINK_STATUSES,
  GUARDIAN_LINK_CREATE_ROLES,
  GUARDIAN_LINK_REVIEW_ROLES,
  isMinorAge,
} from '../config/guardianPolicy.js';
import { assignedBarangay } from '../config/scope.js';
import { isStrictMobile, normalizeEmail } from '../validators/common.js';

const text = (value) => String(value ?? '').trim();

const RELATIONSHIP_LABELS = Object.freeze({
  father: 'Father',
  mother: 'Mother',
  legal_guardian: 'Legal guardian',
  grandparent: 'Grandparent',
  other_family_member: 'Other family member',
  other: 'Other',
});

/** True when the caller may act on data inside the given barangay scope. */
const coversBarangay = (user, minor) => {
  if (user.role === 'admin') return true;
  const scope = assignedBarangay(user);
  if (scope) return text(minor.barangay) === scope;
  // Municipality-wide roles (mho / phn / rhu): the minor must belong to the
  // caller's municipality when the caller has one recorded.
  if (user.municipalityId && minor.municipalityId && user.municipalityId !== minor.municipalityId) return false;
  return true;
};

const loadMinorInScope = async (user, minorResidentId, { requireMinor = true } = {}) => {
  const minor = await repository.getResident(minorResidentId);
  if (!minor) throw ApiError.notFound('Resident record not found.');
  if (!coversBarangay(user, minor)) {
    throw ApiError.forbidden('This record is outside your assigned coverage area.');
  }
  if (requireMinor && !isMinorAge(minor.birthDate)) {
    throw ApiError.unprocessable(
      `Guardian links are only recorded for residents under ${MINOR_AGE_THRESHOLD}. This record is not a minor.`,
    );
  }
  return minor;
};

const publicLink = (link, minor) => ({
  id: link.id,
  minorResidentId: link.minorResidentId,
  minor: minor
    ? {
        id: minor.id,
        healthRecordNo: minor.healthRecordNo,
        firstName: minor.firstName,
        lastName: minor.lastName,
        barangay: minor.barangay || '',
      }
    : null,
  guardianResidentId: link.guardianResidentId || null,
  guardian: {
    lastName: link.guardianLastName,
    firstName: link.guardianFirstName || '',
    middleName: link.guardianMiddleName || '',
  },
  relationshipType: link.relationshipType,
  relationshipLabel: RELATIONSHIP_LABELS[link.relationshipType] || link.relationshipType,
  guardianCellphoneNo: link.guardianCellphoneNo || '',
  guardianIdentityNo: link.guardianIdentityNo || '',
  consentRecorded: Boolean(link.consentRecorded),
  consentNote: link.consentNote || '',
  verificationStatus: link.verificationStatus || 'pending_verification',
  verificationNote: link.verificationNote || '',
  verifiedBy: link.verifiedByName || null,
  verifiedByRole: link.verifiedByRole || null,
  verifiedAt: link.verifiedAt || null,
  createdBy: link.createdByName || null,
  createdByRole: link.createdByRole || null,
  createdAt: link.createdAt || null,
  updatedAt: link.updatedAt || null,
});

const publicResidentLink = (link) => ({
  id: link.id,
  relationshipType: link.relationshipType,
  relationshipLabel: RELATIONSHIP_LABELS[link.relationshipType] || link.relationshipType,
  verificationStatus: link.verificationStatus,
  verificationNote: link.verificationNote || '',
  verifiedAt: link.verifiedAt || null,
  createdAt: link.createdAt || null,
});

/**
 * Staff: search existing residents to link as the guardian of a minor.
 * Bounded, scope-aware; returns display-safe fields only (no address, no
 * medical data, no verification detail beyond what the directory exposes).
 */
export const searchGuardianCandidates = async ({ user, q = '', repo = repository }) => {
  if (!GUARDIAN_LINK_CREATE_ROLES.includes(user.role) && user.role !== 'admin') {
    throw ApiError.forbidden('Your role cannot search guardian candidates.');
  }
  const term = text(q);
  if (term.length < 2) {
    throw ApiError.unprocessable('Enter at least 2 characters to search.');
  }
  const scope = assignedBarangay(user);
  // Barangay-scoped roles search ONLY their assigned barangay; municipality-
  // wide roles (phn / mho / admin) search their own municipality — never a
  // bare global search.
  const results = scope
    ? await repo.searchResidents({
      q: term,
      limit: 10,
      barangay: scope,
      municipalityId: user.municipalityId || null,
    })
    : user.municipalityId
      ? (await repo.listResidents({ q: term, limit: 10, municipalityId: user.municipalityId })).rows
      : [];
  return results.map((resident) => ({
    id: resident.id,
    healthRecordNo: resident.healthRecordNo,
    name: `${resident.firstName} ${resident.lastName}`,
    lastName: resident.lastName,
    birthDate: resident.birthDate || null,
    barangay: resident.barangay || '',
  }));
};

const validateGuardianDetails = (payload = {}) => {
  const errors = {};
  const minorResidentId = text(payload.minorResidentId);
  const relationshipType = text(payload.relationshipType);
  const guardianLastName = text(payload.guardianLastName);
  const guardianFirstName = text(payload.guardianFirstName);
  const guardianCellphoneNo = text(payload.guardianCellphoneNo);
  const guardianResidentId = text(payload.guardianResidentId);
  if (!minorResidentId) errors.minorResidentId = 'The minor resident is required.';
  if (!GUARDIAN_RELATIONSHIP_TYPES.includes(relationshipType)) {
    errors.relationshipType = 'Select the relationship to the minor.';
  }
  if (!guardianLastName) errors.guardianLastName = 'Guardian last name is required.';
  if (!guardianFirstName) errors.guardianFirstName = 'Guardian first name is required.';
  if (guardianCellphoneNo && !isStrictMobile(guardianCellphoneNo)) {
    errors.guardianCellphoneNo = 'Guardian mobile number must be exactly 11 digits (e.g. 09171234567).';
  }
  if (text(payload.guardianIdentityNo).length > 60) {
    errors.guardianIdentityNo = 'Guardian identity number is too long.';
  }

  // If linking to an EXISTING resident record, the declared name must match
  // that record (server-checked; a mismatch is almost always a wrong link).
  return { errors, minorResidentId, relationshipType, guardianLastName, guardianFirstName, guardianCellphoneNo, guardianResidentId };
};

/**
 * Create a guardian link for a minor.
 *
 * Caller options:
 *  - staff (bhw / health_supervisor / phn / admin): in-scope minor only; may
 *    reference an existing resident as the guardian or record new details.
 *  - the minor's own resident account (resident / resident-limited): may only
 *    link the account's own resident record and declare the guardian's
 *    details (no referencing other residents' full records — candidates are
 *    matched by identity only and the resulting link still needs staff review).
 *
 * The link is ALWAYS created with verificationStatus 'pending_verification'.
 * Nothing here verifies anyone or grants any access.
 */
export const createGuardianLink = async ({ user, payload = {} }) => {
  const isStaff = GUARDIAN_LINK_CREATE_ROLES.includes(user.role) || user.role === 'admin';
  const isOwnResident = ['resident', 'resident-limited'].includes(user.role);
  if (!isStaff && !isOwnResident) {
    throw ApiError.forbidden('Your role cannot create guardian links.');
  }

  const {
    errors,
    minorResidentId,
    relationshipType,
    guardianLastName,
    guardianFirstName,
    guardianCellphoneNo,
    guardianResidentId,
  } = validateGuardianDetails(payload);
  if (isOwnResident && guardianResidentId) {
    throw ApiError.forbidden('A resident cannot directly attach another resident account. Request its account holder to accept the link.');
  }
  if (Object.keys(errors).length) {
    throw ApiError.unprocessable('Please correct the highlighted fields.', errors);
  }

  const minor = isOwnResident
    ? await (repository.getResidentByAuthUserId
        ? repository.getResidentByAuthUserId(user.id)
        : repository.getResident(minorResidentId))
    : await loadMinorInScope(user, minorResidentId);
  if (!minor) throw ApiError.notFound('Resident record not found.');
  if (isOwnResident && minor.id !== minorResidentId) {
    throw ApiError.forbidden('You can only add a guardian link to your own record.');
  }
  if (!coversBarangay(user, minor)) {
    throw ApiError.forbidden('This record is outside your assigned coverage area.');
  }
  if (!isMinorAge(minor.birthDate)) {
    throw ApiError.unprocessable(
      `Guardian links are only recorded for residents under ${MINOR_AGE_THRESHOLD}. This record is not a minor.`,
    );
  }

  // Self-reference guard (also enforced by the DB check constraint).
  if (guardianResidentId && guardianResidentId === minor.id) {
    throw ApiError.unprocessable('The guardian cannot be the same record as the minor.');
  }

  // Resolve the linked guardian record when one was supplied.
  let linkedGuardian = null;
  if (guardianResidentId) {
    linkedGuardian = await repository.getResident(guardianResidentId);
    if (!linkedGuardian) {
      throw ApiError.unprocessable('The selected guardian resident was not found. Record the guardian details instead.');
    }
    if (!coversBarangay(user, linkedGuardian)) {
      throw ApiError.forbidden('The selected guardian record is outside your assigned coverage area.');
    }
    if (isMinorAge(linkedGuardian.birthDate)) {
      throw ApiError.unprocessable('A minor resident cannot be linked as another resident’s parent or guardian.');
    }
    // Name consistency: linking an existing record but typing a different
    // last name is a data-integrity error, not a new person.
    if (text(linkedGuardian.lastName).toLowerCase() !== guardianLastName.toLowerCase()) {
      throw ApiError.unprocessable(
        `The last name must match the selected resident record (${linkedGuardian.lastName}). To record a different person, leave the resident unselected.`,
      );
    }
  }

  // Duplicate guard: an active link already exists for this minor.
  const existing = repository.getActiveGuardianLinkForMinor
    ? await repository.getActiveGuardianLinkForMinor(minor.id)
    : null;
  if (existing) {
    const sameGuardian =
      existing.guardianResidentId === guardianResidentId ||
      (text(existing.guardianLastName).toLowerCase() === guardianLastName.toLowerCase() &&
        text(existing.guardianFirstName).toLowerCase() === guardianFirstName.toLowerCase());
    if (sameGuardian) {
      // Idempotent retry: return the existing active link instead of duplicating.
      return publicLink(existing, minor);
    }
    throw ApiError.conflict(
      'This minor already has a guardian link on file. Ask an authorized health worker to review or correct it before adding another.',
    );
  }

  const link = await repository.insertGuardianLink({
    minorResidentId: minor.id,
    guardianResidentId: linkedGuardian?.id || null,
    guardianAuthUserId: linkedGuardian?.authUserId || null,
    guardianLastName,
    guardianFirstName,
    guardianMiddleName: text(payload.guardianMiddleName),
    relationshipType,
    guardianCellphoneNo,
    guardianIdentityNo: text(payload.guardianIdentityNo),
    consentRecorded: Boolean(payload.consentRecorded),
    consentNote: text(payload.consentNote).slice(0, 500),
    verificationStatus: linkedGuardian?.authUserId ? 'pending_guardian_acceptance' : 'pending_verification',
    verificationNote: '',
    createdById: user.id,
    createdByRole: user.role,
    createdByName: user.name || '',
  });

  // Denormalized mirror on the minor record so lists can show status at a
  // glance. Best-effort: the link row is the source of truth.
  try {
    if (repository.updateResident) {
      await repository.updateResident(minor.id, {
        guardianStatus: linkedGuardian?.authUserId
          ? 'pending_guardian_acceptance'
          : 'pending_verification',
      });
    }
  } catch (error) {
    console.error(`Guardian link status mirror failed for ${minor.id}: ${error.message}`);
  }

  return publicLink(link, minor);
};

const publicIncomingRequest = (link, minor) => ({
  id: link.id,
  relationshipType: link.relationshipType,
  relationshipLabel: RELATIONSHIP_LABELS[link.relationshipType] || link.relationshipType,
  status: link.verificationStatus,
  requestedAt: link.createdAt || null,
  minor: minor ? {
    id: minor.id,
    name: `${minor.firstName || ''} ${minor.lastName || ''}`.trim(),
    barangay: minor.barangay || '',
  } : null,
});

/** Requester is always derived from the authenticated resident account. */
export const requestOwnGuardianLink = async ({ user, email, relationshipType }) => {
  if (!['resident', 'resident-limited'].includes(user?.role)) {
    throw ApiError.forbidden('Only a resident account may request a guardian link.');
  }
  const minor = await repository.getResidentByAuthUserId(user.id);
  if (!minor || !isMinorAge(minor.birthDate)) {
    throw ApiError.unprocessable('Guardian linking is available only for your own record when you are under 18.');
  }
  if (!GUARDIAN_RELATIONSHIP_TYPES.includes(relationshipType)) {
    throw ApiError.unprocessable('Select the relationship to the minor.');
  }
  const normalizedEmail = normalizeEmail(email);
  // The same response is returned for unknown, ineligible, and self accounts
  // to prevent account enumeration. The applicant-visible status is also
  // identical regardless of whether an account matched.
  const acknowledgement = {
    requestReceived: true,
    status: 'pending_guardian_acceptance',
    message: 'If an eligible account matches, its holder can review the request after signing in. Staff verification is also required.',
  };

  const existing = await repository.getActiveGuardianLinkForMinor(minor.id);
  if (existing) {
    return acknowledgement;
  }

  await repository.updateResident(minor.id, { guardianStatus: 'pending_guardian_acceptance' });
  const account = await repository.findResidentProfileByEmail(normalizedEmail);
  if (!account || account.id === user.id) return acknowledgement;

  const guardianResident = repository.getResidentByAuthUserId
    ? await repository.getResidentByAuthUserId(account.id)
    : null;
  if (guardianResident && isMinorAge(guardianResident.birthDate)) return acknowledgement;
  const activeAfterLookup = await repository.getActiveGuardianLinkForMinor(minor.id);
  if (activeAfterLookup) return acknowledgement;

  const nameParts = String(account.fullName || '').trim().split(/\s+/).filter(Boolean);
  await repository.insertGuardianLink({
    minorResidentId: minor.id,
    guardianResidentId: guardianResident?.id || null,
    guardianAuthUserId: account.id,
    guardianLastName: nameParts.length ? nameParts[nameParts.length - 1] : '',
    guardianFirstName: nameParts.length > 1 ? nameParts.slice(0, -1).join(' ') : '',
    guardianMiddleName: '',
    relationshipType,
    consentRecorded: false,
    verificationStatus: 'pending_guardian_acceptance',
    createdById: user.id,
    createdByRole: user.role,
    createdByName: user.name || '',
  });
  return acknowledgement;
};

export const listOwnGuardianLinks = async ({ user }) => {
  if (!['resident', 'resident-limited'].includes(user?.role)) {
    throw ApiError.forbidden('Only a resident account may view its guardian links.');
  }
  const minor = await repository.getResidentByAuthUserId(user.id);
  if (!minor || !isMinorAge(minor.birthDate)) {
    return { isMinor: false, status: 'not_applicable', links: [] };
  }
  const links = await repository.listGuardianLinksForMinor(minor.id, { limit: 20 });
  const visibleLinks = links.filter((link) => link.verificationStatus !== 'pending_guardian_acceptance');
  return {
    isMinor: true,
    status: visibleLinks[0]?.verificationStatus || minor.guardianStatus || 'skipped',
    links: visibleLinks.map(publicResidentLink),
  };
};

export const listIncomingGuardianRequests = async ({ user }) => {
  if (!['resident', 'resident-limited'].includes(user?.role)) {
    throw ApiError.forbidden('Only a resident account may view incoming guardian requests.');
  }
  const links = await repository.listGuardianLinksForAccount(user.id, { limit: 20 });
  const requests = await Promise.all(links
    .filter((link) => link.verificationStatus === 'pending_guardian_acceptance')
    .map(async (link) => publicIncomingRequest(
      link,
      await repository.getResident(link.minorResidentId),
    )));
  return requests;
};

export const respondToGuardianRequest = async ({ user, linkId, decision }) => {
  if (!['resident', 'resident-limited'].includes(user?.role)) {
    throw ApiError.forbidden('Only a resident account may respond to guardian requests.');
  }
  const link = await repository.getGuardianLink(linkId);
  if (!link || link.guardianAuthUserId !== user.id) throw ApiError.notFound('Guardian request not found.');
  if (link.verificationStatus !== 'pending_guardian_acceptance') {
    throw ApiError.conflict('This guardian request is no longer awaiting acceptance.');
  }
  const minor = await repository.getResident(link.minorResidentId);
  if (!minor || !isMinorAge(minor.birthDate)) throw ApiError.conflict('This request is no longer valid.');
  const accepted = decision === 'accepted';
  const updated = await repository.updateGuardianLink(link.id, {
    verificationStatus: accepted ? 'pending_verification' : 'rejected',
    verificationNote: accepted ? '' : 'Declined by the account holder.',
    guardianAcceptedById: accepted ? user.id : null,
    guardianAcceptedAt: accepted ? new Date().toISOString() : null,
  });
  await repository.updateResident(minor.id, {
    guardianStatus: accepted ? 'pending_verification' : 'rejected',
  });
  return publicIncomingRequest(updated, minor);
};

export const cancelOwnGuardianRequest = async ({ user }) => {
  if (!['resident', 'resident-limited'].includes(user?.role)) {
    throw ApiError.forbidden('Only a resident account may cancel its guardian request.');
  }
  const minor = await repository.getResidentByAuthUserId(user.id);
  if (!minor) {
    throw ApiError.notFound('Guardian request not found.');
  }
  const link = repository.getActiveGuardianLinkForMinor
    ? await repository.getActiveGuardianLinkForMinor(minor.id)
    : null;
  if (link && !['pending_guardian_acceptance', 'pending_verification'].includes(link.verificationStatus)) {
    throw ApiError.conflict('Only a pending guardian request can be cancelled.');
  }
  if (!link && minor.guardianStatus !== 'pending_guardian_acceptance') {
    throw ApiError.conflict('Only a pending guardian request can be cancelled.');
  }
  if (link) {
    await repository.updateGuardianLink(link.id, {
      verificationStatus: 'cancelled',
      verificationNote: 'Cancelled by the applicant.',
    });
  }
  await repository.updateResident(minor.id, { guardianStatus: 'cancelled' });
  return { status: 'cancelled' };
};

/**
 * Authorized staff review: verify or reject an existing link.
 * Rejection requires a reason; verification records who/when/why. This is the
 * ONLY path that moves a link out of pending_verification.
 */
export const reviewGuardianLink = async ({ user, linkId, decision, note = '' }) => {
  if (!GUARDIAN_LINK_REVIEW_ROLES.includes(user.role) && user.role !== 'admin') {
    throw ApiError.forbidden('Your role cannot review guardian links.');
  }
  const status = GUARDIAN_LINK_STATUSES.includes(decision) ? decision : null;
  if (!status || status === 'pending_verification') {
    throw ApiError.unprocessable('A review must be either "verified" or "rejected".');
  }
  const trimmedNote = text(note);
  if (status === 'rejected' && trimmedNote.length < 5) {
    throw ApiError.unprocessable('A rejection reason of at least 5 characters is required.');
  }

  const link = await repository.getGuardianLink(linkId);
  if (!link) throw ApiError.notFound('Guardian link not found.');
  if (link.verificationStatus !== 'pending_verification') {
    throw ApiError.conflict('The guardian request must be accepted before staff can verify the relationship.');
  }
  if (link.guardianAuthUserId && !link.guardianAcceptedAt) {
    throw ApiError.conflict('The account holder must accept this request before staff can verify the relationship.');
  }

  const minor = await repository.getResident(link.minorResidentId);
  if (!minor) throw ApiError.notFound('The minor resident record was not found.');
  if (!coversBarangay(user, minor)) {
    throw ApiError.forbidden('This record is outside your assigned coverage area.');
  }

  const updated = await repository.updateGuardianLink(link.id, {
    verificationStatus: status,
    verificationNote: trimmedNote,
    verifiedById: user.id,
    verifiedByRole: user.role,
    verifiedByName: user.name || '',
    verifiedAt: new Date().toISOString(),
  });

  // Keep the minor's mirror column in sync (verified when the ACTIVE link is
  // verified; rejected when the active link is rejected).
  try {
    if (repository.updateResident) {
      await repository.updateResident(minor.id, {
        guardianStatus: status === 'verified' ? 'verified' : 'rejected',
      });
    }
  } catch {
    /* best-effort mirror */
  }

  return publicLink(updated, minor);
};

/**
 * Authorized staff correction: fix relationship type / guardian details on an
 * EXISTING link without changing its verification state. (A reviewer who wants
 * to replace the guardian entirely rejects the link and creates a new one.)
 */
export const correctGuardianLink = async ({ user, linkId, payload = {} }) => {
  if (!GUARDIAN_LINK_REVIEW_ROLES.includes(user.role) && user.role !== 'admin') {
    throw ApiError.forbidden('Your role cannot correct guardian links.');
  }
  const link = await repository.getGuardianLink(linkId);
  if (!link) throw ApiError.notFound('Guardian link not found.');
  const minor = await repository.getResident(link.minorResidentId);
  if (!minor) throw ApiError.notFound('The minor resident record was not found.');
  if (!coversBarangay(user, minor)) {
    throw ApiError.forbidden('This record is outside your assigned coverage area.');
  }

  const patch = {};
  if (payload.relationshipType !== undefined) {
    if (!GUARDIAN_RELATIONSHIP_TYPES.includes(text(payload.relationshipType))) {
      throw ApiError.unprocessable('Invalid relationship type.');
    }
    patch.relationshipType = text(payload.relationshipType);
  }
  if (payload.guardianMiddleName !== undefined) patch.guardianMiddleName = text(payload.guardianMiddleName);
  if (payload.guardianCellphoneNo !== undefined) {
    const value = text(payload.guardianCellphoneNo);
    if (value && !isStrictMobile(value)) {
      throw ApiError.unprocessable('Guardian mobile number must be exactly 11 digits (e.g. 09171234567).');
    }
    patch.guardianCellphoneNo = value;
  }
  if (payload.guardianIdentityNo !== undefined) patch.guardianIdentityNo = text(payload.guardianIdentityNo).slice(0, 60);
  if (Object.keys(patch).length === 0) {
    throw ApiError.unprocessable('No changes were provided.');
  }

  const updated = await repository.updateGuardianLink(link.id, patch);
  return publicLink(updated, minor);
};

/** The minor's current links (newest first) — staff in scope. */
export const listGuardianLinksForMinor = async ({ user, minorResidentId }) => {
  if (
    !GUARDIAN_LINK_REVIEW_ROLES.includes(user.role) &&
    !GUARDIAN_LINK_CREATE_ROLES.includes(user.role) &&
    user.role !== 'admin'
  ) {
    throw ApiError.forbidden('Your role cannot view guardian links.');
  }
  const minor = await repository.getResident(minorResidentId);
  if (!minor) throw ApiError.notFound('Resident record not found.');
  if (!coversBarangay(user, minor)) {
    throw ApiError.forbidden('This record is outside your assigned coverage area.');
  }
  const links = await repository.listGuardianLinksForMinor(minor.id, { limit: 20 });
  return links.map((link) => publicLink(link, minor));
};

export default {
  MINOR_AGE_THRESHOLD,
  searchGuardianCandidates,
  createGuardianLink,
  requestOwnGuardianLink,
  listOwnGuardianLinks,
  listIncomingGuardianRequests,
  respondToGuardianRequest,
  cancelOwnGuardianRequest,
  reviewGuardianLink,
  correctGuardianLink,
  listGuardianLinksForMinor,
};
