import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  AlertCircle, ArrowLeft, ArrowRight, Clock, Eye, EyeOff, FileText, HeartPulse,
  ImageIcon, Loader2, MapPin, ShieldCheck, X,
} from "lucide-react";
import {
  RegistrationShell, RegistrationCard, StepIndicator, PageHeading, InfoNote,
  SelectField, Field, inputCls, btnPrimary, btnGhost, btnSecondary,
} from "@/features/registration/components/RegistrationDesign";
import UploadComponent from "@/features/registration/components/UploadComponent";
import { supabase } from "@/lib/supabase";
import { api } from "@/services/api";
import { postFormData } from "@/services/api/apiClient";

const STEPS = [
  { num: 1, label: "Account" },
  { num: 2, label: "Documents" },
  { num: 3, label: "Submit" },
];

// Document slots. A transfer is supporting documentation for changing the
// resident's barangay — never a new resident record.
const SUPPORTING_TYPE = "transfer_proof_of_address";
const HEALTH_RECORD_TYPE = "transfer_previous_health_record";

const STATUS_LABELS = {
  draft: "Draft",
  pending: "Pending Review",
  under_review: "Under Review",
  approved: "Approved",
  rejected: "Rejected",
  cancelled: "Cancelled",
};

const STATUS_TONE = {
  pending: "text-brand-amber",
  under_review: "text-brand-amber",
  approved: "text-emerald-700",
  rejected: "text-brand-danger",
  cancelled: "text-slate-400",
};

const formatDate = (value) => {
  if (!value) return "";
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
};

const formatBytes = (bytes) => {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return "";
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(n / 1024))} KB`;
};

export default function TransferRegistration() {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [authed, setAuthed] = useState(false);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const [context, setContext] = useState(null);
  const [toBarangayId, setToBarangayId] = useState("");
  const [reason, setReason] = useState("");

  const [requestId, setRequestId] = useState("");
  const [documents, setDocuments] = useState({}); // supporting doc: { [SUPPORTING_TYPE]: { file, document } }
  const [healthRecords, setHealthRecords] = useState([]); // [{ file, document }] — supplementary, multiple

  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const message = (err) => err?.message || "We could not complete this step. Please try again.";
  const activeRequest = context?.activeRequest || null;
  const resident = context?.resident || null;
  const destinations = context?.destinations || [];
  const history = context?.history || [];

  const signIn = async () => {
    if (!email.trim() || !password) return setError("Enter your email address and password.");
    setBusy(true); setError("");
    try {
      if (!supabase) throw new Error("Authentication is unavailable. Please try again later.");
      const { error: authError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (authError) throw authError;
      // Authentication IDENTIFIES the existing resident; it never blocks them.
      const ctx = await api.get("/transfer-requests/context");
      setContext(ctx);
      setAuthed(true);
    } catch (err) { setError(message(err)); }
    finally { setBusy(false); }
  };

  const startTransfer = async () => {
    if (!toBarangayId) return setError("Select the barangay you are transferring to.");
    if (resident?.barangayId && toBarangayId === resident.barangayId) {
      return setError("Please select a different barangay from your current residency.");
    }
    setBusy(true); setError("");
    try {
      const res = await api.post("/transfer-requests", { toBarangayId, reason });
      setRequestId(res.requestId);
      setStep(2);
    } catch (err) { setError(message(err)); }
    finally { setBusy(false); }
  };

  const upload = async (type, file) => {
    if (!file) return;
    setBusy(true); setError("");
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("documentType", type);
      const response = await postFormData(`/transfer-requests/${requestId}/documents`, form);
      setDocuments((current) => ({ ...current, [type]: { file, document: response.document } }));
    } catch (err) { setError(message(err)); }
    finally { setBusy(false); }
  };

  const removeUpload = async (type) => {
    const doc = documents[type]?.document;
    setDocuments((current) => { const next = { ...current }; delete next[type]; return next; });
    if (doc?.id && requestId) {
      try { await api.delete(`/transfer-requests/${requestId}/documents/${doc.id}`); }
      catch { /* best-effort; the record is replaced on re-upload */ }
    }
  };

  // Existing health records are supplementary and may be uploaded in any number.
  // The same file (name + size) is never uploaded twice.
  const uploadHealthRecord = async (file) => {
    if (!file) return;
    if (healthRecords.some((r) => r.file?.name === file.name && r.file?.size === file.size)) return;
    setBusy(true); setError("");
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("documentType", HEALTH_RECORD_TYPE);
      const response = await postFormData(`/transfer-requests/${requestId}/documents`, form);
      setHealthRecords((current) => {
        if (current.some((r) => r.document?.id === response.document?.id)) return current;
        return [...current, { file, document: response.document }];
      });
    } catch (err) { setError(message(err)); }
    finally { setBusy(false); }
  };

  const removeHealthRecord = async (documentId) => {
    setHealthRecords((current) => current.filter((r) => r.document?.id !== documentId));
    if (documentId && requestId) {
      try { await api.delete(`/transfer-requests/${requestId}/documents/${documentId}`); }
      catch { /* best-effort */ }
    }
  };

  const submit = async () => {
    setBusy(true); setError("");
    try {
      await api.post(`/transfer-requests/${requestId}/submit`, {});
      setStep(4);
    } catch (err) { setError(message(err)); }
    finally { setBusy(false); }
  };

  const cancelPending = async () => {
    if (!activeRequest?.id) return;
    setBusy(true); setError("");
    try {
      await api.post(`/transfer-requests/${activeRequest.id}/cancel`, {});
      const ctx = await api.get("/transfer-requests/context");
      setContext(ctx);
    } catch (err) { setError(message(err)); }
    finally { setBusy(false); }
  };

  const hasSupporting = Boolean(documents[SUPPORTING_TYPE]);
  const currentStage = step >= 4 ? 3 : step;

  const HistoryList = () => (
    history.length > 0 && (
      <div className="rounded-xl border border-slate-200">
        <p className="border-b border-slate-200 bg-slate-50/70 px-4 py-2.5 text-[10.5px] font-bold uppercase tracking-[0.12em] text-slate-500">
          Transfer History
        </p>
        <ul className="divide-y divide-slate-100">
          {history.map((item) => (
            <li key={item.id} className="flex items-center justify-between gap-3 px-4 py-3 text-[13px]">
              <span className="min-w-0 text-brand-ink">
                {item.fromBarangay || "—"} <ArrowRight className="mx-1 inline h-3 w-3 text-slate-400" /> {item.toBarangay || "—"}
                <span className="ml-2 block text-[11px] text-slate-400">{formatDate(item.submittedAt || item.createdAt)}</span>
              </span>
              <span className={`shrink-0 text-[11px] font-bold uppercase tracking-wide ${STATUS_TONE[item.status] || "text-slate-500"}`}>
                {STATUS_LABELS[item.status] || item.status}
              </span>
            </li>
          ))}
        </ul>
      </div>
    )
  );

  return (
    <RegistrationShell>
      <RegistrationCard>
        <div className="px-5 py-6 sm:px-10 sm:py-8">
          <StepIndicator current={currentStage} steps={STEPS} flowLabel="Transfer of Residency" showStepCount={false} />
          <div className="mt-6 space-y-5">
            {error && <InfoNote tone="danger" icon={AlertCircle}>{error}</InfoNote>}

            {/* STEP 1 — Account + current/new residency ------------------- */}
            {step === 1 && !authed && (
              <>
                <PageHeading
                  title="Sign in to your KALUSAGAP account"
                  subtitle="Sign in with the account linked to your existing resident record. A transfer changes only your current barangay — your resident record and health history stay with you."
                />
                <div className="space-y-4">
                  <Field label="Email Address">
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className={inputCls(false)}
                      autoComplete="email"
                    />
                  </Field>
                  <Field label="Password">
                    <div className="relative">
                      <input
                        type={showPassword ? "text" : "password"}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") signIn(); }}
                        className={`${inputCls(false)} pr-12`}
                        autoComplete="current-password"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((v) => !v)}
                        aria-label={showPassword ? "Hide password" : "Show password"}
                        className="absolute right-3 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-brand-ink focus-visible:ring-2 focus-visible:ring-brand-blue/30"
                      >
                        {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </Field>
                </div>
                <Link to="/login" className="inline-block text-xs font-semibold text-brand-blue underline">Forgot Password?</Link>
                <InfoNote icon={ShieldCheck}>
                  Your account must be authenticated before a transfer can begin. Authentication only identifies your existing resident record — resident records are never searchable from this flow.
                </InfoNote>
              </>
            )}

            {/* STEP 1 (authenticated) — pending request in progress -------- */}
            {step === 1 && authed && activeRequest && (
              <>
                <PageHeading
                  title="Transfer request in progress"
                  subtitle="You already have a pending transfer request. Please wait for the current request to be reviewed before submitting another transfer."
                />
                <div className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                  <p className="px-4 py-3 text-sm text-brand-ink"><strong>Current Barangay:</strong> {activeRequest.fromBarangay || resident?.barangay || "—"}</p>
                  <p className="px-4 py-3 text-sm text-brand-ink"><strong>Requested Barangay:</strong> {activeRequest.toBarangay || "—"}</p>
                  <p className="px-4 py-3 text-sm text-brand-ink"><strong>Status:</strong> {STATUS_LABELS[activeRequest.status] || activeRequest.status}</p>
                  <p className="px-4 py-3 text-sm text-brand-ink"><strong>Submitted:</strong> {formatDate(activeRequest.submittedAt) || "—"}</p>
                </div>
                <InfoNote icon={Clock}>
                  The new transfer submission is disabled while this request is pending. Once it is approved or rejected, you can start another transfer.
                </InfoNote>
                <HistoryList />
              </>
            )}

            {/* STEP 1 (authenticated) — choose destination ----------------- */}
            {step === 1 && authed && !activeRequest && (
              <>
                <PageHeading
                  title="Confirm your transfer of residency"
                  subtitle="Your existing resident record and health history remain associated with your account. Only your current barangay changes once a transfer is approved."
                />
                <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4">
                  <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.12em] text-brand-blue">
                    <MapPin className="h-3.5 w-3.5" /> Current Residency
                  </p>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <div>
                      <p className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-slate-400">Barangay</p>
                      <p className="text-[14px] font-semibold text-brand-ink">{resident?.barangay || "—"}</p>
                    </div>
                    <div>
                      <p className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-slate-400">Resident</p>
                      <p className="text-[14px] font-semibold text-brand-ink">{resident?.name || "—"}</p>
                    </div>
                  </div>
                </div>

                <div className="space-y-6">
                  <SelectField
                    label="New Residency — Destination Barangay"
                    required
                    value={toBarangayId}
                    onChange={(e) => setToBarangayId(e.target.value)}
                    disabled={destinations.length === 0}
                    hint={destinations.length === 0 ? undefined : "Choose the barangay you are transferring to. Your current barangay is not listed."}
                  >
                    <option value="">Select destination barangay</option>
                    {destinations.map((b) => (
                      <option key={b.id} value={b.id}>{b.name}</option>
                    ))}
                  </SelectField>

                  {destinations.length === 0 && (
                    <InfoNote tone="danger" icon={AlertCircle}>
                      No other barangays are available for transfer right now. Please try again later or contact KALUSAGAP support.
                    </InfoNote>
                  )}

                  <Field label="Reason for transfer" optional>
                    <textarea
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      rows={3}
                      maxLength={500}
                      className={`${inputCls(false)} resize-none`}
                      placeholder="e.g. Moved to a new address in the destination barangay."
                    />
                  </Field>
                </div>

                <HistoryList />
              </>
            )}

            {/* STEP 2 — Documents ----------------------------------------- */}
            {step === 2 && (
              <>
                <PageHeading
                  title="Health records & documents"
                  subtitle="Upload the documents that support your transfer. Uploading a health record does not replace or duplicate your existing KALUSAGAP record — it is supplementary documentation only."
                />
                <div className="space-y-6">
                  <div className="space-y-4">
                    <UploadComponent
                      label="Supporting Document"
                      hint="Proof of your new address, or a barangay document — PDF, JPG, PNG up to 10 MB"
                      file={documents[SUPPORTING_TYPE]?.file || null}
                      onFile={(file) => upload(SUPPORTING_TYPE, file)}
                      onRemove={() => removeUpload(SUPPORTING_TYPE)}
                    />
                  </div>

                  {/* Existing health records — supplementary, optional, multiple */}
                  <div className="rounded-xl border border-slate-200 p-4 sm:p-5">
                    <div className="flex items-center justify-between gap-3">
                      <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.12em] text-brand-blue">
                        <HeartPulse className="h-3.5 w-3.5" /> Existing Health Records
                      </p>
                      <span className="shrink-0 text-[11px] font-normal normal-case tracking-normal text-slate-400">Optional</span>
                    </div>
                    <p className="mt-2 text-[12.5px] leading-relaxed text-slate-500">
                      Upload existing health records or medical documents that may help the receiving
                      health team verify and continue your care. Examples: medical record, laboratory
                      result, prescription, immunization record, or a previous consultation record.
                    </p>

                    {healthRecords.length > 0 && (
                      <ul className="mt-4 space-y-2">
                        {healthRecords.map((record) => {
                          const isImage = record.file?.type?.startsWith("image/");
                          const size = formatBytes(record.file?.size ?? record.document?.sizeBytes);
                          return (
                            <li
                              key={record.document?.id}
                              className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white p-3"
                            >
                              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-slate-50">
                                {isImage ? (
                                  <ImageIcon className="h-5 w-5 text-slate-400" />
                                ) : (
                                  <FileText className="h-5 w-5 text-brand-blue" />
                                )}
                              </div>
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-[13px] font-medium text-brand-ink">
                                  {record.file?.name || record.document?.fileName}
                                </p>
                                {size && <p className="text-[12px] text-slate-400">{size}</p>}
                              </div>
                              <button
                                type="button"
                                onClick={() => removeHealthRecord(record.document?.id)}
                                className="flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-[12px] font-semibold text-slate-400 transition-colors hover:bg-brand-danger/10 hover:text-brand-danger"
                              >
                                <X className="h-3.5 w-3.5" /> Remove
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    )}

                    <div className="mt-4">
                      <UploadComponent
                        label={healthRecords.length > 0 ? "Add Another Health Record" : "Upload Health Record"}
                        optional
                        file={null}
                        onFile={uploadHealthRecord}
                        onRemove={() => {}}
                        hint="PDF, JPG, PNG up to 10 MB. You can add more than one document."
                      />
                    </div>
                  </div>
                </div>
                <InfoNote icon={ShieldCheck}>
                  Documents are stored in KALUSAGAP&apos;s private document bucket and are visible only to you and authorized reviewers.
                </InfoNote>
              </>
            )}

            {/* STEP 3 — Review + submit ----------------------------------- */}
            {step === 3 && (
              <>
                <PageHeading title="Review and submit" subtitle="Confirm your transfer details before submitting for review." />
                <div className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                  <p className="px-4 py-3 text-sm text-brand-ink"><strong>Current Barangay:</strong> {resident?.barangay || "—"}</p>
                  <p className="px-4 py-3 text-sm text-brand-ink"><strong>New Barangay:</strong> {destinations.find((b) => b.id === toBarangayId)?.name || "—"}</p>
                  <p className="px-4 py-3 text-sm text-brand-ink"><strong>Supporting Documents:</strong> {documents[SUPPORTING_TYPE] ? "1 file" : "None"}</p>
                  <p className="px-4 py-3 text-sm text-brand-ink"><strong>Existing Health Records:</strong> {healthRecords.length > 0 ? `${healthRecords.length} file${healthRecords.length > 1 ? "s" : ""}` : "Not provided"}</p>
                </div>
                <InfoNote icon={ShieldCheck}>
                  Your existing KALUSAGAP health record will remain associated with your account. If the transfer is approved, your current barangay will be updated to the selected barangay.
                </InfoNote>
              </>
            )}

            {/* STEP 4 — Submitted ----------------------------------------- */}
            {step === 4 && (
              <>
                <PageHeading
                  title="Transfer request submitted"
                  subtitle="Your request has been submitted successfully and will be reviewed by authorized personnel."
                />
                <InfoNote icon={Clock}>
                  <strong className="block text-brand-dark">PENDING REVIEW</strong>
                  <span className="mt-1 block">You will be notified when your transfer request has been reviewed. Your existing health record remains associated with your account.</span>
                </InfoNote>
              </>
            )}
          </div>

          {/* Footer actions ------------------------------------------------- */}
          <div className="mt-8 flex items-center justify-between gap-3 border-t border-slate-100 pt-5">
            {step > 1 && step < 4 ? (
              <button type="button" onClick={() => setStep(step - 1)} className={btnGhost}>
                <ArrowLeft className="h-4 w-4" /> Back
              </button>
            ) : (
              <Link to="/register" className={btnGhost}><ArrowLeft className="h-4 w-4" /> Back</Link>
            )}

            {step === 1 && !authed && (
              <button type="button" onClick={signIn} disabled={busy} className={btnPrimary}>
                {busy && <Loader2 className="h-4 w-4 animate-spin" />}Continue <ArrowRight className="h-4 w-4" />
              </button>
            )}
            {step === 1 && authed && activeRequest && (
              <div className="flex items-center gap-2">
                <button type="button" onClick={cancelPending} disabled={busy} className={btnSecondary}>
                  {busy && <Loader2 className="h-4 w-4 animate-spin" />}Cancel Request
                </button>
                <button type="button" onClick={() => navigate("/app/resident")} className={btnPrimary}>
                  Go to Dashboard <ArrowRight className="h-4 w-4" />
                </button>
              </div>
            )}
            {step === 1 && authed && !activeRequest && (
              <button type="button" onClick={startTransfer} disabled={busy || !toBarangayId} className={btnPrimary}>
                {busy && <Loader2 className="h-4 w-4 animate-spin" />}Continue <ArrowRight className="h-4 w-4" />
              </button>
            )}
            {step === 2 && (
              <button type="button" onClick={() => hasSupporting && setStep(3)} disabled={!hasSupporting || busy} className={btnPrimary}>
                Continue <ArrowRight className="h-4 w-4" />
              </button>
            )}
            {step === 3 && (
              <button type="button" onClick={submit} disabled={busy} className={btnPrimary}>
                {busy && <Loader2 className="h-4 w-4 animate-spin" />}Submit Transfer Request <ArrowRight className="h-4 w-4" />
              </button>
            )}
            {step === 4 && (
              <button type="button" onClick={() => navigate("/app/resident")} className={btnPrimary}>
                Go to Dashboard <ArrowRight className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      </RegistrationCard>
    </RegistrationShell>
  );
}
