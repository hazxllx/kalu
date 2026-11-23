// Shared classification rules and validation for saved admin thresholds.
import {
  DEFAULT_BP_THRESHOLDS, BP_CATEGORIES, BP_READING_BOUNDS,
  parseBloodPressure, classifyBloodPressure, getBloodPressureConfig,
  setBloodPressureConfig,
} from '../../../shared/bloodPressure.js';
export {
  DEFAULT_BP_THRESHOLDS, BP_CATEGORIES, BP_READING_BOUNDS,
  parseBloodPressure, classifyBloodPressure, getBloodPressureConfig,
  setBloodPressureConfig,
};

/**
 * Coerce a candidate value to a finite number, returning `null` for blank,
 * nullish, or non-numeric inputs so callers never treat `""` or `null` as `0`.
 *
 * @param {*} value
 * @returns {number|null}
 */
const num = (value) => {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

/**
 * Merge a (possibly partial / invalid) settings object over the defaults. Any
 * missing or non-numeric field falls back to the default so the thresholds are
 * always complete and usable.
 */
export const resolveThresholds = (settings = null) => {
  const out = { ...DEFAULT_BP_THRESHOLDS };
  if (settings && typeof settings === 'object') {
    for (const key of Object.keys(DEFAULT_BP_THRESHOLDS)) {
      const v = num(settings[key]);
      if (v !== null) out[key] = v;
    }
  }
  return out;
};

/**
 * Validate and normalize an admin BP threshold update payload.
 *
 * Ensures every threshold key in `DEFAULT_BP_THRESHOLDS` is a finite number
 * within `[1, BP_READING_BOUNDS.max]`, rounds values to integers, and checks
 * strict monotonic ordering across systolic (`Low < Elevated < Stage 1 < Stage 2 < Crisis`)
 * and diastolic (`Low < Stage 1 < Stage 2 < Crisis`) cut-offs — mirroring the
 * `public.bp_threshold_settings` database check constraints.
 *
 * Does not throw: returns `{ errors, thresholds }`, where `thresholds` is `null`
 * whenever `errors` is non-empty so the calling service can surface HTTP 422.
 *
 * @param {Object} [payload]
 * @returns {{ errors: string[], thresholds: Object|null }}
 */
export const validateThresholdPayload = (payload = {}) => {
  const out = {};
  const errors = [];
  for (const key of Object.keys(DEFAULT_BP_THRESHOLDS)) {
    const v = num(payload[key]);
    if (v === null) {
      errors.push(`${key} must be a number.`);
    } else if (v <= 0 || v > BP_READING_BOUNDS.max) {
      errors.push(`${key} must be between 1 and ${BP_READING_BOUNDS.max}.`);
    } else {
      out[key] = Math.round(v);
    }
  }
  if (errors.length) return { errors, thresholds: null };

  // Non-overlapping, non-contradictory ordering (mirrors the DB check).
  if (!(out.lowSystolicMax < out.elevatedSystolicMin
    && out.elevatedSystolicMin < out.stage1SystolicMin
    && out.stage1SystolicMin < out.stage2SystolicMin
    && out.stage2SystolicMin < out.crisisSystolicMin)) {
    errors.push('Systolic cut-offs must increase: Low < Elevated < Stage 1 < Stage 2 < Crisis.');
  }
  if (!(out.lowDiastolicMax < out.stage1DiastolicMin
    && out.stage1DiastolicMin < out.stage2DiastolicMin
    && out.stage2DiastolicMin < out.crisisDiastolicMin)) {
    errors.push('Diastolic cut-offs must increase: Low < Stage 1 < Stage 2 < Crisis.');
  }
  return { errors, thresholds: errors.length ? null : out };
};

export default {
  DEFAULT_BP_THRESHOLDS,
  BP_CATEGORIES,
  BP_READING_BOUNDS,
  resolveThresholds,
  parseBloodPressure,
  classifyBloodPressure,
  getBloodPressureConfig,
  setBloodPressureConfig,
  validateThresholdPayload,
};
