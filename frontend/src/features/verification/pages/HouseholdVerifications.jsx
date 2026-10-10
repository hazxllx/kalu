import React, { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import PageHeader from "@/components/common/PageHeader";
import { Card } from "@/components/common/Card";
import { SkeletonTable } from "@/components/common/Skeleton";
import VerificationBadge from "@/features/verification/components/VerificationBadge";
import VerificationQueueToolbar from "@/features/verification/components/VerificationQueueToolbar";
import VerificationPagination from "@/features/verification/components/VerificationPagination";
import HouseholdVerificationReviewDrawer from "@/features/verification/components/HouseholdVerificationReviewDrawer";
import { useAuth } from "@/context/AuthContext";
import { householdsApi } from "@/services/api";
import { ROLES } from "@/lib/brand";
import { CheckCircle2, ChevronRight, History, Home } from "lucide-react";

const PAGE_SIZE = 10;
const HOUSEHOLD_STATUS_FILTERS = [
  { value: "pending", label: "Pending", match: "Pending Verification" },
  { value: "approved", label: "Approved", match: "Verified" },
  { value: "resubmission_required", label: "Resubmission", match: "Returned for Correction" },
];

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
  createdAt: h.createdAt || "",
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
export default function HouseholdVerifications({
  embedded = false,
  onPendingCount,
  pendingCountKey = "household",
}) {
  const { user } = useAuth();
  const reviewerName = (user?.role && ROLES[user.role] && ROLES[user.role].name) || user?.name || "";
  const reviewerRoleLabel = (user?.role && ROLES[user.role] && ROLES[user.role].label) || "Health Supervisor";

  const [households, setHouseholds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("pending");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);
  const [reviewing, setReviewing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);

  const showToast = (message) => { setToast(message); setTimeout(() => setToast(null), 4000); };

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const firstPage = await householdsApi.list({ limit: 100, offset: 0 });
      const rows = [...(firstPage?.rows || firstPage || [])];
      const total = Number(firstPage?.total) || rows.length;
      for (let offset = rows.length; offset < total; offset += 100) {
        const nextPage = await householdsApi.list({ limit: 100, offset });
        const nextRows = nextPage?.rows || nextPage || [];
        if (!nextRows.length) break;
        rows.push(...nextRows);
      }
      const mappedRows = rows.map(toRow);
      setHouseholds(mappedRows);
      onPendingCount?.(
        pendingCountKey,
        mappedRows.filter((household) => household.verificationStatus === "Pending Verification").length,
      );
    } catch (err) {
      setLoadError(err?.message || "Unable to load households. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [onPendingCount, pendingCountKey]);

  useEffect(() => { load(); }, [load]);

  const history = useMemo(
    () => households.filter((h) => h.verificationStatus !== "Pending Verification"),
    [households]
  );

  const filtered = useMemo(() => {
    const selectedStatus = HOUSEHOLD_STATUS_FILTERS.find((filter) => filter.value === statusFilter);
    const normalizedQuery = query.trim().toLowerCase();
    return households.filter((household) => {
      if (household.verificationStatus !== selectedStatus?.match) return false;
      if (
        normalizedQuery &&
        ![household.head, household.householdId, household.ref, household.barangay]
          .some((value) => String(value || "").toLowerCase().includes(normalizedQuery))
      ) return false;
      if (dateFrom && (!household.createdAt || household.createdAt.slice(0, 10) < dateFrom)) return false;
      if (dateTo && (!household.createdAt || household.createdAt.slice(0, 10) > dateTo)) return false;
      return true;
    });
  }, [dateFrom, dateTo, households, query, statusFilter]);
  const pageRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  useEffect(() => {
    const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    if (page > pageCount) setPage(pageCount);
  }, [filtered.length, page]);

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

  return (
    <>
      {!embedded && (
        <PageHeader
          eyebrow="Administration"
          title="Verifications & Approvals"
          subtitle="Review resident, household, and BHW requests in one place."
        />
      )}

      {toast && (
        <div className="fixed bottom-4 right-4 z-50 flex animate-in slide-in-from-bottom-2 items-center gap-2 rounded-btn bg-brand-ink px-4 py-3 shadow-lg">
          <CheckCircle2 className="h-4 w-4 text-brand-green" />
          <span className="text-sm text-white">{toast}</span>
        </div>
      )}

      <Card className="overflow-hidden">
        <VerificationQueueToolbar
          filters={HOUSEHOLD_STATUS_FILTERS}
          status={statusFilter}
          onStatusChange={(value) => { setPage(1); setStatusFilter(value); }}
          searchValue={query}
          onSearchChange={(value) => { setPage(1); setQuery(value); }}
          searchPlaceholder="Search households by head, ID, or barangay"
          resultText={loading ? "Loading…" : `${filtered.length} household${filtered.length === 1 ? "" : "s"}`}
        >
          <label className="sr-only" htmlFor="household-date-from">Submitted from</label>
          <input
            id="household-date-from"
            type="date"
            value={dateFrom}
            onChange={(event) => { setPage(1); setDateFrom(event.target.value); }}
            aria-label="Submitted from"
            className="h-10 rounded-input border border-brand-border bg-white px-3 text-[13px] text-brand-ink focus:border-brand-blue focus:outline-none dark:border-border dark:bg-input dark:text-foreground"
          />
          <label className="sr-only" htmlFor="household-date-to">Submitted through</label>
          <input
            id="household-date-to"
            type="date"
            value={dateTo}
            onChange={(event) => { setPage(1); setDateTo(event.target.value); }}
            aria-label="Submitted through"
            className="h-10 rounded-input border border-brand-border bg-white px-3 text-[13px] text-brand-ink focus:border-brand-blue focus:outline-none dark:border-border dark:bg-input dark:text-foreground"
          />
        </VerificationQueueToolbar>

        <div className="overflow-x-auto">
          {loading ? (
            <SkeletonTable rows={5} cols={6} className="px-4 py-5" />
          ) : (
          <table className="verification-table">
            <thead>
              <tr>
                <th scope="col">Household ID</th>
                <th scope="col">Representative</th>
                <th scope="col">Assignment</th>
                <th scope="col">Submitted</th>
                <th scope="col">Status</th>
                <th scope="col" className="text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((h, i) => (
                <motion.tr
                  key={h.householdId}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.05 }}
                  className="hover:bg-brand-bg/50 transition-colors"
                >
                  <td>
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-full bg-brand-blue/10 text-brand-blue flex items-center justify-center">
                        <Home className="w-4 h-4" />
                      </div>
                      <div>
                        <p className="font-medium text-brand-ink">{h.householdId}</p>
                        <p className="text-xs text-brand-gray">{h.members} members · {h.families} {h.families === 1 ? "family" : "families"}</p>
                      </div>
                    </div>
                  </td>
                  <td>
                    <p className="font-medium text-brand-ink">{h.head}</p>
                  </td>
                  <td className="text-brand-gray">{h.barangay || "—"}</td>
                  <td className="whitespace-nowrap text-brand-gray">{h.createdAt ? new Date(h.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—"}</td>
                  <td>
                    <VerificationBadge
                      status={
                        h.verificationStatus === "Verified"
                          ? "approved"
                          : h.verificationStatus === "Returned for Correction"
                            ? "resubmission_required"
                            : "pending"
                      }
                      size="sm"
                    />
                  </td>
                  <td className="text-right">
                    {h.verificationStatus === "Pending Verification" ? <button
                      type="button"
                      onClick={() => openReview(h)}
                      className="inline-flex items-center gap-1.5 rounded-btn px-1.5 py-1 text-sm font-medium text-brand-blue hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue"
                    >
                      Review <ChevronRight className="w-3.5 h-3.5" />
                    </button> : <span className="text-xs text-brand-gray">Reviewed</span>}
                  </td>
                </motion.tr>
              ))}
            </tbody>
          </table>
          )}
        </div>

        {filtered.length === 0 && (
          <div className="px-6 py-16 text-center">
            <div className="w-14 h-14 rounded-full bg-brand-bg flex items-center justify-center mx-auto">
              <Home className="w-7 h-7 text-brand-gray" strokeWidth={1.5} />
            </div>
            <p className="mt-4 text-sm font-medium text-brand-ink">
              {loading ? "Loading households..." : loadError ? "Unable to load households" : `No ${HOUSEHOLD_STATUS_FILTERS.find((filter) => filter.value === statusFilter)?.label.toLowerCase()} household verifications`}
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
        <VerificationPagination
          page={page}
          pageCount={Math.ceil(filtered.length / PAGE_SIZE)}
          total={filtered.length}
          onPageChange={setPage}
        />
      </Card>

      {/* Verification history */}
      <Card className="mt-6 overflow-hidden">
        <div className="flex items-center gap-2 border-b border-brand-border px-6 py-4">
          <History className="w-4 h-4 text-brand-blue" strokeWidth={1.8} />
          <h3 className="font-heading font-semibold text-brand-ink text-sm">Verification History</h3>
          <span className="ml-auto text-xs text-brand-gray">{history.length} reviewed</span>
        </div>
        <div className="overflow-x-auto">
          <table className="verification-table">
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
