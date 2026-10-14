import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Card } from "@/components/common/Card";
import { Inbox, RefreshCw, CheckCircle2, X } from "lucide-react";
import { usePermissions } from "@/context/PermissionsContext";
import { useAuth } from "@/context/AuthContext";
import { reportsApi } from "@/services/api";
import ReportSnapshotView from "@/features/reports/components/ReportSnapshotView";

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
  "Pending Review": "bg-brand-yellow/15 text-[#B07E00]",
  "Needs Revision": "bg-brand-danger/10 text-brand-danger",
  Approved: "bg-brand-green/10 text-brand-green",
  Rejected: "bg-brand-danger/10 text-brand-danger",
  Draft: "bg-brand-gray/10 text-brand-gray",
};
const STATUS_ORDER = ["Pending Review", "Needs Revision", "Approved", "Rejected", "Draft"];

const displayStatus = (status) => {
  if (status === "Submitted" || status === "Received") return "Pending Review";
  if (status === "Reviewed") return "Approved";
  return status || "Unknown";
};

const formatDateTime = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-US", { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
};

export default function IncomingReports() {
  const { can } = usePermissions();
  const { user } = useAuth();
  // Reviewing an incoming report is a RECIPIENT action, gated by reports.view
  // (not reports.generate) so the RHU Personnel inbox can acknowledge/review
  // without being granted report authoring.
  const canReview = can("reports.view");
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [detail, setDetail] = useState(null);
  // The persisted snapshot for the opened report, fetched on demand so the
  // recipient sees the EXACT submitted content, not a live reconstruction.
  const [detailContent, setDetailContent] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [busy, setBusy] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [typeFilter, setTypeFilter] = useState("All");
  const [barangayFilter, setBarangayFilter] = useState("All");
  const [periodFilter, setPeriodFilter] = useState("All");
  const [search, setSearch] = useState("");
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

  // Load the full persisted snapshot whenever a report is opened. Legacy rows
  // return hasContent=false so the modal shows an explicit unavailable state.
  useEffect(() => {
    if (!detail?.id) {
      setDetailContent(null);
      setDetailError("");
      setDetailLoading(false);
      return undefined;
    }
    let active = true;
    setDetailLoading(true);
    setDetailError("");
    setDetailContent(null);
    reportsApi.get(detail.id)
      .then((res) => { if (active) setDetailContent(res?.record || null); })
      .catch((err) => { if (active) setDetailError(err?.message || "Could not load the submitted report."); })
      .finally(() => { if (active) setDetailLoading(false); });
    return () => { active = false; };
  }, [detail]);

  const sortedRows = useMemo(
    () => [...rows].sort((a, b) => String(b.submittedAt || b.createdAt || "").localeCompare(String(a.submittedAt || a.createdAt || ""))),
    [rows]
  );
  const reportTypes = useMemo(
    () => [...new Set(sortedRows.map((row) => row.reportType).filter(Boolean))].sort(),
    [sortedRows]
  );
  const barangays = useMemo(
    () => [...new Set(sortedRows.map((row) => row.barangay).filter(Boolean))].sort(),
    [sortedRows]
  );
  const periods = useMemo(
    () => [...new Set(sortedRows.map((row) => row.reportPeriod).filter(Boolean))].sort().reverse(),
    [sortedRows]
  );
  const visibleRows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return sortedRows.filter((row) => {
      if (statusFilter !== "All" && displayStatus(row.status) !== statusFilter) return false;
      if (typeFilter !== "All" && row.reportType !== typeFilter) return false;
      if (barangayFilter !== "All" && row.barangay !== barangayFilter) return false;
      if (periodFilter !== "All" && row.reportPeriod !== periodFilter) return false;
      if (!term) return true;
      return [row.reportType, row.title, row.reportPeriod, row.senderName, row.senderRole, row.barangay]
        .filter(Boolean).join(" ").toLowerCase().includes(term);
    });
  }, [barangayFilter, periodFilter, search, sortedRows, statusFilter, typeFilter]);

  const act = async (report, status) => {
    if (!canReview || user?.role !== report.recipientRole) return;
    if (["Needs Revision", "Rejected"].includes(status) && !rejectReason.trim()) {
      showToast("An explanation is required.");
      return;
    }
    setBusy(true);
    try {
      await reportsApi.review(report.id, { status, remarks: rejectReason.trim() });
      showToast(status === "Reviewed" ? "Report approved." : status === "Needs Revision" ? "Report returned for revision." : `Report marked ${status}.`);
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
          <h3 className="text-sm font-semibold text-brand-ink sm:text-base">{user?.role === "mho" ? "Municipal Report Inbox" : "Incoming Reports"}</h3>
          {!loading && <span className="text-xs text-brand-gray">{visibleRows.length} of {sortedRows.length} reports</span>}
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
      ) : (
        <>
        <div className={`grid gap-3 border-b border-slate-200 p-4 sm:grid-cols-2 dark:border-border ${user?.role === "mho" ? "lg:grid-cols-5" : "lg:grid-cols-4"}`}>
          {user?.role === "mho" && (
            <div className="rounded-xl border border-brand-border bg-brand-bg/60 px-3 py-2">
              <span className="block text-xs text-brand-gray">Total Reports Expected</span>
              <span className="font-stat text-lg font-bold text-brand-ink">—</span>
              <span className="block text-[11px] leading-snug text-brand-gray">No reporting schedule is configured.</span>
            </div>
          )}
          {user?.role === "mho" && (
            <div className="rounded-xl border border-brand-border bg-brand-bg/60 px-3 py-2">
              <span className="block text-xs text-brand-gray">Not Submitted</span>
              <span className="font-stat text-lg font-bold text-brand-ink">—</span>
              <span className="block text-[11px] leading-snug text-brand-gray">Expected reports cannot be calculated without a schedule.</span>
            </div>
          )}
          {STATUS_ORDER.map((status) => (
            status === "Draft" || status === "Rejected" ? null : (
            <button
              key={status}
              onClick={() => setStatusFilter(statusFilter === status ? "All" : status)}
              className={`rounded-xl border px-3 py-2 text-left transition-colors ${statusFilter === status ? "border-brand-blue bg-brand-blue/5" : "border-brand-border hover:border-brand-blue/40"}`}
            >
              <span className="block text-xs text-brand-gray">{status}</span>
              <span className="font-stat text-lg font-bold text-brand-ink">{sortedRows.filter((row) => displayStatus(row.status) === status).length}</span>
            </button>
            )
          ))}
        </div>
        <div className="flex flex-col gap-3 border-b border-slate-200 p-4 sm:flex-row sm:flex-wrap dark:border-border">
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search type, sender, barangay, or period"
            aria-label="Search incoming reports"
            className="min-w-0 flex-1 rounded-btn border border-brand-border bg-white px-3 py-2 text-sm outline-none focus:border-brand-blue dark:bg-card"
          />
          <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)} aria-label="Filter report type" className="rounded-btn border border-brand-border bg-white px-3 py-2 text-sm dark:bg-card">
            <option value="All">All report types</option>
            {reportTypes.map((type) => <option key={type} value={type}>{type}</option>)}
          </select>
          <select value={barangayFilter} onChange={(event) => setBarangayFilter(event.target.value)} aria-label="Filter report barangay" className="rounded-btn border border-brand-border bg-white px-3 py-2 text-sm dark:bg-card">
            <option value="All">All barangays / facilities</option>
            {barangays.map((barangay) => <option key={barangay} value={barangay}>{barangay}</option>)}
          </select>
          <select value={periodFilter} onChange={(event) => setPeriodFilter(event.target.value)} aria-label="Filter reporting period" className="rounded-btn border border-brand-border bg-white px-3 py-2 text-sm dark:bg-card">
            <option value="All">All reporting periods</option>
            {periods.map((period) => <option key={period} value={period}>{period}</option>)}
          </select>
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} aria-label="Filter report status" className="rounded-btn border border-brand-border bg-white px-3 py-2 text-sm dark:bg-card">
            <option value="All">All statuses</option>
            {STATUS_ORDER.map((status) => <option key={status} value={status}>{status}</option>)}
          </select>
        </div>
        {visibleRows.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-brand-gray">
            {sortedRows.length === 0 ? "No incoming reports have been submitted." : "No reports match these filters."}
          </p>
        ) : <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="bg-brand-bg text-left">
                {["Report Type", "Barangay / facility", "Period", "From", "Updated", "Submitted", "Status", ""].map((h) => (
                  <th key={h} className="px-5 py-3 font-medium text-brand-gray">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-border">
              {visibleRows.map((r) => (
                <tr key={r.id} className="hover:bg-brand-bg/50">
                  <td className="px-5 py-3 font-medium text-brand-ink">{r.reportType}{r.title ? ` — ${r.title}` : ""}</td>
                  <td className="px-5 py-3 text-brand-gray">{r.barangay || "—"}</td>
                  <td className="px-5 py-3 text-brand-gray">{r.reportPeriod || "—"}</td>
                  <td className="px-5 py-3">
                    <p className="text-brand-ink">{r.senderName || "—"}</p>
                    <p className="text-xs text-brand-gray">{ROLE_LABELS[r.senderRole] || r.senderRole}{r.barangay ? ` · ${r.barangay}` : ""}</p>
                  </td>
                  <td className="whitespace-nowrap px-5 py-3 text-brand-gray">{formatDateTime(r.updatedAt || r.createdAt)}</td>
                  <td className="whitespace-nowrap px-5 py-3 text-brand-gray">{formatDateTime(r.submittedAt)}</td>
                  <td className="px-5 py-3">
                    <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_TONE[displayStatus(r.status)] || "bg-brand-gray/10 text-brand-gray"}`}>{displayStatus(r.status)}</span>
                  </td>
                  <td className="px-5 py-3 text-right">
                    <button onClick={() => { setDetail(r); setRejectReason(""); }} className="text-sm font-medium text-brand-blue hover:underline">Open</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>}
        </>
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
                  ["Status", displayStatus(detail.status)],
                  ["Workflow stage", detail.status],
                  ["Last updated", formatDateTime(detail.updatedAt || detail.createdAt)],
                  ["Remarks", ["Rejected", "Needs Revision"].includes(detail.status) ? "—" : detail.remarks || "—"],
                  ["Revision / rejection explanation", ["Rejected", "Needs Revision"].includes(detail.status) ? detail.remarks || "—" : "—"],
                ].map(([label, value]) => (
                  <div key={label} className="flex items-start justify-between gap-3 text-sm">
                    <p className="shrink-0 text-brand-gray">{label}</p>
                    <p className="min-w-0 text-right font-medium text-brand-ink">{value}</p>
                  </div>
                ))}
              </div>

              {detailContent?.history?.length > 0 && (
                <div className="mt-4">
                  <h4 className="mb-2 text-sm font-semibold text-brand-ink">Report history</h4>
                  <ol className="space-y-2 border-l-2 border-brand-border pl-4">
                    {detailContent.history.map((event, index) => (
                      <li key={`${event.at}-${index}`} className="text-sm">
                        <p className="font-medium text-brand-ink">{event.previousStatus ? `${event.previousStatus} → ` : ""}{event.status}</p>
                        <p className="text-xs text-brand-gray">{formatDateTime(event.at)}{event.actorName ? ` · ${event.actorName}` : ""}{event.actorRole ? ` (${ROLE_LABELS[event.actorRole] || event.actorRole})` : ""}</p>
                        {event.explanation && <p className="mt-1 text-xs text-brand-gray">{event.explanation}</p>}
                      </li>
                    ))}
                  </ol>
                </div>
              )}

              {/* Full submitted report — the exact snapshot persisted at
                  submission, retrieved by id (never regenerated from live data). */}
              <div className="mt-4">
                <h4 className="mb-2 text-sm font-semibold text-brand-ink">Submitted Report</h4>
                {detailLoading ? (
                  <p className="inline-flex items-center gap-2 text-sm text-brand-gray">
                    <RefreshCw className="h-4 w-4 animate-spin" /> Loading submitted report…
                  </p>
                ) : detailError ? (
                  <div className="rounded-btn border border-brand-danger/30 bg-brand-danger/5 p-4 text-sm text-brand-danger">
                    {detailError}
                  </div>
                ) : (
                  <ReportSnapshotView content={detailContent?.content} />
                )}
              </div>

              {canReview && user?.role === detail.recipientRole && detail.status === "Received" && (
                <div className="mt-4">
                  <label className="text-sm font-medium text-brand-ink">Explanation (required for revision or rejection)</label>
                  <textarea
                    rows={3}
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                    placeholder="Explain the required corrections or reason for rejection…"
                    className="mt-1.5 w-full resize-none rounded-btn border border-slate-200 bg-white px-3.5 py-2.5 text-sm outline-none focus:border-brand-blue dark:border-border dark:bg-input dark:text-foreground"
                  />
                </div>
              )}

              <div className="mt-6 flex flex-wrap justify-end gap-3 border-t border-slate-200 pt-4 dark:border-border">
                <button onClick={() => setDetail(null)} className="rounded-btn px-4 py-2 text-sm font-medium text-brand-gray hover:bg-brand-bg dark:hover:bg-hover">Close</button>
                {canReview && user?.role === detail.recipientRole && detail.status === "Submitted" && (
                  <button disabled={busy} onClick={() => act(detail, "Received")} className="rounded-btn border border-brand-border px-4 py-2 text-sm font-medium text-brand-ink hover:border-brand-blue hover:text-brand-blue disabled:opacity-60">Mark Received</button>
                )}
                {canReview && user?.role === detail.recipientRole && detail.status === "Received" && (
                  <>
                    <button disabled={busy || !rejectReason.trim()} onClick={() => act(detail, "Needs Revision")} className="rounded-btn border border-brand-danger/30 px-4 py-2 text-sm font-medium text-brand-danger hover:bg-brand-danger/5 disabled:opacity-60">Return for Revision</button>
                    <button disabled={busy || !rejectReason.trim()} onClick={() => act(detail, "Rejected")} className="rounded-btn border border-brand-danger/30 px-4 py-2 text-sm font-medium text-brand-danger hover:bg-brand-danger/5 disabled:opacity-60">Reject Report</button>
                    <button disabled={busy} onClick={() => act(detail, "Reviewed")} className="rounded-btn bg-brand-blue px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-60">Approve Report</button>
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
