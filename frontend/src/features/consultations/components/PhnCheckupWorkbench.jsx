import React, { useEffect, useMemo, useState } from "react";
import { X, CheckCircle2, Send, CalendarClock, Activity, Stethoscope, AlertTriangle } from "lucide-react";
import { Card } from "@/components/common/Card";
import { calculateRiskLevel } from "@/lib/riskRules";
import { consultationLocationFor } from "@/lib/consultationLocations";
import { useWorkflowStore } from "@/services/mock/mockWorkflowStore";

export const CHECKUP_STATUS_TONES = {
  "Waiting for PHN": "bg-brand-accent/10 text-brand-accent",
  "In Check-up": "bg-brand-blue/10 text-brand-blue",
  "Consultation Completed": "bg-brand-green/10 text-brand-green",
};

const RISK_TONES = {
  High: "bg-brand-danger/10 text-brand-danger",
  Medium: "bg-brand-yellow/15 text-[#B07E00]",
  Low: "bg-brand-green/10 text-brand-green",
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

const InfoItem = ({ label, value, fallback = "—" }) => (
  <div>
    <p className="text-xs text-brand-gray mb-1">{label}</p>
    <p className="text-sm font-medium text-brand-ink">{value || fallback}</p>
  </div>
);

const SectionTitle = ({ step, title }) => (
  <div className="flex items-center gap-2 mb-3">
    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-brand-blue/10 text-xs font-bold text-brand-blue">
      {step}
    </span>
    <h4 className="text-xs font-semibold uppercase tracking-wide text-brand-gray">{title}</h4>
  </div>
);

const RiskPill = ({ level }) => (
  <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${RISK_TONES[level] || RISK_TONES.Medium}`}>
    {level}
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
export default function PhnCheckupWorkbench({ patient, onClose, onComplete = undefined, onOutcome = undefined }) {
  const [assessment, setAssessment] = useState("");
  const [healthConcern, setHealthConcern] = useState("");
  const [clinicalNotes, setClinicalNotes] = useState("");
  const [recommendations, setRecommendations] = useState("");
  const [errors, setErrors] = useState({});
  const [justCompleted, setJustCompleted] = useState(false);

  const completed = Boolean(patient?.checkup) || patient?.status === "Consultation Completed";
  const checkup = patient?.checkup;

  const residenceBarangay = patient?.residenceBarangay || patient?.barangay || null;
  const consultationLocation = consultationLocationFor(patient || {});

  const workflow = useWorkflowStore();
  const referralRow = (workflow.referrals || []).find((r) => r.resident === patient?.patient);
  const followUpRow = (workflow.followUps || []).find((f) => f.resident === patient?.patient);
  const serviceRow = (workflow.services || []).find(
    (s) => (s.name || "").includes(patient?.patient) || (s.notes || "").includes(patient?.patient)
  );

  useEffect(() => {
    document.body.style.overflow = "hidden";
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "";
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  useEffect(() => {
    if (checkup) {
      setAssessment(checkup.assessment || "");
      setHealthConcern(checkup.healthConcern || "");
      setClinicalNotes(checkup.clinicalNotes || "");
      setRecommendations(checkup.recommendations || "");
    }
  }, [checkup]);

  // Automatic, rule-based risk level that re-evaluates live as the PHN types.
  const autoRisk = useMemo(
    () =>
      calculateRiskLevel(patient || {}, patient?.triage || {}, {
        healthConcern,
        assessment,
        clinicalNotes,
        recommendations,
      }),
    [patient, healthConcern, assessment, clinicalNotes, recommendations]
  );

  const displayedLevel = checkup?.riskLevel || autoRisk.level;
  const displayedReason = checkup?.riskReason || autoRisk.reason;

  const validate = () => {
    const next = {};
    if (!assessment.trim()) next.assessment = "Please record your assessment or findings.";
    if (!healthConcern.trim()) next.healthConcern = "Health concern is required.";
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleComplete = () => {
    if (!validate()) return;
    const recorded = {
      assessment: assessment.trim(),
      healthConcern: healthConcern.trim(),
      riskLevel: autoRisk.level,
      riskReason: autoRisk.reason,
      consultationLocation,
      clinicalNotes: clinicalNotes.trim(),
      recommendations: recommendations.trim(),
    };
    setJustCompleted(true);
    onComplete?.(recorded);
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
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-3xl" onClick={(e) => e.stopPropagation()}>
        <Card role="dialog" aria-modal="true" aria-label={`PHN check-up for ${patient?.patient}`} className="flex max-h-[92vh] flex-col overflow-hidden">
          {/* Header */}
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-brand-border px-6 py-4">
            <div className="flex items-center gap-3 min-w-0">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-blue text-white text-sm font-semibold">
                {(patient?.patient || "?")
                  .split(" ")
                  .map((n) => n[0])
                  .slice(0, 2)
                  .join("")}
              </div>
              <div className="min-w-0">
                <h3 className="truncate text-base font-semibold text-brand-ink">{patient?.patient}</h3>
                <p className="text-xs text-brand-gray">
                  PHN Check-up {completed ? "Record" : "in progress"}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${statusTone}`}>
                {patient?.status}
              </span>
              <button onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-lg text-brand-gray transition-colors hover:bg-brand-bg hover:text-brand-ink" aria-label="Close">
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-6 py-5">
            {/* Patient Information */}
            <div className="mb-6">
              <SectionTitle step={1} title="Patient Information" />
              <div className="grid grid-cols-2 gap-3 rounded-btn bg-brand-bg/60 border border-brand-border px-4 py-3 sm:grid-cols-4">
                <InfoItem label="Patient Name" value={patient?.patient} />
                <InfoItem label="Age" value={patient?.age !== undefined && patient?.age !== null ? `${patient.age} yrs` : null} />
                <InfoItem label="Sex" value={patient?.sex} />
                <InfoItem label="Date of Visit" value={patient?.visitDate} />
                <InfoItem label="Barangay" value={residenceBarangay} />
                <InfoItem label="Consultation Location" value={consultationLocation} />
              </div>
            </div>

            {/* Triage Information — READ ONLY */}
            <div className="mb-6">
              <SectionTitle step={2} title="Triage Information (collected by RHU Personnel)" />
              <div className="rounded-btn border border-brand-border px-4 py-3">
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  <div className="sm:col-span-2 lg:col-span-3">
                    <InfoItem label="Chief Complaint / Reason for Visit" value={patient?.triage?.chiefComplaint || patient?.reason} />
                  </div>
                  <InfoItem label="Temperature" value={patient?.triage?.temperature ? `${patient.triage.temperature} °C` : null} />
                  <InfoItem label="Blood Pressure" value={patient?.triage?.bloodPressure ? `${patient.triage.bloodPressure} mmHg` : null} />
                  <InfoItem label="Pulse Rate" value={patient?.triage?.pulseRate ? `${patient.triage.pulseRate} bpm` : null} />
                  <InfoItem label="Respiratory Rate" value={patient?.triage?.respiratoryRate ? `${patient.triage.respiratoryRate} /min` : null} />
                  {patient?.triage?.oxygenSaturation ? (
                    <InfoItem label="O2 Saturation" value={`${patient.triage.oxygenSaturation} %`} />
                  ) : null}
                  {patient?.triage?.weight ? <InfoItem label="Weight" value={`${patient.triage.weight} kg`} /> : null}
                  {patient?.triage?.date ? <InfoItem label="Triage Date" value={patient.triage.date} /> : null}
                  <InfoItem label="Triage Personnel" value={patient?.triage?.personnel} />
                </div>
                {patient?.triage?.notes ? (
                  <div className="mt-3 border-t border-brand-border pt-3">
                    <p className="text-xs text-brand-gray mb-1">Triage Notes</p>
                    <p className="text-sm text-brand-ink whitespace-pre-line">{patient.triage.notes}</p>
                  </div>
                ) : null}
              </div>
            </div>

            {/* PHN Check-up */}
            {completed && checkup ? (
              <div>
                <SectionTitle step={3} title="PHN Check-up Record" />
                <div className="rounded-btn border border-brand-border px-4 py-3">
                  <div className="grid grid-cols-2 gap-3">
                    <InfoItem label="Assessment / Findings" value={checkup.assessment} />
                    <InfoItem label="Health Concern" value={checkup.healthConcern} />
                    <div>
                      <p className="text-xs text-brand-gray mb-1">Risk Level</p>
                      <RiskPill level={checkup.riskLevel || autoRisk.level} />
                    </div>
                    <InfoItem label="Consultation Location" value={checkup.consultationLocation || consultationLocation} />
                    <InfoItem label="Completed By" value={checkup.completedBy} />
                    <InfoItem label="Completed" value={checkup.completedAt} />
                  </div>
                  {(checkup.riskReason || autoRisk.reason) ? (
                    <div className="mt-3 border-t border-brand-border pt-3">
                      <p className="text-xs text-brand-gray mb-1">Risk Reason</p>
                      <p className="text-sm text-brand-ink">{checkup.riskReason || autoRisk.reason}</p>
                    </div>
                  ) : null}
                  {checkup.clinicalNotes ? (
                    <div className="mt-3">
                      <p className="text-xs text-brand-gray mb-1">Clinical Notes</p>
                      <p className="text-sm text-brand-ink whitespace-pre-line">{checkup.clinicalNotes}</p>
                    </div>
                  ) : null}
                  {checkup.recommendations ? (
                    <div className="mt-3">
                      <p className="text-xs text-brand-gray mb-1">Recommendations</p>
                      <p className="text-sm text-brand-ink whitespace-pre-line">{checkup.recommendations}</p>
                    </div>
                  ) : null}
                </div>

                {/* OUTCOME */}
                <div className="mt-5">
                  <SectionTitle step={4} title="Outcome" />
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                    <OutcomeItem label="Consultation Status" value={patient?.status} />
                    <OutcomeItem label="Outcome" value={checkup.outcome || "No Further Action"} />
                    <OutcomeItem label="Referral" value={referralRow ? referralRow.status : null} />
                    <OutcomeItem label="Follow-up" value={followUpRow ? followUpRow.status : null} />
                    <OutcomeItem
                      label="Monitoring / Health Service"
                      value={serviceRow ? serviceRow.status : null}
                    />
                  </div>
                </div>
                {justCompleted && (
                  <div className="mt-4 flex items-center gap-2 rounded-btn bg-brand-green/10 border border-brand-green/20 px-4 py-3 text-sm text-brand-green">
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                    Check-up completed. The patient record now reflects the full triage → check-up workflow.
                  </div>
                )}
                {onOutcome ? renderOutcomeActions() : null}
              </div>
            ) : (
              <div>
                <SectionTitle step={3} title="PHN Check-up" />
                <p className="mb-4 flex items-start gap-2 rounded-btn bg-brand-blue/5 border border-brand-blue/10 px-3 py-2.5 text-xs text-brand-gray">
                  <AlertTriangle className="w-4 h-4 shrink-0 text-brand-accent" />
                  Do not re-enter information already collected during triage. Record only your assessment and
                  recommendations for this check-up.
                </p>
                <div className="space-y-4">
                  <div className="grid sm:grid-cols-2 gap-4">
                    <div>
                      <label className="text-sm font-medium text-brand-ink block mb-1.5">
                        Assessment / Findings <span className="text-brand-danger">*</span>
                      </label>
                      <textarea
                        rows={3}
                        placeholder="e.g. BP re-check shows 140/90 after rest..."
                        value={assessment}
                        onChange={(e) => {
                          setAssessment(e.target.value);
                          if (errors.assessment) setErrors((prev) => ({ ...prev, assessment: "" }));
                        }}
                        className={`${inputCls(errors.assessment)} resize-none`}
                      />
                      {errors.assessment && <p className="text-xs text-brand-danger mt-1">{errors.assessment}</p>}
                    </div>
                    <div>
                      <label className="text-sm font-medium text-brand-ink block mb-1.5">
                        Health Concern <span className="text-brand-danger">*</span>
                      </label>
                      <input
                        type="text"
                        list="phn-health-concerns"
                        placeholder="e.g. Hypertension"
                        value={healthConcern}
                        onChange={(e) => {
                          setHealthConcern(e.target.value);
                          if (errors.healthConcern) setErrors((prev) => ({ ...prev, healthConcern: "" }));
                        }}
                        className={inputCls(errors.healthConcern)}
                      />
                      <datalist id="phn-health-concerns">
                        {HEALTH_CONCERNS.map((c) => (
                          <option key={c} value={c} />
                        ))}
                      </datalist>
                      {errors.healthConcern && <p className="text-xs text-brand-danger mt-1">{errors.healthConcern}</p>}
                    </div>
                  </div>

                  {/* Automatic risk level */}
                  <div>
                    <div className="flex items-center gap-2 mb-1.5">
                      <label className="text-sm font-medium text-brand-ink">Risk Level</label>
                      <span className="text-[11px] text-brand-gray">
                        Risk calculated automatically based on current findings.
                      </span>
                    </div>
                    <div className="flex items-center gap-3 rounded-btn border border-brand-border bg-brand-bg/40 px-4 py-3">
                      <RiskPill level={autoRisk.level} />
                      <p className="text-sm text-brand-ink">
                        <span className="text-brand-gray">Reason:</span> {autoRisk.reason}
                      </p>
                    </div>
                  </div>

                  <div>
                    <label className="text-sm font-medium text-brand-ink block mb-1.5">Clinical Notes</label>
                    <textarea
                      rows={2}
                      placeholder="e.g. Patient reports occasional dizziness. BP remains elevated."
                      value={clinicalNotes}
                      onChange={(e) => setClinicalNotes(e.target.value)}
                      className={`${inputCls()} resize-none`}
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium text-brand-ink block mb-1.5">Recommendations</label>
                    <textarea
                      rows={2}
                      placeholder="e.g. Continue prescribed maintenance medication and schedule follow-up for BP monitoring."
                      value={recommendations}
                      onChange={(e) => setRecommendations(e.target.value)}
                      className={`${inputCls()} resize-none`}
                    />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex shrink-0 justify-end gap-3 border-t border-brand-border bg-white px-6 py-4">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-btn text-sm font-medium text-brand-gray hover:bg-brand-bg transition-colors"
            >
              {completed ? "Close" : "Cancel"}
            </button>
            {!completed && (
              <button
                onClick={handleComplete}
                className="flex items-center gap-2 px-4 py-2 rounded-btn text-sm font-medium bg-brand-green text-white hover:opacity-90 transition-colors"
              >
                <CheckCircle2 className="w-4 h-4" /> Complete Check-up
              </button>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
