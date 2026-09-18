import React, { useMemo, useState } from "react";
import PageHeader from "@/components/common/PageHeader";
import { Card } from "@/components/common/Card";
import {
  useMunicipalSubmissions,
  municipalSubmissionsStore,
} from "@/services/local/municipalSubmissionsStore";
import { useAuth } from "@/context/AuthContext";
import {
  Search, FileText, ClipboardList, X, ChevronRight, RefreshCw, ShieldCheck, CheckCircle2, AlertTriangle,
} from "lucide-react";

const statusTone = {
  Submitted: "bg-brand-blue/10 text-brand-blue dark:bg-brand-blue/15",
  "Pending Review": "bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400",
  "Under Review": "bg-brand-blue/10 text-brand-blue dark:bg-brand-blue/15",
  Reviewed: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400",
  Returned: "bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-400",
  "Needs Correction": "bg-orange-50 text-orange-700 dark:bg-orange-500/15 dark:text-orange-400",
};

const dotTone = {
  Submitted: "bg-brand-blue",
  "Pending Review": "bg-brand-yellow",
  "Under Review": "bg-brand-blue",
  Reviewed: "bg-brand-green",
  Returned: "bg-brand-danger",
  "Needs Correction": "bg-brand-accent",
};

function StatusBadge({ value }) {
  const tone = statusTone[value] || "bg-slate-100 text-slate-600 dark:bg-slate-500/20 dark:text-slate-400";
  const dot = dotTone[value] || "bg-slate-400";
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${tone}`}>
      <span className={`h-2 w-2 rounded-full ${dot}`} /> {value}
    </span>
  );
}

const formatDate = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
};

export default function MunicipalSubmissions() {
  const { user } = useAuth();
  const submissions = useMunicipalSubmissions();
  const reviewer = user?.name || "Dr. Carmen Bautista";

  const [phase, setPhase] = useState("ready"); // loading | error | ready
  const [tab, setTab] = useState("all"); // all | TCL | M1
  const [barangayFilter, setBarangayFilter] = useState("All");
  const [periodFilter, setPeriodFilter] = useState("All");
  const [statusFilter, setStatusFilter] = useState("All");
  const [reviewFilter, setReviewFilter] = useState("All");
  const [query, setQuery] = useState("");
  const [viewingBarangay, setViewingBarangay] = useState(null);
  const [detail, setDetail] = useState(null);
  const [reviewMode, setReviewMode] = useState(null); // null | under-review | reviewed | returned | needs-correction
  const [notes, setNotes] = useState("");
  const [toast, setToast] = useState(null);

  const periods = useMemo(() => [...new Set(submissions.map((s) => s.period))].sort(), [submissions]);

  const showToast = (message) => {
    setToast(message);
    setTimeout(() => setToast(null), 3000);
  };

  // ---- Summary (real data) ----
  const summary = useMemo(() => {
    const tcl = submissions.filter((s) => s.type === "TCL");
    const m1 = submissions.filter((s) => s.type === "M1");
    const pending = submissions.filter((s) => s.reviewStatus === "Pending Review" || s.status === "Under Review").length;
    const reviewed = submissions.filter((s) => s.reviewStatus === "Reviewed").length;
    const returned = submissions.filter((s) => s.reviewStatus === "Returned" || s.reviewStatus === "Needs Correction").length;
    return {
      total: submissions.length,
      tcl: tcl.length,
      m1: m1.length,
      pending,
      reviewed,
      returned,
    };
  }, [submissions]);

  // ---- Barangay submission status for the selected period ----
  const selectedPeriod = periodFilter === "All" ? (periods[periods.length - 1] || "September 2026") : periodFilter;
  const barangayStatus = useMemo(() => {
    return municipalSubmissionsStore.barangays.map((b) => {
      const periodRows = submissions.filter((s) => s.barangay === b && s.period === selectedPeriod);
      const tcl = periodRows.find((s) => s.type === "TCL") || null;
      const m1 = periodRows.find((s) => s.type === "M1") || null;
      const complete = Boolean(tcl && m1);
      return { barangay: b, tcl, m1, complete, rows: periodRows };
    });
  }, [submissions, selectedPeriod]);

  // ---- Filtered list ----
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return submissions.filter((s) => {
      if (tab !== "all" && s.type !== tab) return false;
      if (barangayFilter !== "All" && s.barangay !== barangayFilter) return false;
      if (periodFilter !== "All" && s.period !== periodFilter) return false;
      if (statusFilter !== "All" && s.status !== statusFilter) return false;
      if (reviewFilter !== "All" && s.reviewStatus !== reviewFilter) return false;
      if (q) {
        const hay = `${s.reference} ${s.barangay} ${s.submittedBy} ${s.period}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [submissions, tab, barangayFilter, periodFilter, statusFilter, reviewFilter, query]);

  const sorted = useMemo(
    () => [...filtered].sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt)),
    [filtered]
  );

  const clearFilters = () => {
    setBarangayFilter("All");
    setPeriodFilter("All");
    setStatusFilter("All");
    setReviewFilter("All");
    setQuery("");
    setTab("all");
  };

  const detailRecord = detail ? submissions.find((s) => s.id === detail) : null;

  const applyReview = () => {
    if (!detailRecord || !reviewMode) return;
    if ((reviewMode === "returned" || reviewMode === "needs-correction") && !notes.trim()) {
      showToast("Please add a reason before returning the submission.");
      return;
    }
    municipalSubmissionsStore.reviewSubmission(detailRecord.id, { decision: reviewMode, notes: notes.trim(), reviewer });
    showToast(`${detailRecord.reference} ${reviewMode === "reviewed" ? "reviewed" : reviewMode === "returned" ? "returned" : "marked for correction"}.`);
    setDetail(null);
    setReviewMode(null);
    setNotes("");
  };

  // ---- Loading skeleton ----
  if (phase === "loading") {
    return (
      <>
        <PageHeader crumbs={["Submissions", "Submission Monitoring"]} title="Submission Monitoring" subtitle="Monitor TCL and M1 submissions across all barangays." />
        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-4 mb-6">
          {[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="h-28 animate-pulse rounded-2xl border border-slate-200 bg-slate-100" />)}
        </div>
        <div className="h-72 animate-pulse rounded-2xl border border-slate-200 bg-slate-100" />
      </>
    );
  }

  // ---- Error state ----
  if (phase === "error") {
    return (
      <>
        <PageHeader crumbs={["Submissions", "Submission Monitoring"]} title="Submission Monitoring" subtitle="Monitor TCL and M1 submissions across all barangays." />
        <Card className="p-10 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-brand-danger/10">
            <AlertTriangle className="h-7 w-7 text-brand-danger" />
          </div>
          <h3 className="mt-4 text-lg font-semibold text-brand-ink">Unable to Load Submissions</h3>
          <p className="mx-auto mt-1.5 max-w-md text-sm text-brand-gray">We couldn't retrieve the latest submission data.</p>
          <button onClick={() => setPhase("ready")} className="mt-5 inline-flex items-center gap-2 rounded-btn bg-brand-blue px-5 py-2.5 text-sm font-medium text-white hover:bg-brand-dark">
            <RefreshCw className="h-4 w-4" /> Retry
          </button>
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        crumbs={["Submissions", "Submission Monitoring"]}
        title="Submission Monitoring"
        subtitle="Monitor TCL and M1 submissions across all barangays in your municipality."
        action={
          <span className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-brand-gray dark:border-border dark:bg-card dark:text-slate-300">
            <ShieldCheck className="h-3.5 w-3.5 text-brand-blue" /> Municipal view
          </span>
        }
      />

      {toast && (
        <div className="fixed bottom-4 right-4 z-[80] flex items-center gap-2 rounded-btn bg-brand-ink px-4 py-3 text-white shadow-lg">
          <span className="text-sm">{toast}</span>
        </div>
      )}

      {/* Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-4 mb-6">
        {[
          { label: "Total Submissions", value: summary.total, tone: "bg-brand-blue/10 text-brand-blue", icon: FileText },
          { label: "TCL Submitted", value: summary.tcl, tone: "bg-brand-accent/10 text-brand-accent", icon: ClipboardList },
          { label: "M1 Submitted", value: summary.m1, tone: "bg-brand-green/10 text-brand-green", icon: FileText },
          { label: "Pending Review", value: summary.pending, tone: "bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400", icon: AlertTriangle },
          { label: "Reviewed", value: summary.reviewed, tone: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400", icon: CheckCircle2 },
          { label: "Returned / Needs Correction", value: summary.returned, tone: "bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-400", icon: X },
        ].map((s) => (
          <Card key={s.label} className="p-4 flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${s.tone}`}><s.icon className="w-5 h-5" /></div>
            <div>
              <p className="text-xs text-brand-gray uppercase tracking-wide">{s.label}</p>
              <p className="text-2xl font-semibold text-brand-ink">{s.value}</p>
            </div>
          </Card>
        ))}
      </div>

      {/* Barangay submission status (selected period) */}
      <Card className="p-5 mb-6">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <h3 className="font-semibold text-brand-ink">Barangay Submission Status</h3>
          <div className="flex items-center gap-2">
            <select value={selectedPeriod} onChange={(e) => setPeriodFilter(e.target.value)} className="rounded-btn border border-slate-200 bg-white dark:bg-input px-3 py-2 text-sm outline-none dark:text-foreground">
              {periods.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="bg-brand-bg text-left">
                <th className="px-3 py-2.5 font-medium text-brand-gray">Barangay</th>
                <th className="px-3 py-2.5 font-medium text-brand-gray">TCL</th>
                <th className="px-3 py-2.5 font-medium text-brand-gray">M1</th>
                <th className="px-3 py-2.5 font-medium text-brand-gray">Overall Status</th>
                <th className="px-3 py-2.5 font-medium text-brand-gray text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {barangayStatus.map((b) => (
                <tr key={b.barangay} className="hover:bg-brand-bg/50">
                  <td className="px-3 py-3 font-medium text-brand-ink">{b.barangay}</td>
                  <td className="px-3 py-3">{b.tcl ? <StatusBadge value={b.tcl.status} /> : <span className="text-xs text-brand-gray">Missing</span>}</td>
                  <td className="px-3 py-3">{b.m1 ? <StatusBadge value={b.m1.status} /> : <span className="text-xs text-brand-gray">Missing</span>}</td>
                  <td className="px-3 py-3">
                    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${b.complete ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400" : "bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-400"}`}>
                      <span className={`h-2 w-2 rounded-full ${b.complete ? "bg-brand-green" : "bg-brand-danger"}`} /> {b.complete ? "Complete" : "Incomplete"}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-right">
                    <button onClick={() => setViewingBarangay(viewingBarangay === b.barangay ? null : b.barangay)} className="inline-flex items-center gap-1 text-sm font-medium text-brand-blue hover:underline">
                      View <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Barangay drill-down */}
      {viewingBarangay && (
        <Card className="p-5 mb-6">
          <div className="flex items-center justify-between gap-3 mb-4">
            <h3 className="font-semibold text-brand-ink">Barangay {viewingBarangay} · {selectedPeriod}</h3>
            <button onClick={() => setViewingBarangay(null)} className="text-xs font-medium text-brand-blue hover:underline">Close</button>
          </div>
          <div className="space-y-3">
            {barangayStatus.find((b) => b.barangay === viewingBarangay)?.rows.map((s) => (
              <div key={s.id} className="flex flex-wrap items-center justify-between gap-3 rounded-btn border border-slate-200 dark:border-border bg-white px-4 py-3">
                <div className="min-w-0">
                  <p className="font-medium text-brand-ink">{s.reference} · {s.type}</p>
                  <p className="text-xs text-brand-gray">Submitted by {s.submittedBy} · {formatDate(s.submittedAt)}</p>
                </div>
                <StatusBadge value={s.status} />
                <button onClick={() => setDetail(s.id)} className="text-sm font-medium text-brand-blue hover:underline">View</button>
              </div>
            ))}
            {barangayStatus.find((b) => b.barangay === viewingBarangay)?.rows.length === 0 && (
              <p className="py-6 text-center text-sm text-brand-gray">No submissions for this barangay in the selected period.</p>
            )}
          </div>
        </Card>
      )}

      {/* Progress */}
      <Card className="p-5 mb-6">
        <h3 className="font-semibold text-brand-ink text-sm mb-4">{selectedPeriod} Submission Completion</h3>
        <div className="space-y-3 max-w-xl">
          {[
            { label: "TCL", count: barangayStatus.filter((b) => b.tcl).length, total: barangayStatus.length },
            { label: "M1", count: barangayStatus.filter((b) => b.m1).length, total: barangayStatus.length },
          ].map((p) => {
            const pct = p.total ? Math.round((p.count / p.total) * 100) : 0;
            return (
              <div key={p.label}>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-brand-ink">{p.label}</span>
                  <span className="text-brand-gray">{p.count} / {p.total} barangays · {pct}%</span>
                </div>
                <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-slate-200">
                  <div className="h-full rounded-full bg-brand-blue" style={{ width: `${pct}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      {/* Tabs + filters */}
      <Card className="overflow-hidden">
        <div className="border-b border-slate-200 px-5 pt-4 flex flex-wrap items-center gap-2">
          {[
            { key: "all", label: "All Submissions" },
            { key: "TCL", label: "TCL" },
            { key: "M1", label: "M1" },
          ].map((t) => (
            <button key={t.key} onClick={() => setTab(t.key)} className={`rounded-t-lg px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${tab === t.key ? "border-brand-blue text-brand-blue" : "border-transparent text-brand-gray hover:text-brand-ink"}`}>
              {t.label}
            </button>
          ))}
        </div>
        <div className="px-5 py-4 flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 rounded-input border border-slate-200 dark:border-border bg-brand-bg/60 dark:bg-input px-3 py-2.5 min-w-[200px] flex-1 sm:flex-none">
            <Search className="h-4 w-4 shrink-0 text-brand-gray" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search submissions..." className="w-full bg-transparent text-sm outline-none placeholder:text-slate-400 dark:placeholder:text-slate-500" />
          </div>
          <select value={barangayFilter} onChange={(e) => setBarangayFilter(e.target.value)} className="rounded-btn border border-slate-200 dark:border-border bg-white dark:bg-input px-3 py-2.5 text-sm outline-none dark:text-foreground">
            <option value="All">All Barangays</option>
            {municipalSubmissionsStore.barangays.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
          <select value={periodFilter} onChange={(e) => setPeriodFilter(e.target.value)} className="rounded-btn border border-slate-200 dark:border-border bg-white dark:bg-input px-3 py-2.5 text-sm outline-none dark:text-foreground">
            <option value="All">All Periods</option>
            {periods.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="rounded-btn border border-slate-200 dark:border-border bg-white dark:bg-input px-3 py-2.5 text-sm outline-none dark:text-foreground">
            <option value="All">All Statuses</option>
            {municipalSubmissionsStore.statuses.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select value={reviewFilter} onChange={(e) => setReviewFilter(e.target.value)} className="rounded-btn border border-slate-200 dark:border-border bg-white dark:bg-input px-3 py-2.5 text-sm outline-none dark:text-foreground">
            <option value="All">All Review Status</option>
            {municipalSubmissionsStore.reviewStatuses.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <button onClick={clearFilters} className="inline-flex items-center gap-1.5 rounded-btn border border-brand-border bg-white px-3 py-2.5 text-sm font-medium text-brand-gray hover:bg-brand-bg dark:bg-card dark:hover:bg-hover">
            <X className="h-4 w-4" /> Clear Filters
          </button>
        </div>

        {/* Table / cards */}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm">
            <thead>
              <tr className="bg-brand-bg text-left">
                <th className="px-5 py-3 font-medium text-brand-gray">Reference</th>
                <th className="px-5 py-3 font-medium text-brand-gray">Type</th>
                <th className="px-5 py-3 font-medium text-brand-gray">Barangay</th>
                <th className="px-5 py-3 font-medium text-brand-gray">Reporting Period</th>
                <th className="px-5 py-3 font-medium text-brand-gray">Submitted By</th>
                <th className="px-5 py-3 font-medium text-brand-gray">Date Submitted</th>
                <th className="px-5 py-3 font-medium text-brand-gray">Status</th>
                <th className="px-5 py-3 font-medium text-brand-gray">Review Status</th>
                <th className="px-5 py-3 font-medium text-brand-gray text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {sorted.map((s) => (
                <tr key={s.id} className="hover:bg-brand-bg/50">
                  <td className="px-5 py-3 font-medium text-brand-ink">{s.reference}</td>
                  <td className="px-5 py-3"><span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${s.type === "TCL" ? "bg-brand-blue/10 text-brand-blue dark:bg-brand-blue/15" : "bg-brand-green/10 text-brand-green dark:bg-brand-green/15"}`}>{s.type}</span></td>
                  <td className="px-5 py-3 text-brand-gray">{s.barangay}</td>
                  <td className="px-5 py-3 text-brand-gray">{s.period}</td>
                  <td className="px-5 py-3 text-brand-gray">{s.submittedBy}</td>
                  <td className="px-5 py-3 text-brand-gray whitespace-nowrap">{formatDate(s.submittedAt)}</td>
                  <td className="px-5 py-3"><StatusBadge value={s.status} /></td>
                  <td className="px-5 py-3"><StatusBadge value={s.reviewStatus} /></td>
                  <td className="px-5 py-3 text-right">
                    <button onClick={() => setDetail(s.id)} className="inline-flex items-center gap-1 text-sm font-medium text-brand-blue hover:underline">
                      View <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Mobile cards */}
        <div className="space-y-3 px-4 pb-4 md:hidden">
          {sorted.map((s) => (
            <div key={s.id} className="rounded-btn border border-slate-200 dark:border-border bg-white p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="font-medium text-brand-ink">{s.reference}</p>
                <StatusBadge value={s.status} />
              </div>
              <div className="mt-2 space-y-1 text-xs text-brand-gray">
                <p>Type: <span className="text-brand-ink">{s.type}</span></p>
                <p>Barangay: <span className="text-brand-ink">{s.barangay}</span></p>
                <p>Period: <span className="text-brand-ink">{s.period}</span></p>
                <p>Submitted: <span className="text-brand-ink">{formatDate(s.submittedAt)}</span></p>
              </div>
              <button onClick={() => setDetail(s.id)} className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-brand-blue">
                View <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>

        {sorted.length === 0 && (
          <div className="px-5 py-12 text-center">
            <p className="text-sm font-medium text-brand-ink">No Submissions Found</p>
            <p className="mt-1 text-xs text-brand-gray">There are no TCL/M1 submissions matching the current filters.</p>
            <button onClick={clearFilters} className="mt-4 rounded-btn border border-brand-border bg-white px-4 py-2 text-sm font-medium text-brand-blue hover:bg-brand-bg dark:bg-card dark:hover:bg-hover">
              Clear Filters
            </button>
          </div>
        )}
      </Card>

      {/* Detail drawer */}
      {detailRecord && (
        <SubmissionDetail
          record={detailRecord}
          reviewer={reviewer}
          reviewMode={reviewMode}
          setReviewMode={setReviewMode}
          notes={notes}
          setNotes={setNotes}
          onClose={() => { setDetail(null); setReviewMode(null); setNotes(""); }}
          onSubmit={applyReview}
        />
      )}
    </>
  );
}

/** Detail drawer with review workflow. */
function SubmissionDetail({ record, reviewer, reviewMode, setReviewMode, notes, setNotes, onClose, onSubmit }) {
  const totalsEntries = Object.entries(record.totals || {});
  return (
    <div className="fixed inset-0 z-[70]">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="absolute right-0 top-0 flex h-full w-full max-w-2xl flex-col bg-white dark:bg-card shadow-2xl">
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 dark:border-border px-5 py-4">
          <div className="min-w-0">
            <p className="truncate text-base font-semibold text-brand-ink">{record.reference} · {record.type}</p>
            <p className="text-xs text-brand-gray">{record.barangay} · {record.period}</p>
          </div>
          <button onClick={onClose} className="text-brand-gray hover:text-brand-ink"><X className="h-5 w-5" /></button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
          {/* Submission info */}
          <section className="rounded-2xl border border-slate-200 dark:border-border bg-white p-4">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-brand-gray">Submission Information</p>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div><p className="text-[11px] text-brand-gray uppercase tracking-wide">Submitted By</p><p className="mt-0.5 font-medium text-brand-ink">{record.submittedBy}</p></div>
              <div><p className="text-[11px] text-brand-gray uppercase tracking-wide">Date Submitted</p><p className="mt-0.5 font-medium text-brand-ink">{formatDate(record.submittedAt)}</p></div>
              <div><p className="text-[11px] text-brand-gray uppercase tracking-wide">Last Updated</p><p className="mt-0.5 font-medium text-brand-ink">{formatDate(record.lastUpdated)}</p></div>
              <div><p className="text-[11px] text-brand-gray uppercase tracking-wide">Status</p><div className="mt-1"><StatusBadge value={record.status} /></div></div>
            </div>
          </section>

          {/* Details / totals */}
          <section className="rounded-2xl border border-slate-200 dark:border-border bg-white p-4">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-brand-gray">Submission Details</p>
            {totalsEntries.length > 0 ? (
              <div className="grid grid-cols-2 gap-3">
                {totalsEntries.map(([k, v]) => (
                  <div key={k} className="rounded-btn bg-brand-bg/60 dark:bg-card-nested px-3 py-2.5">
                    <p className="text-[11px] text-brand-gray uppercase tracking-wide">{k.replace(/([A-Z])/g, " $1")}</p>
                    <p className="mt-0.5 text-lg font-semibold text-brand-ink">{v}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-brand-gray">No totals recorded.</p>
            )}
            <p className="mt-3 text-xs text-brand-gray">{record.entries} entries · {record.type === "TCL" ? "Target Client List" : "M1 Maternal Records"}</p>
          </section>

          {/* Review info */}
          <section className="rounded-2xl border border-slate-200 dark:border-border bg-white p-4">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-brand-gray">Review Information</p>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div><p className="text-[11px] text-brand-gray uppercase tracking-wide">Review Status</p><div className="mt-1"><StatusBadge value={record.reviewStatus} /></div></div>
              <div><p className="text-[11px] text-brand-gray uppercase tracking-wide">Reviewed By</p><p className="mt-0.5 font-medium text-brand-ink">{record.reviewedBy || "—"}</p></div>
              <div><p className="text-[11px] text-brand-gray uppercase tracking-wide">Date Reviewed</p><p className="mt-0.5 font-medium text-brand-ink">{formatDate(record.reviewedAt)}</p></div>
              <div><p className="text-[11px] text-brand-gray uppercase tracking-wide">Review Notes</p><p className="mt-0.5 font-medium text-brand-ink">{record.reviewNotes || "—"}</p></div>
            </div>
          </section>

          {/* Audit trail */}
          <section className="rounded-2xl border border-slate-200 dark:border-border bg-white p-4">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-brand-gray">Audit Trail</p>
            <div className="space-y-2">
              {(record.audit || []).map((a, i) => (
                <div key={i} className="flex items-start justify-between gap-3 text-sm">
                  <div>
                    <p className="font-medium text-brand-ink">{a.action}</p>
                    <p className="text-xs text-brand-gray">{a.notes}</p>
                  </div>
                  <p className="shrink-0 text-xs text-brand-gray">{a.by} · {formatDate(a.at)}</p>
                </div>
              ))}
            </div>
          </section>

          {/* Review actions */}
          <section className="rounded-2xl border border-brand-blue/15 bg-brand-light/50 dark:bg-card-nested p-4">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-brand-gray">Review</p>
            <div className="flex flex-wrap gap-2">
              {[
                { key: "reviewed", label: "Approve / Mark Reviewed" },
                { key: "returned", label: "Return for Correction" },
                { key: "needs-correction", label: "Request Clarification" },
              ].map((a) => (
                <button key={a.key} onClick={() => setReviewMode(reviewMode === a.key ? null : a.key)} className={`rounded-full border px-3.5 py-2 text-xs font-medium transition-colors ${reviewMode === a.key ? "border-brand-blue bg-brand-blue text-white" : "border-brand-border bg-white text-brand-gray hover:border-brand-blue dark:bg-card"}`}>
                  {a.label}
                </button>
              ))}
            </div>
            {reviewMode && (
              <div className="mt-3">
                <label className="text-sm font-medium text-brand-ink">Review Notes {reviewMode !== "reviewed" && <span className="text-red-500">*</span>}</label>
                <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={reviewMode === "reviewed" ? "Optional notes..." : "Please specify what needs to be corrected..."} className="mt-1.5 w-full resize-none rounded-btn border border-slate-200 dark:border-border bg-white dark:bg-input px-3.5 py-2.5 text-sm outline-none focus:border-brand-blue" />
                <button onClick={onSubmit} className="mt-3 inline-flex items-center gap-2 rounded-btn bg-brand-blue px-5 py-2.5 text-sm font-medium text-white hover:bg-brand-dark">
                  {reviewMode === "reviewed" ? "Confirm Review" : "Confirm & Submit"}
                </button>
              </div>
            )}
            <p className="mt-3 text-xs text-brand-gray">Reviewed by: {reviewer}</p>
          </section>
        </div>
      </div>
    </div>
  );
}
