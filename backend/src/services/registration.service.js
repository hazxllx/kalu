import ApiError from '../utils/apiError.js';
import { isApprovedBarangayName } from '../config/barangays.js';
import repository from '../repositories/index.js';
import { getServiceClient } from '../config/supabase.js';
import { validateDocumentUpload } from '../validators/documents.validators.js';
import {
  ageFromDateOnly,
  CIVIL_STATUSES,
  hasControlChars,
  isFutureDateOnly,
  isValidPersonName,
  isStrictMobile,
  NAME_SUFFIXES,
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

// Permanent internal Resident ID format (e.g. RES-000123). The lookup/activation
// endpoints validate against this before touching the database.
const RESIDENT_ID_PATTERN = /^RES-\d{6}$/;
const normalizeResidentId = (value) => text(value).toUpperCase();

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
  const middleName = text(payload.middleName);
  const lastName = text(payload.lastName);
  const suffix = text(payload.suffix);
  const birthDate = text(payload.birthDate);
  const sex = text(payload.sex);
  const civilStatus = text(payload.civilStatus);
  const barangay = text(payload.barangay);
  const identityNo = text(payload.identityNo);
  const cellphoneNo = text(payload.cellphoneNo);
  const zone = toZone(payload.zone);

  if (!firstName) errors.push('First name is required.');
  else if (firstName.length > 80) errors.push('First name is too long (max 80 characters).');
  else if (hasControlChars(firstName) || !isValidPersonName(firstName)) {
    errors.push('First name can contain letters, spaces, hyphens, apostrophes, and periods only.');
  }
  if (middleName && middleName.length > 80) errors.push('Middle name is too long (max 80 characters).');
  else if (middleName && (hasControlChars(middleName) || !isValidPersonName(middleName))) {
    errors.push('Middle name can contain letters, spaces, hyphens, apostrophes, and periods only.');
  }
  if (!lastName) errors.push('Last name is required.');
  else if (lastName.length > 80) errors.push('Last name is too long (max 80 characters).');
  else if (hasControlChars(lastName) || !isValidPersonName(lastName)) {
    errors.push('Last name can contain letters, spaces, hyphens, apostrophes, and periods only.');
  }
  if (suffix && !NAME_SUFFIXES.includes(suffix)) errors.push('Select a valid suffix.');
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
  if (!civilStatus) errors.push('Civil status is required.');
  else if (!CIVIL_STATUSES.includes(civilStatus)) errors.push('Select a valid civil status.');
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
    middleName,
    lastName,
    suffix,
    birthDate,
    sex,
    civilStatus,
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
  if (!isApprovedBarangayName(fields.barangay) || !barangayRow
    || String(barangayRow.status || 'Active').toLowerCase() !== 'active') {
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
      middleName: fields.middleName,
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
    middleName: fields.middleName,
    lastName: fields.lastName,
    suffix: fields.suffix,
    birthDate: fields.birthDate,
    birthPlace: text(payload.birthPlace),
    sex: fields.sex,
    civilStatus: fields.civilStatus,
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

/**
 * Existing-resident activation — Step 1 lookup.
 *
 * Validates the Resident ID format and reports ONLY an eligibility state. It
 * intentionally returns NO personal information (name, barangay, DOB, health
 * record) because the applicant has not yet proven their identity. The states:
 *   - 'eligible'       : an unlinked record exists and can be activated
 *   - 'already_linked' : a record exists but already has an account (→ login)
 * A non-existent / malformed ID throws a 4xx with a non-sensitive message.
 *
 * This endpoint is public (the applicant has no account yet) and rate-limited.
 */
export const lookupExistingResident = async ({ residentId } = {}) => {
  const id = normalizeResidentId(residentId);
  if (!RESIDENT_ID_PATTERN.test(id)) {
    throw ApiError.unprocessable('Enter a valid Resident ID (for example, RES-000123).');
  }
  const target = repository.getResident ? await repository.getResident(id) : null;
  if (!target) {
    throw ApiError.notFound(
      'No resident record was found for that Resident ID. Please check the ID your Health Supervisor gave you.',
    );
  }
  if (target.authUserId) {
    // A record that already has an account is not activatable again.
    return { status: 'already_linked' };
  }
  return { status: 'eligible' };
};

/**
 * Existing-resident activation — final link step.
 *
 * Links the authenticated (email-verified) account to the EXISTING resident
 * record identified by Resident ID, after re-checking identity SERVER-SIDE:
 *   - the Resident ID must match a real, unlinked record, and
 *   - the submitted date of birth must match the stored record.
 * A Resident ID alone is never sufficient. The existing record is the source of
 * truth: no demographic field, barangay, Health Record Number or history is
 * modified, and no second resident profile is ever created. The link is atomic
 * (activate_resident_by_id enforces auth_user_id IS NULL) so concurrent
 * requests cannot double-link. When the matched record is already approved, the
 * login account is activated (Account Status → active) without ever changing
 * the verification status.
 */
export const activateExistingResident = async ({ user, residentId, birthDate } = {}) => {
  if (!SELF_ROLES.includes(user?.role)) {
    throw ApiError.forbidden('Only a resident account may activate an existing record.');
  }
  const id = normalizeResidentId(residentId);
  if (!RESIDENT_ID_PATTERN.test(id)) {
    throw ApiError.unprocessable('Enter a valid Resident ID (for example, RES-000123).');
  }
  const dob = text(birthDate);
  if (!dob || !parseDateOnly(dob)) {
    throw ApiError.unprocessable('Enter the date of birth on your existing record to verify your identity.');
  }

  // Idempotent recovery: if this account is already linked (e.g. a retry after
  // a failure between auth creation and linkage), do not create another link.
  const already = await repository.getResidentByAuthUserId(user.id);
  if (already) {
    if (already.id === id) {
      await activateIfVerified(already, user.id);
      return { ...toResidentResult(already), alreadyLinked: false };
    }
    throw ApiError.conflict('A resident record is already linked to this account.');
  }

  const target = repository.getResident ? await repository.getResident(id) : null;
  if (!target) {
    throw ApiError.notFound('No resident record was found for that Resident ID.');
  }
  if (target.authUserId && target.authUserId !== user.id) {
    throw ApiError.conflict(
      'This resident record already has an account. Please log in, or use account recovery if you have forgotten your password.',
    );
  }
  if (target.authUserId === user.id) {
    await activateIfVerified(target, user.id);
    return { ...toResidentResult(target), alreadyLinked: false };
  }

  // Identity gate: the Resident ID alone is not enough — the date of birth must
  // match the stored record. (Email ownership was already proven by the
  // Supabase OTP that created this authenticated session.)
  const dobMatches = text(target.birthDate) !== '' && text(target.birthDate) === dob;
  if (!dobMatches) {
    throw ApiError.unprocessable('The information provided does not match that resident record. Please check your date of birth.');
  }

  // Atomic, race-safe link.
  let linked = null;
  if (repository.activateResidentById) {
    linked = await repository.activateResidentById({ authUserId: user.id, residentId: id, birthDate: dob });
    if (!linked) {
      // The record changed between the read and the claim. Resolve why.
      const after = repository.getResident ? await repository.getResident(id) : null;
      if (after?.authUserId && after.authUserId !== user.id) {
        throw ApiError.conflict(
          'This resident record already has an account. Please log in, or use account recovery if you have forgotten your password.',
        );
      }
      throw ApiError.conflict('This resident record could not be activated. Please try again or contact your Health Supervisor.');
    }
  } else if (repository.updateResident) {
    linked = await repository.updateResident(id, { authUserId: user.id, updatedAt: new Date().toISOString() });
  } else {
    linked = { ...target, authUserId: user.id };
  }

  const result = linked || { ...target, authUserId: user.id };
  await activateIfVerified(result, user.id);
  try {
    await getServiceClient().auth.admin.updateUserById(user.id, { email_confirm: true });
  } catch {
    /* best-effort: do not block linking if confirmation fails */
  }
  return { ...toResidentResult(result), alreadyLinked: false };
};

export default { registerResident, activateOwnAccount, lookupExistingResident, activateExistingResident };
