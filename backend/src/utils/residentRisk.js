/**
 * KALUSAGAP RESIDENT risk engine — the SINGLE authoritative, rule-based risk
 * calculation for an individual resident.
 *
 * This module is PURE (no I/O): it takes a resident's recorded health data (or
 * raw consultation vitals) and a risk configuration (criteria + thresholds) and
 * returns a deterministic { score, level, factors }. Every screen that shows a
 * resident's risk — Resident Directory, Resident Detail, Health Trends, Early
 * Warning, dashboards — resolves it through this one engine, so a resident can
 * never be classified differently on different pages.
 *
 * The flow is HEALTH DATA -> RISK CRITERIA -> RISK SCORE -> RISK LEVEL:
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

const toNumber = (value) => {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

/**
 * Normalize recorded consultation vitals (domain shape: { bp, o2sat,
 * temperature, hr, rr, heightCm, weightKg }) into the numeric health-data
 * fields the criteria target. Missing/unparseable values become null and never
 * match a criterion.
 */
export const healthDataFromVitals = (vitals = {}) => {
  const bp = String(vitals?.bp ?? '');
  const m = /(\d{2,3})\s*\/\s*(\d{2,3})/.exec(bp);
  const systolic = m ? Number(m[1]) : null;
  const diastolic = m ? Number(m[2]) : null;
  const { bmi } = computeBMI(vitals?.heightCm, vitals?.weightKg);
  return {
    systolic,
    diastolic,
    o2sat: toNumber(vitals?.o2sat),
    temperature: toNumber(vitals?.temperature),
    pulse: toNumber(vitals?.hr),
    respiratory: toNumber(vitals?.rr),
    bmi: toNumber(bmi),
  };
};

/** True when recorded vitals carry at least one assessable numeric field. */
export const hasAssessableVitals = (vitals = {}) =>
  Object.values(healthDataFromVitals(vitals)).some((v) => v !== null);

/** Evaluate one criterion against the normalized health data. */
export const evaluateCriterion = (criterion = {}, healthData = {}) => {
  const measured = toNumber(healthData?.[criterion.field]);
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

/** Classify a total score against thresholds. */
export const classifyLevel = (score, thresholds = DEFAULT_RISK_THRESHOLDS) => {
  const moderateMin = Number(thresholds?.moderateMin ?? DEFAULT_RISK_THRESHOLDS.moderateMin);
  const highMin = Number(thresholds?.highMin ?? DEFAULT_RISK_THRESHOLDS.highMin);
  if (Number(score) >= highMin) return 'High';
  if (Number(score) >= moderateMin) return 'Moderate';
  return 'Low';
};

const sortCriteria = (criteria) =>
  [...criteria].sort(
    (a, b) =>
      (Number(a.priority ?? 0) - Number(b.priority ?? 0)) ||
      String(a.code ?? '').localeCompare(String(b.code ?? '')),
  );

/**
 * Assess normalized health data against a configuration.
 * @returns {{ score:number, level:'Low'|'Moderate'|'High', factors:Array }}
 *   `factors` lists only the criteria that applied, with the measured value and
 *   the weight each contributed — exactly what the Resident Detail breakdown
 *   renders.
 */
export const assessHealthData = (healthData = {}, config = DEFAULT_RISK_CONFIG) => {
  const thresholds = config?.thresholds || DEFAULT_RISK_THRESHOLDS;
  const criteria = sortCriteria((config?.criteria || []).filter((c) => c && c.enabled !== false));
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
        measured: toNumber(healthData[c.field]),
        weight,
      });
    }
  }
  return { score, level: classifyLevel(score, thresholds), factors };
};

/** Convenience: assess directly from raw recorded vitals. */
export const assessVitals = (vitals = {}, config = DEFAULT_RISK_CONFIG) =>
  assessHealthData(healthDataFromVitals(vitals), config);

export default {
  healthDataFromVitals,
  hasAssessableVitals,
  evaluateCriterion,
  classifyLevel,
  assessHealthData,
  assessVitals,
};
