/**
 * KALUSAGAP — RHU triage → PHN check-up workflow mapping (BUG-008).
 *
 * The authoritative store for this clinical workflow is PostgreSQL via the
 * Express `/intake` and `/phn` endpoints (the `visits` table). These pure
 * helpers translate a backend visit row into the exact patient-row shape the
 * triage/PHN pages already render, so the UI reads persistent database state
 * instead of a browser-only localStorage snapshot.
 *
 * Kept dependency-free so it can be unit tested directly.
 */

/** Front-end pipeline statuses (unchanged UI contract). */
export const CHECKUP_STATUS = Object.freeze({
  WAITING: "Waiting for PHN",
  IN_CHECKUP: "In Check-up",
  COMPLETED: "Consultation Completed",
});

/** Map a backend visit status to the UI pipeline status. */
export const mapVisitStatus = (status) => {
  switch (status) {
    case "submitted":
    case "received":
      return CHECKUP_STATUS.WAITING;
    case "in_review":
    case "referred":
      return CHECKUP_STATUS.IN_CHECKUP;
    case "completed":
      return CHECKUP_STATUS.COMPLETED;
    default:
      // drafts and unknown states are not part of the PHN pipeline view
      return null;
  }
};

const fullName = (resident = {}) =>
  [resident.firstName, resident.middleName, resident.lastName]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

const ageFromBirthDate = (birthDate) => {
  if (!birthDate) return "";
  const dob = new Date(birthDate);
  if (Number.isNaN(dob.getTime())) return "";
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const m = now.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) age -= 1;
  return age >= 0 ? age : "";
};

/**
 * Translate one backend visit row (with embedded `resident`) into the patient
 * row the triage/PHN pages consume. Returns null for rows outside the pipeline
 * (e.g. drafts) so callers can filter them out.
 */
export const mapVisitToPatient = (visit) => {
  if (!visit) return null;
  const status = mapVisitStatus(visit.status);
  if (!status) return null;
  const resident = visit.resident || {};
  const vitals = visit.vitals || {};
  const phn = visit.phn || {};
  const completed = status === CHECKUP_STATUS.COMPLETED;

  return {
    id: visit.id,
    residentId: visit.residentId || resident.id || null,
    patient: fullName(resident) || resident.name || "Unnamed patient",
    age: resident.age ?? ageFromBirthDate(resident.birthDate),
    sex: resident.sex || "",
    barangay: resident.barangay || null,
    residenceBarangay: resident.barangay || null,
    reason: visit.chiefComplaint || "",
    status,
    visitDate: visit.visitDate || "",
    triage: {
      date: visit.visitDate || "",
      chiefComplaint: visit.chiefComplaint || "",
      temperature: vitals.temperature ?? null,
      bloodPressure: vitals.bp ?? null,
      pulseRate: vitals.hr ?? null,
      respiratoryRate: vitals.rr ?? null,
      oxygenSaturation: vitals.o2sat ?? null,
      weight: vitals.weightKg ?? null,
      heightCm: vitals.heightCm ?? null,
      bmi: vitals.bmi ?? null,
      bloodSugar: vitals.bloodSugar ?? null,
      notes: visit.clinicalHistory || "",
      personnel: visit.recordedByName || "RHU Personnel",
    },
    checkup: completed
      ? {
          assessment: visit.findings || phn.assessment || "",
          healthConcern: phn.assessment || "",
          clinicalNotes: phn.notes || "",
          recommendations: visit.recommendation || visit.treatmentGiven || "",
          riskLevel: visit.riskLevel || "",
          outcome: visit.outcome || "No Further Action",
          completedBy: visit.completedByName || "PHN",
          completedAt: visit.completedAt || "",
        }
      : undefined,
    raw: visit,
  };
};

/** Map a list of visits, dropping rows outside the pipeline. */
export const mapVisitsToPatients = (visits = []) =>
  (Array.isArray(visits) ? visits : []).map(mapVisitToPatient).filter(Boolean);

/**
 * Split a free-text walk-in name into { firstName, lastName } for the intake
 * endpoint, which requires both. A single-word name is used for both parts.
 */
export const splitWalkInName = (name = "") => {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: "", lastName: "" };
  if (parts.length === 1) return { firstName: parts[0], lastName: parts[0] };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
};

/** Build the intake visit payload (vitals) from a triage form payload. */
export const triageToVisitPayload = (payload = {}) => ({
  visitDate: new Date().toISOString(),
  chiefComplaint: payload.chiefComplaint || payload.reason || "",
  clinicalHistory: payload.notes || "",
  vitals: {
    bp: payload.bloodPressure || null,
    temperature: payload.temperature != null ? Number(payload.temperature) : null,
    hr: payload.pulseRate != null ? Number(payload.pulseRate) : null,
    rr: payload.respiratoryRate != null ? Number(payload.respiratoryRate) : null,
    o2sat: payload.oxygenSaturation != null ? Number(payload.oxygenSaturation) : null,
    heightCm: payload.heightCm != null && payload.heightCm !== "" ? Number(payload.heightCm) : null,
    weightKg: payload.weight != null && payload.weight !== "" ? Number(payload.weight) : null,
    bloodSugar: payload.bloodSugar != null && payload.bloodSugar !== "" ? Number(payload.bloodSugar) : null,
  },
});
