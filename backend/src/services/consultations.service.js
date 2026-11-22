import { isDeepStrictEqual } from 'node:util';
import ApiError from '../utils/apiError.js';
import repository from '../repositories/index.js';
import { assignedBarangay } from '../config/scope.js';
import { getServiceClient } from '../config/supabase.js';
import * as operational from './operational.service.js';
import { persistResidentRisk } from './residentRisk.service.js';
import { notifyResidentOnce } from './notifications.service.js';
import { computeBMI } from '../utils/bmi.js';
import { normalizeMedications } from './medicines.service.js';
import { classifyWithConfig } from './bpConfig.service.js';
import { classifyBloodPressure as classifyBpWithThresholds, parseBloodPressure } from '../config/bpThresholds.js';
import { requestFingerprint } from '../middleware/idempotency.js';
import {
  buildEncounterAssessment, encounterBloodPressureContext, validateClinicalIndicators,
  loadEncounterClinicalContext, reconcileConsultationClinicalContext, resolveConsultationMaternal,
  validateConsultationClinicalContext, validateConsultationRiskReview, canReviewConsultationRisk,
} from './clinicalAssessment.service.js';
import {
  calculateConsultationBmi, consultationAssessmentReasons, consultationNumber, consultationVitalValues,
  getManilaDateTime, isConsultationDate, normalizeConsultationClinicalText,
  PRESCRIPTION_ROUTES, PRESCRIPTION_FREQUENCIES, savedConsultationAssessment,
  validateConsultationDateTime, validateConsultationVitals, validateConsultationMedications,
} from '../../../shared/consultationClinical.js';

/**
 * KALUSAGAP — Clinical Consultations Service (`consultations.service.js`).
 *
 * Architectural layer:
 *   `consultations.routes -> authenticate -> authorize / idempotency -> consultations.controller -> consultations.service -> repository / Supabase`
 *
 * Responsibilities:
 *   - Manages clinical consultation records stored in the canonical `visits`
 *     repository/table, hydrating attending personnel and facility details from
 *     Supabase `profiles` and `facilities`.
 *   - Enforces strict role-based and geographic scope rules: staff mutations are
 *     restricted to `health_supervisor` (assigned barangay) and `phn` (assigned
 *     municipality), while `resident` callers may only read consultations tied
 *     to their authenticated `auth_user_id`.
 *   - Restricts consultation creation to verified residents (individually
 *     `approved` or members of a `Verified` household) and validates selected
 *     `health_services` / `health_service_assignments` entries against caller scope.
 *   - Validates plausible clinical vitals ranges, computes BMI (`computeBMI`),
 *     and snapshots blood-pressure classifications (`bpConfig.service` /
 *     `bpThresholds`) and structured prescriptions (`medicines.service`) so
 *     later catalog or threshold changes never alter historical clinical records.
 *   - Guarantees idempotent, crash-safe consultation creation via client
 *     operation UUIDs (`clientOperationKey`), payload fingerprinting, and
 *     row-locked side-effect completion (`completeConsultationOperation`).
 *   - Coordinates post-save side effects: canonical `follow_ups` reconciliation
 *     (awaiting resident confirmation), authoritative resident risk recomputation
 *     (`persistResidentRisk`), and privacy-safe resident notifications.
 */

const STAFF_ROLES = new Set(['health_supervisor', 'phn']);
const text = (value) => String(value ?? '').trim();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const serviceClientFor = (repo = repository) => repo.driver === 'file' ? null : getServiceClient();
const dateOnly = isConsultationDate;

/** Consultation statuses the list endpoint can filter by (visits workflow). */
export const CONSULTATION_STATUSES = Object.freeze([
  'draft',
  'submitted',
  'received',
  'in_review',
  'referred',
  'completed',
]);

/** Validate + normalize the consultation list filter parameters. */
export const parseListFilters = ({ from, to, serviceId, residentId, status } = {}) => {
  const dateIsDateOnly = isConsultationDate;
  const filters = {};
  const errors = [];
  if (residentId !== undefined && residentId !== null && residentId !== '') {
    if (typeof residentId !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(residentId.trim())) {
      errors.push('The selected resident is not valid.');
    } else filters.residentId = residentId.trim();
  }
  if (from !== undefined && from !== null && String(from).trim() !== '') {
    if (!dateIsDateOnly(from)) errors.push('The start date must be a valid date (YYYY-MM-DD).');
    else filters.from = String(from).trim();
  }
  if (to !== undefined && to !== null && String(to).trim() !== '') {
    if (!dateIsDateOnly(to)) errors.push('The end date must be a valid date (YYYY-MM-DD).');
    else filters.to = String(to).trim();
  }
  if (filters.from && filters.to && filters.from > filters.to) {
    errors.push('The end date cannot be before the start date.');
  }
  if (serviceId !== undefined && serviceId !== null && String(serviceId).trim() !== '') {
    const id = String(serviceId).trim();
    // health_services.id is a uuid; an invalid id can never match a row, so
    // reject it before the query instead of silently returning everything.
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      errors.push('The selected health service is not valid.');
    } else {
      filters.serviceId = id;
    }
  }
  if (status !== undefined && status !== null && String(status).trim() !== '') {
    const match = CONSULTATION_STATUSES.find((s) => s === String(status).trim().toLowerCase());
    if (!match) errors.push('The selected consultation status is not valid.');
    else filters.statuses = [match];
  }
  return { filters, errors };
};

/** Interpret the various truthy encodings the "Referral Required" field uses. */
const referralIsRequired = (payload = {}) => {
  const raw = String(payload.referralRequired ?? '').trim().toLowerCase();
  return payload.referralRequired === true || raw === 'yes' || raw === 'true';
};

/**
 * Server-side consultation vitals validation (issue #14).
 *
 * HTML input constraints are not security; a direct API call can send negative,
 * absurd or malformed values. Every vital is OPTIONAL, but when present it must
 * be a plausible clinical value. This is data-integrity validation, not medical
 * diagnosis. Pure + exported for unit testing; returns a list of error strings.
 */
const present = (value) => value !== undefined && value !== null && String(value).trim() !== '';

/**
 * Derive the human-readable blood pressure category label for a `"SYS/DIA"` reading
 * using the shared reference classifier (`config/bpThresholds.js`), or `null` when
 * the reading is absent or unparseable.
 *
 * @param {string} bloodPressure - Raw `"systolic/diastolic"` string (e.g. `"120/80"`).
 * @returns {string|null} Category label or `null`.
 */
export const classifyBloodPressure = (bloodPressure) => {
  // Retain the legacy label-only API using the shared reference classifier.
  const result = classifyBpWithThresholds(bloodPressure);
  return result ? result.label : null;
};

/**
 * Validate optional clinical vitals fields against physiologically plausible
 * data-integrity bounds, returning a field-keyed map of validation messages.
 *
 * @param {Object} [payload] - Consultation request payload containing vital sign fields.
 * @returns {Object} Map of `{ [fieldName]: errorMessage }` for any out-of-range or malformed vital.
 */
const validateVitalsByField = (payload = {}, options = { required: false }) => validateConsultationVitals(payload, options);

/**
 * Validate optional clinical vitals and return a flat list of human-readable error strings.
 *
 * @param {Object} [payload] - Consultation request payload.
 * @returns {Array<string>} Validation error messages (empty when all provided vitals are valid).
 */
export const validateVitals = (payload = {}) => Object.values(validateVitalsByField(payload));

/**
 * Follow-up date consistency for a consultation (issue #15).
 *   - follow_up_required = true  -> a valid next_visit_date is required;
 *   - follow_up_required = false -> next_visit_date must be empty;
 *   - a next visit date must be a valid date on/after the consultation date.
 * Returns { errors, normalized } where normalized carries a cleaned nextVisitDate.
 */
export const validateFollowUp = (payload = {}) => {
  const errors = [];
  const raw = String(payload.followUpRequired ?? '').trim().toLowerCase();
  const required = raw === 'yes' || raw === 'true' || payload.followUpRequired === true;
  const explicitlyNotRequired = raw === 'no' || raw === 'false' || payload.followUpRequired === false;
  const nextVisit = text(payload.nextVisitDate);

  if (nextVisit) {
    if (!dateOnly(nextVisit)) {
      errors.push('Next visit date is invalid.');
    } else if (present(payload.consultationDate) && !Number.isNaN(Date.parse(text(payload.consultationDate)))) {
      if (nextVisit < text(payload.consultationDate)) {
        errors.push('Next visit date cannot be before the consultation date.');
      }
    }
  }
  if (required && !nextVisit) {
    errors.push('A next visit date is required when a follow-up is required.');
  }
  // Contradiction: follow-up explicitly not required but a next visit date given.
  const normalized = { nextVisitDate: explicitlyNotRequired ? '' : nextVisit };
  return { errors, normalized };
};

/**
 * Ensure the authenticated caller holds a clinical consultation staff role
 * (`health_supervisor` or `phn`); throws `403 Forbidden` otherwise.
 *
 * @param {Object} user - Authenticated user context (`req.user`).
 */
const assertStaff = (user) => {
  if (!STAFF_ROLES.has(user?.role)) throw ApiError.forbidden('You are not authorized to manage consultations.');
};

const assertHistoryScope = (user) => {
  assertStaff(user);
  if (!user.municipalityId || (user.role === 'health_supervisor' && !user.barangayId && !assignedBarangay(user))) {
    throw ApiError.forbidden('Your account has no assigned consultation history scope.');
  }
};

/**
 * Verify that the target resident exists and falls within the staff caller's
 * assigned barangay and/or municipality coverage area.
 *
 * Throws `404 Not Found` (rather than `403`) for out-of-scope records so callers
 * cannot enumerate resident IDs belonging to other barangays or municipalities.
 *
 * @param {Object} user - Authenticated staff user context.
 * @param {Object|null} resident - Target resident record.
 */
const assertResidentScope = (user, resident) => {
  if (!resident) throw ApiError.notFound('Resident record not found.');
  const barangay = assignedBarangay(user);
  if (barangay && text(resident.barangay).toLowerCase() !== text(barangay).toLowerCase()) {
    throw ApiError.notFound('Resident record not found.');
  }
  if (user.role === 'health_supervisor' && user.barangayId && resident.barangayId
    && user.barangayId !== resident.barangayId) {
    throw ApiError.notFound('Resident record not found.');
  }
  if (user.municipalityId && resident.municipalityId && user.municipalityId !== resident.municipalityId) {
    throw ApiError.notFound('Resident record not found.');
  }
};

/**
 * Consultation eligibility (verified residents only).
 *
 * A consultation may only be recorded for a resident who is verified under the
 * existing status model — i.e. individually `approved`
 * (residents.verification_status), OR a linked member of a `Verified` household
 * in the same scope. This mirrors EXACTLY the "verified directory" the resident
 * selector is populated from (residents.service.listResidents verifiedOnly), so
 * the UI list and the server submission enforce the same rule. Pending,
 * rejected, resubmission_required and otherwise unverified residents are
 * excluded. Barangay/municipality scope is enforced separately by
 * `assertResidentScope` and is NOT weakened here.
 */
const CONSULTATION_ELIGIBLE_STATUSES = new Set(['approved']);

export const isResidentConsultationEligible = async (resident, repo = repository) => {
  if (!resident) return false;
  if (CONSULTATION_ELIGIBLE_STATUSES.has(text(resident.verificationStatus).toLowerCase())) {
    return true;
  }
  // Household-verified members qualify too (no second verification system).
  if (typeof repo.verifiedHouseholdResidentIds === 'function') {
    try {
      const ids = await repo.verifiedHouseholdResidentIds({
        barangay: resident.barangay || null,
        municipalityId: resident.municipalityId || null,
      });
      if (Array.isArray(ids) && ids.includes(resident.id)) return true;
    } catch {
      // A lookup failure must never silently ALLOW an unverified resident; fall
      // through to not-eligible so the stricter outcome wins.
    }
  }
  return false;
};

/**
 * Enforce that a resident is verified (individually `approved` or linked to a
 * `Verified` household) before allowing a consultation to be recorded; throws
 * `422 Unprocessable Entity` with a `residentId` field error otherwise.
 *
 * @param {Object} resident - Target resident record.
 * @param {Object} [repo] - Repository instance for household verification lookup.
 * @returns {Promise<void>}
 */
const assertResidentEligibleForConsultation = async (resident, repo = repository) => {
  const eligible = await isResidentConsultationEligible(resident, repo);
  if (!eligible) {
    throw ApiError.unprocessable(
      'This resident is not verified yet. Only approved or verified residents can receive a consultation.',
      { residentId: 'Select a verified resident. Pending or unverified residents are not eligible for a consultation.' },
    );
  }
};

/**
 * Resolve + validate the health service selected on a consultation.
 *
 * The selector is populated from real public.health_services records; the
 * backend re-validates the id against the database on every save (a direct API
 * call cannot link an invented service). Rules:
 *   - empty / absent -> null (a general consultation without a service);
 *   - unknown id     -> 422 with a field error;
 *   - inactive service on a NEW consultation -> 422 ("no longer offered");
 *   - inactive service on an EDIT    -> allowed, so an existing association is
 *     preserved rather than forced to be cleared;
 *   - the service must be in the caller's scope (same municipality; barangay
 *     services also visible to the assigned barangay or assignee).
 *
 * Returns { id, name } for persistence (name snapshot keeps historical
 * consultations correct if the catalog entry is renamed later).
 */
export const resolveConsultationService = async ({
  user,
  serviceId,
  existingServiceId = null,
  supabase = getServiceClient(),
}) => {
  const id = text(serviceId);
  if (!id) return { id: null, name: '' };
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
  if (!isUuid) {
    throw ApiError.unprocessable('Please correct the consultation fields shown below.', {
      serviceId: 'The selected health service is not valid.',
    });
  }
  const { data: service, error } = await supabase
    .from('health_services')
    .select('id, name, category, active, municipality_id, barangay_id')
    .eq('id', id)
    .maybeSingle();
  if (error) {
    throw new ApiError(502, `Could not verify the selected health service: ${error.message}`);
  }
  if (!service) {
    throw ApiError.unprocessable('Please correct the consultation fields shown below.', {
      serviceId: 'The selected health service no longer exists. Remove the selection and try again.',
    });
  }
  // Scope: the service must be visible to the caller (same municipality, and a
  // barangay service additionally in their barangay / assigned to them).
  if (user?.role !== 'admin') {
    if (service.municipality_id && user?.municipalityId && service.municipality_id !== user.municipalityId) {
      throw ApiError.unprocessable('Please correct the consultation fields shown below.', {
        serviceId: 'The selected health service is outside your assigned area.',
      });
    }
    if (service.barangay_id && user?.barangayId && service.barangay_id !== user.barangayId) {
      // Assigned personnel keep access to their assigned service regardless of
      // barangay scope (mirrors healthServices.serviceVisibleTo).
      const { data: assignment, error: assignmentError } = await supabase
        .from('health_service_assignments')
        .select('id')
        .eq('service_id', service.id)
        .eq('personnel_id', user.id)
        .eq('active', true)
        .maybeSingle();
      if (assignmentError) {
        throw new ApiError(502, 'Could not verify health service assignment.');
      }
      if (!assignment) {
        throw ApiError.unprocessable('Please correct the consultation fields shown below.', {
          serviceId: 'The selected health service is outside your assigned area.',
        });
      }
    }
  }
  // An inactive service cannot be newly selected, but an existing association
  // on the same consultation is preserved (historical validity).
  if (service.active === false && id !== text(existingServiceId)) {
    throw ApiError.unprocessable('Please correct the consultation fields shown below.', {
      serviceId: `"${service.name}" is no longer offered. Select an active health service.`,
    });
  }
  return { id: service.id, name: service.name || '', category: service.category || '' };
};

const CLINICAL_TEXT_FIELDS = [
  'consultationDate', 'consultationTime', 'chiefComplaint', 'findings', 'diagnosis',
  'treatmentGiven', 'medicationPrescribed', 'adviceGiven', 'remarks', 'nextVisitDate',
];

/**
 * Normalize the clinical findings and diagnosis fields.
 * Supports both new merged format (clinicalFindingsDiagnosis) and legacy separate fields.
 * Returns an object with normalized findings and diagnosis.
 */
const normalizeClinicalFindings = normalizeConsultationClinicalText;

const SERVER_DETAIL_KEYS = new Set([
  'clinicalAssessment', 'clinical_assessment', 'clinicalAssessmentHistory', 'riskAssessment', 'risk_assessment',
  'riskLevel', 'risk_level', 'riskScore', 'risk_score', 'riskReview', 'riskReviewHistory',
  'consultationRiskAssessment', 'consultationRiskAssessmentHistory', 'clinicalContext', 'maternal',
  'healthServiceCategory', 'clinicalIntegrityVersion', 'reportingScope',
]);
const clientClinicalDetails = (details = {}) => Object.fromEntries(Object.entries(details || {}).filter(([key]) => !SERVER_DETAIL_KEYS.has(key)));

/** New/changed prescriptions are strict; untouched shipped rows remain byte-for-byte snapshots. */
export const resolveConsultationMedications = async ({ medications = [], previous = [], repo = repository } = {}) => {
  if (!Array.isArray(medications) || medications.length > 50) {
    throw ApiError.unprocessable('Please correct the prescription entries.', { medications: 'Use a list of up to 50 prescriptions.' });
  }
  const fieldErrors = validateConsultationMedications(medications, { previous });
  if (Object.keys(fieldErrors).length) throw ApiError.unprocessable('Please correct the prescription entries.', fieldErrors);
  const errors = {};
  const used = new Set();
  const fields = ['genericName', 'brandName', 'strength', 'dosageForm', 'dose', 'route', 'frequency', 'duration', 'quantity', 'instructions', 'medicineId'];
  const comparable = (row) => Object.fromEntries(fields.map((field) => [field, row?.[field] ?? (field === 'medicineId' ? null : '')]));
  const output = [];
  for (const [index, raw] of medications.entries()) {
    const prefix = `medications[${index}]`;
    const oldIndex = previous.findIndex((row, position) => !used.has(position) && (isDeepStrictEqual(raw, row)
      || isDeepStrictEqual(comparable(raw), comparable(row))));
    if (oldIndex >= 0) { used.add(oldIndex); output.push(structuredClone(previous[oldIndex])); continue; }
    let entry;
    try { [entry] = normalizeMedications([raw]); }
    catch (error) {
      if (error.statusCode !== 422) throw error;
      for (const [field, message] of Object.entries(error.details || {})) errors[field.replace('medications[0]', prefix)] = message;
      continue;
    }
    for (const field of ['dose', 'route', 'frequency', 'duration', 'quantity']) if (!text(entry[field])) errors[`${prefix}.${field}`] = 'This prescription field is required.';
    if (!PRESCRIPTION_ROUTES.some(({ value }) => value === text(entry.route))) errors[`${prefix}.route`] = 'Choose a predefined prescription route.';
    if (!PRESCRIPTION_FREQUENCIES.some(({ value }) => value === text(entry.frequency))) errors[`${prefix}.frequency`] = 'Choose a predefined prescription frequency.';
    if (!/^[1-9]\d{0,4}$/.test(text(entry.quantity)) || Number(entry.quantity) > 10000) errors[`${prefix}.quantity`] = 'Quantity must be a whole number from 1 to 10000.';
    if (raw.custom !== undefined && raw.custom !== !entry.medicineId) errors[`${prefix}.custom`] = 'Custom/catalog choice must agree with the selected medicine.';
    if (entry.medicineId) {
      if (!UUID.test(entry.medicineId)) errors[`${prefix}.medicineId`] = 'Select a valid catalog medicine.';
      else {
        let medicine;
        try {
          if (!repo.getMedicine) throw new Error('Catalog unavailable');
          medicine = await repo.getMedicine(entry.medicineId);
        } catch { throw new ApiError(503, 'The medicine catalog could not be verified. Retry without changing the prescription.'); }
        if (!medicine || medicine.active === false) errors[`${prefix}.medicineId`] = 'Select an active catalog medicine or explicitly enter a custom medicine.';
        else Object.assign(entry, Object.fromEntries(['genericName', 'brandName', 'strength', 'dosageForm', 'source'].map((field) => [field, medicine[field] || (field === 'source' ? 'local' : '')])));
      }
    }
    output.push(entry);
  }
  if (Object.keys(errors).length) throw ApiError.unprocessable('Please correct the prescription entries.', errors);
  return output;
};

/**
 * Build the structured `consultationDetails` JSON snapshot from normalized
 * clinical text fields while preserving any existing extra keys in `payload.consultationDetails`.
 *
 * @param {Object} payload - Normalized consultation payload.
 * @returns {Object} Structured clinical details object persisted on the visit row.
 */
const clinicalDetails = (payload) => {
  const { findings, diagnosis } = normalizeClinicalFindings(payload);
  const bp = parseBloodPressure(payload.bloodPressure);
  return ({
    ...clientClinicalDetails(payload.consultationDetails),
    ...Object.fromEntries(CLINICAL_TEXT_FIELDS.map((field) => {
      if (field === 'findings') return [field, findings];
      if (field === 'diagnosis') return [field, diagnosis];
      return [field, text(payload[field])];
    })),
    followUpRequired: text(payload.nextVisitDate) ? 'Yes' : 'No',
    clinicalIndicators: validateClinicalIndicators(payload.clinicalIndicators !== undefined
      ? payload.clinicalIndicators : payload.consultationDetails?.clinicalIndicators),
    bloodPressureSystolic: bp?.systolic ?? null,
    bloodPressureDiastolic: bp?.diastolic ?? null,
  });
};

const numericVital = consultationNumber;
const VITAL_FIELDS = {
  bloodPressure: 'bp', temperature: 'temperature', pulseRate: 'hr', respiratoryRate: 'rr',
  height: 'heightCm', weight: 'weightKg', oxygenSaturation: 'o2sat',
};

const ENCOUNTER_RISK_LEVELS = new Map(Object.entries({
  low: 'Low', medium: 'Medium', moderate: 'Medium', high: 'High',
}));
const encounterRiskLevel = (assessment) => ENCOUNTER_RISK_LEVELS.get(
  String(assessment?.level ?? assessment?.riskLevel ?? assessment?.risk_level ?? '').trim().toLowerCase().replace(/\s+risk$/, ''),
) || 'Unassessed';
const savedEncounterAssessment = (details) => details.clinicalAssessment ?? details.clinical_assessment
  ?? details.riskAssessment ?? details.risk_assessment
  ?? (Array.isArray(details.clinicalAssessmentHistory) ? details.clinicalAssessmentHistory.at(-1) : null)
  ?? (details.riskLevel != null || details.risk_level != null ? { level: details.riskLevel ?? details.risk_level } : null);

const bpContext = (payload) => encounterBloodPressureContext({ chiefComplaint: payload.chiefComplaint,
  findings: payload.clinicalFindingsDiagnosis ?? [normalizeClinicalFindings(payload).findings,
    normalizeClinicalFindings(payload).diagnosis].filter(Boolean).join('\n'),
  clinicalIndicators: payload.clinicalIndicators !== undefined
    ? payload.clinicalIndicators : payload.consultationDetails?.clinicalIndicators });

/**
 * Transform a validated consultation payload into a `visits` repository write object.
 *
 * Combines legacy delimiter-formatted text columns (`findings`, `treatmentGiven`,
 * `recommendation`) with structured JSON columns (`consultationDetails`,
 * `medications`, `bpClassification`, `vitals`), computes BMI via `computeBMI`
 * (defaulting `bmiCategory` to `''` to satisfy the `NOT NULL` database constraint),
 * and formats `visitDate` in Philippine Standard Time (`+08:00`).
 *
 * @param {Object} [payload] - Validated consultation input payload.
 * @param {Object} user - Recording staff user context.
 * @param {string} residentId - Target resident UUID.
 * @param {Object} [extra] - Pre-resolved snapshots (`status`, `recordedAt`, `bpClassification`, `healthServiceId`, `healthServiceName`).
 * @returns {Object} Visit record ready for `insertVisit` or `updateVisit`.
 */
export const toVisit = (payload = {}, user, residentId, extra = {}) => {
  payload = { ...payload, ...Object.fromEntries(Object.entries(consultationVitalValues(payload)).filter(([, value]) => value !== undefined)) };
  const { findings, diagnosis } = normalizeClinicalFindings(payload);
  const bp = parseBloodPressure(payload.bloodPressure);
  const context = bpContext(payload);
  return ({
    residentId,
    recordedById: user.id,
    recordedByRole: user.role,
    recordedByName: user.name || user.email || '',
    // The consultation/visit STATUS is only 'completed' when a NEW visit is
    // created by the consultation staff. `update` passes `status: extra.status`
    // to preserve an existing draft/in_review/referred state instead of
    // clobbering it back to 'completed' (the prior bug forced every update to
    // 'completed').
    status: extra.status ?? 'completed',
    visitDate: payload.consultationDate
      ? `${payload.consultationDate}T${text(payload.consultationTime) || '00:00'}:00+08:00`
      : new Date().toISOString(),
    recordedAt: extra.recordedAt ?? payload.recordedAt ?? new Date().toISOString(),
    // Keep the individual form fields: clinical text can itself contain the
    // legacy Diagnosis/Medication/Next visit delimiters.
    consultationDetails: { ...clinicalDetails(payload), healthServiceCategory: extra.healthServiceCategory || '',
      ...(extra.clinicalIntegrityRequired ? { clinicalIntegrityVersion: 'consultation-clinical-v1' } : {}) },
    chiefComplaint: text(payload.chiefComplaint),
    clinicalHistory: text(payload.remarks),
    findings: [findings, diagnosis].filter(Boolean).join('\nDiagnosis: '),
    treatmentGiven: [text(payload.treatmentGiven), text(payload.medicationPrescribed)].filter(Boolean).join('\nMedication: '),
    recommendation: [text(payload.adviceGiven), payload.nextVisitDate ? `Next visit: ${payload.nextVisitDate}` : ''].filter(Boolean).join('\n'),
    // The health service provided during this consultation (FK + name snapshot,
    // validated by resolveConsultationService before the row is written).
    healthServiceId: extra.healthServiceId ?? null,
    healthServiceName: extra.healthServiceName ?? '',
    // Structured, non-lossy prescription storage (by value, so a later catalog
    // change never alters an already-recorded consultation).
    medications: extra.medications ?? normalizeMedications(payload.medications),
    // Previously-dropped field, now persisted.
    referralRequired: referralIsRequired(payload),
    // Blood-pressure classification SNAPSHOT recorded at the time of the
    // consultation. Preserved historically: a later threshold change does not
    // alter it (it is only recomputed when the consultation itself is saved).
    bpClassification: extra.bpClassification ?? classifyBpWithThresholds(payload.bloodPressure, context),
    vitals: {
      bp: bp ? `${bp.systolic}/${bp.diastolic}` : '',
      systolic: bp?.systolic ?? null,
      diastolic: bp?.diastolic ?? null,
      temperature: numericVital(payload.temperature),
      hr: numericVital(payload.pulseRate),
      rr: numericVital(payload.respiratoryRate),
      heightCm: numericVital(payload.height),
      weightKg: numericVital(payload.weight),
      o2sat: numericVital(payload.oxygenSaturation),
      ...(() => {
        const { category } = computeBMI(payload.height, payload.weight);
        // `visits.bmi_category` is NOT NULL (default ''), so a consultation saved
        // without both height and weight must store '' here, not null — otherwise
        // the insert fails with a NOT-NULL violation. `bmi` itself is nullable.
        return { bmi: calculateConsultationBmi(payload.height, payload.weight), bmiCategory: category || '' };
      })(),
    },
    phn: {
      assessment: diagnosis,
      notes: text(payload.remarks),
    },
  });
};

/**
 * Hydrate a raw `visits` repository row into an API-ready consultation DTO.
 *
 * Resolves the recording staff member's profile and facility name from Supabase
 * (`profiles` -> `facilities`), unpacks structured medications or legacy
 * `"\nMedication: "` / `"\nDiagnosis: "` delimiters for backwards compatibility,
 * and attaches historical or fallback blood-pressure classification metadata.
 *
 * @param {Object} visit - Raw visit record from the repository.
 * @param {Object|null} [supabase] - Supabase service client (null when using the file driver).
 * @returns {Promise<Object>} Hydrated consultation response object.
 */
export const fromVisit = async (visit, supabase = serviceClientFor()) => {
  const resident = visit.resident || {};
  const details = visit.consultationDetails || {};
  const findings = text(visit.findings);
  const diagnosisMarker = '\nDiagnosis: ';
  const [findingsText, diagnosis] = findings.includes(diagnosisMarker)
    ? [findings.slice(0, findings.indexOf(diagnosisMarker)), findings.slice(findings.indexOf(diagnosisMarker) + diagnosisMarker.length)]
    : [findings, visit.phn?.assessment || ''];
  const clinicalFindings = details.findings ?? findingsText;
  const clinicalDiagnosis = details.diagnosis ?? text(diagnosis);
  const nextVisitDate = details.nextVisitDate ?? (visit.recommendation?.match(/Next visit:\s*(\d{4}-\d{2}-\d{2})/)?.[1] || '');
  const followUpRequired = details.followUpRequired ?? (nextVisitDate ? 'Yes' : 'No');
  const clinicalAssessment = savedEncounterAssessment(details);
  const displayAssessment = savedConsultationAssessment(details);
  const localDateTime = visit.visitDate ? getManilaDateTime(visit.visitDate) : { date: '', time: '' };

  let attendingPersonnel = visit.recordedById || visit.recordedByName ? {
    id: visit.recordedById || null,
    fullName: visit.recordedByName || '',
    position: visit.recordedByRole || '',
  } : null;
  let facilityName = null;

  if (visit.recordedById && supabase) {
    try {
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('id, full_name, position, facility_id, facilities(name)')
        .eq('id', visit.recordedById)
        .maybeSingle();
      if (profileError) throw profileError;
      if (profile) {
        attendingPersonnel = {
          id: profile.id,
          fullName: visit.recordedByName || profile.full_name || '',
          position: profile.position || '',
        };
        facilityName = profile.facilities?.name || null;
      }
    } catch (error) {
      throw new ApiError(502, 'Could not load recording personnel.');
    }
  }

  // Treatment / medication separation. New records store medications in the
  // structured `medications` column; legacy records encoded a single medication
  // string after a "\nMedication: " marker inside treatment_given.
  const rawTreatment = text(visit.treatmentGiven);
  const medMarker = '\nMedication: ';
  const [treatmentText, legacyMedication] = rawTreatment.includes(medMarker)
    ? [rawTreatment.slice(0, rawTreatment.indexOf(medMarker)), rawTreatment.slice(rawTreatment.indexOf(medMarker) + medMarker.length)]
    : [rawTreatment, ''];

  const columnMedications = Array.isArray(visit.medications) ? visit.medications : [];
  const medications = columnMedications.length
    ? columnMedications
    : (text(legacyMedication)
      ? [{ genericName: text(legacyMedication), custom: true, source: 'custom' }]
      : []);
  const medicationPrescribed = medications.map((m) => [m.genericName, m.strength].filter(Boolean).join(' ')).filter(Boolean).join(', ');

  // Blood-pressure classification: use the snapshot recorded on the visit when
  // present (historical); for legacy rows without one, derive a display value
  // from the default reference thresholds. Never fabricates "Normal" for an
  // empty/invalid reading (the classifier returns null).
  const bloodPressureClassification = (visit.bpClassification && typeof visit.bpClassification === 'object')
    ? visit.bpClassification
    : classifyBpWithThresholds(visit.vitals?.bp, { chiefComplaint: visit.chiefComplaint,
      findings: visit.findings ?? details.findings });

  return {
    id: visit.id,
    resident: {
      id: resident.id || visit.residentId,
      name: [resident.firstName, resident.middleName, resident.lastName].filter(Boolean).join(' '),
      barangay: resident.barangay || '',
      barangayId: resident.barangayId || visit.barangay_id || '',
      zone: resident.zone ?? null,
      sex: resident.sex || '',
      contact: resident.cellphoneNo || '',
      age: resident.birthDate ? Math.max(0, new Date().getFullYear() - new Date(resident.birthDate).getFullYear()) : '',
      program: 'General',
    },
    consultationDate: details.consultationDate ?? localDateTime.date,
    consultationTime: details.consultationTime ?? localDateTime.time,
    // Health service provided (id + name snapshot recorded at save time, so a
    // later rename/deactivation in the catalog never changes history).
    serviceId: visit.healthServiceId || null,
    serviceName: visit.healthServiceName || visit.healthService?.name || '',
    healthServiceCategory: details.healthServiceCategory || visit.healthService?.category || '',
    chiefComplaint: visit.chiefComplaint || '',
    findings: clinicalFindings,
    diagnosis: clinicalDiagnosis,
    treatmentGiven: details.treatmentGiven ?? treatmentText,
    medicationPrescribed: details.medicationPrescribed || medicationPrescribed,
    medications,
    adviceGiven: details.adviceGiven ?? (visit.recommendation || ''),
    remarks: details.remarks ?? (visit.clinicalHistory || visit.phn?.notes || ''),
    followUpRequired,
    nextVisitDate,
    referralRequired: visit.referralRequired || visit.referralId || visit.referrals?.length ? 'Yes' : 'No',
    clinicalAssessment,
    consultationRiskAssessment: details.consultationRiskAssessment || null,
    clinicalContext: details.clinicalContext || null,
    maternal: details.maternal || null,
    riskLevel: encounterRiskLevel(displayAssessment),
    riskAssessmentStatus: displayAssessment?.status || 'unavailable',
    riskReasons: consultationAssessmentReasons(displayAssessment),
    bloodPressureClassification,
    vitals: {
      ...(visit.vitals || {}),
      systolic: parseBloodPressure(visit.vitals?.bp)?.systolic ?? null,
      diastolic: parseBloodPressure(visit.vitals?.bp)?.diastolic ?? null,
      bloodPressureCategory: bloodPressureClassification?.label ?? null,
    },
    status: visit.status,
    createdAt: visit.createdAt,
    updatedAt: visit.updatedAt,
    recordedAt: visit.recordedAt || visit.createdAt,
    clientOperationKey: visit.clientOperationKey || null,
    consultationEffectsCompletedAt: visit.consultationEffectsCompletedAt || null,
    consultationDetails: details,
    facilityName: facilityName,
    attendingPersonnel: attendingPersonnel,
    responsiblePersonnelId: visit.responsiblePersonnelId || null,
    responsiblePersonnelName: visit.responsiblePersonnelName || visit.phn?.personnel || '',
    consultingPersonnel: visit.phn?.personnel || visit.responsiblePersonnelName || visit.recordedByName || '',
    recordedById: visit.recordedById || null,
    recordedByName: visit.recordedByName || '',
    recordedByRole: visit.recordedByRole || '',
    assessment: visit.phn?.assessment || '',
    outcome: visit.status || '',
    completedAt: visit.completedAt || null,
    facilityId: visit.facilityId || null,
    referralId: visit.referralId || null,
    fromReferral: Boolean(visit.referralId),
    followUps: visit.followUps || [],
    referrals: visit.referrals || [],
  };
};

/** Attach only canonical records linked to both this encounter and its resident. */
export const withHistoryLinks = async (visits, repo = repository) => {
  if (!visits.length || !repo.listVisitHistoryLinks) return visits;
  const { followUps, referrals } = await repo.listVisitHistoryLinks(visits.map((visit) => visit.id),
    visits.map((visit) => visit.referralId).filter(Boolean));
  return visits.map((visit) => ({
    ...visit,
    followUps: followUps.filter((row) => row.consultation_id === visit.id && row.resident_id === visit.residentId)
      .map((row) => operational.withScheduleState(row)),
    referrals: referrals.filter((row) => (row.treatment_visit_id === visit.id || row.id === visit.referralId)
      && row.resident_id === visit.residentId),
  }));
};

const TERMINAL_FOLLOWUP = new Set(['Completed', 'Cancelled', 'Rejected']);

/** Purpose label a consultation follow-up is stored under (also the resident-facing "Reason"). */
const followUpPurpose = (payload = {}) =>
  `${text(payload.chiefComplaint) || text(payload.diagnosis) || 'Consultation'} follow-up`;

/**
 * Pure decision for how to reconcile a consultation's follow-up with any LIVE
 * (non-terminal) follow-up already recorded for this consultation. Exported for
 * unit testing.
 *
 *   wants + none                                 -> 'create'     (new, confirmed by default)
 *   wants + live, resident schedule active       -> 'reschedule' (keep the response and move the date)
 *   wants + live, resident change pending       -> 'await'      (do not overwrite the pending request)
 *   not wanted + live follow-up                  -> 'cancel'     (history preserved)
 *   otherwise                                    -> 'noop'
 */
export const planFollowUpSync = (existing, payload = {}) => {
  const wants = Boolean(text(payload.nextVisitDate));
  const live = existing && !TERMINAL_FOLLOWUP.has(text(existing.status));
  if (wants) {
    if (!live) return { action: 'create' };
    return ['Reschedule Requested', 'Cancellation Requested'].includes(text(existing.schedule_response_status))
      ? { action: 'await' }
      : { action: 'reschedule' };
  }
  if (live) return { action: 'cancel' };
  return { action: 'noop' };
};

/**
 * Keep exactly ONE follow-up in sync with a consultation's
 * "Follow-up Required / Next Visit Date".
 *
 * The follow-up is the SAME canonical `follow_ups` record the resident already
 * reads (My Follow-ups + Schedule Calendar) and staff manage — there is no
 * second follow-up system. It is owned by the SAME resident as the consultation
 * (resident_id = visit.residentId).
 *
 * Consultation follow-ups use the same default-confirmed schedule response as
 * all other follow-ups. Residents can still confirm explicitly or request a
 * staff-reviewed change through the schedule-request workflow.
 *
 * Edits resolve ONLY follow-ups linked to this visit, never another user's
 * unlinked follow-up with a similar purpose. A stable visit/date operation key
 * also prevents a concurrent create or retry from duplicating a follow-up.
 *
 * BEST-EFFORT: a follow-up bookkeeping failure is logged but never propagates,
 * so a clinical consultation save is never rejected because of the follow-up
 * step. (Injectable deps are for unit testing only.)
 */
export const syncConsultationFollowUp = async ({
  user,
  visit,
  payload,
  supabase = getServiceClient(),
  ops = operational,
}) => {
  if (!visit?.id || !visit?.residentId) return;
  try {
    const purpose = followUpPurpose(payload);
    const operationKey = `consultation-followup:${visit.id}:${text(payload.nextVisitDate)}`;
    const { data: rows, error } = await supabase
      .from('follow_ups')
      .select('id, status, resident_decision, schedule_response_status, consultation_id, client_operation_key, scheduled_date')
      .eq('resident_id', visit.residentId)
      .eq('consultation_id', visit.id)
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message || 'Could not look up the linked follow-up');
    const liveRows = (rows || []).filter((r) => !TERMINAL_FOLLOWUP.has(text(r.status)));
    const existing = liveRows[0] || null;
    if (!existing && (rows || []).some((r) => r.client_operation_key === operationKey
      || text(r.scheduled_date).slice(0, 10) === text(payload.nextVisitDate))) return;

    const { action } = planFollowUpSync(existing, payload);
    if (action === 'noop') return;

    if (action === 'await') return; // Preserve the resident's pending request for staff review.

    if (action === 'reschedule') {
      // Resident already confirmed — keep it confirmed, just move the date.
      await ops.update({
        user,
        kind: 'followups',
        id: existing.id,
        payload: { scheduled_date: text(payload.nextVisitDate), purpose, notes: text(payload.adviceGiven) },
        consultationId: visit.id,
      });
      return;
    }

    if (action === 'cancel') {
      await ops.update({ user, kind: 'followups', id: existing.id, payload: { status: 'Cancelled' } });
      return;
    }

    // action === 'create'
    await ops.create({
      user,
      kind: 'followups',
      idempotencyKey: operationKey,
      supabase,
      payload: {
        residentId: visit.residentId,
        consultation_id: visit.id,
        scheduled_date: text(payload.nextVisitDate),
        purpose,
        notes: text(payload.adviceGiven),
        assigned_provider: text(user.name) || text(user.email),
        requiresResidentResponse: false,
      },
    });
  } catch (err) {
    // Best-effort: never fail the consultation save because of the follow-up.
    // eslint-disable-next-line no-console
    console.error(`syncConsultationFollowUp: ${err?.message || err}`);
  }
};

/**
 * Notify the resident that a consultation record was saved for them.
 *
 * Runs ONLY after the consultation row is persisted, so a failed save can never
 * produce a success notification. Reuses the shared notification infrastructure
 * (`notifications.service.notifyResidentOnce`) rather than a competing system,
 * and is idempotent per consultation (keyed on the visit id) so retries,
 * repeated saves and refreshes do not create duplicates.
 *
 * The copy is deliberately non-clinical: it never includes the diagnosis,
 * findings, treatment or any other sensitive medical detail — only that a new
 * record is available and (safely) its date. Best-effort: a notification
 * failure never fails or rolls back the consultation save.
 */
const notifyResidentOfConsultation = async ({ resident = null, residentId = null, visit }) => {
  try {
    if (!visit?.id) return;
    let recipientAuthUserId = resident?.authUserId || null;
    const lookupId = residentId || visit.residentId || resident?.id || null;
    if (!recipientAuthUserId && lookupId) {
      const fetched = await repository.getResident(lookupId);
      recipientAuthUserId = fetched?.authUserId || null;
    }
    if (!recipientAuthUserId) return;

    const visitDate = text(visit.visitDate).slice(0, 10);
    const message = visitDate
      ? `A new consultation record from ${visitDate} is now available in My Health Records.`
      : 'A new consultation record is now available in My Health Records.';

    await notifyResidentOnce({
      recipientAuthUserId,
      category: 'information',
      title: 'New consultation record',
      message,
      relatedType: 'consultation',
      relatedId: String(visit.id),
    });
  } catch (err) {
    // Best-effort: never fail the consultation save because of the notification.
    // eslint-disable-next-line no-console
    console.error(`notifyResidentOfConsultation: ${err?.message || err}`);
  }
};

/**
 * List consultations with pagination, search, and date/service/status filters.
 *
 * - Resident callers (`role === 'resident'`): strictly scoped to the resident
 *   record linked to `user.id` (`auth_user_id`), ignoring any external resident filter.
 * - Staff callers (`health_supervisor`, `phn`): scoped by assigned municipality
 *   and barangay, with per-row `assertResidentScope` verification as defense in depth.
 *
 * @param {Object} params - Query parameters (`user`, `q`, `filters`, `limit`, `offset`, `repo`, `supabase`).
 * @returns {Promise<Object>} Paginated `{ rows, total }` consultation list.
 */
export const list = async ({ user, q = '', filters = {}, limit = 200, offset = 0,
  repo = repository, supabase = serviceClientFor(repo) }) => {
  const pageSize = Number(limit);
  const pageOffset = Number(offset);
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 500
    || !Number.isSafeInteger(pageOffset) || pageOffset < 0 || pageOffset > 1_000_000) {
    throw ApiError.unprocessable('Invalid consultation pagination.', { limit: 'Use a page size from 1 to 500 and a non-negative offset.' });
  }
  if (user?.role === 'resident') {
    const resident = await repo.getResidentByAuthUserId(user.id);
    if (!resident) return { rows: [], total: 0 };
    // The resident id comes from the authenticated session (auth user id ->
    // residents.auth_user_id), never from a request parameter, so a resident can
    // only ever list their OWN consultations no matter what ids they send.
    const result = await repo.listVisits({
      q: text(q),
      ...filters,
      statuses: filters.statuses || ['completed'],
      residentId: resident.id,
      orderBy: 'clinicalDate',
      limit: pageSize,
      offset: pageOffset,
    });
    const visits = await withHistoryLinks(result.rows, repo);
    return { rows: await Promise.all(visits.map((v) => fromVisit(v, supabase))), total: result.total };
  }

  assertHistoryScope(user);
  const result = await repo.listVisits({ q: text(q), ...filters, limit: pageSize, offset: pageOffset, orderBy: 'clinicalDate',
    statuses: filters.statuses || (filters.residentId ? ['completed'] : null),
    municipalityId: user.municipalityId,
    barangayId: user.role === 'health_supervisor' ? user.barangayId : null,
    barangay: assignedBarangay(user) });
  const filtered = [];
  for (const visit of result.rows) {
    try { assertResidentScope(user, visit.resident); filtered.push(visit); } catch {}
  }
  const visits = await withHistoryLinks(filtered, repo);
  return { rows: await Promise.all(visits.map((v) => fromVisit(v, supabase))),
    total: filtered.length === result.rows.length ? result.total : filtered.length };
};

/**
 * Retrieve a single consultation by visit ID, enforcing either resident
 * self-ownership (`resident.authUserId === user.id`) or staff geographic scope.
 *
 * @param {Object} params - Lookup parameters (`user`, `id`, `repo`, `supabase`).
 * @returns {Promise<Object>} Hydrated consultation DTO.
 */
export const get = async ({ user, id, repo = repository, supabase = serviceClientFor(repo) }) => {
  const isResidentSelf = user?.role === 'resident';
  if (!isResidentSelf) assertHistoryScope(user);
  const visit = await repo.getVisit(id);
  if (!visit) throw ApiError.notFound('Consultation not found.');
  if (isResidentSelf) {
    const resident = await repo.getResidentByAuthUserId(user.id);
    if (!resident || resident.id !== visit.residentId) throw ApiError.notFound('Consultation not found.');
  } else {
    assertResidentScope(user, visit.resident);
  }
  const [linkedVisit] = await withHistoryLinks([visit], repo);
  return fromVisit(linkedVisit, supabase);
};

/**
 * Validate required clinical consultation fields, date/time/ISO-timestamp formats,
 * vitals ranges, and follow-up date consistency for callers that supply follow-up fields.
 *
 * @param {Object} [payload] - Consultation submission payload.
 * @param {Object} [options] - Validation options (`requireResident`: require `residentId` on create).
 * @returns {Object} Field-keyed validation error map (empty when valid).
 */
export const consultationFieldErrors = (payload = {}, { requireResident = false, requireClinical = true } = {}) => {
  const errors = { ...validateVitalsByField(payload, { required: requireClinical }),
    ...validateConsultationDateTime(payload, { required: requireClinical }) };
  const required = (field, message) => {
    if (!text(payload[field])) errors[field] = message;
  };
  if (requireResident) required('residentId', 'Please select a resident.');
  if (present(payload.recordedAt) && (typeof payload.recordedAt !== 'string'
    || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(payload.recordedAt)
    || !dateOnly(payload.recordedAt.slice(0, 10))
    || !Number.isFinite(Date.parse(payload.recordedAt)))) {
    errors.recordedAt = 'The original recording timestamp is invalid.';
  }
  if (requireClinical) {
    required('chiefComplaint', 'Chief complaint is required.');
    if (!normalizeClinicalFindings(payload).findings) errors.findings = 'Clinical findings are required.';
  }
  for (const [field, label] of [
    ['treatmentGiven', 'Treatment provided'],
    ['adviceGiven', 'Recommendations'],
  ]) {
    if (payload[field] !== undefined && payload[field] !== null) {
      if (typeof payload[field] !== 'string') errors[field] = `Use text for ${label.toLowerCase()}.`;
      else if (payload[field].length > 10000) errors[field] = `Use 10,000 characters or fewer for ${label.toLowerCase()}.`;
    }
  }
  for (const field of CLINICAL_TEXT_FIELDS) if (payload[field] !== undefined && payload[field] !== null && typeof payload[field] !== 'string') {
    errors[field] = 'Use a text value.';
  }
  if (payload.clinicalFindingsDiagnosis !== undefined && payload.clinicalFindingsDiagnosis !== null && typeof payload.clinicalFindingsDiagnosis !== 'string') errors.findings = 'Use a text value for clinical findings.';
  if (payload.consultationDetails !== undefined && (!payload.consultationDetails
    || typeof payload.consultationDetails !== 'object' || Array.isArray(payload.consultationDetails))) {
    errors.consultationDetails = 'Additional clinical details must be a JSON object.';
  }
  const { errors: followUpErrors } = validateFollowUp(payload);
  if (followUpErrors.length) errors.nextVisitDate = followUpErrors.join(' ');
  return errors;
};

/** Scope/permission gates run before any maternal, NCD or encounter history query. */
export const getClinicalContext = async ({ user, residentId, consultationDate, repo = repository, supabase = serviceClientFor(repo) }) => {
  if (!STAFF_ROLES.has(user?.role) && !canReviewConsultationRisk(user)) assertStaff(user);
  if (!user?.municipalityId || (user.role === 'health_supervisor' && !user.barangayId && !assignedBarangay(user))) throw ApiError.forbidden('Your account has no assigned clinical context scope.');
  if (typeof residentId !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(residentId) || !dateOnly(consultationDate)) {
    throw ApiError.unprocessable('Please select a resident and valid consultation date.', {
      ...(!/^[a-zA-Z0-9_-]{1,100}$/.test(String(residentId ?? '')) ? { residentId: 'Select a valid resident.' } : {}),
      ...(!dateOnly(consultationDate) ? { consultationDate: 'Use a real calendar date (YYYY-MM-DD).' } : {}),
    });
  }
  const resident = await repo.getResident(residentId);
  assertResidentScope(user, resident);
  const context = await loadEncounterClinicalContext({ resident, residentId, user, consultationDate, repo, supabase });
  if (context.sourceStatus === 'unavailable') throw new ApiError(503, 'Clinical context could not be verified. No absence of pregnancy or conditions has been assumed.').withCode('CLINICAL_CONTEXT_UNAVAILABLE');
  const { episodes, currentAssessment, ...response } = context;
  return { ...response, canReviewRisk: canReviewConsultationRisk(user) };
};

/**
 * Resolve and validate the mandatory UUID operation key used for idempotent
 * consultation creation, ensuring header (`Idempotency-Key`) and body
 * (`clientOperationKey`) values do not conflict.
 *
 * @param {Object} [payload] - Consultation request payload.
 * @param {string|null} [idempotencyKey] - Optional `Idempotency-Key` header value.
 * @returns {string} Lowercase UUID operation key.
 */
export const consultationOperationKey = (payload = {}, idempotencyKey = null) => {
  const key = text(idempotencyKey || payload.clientOperationKey).toLowerCase();
  if (!UUID.test(key)) {
    throw ApiError.unprocessable('A stable consultation operation UUID is required.', {
      clientOperationKey: 'Retry with the original consultation operation UUID.',
    });
  }
  if (present(payload.clientOperationKey) && text(payload.clientOperationKey).toLowerCase() !== key) {
    throw ApiError.conflict('The consultation operation key does not match this request.');
  }
  return key;
};

/** Compute a deterministic fingerprint over the clinical payload (excluding `clientOperationKey`). */
const operationHash = (payload) => {
  const { clientOperationKey, ...clinical } = payload;
  return requestFingerprint({ method: 'POST', path: '/consultations', body: clinical });
};

/** Ensure a replayed operation key matches the original recording user, resident, and clinical payload hash. */
const assertOperationOwner = (visit, user, payload, hash) => {
  if (visit.recordedById !== user.id || visit.residentId !== payload.residentId
    || visit.clientOperationPayloadHash !== hash) {
    throw ApiError.conflict('This consultation operation belongs to a different author, resident, or clinical payload.');
  }
};

/** Re-check current scope/eligibility even when the HTTP ledger has a response. */
export const validateCreateReplay = async (req, body, { repo = repository, supabase = serviceClientFor(repo) } = {}) => {
  assertStaff(req.user);
  const payload = req.body?.consultation || req.body || {};
  const key = consultationOperationKey(payload, req.idempotencyKey);
  const visit = await repo.findVisitByOperationKey(key);
  if (!visit || visit.id !== body?.data?.consultation?.id) {
    throw ApiError.conflict('The consultation operation could not be confirmed. Retry the original operation.');
  }
  assertOperationOwner(visit, req.user, payload, operationHash(payload));
  const resident = await repo.getResident(visit.residentId);
  assertResidentScope(req.user, resident);
  await assertResidentEligibleForConsultation(resident, repo);
  await resolveConsultationService({ user: req.user, serviceId: payload.serviceId ?? payload.service_id,
    existingServiceId: visit.healthServiceId, supabase });
};

/**
 * Create a new clinical consultation record idempotently and execute post-save side effects.
 *
 * Workflow:
 *   1. Validates staff role, operation UUID/hash ownership, clinical fields,
 *      resident barangay/municipality scope, verified-resident eligibility, and
 *      selected `health_services` scope/active status.
 *   2. Inserts the `visits` row with BP/BMI/medication/service snapshots (recovering
 *      cleanly from PostgreSQL `23505` unique-key races on `clientOperationKey`, and
 *      blocking ambiguous legacy unkeyed offline drafts).
 *   3. Completes durable side effects via `repo.completeConsultationOperation` and
 *      recomputes authoritative resident risk (`persistResidentRisk`) before
 *      confirming `consultationEffectsCompletedAt`.
 *
 * @param {Object} params - Creation parameters (`user`, `payload`, `idempotencyKey`, `repo`, `supabase`, `classifyBp`, `persistRisk`).
 * @returns {Promise<Object>} Newly created (or replayed) hydrated consultation DTO.
 */
export const create = async ({ user, payload = {}, idempotencyKey = null, repo = repository,
  supabase = serviceClientFor(repo), classifyBp = classifyWithConfig, persistRisk = persistResidentRisk }) => {
  assertStaff(user);
  const key = consultationOperationKey(payload, idempotencyKey);
  const hash = operationHash(payload);
  // Resolve the durable operation before allocating a new visit. The original
  // recorder is immutable, including when another staff member edits the visit.
  let visit = await repo.findVisitByOperationKey(key);
  if (visit) assertOperationOwner(visit, user, payload, hash);
  const fieldErrors = consultationFieldErrors(payload, { requireResident: true, requireClinical: !visit });
  if (Object.keys(fieldErrors).length) {
    throw ApiError.unprocessable('Please correct the consultation fields shown below.', fieldErrors);
  }
  const resident = await repo.getResident(payload.residentId);
  assertResidentScope(user, resident);
  // Verified residents only: enforce eligibility on the submission endpoint so a
  // direct API call cannot record a consultation for a pending/unverified
  // resident even though the UI filters them out of the selector.
  await assertResidentEligibleForConsultation(resident, repo);
  const { errors: followUpErrors, normalized } = validateFollowUp(payload);
  if (followUpErrors.length) throw ApiError.unprocessable('Please correct the consultation fields shown below.', { nextVisitDate: followUpErrors.join(' ') });
  const cleanPayload = { ...payload, ...Object.fromEntries(Object.entries(consultationVitalValues(payload)).filter(([, value]) => value !== undefined)),
    nextVisitDate: normalized.nextVisitDate };
  // Validate the selected health service against the database (new consultation:
  // an inactive service is rejected; the association must be a real, in-scope
  // service row — never a free-text name).
  const healthService = await resolveConsultationService({
    user, serviceId: payload.serviceId ?? payload.service_id, existingServiceId: visit?.healthServiceId, supabase,
  });
  if (!visit) {
    const riskReview = validateConsultationRiskReview(payload.riskReview, user);
    validateConsultationClinicalContext(payload.clinicalContext);
    const medications = await resolveConsultationMedications({ medications: payload.medications, repo });
    const context = await loadEncounterClinicalContext({ resident, user, consultationDate: payload.consultationDate,
      consultationTime: payload.consultationTime, repo, supabase });
    // A keyless historical write cannot be correlated with an old response-loss
    // draft. Never guess a clinical match or silently create a second visit.
    if (payload.legacyDraftAdopted === true && await repo.hasUnkeyedVisitsForResident(resident.id)) {
      throw ApiError.conflict('This legacy draft cannot be safely distinguished from a pre-upgrade visit. Review existing records before recording another visit. Clinical information remains on this device.');
    }
    const ids = await repo.nextSubmissionId();
    const bpClassification = await classifyBp(cleanPayload.bloodPressure, { context: bpContext(cleanPayload) });
    const encounter = toVisit(cleanPayload, user, resident.id, {
      bpClassification, healthServiceId: healthService.id, healthServiceName: healthService.name,
      healthServiceCategory: healthService.category, medications, clinicalIntegrityRequired: true,
    });
    encounter.municipalityId = resident.municipalityId || null;
    encounter.barangayId = resident.barangayId || null;
    encounter.consultationDetails.reportingScope = { municipalityId: resident.municipalityId || null, barangayId: resident.barangayId || null };
    encounter.id = ids.id;
    encounter.consultationDetails.clinicalContext = reconcileConsultationClinicalContext({ context, submitted: payload.clinicalContext, user, riskReview });
    const maternal = resolveConsultationMaternal({ value: payload.maternal, context, clinicalContext: encounter.consultationDetails.clinicalContext,
      consultationDate: payload.consultationDate, healthService,
      clinicalText: [text(payload.chiefComplaint), normalizeClinicalFindings(payload).findings].filter(Boolean).join('\n') });
    if (maternal) encounter.consultationDetails.maternal = maternal;
    encounter.consultationDetails = await buildEncounterAssessment({ visit: encounter, resident, user, supabase, context, riskReview });
    try {
      visit = await repo.insertVisit({
        id: ids.id,
        ...encounter,
        clientOperationKey: key,
        clientOperationPayloadHash: hash,
      });
    } catch (error) {
      if ((error.code || error.details?.code) !== '23505') throw error;
      visit = await repo.findVisitByOperationKey(key);
      if (!visit) throw error;
      assertOperationOwner(visit, user, payload, hash);
    }
  }
  // The clinical row survives a failed side-effect transaction. A retry resumes
  // this step, under a database row lock, rather than inserting another visit or
  // silently treating a missing follow-up/notification as completed.
  await repo.completeConsultationOperation({ id: visit.id, creatorId: user.id });
  if (text(payload.followUpId)) {
    const { data: followUp, error: followUpError } = await supabase.from('follow_ups')
      .select('id,resident_id,status,consultation_id,linked_service_id').eq('id', text(payload.followUpId)).maybeSingle();
    if (followUpError) throw new Error(followUpError.message || 'Could not link the follow-up');
    if (!followUp || followUp.resident_id !== resident.id) throw ApiError.unprocessable('The selected follow-up does not belong to this resident.');
    if (followUp.linked_service_id && followUp.linked_service_id !== visit.id) throw ApiError.conflict('This follow-up is already linked to another healthcare record.');
    if (['Completed', 'Cancelled', 'Missed', 'Rejected'].includes(followUp.status) && followUp.linked_service_id !== visit.id) {
      throw ApiError.conflict('This follow-up is already closed.');
    }
    const { error: linkError } = await supabase.from('follow_ups').update({
      consultation_id: visit.id, linked_service_type: 'consultation', linked_service_id: visit.id,
      status: 'Completed', completed_at: new Date().toISOString(),
    }).eq('id', followUp.id).eq('resident_id', resident.id);
    if (linkError) throw new Error(linkError.message || 'Could not link the completed consultation to its follow-up');
  }
  // Recorded health data changed -> recompute + persist the resident's risk
  // (backend-authoritative; best-effort so a save is never blocked by it).
  await persistRisk({ residentId: resident.id, repo });
  const completed = await repo.getVisit(visit.id);
  if (!completed?.consultationEffectsCompletedAt) {
    throw new ApiError(503, 'The consultation completion could not be confirmed. Retry the original operation.');
  }
  const [linkedVisit] = await withHistoryLinks([completed], repo);
  return fromVisit(linkedVisit, supabase);
};

/**
 * Update an existing consultation record while preserving immutable audit and workflow fields.
 *
 * Prevents reassigning `residentId` or mutating `clientOperationKey`, blocks edits
 * while the initial create operation's side effects are still incomplete, preserves
 * the original `recordedBy*` attribution and visit workflow `status` (`draft`,
 * `in_review`, `referred`, etc.), and triggers follow-up reconciliation, resident
 * risk recomputation, and idempotent resident notification.
 *
 * @param {Object} params - Update parameters (`user`, `id`, `payload`, `repo`, `supabase`, `classifyBp`, `persistRisk`, `syncFollowUp`, `notify`).
 * @returns {Promise<Object>} Updated hydrated consultation DTO.
 */
export const update = async ({ user, id, payload = {}, repo = repository, supabase = serviceClientFor(repo),
  classifyBp = classifyWithConfig, persistRisk = persistResidentRisk,
  syncFollowUp = syncConsultationFollowUp, notify = notifyResidentOfConsultation, riskReviewOnly = false }) => {
  payload = { ...payload, ...Object.fromEntries(CLINICAL_TEXT_FIELDS.filter((field) => payload[field] === undefined
    && payload.consultationDetails?.[field] !== undefined).map((field) => [field, payload.consultationDetails[field]])) };
  if (riskReviewOnly) {
    if (!canReviewConsultationRisk(user) || !user.municipalityId) throw ApiError.forbidden('Only a scoped clinical professional may review risk.');
    if (Object.keys(payload).some((key) => key !== 'riskReview') || payload.riskReview === undefined) throw ApiError.unprocessable('This endpoint accepts only a confirmed riskReview.');
  } else if (!STAFF_ROLES.has(user?.role) && payload.riskReview !== undefined && canReviewConsultationRisk(user) && user.municipalityId) {
    // Licensed reassessment still requires route-level clinical update permission and resident scope.
  } else assertStaff(user);
  const visit = await repo.getVisit(id);
  if (!visit) throw ApiError.notFound('Consultation not found.');
  assertResidentScope(user, visit.resident);
  if (present(payload.residentId) && payload.residentId !== visit.residentId) {
    throw ApiError.conflict('A consultation cannot be reassigned to another resident.');
  }
  if (present(payload.clientOperationKey) && payload.clientOperationKey !== visit.clientOperationKey) {
    throw ApiError.conflict('A consultation operation key cannot be changed.');
  }
  if (visit.clientOperationKey && !visit.consultationEffectsCompletedAt) {
    throw ApiError.conflict('This consultation is still being completed. Retry its original create operation first.');
  }
  if (payload.expectedUpdatedAt && payload.expectedUpdatedAt !== visit.updatedAt) throw ApiError.conflict('This consultation changed after it was opened. Reload the saved record before editing.');
  if (riskReviewOnly && user.role === 'rhu_personnel' && visit.facilityId && visit.facilityId !== user.facilityId) throw ApiError.notFound('Consultation not found.');
  const existing = await fromVisit(visit, null);
  const previous = visit.consultationDetails || {};
  const submittedVitals = Object.fromEntries(Object.entries(consultationVitalValues(payload)).filter(([, value]) => value !== undefined));
  const clinicalText = normalizeClinicalFindings(payload);
  const cleanPayload = {
    ...Object.fromEntries(CLINICAL_TEXT_FIELDS.map((field) => [field, existing[field]])),
    ...Object.fromEntries(Object.entries(VITAL_FIELDS).map(([field, key]) => [field, existing.vitals[key]])),
    medications: existing.medications,
    ...payload,
    ...submittedVitals,
    ...(payload.clinicalFindingsDiagnosis !== undefined && payload.findings === undefined ? clinicalText : {}),
    clinicalIndicators: payload.clinicalIndicators ?? payload.consultationDetails?.clinicalIndicators ?? previous.clinicalIndicators ?? {},
    residentId: visit.residentId,
  };
  const clinicalChanged = ['chiefComplaint', 'findings', 'diagnosis', 'consultationDate', 'consultationTime', 'treatmentGiven', 'medicationPrescribed']
    .some((field) => text(cleanPayload[field]) !== text(existing[field]))
    || Object.keys(submittedVitals).some((field) => field !== 'bmi' && (field === 'bloodPressure'
      ? !isDeepStrictEqual(parseBloodPressure(submittedVitals[field]), parseBloodPressure(existing.vitals.bp))
      : String(submittedVitals[field] ?? '') !== String(existing.vitals[VITAL_FIELDS[field]] ?? '')))
    || !isDeepStrictEqual(cleanPayload.clinicalIndicators, previous.clinicalIndicators || {})
    || (payload.medications !== undefined && !isDeepStrictEqual(payload.medications, existing.medications))
    || (payload.clinicalContext !== undefined && !isDeepStrictEqual(payload.clinicalContext, previous.clinicalContext?.submitted))
    || (payload.maternal !== undefined && !isDeepStrictEqual(payload.maternal, previous.maternal)) || payload.riskReview !== undefined;
  const updatesFollowUp = payload.followUpRequired !== undefined || payload.nextVisitDate !== undefined;
  if (!updatesFollowUp) delete cleanPayload.nextVisitDate;
  else if (payload.nextVisitDate === undefined) cleanPayload.nextVisitDate = existing.nextVisitDate;
  const fieldErrors = consultationFieldErrors(clinicalChanged ? cleanPayload : payload, { requireClinical: clinicalChanged });
  if (Object.keys(fieldErrors).length) {
    throw ApiError.unprocessable('Please correct the consultation fields shown below.', fieldErrors);
  }
  cleanPayload.nextVisitDate = updatesFollowUp ? validateFollowUp(cleanPayload).normalized.nextVisitDate : existing.nextVisitDate;
  cleanPayload.referralRequired = payload.referralRequired ?? (visit.referralRequired ? 'Yes' : 'No');
  cleanPayload.consultationDetails = { ...clientClinicalDetails(previous), ...clientClinicalDetails(payload.consultationDetails) };
  // Validate the (possibly changed) health service. `existingServiceId` keeps an
  // association with a since-deactivated service valid when the editor leaves it
  // untouched, while a NEWLY selected inactive service is rejected.
  const healthService = clinicalChanged || payload.serviceId !== undefined || payload.service_id !== undefined ? await resolveConsultationService({
    user,
    serviceId: payload.serviceId ?? payload.service_id ?? visit.healthServiceId,
    existingServiceId: visit.healthServiceId,
    supabase,
  }) : { id: visit.healthServiceId || null, name: visit.healthServiceName || existing.serviceName,
    category: previous.healthServiceCategory || visit.healthService?.category || '' };
  const medications = clinicalChanged ? await resolveConsultationMedications({ medications: cleanPayload.medications, previous: existing.medications, repo }) : visit.medications || [];
  const encounter = toVisit(cleanPayload, user, visit.residentId, {
    healthServiceId: healthService.id,
    healthServiceName: healthService.id === visit.healthServiceId ? visit.healthServiceName || healthService.name : healthService.name,
    healthServiceCategory: healthService.category, medications,
    status: visit.status || 'completed', recordedAt: visit.recordedAt || visit.createdAt,
    clinicalIntegrityRequired: clinicalChanged,
  });
  encounter.id = visit.id;
  if (!updatesFollowUp) encounter.consultationDetails.followUpRequired = existing.followUpRequired;
  if (encounter.consultationDetails.consultationDate === existing.consultationDate
    && encounter.consultationDetails.consultationTime === existing.consultationTime) encounter.visitDate = visit.visitDate;
  if (clinicalChanged) {
    const riskReview = validateConsultationRiskReview(payload.riskReview, user);
    const submitted = payload.clinicalContext ?? previous.clinicalContext?.submitted;
    validateConsultationClinicalContext(submitted);
    const context = await loadEncounterClinicalContext({ resident: visit.resident, user,
      consultationDate: cleanPayload.consultationDate, consultationTime: cleanPayload.consultationTime, repo, supabase, excludeVisitId: visit.id });
    if (Object.hasOwn(previous, 'reportingScope')) encounter.consultationDetails.reportingScope = previous.reportingScope;
    encounter.consultationDetails.clinicalContext = reconcileConsultationClinicalContext({ context, submitted, user, previous, riskReview });
    const pregnancySourceChanged = text(cleanPayload.chiefComplaint) !== text(existing.chiefComplaint)
      || text(cleanPayload.findings) !== text(existing.findings);
    const maternal = payload.maternal === undefined && previous.maternal && cleanPayload.consultationDate === existing.consultationDate
      && healthService.id === visit.healthServiceId && !pregnancySourceChanged
      ? previous.maternal : resolveConsultationMaternal({ value: payload.maternal ?? previous.maternal, context,
      clinicalContext: encounter.consultationDetails.clinicalContext, consultationDate: cleanPayload.consultationDate, healthService,
      clinicalText: [text(cleanPayload.chiefComplaint), normalizeClinicalFindings(cleanPayload).findings].filter(Boolean).join('\n') });
    if (maternal) encounter.consultationDetails.maternal = maternal;
    encounter.bpClassification = await classifyBp(cleanPayload.bloodPressure, { context: bpContext(cleanPayload) });
    encounter.consultationDetails = await buildEncounterAssessment({ visit: encounter, resident: visit.resident, user, supabase, previous, context, riskReview });
  } else {
    // Historical partial encounters remain partial. Metadata edits never create measurements or reassess risk.
    encounter.consultationDetails = { ...previous, ...clientClinicalDetails(payload.consultationDetails),
      ...Object.fromEntries(CLINICAL_TEXT_FIELDS.filter((field) => payload[field] !== undefined).map((field) => [field, text(cleanPayload[field])])) };
    if (updatesFollowUp) Object.assign(encounter.consultationDetails, { nextVisitDate: cleanPayload.nextVisitDate,
      followUpRequired: cleanPayload.nextVisitDate ? 'Yes' : 'No' });
    if (payload.serviceId !== undefined || payload.service_id !== undefined) encounter.consultationDetails.healthServiceCategory = healthService.category || '';
    for (const field of ['vitals', 'bpClassification', 'findings', 'treatmentGiven', 'phn', 'visitDate', 'chiefComplaint']) {
      if (visit[field] === undefined) delete encounter[field]; else encounter[field] = visit[field];
    }
    encounter.medications = visit.medications;
  }
  // Preserve the existing visit status (draft / in_review / referred / etc.) —
  // only a NEW consultation defaults to 'completed'. This stops an update from
  // clobbering a status the workflow (e.g. intake) set on the row.
  const updated = await repo.updateVisit(id, {
    ...encounter,
    recordedById: visit.recordedById,
    recordedByRole: visit.recordedByRole,
    recordedByName: visit.recordedByName,
  }, { expectedUpdatedAt: visit.updatedAt });
  if (!updated) throw ApiError.conflict('This consultation changed while you were editing it. Reopen it and try again.');
  if (updatesFollowUp) await syncFollowUp({ user, visit: updated, payload: cleanPayload, supabase });
  // Recorded health data changed -> recompute + persist the resident's risk.
  await persistRisk({ residentId: visit.residentId, repo });
  // Only after the consultation is persisted. Idempotent per visit id, so
  // editing an existing consultation does not create a duplicate notification.
  await notify({ residentId: visit.residentId, visit: updated });
  const [linkedVisit] = await withHistoryLinks([updated], repo);
  return fromVisit(linkedVisit, supabase);
};

export const reviewRisk = (params) => update({ ...params, riskReviewOnly: true });

export default { list, get, getClinicalContext, create, update, reviewRisk };
