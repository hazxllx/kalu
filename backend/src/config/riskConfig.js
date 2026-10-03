/**
 * Rule-based RESIDENT health-risk configuration — the DEFAULT (seed) criteria
 * and thresholds for the single authoritative risk engine
 * (`utils/residentRisk.js`).
 *
 * SOURCE OF TRUTH: resident risk is derived HEALTH DATA -> RISK CRITERIA ->
 * RISK SCORE -> RISK LEVEL. The criteria and thresholds below are the fallback
 * configuration used when the database configuration tables
 * (`public.risk_criteria` / `public.risk_settings`) are empty or not yet
 * applied. When those tables are populated they override these defaults; see
 * `services/riskConfig.service.js`.
 *
 * IMPORTANT — not invented clinical guidelines. These defaults are a faithful,
 * scored re-expression of the risk rule the system ALREADY applied to residents
 * (the vitals heuristic in `analytics.service.riskFromVitals`):
 *
 *     systolic BP >= 140  OR  SpO2 < 95   =>  High
 *     systolic BP 130..139                =>  Moderate
 *     otherwise                           =>  Low
 *
 * With the default thresholds (Moderate >= 40, High >= 70) the scored criteria
 * below reproduce that exact classification, while making the criteria and
 * thresholds centrally configurable and persistable. No new medical rule is
 * introduced; only the project's existing behavior is made data-driven.
 */

/** Default classification thresholds. Low: 0..moderateMin-1, Moderate:
 *  moderateMin..highMin-1, High: >= highMin. Matches "Low 0–39 / Moderate
 *  40–69 / High 70+". */
export const DEFAULT_RISK_THRESHOLDS = Object.freeze({
  moderateMin: 40,
  highMin: 70,
});

/** Health-data fields the engine can evaluate (extracted from recorded
 *  consultation vitals). Admin criteria may target any of these. */
export const RISK_FIELDS = Object.freeze([
  { field: 'systolic', label: 'Systolic blood pressure', unit: 'mmHg' },
  { field: 'diastolic', label: 'Diastolic blood pressure', unit: 'mmHg' },
  { field: 'o2sat', label: 'Oxygen saturation (SpO2)', unit: '%' },
  { field: 'temperature', label: 'Temperature', unit: '°C' },
  { field: 'pulse', label: 'Pulse rate', unit: 'bpm' },
  { field: 'respiratory', label: 'Respiratory rate', unit: '/min' },
  { field: 'bmi', label: 'Body mass index', unit: 'kg/m²' },
]);

export const RISK_OPERATORS = Object.freeze(['gte', 'gt', 'lte', 'lt', 'eq', 'between']);

/** Seed criteria. `code` is the stable identifier; `priority` orders the
 *  breakdown; `weight` is the score added when the criterion matches. */
export const DEFAULT_RISK_CRITERIA = Object.freeze([
  {
    code: 'bp_systolic_high',
    name: 'High blood pressure',
    description: 'Systolic blood pressure of 140 mmHg or higher (recorded vitals).',
    field: 'systolic',
    operator: 'gte',
    value: 140,
    value2: null,
    weight: 70,
    enabled: true,
    priority: 10,
  },
  {
    code: 'o2sat_low',
    name: 'Low oxygen saturation',
    description: 'Oxygen saturation (SpO2) below 95% (recorded vitals).',
    field: 'o2sat',
    operator: 'lt',
    value: 95,
    value2: null,
    weight: 70,
    enabled: true,
    priority: 20,
  },
  {
    code: 'bp_systolic_elevated',
    name: 'Elevated blood pressure',
    description: 'Systolic blood pressure between 130 and 139 mmHg (recorded vitals).',
    field: 'systolic',
    operator: 'between',
    value: 130,
    value2: 139,
    weight: 40,
    enabled: true,
    priority: 30,
  },
]);

export const DEFAULT_RISK_CONFIG = Object.freeze({
  thresholds: DEFAULT_RISK_THRESHOLDS,
  criteria: DEFAULT_RISK_CRITERIA,
});

export default {
  DEFAULT_RISK_CONFIG,
  DEFAULT_RISK_CRITERIA,
  DEFAULT_RISK_THRESHOLDS,
  RISK_FIELDS,
  RISK_OPERATORS,
};
