import React, { useState } from "react";
import { Card } from "@/components/common/Card";
import { useCertificateMeta } from "@/features/certificates/hooks/useCertificateRegister";
import { medicalCertificatesApi } from "@/services/api";
import MedicalCertificateDocument from "./MedicalCertificateDocument";
import { useCertificatePrint } from "./useCertificatePrint.jsx";
import { useDocumentBranding } from "@/lib/documentBranding";
import { useAuth } from "@/context/AuthContext";
import { X, FileText, Printer, CheckCircle2, ClipboardCheck, Ban, Send, RefreshCw, Loader2 } from "lucide-react";

const inputCls = (error) =>
  `mt-1.5 w-full rounded-btn border bg-white px-3.5 py-2.5 text-sm outline-none transition-colors focus:border-brand-blue dark:bg-input dark:text-foreground ${
    error ? "border-brand-danger" : "border-slate-200 dark:border-border"
  }`;

const labelCls = "text-sm font-medium text-brand-ink";

const statusTone = {
  Draft: "bg-slate-100 text-slate-600 dark:bg-slate-500/20 dark:text-slate-300",
  "For Review": "bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400",
  Approved: "bg-brand-blue/10 text-brand-blue dark:bg-brand-blue/15",
  Issued: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400",
  Rejected: "bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-400",
  Cancelled: "bg-slate-100 text-slate-500 dark:bg-slate-500/20 dark:text-slate-400",
};

export function CertificateStatusBadge({ value }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${statusTone[value] || statusTone.Draft}`}>
      <span className="h-2 w-2 rounded-full bg-current opacity-70" /> {value}
    </span>
  );
}

/**
 * @param {{label: string, required?: boolean, error?: string, children: any}} props
 */
function Field({ label, required, error, children }) {
  return (
    <div>
      <label className={labelCls}>
        {label} {required && <span className="text-brand-danger">*</span>}
      </label>
      {children}
      {error && <p className="mt-1 text-xs text-brand-danger">{error}</p>}
    </div>
  );
}

/**
 * Shared Medical Certificate modal.
 *
 * Modes:
 *  - "create" (PHN / MHO): prepare a certificate for the given
 *    resident, save as Draft or submit For Review.
 *  - "edit" (PHN / MHO): update a Draft or For Review document before approval.
 *  - "view": read-only certificate preview with its real decision history.
 *  - "review" (PHN / MHO): preview + Approve/Issue/Reject actions with notes.
 *
 * Every write goes to `/api/medical-certificates`; the service resolves the
 * resident's scope, validates the transition and writes the certificate log
 * plus a `health_audit_logs` entry.
 */
/**
 * @param {{mode?: string, patient?: any, certificate?: any, currentUser?: string, currentUserRole?: string, purposes?: any, onClose: () => void, onSaved?: (status: string) => void, onRequestStatusChange?: any}} props
 */
export default function MedicalCertificateModal({
  mode = "create",
  patient = null, // { patientId, patient, age, sex, barangay, address }
  certificate = null,
  currentUser = "",
  currentUserRole = "",
  purposes: purposesProp = null,
  onClose,
  onSaved,
  onRequestStatusChange = null,
}) {
const { user } = useAuth();
const meta = useCertificateMeta();
const CERT_PURPOSES = purposesProp?.length ? purposesProp : meta.purposes;
const { printCertificate, portal, brandingError } = useCertificatePrint();
const { branding } = useDocumentBranding("medical_certificate");

/**
 * Authorized signatory — resolved from the centralized branding configuration
 * (the active MHO profile). This is authoritative for the OFFICIAL document:
 * the user can never type an arbitrary doctor/license into the certificate.
 * The logged-in account's name is only a fallback when no MHO signatory is
 * configured. The API re-stamps the signatory at approval/issue time.
 */
const authorizedSignatory = {
  name: String(
    branding?.signatory?.fullName ||
    certificate?.medicalOfficer ||
    user?.name ||
    currentUser ||
    ""
  ).trim(),
  licenseNumber: String(
    certificate?.licenseNumber ||
    branding?.signatory?.licenseNumber ||
    ""
  ).trim(),
};
const signatoryName = authorizedSignatory.name || "Signatory name not set";

const [form, setForm] = useState(() => /** @type {Record<string, any>} */ ({
  purpose: certificate?.purpose || "",
  findings: certificate?.findings || "",
  dateOfExamination: certificate?.dateOfExamination || new Date().toISOString().slice(0, 10),
  medicalOfficer: authorizedSignatory.name,
  licenseNumber: authorizedSignatory.licenseNumber,
  notes: certificate?.notes || "",
}));
const [errors, setErrors] = useState(/** @type {Record<string, any>} */ ({}));
const [actionNotes, setActionNotes] = useState("");
const [busy, setBusy] = useState("");

  const isCreate = mode === "create";
  const isEdit = mode === "edit";
  const isFormMode = isCreate || isEdit;
  const isReview = mode === "review";
  const canDecide = isReview && certificate && ["For Review", "Approved"].includes(certificate.status);

  const set = (key) => (value) => {
    setForm((p) => ({ ...p, [key]: value }));
    if (errors[key]) setErrors((p) => ({ ...p, [key]: "" }));
  };

  const validate = () => {
    const next = {};
    if (!form.purpose) next.purpose = "Purpose is required.";
    if (!form.findings.trim()) next.findings = "Clinical findings are required.";
    if (!form.dateOfExamination) next.dateOfExamination = "Date of examination is required.";
    if (!form.medicalOfficer.trim()) next.medicalOfficer = "Medical officer name is required.";
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSave = async (submit) => {
    if (!validate()) return;
    setBusy("save");
    try {
      // The resident is identified by id only — the API resolves the resident's
      // barangay/municipality scope server-side and never trusts the client.
      const payload = {
        purpose: form.purpose,
        findings: form.findings.trim(),
        dateOfExamination: form.dateOfExamination,
        medicalOfficer: form.medicalOfficer.trim(),
        licenseNumber: form.licenseNumber.trim(),
        notes: form.notes,
      };
      if (isEdit) {
        await medicalCertificatesApi.update(certificate.id, payload);
        onSaved?.("updated");
      } else {
        const { record } = await medicalCertificatesApi.create({ residentId: patient.patientId, ...payload });
        if (submit) await medicalCertificatesApi.submitForReview(record.id);
        onSaved?.(submit ? "For Review" : "Draft");
      }
      onClose();
    } catch (err) {
      setErrors((p) => ({ ...p, submit: err?.message || "The certificate could not be saved." }));
    } finally {
      setBusy("");
    }
  };

  const decide = async (decision) => {
    if (decision === "reject" && !actionNotes.trim()) {
      setErrors((p) => ({ ...p, decision: "A reason is required to reject a certificate." }));
      return;
    }
    setBusy(decision);
    try {
      const actions = {
        approve: medicalCertificatesApi.approve,
        issue: medicalCertificatesApi.issue,
        reject: medicalCertificatesApi.reject,
      };
      await actions[decision]?.(certificate.id, actionNotes.trim());
      onSaved?.(decision === "approve" ? "Approved" : decision === "issue" ? "Issued" : "Rejected");
      onClose();
    } catch (err) {
      setErrors((p) => ({ ...p, decision: err?.message || "The decision could not be saved." }));
    } finally {
      setBusy("");
    }
  };

  const view = certificate;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4">
      <Card className={`max-h-[92vh] w-full overflow-y-auto ${isFormMode ? "max-w-2xl" : "max-w-4xl"}`}>
        <div className="p-6">
          <div className="mb-1 flex items-start justify-between gap-3">
            <div>
              <h3 className="text-lg font-semibold text-brand-ink">
                {isCreate ? "Medical Certificate" : `Medical Certificate · ${view.reference}`}
              </h3>
              <p className="mt-0.5 text-sm text-brand-gray">
                {isCreate
                  ? `${patient.patient} (${patient.patientId}) · ${patient.age} · ${patient.sex} · ${patient.barangay}`
                  : view.status}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {view && <CertificateStatusBadge value={view.status} />}
              <button onClick={onClose} className="text-brand-gray hover:text-brand-ink" aria-label="Close">
                <X className="h-5 w-5" />
              </button>
            </div>
            {brandingError && <p role="alert" className="mt-3 text-sm text-brand-danger">{brandingError}</p>}
          </div>

          {isFormMode ? (
            <div className="mt-4 space-y-4">
              <div>
                <Field label="Purpose of Certificate" required error={errors.purpose}>
                  <select value={form.purpose} onChange={(e) => set("purpose")(e.target.value)} className={`${inputCls(errors.purpose)} cursor-pointer`}>
                    {CERT_PURPOSES.map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                </Field>
              </div>
              <Field label="Clinical Findings / Diagnosis" required error={errors.findings}>
                <textarea
                  rows={3}
                  value={form.findings}
                  onChange={(e) => set("findings")(e.target.value)}
                  placeholder="Clinical findings, vitals, or diagnosis to certify..."
                  className={`${inputCls(errors.findings)} resize-none`}
                />
              </Field>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Date of Examination" required error={errors.dateOfExamination}>
                  <input type="date" value={form.dateOfExamination} onChange={(e) => set("dateOfExamination")(e.target.value)} className={inputCls(errors.dateOfExamination)} />
                </Field>
                <Field label="Medical Officer (Authorized Signatory)" required error={errors.medicalOfficer}>
                  <input
                    type="text"
                    value={form.medicalOfficer}
                    readOnly
                    title="The authorized signatory is resolved from the official configuration and stamped by the API when the certificate is approved/issued."
                    className={`${inputCls(errors.medicalOfficer)} bg-slate-50 dark:bg-slate-500/10`}
                  />
                </Field>
                <Field label="License Number">
                  <input
                    type="text"
                    value={form.licenseNumber}
                    readOnly
                    title="The authorized signatory's license number is resolved from the official configuration and stamped by the API when the certificate is approved/issued."
                    className={`${inputCls()} bg-slate-50 dark:bg-slate-500/10`}
                  />
                </Field>
              </div>
              {isCreate && (
                <p className="rounded-btn border border-brand-blue/15 bg-brand-light/50 dark:bg-card-nested px-3.5 py-2.5 text-xs leading-relaxed text-brand-gray">
                  Certificates prepared at triage or by a PHN are submitted for PHN or MHO review before they become official.
                </p>
              )}
              {errors.submit && <p className="text-xs text-brand-danger">{errors.submit}</p>}
              <div className="flex justify-end gap-3 border-t border-slate-200 pt-4 dark:border-border">
                <button onClick={onClose} className="rounded-btn px-4 py-2 text-sm font-medium text-brand-gray hover:bg-brand-bg dark:hover:bg-hover">Cancel</button>
                {isEdit ? (
                  <button
                    onClick={() => handleSave(false)}
                    disabled={Boolean(busy)}
                    className="inline-flex items-center gap-1.5 rounded-btn bg-brand-blue px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-60"
                  >
                    {busy === "save" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />} Save Changes
                  </button>
                ) : (
                  <>
                    <button
                      onClick={() => handleSave(false)}
                      disabled={Boolean(busy)}
                      className="inline-flex items-center gap-1.5 rounded-btn border border-brand-border bg-white px-4 py-2 text-sm font-medium text-brand-ink hover:bg-brand-bg disabled:opacity-60 dark:bg-card dark:hover:bg-hover"
                    >
                      {busy === "save" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />} Save Draft
                    </button>
                    <button
                      onClick={() => handleSave(true)}
                      disabled={Boolean(busy)}
                      className="inline-flex items-center gap-1.5 rounded-btn bg-brand-blue px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-60"
                    >
                      <Send className="h-4 w-4" /> Submit for Review
                    </button>
                  </>
                )}
              </div>
            </div>
          ) : (
            <div className="mt-4 space-y-5">
              {/* Formal A4 certificate document (official layout) */}
              <div className="max-h-[52vh] overflow-auto rounded-2xl border border-slate-200 bg-slate-100 p-3 dark:border-border dark:bg-background">
                <MedicalCertificateDocument certificate={view} signatoryName={signatoryName} branding={branding} />
              </div>

              {/* Reviewer decisions (PHN / MHO) */}
              {canDecide && (
                <div className="rounded-2xl border border-brand-blue/15 bg-brand-light/50 p-4 dark:bg-card-nested">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-brand-gray">Review Decision</p>
                  <textarea
                    rows={2}
                    value={actionNotes}
                    onChange={(e) => { setActionNotes(e.target.value); if (errors.decision) setErrors((p) => ({ ...p, decision: "" })); }}
                    placeholder="Review notes (required when rejecting)..."
                    className={`${inputCls(errors.decision)} resize-none`}
                  />
                  {errors.decision && <p className="mt-1 text-xs text-brand-danger">{errors.decision}</p>}
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      onClick={() => decide("approve")}
                      disabled={Boolean(busy) || certificate.status !== "For Review"}
                      className="inline-flex items-center gap-1.5 rounded-btn border border-brand-border bg-white px-4 py-2 text-sm font-medium text-brand-ink hover:bg-brand-bg disabled:opacity-50 dark:bg-card dark:hover:bg-hover"
                    >
                      <ClipboardCheck className="h-4 w-4" /> Approve
                    </button>
                    <button
                      onClick={() => decide("issue")}
                      disabled={Boolean(busy) || certificate.status !== "Approved"}
                      className="inline-flex items-center gap-1.5 rounded-btn bg-brand-blue px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-50"
                    >
                      <CheckCircle2 className="h-4 w-4" /> Issue Certificate
                    </button>
                    <button
                      onClick={() => decide("reject")}
                      disabled={Boolean(busy) || certificate.status !== "For Review"}
                      className="inline-flex items-center gap-1.5 rounded-btn border border-brand-danger/30 bg-brand-danger/5 px-4 py-2 text-sm font-medium text-brand-danger hover:bg-brand-danger/10 disabled:opacity-50"
                    >
                      <Ban className="h-4 w-4" /> Reject
                    </button>
                  </div>
                </div>
              )}

              {/* Certificate history (real medical_certificate_logs rows) */}
              <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-border dark:bg-card">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-brand-gray">History</p>
                <div className="space-y-2">
                  {(view.audit || []).map((a, i) => (
                    <div key={i} className="flex items-start justify-between gap-3 text-sm">
                      <div>
                        <p className="font-medium text-brand-ink">{a.action}</p>
                        {a.notes && <p className="text-xs text-brand-gray">{a.notes}</p>}
                      </div>
                      <p className="shrink-0 text-xs text-brand-gray">{a.by}</p>
                    </div>
                  ))}
                  {(view.audit || []).length === 0 && (
                    <p className="text-sm text-brand-gray">No history recorded.</p>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap justify-end gap-3 border-t border-slate-200 pt-4 dark:border-border">
                {/* MHO status management — provided only by the register for the MHO */}
                {onRequestStatusChange && (
                  <button
                    onClick={() => onRequestStatusChange(view)}
                    className="inline-flex items-center gap-1.5 rounded-btn border border-brand-border bg-white px-4 py-2 text-sm font-medium text-brand-ink transition-colors hover:bg-brand-bg dark:bg-card dark:hover:bg-hover"
                  >
                    <RefreshCw className="h-4 w-4" /> Change Status
                  </button>
                )}
                <button onClick={() => printCertificate(view, signatoryName)} className="inline-flex items-center gap-1.5 rounded-btn border border-brand-border bg-white px-4 py-2 text-sm font-medium text-brand-gray hover:bg-brand-bg dark:bg-card dark:hover:bg-hover">
                  <Printer className="h-4 w-4" /> Print
                </button>
                <button onClick={onClose} className="rounded-btn px-4 py-2 text-sm font-medium text-brand-gray hover:bg-brand-bg dark:hover:bg-hover">Close</button>
              </div>
            </div>
          )}
        </div>
      </Card>
      {/* Clean A4 print copy (portalled outside the app UI) */}
      {portal}
    </div>
  );
}
