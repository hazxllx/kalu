import React from "react";
import MedicineSelector from "@/features/consultations/components/MedicineSelector";

const inputClass = (error) =>
  `w-full rounded-btn border bg-white px-3 py-2 text-sm text-brand-ink outline-none focus:border-brand-blue dark:border-border dark:bg-card dark:text-foreground ${
    error ? "border-brand-danger bg-red-50/40 dark:border-brand-danger dark:bg-red-950/20" : "border-brand-border"
  }`;

/**
 * @param {{
 *   findings: string,
 *   onFindingsChange: (value: string) => void,
 *   diagnosis: string,
 *   onDiagnosisChange: (value: string) => void,
 *   medications: any[],
 *   onMedicationsChange: (value: any[]) => void,
 *   recommendations: string,
 *   onRecommendationsChange: (value: string) => void,
 *   errors?: Record<string, string>,
 *   disabled?: boolean,
 *   findingsLabel?: string,
 *   recommendationsRequired?: boolean
 *   showDiagnosis?: boolean
 * }} props
 */
export default function ConsultationClinicalFields({
  findings,
  onFindingsChange,
  diagnosis,
  onDiagnosisChange,
  medications,
  onMedicationsChange,
  recommendations,
  onRecommendationsChange,
  errors = {},
  disabled = false,
  findingsLabel = "Clinical Findings",
  recommendationsRequired = false,
  showDiagnosis = true,
}) {
  return (
    <>
      <section className="mb-4" aria-label={showDiagnosis ? "Clinical findings and diagnosis" : "Clinical findings"}>
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-brand-blue">Clinical Findings</h4>
        <div className={showDiagnosis ? "grid gap-3 sm:grid-cols-2" : "grid gap-3"}>
          <div>
            <label htmlFor="consultation-clinical-findings" className="mb-1 block text-xs text-brand-gray">
              {findingsLabel} <span className="text-brand-danger">*</span>
            </label>
            <textarea
              id="consultation-clinical-findings"
              required
              rows={2}
              disabled={disabled}
              value={findings}
              onChange={(event) => onFindingsChange(event.target.value)}
              placeholder="Examination findings and observed symptoms"
              aria-invalid={Boolean(errors.findings)}
              className={`${inputClass(errors.findings)} resize-y`}
            />
            {errors.findings && <p className="mt-1 text-xs text-brand-danger" role="alert">{errors.findings}</p>}
          </div>
          {showDiagnosis && (
            <div>
              <label htmlFor="consultation-diagnosis" className="mb-1 block text-xs text-brand-gray">Diagnosis / Assessment</label>
              <textarea
                id="consultation-diagnosis"
                rows={2}
                disabled={disabled}
                value={diagnosis}
                onChange={(event) => onDiagnosisChange(event.target.value)}
                placeholder="Clinical diagnosis or assessment"
                aria-invalid={Boolean(errors.diagnosis)}
                className={`${inputClass(errors.diagnosis)} resize-y`}
              />
              {errors.diagnosis && <p className="mt-1 text-xs text-brand-danger" role="alert">{errors.diagnosis}</p>}
            </div>
          )}
        </div>
      </section>
      <section className="mb-4" aria-label="Medications and prescriptions">
        <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-brand-blue">Medications / Prescriptions</h4>
        <MedicineSelector
          value={medications}
          onChange={onMedicationsChange}
          errors={errors}
          disabled={disabled}
          collapsible
        />
      </section>
      <section className="mb-4" aria-label="Recommendations and instructions">
        <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-brand-blue">Recommendations / Instructions</h4>
        <label htmlFor="consultation-recommendations" className="mb-1 block text-xs text-brand-gray">
          Recommendations {recommendationsRequired && <span className="text-brand-danger">*</span>}
        </label>
        <textarea
          id="consultation-recommendations"
          rows={2}
          disabled={disabled}
          value={recommendations}
          onChange={(event) => onRecommendationsChange(event.target.value)}
          placeholder="Follow-up care, self-care guidance or instructions"
          aria-invalid={Boolean(errors.adviceGiven || errors.recommendations)}
          className={`${inputClass(errors.adviceGiven || errors.recommendations)} resize-y`}
        />
        {(errors.adviceGiven || errors.recommendations) && (
          <p className="mt-1 text-xs text-brand-danger" role="alert">{errors.adviceGiven || errors.recommendations}</p>
        )}
      </section>
    </>
  );
}
