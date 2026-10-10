import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Card } from "@/components/common/Card";
import { Inbox, RefreshCw, CheckCircle2, X, FileText } from "lucide-react";
import { usePermissions } from "@/context/PermissionsContext";
import { reportsApi } from "@/services/api";

/**
 * Incoming Reports — the recipient side of the report submission workflow.
 *
 * Loads the reports routed to the authenticated recipient's role + scope from
 * the backend (GET /api/reports?box=incoming). Nothing is read from local or
 * session storage; every row is a persisted, server-scoped report. The
 * recipient can mark a report Received / Reviewed / Rejected.
 */

const ROLE_LABELS = {
  phn: "Public Health Nurse",
  mho: "Municipal Health Officer",
  health_supervisor: "Health Supervisor",
  rhu_personnel: "RHU Personnel",
  bhw: "Barangay Health Worker",
};

const STATUS_TONE = {
  Submitted: "bg-brand-blue/10 text-brand-blue",
  Received: "bg-brand-yellow/15 text-[#B07E00]",
  Reviewed: "bg-brand-green/10 text-brand-green",
  Rejected: "bg-brand-danger/10 text-brand-danger",
  Draft: "bg-brand-gray/10 text-brand-gray",
};

const formatDateTime = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-US", { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
};

export default function IncomingReports() {
  const { can } = usePermissions();
  // Reviewing an incoming report is a RECIPIENT action, gated by reports.view
  // (not reports.generate) so the RHU Personnel inbox can acknowledge/review
  // without being granted report authoring.
  const canReview = can("reports.view");
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [detail, setDetail] = useState(null);
  const [busy, setBusy] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [toast, setToast] = useState(null);

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const load = useCallback(() => {
    setLoading(true);
    setError("");
    return reportsApi
      .list({ box: "incoming" })
      .then((res) => setRows(res?.rows || res?.records || []))
      .catch((err) => setError(err?.message || "We couldn't load incoming reports. Please try again."))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const sortedRows = useMemo(
    () => [...rows].sort((a, b) => String(b.submittedAt || b.createdAt || "").localeCompare(String(a.submittedAt || a.createdAt || ""))),
    [rows]
  );

  const act = async (report, status) => {
    if (!canReview) return;
    if (status === "Rejected" && !rejectReason.trim()) {
      showToast("A reason is required to reject a report.");
      return;
    }
    setBusy(true);
    try {
      await reportsApi.review(report.id, { status, remarks: rejectReason.trim() });
      showToast(`Report marked ${status}.`);
      setDetail(null);
      setRejectReason("");
      await load();
    } catch (err) {
      showToast(err?.message || "The report could not be updated.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="overflow-hidden">
      {toast && (
        <div className="fixed bottom-4 right-4 z-[80] flex items-center gap-2 rounded-btn bg-brand-ink px-4 py-3 text-white shadow-lg">
          <CheckCircle2 className="h-4 w-4 text-brand-green" />
          <span className="text-sm">{toast}</span>
        </div>
      )}

      <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-5 py-4 dark:border-border">
        <div className="flex items-center gap-2">
          <Inbox className="h-4 w-4 text-brand-blue" />
          <h3 className="text-sm font-semibold text-brand-ink sm:text-base">Incoming Reports</h3>
          {!loading && <span className="text-xs text-brand-gray">{sortedRows.length} report{sortedRows.length === 1 ? "" : "s"}</span>}
        </div>
        <button
          onClick={load}
          className="inline-flex items-center gap-2 rounded-btn border border-brand-border px-3 py-1.5 text-xs font-medium text-brand-ink transition-colors hover:border-brand-blue hover:text-brand-blue"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
        </button>
      </div>

      {error ? (
        <div className="px-5 py-10 text-center">
          <p className="text-sm font-medium text-brand-danger">{error}</p>
          <button onClick={load} className="mt-3 inline-flex items-center gap-2 rounded-btn border border-brand-border px-4 py-2 text-sm font-medium text-brand-ink hover:border-brand-blue hover:text-brand-blue">
            <RefreshCw className="h-4 w-4" /> Retry
          </button>
        </div>
      ) : loading ? (
        <p className="px-5 py-12 text-center text-sm text-brand-gray">Loading incoming reports…</p>
      ) : sortedRows.length === 0 ? (
        <div className="px-5 py-12 text-center">
          <FileText className="mx-auto h-8 w-8 text-brand-gray/50" />
          <p className="mt-3 text-sm font-medium text-brand-ink">No incoming reports</p>
          <p className="mt-1 text-xs text-brand-gray">Reports submitted to you will appear here.</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="bg-brand-bg text-left">
                {["Report Type", "Period", "From", "Submitted", "Status", ""].map((h) => (
                  <th key={h} className="px-5 py-3 font-medium text-brand-gray">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-border">
              {sortedRows.map((r) => (
                <tr key={r.id} className="hover:bg-brand-bg/50">
                  <td className="px-5 py-3 font-medium text-brand-ink">{r.reportType}{r.title ? ` — ${r.title}` : ""}</td>
                  <td className="px-5 py-3 text-brand-gray">{r.reportPeriod || "—"}</td>
                  <td className="px-5 py-3">
                    <p className="text-brand-ink">{r.senderName || "—"}</p>
                    <p className="text-xs text-brand-gray">{ROLE_LABELS[r.senderRole] || r.senderRole}{r.barangay ? ` · ${r.barangay}` : ""}</p>
                  </td>
                  <td className="whitespace-nowrap px-5 py-3 text-brand-gray">{formatDateTime(r.submittedAt || r.createdAt)}</td>
                  <td className="px-5 py-3">
                    <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_TONE[r.status] || "bg-brand-gray/10 text-brand-gray"}`}>{r.status}</span>
                  </td>
                  <td className="px-5 py-3 text-right">
                    <button onClick={() => { setDetail(r); setRejectReason(""); }} className="text-sm font-medium text-brand-blue hover:underline">Open</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {detail && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4">
          <Card className="max-h-[92vh] w-full max-w-lg overflow-y-auto">
            <div className="p-6">
              <div className="mb-4 flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-lg font-semibold text-brand-ink">{detail.reportType}</h3>
                  <p className="mt-0.5 text-sm text-brand-gray">{detail.reportPeriod || "No period"}</p>
                </div>
                <button onClick={() => setDetail(null)} className="text-brand-gray hover:text-brand-ink" aria-label="Close"><X className="h-5 w-5" /></button>
              </div>

              <div className="space-y-2.5 rounded-2xl border border-slate-200 bg-white p-4 dark:border-border dark:bg-card">
                {[
                  ["From", `${detail.senderName || "—"} (${ROLE_LABELS[detail.senderRole] || detail.senderRole})`],
                  ["Barangay", detail.barangay || "—"],
                  ["Submitted", formatDateTime(detail.submittedAt || detail.createdAt)],
                  ["Status", detail.status],
                  ["Remarks", detail.remarks || "—"],
                ].map(([label, value]) => (
                  <div key={label} className="flex items-start justify-between gap-3 text-sm">
                    <p className="shrink-0 text-brand-gray">{label}</p>
                    <p className="min-w-0 text-right font-medium text-brand-ink">{value}</p>
                  </div>
                ))}
              </div>

              {canReview && detail.status !== "Reviewed" && detail.status !== "Rejected" && (
                <div className="mt-4">
                  <label className="text-sm font-medium text-brand-ink">Remarks / Reason (required to reject)</label>
                  <textarea
                    rows={3}
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                    placeholder="Optional remarks, or the reason when rejecting…"
                    className="mt-1.5 w-full resize-none rounded-btn border border-slate-200 bg-white px-3.5 py-2.5 text-sm outline-none focus:border-brand-blue dark:border-border dark:bg-input dark:text-foreground"
                  />
                </div>
              )}

              <div className="mt-6 flex flex-wrap justify-end gap-3 border-t border-slate-200 pt-4 dark:border-border">
                <button onClick={() => setDetail(null)} className="rounded-btn px-4 py-2 text-sm font-medium text-brand-gray hover:bg-brand-bg dark:hover:bg-hover">Close</button>
                {detail.status !== "Reviewed" && detail.status !== "Rejected" && (
                  <>
                    {detail.status === "Submitted" && (
                      <button disabled={busy} onClick={() => act(detail, "Received")} className="rounded-btn border border-brand-border px-4 py-2 text-sm font-medium text-brand-ink hover:border-brand-blue hover:text-brand-blue disabled:opacity-60">Mark Received</button>
                    )}
                    <button disabled={busy} onClick={() => act(detail, "Rejected")} className="rounded-btn border border-brand-danger/30 px-4 py-2 text-sm font-medium text-brand-danger hover:bg-brand-danger/5 disabled:opacity-60">Reject</button>
                    <button disabled={busy} onClick={() => act(detail, "Reviewed")} className="rounded-btn bg-brand-blue px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-60">Mark Reviewed</button>
                  </>
                )}
              </div>
            </div>
          </Card>
        </div>
      )}
    </Card>
  );
}
