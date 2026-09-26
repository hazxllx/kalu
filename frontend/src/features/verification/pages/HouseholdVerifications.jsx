import React, { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import PageHeader from "@/components/common/PageHeader";
import { Card } from "@/components/common/Card";
import VerificationBadge from "@/features/verification/components/VerificationBadge";
import HouseholdVerificationReviewDrawer from "@/features/verification/components/HouseholdVerificationReviewDrawer";
import { useAuth } from "@/context/AuthContext";
import { getAssignedBarangay } from "@/lib/barangayScope";
import { householdsApi } from "@/services/api";
import { ROLES } from "@/lib/brand";
import { Search, CheckCircle2, ChevronRight, History, Home } from "lucide-react";

const formatHistoryDate = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString("en-US", { month: "long", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
};

/** Raw API household → pending-table row shape. */
const toRow = (h) => ({
  householdId: h.id,
  ref: h.id,
  head: h.headName || h.head || "—",
  barangay: h.barangay || "",
  members: Array.isArray(h.members) ? h.members.length : h.members ?? 0,
  families: h.families ?? 1,
  verificationStatus: h.verificationStatus || "Pending Verification",
  verifiedBy: h.verifiedBy || "",
  verifiedAt: h.verifiedAt || "",
  correctionReason: h.correctionReason || "",
});

/** Raw API household → review drawer shape. */
const toDrawer = (h) => ({
  householdId: h.id,
  ref: h.id,
  head: h.headName || h.head || "—",
  barangay: h.barangay || "",
  purok: h.purok || "",
  address: h.streetAddress || "",
  contact: h.contact || "",
  income: h.monthlyIncome ? `₱${Number(h.monthlyIncome).toLocaleString()}` : "—",
  families: h.families ?? 1,
  members: Array.isArray(h.members) ? h.members.length : h.members ?? 0,
  water: h.waterSource || "—",
  toilet: h.toiletType || "—",
  membersList: (h.members || []).map((m) => ({
    name: m.name,
    relationship: m.relationship,
    sex: m.sex,
    age: m.age,
    classification: m.classification,
  })),
  collector: h.collectorName || "—",
  collectedOn: h.createdAt ? new Date(h.createdAt).toLocaleDateString() : "—",
  riskLevel: h.riskLevel || "Low",
  lastUpdated: h.updatedAt ? new Date(h.updatedAt).toLocaleDateString() : "—",
});

/**
 * Household Verification (Health Supervisor) — real API.
 *
 * The queue and history come from the households API (barangay scope enforced
 * server-side). Verifying / returning a household persists to the same
 * household row through `householdsApi.update`; the reviewer identity and
 * timestamp are set on the server from the authenticated session, never here.
 */
export default function HouseholdVerifications() {
  const { user } = useAuth();
  const assignedBarangay = getAssignedBarangay(user);
  const reviewerName = (user?.role && ROLES[user.role] && ROLES[user.role].name) || user?.name || "";
  const reviewerRoleLabel = (user?.role && ROLES[user.role] && ROLES[user.role].label) || "Health Supervisor";

  const [households, setHouseholds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [query, setQuery] = useState("");
  const [reviewing, setReviewing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);

  const showToast = (message) => { setToast(message); setTimeout(() => setToast(null), 4000); };

  const load = useCallback(() => {
    setLoading(true);
    setLoadError(null);
    return householdsApi
      .list({ limit: 100 })
      .then((result) => {
        const rows = result?.rows || result || [];
        setHouseholds(rows.map(toRow));
      })
      .catch((err) => setLoadError(err?.message || "Unable to load households. Please try again."))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const pending = useMemo(
    () => households.filter((h) => h.verificationStatus === "Pending Verification"),
    [households]
  );
  const history = useMemo(
    () => households.filter((h) => h.verificationStatus !== "Pending Verification"),
    [households]
  );

  const filtered = pending.filter(
    (h) =>
      h.head.toLowerCase().includes(query.toLowerCase()) ||
      h.householdId.toLowerCase().includes(query.toLowerCase()) ||
      h.ref.toLowerCase().includes(query.toLowerCase())
  );

  const openReview = async (row) => {
    try {
      const result = await householdsApi.get(row.householdId);
      setReviewing(toDrawer(result?.household || result));
    } catch (err) {
      showToast(err?.message || "Could not open the household.");
    }
  };

  const handleDecision = async ({ decision, reason, remarks }) => {
    const record = reviewing;
    if (!record) return;
    const verificationStatus = decision === "approved" ? "Verified" : "Returned for Correction";
    const correctionReason =
      decision === "approved" ? "" : remarks ? `${reason} — ${remarks}` : reason;
    setSaving(true);
    try {
      await householdsApi.update(record.householdId, { verificationStatus, correctionReason });
      setReviewing(null);
      showToast(
        decision === "approved"
          ? `Household ${record.householdId} verified.`
          : `Household ${record.householdId} returned for correction.`
      );
      await load();
    } catch (err) {
      showToast(err?.message || "Could not save the verification decision.");
    } finally {
      setSaving(false);
    }
  };

  const scopeLabel = assignedBarangay ? `in Barangay ${assignedBarangay}` : "in your barangay";

  return (
    <>
      <PageHeader
        crumbs={["Dashboard", "Household Verifications"]}
        title="Household Verification"
        subtitle={`${pending.length} households awaiting verification of profiling information ${scopeLabel}.`}
      />

      {toast && (
        <div className="fixed bottom-4 right-4 z-50 flex animate-in slide-in-from-bottom-2 items-center gap-2 rounded-btn bg-brand-ink px-4 py-3 shadow-lg">
          <CheckCircle2 className="h-4 w-4 text-brand-green" />
          <span className="text-sm text-white">{toast}</span>
        </div>
      )}

      <Card className="overflow-hidden">
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
                    <p className="text-xs text-brand-gray">{h.members} members · {h.families} {h.families === 1 ? "family" : "families"}</p>
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
                      onClick={() => openReview(h)}
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
            <p className="mt-4 text-sm font-medium text-brand-ink">
              {loading ? "Loading households..." : loadError ? "Unable to load households" : "No pending household verifications"}
            </p>
            <p className="text-xs text-brand-gray mt-1">
              {loading ? "Please wait." : loadError ? loadError : "All caught up."}
            </p>
            {loadError && !loading && (
              <button onClick={load} className="mt-4 rounded-btn bg-brand-blue px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark">
                Try Again
              </button>
            )}
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
                <th className="px-6 py-3 font-medium text-brand-gray">Correction Reason</th>
                <th className="px-6 py-3 font-medium text-brand-gray">Review Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-brand-border">
              {history.map((h) => (
                <tr key={h.householdId} className="hover:bg-brand-bg/50 transition-colors">
                  <td className="px-6 py-3.5">
                    <p className="font-medium text-brand-ink">{h.householdId}</p>
                    <p className="text-xs text-brand-gray">Head: {h.head}</p>
                  </td>
                  <td className="px-6 py-3.5">
                    <span className="font-stat font-medium text-brand-ink text-xs">{h.ref}</span>
                  </td>
                  <td className="px-6 py-3.5">
                    <VerificationBadge status={h.verificationStatus === "Verified" ? "verified" : "returned for correction"} size="sm" />
                  </td>
                  <td className="px-6 py-3.5 max-w-xs">
                    <p className="text-sm text-brand-ink">{h.correctionReason || "—"}</p>
                  </td>
                  <td className="px-6 py-3.5 text-sm text-brand-gray whitespace-nowrap">
                    {formatHistoryDate(h.verifiedAt)}
                  </td>
                </tr>
              ))}
              {history.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-6 py-10 text-center text-sm text-brand-gray">
                    No households reviewed yet.
                  </td>
                </tr>
              )}
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
            saving={saving}
            onClose={() => setReviewing(null)}
            onDecision={handleDecision}
          />
        )}
      </AnimatePresence>
    </>
  );
}
