// frontend/src/features/health-records/lib/phnRecords.js
import {
  getManilaDateTime, validateConsultationDateTime, validateConsultationVitals,
  calculateConsultationBmi, consultationVitalValues, normalizeConsultationClinicalText, validateConsultationMedications,
} from '../../../../../shared/consultationClinical.js';

const text = (value) => String(value ?? '').trim();
const value = (field) => field === null || field === undefined ? '' : String(field);
const fields = ['chiefComplaint', 'findings', 'diagnosis', 'treatmentGiven', 'medicationPrescribed', 'adviceGiven', 'remarks', 'followUpRequired', 'nextVisitDate', 'referralRequired'];
const vitals = { bloodPressure: 'bp', temperature: 'temperature', pulseRate: 'hr', respiratoryRate: 'rr', height: 'heightCm', weight: 'weightKg', oxygenSaturation: 'o2sat' };
const clinicalFields = ['consultationDate', 'consultationTime', 'chiefComplaint', 'findings', 'diagnosis', 'treatmentGiven', ...Object.keys(vitals)];

export const consultationCondition = (condition) => ({
  name: text(typeof condition === 'string' ? condition : condition?.name),
  status: condition?.status === 'uncontrolled' ? 'uncontrolled' : 'stable',
  significant: condition?.significant === true,
});

const contextInput = (form) => ({
  pregnancyStatus: form.clinicalContext?.pregnancyStatus || 'unknown',
  existingConditions: (form.clinicalContext?.existingConditions || []).map((condition) => ({
    name: text(condition.name), status: condition.status, significant: condition.significant,
  })),
});

export const consultationForm = (record = null, now = new Date()) => {
  const local = record ? null : getManilaDateTime(now);
  const details = record?.consultationDetails ?? record?.consultation_details ?? {};
  const savedContext = record?.clinicalContext ?? details.clinicalContext;
  const submitted = savedContext?.submitted ?? savedContext;
  const measurements = consultationVitalValues(record || {});
  const form = {
    residentId: value(record?.resident?.id || record?.residentId || record?.resident_id),
    consultationDate: record ? value(record.consultationDate ?? details.consultationDate) : local.date,
    consultationTime: record ? value(record.consultationTime ?? details.consultationTime) : local.time,
    followUpRequired: 'No', referralRequired: 'No',
    medications: structuredClone(record?.medications ?? details.medications ?? []),
    clinicalIndicators: structuredClone(record?.clinicalIndicators ?? details.clinicalIndicators ?? {}),
    clinicalContext: {
      pregnancyStatus: submitted?.pregnancyStatus || (savedContext?.pregnancy?.isPregnant ? 'pregnant' : savedContext?.pregnancy?.isPostpartum ? 'postpartum' : 'unknown'),
      existingConditions: (submitted?.existingConditions || []).map(consultationCondition),
    },
    maternal: structuredClone(record?.maternal ?? details.maternal ?? null),
  };
  fields.forEach((field) => { form[field] = value(record?.[field] ?? details[field] ?? form[field]); });
  Object.keys(vitals).forEach((field) => {
    const measured = measurements[field];
    form[field] = value(field === 'bloodPressure' && measured && typeof measured === 'object'
      ? `${measured.systolic}/${measured.diastolic}` : measured);
  });
  Object.assign(form, normalizeConsultationClinicalText({ ...details, ...record }));
  return form;
};

export const requiresClinicalCompletion = (form, original = null) => {
  if (!original) return true;
  const previous = consultationForm(original);
  return clinicalFields.some((field) => text(form[field]) !== text(previous[field]))
    || ['medications', 'clinicalIndicators', 'maternal'].some((field) => JSON.stringify(form[field]) !== JSON.stringify(previous[field]))
    || JSON.stringify(contextInput(form)) !== JSON.stringify(contextInput(previous))
    || Boolean(form.riskReview);
};

export const clinicalPayload = (form, original = null) => {
  const payload = {
    residentId: text(form.residentId),
    serviceId: original?.serviceId ?? original?.service_id ?? original?.healthServiceId ?? original?.health_service_id
      ?? original?.healthService?.id ?? original?.health_services?.id ?? null,
    consultationDetails: structuredClone(original?.consultationDetails ?? original?.consultation_details ?? {}),
  };
  if (original?.recordedAt) payload.recordedAt = original.recordedAt;
  if (original?.clientOperationKey) payload.clientOperationKey = original.clientOperationKey;
  if (original?.updatedAt) payload.expectedUpdatedAt = original.updatedAt;
  if (!requiresClinicalCompletion(form, original)) {
    // Do not replay partial/invalid historical measurements as a clinical correction.
    const previous = consultationForm(original);
    fields.forEach((field) => { if (text(form[field]) !== text(previous[field])) payload[field] = text(form[field]); });
    return payload;
  }
  payload.consultationDate = text(form.consultationDate);
  payload.consultationTime = text(form.consultationTime);
  fields.forEach((field) => { payload[field] = text(form[field]); });
  Object.keys(vitals).forEach((field) => { payload[field] = text(form[field]); });
  payload.bmi = calculateConsultationBmi(form.height, form.weight);
  payload.medications = structuredClone(form.medications || []);
  payload.clinicalIndicators = structuredClone(form.clinicalIndicators || {});
  payload.clinicalContext = contextInput(form);
  if (form.maternal) payload.maternal = structuredClone(form.maternal);
  if (form.riskReview) payload.riskReview = {
    level: form.riskReview.level, reason: text(form.riskReview.reason), reassessmentConfirmed: form.riskReview.reassessmentConfirmed,
  };
  return payload;
};

export const clinicalErrors = (payload, { required = true, encounterDate = payload.consultationDate, previousMedications = [] } = {}) => {
  const errors = { ...validateConsultationDateTime(payload, { required }), ...validateConsultationVitals(payload, { required }),
    ...validateConsultationMedications(payload.medications, { previous: previousMedications }) };
  if (!payload.residentId) errors.residentId = 'Select a resident from the authorized registry.';
  if (required) {
    if (!text(payload.chiefComplaint)) errors.chiefComplaint = 'Chief complaint is required.';
    if (!text(payload.findings)) errors.findings = 'Clinical findings are required.';
  }
  if ((payload.followUpRequired === 'Yes' || payload.nextVisitDate)
    && (validateConsultationDateTime({ consultationDate: payload.nextVisitDate }).consultationDate || (encounterDate && payload.nextVisitDate < encounterDate))) errors.nextVisitDate = 'Set a valid follow-up date on or after the encounter.';
  if (payload.clinicalContext) {
    if (!['unknown', 'not_pregnant', 'pregnant', 'postpartum'].includes(payload.clinicalContext.pregnancyStatus)) errors['clinicalContext.pregnancyStatus'] = 'Select a valid pregnancy status.';
    if (!Array.isArray(payload.clinicalContext.existingConditions) || payload.clinicalContext.existingConditions.length > 50) errors['clinicalContext.existingConditions'] = 'Use up to 50 structured conditions.';
    (Array.isArray(payload.clinicalContext.existingConditions) ? payload.clinicalContext.existingConditions : []).forEach((condition, index) => {
      if (typeof condition?.name !== 'string' || !text(condition.name) || text(condition.name).length > 160) errors[`clinicalContext.existingConditions[${index}].name`] = 'Enter a condition name of up to 160 characters.';
      if (!['stable', 'uncontrolled'].includes(condition?.status) || typeof condition?.significant !== 'boolean') errors[`clinicalContext.existingConditions[${index}]`] = 'Choose stable or uncontrolled and confirm clinical significance.';
    });
  }
  if (payload.riskReview && (!['Low', 'Medium', 'High'].includes(payload.riskReview.level) || !text(payload.riskReview.reason)
    || text(payload.riskReview.reason).length > 1000 || payload.riskReview.reassessmentConfirmed !== true)) errors.riskReview = 'Choose a classification, document a clinical reason (1-1000 characters), and explicitly confirm reassessment.';
  return errors;
};

export const requireServerConsultation = (response, expectedId = null) => {
  const record = response?.consultation;
  if (!record?.id || !(record.resident?.id || record.residentId) || (!record.consultationDate && expectedId === null) || (expectedId !== null && String(record.id) !== String(expectedId))) {
    throw new Error('The server did not confirm the complete consultation. Reload the record before retrying.');
  }
  return record;
};

/**
 * Persists a completed PHN check-up from PhnCheckupWorkbench and refreshes both
 * the consultations list and the PHN workflow queue.
 */
export const completePhnHealthRecordCheckup = async ({
  checkup,
  recorded,
  completeCheckup,
  refreshRecords,
  refreshQueue,
}) => {
  if (!checkup?.id) throw new Error('No active PHN check-up selected.');
  await completeCheckup(checkup.id, recorded);
  await Promise.all([refreshRecords?.(), refreshQueue?.()]);
};
