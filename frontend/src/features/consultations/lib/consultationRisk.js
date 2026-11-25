import { canonicalRiskLevel } from "../../../lib/riskLevel.js";
import { consultationNumber, savedConsultationAssessment } from "../../../../../shared/consultationClinical.js";
import { bloodPressureBadgeClassName, classifyBloodPressure as classifyBp } from "../utils/bpClassification.js";

export const consultationAssessment = (consultation = {}) => {
  const details = consultation.consultationDetails ?? consultation.consultation_details ?? {};
  return savedConsultationAssessment({
    ...details,
    consultationRiskAssessment: consultation.consultationRiskAssessment ?? details.consultationRiskAssessment,
    clinicalAssessment: consultation.clinicalAssessment ?? consultation.clinical_assessment
      ?? details.clinicalAssessment ?? details.clinical_assessment,
  });
};

export const consultationRiskLevel = (consultation = {}) => {
  const details = consultation.consultationDetails ?? consultation.consultation_details ?? {};
  const assessment = consultationAssessment(consultation);
  const candidates = [
    consultation.encounterRiskAssessment?.level,
    consultation.encounter_risk_assessment?.level,
    assessment?.level,
    assessment?.riskLevel,
    assessment?.risk_level,
    consultation.riskLevel,
    consultation.risk_level,
    details.riskLevel,
    details.risk_level,
  ];
  return candidates.map(canonicalRiskLevel).find(Boolean) || null;
};

export const consultationServiceName = (consultation = {}) => consultation.serviceName
  || consultation.healthServiceName || consultation.health_service_name
  || consultation.healthService?.name || consultation.health_services?.name || "";

export const savedConsultationBloodPressureClassification = (consultation = {}) => {
  const details = consultation.consultationDetails ?? consultation.consultation_details ?? {};
  const vitals = consultation.vitals || {};
  const saved = [
    consultation.bpClassification,
    consultation.bloodPressureClassification,
    consultation.blood_pressure_classification,
    details.bpClassification,
    details.bloodPressureClassification,
    vitals.bpClassification,
    vitals.bloodPressureClassification,
  ].find((value) => value && typeof value === "object" && !Array.isArray(value));
  if (saved) return saved;
  const savedLabel = consultation.bloodPressureCategory || vitals.bloodPressureCategory;
  return typeof savedLabel === "string" && savedLabel.trim()
    ? { label: savedLabel.trim(), category: savedLabel.trim() }
    : null;
};

export const consultationBloodPressureClassification = (consultation = {}) => {
  const saved = savedConsultationBloodPressureClassification(consultation);
  const details = consultation.consultationDetails ?? consultation.consultation_details ?? {};
  const vitals = consultation.vitals || {};
  const reading = vitals.bloodPressure || vitals.bp || consultation.bloodPressure || consultation.blood_pressure
    || (vitals.systolic != null && vitals.diastolic != null ? { systolic: vitals.systolic, diastolic: vitals.diastolic } : null);
  // Reclassify older saved snapshots from the raw value for display only;
  // previously recorded clinical history remains unchanged.
  if (saved?.classificationVersion === 'bp-v4') return { ...saved, badgeClassName: bloodPressureBadgeClassName(saved) };
  const current = classifyBp(reading, {
    chiefComplaint: consultation.chiefComplaint ?? details.chiefComplaint,
    findings: consultation.findings ?? details.findings,
    clinicalFindingsDiagnosis: consultation.clinicalFindingsDiagnosis,
    indicators: consultation.clinicalIndicators ?? details.clinicalIndicators
      ?? details.clinicalAssessment?.inputs?.indicators,
  });
  if (current) return current;
  return saved ? { ...saved, badgeClassName: bloodPressureBadgeClassName(saved) } : null;
};

export const consultationHealthServiceLabel = (service = {}) => {
  const name = String(service.name ?? "").trim();
  const category = String(service.category ?? "").trim();
  const normalizedName = name.toLowerCase().replace(/[^a-z0-9]/g, "");
  const normalizedCategory = category.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!name) return category;
  if (normalizedName === "immunization" && normalizedCategory === "immunization") return "Immunization";
  if (["consult", "consultation"].includes(normalizedName) && normalizedCategory === "consultation") return "Consultation";
  if (normalizedName === "prenatal" && normalizedCategory === "maternal") return "Prenatal / Maternal";
  if (normalizedName === normalizedCategory) return category || name;
  return name;
};

export const consultationTemperatureWarningVisible = (value) => {
  const temperature = consultationNumber(value);
  return temperature !== null && temperature >= 60;
};

export const consultationRiskReasons = (consultation = {}) => {
  const assessment = consultationAssessment(consultation);
  const encounterReasons = consultation.encounterRiskAssessment?.reasons ?? consultation.encounter_risk_assessment?.reasons;
  const reasons = Array.isArray(encounterReasons) && encounterReasons.length
    ? encounterReasons
    : Array.isArray(assessment?.reasons) ? assessment.reasons : typeof assessment?.reasons === "string" ? [assessment.reasons] : [];
  const messages = reasons.map((reason) => typeof reason === "string" ? reason : reason?.message || reason?.ruleId?.replaceAll("_", " ")).filter(Boolean);
  return messages.length ? messages.join("; ") : consultation.riskReason || "";
};

export const consultationFollowUp = (consultation = {}) => {
  const linked = Array.isArray(consultation.followUps)
    ? [...consultation.followUps].sort((a, b) =>
      String(b?.scheduled_date || b?.scheduledDate || "").localeCompare(String(a?.scheduled_date || a?.scheduledDate || "")))[0]
    : null;
  const date = linked?.scheduled_date || linked?.scheduledDate || consultation.nextVisitDate || "";
  const rawStatus = String(linked?.status || consultation.followUpStatus || "").trim();
  const normalizedStatus = rawStatus.toLowerCase();
  const hasExplicitRequired = consultation.followUpRequired !== undefined && consultation.followUpRequired !== null;
  const required = [true, "yes", "true"].includes(
    typeof consultation.followUpRequired === "string" ? consultation.followUpRequired.trim().toLowerCase() : consultation.followUpRequired,
  );
  const notRequired = ["no", "none", "not required", "not_required"].includes(normalizedStatus);
  if (!linked && (notRequired || (hasExplicitRequired && !required && !rawStatus))) {
    return { has: false, date: "", status: "No" };
  }
  const has = Boolean(linked || date || required || (rawStatus && !notRequired));
  if (!has) return { has, date: "", status: "No" };
  if (normalizedStatus === "completed" || linked?.completed_at) return { has, date, status: "Completed" };
  if (linked?.is_overdue === true || linked?.isOverdue === true || normalizedStatus === "overdue") {
    return { has, date, status: "Overdue" };
  }
  if (normalizedStatus === "pending") return { has, date, status: "Pending" };
  if (normalizedStatus === "missed") return { has, date, status: "Missed" };
  if (["cancelled", "canceled"].includes(normalizedStatus)) return { has, date, status: "Cancelled" };
  if (normalizedStatus === "rejected") return { has, date, status: "Rejected" };
  if (date || ["scheduled", "today", "upcoming", "ongoing", "confirmed", "accepted"].includes(normalizedStatus)) {
    return { has, date, status: "Scheduled" };
  }
  return { has, date, status: "Pending" };
};
