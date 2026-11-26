// frontend/src/features/households/pages/HouseholdRiskOverview.jsx
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import PageHeader from "@/components/common/PageHeader";
import KpiHorizontal from "@/components/common/KpiHorizontal";
import TablePagination from "@/components/tables/TablePagination";
import { householdsApi } from "@/services/api/householdsApi";
import { householdRiskApi } from "@/services/api/householdRiskApi";
import { loadRiskClusters, daysSince } from "../lib/riskClusterAdapter";
import {
  RISK_LEVELS, RISK_LEVEL_LABELS,
} from "@/lib/householdRisk";
import { useBarangays } from "@/context/BarangaysContext";
import { usePermissions } from "@/context/PermissionsContext";
import { formatShortDate } from "@/lib/dateUtils";
import { FollowUpModal } from "../components/RiskActionModals";
import {
  Search, ArrowRight, AlertTriangle, RefreshCw,
} from "lucide-react";

const levelTone = {
  [RISK_LEVELS.STABLE]: { chip: "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300", dot: "bg-emerald-500", color: "#10b981" },
  [RISK_LEVELS.MONITOR]: { chip: "bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300", dot: "bg-amber-500", color: "#f59e0b" },
  [RISK_LEVELS.INTERVENTION]: { chip: "bg-orange-50 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300", dot: "bg-orange-500", color: "#f97316" },
  [RISK_LEVELS.PRIORITY]: { chip: "bg-rose-50 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300", dot: "bg-rose-500", color: "#ef4444" },
  [RISK_LEVELS.UNASSESSED]: { chip: "bg-brand-bg text-brand-gray dark:bg-hover dark:text-muted-foreground", dot: "bg-brand-gray", color: "#94a3b8" },
};

const levelOrder = [RISK_LEVELS.PRIORITY, RISK_LEVELS.INTERVENTION, RISK_LEVELS.MONITOR, RISK_LEVELS.STABLE, RISK_LEVELS.UNASSESSED];
const countKey = {
  [RISK_LEVELS.PRIORITY]: "priority",
  [RISK_LEVELS.INTERVENTION]: "intervention",
  [RISK_LEVELS.MONITOR]: "monitor",
  [RISK_LEVELS.STABLE]: "stable",
  [RISK_LEVELS.UNASSESSED]: "unassessed",
};
const clusterLabel = (level) => RISK_LEVEL_LABELS[level] || RISK_LEVEL_LABELS[RISK_LEVELS.UNASSESSED];
const filterControl = "h-10 w-full min-w-0 rounded-btn border border-brand-border bg-white px-3 text-sm text-brand-ink outline-none transition focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/20 dark:bg-card";
const filterLabel = "grid min-w-0 gap-1.5 text-xs font-medium text-brand-gray";

const formatDate = (iso) => formatShortDate(iso) || "—";

const daysAgo = (iso) => {
  const d = daysSince(iso);
  return d === null ? "—" : `${d} days ago`;
};

// Handles householdDetailPath logic.
function householdDetailPath(id) {
  const raw = typeof window !== "undefined" ? window.location.pathname : "/app/mho/households/risk-overview";
  const parts = raw.split("/").filter(Boolean);
  const appIdx = parts.indexOf("app");
  const role = appIdx >= 0 && parts[appIdx + 1] ? parts[appIdx + 1] : "mho";
  return `/app/${role}/households/${id}`;
}

// Renders or manages HouseholdRiskOverview logic.
export default function HouseholdRiskOverview() {
  const { can } = usePermissions();
  const canViewWorkflow = can("followups.view");
  const routeRole = typeof window !== "undefined"
    ? window.location.pathname.split("/").filter(Boolean)[1]
    : "phn";
  const isBarangayScoped = routeRole === "health_supervisor";
  const [phase, setPhase] = useState("loading");
  const [loadError, setLoadError] = useState("");
  const [clusters, setClusters] = useState([]);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 20;

  const load = useCallback(async () => {
    setPhase("loading");
    setLoadError("");
    try {
      const loaded = await loadRiskClusters({
        listHouseholds: (params) => householdsApi.list(params),
        getWorkflow: (id) => householdRiskApi.getWorkflow(id),
        includeWorkflow: canViewWorkflow,
      });
      setClusters(loaded);
      setPhase("ready");
    } catch (error) {
      setClusters([]);
      setLoadError(error?.payload?.error?.code === "HOUSEHOLD_CLUSTER_SCHEMA_REQUIRED"
        ? "Household cluster storage is unavailable. Apply the household cluster assignment migration and reload the API schema."
        : error?.message || "We couldn't retrieve the latest household risk information.");
      setPhase("error");
    }
  }, [canViewWorkflow]);

  useEffect(() => {
    load();
  }, [load]);

  const { barangays: liveBarangays } = useBarangays();
  const [query, setQuery] = useState("");
  const [barangayFilter, setBarangayFilter] = useState("All");
  const [levelFilter, setLevelFilter] = useState("all");
  const [indicatorFilter, setIndicatorFilter] = useState("all");
  const [followUpFilter, setFollowUpFilter] = useState("all");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [followUpFor, setFollowUpFor] = useState(null);
  const [toast, setToast] = useState(null);

  const showToast = (message) => {
    setToast(message);
    setTimeout(() => setToast(null), 3000);
  };

  const indicatorOptions = useMemo(() => {
    const seen = new Set();
    clusters.forEach((h) => (h.environmentalRisk?.factors || []).forEach((factor) => seen.add(factor)));
    return [...seen];
  }, [clusters]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return clusters.filter((h) => {
      if (barangayFilter !== "All" && h.barangay !== barangayFilter) return false;
      if (levelFilter !== "all" && h.risk?.level !== levelFilter) return false;
      if (followUpFilter !== "all") {
        const status = String(h.workflowStatus || "").toLowerCase();
        if (followUpFilter === "required" && !["follow-up scheduled", "intervention initiated", "monitoring"].some((s) => status.includes(s.split(" ")[0]))) return false;
        if (followUpFilter === "scheduled" && status !== "follow-up scheduled") return false;
        if (followUpFilter === "overdue" && !status.includes("overdue")) return false;
        if (followUpFilter === "resolved" && status !== "resolved") return false;
      }
      if (indicatorFilter !== "all" && !(h.environmentalRisk?.factors || []).includes(indicatorFilter)) return false;
      if (startDate || endDate) {
        const last = h.lastHouseholdVisit || h.lastAssessment || "";
        if (!last) return false;
        const visitDate = String(last).slice(0, 10);
        if (startDate && visitDate < startDate) return false;
        if (endDate && visitDate > endDate) return false;
      }
      if (q) {
        const hay = `${h.head} ${h.id} ${h.barangay} ${h.surname || ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [clusters, query, barangayFilter, levelFilter, followUpFilter, indicatorFilter, startDate, endDate]);

  const counts = useMemo(() => {
    const c = { total: filtered.length, priority: 0, intervention: 0, monitor: 0, stable: 0, unassessed: 0 };
    filtered.forEach((h) => {
      if (h.risk?.level === RISK_LEVELS.PRIORITY) c.priority += 1;
      else if (h.risk?.level === RISK_LEVELS.INTERVENTION) c.intervention += 1;
      else if (h.risk?.level === RISK_LEVELS.MONITOR) c.monitor += 1;
      else if (h.risk?.level === RISK_LEVELS.STABLE) c.stable += 1;
      else c.unassessed += 1;
    });
    return c;
  }, [filtered]);

  const openFollowUps = useMemo(() => {
    return filtered.filter((h) => {
      const status = String(h.workflowStatus || "").toLowerCase();
      return status && status !== "resolved" && status !== "not started";
    }).length;
  }, [filtered]);

  const byBarangay = useMemo(() => {
    const map = {};
    filtered.forEach((h) => {
      const b = h.barangay || "Unassigned";
      if (!map[b]) map[b] = { priority: 0, intervention: 0, monitor: 0, stable: 0, unassessed: 0, total: 0 };
      map[b].total += 1;
      if (h.risk?.level === RISK_LEVELS.PRIORITY) map[b].priority += 1;
      else if (h.risk?.level === RISK_LEVELS.INTERVENTION) map[b].intervention += 1;
      else if (h.risk?.level === RISK_LEVELS.MONITOR) map[b].monitor += 1;
      else if (h.risk?.level === RISK_LEVELS.STABLE) map[b].stable += 1;
      else map[b].unassessed += 1;
    });
    return Object.entries(map).sort((a, b) => b[1].priority - a[1].priority);
  }, [filtered]);

  const indicatorBreakdown = useMemo(() => {
    const map = {};
    filtered.forEach((h) => new Set(h.environmentalRisk?.factors || []).forEach((factor) => {
      map[factor] = (map[factor] || 0) + 1;
    }));
    return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 6);
  }, [filtered]);

  const visiblePriorityList = useMemo(
    () => filtered
      .filter((h) => h.risk?.level === RISK_LEVELS.PRIORITY || h.risk?.level === RISK_LEVELS.INTERVENTION)
      .sort((a, b) => levelOrder.indexOf(a.risk.level) - levelOrder.indexOf(b.risk.level)),
    [filtered]
  );

  const clearFilters = () => {
    setQuery("");
    setBarangayFilter("All");
    setLevelFilter("all");
    setIndicatorFilter("all");
    setFollowUpFilter("all");
    setStartDate("");
    setEndDate("");
  };

  // Pagination
  const totalPages = Math.ceil(filtered.length / itemsPerPage);
  const paginatedData = filtered.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  useEffect(() => {
    setCurrentPage(1);
  }, [query, barangayFilter, levelFilter, indicatorFilter, followUpFilter, startDate, endDate]);

  if (phase === "loading") {
    return (
      <>
        <PageHeader
          eyebrow="HOUSEHOLD MONITORING"
          title="Household Risk Overview"
          subtitle="Monitor household health risks, review risk classifications, and identify households requiring attention."
          meta={
            <span className="text-xs font-semibold uppercase tracking-gov text-white/70">
              Loading...
            </span>
          }
        />
        <div className="space-y-6">
          <div className="h-32 animate-pulse rounded-card bg-brand-bg dark:bg-hover" />
          <div className="h-16 animate-pulse rounded-card bg-brand-bg dark:bg-hover" />
          <div className="h-96 animate-pulse rounded-card bg-brand-bg dark:bg-hover" />
        </div>
      </>
    );
  }

  if (phase === "error") {
    return (
      <>
        <PageHeader
          eyebrow="HOUSEHOLD MONITORING"
          title="Household Risk Overview"
          subtitle="Monitor household health risks, review risk classifications, and identify households requiring attention."
          meta={
            <span className="text-xs font-semibold uppercase tracking-gov text-white/70">
              {new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
            </span>
          }
        />
        <div className="rounded-card border border-brand-border bg-white p-8 text-center shadow-sm dark:bg-card sm:p-12">
          <div className="mx-auto flex h-16 w-16 items-center justify-center">
            <AlertTriangle className="h-12 w-12 text-rose-500" />
          </div>
          <h3 className="mt-4 text-lg font-semibold tracking-tight text-brand-ink">Unable to Load Household Risk Data</h3>
          <p className="mx-auto mt-2 max-w-md text-sm text-brand-gray">
            {loadError || "We couldn&apos;t retrieve the latest household risk information."}
          </p>
          <button onClick={() => load()} className="mt-6 inline-flex h-10 items-center gap-2 rounded-lg bg-blue-600 px-5 text-sm font-medium text-white transition-colors hover:bg-blue-700">
            <RefreshCw className="h-4 w-4" /> Retry
          </button>
        </div>
      </>
    );
  }

  const noData = clusters.length === 0;

  return (
    <>
      <PageHeader
        eyebrow="HOUSEHOLD MONITORING"
        title="Household Risk Overview"
        subtitle="Monitor household health risks, review risk classifications, and identify households requiring attention."
        meta={
          <span className="text-xs font-semibold uppercase tracking-gov text-white/70">
            {new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
          </span>
        }
      />

      <div className="mx-auto max-w-[1400px]">
        {/* Exactly 4 KPIs - Standardized Design */}
        <div className="mb-6 phn-kpi-white">
          <KpiHorizontal count={4}>
            <KpiHorizontal.Item
              label="HOUSEHOLDS MONITORED"
              value={counts.total}
              tone="blue"
              description="Households matching current filters"
            />
            <KpiHorizontal.Item
              label="PRIORITY"
              value={counts.priority}
              tone="red"
              description="Matching households with Priority assignment"
            />
            <KpiHorizontal.Item
              label="INTERVENTION"
              value={counts.intervention}
              tone="amber"
              description="Matching households with Intervention assignment"
            />
            <KpiHorizontal.Item
              label="OPEN FOLLOW-UPS"
              value={openFollowUps}
              tone="amber"
              description="Matching households with an unfinished plan"
            />
          </KpiHorizontal>
        </div>



        <section aria-label="Filter household risk data" className="mb-6 rounded-card border border-brand-border bg-white p-4 shadow-sm dark:bg-card sm:p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-brand-ink">Filter households</h2>
              <p className="mt-0.5 text-xs text-brand-gray">Metrics and lists update as filters change.</p>
            </div>
            <button type="button" onClick={clearFilters} className="inline-flex h-9 items-center rounded-btn px-3 text-sm font-medium text-brand-blue transition hover:bg-brand-blue/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/30">
              Clear filters
            </button>
          </div>
          <div className={`grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 ${isBarangayScoped ? "2xl:grid-cols-7" : "2xl:grid-cols-8"}`}>
            <label className={`${filterLabel} sm:col-span-2 lg:col-span-3 2xl:col-span-2`}>
              <span className="min-h-5 leading-5">Search</span>
              <span className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-brand-gray" />
                <input aria-label="Search household ID or name" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Household ID, head, or barangay" className={`${filterControl} pl-10 placeholder:text-brand-gray/70`} />
              </span>
            </label>
            {!isBarangayScoped && (
              <label className={filterLabel}><span className="min-h-5 leading-5">Barangay</span>
                <select aria-label="Filter by barangay" value={barangayFilter} onChange={(e) => setBarangayFilter(e.target.value)} className={filterControl}>
                  <option value="All">All barangays</option>
                  {liveBarangays.map((b) => <option key={b} value={b}>{b}</option>)}
                </select>
              </label>
            )}
            <label className={filterLabel}><span className="min-h-5 leading-5">Cluster</span>
              <select aria-label="Filter by cluster assignment" value={levelFilter} onChange={(e) => setLevelFilter(e.target.value)} className={filterControl}>
                <option value="all">All clusters</option>
                {levelOrder.map((level) => <option key={level} value={level}>{RISK_LEVEL_LABELS[level]}</option>)}
              </select>
            </label>
            <label className={filterLabel}><span className="min-h-5 leading-5">Indicator</span>
              <select aria-label="Filter by environmental indicator" value={indicatorFilter} onChange={(e) => setIndicatorFilter(e.target.value)} className={filterControl}>
                <option value="all">All indicators</option>
                {indicatorOptions.map((factor) => <option key={factor} value={factor}>{factor}</option>)}
              </select>
            </label>
            <label className={filterLabel}><span className="min-h-5 leading-5">Follow-up</span>
              <select aria-label="Filter by follow-up status" value={followUpFilter} onChange={(e) => setFollowUpFilter(e.target.value)} className={filterControl}>
                <option value="all">All statuses</option>
                <option value="required">Required</option>
                <option value="scheduled">Scheduled</option>
                <option value="overdue">Overdue</option>
                <option value="resolved">Resolved</option>
              </select>
            </label>
            <label className={`${filterLabel} 2xl:col-span-1`}><span className="min-h-5 leading-5">Visit from</span>
              <input aria-label="Visit date from" type="date" value={startDate} max={endDate || undefined} onChange={(e) => setStartDate(e.target.value)} className={`${filterControl} px-2`} />
            </label>
            <label className={`${filterLabel} 2xl:col-span-1`}><span className="min-h-5 leading-5">Visit to</span>
              <input aria-label="Visit date to" type="date" value={endDate} min={startDate || undefined} onChange={(e) => setEndDate(e.target.value)} className={`${filterControl} px-2`} />
            </label>
          </div>
          <p className="mt-3 text-xs text-brand-gray" aria-live="polite">Showing <span className="font-semibold text-brand-ink">{filtered.length}</span> of {clusters.length} households</p>
        </section>

        {/* Priority Households */}
        <div id="priority-section" className="mb-6 rounded-card border border-brand-border bg-white p-4 shadow-sm dark:bg-card sm:p-6">
          <div className="mb-5 flex items-end justify-between">
            <div>
              <h2 className="text-lg font-semibold tracking-tight text-brand-ink">Priority and Intervention households</h2>
              <p className="mt-1 text-sm text-brand-gray">Households with one of these explicit cluster assignments</p>
            </div>
            <div className="flex items-center gap-4">
              <span className="text-sm text-brand-gray">
                <span className="font-semibold text-brand-ink">{visiblePriorityList.length}</span> households
              </span>
              <button
                onClick={() => document.getElementById("records-section")?.scrollIntoView({ behavior: "smooth" })}
                className="inline-flex items-center gap-1 text-sm font-medium text-blue-600 hover:text-blue-700"
              >
                View all <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          </div>

          {visiblePriorityList.length === 0 ? (
            <div className="py-12 text-center">
                <p className="text-sm font-medium text-brand-ink">No Priority or Intervention cluster assignments are recorded.</p>
                <p className="mt-1 text-sm text-brand-gray">
                  {noData ? "Household cluster assignments will appear here when recorded." : "This list does not infer cluster assignments from environmental risk."}
              </p>
            </div>
          ) : (
            <>
            <div className="hidden overflow-x-auto sm:block">
              <table className="w-full min-w-[980px]">
                <thead>
                  <tr className="border-b border-brand-border bg-brand-bg dark:bg-hover">
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-brand-gray">ID</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-brand-gray">Head of Household</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-brand-gray">Barangay</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-brand-gray">Cluster Assignment</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-brand-gray">Environmental Indicators</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-brand-gray">Follow-up</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-brand-gray">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {visiblePriorityList.map((h) => {
                    const tone = levelTone[h.risk?.level] || levelTone[RISK_LEVELS.UNASSESSED];
                    const indicators = (h.environmentalRisk?.factors || []).join(", ");
                    return (
                      <tr key={h.id} className="transition-colors hover:bg-brand-bg dark:bg-hover">
                        <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-brand-gray">{h.id}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-sm font-medium text-brand-ink">{h.head || "—"}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-sm text-brand-gray">{h.barangay || "—"}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${tone.chip}`}>
                            <span className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} />
                            {clusterLabel(h.risk?.level)}
                          </span>
                        </td>
                        <td className="max-w-xs px-4 py-3">
                          <div className="truncate text-sm text-brand-ink" title={indicators}>
                            {indicators || "No environmental indicators recorded"}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-sm text-brand-gray">{h.workflowStatus || "—"}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-right">
                          <div className="inline-flex items-center gap-2">
                            <Link
                              to={householdDetailPath(h.id)}
                              className="text-sm font-medium text-blue-600 hover:text-blue-700"
                            >
                              View
                            </Link>
                            <button
                              type="button"
                              onClick={() => setFollowUpFor(h.id)}
                              className="rounded-lg bg-blue-900 px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-blue-800"
                            >
                              Follow-up
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="grid gap-2 sm:hidden">
              {visiblePriorityList.map((h) => {
                const tone = levelTone[h.risk?.level] || levelTone[RISK_LEVELS.UNASSESSED];
                const indicators = (h.environmentalRisk?.factors || []).join(", ");
                return (
                  <article key={h.id} className="rounded-btn border border-brand-border p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-brand-ink">{h.head || "Unnamed"} Household</p>
                        <p className="mt-0.5 font-mono text-xs text-brand-gray">{h.id}</p>
                        <p className="mt-1 text-xs text-brand-gray">{h.barangay || "—"}</p>
                      </div>
                    </div>
                    <dl className="mt-3 grid grid-cols-1 gap-y-2 border-t border-brand-border pt-3">
                      <div>
                        <dt className="text-[11px] font-medium text-brand-gray">Cluster assignment</dt>
                        <dd className="mt-1">
                          <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${tone.chip}`}>
                            <span className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} />
                            {clusterLabel(h.risk?.level)}
                          </span>
                        </dd>
                      </div>
                      <div>
                        <dt className="text-[11px] font-medium text-brand-gray">Environmental indicators</dt>
                        <dd className="mt-0.5 break-words text-sm text-brand-ink">{indicators || "No environmental indicators recorded"}</dd>
                      </div>
                      <div>
                        <dt className="text-[11px] font-medium text-brand-gray">Workflow status</dt>
                        <dd className="mt-0.5 break-words text-sm text-brand-ink">{h.workflowStatus || "—"}</dd>
                      </div>
                    </dl>
                    <div className="mt-3 flex items-center justify-end gap-3 border-t border-brand-border pt-3">
                      <Link to={householdDetailPath(h.id)} className="text-sm font-medium text-blue-600 hover:text-blue-700">View</Link>
                      <button
                        type="button"
                        onClick={() => setFollowUpFor(h.id)}
                        className="rounded-lg bg-blue-900 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-800"
                      >
                        Follow-up
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
            </>
          )}
        </div>

        {/* Analytics Section */}
        <div id="overview-section" className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Household Risk Distribution */}
          <div className="rounded-card border border-brand-border bg-white p-4 shadow-sm dark:bg-card sm:p-6">
            <h2 className="text-lg font-semibold tracking-tight text-brand-ink">Household risk distribution</h2>
            <p className="mt-1 text-sm text-brand-gray">Risk classifications among {counts.total} matching households</p>

            {counts.total === 0 ? (
              <p className="py-10 text-center text-sm text-brand-gray">No distribution data available.</p>
            ) : (
              <div className="mt-6 space-y-4">
                {levelOrder.map((level) => {
                  const value = counts[countKey[level]];
                  const percentage = Math.round((value / counts.total) * 100);
                  const tone = levelTone[level];
                  return (
                    <div key={level}>
                      <div className="mb-2 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className={`h-2 w-2 rounded-full ${tone.dot}`} />
                          <span className="text-sm font-medium text-brand-ink">{RISK_LEVEL_LABELS[level]}</span>
                        </div>
                        <div className="flex items-baseline gap-2">
                          <span className="text-sm font-semibold text-brand-ink">{value}</span>
                          <span className="text-xs text-brand-gray">({percentage}%)</span>
                        </div>
                      </div>
                      <div className="h-2 w-full overflow-hidden rounded-full bg-brand-bg dark:bg-hover">
                        <div
                          className="h-full rounded-full"
                          style={{ width: `${percentage}%`, backgroundColor: tone.color }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Top Household Risk Indicators */}
          <div className="rounded-card border border-brand-border bg-white p-4 shadow-sm dark:bg-card sm:p-6">
            <h2 className="text-lg font-semibold tracking-tight text-brand-ink">Top household risk indicators</h2>
            <p className="mt-1 text-sm text-brand-gray">Households with each indicator in the current filtered set</p>

            {indicatorBreakdown.length === 0 ? (
              <p className="py-10 text-center text-sm text-brand-gray">No risk indicators recorded yet.</p>
            ) : (
              <div className="mt-6 space-y-4">
                {indicatorBreakdown.map(([label, val]) => {
                  const percentage = counts.total ? Math.round((val / counts.total) * 100) : 0;
                  return (
                    <div key={label}>
                      <div className="mb-2 flex items-center justify-between">
                        <span className="text-sm font-medium text-brand-ink">{label}</span>
                        <span className="text-sm font-semibold text-brand-ink">{val} <span className="font-normal text-brand-gray">({percentage}%)</span></span>
                      </div>
                      <div className="h-2 w-full overflow-hidden rounded-full bg-brand-bg dark:bg-hover">
                        <div
                          className="h-full rounded-full bg-blue-600"
                          style={{ width: `${percentage}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Risk by Barangay */}
        <div id="barangays-section" className="mb-6 rounded-card border border-brand-border bg-white p-4 shadow-sm dark:bg-card sm:p-6">
          <h2 className="text-lg font-semibold tracking-tight text-brand-ink">Risk by barangay</h2>
          <p className="mt-1 text-sm text-brand-gray">Risk distribution among households matching the current filters</p>

          <div className="mt-6 hidden sm:block">
            <table className="w-full table-fixed">
              <thead>
                <tr className="border-b border-brand-border bg-brand-bg dark:bg-hover">
                  <th className="w-[40%] px-3 py-3 text-left text-xs font-semibold uppercase tracking-wider text-brand-gray">Barangay</th>
                  <th className="w-[20%] px-3 py-3 text-right text-xs font-semibold uppercase tracking-wider text-brand-gray">Priority</th>
                  <th className="w-[20%] px-3 py-3 text-right text-xs font-semibold uppercase tracking-wider text-brand-gray">Intervention</th>
                  <th className="w-[20%] px-3 py-3 text-right text-xs font-semibold uppercase tracking-wider text-brand-gray">Monitor</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {byBarangay.map(([name, c]) => (
                  <tr key={name} className="transition-colors hover:bg-brand-bg dark:bg-hover">
                    <td className="px-3 py-3 text-sm font-medium text-brand-ink">{name}</td>
                    <td className="px-3 py-3 text-right tabular-nums">
                      <span className={`text-sm font-semibold ${c.priority > 0 ? "text-rose-600" : "text-brand-gray"}`}>
                        {c.priority}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums">
                      <span className={`text-sm font-semibold ${c.intervention > 0 ? "text-orange-600" : "text-brand-gray"}`}>
                        {c.intervention}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums">
                      <span className={`text-sm font-semibold ${c.monitor > 0 ? "text-blue-600" : "text-brand-gray"}`}>
                        {c.monitor}
                      </span>
                    </td>
                  </tr>
                ))}
                {byBarangay.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-10 text-center text-sm text-brand-gray">
                      No barangay data available.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="mt-4 grid gap-2 sm:hidden">
            {byBarangay.map(([name, c]) => (
              <article key={name} className="rounded-btn border border-brand-border p-3">
                <p className="mb-2 text-sm font-semibold text-brand-ink">{name}</p>
                <dl className="grid grid-cols-3 gap-2">
                  <div><dt className="text-[11px] text-brand-gray">Priority</dt><dd className="mt-0.5 text-base font-semibold tabular-nums text-rose-600">{c.priority}</dd></div>
                  <div><dt className="text-[11px] text-brand-gray">Intervention</dt><dd className="mt-0.5 text-base font-semibold tabular-nums text-orange-600">{c.intervention}</dd></div>
                  <div><dt className="text-[11px] text-brand-gray">Monitor</dt><dd className="mt-0.5 text-base font-semibold tabular-nums text-blue-600">{c.monitor}</dd></div>
                </dl>
              </article>
            ))}
            {byBarangay.length === 0 && <p className="py-8 text-center text-sm text-brand-gray">No barangay data available.</p>}
          </div>
        </div>

        {/* All Household Records */}
        <div id="records-section" className="rounded-card border border-brand-border bg-white p-4 shadow-sm dark:bg-card sm:p-6">
          <div className="mb-5 flex items-end justify-between">
            <div>
              <h2 className="text-lg font-semibold tracking-tight text-brand-ink">All household records</h2>
              <p className="mt-1 text-sm text-brand-gray">Complete registry of monitored households</p>
            </div>
            <span className="text-sm font-semibold text-brand-ink">{filtered.length} households</span>
          </div>

          <div className="hidden overflow-x-auto sm:block">
            <table className="w-full table-fixed">
              <thead>
                <tr className="border-b border-brand-border bg-brand-bg dark:bg-hover">
                  <th className="w-[20%] px-3 py-3 text-left text-xs font-semibold uppercase tracking-wider text-brand-gray">Household</th>
                  <th className="w-[15%] px-3 py-3 text-left text-xs font-semibold uppercase tracking-wider text-brand-gray">Barangay</th>
                  <th className="w-[15%] px-3 py-3 text-left text-xs font-semibold uppercase tracking-wider text-brand-gray">Risk Level</th>
                  <th className="w-[10%] px-3 py-3 text-left text-xs font-semibold uppercase tracking-wider text-brand-gray">Indicators</th>
                  <th className="w-[17%] px-3 py-3 text-left text-xs font-semibold uppercase tracking-wider text-brand-gray">Last Visit</th>
                  <th className="w-[17%] px-3 py-3 text-left text-xs font-semibold uppercase tracking-wider text-brand-gray">Follow-up</th>
                  <th className="w-[6%] px-3 py-3 text-right text-xs font-semibold uppercase tracking-wider text-brand-gray">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {paginatedData.map((h) => {
                  const tone = levelTone[h.risk?.level] || levelTone[RISK_LEVELS.UNASSESSED];
                  return (
                    <tr key={h.id} className="transition-colors hover:bg-brand-bg dark:bg-hover">
                      <td className="px-3 py-3">
                        <div className="truncate text-sm font-medium text-brand-ink" title={`${h.head} Household`}>{h.head} Household</div>
                        <div className="mt-0.5 font-mono text-xs text-brand-gray">{h.id}</div>
                      </td>
                      <td className="px-3 py-3 text-sm text-brand-gray">{h.barangay || "—"}</td>
                      <td className="px-3 py-3">
                        <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${tone.chip}`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} />
                          {clusterLabel(h.risk?.level)}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-sm tabular-nums text-brand-ink">{h.indicatorCount}</td>
                      <td className="px-3 py-3 text-sm text-brand-gray">{h.lastHouseholdVisit ? formatDate(h.lastHouseholdVisit) : "—"}</td>
                      <td className="px-3 py-3 text-sm text-brand-gray">{h.nextScheduledFollowUp ? formatDate(h.nextScheduledFollowUp) : "—"}</td>
                      <td className="px-3 py-3 text-right">
                        <Link
                          to={householdDetailPath(h.id)}
                          className="text-sm font-medium text-blue-600 hover:text-blue-700"
                        >
                          View
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="grid gap-3 sm:hidden">
            {paginatedData.map((h) => {
              const tone = levelTone[h.risk?.level] || levelTone[RISK_LEVELS.UNASSESSED];
              return (
                <article key={h.id} className="rounded-btn border border-brand-border p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="break-words text-sm font-semibold text-brand-ink">{h.head || "Unnamed"} Household</p>
                      <p className="mt-0.5 break-all font-mono text-xs text-brand-gray">{h.id}</p>
                    </div>
                    <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${tone.chip}`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} />
                      {clusterLabel(h.risk?.level)}
                    </span>
                  </div>
                  <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 border-t border-brand-border pt-3">
                    <div className="min-w-0">
                      <dt className="text-[11px] font-medium text-brand-gray">Barangay</dt>
                      <dd className="mt-0.5 break-words text-sm text-brand-ink">{h.barangay || "—"}</dd>
                    </div>
                    <div>
                      <dt className="text-[11px] font-medium text-brand-gray">Indicators</dt>
                      <dd className="mt-0.5 text-sm font-semibold tabular-nums text-brand-ink">{h.indicatorCount}</dd>
                    </div>
                    <div>
                      <dt className="text-[11px] font-medium text-brand-gray">Last visit</dt>
                      <dd className="mt-0.5 text-sm text-brand-ink">{h.lastHouseholdVisit ? formatDate(h.lastHouseholdVisit) : "—"}</dd>
                    </div>
                    <div>
                      <dt className="text-[11px] font-medium text-brand-gray">Scheduled follow-up</dt>
                      <dd className="mt-0.5 text-sm text-brand-ink">{h.nextScheduledFollowUp ? formatDate(h.nextScheduledFollowUp) : "—"}</dd>
                    </div>
                  </dl>
                  <div className="mt-3 flex justify-end border-t border-brand-border pt-3">
                    <Link to={householdDetailPath(h.id)} className="text-sm font-medium text-blue-600 hover:text-blue-700">View</Link>
                  </div>
                </article>
              );
            })}
          </div>

          {filtered.length === 0 && !noData && (
            <p className="px-4 py-10 text-center text-sm text-brand-gray">No households match your filters.</p>
          )}
          {filtered.length === 0 && noData && (
            <p className="px-4 py-10 text-center text-sm text-brand-gray">No household risk data recorded yet.</p>
          )}

          {/* Pagination */}
          {filtered.length > 0 && totalPages > 1 && (
            <TablePagination
              total={filtered.length}
              page={currentPage}
              pageSize={itemsPerPage}
              onPageChange={setCurrentPage}
              showPageSize={false}
              itemLabel="records"
              className="mt-4"
            />
          )}
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-4 right-4 z-50 rounded-card border border-brand-border bg-white px-4 py-3 shadow-lg dark:bg-card">
          <span className="text-sm text-brand-ink">{toast}</span>
        </div>
      )}

      {/* Follow-up Modal */}
      {followUpFor && (() => {
        const target = clusters.find((h) => h.id === followUpFor);
        if (!target) return null;
        return (
          <FollowUpModal
            household={target}
            onClose={() => setFollowUpFor(null)}
            onSave={(status, notes) => {
              const followUpCount = (target.followUpCount || 0) + 1;
              const lastFollowUpAt = new Date().toISOString().slice(0, 10);
              householdRiskApi
                .saveWorkflow(target.id, { workflowStatus: status, followUpCount, lastFollowUpAt, lastNote: notes })
                .then(() => {
                  showToast(`Follow-up recorded for the ${target.surname || target.head} household.`);
                  load();
                })
                .catch((err) => showToast(err?.message || "Could not save the follow-up."));
              setFollowUpFor(null);
            }}
          />
        );
      })()}
    </>
  );
}
