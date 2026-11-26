// frontend/src/features/triage/lib/triageValidation.js
import { classifyBloodPressure, parseBloodPressure } from '../../../../../shared/bloodPressure.js';

// Entry safeguards, not diagnostic or age-specific normal ranges.
export const VITAL_FIELDS = Object.freeze([
  { key: "heightCm", label: "Height", unit: "cm", min: 20, max: 300 },
  { key: "weightKg", label: "Weight", unit: "kg", min: 0.3, max: 500 },
  { key: "temperature", label: "Temperature", unit: "C", min: 25, max: 46 },
  { key: "pulseRate", label: "Heart Rate", unit: "bpm", min: 20, max: 250, integer: true },
  { key: "respiratoryRate", label: "Respiratory Rate", unit: "breaths/min", min: 4, max: 90, integer: true },
  { key: "oxygenSaturation", label: "Oxygen Saturation", unit: "%", min: 50, max: 100 },
  { key: "bloodSugar", label: "Blood Sugar", unit: "mg/dL", min: 1, max: 2000 },
]);

const text = (value) => value == null ? "" : String(value).trim();
const DECIMAL = /^\d+(?:\.\d+)?$/;
export const isRecorded = (value) => text(value) !== "";
export const optionalReading = (value) => isRecorded(value) ? text(value) : null;
export const emptyVitals = () => Object.fromEntries([...VITAL_FIELDS.map(({ key }) => [key, ""]), ["bloodPressure", ""]]);

export function ageFromBirthDate(value, today = new Date()) {
  if (!value) return "";
  const parts = /^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/.exec(String(value));
  if (!parts) return "";
  const [, year, month, day] = parts.map(Number);
  const birth = new Date(year, month - 1, day);
  if (birth.getFullYear() !== year || birth.getMonth() !== month - 1 || birth.getDate() !== day) return "";
  if (!Number.isFinite(birth.getTime()) || birth > today) return "";
  let age = today.getFullYear() - birth.getFullYear();
  if (today.getMonth() < birth.getMonth() || (today.getMonth() === birth.getMonth() && today.getDate() < birth.getDate())) age -= 1;
  return age;
}

export function residentIdentity(resident) {
  if (!resident) return null;
  return {
    id: resident.id,
    name: [resident.firstName ?? resident.first_name, resident.middleName ?? resident.middle_name, resident.lastName ?? resident.last_name].filter(Boolean).join(" ").trim() || resident.name || "",
    age: resident.birthDate || resident.birth_date ? ageFromBirthDate(resident.birthDate || resident.birth_date) : resident.age ?? "",
    sex: resident.sex || "",
    barangay: resident.barangay || "",
  };
}

export function validateDemographics(patient, barangays) {
  const errors = {};
  const name = text(patient?.name);
  if (!name) errors.name = "Please enter the patient's name.";
  else if (name.length > 200 || !/\p{L}/u.test(name) || !/^[\p{L}\p{M}\p{Zs}.'’\-]+$/u.test(name)) errors.name = "Use letters, spaces, apostrophes, periods or hyphens, without numbers.";
  const age = text(patient?.age);
  if (!/^\d+$/.test(age) || Number(age) > 120) errors.age = "Enter a whole-number age from 0 to 120.";
  if (!["Female", "Male", "Other"].includes(patient?.sex)) errors.sex = "Please choose the patient's sex.";
  if (!barangays.includes(patient?.barangay)) errors.barangay = "Choose a currently registered barangay.";
  return errors;
}

export function validateRegisteredPatient(selected, loaded, loading, barangays) {
  if (loading) return { patient: "Wait for the patient record to finish loading." };
  if (!selected?.id || !loaded?.id || String(selected.id) !== String(loaded.id)) return { patient: "Select and load an existing patient record before continuing." };
  const missing = Object.keys(validateDemographics(residentIdentity(loaded), barangays));
  return missing.length ? { patient: `The registered record has missing or invalid ${missing.join(", ")}. Update the patient record before triage.` } : {};
}

export function validateVisitDetails(vitals, reason, reasonDetail, notes = "") {
  const errors = {};
  for (const { key, label, min, max, integer } of VITAL_FIELDS) {
    const value = text(vitals[key]);
    if (!value) continue;
    if (!DECIMAL.test(value) || !Number.isFinite(Number(value)) || (integer && !/^\d+$/.test(value)) || Number(value) < min || Number(value) > max) {
      errors[key] = `Enter ${integer ? "a whole number" : "a number"} from ${min} to ${max} for ${label.toLowerCase()}, or leave unrecorded.`;
    }
  }
  const bp = text(vitals.bloodPressure);
  if (bp) {
    const match = /^(\d{2,3})\s*\/\s*(\d{2,3})$/.exec(bp);
    if (!match) errors.bloodPressure = "Use systolic/diastolic whole numbers, for example 120/80.";
    else if (!parseBloodPressure(bp)) errors.bloodPressure = "Use systolic 40 to 300 and diastolic 20 to 200; systolic must be higher.";
  }
  if (!text(reason)) errors.reason = "Please choose the reason for this visit.";
  if (reason === "Other" && !text(reasonDetail)) errors.reasonDetail = "Please describe the reason.";
  if (text(reason === "Other" ? reasonDetail : reason).length > 2000) errors.reasonDetail = "Keep the reason within 2,000 characters.";
  if (text(notes).length > 10000) errors.notes = "Keep notes within 10,000 characters.";
  return errors;
}

// Display preview only. The server independently recalculates the saved value.
export function previewBmi(vitals) {
  const errors = validateVisitDetails(vitals, "Check-up", "");
  if (!isRecorded(vitals.heightCm) || !isRecorded(vitals.weightKg) || errors.heightCm || errors.weightKg) return "";
  return (Math.round(Number(vitals.weightKg) / ((Number(vitals.heightCm) / 100) ** 2) * 10) / 10).toFixed(1);
}

export function reviewFlags(vitals, context = {}) {
  const invalid = validateVisitDetails(vitals, "Check-up", "");
  const flags = [];
  const flag = (key, unusual) => {
    if (isRecorded(vitals[key]) && !invalid[key] && unusual(Number(vitals[key]))) flags.push(`${VITAL_FIELDS.find((field) => field.key === key).label}: ${vitals[key]} - unusual reading; verify and review during consultation.`);
  };
  flag("temperature", (v) => v < 35 || v >= 38);
  flag("pulseRate", (v) => v < 40 || v > 180);
  flag("respiratoryRate", (v) => v < 8 || v > 40);
  flag("oxygenSaturation", (v) => v < 94);
  flag("bloodSugar", (v) => v < 70 || v > 250);
  if (isRecorded(vitals.bloodPressure) && !invalid.bloodPressure) {
    const bp = classifyBloodPressure(vitals.bloodPressure, context);
    if (bp?.referralEvaluationRequired) flags.push(`Blood Pressure: ${vitals.bloodPressure} - ${bp.message}`);
    else if (bp && (bp.systolic < 90 || bp.systolic >= 180 || bp.diastolic >= 120)) flags.push(`Blood Pressure: ${vitals.bloodPressure} - unusual reading; verify and review during consultation.`);
  }
  return flags;
}

const FIELD_ALIASES = {
  bp: "bloodPressure", hr: "pulseRate", rr: "respiratoryRate", o2sat: "oxygenSaturation",
  weight: "weightKg", height: "heightCm", blood_sugar: "bloodSugar", clinicalHistory: "notes",
  chiefComplaint: "reasonDetail", firstName: "name", lastName: "name", middleName: "name", residentId: "patient", referralId: "patient",
};

export function mapTriageFieldErrors(error) {
  const source = error?.payload?.error?.errors || error?.payload?.error?.details?.errors || error?.payload?.error?.details || error?.fieldErrors || {};
  const mapped = {};
  const entries = Array.isArray(source) ? source.map((item) => [Array.isArray(item.path) ? item.path.join(".") : item.field || item.path, item.message]) : Object.entries(source);
  for (const [path, message] of entries) {
    const field = String(path || "").split(".").pop();
    if (field && message) mapped[FIELD_ALIASES[field] || field] = Array.isArray(message) ? message.join(" ") : String(message);
  }
  return mapped;
}

export function errorStep(errors) {
  return ["patient", "name", "age", "sex", "barangay"].some((key) => errors[key]) ? "patient" : "details";
}
