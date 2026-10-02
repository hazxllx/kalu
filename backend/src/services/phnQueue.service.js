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
 *   - only the PHN role may mutate queue items,
 *   - clinical content is editable only while status is in the PHN set,
 *   - a visit can generate at most one referral,
 *   - referral snapshots are frozen at generation time and re-synced
 *     explicitly, never implicitly on unrelated edits.
 */
import ApiError from '../utils/apiError.js';
import repository from '../repositories/index.js';
import { computeBMI } from '../utils/bmi.js';
import { FACILITY, SUBMISSION_STATUS, PHN_EDITABLE_STATUSES } from '../config/facility.js';
import { validateVitals } from './intake.service.js';

const isPHN = (user) => user?.role === 'phn';

// RHU Consultation Station reuses the SAME visit queue the PHN uses: both the
// PHN and RHU personnel may receive/review/update/complete a submitted
// encounter (record findings/assessment/treatment). This does NOT change the
// PHN assessment feature — it only additionally admits the RHU consultation
// role. Referral generation remains PHN-only (see createReferral/updateReferral).
const canProcessConsultation = (user) => user?.role === 'phn' || user?.role === 'rhu_personnel';

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
const recordInScope = (user, resident) => {
  if (!user) return false;
  if (user.role === 'admin') return true;
  const municipalityId = resident?.municipalityId ?? null;
  const barangayId = resident?.barangayId ?? null;
  if (BARANGAY_ROLES.has(user.role)) {
    return Boolean(user.barangayId) && barangayId === user.barangayId;
  }
  if (MUNICIPALITY_ROLES.has(user.role)) {
    return Boolean(user.municipalityId) && municipalityId === user.municipalityId;
  }
  return false;
};

const clone = (value) => JSON.parse(JSON.stringify(value));

const withoutMeta = (obj) => {
  const next = clone(obj);
  delete next.createdAt;
  delete next.updatedAt;
  delete next.resident;
  delete next.recordedById;
  delete next.recordedByRole;
  delete next.recordedByName;
  return next;
};

export const listQueue = async ({ statuses = null, q = '', user } = {}) => {
  if (!canProcessConsultation(user)) throw ApiError.forbidden();
  const allowed = statuses && statuses.length ? statuses : null;
  const effectiveStatuses = allowed && allowed.length
    ? allowed
    : [SUBMISSION_STATUS.SUBMITTED, SUBMISSION_STATUS.RECEIVED, SUBMISSION_STATUS.IN_REVIEW, SUBMISSION_STATUS.REFERRED, SUBMISSION_STATUS.COMPLETED];
  const result = await repository.listVisits({ statuses: effectiveStatuses, q, limit: 100 });
  // BUG-002: the PHN queue is limited to the PHN's own municipality.
  const rows = (result?.rows ?? result ?? []).filter((v) => recordInScope(user, v.resident));
  return Array.isArray(result) ? rows : { ...result, rows, total: rows.length };
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
    isRecorder ||
    ((isPHN(user) || ['mho', 'health_supervisor', 'rhu_personnel'].includes(user?.role)) &&
      recordInScope(user, submission.resident));
  if (!canView) throw ApiError.notFound('Submission not found');

  if (!isPHN(user) && submission.status === SUBMISSION_STATUS.DRAFT) {
    // Staff other than the recorder cannot view drafts.
    if (!isRecorder) throw ApiError.notFound('Submission not found');
  }
  return submission;
};

const normalizePhnVisit = (visit = {}) => {
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
  if (vitals) patch.vitals = vitals;
  if (visit.phn) {
    const phnPatch = {};
    if (visit.phn.assessment !== undefined) phnPatch.assessment = pickText(visit.phn.assessment);
    if (visit.phn.notes !== undefined) phnPatch.notes = pickText(visit.phn.notes);
    if (visit.phn.personnel !== undefined) phnPatch.personnel = pickText(visit.phn.personnel);
    if (Object.keys(phnPatch).length) patch.phn = phnPatch;
  }
  return patch;
};

export const updateSubmissionForPhn = async ({ id, patch = {}, user }) => {
  if (!canProcessConsultation(user)) throw ApiError.forbidden();
  const submission = await repository.getVisit(id);
  if (!submission) throw ApiError.notFound('Submission not found');
  if (!PHN_EDITABLE_STATUSES.includes(submission.status)) {
    throw ApiError.forbidden('This submission is not open for PHN processing.');
  }

  const normalized = normalizePhnVisit(patch);
  const vitals = { ...(submission.vitals || {}), ...(normalized.vitals || {}) };
  const errors = validateVitals(vitals);
  if (errors.length) throw ApiError.badRequest('Invalid vital signs.', errors);

  const updated = await repository.updateVisit(id, normalized);
  return updated;
};

const guardTransition = (submission, from, to) => {
  if (!from.includes(submission.status)) {
    throw ApiError.conflict(`Cannot move a ${submission.status} submission to ${to}.`);
  }
};

export const receiveSubmission = async ({ id, user }) => {
  if (!canProcessConsultation(user)) throw ApiError.forbidden();
  const submission = await repository.getVisit(id);
  if (!submission) throw ApiError.notFound('Submission not found');
  guardTransition(submission, [SUBMISSION_STATUS.SUBMITTED, SUBMISSION_STATUS.RECEIVED], SUBMISSION_STATUS.RECEIVED);
  const now = new Date().toISOString();
  return repository.updateVisit(id, { status: SUBMISSION_STATUS.RECEIVED, receivedAt: now });
};

export const markInReview = async ({ id, user }) => {
  if (!canProcessConsultation(user)) throw ApiError.forbidden();
  const submission = await repository.getVisit(id);
  if (!submission) throw ApiError.notFound('Submission not found');
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
  if (!canProcessConsultation(user)) throw ApiError.forbidden();
  const submission = await repository.getVisit(id);
  if (!submission) throw ApiError.notFound('Submission not found');
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
  return repository.updateVisit(id, {
    status: SUBMISSION_STATUS.COMPLETED,
    receivedAt: submission.receivedAt || now,
    reviewedAt: submission.reviewedAt || now,
    completedAt: now,
  });
};

const referralDraftDefaults = (submission, user) => {
  const resident = submission.resident || {};
  const snapResident = withoutMeta(resident);
  const snapVisit = withoutMeta(submission);
  return {
    residentId: submission.residentId,
    visitId: submission.id,
    referringFacility: FACILITY.name,
    referringFacilityAddress: FACILITY.address,
    referringPersonnel: user.name || user.email || '',
    referringContact: FACILITY.contactNumber,
    referralDate: new Date().toISOString(),
    patientSnapshot: snapResident,
    visitSnapshot: snapVisit,
    createdById: user.id,
    createdByRole: user.role,
    createdByName: user.name || user.email || '',
    status: SUBMISSION_STATUS.REFERRED,
  };
};

const normalizeReferralDraft = (draft = {}) => {
  const text = (v) => String(v ?? '').trim();
  return {
    receivingFacility: text(draft.receivingFacility),
    receivingFacilityAddress: text(draft.receivingFacilityAddress),
    receivingPersonnel: text(draft.receivingPersonnel),
    appointmentDate: draft.appointmentDate || null,
    appointmentTime: draft.appointmentTime || null,
    reasonForReferral: text(draft.reasonForReferral),
    workingImpression: text(draft.workingImpression),
    referralCategory: text(draft.referralCategory),
    outpatientService: text(draft.outpatientService),
  };
};

export const createReferral = async ({ visitId, draft = {}, user }) => {
  if (!isPHN(user)) throw ApiError.forbidden();
  const submission = await repository.getVisit(visitId);
  if (!submission) throw ApiError.notFound('Submission not found');
  if (!PHN_EDITABLE_STATUSES.includes(submission.status)) {
    throw ApiError.forbidden('The submission must be received and in review before a referral is generated.');
  }
  const existingReferral = await repository.getReferralByVisitId(visitId);
  if (existingReferral) {
    throw ApiError.conflict('A referral has already been generated for this submission.');
  }

  const normalized = normalizeReferralDraft(draft);
  if (!normalized.receivingFacility) throw ApiError.badRequest('Receiving facility is required.');
  if (!normalized.reasonForReferral) throw ApiError.badRequest('Reason for referral is required.');

  const ids = await repository.nextReferralId();
  const referral = await repository.insertReferral({
    id: ids.id,
    ...referralDraftDefaults(submission, user),
    ...normalized,
  });

  const now = new Date().toISOString();
  await repository.updateVisit(visitId, {
    status: SUBMISSION_STATUS.REFERRED,
    receivedAt: submission.receivedAt || now,
    reviewedAt: submission.reviewedAt || now,
    referredAt: now,
  });

  return referral;
};

export const updateReferral = async ({ id, patch = {}, user }) => {
  if (!isPHN(user)) throw ApiError.forbidden();
  const referral = await repository.getReferral(id);
  if (!referral) throw ApiError.notFound('Referral not found');
  const normalized = normalizeReferralDraft(patch);
  if (Object.prototype.hasOwnProperty.call(normalized, 'receivingFacility') && !normalized.receivingFacility) {
    throw ApiError.badRequest('Receiving facility is required.');
  }
  if (Object.prototype.hasOwnProperty.call(normalized, 'reasonForReferral') && !normalized.reasonForReferral) {
    throw ApiError.badRequest('Reason for referral is required.');
  }
  return repository.updateReferral(id, normalized);
};

/**
 * Re-freezes the patient + visit snapshots of a referral from the current
 * resident/visit state. Called explicitly when the PHN edits clinical data
 * after generating the referral.
 */
export const syncReferralSnapshots = async ({ id, user }) => {
  if (!isPHN(user)) throw ApiError.forbidden();
  const referral = await repository.getReferral(id);
  if (!referral) throw ApiError.notFound('Referral not found');
  const submission = await repository.getVisit(referral.visitId);
  if (!submission) throw ApiError.notFound('Source submission not found');
  const updated = await repository.updateReferral(id, {
    patientSnapshot: withoutMeta(submission.resident || {}),
    visitSnapshot: withoutMeta(submission),
  });
  return updated;
};

export const listReferrals = async ({ q = '', user } = {}) => {
  const canView =
    isPHN(user) || ['mho', 'health_supervisor', 'rhu_personnel'].includes(user?.role);
  if (!canView) throw ApiError.forbidden();
  const result = await repository.listReferrals({ q, limit: 100 });
  // BUG-002: filter the queue to the caller's scope. The repository has no
  // scope columns of its own, so filter on the embedded resident scope.
  const rows = (result?.rows ?? result ?? []).filter((r) => recordInScope(user, r.resident));
  return Array.isArray(result) ? rows : { ...result, rows, total: rows.length };
};

export const getReferral = async ({ id, user }) => {
  const canView = isPHN(user) || ['mho', 'health_supervisor', 'rhu_personnel'].includes(user?.role);
  if (!canView) throw ApiError.notFound('Referral not found');
  const referral = await repository.getReferral(id);
  if (!referral) throw ApiError.notFound('Referral not found');
  // BUG-002: out-of-scope referral reads return 404 even with a known id.
  if (!recordInScope(user, referral.resident)) throw ApiError.notFound('Referral not found');
  return referral;
};

export const getReferralByVisitId = async ({ visitId, user }) => {
  const canView = isPHN(user) || ['mho', 'health_supervisor', 'rhu_personnel'].includes(user?.role);
  if (!canView) throw ApiError.notFound('Referral not found');
  const referral = await repository.getReferralByVisitId(visitId);
  if (!referral) throw ApiError.notFound('Referral not found');
  if (!recordInScope(user, referral.resident)) throw ApiError.notFound('Referral not found');
  return referral;
};

export default {
  listQueue,
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
};
