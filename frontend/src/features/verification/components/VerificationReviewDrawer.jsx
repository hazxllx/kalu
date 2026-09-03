import React, { useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  X, FileText, CheckCircle2, XCircle, ShieldCheck, User, MapPin, Calendar, Phone, Home, Hash,
} from "lucide-react";
import { Card } from "@/components/common/Card";
import VerificationBadge from "@/features/verification/components/VerificationBadge";
import { REJECTION_REASONS } from "@/services/mock/mockVerifications";

const formatReviewDate = (date) =>
  date.toLocaleString("en-US", { month: "long", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });

/** Compact label-over-value cell used across the review sections. */
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
  return (
    <p className="mb-2.5 text-xs font-semibold uppercase tracking-wide text-brand-gray">{children}</p>
  );
}

/**
 * Verification review drawer for a pending resident registration.
 *
 * Shows everything the resident submitted (identity, residency, proof of
 * residency) and lets the reviewer approve (with confirmation) or reject
 * (with a required reason). The reviewer identity and review date shown in
 * the audit block come from the signed-in user and the actual review time.
 *
 * @param {object} props.verification the pending verification record
 * @param {string} props.reviewerName e.g. "Maria Dela Cruz"
 * @param {string} props.reviewerRoleLabel e.g. "Health Supervisor"
 * @param {() => void} props.onClose
 * @param ({ decision, reason, remarks, reviewedAt }) => void props.onDecision
 */
export default function VerificationReviewDrawer({
  verification,
  reviewerName,
  reviewerRoleLabel,
  onClose,
  onDecision,
}) {
  const [showApproveConfirm, setShowApproveConfirm] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [remarks, setRemarks] = useState("");
  const [error, setError] = useState("");
  const [reviewDate] = useState(() => new Date());

  // Escape closes the confirmation/reason form first, then the drawer;
  // background scrolling stays locked while the drawer is open.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      if (showApproveConfirm) setShowApproveConfirm(false);
      else if (rejecting) setRejecting(false);
      else onClose();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [showApproveConfirm, rejecting, onClose]);

  const confirmReject = () => {
    if (!reason) {
      setError("Please select a rejection reason.");
      return;
    }
    if (reason === "Other" && !remarks.trim()) {
      setError("Please provide remarks when choosing 'Other'.");
      return;
    }
    setError("");
    onDecision({
      decision: "rejected",
      reason,
      remarks: remarks.trim(),
      reviewedAt: new Date().toISOString(),
    });
  };

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
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-brand-border bg-white px-5 py-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand-blue text-sm font-heading font-semibold text-white">
              {verification.name.split(" ").map((n) => n[0]).slice(0, 2).join("")}
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="truncate font-heading font-semibold text-brand-ink">{verification.name}</h3>
                <VerificationBadge status="pending" size="sm" />
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

        {/* Body */}
        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
          {/* Identity / registration details */}
          <section>
            <SectionTitle>Identity / Registration Details</SectionTitle>
            <div className="grid grid-cols-2 gap-3">
              <InfoCell icon={User} label="Full Name" value={verification.name} />
              <InfoCell icon={Calendar} label="Date of Birth" value={verification.birthDate} />
              <InfoCell icon={User} label="Age" value={`${verification.age} years`} />
              <InfoCell icon={User} label="Sex" value={verification.sex} />
              <InfoCell icon={User} label="Civil Status" value={verification.civilStatus} />
              <InfoCell icon={Phone} label="Contact Number" value={verification.contact} />
              <InfoCell icon={MapPin} label="Barangay" value={verification.barangay} />
              <InfoCell icon={Calendar} label="Registration Date" value={verification.registered} />
            </div>
            <div className="mt-3 grid grid-cols-1 gap-3">
              <InfoCell icon={MapPin} label="Address" value={verification.address} />
              <InfoCell icon={Hash} label="Reference Number" value={verification.ref} />
            </div>
          </section>

          {/* Residency information */}
          <section>
            <SectionTitle>Residency Information</SectionTitle>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <InfoCell icon={ShieldCheck} label="Residency Status" value={verification.residencyStatus} />
              <InfoCell icon={Calendar} label="Length of Residency" value={verification.lengthOfResidency} />
              <InfoCell icon={Home} label="Household / Family ID" value={verification.householdId} />
            </div>
          </section>

          {/* Proof of residency */}
          <section>
            <SectionTitle>Proof of Residency</SectionTitle>
            <div className="flex items-center gap-3 rounded-btn border border-brand-border bg-white p-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-brand-blue/10">
                <FileText className="h-5 w-5 text-brand-blue" strokeWidth={1.8} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-brand-ink">{verification.proofDocument || "Proof of Residency"}</p>
                <p className="mt-0.5 text-xs text-brand-gray">
                  Submitted with the registration — no file preview available in this demo.
                </p>
              </div>
              <span className="shrink-0 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700">
                Submitted for Review
              </span>
            </div>
          </section>

          {/* Verification decision */}
          <section className="rounded-btn border border-brand-border bg-white p-4">
            <SectionTitle>Verification Decision</SectionTitle>
            {!rejecting ? (
              <div className="space-y-2.5">
                <button
                  onClick={() => setShowApproveConfirm(true)}
                  className="flex w-full items-center justify-center gap-2 rounded-btn bg-brand-blue py-3 text-sm font-medium text-white shadow-soft transition-colors hover:bg-brand-dark"
                >
                  <CheckCircle2 className="w-4 h-4" /> Approve Verification
                </button>
                <button
                  onClick={() => {
                    setRejecting(true);
                    setReason("");
                    setRemarks("");
                    setError("");
                  }}
                  className="flex w-full items-center justify-center gap-2 rounded-btn border border-brand-danger/30 bg-brand-danger/5 py-3 text-sm font-medium text-brand-danger transition-colors hover:bg-brand-danger/10"
                >
                  <XCircle className="w-4 h-4" /> Reject
                </button>
              </div>
            ) : (
              <div className="space-y-3.5">
                <p className="text-sm text-brand-gray">
                  Select the reason for rejecting <span className="font-medium text-brand-ink">{verification.name}</span>'s
                  verification. The reason is recorded with the verification history.
                </p>
                <div className="space-y-1.5">
                  {REJECTION_REASONS.map((r) => (
                    <label
                      key={r}
                      className={`flex cursor-pointer items-center gap-2.5 rounded-btn border px-3.5 py-2.5 text-sm transition-colors ${
                        reason === r
                          ? "border-brand-danger/40 bg-brand-danger/5 text-brand-ink"
                          : "border-brand-border bg-white text-brand-ink hover:bg-brand-bg"
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
                    placeholder="Add custom remarks (required when choosing 'Other')..."
                    className="w-full resize-none rounded-btn border border-brand-border bg-white px-3 py-2.5 text-sm text-brand-ink outline-none transition-colors focus:border-brand-blue"
                  />
                </div>
                {error && <p className="text-xs text-red-600">{error}</p>}
                <div className="flex items-center justify-end gap-3">
                  <button
                    onClick={() => setRejecting(false)}
                    className="rounded-btn px-4 py-2 text-sm font-medium text-brand-gray transition-colors hover:bg-brand-bg"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={confirmReject}
                    className="flex items-center gap-2 rounded-btn bg-brand-danger px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-danger/90"
                  >
                    <XCircle className="w-4 h-4" /> Confirm Rejection
                  </button>
                </div>
              </div>
            )}
          </section>

          {/* Audit information */}
          <section className="rounded-btn border border-brand-border bg-white p-4">
            <SectionTitle>Audit Information</SectionTitle>
            <div className="space-y-2 text-sm">
              <div className="flex items-center justify-between gap-3">
                <p className="text-brand-gray">Reviewed by</p>
                <p className="text-right font-medium text-brand-ink">
                  {reviewerName}
                  <span className="block text-xs font-normal text-brand-gray">{reviewerRoleLabel}</span>
                </p>
              </div>
              <div className="flex items-center justify-between gap-3 border-t border-brand-border pt-2">
                <p className="text-brand-gray">Review Date</p>
                <p className="font-medium text-brand-ink">{formatReviewDate(reviewDate)}</p>
              </div>
            </div>
          </section>
        </div>

        {/* Approve confirmation dialog */}
        {showApproveConfirm && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/50 p-4">
            <Card role="alertdialog" aria-modal="true" className="w-full max-w-md overflow-hidden">
              <div className="p-6">
                <div className="flex items-start gap-3.5">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-green/10">
                    <CheckCircle2 className="h-5 w-5 text-brand-green" strokeWidth={1.8} />
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-brand-ink">Approve Resident Verification?</h3>
                    <p className="mt-1.5 text-sm text-brand-gray">
                      <span className="font-medium text-brand-ink">{verification.name}</span> will be verified as a
                      resident of Barangay {verification.barangay}.
                    </p>
                  </div>
                </div>
              </div>
              <div className="flex justify-end gap-3 border-t border-brand-border bg-white px-6 py-4">
                <button
                  onClick={() => setShowApproveConfirm(false)}
                  className="rounded-btn px-4 py-2 text-sm font-medium text-brand-gray transition-colors hover:bg-brand-bg"
                >
                  Cancel
                </button>
                <button
                  onClick={() =>
                    onDecision({
                      decision: "approved",
                      reason: "",
                      remarks: "",
                      reviewedAt: new Date().toISOString(),
                    })
                  }
                  className="rounded-btn bg-brand-blue px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-dark"
                >
                  Approve
                </button>
              </div>
            </Card>
          </div>
        )}
      </motion.aside>
    </div>
  );
}
