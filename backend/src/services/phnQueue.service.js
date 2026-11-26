// backend/src/services/phnQueue.service.js
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
import { markCompletedFromVisit } from './referrals.service.js';
import * as canonicalReferrals from './referrals.service.js';
import { getServiceClient } from '../config/supabase.js';
import { getRiskConfig } from './riskConfig.service.js';
import { assessVisitRisk } from '../utils/residentRisk.js';
import { buildEncounterAssessment, validateClinicalIndicators, encounterBloodPressureContext,
  loadEncounterClinicalContext, reconcileConsultationClinicalContext, resolveConsultationMaternal,
  validateConsultationRiskReview } from './clinicalAssessment.service.js';
import { resolveConsultationMedications } from './consultations.service.js';
import { normalizeMedications } from './medicines.service.js';
import { getManilaDateTime, validateConsultationVitals, validateConsultationDateTime } from '../../../shared/consultationClinical.js';
import { classifyBloodPressure } from '../../../shared/bloodPressure.js';
import env from '../config/env.js';

/** Preserve the configured score while distinguishing missing inputs from a negative finding. */
export const assessPhnVisitRisk = (visit, config) => {
  const risk = assessVisitRisk(visit, config);
  return { ...visit, clinicalAssessment: risk.clinicalAssessment || visit?.consultationDetails?.clinicalAssessment || null,
    consultationRiskAssessment: risk.consultationRiskAssessment || null, riskLevel: risk.level, riskScore: risk.score,
    riskFactors: risk.factors, riskAssessedAt: risk.level === null ? null : visit.visitDate || visit.createdAt || null,
    riskAssessmentStatus: risk.status, missingMeasurements: risk.missingMeasurements, riskReason: risk.reason,
    ...(risk.riskSource ? { riskSource: risk.riskSource } : {}) };
};

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
const requiresAssignedConsultationRoute = (user) =>
  user?.role === 'rhu_personnel'
  || (user?.role === 'health_supervisor' && canConsult(user));

const isDirectRhuTriageSubmission = (user, submission) =>
  user?.role === 'rhu_personnel'
  && Boolean(user.facilityId)
  && submission?.facilityId === user.facilityId
  && !submission?.consultationRoutedAt
  && !submission?.consultationRoutedFacilityId;

const recordInScope = (user, resident, facilityId = null, consultationRoutedFacilityId = null, consultationRoutedAt = null) => {
  if (!user) return false;
  if (user.role === 'admin') return true;
  if (user.role === 'rhu_personnel') {
    if (!user.facilityId) return false;
    const wasRouted = Boolean(consultationRoutedAt || consultationRoutedFacilityId);
    if (wasRouted
      ? consultationRoutedFacilityId !== user.facilityId
      : facilityId !== user.facilityId) return false;
  } else if (requiresAssignedConsultationRoute(user)) {
    if (!user.facilityId || consultationRoutedFacilityId !== user.facilityId) return false;
  } else if (!withinFacilityScope(user, facilityId)) return false;
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
  if (!recordInScope(user, submission?.resident, submission?.facilityId, submission?.consultationRoutedFacilityId, submission?.consultationRoutedAt)) {
    throw ApiError.notFound('Submission not found');
  }
};

const assertRoutedConsultationOwnership = (user, submission) => {
  if (isPHN(user) && submission?.consultationRoutedAt) {
    throw ApiError.conflict('This encounter has been routed to RHU Consultation and can no longer be changed in the PHN check-up.');
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
      // Include facility-originated triage and explicitly routed BHS cases;
      // recordInScope below restricts RHU staff to their own facility or the
      // consultation facility selected by the PHN.
      facilityId: null });
    const page = Array.isArray(result) ? result : result?.rows;
    if (!Array.isArray(page)) throw new ApiError(503, 'The consultation queue returned an invalid record list.');
    for (const visit of page) {
      if (!visit?.id || seen.has(visit.id)) throw new ApiError(503, 'The consultation queue pagination did not advance.');
      seen.add(visit.id);
      if (recordInScope(user, visit.resident, visit.facilityId, visit.consultationRoutedFacilityId, visit.consultationRoutedAt)) rows.push(visit);
    }
    if (page.length < 100 || (Number.isFinite(result?.total) && offset + page.length >= result.total)) break;
  }
  const config = await getRiskConfig({ repo: repository });
  const assessed = rows.map((visit) => assessPhnVisitRisk(visit, config));
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
    (isRecorder && recordInScope(user, submission.resident, submission.facilityId, submission.consultationRoutedFacilityId, submission.consultationRoutedAt)) ||
    ((isPHN(user) || ['mho', 'health_supervisor', 'rhu_personnel'].includes(user?.role)) &&
      recordInScope(user, submission.resident, submission.facilityId, submission.consultationRoutedFacilityId, submission.consultationRoutedAt));
  if (!canView) throw ApiError.notFound('Submission not found');

  if (!isPHN(user) && submission.status === SUBMISSION_STATUS.DRAFT) {
    // Staff other than the recorder cannot view drafts.
    if (!isRecorder) throw ApiError.notFound('Submission not found');
  }
  return assessPhnVisitRisk(submission, await getRiskConfig({ repo: repository }));
};

export const normalizePhnVisit = (visit = {}) => {
  if (visit.vitals !== undefined) {
    const errors = validateVitals(visit.vitals);
    if (Object.keys(errors).length) throw ApiError.badRequest('Invalid vital signs.', errors);
  }
  const pickText = (value) => String(value ?? '').trim();
  let consultationVitals;
  if (visit.consultationVitals !== undefined) {
    const input = visit.consultationVitals;
    const fields = ['bloodPressure', 'temperature', 'pulseRate', 'respiratoryRate', 'height', 'weight', 'oxygenSaturation'];
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw ApiError.unprocessable('Please correct the consultation measurements.', {
        consultationVitals: 'Enter only supported missing vital signs.',
      });
    }
    const unsupported = Object.keys(input).filter((field) => !fields.includes(field));
    if (unsupported.length) {
      throw ApiError.unprocessable('Please correct the consultation measurements.', {
        consultationVitals: 'Only supported vital signs can be added here.',
      });
    }
    const values = Object.fromEntries(fields
      .filter((field) => input[field] !== undefined && input[field] !== null && String(input[field]).trim() !== '')
      .map((field) => [field, typeof input[field] === 'string' ? input[field].trim() : input[field]]));
    for (const [field, value] of Object.entries(values)) {
      if (typeof value !== 'string' && typeof value !== 'number') {
        throw ApiError.unprocessable('Please correct the consultation measurements.', {
          [`consultationVitals.${field}`]: 'Enter a valid measurement.',
        });
      }
    }
    const vitalErrors = validateConsultationVitals(values, { required: false });
    if (Object.keys(vitalErrors).length) {
      throw ApiError.unprocessable('Please correct the consultation measurements.',
        Object.fromEntries(Object.entries(vitalErrors).map(([field, message]) => [`consultationVitals.${field}`, message])));
    }
    consultationVitals = Object.fromEntries(Object.entries(values).map(([field, value]) => [
      field,
      field === 'bloodPressure' ? String(value).trim() : Number(value),
    ]));
  }
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
          bloodSugar: num(visit.vitals.bloodSugar),
          heightCm,
          weightKg,
          bmi,
          bmiCategory: category,
        };
      })()
    : undefined;

  const patch = {};
  if (visit.consultationDetails?.clinicalIndicators !== undefined) {
    patch.consultationDetails = { clinicalIndicators: validateClinicalIndicators(visit.consultationDetails.clinicalIndicators) };
  }
  if (visit.visitDate !== undefined) patch.visitDate = visit.visitDate || null;
  if (visit.chiefComplaint !== undefined) patch.chiefComplaint = pickText(visit.chiefComplaint);
  if (visit.clinicalHistory !== undefined) patch.clinicalHistory = pickText(visit.clinicalHistory);
  if (visit.findings !== undefined) patch.findings = pickText(visit.findings);
  if (visit.diagnosis !== undefined) {
    if (typeof visit.diagnosis !== 'string' || visit.diagnosis.length > 10000) {
      throw ApiError.unprocessable('Please correct the consultation details.', {
        diagnosis: 'Use text of 10,000 characters or fewer.',
      });
    }
    patch.diagnosis = pickText(visit.diagnosis);
  }
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
  if (consultationVitals && Object.keys(consultationVitals).length) patch.consultationVitals = consultationVitals;
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

const CONSULTATION_VITAL_COLUMN = Object.freeze({
  bloodPressure: 'bp',
  temperature: 'temperature',
  pulseRate: 'hr',
  respiratoryRate: 'rr',
  height: 'heightCm',
  weight: 'weightKg',
  oxygenSaturation: 'o2sat',
});

const hasRecordedVital = (value) => value !== null && value !== undefined
  && !['', '—', '-', 'not recorded'].includes(String(value).trim().toLowerCase());

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
  supabase,
  complete = false,
}) => {
  assertCanProcessConsultation(user);
  const submission = await repo.getVisit(id);
  if (!submission) throw ApiError.notFound('Submission not found');
  assertSubmissionScope(user, submission);
  assertRoutedConsultationOwnership(user, submission);
  if (submission.status === SUBMISSION_STATUS.COMPLETED && complete) {
    const requested = normalizePhnVisit(patch);
    const comparable = (value) => {
      if (Array.isArray(value)) return value.map(comparable);
      if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, comparable(value[key])]));
      return value ?? '';
    };
    const same = Object.entries(requested).every(([key, value]) => {
      if (key === 'phn') return Object.entries(value).every(([field, text]) => String(submission.phn?.[field] || '').trim() === text);
      if (key === 'diagnosis') return String(submission.consultationDetails?.diagnosis || '').trim() === value;
      if (key === 'consultationDetails') return Object.entries(value.clinicalIndicators || {}).every(([field, present]) =>
        submission.consultationDetails?.clinicalIndicators?.[field] === present);
      if (key === 'consultationVitals') return Object.entries(value).every(([field, text]) =>
        JSON.stringify(submission.consultationDetails?.consultationVitals?.[field] ?? '') === JSON.stringify(text));
      const saved = key === 'medications' ? normalizeMedications(submission.medications || []) : submission[key];
      return JSON.stringify(comparable(saved)) === JSON.stringify(comparable(value));
    });
    if (same) return submission;
    throw ApiError.conflict('This consultation has already been completed with different details. Reopen its saved record to review it.');
  }
  if (!PHN_EDITABLE_STATUSES.includes(submission.status)) {
    throw ApiError.forbidden('This submission is not open for PHN processing.');
  }
  if (patch.expectedUpdatedAt && patch.expectedUpdatedAt !== submission.updatedAt) {
    throw ApiError.conflict('This consultation changed after it was opened. Your entries are preserved; reload the saved record before editing.');
  }

  if (submission.triageSnapshot) {
    const protectedFields = ['vitals', 'visitDate', 'chiefComplaint', 'clinicalHistory'];
    const errors = Object.fromEntries(protectedFields.filter((field) => Object.hasOwn(patch, field)).map((field) => [field, 'Original triage information is read-only after handoff.']));
    if (Object.keys(errors).length) throw ApiError.badRequest('The original triage record cannot be changed during consultation.', errors);
  }

  const normalized = normalizePhnVisit(patch);
  const requestedConsultationVitals = normalized.consultationVitals || {};
  delete normalized.consultationVitals;
  const savedConsultationVitals = submission.consultationDetails?.consultationVitals || {};
  const triageVitals = submission.triageSnapshot?.vitals || submission.vitals || {};
  const consultationVitals = { ...savedConsultationVitals };
  for (const [field, value] of Object.entries(requestedConsultationVitals)) {
    const column = CONSULTATION_VITAL_COLUMN[field];
    if (hasRecordedVital(triageVitals[column])) {
      throw ApiError.unprocessable('Only vital signs missing from triage can be added during consultation.', {
        [`consultationVitals.${field}`]: 'This measurement was already recorded during triage and cannot be replaced.',
      });
    }
    if (hasRecordedVital(submission.vitals?.[column]) && !hasRecordedVital(savedConsultationVitals[field])) {
      throw ApiError.conflict('This measurement is already recorded on the encounter. Reload it before continuing.');
    }
    consultationVitals[field] = value;
  }
  for (const [field, value] of Object.entries(consultationVitals)) {
    const column = CONSULTATION_VITAL_COLUMN[field];
    if (!column || hasRecordedVital(triageVitals[column])) {
      throw ApiError.conflict('A saved consultation measurement conflicts with the original triage snapshot.');
    }
    if (!hasRecordedVital(value)) delete consultationVitals[field];
  }
  if (normalized.diagnosis !== undefined) {
    normalized.consultationDetails = {
      ...submission.consultationDetails,
      ...normalized.consultationDetails,
      diagnosis: normalized.diagnosis,
    };
    delete normalized.diagnosis;
  }
  if (normalized.medications !== undefined) normalized.medications = await resolveConsultationMedications({ medications: normalized.medications, previous: submission.medications || [], repo });
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
        supabase: supabase || getServiceClient(),
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
  for (const [field, value] of Object.entries(consultationVitals)) {
    vitals[CONSULTATION_VITAL_COLUMN[field]] = field === 'bloodPressure' ? String(value).trim() : Number(value);
  }
  if (Object.hasOwn(consultationVitals, 'height') || Object.hasOwn(consultationVitals, 'weight')) {
    const calculated = computeBMI(vitals.heightCm, vitals.weightKg);
    vitals.bmi = calculated.bmi;
    vitals.bmiCategory = calculated.category;
  }
  if (Object.keys(consultationVitals).length) {
    normalized.consultationDetails = {
      ...submission.consultationDetails,
      ...normalized.consultationDetails,
      consultationVitals,
    };
  }
  const errors = validateVitals(vitals);
  if (Object.keys(errors).length) throw ApiError.badRequest('Invalid vital signs.', errors);

  if (complete) {
    const final = { ...submission, ...normalized };
    const errors = {};
    if (!String(final.findings || '').trim()) errors.findings = 'Clinical assessment is required before completing the consultation.';
    if (!String(final.treatmentGiven || '').trim()) errors.treatmentGiven = 'Treatment or recommendations are required before completing the consultation.';
    if (Object.keys(errors).length) throw ApiError.badRequest('Please complete the consultation assessment.', errors);
    const now = new Date().toISOString();
    Object.assign(normalized, { status: SUBMISSION_STATUS.COMPLETED, completedAt: now, receivedAt: submission.receivedAt || now, reviewedAt: submission.reviewedAt || now });
  }
  // The database status/clinical update is one statement. A competing completion
  // cannot be overwritten after the initial read.
  const encounter = { ...submission, ...normalized, vitals,
    consultationDetails: { ...submission.consultationDetails, ...normalized.consultationDetails,
        ...(normalized.findings !== undefined ? { findings: normalized.findings } : {}) } };
  const clinicalChanged = complete
    || Object.keys(requestedConsultationVitals).length > 0
    || ['findings','treatmentGiven'].some((field) => normalized[field] !== undefined && normalized[field] !== submission[field])
    || patch.diagnosis !== undefined
    || (normalized.phn?.assessment !== undefined && normalized.phn.assessment !== submission.phn?.assessment)
    || (normalized.medications !== undefined && JSON.stringify(normalized.medications) !== JSON.stringify(submission.medications || []))
    || ['clinicalIndicators','clinicalContext','maternal','riskReview','consultationDate','consultationTime'].some((field) => patch[field] !== undefined);
  if (!clinicalChanged) {
    normalized.consultationDetails = submission.consultationDetails;
    const updated = await repo.updateVisit(id, normalized, { expectedUpdatedAt: patch.expectedUpdatedAt || submission.updatedAt, allowedStatuses: PHN_EDITABLE_STATUSES });
    if (!updated) throw ApiError.conflict('This consultation was updated by another reviewer. Reload and retry.');
    return updated;
  }
  const clinicalDateTime = getManilaDateTime(encounter.visitDate);
  const dateTime = { consultationDate: patch.consultationDate ?? encounter.consultationDetails.consultationDate ?? clinicalDateTime.date,
    consultationTime: patch.consultationTime ?? encounter.consultationDetails.consultationTime ?? clinicalDateTime.time };
  const clinicalErrors = { ...validateConsultationVitals(vitals), ...validateConsultationDateTime(dateTime) };
  if (!String(encounter.consultationDetails.findings ?? encounter.findings ?? '').trim()) clinicalErrors.findings = 'Clinical findings are required.';
  if (Object.keys(clinicalErrors).length) throw ApiError.unprocessable('Complete valid clinical measurements and date/time before saving consultation details.', clinicalErrors);
  Object.assign(encounter.consultationDetails, dateTime, { clinicalIntegrityVersion: 'consultation-clinical-v1',
    findings: encounter.consultationDetails.findings ?? encounter.findings ?? '' });
  const clinicalClient = supabase || (env.isSupabaseConfigured && repo.driver === 'supabase' ? getServiceClient() : null);
  const context = await loadEncounterClinicalContext({ resident: submission.resident, user, ...dateTime, repo, supabase: clinicalClient, excludeVisitId: submission.id });
  const riskReview = validateConsultationRiskReview(patch.riskReview, user);
  encounter.consultationDetails.clinicalContext = reconcileConsultationClinicalContext({ context,
    submitted: patch.clinicalContext ?? submission.consultationDetails?.clinicalContext?.submitted, user, riskReview });
  const maternal = resolveConsultationMaternal({ value: patch.maternal ?? submission.consultationDetails?.maternal, context,
    clinicalContext: encounter.consultationDetails.clinicalContext, consultationDate: dateTime.consultationDate,
    healthService: { id: normalized.healthServiceId ?? submission.healthServiceId,
      category: encounter.consultationDetails.healthServiceCategory || submission.healthService?.category } });
  if (maternal) encounter.consultationDetails.maternal = maternal;
  normalized.bpClassification = classifyBloodPressure(vitals.bp, encounterBloodPressureContext({
    chiefComplaint: encounter.chiefComplaint,
    findings: encounter.findings,
    clinicalIndicators: encounter.consultationDetails?.clinicalIndicators,
  }));
  const assessedDetails = await buildEncounterAssessment({ visit: encounter, resident: submission.resident, user,
    supabase: clinicalClient, previous: submission.consultationDetails, context,
    riskReview });
  normalized.consultationDetails = {
    ...assessedDetails,
    ...(Object.keys(consultationVitals).length ? { consultationVitals } : {}),
  };
  const updated = await repo.updateVisit(id, normalized, { expectedUpdatedAt: submission.updatedAt, allowedStatuses: PHN_EDITABLE_STATUSES });
  if (!updated) throw ApiError.conflict('The consultation changed while saving. Reload its saved record before continuing.');
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

/** Explicit PHN hand-off to one RHU Consultation facility after initial review. */
export const routeSubmissionToConsultation = async ({ id, facilityId = null, user, repo = repository, supabase = getServiceClient() }) => {
  if (!isPHN(user)) throw ApiError.forbidden('Only a PHN may route an encounter to RHU Consultation.');
  if (!user.municipalityId) throw ApiError.forbidden('Your account has no municipality assignment.');
  const submission = await repo.getVisit(id);
  if (!submission) throw ApiError.notFound('Submission not found');
  assertSubmissionScope(user, submission);
  if (submission.status !== SUBMISSION_STATUS.IN_REVIEW) {
    throw ApiError.conflict('Review the triage submission before routing it to RHU Consultation.');
  }
  if (submission.consultationStartedAt) throw ApiError.conflict('RHU Consultation has already started this encounter.');

  let facilitiesQuery = supabase.from('facilities')
    .select('id, municipality_id, name, type')
    .eq('municipality_id', user.municipalityId)
    .eq('type', 'rhu')
    .order('name', { ascending: true });
  if (facilityId) facilitiesQuery = facilitiesQuery.eq('id', facilityId);
  const { data: facilities, error } = await facilitiesQuery;
  if (error) throw new ApiError(503, 'RHU Consultation destinations are unavailable.');
  if (!Array.isArray(facilities) || facilities.length === 0) {
    throw ApiError.unprocessable('Select an RHU facility in your municipality.');
  }
  if (!facilityId && facilities.length !== 1) {
    throw ApiError.unprocessable('Choose the RHU Consultation facility for this encounter.');
  }
  const destination = facilityId ? facilities[0] : facilities[0];
  const now = new Date().toISOString();
  const routed = await repo.updateVisit(id, {
    consultationRoutedAt: now,
    consultationRoutedBy: user.id,
    consultationRoutedFacilityId: destination.id,
    consultationStartedAt: null,
    consultationStartedBy: null,
  }, { expectedUpdatedAt: submission.updatedAt, allowedStatuses: [SUBMISSION_STATUS.IN_REVIEW] });
  return { ...routed, consultationRoutedFacilityName: destination.name };
};

export const listConsultationFacilities = async ({ user, supabase = getServiceClient() }) => {
  if (!isPHN(user)) throw ApiError.forbidden('Only a PHN may choose an RHU Consultation destination.');
  if (!user.municipalityId) throw ApiError.forbidden('Your account has no municipality assignment.');
  const { data, error } = await supabase.from('facilities')
    .select('id, name, municipality_id, type')
    .eq('municipality_id', user.municipalityId)
    .eq('type', 'rhu')
    .order('name', { ascending: true });
  if (error) throw new ApiError(503, 'RHU Consultation destinations are unavailable.');
  return (data || []).filter((facility) => facility.municipality_id === user.municipalityId && facility.type === 'rhu')
    .map(({ id, name }) => ({ id, name }));
};

export const markInReview = async ({ id, user }) => {
  assertCanProcessConsultation(user);
  const submission = await repository.getVisit(id);
  if (!submission) throw ApiError.notFound('Submission not found');
  assertSubmissionScope(user, submission);
  assertRoutedConsultationOwnership(user, submission);
  if (requiresAssignedConsultationRoute(user)) {
    if (isDirectRhuTriageSubmission(user, submission)) {
      if (submission.consultationStartedAt) return submission;
      if (![SUBMISSION_STATUS.SUBMITTED, SUBMISSION_STATUS.RECEIVED, SUBMISSION_STATUS.IN_REVIEW].includes(submission.status)) {
        throw ApiError.conflict(`Cannot start consultation for a ${submission.status} submission.`);
      }
      const now = new Date().toISOString();
      const directUpdate = {
        status: SUBMISSION_STATUS.IN_REVIEW,
        receivedAt: submission.receivedAt || now,
        reviewedAt: submission.reviewedAt || now,
        consultationStartedAt: now,
        consultationStartedBy: user.id,
      };
      const started = await repository.updateVisit(id, directUpdate, {
        expectedUpdatedAt: submission.updatedAt,
        allowedStatuses: [SUBMISSION_STATUS.SUBMITTED, SUBMISSION_STATUS.RECEIVED, SUBMISSION_STATUS.IN_REVIEW],
      });
      if (!started) throw ApiError.conflict('This triage submission changed while consultation was starting. Reload the queue and try again.');
      return started;
    }
    if (submission.consultationRoutedFacilityId !== user.facilityId) throw ApiError.notFound('Submission not found');
    if (submission.consultationStartedAt) return submission;
    return repository.updateVisit(id, {
      consultationStartedAt: new Date().toISOString(),
      consultationStartedBy: user.id,
    }, { expectedUpdatedAt: submission.updatedAt, allowedStatuses: [SUBMISSION_STATUS.IN_REVIEW] });
  }
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

export const completeSubmission = async ({ id, user, patch, repo = repository, supabase }) => {
  if (patch !== undefined) {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw ApiError.badRequest('Enter consultation details in their separate fields.');
    return updateSubmissionForPhn({ id, patch, user, repo, supabase, complete: true });
  }
  assertCanProcessConsultation(user);
  const submission = await repo.getVisit(id);
  if (!submission) throw ApiError.notFound('Submission not found');
  assertSubmissionScope(user, submission);
  assertRoutedConsultationOwnership(user, submission);
  if (submission.status === SUBMISSION_STATUS.COMPLETED) return submission;
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

  const updated = await updateSubmissionForPhn({ id, patch: {}, user, repo, supabase, complete: true });

  // If this RHU encounter is linked to a barangay referral, mark it completed
  // from the referral side so the Health Supervisor sees the unified stage advance.
  if (updated.referralId && repo.driver !== 'supabase') {
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
