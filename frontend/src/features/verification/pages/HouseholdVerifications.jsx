import React, { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import PageHeader from "@/components/common/PageHeader";
import { Card } from "@/components/common/Card";
import VerificationBadge from "@/features/verification/components/VerificationBadge";
import HouseholdVerificationReviewDrawer from "@/features/verification/components/HouseholdVerificationReviewDrawer";
import { useAuth } from "@/context/AuthContext";
import { getAssignedBarangay } from "@/lib/barangayScope";
import { householdStore } from "@/services/local/householdStore";
import { ROLES } from "@/lib/brand";
import {
  resolvePendingHouseholdVerifications,
  resolveHouseholdVerificationHistory,
} from "@/services/local/householdVerifications";
import { Search, CheckCircle2, ChevronRight, History, Home } from "lucide-react";

const formatHistoryDate = (iso) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString("en-US", { month: "long", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
};

/**
 * Household Verification (Health Supervisor).
 *
 * The queue and history are always scoped to the supervisor's assigned
 * barangay (`getAssignedBarangay`), matching how resident verifications are
 * scoped. The page has no barangay selector and cannot request another
 * barangay's household records.
 */
export default function HouseholdVerifications() {
  const { user } = useAuth();
  const assignedBarangay = getAssignedBarangay(user);
  const reviewerName = (user?.role && ROLES[user.role] && ROLES[user.role].name) || user?.name || "";
  const reviewerRoleLabel =
    (user?.role && ROLES[user.role] && ROLES[user.role].label) || "Health Supervisor";

  const [pending, setPending] = useState(() => resolvePendingHouseholdVerifications(assignedBarangay));
  const [history, setHistory] = useState(() => resolveHouseholdVerificationHistory(assignedBarangay));
  const [query, setQuery] = useState("");
  const [reviewing, setReviewing] = useState(null);
  const [toast, setToast] = useState(null);

  const filtered = pending.filter(
    (h) =>
      h.head.toLowerCase().includes(query.toLowerCase()) ||
      h.householdId.toLowerCase().includes(query.toLowerCase()) ||
      h.ref.toLowerCase().includes(query.toLowerCase())
  );

  const showToast = (message) => {
    setToast(message);
    setTimeout(() => setToast(null), 4000);
  };

  const handleDecision = ({ decision, reason, remarks, reviewedAt }) => {
    const record = reviewing;
    if (!record) return;

    setPending((prev) => prev.filter((v) => v.householdId !== record.householdId));
    setHistory((prev) => [
      {
        ref: record.ref,
        householdId: record.householdId,
        head: record.head,
        barangay: record.barangay,
        status: decision === "approved" ? "Verified" : "Returned for Correction",
        decision,
        reason,
        remarks,
        reviewedBy: reviewerName || "Health Supervisor",
        reviewedByRole: user?.role || "",
        reviewedAt,
      },
      ...prev,
    ]);
    setReviewing(null);

    // Sync the outcome to the shared household store so the BHW household
    // list immediately shows the verification status, reviewer, review date,
    // and correction reason (one store for both roles).
    householdStore.applyVerification(record.householdId, {
      status: decision === "approved" ? "Verified" : "Returned for Correction",
      reviewer: reviewerName || "Health Supervisor",
      reviewedAt: reviewedAt ? reviewedAt.slice(0, 10) : new Date().toISOString().slice(0, 10),
      reason,
    });

    showToast(
      decision === "approved"
        ? `Household ${record.householdId} verified.`
        : `Household ${record.householdId} returned for correction.`
    );
  };

  const scopeLabel = assignedBarangay ? `in Barangay ${assignedBarangay}` : "in your barangay";

  return (
    <>
      <PageHeader
        crumbs={["Dashboard", "Household Verifications"]}
        title="Household Verification"
        subtitle={`${pending.length} households awaiting verification of profiling information ${scopeLabel}.`}
      />

      {/* Toast Notification */}
      {toast && (
        <div className="fixed bottom-4 right-4 z-50 flex animate-in slide-in-from-bottom-2 items-center gap-2 rounded-btn bg-brand-ink px-4 py-3 shadow-lg">
          <CheckCircle2 className="h-4 w-4 text-brand-green" />
          <span className="text-sm text-white">{toast}</span>
        </div>
      )}

      <Card className="overflow-hidden">
        {/* Search bar */}
        <div className="px-6 py-4 border-b border-brand-border">
          <div className="flex items-center gap-2 bg-brand-bg border border-brand-border rounded-input px-3.5 py-2.5 max-w-sm">
            <Search className="w-4 h-4 text-brand-gray" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by household head, ID, or reference..."
              className="bg-transparent text-sm outline-none w-full placeholder:text-brand-gray/70"
            />
          </div>
        </div>

        {/* Pending table */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-brand-bg text-left">
                <th className="px-6 py-3 font-medium text-brand-gray">Household</th>
                <th className="px-6 py-3 font-medium text-brand-gray">Household Head</th>
                <th className="px-6 py-3 font-medium text-brand-gray">Barangay</th>
                <th className="px-6 py-3 font-medium text-brand-gray">Reference</th>
                <th className="px-6 py-3 font-medium text-brand-gray">Status</th>
                <th className="px-6 py-3 font-medium text-brand-gray text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-brand-border">
              {filtered.map((h, i) => (
                <motion.tr
                  key={h.householdId}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.05 }}
                  className="hover:bg-brand-bg/50 transition-colors"
                >
                  <td className="px-6 py-3.5">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-full bg-brand-blue/10 text-brand-blue flex items-center justify-center">
                        <Home className="w-4 h-4" />
                      </div>
                      <span className="font-medium text-brand-ink">{h.householdId}</span>
                    </div>
                  </td>
                  <td className="px-6 py-3.5">
                    <p className="font-medium text-brand-ink">{h.head}</p>
                    <p className="text-xs text-brand-gray">{h.members} members Â· {h.families} {h.families === 1 ? "family" : "families"}</p>
                  </td>
                  <td className="px-6 py-3.5 text-brand-gray">{h.barangay}</td>
                  <td className="px-6 py-3.5">
                    <span className="font-stat font-medium text-brand-ink text-xs">{h.ref}</span>
                  </td>
                  <td className="px-6 py-3.5">
                    <VerificationBadge status="pending" size="sm" />
                  </td>
                  <td className="px-6 py-3.5 text-right">
                    <button
                      onClick={() => setReviewing(h)}
                      className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-blue hover:underline"
                    >
                      Review <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </motion.tr>
              ))}
            </tbody>
          </table>
        </div>

        {filtered.length === 0 && (
          <div className="px-6 py-16 text-center">
            <div className="w-14 h-14 rounded-full bg-brand-bg flex items-center justify-center mx-auto">
              <Home className="w-7 h-7 text-brand-gray" strokeWidth={1.5} />
            </div>
            <p className="mt-4 text-sm font-medium text-brand-ink">No pending household verifications</p>
            <p className="text-xs text-brand-gray mt-1">All caught up.</p>
          </div>
        )}
      </Card>

      {/* Verification history */}
      <Card className="mt-6 overflow-hidden">
        <div className="flex items-center gap-2 border-b border-brand-border px-6 py-4">
          <History className="w-4 h-4 text-brand-blue" strokeWidth={1.8} />
          <h3 className="font-heading font-semibold text-brand-ink text-sm">Verification History</h3>
          <span className="ml-auto text-xs text-brand-gray">{history.length} reviewed</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-brand-bg text-left">
                <th className="px-6 py-3 font-medium text-brand-gray">Household</th>
                <th className="px-6 py-3 font-medium text-brand-gray">Reference</th>
                <th className="px-6 py-3 font-medium text-brand-gray">Decision</th>
                <th className="px-6 py-3 font-medium text-brand-gray">Reason / Remarks</th>
                <th className="px-6 py-3 font-medium text-brand-gray">Reviewed by</th>
                <th className="px-6 py-3 font-medium text-brand-gray">Review Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-brand-border">
              {history.map((h) => (
                <tr key={`${h.ref}-${h.reviewedAt}`} className="hover:bg-brand-bg/50 transition-colors">
                  <td className="px-6 py-3.5">
                    <p className="font-medium text-brand-ink">{h.householdId}</p>
                    <p className="text-xs text-brand-gray">Head: {h.head}</p>
                  </td>
                  <td className="px-6 py-3.5">
                    <span className="font-stat font-medium text-brand-ink text-xs">{h.ref}</span>
                  </td>
                  <td className="px-6 py-3.5">
                    <VerificationBadge status={h.status.toLowerCase()} size="sm" />
                  </td>
                  <td className="px-6 py-3.5 max-w-xs">
                    {h.decision === "returned" ? (
                      <p className="text-sm text-brand-ink">
                        {h.reason}
                        {h.remarks && <span className="block text-xs text-brand-gray mt-0.5">{h.remarks}</span>}
                      </p>
                    ) : (
                      <p className="text-sm text-brand-gray">{h.remarks || "â€”"}</p>
                    )}
                  </td>
                  <td className="px-6 py-3.5 text-sm text-brand-gray">{h.reviewedBy}</td>
                  <td className="px-6 py-3.5 text-sm text-brand-gray whitespace-nowrap">
                    {formatHistoryDate(h.reviewedAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Household verification review drawer */}
      <AnimatePresence>
        {reviewing && (
          <HouseholdVerificationReviewDrawer
            household={reviewing}
            reviewerName={reviewerName}
            reviewerRoleLabel={reviewerRoleLabel}
            onClose={() => setReviewing(null)}
            onDecision={handleDecision}
          />
        )}
      </AnimatePresence>
    </>
  );
}
