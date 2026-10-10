import React, { useCallback, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import PageHeader from "@/components/common/PageHeader";
import { Card } from "@/components/common/Card";
import VerificationBadge from "@/features/verification/components/VerificationBadge";
import VerificationReviewDrawer from "@/features/verification/components/VerificationReviewDrawer";
import VerificationQueueToolbar from "@/features/verification/components/VerificationQueueToolbar";
import VerificationPagination from "@/features/verification/components/VerificationPagination";
import { SkeletonTable } from "@/components/common/Skeleton";
import {
  approveResident,
  fetchResidentVerification,
  fetchVerificationHistory,
  fetchVerificationQueue,
  rejectResident,
  requestResubmission,
} from "@/services/api/verificationsApi";
import { CheckCircle2, ChevronRight, History } from "lucide-react";

/**
 * Health Supervisor resident-verification page.
 *
 * Pending / Approved / Rejected queues backed by the residents table, plus the
 * recent decision history. Barangay scope is enforced by the server. After an
 * action the queue and history are re-fetched from the API — the UI never
 * assumes the outcome.
 */

const TABS = [
  { key: "pending", label: "Pending" },
  { key: "approved", label: "Approved" },
  { key: "rejected", label: "Rejected" },
  { key: "resubmission_required", label: "Resubmission" },
];
const PAGE_SIZE = 10;

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

export default function PendingVerifications({
  embedded = false,
  onPendingCount,
  pendingCountKey = "resident",
}) {
  const [tab, setTab] = useState("pending");
  const [rows, setRows] = useState([]);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [reviewing, setReviewing] = useState(null);
  const [reviewHistory, setReviewHistory] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState(null);
  const [error, setError] = useState("");
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);

  const loadQueue = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const { rows: data, total: resultTotal } = await fetchVerificationQueue({
        status: tab,
        q: query,
        limit: PAGE_SIZE,
        offset: (page - 1) * PAGE_SIZE,
      });
      setRows(data);
      setTotal(resultTotal);
      if (tab === "pending" && !query.trim()) onPendingCount?.(pendingCountKey, resultTotal);
    } catch (err) {
      setRows([]);
      setTotal(0);
      setError(err?.message || "We could not load the verification queue. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [onPendingCount, page, pendingCountKey, query, tab]);

  const loadHistory = useCallback(async () => {
    try {
      setHistory(await fetchVerificationHistory());
    } catch {
      setHistory([]);
    }
  }, []);

  useEffect(() => {
    loadQueue();
  }, [loadQueue]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  const showToast = (message) => {
    setToast(message);
    window.setTimeout(() => setToast(null), 4000);
  };

  const openReview = async (row) => {
    setReviewing(row);
    setReviewHistory([]);
    try {
      const { verification, history: detailHistory } = await fetchResidentVerification(row.id);
      if (verification) setReviewing(verification);
      setReviewHistory(detailHistory);
    } catch {
      /* keep the row data already shown */
    }
  };

  const afterDecision = async (message) => {
    setReviewing(null);
    setReviewHistory([]);
    await Promise.all([loadQueue(), loadHistory()]);
    showToast(message);
  };

  const runDecision = async (action) => {
    if (!reviewing) return;
    setSubmitting(true);
    setError("");
    try {
      await action();
      await afterDecision(
        tab === "pending" || tab === "resubmission_required"
          ? `Decision recorded for ${reviewing.name}.`
          : `Updated ${reviewing.name}.`,
      );
    } catch (err) {
      setError(err?.message || "The action could not be completed. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const filtered = rows;

  const activeTab = TABS.find((t) => t.key === tab);

  useEffect(() => {
    const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
    if (page > pageCount) setPage(pageCount);
  }, [page, total]);

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
        <div className="fixed bottom-4 right-4 z-50 flex items-center gap-2 rounded-btn bg-brand-ink px-4 py-3 shadow-lg">
          <CheckCircle2 className="h-4 w-4 text-brand-green" />
          <span className="text-sm text-white">{toast}</span>
        </div>
      )}

      {error && (
        <div role="alert" className="mb-4 rounded-btn border border-brand-danger/25 bg-brand-danger/5 px-4 py-3 text-sm text-brand-danger">
          {error}
        </div>
      )}

      <Card className="overflow-hidden">
        <VerificationQueueToolbar
          filters={TABS.map((filter) => ({ value: filter.key, label: filter.label }))}
          status={tab}
          onStatusChange={(value) => { setPage(1); setTab(value); }}
          searchValue={query}
          onSearchChange={(value) => { setPage(1); setQuery(value); }}
          searchPlaceholder="Search residents by name, reference, or barangay"
          resultText={loading ? "Loading…" : `${total} request${total === 1 ? "" : "s"}`}
        />

        <div className="overflow-x-auto">
          {loading ? (
            <SkeletonTable rows={5} cols={6} className="px-6 py-5" />
          ) : (
            <table className="verification-table">
              <thead>
                <tr className="bg-brand-bg text-left">
                  <th scope="col">Applicant</th>
                  <th scope="col">Assignment</th>
                  <th scope="col">Submitted</th>
                  <th scope="col">Reference no.</th>
                  <th scope="col">Status</th>
                  <th scope="col" className="text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r, i) => (
                  <motion.tr
                    key={r.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.04 }}
                    className="transition-colors hover:bg-brand-bg/50"
                  >
                    <td>
                      <div className="flex items-center gap-3">
                        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-light text-xs font-heading font-semibold text-brand-blue">
                          {(r.name || "?").split(" ").map((n) => n[0]).slice(0, 2).join("")}
                        </div>
                        <span className="font-medium text-brand-ink">{r.name}</span>
                      </div>
                    </td>
                    <td className="text-brand-gray">{r.barangay}</td>
                    <td className="whitespace-nowrap text-brand-gray">{formatDate(r.submittedAt)}</td>
                    <td>
                      <span className="font-stat text-xs font-medium text-brand-ink">{r.ref}</span>
                    </td>
                    <td>
                      <VerificationBadge status={r.status} size="sm" />
                    </td>
                    <td className="text-right">
                      <button
                        type="button"
                        onClick={() => openReview(r)}
                        className="inline-flex items-center gap-1.5 rounded-btn px-1.5 py-1 text-sm font-medium text-brand-blue hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue"
                      >
                        Review <ChevronRight className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {!loading && filtered.length === 0 && (
          <div className="px-6 py-16 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-brand-bg">
              <CheckCircle2 className="h-7 w-7 text-brand-gray" strokeWidth={1.5} />
            </div>
            <p className="mt-4 text-sm font-medium text-brand-ink">No {activeTab?.label.toLowerCase()} residents</p>
            <p className="mt-1 text-xs text-brand-gray">Nothing to show for this filter.</p>
          </div>
        )}
        <VerificationPagination
          page={page}
          pageCount={Math.ceil(total / PAGE_SIZE)}
          total={total}
          onPageChange={setPage}
        />
      </Card>

      {/* Decision history */}
      <Card className="mt-6 overflow-hidden">
        <div className="flex items-center gap-2 border-b border-brand-border px-6 py-4">
          <History className="h-4 w-4 text-brand-blue" strokeWidth={1.8} />
          <h3 className="font-heading text-sm font-semibold text-brand-ink">Recent Decisions</h3>
          <span className="ml-auto text-xs text-brand-gray">{history.length} recorded</span>
        </div>
        <div className="overflow-x-auto">
          <table className="verification-table">
            <thead>
              <tr className="bg-brand-bg text-left">
                <th className="px-6 py-3 font-medium text-brand-gray">Resident</th>
                <th className="px-6 py-3 font-medium text-brand-gray">Action</th>
                <th className="px-6 py-3 font-medium text-brand-gray">Reason</th>
                <th className="px-6 py-3 font-medium text-brand-gray">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-brand-border">
              {history.map((h) => (
                <tr key={h.id} className="transition-colors hover:bg-brand-bg/50">
                  <td className="px-6 py-3.5">
                    <p className="font-medium text-brand-ink">{h.residentName || h.residentRef}</p>
                    <p className="text-xs text-brand-gray">Barangay {h.barangay}</p>
                  </td>
                  <td className="px-6 py-3.5">
                    <VerificationBadge status={h.newStatus} size="sm" />
                  </td>
                  <td className="max-w-xs px-6 py-3.5 text-sm text-brand-ink">{h.reason || "—"}</td>
                  <td className="whitespace-nowrap px-6 py-3.5 text-sm text-brand-gray">{formatDateTime(h.createdAt)}</td>
                </tr>
              ))}
              {history.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-6 py-10 text-center text-sm text-brand-gray">
                    No decisions recorded yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <AnimatePresence>
        {reviewing && (
          <VerificationReviewDrawer
            verification={reviewing}
            history={reviewHistory}
            submitting={submitting}
            onClose={() => {
              if (submitting) return;
              setReviewing(null);
              setReviewHistory([]);
            }}
            onApprove={() => runDecision(() => approveResident(reviewing.id, {}))}
            onReject={({ reason, remarks }) => runDecision(() => rejectResident(reviewing.id, { reason, remarks }))}
            onRequestResubmission={({ reason, remarks }) =>
              runDecision(() => requestResubmission(reviewing.id, { reason, remarks }))
            }
          />
        )}
      </AnimatePresence>
    </>
  );
}
