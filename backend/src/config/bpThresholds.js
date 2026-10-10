/**
 * Blood-pressure classification configuration — DEFAULT (fallback) numeric
 * cut-offs and the single authoritative classifier used by the backend.
 *
 * SCREENING GUIDANCE, NOT A DIAGNOSIS. These defaults are the widely used
 * ACC/AHA-style office blood-pressure reference ranges, expressed as
 * configurable numbers so the System Administrator can adjust the cut-offs
 * (public.bp_threshold_settings) without changing code. When the database row
 * is absent or invalid these defaults apply, so classification always works.
 *
 * The ALGORITHM and its precedence are fixed and safe; only the numbers are
 * configurable. Precedence (most severe applicable category wins):
 *   Crisis > Stage 2 > Stage 1 > Low > Elevated > Normal.
 *
 * An empty, incomplete, malformed, negative or physiologically implausible
 * reading is NEVER classified as Normal — the classifier returns null so the
 * UI shows no category.
 */

/** Default numeric cut-offs (mmHg). */
export const DEFAULT_BP_THRESHOLDS = Object.freeze({
  lowSystolicMax: 89, // systolic <= this (i.e. < 90) contributes Low
  lowDiastolicMax: 59, // diastolic <= this (i.e. < 60) contributes Low
  elevatedSystolicMin: 120, // Elevated starts at this systolic (diastolic < stage1 diastolic)
  stage1SystolicMin: 130,
  stage1DiastolicMin: 80,
  stage2SystolicMin: 140,
  stage2DiastolicMin: 90,
  crisisSystolicMin: 181, // "above 180"
  crisisDiastolicMin: 121, // "above 120"
});

/** Stable category codes + the default human labels (admin-overridable). */
export const BP_CATEGORIES = Object.freeze({
  crisis: { code: 'crisis', label: 'Crisis — Hypertensive Crisis', severity: 5, emergency: true },
  stage2: { code: 'stage2', label: 'HIGH — Hypertension Stage 2', severity: 4 },
  stage1: { code: 'stage1', label: 'HIGH — Hypertension Stage 1', severity: 3 },
  elevated: { code: 'elevated', label: 'Elevated', severity: 2 },
  low: { code: 'low', label: 'LOW — Hypotension', severity: 1 },
  normal: { code: 'normal', label: 'Normal', severity: 0 },
});

/** Physiologically plausible reading bounds (data integrity, not diagnosis). */
export const BP_READING_BOUNDS = Object.freeze({ min: 40, max: 300 });

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
 * Parse a "systolic/diastolic" reading. Returns { systolic, diastolic } or null
 * for anything missing, malformed, negative or outside the plausible bounds.
 * A systolic that is not strictly greater than the diastolic is rejected.
 */
export const parseBloodPressure = (value) => {
  const match = String(value ?? '').trim().match(/^(\d{2,3})\s*\/\s*(\d{2,3})$/);
  if (!match) return null;
  const systolic = Number(match[1]);
  const diastolic = Number(match[2]);
  const { min, max } = BP_READING_BOUNDS;
  if (!Number.isFinite(systolic) || !Number.isFinite(diastolic)) return null;
  if (systolic < min || systolic > max || diastolic < min || diastolic > max) return null;
  if (systolic <= diastolic) return null;
  return { systolic, diastolic };
};

const labelFor = (categoryCode, labels) => {
  const override = labels && typeof labels === 'object' ? labels[categoryCode] : null;
  return (typeof override === 'string' && override.trim()) ? override.trim() : BP_CATEGORIES[categoryCode].label;
};

/**
 * Classify a blood-pressure reading using the resolved thresholds.
 *
 * @param {string|{systolic:number,diastolic:number}} reading - "120/80" or parsed pair
 * @param {object} [settings] - raw settings row (merged over defaults)
 * @param {object} [labels] - optional label overrides keyed by category code
 * @returns {null | { code, label, severity, emergency, systolic, diastolic, source }}
 *          null when the reading is empty/invalid (never "Normal").
 */
export const classifyBloodPressure = (reading, settings = null, labels = null) => {
  const parsed = typeof reading === 'object' && reading !== null
    ? (Number.isFinite(Number(reading.systolic)) && Number.isFinite(Number(reading.diastolic))
      ? { systolic: Number(reading.systolic), diastolic: Number(reading.diastolic) }
      : null)
    : parseBloodPressure(reading);
  if (!parsed) return null;

  const t = resolveThresholds(settings);
  const effectiveLabels = labels || (settings && settings.labels) || null;
  const { systolic, diastolic } = parsed;

  let category;
  if (systolic >= t.crisisSystolicMin || diastolic >= t.crisisDiastolicMin) category = 'crisis';
  else if (systolic >= t.stage2SystolicMin || diastolic >= t.stage2DiastolicMin) category = 'stage2';
  else if (systolic >= t.stage1SystolicMin || diastolic >= t.stage1DiastolicMin) category = 'stage1';
  else if (systolic <= t.lowSystolicMax || diastolic <= t.lowDiastolicMax) category = 'low';
  else if (systolic >= t.elevatedSystolicMin && diastolic < t.stage1DiastolicMin) category = 'elevated';
  else category = 'normal';

  const meta = BP_CATEGORIES[category];
  return {
    code: meta.code,
    label: labelFor(category, effectiveLabels),
    severity: meta.severity,
    emergency: Boolean(meta.emergency),
    systolic,
    diastolic,
    source: settings ? 'configured' : 'default',
  };
};

/**
 * Validate an admin threshold payload. Returns normalized integers; throws an
 * array of messages on contradiction so the service can surface a 422.
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
  validateThresholdPayload,
};
