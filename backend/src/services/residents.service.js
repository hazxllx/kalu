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
import { getServiceClient } from '../config/supabase.js';
import env from '../config/env.js';
import { isPhonePH } from '../validators/common.js';
import { computeBMI } from '../utils/bmi.js';
import { riskFromVitals } from './analytics.service.js';
import {
  attachRiskToResidents,
  assessResidentById,
} from './residentRisk.service.js';
import { getRiskConfig } from './riskConfig.service.js';

const SELF_ROLES = ['resident', 'resident-limited'];

const clean = (value) => String(value ?? '').trim();

const RESIDENT_ACCOUNT_PASSWORD_CHARS =
  'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%';

export const generateTemporaryPassword = (length = 16) => {
  const size = Math.max(12, Number(length) || 16);
  const required = ['A', 'a', '1', '!'];
  const chars = RESIDENT_ACCOUNT_PASSWORD_CHARS.split('');

  const picks = Array.from(
    { length: size },
    () => chars[Math.floor(Math.random() * chars.length)],
  );

  for (let i = 0; i < required.length; i += 1) {
    picks[i % picks.length] = required[i];
  }

  for (let i = picks.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [picks[i], picks[j]] = [picks[j], picks[i]];
  }

  return picks.join('').slice(0, size);
};

export const buildResidentAccountCreation = ({
  email,
  fullName,
  password = generateTemporaryPassword(),
} = {}) => {
  const normalizedEmail = String(email ?? '').trim().toLowerCase();

  if (!normalizedEmail) {
    throw ApiError.badRequest(
      'A valid email is required before a resident login account can be created.',
    );
  }

  return {
    email: normalizedEmail,
    password: String(password || generateTemporaryPassword()),
    user_metadata: {
      full_name:
        String(fullName || '').trim() ||
        normalizedEmail.split('@')[0],
      requested_role: 'resident',
    },
    profile_status: 'pending_verification',
  };
};

export const createResidentAuthUser = async ({
  email,
  fullName,
  password,
} = {}) => {
  const account = buildResidentAccountCreation({
    email,
    fullName,
    password,
  });

  const supabase = getServiceClient();

  const baseUrl =
    (Array.isArray(env.clientUrls) && env.clientUrls[0]) ||
    'http://localhost:5173';

  const redirectTo =
    `${baseUrl.replace(/\/+$/, '')}/reset-password`;

  // Invitation flow: create the auth user WITHOUT a password and email them a
  // one-time invitation link. The resident clicks it, lands on /reset-password
  // (the AuthContext treats that route as a recovery-style flow and does not
  // hijack the session), sets their OWN password, and the account is activated.
  // Health personnel never see, set, or manage the resident's password.

  const { data, error } =
    await supabase.auth.admin.inviteUserByEmail(account.email, {
      data: account.user_metadata,
      redirectTo,
    });

  if (error) {
    if (
      /already been registered|already exists|already registered/i.test(
        error.message || '',
      )
    ) {
      throw ApiError.conflict(
        'A resident account for that email already exists.',
      );
    }

    throw ApiError(
      500,
      'The resident invitation could not be sent. Please check the email and try again.',
    );
  }

  const authUserId = data?.user?.id;

  if (!authUserId) {
    throw ApiError(
      503,
      'The resident account could not be created. Please try again.',
    );
  }

  const { error: profileError } = await supabase
    .from('profiles')
    .update({
      email: account.email,
      full_name: account.user_metadata.full_name,
      role: 'resident',
      status: account.profile_status,
    })
    .eq('id', authUserId);

  if (profileError) {
    try {
      await supabase.auth.admin.deleteUser(authUserId);
    } catch {
      // best effort: leave the orphaned auth record for admin review
    }

    throw ApiError(
      500,
      'The resident account was created but could not be set up. Please try again.',
    );
  }

  return {
    authUserId,
    email: account.email,
    invited: true,
    profileStatus: account.profile_status,
  };
};

/**
 * Map a stored visit to the BASIC, resident-safe view for "My Health Record".
 *
 * BMI is DERIVED here (never stored via the consultation path) so the resident
 * sees the same computed value the staff form shows. No internal identifiers
 * or other residents' data are ever included.
 */
const toResidentRecord = (visit = {}) => {
  const v = visit.vitals || {};

  const findings = clean(visit.findings);
  const diagnosisMarker = '\nDiagnosis: ';

  const [findingsText, diagnosis] = findings.includes(diagnosisMarker)
    ? findings.split(diagnosisMarker)
    : [findings, clean(visit.phn?.assessment)];

  const treatment = clean(visit.treatmentGiven);
  const medMarker = '\nMedication: ';

  const [treatmentText, medication] = treatment.includes(medMarker)
    ? treatment.split(medMarker)
    : [treatment, ''];

  const recommendation = clean(visit.recommendation);

  const nextVisitDate =
    recommendation.match(/Next visit:\s*(\d{4}-\d{2}-\d{2})/)?.[1] || '';

  const adviceText = recommendation
    .replace(/\n?Next visit:\s*\d{4}-\d{2}-\d{2}/, '')
    .trim();

  const { bmi, category } = computeBMI(
    v.heightCm,
    v.weightKg,
  );

  return {
    id: visit.id,
    date: visit.visitDate
      ? String(visit.visitDate).slice(0, 10)
      : '',
    time: String(visit.visitDate || '').includes('T')
      ? String(visit.visitDate).slice(11, 16)
      : '',
    chiefComplaint: clean(visit.chiefComplaint),
    findings: clean(findingsText),
    diagnosis: clean(diagnosis),
    treatmentGiven: clean(treatmentText),
    medications: clean(medication),
    recommendations: adviceText,
    followUpRequired: nextVisitDate ? 'Yes' : 'No',
    nextVisitDate,

    vitals: {
      bloodPressure: clean(v.bp),
      temperature: v.temperature ?? '',
      pulseRate: v.hr ?? '',
      respiratoryRate: v.rr ?? '',
      oxygenSaturation: v.o2sat ?? '',
      height: v.heightCm ?? '',
      weight: v.weightKg ?? '',
      bmi: bmi ?? '',
      bmiCategory: category ?? '',
    },

    seenBy: clean(visit.recordedByName),
    status: visit.status || '',
  };
};

/**
 * "My Health Record" for the authenticated resident.
 *
 * The resident identity is derived from the session (auth user id ->
 * residents.auth_user_id) and is NEVER taken from the client, so a resident
 * can only ever read their OWN completed consultations. Returns basic profile
 * plus the resident-safe consultation history.
 */
export const getOwnHealthRecords = async ({ user } = {}) => {
  if (!SELF_ROLES.includes(user?.role)) {
    throw ApiError.forbidden(
      'Only a resident may view their own health record.',
    );
  }

  const resident = await repository.getResidentByAuthUserId(user.id);

  if (!resident) {
    // Account exists but is not yet linked to a resident record.
    return {
      resident: null,
      consultations: [],
    };
  }

  const result = await repository.listVisits({
    residentId: resident.id,
    statuses: ['completed'],
    limit: 100,
  });

  const consultations = (result.rows || [])
    .map(toResidentRecord)
    .sort((a, b) =>
      String(b.date).localeCompare(String(a.date)),
    );

  // Health risk level for the resident dashboard. It reuses the SAME
  // KALUSAGAP risk heuristic used by the staff analytics (riskFromVitals) —
  // no separate frontend formula — applied to the most recent completed
  // visit's vitals. Null when there is no vitals-bearing consultation to assess.

  const latestVisit =
    (result.rows || [])
      .slice()
      .sort((a, b) =>
        String(b.visitDate || '').localeCompare(
          String(a.visitDate || ''),
        ),
      )[0] || null;

  const hasVitals =
    latestVisit?.vitals &&
    (latestVisit.vitals.bp || latestVisit.vitals.o2sat);

  const riskConfig = await getRiskConfig({
    repo: repository,
  });

  const riskLevel = hasVitals
    ? riskFromVitals(latestVisit.vitals, riskConfig)
    : null;

  const lastConsultationDate =
    consultations[0]?.date || '';

  return {
    resident: {
      name: [
        resident.firstName,
        resident.middleName,
        resident.lastName,
        resident.suffix,
      ]
        .filter(Boolean)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim(),

      barangay: resident.barangay || '',
      birthDate: resident.birthDate || '',

      age: resident.birthDate
        ? Math.max(
            0,
            new Date().getFullYear() -
              new Date(resident.birthDate).getFullYear(),
          )
        : '',

      sex: resident.sex || '',
      verificationStatus:
        resident.verificationStatus || '',
    },

    riskLevel,
    lastConsultationDate,
    consultations,
  };
};

/**
 * Resident self-service profile update.
 *
 * The resident is derived from the authenticated session (never a body id),
 * and only the whitelisted, non-administrative field(s) may change —
 * currently the contact number.
 *
 * Identity, barangay/municipality, reference and verification state are
 * system-controlled and are never editable here.
 */
export const updateOwnProfile = async ({
  user,
  payload = {},
} = {}) => {
  if (!SELF_ROLES.includes(user?.role)) {
    throw ApiError.forbidden(
      'Only a resident may update their own profile.',
    );
  }

  const resident =
    await repository.getResidentByAuthUserId(user.id);

  if (!resident) {
    throw ApiError.notFound(
      'Your resident record was not found.',
    );
  }

  const patch = {};

  if (payload.cellphoneNo !== undefined) {
    const phone = String(
      payload.cellphoneNo ?? '',
    ).trim();

    if (phone && !isPhonePH(phone)) {
      throw ApiError.unprocessable(
        'Contact number must be a valid PH mobile number (e.g. 0917 123 4567).',
      );
    }

    patch.cellphoneNo = phone;
  }

  const target =
    Object.keys(patch).length
      ? await repository.updateResident(
          resident.id,
          patch,
        )
      : resident;

  return {
    id: target.id,

    name: [
      target.firstName,
      target.middleName,
      target.lastName,
      target.suffix,
    ]
      .filter(Boolean)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim(),

    cellphoneNo: target.cellphoneNo || '',
    barangay: target.barangay || '',
  };
};

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

const isReadRole = (user) =>
  ['phn', 'health_supervisor', 'mho'].includes(
    user?.role,
  );

const isEditRole = (user) =>
  ['phn', 'health_supervisor'].includes(
    user?.role,
  );

const isCreateRole = (user) =>
  ['phn', 'health_supervisor', 'mho'].includes(
    user?.role,
  );

const VALID_SEX = Object.freeze([
  'Male',
  'Female',
]);

const parsePositiveInt = (
  value,
  fallback,
) => {
  const parsed = Number.parseInt(value, 10);

  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : fallback;
};

/**
 * Login-account status for a resident, derived from the linked auth user's
 * `profiles.status`.
 *
 * 'none' when the resident has no linked account.
 *
 * This is a read-only projection — it NEVER changes the resident's
 * verification_status, keeping Account Status and Verification Status separate.
 */
const deriveAccountStatus = (
  authUserId,
  statusMap = {},
) => {
  if (!authUserId) return 'none';

  const status = statusMap[authUserId];

  if (status === 'active') return 'active';

  if (status === 'disabled') return 'disabled';

  return 'pending';
};

const attachAccountStatus = async (
  residents = [],
) => {
  const list = Array.isArray(residents)
    ? residents
    : [];

  const authIds = list
    .map((r) => r?.authUserId)
    .filter(Boolean);

  const statusMap = authIds.length
    ? await repository.getProfileStatusesByIds(
        authIds,
      )
    : {};

  for (const resident of list) {
    if (resident) {
      resident.accountStatus =
        deriveAccountStatus(
          resident.authUserId,
          statusMap,
        );
    }
  }

  return residents;
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
export const listResidents = async ({
  user,
  q = '',
  barangay = '',
  limit = 50,
  offset = 0,
  verifiedOnly = false,
} = {}) => {
  const scope = assignedBarangay(user);
  const requested = String(barangay || '').trim();

  if (
    scope &&
    requested &&
    requested.toLowerCase() !== scope.toLowerCase()
  ) {
    throw ApiError.forbidden(
      'Your account is assigned to Barangay ' +
        scope +
        ' only',
    );
  }

  const effectiveBarangay =
    scope || requested || null;

  const parsedLimit = Math.min(
    parsePositiveInt(limit, 50),
    100,
  );

  const parsedOffset = Math.max(
    Number.parseInt(offset, 10) || 0,
    0,
  );

  const search = String(q || '').trim();
  const municipalityId =
    user?.municipalityId || null;

  if (!verifiedOnly) {
    const base =
      await repository.listResidents({
        q: search,
        limit: parsedLimit,
        offset: parsedOffset,
        barangay: effectiveBarangay,
        municipalityId,
      });

    await attachAccountStatus(base.rows);

    return {
      ...base,
      rows: await attachRiskToResidents(
        base.rows,
      ),
    };
  }

  // Verified directory: a resident qualifies when EITHER their individual
  // verification is approved (residents.verification_status = 'approved') OR
  // they are a linked member of a Verified household in the same scope.
  // The two sources are merged and de-duplicated on the canonical resident id.

  const approved =
    await repository.listResidents({
      q: search,
      limit: parsedLimit,
      offset: 0,
      barangay: effectiveBarangay,
      municipalityId,
      verificationStatuses: ['approved'],
    });

  const byId = new Map(
    approved.rows.map((r) => [r.id, r]),
  );

  const householdVerifiedIds =
    await repository.verifiedHouseholdResidentIds({
      barangay: effectiveBarangay,
      municipalityId,
    });

  const missingIds =
    householdVerifiedIds.filter(
      (id) => !byId.has(id),
    );

  if (missingIds.length) {
    const extra =
      await repository.listResidentsByIds({
        ids: missingIds,
        q: search,
        barangay: effectiveBarangay,
        municipalityId,
      });

    for (const resident of extra) {
      byId.set(resident.id, resident);
    }
  }

  const rows = [...byId.values()]
    .sort((a, b) =>
      String(b.createdAt || '').localeCompare(
        String(a.createdAt || ''),
      ),
    )
    .slice(0, parsedLimit);

  await attachAccountStatus(rows);

  return {
    rows: await attachRiskToResidents(rows),
    total: byId.size,
  };
};

/**
 * Register a new resident record.
 *
 * Identity fields are validated (422), the barangay must exist within the
 * caller's scope, and an identical name + birth-date record in the same
 * barangay is rejected with 409.
 */
export const createResident = async ({
  user,
  payload = {},
}) => {
  if (!isCreateRole(user)) {
    throw ApiError.forbidden(
      'Your role is not permitted to register residents',
    );
  }

  const text = (value) =>
    String(value ?? '').trim();

  const firstName = text(payload.firstName);
  const middleName = text(payload.middleName);
  const lastName = text(payload.lastName);
  const suffix = text(payload.suffix);
  const birthDate = text(payload.birthDate);
  const sex = text(payload.sex);
  const barangay = text(payload.barangay);

  const errors = [];

  if (!firstName) {
    errors.push('First name is required.');
  }

  if (!lastName) {
    errors.push('Last name is required.');
  }

  if (!birthDate) {
    errors.push('Date of birth is required.');
  } else {
    const dob = new Date(birthDate);

    if (Number.isNaN(dob.getTime())) {
      errors.push('Date of birth is invalid.');
    } else if (dob.getTime() > Date.now()) {
      errors.push(
        'Date of birth cannot be in the future.',
      );
    }
  }

  if (!sex) {
    errors.push('Sex is required.');
  } else if (!VALID_SEX.includes(sex)) {
    errors.push(
      'Sex must be "Male" or "Female".',
    );
  }

  if (!barangay) {
    errors.push('Barangay is required.');
  }

  if (errors.length) {
    throw ApiError.unprocessable(
      'Please correct the highlighted fields.',
      errors,
    );
  }

  // Barangay must be within the caller's assignment / municipality.
  const scope = assignedBarangay(user);

  if (
    scope &&
    barangay.toLowerCase() !==
      scope.toLowerCase()
  ) {
    throw ApiError.forbidden(
      'Your account is assigned to Barangay ' +
        scope +
        ' only',
    );
  }

  const barangayRow =
    await repository.findBarangayByName(
      barangay,
      user?.municipalityId || null,
    );

  if (!barangayRow) {
    throw ApiError.unprocessable(
      `Unknown barangay: ${barangay}. It must belong to your municipality.`,
    );
  }

  // Duplicate guard: identical identity in the same barangay is a conflict.
  // The same person moving barangays is a legitimate transfer, not a duplicate.
  const duplicate =
    await repository.findResidentByIdentity({
      lastName,
      firstName,
      middleName,
      birthDate,
    });

  if (
    duplicate &&
    String(
      duplicate.barangay || '',
    ).toLowerCase() ===
      barangay.toLowerCase()
  ) {
    throw ApiError.conflict(
      `A resident with the same name and date of birth is already registered in ${barangay} (${duplicate.healthRecordNo || duplicate.id}).`,
    );
  }

  const ids =
    await repository.nextResidentIds();

  const shouldCreateLoginAccount =
    Boolean(
      payload.createLoginAccount ||
        payload.createResidentLoginAccount ||
        payload.createAccount ||
        payload.createResidentAccount,
    );

  if (shouldCreateLoginAccount) {
    const residentEmail = text(
      payload.email,
    );

    if (!residentEmail) {
      throw ApiError.unprocessable(
        'An email is required when creating a resident login account.',
      );
    }

    const account =
      await createResidentAuthUser({
        email: residentEmail,
        fullName: [
          firstName,
          middleName,
          lastName,
          suffix,
        ]
          .filter(Boolean)
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim(),
        password:
          payload.password || undefined,
      });

    const resident =
      await repository.insertResident({
        ...ids,

        authUserId:
          account.authUserId,

        // An authorized health worker registering a resident in person IS the
        // verification, so the resident record is Verified on creation.
        // This is independent of the login-account state below.
        verificationStatus: 'approved',
        verifiedBy: user?.id || null,
        verifiedAt:
          new Date().toISOString(),

        firstName,
        middleName,
        lastName,
        suffix,
        birthDate,
        birthPlace: text(
          payload.birthPlace,
        ),
        sex,
        civilStatus: text(
          payload.civilStatus,
        ),
        religion: text(
          payload.religion,
        ),
        employmentStatus: text(
          payload.employmentStatus,
        ),
        fatherName: text(
          payload.fatherName,
        ),
        motherName: text(
          payload.motherName,
        ),
        is4PsMember: Boolean(
          payload.is4PsMember,
        ),
        philhealthNo: text(
          payload.philhealthNo,
        ),
        currentAddress: text(
          payload.currentAddress,
        ),
        permanentAddress: text(
          payload.permanentAddress,
        ),
        cellphoneNo: text(
          payload.cellphoneNo,
        ),
        identityNo: text(
          payload.identityNo,
        ),
        barangay: barangayRow.name,
        createdById: user?.id || '',
        createdByRole:
          user?.role || '',
      });

    return {
      ...resident,
      authUserId:
        account.authUserId,
      accountInvited: true,
    };
  }

  return repository.insertResident({
    ...ids,

    // Verified on creation — the staff registration in person is the
    // verification. No login account is created on this path (Account:
    // No Account); the resident may create/claim one later.
    verificationStatus: 'approved',
    verifiedBy: user?.id || null,
    verifiedAt:
      new Date().toISOString(),

    firstName,
    middleName,
    lastName,
    suffix,
    birthDate,
    birthPlace: text(
      payload.birthPlace,
    ),
    sex,
    civilStatus: text(
      payload.civilStatus,
    ),
    religion: text(
      payload.religion,
    ),
    employmentStatus: text(
      payload.employmentStatus,
    ),
    fatherName: text(
      payload.fatherName,
    ),
    motherName: text(
      payload.motherName,
    ),
    is4PsMember: Boolean(
      payload.is4PsMember,
    ),
    philhealthNo: text(
      payload.philhealthNo,
    ),
    currentAddress: text(
      payload.currentAddress,
    ),
    permanentAddress: text(
      payload.permanentAddress,
    ),
    cellphoneNo: text(
      payload.cellphoneNo,
    ),
    identityNo: text(
      payload.identityNo,
    ),
    barangay: barangayRow.name,
    createdById: user?.id || '',
    createdByRole:
      user?.role || '',
  });
};

/**
 * Barangay guard: a barangay-scoped caller (e.g. a Health Supervisor
 * assigned to San Isidro) may only read or write residents of their own
 * barangay.
 *
 * Out-of-scope records read as "not found" so the API never confirms the
 * existence of another barangay's data.
 */
const assertWithinScope = (
  user,
  resident,
) => {
  const scope = assignedBarangay(user);

  if (!scope) return;

  if (
    String(
      resident?.barangay ?? '',
    )
      .trim()
      .toLowerCase() !==
    scope.toLowerCase()
  ) {
    throw ApiError.notFound(
      'Resident record not found',
    );
  }
};

export const getResident = async ({
  id,
  user,
}) => {
  if (!isReadRole(user)) {
    throw ApiError.notFound(
      'Resident record not found',
    );
  }

  const resident =
    await repository.getResident(id);

  if (!resident) {
    throw ApiError.notFound(
      'Resident record not found',
    );
  }

  assertWithinScope(
    user,
    resident,
  );

  await attachAccountStatus([
    resident,
  ]);

  // Attach the authoritative, freshly-computed risk assessment
  // for the Resident Detail view. Never trusts any client-supplied
  // risk value.
  const risk =
    await assessResidentById({
      id: resident.id,
    });

  return {
    ...resident,
    ...risk,
  };
};

export const updateResident = async ({
  id,
  patch = {},
  user,
}) => {
  if (!isEditRole(user)) {
    throw ApiError.forbidden(
      'Your role is not permitted to edit resident records',
    );
  }

  const existing =
    await repository.getResident(id);

  if (!existing) {
    throw ApiError.notFound(
      'Resident record not found',
    );
  }

  assertWithinScope(
    user,
    existing,
  );

  const updates = {};

  for (const key of EDITABLE_RESIDENT_KEYS) {
    if (patch[key] !== undefined) {
      updates[key] = patch[key];
    }
  }

  updates.barangay = String(
    patch.barangay ??
      existing.barangay ??
      '',
  ).trim();

  // A barangay-scoped caller cannot move a resident into another barangay —
  // that would either hide the record or claim it for another area.
  const scope = assignedBarangay(user);

  if (
    scope &&
    updates.barangay.toLowerCase() !==
      scope.toLowerCase()
  ) {
    throw ApiError.forbidden(
      'Your account is assigned to Barangay ' +
        scope +
        ' only',
    );
  }

  updates.currentAddress = String(
    patch.currentAddress ??
      existing.currentAddress ??
      '',
  ).trim();

  updates.permanentAddress = String(
    patch.permanentAddress ??
      existing.permanentAddress ??
      '',
  ).trim();

  updates.cellphoneNo = String(
    patch.cellphoneNo ??
      existing.cellphoneNo ??
      '',
  ).trim();

  updates.philhealthNo = String(
    patch.philhealthNo ??
      existing.philhealthNo ??
      '',
  ).trim();

  // Identity keys (name, DOB) are not editable here to avoid silently
  // splitting a resident's health record; corrections go through an admin.

  return repository.updateResident(
    id,
    updates,
  );
};

export default {
  getResident,
  updateResident,
  getOwnHealthRecords,
};