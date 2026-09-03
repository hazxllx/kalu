import React, { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import PageHeader from "@/components/common/PageHeader";
import { Card } from "@/components/common/Card";
import VerificationBadge from "@/features/verification/components/VerificationBadge";
import VerificationReviewDrawer from "@/features/verification/components/VerificationReviewDrawer";
import { useAuth } from "@/context/AuthContext";
import { getAssignedBarangay } from "@/lib/barangayScope";
import { ROLES } from "@/lib/brand";
import {
  resolvePendingVerifications,
  resolveVerificationHistory,
} from "@/services/mock/mockVerifications";
import {
  fetchPendingVerifications,
  submitVerificationDecision,
} from "@/services/api/verificationsApi";
import { Search, CheckCircle2, ChevronRight, History } from "lucide-react";

const formatApiDate = (iso) => {
  if (!iso) return "";
  const d = new Date(String(iso).length === 10 ? `${iso}T00:00:00` : iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
};

const formatHistoryDate = (iso) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString("en-US", { month: "long", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
};

/** Maps the API record shape onto the page's display shape. */
const fromApi = (v) => ({
  ref: v.ref,
  name: v.name,
  barangay: v.barangay,
  registered: formatApiDate(v.registeredDate),
  contact: v.contactNumber || "",
  birthDate: formatApiDate(v.birthDate),
  age: v.age ?? "",
  sex: v.sex || "",
  civilStatus: v.civilStatus || "",
  address: v.address || "",
  residencyStatus: v.residencyStatus || "",
  lengthOfResidency: v.lengthOfResidency || "",
  householdId: v.householdId || "",
  proofDocument: v.proofDocument || "",
  status: v.status || "Pending",
});

export default function PendingVerifications() {
  const { user } = useAuth();
  // Barangay scope comes from the signed-in user's assignment — the queue is
  // limited to it here AND on the server (/api/verifications/* derives the
  // same scope from the session).
  const assignedBarangay = getAssignedBarangay(user);
  const reviewerName = (user?.role && ROLES[user.role] && ROLES[user.role].name) || user?.name || "";
  const reviewerRoleLabel =
    (user?.role && ROLES[user.role] && ROLES[user.role].label) || "Health Supervisor";

  const [pending, setPending] = useState(() => resolvePendingVerifications(assignedBarangay));
  const [history, setHistory] = useState(() => resolveVerificationHistory(assignedBarangay));
  const [query, setQuery] = useState("");
  const [reviewing, setReviewing] = useState(null);
  const [toast, setToast] = useState(null);

  // Pull the live queue from the API when reachable (server enforces the
  // barangay assignment); otherwise keep the scoped mock dataset.
  useEffect(() => {
    let cancelled = false;
    fetchPendingVerifications()
      .then((rows) => {
        if (!cancelled && Array.isArray(rows) && rows.length > 0) {
          setPending(rows.map(fromApi));
        }
      })
      .catch(() => {
        /* API unavailable — keep the scoped mock queue */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = pending.filter(
    (r) =>
      r.name.toLowerCase().includes(query.toLowerCase()) ||
      r.ref.toLowerCase().includes(query.toLowerCase())
  );

  const showToast = (message) => {
    setToast(message);
    setTimeout(() => setToast(null), 4000);
  };

  const handleDecision = ({ decision, reason, remarks, reviewedAt }) => {
    const record = reviewing;
    if (!record) return;

    // Best-effort persistence through the API — the server independently
    // verifies the reviewer's barangay assignment before accepting it.
    submitVerificationDecision({ ref: record.ref, decision, reason, remarks }).catch(() => {});

    setPending((prev) => prev.filter((v) => v.ref !== record.ref));
    setHistory((prev) => [
      {
        ref: record.ref,
        name: record.name,
        barangay: record.barangay,
        status: decision === "approved" ? "Verified" : "Rejected",
        decision,
        reason,
        remarks,
        reviewedBy: reviewerName || "Health Supervisor",
        reviewedByRole: user?.role || "",
        reviewedAt,
        notified: true,
      },
      ...prev,
    ]);
    setReviewing(null);
    showToast(
      decision === "approved"
        ? `${record.name} is now verified as a resident of Barangay ${record.barangay}.`
        : `${record.name}'s verification was rejected — the resident will be notified.`
    );
  };

  const scopeLabel = assignedBarangay ? `in Barangay ${assignedBarangay}` : "in your barangay";

  return (
    <>
      <PageHeader
        crumbs={["Home", "Dashboard", "Pending Verifications"]}
        title="Pending Resident Verifications"
        subtitle={`${pending.length} residents awaiting identity verification ${scopeLabel}.`}
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
              placeholder="Search by name or reference..."
              className="bg-transparent text-sm outline-none w-full placeholder:text-brand-gray/70"
            />
          </div>
        </div>

        {/* Pending table */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-brand-bg text-left">
                <th className="px-6 py-3 font-medium text-brand-gray">Resident</th>
                <th className="px-6 py-3 font-medium text-brand-gray">Barangay</th>
                <th className="px-6 py-3 font-medium text-brand-gray">Registered</th>
                <th className="px-6 py-3 font-medium text-brand-gray">Reference</th>
                <th className="px-6 py-3 font-medium text-brand-gray">Status</th>
                <th className="px-6 py-3 font-medium text-brand-gray text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-brand-border">
              {filtered.map((r, i) => (
                <motion.tr
                  key={r.ref}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.05 }}
                  className="hover:bg-brand-bg/50 transition-colors"
                >
                  <td className="px-6 py-3.5">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-full bg-brand-light text-brand-blue flex items-center justify-center text-xs font-heading font-semibold">
                        {r.name.split(" ").map((n) => n[0]).slice(0, 2).join("")}
                      </div>
                      <span className="font-medium text-brand-ink">{r.name}</span>
                    </div>
                  </td>
                  <td className="px-6 py-3.5 text-brand-gray">{r.barangay}</td>
                  <td className="px-6 py-3.5 text-brand-gray">{r.registered}</td>
                  <td className="px-6 py-3.5">
                    <span className="font-stat font-medium text-brand-ink text-xs">{r.ref}</span>
                  </td>
                  <td className="px-6 py-3.5">
                    <VerificationBadge status="pending" size="sm" />
                  </td>
                  <td className="px-6 py-3.5 text-right">
                    <button
                      onClick={() => setReviewing(r)}
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
              <CheckCircle2 className="w-7 h-7 text-brand-gray" strokeWidth={1.5} />
            </div>
            <p className="mt-4 text-sm font-medium text-brand-ink">No pending verifications</p>
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
                <th className="px-6 py-3 font-medium text-brand-gray">Resident</th>
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
                    <p className="font-medium text-brand-ink">{h.name}</p>
                    <p className="text-xs text-brand-gray">Barangay {h.barangay}</p>
                  </td>
                  <td className="px-6 py-3.5">
                    <span className="font-stat font-medium text-brand-ink text-xs">{h.ref}</span>
                  </td>
                  <td className="px-6 py-3.5">
                    <VerificationBadge status={h.status.toLowerCase()} size="sm" />
                  </td>
                  <td className="px-6 py-3.5 max-w-xs">
                    {h.decision === "rejected" ? (
                      <p className="text-sm text-brand-ink">
                        {h.reason}
                        {h.remarks && <span className="block text-xs text-brand-gray mt-0.5">{h.remarks}</span>}
                      </p>
                    ) : (
                      <p className="text-sm text-brand-gray">
                        {h.remarks || "—"}
                      </p>
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

      {/* Verification review drawer */}
      <AnimatePresence>
        {reviewing && (
          <VerificationReviewDrawer
            verification={reviewing}
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
