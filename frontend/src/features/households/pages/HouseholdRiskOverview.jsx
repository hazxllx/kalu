import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import PageHeader from "@/components/common/PageHeader";
import KpiHorizontal from "@/components/common/KpiHorizontal";
import TablePagination from "@/components/tables/TablePagination";
import { householdsApi } from "@/services/api/householdsApi";
import { householdRiskApi } from "@/services/api/householdRiskApi";
import { toRiskCluster, daysSince } from "../lib/riskClusterAdapter";
import {
  RISK_LEVELS, RISK_LEVEL_LABELS, getRiskConfig,
} from "@/lib/householdRisk";
import { useBarangays } from "@/context/BarangaysContext";
import { formatShortDate } from "@/lib/dateUtils";
import { FollowUpModal } from "../components/RiskActionModals";
import {
  Search, ChevronRight, ArrowRight, AlertTriangle, RefreshCw,
} from "lucide-react";

const levelTone = {
  [RISK_LEVELS.STABLE]: { chip: "bg-emerald-50 text-emerald-700", dot: "bg-emerald-500", color: "#10b981" },
  [RISK_LEVELS.MONITOR]: { chip: "bg-blue-50 text-blue-700", dot: "bg-blue-500", color: "#3b82f6" },
  [RISK_LEVELS.INTERVENTION]: { chip: "bg-orange-50 text-orange-700", dot: "bg-orange-500", color: "#f97316" },
  [RISK_LEVELS.PRIORITY]: { chip: "bg-rose-50 text-rose-700", dot: "bg-rose-500", color: "#ef4444" },
};

const levelOrder = [RISK_LEVELS.PRIORITY, RISK_LEVELS.INTERVENTION, RISK_LEVELS.MONITOR, RISK_LEVELS.STABLE];

const formatDate = (iso) => formatShortDate(iso) || "—";

const daysAgo = (iso) => {
  const d = daysSince(iso);
  return d === null ? "—" : `${d} days ago`;
};

function householdDetailPath(id) {
  const raw = typeof window !== "undefined" ? window.location.pathname : "/app/mho/households/risk-overview";
  const parts = raw.split("/").filter(Boolean);
  const appIdx = parts.indexOf("app");
  const role = appIdx >= 0 && parts[appIdx + 1] ? parts[appIdx + 1] : "mho";
  return `/app/${role}/households/${id}`;
}

export default function HouseholdRiskOverview() {
  const [phase, setPhase] = useState("loading");
  const [clusters, setClusters] = useState([]);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 20;

  const load = useCallback(async () => {
    setPhase("loading");
    try {
      const res = await householdsApi.list({ limit: 200 });
      const rows = Array.isArray(res?.rows) ? res.rows : [];
      const workflows = await Promise.all(
        rows.map((h) => householdRiskApi.getWorkflow(h.id).catch(() => null))
      );
      setClusters(rows.map((h, i) => toRiskCluster(h, workflows[i])));
      setPhase("ready");
    } catch {
      setClusters([]);
      setPhase("error");
    }
  }, []);

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
  const [appliedFilters, setAppliedFilters] = useState({
    query: "",
    barangayFilter: "All",
    levelFilter: "all",
    indicatorFilter: "all",
    followUpFilter: "all",
    startDate: "",
    endDate: "",
  });
  const [followUpFor, setFollowUpFor] = useState(null);
  const [toast, setToast] = useState(null);

  const showToast = (message) => {
    setToast(message);
    setTimeout(() => setToast(null), 3000);
  };

  const indicatorOptions = useMemo(() => {
    const seen = new Set();
    clusters.forEach((h) => (h.risk?.indicators || []).forEach((i) => seen.add(i.key)));
    return [...seen];
  }, [clusters]);

  const filtered = useMemo(() => {
    const q = appliedFilters.query.trim().toLowerCase();
    return clusters.filter((h) => {
      if (appliedFilters.barangayFilter !== "All" && h.barangay !== appliedFilters.barangayFilter) return false;
      if (appliedFilters.levelFilter !== "all" && h.risk?.level !== appliedFilters.levelFilter) return false;
      if (appliedFilters.followUpFilter !== "all") {
        const status = String(h.workflowStatus || "").toLowerCase();
        if (appliedFilters.followUpFilter === "required" && !["follow-up scheduled", "intervention initiated", "monitoring"].some((s) => status.includes(s.split(" ")[0]))) return false;
        if (appliedFilters.followUpFilter === "scheduled" && status !== "follow-up scheduled") return false;
        if (appliedFilters.followUpFilter === "overdue" && !status.includes("overdue")) return false;
        if (appliedFilters.followUpFilter === "resolved" && status !== "resolved") return false;
      }
      if (appliedFilters.indicatorFilter !== "all" && !(h.risk?.indicators || []).some((i) => i.key === appliedFilters.indicatorFilter)) return false;
      if (appliedFilters.startDate || appliedFilters.endDate) {
        const last = h.lastHouseholdVisit || h.lastAssessment || "";
        if (last && appliedFilters.startDate && last < appliedFilters.startDate) return false;
        if (last && appliedFilters.endDate && last > appliedFilters.endDate) return false;
      }
      if (q) {
        const hay = `${h.head} ${h.id} ${h.barangay} ${h.surname || ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [clusters, appliedFilters]);

  const counts = useMemo(() => {
    const c = { total: clusters.length, priority: 0, intervention: 0, monitor: 0, stable: 0 };
    clusters.forEach((h) => {
      if (h.risk?.level === RISK_LEVELS.PRIORITY) c.priority += 1;
      else if (h.risk?.level === RISK_LEVELS.INTERVENTION) c.intervention += 1;
      else if (h.risk?.level === RISK_LEVELS.MONITOR) c.monitor += 1;
      else c.stable += 1;
    });
    return c;
  }, [clusters]);

  const openFollowUps = useMemo(() => {
    return clusters.filter((h) => {
      const status = String(h.workflowStatus || "").toLowerCase();
      return status && status !== "resolved" && status !== "not started";
    }).length;
  }, [clusters]);

  const byBarangay = useMemo(() => {
    const map = {};
    clusters.forEach((h) => {
      const b = h.barangay || "Unassigned";
      if (!map[b]) map[b] = { priority: 0, intervention: 0, monitor: 0, stable: 0, total: 0 };
      map[b].total += 1;
      if (h.risk?.level === RISK_LEVELS.PRIORITY) map[b].priority += 1;
      else if (h.risk?.level === RISK_LEVELS.INTERVENTION) map[b].intervention += 1;
      else if (h.risk?.level === RISK_LEVELS.MONITOR) map[b].monitor += 1;
      else map[b].stable += 1;
    });
    return Object.entries(map).sort((a, b) => b[1].priority - a[1].priority);
  }, [clusters]);

  const indicatorBreakdown = useMemo(() => {
    const map = {};
    clusters.forEach((h) => (h.risk?.indicators || []).forEach((i) => {
      map[i.label] = (map[i.label] || 0) + 1;
    }));
    return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 6);
  }, [clusters]);

  const visiblePriorityList = useMemo(
    () => filtered
      .filter((h) => h.risk?.level === RISK_LEVELS.PRIORITY || h.risk?.level === RISK_LEVELS.INTERVENTION)
      .sort((a, b) => (b.risk?.score || 0) - (a.risk?.score || 0)),
    [filtered]
  );

  const maxIndicatorCount = indicatorBreakdown.length ? indicatorBreakdown[0][1] : 1;

  const applyFilters = () => setAppliedFilters({
    query,
    barangayFilter,
    levelFilter,
    indicatorFilter,
    followUpFilter,
    startDate,
    endDate,
  });

  const clearFilters = () => {
    setQuery("");
    setBarangayFilter("All");
    setLevelFilter("all");
    setIndicatorFilter("all");
    setFollowUpFilter("all");
    setStartDate("");
    setEndDate("");
    setAppliedFilters({
      query: "",
      barangayFilter: "All",
      levelFilter: "all",
      indicatorFilter: "all",
      followUpFilter: "all",
      startDate: "",
      endDate: "",
    });
  };

  // Pagination
  const totalPages = Math.ceil(filtered.length / itemsPerPage);
  const paginatedData = filtered.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  useEffect(() => {
    setCurrentPage(1);
  }, [appliedFilters]);

  if (phase === "loading") {
    return (
      <>
        <PageHeader
          eyebrow="HOUSEHOLD MONITORING"
          title="Household Risk Overview"
          subtitle="Monitor household health risks, review risk classifications, and identify households requiring attention."
          meta={
            <span className="text-[10px] font-semibold uppercase tracking-gov text-white/70">
              Loading...
            </span>
          }
        />
        <div className="space-y-6">
          <div className="h-32 animate-pulse rounded-[20px] bg-slate-100" />
          <div className="h-16 animate-pulse rounded-[20px] bg-slate-100" />
          <div className="h-96 animate-pulse rounded-[20px] bg-slate-100" />
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
            <span className="text-[10px] font-semibold uppercase tracking-gov text-white/70">
              {new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
            </span>
          }
        />
        <div className="rounded-[20px] border border-blue-100 bg-white p-12 text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center">
            <AlertTriangle className="h-12 w-12 text-rose-500" />
          </div>
          <h3 className="mt-4 font-display text-xl font-medium text-slate-900">Unable to Load Household Risk Data</h3>
          <p className="mx-auto mt-2 max-w-md text-sm text-slate-600">
            We couldn&apos;t retrieve the latest household risk information.
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
          <span className="text-[10px] font-semibold uppercase tracking-gov text-white/70">
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
              description="Registered households in the registry"
            />
            <KpiHorizontal.Item
              label="PRIORITY REVIEW"
              value={counts.priority}
              tone="red"
              description="Households requiring immediate follow-up"
            />
            <KpiHorizontal.Item
              label="NEEDS INTERVENTION"
              value={counts.intervention}
              tone="amber"
              description="Households requiring active intervention"
            />
            <KpiHorizontal.Item
              label="OPEN FOLLOW-UPS"
              value={openFollowUps}
              tone="amber"
              description="Households with an unfinished follow-up plan"
            />
          </KpiHorizontal>
        </div>



        {/* Filters - Single Row */}
        <div className="mb-6 overflow-hidden rounded-[20px] border border-blue-100 bg-white p-4">
          <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:gap-2">
            {/* Search Input */}
            <div className="relative w-full lg:w-[220px] xl:w-[260px]">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search household ID or name"
                className="h-9 w-full rounded-lg border border-slate-200 bg-white pl-10 pr-3 text-sm text-slate-900 placeholder:text-slate-400 transition-colors focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
              />
            </div>

            {/* Barangay Dropdown */}
            <div className="w-full lg:w-[140px]">
              <select
                value={barangayFilter}
                onChange={(e) => setBarangayFilter(e.target.value)}
                className="h-9 w-full appearance-none rounded-lg border border-slate-200 bg-white px-3 pr-8 text-sm text-slate-900 transition-colors focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
                style={{
                  backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3E%3Cpath stroke='%2394a3b8' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='m6 8 4 4 4-4'/%3E%3C/svg%3E\")",
                  backgroundPosition: "right 0.5rem center",
                  backgroundRepeat: "no-repeat",
                  backgroundSize: "1.25rem 1.25rem",
                }}
              >
                <option value="All">All Barangays</option>
                {liveBarangays.map((b) => (
                  <option key={b} value={b}>{b}</option>
                ))}
              </select>
            </div>

            {/* Risk Level Dropdown */}
            <div className="w-full lg:w-[135px]">
              <select
                value={levelFilter}
                onChange={(e) => setLevelFilter(e.target.value)}
                className="h-9 w-full appearance-none rounded-lg border border-slate-200 bg-white px-3 pr-8 text-sm text-slate-900 transition-colors focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
                style={{
                  backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3E%3Cpath stroke='%2394a3b8' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='m6 8 4 4 4-4'/%3E%3C/svg%3E\")",
                  backgroundPosition: "right 0.5rem center",
                  backgroundRepeat: "no-repeat",
                  backgroundSize: "1.25rem 1.25rem",
                }}
              >
                <option value="all">All Risk Levels</option>
                {levelOrder.map((l) => (
                  <option key={l} value={l}>{RISK_LEVEL_LABELS[l]}</option>
                ))}
              </select>
            </div>

            {/* Indicators Dropdown */}
            <div className="w-full lg:w-[135px]">
              <select
                value={indicatorFilter}
                onChange={(e) => setIndicatorFilter(e.target.value)}
                className="h-9 w-full appearance-none rounded-lg border border-slate-200 bg-white px-3 pr-8 text-sm text-slate-900 transition-colors focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
                style={{
                  backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3E%3Cpath stroke='%2394a3b8' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='m6 8 4 4 4-4'/%3E%3C/svg%3E\")",
                  backgroundPosition: "right 0.5rem center",
                  backgroundRepeat: "no-repeat",
                  backgroundSize: "1.25rem 1.25rem",
                }}
              >
                <option value="all">All Indicators</option>
                {indicatorOptions.map((k) => {
                  const def = getRiskConfig().indicators.find((i) => i.key === k);
                  return <option key={k} value={k}>{def?.label || k}</option>;
                })}
              </select>
            </div>

            {/* Follow-up Status Dropdown */}
            <div className="w-full lg:w-[130px]">
              <select
                value={followUpFilter}
                onChange={(e) => setFollowUpFilter(e.target.value)}
                className="h-9 w-full appearance-none rounded-lg border border-slate-200 bg-white px-3 pr-8 text-sm text-slate-900 transition-colors focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
                style={{
                  backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3E%3Cpath stroke='%2394a3b8' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='m6 8 4 4 4-4'/%3E%3C/svg%3E\")",
                  backgroundPosition: "right 0.5rem center",
                  backgroundRepeat: "no-repeat",
                  backgroundSize: "1.25rem 1.25rem",
                }}
              >
                <option value="all">All Follow-up</option>
                <option value="required">Required</option>
                <option value="scheduled">Scheduled</option>
                <option value="overdue">Overdue</option>
                <option value="resolved">Resolved</option>
              </select>
            </div>

            {/* Date From */}
            <div className="w-full lg:w-[130px]">
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-xs text-slate-900 transition-colors focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
              />
            </div>

            {/* Date To */}
            <div className="w-full lg:w-[130px]">
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-xs text-slate-900 transition-colors focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
              />
            </div>

            {/* Clear Filters */}
            <button
              onClick={clearFilters}
              className="inline-flex h-9 items-center px-3 text-sm font-medium text-slate-600 transition-colors hover:text-slate-900 lg:ml-auto"
            >
              Clear
            </button>

            {/* Apply Filters */}
            <button
              onClick={applyFilters}
              className="inline-flex h-9 items-center rounded-lg bg-blue-600 px-4 text-sm font-medium text-white transition-colors hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
            >
              Apply
            </button>
          </div>
        </div>

        {/* Priority Households */}
        <div id="priority-section" className="mb-6 rounded-[20px] border border-blue-100 bg-white p-6">
          <div className="mb-5 flex items-end justify-between">
            <div>
              <h2 className="font-display text-2xl font-medium text-slate-900">Priority households</h2>
              <p className="mt-1 text-sm text-slate-600">Households requiring immediate follow-up and intervention</p>
            </div>
            <div className="flex items-center gap-4">
              <span className="text-sm text-slate-600">
                <span className="font-semibold text-slate-900">{visiblePriorityList.length}</span> households
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
              <p className="text-sm font-medium text-slate-900">No households currently require immediate review.</p>
              <p className="mt-1 text-sm text-slate-600">
                {noData ? "Household risk records will appear here when available." : "Households meeting the priority or intervention criteria will appear here."}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[980px]">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50">
                    <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500">ID</th>
                    <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500">Head of Household</th>
                    <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500">Barangay</th>
                    <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500">Risk Level</th>
                    <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500">Key Indicators</th>
                    <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500">Follow-up</th>
                    <th className="px-4 py-3 text-right text-[10px] font-semibold uppercase tracking-wider text-slate-500">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {visiblePriorityList.map((h) => {
                    const tone = levelTone[h.risk?.level || RISK_LEVELS.STABLE];
                    const indicators = (h.risk?.indicators || []).map((i) => i.label).join(", ");
                    return (
                      <tr key={h.id} className="transition-colors hover:bg-slate-50">
                        <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-slate-600">{h.id}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-sm font-medium text-slate-900">{h.head || "—"}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-600">{h.barangay || "—"}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${tone.chip}`}>
                            <span className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} />
                            {RISK_LEVEL_LABELS[h.risk?.level || RISK_LEVELS.STABLE]}
                          </span>
                        </td>
                        <td className="max-w-xs px-4 py-3">
                          <div className="truncate text-sm text-slate-700" title={indicators}>
                            {indicators || "No indicators listed"}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-sm text-slate-600">{h.workflowStatus || "—"}</td>
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
          )}
        </div>

        {/* Analytics Section */}
        <div id="overview-section" className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Household Risk Distribution */}
          <div className="rounded-[20px] border border-blue-100 bg-white p-6">
            <h2 className="font-display text-xl font-medium text-slate-900">Household risk distribution</h2>
            <p className="mt-1 text-sm text-slate-600">Household counts across current risk classifications</p>

            {counts.total === 0 ? (
              <p className="py-10 text-center text-sm text-slate-600">No distribution data available.</p>
            ) : (
              <div className="mt-6 space-y-4">
                {levelOrder.map((level) => {
                  const value = counts[level === RISK_LEVELS.PRIORITY ? "priority" : level === RISK_LEVELS.INTERVENTION ? "intervention" : level === RISK_LEVELS.MONITOR ? "monitor" : "stable"];
                  const percentage = Math.round((value / counts.total) * 100);
                  const tone = levelTone[level];
                  return (
                    <div key={level}>
                      <div className="mb-2 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className={`h-2 w-2 rounded-full ${tone.dot}`} />
                          <span className="text-sm font-medium text-slate-900">{RISK_LEVEL_LABELS[level]}</span>
                        </div>
                        <div className="flex items-baseline gap-2">
                          <span className="text-sm font-semibold text-slate-900">{value}</span>
                          <span className="text-xs text-slate-500">({percentage}%)</span>
                        </div>
                      </div>
                      <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
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
          <div className="rounded-[20px] border border-blue-100 bg-white p-6">
            <h2 className="font-display text-xl font-medium text-slate-900">Top household risk indicators</h2>
            <p className="mt-1 text-sm text-slate-600">Most frequently recorded indicators across households</p>

            {indicatorBreakdown.length === 0 ? (
              <p className="py-10 text-center text-sm text-slate-600">No risk indicators recorded yet.</p>
            ) : (
              <div className="mt-6 space-y-4">
                {indicatorBreakdown.map(([label, val]) => {
                  const percentage = Math.round((val / maxIndicatorCount) * 100);
                  return (
                    <div key={label}>
                      <div className="mb-2 flex items-center justify-between">
                        <span className="text-sm font-medium text-slate-900">{label}</span>
                        <span className="text-sm font-semibold text-slate-900">{val}</span>
                      </div>
                      <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
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
        <div id="barangays-section" className="mb-6 rounded-[20px] border border-blue-100 bg-white p-6">
          <h2 className="font-display text-xl font-medium text-slate-900">Risk by barangay</h2>
          <p className="mt-1 text-sm text-slate-600">Risk distribution comparison across all barangays</p>

          <div className="mt-6 overflow-x-auto">
            <table className="w-full min-w-[640px]">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50">
                  <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500">Barangay</th>
                  <th className="px-4 py-3 text-right text-[10px] font-semibold uppercase tracking-wider text-slate-500">Priority</th>
                  <th className="px-4 py-3 text-right text-[10px] font-semibold uppercase tracking-wider text-slate-500">Intervention</th>
                  <th className="px-4 py-3 text-right text-[10px] font-semibold uppercase tracking-wider text-slate-500">Monitor</th>
                  <th className="px-4 py-3 text-right text-[10px] font-semibold uppercase tracking-wider text-slate-500">Stable</th>
                  <th className="px-4 py-3 text-right text-[10px] font-semibold uppercase tracking-wider text-slate-500">Total</th>
                  <th className="px-4 py-3 text-right text-[10px] font-semibold uppercase tracking-wider text-slate-500">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {byBarangay.map(([name, c]) => (
                  <tr key={name} className="transition-colors hover:bg-slate-50">
                    <td className="px-4 py-3 text-sm font-medium text-slate-900">{name}</td>
                    <td className="px-4 py-3 text-right">
                      <span className={`text-sm font-semibold ${c.priority > 0 ? "text-rose-600" : "text-slate-400"}`}>
                        {c.priority}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className={`text-sm font-semibold ${c.intervention > 0 ? "text-orange-600" : "text-slate-400"}`}>
                        {c.intervention}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className={`text-sm font-semibold ${c.monitor > 0 ? "text-blue-600" : "text-slate-400"}`}>
                        {c.monitor}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className={`text-sm font-semibold ${c.stable > 0 ? "text-emerald-600" : "text-slate-400"}`}>
                        {c.stable}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right text-sm font-semibold text-slate-900">{c.total}</td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => {
                          setBarangayFilter(name);
                          setAppliedFilters((current) => ({ ...current, barangayFilter: name }));
                          window.scrollTo({ top: 0, behavior: "smooth" });
                        }}
                        className="text-sm font-medium text-blue-600 hover:text-blue-700"
                      >
                        View
                      </button>
                    </td>
                  </tr>
                ))}
                {byBarangay.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-10 text-center text-sm text-slate-600">
                      No barangay data available.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* All Household Records */}
        <div id="records-section" className="rounded-[20px] border border-blue-100 bg-white p-6">
          <div className="mb-5 flex items-end justify-between">
            <div>
              <h2 className="font-display text-xl font-medium text-slate-900">All household records</h2>
              <p className="mt-1 text-sm text-slate-600">Complete registry of monitored households</p>
            </div>
            <span className="text-sm font-semibold text-slate-900">{filtered.length} households</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px]">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50">
                  <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500">Household</th>
                  <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500">Barangay</th>
                  <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500">Risk Level</th>
                  <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500">Indicators</th>
                  <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500">Last Visit</th>
                  <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500">Follow-up</th>
                  <th className="px-4 py-3 text-right text-[10px] font-semibold uppercase tracking-wider text-slate-500">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {paginatedData.map((h) => {
                  const tone = levelTone[h.risk?.level || RISK_LEVELS.STABLE];
                  return (
                    <tr key={h.id} className="transition-colors hover:bg-slate-50">
                      <td className="px-4 py-3">
                        <div className="text-sm font-medium text-slate-900">{h.head} Household</div>
                        <div className="mt-0.5 font-mono text-xs text-slate-500">{h.id}</div>
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-600">{h.barangay}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${tone.chip}`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} />
                          {RISK_LEVEL_LABELS[h.risk?.level || RISK_LEVELS.STABLE]}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-900">{h.risk?.count ?? 0}</td>
                      <td className="px-4 py-3 text-sm text-slate-600">{daysAgo(h.lastHouseholdVisit)}</td>
                      <td className="px-4 py-3 text-sm text-slate-600">{h.workflowStatus || "—"}</td>
                      <td className="px-4 py-3 text-right">
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

          {filtered.length === 0 && !noData && (
            <p className="px-4 py-10 text-center text-sm text-slate-600">No households match your filters.</p>
          )}
          {filtered.length === 0 && noData && (
            <p className="px-4 py-10 text-center text-sm text-slate-600">No household risk data recorded yet.</p>
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
        <div className="fixed bottom-4 right-4 z-50 rounded-lg border border-blue-100 bg-white px-4 py-3 shadow-lg">
          <span className="text-sm text-slate-900">{toast}</span>
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
