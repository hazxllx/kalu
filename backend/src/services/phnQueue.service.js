/**
 * PHN workflow service — the receiving side of the intake hand-off.
 *
 * The Public Health Nurse owns the submission once it leaves DRAFT:
 *   - queue listing (no drafts),
 *   - opening + reviewing a submission,
 *   - adding PHN-specific clinical information,
 *   - status transitions: received -> in_review -> referred/completed,
 *   - generating an RHU referral that snapshots the patient + visit so a
 *     finalized referral never changes when the resident profile is edited.
 *
 * Enforcement notes (server side):
 *   - only PHN/RHU consultation staff may mutate queue items inside their scope,
 *   - clinical content is editable only while status is in the PHN set,
 *   - a visit can generate at most one referral,
 *   - referral snapshots are frozen at generation time and re-synced
 *     explicitly, never implicitly on unrelated edits.
 */
import ApiError from '../utils/apiError.js';
import repository from '../repositories/index.js';
import { computeBMI } from '../utils/bmi.js';
import { FACILITY, SUBMISSION_STATUS, PHN_EDITABLE_STATUSES } from '../config/facility.js';
import { withinFacilityScope } from '../config/scope.js';
import { canConsult } from '../config/rhuStations.js';
import { validateVitals } from './intake.service.js';
import { normalizeMedications } from './medicines.service.js';
import { markCompletedFromVisit } from './referrals.service.js';
import * as canonicalReferrals from './referrals.service.js';
import { getServiceClient } from '../config/supabase.js';
import { getRiskConfig } from './riskConfig.service.js';
import { assessVitals, hasAssessableVitals } from '../utils/residentRisk.js';

const isPHN = (user) => user?.role === 'phn';

// RHU Consultation Station reuses the SAME visit queue the PHN uses: the PHN,
// an RHU Personnel assigned to the Consultation station, and a Health Supervisor
// assigned to the Consultation station may all receive/review/update/complete a
// submitted encounter (record findings/assessment/treatment). This does NOT
// change the PHN assessment feature, and it does NOT grant consultation from a
// role alone — `canConsult` requires the PHN role OR the Consultation station.
// Referral generation remains PHN-only (see createReferral/updateReferral).
const canProcessConsultation = (user) => canConsult(user);

const assertCanProcessConsultation = (user) => {
  if (!canProcessConsultation(user)) throw ApiError.forbidden();
  if (user.role === 'rhu_personnel' && !user.facilityId) {
    throw ApiError.unprocessable('Your account must be assigned to an RHU facility before accessing the consultation queue.');
  }
};

const MUNICIPALITY_ROLES = new Set(['mho', 'phn', 'rhu_personnel']);
const BARANGAY_ROLES = new Set(['health_supervisor', 'bhw']);

/**
 * BUG-002: is this clinical record inside the caller's coverage?
 * Scope is derived from the AUTHENTICATED profile and compared against the
 * record's resident scope (municipality/barangay), never from a client id.
 * Mirrors the residents/visits/referrals RLS in 20260915100100 so a
 * barangay-scoped Health Supervisor cannot read another barangay's PHI and a
 * municipality-scoped role cannot read another municipality's PHI, even when
 * the record id is known.
 */
const recordInScope = (user, resident, facilityId = null) => {
  if (!user) return false;
  if (user.role === 'admin') return true;
  if (!withinFacilityScope(user, facilityId)) return false;
  const municipalityId = resident?.municipalityId ?? null;
  const barangayId = resident?.barangayId ?? null;
  if (BARANGAY_ROLES.has(user.role)) {
    return Boolean(user.municipalityId && user.barangayId) && municipalityId === user.municipalityId && barangayId === user.barangayId;
  }
  if (MUNICIPALITY_ROLES.has(user.role)) {
    return Boolean(user.municipalityId) && municipalityId === user.municipalityId;
  }
  return false;
};

const assertSubmissionScope = (user, submission) => {
  if (!recordInScope(user, submission?.resident, submission?.facilityId)) {
    throw ApiError.notFound('Submission not found');
  }
};

export const listQueue = async ({ statuses = null, q = '', user } = {}) => {
  assertCanProcessConsultation(user);
  const allowed = statuses && statuses.length ? statuses : null;
  const effectiveStatuses = allowed && allowed.length
    ? allowed
    : [SUBMISSION_STATUS.SUBMITTED, SUBMISSION_STATUS.RECEIVED, SUBMISSION_STATUS.IN_REVIEW, SUBMISSION_STATUS.REFERRED, SUBMISSION_STATUS.COMPLETED];
  const validStatuses = new Set([SUBMISSION_STATUS.SUBMITTED, SUBMISSION_STATUS.RECEIVED, SUBMISSION_STATUS.IN_REVIEW, SUBMISSION_STATUS.REFERRED, SUBMISSION_STATUS.COMPLETED]);
  if (effectiveStatuses.some((status) => !validStatuses.has(status))) throw ApiError.badRequest('Unknown consultation queue status.');
  if (!user.municipalityId) throw ApiError.forbidden('The consultation queue requires an assigned municipality.');
  const rows = [];
  const seen = new Set();
  for (let offset = 0; ; offset += 100) {
    const result = await repository.listVisits({ statuses: effectiveStatuses, q, limit: 100, offset,
      municipalityId: user.municipalityId,
      barangayId: BARANGAY_ROLES.has(user.role) ? user.barangayId : null,
      facilityId: user.role === 'rhu_personnel' ? user.facilityId : null });
    const page = Array.isArray(result) ? result : result?.rows;
    if (!Array.isArray(page)) throw new ApiError(503, 'The consultation queue returned an invalid record list.');
    for (const visit of page) {
      if (!visit?.id || seen.has(visit.id)) throw new ApiError(503, 'The consultation queue pagination did not advance.');
      seen.add(visit.id);
      if (recordInScope(user, visit.resident, visit.facilityId)) rows.push(visit);
    }
    if (page.length < 100 || (Number.isFinite(result?.total) && offset + page.length >= result.total)) break;
  }
  const config = await getRiskConfig({ repo: repository });
  const assessed = rows.map((visit) => {
    const risk = hasAssessableVitals(visit.vitals) ? assessVitals(visit.vitals, config) : null;
    return { ...visit, riskLevel: risk?.level ?? null, riskScore: risk?.score ?? null,
      riskFactors: risk?.factors ?? [], riskAssessedAt: risk ? visit.visitDate || visit.createdAt : null };
  });
  return { rows: assessed, total: assessed.length };
};

export const viewSubmission = async ({ id, user }) => {
  const submission = await repository.getVisit(id);
  if (!submission) throw ApiError.notFound('Submission not found');

  // The recorder may always reopen their own submission (any draft state).
  const isRecorder = submission.recordedById === user?.id;
  // BUG-002: every other reader must be BOTH an allowed role AND inside the
  // record's municipality/barangay scope. Out-of-scope reads return 404 so a
  // known id cannot be used to probe or read another barangay's PHI.
  const canView =
    (isRecorder && recordInScope(user, submission.resident, submission.facilityId)) ||
    ((isPHN(user) || ['mho', 'health_supervisor', 'rhu_personnel'].includes(user?.role)) &&
      recordInScope(user, submission.resident, submission.facilityId));
  if (!canView) throw ApiError.notFound('Submission not found');

  if (!isPHN(user) && submission.status === SUBMISSION_STATUS.DRAFT) {
    // Staff other than the recorder cannot view drafts.
    if (!isRecorder) throw ApiError.notFound('Submission not found');
  }
  return submission;
};

export const normalizePhnVisit = (visit = {}) => {
  const pickText = (value) => String(value ?? '').trim();
  const vitals = visit.vitals
    ? (() => {
        const heightCm = visit.vitals.heightCm === '' || visit.vitals.heightCm === null || visit.vitals.heightCm === undefined ? null : Number(visit.vitals.heightCm);
        const weightKg = visit.vitals.weightKg === '' || visit.vitals.weightKg === null || visit.vitals.weightKg === undefined ? null : Number(visit.vitals.weightKg);
        const num = (v) => (v === '' || v === null || v === undefined ? null : Number(v));
        const { bmi, category } = computeBMI(heightCm, weightKg);
        return {
          bp: String(visit.vitals.bp ?? '').trim() || null,
          hr: num(visit.vitals.hr),
          rr: num(visit.vitals.rr),
          o2sat: num(visit.vitals.o2sat),
          temperature: num(visit.vitals.temperature),
          heightCm,
          weightKg,
          bmi,
          bmiCategory: category,
        };
      })()
    : undefined;

  const patch = {};
  if (visit.visitDate !== undefined) patch.visitDate = visit.visitDate || null;
  if (visit.chiefComplaint !== undefined) patch.chiefComplaint = pickText(visit.chiefComplaint);
  if (visit.clinicalHistory !== undefined) patch.clinicalHistory = pickText(visit.clinicalHistory);
  if (visit.findings !== undefined) patch.findings = pickText(visit.findings);
  if (visit.treatmentGiven !== undefined) patch.treatmentGiven = pickText(visit.treatmentGiven);
  if (visit.recommendation !== undefined) patch.recommendation = pickText(visit.recommendation);
  if (visit.healthServiceId !== undefined || visit.health_service_id !== undefined) {
    patch.healthServiceId = pickText(visit.healthServiceId ?? visit.health_service_id) || null;
  }
  // Structured prescriptions (visits.medications JSONB). Normalized with the
  // same catalogue-aware helper the Health-Supervisor consultation uses, so the
  // PHN check-up persists prescriptions identically. Only written when the
  // client includes the field, so unrelated PHN edits never clear it.
  if (visit.medications !== undefined) patch.medications = normalizeMedications(visit.medications);
  if (vitals) patch.vitals = vitals;
  if (visit.phn) {
    const phnPatch = {};
    if (visit.phn.assessment !== undefined) phnPatch.assessment = pickText(visit.phn.assessment);
    if (visit.phn.notes !== undefined) phnPatch.notes = pickText(visit.phn.notes);
    // NOTE: the consultation personnel label is NEVER taken from the client. It
    // is stamped from the authenticated user in updateSubmissionForPhn so the
    // record always reflects who actually performed the consultation.
    if (Object.keys(phnPatch).length) patch.phn = phnPatch;
  }
  return patch;
};

const consultationServiceVisibleTo = (user, service) => {
  if (!service || service.active === false || service.municipality_id !== user.municipalityId) return false;
  if (user.role === 'phn') return true;
  if (user.role === 'rhu_personnel') {
    return (!service.facility_id || service.facility_id === user.facilityId)
      && !service.barangay_id;
  }
  if (user.role === 'health_supervisor') {
    return !service.barangay_id || service.barangay_id === user.barangayId;
  }
  return false;
};

/**
 * Active service choices for the shared consultation workbench only.
 * Callers must already be authenticated and assigned consultation access;
 * RHU Personnel additionally see only RHU-wide or their assigned facility's
 * services. This deliberately does not grant access to the general catalog API.
 */
export const listConsultationHealthServices = async ({ user, supabase = getServiceClient() }) => {
  assertCanProcessConsultation(user);
  if (!user.municipalityId) {
    throw ApiError.forbidden('Your account has no municipality assignment for consultation services.');
  }
  const { data, error } = await supabase
    .from('health_services')
    .select('id, name, category, active, municipality_id, facility_id, barangay_id')
    .eq('municipality_id', user.municipalityId)
    .eq('active', true)
    .order('name', { ascending: true });
  if (error) {
    throw new ApiError(502, `Could not load consultation health services: ${error.message}`);
  }
  return (data || [])
    .filter((service) => consultationServiceVisibleTo(user, service))
    .map(({ id, name, category, active }) => ({ id, name, category: category || 'Other', active }));
};

const resolveConsultationHealthService = async ({ user, serviceId, supabase }) => {
  const services = await listConsultationHealthServices({ user, supabase });
  const service = services.find((row) => row.id === serviceId);
  if (!service) {
    throw ApiError.unprocessable('Please select an active health service available to your consultation area.', {
      healthServiceId: 'The selected health service is inactive, unavailable, or outside your authorized scope.',
    });
  }
  return service;
};

export const updateSubmissionForPhn = async ({
  id,
  patch = {},
  user,
  repo = repository,
  supabase = getServiceClient(),
}) => {
  assertCanProcessConsultation(user);
  const submission = await repo.getVisit(id);
  if (!submission) throw ApiError.notFound('Submission not found');
  assertSubmissionScope(user, submission);
  if (!PHN_EDITABLE_STATUSES.includes(submission.status)) {
    throw ApiError.forbidden('This submission is not open for PHN processing.');
  }

  const normalized = normalizePhnVisit(patch);
  if (normalized.healthServiceId !== undefined) {
    if (!normalized.healthServiceId) {
      normalized.healthServiceName = '';
    } else if (normalized.healthServiceId === submission.healthServiceId) {
      // Preserve the historical name snapshot for a service that was later
      // deactivated or renamed; an unchanged association remains valid.
      normalized.healthServiceName = submission.healthServiceName || '';
    } else {
      const service = await resolveConsultationHealthService({
        user,
        serviceId: normalized.healthServiceId,
        supabase,
      });
      normalized.healthServiceName = service.name;
    }
  }
  // Stamp the consultation personnel label from the authenticated user whenever
  // PHN/consultation clinical fields are recorded — the performer is the signed-in
  // account, never a client-submitted name.
  if (normalized.phn) {
    normalized.phn.personnel = user.name || user.email || '';
  }
  const vitals = {
    heightCm: null,
    weightKg: null,
    ...(submission.vitals || {}),
    ...(normalized.vitals || {}),
  };
  const errors = validateVitals(vitals);
  if (errors.length) throw ApiError.badRequest('Invalid vital signs.', errors);

  const updated = await repo.updateVisit(id, normalized);
  return updated;
};

const guardTransition = (submission, from, to) => {
  if (!from.includes(submission.status)) {
    throw ApiError.conflict(`Cannot move a ${submission.status} submission to ${to}.`);
  }
};

export const receiveSubmission = async ({ id, user }) => {
  assertCanProcessConsultation(user);
  const submission = await repository.getVisit(id);
  if (!submission) throw ApiError.notFound('Submission not found');
  assertSubmissionScope(user, submission);
  guardTransition(submission, [SUBMISSION_STATUS.SUBMITTED, SUBMISSION_STATUS.RECEIVED], SUBMISSION_STATUS.RECEIVED);
  const now = new Date().toISOString();
  return repository.updateVisit(id, { status: SUBMISSION_STATUS.RECEIVED, receivedAt: now });
};

export const markInReview = async ({ id, user }) => {
  assertCanProcessConsultation(user);
  const submission = await repository.getVisit(id);
  if (!submission) throw ApiError.notFound('Submission not found');
  assertSubmissionScope(user, submission);
  guardTransition(
    submission,
    [SUBMISSION_STATUS.SUBMITTED, SUBMISSION_STATUS.RECEIVED, SUBMISSION_STATUS.IN_REVIEW, SUBMISSION_STATUS.REFERRED],
    SUBMISSION_STATUS.IN_REVIEW,
  );
  const now = new Date().toISOString();
  return repository.updateVisit(id, {
    status: SUBMISSION_STATUS.IN_REVIEW,
    receivedAt: submission.receivedAt || now,
    reviewedAt: submission.reviewedAt || now,
  });
};

export const completeSubmission = async ({ id, user }) => {
  assertCanProcessConsultation(user);
  const submission = await repository.getVisit(id);
  if (!submission) throw ApiError.notFound('Submission not found');
  assertSubmissionScope(user, submission);
  guardTransition(
    submission,
    [SUBMISSION_STATUS.IN_REVIEW, SUBMISSION_STATUS.REFERRED, SUBMISSION_STATUS.RECEIVED, SUBMISSION_STATUS.SUBMITTED],
    SUBMISSION_STATUS.COMPLETED,
  );

  // The clinical OUTPUTS moved off the submit gate are enforced HERE, at
  // completion: a completed visit must carry the PHN's findings and the
  // treatment given. This preserves the end-state guarantee (a completed
  // consultation is clinically complete) without requiring those fields at the
  // triage hand-off.
  const missing = [];
  if (!String(submission.findings ?? '').trim()) missing.push('Findings are required before completing the check-up.');
  if (!String(submission.treatmentGiven ?? '').trim()) missing.push('Treatment given is required before completing the check-up.');
  if (missing.length) {
    throw ApiError.badRequest('Cannot complete: the PHN clinical assessment is incomplete.', missing);
  }

  const now = new Date().toISOString();
  const updated = await repository.updateVisit(id, {
    status: SUBMISSION_STATUS.COMPLETED,
    receivedAt: submission.receivedAt || now,
    reviewedAt: submission.reviewedAt || now,
    completedAt: now,
  });

  // If this RHU encounter is linked to a barangay referral, mark it completed
  // from the referral side so the Health Supervisor sees the unified stage advance.
  if (updated.referralId) {
    await markCompletedFromVisit(updated.referralId);
  }

  return updated;
};

/** Sparse document-field adapter. Free-text names never establish recipients. */
export const normalizeReferralDraft = (draft = {}, existing = null) => {
  const row = {};
  const fields = {
    referringFacility: 'referring_facility', receivingFacility: 'destination_facility',
    reasonForReferral: 'reason', workingImpression: 'impression', outpatientService: 'destination_service', referralCategory: 'referral_category',
    recipientPersonnelId: 'recipient_personnel_id', recipientFacilityId: 'recipient_facility_id',
    recipientRole: 'recipient_role', recipientStation: 'recipient_station',
    chiefComplaints: 'chief_complaints', medicalHistory: 'medical_history', physicalExamFindings: 'physical_exam_findings',
    scheduledAt: 'scheduled_at', laboratoryTestRequired: 'laboratory_test_required', laboratoryTest: 'laboratory_test',
    additionalInstructions: 'additional_instructions', clientTimeZone: 'client_time_zone', expectedVersion: 'expected_version',
  };
  for (const [camel, snake] of Object.entries(fields)) {
    if (Object.prototype.hasOwnProperty.call(draft, camel)) row[snake] = draft[camel];
    if (Object.prototype.hasOwnProperty.call(draft, snake)) row[snake] = draft[snake];
  }
  for (const key of ['priority', 'notes', 'version', 'status', 'resident_id', 'created_by', 'municipality_id', 'barangay_id', 'patient_snapshot', 'visit_snapshot', 'completed_at']) {
    if (Object.prototype.hasOwnProperty.call(draft, key)) row[key] = draft[key];
  }
  if (draft.referralDate !== undefined || draft.referral_date !== undefined) {
    row.referral_date = String(draft.referralDate ?? draft.referral_date ?? '').slice(0, 10) || null;
  }
  if (row.scheduled_at === undefined && (draft.appointmentDate !== undefined || draft.appointmentTime !== undefined)) {
    const prior = existing?.scheduled_at ? new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(existing.scheduled_at)) : '';
    const date = draft.appointmentDate ?? prior.slice(0, 10);
    const time = draft.appointmentTime ?? prior.slice(11, 16);
    if (!date && time) throw ApiError.unprocessable('An appointment date is required with the appointment time.');
    row.scheduled_at = date ? `${date}T${time || '09:00'}:00+08:00` : null;
  }
  return row;
};

export const createReferral = async ({ visitId, draft = {}, user, repo = repository, supabase }) => {
  if (!isPHN(user)) throw ApiError.forbidden();
  const submission = await repo.getVisit(visitId);
  if (!submission) throw ApiError.notFound('Submission not found');
  // BUG-002: enforce scope on the source submission so a PHN cannot generate a
  // referral for a visit in another municipality (IDOR). Mirrors the check used
  // by receiveSubmission / markInReview / completeSubmission.
  assertSubmissionScope(user, submission);
  if (!PHN_EDITABLE_STATUSES.includes(submission.status)) {
    throw ApiError.forbidden('The submission must be received and in review before a referral is generated.');
  }
  const normalized = normalizeReferralDraft(draft);
  const referral = await canonicalReferrals.create({
    user, fromPhn: true, supabase: supabase || getServiceClient(),
    payload: {
      referring_facility: FACILITY.name,
      ...normalized,
      residentId: submission.residentId,
      treatment_visit_id: submission.id,
    },
  });
  // The canonical RPC commits the source visit's referred status, snapshots,
  // history and addressed notifications in the SAME transaction.
  return canonicalReferrals.toPhnReferral(referral);
};

export const updateReferral = async ({ id, patch = {}, user, supabase }) => {
  if (!isPHN(user)) throw ApiError.forbidden();
  const client = supabase || getServiceClient();
  // Canonical get/update both recheck CURRENT resident geography and sender
  // identity. Resolving an old REF-* ID never bypasses the prior scope fix.
  const existing = await canonicalReferrals.getById({ user, id, supabase: client });
  return canonicalReferrals.toPhnReferral(await canonicalReferrals.update({ user, id: existing.id, payload: normalizeReferralDraft(patch, existing), supabase: client }));
};

/**
 * Re-freezes the patient + visit snapshots of a referral from the current
 * resident/visit state. Called explicitly when the PHN edits clinical data
 * after generating the referral.
 */
export const syncReferralSnapshots = async ({ id, user, version, repo = repository, supabase }) => {
  if (!isPHN(user)) throw ApiError.forbidden();
  const client = supabase || getServiceClient();
  const referral = await canonicalReferrals.getById({ user, id, supabase: client });
  const submission = await repo.getVisit(referral.treatment_visit_id);
  if (!submission) throw ApiError.notFound('Source submission not found');
  assertSubmissionScope(user, submission);
  if (submission.residentId !== referral.resident_id) throw ApiError.notFound('Source submission not found');
  return canonicalReferrals.toPhnReferral(await canonicalReferrals.syncSnapshots({ user, id: referral.id, version, supabase: client }));
};

export const listReferrals = async ({ q = '', user, box = 'all', status = null, supabase } = {}) => {
  const canView =
    isPHN(user) || ['mho', 'health_supervisor', 'rhu_personnel'].includes(user?.role);
  if (!canView) throw ApiError.forbidden();
  const records = await canonicalReferrals.list({ user, box, status, supabase: supabase || getServiceClient() });
  const needle = String(q || '').trim().toLowerCase();
  const rows = records.map(canonicalReferrals.toPhnReferral).filter((row) => !needle || [row.id, row.reasonForReferral, row.receivingFacility, row.resident.firstName, row.resident.lastName].some((value) => String(value || '').toLowerCase().includes(needle)));
  return { rows, total: rows.length };
};

export const getReferral = async ({ id, user, supabase }) => {
  const canView = isPHN(user) || ['mho', 'health_supervisor', 'rhu_personnel'].includes(user?.role);
  if (!canView) throw ApiError.notFound('Referral not found');
  return canonicalReferrals.toPhnReferral(await canonicalReferrals.getById({ user, id, supabase: supabase || getServiceClient() }));
};

export const getReferralByVisitId = async ({ visitId, user, supabase }) => {
  const canView = isPHN(user) || ['mho', 'health_supervisor', 'rhu_personnel'].includes(user?.role);
  if (!canView) throw ApiError.notFound('Referral not found');
  return canonicalReferrals.toPhnReferral(await canonicalReferrals.getByVisitId({ user, visitId, supabase: supabase || getServiceClient() }));
};

export const updateReferralStatus = async ({ id, status, resolutionNotes, version, user, supabase }) =>
  canonicalReferrals.toPhnReferral(await canonicalReferrals.updateStatus({ user, id, status, resolutionNotes, version, supabase: supabase || getServiceClient() }));

export default {
  listQueue,
  listConsultationHealthServices,
  viewSubmission,
  updateSubmissionForPhn,
  receiveSubmission,
  markInReview,
  completeSubmission,
  createReferral,
  updateReferral,
  syncReferralSnapshots,
  listReferrals,
  getReferral,
  getReferralByVisitId,
  updateReferralStatus,
};
