/**
 * Medical certificate service.
 *
 * Backs public.medical_certificates (see
 * supabase/migrations/20260928150100_medical_certificates.sql) and replaces the
 * browser-session-only certificate store, which seeded to an empty array and
 * therefore showed an empty register to every role on every page load.
 *
 * Workflow (unchanged from the original design, now actually persisted):
 *
 *   Draft ──> For Review ──> Approved ──> Issued
 *                 └──────> Rejected          (terminal)
 *   any non-Issued ──> Cancelled           (terminal)
 *
 *   - PHN / MHO prepare a certificate and submit it for review.
 *   - Only the PHN or the MHO may approve / issue / reject; the role is checked
 *     here, in the route's `authorize(FEATURE_ROLES.certificateReview)`, and in
 *     public.can_review_medical_certificates().
 *
 * SECURITY MODEL (defense in depth, mirroring referrals.service.js):
 *   - every read is filtered to the caller's barangay/municipality scope HERE,
 *   - the resident and its scope are resolved from the database, never from the
 *     request body,
 *   - every transition is written to medical_certificate_logs AND
 *     health_audit_logs, so the certificate register and the system Audit Trail
 *     agree.
 *
 * `supabase` is injectable so the unit tests can drive it without a live
 * database.
 */
import { getServiceClient } from '../config/supabase.js';
import { ROLES } from '../config/roles.js';
import ApiError from '../utils/apiError.js';
import { notifyResident } from './notifications.service.js';

const TABLE = 'medical_certificates';
const LOG_TABLE = 'medical_certificate_logs';

export const CERT_STATUS = Object.freeze({
  DRAFT: 'Draft',
  FOR_REVIEW: 'For Review',
  APPROVED: 'Approved',
  ISSUED: 'Issued',
  REJECTED: 'Rejected',
  CANCELLED: 'Cancelled',
});

export const CERT_STATUSES = Object.freeze(Object.values(CERT_STATUS));

/** Legal transitions. Mirrors the UI's ALLOWED_TRANSITIONS map. */
export const ALLOWED_TRANSITIONS = Object.freeze({
  [CERT_STATUS.DRAFT]: [CERT_STATUS.FOR_REVIEW, CERT_STATUS.CANCELLED],
  [CERT_STATUS.FOR_REVIEW]: [CERT_STATUS.APPROVED, CERT_STATUS.REJECTED, CERT_STATUS.CANCELLED],
  [CERT_STATUS.APPROVED]: [CERT_STATUS.ISSUED, CERT_STATUS.CANCELLED],
  [CERT_STATUS.ISSUED]: [],
  [CERT_STATUS.REJECTED]: [],
  [CERT_STATUS.CANCELLED]: [],
});

export const CERT_PURPOSES = Object.freeze([
  'General Medical Certificate',
  'Fitness to Work / School',
  'Sick Leave Certification',
  'Post-Consultation Clearance',
  'Travel / Camping Clearance',
]);

const PREPARE_ROLES = new Set([ROLES.PHN, ROLES.MHO]);
const REVIEW_ROLES = new Set([ROLES.PHN, ROLES.MHO]);
// Triage-station RHU Personnel may INITIATE a request (status 'For Review');
// they can never prepare a full certificate, update, or decide.
const REQUEST_ROLES = new Set([ROLES.RHU_PERSONNEL]);
// Municipality-scoped readers of the register. RHU Personnel read their own
// municipality (matches the medical_certificates RLS); they still cannot write
// or decide — that is gated separately.
const MUNICIPALITY_ROLES = new Set([ROLES.MHO, ROLES.PHN, ROLES.RHU_PERSONNEL]);
const BARANGAY_ROLES = new Set([ROLES.HEALTH_SUPERVISOR]);
const RESIDENT_ROLES = new Set([ROLES.RESIDENT, ROLES.RESIDENT_LIMITED]);

const RESIDENT_EMBED =
  'resident:residents(id, first_name, middle_name, last_name, barangay, sex, birth_date, cellphone_no, current_address, permanent_address, civil_status, auth_user_id, municipality_id)';
const LOG_SELECT = 'id, action, previous_status, new_status, notes, created_at, actor_id, actor:profiles!actor_id(full_name, email, role)';
const SELECT = `*, ${RESIDENT_EMBED}`;

const text = (v) => String(v ?? '').trim();
const todayIso = () => new Date().toISOString().slice(0, 10);

const throwOnError = (error, fallback) => {
  if (error) throw Object.assign(new Error(error.message || fallback), { statusCode: 500, details: error });
};

const ageFrom = (birthDate) => {
  if (!birthDate) return '';
  const dob = new Date(birthDate);
  if (Number.isNaN(dob.getTime())) return '';
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const m = now.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) age -= 1;
  return age >= 0 ? age : '';
};

const fullName = (r) =>
  [r?.first_name, r?.middle_name, r?.last_name].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();

/** Domain row -> the certificate shape the register + document form consume. */
const toCertificate = (row, audit = []) => {
  if (!row) return null;
  const resident = row.resident || null;
  return {
    id: row.id,
    reference: row.reference_no,
    certificateNumber: row.certificate_number || row.reference_no,
    patientId: row.resident_id,
    patient: fullName(resident) || 'Unlinked resident',
    age: resident ? String(ageFrom(resident.birth_date)) : '',
    sex: resident?.sex || '',
    civilStatus: row.civil_status || resident?.civil_status || '',
    barangay: resident?.barangay || '',
    address: resident?.current_address || resident?.permanent_address || '',
    purpose: row.purpose || '',
    findings: row.findings || '',
    dateOfExamination: row.date_of_examination || '',
    medicalOfficer: row.medical_officer || '',
    licenseNumber: row.license_number || '',
    recommendation: row.recommendation || '',
    remarks: row.remarks || '',
    notes: row.notes || '',
    status: row.status,
    dateIssued: row.date_issued || '',
    issuedAt: row.date_issued ? new Date(row.date_issued).toISOString() : '',
    preparedBy: row.created_by,
    preparedByRole: row.created_by_role || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    audit,
  };
};

const toLogEntry = (log) => ({
  action: log.action,
  by: log.actor?.full_name || log.actor?.email || '',
  byRole: log.actor?.role || '',
  at: log.created_at,
  notes: log.notes || '',
});

/** Resident-facing notification copy — no clinical detail leaks into the feed. */
const notificationFor = (status) => {
  switch (status) {
    case CERT_STATUS.FOR_REVIEW:
      return { category: 'information', title: 'Medical certificate submitted', message: 'A medical certificate has been submitted for review.' };
    case CERT_STATUS.APPROVED:
      return { category: 'information', title: 'Medical certificate approved', message: 'Your medical certificate has been approved.' };
    case CERT_STATUS.ISSUED:
      return { category: 'information', title: 'Medical certificate issued', message: 'Your medical certificate is ready.' };
    case CERT_STATUS.REJECTED:
      return { category: 'alert', title: 'Medical certificate rejected', message: 'Your medical certificate request was rejected.' };
    case CERT_STATUS.CANCELLED:
      return { category: 'information', title: 'Medical certificate cancelled', message: 'A medical certificate request was cancelled.' };
    default:
      return null;
  }
};

const writeLog = async (supabase, user, certificateId, action, previousStatus, newStatus, notes = '') => {
  const { error } = await supabase.from(LOG_TABLE).insert({
    certificate_id: certificateId,
    actor_id: user?.id || null,
    action,
    previous_status: previousStatus || null,
    new_status: newStatus || null,
    notes,
  });
  throwOnError(error, 'Could not write certificate history');
};

/**
 * Resolve the AUTHORIZED signatory from the database — never from the client.
 *
 * The MHO is the required approval/signatory role for medical documents, so the
 * approving MHO's own profile (full_name / position / license_no) is the
 * authoritative signatory identity. Falls back to the session user's identity
 * only when the profile row cannot be read, and never to a request body value.
 */
const resolveSignatory = async (supabase, user) => {
  if (user?.id) {
    const { data, error } = await supabase
      .from('profiles')
      .select('full_name, position, license_no')
      .eq('id', user.id)
      .maybeSingle();
    if (!error && data) {
      return {
        fullName: data.full_name || '',
        position: data.position || 'Municipal Health Officer',
        licenseNumber: data.license_no || '',
      };
    }
  }
  return {
    fullName: user?.name || '',
    position: 'Municipal Health Officer',
    licenseNumber: '',
  };
};

const writeAudit = async (supabase, user, action, certificateId, row, metadata = {}) => {
  const { error } = await supabase.from('health_audit_logs').insert({
    actor_id: user.id,
    action,
    entity_type: TABLE,
    entity_id: certificateId,
    municipality_id: row.municipality_id || null,
    barangay_id: row.barangay_id || null,
    metadata,
  });
  throwOnError(error, 'Could not write audit log');
};

const loadAudit = async (supabase, certificateId) => {
  const { data, error } = await supabase
    .from(LOG_TABLE)
    .select(LOG_SELECT)
    .eq('certificate_id', certificateId)
    .order('created_at', { ascending: true });
  if (error) return [];
  return (data || []).map(toLogEntry);
};

/** The resident a certificate is filed against, with its scope. */
const residentInScope = async (supabase, user, residentId) => {
  const id = text(residentId);
  if (!id) throw ApiError.badRequest('A resident is required for a medical certificate.');
  const { data, error } = await supabase
    .from('residents')
    .select('id, first_name, middle_name, last_name, barangay, barangay_id, municipality_id, auth_user_id, sex, birth_date, civil_status, current_address, permanent_address, cellphone_no')
    .eq('id', id)
    .maybeSingle();
  throwOnError(error, 'Could not load resident');
  if (!data) throw ApiError.notFound('Resident record not found.');

  if (user.role === ROLES.PHN || user.role === ROLES.MHO || user.role === ROLES.RHU_PERSONNEL) {
    if (user.municipalityId && data.municipality_id && data.municipality_id !== user.municipalityId) {
      throw ApiError.notFound('Resident record not found.');
    }
  } else if (user.role === ROLES.HEALTH_SUPERVISOR) {
    if (!user.barangayId || data.barangay_id !== user.barangayId) {
      throw ApiError.notFound('Resident record not found.');
    }
  } else {
    throw ApiError.forbidden('You are not authorized to file medical certificates.');
  }
  return data;
};

const applyScope = (query, user) => {
  if (RESIDENT_ROLES.has(user?.role)) return query.eq('resident_id', '__own__');
  if (BARANGAY_ROLES.has(user?.role)) {
    if (!user.barangayId) return query.eq('barangay_id', '__none__');
    return query.eq('barangay_id', user.barangayId);
  }
  if (MUNICIPALITY_ROLES.has(user?.role)) {
    if (!user.municipalityId) return query.eq('municipality_id', '__none__');
    return query.eq('municipality_id', user.municipalityId);
  }
  return query.eq('municipality_id', '__none__');
};

const ownResidentId = async (supabase, user) => {
  const { data, error } = await supabase.from('residents').select('id').eq('auth_user_id', user.id).maybeSingle();
  throwOnError(error, 'Could not load resident record');
  return data?.id || null;
};

/**
 * Next MC-YYYY-#### reference for the current year. Derived from the stored
 * references so the number is always allocated from real data.
 */
export const nextReference = async ({ supabase = getServiceClient() } = {}) => {
  const year = new Date().getFullYear();
  const { data, error } = await supabase.from(TABLE).select('reference_no').like('reference_no', `MC-${year}-%`);
  if (error) throw Object.assign(new Error(error.message), { statusCode: 500 });
  const max = (data || []).reduce((acc, r) => {
    const m = String(r.reference_no || '').match(/^MC-\d{4}-(\d+)$/);
    return m ? Math.max(acc, Number(m[1])) : acc;
  }, 0);
  return `MC-${year}-${String(max + 1).padStart(4, '0')}`;
};

/** Certificates visible to the caller, newest first. */
export const list = async ({ user, status = null, residentId = null, supabase = getServiceClient() }) => {
  let query = supabase.from(TABLE).select(SELECT).order('created_at', { ascending: false }).limit(200);

  if (RESIDENT_ROLES.has(user?.role)) {
    const mine = await ownResidentId(supabase, user);
    if (!mine) return [];
    query = query.eq('resident_id', mine);
  } else {
    query = applyScope(query, user);
  }

  if (status) query = query.eq('status', status);
  if (residentId) query = query.eq('resident_id', residentId);

  const { data, error } = await query;
  throwOnError(error, 'Could not load medical certificates');
  return (data || []).map((row) => toCertificate(row));
};

/** One certificate plus its full decision history. */
export const getById = async ({ user, id, supabase = getServiceClient() }) => {
  const { data, error } = await supabase.from(TABLE).select(SELECT).eq('id', id).maybeSingle();
  throwOnError(error, 'Could not load medical certificate');
  if (!data) throw ApiError.notFound('Medical certificate not found.');

  if (RESIDENT_ROLES.has(user?.role)) {
    const mine = await ownResidentId(supabase, user);
    if (!mine || data.resident_id !== mine) throw ApiError.notFound('Medical certificate not found.');
  } else if (BARANGAY_ROLES.has(user?.role)) {
    if (!user.barangayId || data.barangay_id !== user.barangayId) throw ApiError.notFound('Medical certificate not found.');
  } else if (MUNICIPALITY_ROLES.has(user?.role)) {
    if (!user.municipalityId || data.municipality_id !== user.municipalityId) {
      throw ApiError.notFound('Medical certificate not found.');
    }
  } else {
    throw ApiError.forbidden('You are not authorized to view medical certificates.');
  }

  return toCertificate(data, await loadAudit(supabase, data.id));
};

/** MC-YYYY-#### is unique; a lost race retries a few times before failing. */
const insertWithReference = async (supabase, row) => {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const reference = await nextReference({ supabase });
    const { data, error } = await supabase
      .from(TABLE)
      .insert({ ...row, reference_no: reference, certificate_number: reference })
      .select(SELECT)
      .single();
    if (!error) return data;
    if (/duplicate key|unique/i.test(error.message || '') && attempt < 4) continue;
    throwOnError(error, 'Could not create medical certificate');
  }
  throw ApiError(503, 'Could not allocate a certificate number. Please try again.');
};

const sanitizeWrite = (payload = {}) => {
  const row = {};
  if (payload.purpose !== undefined) {
    if (payload.purpose && !CERT_PURPOSES.includes(payload.purpose)) {
      throw ApiError.unprocessable('Invalid certificate purpose.');
    }
    row.purpose = text(payload.purpose) || CERT_PURPOSES[0];
  }
  if (payload.findings !== undefined) row.findings = text(payload.findings);
  if (payload.dateOfExamination !== undefined) {
    const value = text(payload.dateOfExamination);
    if (value && !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw ApiError.unprocessable('Invalid date of examination.');
    row.date_of_examination = value || todayIso();
  }
  // SECURITY: the authorized signatory is NEVER client-supplied. Any
  // medicalOfficer / licenseNumber sent by the client is ignored — the values
  // are resolved server-side from the profile of the preparer and re-stamped
  // from the approving MHO's profile at approval/issue time.
  if (payload.civilStatus !== undefined) row.civil_status = text(payload.civilStatus);
  if (payload.recommendation !== undefined) row.recommendation = text(payload.recommendation);
  if (payload.remarks !== undefined) row.remarks = text(payload.remarks);
  if (payload.notes !== undefined) row.notes = text(payload.notes);
  return row;
};

export const create = async ({ user, payload = {}, supabase = getServiceClient() }) => {
  const isTriageRequest = REQUEST_ROLES.has(user?.role);
  if (!PREPARE_ROLES.has(user?.role) && !isTriageRequest) {
    throw ApiError.forbidden('You are not authorized to prepare medical certificates.');
  }
  const resident = await residentInScope(supabase, user, payload.residentId ?? payload.resident_id);

  const row = sanitizeWrite(payload);

  if (isTriageRequest) {
    // Triage INITIATES a request only. It can never be a decision: the status is
    // forced to 'For Review', and NO signatory is stamped — the authorized
    // signatory (MHO) is resolved at approval/issue time. Clinical findings are
    // optional at request time (the PHN/MHO complete them on review). This is the
    // service-role enforcement; the DB trigger enforce_triage_certificate_request
    // is the backstop for any direct user-token write.
    row.status = CERT_STATUS.FOR_REVIEW;
  } else {
    if (!row.findings) throw ApiError.unprocessable('Clinical findings are required.');
    // The authorized signatory is resolved server-side from the preparer's
    // profile (the MHO signatory is re-stamped at approval/issue time).
    const signatory = await resolveSignatory(supabase, user);
    row.medical_officer = signatory.fullName || user?.name || '';
    row.license_number = signatory.licenseNumber || '';
    if (!row.medical_officer) throw ApiError.unprocessable('The medical officer name is required.');
    row.status = CERT_STATUS.DRAFT;
  }
  row.resident_id = resident.id;
  row.created_by = user.id;
  row.civil_status = row.civil_status || resident.civil_status || '';
  // municipality_id / barangay_id are set by the DB trigger from the resident.

  const created = await insertWithReference(supabase, row);
  await writeLog(
    supabase,
    user,
    created.id,
    row.status,
    null,
    row.status,
    isTriageRequest ? 'Certificate request submitted for review' : 'Certificate created',
  );
  await writeAudit(supabase, user, 'MEDICAL_CERTIFICATE_CREATED', created.id, created, {
    reference: created.reference_no,
    request: isTriageRequest || undefined,
  });
  return toCertificate(created, await loadAudit(supabase, created.id));
};

const writableCertificate = async (supabase, user, id) => {
  const { data, error } = await supabase.from(TABLE).select(SELECT).eq('id', id).maybeSingle();
  throwOnError(error, 'Could not load medical certificate');
  if (!data) throw ApiError.notFound('Medical certificate not found.');

  if (user.role === ROLES.HEALTH_SUPERVISOR) {
    if (!user.barangayId || data.barangay_id !== user.barangayId) throw ApiError.notFound('Medical certificate not found.');
  } else if (user.role === ROLES.PHN || user.role === ROLES.MHO) {
    if (!user.municipalityId || data.municipality_id !== user.municipalityId) {
      throw ApiError.notFound('Medical certificate not found.');
    }
  } else {
    throw ApiError.forbidden('You are not authorized to modify medical certificates.');
  }
  return data;
};

/** Edit the document fields of a certificate that is not yet issued. */
export const update = async ({ user, id, payload = {}, supabase = getServiceClient() }) => {
  const existing = await writableCertificate(supabase, user, id);
  if (![CERT_STATUS.DRAFT, CERT_STATUS.FOR_REVIEW].includes(existing.status)) {
    throw ApiError.conflict('Only draft or pending-review certificates can be edited.');
  }
  const row = sanitizeWrite(payload);
  if (Object.prototype.hasOwnProperty.call(payload, 'findings') && !row.findings) {
    throw ApiError.unprocessable('Clinical findings are required.');
  }
  if (Object.keys(row).length === 0) {
    return toCertificate(existing, await loadAudit(supabase, existing.id));
  }

  const { data, error } = await supabase.from(TABLE).update(row).eq('id', id).select(SELECT).single();
  throwOnError(error, 'Could not update medical certificate');
  await writeLog(supabase, user, id, 'Updated', existing.status, existing.status, 'Certificate details updated');
  await writeAudit(supabase, user, 'MEDICAL_CERTIFICATE_UPDATED', id, data, { reference: data.reference_no });
  return toCertificate(data, await loadAudit(supabase, data.id));
};

/**
 * Move a certificate through the review workflow.
 *
 * Only the PHN and the MHO may make a decision; the preparer may submit a draft
 * for review or cancel their own. Illegal transitions are refused rather than
 * silently applied, and every move is recorded.
 */
export const changeStatus = async ({ user, id, status, notes = '', supabase = getServiceClient() }) => {
  const target = text(status);
  if (!CERT_STATUSES.includes(target)) throw ApiError.unprocessable('Invalid certificate status.');

  const existing = await writableCertificate(supabase, user, id);
  const current = existing.status;

  if (current === target) return toCertificate(existing, await loadAudit(supabase, existing.id));

  const isDecision = [CERT_STATUS.APPROVED, CERT_STATUS.ISSUED, CERT_STATUS.REJECTED].includes(target);
  if (isDecision && !REVIEW_ROLES.has(user?.role)) {
    throw ApiError.forbidden('Only the PHN or the MHO may approve, issue or reject a medical certificate.');
  }
  // BUSINESS RULE: the MHO is the authorized signatory/approver. Approval is the
  // required MHO step, so only the MHO may move a certificate to Approved — a
  // PHN preparing/reviewing a certificate can submit it for review or reject it,
  // but can never mark it MHO-approved. Issuance is only reachable FROM Approved
  // (see ALLOWED_TRANSITIONS), so a certificate can never be issued without a
  // real MHO approval on record. No electronic/digital signature is involved;
  // the approval is recorded as the approving MHO's id + timestamp below.
  if (target === CERT_STATUS.APPROVED && user?.role !== ROLES.MHO) {
    throw ApiError.forbidden('Only the Municipal Health Officer may approve a medical certificate.');
  }
  if (!isDecision && !PREPARE_ROLES.has(user?.role)) {
    throw ApiError.forbidden('You are not authorized to change a medical certificate status.');
  }

  const allowed = ALLOWED_TRANSITIONS[current] || [];
  if (!allowed.includes(target)) {
    throw ApiError.conflict(`A ${current} certificate cannot be moved to ${target}.`);
  }
  if (target === CERT_STATUS.REJECTED && !text(notes)) {
    throw ApiError.unprocessable('A reason is required to reject a medical certificate.');
  }

  const row = { status: target };
  if (target === CERT_STATUS.ISSUED) row.date_issued = todayIso();
  if (isDecision) {
    row.reviewed_by = user.id;
    row.reviewed_at = new Date().toISOString();
    row.review_remarks = text(notes);
  }

  // The authorized signatory is resolved server-side (the approving MHO's own
  // profile) and stamped onto the certificate. A client can never type an
  // arbitrary doctor/license into the document — the stored values are the
  // authoritative ones, and they are preserved unchanged once the certificate
  // is approved/issued.
  if (target === CERT_STATUS.APPROVED || target === CERT_STATUS.ISSUED) {
    const signatory = await resolveSignatory(supabase, user);
    const signatoryName = (signatory.fullName || '').trim();
    const license = (signatory.licenseNumber || '').trim();
    if (signatoryName) row.medical_officer = signatoryName;
    if (signatoryName || license) row.license_number = license;
  }

  const { data, error } = await supabase.from(TABLE).update(row).eq('id', id).select(SELECT).single();
  throwOnError(error, 'Could not update medical certificate status');

  await writeLog(supabase, user, id, target, current, target, text(notes));
  await writeAudit(supabase, user, 'MEDICAL_CERTIFICATE_STATUS_CHANGED', id, data, {
    reference: data.reference_no,
    from: current,
    to: target,
  });

  const payload = notificationFor(target);
  if (payload) {
    await notifyResident({
      recipientAuthUserId: existing.resident?.auth_user_id,
      ...payload,
      relatedType: TABLE,
      relatedId: data.id,
    });
  }

  return toCertificate(data, await loadAudit(supabase, data.id));
};

/** Convenience wrappers matching the register's decision buttons. */
export const submitForReview = (args) => changeStatus({ ...args, status: CERT_STATUS.FOR_REVIEW });
export const approve = (args) => changeStatus({ ...args, status: CERT_STATUS.APPROVED });
export const issue = (args) => changeStatus({ ...args, status: CERT_STATUS.ISSUED });
export const reject = (args) => changeStatus({ ...args, status: CERT_STATUS.REJECTED });
export const cancel = (args) => changeStatus({ ...args, status: CERT_STATUS.CANCELLED });

export const canDecide = (user) => REVIEW_ROLES.has(user?.role);

export default {
  CERT_STATUS,
  CERT_STATUSES,
  CERT_PURPOSES,
  ALLOWED_TRANSITIONS,
  nextReference,
  list,
  getById,
  create,
  update,
  changeStatus,
  submitForReview,
  approve,
  issue,
  reject,
  cancel,
  canDecide,
};
