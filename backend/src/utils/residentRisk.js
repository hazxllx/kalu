/**
 * @module utils/residentRisk
 * @description KALUSAGAP RESIDENT risk engine — the SINGLE authoritative, rule-based risk
 * calculation for an individual resident.
 *
 * Architectural layer:
 *   `route -> authenticate -> authorize -> controller -> service (uses utils/residentRisk + services/riskConfig.service.js) -> repository/Supabase`
 *
 * This module is PURE (no I/O): it takes a resident's recorded health data (or
 * raw consultation vitals) and a risk configuration (criteria + thresholds) and
 * returns a deterministic `{ score, level, factors }`. Every screen that shows a
 * resident's risk — Resident Directory, Resident Detail, Health Trends, Early
 * Warning, dashboards — resolves it through this one engine, so a resident can
 * never be classified differently on different pages.
 *
 * The flow is `HEALTH DATA -> RISK CRITERIA -> RISK SCORE -> RISK LEVEL`:
 *   1. `healthDataFromVitals` normalizes recorded vitals into numeric fields,
 *   2. each ENABLED criterion is evaluated against those fields,
 *   3. the weights of the matching criteria are summed into a score,
 *   4. the score is classified against the configured thresholds.
 *
 * It is rule-based only — no machine learning, prediction or randomness. The
 * configuration is supplied by `services/riskConfig.service.js` (database or
 * the documented defaults in `config/riskConfig.js`); this engine never trusts
 * a client-supplied score or level.
 */
import { computeBMI } from './bmi.js';
import { DEFAULT_RISK_CONFIG, DEFAULT_RISK_THRESHOLDS } from '../config/riskConfig.js';
import { consultationAssessmentReasons, consultationChronology, isAuthorizedRiskReview, normalizeConsultationRiskLevel,
  previousConsultationAssessment, savedConsultationAssessment } from '../../../shared/consultationClinical.js';

/**
 * Coerces a raw measurement or threshold bound to a finite number, returning `null`
 * for `null`, `undefined`, non-numeric strings, or blank/whitespace strings
 * (guarding against `Number('') === 0` falsely matching `lt`/`lte` criteria).
 *
 * @param {*} value - Raw value to parse.
 * @returns {number|null} Finite numeric value, or `null` when missing/invalid.
 */
const toNumber = (value) => {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (value === null || value === undefined || String(value).trim() === '') return null;
  if (typeof value === 'string' && !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim())) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const measurementNumber = (value) => {
  const number = toNumber(value);
  return number !== null && number > 0 ? number : null;
};

const FIELD_LABELS = {
  systolic: 'systolic blood pressure', diastolic: 'diastolic blood pressure',
  o2sat: 'oxygen saturation', temperature: 'temperature', pulse: 'pulse rate',
  respiratory: 'respiratory rate', bmi: 'body mass index',
};

/** Match the database's deterministic latest-visit ordering across risk consumers. */
export const isLaterVisit = (visit, current) => {
  if (!current) return true;
  const aDate = consultationChronology(visit);
  const bDate = consultationChronology(current);
  if (aDate !== bDate) return aDate > bDate;
  for (const field of ['updatedAt', 'createdAt']) {
    const a = Date.parse(visit[field] || visit.createdAt || '') || 0;
    const b = Date.parse(current[field] || current.createdAt || '') || 0;
    if (a !== b) return a > b;
  }
  return String(visit.id || '') > String(current.id || '');
};

/**
 * Normalizes recorded consultation vitals (`{ bp, o2sat, temperature, hr, rr,
 * heightCm, weightKg }`) into the canonical numeric health-data fields targeted
 * by risk criteria. Extracts 2-to-3-digit systolic/diastolic values from `bp`,
 * maps `hr -> pulse` and `rr -> respiratory`, and recomputes `bmi` server-side.
 * Missing or unparseable fields become `null` and never match any criterion.
 *
 * @param {Object} [vitals={}] - Raw consultation vitals object.
 * @returns {Object} Normalized numeric fields `{ systolic, diastolic, o2sat, temperature, pulse, respiratory, bmi }`.
 */
export const healthDataFromVitals = (vitals = {}) => {
  const bp = String(vitals?.bp ?? '');
  const m = /^\s*(\d{2,3})\s*\/\s*(\d{2,3})\s*$/.exec(bp);
  const systolic = m ? measurementNumber(m[1]) : null;
  const diastolic = m ? measurementNumber(m[2]) : null;
  const { bmi } = computeBMI(measurementNumber(vitals?.heightCm), measurementNumber(vitals?.weightKg));
  return {
    systolic,
    diastolic,
    o2sat: measurementNumber(vitals?.o2sat),
    temperature: measurementNumber(vitals?.temperature),
    pulse: measurementNumber(vitals?.hr),
    respiratory: measurementNumber(vitals?.rr),
    bmi: measurementNumber(bmi),
  };
};

/**
 * Returns true when the configured assessment can produce a risk level.
 * A partial negative finding cannot establish Low risk.
 *
 * @param {Object} [vitals={}] - Raw consultation vitals object.
 * @param {Object} [config=DEFAULT_RISK_CONFIG] - Active configured criteria and thresholds.
 * @returns {boolean} True when sufficient measurements or positive configured findings exist.
 */
export const hasAssessableVitals = (vitals = {}, config = DEFAULT_RISK_CONFIG) =>
  assessVitals(vitals, config).level !== null;

/**
 * Evaluates a single risk criterion against normalized health data.
 * Supports `'gte'`, `'gt'`, `'lte'`, `'lt'`, `'eq'`, and inclusive `'between'`
 * (`[value, value2]`). Returns `false` when the measured field or required
 * threshold bound is missing or when the operator is unrecognized.
 *
 * @param {Object} [criterion={}] - Risk rule definition (`{ field, operator, value, value2 }`).
 * @param {Object} [healthData={}] - Normalized numeric health measurements.
 * @returns {boolean} `true` if the measured value satisfies the criterion.
 */
export const evaluateCriterion = (criterion = {}, healthData = {}) => {
  const measured = measurementNumber(healthData?.[criterion.field]);
  if (measured === null) return false;
  const a = toNumber(criterion.value);
  switch (criterion.operator) {
    case 'gte': return a !== null && measured >= a;
    case 'gt': return a !== null && measured > a;
    case 'lte': return a !== null && measured <= a;
    case 'lt': return a !== null && measured < a;
    case 'eq': return a !== null && measured === a;
    case 'between': {
      const b = toNumber(criterion.value2);
      return a !== null && b !== null && measured >= a && measured <= b;
    }
    default: return false;
  }
};

/**
 * Maps an accumulated resident risk score to `'Low'`, `'Moderate'`, or `'High'`
 * using the configured `moderateMin` and `highMin` cutoffs (falling back to
 * `DEFAULT_RISK_THRESHOLDS` when omitted).
 *
 * @param {number} score - Total weighted risk score.
 * @param {Object} [thresholds=DEFAULT_RISK_THRESHOLDS] - `{ moderateMin, highMin }` cutoffs.
 * @returns {string} `'High'`, `'Moderate'`, or `'Low'`.
 */
export const classifyLevel = (score, thresholds = DEFAULT_RISK_THRESHOLDS) => {
  const moderateMin = Number(thresholds?.moderateMin ?? DEFAULT_RISK_THRESHOLDS.moderateMin);
  const highMin = Number(thresholds?.highMin ?? DEFAULT_RISK_THRESHOLDS.highMin);
  if (Number(score) >= highMin) return 'High';
  if (Number(score) >= moderateMin) return 'Moderate';
  return 'Low';
};

/**
 * Deterministically orders criteria by ascending `priority` with alphabetical
 * `code` tie-breaking so matched `factors` render in a consistent sequence.
 */
const sortCriteria = (criteria) =>
  [...criteria].sort(
    (a, b) =>
      (Number(a.priority ?? 0) - Number(b.priority ?? 0)) ||
      String(a.code ?? '').localeCompare(String(b.code ?? '')),
  );

/**
 * Evaluates normalized health data against all enabled criteria in a risk
 * configuration (criteria are enabled unless `enabled === false`), summing
 * matched weights and classifying the resulting score.
 *
 * `factors` lists only the criteria that matched, capturing `{ code, name,
 * field, measured, weight }` — the exact breakdown rendered on Resident Detail.
 *
 * @param {Object} [healthData={}] - Normalized numeric health fields from `healthDataFromVitals`.
 * @param {Object} [config=DEFAULT_RISK_CONFIG] - Risk configuration (`{ criteria, thresholds }`).
 * @returns {Object} `{ score: number, level: string, factors: Array<Object> }`.
 */
export const assessHealthData = (healthData = {}, config = DEFAULT_RISK_CONFIG) => {
  const thresholds = config?.thresholds || DEFAULT_RISK_THRESHOLDS;
  const criteria = sortCriteria((config?.criteria || []).filter((c) => c && c.enabled !== false));
  const fields = [...new Set(criteria.map((criterion) => criterion.field))].sort();
  const missingMeasurements = fields.filter((field) => measurementNumber(healthData?.[field]) === null);
  const available = fields.length > missingMeasurements.length;
  const factors = [];
  let score = 0;
  for (const c of criteria) {
    if (evaluateCriterion(c, healthData)) {
      const weight = Number(c.weight) || 0;
      score += weight;
      factors.push({
        code: c.code,
        name: c.name,
        field: c.field,
        measured: measurementNumber(healthData[c.field]),
        weight,
      });
    }
  }
  const classified = classifyLevel(score, thresholds);
  const incomplete = available && missingMeasurements.length > 0 && classified === 'Low';
  const status = !available ? 'unavailable' : incomplete ? 'incomplete' : 'assessed';
  const missingReason = `Missing measurements: ${missingMeasurements.map((field) => FIELD_LABELS[field] || field).join(', ')}.`;
  let reason = !available
    ? 'No measurements required by the configured risk criteria are available.'
    : incomplete
      ? `Assessment incomplete. ${missingReason}`
      : factors.length
        ? factors.map((factor) => `${factor.name} (${factor.measured})`).join('; ')
        : 'No configured risk criteria matched the recorded measurements.';
  if (status === 'assessed' && missingMeasurements.length) reason += ` ${missingReason}`;
  return { score: available ? score : null, level: status === 'assessed' ? classified : null,
    factors, status, missingMeasurements, reason };
};

/**
 * Convenience pipeline that normalizes raw consultation vitals via
 * `healthDataFromVitals` and immediately evaluates them via `assessHealthData`.
 *
 * @param {Object} [vitals={}] - Raw consultation vitals object.
 * @param {Object} [config=DEFAULT_RISK_CONFIG] - Risk configuration (`{ criteria, thresholds }`).
 * @returns {Object} `{ score: number, level: string, factors: Array<Object> }`.
 */
export const assessVitals = (vitals = {}, config = DEFAULT_RISK_CONFIG) =>
  assessHealthData(healthDataFromVitals(vitals), config);

/** Positive legacy evidence is sourced to recorded measurements, never to an unsourced master Low/High. */
export const riskHistoryVisit = (visit, config = DEFAULT_RISK_CONFIG) => {
  const details = visit?.consultationDetails || {};
  const saved = savedConsultationAssessment(details);
  const reviews = [...(Array.isArray(details.riskReviewHistory) ? details.riskReviewHistory : []), details.consultationRiskAssessment?.review].filter(isAuthorizedRiskReview);
  if (details.consultationRiskAssessment || saved?.reviewStatus === 'approved'
    || normalizeConsultationRiskLevel(saved?.level ?? saved?.riskLevel ?? saved?.risk_level) === 'High'
    || reviews.some((review) => review.level !== 'High')) return visit;
  const weighted = assessVitals(visit?.vitals, config);
  if (weighted.level !== 'High' || !consultationChronology(visit)) return visit;
  const legacy = { level: 'High', status: 'assessed', riskSource: 'legacy_weighted_measurements',
    reviewStatus: 'professional_review_required', decisionSupport: true, missingMeasurements: weighted.missingMeasurements,
    reasons: weighted.factors.map((factor) => ({ ruleId: factor.code, field: factor.field,
      message: `${factor.name} (${factor.measured}): positive recorded legacy risk evidence, not an approved clinical protocol.` })),
    sourceConfig: { updatedAt: config.updatedAt || null, thresholds: config.thresholds, matchedCriteria: weighted.factors },
    sources: [{ type: 'legacy_recorded_vitals', id: visit.id }] };
  return { ...visit, consultationDetails: { ...details, consultationRiskAssessment: legacy } };
};

/** Saved clinical screening overrides weighted scoring without losing an unresolved, sourced High. */
export const assessVisitRisk = (visit, config = DEFAULT_RISK_CONFIG, history = []) => {
  const weighted = assessVitals(visit?.vitals, config);
  const details = visit?.consultationDetails || {};
  const saved = savedConsultationAssessment(details);
  const clinical = details.clinicalAssessment;
  const screening = details.consultationRiskAssessment;
  const eligible = saved && (saved === screening || saved.reviewStatus === 'approved'
    || normalizeConsultationRiskLevel(saved.level ?? saved.riskLevel ?? saved.risk_level) === 'High'
    || consultationAssessmentReasons(saved).some((reason) => ['bp_emergency', 'bp_severe'].includes(reason.ruleId)));
  const prior = previousConsultationAssessment(history.filter((row) => row.residentId === visit?.residentId).map((row) => riskHistoryVisit(row, config)),
    { asOf: consultationChronology(visit), excludeVisitId: visit?.id });
  const reviewed = [...(Array.isArray(details.riskReviewHistory) ? details.riskReviewHistory : []), screening?.review].filter(isAuthorizedRiskReview).at(-1);
  const hold = prior?.level === 'High' && (!reviewed || reviewed.level === 'High');
  if (!eligible && !hold) return weighted;
  const level = hold ? 'High' : normalizeConsultationRiskLevel(saved?.level ?? saved?.riskLevel ?? saved?.risk_level);
  const reasons = consultationAssessmentReasons(saved).slice();
  if (hold && !reasons.some((reason) => reason.ruleId === 'previous_high_held')) reasons.push({ ruleId: 'previous_high_held',
    message: 'A previous saved High assessment is retained until an authorized professional documents a confirmed reassessment and reason.' });
  const factors = reasons.map((reason) => ({ ...reason, code: reason.ruleId || 'clinical_assessment',
    name: reason.message || (reason.field || reason.ruleId || 'Clinical assessment').replaceAll('_', ' '),
    field: reason.field || null, measured: null, weight: null, source: 'consultation' }));
  return { score: null, level: level === 'Medium' ? 'Moderate' : level, factors,
    status: level ? 'assessed' : saved?.status || 'unavailable', missingMeasurements: Array.isArray(saved?.missingMeasurements) ? saved.missingMeasurements : weighted.missingMeasurements,
    reason: reasons.map((reason) => reason.message || (reason.field || reason.ruleId || '').replaceAll('_', ' ')).filter(Boolean).join('; '),
    riskSource: hold ? 'saved_high_hold' : saved === screening ? 'consultation_screening' : 'saved_clinical_assessment',
    ...(hold ? { previousAssessment: prior } : {}),
    ...(screening ? { consultationRiskAssessment: screening } : {}), ...(clinical ? { clinicalAssessment: clinical } : {}) };
};

export default {
  healthDataFromVitals,
  hasAssessableVitals,
  evaluateCriterion,
  classifyLevel,
  assessHealthData,
  assessVitals,
};
