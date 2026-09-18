import React, { useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  X, CheckCircle2, XCircle, FileWarning, User, MapPin, Calendar, Phone, Hash, History, Loader2,
} from "lucide-react";
import VerificationBadge from "@/features/verification/components/VerificationBadge";
import { REJECTION_REASONS } from "@/services/local/verifications";

const formatDate = (value) => {
  if (!value) return "—";
  const d = new Date(String(value).length === 10 ? `${value}T00:00:00` : value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
};

const formatDateTime = (value) => {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString("en-US", { month: "long", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
};

function InfoCell({ icon: Icon, label, value }) {
  return (
    <div className="rounded-btn bg-brand-bg p-3">
      <div className="flex items-center gap-1.5">
        {Icon && <Icon className="w-3.5 h-3.5 text-brand-gray" strokeWidth={1.8} />}
        <p className="text-[11px] text-brand-gray uppercase tracking-wide">{label}</p>
      </div>
      <p className="mt-1 text-sm font-medium text-brand-ink">{value || "—"}</p>
    </div>
  );
}

function SectionTitle({ children }) {
  return <p className="mb-2.5 text-xs font-semibold uppercase tracking-wide text-brand-gray">{children}</p>;
}

/**
 * Review drawer for a resident registration.
 *
 * Shows the resident's submitted details and verification history and lets the
 * reviewer approve, reject (reason required) or request a resubmission. All
 * actions are performed by the backend; this component only collects the
 * reviewer's input and renders the result. The reviewer identity is derived
 * from the session on the server.
 */
export default function VerificationReviewDrawer({
  verification,
  history = [],
  onClose,
  onApprove,
  onReject,
  onRequestResubmission,
  submitting = false,
}) {
  const [mode, setMode] = useState(null); // 'approve' | 'reject' | 'resubmit'
  const [reason, setReason] = useState("");
  const [remarks, setRemarks] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      if (mode) setMode(null);
      else onClose();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [mode, onClose]);

  const reset = () => {
    setReason("");
    setRemarks("");
    setError("");
  };

  const openMode = (next) => {
    reset();
    setMode(next);
  };

  const submitReject = () => {
    if (submitting) return;
    if (!reason) return setError("Please select a rejection reason.");
    if (reason === "Other" && remarks.trim().length < 5) {
      return setError('Please describe the reason (at least 5 characters) when choosing "Other".');
    }
    setError("");
    return onReject({ reason, remarks: remarks.trim() });
  };

  const submitResubmission = () => {
    if (submitting) return;
    if (!reason) return setError("Please select a reason for the resubmission request.");
    if (reason === "Other" && remarks.trim().length < 5) {
      return setError('Please describe the reason (at least 5 characters) when choosing "Other".');
    }
    setError("");
    return onRequestResubmission({ reason, remarks: remarks.trim() });
  };

  const status = verification.status || "pending";
  const decided = status !== "pending";

  return (
    <div className="fixed inset-0 z-50">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="absolute inset-0 bg-brand-deep/60"
      />
      <motion.aside
        initial={{ x: "100%" }}
        animate={{ x: 0 }}
        exit={{ x: "100%" }}
        transition={{ type: "tween", duration: 0.25, ease: "easeOut" }}
        className="absolute right-0 top-0 flex h-full w-full flex-col bg-brand-bg shadow-2xl sm:max-w-xl"
        role="dialog"
        aria-modal="true"
        aria-label={`Verification review for ${verification.name}`}
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-brand-border bg-white px-5 py-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand-blue text-sm font-heading font-semibold text-white">
              {(verification.name || "?").split(" ").map((n) => n[0]).slice(0, 2).join("")}
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="truncate font-heading font-semibold text-brand-ink">{verification.name}</h3>
                <VerificationBadge status={status} size="sm" />
              </div>
              <p className="text-xs text-brand-gray">
                Reference <span className="font-stat font-medium">{verification.ref}</span> · Barangay {verification.barangay}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-brand-gray transition-colors hover:bg-brand-bg hover:text-brand-ink"
            aria-label="Close review panel"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
          <section>
            <SectionTitle>Registration Details</SectionTitle>
            <div className="grid grid-cols-2 gap-3">
              <InfoCell icon={User} label="Full Name" value={verification.name} />
              <InfoCell icon={Calendar} label="Date of Birth" value={formatDate(verification.birthDate)} />
              <InfoCell icon={User} label="Age" value={verification.age !== "" ? `${verification.age} years` : ""} />
              <InfoCell icon={User} label="Sex" value={verification.sex} />
              <InfoCell icon={User} label="Civil Status" value={verification.civilStatus} />
              <InfoCell icon={Phone} label="Contact Number" value={verification.contactNumber} />
              <InfoCell icon={MapPin} label="Barangay" value={verification.barangay} />
              <InfoCell icon={Calendar} label="Registration Date" value={formatDate(verification.registeredDate)} />
            </div>
            <div className="mt-3 grid grid-cols-1 gap-3">
              <InfoCell icon={MapPin} label="Address" value={verification.address} />
              <InfoCell icon={Hash} label="Reference Number" value={verification.ref} />
            </div>
          </section>

          {(verification.rejectionReason || verification.verifiedAt) && (
            <section className="rounded-btn border border-brand-border bg-white p-4">
              <SectionTitle>Previous Decision</SectionTitle>
              <div className="space-y-2 text-sm">
                {verification.verifiedAt && (
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-brand-gray">Reviewed</p>
                    <p className="font-medium text-brand-ink">{formatDateTime(verification.verifiedAt)}</p>
                  </div>
                )}
                {verification.rejectionReason && (
                  <div className="border-t border-brand-border pt-2">
                    <p className="text-brand-gray">Reason</p>
                    <p className="mt-1 font-medium text-brand-ink">{verification.rejectionReason}</p>
                  </div>
                )}
              </div>
            </section>
          )}

          {history.length > 0 && (
            <section className="rounded-btn border border-brand-border bg-white p-4">
              <div className="mb-3 flex items-center gap-2">
                <History className="h-4 w-4 text-brand-blue" strokeWidth={1.8} />
                <SectionTitle>Verification History</SectionTitle>
              </div>
              <ol className="space-y-3">
                {history.map((entry) => (
                  <li key={entry.id} className="text-sm">
                    <p className="font-medium text-brand-ink capitalize">{entry.action}</p>
                    <p className="text-xs text-brand-gray">
                      {formatDateTime(entry.createdAt)}
                      {entry.previousStatus && entry.newStatus ? ` · ${entry.previousStatus} → ${entry.newStatus}` : ""}
                    </p>
                    {entry.reason && <p className="mt-0.5 text-xs text-brand-ink">Reason: {entry.reason}</p>}
                  </li>
                ))}
              </ol>
            </section>
          )}

          {/* Decision actions */}
          {!decided && (
            <section className="rounded-btn border border-brand-border bg-white p-4">
              <SectionTitle>Verification Decision</SectionTitle>
              {!mode && (
                <div className="space-y-2.5">
                  <button
                    onClick={() => openMode("approve")}
                    className="flex w-full items-center justify-center gap-2 rounded-btn bg-brand-blue py-3 text-sm font-medium text-white shadow-soft transition-colors hover:bg-brand-dark"
                  >
                    <CheckCircle2 className="w-4 h-4" /> Approve Resident
                  </button>
                  <button
                    onClick={() => openMode("resubmit")}
                    className="flex w-full items-center justify-center gap-2 rounded-btn border border-brand-border bg-white py-3 text-sm font-medium text-brand-gray transition-colors hover:bg-brand-bg"
                  >
                    <FileWarning className="w-4 h-4" /> Request Resubmission
                  </button>
                  <button
                    onClick={() => openMode("reject")}
                    className="flex w-full items-center justify-center gap-2 rounded-btn border border-brand-danger/30 bg-brand-danger/5 py-3 text-sm font-medium text-brand-danger transition-colors hover:bg-brand-danger/10"
                  >
                    <XCircle className="w-4 h-4" /> Reject Resident
                  </button>
                </div>
              )}

              {mode === "approve" && (
                <div className="space-y-3">
                  <p className="text-sm text-brand-gray">
                    Approve <span className="font-medium text-brand-ink">{verification.name}</span>? The resident will gain
                    full access to resident features.
                  </p>
                  <div className="flex justify-end gap-3">
                    <button onClick={() => setMode(null)} disabled={submitting} className="rounded-btn px-4 py-2 text-sm font-medium text-brand-gray hover:bg-brand-bg">
                      Cancel
                    </button>
                    <button
                      onClick={() => onApprove()}
                      disabled={submitting}
                      className="flex items-center gap-2 rounded-btn bg-brand-blue px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-dark disabled:opacity-60"
                    >
                      {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                      Confirm approval
                    </button>
                  </div>
                </div>
              )}

              {(mode === "reject" || mode === "resubmit") && (
                <div className="space-y-3.5">
                  <p className="text-sm text-brand-gray">
                    {mode === "reject"
                      ? `Select the reason for rejecting ${verification.name}'s registration.`
                      : `Select the reason for requesting a resubmission from ${verification.name}.`}
                  </p>
                  <div className="space-y-1.5">
                    {REJECTION_REASONS.map((r) => (
                      <label
                        key={r}
                        className={`flex cursor-pointer items-center gap-2.5 rounded-btn border px-3.5 py-2.5 text-sm transition-colors ${
                          reason === r ? "border-brand-danger/40 bg-brand-danger/5 text-brand-ink" : "border-brand-border bg-white text-brand-ink hover:bg-brand-bg"
                        }`}
                      >
                        <input
                          type="radio"
                          name="rejection-reason"
                          checked={reason === r}
                          onChange={() => {
                            setReason(r);
                            setError("");
                          }}
                          className="h-4 w-4 accent-brand-danger"
                        />
                        {r}
                      </label>
                    ))}
                  </div>
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-brand-ink">
                      Remarks {reason === "Other" && <span className="text-red-500">*</span>}
                    </label>
                    <textarea
                      rows={3}
                      value={remarks}
                      onChange={(e) => {
                        setRemarks(e.target.value);
                        setError("");
                      }}
                      placeholder="Add details the resident should see..."
                      className="w-full resize-none rounded-btn border border-brand-border bg-white px-3 py-2.5 text-sm text-brand-ink outline-none transition-colors focus:border-brand-blue"
                    />
                  </div>
                  {error && <p className="text-xs text-red-600">{error}</p>}
                  <div className="flex items-center justify-end gap-3">
                    <button onClick={() => setMode(null)} disabled={submitting} className="rounded-btn px-4 py-2 text-sm font-medium text-brand-gray hover:bg-brand-bg">
                      Cancel
                    </button>
                    <button
                      onClick={mode === "reject" ? submitReject : submitResubmission}
                      disabled={submitting}
                      className="flex items-center gap-2 rounded-btn bg-brand-danger px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-danger/90 disabled:opacity-60"
                    >
                      {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <XCircle className="w-4 h-4" />}
                      {mode === "reject" ? "Confirm rejection" : "Confirm request"}
                    </button>
                  </div>
                </div>
              )}
            </section>
          )}

          {decided && (
            <section className="rounded-btn border border-brand-border bg-white p-4">
              <SectionTitle>Decision Recorded</SectionTitle>
              <p className="text-sm text-brand-gray">
                This registration is <span className="font-medium text-brand-ink">{status.replace("_", " ")}</span>. Use the
                resident's history above to review the decision.
              </p>
            </section>
          )}
        </div>
      </motion.aside>
    </div>
  );
}
