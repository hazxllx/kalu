// frontend/src/features/verification/components/HouseholdVerificationReviewDrawer.jsx
import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import {
  X, CheckCircle2, XCircle, ShieldCheck, Home, Users, MapPin, Phone, Hash, User, Wallet,
} from "lucide-react";
import { Card } from "@/components/common/Card";
import { HOUSEHOLD_RETURN_REASONS } from "@/services/local/householdVerifications";

import HouseholdFeedback from '@/features/households/components/HouseholdFeedback';

const formatReviewDate = (date) =>
  date.toLocaleString("en-US", { month: "long", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });

/** Compact label-over-value cell used across the review sections. */
function InfoCell({ icon: Icon, label, value }) {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1.5">
        {Icon && <Icon className="h-4 w-4 shrink-0 text-brand-gray" strokeWidth={1.8} />}
        <p className="text-xs text-brand-gray uppercase tracking-wide">{label}</p>
      </div>
      <p className="mt-1.5 break-words text-base font-medium text-brand-ink [overflow-wrap:anywhere]">{value || "—"}</p>
    </div>
  );
}

// Renders or manages SectionTitle logic.
function SectionTitle({ children }) {
  return (
    <p className="mb-5 text-sm font-semibold uppercase tracking-wide text-brand-gray">{children}</p>
  );
}

/**
 * Verification review drawer for a pending household profile.
 *
 * Lets a Health Supervisor review the household information captured during
 * household profiling (household, head, members, address/barangay, composition
 * and collected data) and either Verify (with confirmation) or Return for
 * Correction (with a required reason). Reviewer identity + review date come
 * from the signed-in user and the actual review time.
 */
export default function HouseholdVerificationReviewDrawer({
  household,
  reviewerName,
  reviewerRoleLabel,
  saving = false,
  requestError = "",
  correctionError = "",
  onEdit = () => {},
  onClose,
  onDecision,
}) {
  const [showVerifyConfirm, setShowVerifyConfirm] = useState(false);
  const [returning, setReturning] = useState(false);
  const [reason, setReason] = useState("");
  const [remarks, setRemarks] = useState("");
  const [error, setError] = useState("");
  const [reviewDate] = useState(() => new Date());
  const statusLabel = household.verificationStatus === "Verified"
    ? "Verified"
    : household.verificationStatus === "Returned for Correction"
      ? "Returned for Correction"
      : "Pending Verification";

  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      if (showVerifyConfirm) setShowVerifyConfirm(false);
      else if (returning) setReturning(false);
      else onClose();
    };
    document.addEventListener("keydown", onKey);
    const previousBodyOverflow = document.body.style.overflow;
    const previousDocumentOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousDocumentOverflow;
    };
  }, [showVerifyConfirm, returning, onClose]);

  const confirmReturn = () => {
    if (saving) return;
    if (!reason) {
      setError("Please select a reason for returning the household profile.");
      return;
    }
    if (reason === "Other" && !remarks.trim()) {
      setError("Please provide remarks when choosing 'Other'.");
      return;
    }
    setError("");
    onDecision({
      decision: "returned",
      reason,
      remarks: remarks.trim(),
      reviewedAt: new Date().toISOString(),
    });
  };

  return createPortal(
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
        transition={{ type: "tween", duration: 0.16, ease: "easeOut" }}
        className="fixed inset-y-0 right-0 flex w-full flex-col overflow-hidden bg-brand-bg shadow-2xl dark:bg-card md:w-[min(44rem,calc(100vw-2rem))]"
        role="dialog"
        aria-modal="true"
        aria-label={`Household verification review for ${household.head}`}
      >
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-brand-border bg-white px-5 py-4 dark:bg-card sm:px-6 sm:py-5">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-brand-blue text-white">
              <Home className="h-6 w-6" strokeWidth={1.8} />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2.5">
                <h3 className="truncate font-heading text-lg font-semibold text-brand-ink sm:text-xl">
                  Household {household.householdId}
                </h3>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
                  <ShieldCheck className="h-3.5 w-3.5" strokeWidth={1.8} />
                  {statusLabel}
                </span>
              </div>
              <p className="mt-0.5 text-sm text-brand-gray">
                HH Head: {household.head} · Barangay {household.barangay}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-brand-gray transition-colors hover:bg-brand-bg hover:text-brand-ink dark:hover:bg-card-nested"
            aria-label="Close review panel"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 space-y-10 overflow-y-auto overscroll-contain bg-brand-bg px-5 pt-6 pb-6 dark:bg-card sm:px-6 sm:pt-7 sm:pb-6">
          {/* Household information */}
          <section>
            <SectionTitle>Household Information</SectionTitle>
            <div className="grid grid-cols-1 gap-x-8 gap-y-12 sm:grid-cols-2">
              <InfoCell icon={Home} label="Household ID" value={household.householdId} />
              <InfoCell icon={User} label="Household Head" value={household.head} />
              <InfoCell icon={MapPin} label="Barangay" value={household.barangay} />
              <InfoCell icon={MapPin} label="Purok / Zone" value={household.purok} />
              <InfoCell icon={MapPin} label="Street / Sitio" value={household.address} />
              <InfoCell icon={Phone} label="Contact Number" value={household.contact} />
              <InfoCell icon={Wallet} label="Est. Monthly Income" value={household.income} />
              <InfoCell icon={Hash} label="Reference" value={household.ref} />
            </div>
          </section>

          {/* Household composition */}
          <section>
            <SectionTitle>Household Composition</SectionTitle>
            <div className="grid grid-cols-2 gap-x-6 gap-y-7 sm:grid-cols-4">
              <InfoCell icon={Users} label="Families" value={household.families} />
              <InfoCell icon={Users} label="Members" value={household.members} />
              <InfoCell icon={ShieldCheck} label="Water Source" value={household.water} />
              <InfoCell icon={ShieldCheck} label="Toilet" value={household.toilet} />
            </div>
          </section>

          {/* Household members */}
          <section>
            <SectionTitle>Household Members</SectionTitle>
            <div className="overflow-x-auto rounded-btn border border-brand-border bg-white dark:bg-card">
              <table className="w-full min-w-[34rem] text-sm">
                <thead>
                  <tr className="bg-brand-bg text-left dark:bg-card-nested">
                    <th className="px-3 py-2 font-medium text-brand-gray">Name</th>
                    <th className="px-3 py-2 font-medium text-brand-gray">Relationship</th>
                    <th className="px-3 py-2 font-medium text-brand-gray">Sex</th>
                    <th className="px-3 py-2 font-medium text-brand-gray">Age</th>
                    <th className="px-3 py-2 font-medium text-brand-gray">Classification</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-brand-border dark:bg-card">
                  {(household.membersList || []).map((m, i) => (
                    <tr key={i}>
                      <td className="px-3 py-2 text-brand-ink">{m.name}</td>
                      <td className="px-3 py-2 text-brand-gray">{m.relationship}</td>
                      <td className="px-3 py-2 text-brand-gray">{m.sex}</td>
                      <td className="px-3 py-2 text-brand-gray">{m.age}</td>
                      <td className="px-3 py-2 text-brand-gray">{m.classification}</td>
                    </tr>
                  ))}
                  {(!household.membersList || household.membersList.length === 0) && (
                    <tr>
                      <td colSpan={5} className="px-3 py-4 text-center text-brand-gray">
                        No member details recorded.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {/* Data collection info */}
          <section>
            <SectionTitle>Profiling / Collection</SectionTitle>
            <div className="grid grid-cols-1 gap-x-8 gap-y-12 sm:grid-cols-2">
              <InfoCell icon={User} label="Assigned BHW / Collector" value={household.collector} />
              <InfoCell icon={Home} label="Collected On" value={household.collectedOn} />
              <InfoCell icon={ShieldCheck} label="Risk Level" value={household.riskLevel} />
              <InfoCell icon={Hash} label="Last Updated" value={household.lastUpdated} />
            </div>
          </section>

          {/* Audit information */}
          <section className="border-t border-brand-border pt-5">
            <SectionTitle>Audit Information</SectionTitle>
            <div className="space-y-2 text-sm">
              <div className="flex items-center justify-between gap-3">
                <p className="text-brand-gray">Verified / reviewed by</p>
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

          {/* Review actions follow the household details, matching the scrollable reference layout. */}
          {household.verificationStatus === "Pending Verification" && (
            <section className="border-t border-brand-border pt-5">
              {!showVerifyConfirm && <HouseholdFeedback message={requestError} tone="error" />}
              {returning ? (
                <div className="space-y-3">
                  <p className="text-sm text-brand-gray">Reason for returning household {household.householdId}</p>
                  <div role="group" aria-label="Reason for returning household" aria-invalid={Boolean(error && !reason)} aria-describedby={error && !reason ? "return-reason-error" : undefined} className={`grid grid-cols-1 gap-2 sm:grid-cols-2 ${error && !reason ? "rounded border border-red-300 p-2" : ""}`}>
                    {HOUSEHOLD_RETURN_REASONS.map((r) => (
                      <label
                        key={r}
                        className={`flex cursor-pointer items-center gap-2 rounded-btn border px-3 py-2.5 text-sm transition-colors ${
                          reason === r ? "border-brand-danger/40 bg-brand-danger/5 text-brand-ink" : "border-brand-border text-brand-ink"
                        }`}
                      >
                        <input
                          type="radio"
                          disabled={saving}
                          name="household-return-reason"
                          checked={reason === r}
                          onChange={() => { setReason(r); setError(""); onEdit(); }}
                          className="h-4 w-4 accent-brand-danger"
                        />
                        {r}
                      </label>
                    ))}
                  </div>
                  {error && !reason && <p id="return-reason-error" className="text-xs text-red-700">{error}</p>}
                  <label className="block">
                    <span className="mb-1.5 block text-sm font-medium text-brand-ink">Remarks {reason === "Other" && <span className="text-red-500">*</span>}</span>
                    <textarea
                      rows={3}
                      value={remarks}
                      disabled={saving}
                      aria-invalid={Boolean(correctionError || (error && reason === "Other"))}
                      aria-describedby={(correctionError || (error && reason === "Other")) ? "return-remarks-error" : undefined}
                      onChange={(e) => { setRemarks(e.target.value); onEdit(); if (e.target.value.trim()) setError(""); }}
                      placeholder="Explain the correction needed"
                      className={`w-full resize-none rounded-btn border ${(correctionError || (error && reason === "Other")) ? "border-red-400" : "border-brand-border"} bg-white px-3 py-2.5 text-sm text-brand-ink outline-none focus:border-brand-blue dark:bg-card-nested`}
                    />
                  </label>
                  {(correctionError || (error && reason === "Other")) && <p id="return-remarks-error" className="text-xs text-red-700">{correctionError || error}</p>}
                  <div className="flex flex-col-reverse justify-end gap-2 sm:flex-row">
                    <button type="button" disabled={saving} onClick={() => setReturning(false)} className="h-11 rounded-btn px-4 text-sm font-medium text-brand-gray">Cancel</button>
                    <button type="button" onClick={confirmReturn} disabled={saving} className="h-11 rounded-btn bg-brand-danger px-5 text-sm font-medium text-white disabled:opacity-60">
                      {saving ? "Saving…" : "Confirm Return"}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => setShowVerifyConfirm(true)}
                    disabled={saving}
                    className="flex h-11 items-center justify-center gap-2 rounded-btn bg-brand-blue text-sm font-medium text-white disabled:opacity-60"
                  >
                    <CheckCircle2 className="h-4 w-4" /> Verify Household
                  </button>
                  <button
                    type="button"
                    onClick={() => { setReturning(true); setReason(""); setRemarks(""); setError(""); }}
                    disabled={saving}
                    className="flex h-11 items-center justify-center gap-2 rounded-btn border border-brand-danger/30 bg-brand-danger/5 text-sm font-medium text-brand-danger disabled:opacity-60 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300"
                  >
                    <XCircle className="h-4 w-4" /> Return for Correction
                  </button>
                </div>
              )}
            </section>
          )}
        </div>

        {/* Verify confirmation dialog */}
        {showVerifyConfirm && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/50 p-4">
            <Card role="alertdialog" aria-modal="true" className="w-full max-w-md overflow-hidden">
              <div className="p-6">
                <div className="flex items-start gap-3.5">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-green/10">
                    <CheckCircle2 className="h-5 w-5 text-brand-green" strokeWidth={1.8} />
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-brand-ink">Verify this household profile?</h3>
                    <p className="mt-1.5 text-sm text-brand-gray">
                      Household{" "}
                      <span className="font-medium text-brand-ink">{household.householdId}</span> (head:{" "}
                      {household.head}) in Barangay {household.barangay} will be marked as verified.
                    </p>
                  </div>
                </div>
              </div>
              {requestError && <div className="px-6 pb-3"><HouseholdFeedback message={requestError} tone="error" /></div>}
              <div className="flex justify-end gap-3 border-t border-brand-border bg-white px-6 py-4">
                <button
                  disabled={saving}
                  onClick={() => setShowVerifyConfirm(false)}
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
                  disabled={saving}
                  className="rounded-btn bg-brand-blue px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {saving ? "Saving…" : "Verify Household"}
                </button>
              </div>
            </Card>
          </div>
        )}
      </motion.aside>
    </div>,
    document.body,
  );
}
