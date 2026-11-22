import { canonicalRiskLevel } from "../../../lib/riskLevel.js";

export const consultationRiskLevel = (consultation = {}) => {
  const details = consultation.consultationDetails ?? consultation.consultation_details ?? {};
  const assessment = consultation.clinicalAssessment ?? consultation.clinical_assessment
    ?? details.clinicalAssessment ?? details.clinical_assessment
    ?? details.riskAssessment ?? details.risk_assessment
    ?? (Array.isArray(details.clinicalAssessmentHistory) ? details.clinicalAssessmentHistory.at(-1) : null);
  const candidates = [
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
