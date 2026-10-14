import React, { useEffect, useState } from "react";
import { Card } from "@/components/common/Card";
import { useCertificateMeta } from "@/features/certificates/hooks/useCertificateRegister";
import {
  canPrintOfficialMedicalCertificate,
  canReviewMedicalCertificate,
  isMedicalCertificateReviewer,
} from "@/features/certificates/lib/certificatePermissions";
import { medicalCertificatesApi } from "@/services/api";
import MedicalCertificateDocument from "./MedicalCertificateDocument";
import { useCertificatePrint } from "./useCertificatePrint.jsx";
import { useDocumentBranding } from "@/lib/documentBranding";
import { useAuth } from "@/context/AuthContext";
import { X, FileText, Printer, CheckCircle2, ClipboardCheck, Ban, Send, Loader2, Eye } from "lucide-react";

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
 *  - "review" (PHN / MHO): review history + preview + approve/issue/reject.
 *
 * Every write goes to `/api/medical-certificates`; the service resolves the
 * resident's scope, validates the transition and writes the certificate log
 * plus a `health_audit_logs` entry.
 */
/**
 * @param {{mode?: string, patient?: any, certificate?: any, currentUser?: string, currentUserRole?: string, purposes?: any, onClose: () => void, onSaved?: (status: string) => void}} props
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
}) {
const { user } = useAuth();
const meta = useCertificateMeta();
const CERT_PURPOSES = purposesProp?.length ? purposesProp : meta.purposes;
const { printCertificate, portal, brandingError } = useCertificatePrint();
const { branding } = useDocumentBranding("medical_certificate");

/**
 * The stored reviewer identity is authoritative on an issued certificate;
 * branding supplies the intended signatory only for a draft preview.
 */
const authorizedSignatory = {
  name: String(
    certificate?.medicalOfficer ||
    branding?.signatory?.fullName ||
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
const [record, setRecord] = useState(certificate);
const [detailError, setDetailError] = useState("");
const [detailLoading, setDetailLoading] = useState(Boolean(certificate?.id && mode !== "create"));
const [showPreview, setShowPreview] = useState(false);
const [showIssueConfirm, setShowIssueConfirm] = useState(false);
const [savedId, setSavedId] = useState(null);

useEffect(() => {
  let active = true;
  setRecord(certificate);
  setDetailError("");
  if (!certificate?.id || mode === "create") {
    setDetailLoading(false);
    return () => { active = false; };
  }

  setDetailLoading(true);
  medicalCertificatesApi.get(certificate.id)
    .then((payload) => {
      if (active) setRecord(payload?.record || payload);
    })
    .catch((error) => {
      if (active) setDetailError(error?.message || "Certificate details and review history could not be loaded.");
    })
    .finally(() => {
      if (active) setDetailLoading(false);
    });

  return () => { active = false; };
}, [certificate, mode]);

  const isCreate = mode === "create";
  const isEdit = mode === "edit";
  const isFormMode = isCreate || isEdit;
  const isReview = mode === "review";
  const isAuthorizedReviewer = isMedicalCertificateReviewer(user);
  const view = record;
  const previewCertificate = {
    ...(certificate || {}),
    patient: patient?.patient || certificate?.patient || "",
    patientId: patient?.patientId || certificate?.patientId || "",
    age: patient?.age || certificate?.age || "",
    sex: patient?.sex || certificate?.sex || "",
    barangay: patient?.barangay || certificate?.barangay || "",
    address: patient?.address || certificate?.address || "",
    purpose: form.purpose,
    findings: form.findings,
    dateOfExamination: form.dateOfExamination,
    medicalOfficer: authorizedSignatory.name,
    licenseNumber: authorizedSignatory.licenseNumber,
    signatoryPosition: branding?.signatory?.position || "",
    status: certificate?.status || "Draft",
  };
  const canDecide = isReview && canReviewMedicalCertificate(user, view) && !detailError && !detailLoading;

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
        let id = savedId;
        if (id) {
          await medicalCertificatesApi.update(id, payload);
        } else {
          const { record: created } = await medicalCertificatesApi.create({ residentId: patient.patientId, ...payload });
          id = created.id;
          setSavedId(id);
        }
        if (submit) await medicalCertificatesApi.submitForReview(id);
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
        approveAndIssue: (id, notes) => medicalCertificatesApi.changeStatus(id, "Issued", notes),
        issue: medicalCertificatesApi.issue,
        reject: medicalCertificatesApi.reject,
      };
      await actions[decision]?.(view.id, actionNotes.trim());
      onSaved?.(decision === "reject" ? "Rejected" : "Issued");
      onClose();
    } catch (err) {
      setErrors((p) => ({ ...p, decision: err?.message || "The decision could not be saved." }));
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4">
      <Card className={`flex max-h-[92dvh] w-full flex-col overflow-hidden ${isFormMode ? "max-w-2xl" : "max-w-4xl"}`}>
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="shrink-0 border-b border-slate-200 px-4 py-4 dark:border-border sm:px-6">
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
          </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-5 sm:px-6 sm:pb-6">
          {brandingError && <p role="alert" className="mt-3 text-sm text-brand-danger">{brandingError}</p>}
          {detailError && <p role="alert" className="mt-3 rounded-btn bg-brand-danger/5 px-3 py-2 text-sm text-brand-danger">{detailError}</p>}
          {detailError && <p className="mt-1 text-xs text-brand-gray">Review actions are unavailable until the full certificate record loads.</p>}
          {detailLoading && <p role="status" className="mt-3 text-sm text-brand-gray">Loading certificate details and review history...</p>}

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
                <button
                  type="button"
                  onClick={() => setShowPreview(true)}
                  className="inline-flex items-center gap-1.5 rounded-btn border border-brand-border bg-white px-4 py-2 text-sm font-medium text-brand-blue hover:bg-brand-bg dark:bg-card dark:hover:bg-hover"
                >
                  <Eye className="h-4 w-4" /> Preview Certificate
                </button>
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
              <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-border dark:bg-card">
                <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-brand-gray">Certificate Review</p>
                <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
                  {[
                    ["Patient name", view.patient],
                    ["Resident ID", view.patientId],
                    ["Certificate number", view.certificateNumber || view.reference],
                    ["Date examined", view.dateOfExamination],
                    ["Civil status", view.civilStatus],
                    ["Diagnosis / medical impression", view.findings],
                    ["Recommendation", view.recommendation],
                    ["Remarks", view.remarks],
                    ["Certificate creator", view.preparedBy],
                    ["Submission date", view.submittedAt ? new Date(view.submittedAt).toLocaleString() : ""],
                    ["Current status", view.status],
                  ].map(([label, value]) => (
                    <div key={label}>
                      <dt className="text-xs text-brand-gray">{label}</dt>
                      <dd className="mt-0.5 whitespace-pre-wrap font-medium text-brand-ink">{value || "—"}</dd>
                    </div>
                  ))}
                  {view.reviewer && (
                    <div>
                      <dt className="text-xs text-brand-gray">Reviewer</dt>
                      <dd className="mt-0.5 font-medium text-brand-ink">
                        {view.reviewer}{view.reviewerRole ? ` (${view.reviewerRole})` : ""}
                        {view.reviewedAt ? ` · ${new Date(view.reviewedAt).toLocaleString()}` : ""}
                      </dd>
                    </div>
                  )}
                  {view.status === "Issued" && view.issuedAt && (
                    <div>
                      <dt className="text-xs text-brand-gray">Issued</dt>
                      <dd className="mt-0.5 font-medium text-brand-ink">{new Date(view.issuedAt).toLocaleString()}</dd>
                    </div>
                  )}
                  {view.status === "Issued" && view.issuedBy && (
                    <div>
                      <dt className="text-xs text-brand-gray">Issued by</dt>
                      <dd className="mt-0.5 font-medium text-brand-ink">{view.issuedBy}</dd>
                    </div>
                  )}
                </dl>
              </div>

              {canPrintOfficialMedicalCertificate(user, view) && (
                <p className="rounded-btn bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800">
                  Issued by {view.issuedBy || view.reviewer || "an authorized reviewer"}
                  {view.issuedAt ? ` on ${new Date(view.issuedAt).toLocaleString()}` : ""}.
                </p>
              )}

              <button
                type="button"
                onClick={() => setShowPreview(true)}
                className="inline-flex items-center gap-1.5 rounded-btn border border-brand-border bg-white px-4 py-2 text-sm font-medium text-brand-blue hover:bg-brand-bg dark:bg-card dark:hover:bg-hover"
              >
                <Eye className="h-4 w-4" /> Preview Certificate
              </button>

              {canDecide && (
                <div className="rounded-2xl border border-brand-blue/15 bg-brand-light/50 p-4 dark:bg-card-nested">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-brand-gray">Review Decision</p>
                  <textarea
                    rows={2}
                    value={actionNotes}
                    onChange={(e) => { setActionNotes(e.target.value); if (errors.decision) setErrors((p) => ({ ...p, decision: "" })); }}
                    placeholder="Optional review notes; required when rejecting..."
                    className={`${inputCls(errors.decision)} resize-none`}
                  />
                  {errors.decision && <p className="mt-1 text-xs text-brand-danger">{errors.decision}</p>}
                  <div className="mt-3 flex flex-wrap gap-2">
                    {view.status === "For Review" && (
                      <button
                        onClick={() => setShowIssueConfirm(true)}
                        disabled={Boolean(busy) || Boolean(detailError)}
                        className="inline-flex items-center gap-1.5 rounded-btn bg-brand-blue px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-50"
                      >
                        <ClipboardCheck className="h-4 w-4" /> Approve and Issue
                      </button>
                    )}
                    {view.status === "Approved" && (
                      <button
                        onClick={() => setShowIssueConfirm(true)}
                        disabled={Boolean(busy) || Boolean(detailError)}
                        className="inline-flex items-center gap-1.5 rounded-btn bg-brand-blue px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-50"
                      >
                        <CheckCircle2 className="h-4 w-4" /> Issue Certificate
                      </button>
                    )}
                    <button
                      onClick={() => decide("reject")}
                      disabled={Boolean(busy) || view.status !== "For Review" || Boolean(detailError)}
                      className="inline-flex items-center gap-1.5 rounded-btn border border-brand-danger/30 bg-brand-danger/5 px-4 py-2 text-sm font-medium text-brand-danger hover:bg-brand-danger/10 disabled:opacity-50"
                    >
                      <Ban className="h-4 w-4" /> Reject
                    </button>
                  </div>
                </div>
              )}

              {/* Certificate history (real medical_certificate_logs rows) */}
              <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-border dark:bg-card">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-brand-gray">Review History</p>
                <div className="space-y-2">
                  {(view.audit || []).map((a, i) => (
                    <div key={i} className="flex items-start justify-between gap-3 text-sm">
                      <div>
                        <p className="font-medium text-brand-ink">{a.action}</p>
                        {a.notes && <p className="text-xs text-brand-gray">{a.notes}</p>}
                      </div>
                      <p className="shrink-0 text-right text-xs text-brand-gray">
                        {a.by}{a.byRole ? ` (${a.byRole})` : ""}
                        {a.at ? <span className="block">{new Date(a.at).toLocaleString()}</span> : null}
                      </p>
                    </div>
                  ))}
                  {(view.audit || []).length === 0 && (
                    <p className="text-sm text-brand-gray">No history recorded.</p>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap justify-end gap-3 border-t border-slate-200 pt-4 dark:border-border">
                {isAuthorizedReviewer && view.status === "Issued" && (
                  <button onClick={() => printCertificate(view, signatoryName)} className="inline-flex items-center gap-1.5 rounded-btn border border-brand-border bg-white px-4 py-2 text-sm font-medium text-brand-gray hover:bg-brand-bg dark:bg-card dark:hover:bg-hover">
                    <Printer className="h-4 w-4" /> Print Official Certificate
                  </button>
                )}
                <button onClick={onClose} className="rounded-btn px-4 py-2 text-sm font-medium text-brand-gray hover:bg-brand-bg dark:hover:bg-hover">Back to Register</button>
              </div>
              {showIssueConfirm && (
                <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 p-4">
                  <Card className="w-full max-w-md">
                    <div className="p-6">
                      <h3 className="text-lg font-semibold text-brand-ink">
                        {view.status === "For Review" ? "Approve and issue this certificate?" : "Issue this certificate?"}
                      </h3>
                      <p className="mt-2 text-sm text-brand-gray">
                        This action makes {view.reference} official and final. It cannot be repeated or edited afterward.
                      </p>
                      <div className="mt-5 flex justify-end gap-3">
                        <button
                          type="button"
                          onClick={() => setShowIssueConfirm(false)}
                          className="rounded-btn px-4 py-2 text-sm font-medium text-brand-gray hover:bg-brand-bg"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setShowIssueConfirm(false);
                            decide(view.status === "For Review" ? "approveAndIssue" : "issue");
                          }}
                          disabled={Boolean(busy)}
                          className="rounded-btn bg-brand-blue px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-60"
                        >
                          Confirm and Issue
                        </button>
                      </div>
                    </div>
                  </Card>
                </div>
              )}
            </div>
          )}
          </div>
        </div>
      </Card>
      {showPreview && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-2 sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="certificate-preview-title"
        >
          <div className="flex max-h-[96dvh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-card">
            <div className="flex shrink-0 items-center justify-between gap-4 border-b border-slate-200 px-4 py-3 dark:border-border sm:px-6">
              <div>
                <h3 id="certificate-preview-title" className="text-base font-semibold text-brand-ink">
                  Certificate Preview
                </h3>
                <p className="text-xs text-brand-gray">
                  {(isFormMode ? previewCertificate.status : view.status) === "Issued"
                    ? "Official issued certificate."
                    : "Preview only. Previewing does not issue this certificate."}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowPreview(false)}
                className="rounded-btn p-2 text-brand-gray hover:bg-brand-bg hover:text-brand-ink dark:hover:bg-hover"
                aria-label="Close certificate preview"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-auto bg-slate-100 p-3 dark:bg-background sm:p-5">
              <div className="flex min-h-full w-max min-w-full justify-center">
                <MedicalCertificateDocument
                  certificate={isFormMode ? previewCertificate : view}
                  signatoryName={signatoryName}
                  branding={branding}
                />
              </div>
            </div>
          </div>
        </div>
      )}
      {/* Clean A4 print copy (portalled outside the app UI) */}
      {portal}
    </div>
  );
}
