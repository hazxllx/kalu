/**
 * Blood-pressure classification (frontend) — mirrors the backend classifier in
 * `backend/src/config/bpThresholds.js`. Screening guidance, NOT a diagnosis.
 *
 * The ALGORITHM and its precedence are fixed and safe (Crisis > Stage 2 >
 * Stage 1 > Low > Elevated > Normal, most severe applicable category wins);
 * only the numeric cut-offs are configurable (fetched from /bp-config). An
 * empty, incomplete, malformed, negative or implausible reading returns null so
 * the UI shows no category — it is NEVER classified as Normal.
 */

export const DEFAULT_BP_THRESHOLDS = Object.freeze({
  lowSystolicMax: 89,
  lowDiastolicMax: 59,
  elevatedSystolicMin: 120,
  stage1SystolicMin: 130,
  stage1DiastolicMin: 80,
  stage2SystolicMin: 140,
  stage2DiastolicMin: 90,
  crisisSystolicMin: 181,
  crisisDiastolicMin: 121,
});

const READING_BOUNDS = { min: 40, max: 300 };

/** Default label + KALUSAGAP tone per category code. */
export const BP_CATEGORY_META = Object.freeze({
  crisis: { label: "Crisis \u2014 Hypertensive Crisis", tone: "bg-brand-danger text-white", severity: 5, emergency: true },
  stage2: { label: "HIGH \u2014 Hypertension Stage 2", tone: "bg-brand-danger/10 text-brand-danger", severity: 4 },
  stage1: { label: "HIGH \u2014 Hypertension Stage 1", tone: "bg-brand-amber/10 text-brand-amber", severity: 3 },
  elevated: { label: "Elevated", tone: "bg-brand-goldpale text-brand-amber", severity: 2 },
  low: { label: "LOW \u2014 Hypotension", tone: "bg-brand-blue/10 text-brand-blue", severity: 1 },
  normal: { label: "Normal", tone: "bg-brand-green/10 text-brand-green", severity: 0 },
});

const num = (value) => {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

export const resolveThresholds = (settings) => {
  const out = { ...DEFAULT_BP_THRESHOLDS };
  if (settings && typeof settings === "object") {
    for (const key of Object.keys(DEFAULT_BP_THRESHOLDS)) {
      const v = num(settings[key]);
      if (v !== null) out[key] = v;
    }
  }
  return out;
};

/** Parse "systolic/diastolic"; null for anything invalid/implausible. */
export const parseBloodPressure = (value) => {
  const match = String(value ?? "").trim().match(/^(\d{2,3})\s*\/\s*(\d{2,3})$/);
  if (!match) return null;
  const systolic = Number(match[1]);
  const diastolic = Number(match[2]);
  const { min, max } = READING_BOUNDS;
  if (systolic < min || systolic > max || diastolic < min || diastolic > max) return null;
  if (systolic <= diastolic) return null;
  return { systolic, diastolic };
};

/**
 * Classify a reading. Returns null for empty/invalid input (never Normal).
 * @param {string} value - "120/80"
 * @param {object} [thresholds] - resolved or raw settings (merged over defaults)
 * @param {object} [labels] - optional label overrides keyed by category code
 */
export const classifyBloodPressure = (value, thresholds = null, labels = null) => {
  const parsed = parseBloodPressure(value);
  if (!parsed) return null;
  const t = resolveThresholds(thresholds);
  const { systolic, diastolic } = parsed;

  let code;
  if (systolic >= t.crisisSystolicMin || diastolic >= t.crisisDiastolicMin) code = "crisis";
  else if (systolic >= t.stage2SystolicMin || diastolic >= t.stage2DiastolicMin) code = "stage2";
  else if (systolic >= t.stage1SystolicMin || diastolic >= t.stage1DiastolicMin) code = "stage1";
  else if (systolic <= t.lowSystolicMax || diastolic <= t.lowDiastolicMax) code = "low";
  else if (systolic >= t.elevatedSystolicMin && diastolic < t.stage1DiastolicMin) code = "elevated";
  else code = "normal";

  const meta = BP_CATEGORY_META[code];
  const override = labels && typeof labels === "object" ? labels[code] : null;
  return {
    code,
    label: (typeof override === "string" && override.trim()) ? override.trim() : meta.label,
    tone: meta.tone,
    severity: meta.severity,
    emergency: Boolean(meta.emergency),
    systolic,
    diastolic,
  };
};

export default { classifyBloodPressure, parseBloodPressure, resolveThresholds, DEFAULT_BP_THRESHOLDS, BP_CATEGORY_META };
