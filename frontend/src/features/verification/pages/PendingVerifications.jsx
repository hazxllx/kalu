import React, { useCallback, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import PageHeader from "@/components/common/PageHeader";
import { Card } from "@/components/common/Card";
import VerificationBadge from "@/features/verification/components/VerificationBadge";
import VerificationReviewDrawer from "@/features/verification/components/VerificationReviewDrawer";
import { SkeletonTable } from "@/components/common/Skeleton";
import {
  approveResident,
  fetchResidentVerification,
  fetchVerificationHistory,
  fetchVerificationQueue,
  rejectResident,
  requestResubmission,
} from "@/services/api/verificationsApi";
import { CheckCircle2, ChevronRight, History, Search } from "lucide-react";

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

export default function PendingVerifications() {
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

  const loadQueue = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const { rows: data } = await fetchVerificationQueue({ status: tab });
      setRows(data);
    } catch (err) {
      setRows([]);
      setError(err?.message || "We could not load the verification queue. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [tab]);

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

  const filtered = rows.filter((r) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return (
      String(r.name || "").toLowerCase().includes(q) ||
      String(r.ref || "").toLowerCase().includes(q) ||
      String(r.barangay || "").toLowerCase().includes(q)
    );
  });

  const activeTab = TABS.find((t) => t.key === tab);

  return (
    <>
      <PageHeader
        crumbs={["Dashboard", "Resident Verifications"]}
        title="Resident Verifications"
        subtitle="Review resident registrations and record an approval or rejection."
      />

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
        {/* Tabs + search */}
        <div className="flex flex-col gap-3 border-b border-brand-border px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap gap-1.5">
            {TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors ${
                  tab === t.key ? "bg-brand-blue text-white" : "bg-brand-bg text-brand-gray hover:text-brand-ink"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className="flex max-w-sm items-center gap-2 rounded-input border border-brand-border bg-brand-bg px-3.5 py-2.5">
            <Search className="h-4 w-4 text-brand-gray" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name, reference or barangay..."
              className="w-full bg-transparent text-sm outline-none placeholder:text-brand-gray/70"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          {loading ? (
            <SkeletonTable rows={5} cols={6} className="px-6 py-5" />
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-brand-bg text-left">
                  <th className="px-6 py-3 font-medium text-brand-gray">Resident</th>
                  <th className="px-6 py-3 font-medium text-brand-gray">Barangay</th>
                  <th className="px-6 py-3 font-medium text-brand-gray">Submitted</th>
                  <th className="px-6 py-3 font-medium text-brand-gray">Reference</th>
                  <th className="px-6 py-3 font-medium text-brand-gray">Status</th>
                  <th className="px-6 py-3 text-right font-medium text-brand-gray">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-brand-border">
                {filtered.map((r, i) => (
                  <motion.tr
                    key={r.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.04 }}
                    className="transition-colors hover:bg-brand-bg/50"
                  >
                    <td className="px-6 py-3.5">
                      <div className="flex items-center gap-3">
                        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-light text-xs font-heading font-semibold text-brand-blue">
                          {(r.name || "?").split(" ").map((n) => n[0]).slice(0, 2).join("")}
                        </div>
                        <span className="font-medium text-brand-ink">{r.name}</span>
                      </div>
                    </td>
                    <td className="px-6 py-3.5 text-brand-gray">{r.barangay}</td>
                    <td className="px-6 py-3.5 text-brand-gray">{formatDate(r.submittedAt)}</td>
                    <td className="px-6 py-3.5">
                      <span className="font-stat text-xs font-medium text-brand-ink">{r.ref}</span>
                    </td>
                    <td className="px-6 py-3.5">
                      <VerificationBadge status={r.status} size="sm" />
                    </td>
                    <td className="px-6 py-3.5 text-right">
                      <button
                        onClick={() => openReview(r)}
                        className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-blue hover:underline"
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
      </Card>

      {/* Decision history */}
      <Card className="mt-6 overflow-hidden">
        <div className="flex items-center gap-2 border-b border-brand-border px-6 py-4">
          <History className="h-4 w-4 text-brand-blue" strokeWidth={1.8} />
          <h3 className="font-heading text-sm font-semibold text-brand-ink">Recent Decisions</h3>
          <span className="ml-auto text-xs text-brand-gray">{history.length} recorded</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
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
