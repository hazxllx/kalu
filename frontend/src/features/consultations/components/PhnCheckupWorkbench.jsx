import React, { useEffect, useRef, useState } from "react";
import { X, CheckCircle2, Send, CalendarClock, Activity, Stethoscope, AlertTriangle, FileText, Pill } from "lucide-react";
import { Card } from "@/components/common/Card";
import { FormModalHeader } from "@/components/common/FormModal";
import { consultationLocationFor } from "@/lib/consultationLocations";
import { useAuth } from "@/context/AuthContext";
import { usePermissions } from "@/context/PermissionsContext";
import { phnWorkflowApi } from "@/services/api/phnWorkflow";
import MedicalCertificateModal from "@/features/certificates/components/MedicalCertificateModal";
import ConsultationClinicalFields from "@/features/consultations/components/ConsultationClinicalFields";
import ConsultationHealthServiceField from "@/features/consultations/components/ConsultationHealthServiceField";
import { formatClinicalDateTime } from "@/lib/dateUtils";
import ResidentHealthHistory from "@/features/consultations/components/ResidentHealthHistory";

export const CHECKUP_STATUS_TONES = {
  "Waiting for PHN": "bg-brand-accent/10 text-brand-accent",
  "In Check-up": "bg-brand-blue/10 text-brand-blue",
  "Consultation Completed": "bg-brand-green/10 text-brand-green",
};

const RISK_TONES = {
  High: "bg-brand-danger/10 text-brand-danger",
  Medium: "bg-brand-yellow/15 text-[#B07E00]",
  Moderate: "bg-brand-yellow/15 text-[#B07E00]",
  Low: "bg-brand-green/10 text-brand-green",
  Incomplete: "bg-brand-yellow/15 text-[#B07E00]",
  Unavailable: "bg-slate-100 text-slate-600",
  Unassessed: "bg-slate-100 text-slate-600",
};

const HEALTH_CONCERNS = [
  "Hypertension",
  "Diabetes",
  "Suspected Communicable Disease",
  "Respiratory Symptoms",
  "Fever",
  "Medication / Maintenance Review",
  "Routine Monitoring",
  "Other",
];

const inputCls = (error) =>
  `w-full bg-white border rounded-btn px-3 py-2.5 text-sm outline-none focus:border-brand-blue ${
    error ? "border-brand-danger" : "border-brand-border"
  }`;

const hasValue = (value) => value !== null && value !== undefined && String(value).trim() !== "";
const measurement = (value, unit = "") => hasValue(value) ? `${value}${unit ? ` ${unit}` : ""}` : null;

const InfoItem = ({ label, value, fallback = "Not recorded" }) => (
  <div>
    <p className="text-xs text-brand-gray mb-1">{label}</p>
    <p className="break-words text-sm font-medium text-brand-ink">{hasValue(value) ? value : fallback}</p>
  </div>
);

const DateTimeItem = ({ label, value }) => {
  const formatted = formatClinicalDateTime(value);
  return (
    <div>
      <p className="text-xs text-brand-gray mb-1">{label}</p>
      <p className="text-sm font-medium text-brand-ink">{formatted.date === "—" ? "Not recorded" : formatted.date}</p>
      {formatted.time !== "—" ? <p className="text-xs text-brand-gray">{formatted.time}</p> : null}
    </div>
  );
};

const SectionTitle = ({ step, title }) => (
  <div className="flex items-center gap-2 mb-3">
    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-brand-blue/10 text-xs font-bold text-brand-blue">
      {step}
    </span>
    <h4 className="text-xs font-semibold uppercase tracking-wide text-brand-gray">{title}</h4>
  </div>
);

const RiskPill = ({ level }) => (
  <span className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-1 text-xs font-medium ${RISK_TONES[level] || RISK_TONES.Unassessed}`}>
    {level || "Unassessed"}
  </span>
);

const OutcomeItem = ({ label, value }) => (
  <div className="rounded-btn bg-brand-bg/60 border border-brand-border px-3 py-2">
    <p className="text-[11px] font-semibold uppercase tracking-wide text-brand-gray">{label}</p>
    <p className="mt-0.5 text-sm font-medium text-brand-ink">{value || "—"}</p>
  </div>
);

/**
 * PHN consultation workbench.
 *
 *  - "Patient Information"  — resident profile + consultation location (RHU).
 *  - "Triage Information"   — READ-ONLY snapshot collected by RHU Personnel.
 *  - "PHN Check-up"         — the PHN records assessment / findings / health
 *                             concern / clinical notes / recommendations here.
 *
 * The Risk Level is calculated AUTOMATICALLY from the read-only triage data
 * and the PHN's entries (rule-based, front-end prototype only). When a check-up
 * already exists the same sections render in read-only mode so the completed
 * consultation can be reopened from Health Records or the Check-ups list.
 */
/**
 * @param {{patient: any, onClose: () => void, user?: any, onComplete?: any, onOutcome?: any}} props
 */
export default function PhnCheckupWorkbench({ patient, onClose, onComplete = undefined, onOutcome = undefined }) {
  const [assessment, setAssessment] = useState("");
  const [diagnosis, setDiagnosis] = useState("");
  const [healthConcern, setHealthConcern] = useState("");
  const [clinicalNotes, setClinicalNotes] = useState("");
  const [recommendations, setRecommendations] = useState("");
  const [healthServiceId, setHealthServiceId] = useState("");
  const [healthServices, setHealthServices] = useState([]);
  const [healthServicesLoading, setHealthServicesLoading] = useState(false);
  const [healthServicesError, setHealthServicesError] = useState("");
  const [medications, setMedications] = useState(/** @type {any[]} */ ([]));
  const [errors, setErrors] = useState(/** @type {Record<string, any>} */ ({}));
  const [justCompleted, setJustCompleted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [certOpen, setCertOpen] = useState(false);
  const submittingRef = useRef(false);
  const hydratedRecord = useRef(null);
  const certOpenRef = useRef(false);
  certOpenRef.current = certOpen;
  const { user } = useAuth();
  const { can } = usePermissions();

  const completed = Boolean(patient?.checkup) || patient?.status === "Consultation Completed";
  const checkup = patient?.checkup;

  const residenceBarangay = patient?.residenceBarangay || patient?.barangay || null;
  const consultationLocation = consultationLocationFor(patient || {});

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e) => {
      if (e.key === "Escape" && !submittingRef.current && !certOpenRef.current) onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  useEffect(() => {
    const identity = `${patient?.id || ""}:${completed}`;
    if (hydratedRecord.current === identity) return;
    hydratedRecord.current = identity;
    const saved = checkup || patient?.checkupDraft;
    setAssessment(saved?.assessment || "");
    setDiagnosis(saved?.diagnosis || "");
    setHealthConcern(saved?.healthConcern || "");
    setClinicalNotes(saved?.clinicalNotes || "");
    setRecommendations(saved?.recommendations || "");
    setMedications(Array.isArray(saved?.medications) ? saved.medications : []);
    setErrors({});
    setSubmitError("");
    setJustCompleted(false);
  }, [patient?.id, patient?.checkupDraft, checkup, completed]);

  useEffect(() => {
    setHealthServiceId(patient?.serviceId || patient?.raw?.healthServiceId || "");
    setHealthServices([]);
    setHealthServicesError("");
    if (completed) return undefined;

    let active = true;
    setHealthServicesLoading(true);
    phnWorkflowApi
      .listConsultationHealthServices()
      .then((rows) => {
        if (active) setHealthServices(rows);
      })
      .catch((error) => {
        if (active) {
          setHealthServicesError(error?.message || "Could not load active health services.");
        }
      })
      .finally(() => {
        if (active) setHealthServicesLoading(false);
      });
    return () => {
      active = false;
    };
  }, [patient?.id, patient?.serviceId, patient?.raw?.healthServiceId, completed]);

  // Authoritative risk comes from the backend assessment (phnQueue.service /
  // residentRisk.js), resolved onto the patient row by mapVisitToPatient. A
  // client-side prototype engine must not override the stored clinical risk.
  const autoRisk = {
    level: patient?.riskAssessmentStatus === "incomplete" ? "Incomplete"
      : patient?.riskAssessmentStatus === "unavailable" ? "Unavailable"
        : patient?.riskLevel ?? patient?.checkup?.riskLevel ?? "Unassessed",
    reason: patient?.riskReason || patient?.checkup?.riskReason || (Array.isArray(patient?.riskFactors)
      ? patient.riskFactors.map((factor) => typeof factor === "string" ? factor : factor?.name || factor?.label || factor?.message || factor?.reason || "").filter(Boolean).join("; ")
      : "") || "The backend assessment breakdown is unavailable. Reload the record to verify the assessment.",
  };

  const validate = () => {
    const next = {};
    if (!assessment.trim()) next.assessment = "Please record your assessment or findings.";
    if (!healthConcern.trim()) next.healthConcern = "Health concern is required.";
    if (!recommendations.trim()) next.recommendations = "Record the actual treatment or recommendations before completing the consultation.";
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleComplete = async () => {
    if (submittingRef.current) return;
    if (!validate()) return;
    submittingRef.current = true;
    const recorded = {
      assessment: assessment.trim(),
      diagnosis: diagnosis.trim(),
      healthConcern: healthConcern.trim(),
      consultationLocation,
      clinicalNotes: clinicalNotes.trim(),
      recommendations: recommendations.trim(),
      medications,
      healthServiceId: healthServiceId || null,
      expectedUpdatedAt: patient?.raw?.updatedAt,
    };
    setSubmitting(true);
    setSubmitError("");
    try {
      if (typeof onComplete !== "function") throw new Error("Saving is unavailable. Reopen this consultation from the queue.");
      await onComplete(recorded);
      setJustCompleted(true);
    } catch (error) {
      const fieldErrors = error?.payload?.error?.errors || error?.payload?.error?.details || {};
      setErrors(Object.fromEntries(Object.entries(fieldErrors).filter(([field]) => field.startsWith("medications"))));
      setSubmitError(error?.message || "Could not save this check-up. Your entries are still available; retry when ready.");
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  const statusTone = CHECKUP_STATUS_TONES[patient?.status] || "bg-slate-100 text-slate-600";

  const renderOutcomeActions = () => (
    <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-brand-border pt-4">
      <span className="text-xs font-semibold uppercase tracking-wide text-brand-gray">Next:</span>
      <button
        onClick={() => onOutcome?.("referral")}
        className="flex items-center gap-1.5 text-sm font-medium text-brand-blue hover:underline"
      >
        <Send className="w-3.5 h-3.5" /> Create Referral
      </button>
      <button
        onClick={() => onOutcome?.("followup")}
        className="flex items-center gap-1.5 text-sm font-medium text-brand-blue hover:underline"
      >
        <CalendarClock className="w-3.5 h-3.5" /> Schedule Follow-up
      </button>
      <button
        onClick={() => onOutcome?.("monitoring")}
        className="flex items-center gap-1.5 text-sm font-medium text-brand-blue hover:underline"
      >
        <Activity className="w-3.5 h-3.5" /> Continue Monitoring
      </button>
      <button
        onClick={() => onOutcome?.("service")}
        className="flex items-center gap-1.5 text-sm font-medium text-brand-blue hover:underline"
      >
        <Stethoscope className="w-3.5 h-3.5" /> Coordinate Health Service
      </button>
      <button
        onClick={() => setCertOpen(true)}
        className="flex items-center gap-1.5 text-sm font-medium text-brand-blue hover:underline"
      >
        <FileText className="w-3.5 h-3.5" /> Medical Certificate
      </button>
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-2 sm:p-4" onClick={() => { if (!submitting) onClose(); }}>
      <div className={`w-full min-w-0 ${completed ? "max-w-4xl" : "max-w-5xl"}`} onClick={(e) => e.stopPropagation()}>
        <Card role="dialog" aria-modal="true" aria-label={`PHN check-up for ${patient?.patient}`} className={`flex h-[min(90dvh,820px)] min-h-0 flex-col overflow-hidden ${completed ? "" : "border-brand-border bg-white dark:border-border dark:bg-card"} sm:max-h-[90dvh]`}>
          {completed ? (
            <div className="flex shrink-0 items-start gap-3 border-b border-brand-border px-4 py-3 sm:items-center sm:px-6 sm:py-4">
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-blue text-white text-sm font-semibold">
                {(patient?.patient || "?")
                  .split(" ")
                  .map((n) => n[0])
                  .slice(0, 2)
                  .join("")}
              </div>
              <div className="min-w-0">
                <h3 className="break-words text-base font-semibold leading-snug text-brand-ink" title={patient?.patient}>{patient?.patient}</h3>
                <p className="text-xs text-brand-gray">
                  PHN Check-up {completed ? "Record" : "in progress"}
                </p>
                <span className={`mt-1 inline-flex max-w-full whitespace-normal rounded-full px-2.5 py-1 text-[11px] font-medium leading-tight sm:whitespace-nowrap sm:text-xs ${statusTone}`}>
                  {patient?.status}
                </span>
              </div>
            </div>
            <div className="flex shrink-0 items-center">
              <button onClick={onClose} disabled={submitting} className="flex h-9 w-9 items-center justify-center rounded-lg text-brand-gray transition-colors hover:bg-brand-bg hover:text-brand-ink disabled:opacity-50" aria-label="Close">
                <X className="w-4 h-4" />
              </button>
            </div>
            </div>
          ) : (
            <FormModalHeader
              title="PHN Check-up"
              description={`${patient?.patient || "Resident"} · In progress · ${patient?.status || "Pending"}`}
              onClose={onClose}
              closeDisabled={submitting}
            />
          )}

          <div className="min-h-0 flex-1 touch-pan-y overflow-y-auto overscroll-contain px-3 py-3 sm:px-5 sm:py-4">
            {submitError && <p className="mb-4 rounded-btn border border-brand-danger/30 bg-brand-danger/5 px-3 py-2.5 text-sm text-brand-danger" role="alert">{submitError}</p>}
            {/* Patient Information */}
            <div className="mb-4">
              <SectionTitle step={1} title="Patient Information" />
              <div className="grid grid-cols-2 gap-2 rounded-btn border border-brand-border bg-brand-bg/60 px-3 py-2 sm:grid-cols-4">
                <InfoItem label="Patient Name" value={patient?.patient} />
                <InfoItem label="Age at Triage" value={measurement(patient?.age, "yrs")} />
                <InfoItem label="Sex" value={patient?.sex} />
                <InfoItem label="Patient ID" value={patient?.residentId} />
                <DateTimeItem label="Date of Visit" value={patient?.visitDate} />
                <InfoItem label="Barangay" value={residenceBarangay} />
                <InfoItem label="Consultation Location" value={consultationLocation} />
              </div>
            </div>

            {/* Triage Information — READ ONLY */}
            <div className="mb-4">
              <SectionTitle step={2} title="Triage Information (collected by RHU Personnel)" />
              <div className="rounded-btn border border-brand-border px-3 py-2">
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <div className="sm:col-span-2 lg:col-span-3">
                    <InfoItem label="Chief Complaint / Reason for Visit" value={patient?.triage?.chiefComplaint || patient?.reason} />
                  </div>
                  <InfoItem label="Height" value={measurement(patient?.triage?.heightCm, "cm")} />
                  <InfoItem label="Weight" value={measurement(patient?.triage?.weight, "kg")} />
                  <InfoItem label="BMI" value={measurement(patient?.triage?.bmi, "kg/m²")} />
                  <InfoItem label="Blood Pressure" value={measurement(patient?.triage?.bloodPressure, "mmHg")} />
                  <InfoItem label="Blood Sugar" value={measurement(patient?.triage?.bloodSugar, "mg/dL")} />
                  <InfoItem label="Temperature" value={measurement(patient?.triage?.temperature, "°C")} />
                  <InfoItem label="Pulse Rate" value={measurement(patient?.triage?.pulseRate, "bpm")} />
                  <InfoItem label="Respiratory Rate" value={measurement(patient?.triage?.respiratoryRate, "/min")} />
                  <InfoItem label="O2 Saturation" value={measurement(patient?.triage?.oxygenSaturation, "%")} />
                  <DateTimeItem label="Triage Date and Time" value={patient?.triage?.date} />
                  <InfoItem label="Triage Personnel" value={patient?.triage?.personnel} />
                  <InfoItem label="Triage / Encounter ID" value={patient?.triage?.id || patient?.id} />
                </div>
                <details className="mt-2 border-t border-brand-border pt-2">
                  <summary className="cursor-pointer text-xs font-medium text-brand-blue">Triage notes</summary>
                  <p className="mt-1 whitespace-pre-line text-sm text-brand-ink">{patient?.triage?.notes || "Not recorded"}</p>
                </details>
                {patient?.triage?.warnings?.length > 0 && (
                  <div className="mt-3 rounded-btn border border-brand-accent/30 bg-brand-accent/5 p-3 text-xs text-brand-ink" role="note">
                    <p className="font-semibold">Measurements flagged for clinical review</p>
                    <ul className="mt-1 list-disc space-y-1 pl-4">
                      {patient.triage.warnings.map((warning, index) => <li key={index}>{typeof warning === "string" ? warning : warning.message}</li>)}
                    </ul>
                  </div>
                )}
              </div>
            </div>

            {user?.id && patient?.residentId && can("consultation.history.view")
              && ["phn", "health_supervisor", "mho"].includes(user.role) && (
                <details className="mb-4 rounded-btn border border-brand-border px-3">
                  <summary className="cursor-pointer py-2 text-xs font-medium text-brand-blue">Resident health history</summary>
                  <ResidentHealthHistory residentId={patient.residentId} consultationId={patient.id} ownerId={user.id}
                    scopeKey={JSON.stringify([user.role, user.municipalityId, user.barangayId])} revision={`${patient.id}:${completed || justCompleted}`} />
                </details>
              )}
            {/* PHN Check-up */}
            {completed && checkup ? (
              <div>
                <SectionTitle step={3} title="PHN Check-up Record" />
                <div className="space-y-3">
                  <section className="rounded-btn border border-brand-border bg-white px-4 py-3">
                    <h5 className="mb-3 text-xs font-semibold uppercase tracking-wide text-brand-gray">Assessment</h5>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                      <InfoItem label="Assessment / Findings" value={checkup.assessment} />
                      <InfoItem label="Diagnosis / Assessment" value={checkup.diagnosis} />
                      <InfoItem label="Health Concern" value={checkup.healthConcern} />
                      <InfoItem label="Health Service" value={patient?.serviceName || patient?.raw?.healthServiceName} fallback="No specific health service" />
                      <div>
                        <p className="text-xs text-brand-gray mb-1">Risk Level</p>
                        <RiskPill level={checkup.riskLevel || autoRisk.level} />
                      </div>
                    </div>
                    <p className="mt-3 border-t border-brand-border pt-3 text-sm text-brand-ink break-words">
                      <span className="text-xs text-brand-gray">Risk Reason: </span>{checkup.riskReason || autoRisk.reason}
                    </p>
                  </section>

                  <section className="rounded-btn border border-brand-border bg-white px-4 py-3">
                    <h5 className="mb-2 text-xs font-semibold uppercase tracking-wide text-brand-gray">Clinical Notes</h5>
                    <p className="whitespace-pre-wrap break-words text-sm text-brand-ink">{checkup.clinicalNotes || "No clinical notes recorded."}</p>
                  </section>

                  <section className="rounded-btn border border-brand-border bg-white px-4 py-3">
                    <h5 className="mb-2 text-xs font-semibold uppercase tracking-wide text-brand-gray">Recommendations</h5>
                    <p className="whitespace-pre-wrap break-words text-sm text-brand-ink">{checkup.recommendations || "No recommendations recorded."}</p>
                  </section>

                  <section className="rounded-btn border border-brand-border bg-white px-4 py-3">
                    <h5 className="mb-2 text-xs font-semibold uppercase tracking-wide text-brand-gray">Medications / Prescriptions</h5>
                    {Array.isArray(checkup.medications) && checkup.medications.length > 0 ? (
                      <ul className="space-y-1.5">
                        {checkup.medications.map((m, i) => (
                          <li key={`${m.medicineId || "custom"}-${i}`} className="rounded-btn border border-brand-border p-3 text-sm text-brand-ink">
                            <div className="mb-3 flex items-start gap-2">
                            <Pill className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-blue" aria-hidden="true" />
                              <span className="min-w-0 break-words font-medium">{[m.genericName, m.brandName && `(${m.brandName})`, m.strength, m.dosageForm].filter(Boolean).join(" ") || "Medication name not recorded"}</span>
                            </div>
                            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                              <InfoItem label="Prescribed Dosage" value={m.dose} fallback="Not provided" />
                              <InfoItem label="Frequency" value={m.frequency} fallback="Not provided" />
                              <InfoItem label="Route" value={m.route} fallback="Not provided" />
                              <InfoItem label="Duration" value={m.duration} fallback="Not provided" />
                              <InfoItem label="Quantity" value={m.quantity} fallback="Not provided" />
                              <InfoItem label="Special Instructions" value={m.instructions} fallback="Not provided" />
                            </div>
                            {![m.dose, m.frequency, m.route, m.duration, m.instructions].some(hasValue) && <p className="mt-2 text-xs text-brand-gray">Prescription details have not yet been provided.</p>}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-sm text-brand-gray">No medication prescribed for this check-up.</p>
                    )}
                  </section>

                  <section className="rounded-btn border border-brand-border bg-white px-4 py-3">
                    <h5 className="mb-3 text-xs font-semibold uppercase tracking-wide text-brand-gray">Outcome</h5>
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                      <InfoItem label="Consultation Location" value={checkup.consultationLocation || consultationLocation} />
                      <InfoItem label="Assessed By" value={checkup.personnel} />
                      <InfoItem label="Completed By" value={checkup.completedBy} />
                      <InfoItem label="Completed" value={checkup.completedAt} />
                      <OutcomeItem label="Consultation Status" value={patient?.status} />
                      <OutcomeItem label="Outcome" value={checkup.outcome || "No Further Action"} />
                      <OutcomeItem label="Referral" value={checkup.referralStatus || "—"} />
                      <OutcomeItem label="Follow-up" value={checkup.followUpStatus || "—"} />
                      <OutcomeItem label="Monitoring / Health Service" value={checkup.serviceStatus || "—"} />
                    </div>
                  </section>
                </div>
                {justCompleted && (
                  <div className="mt-4 flex items-center gap-2 rounded-btn bg-brand-green/10 border border-brand-green/20 px-4 py-3 text-sm text-brand-green">
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                    Check-up completed. The patient record now reflects the full triage â†’ check-up workflow.
                  </div>
                )}
                {onOutcome ? renderOutcomeActions() : null}
              </div>
            ) : completed ? (
              <div>
                <SectionTitle step={3} title="PHN Check-up Record" />
                <p className="rounded-btn border border-brand-border bg-brand-bg/40 px-4 py-3 text-sm text-brand-gray" role="status">
                  This consultation is marked completed, but the clinical summary is unavailable. No new record will be created from this view.
                </p>
                {onOutcome ? renderOutcomeActions() : null}
              </div>
            ) : (
              <div>
                <SectionTitle step={3} title="PHN Check-up" />
                <p className="mb-3 flex items-start gap-2 rounded-btn border border-brand-blue/10 bg-brand-blue/5 px-3 py-2 text-xs text-brand-gray">
                  <AlertTriangle className="w-4 h-4 shrink-0 text-brand-accent" />
                  Do not re-enter information already collected during triage. Record only your assessment and
                  recommendations for this check-up.
                </p>
                <div className="space-y-3">
                  <div>
                    <ConsultationHealthServiceField
                      value={healthServiceId}
                      onChange={setHealthServiceId}
                      services={healthServices}
                      loading={healthServicesLoading}
                      serviceError={healthServicesError}
                      recordedName={patient?.serviceName || patient?.raw?.healthServiceName || ""}
                    />
                  </div>
                  <label htmlFor="phn-health-concern" className="block text-xs font-medium text-brand-gray">
                    Health Concern <span className="text-brand-danger">*</span>
                    <input
                      id="phn-health-concern"
                      type="text"
                      list="phn-health-concerns"
                      placeholder="e.g. Hypertension"
                      value={healthConcern}
                      onChange={(event) => {
                        setHealthConcern(event.target.value);
                        if (errors.healthConcern) setErrors((previous) => ({ ...previous, healthConcern: "" }));
                      }}
                      className={`${inputCls(errors.healthConcern)} mt-1`}
                    />
                    <datalist id="phn-health-concerns">
                      {HEALTH_CONCERNS.map((concern) => <option key={concern} value={concern} />)}
                    </datalist>
                  </label>
                  {errors.healthConcern && <p className="text-xs text-brand-danger" role="alert">{errors.healthConcern}</p>}

                  <ConsultationClinicalFields
                    findings={assessment}
                    onFindingsChange={(value) => {
                      setAssessment(value);
                      if (errors.assessment) setErrors((previous) => ({ ...previous, assessment: "" }));
                    }}
                    diagnosis={diagnosis}
                    onDiagnosisChange={setDiagnosis}
                    medications={medications}
                    onMedicationsChange={setMedications}
                    recommendations={recommendations}
                    onRecommendationsChange={(value) => {
                      setRecommendations(value);
                      if (errors.recommendations) setErrors((previous) => ({ ...previous, recommendations: "" }));
                    }}
                    errors={{ ...errors, findings: errors.assessment }}
                    findingsLabel="Assessment / Findings"
                    recommendationsRequired
                  />

                  {/* Automatic risk level */}
                  <div>
                    <div className="flex items-center gap-2 mb-1.5">
                      <label className="text-sm font-medium text-brand-ink">Risk Level</label>
                    <span className="text-[11px] text-brand-gray">
                        Backend assessment from the recorded triage measurements.
                      </span>
                    </div>
                    <div className="flex flex-col items-start gap-2 rounded-btn border border-brand-border bg-brand-bg/40 px-3 py-3 sm:flex-row sm:items-center sm:gap-3 sm:px-4">
                      <RiskPill level={autoRisk.level} />
                      <p className="text-sm text-brand-ink">
                        <span className="text-brand-gray">Reason:</span> <span className="break-words">{autoRisk.reason}</span>
                      </p>
                    </div>
                  </div>

                  <div>
                    <label htmlFor="phn-clinical-notes" className="text-sm font-medium text-brand-ink block mb-1.5">Clinical Notes</label>
                    <textarea
                      id="phn-clinical-notes"
                      rows={2}
                      placeholder="e.g. Patient reports occasional dizziness. BP remains elevated."
                      value={clinicalNotes}
                      onChange={(e) => setClinicalNotes(e.target.value)}
                        className={`${inputCls()} max-h-32 resize-y`}
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium text-brand-ink block mb-1.5">
                      Assessed By
                    </label>
                    <div className={`${inputCls()} flex items-center bg-brand-bg/40 text-brand-gray`}>
                      {user?.name || "Your account"}
                    </div>
                    <p className="mt-1 text-xs text-brand-gray">
                      This consultation is automatically recorded under your signed-in account.
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-brand-border bg-white px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:gap-3 sm:px-6 sm:py-4">
            <button
              onClick={onClose}
              disabled={submitting}
              className="min-h-10 px-3 py-2 rounded-btn text-sm font-medium text-brand-gray hover:bg-brand-bg transition-colors disabled:opacity-50"
            >
              {completed ? "Close" : "Cancel"}
            </button>
            {!completed && (
              <button
                onClick={handleComplete}
                disabled={submitting}
                className={`flex min-h-10 items-center justify-center gap-2 rounded-btn px-3 py-2 text-xs font-medium text-white transition-colors disabled:cursor-wait disabled:opacity-60 sm:px-4 sm:text-sm ${completed ? "bg-brand-green hover:opacity-90" : "bg-brand-blue hover:bg-brand-dark"}`}
              >
                {submitting ? <Activity className="h-4 w-4 animate-pulse" /> : <CheckCircle2 className="w-4 h-4" />}
                {submitting ? "Saving…" : "Complete Check-up"}
              </button>
            )}
          </div>
        </Card>
      </div>

      {/* Medical Certificate (prepared by the PHN, submitted for MHO review) */}
      {certOpen && patient && (
        <MedicalCertificateModal
          mode="create"
          patient={{
            patientId: patient.residentId || String(patient.id),
            patient: patient.patient,
            age: patient.age ?? "",
            sex: patient.sex || "",
            barangay: residenceBarangay || "RHU",
            address: residenceBarangay || "RHU",
          }}
          currentUser={user?.name || "Public Health Nurse"}
          currentUserRole="Public Health Nurse"
          onClose={() => setCertOpen(false)}
        />
      )}
    </div>
  );
}
