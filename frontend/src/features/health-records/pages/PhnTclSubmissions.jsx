import React, { useCallback, useEffect, useMemo, useState } from "react";
import PageHeader from "@/components/common/PageHeader";
import { Card } from "@/components/common/Card";
import {
  Search,
  RefreshCw,
  X,
  FileText,
  FileSpreadsheet,
  Building2,
  ClipboardCheck,
  Clock,
  Layers,
  ChevronRight,
  ChevronDown,
  Eye,
  CalendarDays,
} from "lucide-react";
import { reportsApi } from "@/services/api";
import { useBarangays } from "@/context/BarangaysContext";
import { usePermissions } from "@/context/PermissionsContext";
import ReportSnapshotView from "@/features/reports/components/ReportSnapshotView";

/**
 * PHN — Target Client Lists (submission monitoring).
 *
 * This page is the Public Health Nurse's municipality-wide monitor of the TCL /
 * health-program documents genuinely SUBMITTED by barangays. It reads only
 * persisted, server-scoped submissions from the real report-submission
 * workflow (GET /api/reports?box=incoming): barangay Health Supervisors submit
 * their records upward and the PHN has municipality-wide oversight of them. No
 * mock data, hardcoded counts, placeholder cards, or invented submissions are
 * used — every row is a real `public.reports` record delivered to the PHN's
 * scope with status, barangay, submitting staff, and submission timestamp.
 *
 * Drafts never leave the sender (the backend filters status != 'Draft'), so a
 * locally saved draft or an unsent form can never appear here.
 */

// ---- Status: the real workflow statuses, with the display labels the PHN TCL
// monitor uses. Only states the backend workflow actually supports are mapped:
//   Submitted -> Submitted, Received -> Under Review, Reviewed -> Reviewed,
//   Rejected  -> Returned.
const STATUS_DISPLAY = {
  Submitted: "Submitted",
  Received: "Under Review",
  Reviewed: "Reviewed",
  Rejected: "Returned",
};

const STATUS_TONE = {
  Submitted: "bg-brand-blue/10 text-brand-blue",
  "Under Review": "bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400",
  Reviewed: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400",
  Returned: "bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-400",
};

const STATUS_DOT = {
  Submitted: "bg-brand-blue",
  "Under Review": "bg-brand-yellow",
  Reviewed: "bg-brand-green",
  Returned: "bg-brand-danger",
};

// Statuses still awaiting PHN action (not yet reviewed/returned).
const PENDING_STATUSES = new Set(["Submitted", "Received"]);

const ROLE_LABELS = {
  phn: "Public Health Nurse",
  mho: "Municipal Health Officer",
  health_supervisor: "Health Supervisor",
  rhu_personnel: "RHU Personnel",
  bhw: "Barangay Health Worker",
};

const RHU_LABEL = "RHU / Municipality-level";

/**
 * Derive a health program category from a report's type/title. The report type
 * is the real, free-text document name a barangay submitted; this classifier
 * only groups the actual submitted documents under the program categories the
 * system already uses. Documents that do not match keep an honest fallback
 * category rather than being dropped or re-labelled.
 */
const deriveCategory = (report) => {
  const text = `${report.reportType || ""} ${report.title || ""}`.toLowerCase();
  const has = (...terms) => terms.some((t) => text.includes(t));
  if (has("maternal", "prenatal", "postpartum", "postnatal", "pregnan", "delivery", "family planning", "child", "immuniz", "newborn", "infant", "nutrition"))
    return "Maternal and Family Health";
  if (has("ncd", "non-communicable", "cervical", "breast", "visual", "oral", "screening", "hypertension", "diabetes", "senior"))
    return "Screening and Preventive Care";
  if (has("environment", "sanitation", "water", "household"))
    return "Environmental Health";
  if (has("referral", "follow-up", "follow up", "followup", "consultation", "health service", "health record"))
    return "Care Coordination and Services";
  if (has("community", "trend", "early warning", "surveillance"))
    return "Community Health Programs";
  return "Other Health Programs";
};

const displayStatus = (raw) => STATUS_DISPLAY[raw] || raw || "Submitted";

const formatDate = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
};

const formatDateTime = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
};

/** The YYYY-MM-DD portion of a submission's effective date (submitted, else created). */
const submissionDate = (r) => {
  const iso = r.submittedAt || r.createdAt || "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
};

const PAGE_SIZE = 15;

function StatusBadge({ raw }) {
  const label = displayStatus(raw);
  const tone = STATUS_TONE[label] || "bg-slate-100 text-slate-600";
  const dot = STATUS_DOT[label] || "bg-slate-400";
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${tone}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} aria-hidden="true" /> {label}
    </span>
  );
}

export default function PhnTclSubmissions() {
  const { can } = usePermissions();
  const { barangays } = useBarangays();
  // Reviewing a submission is a recipient/oversight action gated by reports.view
  // (the same permission the shared Incoming Reports inbox uses). The PHN has
  // municipality-wide read/review oversight of barangay submissions.
  const canReview = can("reports.view");

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // ---- View + filters ----
  const [view, setView] = useState("all"); // all | barangay
  const [barangayFilter, setBarangayFilter] = useState("All");
  const [categoryFilter, setCategoryFilter] = useState("All");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState({}); // barangay -> bool (By Barangay view)

  // ---- Detail / review modal ----
  const [detail, setDetail] = useState(null);
  const [detailContent, setDetailContent] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [remarks, setRemarks] = useState("");
  const [busy, setBusy] = useState(false);
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
      .catch((err) => setError(err?.message || "We couldn't load submitted TCL documents. Please try again."))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Load the exact persisted snapshot when a document is opened (never a live
  // reconstruction), matching the shared recipient inbox behavior.
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
    reportsApi
      .get(detail.id)
      .then((res) => { if (active) setDetailContent(res?.record || null); })
      .catch((err) => { if (active) setDetailError(err?.message || "Could not open the submitted document."); })
      .finally(() => { if (active) setDetailLoading(false); });
    return () => { active = false; };
  }, [detail]);

  // Normalize every real submission into the row shape this page renders.
  const submissions = useMemo(
    () =>
      rows.map((r) => ({
        ...r,
        barangayName: r.barangay || RHU_LABEL,
        category: deriveCategory(r),
        documentName: r.title ? `${r.reportType}${r.title && r.title !== r.reportType ? ` — ${r.title}` : ""}` : r.reportType || "Submitted document",
        effectiveDate: submissionDate(r),
        effectiveIso: r.submittedAt || r.createdAt || "",
      })),
    [rows]
  );

  // Category options come ONLY from categories actually present in real data so
  // the dropdown never offers an empty / fabricated category.
  const categoryOptions = useMemo(
    () => Array.from(new Set(submissions.map((s) => s.category))).sort((a, b) => a.localeCompare(b)),
    [submissions]
  );

  // Barangay options: the live DB barangay list, unioned with any barangay name
  // that actually appears in submissions (so an RHU-level submission is still
  // selectable). Keeps the dropdown aligned with the database.
  const barangayOptions = useMemo(() => {
    const set = new Set([...(barangays || [])]);
    submissions.forEach((s) => { if (s.barangayName) set.add(s.barangayName); });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [barangays, submissions]);

  // ---- Filtered + sorted (barangay -> category -> newest first) ----
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return submissions
      .filter((s) => {
        if (barangayFilter !== "All" && s.barangayName !== barangayFilter) return false;
        if (categoryFilter !== "All" && s.category !== categoryFilter) return false;
        if (fromDate && (!s.effectiveDate || s.effectiveDate < fromDate)) return false;
        if (toDate && (!s.effectiveDate || s.effectiveDate > toDate)) return false;
        if (q) {
          const hay = `${s.documentName} ${s.reportType} ${s.title} ${s.senderName} ${s.barangayName} ${s.category}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      })
      .sort((a, b) => {
        if (a.barangayName !== b.barangayName) return a.barangayName.localeCompare(b.barangayName);
        if (a.category !== b.category) return a.category.localeCompare(b.category);
        return String(b.effectiveIso).localeCompare(String(a.effectiveIso));
      });
  }, [submissions, barangayFilter, categoryFilter, fromDate, toDate, query]);

  // Reset to the first page whenever the filtered result set changes.
  useEffect(() => { setPage(1); }, [barangayFilter, categoryFilter, fromDate, toDate, query, view]);

  // ---- Summary cards ----
  // Computed from the currently FILTERED submissions so the counts update in
  // lockstep with the toolbar (barangay/category/date/search). With no active
  // filter this equals the full set of real submissions; it never uses mock or
  // hardcoded values.
  const summary = useMemo(() => {
    const total = filtered.length;
    const barangaysWith = new Set(filtered.map((s) => s.barangayName)).size;
    const pending = filtered.filter((s) => PENDING_STATUSES.has(s.status)).length;
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const recent = filtered.filter((s) => {
      const t = new Date(s.effectiveIso).getTime();
      return !Number.isNaN(t) && t >= weekAgo;
    }).length;
    return { total, barangaysWith, pending, recent };
  }, [filtered]);

  // ---- Grouping for the By Barangay view: barangay -> category -> rows ----
  const groupedByBarangay = useMemo(() => {
    const map = new Map();
    filtered.forEach((s) => {
      if (!map.has(s.barangayName)) map.set(s.barangayName, new Map());
      const catMap = map.get(s.barangayName);
      if (!catMap.has(s.category)) catMap.set(s.category, []);
      catMap.get(s.category).push(s);
    });
    return Array.from(map.entries()).map(([barangay, catMap]) => ({
      barangay,
      count: Array.from(catMap.values()).reduce((n, arr) => n + arr.length, 0),
      categories: Array.from(catMap.entries()).map(([category, items]) => ({ category, items })),
    }));
  }, [filtered]);

  // Pagination for the consolidated All Submissions table.
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paged = useMemo(
    () => filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [filtered, page]
  );

  const hasActiveFilters =
    barangayFilter !== "All" || categoryFilter !== "All" || Boolean(fromDate) || Boolean(toDate) || Boolean(query.trim());

  const resetFilters = () => {
    setBarangayFilter("All");
    setCategoryFilter("All");
    setFromDate("");
    setToDate("");
    setQuery("");
  };

  const toggleBarangay = (name) =>
    setExpanded((prev) => ({ ...prev, [name]: !prev[name] }));

  const act = async (status) => {
    if (!canReview || !detail) return;
    if (status === "Rejected" && !remarks.trim()) {
      showToast("A reason is required to return a document.");
      return;
    }
    setBusy(true);
    try {
      await reportsApi.review(detail.id, { status, remarks: remarks.trim() });
      showToast(`Document marked ${displayStatus(status)}.`);
      setDetail(null);
      setRemarks("");
      await load();
    } catch (err) {
      showToast(err?.message || "The document could not be updated.");
    } finally {
      setBusy(false);
    }
  };

  const closeDetail = () => {
    setDetail(null);
    setRemarks("");
  };

  const summaryCards = [
    { label: "Submitted Documents", value: summary.total, icon: FileText, tone: "bg-brand-blue/10 text-brand-blue" },
    { label: "Barangays with Submissions", value: summary.barangaysWith, icon: Building2, tone: "bg-brand-sky/15 text-brand-accent" },
    { label: "Pending PHN Review", value: summary.pending, icon: ClipboardCheck, tone: "bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400" },
    { label: "Recently Submitted (7 days)", value: summary.recent, icon: Clock, tone: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400" },
  ];

  // Compact row-action buttons (View + optional Review) reused by both views.
  const RowActions = ({ s }) => (
    <div className="flex items-center justify-end gap-2">
      <button
        onClick={() => { setDetail(s); setRemarks(""); }}
        className="inline-flex items-center gap-1 text-sm font-medium text-brand-blue hover:underline"
      >
        <Eye className="h-3.5 w-3.5" /> View Document
      </button>
    </div>
  );

  return (
    <>
      <PageHeader
        dense
        crumbs={["Records"]}
        title="Target Client Lists"
        subtitle="Monitor submitted health program records across barangays."
      />

      {toast && (
        <div className="fixed bottom-4 right-4 z-[80] flex items-center gap-2 rounded-btn bg-brand-ink px-4 py-3 text-white shadow-lg">
          <span className="text-sm">{toast}</span>
        </div>
      )}

      {/* Summary cards — compact, dynamically computed from real submissions. */}
      <div className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {summaryCards.map((c) => (
          <Card key={c.label} className="flex items-center gap-3 p-3">
            <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-btn ${c.tone}`}>
              <c.icon className="h-[18px] w-[18px]" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <p className="truncate text-[11px] font-semibold uppercase tracking-wide text-brand-gray">{c.label}</p>
              <p className="font-stat text-xl font-semibold text-brand-ink">{loading ? "—" : c.value}</p>
            </div>
          </Card>
        ))}
      </div>

      {/* Filter toolbar — compact, single card with two rows. */}
      <Card className="mb-3 p-3">
        {/* Row 1 — primary filters */}
        <div className="flex flex-wrap items-center gap-2">
          {/* View toggle */}
          <div className="inline-flex shrink-0 rounded-btn border border-brand-border p-0.5">
            {[
              { key: "all", label: "All Submissions" },
              { key: "barangay", label: "By Barangay" },
            ].map((t) => (
              <button
                key={t.key}
                onClick={() => setView(t.key)}
                className={`rounded-[2px] px-3 py-1.5 text-xs font-semibold transition-colors ${
                  view === t.key ? "bg-brand-blue text-white" : "bg-white text-brand-blue hover:text-brand-dark dark:bg-transparent"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="flex min-w-[180px] flex-1 items-center gap-2 rounded-input border border-brand-border bg-brand-bg/60 px-3 py-2">
            <Search className="h-4 w-4 shrink-0 text-brand-gray" aria-hidden="true" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by document"
              aria-label="Search submitted documents"
              className="w-full bg-transparent text-sm text-brand-ink outline-none placeholder:text-brand-gray"
            />
          </div>

          <select
            value={barangayFilter}
            onChange={(e) => setBarangayFilter(e.target.value)}
            aria-label="Filter by barangay"
            className="rounded-btn border border-brand-border bg-white px-3 py-2 text-sm text-brand-ink outline-none focus:border-brand-blue dark:bg-card"
          >
            <option value="All">All Barangays</option>
            {barangayOptions.map((b) => (
              <option key={b} value={b}>{b}</option>
            ))}
          </select>

          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            aria-label="Filter by health program category"
            className="rounded-btn border border-brand-border bg-white px-3 py-2 text-sm text-brand-ink outline-none focus:border-brand-blue dark:bg-card"
          >
            <option value="All">All Categories</option>
            {categoryOptions.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>

          {/* Submission date range — one compact control with a calendar icon. */}
          <div className="flex items-center gap-1.5 rounded-btn border border-brand-border bg-white px-2.5 py-1.5 dark:bg-card">
            <CalendarDays className="h-4 w-4 shrink-0 text-brand-gray" aria-hidden="true" />
            <input
              type="date"
              value={fromDate}
              max={toDate || undefined}
              onChange={(e) => setFromDate(e.target.value)}
              aria-label="Submitted from date"
              className="bg-transparent text-sm text-brand-ink outline-none"
            />
            <span className="text-xs text-brand-gray">to</span>
            <input
              type="date"
              value={toDate}
              min={fromDate || undefined}
              onChange={(e) => setToDate(e.target.value)}
              aria-label="Submitted to date"
              className="bg-transparent text-sm text-brand-ink outline-none"
            />
          </div>
        </div>

        {/* Row 2 — actions */}
        <div className="mt-2.5 flex items-center gap-2 border-t border-brand-border pt-2.5">
          <button
            onClick={resetFilters}
            disabled={!hasActiveFilters}
            className="inline-flex items-center gap-1.5 rounded-btn bg-brand-bg px-3 py-2 text-sm font-medium text-brand-gray transition-colors hover:bg-brand-light hover:text-brand-ink disabled:cursor-not-allowed disabled:opacity-50 dark:bg-card"
          >
            <X className="h-4 w-4" /> Reset
          </button>

          <button
            onClick={load}
            className="inline-flex items-center gap-1.5 rounded-btn border border-brand-border bg-white px-3 py-2 text-sm font-medium text-brand-ink transition-colors hover:border-brand-blue hover:text-brand-blue dark:bg-card"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
          </button>
        </div>
      </Card>

      {/* ---- Main content ---- */}
      {error ? (
        <Card className="px-6 py-12 text-center">
          <p className="text-sm font-medium text-brand-danger">{error}</p>
          <button
            onClick={load}
            className="mt-3 inline-flex items-center gap-2 rounded-btn border border-brand-border px-4 py-2 text-sm font-medium text-brand-ink hover:border-brand-blue hover:text-brand-blue"
          >
            <RefreshCw className="h-4 w-4" /> Retry
          </button>
        </Card>
      ) : loading ? (
        <Card className="px-6 py-12 text-center text-sm text-brand-gray">Loading submitted TCL documents…</Card>
      ) : filtered.length === 0 ? (
        <Card className="flex flex-col items-center justify-center gap-1 px-6 py-14 text-center">
          <FileSpreadsheet className="h-8 w-8 text-brand-gray/40" aria-hidden="true" />
          <p className="mt-2 text-sm font-semibold text-brand-ink">No submitted TCL documents found for the selected filters.</p>
          {hasActiveFilters ? (
            <button onClick={resetFilters} className="mt-3 rounded-btn border border-brand-border bg-white px-4 py-2 text-sm font-medium text-brand-blue hover:bg-brand-bg dark:bg-card">
              Reset filters
            </button>
          ) : (
            <p className="text-xs text-brand-gray">Documents submitted by barangays will appear here once received.</p>
          )}
        </Card>
      ) : view === "all" ? (
        /* ---- All Submissions: one consolidated, dense table ---- */
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] border-collapse text-sm">
              <thead>
                <tr className="bg-brand-bg text-left">
                  {["Barangay", "Health Program Category", "TCL Document", "Submitted By", "Date Submitted", "Status", "Action"].map((h, i) => (
                    <th
                      key={h || i}
                      className={`border-b border-brand-border px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-brand-gray ${i === 6 ? "text-right" : ""}`}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-brand-border">
                {paged.map((s) => (
                  <tr key={s.id} className="odd:bg-white even:bg-brand-bg/30 hover:bg-brand-light/50">
                    <td className="whitespace-nowrap px-4 py-2.5 font-medium text-brand-ink">{s.barangayName}</td>
                    <td className="px-4 py-2.5 text-brand-gray">{s.category}</td>
                    <td className="px-4 py-2.5 text-brand-ink">
                      <span className="block max-w-[280px] truncate" title={s.documentName}>{s.documentName}</span>
                    </td>
                    <td className="px-4 py-2.5">
                      <p className="text-brand-ink">{s.senderName || "—"}</p>
                      <p className="text-[11px] text-brand-gray">{ROLE_LABELS[s.senderRole] || s.senderRole}</p>
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-brand-gray">{formatDate(s.effectiveIso)}</td>
                    <td className="px-4 py-2.5"><StatusBadge raw={s.status} /></td>
                    <td className="px-4 py-2.5 text-right"><RowActions s={s} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between gap-3 border-t border-brand-border px-4 py-3 text-sm">
              <p className="text-xs text-brand-gray">
                Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filtered.length)} of {filtered.length}
              </p>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="rounded-btn border border-brand-border px-3 py-1.5 text-xs font-medium text-brand-ink disabled:opacity-50"
                >
                  Previous
                </button>
                <span className="px-2 text-xs text-brand-gray">Page {page} of {totalPages}</span>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                  className="rounded-btn border border-brand-border px-3 py-1.5 text-xs font-medium text-brand-ink disabled:opacity-50"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </Card>
      ) : (
        /* ---- By Barangay: expandable sections, categories as sub-headers ---- */
        <div className="space-y-3">
          {groupedByBarangay.map((group) => {
            const open = expanded[group.barangay] !== false; // default expanded
            return (
              <Card key={group.barangay} className="overflow-hidden">
                <button
                  onClick={() => toggleBarangay(group.barangay)}
                  className="flex w-full items-center justify-between gap-3 bg-brand-dark px-4 py-2.5 text-left text-white"
                >
                  <span className="flex items-center gap-2">
                    <Building2 className="h-4 w-4 text-brand-goldlight" aria-hidden="true" />
                    <span className="text-sm font-semibold">{group.barangay}</span>
                    <span className="rounded-full bg-white/15 px-2 py-0.5 text-[11px] font-medium">
                      {group.count} document{group.count === 1 ? "" : "s"}
                    </span>
                  </span>
                  {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                </button>

                {open && (
                  <div className="divide-y divide-brand-border">
                    {group.categories.map(({ category, items }) => (
                      <section key={category}>
                        <div className="flex items-center gap-2 bg-brand-light/60 px-4 py-1.5">
                          <Layers className="h-3.5 w-3.5 text-brand-blue" aria-hidden="true" />
                          <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-brand-blue">{category}</h3>
                          <span className="text-[11px] text-brand-gray">· {items.length}</span>
                        </div>
                        <div className="overflow-x-auto">
                          <table className="w-full min-w-[640px] text-sm">
                            <thead>
                              <tr className="text-left">
                                {["TCL Document", "Submitted By", "Date Submitted", "Status", "Action"].map((h, i) => (
                                  <th key={h || i} className={`px-4 py-2 text-[11px] font-medium uppercase tracking-wide text-brand-gray ${i === 4 ? "text-right" : ""}`}>{h}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-brand-border">
                              {items.map((s) => (
                                <tr key={s.id} className="hover:bg-brand-light/50">
                                  <td className="px-4 py-2.5 text-brand-ink">
                                    <span className="block max-w-[280px] truncate" title={s.documentName}>{s.documentName}</span>
                                  </td>
                                  <td className="px-4 py-2.5">
                                    <p className="text-brand-ink">{s.senderName || "—"}</p>
                                    <p className="text-[11px] text-brand-gray">{ROLE_LABELS[s.senderRole] || s.senderRole}</p>
                                  </td>
                                  <td className="whitespace-nowrap px-4 py-2.5 text-brand-gray">{formatDate(s.effectiveIso)}</td>
                                  <td className="px-4 py-2.5"><StatusBadge raw={s.status} /></td>
                                  <td className="px-4 py-2.5 text-right"><RowActions s={s} /></td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </section>
                    ))}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {/* ---- Document detail + review drawer ---- */}
      {detail && (
        <div className="fixed inset-0 z-[70]">
          <div className="absolute inset-0 bg-black/60" onClick={closeDetail} />
          <div className="absolute right-0 top-0 flex h-full w-full max-w-2xl flex-col bg-white shadow-2xl dark:bg-card">
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-brand-border px-5 py-4">
              <div className="min-w-0">
                <p className="truncate text-base font-semibold text-brand-ink">{detail.documentName}</p>
                <p className="text-xs text-brand-gray">{detail.barangayName} · {detail.category}</p>
              </div>
              <button onClick={closeDetail} className="text-brand-gray hover:text-brand-ink" aria-label="Close"><X className="h-5 w-5" /></button>
            </div>

            <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
              <section className="rounded-2xl border border-brand-border bg-white p-4 dark:bg-card">
                <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-brand-gray">Submission Information</p>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <p className="text-[11px] uppercase tracking-wide text-brand-gray">Submitted By</p>
                    <p className="mt-0.5 font-medium text-brand-ink">{detail.senderName || "—"}</p>
                    <p className="text-[11px] text-brand-gray">{ROLE_LABELS[detail.senderRole] || detail.senderRole}</p>
                  </div>
                  <div>
                    <p className="text-[11px] uppercase tracking-wide text-brand-gray">Date Submitted</p>
                    <p className="mt-0.5 font-medium text-brand-ink">{formatDateTime(detail.submittedAt || detail.createdAt)}</p>
                  </div>
                  <div>
                    <p className="text-[11px] uppercase tracking-wide text-brand-gray">Reporting Period</p>
                    <p className="mt-0.5 font-medium text-brand-ink">{detail.reportPeriod || "—"}</p>
                  </div>
                  <div>
                    <p className="text-[11px] uppercase tracking-wide text-brand-gray">Status</p>
                    <div className="mt-1"><StatusBadge raw={detail.status} /></div>
                  </div>
                </div>
                {detail.remarks && (
                  <div className="mt-3 border-t border-brand-border pt-3">
                    <p className="text-[11px] uppercase tracking-wide text-brand-gray">Remarks</p>
                    <p className="mt-0.5 text-sm text-brand-ink">{detail.remarks}</p>
                  </div>
                )}
              </section>

              <section>
                <h4 className="mb-2 text-sm font-semibold text-brand-ink">Submitted Document</h4>
                {detailLoading ? (
                  <p className="inline-flex items-center gap-2 text-sm text-brand-gray">
                    <RefreshCw className="h-4 w-4 animate-spin" /> Loading submitted document…
                  </p>
                ) : detailError ? (
                  <div className="rounded-btn border border-brand-danger/30 bg-brand-danger/5 p-4 text-sm text-brand-danger">{detailError}</div>
                ) : (
                  <ReportSnapshotView content={detailContent?.content} />
                )}
              </section>

              {/* Review — PHN oversight. Only offered while the document is still
                  open (not already Reviewed/Returned) and the caller may review. */}
              {canReview && detail.status !== "Reviewed" && detail.status !== "Rejected" && (
                <section className="rounded-2xl border border-brand-blue/15 bg-brand-light/50 p-4 dark:bg-card">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-brand-gray">PHN Review</p>
                  <label className="text-sm font-medium text-brand-ink">Remarks <span className="text-brand-gray">(required to return)</span></label>
                  <textarea
                    rows={3}
                    value={remarks}
                    onChange={(e) => setRemarks(e.target.value)}
                    placeholder="Optional remarks, or the reason when returning the document…"
                    className="mt-1.5 w-full resize-none rounded-btn border border-brand-border bg-white px-3.5 py-2.5 text-sm outline-none focus:border-brand-blue dark:bg-input"
                  />
                  <div className="mt-3 flex flex-wrap gap-2">
                    {detail.status === "Submitted" && (
                      <button
                        disabled={busy}
                        onClick={() => act("Received")}
                        className="rounded-btn border border-brand-border px-4 py-2 text-sm font-medium text-brand-ink hover:border-brand-blue hover:text-brand-blue disabled:opacity-60"
                      >
                        Mark Under Review
                      </button>
                    )}
                    <button
                      disabled={busy}
                      onClick={() => act("Rejected")}
                      className="rounded-btn border border-brand-danger/30 px-4 py-2 text-sm font-medium text-brand-danger hover:bg-brand-danger/5 disabled:opacity-60"
                    >
                      Return
                    </button>
                    <button
                      disabled={busy}
                      onClick={() => act("Reviewed")}
                      className="rounded-btn bg-brand-blue px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-60"
                    >
                      Mark Reviewed
                    </button>
                  </div>
                </section>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
