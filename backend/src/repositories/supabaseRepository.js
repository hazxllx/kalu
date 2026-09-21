/**
 * Supabase (PostgreSQL) repository driver.
 *
 * Implements the same repository contract as the file driver. The API uses the
 * service-role client after `authenticate` + `authorize` have run, so
 * application-level RBAC is enforced in the service layer; the SQL migration
 * additionally enables RLS policies for defense in depth (see
 * database/migrations).
 *
 * Human-readable identifiers (RES-/SUB-/REF-) are minted from the
 * `record_counters` table so records look identical across drivers.
 */
import { getServiceClient } from '../config/supabase.js';

const TABLES = Object.freeze({
  residents: 'residents',
  visits: 'visits',
  referrals: 'referrals',
  households: 'households',
  householdMembers: 'household_members',
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
  return (data || []).map(memberFromRow);
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
  barangay: 'barangay',
  barangayId: 'barangay_id',
  municipalityId: 'municipality_id',
  verificationStatus: 'verification_status',
  verifiedBy: 'verified_by',
  verifiedAt: 'verified_at',
  rejectionReason: 'rejection_reason',
  submittedForVerificationAt: 'submitted_for_verification_at',
  authUserId: 'auth_user_id',
  createdAt: 'created_at',
  createdById: 'created_by_id',
  createdByRole: 'created_by_role',
};

const DB_TO_RESIDENT = Object.fromEntries(Object.entries(RESIDENT_TO_DB).map(([k, v]) => [v, k]));

const VISIT_TO_DB = {
  id: 'id',
  residentId: 'resident_id',
  recordedById: 'recorded_by_id',
  recordedByRole: 'recorded_by_role',
  recordedByName: 'recorded_by_name',
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
  }
  return row;
};

const visitFromRow = (row) => {
  if (!row) return null;
  const out = mapBack(row, DB_TO_VISIT);
  const vitals = vitalsFromRow(row);
  if (Object.keys(vitals).length) out.vitals = vitals;
  if (row.phn_assessment !== null || row.phn_notes !== null) {
    out.phn = {};
    if (row.phn_assessment !== null && row.phn_assessment !== undefined) out.phn.assessment = row.phn_assessment;
    if (row.phn_notes !== null && row.phn_notes !== undefined) out.phn.notes = row.phn_notes;
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

const SELECT_RESIDENT = Object.keys(DB_TO_RESIDENT).join(',');

const throwOnError = (error, fallback) => {
  if (error) {
    const err = new Error(error.message || fallback);
    err.details = error;
    throw err;
  }
};

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
  async searchResidents({ q = '', limit = 20 } = {}) {
    const supabase = getServiceClient();
    let query = supabase.from(TABLES.residents).select('*').order('created_at', { ascending: false }).limit(limit);
    if (q) {
      const term = String(q).trim();
      query = query.or(
        `first_name.ilike.%${term}%,last_name.ilike.%${term}%,middle_name.ilike.%${term}%,health_record_no.ilike.%${term}%,philhealth_no.ilike.%${term}%,cellphone_no.ilike.%${term}%,barangay.ilike.%${term}%`,
      );
    }
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
  async listResidents({ q = '', limit = 50, offset = 0, barangay = null, municipalityId = null } = {}) {
    const supabase = getServiceClient();
    let query = supabase
      .from(TABLES.residents)
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);
    if (q) {
      const term = String(q).trim();
      query = query.or(
        `first_name.ilike.%${term}%,last_name.ilike.%${term}%,middle_name.ilike.%${term}%,health_record_no.ilike.%${term}%,philhealth_no.ilike.%${term}%,cellphone_no.ilike.%${term}%`,
      );
    }
    if (barangay) query = query.eq('barangay', barangay);
    if (municipalityId) query = query.eq('municipality_id', municipalityId);
    const { data, error, count } = await query;
    throwOnError(error, 'Could not list residents');
    return { rows: (data || []).map(residentFromRow), total: count ?? (data || []).length };
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

  async insertHousehold(household) {
    const supabase = getServiceClient();
    const { data, error } = await supabase
      .from(TABLES.households)
      .insert(householdToRow(household))
      .select('*')
      .single();
    throwOnError(error, 'Could not save household');
    return householdFromRow(data);
  },

  async updateHousehold(id, patch) {
    const supabase = getServiceClient();
    const { data, error } = await supabase
      .from(TABLES.households)
      .update(householdToRow(patch))
      .eq('id', id)
      .select('*')
      .single();
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

  async createTransferRequest({ authUserId, otpHash, otpExpiresAt }) {
    const supabase = getServiceClient();
    const { data, error } = await supabase.from('transfer_requests').insert({
      auth_user_id: authUserId,
      status: 'pending',
      otp_hash: otpHash,
      otp_expires_at: otpExpiresAt,
    }).select('*').single();
    throwOnError(error, 'Could not create transfer request');
    return data;
  },

  async getTransferRequest(id, authUserId = null) {
    const supabase = getServiceClient();
    let query = supabase.from('transfer_requests').select('*').eq('id', id);
    if (authUserId) query = query.eq('auth_user_id', authUserId);
    const { data, error } = await query.maybeSingle();
    throwOnError(error, 'Could not load transfer request');
    return data || null;
  },

  async getLatestTransferRequest(authUserId) {
    const supabase = getServiceClient();
    const { data, error } = await supabase.from('transfer_requests').select('*')
      .eq('auth_user_id', authUserId).order('created_at', { ascending: false }).limit(1).maybeSingle();
    throwOnError(error, 'Could not load transfer request');
    return data || null;
  },

  async updateTransferRequest(id, patch) {
    const supabase = getServiceClient();
    const { data, error } = await supabase.from('transfer_requests').update(patch).eq('id', id).select('*').single();
    throwOnError(error, 'Could not update transfer request');
    return data;
  },

  async listTransferRequests({ status = null, limit = 100, offset = 0 } = {}) {
    const supabase = getServiceClient();
    let query = supabase.from('transfer_requests').select('*', { count: 'exact' })
      .order('created_at', { ascending: true }).range(offset, offset + limit - 1);
    if (status) query = query.eq('status', status);
    const { data, error, count } = await query;
    throwOnError(error, 'Could not list transfer requests');
    return { rows: data || [], total: count ?? (data || []).length };
  },

  async approveTransferRequest({ requestId, reviewerId, residentId }) {
    const supabase = getServiceClient();
    const { data, error } = await supabase.rpc('approve_transfer_request', {
      p_request_id: requestId, p_reviewer_id: reviewerId, p_resident_id: residentId,
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
    const { data, error } = await supabase
      .from(TABLES.documents)
      .insert({
        resident_id: document.residentId || null,
        transfer_request_id: document.transferRequestId || null,
        document_type: document.documentType,
        // `purpose` is a NOT NULL column on the original documents table (no
        // default). The registration/transfer flows track the kind of file in
        // `document_type`, so mirror it into `purpose` to satisfy the column
        // without a schema change.
        purpose: document.purpose || document.documentType,
        government_id_type: document.governmentIdType || null,
        file_name: document.fileName,
        storage_path: document.storagePath,
        mime_type: document.mimeType,
        size_bytes: document.sizeBytes,
        status: document.status || 'uploaded',
        verification_status: document.verificationStatus || 'pending',
        uploaded_by: document.uploadedById || null,
      })
      .select('*')
      .single();
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
    const { data, error } = await supabase
      .from(TABLES.documents)
      .update({
        ...patch,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select('*')
      .maybeSingle();
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

};

export default supabaseRepository;
