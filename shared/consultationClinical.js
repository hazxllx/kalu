// shared/consultationClinical.js
import { BP_READING_BOUNDS, classifyBloodPressure, parseBloodPressure } from './bloodPressure.js';

const text = (value) => typeof value === 'string' ? value.trim() : '';
const object = (value) => value && typeof value === 'object' && !Array.isArray(value);
const numericText = (value) => value === null || value === undefined || value === '' ? null : Number(value);

export const CONSULTATION_SCREENING_VERSION = 'consultation-screening-v1';
export const CONSULTATION_VITAL_ALIASES = Object.freeze({
  bloodPressure: ['bloodPressure', 'bp'], temperature: ['temperature', 'temp'],
  pulseRate: ['pulseRate', 'hr', 'pulse'], respiratoryRate: ['respiratoryRate', 'rr', 'respiratory'],
  height: ['height', 'heightCm', 'height_cm'], weight: ['weight', 'weightKg', 'weight_kg'],
  oxygenSaturation: ['oxygenSaturation', 'o2sat', 'spo2'], bmi: ['bmi'],
});
export const CONSULTATION_VITAL_RANGES = Object.freeze({
  temperature: Object.freeze({ min: 30, max: 43, label: 'Temperature (°C)' }),
  pulseRate: Object.freeze({ min: 20, max: 250, label: 'Pulse rate (bpm)', wholeNumber: true }),
  respiratoryRate: Object.freeze({ min: 5, max: 80, label: 'Respiratory rate (breaths/min)', wholeNumber: true }),
  height: Object.freeze({ min: 30, max: 250, label: 'Height (cm)' }),
  weight: Object.freeze({ min: 0.5, max: 400, label: 'Weight (kg)' }),
  oxygenSaturation: Object.freeze({ min: 50, max: 100, label: 'Oxygen saturation (%)' }),
});

export const clinicalTextIndicatesPregnancy = (clinicalText) => String(clinicalText ?? '')
  .toLowerCase()
  .split(/[\n;.!?]|,\s*|\b(?:but|however|although)\b/)
  .some((clause) => [...clause.matchAll(/\b(?:pregnant|pregnancy)\b/g)].some((match) => {
    const before = clause.slice(0, match.index);
    const after = clause.slice(match.index + match[0].length);
    const negatedBefore = /\b(?:no|not|denies|denied|negative\s+for|without|rule(?:s|d)?\s+out|exclude[ds]?)\b(?:\W+\w+){0,3}\W*$/.test(before);
    const negatedAfter = /^\s*(?:not\s+(?:confirmed|established|detected|present)|(?:rule(?:s|d)?\s+out)|negative)\b/.test(after);
    return !negatedBefore && !negatedAfter;
  }));

export const PRESCRIPTION_ROUTES = Object.freeze([
  ['Oral', 'Oral'], ['Sublingual', 'Sublingual'], ['Buccal', 'Buccal'],
  ['Topical', 'Topical'], ['Inhalation', 'Inhalation'], ['Intranasal', 'Nasal'],
  ['Ophthalmic', 'Ophthalmic'], ['Otic', 'Otic'], ['Rectal', 'Rectal'], ['Vaginal', 'Vaginal'],
  ['Intramuscular', 'Intramuscular (IM)'], ['Subcutaneous', 'Subcutaneous (SC)'], ['Intravenous', 'Intravenous (IV)'],
  ['Other / As prescribed', 'Other / As prescribed'],
].map(([value, label]) => Object.freeze({ value, label })));
export const PRESCRIPTION_FREQUENCIES = Object.freeze([
  ['Once daily', 'Once daily'], ['Twice daily', 'Twice daily'], ['Three times daily', 'Three times daily'],
  ['Every 4 hours', 'Every 4 hours'],
  ['Every 6 hours', 'Every 6 hours'], ['Every 8 hours', 'Every 8 hours'], ['Every 12 hours', 'Every 12 hours'],
  ['As prescribed', 'As prescribed'], ['As needed', 'As needed (PRN)'],
].map(([value, label]) => Object.freeze({ value, label })));

export const PRESCRIPTION_FREQUENCY_PER_DAY = Object.freeze({
  'Once daily': 1, 'Twice daily': 2, 'Three times daily': 3,
  'Every 4 hours': 6, 'Every 6 hours': 4, 'Every 8 hours': 3, 'Every 12 hours': 2,
});

// Handles calculatePrescriptionQuantity logic.
export function calculatePrescriptionQuantity(frequency, duration) {
  const days = Number(duration);
  const perDay = PRESCRIPTION_FREQUENCY_PER_DAY[frequency];
  if (!Number.isInteger(days) || days <= 0 || !perDay) return '';
  const quantity = perDay * days;
  return Number.isSafeInteger(quantity) && quantity <= 10000 ? String(quantity) : '';
}

const PRESCRIPTION_LIMITS = Object.freeze({ genericName: 160, brandName: 160, strength: 80, dosageForm: 80,
  dose: 120, route: 80, frequency: 120, duration: 20, quantity: 20, instructions: 400, medicineId: 160 });
const prescriptionSignature = (row) => JSON.stringify(Object.keys(PRESCRIPTION_LIMITS).map((field) =>
  row?.[field] ?? (field === 'genericName' ? row?.name ?? '' : field === 'medicineId' ? null : '')));

// Handles validateConsultationMedications logic.
export function validateConsultationMedications(medications, { previous = [] } = {}) {
  if (medications === undefined) return {};
  if (!Array.isArray(medications) || medications.length > 50) return { medications: 'Use a list of up to 50 prescriptions.' };
  const errors = {};
  const used = new Set();
  for (const [index, row] of medications.entries()) {
    const prefix = `medications[${index}]`;
    if (!object(row)) { errors[prefix] = 'Use a structured prescription entry.'; continue; }
    const oldIndex = previous.findIndex((old, position) => !used.has(position) && prescriptionSignature(row) === prescriptionSignature(old));
    if (oldIndex >= 0) { used.add(oldIndex); continue; }
    for (const key of Object.keys(row)) if (![...Object.keys(PRESCRIPTION_LIMITS), 'name', 'custom', 'source'].includes(key)) errors[`${prefix}.${key}`] = 'This prescription field is not supported.';
    for (const [field, max] of Object.entries(PRESCRIPTION_LIMITS)) {
      const value = field === 'genericName' ? row.genericName ?? row.name : row[field];
      const numericField = ['duration', 'quantity'].includes(field);
      if (numericField && value !== null && value !== undefined && value !== '') {
        const number = numericText(value);
        if (!Number.isFinite(number) || (!Number.isInteger(number) || number < 1)) errors[`${prefix}.${field}`] = 'Enter a valid positive number.';
      } else if (!numericField && value != null && typeof value !== 'string') errors[`${prefix}.${field}`] = 'Use a text value.';
      else if (typeof value === 'string' && value.length > max) errors[`${prefix}.${field}`] = `Use ${max} characters or fewer.`;
      const empty = value === null || value === undefined || (typeof value === 'string' && !value.trim());
      if (['genericName', 'route', 'frequency', 'duration', 'quantity'].includes(field) && empty) errors[`${prefix}.${field}`] = 'This prescription field is required.';
    }
    if (!PRESCRIPTION_ROUTES.some(({ value }) => value === text(row.route))) errors[`${prefix}.route`] = 'Choose a predefined prescription route.';
    if (!PRESCRIPTION_FREQUENCIES.some(({ value }) => value === text(row.frequency))) errors[`${prefix}.frequency`] = 'Choose a predefined prescription frequency.';
    const quantity = numericText(row.quantity);
    if (quantity !== null && (!Number.isInteger(quantity) || quantity < 1 || quantity > 10000)) errors[`${prefix}.quantity`] = 'Quantity must be a whole number from 1 to 10000.';
    const duration = numericText(row.duration);
    if (duration !== null && (!Number.isInteger(duration) || duration < 1 || duration > 3650)) errors[`${prefix}.duration`] = 'Duration must be a whole number of days.';
    const calculatedQuantity = calculatePrescriptionQuantity(text(row.frequency), row.duration);
    if (!calculatedQuantity) {
      if (text(row.frequency) && row.duration) errors[`${prefix}.quantity`] = 'Quantity cannot be calculated until frequency and duration are valid.';
    } else if (String(row.quantity) !== calculatedQuantity) {
      errors[`${prefix}.quantity`] = `Quantity must equal frequency × duration (${calculatedQuantity}).`;
    }
    const catalog = Boolean(text(row.medicineId));
    if (catalog && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(row.medicineId)) errors[`${prefix}.medicineId`] = 'Select a valid catalog medicine.';
    if (row.custom !== undefined && (typeof row.custom !== 'boolean' || row.custom !== !catalog)) errors[`${prefix}.custom`] = 'Custom/catalog choice must agree with the selected medicine.';
    if (row.source !== undefined && ((!catalog && row.source !== 'custom' && row.source !== '')
      || (catalog && !['local', 'yakap', ''].includes(row.source)))) errors[`${prefix}.source`] = 'The source must match the catalog/custom choice.';
  }
  return errors;
}

// Handles getManilaDateTime logic.
export function getManilaDateTime(now = new Date()) {
  const instant = now instanceof Date ? now : new Date(now);
  if (!Number.isFinite(instant.getTime())) return { date: '', time: '' };
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(instant).map(({ type, value }) => [type, value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

// Handles isConsultationDate logic.
export function isConsultationDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000-')) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export const isConsultationTime = (value) => typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);

// Handles validateConsultationDateTime logic.
export function validateConsultationDateTime(payload = {}, { required = true } = {}) {
  const errors = {};
  for (const [field, label, valid] of [
    ['consultationDate', 'Consultation date', isConsultationDate],
    ['consultationTime', 'Consultation time', isConsultationTime],
  ]) {
    if (payload[field] == null || payload[field] === '') {
      if (required) errors[field] = `${label} is required.`;
    } else if (!valid(payload[field])) errors[field] = `${label} must be a valid ${field === 'consultationDate' ? 'calendar date (YYYY-MM-DD)' : 'time (HH:MM)'}.`;
  }
  return errors;
}

// Handles consultationNumber logic.
export function consultationNumber(value) {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && !/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(value.trim())) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

// Handles consultationVitalValues logic.
export function consultationVitalValues(payload = {}) {
  const input = object(payload) ? payload : {};
  const nested = object(input.vitals) ? input.vitals : {};
  const values = Object.fromEntries(Object.entries(CONSULTATION_VITAL_ALIASES).map(([field, aliases]) => {
    for (const source of [input, nested]) {
      const alias = aliases.find((key) => Object.hasOwn(source, key));
      if (alias) return [field, source[alias]];
    }
    return [field, undefined];
  }));
  if (values.bloodPressure === undefined) {
    const source = input.systolic !== undefined || input.diastolic !== undefined ? input : nested;
    if (source.systolic !== undefined || source.diastolic !== undefined) {
      values.bloodPressure = { systolic: source.systolic, diastolic: source.diastolic };
    }
  }
  return values;
}

// Handles calculateConsultationBmi logic.
export function calculateConsultationBmi(height, weight) {
  const h = consultationNumber(height);
  const w = consultationNumber(weight);
  if (h === null || w === null || h < 30 || h > 250 || w < 0.5 || w > 400) return null;
  return Math.round((w / ((h / 100) ** 2)) * 10) / 10;
}

// Handles validateConsultationVitals logic.
export function validateConsultationVitals(payload = {}, { required = true, ranges = CONSULTATION_VITAL_RANGES } = {}) {
  const values = consultationVitalValues(payload);
  const errors = {};
  for (const [field, defaults] of Object.entries(CONSULTATION_VITAL_RANGES)) {
    const { min, max, label, wholeNumber = false } = { ...defaults, ...ranges[field] };
    const value = values[field];
    if (value == null || (typeof value === 'string' && !value.trim())) {
      if (required) errors[field] = `${label} is required.`;
    } else {
      const number = consultationNumber(value);
      if (number === null) errors[field] = `${label} must be a valid number.`;
      else if (number < min || number > max) errors[field] = `${label} must be between ${min} and ${max}. Recheck the measurement and units.`;
      else if (wholeNumber && !Number.isInteger(number)) errors[field] = `${label} must be a whole number.`;
    }
  }
  const bp = values.bloodPressure;
  if (bp == null || (typeof bp === 'string' && !bp.trim())) {
    if (required) errors.bloodPressure = 'Blood pressure is required.';
  } else {
    const match = typeof bp === 'string' ? /^\s*(\d{2,3})\s*\/\s*(\d{2,3})\s*$/.exec(bp) : null;
    const parts = match ? [Number(match[1]), Number(match[2])]
      : object(bp) && !Array.isArray(bp) ? [consultationNumber(bp.systolic), consultationNumber(bp.diastolic)] : null;
    if (!parts || parts.some((value) => value === null || !Number.isInteger(value))) {
      errors.bloodPressure = 'Enter systolic/diastolic blood pressure using whole numbers, for example 120/80.';
    } else {
      const [systolic, diastolic] = parts;
      if (systolic < BP_READING_BOUNDS.min || systolic > BP_READING_BOUNDS.max) {
        errors.bloodPressure = `Systolic pressure must be between ${BP_READING_BOUNDS.min} and ${BP_READING_BOUNDS.max} mmHg.`;
      } else if (diastolic < BP_READING_BOUNDS.diastolicMin || diastolic > BP_READING_BOUNDS.diastolicMax) {
        errors.bloodPressure = `Diastolic pressure must be between ${BP_READING_BOUNDS.diastolicMin} and ${BP_READING_BOUNDS.diastolicMax} mmHg.`;
      } else if (systolic <= diastolic) {
        errors.bloodPressure = 'Systolic pressure must be higher than diastolic pressure.';
      }
    }
  }
  const bmi = calculateConsultationBmi(values.height, values.weight);
  if (required && bmi === null) errors.bmi = 'BMI requires a valid measured height and weight.';
  else if (bmi !== null && (bmi < 3 || bmi > 200)) errors.bmi = 'Calculated BMI is outside the plausible range (3-200). Check height and weight.';
  return errors;
}

// Handles normalizeConsultationClinicalText logic.
export function normalizeConsultationClinicalText(payload = {}) {
  if (payload.findings !== undefined) return { findings: text(payload.findings), diagnosis: text(payload.diagnosis) };
  const merged = text(payload.clinicalFindingsDiagnosis);
  const marker = /^[ \t]*Diagnosis:[ \t]*/im.exec(merged);
  if (marker) return {
    findings: merged.slice(0, marker.index).trim(),
    diagnosis: payload.diagnosis !== undefined ? text(payload.diagnosis) : merged.slice(marker.index + marker[0].length).trim(),
  };
  return { findings: merged, diagnosis: text(payload.diagnosis) };
}

export const normalizeConsultationRiskLevel = (value) => ({ low: 'Low', medium: 'Medium', moderate: 'Medium', high: 'High' })[
  String(value ?? '').trim().toLowerCase().replace(/\s+risk$/, '')
] || null;

// Handles consultationAssessmentReasons logic.
export function consultationAssessmentReasons(assessment) {
  const normalize = (input) => {
    const reason = { ...input };
    for (const field of ['ruleId', 'message', 'field']) if (typeof reason[field] !== 'string') delete reason[field];
    reason.ruleId ||= 'saved_risk_reason';
    reason.message ||= (reason.field || (reason.ruleId === 'saved_risk_reason' ? 'Legacy clinical rationale unavailable' : reason.ruleId)).replaceAll('_', ' ');
    return reason;
  };
  if (Array.isArray(assessment?.reasons)) return assessment.reasons.flatMap((reason) => object(reason) ? [normalize(reason)]
    : typeof reason === 'string' && reason.trim() ? [{ ruleId: 'saved_risk_reason', message: reason }] : []);
  const reason = [assessment?.reasons, assessment?.riskReason, assessment?.risk_reason, assessment?.reason]
    .find((value) => typeof value === 'string' && value.trim());
  return reason ? [{ ruleId: 'saved_risk_reason', message: reason }] : [];
}

/** Read shipped snapshots without inferring risk from complaint, type, or a missing measurement. */
export function savedConsultationAssessment(details = {}) {
  const screening = details.consultationRiskAssessment;
  const clinical = details.clinicalAssessment ?? details.clinical_assessment ?? details.riskAssessment ?? details.risk_assessment
    ?? (Array.isArray(details.clinicalAssessmentHistory) ? details.clinicalAssessmentHistory.at(-1) : null)
    ?? (details.riskLevel != null || details.risk_level != null ? { level: details.riskLevel ?? details.risk_level } : null);
  if (normalizeConsultationRiskLevel(clinical?.level ?? clinical?.riskLevel ?? clinical?.risk_level) === 'High'
    && normalizeConsultationRiskLevel(screening?.level) !== 'High' && !isAuthorizedRiskReview(screening?.review)) return clinical;
  return object(screening) ? screening : clinical;
}

// Handles isAuthorizedRiskReview logic.
export function isAuthorizedRiskReview(review) {
  return object(review) && normalizeConsultationRiskLevel(review.level) !== null
    && review.reassessmentConfirmed === true && typeof review.reason === 'string' && review.reason.trim().length > 0
    && typeof review.reviewedBy === 'string' && review.reviewedBy.length > 0
    && typeof review.reviewedAt === 'string' && Number.isFinite(Date.parse(review.reviewedAt))
    && (['mho', 'phn', 'rhu_personnel'].includes(review.reviewedByRole)
      || (review.reviewedByRole === 'health_supervisor' && review.clinicianAuthority === 'consultation_station'));
}

// Handles consultationChronology logic.
export function consultationChronology(visit = {}) {
  if (!object(visit)) return '';
  const details = visit.consultationDetails ?? visit.consultation_details ?? {};
  const instant = visit.visitDate ?? visit.visit_date;
  const local = isConsultationDate(details.consultationDate) ? {
    date: details.consultationDate, time: isConsultationTime(details.consultationTime) ? details.consultationTime : '00:00',
  } : instant ? getManilaDateTime(instant) : { date: '', time: '' };
  return local.date ? `${local.date}T${local.time}` : '';
}

/** A lower routine screening is not a clinical reassessment of an earlier saved High. */
export function previousConsultationAssessment(visits = [], { asOf = null, excludeVisitId = null } = {}) {
  const rows = visits.filter((visit) => visit.id !== excludeVisitId && consultationChronology(visit)
    && (!asOf || consultationChronology(visit) <= asOf)).sort((a, b) =>
    consultationChronology(b).localeCompare(consultationChronology(a)) || String(b.id).localeCompare(String(a.id)));
  let latest = null;
  for (const visit of rows) {
    const details = visit.consultationDetails ?? visit.consultation_details ?? {};
    const assessment = savedConsultationAssessment(details);
    const level = normalizeConsultationRiskLevel(assessment?.level ?? assessment?.riskLevel ?? assessment?.risk_level);
    const sourced = (value, resolvedLevel = level) => ({ ...value, level: resolvedLevel, reasons: consultationAssessmentReasons(value), sourceVisitId: visit.id,
      consultationDate: consultationChronology(visit).slice(0, 10), consultationTime: consultationChronology(visit).slice(11, 16),
      sources: [...(Array.isArray(value?.sources) ? value.sources : []), { type: 'saved_consultation', id: visit.id }] });
    if (!latest && level) latest = sourced(assessment);
    if (level === 'High') return sourced(assessment);
    const reviews = [...(Array.isArray(details.riskReviewHistory) ? details.riskReviewHistory : []), assessment?.review]
      .filter(isAuthorizedRiskReview);
    const reviewed = reviews.at(-1);
    if (reviewed && reviewed.level !== 'High') return latest || sourced({ ...assessment, review: reviewed }, reviewed.level);
    const historical = [...(Array.isArray(details.consultationRiskAssessmentHistory) ? details.consultationRiskAssessmentHistory : []),
      ...(Array.isArray(details.clinicalAssessmentHistory) ? details.clinicalAssessmentHistory : [])].reverse()
      .find((value) => normalizeConsultationRiskLevel(value?.level ?? value?.riskLevel ?? value?.risk_level) === 'High');
    if (historical) return sourced(historical, 'High');
  }
  return latest;
}

/** Provisional screening decision support. It is never a locally approved clinical protocol. */
export function assessConsultationRisk({ vitals = {}, age = null, indicators = {}, pregnancy = null,
  existingConditions = [], previousAssessment = null, sourceStatus = 'available' } = {}) {
  const values = consultationVitalValues(vitals);
  const errors = validateConsultationVitals(values);
  const missingMeasurements = Object.keys(errors);
  const numbers = Object.fromEntries(Object.keys(CONSULTATION_VITAL_RANGES).map((field) => [field,
    errors[field] ? null : consultationNumber(values[field])]));
  const bp = errors.bloodPressure ? null : classifyBloodPressure(values.bloodPressure, { indicators });
  const bmi = errors.bmi ? null : calculateConsultationBmi(values.height, values.weight);
  const reasons = [];
  let level = 'Low';
  let urgency = null;
  const rank = { Low: 0, Medium: 1, High: 2 };
  const add = (tier, ruleId, message, field, requiredUrgency = null) => {
    if (rank[tier] > rank[level]) level = tier;
    if (requiredUrgency === 'immediate' || (!urgency && requiredUrgency)) urgency = requiredUrgency;
    reasons.push({ ruleId, message, ...(field ? { field } : {}) });
  };
  for (const field of ['severeBreathingDifficulty', 'suspectedStroke', 'severeBleeding', 'alteredConsciousness',
    'convulsions', 'acuteNeurologicalSymptoms', 'difficultySpeaking', 'acuteCardiovascularSymptoms', 'chestPain']) {
    if (indicators?.[field] === true) add('High', 'danger_sign', `Danger sign: ${field.replace(/([A-Z])/g, ' $1').toLowerCase()}. Immediate professional evaluation is needed.`, field, 'immediate');
  }
  if (indicators?.resourcesUnavailable === true) add('High', 'required_resources_unavailable', 'Required clinical resources are unavailable. Arrange referral evaluation.', null, 'prompt');
  if (bp?.code === 'emergency' || bp?.code === 'crisis') add('High', 'bp_crisis_range', bp.message, 'bloodPressure', bp.urgency);
  else if (bp && (bp.systolic >= 180 || bp.diastolic >= 110)) add('High', 'bp_severe_reading', 'Severely elevated blood pressure requires prompt professional evaluation. This screening is not a hypertension or emergency diagnosis.', 'bloodPressure', 'prompt');
  else if (bp && (bp.systolic < 80 || bp.diastolic < 50)) add('High', 'bp_dangerously_low', 'Very low blood pressure requires urgent professional evaluation.', 'bloodPressure', 'prompt');
  else if (bp?.hypotensionPresent) add('Medium', 'bp_low_reading', bp.message, 'bloodPressure');
  else if (bp && bp.code !== 'normal') add('Medium', `bp_${bp.code}`, `${bp.label} blood pressure reading requires clinical review; this is not a diagnosis.`, 'bloodPressure');
  const pregnant = pregnancy === true || pregnancy?.isPregnant === true || pregnancy?.pregnancyStatus === 'pregnant';
  const maternal = pregnant || pregnancy?.isPostpartum === true;
  if (pregnant && bp && (bp.systolic >= 140 || bp.diastolic >= 90)) add('High', 'pregnancy_elevated_bp', 'Blood pressure at or above 140 systolic OR 90 diastolic during pregnancy requires urgent maternal evaluation.', 'bloodPressure', 'prompt');
  if (maternal) for (const field of ['bleeding', 'severeHeadache', 'visualDisturbance', 'severeAbdominalPain', 'reducedFetalMovement']) {
    if (indicators?.[field] === true || pregnancy?.[field] === true) add('High', 'maternal_danger_sign', `Maternal danger sign: ${field.replace(/([A-Z])/g, ' $1').toLowerCase()}.`, field, 'prompt');
  }
  const conditions = Array.isArray(existingConditions) ? existingConditions : [];
  for (const condition of conditions) {
    const name = typeof condition === 'string' ? condition.trim() : text(condition?.name);
    if (!name || condition?.status === 'resolved' || condition?.active === false) continue;
    const uncontrolled = condition?.status === 'uncontrolled';
    const high = condition?.significant === true && (uncontrolled || pregnant);
    add(high ? 'High' : 'Medium',
      uncontrolled ? 'uncontrolled_condition' : pregnant && condition?.significant === true ? 'pregnancy_comorbidity' : 'existing_condition',
      `${name}: ${uncontrolled ? `uncontrolled condition requires ${high ? 'urgent review' : 'clinical management review'}` : pregnant && condition?.significant === true
        ? 'significant additional condition during pregnancy requires maternal review' : 'existing condition requires monitoring'}.`,
      'existingConditions', high ? 'prompt' : null);
  }
  if (!pregnant && conditions.filter((condition) => condition?.significant === true && condition?.active !== false && condition?.status !== 'resolved').length >= 2) {
    add('High', 'multiple_significant_conditions', 'Multiple significant conditions require professional reassessment of care complexity.', 'existingConditions', 'prompt');
  }
  for (const field of ['chronicDisease', 'activeTreatment', 'moderateSymptoms', 'additionalTesting', 'ncdScreeningPositive', 'followUpRequired']) {
    if (indicators?.[field] === true) add('Medium', 'clinical_monitoring', `Clinical monitoring is required: ${field.replace(/([A-Z])/g, ' $1').toLowerCase()}.`, field);
  }
  const numericAge = consultationNumber(age);
  const young = numericAge !== null && numericAge < 12;
  const pulse = young ? numericAge < 1 ? [80, 180, 60, 200] : numericAge < 5 ? [80, 140, 60, 180] : [70, 120, 50, 150] : [60, 100, 40, 130];
  const respiratory = young ? numericAge < 1 ? [30, 60, 20, 70] : numericAge < 5 ? [20, 40, 12, 60] : [15, 30, 8, 40] : [12, 20, 8, 30];
  for (const [field, [normalMin, normalMax, dangerMin, dangerMax]] of [['pulseRate', pulse], ['respiratoryRate', respiratory]]) {
    const number = numbers[field];
    if (number === null) continue;
    if (number <= dangerMin || number >= dangerMax) add('High', `${field}_danger`, `Dangerous ${field === 'pulseRate' ? 'pulse' : 'respiratory'} rate requires urgent professional evaluation.`, field, 'prompt');
    else if (number < normalMin || number > normalMax) add('Medium', `${field}_abnormal`, `Abnormal ${field === 'pulseRate' ? 'pulse' : 'respiratory'} rate requires clinical review.`, field);
  }
  if (numbers.oxygenSaturation !== null) {
    if (numbers.oxygenSaturation <= 92) add('High', 'oxygen_danger', 'Oxygen saturation at or below 92% requires urgent professional evaluation.', 'oxygenSaturation', 'prompt');
    else if (numbers.oxygenSaturation < 96) add('Medium', 'oxygen_abnormal', 'Reduced oxygen saturation requires clinical review.', 'oxygenSaturation');
  }
  if (numbers.temperature !== null) {
    if (numbers.temperature < 35 || numbers.temperature >= 40) add('High', 'temperature_danger', 'Dangerous body temperature requires urgent professional evaluation.', 'temperature', 'prompt');
    else if (numbers.temperature < 36 || numbers.temperature >= 37.5) add('Medium', 'temperature_abnormal', 'Abnormal body temperature requires clinical review.', 'temperature');
  }
  if (bmi !== null && numericAge !== null && numericAge >= 18 && (bmi < 18.5 || bmi >= 25)) {
    add('Medium', 'bmi_abnormal', 'Calculated adult BMI requires nutritional and clinical review.', 'bmi');
  }
  const contextAvailable = sourceStatus === 'available' && Array.isArray(existingConditions);
  const computedLevel = level;
  const previousHighHeld = normalizeConsultationRiskLevel(previousAssessment?.level) === 'High' && Boolean(previousAssessment?.sourceVisitId);
  if (previousHighHeld) add('High', 'previous_high_held', 'A previous saved High assessment is retained until an authorized professional documents a confirmed reassessment and reason.', null);
  if (level === 'Low' && (missingMeasurements.length || !contextAvailable)) level = null;
  if (missingMeasurements.length) reasons.push({ ruleId: 'vitals_incomplete', message: `Missing or invalid measurements: ${missingMeasurements.join(', ')}.` });
  if (!contextAvailable) reasons.push({ ruleId: 'clinical_context_unavailable', message: 'Clinical source data is unavailable or unresolved. Absence of conditions or pregnancy has not been established.' });
  if (level === 'Low') reasons.push({ ruleId: 'normal_complete_screening', message: 'Complete reference-range vitals and no recorded significant additional conditions. Professional review is still required.' });
  const availableCount = 8 - missingMeasurements.length;
  return { level, computedLevel: computedLevel === 'Low' && (missingMeasurements.length || !contextAvailable) ? null : computedLevel,
    status: level !== null ? 'assessed' : availableCount === 0 || !contextAvailable ? 'unavailable' : 'incomplete',
    reasons, missingMeasurements, version: CONSULTATION_SCREENING_VERSION, ruleVersion: CONSULTATION_SCREENING_VERSION,
    reviewStatus: 'professional_review_required', decisionSupport: true, sourceStatus,
    referralEvaluationRequired: urgency !== null, urgency, previousHighHeld,
    ...(previousHighHeld ? { previousAssessment: { ...previousAssessment } } : {}) };
}
