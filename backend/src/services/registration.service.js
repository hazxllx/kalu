import ApiError from '../utils/apiError.js';
import repository from '../repositories/index.js';
import { getServiceClient } from '../config/supabase.js';
import { validateDocumentUpload } from '../validators/documents.validators.js';
import {
  ageFromDateOnly,
  isFutureDateOnly,
  isStrictMobile,
  parseDateOnly,
  toZone,
} from '../validators/common.js';

const SELF_ROLES = Object.freeze(['resident', 'resident-limited']);

// Verification states that mean "registration is still in progress and may be
// safely retried". A retry that happens after the Auth user + resident row
// were created (but before document upload finished) must NOT be blocked or
// create a second resident record — it recovers the existing pending row so
// the flow can continue to the document step. 'verified' is deliberately
// excluded: an already-approved resident is a genuine conflict.
const RETRYABLE_STATUSES = Object.freeze(['pending', 'unverified', 'rejected']);

const text = (value) => String(value ?? '').trim();

const toResidentResult = (resident) => ({
  id: resident.id,
  healthRecordNo: resident.healthRecordNo,
  firstName: resident.firstName,
  lastName: resident.lastName,
  barangay: resident.barangay,
  verificationStatus: resident.verificationStatus || 'pending',
});

const minorFieldsFor = (fields, existing) => {
  if (!fields.minorVerificationMethod || existing?.minorVerificationMethod) return {};
  return {
    minorVerificationMethod: fields.minorVerificationMethod,
    minorAlternativeStatus: fields.minorVerificationMethod === 'staff_alternative' ? 'pending_review' : null,
    ...(existing?.guardianStatus ? {} : {
      guardianStatus: fields.guardianLinkChoice === 'request' ? 'pending_guardian_acceptance' : 'skipped',
    }),
  };
};

/**
 * When a self-service account links to an existing resident profile that is
 * already Verified, the resident has proven ownership (email OTP + their own
 * chosen password) of a record an authorized health worker already verified,
 * so the login account becomes Active. This NEVER changes the resident's
 * verification_status — Account Status and Verification Status stay separate.
 */
const activateIfVerified = async (resident, authUserId) => {
  if (authUserId && resident?.verificationStatus === 'approved' && repository.setProfileStatus) {
    try {
      await repository.setProfileStatus(authUserId, 'active');
    } catch {
      /* best-effort: account activation is recoverable via the verification queue */
    }
  }
};

const validate = (payload) => {
  const errors = [];
  const firstName = text(payload.firstName);
  const lastName = text(payload.lastName);
  const birthDate = text(payload.birthDate);
  const sex = text(payload.sex);
  const barangay = text(payload.barangay);
  const identityNo = text(payload.identityNo);
  const cellphoneNo = text(payload.cellphoneNo);
  const zone = toZone(payload.zone);

  if (!firstName) errors.push('First name is required.');
  if (!lastName) errors.push('Last name is required.');
  if (!birthDate) errors.push('Date of birth is required.');
  else {
    const age = ageFromDateOnly(birthDate);
    if (!parseDateOnly(birthDate)) errors.push('Date of birth is invalid.');
    else if (isFutureDateOnly(birthDate)) errors.push('Date of birth cannot be in the future.');
    else if (age === null || age < 0 || age > 120) errors.push('Date of birth is not a valid age.');
  }
  const age = ageFromDateOnly(birthDate);
  const isMinor = age !== null && age < 18;
  const minorVerificationMethod = text(payload.minorVerificationMethod);
  const guardianLinkChoice = text(payload.guardianLinkChoice);
  if (isMinor && !['student_id', 'staff_alternative'].includes(minorVerificationMethod)) {
    errors.push('Select a student ID or request staff-approved alternative verification.');
  } else if (!isMinor && minorVerificationMethod) {
    errors.push('Minor verification options are only available to applicants under 18.');
  }
  if (isMinor && !['skip', 'request'].includes(guardianLinkChoice)) {
    errors.push('Choose whether to skip or request parent/guardian linking.');
  } else if (!isMinor && guardianLinkChoice) {
    errors.push('Parent/guardian linking is only available to applicants under 18.');
  }
  if (!sex) errors.push('Sex is required.');
  else if (!['Male', 'Female'].includes(sex)) errors.push('Sex must be "Male" or "Female".');
  if (!barangay) errors.push('Barangay is required.');
  // Server-authoritative mobile + zone checks (the request validator already
  // ran, but the service never trusts the caller and re-enforces both here).
  if (cellphoneNo && !isStrictMobile(cellphoneNo)) {
    errors.push('Mobile number must be exactly 11 digits (e.g. 09381829120).');
  }
  if (payload.zone !== undefined && text(payload.zone) !== '' && zone === null) {
    errors.push('Zone must be a number from 1 to 8.');
  }

  if (errors.length) throw ApiError.unprocessable('Please correct the highlighted fields.', errors);

  return {
    firstName,
    lastName,
    birthDate,
    sex,
    barangay,
    identityNo,
    cellphoneNo,
    zone,
    ...(isMinor ? { minorVerificationMethod } : {}),
    ...(isMinor ? { guardianLinkChoice } : {}),
  };
};

export const registerResident = async ({ user, payload = {} }) => {
  if (!SELF_ROLES.includes(user?.role)) {
    throw ApiError.forbidden('Only a resident account may complete resident registration.');
  }

  const existing = await repository.getResidentByAuthUserId(user.id);
  if (existing) {
    // Idempotent retry: a resident row that is still awaiting verification was
    // created by an earlier attempt that failed later in the flow (e.g. during
    // document upload). Return it instead of creating a duplicate or hard 409,
    // so the client can resume the remaining steps.
    if (RETRYABLE_STATUSES.includes(existing.verificationStatus)) {
      return toResidentResult(existing);
    }
    throw ApiError.conflict('A resident record is already linked to this account.');
  }

  const fields = validate(payload);

  // ---------------------------------------------------------------------------
  // Explicit "already registered by a BHW / Health Personnel" claim path.
  // The resident supplies the Resident ID of the profile a health worker
  // created for them. We link the authenticated account to that EXISTING
  // profile instead of creating a second one. Identity is confirmed by Resident
  // ID + date of birth (never name alone, per the duplicate-prevention rule).
  // ---------------------------------------------------------------------------
  const claimResidentId = text(payload.residentId);
  if (claimResidentId) {
    const target = repository.getResident ? await repository.getResident(claimResidentId) : null;
    if (!target) {
      throw ApiError.unprocessable(
        'We could not find a resident record for that Resident ID. Please check the ID, or continue without it and we will match your details.',
      );
    }
    if (target.authUserId && target.authUserId !== user.id) {
      throw ApiError.conflict('This resident already has an account.');
    }
    if (target.authUserId === user.id) {
      return toResidentResult(target);
    }
    const dobMatches = text(target.birthDate) !== '' && text(target.birthDate) === text(fields.birthDate);
    if (!dobMatches) {
      throw ApiError.unprocessable(
        'The information provided does not match that resident record. Please verify your date of birth.',
      );
    }
    let linked = repository.updateResident
      ? await repository.updateResident(target.id, {
        authUserId: user.id,
        updatedAt: new Date().toISOString(),
      })
      : { ...target, authUserId: user.id };
    if (repository.updateResident && Object.keys(minorFieldsFor(fields, target)).length) {
      linked = await repository.updateResident(target.id, minorFieldsFor(fields, target));
    }
    const result = linked || { ...target, authUserId: user.id };
    await activateIfVerified(result, user.id);
    try {
      await getServiceClient().auth.admin.updateUserById(user.id, { email_confirm: true });
    } catch {
      /* best-effort: do not block linking if confirmation fails */
    }
    return toResidentResult(result);
  }

  const barangayRow = await repository.findBarangayByName(fields.barangay, user.municipalityId || null);
  if (!barangayRow) {
    throw ApiError.unprocessable(`Unknown barangay: ${fields.barangay}. Please select a valid barangay.`);
  }

  // Find an existing profile to link to, so a resident who was already
  // registered by a BHW / Health Personnel is NEVER duplicated. We try the
  // strongest signal first and fall back to weaker (but DOB-anchored) ones:
  //   1. identity number (when the resident supplies a government ID), then
  //   2. first + last name + date of birth (staff records usually have no
  //      identity number, so an identity-only lookup would miss them), then
  //   3. the same without middle name (staff records often omit it).
  // Name is never used without the date of birth.
  let duplicate = null;
  if (fields.identityNo) {
    duplicate = await repository.findResidentByIdentity({ identityNo: fields.identityNo });
  }
  if (!duplicate) {
    duplicate = await repository.findResidentByIdentity({
      lastName: fields.lastName,
      firstName: fields.firstName,
      middleName: text(payload.middleName),
      birthDate: fields.birthDate,
      ...(fields.minorVerificationMethod ? {
        minorVerificationMethod: fields.minorVerificationMethod,
        minorAlternativeStatus: fields.minorVerificationMethod === 'staff_alternative' ? 'pending_review' : null,
        guardianStatus: fields.guardianLinkChoice === 'request' ? 'pending_guardian_acceptance' : 'skipped',
      } : {}),
    });
  }
  if (!duplicate && text(payload.middleName)) {
    duplicate = await repository.findResidentByIdentity({
      lastName: fields.lastName,
      firstName: fields.firstName,
      birthDate: fields.birthDate,
    });
  }
  if (duplicate) {
    if (duplicate.authUserId && duplicate.authUserId !== user.id) {
      throw ApiError.conflict(
        'We found information that may already be associated with an existing KALUSAGAP account. Please sign in or complete the verification process.',
      );
    }
    if (duplicate.authUserId === user.id) {
      return toResidentResult(duplicate);
    }

    const hasClaimMatch = Boolean(
      fields.identityNo || duplicate.identityNo || duplicate.birthDate || fields.birthDate,
    );
    if (!hasClaimMatch) {
      throw ApiError.conflict(
        'We found information that may already be associated with an existing KALUSAGAP account. Please sign in or complete the verification process.',
      );
    }

    const isValidAuthUserId = typeof user?.id === 'string' && /^[0-9a-fA-F-]{36}$/.test(user.id.trim());
    if (!isValidAuthUserId) {
      throw ApiError.conflict(
        'We found information that may already be associated with an existing KALUSAGAP account. Please sign in or complete the verification process.',
      );
    }

    // Link the SPECIFIC unlinked record we matched. The atomic claim RPC is
    // used only when the match was by identity number (it re-checks identity +
    // DOB and that auth_user_id is still null). Otherwise — the common case
    // where a staff-created profile has no identity number — we link the found
    // record directly by its id so we never create a duplicate.
    const matchedByIdentity = Boolean(
      fields.identityNo &&
        duplicate.identityNo &&
        String(fields.identityNo).trim() === String(duplicate.identityNo).trim(),
    );

    let claimed = null;
    if (matchedByIdentity && repository.claimResidentForAccount) {
      claimed = await repository.claimResidentForAccount({
        authUserId: user.id,
        identityNo: fields.identityNo,
        birthDate: fields.birthDate || duplicate.birthDate || null,
      });
    }

    if (!claimed) {
      claimed = repository.updateResident
        ? await repository.updateResident(duplicate.id, {
          authUserId: user.id,
          updatedAt: new Date().toISOString(),
        })
        : { ...duplicate, authUserId: user.id };
    }

    let linkedResident = claimed || { ...duplicate, authUserId: user.id };
    if (repository.updateResident && Object.keys(minorFieldsFor(fields, duplicate)).length) {
      linkedResident = await repository.updateResident(duplicate.id, minorFieldsFor(fields, duplicate));
    }
    await activateIfVerified(linkedResident, user.id);
    try {
      await getServiceClient().auth.admin.updateUserById(user.id, { email_confirm: true });
    } catch {
      /* best-effort: do not block linking if confirmation fails */
    }
    return toResidentResult(linkedResident);
  }

  const ids = await repository.nextResidentIds();

  const resident = await repository.insertResident({
    ...ids,
    authUserId: user.id,
    firstName: fields.firstName,
    middleName: text(payload.middleName),
    lastName: fields.lastName,
    suffix: text(payload.suffix),
    birthDate: fields.birthDate,
    birthPlace: text(payload.birthPlace),
    sex: fields.sex,
    civilStatus: text(payload.civilStatus),
    religion: text(payload.religion),
    employmentStatus: text(payload.employmentStatus),
    is4PsMember: Boolean(payload.is4PsMember),
    philhealthNo: text(payload.philhealthNo),
    currentAddress: text(payload.currentAddress),
    permanentAddress: text(payload.permanentAddress),
    cellphoneNo: fields.cellphoneNo,
    identityNo: text(payload.identityNo),
    ...(fields.zone === null ? {} : { zone: fields.zone }),
    barangay: barangayRow.name,
    // Populate the scope columns explicitly from the resolved barangay so the
    // Health Supervisor verification queue (which filters by barangay AND
    // municipality) can always find a newly-registered resident, instead of
    // relying on a database trigger to backfill them.
    barangayId: barangayRow.id,
    municipalityId: barangayRow.municipalityId || user.municipalityId || null,
    verificationStatus: 'pending',
    submittedForVerificationAt: new Date().toISOString(),
    createdById: user.id,
    createdByRole: user.role,
  });

  const supabase = getServiceClient();
  try {
    await supabase.auth.admin.updateUserById(user.id, { email_confirm: true });
  } catch {
    /* best-effort: do not block registration if confirmation fails */
  }

  return toResidentResult(resident);
};

/**
 * Self-service account activation, called after a resident accepts their
 * invitation link and sets a password on /reset-password. If the resident's
 * profile is already Verified (a BHS/PHN registered them in person), the login
 * account is switched from Pending Activation to Active. This NEVER changes the
 * verification status, and is a safe no-op for any account whose resident
 * record is not approved (e.g. a self-registered resident still pending review).
 */
export const activateOwnAccount = async ({ user } = {}) => {
  if (!SELF_ROLES.includes(user?.role)) {
    throw ApiError.forbidden('Only a resident account may activate itself.');
  }
  const resident = repository.getResidentByAuthUserId
    ? await repository.getResidentByAuthUserId(user.id)
    : null;
  if (resident && resident.verificationStatus === 'approved' && repository.setProfileStatus) {
    await repository.setProfileStatus(user.id, 'active');
    return { activated: true };
  }
  return { activated: false };
};

export default { registerResident, activateOwnAccount };
