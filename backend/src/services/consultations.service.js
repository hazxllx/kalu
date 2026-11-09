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
import { classifyBloodPressure as classifyBpWithThresholds } from '../config/bpThresholds.js';
import { requestFingerprint } from '../middleware/idempotency.js';

const STAFF_ROLES = new Set(['health_supervisor', 'phn']);
const text = (value) => String(value ?? '').trim();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const serviceClientFor = (repo = repository) => repo.driver === 'file' ? null : getServiceClient();
const dateOnly = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(`${value}T00:00:00Z`))
  && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

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
export const parseListFilters = ({ from, to, serviceId, status } = {}) => {
  const dateIsDateOnly = (v) =>
    typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00`));
  const filters = {};
  const errors = [];
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
const inRange = (value, lo, hi) => {
  const n = Number(value);
  return Number.isFinite(n) && n >= lo && n <= hi;
};
const present = (value) => value !== undefined && value !== null && String(value).trim() !== '';

export const classifyBloodPressure = (bloodPressure) => {
  // Single source of truth: delegate to the authoritative, admin-configurable
  // classifier (config/bpThresholds.js) and return its human label (or null).
  // The previous hardcoded thresholds here diverged from the authoritative
  // table (wrong crisis/stage boundaries) and had NO hypotension band, so a
  // valid low reading like "85/55" was mislabelled "Normal". Delegating removes
  // that divergence while preserving the string shape of
  // `vitals.bloodPressureCategory`.
  const result = classifyBpWithThresholds(bloodPressure);
  return result ? result.label : null;
};

const validateVitalsByField = (payload = {}) => {
  const errors = {};
  const check = (field, label, lo, hi) => {
    if (!present(payload[field])) return;
    if (!inRange(payload[field], lo, hi)) errors[field] = `${label} must be between ${lo} and ${hi}.`;
  };
  // Body-temperature plausibility range for data integrity (NOT a diagnosis).
  // The previous hardcoded 30–45 °C floor wrongly rejected genuine, clinically
  // recorded severe-hypothermia readings (survival is documented below 20 °C).
  // Aligned with the app's clinically reviewed vital range already used at RHU
  // triage/intake (see intake.service.js: 25–46 °C) so the same reading is
  // accepted everywhere in °C.
  check('temperature', 'Temperature (°C)', 25, 46);
  check('pulseRate', 'Pulse rate (bpm)', 20, 250);
  check('respiratoryRate', 'Respiratory rate (breaths/min)', 5, 80);
  check('height', 'Height (cm)', 30, 250);
  check('weight', 'Weight (kg)', 1, 400);
  check('oxygenSaturation', 'Oxygen saturation (%)', 50, 100);

  if (present(payload.bloodPressure)) {
    const m = text(payload.bloodPressure).match(/^(\d{2,3})\s*\/\s*(\d{2,3})$/);
    if (!m) {
      errors.bloodPressure = 'Blood pressure must be in the form systolic/diastolic (e.g. 120/80).';
    } else {
      const sys = Number(m[1]);
      const dia = Number(m[2]);
      if (!inRange(sys, 40, 300)) errors.bloodPressure = 'Systolic blood pressure must be between 40 and 300.';
      else if (!inRange(dia, 40, 300)) errors.bloodPressure = 'Diastolic blood pressure must be between 40 and 300.';
      else if (sys <= dia) errors.bloodPressure = 'Systolic blood pressure must be greater than diastolic.';
    }
  }
  return errors;
};

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

const assertStaff = (user) => {
  if (!STAFF_ROLES.has(user?.role)) throw ApiError.forbidden('You are not authorized to manage consultations.');
};

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
    .select('id, name, active, municipality_id, barangay_id')
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
  return { id: service.id, name: service.name || '' };
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
const normalizeClinicalFindings = (payload = {}) => {
  // New merged field takes priority
  if (payload.clinicalFindingsDiagnosis) {
    const merged = text(payload.clinicalFindingsDiagnosis);
    // Try to split if diagnosis marker exists (for safety with mixed input)
    if (merged.includes('\n')) {
      const parts = merged.split('\n');
      return {
        findings: parts.slice(0, -1).join('\n'),
        diagnosis: parts[parts.length - 1],
      };
    }
    // No newline, treat entire content as findings with no separate diagnosis
    return {
      findings: merged,
      diagnosis: '',
    };
  }
  // Fallback to legacy separate fields
  return {
    findings: text(payload.findings || ''),
    diagnosis: text(payload.diagnosis || ''),
  };
};

const clinicalDetails = (payload) => {
  const { findings, diagnosis } = normalizeClinicalFindings(payload);
  return ({
    ...(payload.consultationDetails || {}),
    ...Object.fromEntries(CLINICAL_TEXT_FIELDS.map((field) => {
      if (field === 'findings') return [field, findings];
      if (field === 'diagnosis') return [field, diagnosis];
      return [field, text(payload[field])];
    })),
    followUpRequired: text(payload.nextVisitDate) ? 'Yes' : 'No',
  });
};

const numericVital = (value) => present(value) ? Number(value) : null;

export const toVisit = (payload = {}, user, residentId, extra = {}) => {
  const { findings, diagnosis } = normalizeClinicalFindings(payload);
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
    consultationDetails: clinicalDetails(payload),
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
    medications: normalizeMedications(payload.medications),
    // Previously-dropped field, now persisted.
    referralRequired: referralIsRequired(payload),
    // Blood-pressure classification SNAPSHOT recorded at the time of the
    // consultation. Preserved historically: a later threshold change does not
    // alter it (it is only recomputed when the consultation itself is saved).
    bpClassification: extra.bpClassification ?? null,
    vitals: {
      bp: text(payload.bloodPressure),
      temperature: numericVital(payload.temperature),
      hr: numericVital(payload.pulseRate),
      rr: numericVital(payload.respiratoryRate),
      heightCm: numericVital(payload.height),
      weightKg: numericVital(payload.weight),
      o2sat: numericVital(payload.oxygenSaturation),
      ...(() => {
        const { bmi, category } = computeBMI(payload.height, payload.weight);
        // `visits.bmi_category` is NOT NULL (default ''), so a consultation saved
        // without both height and weight must store '' here, not null — otherwise
        // the insert fails with a NOT-NULL violation. `bmi` itself is nullable.
        return { bmi, bmiCategory: category || '' };
      })(),
    },
    phn: {
      assessment: diagnosis,
      notes: text(payload.remarks),
    },
  });
};

export const fromVisit = async (visit, supabase = serviceClientFor()) => {
  const resident = visit.resident || {};
  const details = visit.consultationDetails || {};
  const findings = text(visit.findings);
  const diagnosisMarker = '\nDiagnosis: ';
  const [findingsText, diagnosis] = findings.includes(diagnosisMarker)
    ? findings.split(diagnosisMarker)
    : [findings, visit.phn?.assessment || ''];

  let attendingPersonnel = null;
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
          fullName: profile.full_name || '',
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
    : classifyBpWithThresholds(visit.vitals?.bp);

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
    consultationDate: details.consultationDate ?? (visit.visitDate ? String(visit.visitDate).slice(0, 10) : ''),
    consultationTime: details.consultationTime ?? (visit.visitDate?.includes('T') ? String(visit.visitDate).slice(11, 16) : ''),
    // Health service provided (id + name snapshot recorded at save time, so a
    // later rename/deactivation in the catalog never changes history).
    serviceId: visit.healthServiceId || null,
    serviceName: visit.healthServiceName || '',
    chiefComplaint: visit.chiefComplaint || '',
    findings: details.findings ?? findingsText,
    diagnosis: details.diagnosis ?? text(diagnosis),
    treatmentGiven: details.treatmentGiven ?? treatmentText,
    medicationPrescribed: details.medicationPrescribed || medicationPrescribed,
    medications,
    adviceGiven: details.adviceGiven ?? (visit.recommendation || ''),
    remarks: details.remarks ?? (visit.clinicalHistory || visit.phn?.notes || ''),
    followUpRequired: details.followUpRequired ?? (visit.recommendation?.includes('Next visit:') ? 'Yes' : 'No'),
    nextVisitDate: details.nextVisitDate ?? (visit.recommendation?.match(/Next visit:\s*(\d{4}-\d{2}-\d{2})/)?.[1] || ''),
    referralRequired: visit.referralRequired ? 'Yes' : 'No',
    bloodPressureClassification,
    vitals: {
      ...(visit.vitals || {}),
      bloodPressureCategory: classifyBloodPressure(visit.vitals?.bp),
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
  };
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
 *   wants + none                                 -> 'create'     (new, awaiting resident confirmation)
 *   wants + live, resident already approved      -> 'reschedule' (keep confirmed, move the date)
 *   wants + live, not yet decided                -> 'await'      (assert awaiting-confirmation state)
 *   not wanted + live follow-up                  -> 'cancel'     (history preserved)
 *   otherwise                                    -> 'noop'
 */
export const planFollowUpSync = (existing, payload = {}) => {
  const wants = Boolean(text(payload.nextVisitDate));
  const live = existing && !TERMINAL_FOLLOWUP.has(text(existing.status));
  if (wants) {
    if (!live) return { action: 'create' };
    return { action: text(existing.resident_decision) === 'approved' ? 'reschedule' : 'await' };
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
 * A consultation follow-up REQUIRES the resident to confirm/reject: it lives in
 * the existing "awaiting resident response" state (status 'Pending',
 * requires_resident_response = true, resident_decision 'pending'), which the
 * resident page renders with Confirm/Reject. New rows are created through the
 * existing operational service (audit + "requires your response" notification);
 * a still-undecided existing row is re-asserted into that state (this also
 * upgrades older rows that were created before confirmation was required); a row
 * the resident has already approved is only rescheduled, never reset.
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
      .select('id, status, resident_decision, consultation_id, client_operation_key, scheduled_date')
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

    if (action === 'await') {
      // Assert the awaiting-confirmation state so the resident gets Confirm /
      // Reject. Confirmation columns are resident-owned and not settable through
      // the staff operational update, so this one field-set is written directly
      // on the already-resolved own row (ownership: resident_id + created_by).
      const { error: upErr } = await supabase
        .from('follow_ups')
        .update({
          scheduled_date: text(payload.nextVisitDate),
          purpose,
          notes: text(payload.adviceGiven),
          status: 'Pending',
          consultation_id: visit.id,
          requires_resident_response: true,
          resident_decision: 'pending',
          resident_decision_at: null,
          resident_decision_reason: '',
        })
        .eq('id', existing.id);
      if (upErr) throw new Error(upErr.message || 'Could not update the follow-up');
      return;
    }

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
        // Enter the EXISTING "awaiting resident response" workflow: shows on My
        // Follow-ups as "Action Required" with Confirm/Reject; the resident's
        // decision moves it to Scheduled (approved) or Cancelled (rejected).
        requiresResidentResponse: true,
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
      residentId: resident.id,
      limit: pageSize,
      offset: pageOffset,
    });
    return { rows: await Promise.all(result.rows.map((v) => fromVisit(v, supabase))), total: result.total };
  }

  assertStaff(user);
  const result = await repo.listVisits({ q: text(q), ...filters, limit: pageSize, offset: pageOffset,
    municipalityId: user.municipalityId,
    barangayId: user.role === 'health_supervisor' ? user.barangayId : null,
    barangay: assignedBarangay(user) });
  const filtered = [];
  for (const visit of result.rows) {
    try { assertResidentScope(user, visit.resident); filtered.push(visit); } catch {}
  }
  return { rows: await Promise.all(filtered.map((v) => fromVisit(v, supabase))),
    total: filtered.length === result.rows.length ? result.total : filtered.length };
};

export const get = async ({ user, id, repo = repository, supabase = serviceClientFor(repo) }) => {
  const isResidentSelf = user?.role === 'resident';
  if (!isResidentSelf) assertStaff(user);
  const visit = await repo.getVisit(id);
  if (!visit) throw ApiError.notFound('Consultation not found.');
  if (isResidentSelf) {
    const resident = await repo.getResidentByAuthUserId(user.id);
    if (!resident || resident.id !== visit.residentId) throw ApiError.notFound('Consultation not found.');
  } else {
    assertResidentScope(user, visit.resident);
  }
  return fromVisit(visit, supabase);
};

const consultationFieldErrors = (payload = {}, { requireResident = false } = {}) => {
  const errors = validateVitalsByField(payload);
  const required = (field, message) => {
    if (!text(payload[field])) errors[field] = message;
  };
  if (requireResident) required('residentId', 'Please select a resident.');
  required('consultationDate', 'Consultation date is required.');
  if (payload.consultationDate && !dateOnly(payload.consultationDate)) {
    errors.consultationDate = 'Consultation date is invalid.';
  }
  if (present(payload.consultationTime) && !/^([01]\d|2[0-3]):[0-5]\d$/.test(text(payload.consultationTime))) {
    errors.consultationTime = 'Consultation time must be a valid time (HH:MM).';
  }
  if (present(payload.recordedAt) && (typeof payload.recordedAt !== 'string'
    || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(payload.recordedAt)
    || !Number.isFinite(Date.parse(payload.recordedAt)))) {
    errors.recordedAt = 'The original recording timestamp is invalid.';
  }
  required('chiefComplaint', 'Chief complaint is required.');
  // Accept either the merged field or the legacy separate fields
  const hasMergedField = present(payload.clinicalFindingsDiagnosis);
  const hasSeparateFields = present(payload.findings) || present(payload.diagnosis);
  if (!hasMergedField && !hasSeparateFields) {
    errors.clinicalFindingsDiagnosis = 'Clinical findings and diagnosis are required.';
  }
  if (payload.consultationDetails !== undefined && (!payload.consultationDetails
    || typeof payload.consultationDetails !== 'object' || Array.isArray(payload.consultationDetails))) {
    errors.consultationDetails = 'Additional clinical details must be a JSON object.';
  }
  const { errors: followUpErrors } = validateFollowUp(payload);
  if (followUpErrors.length) errors.nextVisitDate = followUpErrors.join(' ');
  return errors;
};

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

const operationHash = (payload) => {
  const { clientOperationKey, ...clinical } = payload;
  return requestFingerprint({ method: 'POST', path: '/consultations', body: clinical });
};

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

export const create = async ({ user, payload = {}, idempotencyKey = null, repo = repository,
  supabase = serviceClientFor(repo), classifyBp = classifyWithConfig, persistRisk = persistResidentRisk }) => {
  assertStaff(user);
  const key = consultationOperationKey(payload, idempotencyKey);
  const hash = operationHash(payload);
  // Resolve the durable operation before allocating a new visit. The original
  // recorder is immutable, including when another staff member edits the visit.
  let visit = await repo.findVisitByOperationKey(key);
  if (visit) assertOperationOwner(visit, user, payload, hash);
  const fieldErrors = consultationFieldErrors(payload, { requireResident: true });
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
  const cleanPayload = { ...payload, nextVisitDate: normalized.nextVisitDate };
  // Validate the selected health service against the database (new consultation:
  // an inactive service is rejected; the association must be a real, in-scope
  // service row — never a free-text name).
  const healthService = await resolveConsultationService({
    user, serviceId: payload.serviceId ?? payload.service_id, existingServiceId: visit?.healthServiceId, supabase,
  });
  if (!visit) {
    // A keyless historical write cannot be correlated with an old response-loss
    // draft. Never guess a clinical match or silently create a second visit.
    if (payload.legacyDraftAdopted === true && await repo.hasUnkeyedVisitsForResident(resident.id)) {
      throw ApiError.conflict('This legacy draft cannot be safely distinguished from a pre-upgrade visit. Review existing records before recording another visit. Clinical information remains on this device.');
    }
    const ids = await repo.nextSubmissionId();
    const bpClassification = await classifyBp(cleanPayload.bloodPressure);
    try {
      visit = await repo.insertVisit({
        id: ids.id,
        ...toVisit(cleanPayload, user, resident.id, {
          bpClassification, healthServiceId: healthService.id, healthServiceName: healthService.name,
        }),
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
  // Recorded health data changed -> recompute + persist the resident's risk
  // (backend-authoritative; best-effort so a save is never blocked by it).
  await persistRisk({ residentId: resident.id });
  const completed = await repo.getVisit(visit.id);
  if (!completed?.consultationEffectsCompletedAt) {
    throw new ApiError(503, 'The consultation completion could not be confirmed. Retry the original operation.');
  }
  return fromVisit(completed, supabase);
};

export const update = async ({ user, id, payload = {}, repo = repository, supabase = serviceClientFor(repo),
  classifyBp = classifyWithConfig, persistRisk = persistResidentRisk,
  syncFollowUp = syncConsultationFollowUp, notify = notifyResidentOfConsultation }) => {
  assertStaff(user);
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
  const fieldErrors = consultationFieldErrors(payload);
  const { errors: followUpErrors, normalized } = validateFollowUp(payload);
  if (Object.keys(fieldErrors).length) {
    throw ApiError.unprocessable('Please correct the consultation fields shown below.', fieldErrors);
  }
  const cleanPayload = { ...payload, nextVisitDate: normalized.nextVisitDate, residentId: visit.residentId,
    consultationDetails: { ...visit.consultationDetails, ...payload.consultationDetails } };
  // Validate the (possibly changed) health service. `existingServiceId` keeps an
  // association with a since-deactivated service valid when the editor leaves it
  // untouched, while a NEWLY selected inactive service is rejected.
  const healthService = await resolveConsultationService({
    user,
    serviceId: payload.serviceId ?? payload.service_id,
    existingServiceId: visit.healthServiceId,
    supabase,
  });
  const bpClassification = await classifyBp(cleanPayload.bloodPressure);
  // Preserve the existing visit status (draft / in_review / referred / etc.) —
  // only a NEW consultation defaults to 'completed'. This stops an update from
  // clobbering a status the workflow (e.g. intake) set on the row.
  const updated = await repo.updateVisit(id, {
    ...toVisit(cleanPayload, user, visit.residentId, {
      bpClassification,
      healthServiceId: healthService.id,
      healthServiceName: healthService.id === visit.healthServiceId ? visit.healthServiceName || healthService.name : healthService.name,
      status: visit.status || 'completed',
      recordedAt: visit.recordedAt || visit.createdAt,
    }),
    recordedById: visit.recordedById,
    recordedByRole: visit.recordedByRole,
    recordedByName: visit.recordedByName,
  });
  await syncFollowUp({ user, visit: updated, payload: cleanPayload, supabase });
  // Recorded health data changed -> recompute + persist the resident's risk.
  await persistRisk({ residentId: visit.residentId });
  // Only after the consultation is persisted. Idempotent per visit id, so
  // editing an existing consultation does not create a duplicate notification.
  await notify({ residentId: visit.residentId, visit: updated });
  return fromVisit(updated, supabase);
};

export default { list, get, create, update };
