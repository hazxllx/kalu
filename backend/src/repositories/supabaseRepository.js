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
  counters: 'record_counters',
});

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
};

const DB_TO_RESIDENT = Object.fromEntries(Object.entries(RESIDENT_TO_DB).map(([k, v]) => [v, k]));

const VITAL_DB_KEYS = ['bp', 'hr', 'rr', 'o2sat', 'temperature', 'height_cm', 'weight_kg', 'bmi', 'bmi_category'];

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

const vitalsFromRow = (row) => {
  const vitals = {};
  for (const key of VITAL_DB_KEYS) {
    const value = row[key];
    if (value !== undefined && value !== null) vitals[key] = value;
  }
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
  const { data, error } = await supabase.rpc('increment_counter', { counter_name: name });
  throwOnError(error, `Could not allocate ${name} identifier`);
  return data;
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

  async findResidentByIdentity({ lastName, firstName, middleName, birthDate } = {}) {
    const supabase = getServiceClient();
    let query = supabase
      .from(TABLES.residents)
      .select('*')
      .ilike('last_name', String(lastName || '').trim())
      .ilike('first_name', String(firstName || '').trim());
    if (middleName) query = query.ilike('middle_name', String(middleName).trim());
    if (birthDate) query = query.eq('birth_date', birthDate);
    const { data, error } = await query.limit(5);
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
};

export default supabaseRepository;
