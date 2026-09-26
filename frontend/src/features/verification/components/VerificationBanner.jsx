import React, { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { AlertTriangle, BadgeCheck, Clock, Loader2, RefreshCw, RotateCcw, ShieldAlert, UploadCloud, X } from "lucide-react";

import { Card } from "@/components/common/Card";
import { fetchMyVerification, resubmitOwnVerification } from "@/services/api/verificationsApi";
import { registrationApi } from "@/services/api";
import { postFormData } from "@/services/api/apiClient";
import UploadComponent from "@/features/registration/components/UploadComponent";
import { useAuth } from "@/context/AuthContext";

/**
 * Dashboard banner for the resident's manual verification state.
 *
 * Reads the real status from the backend (`GET /verifications/me`). There is no
 * fake refresh timer: "Refresh" re-fetches, and the status is only ever changed
 * by a Health Supervisor decision on the server.
 *
 * When the supervisor requests a resubmission (or rejects), the resident can
 * re-upload their government ID (front + back) through the SAME private
 * document endpoint used at registration; the new files replace the previous
 * ones and the record returns to `pending` for another review.
 */

const META = {
  pending: {
    label: "Pending Verification",
    tone: "border-amber-200 bg-amber-50",
    iconWrap: "border-amber-200 bg-white text-amber-700",
    chip: "text-amber-700 bg-amber-100",
    message: "Your registration is pending Health Supervisor review.",
    Icon: Clock,
  },
  approved: {
    label: "Approved by Health Supervisor",
    tone: "border-emerald-200 bg-emerald-50",
    iconWrap: "border-emerald-200 bg-white text-emerald-700",
    chip: "text-emerald-700 bg-emerald-100",
    message: "Your registration has been approved. You now have full access to resident features.",
    Icon: BadgeCheck,
  },
  rejected: {
    label: "Registration Rejected",
    tone: "border-rose-200 bg-rose-50",
    iconWrap: "border-rose-200 bg-white text-rose-700",
    chip: "text-rose-700 bg-rose-100",
    message: "Your registration was rejected. Please review the reason and resubmit clearer documents.",
    Icon: ShieldAlert,
  },
  resubmission_required: {
    label: "Resubmission Required",
    tone: "border-amber-200 bg-amber-50",
    iconWrap: "border-amber-200 bg-white text-amber-700",
    chip: "text-amber-700 bg-amber-100",
    message: "Your registration needs updated documents before it can be approved. Please upload clearer photos of your government ID.",
    Icon: AlertTriangle,
  },
};

// Mirrors backend/src/validators/documents.validators.js GOVERNMENT_ID_TYPES.
const GOV_ID_OPTIONS = [
  { value: "philsys", label: "PhilSys (National ID)" },
  { value: "drivers_license", label: "Driver's License" },
  { value: "passport", label: "Passport" },
  { value: "umid", label: "UMID" },
  { value: "prc_id", label: "PRC ID" },
  { value: "postal_id", label: "Postal ID" },
  { value: "other", label: "Other" },
];

const formatDate = (iso) => {
  if (!iso) return "";
  const d = new Date(String(iso).length === 10 ? `${iso}T00:00:00` : iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
};

export default function VerificationBanner() {
  const [state, setState] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [resubmitting, setResubmitting] = useState(false);
  const { refreshProfile } = useAuth();
  const syncedApproval = useRef(false);

  // Resubmission document upload modal.
  const [showResubmit, setShowResubmit] = useState(false);
  const [govIdType, setGovIdType] = useState("");
  const [govIdOther, setGovIdOther] = useState("");
  const [idFront, setIdFront] = useState(null);
  const [idBack, setIdBack] = useState(null);
  const [idSelfie, setIdSelfie] = useState(null);
  const [formErrors, setFormErrors] = useState({});

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      let next = await fetchMyVerification();

      // If the resident confirmed their email after registration, the resident
      // record may not exist yet. Finish creating it from the payload the
      // registration page kept, then re-read the real status. One-time,
      // authenticated server call — the client never sets a status.
      if (!next.hasResidentRecord) {
        let pending = null;
        try {
          const raw = sessionStorage.getItem("pendingResidentRegistration");
          pending = raw ? JSON.parse(raw) : null;
        } catch {
          pending = null;
        }
        if (pending?.resident) {
          try {
            await registrationApi.registerResident(pending);
            sessionStorage.removeItem("pendingResidentRegistration");
            sessionStorage.removeItem("registrationNeedsConfirmation");
            next = await fetchMyVerification();
          } catch {
            /* fall through to the no-record state below */
          }
        }
      }

      setState(next);

      // Single authoritative verification state: the moment this banner can see
      // the approval (residents.verification_status = 'approved'), re-resolve the
      // account profile so the session role flips from 'resident-limited' to
      // 'resident' (profiles.status = 'active'). That unlocks the sidebar/routes
      // and redirects out of the limited area — no re-login, timer or hardcoded
      // flag. Guarded so it runs once per approval.
      if (next?.verification?.status === "approved" && !syncedApproval.current) {
        syncedApproval.current = true;
        refreshProfile?.();
      }
    } catch {
      setError("We could not load your verification status. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [refreshProfile]);

  useEffect(() => {
    load();
  }, [load]);

  const openResubmit = () => {
    setGovIdType("");
    setGovIdOther("");
    setIdFront(null);
    setIdBack(null);
    setIdSelfie(null);
    setFormErrors({});
    setError("");
    setShowResubmit(true);
  };

  const uploadOne = async (residentId, file, documentType) => {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("residentId", residentId);
    fd.append("documentType", documentType);
    fd.append("governmentIdType", govIdType);
    if (govIdType === "other" && govIdOther.trim()) {
      fd.append("governmentIdTypeOther", govIdOther.trim());
    }
    const resp = await postFormData("/resident-documents/upload", fd);
    if (!resp?.document) {
      throw new Error("We could not upload your document. Please try again.");
    }
  };

  const handleResubmit = async () => {
    const verification = state?.verification;
    if (!verification?.id) return;

    // Reuse the registration validation rules: ID type + BOTH sides + a photo
    // holding the ID are all required.
    const errs = {};
    if (!govIdType) errs.govIdType = "Select your government-issued ID.";
    if (govIdType === "other" && !govIdOther.trim()) errs.govIdOther = "Please specify the ID type.";
    if (!idFront) errs.idFront = "Upload the front of your government ID.";
    if (!idBack) errs.idBack = "Upload the back of your government ID.";
    if (!idSelfie) errs.idSelfie = "Upload a photo of yourself holding your ID.";
    setFormErrors(errs);
    if (Object.keys(errs).length > 0) return;

    setResubmitting(true);
    setError("");
    try {
      // Replace the previous private files (server supersedes the old pending
      // documents for each slot), then return the record to pending review.
      await uploadOne(verification.id, idFront, "government_id_front");
      await uploadOne(verification.id, idBack, "government_id_back");
      await uploadOne(verification.id, idSelfie, "identity_photo");
      await resubmitOwnVerification(verification.id);
      setShowResubmit(false);
      await load();
    } catch (err) {
      setError(err?.message || "We could not submit your documents. Please try again.");
    } finally {
      setResubmitting(false);
    }
  };

  if (loading) {
    return (
      <Card className="flex items-center gap-4 p-6" role="status" aria-label="Loading verification status">
        <div className="h-12 w-12 shrink-0 animate-pulse rounded-xl bg-slate-100" />
        <div className="flex-1 space-y-2">
          <div className="h-4 w-40 animate-pulse rounded bg-slate-100" />
          <div className="h-3 w-2/3 animate-pulse rounded bg-slate-100" />
        </div>
      </Card>
    );
  }

  const status = state?.verification?.status || "pending";
  const meta = META[status] || META.pending;
  const { Icon } = meta;
  const verification = state?.verification;
  const canResubmit = status === "rejected" || status === "resubmission_required";
  // Enable the submit button only once the required fields are valid (mirrors
  // the click-time validation; the actual rules live in handleResubmit).
  const canSubmitResubmission =
    Boolean(govIdType) &&
    (govIdType !== "other" || govIdOther.trim().length > 0) &&
    Boolean(idFront) &&
    Boolean(idBack) &&
    Boolean(idSelfie);

  if (state && state.hasResidentRecord === false) {
    return (
      <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}>
        <Card className="border-slate-200 p-6">
          <p className="text-sm font-semibold text-brand-ink">No resident record is linked to your account yet.</p>
          <p className="mt-1 text-sm text-brand-gray">
            Please contact your Barangay Health Station or the RHU so your resident record can be completed.
          </p>
        </Card>
      </motion.div>
    );
  }

  return (
    <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}>
      <Card className={`p-6 ${meta.tone}`}>
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-4">
            <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border ${meta.iconWrap}`}>
              <Icon className="h-6 w-6" strokeWidth={1.8} aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-brand-gray">Verification status</p>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <h2 className="font-heading text-lg font-semibold text-brand-ink">{meta.label}</h2>
                <span className={`inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-[0.06em] ${meta.chip}`}>
                  Manual review
                </span>
              </div>
              <p className="mt-1.5 max-w-xl text-sm leading-relaxed text-brand-gray">{meta.message}</p>

              {verification?.submittedAt && (
                <p className="mt-2 text-xs text-brand-gray">
                  Submitted on <span className="font-medium text-brand-ink">{formatDate(verification.submittedAt)}</span>
                  {verification.barangay ? ` · Barangay ${verification.barangay}` : ""}
                </p>
              )}

              {canResubmit && verification?.rejectionReason && (
                <p className="mt-3 rounded-lg border border-brand-danger/20 bg-white px-3 py-2 text-xs text-brand-ink">
                  <span className="font-semibold">Reason:</span> {verification.rejectionReason}
                </p>
              )}
              {canResubmit && !verification?.rejectionReason && (
                <p className="mt-3 rounded-lg border border-brand-danger/20 bg-white px-3 py-2 text-xs text-brand-ink">
                  Please review and resubmit your verification documents.
                </p>
              )}
            </div>
          </div>

          <div className="flex shrink-0 flex-col items-stretch gap-2 sm:items-end">
            {canResubmit && (
              <button
                type="button"
                onClick={openResubmit}
                disabled={resubmitting}
                className="inline-flex items-center justify-center gap-2 rounded-btn bg-brand-blue px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-dark disabled:opacity-60"
              >
                <RotateCcw className="h-4 w-4" /> Resubmit Documents
              </button>
            )}
            {!canResubmit && status !== "approved" && (
              <button
                type="button"
                onClick={load}
                className="inline-flex items-center justify-center gap-2 rounded-btn border border-brand-border bg-white px-4 py-2 text-sm font-medium text-brand-gray transition-colors hover:bg-brand-bg"
              >
                <RefreshCw className="h-4 w-4" /> Refresh status
              </button>
            )}
          </div>
        </div>

        {error && (
          <p role="alert" className="mt-4 flex items-center gap-2 text-sm font-medium text-brand-danger">
            <ShieldAlert className="h-4 w-4 shrink-0" /> {error}
          </p>
        )}
      </Card>

      {/* Resubmission document upload — reuses the registration upload component,
          private storage endpoint and validation rules. Fixed header/footer with
          only the content scrolling. */}
      {showResubmit && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-3 sm:p-4">
          <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
            {/* HEADER */}
            <div className="flex shrink-0 items-start justify-between gap-3 border-b border-brand-border px-5 py-4 sm:px-6">
              <div className="min-w-0">
                <h3 className="font-heading text-base font-semibold text-brand-ink sm:text-lg">Resubmit Verification Documents</h3>
                <p className="mt-0.5 text-xs text-brand-gray sm:text-sm">
                  Upload clearer photos of your government ID. Both the front and back are required.
                </p>
              </div>
              <button
                onClick={() => !resubmitting && setShowResubmit(false)}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-brand-gray transition-colors hover:bg-brand-bg hover:text-brand-ink focus:outline-none focus:ring-2 focus:ring-brand-blue/40"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* CONTENT (only this scrolls) */}
            <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4 sm:px-6">
              {verification?.rejectionReason && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
                  <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-amber-700">Reviewer note</p>
                  <p className="mt-0.5 text-sm leading-snug text-brand-ink">{verification.rejectionReason}</p>
                </div>
              )}

              <div>
                <label className="text-sm font-medium text-brand-ink">
                  Government ID Type <span className="text-brand-danger">*</span>
                </label>
                <select
                  value={govIdType}
                  onChange={(e) => { setGovIdType(e.target.value); setFormErrors((p) => ({ ...p, govIdType: "" })); }}
                  className={`mt-1.5 h-11 w-full cursor-pointer rounded-input border bg-white px-3.5 text-sm outline-none focus:border-brand-blue ${
                    formErrors.govIdType ? "border-brand-danger" : "border-brand-border"
                  }`}
                >
                  <option value="">Select your government-issued ID</option>
                  {GOV_ID_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                {formErrors.govIdType && <p className="mt-1 text-xs text-brand-danger">{formErrors.govIdType}</p>}
              </div>

              {govIdType === "other" && (
                <div>
                  <label className="text-sm font-medium text-brand-ink">
                    Specify ID Type <span className="text-brand-danger">*</span>
                  </label>
                  <input
                    type="text"
                    value={govIdOther}
                    onChange={(e) => { setGovIdOther(e.target.value); setFormErrors((p) => ({ ...p, govIdOther: "" })); }}
                    placeholder="e.g. Voter's ID"
                    className={`mt-1.5 h-11 w-full rounded-input border bg-white px-3.5 text-sm outline-none focus:border-brand-blue ${
                      formErrors.govIdOther ? "border-brand-danger" : "border-brand-border"
                    }`}
                  />
                  {formErrors.govIdOther && <p className="mt-1 text-xs text-brand-danger">{formErrors.govIdOther}</p>}
                </div>
              )}

              {/* ID Front + Back + holding-ID photo side-by-side on desktop,
                  stacked on mobile. */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div>
                  <UploadComponent
                    label="Government ID (Front)"
                    file={idFront}
                    onFile={(f) => { setIdFront(f); setFormErrors((p) => ({ ...p, idFront: "" })); }}
                    onRemove={() => setIdFront(null)}
                  />
                  {formErrors.idFront && <p className="mt-1 text-xs text-brand-danger">{formErrors.idFront}</p>}
                </div>
                <div>
                  <UploadComponent
                    label="Government ID (Back)"
                    file={idBack}
                    onFile={(f) => { setIdBack(f); setFormErrors((p) => ({ ...p, idBack: "" })); }}
                    onRemove={() => setIdBack(null)}
                  />
                  {formErrors.idBack && <p className="mt-1 text-xs text-brand-danger">{formErrors.idBack}</p>}
                </div>
                <div>
                  <UploadComponent
                    label="Photo Holding Your ID"
                    file={idSelfie}
                    onFile={(f) => { setIdSelfie(f); setFormErrors((p) => ({ ...p, idSelfie: "" })); }}
                    onRemove={() => setIdSelfie(null)}
                    accept=".png,.jpg,.jpeg"
                    allowedExts={["png", "jpg", "jpeg"]}
                    hint="PNG, JPG, JPEG — up to 10 MB"
                  />
                  {formErrors.idSelfie && <p className="mt-1 text-xs text-brand-danger">{formErrors.idSelfie}</p>}
                </div>
              </div>

              <p className="text-xs text-brand-gray">
                Take a clear photo of yourself holding your government ID. Your face and ID must be visible.
              </p>

              <div className="rounded-lg border border-brand-border bg-brand-bg px-3 py-2.5">
                <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-brand-gray">Photo guide</p>
                <ul className="mt-1 grid grid-cols-1 gap-0.5 text-xs text-brand-ink sm:grid-cols-2">
                  <li>• Your face must be clearly visible</li>
                  <li>• Hold your ID in your hand</li>
                  <li>• Make sure the ID information is readable</li>
                  <li>• Use good lighting</li>
                  <li>• Avoid blur and glare</li>
                </ul>
              </div>

              {error && (
                <p role="alert" className="flex items-center gap-2 text-sm font-medium text-brand-danger">
                  <ShieldAlert className="h-4 w-4 shrink-0" /> {error}
                </p>
              )}
            </div>

            {/* FOOTER */}
            <div className="flex shrink-0 items-center justify-end gap-3 border-t border-brand-border bg-white px-5 py-3.5 sm:px-6">
              <button
                onClick={() => !resubmitting && setShowResubmit(false)}
                className="rounded-btn px-4 py-2 text-sm font-medium text-brand-gray hover:bg-brand-bg"
              >
                Cancel
              </button>
              <button
                onClick={handleResubmit}
                disabled={resubmitting || !canSubmitResubmission}
                className="inline-flex items-center gap-2 rounded-btn bg-brand-blue px-5 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-60"
              >
                {resubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
                {resubmitting ? "Submitting…" : "Submit Resubmission"}
              </button>
            </div>
          </div>
        </div>
      )}
    </motion.div>
  );
}
