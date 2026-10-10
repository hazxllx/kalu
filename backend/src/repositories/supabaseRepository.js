/**
 * Supabase (PostgreSQL) repository driver.
 *
 * Implements the same repository contract as the file driver. The API uses the
 * service-role client after `authenticate` + `authorize` have run, so
 * application-level RBAC is enforced in the service layer; the SQL migration
 * additionally enables RLS policies for defense in depth (see
 * supabase/migrations).
 *
 * Human-readable identifiers (RES-/SUB-/REF-) are minted from the
 * `record_counters` table so records look identical across drivers.
 */
import { createAuthClient, getServiceClient } from '../config/supabase.js';
import env from '../config/env.js';

const TABLES = Object.freeze({
  residents: 'residents',
  visits: 'visits',
  referrals: 'referrals',
  households: 'households',
  householdMembers: 'household_members',
  householdMemberHealth: 'household_member_health_profiles',
  counters: 'record_counters',
  verificationLogs: 'resident_verification_logs',
  profiles: 'profiles',
  documents: 'documents',
});

// ---------------------------------------------------------------------------
// Household mapping — the domain shape mirrors what the profiling form sends
// and what the household list/cards render (camelCase), including the
// server-computed risk classification and the HS verification workflow.
// ---------------------------------------------------------------------------
const HOUSEHOLD_TO_DB = {
  id: 'id',
  municipalityId: 'municipality_id',
  barangayId: 'barangay_id',
  headName: 'head_name',
  purok: 'purok',
  streetAddress: 'street_address',
  contact: 'contact',
  families: 'families',
  monthlyIncome: 'monthly_income',
  hhStatus: 'hh_status',
  approvalStatus: 'approval_status',
  respondentLast: 'respondent_last',
  respondentFirst: 'respondent_first',
  respondentMaiden: 'respondent_maiden',
  nhts: 'nhts',
  ip: 'ip',
  philhealthMember: 'philhealth_member',
  philhealthId: 'philhealth_id',
  philhealthCategory: 'philhealth_category',
  waterSource: 'water_source',
  waterType: 'water_type',
  waterDistance: 'water_distance',
  waterAvailability: 'water_availability',
  waterTreated: 'water_treated',
  treatmentMethods: 'treatment_methods',
  toiletType: 'toilet_type',
  sanitationAccess: 'sanitation_access',
  wasteDisposal: 'waste_disposal',
  wasteSegregation: 'waste_segregation',
  quarterVisits: 'quarter_visits',
  latitude: 'latitude',
  longitude: 'longitude',
  riskScore: 'risk_score',
  riskLevel: 'risk_level',
  riskFactors: 'risk_factors',
  flags: 'flags',
  verificationStatus: 'verification_status',
  verifiedBy: 'verified_by',
  verifiedAt: 'verified_at',
  correctionReason: 'correction_reason',
  collectorId: 'collector_id',
  collectorName: 'collector_name',
  createdBy: 'created_by',
  revision: 'revision',
  clientOperationKey: 'client_operation_key',
};

const DB_TO_HOUSEHOLD = Object.fromEntries(
  Object.entries(HOUSEHOLD_TO_DB).map(([k, v]) => [v, k]),
);

const householdToRow = (household) => mapKeys(household, HOUSEHOLD_TO_DB);

const householdFromRow = (row) => {
  const household = mapKeys(row, DB_TO_HOUSEHOLD);
  // Derived display values the UI expects alongside the raw fields.
  household.barangay = row.barangay ?? '';
  household.address = [row.street_address, row.purok].filter(Boolean).join(', ');
  household.createdAt = row.created_at;
  household.updatedAt = row.updated_at;
  // Optimistic-concurrency version (defaults to 1 for rows created before the
  // offline migration added the column).
  household.revision = row.revision ?? 1;
  household.clientOperationKey = row.client_operation_key ?? null;
  return household;
};

const MEMBER_TO_DB = {
  residentId: 'resident_id',
  name: 'name',
  birthday: 'birthday',
  age: 'age',
  sex: 'sex',
  classification: 'classification',
  relationship: 'relationship',
  contact: 'contact',
  isPwd: 'is_pwd',
  philhealth: 'philhealth',
  fpMethod: 'fp_method',
  quarterStatus: 'quarter_status',
  isHead: 'is_head',
};

const DB_TO_MEMBER = Object.fromEntries(Object.entries(MEMBER_TO_DB).map(([k, v]) => [v, k]));

const memberToRow = (member) => mapKeys(member, MEMBER_TO_DB);

const memberFromRow = (row) => ({
  ...mapKeys(row, DB_TO_MEMBER),
  id: row.id,
  householdId: row.household_id,
  createdAt: row.created_at,
});

// Member-level health profile (1:1 with a household member). BMI is a recorded,
// unclassified value recomputed server-side; scope columns are trigger-managed.
const MEMBER_HEALTH_TO_DB = {
  householdMemberId: 'household_member_id',
  heightCm: 'height_cm',
  weightKg: 'weight_kg',
  bmi: 'bmi',
  bmiMeasuredAt: 'bmi_measured_at',
  dateOfDeath: 'date_of_death',
  causeOfDeath: 'cause_of_death',
  transOut: 'trans_out',
  remarks: 'remarks',
  createdBy: 'created_by',
};

const DB_TO_MEMBER_HEALTH = Object.fromEntries(
  Object.entries(MEMBER_HEALTH_TO_DB).map(([k, v]) => [v, k]),
);

const memberHealthToRow = (profile) => mapKeys(profile, MEMBER_HEALTH_TO_DB);

const memberHealthFromRow = (row) => {
  if (!row) return null;
  const profile = mapKeys(row, DB_TO_MEMBER_HEALTH);
  profile.id = row.id;
  profile.householdId = row.household_id;
  profile.municipalityId = row.municipality_id;
  profile.barangayId = row.barangay_id;
  profile.createdAt = row.created_at;
  profile.updatedAt = row.updated_at;
  return profile;
};

const DOCUMENT_TO_DB = {
  id: 'id',
  residentId: 'resident_id',
  transferRequestId: 'transfer_request_id',
  documentType: 'document_type',
  governmentIdType: 'government_id_type',
  fileName: 'file_name',
  storagePath: 'storage_path',
  mimeType: 'mime_type',
  sizeBytes: 'size_bytes',
  verificationStatus: 'verification_status',
  rejectionReason: 'rejection_reason',
  reviewedById: 'reviewed_by',
  reviewedAt: 'reviewed_at',
  uploadedById: 'uploaded_by',
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  // Deterministic automated screening result (advisory; see
  // services/documentVerification.service.js). Null until the upload runs.
  screeningStatus: 'screening_status',
  screeningReason: 'screening_reason',
  screeningQuality: 'screening_quality',
  screeningOcrDetected: 'screening_ocr_detected',
  screeningCheckedAt: 'screening_checked_at',
};

const DB_TO_DOCUMENT = Object.fromEntries(Object.entries(DOCUMENT_TO_DB).map(([k, v]) => [v, k]));

const documentFromRow = (row) => (row ? mapBack(row, DB_TO_DOCUMENT) : null);

async function listHouseholdMembersFor(supabase, householdId) {
  const { data, error } = await supabase
    .from(TABLES.householdMembers)
    .select('*')
    .eq('household_id', householdId)
    .order('created_at', { ascending: true });
  throwOnError(error, 'Could not load household members');
  const members = (data || []).map(memberFromRow);

  // Attach the linked resident's login-account status (read-only, additive) so
  // the household roster can show Active / Pending Activation / No Account. A
  // member is "No Account" unless its linked resident has an auth user whose
  // profile is usable. This never changes membership data or any write path.
  const residentIds = [...new Set(members.map((m) => m.residentId).filter(Boolean))];
  if (residentIds.length) {
    const { data: residentRows, error: resErr } = await supabase
      .from(TABLES.residents)
      .select('id, auth_user_id')
      .in('id', residentIds);
    throwOnError(resErr, 'Could not load member account status');

    const authByResident = new Map();
    const authUserIds = [];
    for (const row of residentRows || []) {
      if (row.auth_user_id) {
        authByResident.set(row.id, row.auth_user_id);
        authUserIds.push(row.auth_user_id);
      }
    }

    const statusByAuthUser = new Map();
    if (authUserIds.length) {
      const { data: profileRows, error: profErr } = await supabase
        .from(TABLES.profiles)
        .select('id, status')
        .in('id', authUserIds);
      throwOnError(profErr, 'Could not load member account status');
      for (const row of profileRows || []) statusByAuthUser.set(row.id, row.status);
    }

    for (const member of members) {
      const authUserId = member.residentId ? authByResident.get(member.residentId) : null;
      if (!authUserId) {
        member.accountStatus = 'none';
      } else {
        const status = statusByAuthUser.get(authUserId);
        member.accountStatus =
          status === 'active' ? 'active' : status === 'disabled' ? 'disabled' : 'pending';
      }
    }
  } else {
    for (const member of members) member.accountStatus = 'none';
  }

  return members;
}

// ---------------------------------------------------------------------------
// Field mapping helpers
// ---------------------------------------------------------------------------

const RESIDENT_TO_DB = {
  id: 'id',
  healthRecordNo: 'health_record_no',
  lastName: 'last_name',
  firstName: 'first_name',
  middleName: 'middle_name',
  suffix: 'suffix',
  birthDate: 'birth_date',
  birthPlace: 'birth_place',
  sex: 'sex',
  civilStatus: 'civil_status',
  religion: 'religion',
  employmentStatus: 'employment_status',
  fatherName: 'father_name',
  motherName: 'mother_name',
  is4PsMember: 'is_4ps_member',
  philhealthNo: 'philhealth_no',
  currentAddress: 'current_address',
  permanentAddress: 'permanent_address',
  cellphoneNo: 'cellphone_no',
  identityNo: 'identity_no',
  zone: 'zone',
  barangay: 'barangay',
  barangayId: 'barangay_id',
  municipalityId: 'municipality_id',
  verificationStatus: 'verification_status',
  verificationSubmittedBy: 'verification_submitted_by',
  verifiedBy: 'verified_by',
  verifiedAt: 'verified_at',
  rejectionReason: 'rejection_reason',
  submittedForVerificationAt: 'submitted_for_verification_at',
  authUserId: 'auth_user_id',
  createdAt: 'created_at',
  createdById: 'created_by_id',
  createdByRole: 'created_by_role',
  // Persisted authoritative risk assessment (computed server-side; never
  // trusted from the client). See services/residentRisk.service.js.
  riskScore: 'risk_score',
  riskLevel: 'risk_level',
  riskFactors: 'risk_factors',
  riskAssessedAt: 'risk_assessed_at',
  // Denormalized mirror of the minor's active guardian-link status
  // (service-maintained; the resident_guardian_links table is the source of
  // truth). Phase 2.2.
  guardianStatus: 'guardian_status',
  minorVerificationMethod: 'minor_verification_method',
  minorAlternativeStatus: 'minor_alternative_status',
  minorAlternativeReason: 'minor_alternative_reason',
  minorAlternativeReviewedBy: 'minor_alternative_reviewed_by',
  minorAlternativeReviewedAt: 'minor_alternative_reviewed_at',
};

const DB_TO_RESIDENT = Object.fromEntries(Object.entries(RESIDENT_TO_DB).map(([k, v]) => [v, k]));

const VISIT_TO_DB = {
  id: 'id',
  residentId: 'resident_id',
  recordedById: 'recorded_by_id',
  recordedByRole: 'recorded_by_role',
  recordedByName: 'recorded_by_name',
  responsiblePersonnelId: 'responsible_personnel_id',
  responsiblePersonnelName: 'responsible_personnel_name',
  facilityId: 'facility_id',
  status: 'status',
  visitDate: 'visit_date',
  chiefComplaint: 'chief_complaint',
  clinicalHistory: 'clinical_history',
  findings: 'findings',
  treatmentGiven: 'treatment_given',
  recommendation: 'recommendation',
  submittedAt: 'submitted_at',
  receivedAt: 'received_at',
  reviewedAt: 'reviewed_at',
  referredAt: 'referred_at',
  completedAt: 'completed_at',
};

const DB_TO_VISIT = Object.fromEntries(Object.entries(VISIT_TO_DB).map(([k, v]) => [v, k]));

const REFERRAL_TO_DB = {
  id: 'id',
  residentId: 'resident_id',
  visitId: 'visit_id',
  status: 'status',
  referringFacility: 'referring_facility',
  referringFacilityAddress: 'referring_facility_address',
  referringPersonnel: 'referring_personnel',
  referringContact: 'referring_contact',
  receivingFacility: 'receiving_facility',
  receivingFacilityAddress: 'receiving_facility_address',
  receivingPersonnel: 'receiving_personnel',
  referralDate: 'referral_date',
  appointmentDate: 'appointment_date',
  appointmentTime: 'appointment_time',
  reasonForReferral: 'reason_for_referral',
  workingImpression: 'working_impression',
  referralCategory: 'referral_category',
  outpatientService: 'outpatient_service',
  printedAt: 'printed_at',
  createdById: 'created_by_id',
  createdByRole: 'created_by_role',
  createdByName: 'created_by_name',
};

const DB_TO_REFERRAL = Object.fromEntries(Object.entries(REFERRAL_TO_DB).map(([k, v]) => [v, k]));

const mapKeys = (obj, mapping) => {
  const out = {};
  for (const [from, to] of Object.entries(mapping)) {
    if (obj[from] !== undefined) out[to] = obj[from];
  }
  return out;
};

const mapBack = (row, mapping) => {
  const out = {};
  for (const [dbKey, domainKey] of Object.entries(mapping)) {
    if (row[dbKey] !== undefined) out[domainKey] = row[dbKey];
  }
  return out;
};

const residentToRow = (resident) => mapKeys(resident, RESIDENT_TO_DB);
const residentFromRow = (row) => (row ? mapBack(row, DB_TO_RESIDENT) : null);

const GUARDIAN_LINK_TO_DB = {
  id: 'id',
  minorResidentId: 'minor_resident_id',
  guardianResidentId: 'guardian_resident_id',
  guardianAuthUserId: 'guardian_auth_user_id',
  guardianAcceptedById: 'guardian_accepted_by_id',
  guardianAcceptedAt: 'guardian_accepted_at',
  guardianLastName: 'guardian_last_name',
  guardianFirstName: 'guardian_first_name',
  guardianMiddleName: 'guardian_middle_name',
  relationshipType: 'relationship_type',
  guardianCellphoneNo: 'guardian_cellphone_no',
  guardianIdentityNo: 'guardian_identity_no',
  consentRecorded: 'consent_recorded',
  consentNote: 'consent_note',
  verificationStatus: 'verification_status',
  verificationNote: 'verification_note',
  verifiedById: 'verified_by_id',
  verifiedByRole: 'verified_by_role',
  verifiedByName: 'verified_by_name',
  verifiedAt: 'verified_at',
  createdById: 'created_by_id',
  createdByRole: 'created_by_role',
  createdByName: 'created_by_name',
  createdAt: 'created_at',
  updatedAt: 'updated_at',
};

const DB_TO_GUARDIAN_LINK = Object.fromEntries(Object.entries(GUARDIAN_LINK_TO_DB).map(([k, v]) => [v, k]));

const guardianLinkToRow = (link) => {
  const row = mapKeys(link, GUARDIAN_LINK_TO_DB);
  // Explicit NULL for "no linked resident" (mapKeys skips undefined keys).
  if (row.guardian_resident_id === undefined) row.guardian_resident_id = null;
  return row;
};

const guardianLinkFromRow = (row) => (row ? mapBack(row, DB_TO_GUARDIAN_LINK) : null);

const RISK_CRITERION_TO_DB = {
  code: 'code',
  name: 'name',
  description: 'description',
  field: 'field',
  operator: 'operator',
  value: 'value',
  value2: 'value2',
  weight: 'weight',
  enabled: 'enabled',
  priority: 'priority',
};
const DB_TO_RISK_CRITERION = Object.fromEntries(Object.entries(RISK_CRITERION_TO_DB).map(([k, v]) => [v, k]));
const riskCriterionToRow = (criterion) => mapKeys(criterion, RISK_CRITERION_TO_DB);
const riskCriterionFromRow = (row) => (row ? mapBack(row, DB_TO_RISK_CRITERION) : null);

/**
 * Vitals out of the database in the DOMAIN shape (camelCase) — the same keys
 * the intake service accepts — so a saved submission round-trips unchanged.
 */
const vitalsFromRow = (row) => {
  const vitals = {};
  if (row.bp !== undefined && row.bp !== null) vitals.bp = row.bp;
  if (row.hr !== undefined && row.hr !== null) vitals.hr = row.hr;
  if (row.rr !== undefined && row.rr !== null) vitals.rr = row.rr;
  if (row.o2sat !== undefined && row.o2sat !== null) vitals.o2sat = row.o2sat;
  if (row.temperature !== undefined && row.temperature !== null) vitals.temperature = row.temperature;
  if (row.height_cm !== undefined && row.height_cm !== null) vitals.heightCm = row.height_cm;
  if (row.weight_kg !== undefined && row.weight_kg !== null) vitals.weightKg = row.weight_kg;
  if (row.bmi !== undefined && row.bmi !== null) vitals.bmi = row.bmi;
  if (row.bmi_category !== undefined && row.bmi_category !== null) vitals.bmiCategory = row.bmi_category;
  if (row.blood_sugar !== undefined && row.blood_sugar !== null) vitals.bloodSugar = row.blood_sugar;
  return vitals;
};

const visitToRow = (visit) => {
  const row = mapKeys(visit, VISIT_TO_DB);
  if (visit.vitals) {
    const v = visit.vitals;
    if (v.bp !== undefined) row.bp = v.bp;
    if (v.hr !== undefined) row.hr = v.hr;
    if (v.rr !== undefined) row.rr = v.rr;
    if (v.o2sat !== undefined) row.o2sat = v.o2sat;
    if (v.temperature !== undefined) row.temperature = v.temperature;
    if (v.heightCm !== undefined) row.height_cm = v.heightCm;
    if (v.weightKg !== undefined) row.weight_kg = v.weightKg;
    if (v.bmi !== undefined) row.bmi = v.bmi;
    if (v.bmiCategory !== undefined) row.bmi_category = v.bmiCategory;
    if (v.bloodSugar !== undefined) row.blood_sugar = v.bloodSugar;
  }
  if (visit.phn) {
    if (visit.phn.assessment !== undefined) row.phn_assessment = visit.phn.assessment;
    if (visit.phn.notes !== undefined) row.phn_notes = visit.phn.notes;
    if (visit.phn.personnel !== undefined) row.phn_personnel = visit.phn.personnel;
  }
  return row;
};

const visitFromRow = (row) => {
  if (!row) return null;
  const out = mapBack(row, DB_TO_VISIT);
  const vitals = vitalsFromRow(row);
  if (Object.keys(vitals).length) out.vitals = vitals;
  if (row.phn_assessment !== null || row.phn_notes !== null || row.phn_personnel !== null) {
    out.phn = {};
    if (row.phn_assessment !== null && row.phn_assessment !== undefined) out.phn.assessment = row.phn_assessment;
    if (row.phn_notes !== null && row.phn_notes !== undefined) out.phn.notes = row.phn_notes;
    if (row.phn_personnel !== null && row.phn_personnel !== undefined) out.phn.personnel = row.phn_personnel;
  }
  return out;
};

const referralToRow = (referral) => {
  const row = mapKeys(referral, REFERRAL_TO_DB);
  if (referral.patientSnapshot) row.patient_snapshot = referral.patientSnapshot;
  if (referral.visitSnapshot) row.visit_snapshot = referral.visitSnapshot;
  return row;
};

const referralFromRow = (row) => {
  if (!row) return null;
  const out = mapBack(row, DB_TO_REFERRAL);
  if (row.patient_snapshot !== null && row.patient_snapshot !== undefined) out.patientSnapshot = row.patient_snapshot;
  if (row.visit_snapshot !== null && row.visit_snapshot !== undefined) out.visitSnapshot = row.visit_snapshot;
  return out;
};

// Resident verification audit-log row -> domain shape.
const verificationLogFromRow = (row) => ({
  id: row.id,
  residentId: row.resident_id,
  reviewedBy: row.reviewed_by ?? null,
  action: row.action,
  reason: row.reason || '',
  previousStatus: row.previous_status ?? null,
  newStatus: row.new_status,
  createdAt: row.created_at,
});

// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------

// The persisted resident risk classification (risk_score / risk_level /
// risk_factors / risk_assessed_at) is the authoritative, rule-based result
// written by services/residentRisk.service.js behind the resident-risk
// migration (supabase/migrations/20261004000000_resident_risk_configuration).
// It is only ever READ through the resident reads that `select('*')`
// (getResident / listResidents / searchResidents), which transparently include
// the columns when the migration is applied and omit them when it is not.
//
// Embedded resident joins on visits/referrals do not need risk or minor-review
// fields. Keep migration-dependent columns out of this projection so analytics
// remains readable while the live database is behind those optional migrations.
const RESIDENT_OPTIONAL_COLUMNS = new Set([
  'risk_score',
  'risk_level',
  'risk_factors',
  'risk_assessed_at',
  'minor_verification_method',
  'minor_alternative_status',
  'minor_alternative_reason',
  'minor_alternative_reviewed_by',
  'minor_alternative_reviewed_at',
]);
const SELECT_RESIDENT = Object.keys(DB_TO_RESIDENT)
  .filter((column) => !RESIDENT_OPTIONAL_COLUMNS.has(column))
  .join(',');

// BUG-012: transfer_requests carries OTP secret material (otp_hash,
// otp_expires_at, otp_attempts, otp_verified_at, otp_locked_until). API reads
// must NEVER select those columns — this explicit allow-list replaces SELECT *
// on every transfer read/write path. OTP verification stays server-side inside
// public.approve_transfer_request().
const TRANSFER_SAFE_COLUMNS =
  'id, auth_user_id, status, resident_id, target_resident_id, from_barangay_id, to_barangay_id, reason, submitted_at, reviewed_by, reviewed_at, rejection_reason, created_at, updated_at';

const throwOnError = (error, fallback) => {
  if (error) {
    const err = new Error(error.message || fallback);
    err.details = error;
    throw err;
  }
};

/**
 * True when a write failed only because the additive automated-screening
 * columns are not present yet (migration not applied). Used to transparently
 * fall back to the base document row instead of breaking uploads.
 */
const isMissingScreeningColumn = (error) => {
  const code = error?.code || '';
  const message = error?.message || '';
  return code === 'PGRST204' || /screening_[a-z_]+/.test(message)
    || (/column/i.test(message) && /documents/i.test(message));
};

/**
 * True when a write failed only because the offline-sync columns
 * (`revision` / `client_operation_key`) are not present yet (migration not
 * applied). Lets the online household workflow keep working unchanged against a
 * database that has not received `20261006130000_offline_sync_operations.sql`.
 */
const isMissingOfflineColumn = (error) => {
  const code = error?.code || error?.details?.code || '';
  const message = error?.message || error?.details?.message || '';
  return (
    code === 'PGRST204' ||
    code === '42703' ||
    (/client_operation_key|revision/i.test(message) && /column/i.test(message))
  );
};

/**
 * True when the `create_household_with_members` RPC is not present yet (offline
 * migration not applied). The service then uses the legacy sequential insert.
 */
const isMissingRpc = (error) => {
  const code = error?.code || '';
  const message = error?.message || '';
  return (
    code === 'PGRST202' ||
    /could not find the function|function .* does not exist|schema cache/i.test(message)
  );
};

// ----- resident free-text search -------------------------------------------

/** Columns a resident directory search matches against, in priority order. */
const RESIDENT_SEARCH_COLUMNS = Object.freeze([
  'first_name',
  'middle_name',
  'last_name',
  'health_record_no',
  'philhealth_no',
  'cellphone_no',
]);

/** PostgREST `or=` treats , ( ) and . as syntax, so a typed term must not. */
const escapeSearchToken = (value) =>
  String(value ?? '')
    .replace(/[,()%*\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Build a PostgREST `or=` filter for a resident name / identifier search.
 *
 * The term is tokenised on whitespace and every token must match at least one
 * column (AND across tokens, OR across columns). This is what makes a real
 * name search work: the previous single-pattern form turned "Maria Santos" into
 * `first_name.ilike.%Maria Santos%`, which can never match because a first
 * name has no space in it. Matching is case-insensitive through `ilike`.
 */
const residentSearchFilter = (term, { includeBarangay = false } = {}) => {
  const columns = includeBarangay ? [...RESIDENT_SEARCH_COLUMNS, 'barangay'] : RESIDENT_SEARCH_COLUMNS;
  const tokens = String(term ?? '')
    .split(/\s+/)
    .map(escapeSearchToken)
    .filter(Boolean);

  if (!tokens.length) return null;

  // OR across columns within a token, AND across tokens.
  const perToken = tokens.map((token) => {
    const anyColumn = columns.map((column) => `${column}.ilike.%${token}%`).join(',');
    return `or(${anyColumn})`;
  });

  return tokens.length > 1 ? `and(${perToken.join(',')})` : `or(${perToken[0]})`;
};

// ----- profiles (Admin User Management) -----------------------------------
// The curated column set the Admin console needs. `profiles` holds no secret
// material (no password/token columns exist on it), but we still select an
// explicit allow-list so the API can never leak columns added later.
const PROFILE_ADMIN_COLUMNS =
  'id,email,full_name,role,status,municipality_id,barangay_id,facility_id,position,license_no,contact,created_at,updated_at';
const PROFILE_ADMIN_SELECT =
  `${PROFILE_ADMIN_COLUMNS},barangay:barangays(name),municipality:municipalities(name),facility:facilities(name)`;
const PROFILE_ADMIN_BASE_SELECT = PROFILE_ADMIN_COLUMNS;

/** Only the embedded barangay/municipality relationship lookup is unavailable. */
const isEmbeddedResourceUnavailable = (error) => {
  const code = error?.code || '';
  const message = error?.message || '';
  return code === 'PGRST200' || /could not find a relationship/i.test(message);
};

/** Map a profiles row to the curated admin-user shape (no secrets). */
const profileToAdminUser = (row) => ({
  id: row.id,
  email: row.email,
  name: row.full_name || row.email,
  role: row.role,
  status: row.status,
  municipalityId: row.municipality_id ?? null,
  municipality: row.municipality?.name ?? null,
  barangayId: row.barangay_id ?? null,
  barangay: row.barangay?.name ?? null,
  facilityId: row.facility_id ?? null,
  facility: row.facility?.name ?? null,
  position: row.position || '',
  licenseNo: row.license_no || '',
  contact: row.contact || '',
  createdAt: row.created_at ?? null,
  updatedAt: row.updated_at ?? null,
});

const counterRpc = async (name) => {
  const supabase = getServiceClient();
  // One retry on transport failures only. supabase-js surfaces those either as
  // a thrown TypeError ("fetch failed") or as a returned error whose message
  // is "fetch failed" — both are transient (idle keep-alive connections
  // dropping); a retry can at worst skip an id, far better than a hard 500.
  // API-level errors are deterministic and rethrown immediately.
  const isTransportFailure = (err) =>
    err instanceof TypeError || /fetch failed|networkerror/i.test(String(err?.message || ''));
  let lastError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const { data, error } = await supabase.rpc('increment_counter', { counter_name: name });
      if (error && isTransportFailure(error)) throw new TypeError(error.message);
      throwOnError(error, `Could not allocate ${name} identifier`);
      return data;
    } catch (err) {
      lastError = err;
      if (!isTransportFailure(err)) throw err;
    }
  }
  throw lastError;
};

export const supabaseRepository = {
  driver: 'supabase',

  async nextResidentIds() {
    const n = await counterRpc('residents');
    return { id: `RES-${String(n).padStart(6, '0')}`, healthRecordNo: `RHU-${String(n).padStart(6, '0')}` };
  },

  async nextSubmissionId() {
    const n = await counterRpc('submissions');
    return { id: `SUB-${String(n).padStart(6, '0')}` };
  },

  async nextReferralId() {
    const n = await counterRpc('referrals');
    return { id: `REF-${String(n).padStart(6, '0')}` };
  },

  async nextHouseholdId() {
    const n = await counterRpc('households');
    return { id: `HH-${String(n).padStart(3, '0')}` };
  },

  // ----- residents ----------------------------------------------------------
  /**
   * PostgREST `or=` filter for a free-text resident search.
   *
   * The previous implementation injected the WHOLE search string into every
   * column pattern, so a multi-word query such as "Maria Santos" became
   * `first_name.ilike.%Maria Santos%` and matched nothing (a first name never
   * contains a space). The term is now split on whitespace and every token must
   * match at least one column, so "Maria Santos", "santos maria" and "maria"
   * all work regardless of which name part holds the token.
   *
   * Matching stays case-insensitive (ilike) and the OR across columns means
   * first / middle / last name, record number, PhilHealth number and mobile
   * are all searchable from one field.
   */
  async searchResidents({ q = '', limit = 20, barangay = null, municipalityId = null } = {}) {
    const supabase = getServiceClient();
    let query = supabase.from(TABLES.residents).select('*').order('created_at', { ascending: false }).limit(limit);
    if (q) query = query.or(residentSearchFilter(q, { includeBarangay: true }));
    if (barangay) query = query.eq('barangay', barangay);
    if (municipalityId) query = query.eq('municipality_id', municipalityId);
    const { data, error } = await query;
    throwOnError(error, 'Could not search residents');
    return (data || []).map(residentFromRow);
  },

  /**
   * Scope-aware directory listing. `barangay` filters on the canonical text
   * column (kept in sync with barangay_id by the residents_sync_scope
   * trigger); `municipalityId` limits rows to the caller's municipality.
   * Returns { rows, total }.
   */
  async listResidents({ q = '', limit = 50, offset = 0, barangay = null, municipalityId = null, verificationStatuses = null } = {}) {
    const supabase = getServiceClient();
    let query = supabase
      .from(TABLES.residents)
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);
    if (q) query = query.or(residentSearchFilter(q));
    if (barangay) query = query.eq('barangay', barangay);
    if (municipalityId) query = query.eq('municipality_id', municipalityId);
    if (verificationStatuses && verificationStatuses.length) query = query.in('verification_status', verificationStatuses);
    const { data, error, count } = await query;
    throwOnError(error, 'Could not list residents');
    return { rows: (data || []).map(residentFromRow), total: count ?? (data || []).length };
  },

  /**
   * Resident ids that belong to a VERIFIED household within the given scope.
   * Only members explicitly linked to a resident record (resident_id) count;
   * free-form roster entries are ignored. Used to include household-verified
   * residents in the verified directory without a second verification system.
   */
  async verifiedHouseholdResidentIds({ barangay = null, municipalityId = null } = {}) {
    const supabase = getServiceClient();
    let query = supabase
      .from('household_members')
      .select('resident_id, households!inner(verification_status, barangay, municipality_id)')
      .not('resident_id', 'is', null)
      .eq('households.verification_status', 'Verified');
    if (barangay) query = query.eq('households.barangay', barangay);
    if (municipalityId) query = query.eq('households.municipality_id', municipalityId);
    const { data, error } = await query;
    throwOnError(error, 'Could not load verified household members');
    return [...new Set((data || []).map((row) => row.resident_id).filter(Boolean))];
  },

  /** Fetch residents by id, scope- and search-filtered. Returns mapped rows. */
  async listResidentsByIds({ ids = [], q = '', barangay = null, municipalityId = null } = {}) {
    if (!ids.length) return [];
    const supabase = getServiceClient();
    let query = supabase
      .from(TABLES.residents)
      .select('*')
      .in('id', ids)
      .order('created_at', { ascending: false });
    if (barangay) query = query.eq('barangay', barangay);
    if (municipalityId) query = query.eq('municipality_id', municipalityId);
    if (q) query = query.or(residentSearchFilter(q));
    const { data, error } = await query;
    throwOnError(error, 'Could not list residents');
    return (data || []).map(residentFromRow);
  },

  /** Barangay reference lookup (name, optionally restricted to a municipality). */
  async findBarangayByName(name, municipalityId = null) {
    const supabase = getServiceClient();
    let query = supabase
      .from('barangays')
      .select('id, name, municipality_id, municipality:municipalities(name)')
      .ilike('name', String(name || '').trim())
      .limit(2);
    if (municipalityId) query = query.eq('municipality_id', municipalityId);
    const { data, error } = await query;
    throwOnError(error, 'Could not look up barangay');
    const row = (data || [])[0];
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      municipalityId: row.municipality_id,
      municipality: row.municipality?.name || null,
    };
  },

  /** Barangays (with map coordinates) in a municipality, or all when null. */
  async listBarangays({ municipalityId = null } = {}) {
    const supabase = getServiceClient();
    let query = supabase
      .from('barangays')
      .select('id, name, latitude, longitude, municipality_id, status')
      .order('name', { ascending: true });
    if (municipalityId) query = query.eq('municipality_id', municipalityId);
    const { data, error } = await query;
    throwOnError(error, 'Could not list barangays');
    return data || [];
  },

  /** One municipality (with its centre coordinates) by id, or null. */
  async getMunicipality(municipalityId) {
    if (!municipalityId) return null;
    const supabase = getServiceClient();
    const { data, error } = await supabase
      .from('municipalities')
      .select('id, name, province, region, latitude, longitude')
      .eq('id', municipalityId)
      .maybeSingle();
    throwOnError(error, 'Could not load municipality');
    return data || null;
  },

  // ----- households ----------------------------------------------------------

  /**
   * Scope-aware household listing. `barangay` filters on the synced name,
   * `municipalityId` on the caller's municipality; `q` searches id, head,
   * purok, street and collector. Returns { rows, total }.
   */
  async listHouseholds({ q = '', barangay = null, municipalityId = null, limit = 50, offset = 0 } = {}) {
    const supabase = getServiceClient();
    let query = supabase
      .from(TABLES.households)
      .select('*, members:household_members(count)', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);
    if (q) {
      const term = String(q).trim();
      query = query.or(
        `id.ilike.%${term}%,head_name.ilike.%${term}%,purok.ilike.%${term}%,street_address.ilike.%${term}%,collector_name.ilike.%${term}%,barangay.ilike.%${term}%`,
      );
    }
    if (barangay) query = query.eq('barangay', barangay);
    if (municipalityId) query = query.eq('municipality_id', municipalityId);
    const { data, error, count } = await query;
    throwOnError(error, 'Could not list households');
    return {
      rows: (data || []).map((row) => ({
        ...householdFromRow(row),
        memberCount: row.members?.[0]?.count ?? 0,
      })),
      total: count ?? (data || []).length,
    };
  },

  /** Single household (scope checked by the service + RLS), with members. */
  async getHousehold(id) {
    const supabase = getServiceClient();
    const { data, error } = await supabase
      .from(TABLES.households)
      .select('*')
      .eq('id', id)
      .maybeSingle();
    throwOnError(error, 'Could not load household');
    if (!data) return null;
    const members = await listHouseholdMembersFor(supabase, id);
    return { ...householdFromRow(data), members };
  },

  /**
   * Households (clustered per family) with their member resident links, scoped
   * for the Community Health Map. Returns households with coordinates and the
   * set of linked resident ids so the service can flag active cases per
   * household WITHOUT exposing any resident identity on the map.
   */
  async listHouseholdsForMap({ barangay = null, municipalityId = null, limit = 2000 } = {}) {
    const supabase = getServiceClient();
    let query = supabase
      .from(TABLES.households)
      .select('id, barangay, barangay_id, municipality_id, latitude, longitude, risk_level, risk_score, purok, members:household_members(id, resident_id)')
      .limit(limit);
    if (barangay) query = query.eq('barangay', barangay);
    if (municipalityId) query = query.eq('municipality_id', municipalityId);
    const { data, error } = await query;
    throwOnError(error, 'Could not list households for the map');
    return (data || []).map((row) => ({
      id: row.id,
      barangay: row.barangay ?? '',
      barangayId: row.barangay_id ?? null,
      municipalityId: row.municipality_id ?? null,
      latitude: row.latitude != null ? Number(row.latitude) : null,
      longitude: row.longitude != null ? Number(row.longitude) : null,
      riskLevel: row.risk_level ?? null,
      riskScore: row.risk_score ?? null,
      purok: row.purok ?? '',
      memberCount: Array.isArray(row.members) ? row.members.length : 0,
      residentIds: Array.isArray(row.members)
        ? row.members.map((m) => m.resident_id).filter(Boolean)
        : [],
    }));
  },

  async insertHousehold(household) {
    const supabase = getServiceClient();
    const row = householdToRow(household);
    let { data, error } = await supabase
      .from(TABLES.households)
      .insert(row)
      .select('*')
      .single();
    if (error && isMissingOfflineColumn(error)) {
      // Migration not applied yet: retry without the additive operation-key
      // column so online creation keeps working. Idempotency activates once the
      // migration is deployed.
      const { client_operation_key: _omit, ...compat } = row;
      ({ data, error } = await supabase
        .from(TABLES.households)
        .insert(compat)
        .select('*')
        .single());
    }
    if (error) {
      // Database-enforced idempotency: a replayed create carries the same
      // client_operation_key, which is unique. Surface it as 23505 so the
      // service returns the already-created household instead of failing.
      if (error.code === '23505' && household?.clientOperationKey) {
        const duplicate = new Error('A household for this operation already exists.');
        duplicate.code = '23505';
        duplicate.statusCode = 409;
        duplicate.details = error;
        throw duplicate;
      }
      throwOnError(error, 'Could not save household');
    }
    return householdFromRow(data);
  },

  /**
   * Atomically create a household and all of its members in ONE database
   * transaction via `public.create_household_with_members`. Returns
   * `{ household, deduplicated }`, or `null` when the function is not deployed
   * yet so the caller can fall back to the legacy sequential insert.
   */
  async createHouseholdWithMembers(household, members = []) {
    const supabase = getServiceClient();
    const { data, error } = await supabase.rpc('create_household_with_members', {
      p_household: householdToRow(household),
      p_members: (members || []).map(memberToRow),
      p_client_operation_key: household?.clientOperationKey || null,
    });
    if (error) {
      if (isMissingRpc(error)) return null;
      if (error.code === '23505' && household?.clientOperationKey) {
        const existing = await this.findHouseholdByOperationKey(household.clientOperationKey);
        if (existing) return { household: existing, deduplicated: true };
      }
      if (error.code === '23505') {
        const duplicate = new Error(
          'A household for that head and address is already registered.',
        );
        duplicate.statusCode = 409;
        duplicate.details = error;
        throw duplicate;
      }
      throwOnError(error, 'Could not create household');
    }
    const payload = Array.isArray(data) ? data[0] : data;
    const row = payload?.household ?? payload;
    return { household: householdFromRow(row), deduplicated: Boolean(payload?.deduplicated) };
  },

  /** The household created by a given offline operation key, or null. */
  async findHouseholdByOperationKey(clientOperationKey) {
    if (!clientOperationKey) return null;
    const supabase = getServiceClient();
    const { data, error } = await supabase
      .from(TABLES.households)
      .select('*')
      .eq('client_operation_key', clientOperationKey)
      .maybeSingle();
    // Column not migrated yet: behave as "no prior operation" so the online
    // workflow is unaffected until the migration is applied.
    if (error && isMissingOfflineColumn(error)) return null;
    throwOnError(error, 'Could not look up household by operation key');
    return data ? householdFromRow(data) : null;
  },

  async updateHousehold(id, patch, { expectedRevision = null } = {}) {
    const supabase = getServiceClient();
    const usesConcurrency = expectedRevision !== null && expectedRevision !== undefined;
    const row = householdToRow(patch);
    const runUpdate = (columns) => {
      let query = supabase.from(TABLES.households).update(columns).eq('id', id);
      if (usesConcurrency) {
        // Conditional write: only applies when the stored revision still
        // matches, so a concurrent edit cannot be silently overwritten.
        query = query.eq('revision', Number(expectedRevision));
      }
      return query.select('*').maybeSingle();
    };
    let { data, error } = await runUpdate(row);
    if (error && isMissingOfflineColumn(error)) {
      // Migration not applied yet: retry without the additive columns so online
      // updates keep working (no revision bump until the migration is deployed).
      const { revision: _r, client_operation_key: _k, ...compat } = row;
      ({ data, error } = await runUpdate(compat));
    }
    throwOnError(error, 'Could not update household');
    return data ? householdFromRow(data) : null;
  },

  /** True when a household with the same head + purok + street exists in scope. */
  async findHouseholdDuplicate({ barangayId, headName, purok, streetAddress }) {
    const supabase = getServiceClient();
    const { data, error } = await supabase
      .from(TABLES.households)
      .select('id, head_name')
      .eq('barangay_id', barangayId)
      .ilike('head_name', String(headName || '').trim())
      .ilike('purok', String(purok || '').trim())
      .ilike('street_address', String(streetAddress || '').trim())
      .limit(1);
    throwOnError(error, 'Could not check for duplicate households');
    return (data || [])[0] || null;
  },

  async addHouseholdMember(householdId, member) {
    const supabase = getServiceClient();
    const { data, error } = await supabase
      .from(TABLES.householdMembers)
      .insert({ ...memberToRow(member), household_id: householdId })
      .select('*')
      .single();
    if (error) {
      // Unique violation on (household_id, resident_id) = duplicate member.
      if (error.code === '23505') {
        const duplicate = new Error('That resident is already a member of this household.');
        duplicate.statusCode = 409;
        throw duplicate;
      }
      throwOnError(error, 'Could not add household member');
    }
    return memberFromRow(data);
  },

  async removeHouseholdMember(householdId, memberId) {
    const supabase = getServiceClient();
    const { data, error } = await supabase
      .from(TABLES.householdMembers)
      .delete()
      .eq('id', memberId)
      .eq('household_id', householdId)
      .select('id')
      .maybeSingle();
    throwOnError(error, 'Could not remove household member');
    return Boolean(data);
  },

  /** Member health profile (1:1) or null when none has been recorded yet. */
  async getMemberHealthProfile(householdMemberId) {
    const supabase = getServiceClient();
    const { data, error } = await supabase
      .from(TABLES.householdMemberHealth)
      .select('*')
      .eq('household_member_id', householdMemberId)
      .maybeSingle();
    throwOnError(error, 'Could not load member health profile');
    return memberHealthFromRow(data);
  },

  /**
   * Insert-or-update the member health profile. The parent household id and
   * scope columns are set by a database trigger from the linked member, so they
   * are never accepted here. Returns the persisted row.
   */
  async upsertMemberHealthProfile(householdMemberId, patch = {}) {
    const supabase = getServiceClient();
    const existing = await this.getMemberHealthProfile(householdMemberId);
    const row = memberHealthToRow({ ...patch, householdMemberId });
    if (existing) {
      // Preserve the original creator on updates.
      delete row.created_by;
      const { data, error } = await supabase
        .from(TABLES.householdMemberHealth)
        .update(row)
        .eq('household_member_id', householdMemberId)
        .select('*')
        .single();
      throwOnError(error, 'Could not update member health profile');
      return memberHealthFromRow(data);
    }
    const { data, error } = await supabase
      .from(TABLES.householdMemberHealth)
      .insert(row)
      .select('*')
      .single();
    throwOnError(error, 'Could not save member health profile');
    return memberHealthFromRow(data);
  },

  async findResidentByIdentity({ lastName, firstName, middleName, birthDate, identityNo } = {}) {
    const supabase = getServiceClient();
    let query = supabase
      .from(TABLES.residents)
      .select('*')
      .limit(5);
    if (identityNo) query = query.eq('identity_no', String(identityNo).trim());
    else {
      query = query
        .ilike('last_name', String(lastName || '').trim())
        .ilike('first_name', String(firstName || '').trim());
    }
    if (middleName) query = query.ilike('middle_name', String(middleName).trim());
    if (birthDate) query = query.eq('birth_date', birthDate);
    const { data, error } = await query;
    throwOnError(error, 'Could not look up resident');
    const rows = data || [];
    const exact = rows.find((r) => {
      if (middleName && String(r.middle_name || '').toLowerCase() !== String(middleName).toLowerCase()) return false;
      if (birthDate && r.birth_date !== birthDate) return false;
      return true;
    });
    return exact ? residentFromRow(exact) : rows[0] ? residentFromRow(rows[0]) : null;
  },

  async getResident(id) {
    const supabase = getServiceClient();
    const { data, error } = await supabase.from(TABLES.residents).select('*').eq('id', id).maybeSingle();
    throwOnError(error, 'Could not fetch resident');
    return residentFromRow(data);
  },

  async insertResident(resident) {
    const supabase = getServiceClient();
    const { data, error } = await supabase.from(TABLES.residents).insert(residentToRow(resident)).select().single();
    throwOnError(error, 'Could not create resident');
    return residentFromRow(data);
  },

  async updateResident(id, patch) {
    const supabase = getServiceClient();
    const { data, error } = await supabase
      .from(TABLES.residents)
      .update({ ...residentToRow(patch), updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .maybeSingle();
    throwOnError(error, 'Could not update resident');
    return residentFromRow(data);
  },

  /**
   * Manual-verification queue: residents filtered by verification status,
   * scope and search term. Oldest submission first so the reviewer works
   * through the queue in order. Returns { rows, total }.
   */
  async listResidentsByVerificationStatus({
    statuses = null,
    q = '',
    barangay = null,
    municipalityId = null,
    limit = 100,
    offset = 0,
  } = {}) {
    const supabase = getServiceClient();
    let query = supabase
      .from(TABLES.residents)
      .select('*', { count: 'exact' })
      .order('submitted_for_verification_at', { ascending: true, nullsFirst: false })
      .range(offset, offset + limit - 1);
    if (statuses && statuses.length) query = query.in('verification_status', statuses);
    if (q) {
      const term = String(q).trim();
      query = query.or(
        `first_name.ilike.%${term}%,last_name.ilike.%${term}%,middle_name.ilike.%${term}%,health_record_no.ilike.%${term}%,cellphone_no.ilike.%${term}%`,
      );
    }
    if (barangay) query = query.eq('barangay', barangay);
    if (municipalityId) query = query.eq('municipality_id', municipalityId);
    const { data, error, count } = await query;
    throwOnError(error, 'Could not load the resident verification queue');
    return { rows: (data || []).map(residentFromRow), total: count ?? (data || []).length };
  },

  /**
   * Activate / deactivate the resident's account as a side effect of the
   * verification decision. `profiles.status` is what controls route access
   * (`pending_verification` -> resident-limited), so approval must set it to
   * `active`. Service-role only; the profile guard trigger allows this because
   * auth.uid() is null for service-role writes.
   */
  async setProfileStatus(profileId, status) {
    if (!profileId) return null;
    const supabase = getServiceClient();
    const { data, error } = await supabase
      .from(TABLES.profiles)
      .update({ status })
      .eq('id', profileId)
      .select('id, status')
      .maybeSingle();
    throwOnError(error, 'Could not update the resident account status');
    return data || null;
  },

  /**
   * Map of auth-user-id -> profiles.status for the given ids. Read-only helper
   * used to surface a resident's login-account status (Active / Pending
   * Activation / Disabled) alongside the resident record, without changing any
   * write path. Ids with no profile row are simply absent from the map.
   */
  async getProfileStatusesByIds(ids = []) {
    const unique = [...new Set((ids || []).filter(Boolean))];
    if (!unique.length) return {};
    const supabase = getServiceClient();
    const { data, error } = await supabase
      .from(TABLES.profiles)
      .select('id, status')
      .in('id', unique);
    throwOnError(error, 'Could not load account statuses');
    const map = {};
    for (const row of data || []) map[row.id] = row.status;
    return map;
  },

  // ----- account administration (Admin User Management) --------------------
  // profiles is the single source of truth for a user's application role,
  // account status and coverage assignment. Reads/writes here run on the
  // service-role client and are only reachable after authenticate +
  // authorize(admin); the profile guard trigger allows service-role writes.
  async listProfiles({
    q = '',
    role = null,
    status = null,
    municipalityId = null,
    barangayId = null,
    limit = 50,
    offset = 0,
  } = {}) {
    const supabase = getServiceClient();
    const read = (select) => {
      let query = supabase
        .from(TABLES.profiles)
        .select(select, { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);
      if (role) query = query.eq('role', role);
      if (status) query = query.eq('status', status);
      if (municipalityId) query = query.eq('municipality_id', municipalityId);
      if (barangayId) query = query.eq('barangay_id', barangayId);
      if (q) {
        const term = String(q).trim();
        query = query.or(`full_name.ilike.%${term}%,email.ilike.%${term}%`);
      }
      return query;
    };
    let { data, error, count } = await read(PROFILE_ADMIN_SELECT);
    if (error && isEmbeddedResourceUnavailable(error)) {
      ({ data, error, count } = await read(PROFILE_ADMIN_BASE_SELECT));
    }
    throwOnError(error, 'Could not list user accounts');
    return { rows: (data || []).map(profileToAdminUser), total: count ?? (data || []).length };
  },

  async getProfileById(id) {
    if (!id) return null;
    const supabase = getServiceClient();
    const read = (select) => supabase.from(TABLES.profiles).select(select).eq('id', id).maybeSingle();
    let { data, error } = await read(PROFILE_ADMIN_SELECT);
    if (error && isEmbeddedResourceUnavailable(error)) {
      ({ data, error } = await read(PROFILE_ADMIN_BASE_SELECT));
    }
    throwOnError(error, 'Could not load the user account');
    return data ? profileToAdminUser(data) : null;
  },

  async updateProfileFields(id, fields) {
    const supabase = getServiceClient();
    const { data, error } = await supabase
      .from(TABLES.profiles)
      .update(fields)
      .eq('id', id)
      .select(PROFILE_ADMIN_BASE_SELECT)
      .maybeSingle();
    throwOnError(error, 'Could not update the user account');
    return data ? profileToAdminUser(data) : null;
  },

  /** Count active (non-disabled) administrators, optionally excluding one id. */
  async countActiveAdmins({ excludeId = null } = {}) {
    const supabase = getServiceClient();
    let query = supabase
      .from(TABLES.profiles)
      .select('id', { count: 'exact', head: true })
      .eq('role', 'admin')
      .eq('status', 'active');
    if (excludeId) query = query.neq('id', excludeId);
    const { count, error } = await query;
    throwOnError(error, 'Could not count administrator accounts');
    return count ?? 0;
  },

  /**
   * Real account totals for the admin summary cards. Each count is an exact,
   * head-only query (no rows transferred) over the single source of truth,
   * `public.profiles`. Returned keys mirror the stored status enum values so the
   * API contract stays aligned with the status filter.
   */
  async getAccountSummary() {
    const supabase = getServiceClient();
    const countWhere = async (apply) => {
      let query = supabase.from(TABLES.profiles).select('id', { count: 'exact', head: true });
      query = apply ? apply(query) : query;
      const { count, error } = await query;
      throwOnError(error, 'Could not summarise accounts');
      return count ?? 0;
    };
    const [total, active, pendingVerification, disabled] = await Promise.all([
      countWhere(null),
      countWhere((query) => query.eq('status', 'active')),
      countWhere((query) => query.eq('status', 'pending_verification')),
      countWhere((query) => query.eq('status', 'disabled')),
    ]);
    return { total, active, pending_verification: pendingVerification, disabled };
  },

  async getAccountAssignmentOptions() {
    const supabase = getServiceClient();
    const [municipalitiesResult, barangaysResult, facilitiesResult] = await Promise.all([
      supabase
        .from('municipalities')
        .select('id,name,province')
        .eq('is_active', true)
        .order('name'),
      supabase
        .from('barangays')
        .select('id,name,municipality_id')
        .eq('status', 'Active')
        .order('name'),
      supabase
        .from('facilities')
        .select('id,name,municipality_id')
        .eq('type', 'rhu')
        .order('name'),
    ]);
    throwOnError(municipalitiesResult.error, 'Could not load municipalities');
    throwOnError(barangaysResult.error, 'Could not load barangays');
    throwOnError(facilitiesResult.error, 'Could not load RHU facilities');

    return {
      municipalities: (municipalitiesResult.data || []).map(({ id, name, province }) => ({
        id,
        name,
        province,
      })),
      barangays: (barangaysResult.data || []).map(({ id, name, municipality_id }) => ({
        id,
        name,
        municipalityId: municipality_id,
      })),
      facilities: (facilitiesResult.data || []).map(({ id, name, municipality_id }) => ({
        id,
        name,
        municipalityId: municipality_id,
      })),
    };
  },

  async inviteAccount({ email, fullName }) {
    const supabase = getServiceClient();
    const redirectTo = env.clientUrls[0] ? `${env.clientUrls[0]}/reset-password` : undefined;
    const { data, error } = await supabase.auth.admin.inviteUserByEmail(email, {
      data: { full_name: fullName },
      ...(redirectTo ? { redirectTo } : {}),
    });
    if (error) throw Object.assign(new Error(error.message || 'Could not invite the user'), { details: error });
    return data?.user?.id ?? null;
  },

  async provisionAccountProfile({ id, actorId, profile }) {
    const supabase = getServiceClient();
    const { data, error } = await supabase.rpc('admin_provision_profile', {
      p_target_id: id,
      p_actor_id: actorId,
      p_profile: profile,
    });
    throwOnError(error, 'Could not provision the invited account');
    return data ? profileToAdminUser(data) : null;
  },

  async removeUnprovisionedAuthUser(id) {
    const supabase = getServiceClient();
    const { error } = await supabase.auth.admin.deleteUser(id);
    throwOnError(error, 'Could not clean up the unprovisioned invitation');
  },

  /**
   * Transactional, advisory-locked re-check of every account-deletion safety
   * invariant (active-admin actor, target exists, no self-delete, not the last
   * active admin). Performs no mutation; returns the target profile snapshot the
   * caller uses for the post-deletion audit record. Raises a Postgres error
   * (mapped to an HTTP status by the service) when a guard fails.
   */
  async assertAccountDeletable({ id, actorId }) {
    const supabase = getServiceClient();
    const { data, error } = await supabase.rpc('admin_assert_account_deletable', {
      p_target_id: id,
      p_actor_id: actorId,
    });
    throwOnError(error, 'Could not verify that the account may be deleted');
    return data || null;
  },

  /**
   * Permanently delete the Supabase Auth identity. `public.profiles.id` has an
   * `on delete cascade` to `auth.users`, so this single call atomically removes
   * the profile too and drops the user's Auth sessions/identities (the account
   * can no longer sign in). Operational, clinical and audit references to the
   * account are `on delete set null`, so those historical records are preserved.
   */
  async deleteAuthAccount(id) {
    const supabase = getServiceClient();
    const { error } = await supabase.auth.admin.deleteUser(id);
    if (error) {
      throw Object.assign(new Error(error.message || 'Could not delete the account'), {
        statusCode: 502,
        details: error,
      });
    }
  },

  async updateAdminAccountProfile({ id, actorId, profile }) {
    const supabase = getServiceClient();
    const { data, error } = await supabase.rpc('admin_update_profile', {
      p_target_id: id,
      p_actor_id: actorId,
      p_profile: profile,
    });
    throwOnError(error, 'Could not update the user account');
    return data ? profileToAdminUser(data) : null;
  },

  async sendAccountRecoveryEmail({ user, actorId }) {
    const supabase = createAuthClient();
    const redirectTo = env.clientUrls[0] ? `${env.clientUrls[0]}/reset-password` : undefined;
    const admin = getServiceClient();
    const { error: auditError } = await admin.from('health_audit_logs').insert({
      actor_id: actorId,
      action: 'ACCOUNT_ACCESS_RESET_REQUESTED',
      entity_type: 'profiles',
      entity_id: user.id,
      municipality_id: user.municipalityId,
      barangay_id: user.barangayId,
      metadata: { email: user.email },
    });
    throwOnError(auditError, 'Could not record the account access reset request');

    const { error } = await supabase.auth.resetPasswordForEmail(user.email, {
      ...(redirectTo ? { redirectTo } : {}),
    });
    if (error) throw Object.assign(new Error(error.message || 'Could not send the recovery email'), { details: error });
  },

  // ----- resident verification audit log -----------------------------------
  async insertResidentVerificationLog(log) {
    const supabase = getServiceClient();
    const { data, error } = await supabase
      .from(TABLES.verificationLogs)
      .insert({
        resident_id: log.residentId,
        reviewed_by: log.reviewedBy ?? null,
        action: log.action,
        reason: log.reason ?? '',
        previous_status: log.previousStatus ?? null,
        new_status: log.newStatus,
      })
      .select('*')
      .single();
    throwOnError(error, 'Could not write the verification audit log');
    return data;
  },

  async listResidentVerificationLogs(residentId, { limit = 50 } = {}) {
    const supabase = getServiceClient();
    const { data, error } = await supabase
      .from(TABLES.verificationLogs)
      .select('*')
      .eq('resident_id', residentId)
      .order('created_at', { ascending: false })
      .limit(limit);
    throwOnError(error, 'Could not load the verification history');
    return (data || []).map(verificationLogFromRow);
  },

  /**
   * Recent verification decisions across the caller's scope, newest first, with
   * the resident's name/barangay embedded for the reviewer's history table.
   */
  async listRecentResidentVerificationLogs({ actions = null, barangay = null, municipalityId = null, limit = 100, offset = 0 } = {}) {
    const supabase = getServiceClient();
    let query = supabase
      .from(TABLES.verificationLogs)
      .select(
        '*, resident:residents!inner(id, first_name, middle_name, last_name, barangay, municipality_id, verification_status)',
        { count: 'exact' },
      )
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);
    if (actions && actions.length) query = query.in('action', actions);
    if (barangay) query = query.eq('resident.barangay', barangay);
    if (municipalityId) query = query.eq('resident.municipality_id', municipalityId);
    const { data, error, count } = await query;
    throwOnError(error, 'Could not load the verification history');
    const rows = (data || []).map((row) => ({
      ...verificationLogFromRow(row),
      residentName: [row.resident?.first_name, row.resident?.last_name].filter(Boolean).join(' ').trim(),
      residentRef: row.resident?.id || row.resident_id,
      barangay: row.resident?.barangay || '',
      residentStatus: row.resident?.verification_status || '',
    }));
    return { rows, total: count ?? rows.length };
  },

  // ----- visits / submissions ----------------------------------------------
  async insertVisit(visit) {
    const supabase = getServiceClient();
    const { data, error } = await supabase.from(TABLES.visits).insert(visitToRow(visit)).select().single();
    throwOnError(error, 'Could not create submission');
    const resident = await this.getResident(visit.residentId);
    return { ...visitFromRow(data), resident };
  },

  async getVisit(id) {
    const supabase = getServiceClient();
    const { data, error } = await supabase
      .from(TABLES.visits)
      .select(`*, resident:residents(${SELECT_RESIDENT})`)
      .eq('id', id)
      .maybeSingle();
    throwOnError(error, 'Could not fetch submission');
    if (!data) return null;
    return { ...visitFromRow(data), resident: residentFromRow(data.resident) };
  },

  async listVisits({ q = '', statuses = null, submittedById = null, residentId = null, limit = 100, offset = 0 } = {}) {
    const supabase = getServiceClient();
    let query = supabase
      .from(TABLES.visits)
      .select(`*, resident:residents(${SELECT_RESIDENT})`, { count: 'exact' })
      .order('updated_at', { ascending: false })
      .range(offset, offset + limit - 1);
    if (statuses && statuses.length) query = query.in('status', statuses);
    if (submittedById) query = query.eq('recorded_by_id', submittedById);
    if (residentId) query = query.eq('resident_id', residentId);
    if (q) {
      const term = String(q).trim();
      query = query.or(
        `resident.first_name.ilike.%${term}%,resident.last_name.ilike.%${term}%,resident.health_record_no.ilike.%${term}%,chief_complaint.ilike.%${term}%,id.ilike.%${term}%`,
      );
    }
    const { data, error, count } = await query;
    throwOnError(error, 'Could not list submissions');
    const rows = (data || []).map((row) => ({ ...visitFromRow(row), resident: residentFromRow(row.resident) }));
    return { rows, total: count ?? rows.length };
  },

  async listTclEntries({ limit = 5000, offset = 0 } = {}) {
    const supabase = getServiceClient();
    const { data, error, count } = await supabase
      .from('tcl_entries')
      .select('id, resident_id, municipality_id, barangay_id, program, status, last_visit, created_at', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);
    throwOnError(error, 'Could not list health program records');
    const rows = (data || []).map((row) => ({
      id: row.id,
      residentId: row.resident_id,
      municipalityId: row.municipality_id,
      barangayId: row.barangay_id,
      program: row.program,
      status: row.status,
      lastVisit: row.last_visit,
      createdAt: row.created_at,
    }));
    return { rows, total: count ?? rows.length };
  },

  async updateVisit(id, patch) {
    const supabase = getServiceClient();
    const row = visitToRow(patch);
    row.updated_at = new Date().toISOString();
    const { data, error } = await supabase
      .from(TABLES.visits)
      .update(row)
      .eq('id', id)
      .select(`*, resident:residents(${SELECT_RESIDENT})`)
      .maybeSingle();
    throwOnError(error, 'Could not update submission');
    if (!data) return null;
    return { ...visitFromRow(data), resident: residentFromRow(data.resident) };
  },

  // ----- referrals ----------------------------------------------------------
  async insertReferral(referral) {
    const supabase = getServiceClient();
    const { data, error } = await supabase.from(TABLES.referrals).insert(referralToRow(referral)).select().single();
    throwOnError(error, 'Could not create referral');
    const resident = await this.getResident(referral.residentId);
    return { ...referralFromRow(data), resident };
  },

  async getReferral(id) {
    const supabase = getServiceClient();
    const { data, error } = await supabase
      .from(TABLES.referrals)
      .select(`*, resident:residents(${SELECT_RESIDENT})`)
      .eq('id', id)
      .maybeSingle();
    throwOnError(error, 'Could not fetch referral');
    if (!data) return null;
    return { ...referralFromRow(data), resident: residentFromRow(data.resident) };
  },

  async getReferralByVisitId(visitId) {
    const supabase = getServiceClient();
    const { data, error } = await supabase
      .from(TABLES.referrals)
      .select(`*, resident:residents(${SELECT_RESIDENT})`)
      .eq('visit_id', visitId)
      .maybeSingle();
    throwOnError(error, 'Could not fetch referral');
    if (!data) return null;
    return { ...referralFromRow(data), resident: residentFromRow(data.resident) };
  },

  async updateReferral(id, patch) {
    const supabase = getServiceClient();
    const { data, error } = await supabase
      .from(TABLES.referrals)
      .update({ ...referralToRow(patch), updated_at: new Date().toISOString() })
      .eq('id', id)
      .select(`*, resident:residents(${SELECT_RESIDENT})`)
      .maybeSingle();
    throwOnError(error, 'Could not update referral');
    if (!data) return null;
    return { ...referralFromRow(data), resident: residentFromRow(data.resident) };
  },

  async listReferrals({ q = '', residentId = null, limit = 100, offset = 0 } = {}) {
    const supabase = getServiceClient();
    let query = supabase
      .from(TABLES.referrals)
      .select(`*, resident:residents(${SELECT_RESIDENT})`, { count: 'exact' })
      .order('updated_at', { ascending: false })
      .range(offset, offset + limit - 1);
    if (residentId) query = query.eq('resident_id', residentId);
    if (q) {
      const term = String(q).trim();
      query = query.or(`resident.first_name.ilike.%${term}%,resident.last_name.ilike.%${term}%,id.ilike.%${term}%`);
    }
    const { data, error, count } = await query;
    throwOnError(error, 'Could not list referrals');
    const rows = (data || []).map((row) => ({ ...referralFromRow(row), resident: residentFromRow(row.resident) }));
    return { rows, total: count ?? rows.length };
  },

  // ----- resident account link ---------------------------------------------
  /** The resident linked to a signed-in account (set at registration). */
  async getResidentByAuthUserId(authUserId) {
    const supabase = getServiceClient();
    const { data, error } = await supabase
      .from(TABLES.residents)
      .select('*')
      .eq('auth_user_id', authUserId)
      .maybeSingle();
    throwOnError(error, 'Could not look up the resident for this account');
    return residentFromRow(data);
  },

  async createTransferRequest({
    authUserId,
    residentId = null,
    fromBarangayId = null,
    toBarangayId = null,
    reason = '',
    status = 'draft',
    otpHash = null,
    otpExpiresAt = null,
  }) {
    const supabase = getServiceClient();
    const { data, error } = await supabase.from('transfer_requests').insert({
      auth_user_id: authUserId,
      resident_id: residentId,
      from_barangay_id: fromBarangayId,
      to_barangay_id: toBarangayId,
      reason,
      status,
      otp_hash: otpHash,
      otp_expires_at: otpExpiresAt,
    }).select(TRANSFER_SAFE_COLUMNS).single();
    throwOnError(error, 'Could not create transfer request');
    return data;
  },

  /** Every transfer request for one account, newest first (transfer history). */
  async listTransferRequestsByUser(authUserId) {
    const supabase = getServiceClient();
    const { data, error } = await supabase.from('transfer_requests').select(TRANSFER_SAFE_COLUMNS)
      .eq('auth_user_id', authUserId).order('created_at', { ascending: false });
    throwOnError(error, 'Could not load transfer history');
    return data || [];
  },

  async getTransferRequest(id, authUserId = null) {
    const supabase = getServiceClient();
    let query = supabase.from('transfer_requests').select(TRANSFER_SAFE_COLUMNS).eq('id', id);
    if (authUserId) query = query.eq('auth_user_id', authUserId);
    const { data, error } = await query.maybeSingle();
    throwOnError(error, 'Could not load transfer request');
    return data || null;
  },

  async getLatestTransferRequest(authUserId) {
    const supabase = getServiceClient();
    const { data, error } = await supabase.from('transfer_requests').select(TRANSFER_SAFE_COLUMNS)
      .eq('auth_user_id', authUserId).order('created_at', { ascending: false }).limit(1).maybeSingle();
    throwOnError(error, 'Could not load transfer request');
    return data || null;
  },

  async updateTransferRequest(id, patch) {
    const supabase = getServiceClient();
    const { data, error } = await supabase.from('transfer_requests').update(patch).eq('id', id).select(TRANSFER_SAFE_COLUMNS).single();
    throwOnError(error, 'Could not update transfer request');
    return data;
  },

  async listTransferRequests({ status = null, limit = 100, offset = 0 } = {}) {
    const supabase = getServiceClient();
    let query = supabase.from('transfer_requests').select(TRANSFER_SAFE_COLUMNS, { count: 'exact' })
      .order('created_at', { ascending: true }).range(offset, offset + limit - 1);
    if (status) query = query.eq('status', status);
    const { data, error, count } = await query;
    throwOnError(error, 'Could not list transfer requests');
    return { rows: data || [], total: count ?? (data || []).length };
  },

  async approveTransferRequest({ requestId, reviewerId }) {
    const supabase = getServiceClient();
    const { data, error } = await supabase.rpc('approve_transfer_request', {
      p_request_id: requestId, p_reviewer_id: reviewerId,
    });
    throwOnError(error, 'Could not approve transfer request');
    return data || null;
  },

  async insertTransferAuditLog({ transferRequestId, actorId, action, metadata = {} }) {
    const supabase = getServiceClient();
    const { data, error } = await supabase.from('transfer_request_audit_logs').insert({
      transfer_request_id: transferRequestId, actor_id: actorId, action, metadata,
    }).select('*').single();
    throwOnError(error, 'Could not write transfer audit log');
    return data;
  },

  async listDocumentsByTransferRequest(transferRequestId) {
    const supabase = getServiceClient();
    const { data, error } = await supabase.from(TABLES.documents).select('*')
      .eq('transfer_request_id', transferRequestId).order('created_at', { ascending: true });
    throwOnError(error, 'Could not list transfer documents');
    return (data || []).map(documentFromRow);
  },

  /** Atomically claims an unlinked record; identity matching stays server-side. */
  async claimResidentForAccount({ authUserId, identityNo, birthDate }) {
    const supabase = getServiceClient();
    const { data, error } = await supabase.rpc('claim_resident_for_account', {
      p_auth_user_id: authUserId,
      p_identity_no: String(identityNo || '').trim(),
      p_birth_date: birthDate,
    });
    throwOnError(error, 'Could not complete resident account linking');
    return residentFromRow(data);
  },

  // ----- documents ----------------------------------------------------------
  async insertDocument(document) {
    const supabase = getServiceClient();
    // `purpose` is a NOT NULL column on the original documents table (no
    // default). The registration/transfer flows track the kind of file in
    // `document_type`, so mirror it into `purpose` to satisfy the column
    // without a schema change.
    const baseRow = {
      resident_id: document.residentId || null,
      transfer_request_id: document.transferRequestId || null,
      document_type: document.documentType,
      purpose: document.purpose || document.documentType,
      government_id_type: document.governmentIdType || null,
      file_name: document.fileName,
      storage_path: document.storagePath,
      mime_type: document.mimeType,
      size_bytes: document.sizeBytes,
      status: document.status || 'uploaded',
      verification_status: document.verificationStatus || 'pending',
      uploaded_by: document.uploadedById || null,
    };

    // Automated screening columns are additive (migration
    // 20261005000000_document_automated_screening). Only include them when the
    // service supplies a result, and fall back to the base row if the column
    // set is not present yet, so the existing upload path never breaks on a
    // database where the migration has not been applied.
    const screeningRow = {};
    if (document.screeningStatus !== undefined) screeningRow.screening_status = document.screeningStatus;
    if (document.screeningReason !== undefined) screeningRow.screening_reason = document.screeningReason;
    if (document.screeningQuality !== undefined) screeningRow.screening_quality = document.screeningQuality;
    if (document.screeningOcrDetected !== undefined) screeningRow.screening_ocr_detected = document.screeningOcrDetected;
    if (document.screeningCheckedAt !== undefined) screeningRow.screening_checked_at = document.screeningCheckedAt;

    const insert = (row) => supabase.from(TABLES.documents).insert(row).select('*').single();
    let { data, error } = await insert({ ...baseRow, ...screeningRow });
    if (error && Object.keys(screeningRow).length && isMissingScreeningColumn(error)) {
      ({ data, error } = await insert(baseRow));
    }
    throwOnError(error, 'Could not create document record');
    return documentFromRow(data);
  },

  async getDocument(id) {
    const supabase = getServiceClient();
    const { data, error } = await supabase
      .from(TABLES.documents)
      .select('*')
      .eq('id', id)
      .maybeSingle();
    throwOnError(error, 'Could not fetch document');
    if (!data) return null;
    return documentFromRow(data);
  },

  async listDocumentsByResident(residentId) {
    const supabase = getServiceClient();
    const { data, error } = await supabase
      .from(TABLES.documents)
      .select('*')
      .eq('resident_id', residentId)
      .order('created_at', { ascending: false });
    throwOnError(error, 'Could not list documents');
    return (data || []).map(documentFromRow);
  },

  async updateDocument(id, patch) {
    const supabase = getServiceClient();
    const row = mapKeys(patch, DOCUMENT_TO_DB);
    const update = (values) => supabase
      .from(TABLES.documents)
      .update({ ...values, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select('*')
      .maybeSingle();
    let { data, error } = await update(row);
    if (error && isMissingScreeningColumn(error)) {
      const legacyRow = Object.fromEntries(
        Object.entries(row).filter(([column]) => !column.startsWith('screening_')),
      );
      if (Object.keys(legacyRow).length !== Object.keys(row).length) {
        ({ data, error } = await update(legacyRow));
      }
    }
    throwOnError(error, 'Could not update document');
    if (!data) return null;
    return documentFromRow(data);
  },

  async deleteDocument(id) {
    const supabase = getServiceClient();
    const { error } = await supabase
      .from(TABLES.documents)
      .delete()
      .eq('id', id);
    throwOnError(error, 'Could not delete document');
    return true;
  },

  // ----- risk configuration -------------------------------------------------
  // Authoritative resident risk CRITERIA + THRESHOLDS. Read by the config
  // service (admin editing + risk computation); written only by admins (RLS +
  // service-layer guard). Rows map to the domain criterion shape.
  async listRiskCriteria() {
    const supabase = getServiceClient();
    const { data, error } = await supabase
      .from('risk_criteria')
      .select('*')
      .order('priority', { ascending: true });
    throwOnError(error, 'Could not load risk criteria');
    return (data || []).map(riskCriterionFromRow);
  },

  async getRiskCriterion(code) {
    const supabase = getServiceClient();
    const { data, error } = await supabase.from('risk_criteria').select('*').eq('code', code).maybeSingle();
    throwOnError(error, 'Could not fetch risk criterion');
    return data ? riskCriterionFromRow(data) : null;
  },

  async upsertRiskCriterion(criterion) {
    const supabase = getServiceClient();
    const { data, error } = await supabase
      .from('risk_criteria')
      .upsert(riskCriterionToRow(criterion), { onConflict: 'code' })
      .select('*')
      .single();
    throwOnError(error, 'Could not save risk criterion');
    return riskCriterionFromRow(data);
  },

  async deleteRiskCriterion(code) {
    const supabase = getServiceClient();
    const { error } = await supabase.from('risk_criteria').delete().eq('code', code);
    throwOnError(error, 'Could not delete risk criterion');
    return true;
  },

  async getRiskSettings() {
    const supabase = getServiceClient();
    const { data, error } = await supabase
      .from('risk_settings')
      .select('*')
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    throwOnError(error, 'Could not load risk settings');
    if (!data) return null;
    return { moderateMin: data.moderate_min, highMin: data.high_min, updatedAt: data.updated_at };
  },

  async saveRiskSettings({ moderateMin, highMin }) {
    const supabase = getServiceClient();
    // Single authoritative row (id = true singleton).
    const { data, error } = await supabase
      .from('risk_settings')
      .upsert({ id: true, moderate_min: Number(moderateMin), high_min: Number(highMin), updated_at: new Date().toISOString() }, { onConflict: 'id' })
      .select('*')
      .single();
    throwOnError(error, 'Could not save risk settings');
    return { moderateMin: data.moderate_min, highMin: data.high_min, updatedAt: data.updated_at };
  },

  async insertHealthAuditLog(log) {
    const supabase = getServiceClient();
    const { data, error } = await supabase
      .from('health_audit_logs')
      .insert({
        actor_id: log.actorId || null,
        action: log.action,
        entity_type: log.entityType,
        entity_id: String(log.entityId),
        municipality_id: log.municipalityId || null,
        barangay_id: log.barangayId || null,
        metadata: log.metadata || {},
      })
      .select('*')
      .single();
    throwOnError(error, 'Could not record audit log');
    return data;
  },

  // ----- minor / guardian links ---------------------------------------------
  async insertGuardianLink(link) {
    const supabase = getServiceClient();
    const { data, error } = await supabase
      .from('resident_guardian_links')
      .insert(guardianLinkToRow(link))
      .select('*')
      .single();
    throwOnError(error, 'Could not create the guardian link');
    return guardianLinkFromRow(data);
  },

  async getGuardianLink(id) {
    const supabase = getServiceClient();
    const { data, error } = await supabase
      .from('resident_guardian_links')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    throwOnError(error, 'Could not load the guardian link');
    return guardianLinkFromRow(data);
  },

  /**
   * The minor's single ACTIVE (non-rejected) link, if any. The DB guarantees at
   * most one via the partial unique index, but the service also guards this so
   * a race between two writers still resolves to a 409 rather than a second
   * active link.
   */
  async getActiveGuardianLinkForMinor(minorResidentId) {
    const supabase = getServiceClient();
    const { data, error } = await supabase
      .from('resident_guardian_links')
      .select('*')
      .eq('minor_resident_id', minorResidentId)
      .not('verification_status', 'in', '("rejected","cancelled")')
      .limit(1)
      .maybeSingle();
    throwOnError(error, 'Could not load the guardian link');
    return guardianLinkFromRow(data);
  },

  /** All links for a minor, newest first (review/correction history). */
  async listGuardianLinksForMinor(minorResidentId, { limit = 20 } = {}) {
    const supabase = getServiceClient();
    const { data, error } = await supabase
      .from('resident_guardian_links')
      .select('*')
      .eq('minor_resident_id', minorResidentId)
      .order('created_at', { ascending: false })
      .limit(limit);
    throwOnError(error, 'Could not list guardian links');
    return (data || []).map(guardianLinkFromRow);
  },

  /** Links where a given resident is recorded as the guardian. */
  async listGuardianLinksForGuardian(guardianResidentId, { limit = 20 } = {}) {
    const supabase = getServiceClient();
    const { data, error } = await supabase
      .from('resident_guardian_links')
      .select('*')
      .eq('guardian_resident_id', guardianResidentId)
      .order('created_at', { ascending: false })
      .limit(limit);
    throwOnError(error, 'Could not list guardian links');
    return (data || []).map(guardianLinkFromRow);
  },

  async findResidentProfileByEmail(email) {
    const supabase = getServiceClient();
    const { data, error } = await supabase
      .from(TABLES.profiles)
      .select('id, email, role, full_name')
      .eq('email', String(email || '').trim().toLowerCase())
      .in('role', ['resident', 'resident-limited'])
      .limit(1)
      .maybeSingle();
    throwOnError(error, 'Could not resolve the guardian account');
    return data
      ? { id: data.id, email: data.email, role: data.role, fullName: data.full_name || '' }
      : null;
  },

  async listGuardianLinksForAccount(authUserId, { limit = 20 } = {}) {
    const supabase = getServiceClient();
    const { data, error } = await supabase
      .from('resident_guardian_links')
      .select('*')
      .eq('guardian_auth_user_id', authUserId)
      .order('created_at', { ascending: false })
      .limit(limit);
    throwOnError(error, 'Could not list guardian link requests');
    return (data || []).map(guardianLinkFromRow);
  },

  async updateGuardianLink(id, patch) {
    const supabase = getServiceClient();
    const { data, error } = await supabase
      .from('resident_guardian_links')
      .update({ ...guardianLinkToRow(patch), updated_at: new Date().toISOString() })
      .eq('id', id)
      .select('*')
      .maybeSingle();
    throwOnError(error, 'Could not update the guardian link');
    return guardianLinkFromRow(data);
  },

  async deleteGuardianLink(id) {
    const supabase = getServiceClient();
    const { error } = await supabase.from('resident_guardian_links').delete().eq('id', id);
    throwOnError(error, 'Could not delete the guardian link');
    return true;
  },
};

export default supabaseRepository;
