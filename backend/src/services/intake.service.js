/**
 * Intake workflow service (BHW / RHU personnel / Health Supervisor).
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
import repository from '../repositories/index.js';
import { computeBMI, isPlausibleVital } from '../utils/bmi.js';
import { SUBMISSION_STATUS } from '../config/facility.js';
import { assignedBarangay } from '../config/scope.js';

const INTAKE_ROLES = ['bhw', 'rhu_personnel', 'health_supervisor'];

const isIntakeRole = (user) => user?.role && INTAKE_ROLES.includes(user.role);

const editableStatusesForIntake = () => [SUBMISSION_STATUS.DRAFT];

/** True when the resident is visible to this caller under barangay scoping. */
const withinBarangayScope = (user, resident) => {
  const scope = assignedBarangay(user);
  if (!scope) return true;
  return String(resident?.barangay ?? '').trim().toLowerCase() === scope.toLowerCase();
};

export const searchResidents = async ({ q = '', user }) => {
  const residents = await repository.searchResidents({ q, limit: 25 });
  // Barangay-scoped callers only ever see residents of their own barangay —
  // filtered here at the data-access layer, not in the UI.
  const scope = assignedBarangay(user);
  if (!scope) return residents;
  return residents.filter((r) => withinBarangayScope(user, r));
};

export const getResidentForIntake = async ({ id, user }) => {
  if (!isIntakeRole(user)) throw ApiError.forbidden();
  const resident = await repository.getResident(id);
  if (!resident || !withinBarangayScope(user, resident)) {
    throw ApiError.notFound('Resident record not found');
  }
  return resident;
};

const normalizeDemographics = (resident = {}) => ({
  lastName: String(resident.lastName ?? '').trim(),
  firstName: String(resident.firstName ?? '').trim(),
  middleName: String(resident.middleName ?? '').trim(),
  suffix: String(resident.suffix ?? '').trim(),
  birthDate: resident.birthDate || null,
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
  barangay: String(resident.barangay ?? '').trim(),
});

const normalizeVitals = (vitals = {}) => {
  const num = (value) => {
    if (value === '' || value === null || value === undefined) return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
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
    heightCm,
    weightKg,
    bmi,
    bmiCategory: category,
  };
};

const normalizeVisit = (visit = {}) => ({
  visitDate: visit.visitDate || new Date().toISOString(),
  chiefComplaint: String(visit.chiefComplaint ?? '').trim(),
  clinicalHistory: String(visit.clinicalHistory ?? '').trim(),
  findings: String(visit.findings ?? '').trim(),
  treatmentGiven: String(visit.treatmentGiven ?? '').trim(),
  recommendation: String(visit.recommendation ?? '').trim(),
  vitals: normalizeVitals(visit.vitals || {}),
});

export const validateVitals = (vitals = {}) => {
  const errors = [];
  if (vitals.bp && !/^\s*\d{2,3}\s*\/\s*\d{2,3}\s*$/.test(String(vitals.bp))) {
    errors.push('Blood pressure must be in systolic/diastolic form, e.g. 120/80.');
  }
  if (!isPlausibleVital(vitals.hr, { min: 20, max: 250 })) errors.push('Heart rate must be a number between 20 and 250 bpm.');
  if (!isPlausibleVital(vitals.rr, { min: 4, max: 90 })) errors.push('Respiratory rate must be a number between 4 and 90.');
  if (!isPlausibleVital(vitals.o2sat, { min: 50, max: 100 })) errors.push('Oxygen saturation must be a number between 50 and 100%.');
  if (!isPlausibleVital(vitals.temperature, { min: 25, max: 46 })) errors.push('Temperature must be a number between 25 and 46 °C.');
  if (vitals.heightCm !== null && (!Number.isFinite(vitals.heightCm) || vitals.heightCm <= 0)) {
    errors.push('Height must be a positive number (cm).');
  }
  if (vitals.weightKg !== null && (!Number.isFinite(vitals.weightKg) || vitals.weightKg <= 0)) {
    errors.push('Weight must be a positive number (kg).');
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
  const errors = [];
  if (!resident || !resident.firstName || !resident.lastName) {
    errors.push('Patient last name and first name are required.');
  }
  if (!visit) {
    errors.push('Visit information is required.');
    return errors;
  }
  if (!visit.visitDate) errors.push('Date & time of visit is required.');
  if (!visit.chiefComplaint) errors.push('Chief complaint is required.');
  // findings + treatmentGiven are PHN-stage outputs, enforced at completion.
  errors.push(...validateVitals(visit.vitals || {}));
  return errors;
};

/**
 * Creates a submission. Accepts either an existing resident (residentId) or a
 * new-resident demographic payload (resident), plus the current-visit payload.
 * New residents are identity-matched first to prevent duplicates.
 */
export const createSubmission = async ({ residentId = null, resident = null, visit = {}, user }) => {
  if (!isIntakeRole(user)) throw ApiError.forbidden();

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
    if (!demographics.lastName || !demographics.firstName) {
      throw ApiError.badRequest('Last name and first name are required for a new resident record.');
    }
    // A barangay-scoped caller cannot create a resident outside their assigned
    // barangay. The barangay is forced to the session's scope; a mismatching
    // client-supplied barangay is rejected rather than silently overwritten.
    if (scope) {
      if (demographics.barangay && demographics.barangay.toLowerCase() !== scope.toLowerCase()) {
        throw ApiError.forbidden('Your account is assigned to Barangay ' + scope + ' only');
      }
      demographics.barangay = scope;
    }
    const existing = await repository.findResidentByIdentity({
      lastName: demographics.lastName,
      firstName: demographics.firstName,
      middleName: demographics.middleName,
      birthDate: demographics.birthDate,
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
  const submissionId = await repository.nextSubmissionId();
  const submission = {
    id: submissionId.id,
    residentId: residentRow.id,
    recordedById: user.id,
    recordedByRole: user.role,
    recordedByName: user.name || user.email || '',
    status: SUBMISSION_STATUS.DRAFT,
    ...normalized,
  };

  return repository.insertVisit(submission);
};

export const listMySubmissions = async ({ user }) => {
  if (!isIntakeRole(user)) throw ApiError.forbidden();
  const { rows } = await repository.listVisits({ submittedById: user.id, limit: 100 });
  return rows;
};

export const getSubmissionForIntake = async ({ id, user }) => {
  if (!isIntakeRole(user)) throw ApiError.forbidden();
  const submission = await repository.getVisit(id);
  if (!submission) throw ApiError.notFound('Submission not found');
  if (submission.recordedById !== user.id) {
    // A submission recorded by someone else is not part of this user's intake.
    throw ApiError.notFound('Submission not found');
  }
  return submission;
};

export const updateSubmissionDraft = async ({ id, visit = {}, user }) => {
  if (!isIntakeRole(user)) throw ApiError.forbidden();
  const submission = await repository.getVisit(id);
  if (!submission) throw ApiError.notFound('Submission not found');
  if (submission.recordedById !== user.id) throw ApiError.forbidden('You may only update submissions you created.');
  if (!editableStatusesForIntake().includes(submission.status)) {
    throw ApiError.forbidden('This submission has been submitted and can no longer be edited.');
  }

  const normalized = normalizeVisit({ ...submission, ...visit });
  const updated = await repository.updateVisit(id, normalized);
  return updated;
};

export const submitSubmission = async ({ id, user }) => {
  if (!isIntakeRole(user)) throw ApiError.forbidden();
  const submission = await repository.getVisit(id);
  if (!submission) throw ApiError.notFound('Submission not found');
  if (submission.recordedById !== user.id) {
    throw ApiError.forbidden('You may only submit submissions you created.');
  }
  if (submission.status !== SUBMISSION_STATUS.DRAFT) {
    throw ApiError.conflict('This submission has already been submitted.');
  }

  // Server-side validation + BMI recalculation on every submit. A manually
  // supplied BMI is never trusted.
  const resident = submission.resident;
  const normalized = normalizeVisit(submission);
  const errors = validateSubmissionForSubmit(resident, normalized);
  if (errors.length) throw ApiError.badRequest('Cannot submit: please complete the required fields.', errors);

  const now = new Date().toISOString();
  const updated = await repository.updateVisit(id, {
    ...normalized,
    status: SUBMISSION_STATUS.SUBMITTED,
    submittedAt: now,
  });

  return {
    submission: updated,
    locked: true,
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
};
