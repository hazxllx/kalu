import React, { useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  X, CheckCircle2, XCircle, ShieldCheck, Home, Users, MapPin, Phone, Hash, User, Wallet,
} from "lucide-react";
import { Card } from "@/components/common/Card";
import VerificationBadge from "@/features/verification/components/VerificationBadge";
import { HOUSEHOLD_RETURN_REASONS } from "@/services/local/householdVerifications";

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
  onClose,
  onDecision,
}) {
  const [showVerifyConfirm, setShowVerifyConfirm] = useState(false);
  const [returning, setReturning] = useState(false);
  const [reason, setReason] = useState("");
  const [remarks, setRemarks] = useState("");
  const [error, setError] = useState("");
  const [reviewDate] = useState(() => new Date());

  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      if (showVerifyConfirm) setShowVerifyConfirm(false);
      else if (returning) setReturning(false);
      else onClose();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [showVerifyConfirm, returning, onClose]);

  const confirmReturn = () => {
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
        initial={{ opacity: 0, scale: 0.98 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.98 }}
        transition={{ type: "tween", duration: 0.16, ease: "easeOut" }}
        className="absolute left-1/2 top-1/2 flex max-h-[calc(100dvh-1rem)] w-[calc(100%-1rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-card bg-brand-bg shadow-2xl sm:max-h-[calc(100vh-2rem)] sm:w-[calc(100%-2rem)] sm:max-w-2xl"
        role="dialog"
        aria-modal="true"
        aria-label={`Household verification review for ${household.head}`}
      >
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-brand-border bg-white px-5 py-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand-blue text-white">
              <Home className="h-5 w-5" strokeWidth={1.8} />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="truncate font-heading font-semibold text-brand-ink">
                  Household {household.householdId}
                </h3>
                <VerificationBadge
                  status={
                    household.verificationStatus === "Verified"
                      ? "approved"
                      : household.verificationStatus === "Returned for Correction"
                        ? "resubmission_required"
                        : "pending"
                  }
                  size="sm"
                />
              </div>
              <p className="text-xs text-brand-gray">
                HH Head: {household.head} · Barangay {household.barangay}
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
          {/* Household information */}
          <section>
            <SectionTitle>Household Information</SectionTitle>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <InfoCell icon={Users} label="Families" value={household.families} />
              <InfoCell icon={Users} label="Members" value={household.members} />
              <InfoCell icon={ShieldCheck} label="Water Source" value={household.water} />
              <InfoCell icon={ShieldCheck} label="Toilet" value={household.toilet} />
            </div>
          </section>

          {/* Household members */}
          <section>
            <SectionTitle>Household Members</SectionTitle>
            <div className="overflow-hidden rounded-btn border border-brand-border bg-white">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-brand-bg text-left">
                    <th className="px-3 py-2 font-medium text-brand-gray">Name</th>
                    <th className="px-3 py-2 font-medium text-brand-gray">Relationship</th>
                    <th className="px-3 py-2 font-medium text-brand-gray">Sex</th>
                    <th className="px-3 py-2 font-medium text-brand-gray">Age</th>
                    <th className="px-3 py-2 font-medium text-brand-gray">Classification</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-brand-border">
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
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <InfoCell icon={User} label="Assigned BHW / Collector" value={household.collector} />
              <InfoCell icon={Home} label="Collected On" value={household.collectedOn} />
              <InfoCell icon={ShieldCheck} label="Risk Level" value={household.riskLevel} />
              <InfoCell icon={Hash} label="Last Updated" value={household.lastUpdated} />
            </div>
          </section>

          {/* Audit information */}
          <section className="rounded-btn border border-brand-border bg-white p-4">
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
        </div>

        {/* Dedicated action footer */}
        {household.verificationStatus === "Pending Verification" && (
          <div className="shrink-0 border-t border-brand-border bg-white">
            {returning ? (
              <div className="max-h-[45dvh] space-y-3 overflow-y-auto px-4 py-3 sm:px-5">
                <p className="text-xs text-brand-gray">Reason for returning household {household.householdId}</p>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {HOUSEHOLD_RETURN_REASONS.map((r) => (
                    <label
                      key={r}
                      className={`flex cursor-pointer items-center gap-2 rounded-btn border px-3 py-2 text-xs transition-colors ${
                        reason === r ? "border-brand-danger/40 bg-brand-danger/5 text-brand-ink" : "border-brand-border text-brand-ink"
                      }`}
                    >
                      <input
                        type="radio"
                        name="household-return-reason"
                        checked={reason === r}
                        onChange={() => { setReason(r); setError(""); }}
                        className="h-4 w-4 accent-brand-danger"
                      />
                      {r}
                    </label>
                  ))}
                </div>
                <label className="block">
                  <span className="mb-1.5 block text-xs font-medium text-brand-ink">Remarks {reason === "Other" && <span className="text-red-500">*</span>}</span>
                  <textarea
                    rows={2}
                    value={remarks}
                    onChange={(e) => { setRemarks(e.target.value); setError(""); }}
                    placeholder="Explain the correction needed"
                    className="w-full resize-none rounded-btn border border-brand-border px-3 py-2 text-sm outline-none focus:border-brand-blue"
                  />
                </label>
                {error && <p className="text-xs text-red-600">{error}</p>}
                <div className="flex justify-end gap-2">
                  <button type="button" onClick={() => setReturning(false)} className="h-10 rounded-btn px-4 text-sm font-medium text-brand-gray">Cancel</button>
                  <button type="button" onClick={confirmReturn} disabled={saving} className="h-10 rounded-btn bg-brand-danger px-4 text-sm font-medium text-white disabled:opacity-60">
                    {saving ? "Saving…" : "Confirm Return"}
                  </button>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-2 px-4 py-3 sm:grid-cols-2 sm:px-5">
                <button
                  type="button"
                  onClick={() => setShowVerifyConfirm(true)}
                  disabled={saving}
                  className="flex h-10 items-center justify-center gap-2 rounded-btn bg-brand-blue text-sm font-medium text-white disabled:opacity-60"
                >
                  <CheckCircle2 className="h-4 w-4" /> Verify Household
                </button>
                <button
                  type="button"
                  onClick={() => { setReturning(true); setReason(""); setRemarks(""); setError(""); }}
                  disabled={saving}
                  className="flex h-10 items-center justify-center gap-2 rounded-btn border border-brand-danger/30 bg-brand-danger/5 text-sm font-medium text-brand-danger disabled:opacity-60"
                >
                  <XCircle className="h-4 w-4" /> Return for Correction
                </button>
              </div>
            )}
          </div>
        )}

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
              <div className="flex justify-end gap-3 border-t border-brand-border bg-white px-6 py-4">
                <button
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
    </div>
  );
}
