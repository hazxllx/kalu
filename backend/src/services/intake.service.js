/**
 * Intake workflow service (BHW / RHU personnel / Health Supervisor).
 *
 * Architectural layer:
 *   route -> authenticate -> authorize / authorizeStation(TRIAGE) -> intake.controller
 *         -> intake.service -> repository / referrals.service / Supabase
 *
 * Drives the resident -> submission lifecycle up to hand-off:
 *   - search an existing resident for prefill,
 *   - create/update a DRAFT submission (own records only),
 *   - SUBMIT: validates, recomputes BMI server-side, locks the clinical
 *     content, stamps submittedAt and transfers the record to the PHN queue.
 *
 * Enforcement notes (server side, not just UI):
 *   - a submission may only be edited while it is a DRAFT owned by the caller,
 *   - after SUBMIT the clinical content is immutable for the submitting role,
 *   - resident identity is matched before creating a new resident so a new
 *     intake for an existing patient never creates a duplicate.
 */
import ApiError from '../utils/apiError.js';
import { assertIncomingReferral } from './referrals.service.js';
import repository from '../repositories/index.js';
import { getServiceClient } from '../config/supabase.js';
import { computeBMI } from '../utils/bmi.js';
import { SUBMISSION_STATUS } from '../config/facility.js';
import { assignedBarangay, withinFacilityScope } from '../config/scope.js';
import { canTriage } from '../config/rhuStations.js';
import { requestFingerprint } from '../middleware/idempotency.js';

const INTAKE_ROLES = ['bhw', 'rhu_personnel', 'health_supervisor'];

const isIntakeRole = (user) => user?.role && INTAKE_ROLES.includes(user.role);

/**
 * Station re-check (defense in depth; the route also runs
 * authorizeStation(TRIAGE)). An RHU Personnel account must hold the Triage
 * station to drive the intake/triage workflow — a Consultation-only RHU account
 * is refused. BHW community intake and the Health Supervisor's barangay intake
 * are not station-gated, so they pass through unchanged.
 */
const assertTriageStation = (user) => {
  if (user?.role === 'rhu_personnel' && !canTriage(user)) {
    throw ApiError.forbidden('You are not assigned to the RHU Triage station.');
  }
};

const editableStatusesForIntake = () => [SUBMISSION_STATUS.DRAFT];

/** Service-role reads must enforce municipality and barangay IDs as well as names. */
const withinBarangayScope = (user, resident, repo = repository) => {
  if (!resident) return false;
  const municipality = String(user?.municipalityId || '').trim();
  const residentMunicipality = String(resident.municipalityId || '').trim();
  if ((municipality && residentMunicipality && municipality !== residentMunicipality) ||
      (repo.driver === 'supabase' && (!municipality || !residentMunicipality))) return false;
  const scope = assignedBarangay(user);
  if (['bhw', 'health_supervisor'].includes(user?.role) && !scope) return false;
  if (scope && user?.barangayId && resident.barangayId && String(user.barangayId) !== String(resident.barangayId)) return false;
  if (!scope) return true;
  return String(resident?.barangay ?? '').trim().toLowerCase() === scope.toLowerCase();
};

/**
 * Enforce that the caller holds an intake-eligible role (`bhw`, `rhu_personnel`,
 * `health_supervisor`), passes RHU Triage station verification, and carries valid
 * municipality, barangay (BHW/HS), or RHU facility (`rhu_personnel`) assignments.
 */
const assertIntakeActorScope = (user, repo = repository) => {
  if (!isIntakeRole(user)) throw ApiError.forbidden();
  assertTriageStation(user);
  if (repo.driver === 'supabase' && (!user.id || !user.municipalityId)) throw ApiError.forbidden('A current municipality assignment is required.');
  if (['bhw', 'health_supervisor'].includes(user.role) && !assignedBarangay(user)) throw ApiError.forbidden('A current barangay assignment is required.');
  if (user.role === 'rhu_personnel' && !user.facilityId) throw ApiError.forbidden('A current RHU facility assignment is required.');
};

/** Check that a submission's resident and facility both fall within the caller's intake scope. */
const withinIntakeScope = (user, submission) =>
  withinBarangayScope(user, submission?.resident) &&
  withinFacilityScope(user, submission?.facilityId);

/**
 * Search existing residents (up to 25 matches) within the caller's municipality
 * and barangay scope to prefill the intake/triage form.
 */
export const searchResidents = async ({ q = '', user, repo = repository }) => {
  assertIntakeActorScope(user, repo);
  const scope = assignedBarangay(user);
  // Scope is passed into the repository query so a service-role data access
  // path never fetches records outside the caller's authorized window.
  return repo.searchResidents({
    q,
    limit: 25,
    barangay: scope || null,
    municipalityId: user?.municipalityId || null,
  });
};

/**
 * Load a scoped resident profile for intake prefill, enriched with `latestMeasurements`
 * (most recent plausible height < 300 cm and weight < 500 kg) and up to 5
 * `recentClinicalHistory` summaries drawn from `COMPLETED` rows in `public.visits`
 * (constrained to `user.facilityId` for RHU personnel).
 */
export const getResidentForIntake = async ({ id, user, repo = repository, supabase = null }) => {
  assertIntakeActorScope(user, repo);
  const resident = await repo.getResident(id);
  if (!resident || !withinBarangayScope(user, resident, repo)) {
    throw ApiError.notFound('Resident record not found');
  }

  // Historical measurements and recent clinical context come only from this
  // resident's own completed encounters. They are displayed as historical and
  // are never copied into a new screening encounter automatically.
  let history = (supabase || getServiceClient())
    .from('visits')
    .select('id, visit_date, height_cm, weight_kg, chief_complaint, findings, phn_assessment, status')
    .eq('resident_id', resident.id)
    .eq('status', SUBMISSION_STATUS.COMPLETED);
  if (user.role === 'rhu_personnel') history = history.eq('facility_id', user.facilityId);
  const { data, error } = await history.order('visit_date', { ascending: false, nullsFirst: false }).limit(50);
  if (error) throw new ApiError(503, 'Could not load resident clinical history.');
  if (!Array.isArray(data)) throw new ApiError(503, 'The resident clinical history response was incomplete.');

  const validHeight = (value) => Number.isFinite(Number(value)) && Number(value) > 0 && Number(value) < 300;
  const validWeight = (value) => Number.isFinite(Number(value)) && Number(value) > 0 && Number(value) < 500;
  const visits = data;
  const heightVisit = visits.find((visit) => validHeight(visit.height_cm));
  const weightVisit = visits.find((visit) => validWeight(visit.weight_kg));
  const recentClinicalHistory = visits
    .filter((visit) => visit.chief_complaint || visit.findings || visit.phn_assessment)
    .slice(0, 5)
    .map((visit) => ({
      date: visit.visit_date || null,
      chiefComplaint: visit.chief_complaint || '',
      findings: visit.findings || '',
      assessment: visit.phn_assessment || '',
    }));

  return {
    ...resident,
    latestMeasurements: {
      heightCm: heightVisit ? Number(heightVisit.height_cm) : null,
      heightMeasuredAt: heightVisit?.visit_date || null,
      weightKg: weightVisit ? Number(weightVisit.weight_kg) : null,
      weightMeasuredAt: weightVisit?.visit_date || null,
    },
    recentClinicalHistory,
  };
};

/** Sanitize and trim demographic fields supplied when registering a new resident during intake. */
const normalizeDemographics = (resident = {}) => ({
  lastName: String(resident.lastName ?? '').trim(),
  firstName: String(resident.firstName ?? '').trim(),
  middleName: String(resident.middleName ?? '').trim(),
  suffix: String(resident.suffix ?? '').trim(),
  birthDate: resident.birthDate || null,
  age: resident.age === '' || resident.age === null || resident.age === undefined ? null : resident.age,
  birthPlace: String(resident.birthPlace ?? '').trim(),
  sex: resident.sex || '',
  civilStatus: resident.civilStatus || '',
  religion: String(resident.religion ?? '').trim(),
  employmentStatus: resident.employmentStatus || '',
  fatherName: String(resident.fatherName ?? '').trim(),
  motherName: String(resident.motherName ?? '').trim(),
  is4PsMember: Boolean(resident.is4PsMember),
  philhealthNo: String(resident.philhealthNo ?? '').trim(),
  currentAddress: String(resident.currentAddress ?? '').trim(),
  permanentAddress: String(resident.permanentAddress ?? '').trim(),
  cellphoneNo: String(resident.cellphoneNo ?? '').trim(),
  identityNo: String(resident.identityNo ?? '').trim(),
  barangay: String(resident.barangay ?? resident.registeredBarangay ?? '').trim(),
});

const ageAtVisit = (resident, visitDate) => {
  if (!resident?.birthDate) return resident?.age;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(resident.birthDate);
  const at = new Date(visitDate);
  if (!match || Number.isNaN(at.getTime())) return null;
  const [, year, month, day] = match.map(Number);
  const birth = new Date(Date.UTC(year, month - 1, day));
  if (birth.getUTCFullYear() !== year || birth.getUTCMonth() !== month - 1 || birth.getUTCDate() !== day || birth > at) return null;
  let age = at.getUTCFullYear() - year;
  if (at.getUTCMonth() < month - 1 || (at.getUTCMonth() === month - 1 && at.getUTCDate() < day)) age -= 1;
  return age;
};

const triageSnapshot = (resident, visit, user, submittedAt) => ({
  residentId: resident.id || null,
  resident: {
    id: resident.id || null, firstName: resident.firstName || '', middleName: resident.middleName || '', lastName: resident.lastName || '',
    age: ageAtVisit(resident, visit.visitDate), sex: resident.sex || '', barangay: resident.barangay || resident.registeredBarangay || '',
  },
  vitals: visit.vitals,
  chiefComplaint: visit.chiefComplaint,
  clinicalHistory: visit.clinicalHistory,
  visitDate: visit.visitDate,
  recordedBy: user.id,
  recordedByName: user.name || '',
  submittedAt,
  triageWarnings: triageReviewWarnings(visit.vitals),
});

/**
 * Coerce vital sign measurements to finite numbers (or `null`) and recompute
 * `bmi` and `bmiCategory` server-side via `computeBMI`.
 */
const normalizeVitals = (vitals = {}) => {
  const num = (value) => {
    if (value === '' || value === null || value === undefined) return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : value;
  };
  const heightCm = num(vitals.heightCm);
  const weightKg = num(vitals.weightKg);
  const { bmi, category } = computeBMI(heightCm, weightKg);
  return {
    bp: String(vitals.bp ?? '').trim() || null,
    hr: num(vitals.hr),
    rr: num(vitals.rr),
    o2sat: num(vitals.o2sat),
    temperature: num(vitals.temperature),
    bloodSugar: num(vitals.bloodSugar),
    heightCm,
    weightKg,
    bmi,
    bmiCategory: category,
  };
};

/** Normalize visit narrative fields, default `visitDate`, and normalize nested `vitals`. */
const normalizeVisit = (visit = {}) => ({
  visitDate: visit.visitDate || new Date().toISOString(),
  chiefComplaint: String(visit.chiefComplaint ?? '').trim(),
  clinicalHistory: String(visit.clinicalHistory ?? '').trim(),
  findings: String(visit.findings ?? '').trim(),
  treatmentGiven: String(visit.treatmentGiven ?? '').trim(),
  recommendation: String(visit.recommendation ?? '').trim(),
  vitals: normalizeVitals(visit.vitals || {}),
});

/**
 * Validate optional triage vital signs when provided: `bp` (`systolic/diastolic`),
 * `hr` (20..250 bpm), `rr` (4..90), `o2sat` (50..100%), `temperature` (25..46 °C),
 * and positive `heightCm` / `weightKg`.
 */
export const validateVitals = (vitals = {}) => {
  if (!vitals || typeof vitals !== 'object' || Array.isArray(vitals)) return { vitals: 'Use separate fields for each vital sign.' };
  const errors = {};
  const error = (field, message) => { errors[field] = message; };
  const has = (value) => value !== null && value !== undefined && value !== '';
  if (has(vitals.bp)) {
    const match = String(vitals.bp).match(/^\s*(\d{2,3})\s*\/\s*(\d{2,3})\s*$/);
    if (!match) error('vitals.bp', 'Enter blood pressure as systolic/diastolic, for example 120/80.');
    else if (+match[1] < 40 || +match[1] > 300 || +match[2] < 20 || +match[2] > 200 || +match[1] <= +match[2]) {
      error('vitals.bp', 'Enter a plausible systolic/diastolic reading (40-300/20-200 mmHg, systolic greater than diastolic).');
    }
  }
  // Heart rate / respiratory rate / O2 sat / temperature are OPTIONAL at the
  // triage hand-off (a triage may not capture every vital). They are only
  // range-checked when actually provided; a missing value is accepted. Blood
  // pressure, height and weight are likewise validated only when present.
  const bounds = [
    ['hr', 20, 250, 'Heart rate must be between 20 and 250 bpm.'],
    ['rr', 4, 90, 'Respiratory rate must be between 4 and 90 breaths/min.'],
    ['o2sat', 50, 100, 'Oxygen saturation must be between 50 and 100%.'],
    ['temperature', 25, 46, 'Temperature must be between 25 and 46 °C.'],
    ['heightCm', 20, 300, 'Height must be between 20 and 300 cm.'],
    ['weightKg', 0.3, 500, 'Weight must be between 0.3 and 500 kg.'],
    ['bloodSugar', 1, 2000, 'Blood sugar must be between 1 and 2000 mg/dL.'],
  ];
  for (const [field, min, max, message] of bounds) {
    if (!has(vitals[field])) continue;
    const value = vitals[field];
    if (!['number', 'string'].includes(typeof value) || !/^\d+(?:\.\d+)?$/.test(String(value).trim()) ||
        !Number.isFinite(Number(value)) || Number(value) < min || Number(value) > max) error(`vitals.${field}`, message);
    else if (['hr', 'rr'].includes(field) && (!/^\d+$/.test(String(value).trim()) || !Number.isInteger(Number(value)))) {
      error(`vitals.${field}`, 'Enter a whole-number measurement for this field.');
    }
  }
  return errors;
};

/**
 * Validates a submission at the RHU/BHW hand-off (the `submitted` transition).
 *
 * A submission at this stage carries only what the intake/triage worker
 * actually possesses: the resident identity, the visit date, the chief
 * complaint and the triage vitals. The clinical OUTPUTS — `findings` and
 * `treatmentGiven` — belong to the PHN stage and are therefore NOT required
 * here; they are enforced later, at PHN completion (see
 * phnQueue.service.completeSubmission). This lets a legitimate triage hand-off
 * enter the PHN queue without fabricating clinical content.
 */
export const validateSubmissionForSubmit = (resident, visit) => {
  const errors = {};
  const name = [resident?.firstName, resident?.middleName, resident?.lastName].filter(Boolean).join(' ').trim();
  if (!resident || !String(resident.firstName || '').trim()) errors['resident.firstName'] = 'Patient name is required.';
  if (name && (name.length > 200 || !/\p{L}/u.test(name) || !/^[\p{L}\p{M}\p{Zs}.'’\-]+$/u.test(name))) {
    errors['resident.firstName'] = 'Use letters, spaces, apostrophes, periods or hyphens in the patient name; numbers are not allowed.';
  }
  if (!resident?.sex || !['Female', 'Male', 'Other'].includes(resident.sex)) errors['resident.sex'] = 'Select sex.';
  const recordedAge = ageAtVisit(resident, visit?.visitDate);
  const age = Number(recordedAge);
  if (!['number', 'string'].includes(typeof recordedAge) || !/^\d+$/.test(String(recordedAge).trim()) || age > 120 || !Number.isInteger(age)) errors['resident.age'] = 'Age must be a whole number from 0 to 120.';
  if (!String(resident?.barangay || resident?.registeredBarangay || '').trim()) errors['resident.barangay'] = 'Registered barangay is required.';
  if (!visit) {
    errors.visit = 'Visit information is required.';
    return errors;
  }
  if (typeof visit.visitDate !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(visit.visitDate) || Number.isNaN(Date.parse(visit.visitDate))) errors['visit.visitDate'] = 'Enter a valid date and time of visit.';
  if (typeof visit.chiefComplaint !== 'string' || !visit.chiefComplaint.trim()) errors['visit.chiefComplaint'] = 'Chief complaint is required.';
  else if (visit.chiefComplaint.trim().length > 2000) errors['visit.chiefComplaint'] = 'Use 2,000 characters or fewer for the chief complaint.';
  if (visit.clinicalHistory != null && (typeof visit.clinicalHistory !== 'string' || visit.clinicalHistory.trim().length > 10000)) errors['visit.clinicalHistory'] = 'Use text of 10,000 characters or fewer for triage notes.';
  // findings + treatmentGiven are PHN-stage outputs, enforced at completion.
  Object.assign(errors, validateVitals(visit.vitals || {}));
  return errors;
};

/** Non-diagnostic prompts to verify unusual values; recorded observations are never changed. */
export const triageReviewWarnings = (vitals = {}) => {
  const warnings = [];
  const bp = String(vitals.bp || '').match(/^\s*(\d{2,3})\s*\/\s*(\d{2,3})\s*$/);
  if (bp && (+bp[1] >= 180 || +bp[2] >= 120 || +bp[1] < 90)) warnings.push({ field: 'vitals.bp', message: 'Blood pressure needs clinical review; verify the reading and recorded units.' });
  const checks = [
    ['hr', (n) => n < 40 || n > 180, 'Unusual heart rate; verify the measurement.'],
    ['rr', (n) => n < 8 || n > 40, 'Unusual respiratory rate; verify the measurement.'],
    ['o2sat', (n) => n < 94, 'Unusual oxygen saturation; verify the measurement.'],
    ['temperature', (n) => n < 35 || n >= 38, 'Unusual temperature; verify the measurement and units.'],
    ['bloodSugar', (n) => n < 70 || n > 250, 'Unusual blood sugar value; verify the measurement and units.'],
  ];
  for (const [field, unusual, message] of checks) {
    if (vitals[field] !== null && vitals[field] !== undefined && vitals[field] !== '' && unusual(Number(vitals[field]))) {
      warnings.push({ field: `vitals.${field}`, message });
    }
  }
  return warnings;
};

/**
 * Creates a submission. Accepts either an existing resident (residentId) or a
 * new-resident demographic payload (resident), plus the current-visit payload.
 * New residents are identity-matched first to prevent duplicates.
 *
 * When `referralId` is provided, verifies the incoming RHU referral via
 * `assertIncomingReferral`, reuses any existing own `DRAFT` encounter on `visits`
 * (or throws 409/403 if already submitted or owned by another user), derives the
 * authoritative `residentId` from the referral, and stamps `receivedAt`.
 * Performer audit fields (`recordedById`, `responsiblePersonnelId`) always come
 * from the authenticated session.
 */
export const createSubmission = async ({ residentId = null, resident = null, visit = {}, referralId = null, submit = false, clientSubmissionId = null, user, repo = repository }) => {
  assertIntakeActorScope(user, repo);
  if (user.role === 'rhu_personnel' && !user.facilityId) {
    throw ApiError.unprocessable('Your account must be assigned to an RHU facility before submitting triage.');
  }

  if (!visit || typeof visit !== 'object' || Array.isArray(visit)) throw ApiError.badRequest('Visit details must use separate fields.', { visit: 'Enter visit details.' });
  const vitalErrors = validateVitals(visit.vitals === undefined ? {} : visit.vitals);
  if (Object.keys(vitalErrors).length) throw ApiError.badRequest('Invalid vital signs.', vitalErrors);

  if (submit) {
    if (!clientSubmissionId || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clientSubmissionId)) {
      throw ApiError.unprocessable('A stable client submission UUID is required.', { clientSubmissionId: 'Retry with the original submission UUID.' });
    }
    const scope = assignedBarangay(user);
    let atomicResident = null;
    let atomicResidentId = residentId || null;
    let incomingReferral = null;
    if (referralId) {
      incomingReferral = await assertIncomingReferral({ user, id: referralId });
      if (atomicResidentId && atomicResidentId !== incomingReferral.resident_id) {
        throw ApiError.badRequest('The referral does not belong to the selected patient.', { resident: 'Reopen the referral and verify the patient.' });
      }
      atomicResidentId = incomingReferral.resident_id;
    }
    if (atomicResidentId) {
      atomicResident = await repo.getResident(atomicResidentId);
      if (!atomicResident || !withinBarangayScope(user, atomicResident, repo)) throw ApiError.notFound('Resident record not found');
      if (repo.driver === 'supabase') {
        const barangay = await repo.findBarangayByName(atomicResident.barangay, user.municipalityId);
        if (!barangay?.id || barangay.status !== 'Active' || barangay.id !== atomicResident.barangayId) {
          throw ApiError.badRequest('The patient barangay is missing or no longer registered.', { 'resident.barangay': 'Update the registered patient record before triage.' });
        }
      }
    } else if (resident) {
      atomicResident = normalizeDemographics(resident);
      if (scope && atomicResident.barangay && atomicResident.barangay.toLowerCase() !== scope.toLowerCase()) {
        throw ApiError.forbidden('Your account is assigned to Barangay ' + scope + ' only');
      }
      if (scope) atomicResident.barangay = scope;
      if (repo.driver === 'supabase') {
        const barangay = await repo.findBarangayByName(atomicResident.barangay, user.municipalityId);
        if (!barangay?.id || String(barangay.name || '').trim().toLowerCase() !== atomicResident.barangay.toLowerCase() || barangay.is_active === false || barangay.status !== 'Active' || String(barangay.municipality_id || barangay.municipalityId || '') !== String(user.municipalityId)) {
          throw ApiError.unprocessable('Select an active barangay within your assigned municipality.', { 'resident.barangay': 'Select an active barangay in your municipality.' });
        }
        atomicResident.barangayId = barangay.id;
        atomicResident.municipalityId = user.municipalityId;
        atomicResident.barangay = barangay.name;
      }
    } else {
      throw ApiError.badRequest('A resident must be selected or a new resident profile supplied.', { resident: 'Select or register a resident.' });
    }
    const normalized = normalizeVisit(visit);
    const errors = validateSubmissionForSubmit(atomicResident, { ...normalized, ...visit, vitals: visit.vitals || {} });
    if (!visit.visitDate) errors['visit.visitDate'] = 'Enter a valid date and time of visit.';
    if (Object.keys(errors).length) throw ApiError.badRequest('Cannot submit: please correct the highlighted fields.', errors);
    if (Number(ageAtVisit(atomicResident, normalized.visitDate)) < 18) normalized.vitals.bmiCategory = null;
    const now = new Date().toISOString();
    const performerName = user.name || '';
    const snapshot = triageSnapshot(atomicResident, normalized, user, now);
    const fingerprint = requestFingerprint({ method: 'POST', path: '/api/intake/visits', body: { residentId: atomicResidentId, resident: atomicResidentId ? null : atomicResident, referralId: incomingReferral?.id || null, visit: normalized } });
    return repo.createSubmittedTriage({
      resident: atomicResidentId ? null : atomicResident,
      residentId: atomicResidentId,
      submissionId: clientSubmissionId.toLowerCase(),
      fingerprint,
      actorId: user.id,
      visit: { ...normalized, ...(incomingReferral?.encounter?.status === SUBMISSION_STATUS.DRAFT ? { id: incomingReferral.encounter.id } : {}), recordedByRole: user.role, recordedByName: performerName, responsiblePersonnelName: performerName, facilityId: user.facilityId || null, referralId: incomingReferral?.id || null, receivedAt: incomingReferral ? now : null, triageSnapshot: snapshot },
    });
  }

  // Triage of a referred patient: the barangay referral is authoritative for the
  // resident identity (never trust a client-supplied residentId here), and one
  // referral has at most ONE active RHU encounter — reopening reuses it rather
  // than creating a duplicate triage.
  let linkedReferralId = null;
  if (referralId) {
    const supabase = getServiceClient();
    const ref = await assertIncomingReferral({ user, id: referralId, supabase });
    const { data: existingVisits, error: existingVisitError } = await supabase
      .from('visits')
      .select('id, status, recorded_by_id')
      .eq('referral_id', referralId)
      .neq('status', 'completed')
      .order('created_at', { ascending: false })
      .limit(1);
    if (existingVisitError) throw new ApiError(503, 'Could not check the existing referral encounter. Try again before starting another one.');
    if (Array.isArray(existingVisits) && existingVisits.length) {
      const existing = existingVisits[0];
      if (existing.status !== SUBMISSION_STATUS.DRAFT) {
        throw ApiError.conflict('This referral already has a screening submitted to the consultation queue.');
      }
      if (existing.recorded_by_id !== user.id) {
        throw ApiError.forbidden('Only the personnel who started this draft may continue it.');
      }
      await repository.updateVisit(existing.id, normalizeVisit(visit));
      return repository.getVisit(existing.id);
    }
    residentId = ref.resident_id; // authoritative
    linkedReferralId = ref.id;
  }

  const scope = assignedBarangay(user);

  let residentRow = null;
  if (residentId) {
    residentRow = await repository.getResident(residentId);
    // A barangay-scoped caller may only attach a visit to a resident in their
    // own barangay. Reported as 404 (not 403) so a caller cannot probe for the
    // existence of out-of-scope resident ids.
    if (!residentRow || !withinBarangayScope(user, residentRow)) {
      throw ApiError.notFound('Resident record not found');
    }
  } else if (resident) {
    const demographics = normalizeDemographics(resident);
    const demographicErrors = validateSubmissionForSubmit(demographics, { ...normalizeVisit(visit), chiefComplaint: 'Draft' });
    const patientErrors = Object.fromEntries(Object.entries(demographicErrors).filter(([field]) => field.startsWith('resident.')));
    if (Object.keys(patientErrors).length) throw ApiError.badRequest('Please correct the patient information.', patientErrors);
    // A barangay-scoped caller cannot create a resident outside their assigned
    // barangay. The barangay is forced to the session's scope; a mismatching
    // client-supplied barangay is rejected rather than silently overwritten.
    if (scope) {
      if (demographics.barangay && demographics.barangay.toLowerCase() !== scope.toLowerCase()) {
        throw ApiError.forbidden('Your account is assigned to Barangay ' + scope + ' only');
      }
      demographics.barangay = scope;
    }
    if (repository.driver === 'supabase') {
      const barangay = await repository.findBarangayByName(demographics.barangay, user.municipalityId);
      if (!barangay?.id || barangay.is_active === false ||
          String(barangay.municipality_id || barangay.municipalityId || '') !== String(user.municipalityId)) {
        throw ApiError.unprocessable('Select an active barangay within your assigned municipality.');
      }
      demographics.municipalityId = user.municipalityId;
      demographics.barangayId = barangay.id;
      demographics.barangay = barangay.name;
    }
    const existing = await repository.findResidentByIdentity({
      lastName: demographics.lastName,
      firstName: demographics.firstName,
      middleName: demographics.middleName,
      birthDate: demographics.birthDate,
      municipalityId: user.municipalityId || null,
    });
    if (existing) {
      throw ApiError.conflict(
        `An existing resident record was found for ${existing.firstName} ${existing.lastName} (${existing.healthRecordNo}). ` +
          'Please search for the resident instead of creating a new record.',
      );
    }
    const ids = await repository.nextResidentIds();
    residentRow = await repository.insertResident({ id: ids.id, healthRecordNo: ids.healthRecordNo, ...demographics });
  } else {
    throw ApiError.badRequest('A resident must be selected or a new resident profile supplied.');
  }

  const normalized = normalizeVisit(visit);
  // The performer is ALWAYS the authenticated user — never a client-supplied
  // name. recordedById/responsiblePersonnelId are the authoritative audit ids;
  // recordedByName is the account's own display name. There is no manually
  // entered "assigned personnel" field.
  const performerName = user.name || user.email || '';
  const submissionId = await repository.nextSubmissionId();
  const submission = {
    id: submissionId.id,
    residentId: residentRow.id,
    recordedById: user.id,
    recordedByRole: user.role,
    recordedByName: performerName,
    responsiblePersonnelId: user.id,
    responsiblePersonnelName: performerName,
    facilityId: user.facilityId || null,
    referralId: linkedReferralId,
    // Existing visits.received_at records the resident's arrival at the RHU.
    // A referral-linked screening is marked arrived when triage starts; this is
    // independent from the later triage hand-off status.
    receivedAt: linkedReferralId ? new Date().toISOString() : null,
    status: SUBMISSION_STATUS.DRAFT,
    ...normalized,
  };

  return repository.insertVisit(submission);
};

/** List up to 100 intake submissions recorded by the caller that remain within their current scope. */
export const listMySubmissions = async ({ user }) => {
  assertIntakeActorScope(user);
  const { rows } = await repository.listVisits({ submittedById: user.id, limit: 100 });
  return rows.filter((submission) => withinIntakeScope(user, submission));
};

/**
 * Retrieve a single intake submission owned by the caller within their current
 * barangay/facility scope. Throws 404 when absent, out of scope, or owned by another user.
 */
export const getSubmissionForIntake = async ({ id, user }) => {
  assertIntakeActorScope(user);
  const submission = await repository.getVisit(id);
  if (!submission) throw ApiError.notFound('Submission not found');
  if (submission.recordedById !== user.id || !withinIntakeScope(user, submission)) {
    // Avoid exposing whether another user's or out-of-scope submission exists.
    throw ApiError.notFound('Submission not found');
  }
  return submission;
};

/**
 * Update narrative and vital fields on a `DRAFT` intake submission created by
 * the caller, recomputing BMI server-side. Rejects non-draft submissions with 403.
 */
export const updateSubmissionDraft = async ({ id, visit = {}, user }) => {
  assertIntakeActorScope(user);
  const submission = await repository.getVisit(id);
  if (!submission) throw ApiError.notFound('Submission not found');
  if (submission.recordedById !== user.id) throw ApiError.forbidden('You may only update submissions you created.');
  if (!withinIntakeScope(user, submission)) throw ApiError.notFound('Submission not found');
  if (!editableStatusesForIntake().includes(submission.status)) {
    throw ApiError.forbidden('This submission has been submitted and can no longer be edited.');
  }

  const vitalErrors = validateVitals(visit?.vitals || {});
  if (Object.keys(vitalErrors).length) throw ApiError.badRequest('Invalid vital signs.', vitalErrors);

  const normalized = normalizeVisit({ ...submission, ...visit });
  const updated = await repository.updateVisit(id, normalized);
  return updated;
};

/**
 * Finalize and hand off a `DRAFT` intake submission to the PHN consultation queue.
 *
 * Re-normalizes vitals and BMI server-side, runs `validateSubmissionForSubmit`,
 * transitions status to `SUBMITTED`, stamps `submittedAt`, and locks the record
 * against further intake edits.
 */
export const submitSubmission = async ({ id, user }) => {
  assertIntakeActorScope(user);
  const submission = await repository.getVisit(id);
  if (!submission) throw ApiError.notFound('Submission not found');
  if (submission.recordedById !== user.id || !withinIntakeScope(user, submission)) {
    throw ApiError.forbidden('You may only submit submissions you created.');
  }
  if (submission.status !== SUBMISSION_STATUS.DRAFT) {
    throw ApiError.conflict('This submission has already been submitted.');
  }

  // Server-side validation + BMI recalculation on every submit. A manually
  // supplied BMI is never trusted.
  const resident = submission.resident;
  const errors = validateSubmissionForSubmit(resident, submission);
  if (Object.keys(errors).length) throw ApiError.badRequest('Cannot submit: please correct the highlighted fields.', errors);
  const normalized = normalizeVisit(submission);
  if (Number(ageAtVisit(resident, normalized.visitDate)) < 18) normalized.vitals.bmiCategory = null;

  const now = new Date().toISOString();
  const updated = await repository.updateVisit(id, {
    ...normalized,
    status: SUBMISSION_STATUS.SUBMITTED,
    submittedAt: now,
    triageSnapshot: triageSnapshot(resident, normalized, { id: submission.recordedById, name: submission.recordedByName }, now),
  });

  return {
    submission: updated,
    locked: true,
    warnings: triageReviewWarnings(normalized.vitals),
    message:
      'Submission successful. The record has been transferred to the Public Health Nurse queue and is no longer editable.',
  };
};

export default {
  searchResidents,
  getResidentForIntake,
  createSubmission,
  listMySubmissions,
  getSubmissionForIntake,
  updateSubmissionDraft,
  submitSubmission,
  validateVitals,
  validateSubmissionForSubmit,
  triageReviewWarnings,
};
