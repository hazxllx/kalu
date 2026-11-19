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

const ageFromBirthDate = (birthDate, referenceDate) => {
  if (!birthDate) return "";
  const dob = new Date(birthDate);
  if (Number.isNaN(dob.getTime())) return "";
  const now = referenceDate ? new Date(referenceDate) : new Date();
  if (Number.isNaN(now.getTime())) return "";
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
  const snapshot = visit.triageSnapshot || null;
  const residentId = visit.residentId || resident.id || null;
  if ((resident.id && residentId !== resident.id) ||
      (snapshot && (!snapshot.residentId || snapshot.residentId !== residentId)) ||
      (snapshot?.resident?.id && snapshot.resident.id !== residentId)) {
    throw new Error("The encounter's patient identity could not be verified. Reload the record before continuing.");
  }
  const triageRecord = snapshot || visit;
  const triageResident = snapshot ? snapshot.resident || {} : resident;
  const vitals = triageRecord.vitals || {};
  const phn = visit.phn || {};
  const completed = status === CHECKUP_STATUS.COMPLETED;
  const clinicalDetails = {
    assessment: visit.findings || phn.assessment || "",
    healthConcern: phn.assessment || "",
    healthServiceName: visit.healthServiceName || "",
    clinicalNotes: phn.notes || "",
    recommendations: visit.recommendation || visit.treatmentGiven || "",
    medications: Array.isArray(visit.medications) ? visit.medications : [],
    riskLevel: Object.hasOwn(visit, 'riskLevel') ? visit.riskLevel : visit.risk_level ?? resident.riskLevel ?? null,
    riskReason: visit.riskReason || '',
    riskAssessmentStatus: visit.riskAssessmentStatus || '',
    outcome: visit.outcome || "",
    personnel: phn.personnel || "",
    completedBy: visit.completedByName || "",
    completedAt: visit.completedAt || "",
  };

  return {
    id: visit.id,
    residentId,
    patient: fullName(triageResident) || triageResident.name || "Patient name not recorded",
    age: triageResident.age ?? ageFromBirthDate(triageResident.birthDate, triageRecord.visitDate),
    sex: triageResident.sex || "",
    barangay: triageResident.barangay || null,
    residenceBarangay: triageResident.barangay || null,
    reason: triageRecord.chiefComplaint || "",
    serviceId: visit.healthServiceId || null,
    serviceName: visit.healthServiceName || "",
    status,
    riskLevel: Object.hasOwn(visit, 'riskLevel') ? visit.riskLevel : visit.risk_level ?? resident.riskLevel ?? resident.risk_level ?? null,
    riskScore: Object.hasOwn(visit, 'riskScore') ? visit.riskScore : visit.risk_score ?? resident.riskScore ?? resident.risk_score ?? null,
    riskFactors: visit.riskFactors ?? visit.risk_factors ?? [],
    riskReason: visit.riskReason || '',
    riskAssessmentStatus: visit.riskAssessmentStatus || '',
    riskAssessedAt: visit.riskAssessedAt || null,
    facilityId: visit.facilityId ?? visit.facility_id ?? null,
    municipalityId: resident.municipalityId ?? resident.municipality_id ?? null,
    visitDate: visit.visitDate || "",
    triage: {
      id: visit.id,
      residentId,
      date: triageRecord.submittedAt || visit.submittedAt || triageRecord.visitDate || "",
      chiefComplaint: triageRecord.chiefComplaint || "",
      temperature: vitals.temperature ?? null,
      bloodPressure: vitals.bp ?? null,
      pulseRate: vitals.hr ?? null,
      respiratoryRate: vitals.rr ?? null,
      oxygenSaturation: vitals.o2sat ?? null,
      weight: vitals.weightKg ?? null,
      heightCm: vitals.heightCm ?? null,
      bmi: vitals.bmi ?? null,
      bloodSugar: vitals.bloodSugar ?? null,
      notes: triageRecord.clinicalHistory || "",
      personnel: triageRecord.recordedByName || "",
      personnelId: triageRecord.recordedBy || null,
      warnings: triageRecord.triageWarnings || visit.triageWarnings || [],
    },
    checkup: completed ? clinicalDetails : undefined,
    checkupDraft: completed ? undefined : clinicalDetails,
    raw: visit,
  };
};

/** Map a list of visits, dropping rows outside the pipeline. */
export const mapVisitsToPatients = (visits = []) =>
  (Array.isArray(visits) ? visits : []).map(mapVisitToPatient).filter(Boolean);

/**
 * Split a free-text walk-in name into { firstName, lastName } for the intake
 * endpoint. A single-word name must not be duplicated into a fabricated surname.
 */
export const splitWalkInName = (name = "") => {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: "", lastName: "" };
  if (parts.length === 1) return { firstName: parts[0], lastName: "" };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
};

/** Build the intake visit payload (vitals) from a triage form payload. */
export const triageToVisitPayload = (payload = {}) => ({
  visitDate: payload.visitDate || new Date().toISOString(),
  chiefComplaint: payload.chiefComplaint || payload.reason || "",
  clinicalHistory: payload.notes || "",
  // The triage performer is recorded server-side from the authenticated user;
  // no personnel name is sent from the client.
  vitals: {
    bp: payload.bloodPressure || null,
    // Preserve raw input so the API can reject malformed readings explicitly.
    temperature: payload.temperature === "" ? null : payload.temperature ?? null,
    hr: payload.pulseRate === "" ? null : payload.pulseRate ?? null,
    rr: payload.respiratoryRate === "" ? null : payload.respiratoryRate ?? null,
    o2sat: payload.oxygenSaturation === "" ? null : payload.oxygenSaturation ?? null,
    heightCm: payload.heightCm === "" ? null : payload.heightCm ?? null,
    weightKg: payload.weight === "" ? null : payload.weight ?? null,
    bloodSugar: payload.bloodSugar === "" ? null : payload.bloodSugar ?? null,
  },
});
