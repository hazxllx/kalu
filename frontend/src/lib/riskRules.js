/**
 * Front-end risk classification for the RHU → PHN check-up workflow.
 *
 * This is a DEMO / PROTOTYPE rule engine only — it is transparent, deterministic
 * and kept in one file so a proper clinical/backend ruleset can replace it
 * later. It does NOT perform real medical diagnosis.
 *
 * Priority order when several indicators are present:
 *   HIGH > MEDIUM > LOW
 *
 * `calculateRiskLevel(patient, triageData, checkupData)` returns
 *   { level: "High" | "Medium" | "Low", reason: string }
 */

export const RISK_LEVELS = Object.freeze({ HIGH: "High", MEDIUM: "Medium", LOW: "Low" });

const HIGH_REASONS = {
  communicable: "Possible communicable disease identified during assessment.",
  severeSymptom: "Severe or concerning symptoms require priority assessment.",
  veryHighBp: "Very high blood pressure requires immediate attention.",
  lowOxygen: "Low oxygen saturation requires immediate attention.",
  abnormalVitals: "Abnormal vital signs require priority assessment.",
};

const MEDIUM_REASONS = {
  hypertension: "Elevated blood pressure requires monitoring and follow-up.",
  chronic: "Chronic condition requires monitoring and medication review.",
  maintenance: "Maintenance medication and monitoring are required.",
  symptoms: "Persistent symptoms require follow-up assessment.",
  abnormal: "Abnormal findings require follow-up and monitoring.",
};

const LOW_REASON = "No significant risk indicators identified.";

/** Lower-cased searchable copy of every relevant structured field. */
const collectText = ({ patient = {}, triage = {}, checkup = {} }) => {
  const parts = [
    patient?.reason,
    patient?.notes,
    triage?.chiefComplaint,
    triage?.notes,
    checkup?.healthConcern,
    checkup?.assessment,
    checkup?.clinicalNotes,
    checkup?.recommendations,
  ];
  return parts
    .filter(Boolean)
    .map((t) => String(t))
    .join(" ")
    .toLowerCase();
};

const hasTerm = (text, terms) => {
  const list = Array.isArray(terms) ? terms : [terms];
  return list.some((term) => text.includes(String(term).toLowerCase()));
};

/** First blood pressure found in a string or BP field ("145/92"). */
const findBloodPressure = (value) => {
  const match = String(value || "").match(/(\d{2,3})\s*\/\s*(\d{2,3})/);
  if (!match) return null;
  return { systolic: Number(match[1]), diastolic: Number(match[2]) };
};

const parseNumber = (value) => {
  const match = String(value || "").match(/\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
};

/**
 * Rule-based risk level based on triage data + the PHN's check-up entries.
 *
 * @param {object} [patient]  The patient record (reason, notes).
 * @param {object} [triage]   Read-only RHU triage snapshot (vitals, notes).
 * @param {object} [checkup]  PHN-entered fields (healthConcern, assessment,
 *                            clinicalNotes, recommendations).
 * @returns {{ level: string, reason: string }}
 */
export const calculateRiskLevel = (patient = {}, triage = {}, checkup = {}) => {
  const triageData =
    triage && typeof triage === "object" && Object.keys(triage).length > 0
      ? triage
      : patient?.triage || {};
  const text = collectText({ patient, triage: triageData, checkup });

  const bloodPressure = findBloodPressure(triageData?.bloodPressure) || findBloodPressure(text);
  const oxygen = parseNumber(triageData?.oxygenSaturation);
  const temperature = parseNumber(triageData?.temperature);
  const pulse = parseNumber(triageData?.pulseRate);
  const respiratory = parseNumber(triageData?.respiratoryRate);

  const communicableTerms = [
    "communicable",
    "infectious",
    "infection",
    "tuberculosis",
    "tb symptom",
    "tb screening",
    "sputum",
    "suspected tb",
    "dengue",
    "measles",
    "chickenpox",
    "meningitis",
  ];

  /* ------------------------------ HIGH ------------------------------- */
  if (hasTerm(text, communicableTerms)) {
    return { level: RISK_LEVELS.HIGH, reason: HIGH_REASONS.communicable };
  }
  if (
    hasTerm(text, [
      "chest pain",
      "difficulty breathing",
      "shortness of breath",
      "cannot breathe",
      "altered consciousness",
      "loss of consciousness",
      "unresponsive",
      "seizure",
      "severe pain",
      "severe bleeding",
      "very high blood pressure",
      "stroke",
      "severe dehydration",
    ])
  ) {
    return { level: RISK_LEVELS.HIGH, reason: HIGH_REASONS.severeSymptom };
  }
  if (bloodPressure && (bloodPressure.systolic >= 180 || bloodPressure.diastolic >= 120)) {
    return { level: RISK_LEVELS.HIGH, reason: HIGH_REASONS.veryHighBp };
  }
  if (bloodPressure && bloodPressure.systolic >= 160 && hasTerm(text, ["headache", "blurred", "nausea", "dizzy", "chest"])) {
    return { level: RISK_LEVELS.HIGH, reason: HIGH_REASONS.veryHighBp };
  }
  if (oxygen !== null && oxygen < 90) {
    return { level: RISK_LEVELS.HIGH, reason: HIGH_REASONS.lowOxygen };
  }
  if (respiratory !== null && respiratory >= 30) {
    return { level: RISK_LEVELS.HIGH, reason: HIGH_REASONS.abnormalVitals };
  }
  if (pulse !== null && pulse >= 120) {
    return { level: RISK_LEVELS.HIGH, reason: HIGH_REASONS.abnormalVitals };
  }
  if (temperature !== null && temperature >= 39.5) {
    return { level: RISK_LEVELS.HIGH, reason: HIGH_REASONS.abnormalVitals };
  }
  if (hasTerm(text, ["severe", "critical", "emergency", "urgent"])) {
    return { level: RISK_LEVELS.HIGH, reason: HIGH_REASONS.severeSymptom };
  }

  /* ------------------------------ MEDIUM ----------------------------- */
  const hypertension = hasTerm(text, [
    "hypertension",
    "high blood pressure",
    "elevated blood pressure",
    "bp re-check",
    "bp check",
    "uncontrolled hypertension",
    "elevated bp",
  ]) || Boolean(bloodPressure && (bloodPressure.systolic >= 140 || bloodPressure.diastolic >= 90));
  if (hypertension) {
    return { level: RISK_LEVELS.MEDIUM, reason: MEDIUM_REASONS.hypertension };
  }
  if (hasTerm(text, ["diabetes", "diabetic", "fbs", "blood sugar", "glucose"])) {
    return { level: RISK_LEVELS.MEDIUM, reason: MEDIUM_REASONS.chronic };
  }
  if (hasTerm(text, ["maintenance", "maintenance medication", "medication review", "on medication", "meds", "maintenance meds"])) {
    return { level: RISK_LEVELS.MEDIUM, reason: MEDIUM_REASONS.maintenance };
  }
  if (hasTerm(text, ["persistent", "persistent cough", "ongoing", "follow-up required"])) {
    return { level: RISK_LEVELS.MEDIUM, reason: MEDIUM_REASONS.symptoms };
  }
  if (
    hasTerm(text, [
      "respiratory infection",
      "wheezing",
      "bronchitis",
      "pneumonia",
      "anemia",
      "nutrition",
      "weight loss",
      "fever",
      "sore throat",
      "ear pain",
    ])
  ) {
    return { level: RISK_LEVELS.MEDIUM, reason: MEDIUM_REASONS.symptoms };
  }
  if (bloodPressure && bloodPressure.systolic >= 140) {
    return { level: RISK_LEVELS.MEDIUM, reason: MEDIUM_REASONS.hypertension };
  }
  if (oxygen !== null && oxygen < 94) {
    return { level: RISK_LEVELS.MEDIUM, reason: MEDIUM_REASONS.abnormal };
  }
  if (temperature !== null && temperature >= 38) {
    return { level: RISK_LEVELS.MEDIUM, reason: MEDIUM_REASONS.abnormal };
  }
  if ((pulse !== null && pulse >= 100) || (respiratory !== null && respiratory >= 24)) {
    return { level: RISK_LEVELS.MEDIUM, reason: MEDIUM_REASONS.abnormal };
  }

  /* ------------------------------- LOW ------------------------------- */
  return { level: RISK_LEVELS.LOW, reason: LOW_REASON };
};

/**
 * Convenience for UI lists: returns the risk shown for a workflow patient.
 *
 * A completed check-up uses its stored (auto-calculated) risk; otherwise the
 * rules are evaluated live from triage + any in-progress check-up entries.
 *
 * @returns {{ level: string, reason: string }}
 */
export const riskOfPatient = (patient = {}) => {
  const checkup = patient?.checkup;
  if (checkup && checkup.riskLevel) {
    const reason =
      checkup.riskReason ||
      calculateRiskLevel(patient, patient?.triage, checkup).reason;
    return { level: checkup.riskLevel, reason };
  }
  return calculateRiskLevel(patient || {}, patient?.triage || {}, checkup || {});
};

export default calculateRiskLevel;
