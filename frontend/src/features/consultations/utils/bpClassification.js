/**
 * Advisory blood-pressure screening categories for the KALUSAGAP vitals form.
 * Thresholds require confirmation against the approved clinical protocol
 * before production use. A category is not a definitive diagnosis.
 *
 * When systolic and diastolic values fall into different categories, the more
 * severe applicable category wins. Crisis uses the requested strict
 * "above 180 systolic and/or above 120 diastolic" thresholds.
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

const READING_BOUNDS = Object.freeze({ min: 40, max: 300 });

export const BP_CATEGORY_META = Object.freeze({
  normal: {
    label: "Normal Blood Pressure",
    badgeClassName: "bg-green-100 text-green-800",
    severity: 0,
    alertLevel: "normal",
    message: "Blood pressure is within the reference range.",
  },
  elevated: {
    label: "Elevated Blood Pressure",
    badgeClassName: "bg-yellow-100 text-yellow-800",
    severity: 1,
    alertLevel: "monitor",
    message: "Elevated reading. Recheck and monitor according to the clinical protocol.",
  },
  stage1: {
    label: "Stage 1 Hypertension",
    badgeClassName: "bg-orange-100 text-orange-800",
    severity: 2,
    alertLevel: "assessment",
    message: "High blood pressure reading. Arrange appropriate clinical assessment.",
  },
  stage2: {
    label: "Stage 2 Hypertension",
    badgeClassName: "bg-red-100 text-red-800",
    severity: 3,
    alertLevel: "urgent",
    message: "Very high blood pressure reading. Prompt clinical assessment is needed.",
  },
  crisis: {
    label: "Hypertensive Crisis",
    badgeClassName: "bg-red-800 text-white",
    severity: 4,
    alertLevel: "crisis",
    message:
      "Extremely high reading. Arrange prompt clinical assessment. If concerning symptoms are present, seek immediate emergency assessment; do not wait to repeat the reading. A numerical reading alone does not establish a hypertensive emergency.",
  },
});

/** Parse "systolic/diastolic"; null for missing, malformed, or implausible input. */
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
 * Classify a valid reading. Returns null for empty or invalid input.
 *
 * Crisis is a screening category only. Emergency assessment requires
 * evaluation of symptoms and possible acute organ damage by a clinician.
 */
export const classifyBloodPressure = (value) => {
  const parsed = parseBloodPressure(value);
  if (!parsed) return null;

  const { systolic, diastolic } = parsed;
  let code;

  if (systolic > 180 || diastolic > 120) code = "crisis";
  else if (systolic >= 140 || diastolic >= 90) code = "stage2";
  else if (systolic >= 130 || diastolic >= 80) code = "stage1";
  else if (systolic >= 120 && systolic <= 129 && diastolic < 80) code = "elevated";
  else code = "normal";

  const meta = BP_CATEGORY_META[code];
  return {
    ...parsed,
    code,
    category: meta.label,
    label: meta.label,
    severity: meta.severity,
    alertLevel: meta.alertLevel,
    emergency: false,
    badgeClassName: meta.badgeClassName,
    message: meta.message,
  };
};

export default {
  classifyBloodPressure,
  parseBloodPressure,
  DEFAULT_BP_THRESHOLDS,
  BP_CATEGORY_META,
};
