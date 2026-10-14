import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import PageHeader from "@/components/common/PageHeader";
import { Card } from "@/components/common/Card";
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
  Search, ShieldCheck, AlertTriangle, PhoneCall, X, ChevronRight, Users, MapPin, RefreshCw,
  Download, ClipboardCheck, Eye, Activity,
} from "lucide-react";

const levelTone = {
  [RISK_LEVELS.STABLE]: { chip: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400", dot: "bg-brand-green", bar: "#1F7A4C" },
  [RISK_LEVELS.MONITOR]: { chip: "bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400", dot: "bg-brand-yellow", bar: "#B98A1E" },
  [RISK_LEVELS.INTERVENTION]: { chip: "bg-orange-50 text-orange-700 dark:bg-orange-500/15 dark:text-orange-400", dot: "bg-brand-accent", bar: "#1B6EC2" },
  [RISK_LEVELS.PRIORITY]: { chip: "bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-400", dot: "bg-brand-danger", bar: "#B3202C" },
};

const levelOrder = [RISK_LEVELS.PRIORITY, RISK_LEVELS.INTERVENTION, RISK_LEVELS.MONITOR, RISK_LEVELS.STABLE];

const formatDate = (iso) => formatShortDate(iso) || "—";

const daysAgo = (iso) => {
  const d = daysSince(iso);
  return d === null ? "—" : `${d} days ago`;
};

/** Early Warning route for the current role area (existing module). */
function earlyWarningPath() {
  const raw = typeof window !== "undefined" ? window.location.pathname : "/app/mho/trends";
  const parts = raw.split("/").filter(Boolean);
  const appIdx = parts.indexOf("app");
  if (appIdx >= 0 && parts[appIdx + 1]) {
    const role = parts[appIdx + 1];
    if (role === "mho" || role === "health_supervisor") return `/${parts.slice(0, appIdx + 2).join("/")}/trends`;
  }
  return "/app/mho/trends";
}

/** Household risk detail route for the current role area. */
function householdDetailPath(id) {
  const raw = typeof window !== "undefined" ? window.location.pathname : "/app/mho/households/risk-overview";
  const parts = raw.split("/").filter(Boolean);
  const appIdx = parts.indexOf("app");
  const role = appIdx >= 0 && parts[appIdx + 1] ? parts[appIdx + 1] : "mho";
  return `/app/${role}/households/${id}`;
}

export default function HouseholdRiskOverview() {
  const [phase, setPhase] = useState("loading"); // "loading" | "error" | "ready"
  const [clusters, setClusters] = useState([]);

  // Load persisted households (server risk classification) and merge each
  // household's persisted risk workflow. Scope/role are enforced server-side;
  // this never sends a scope id and cannot widen access.
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

  // --- Filters ---
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

  const byBarangay = useMemo(() => {
    const map = {};
    clusters.forEach((h) => {
      const b = h.barangay || "Unassigned";
      if (!map[b]) map[b] = { priority: 0, intervention: 0, monitor: 0, stable: 0, total: 0, households: [] };
      map[b].total += 1;
      map[b].households.push(h);
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
  const latestDataDate = useMemo(() => {
    const dates = clusters
      .flatMap((h) => [h.lastHouseholdVisit, h.lastAssessment])
      .filter(Boolean)
      .map(String)
      .sort();
    return dates.length ? formatDate(dates[dates.length - 1]) : "No date available";
  }, [clusters]);

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

  const exportReport = () => {
    const columns = ["Household ID", "Head of Household", "Barangay", "Risk Level", "Key Indicators", "Follow-up", "Last Visit"];
    const rows = filtered.map((h) => [
      h.id,
      h.head,
      h.barangay,
      RISK_LEVEL_LABELS[h.risk?.level || RISK_LEVELS.STABLE],
      (h.risk?.indicators || []).map((indicator) => indicator.label).join("; "),
      h.workflowStatus || "",
      h.lastHouseholdVisit || "",
    ]);
    const csv = [columns, ...rows]
      .map((row) => row.map((value) => `"${String(value ?? "").replace(/"/g, '""')}"`).join(","))
      .join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `household-risk-report-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  // ------------------------------- States ---------------------------------
  if (phase === "loading") {
    return (
      <>
        <PageHeader crumbs={["Household Risk Monitoring"]} title="Household Risk Monitoring" subtitle="Overview of household risks, key indicators, and follow-up status." dense />
        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-4 mb-6">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="h-28 animate-pulse rounded-2xl border border-slate-200 bg-slate-100" />
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
          <div className="h-40 animate-pulse rounded-2xl border border-slate-200 bg-slate-100" />
          <div className="h-40 animate-pulse rounded-2xl border border-slate-200 bg-slate-100" />
          <div className="h-40 animate-pulse rounded-2xl border border-slate-200 bg-slate-100" />
        </div>
        <div className="h-72 animate-pulse rounded-2xl border border-slate-200 bg-slate-100" />
      </>
    );
  }

  if (phase === "error") {
    return (
      <>
        <PageHeader crumbs={["Household Risk Monitoring"]} title="Household Risk Monitoring" subtitle="Overview of household risks, key indicators, and follow-up status." dense />
        <Card className="p-10 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-brand-danger/10">
            <AlertTriangle className="h-7 w-7 text-brand-danger" />
          </div>
          <h3 className="mt-4 text-lg font-semibold text-brand-ink">Unable to Load Household Risk Data</h3>
          <p className="mx-auto mt-1.5 max-w-md text-sm text-brand-gray">
            We couldn&apos;t retrieve the latest household risk information.
          </p>
          <button onClick={() => load()} className="mt-5 inline-flex items-center gap-2 rounded-btn bg-brand-blue px-5 py-2.5 text-sm font-medium text-white hover:bg-brand-dark">
            <RefreshCw className="h-4 w-4" /> Retry
          </button>
        </Card>
      </>
    );
  }

  const noData = clusters.length === 0;

  return (
    <>
      <PageHeader
        dense
        crumbs={["Household Risk Monitoring"]}
        title="Household Risk Monitoring"
        subtitle="Overview of household risks, key indicators, and follow-up status."
        meta={<span className="text-xs text-white/75">Latest data: <strong className="font-medium text-white">{latestDataDate}</strong></span>}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={exportReport}
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-btn bg-white px-4 py-2 text-sm font-semibold text-brand-blue transition hover:bg-brand-bg"
            >
              <Download className="h-4 w-4" /> Export Report
            </button>
            <Link
              to={earlyWarningPath()}
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-btn border border-white/25 px-3 py-2 text-sm font-medium text-white/90 transition hover:bg-white/10"
            >
              <AlertTriangle className="h-4 w-4" /> Early Intervention
            </Link>
          </div>
        }
      />

      {/* Summary cards */}
      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {[
          { key: "priority", level: RISK_LEVELS.PRIORITY, label: "Priority Review", icon: AlertTriangle, color: "text-rose-700", tint: "bg-rose-50", bar: "bg-rose-600" },
          { key: "intervention", level: RISK_LEVELS.INTERVENTION, label: "Needs Intervention", icon: ClipboardCheck, color: "text-blue-700", tint: "bg-blue-50", bar: "bg-blue-600" },
          { key: "monitor", level: RISK_LEVELS.MONITOR, label: "Monitor", icon: Activity, color: "text-amber-700", tint: "bg-amber-50", bar: "bg-amber-500" },
          { key: "stable", level: RISK_LEVELS.STABLE, label: "Stable", icon: ShieldCheck, color: "text-emerald-700", tint: "bg-emerald-50", bar: "bg-emerald-600" },
          { key: "total", label: "Total Households", icon: Users, color: "text-brand-blue", tint: "bg-brand-blue/10", bar: "bg-brand-blue" },
        ].map((stat) => {
          const Icon = stat.icon;
          const value = counts[stat.key];
          const percentage = counts.total ? Math.round((value / counts.total) * 100) : 0;
          const selected = stat.level && appliedFilters.levelFilter === stat.level;
          const content = (
            <>
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-brand-gray">{stat.label}</span>
                <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${stat.tint} ${stat.color}`}>
                  <Icon className="h-4 w-4" aria-hidden="true" />
                </span>
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="text-2xl font-bold tracking-tight text-brand-ink">{value}</span>
                <span className="text-xs text-brand-gray">{percentage}% of households</span>
              </div>
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-100" aria-hidden="true">
                <div className={`h-full rounded-full transition-all ${stat.bar}`} style={{ width: `${percentage}%` }} />
              </div>
            </>
          );
          return stat.level ? (
            <button
              key={stat.key}
              type="button"
              aria-pressed={Boolean(selected)}
              onClick={() => {
                const nextLevel = selected ? "all" : stat.level;
                setLevelFilter(nextLevel);
                setAppliedFilters((current) => ({ ...current, levelFilter: nextLevel }));
              }}
              className={`min-h-[116px] rounded-card border bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue ${selected ? "border-brand-blue ring-1 ring-brand-blue/30" : "border-slate-200"}`}
            >
              {content}
            </button>
          ) : (
            <Card key={stat.key} className="min-h-[116px] p-4 shadow-sm">
              {content}
            </Card>
          );
        })}
      </div>

      {/* Filters */}
      <Card className="mb-6 p-4 shadow-sm">
        <div className="mb-3 flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-blue/10 text-brand-blue"><Search className="h-3.5 w-3.5" /></span>
          <h2 className="text-sm font-semibold text-brand-ink">Filter households</h2>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-12 xl:items-end">
          {/* Search — widest control */}
          <div className="sm:col-span-2 xl:col-span-4">
            <label className="mb-1.5 block text-xs font-medium text-brand-gray">Search household</label>
            <div className="flex h-10 items-center gap-2 rounded-input border border-slate-200 dark:border-border bg-brand-bg/60 dark:bg-input px-3">
              <Search className="h-4 w-4 shrink-0 text-brand-gray dark:text-slate-400" />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Household, household ID, or head of household" className="w-full min-w-0 bg-transparent text-sm outline-none placeholder:text-slate-400 dark:placeholder:text-slate-500" />
            </div>
          </div>

          <div className="xl:col-span-2">
            <label className="mb-1.5 block text-xs font-medium text-brand-gray">Barangay</label>
            <select value={barangayFilter} onChange={(e) => setBarangayFilter(e.target.value)} className="h-10 w-full rounded-btn border border-slate-200 dark:border-border bg-white dark:bg-input px-3 text-sm outline-none text-brand-ink dark:text-foreground focus:border-brand-blue">
              <option value="All">All Barangays</option>
              {liveBarangays.map((b) => <option key={b} value={b}>{b}</option>)}
              {byBarangay.filter(([n]) => !liveBarangays.includes(n)).map(([n]) => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>

          <div className="xl:col-span-2">
            <label className="mb-1.5 block text-xs font-medium text-brand-gray">Risk Level</label>
            <select value={levelFilter} onChange={(e) => setLevelFilter(e.target.value)} className="h-10 w-full rounded-btn border border-slate-200 dark:border-border bg-white dark:bg-input px-3 text-sm outline-none text-brand-ink dark:text-foreground focus:border-brand-blue">
              <option value="all">All Risk Levels</option>
              {levelOrder.map((l) => <option key={l} value={l}>{RISK_LEVEL_LABELS[l]}</option>)}
            </select>
          </div>

          <div className="xl:col-span-2">
            <label className="mb-1.5 block text-xs font-medium text-brand-gray">Indicators</label>
            <select value={indicatorFilter} onChange={(e) => setIndicatorFilter(e.target.value)} className="h-10 w-full rounded-btn border border-slate-200 dark:border-border bg-white dark:bg-input px-3 text-sm outline-none text-brand-ink dark:text-foreground focus:border-brand-blue">
              <option value="all">All Indicators</option>
              {indicatorOptions.map((k) => {
                const def = getRiskConfig().indicators.find((i) => i.key === k);
                return <option key={k} value={k}>{def?.label || k}</option>;
              })}
            </select>
          </div>

          <div className="xl:col-span-2">
            <label className="mb-1.5 block text-xs font-medium text-brand-gray">Follow-up</label>
            <select value={followUpFilter} onChange={(e) => setFollowUpFilter(e.target.value)} className="h-10 w-full rounded-btn border border-slate-200 dark:border-border bg-white dark:bg-input px-3 text-sm outline-none text-brand-ink dark:text-foreground focus:border-brand-blue">
              <option value="all">All Follow-up</option>
              <option value="required">Required</option>
              <option value="scheduled">Scheduled</option>
              <option value="overdue">Overdue</option>
              <option value="resolved">Resolved</option>
            </select>
          </div>

          {/* Start + End dates stay together */}
          <div className="sm:col-span-2 xl:col-span-5">
            <label className="mb-1.5 block text-xs font-medium text-brand-gray">Date range</label>
            <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
              <input aria-label="Start date" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="h-10 min-w-0 w-full rounded-btn border border-slate-200 dark:border-border bg-white dark:bg-input px-2 text-sm outline-none text-brand-ink dark:text-foreground focus:border-brand-blue sm:px-3" />
              <span className="text-xs text-brand-gray">to</span>
              <input aria-label="End date" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="h-10 min-w-0 w-full rounded-btn border border-slate-200 dark:border-border bg-white dark:bg-input px-2 text-sm outline-none text-brand-ink dark:text-foreground focus:border-brand-blue sm:px-3" />
            </div>
          </div>

          <div className="flex flex-col gap-2 sm:col-span-2 sm:flex-row sm:justify-end xl:col-span-7">
            <button type="button" onClick={clearFilters} className="inline-flex h-10 items-center justify-center gap-1.5 rounded-btn border border-brand-border bg-white px-4 text-sm font-medium text-brand-gray hover:bg-brand-bg">
              <X className="h-4 w-4" /> Clear Filters
            </button>
            <button type="button" onClick={applyFilters} className="inline-flex h-10 items-center justify-center gap-1.5 rounded-btn bg-brand-blue px-4 text-sm font-semibold text-white hover:bg-brand-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue focus-visible:ring-offset-2">
              Apply Filters
            </button>
          </div>
        </div>
      </Card>

      {/* Priority households */}
      <Card className="mb-6 overflow-hidden border-slate-200 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-rose-50 text-rose-700">
                <AlertTriangle className="h-4 w-4" />
              </span>
              <h2 className="text-lg font-semibold text-brand-ink">Priority Households</h2>
            </div>
            <p className="mt-1 text-sm text-brand-gray">Households requiring the most immediate follow-up.</p>
          </div>
          <div className="flex items-center gap-3">
            <span className="rounded-full bg-rose-50 px-3 py-1 text-xs font-semibold text-rose-700">
              {visiblePriorityList.length} {visiblePriorityList.length === 1 ? "household" : "households"}
            </span>
            <button
              type="button"
              onClick={() => document.getElementById("all-households")?.scrollIntoView({ behavior: "smooth", block: "start" })}
              className="inline-flex min-h-9 items-center gap-1 rounded-btn px-2.5 text-sm font-semibold text-brand-blue hover:bg-brand-blue/5"
            >
              View All <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
        {visiblePriorityList.length === 0 ? (
          <div className="flex items-center gap-4 px-5 py-6">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-700">
              <ShieldCheck className="h-5 w-5" />
            </span>
            <div>
              <p className="text-sm font-semibold text-brand-ink">No households currently require immediate review.</p>
              <p className="mt-1 text-sm text-brand-gray">
                {noData ? "Household risk records will appear here when available." : "Households meeting the priority or intervention criteria will appear here."}
              </p>
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-sm">
              <thead>
                <tr className="bg-slate-50 text-left">
                  <th className="px-5 py-3 font-medium text-brand-gray">Household ID</th>
                  <th className="px-5 py-3 font-medium text-brand-gray">Head of Household</th>
                  <th className="px-5 py-3 font-medium text-brand-gray">Barangay</th>
                  <th className="px-5 py-3 font-medium text-brand-gray">Risk Level</th>
                  <th className="px-5 py-3 font-medium text-brand-gray">Key Indicators</th>
                  <th className="px-5 py-3 font-medium text-brand-gray">Follow-up</th>
                  <th className="px-5 py-3 text-right font-medium text-brand-gray">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visiblePriorityList.map((h) => {
                  const tone = levelTone[h.risk?.level] || levelTone[RISK_LEVELS.STABLE];
                  const followUp = h.workflowStatus || "Not started";
                  const followUpTone = followUp.toLowerCase().includes("overdue")
                    ? "bg-rose-50 text-rose-700"
                    : followUp.toLowerCase().includes("resolved")
                      ? "bg-emerald-50 text-emerald-700"
                      : followUp.toLowerCase().includes("scheduled")
                        ? "bg-blue-50 text-blue-700"
                        : "bg-slate-100 text-slate-600";
                  return (
                    <tr key={h.id} className="transition-colors hover:bg-slate-50/80">
                      <td className="whitespace-nowrap px-5 py-3.5 font-medium text-brand-ink">{h.id}</td>
                      <td className="px-5 py-3.5 font-medium text-brand-ink">{h.head || "—"}</td>
                      <td className="whitespace-nowrap px-5 py-3.5 text-brand-gray">{h.barangay ? `Barangay ${h.barangay}` : "—"}</td>
                      <td className="px-5 py-3.5">
                        <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ${tone.chip}`}>
                          <span className={`h-2 w-2 rounded-full ${tone.dot}`} /> {RISK_LEVEL_LABELS[h.risk?.level || RISK_LEVELS.STABLE]}
                        </span>
                      </td>
                      <td className="max-w-[260px] px-5 py-3.5 text-brand-gray">
                        <span className="line-clamp-2" title={(h.risk?.indicators || []).map((indicator) => indicator.label).join(", ")}>
                          {(h.risk?.indicators || []).map((indicator) => indicator.label).join(", ") || "No indicators listed"}
                        </span>
                      </td>
                      <td className="px-5 py-3.5">
                        <span className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ${followUpTone}`}>{followUp}</span>
                      </td>
                      <td className="whitespace-nowrap px-5 py-3.5 text-right">
                        <div className="inline-flex items-center gap-3">
                          <Link to={householdDetailPath(h.id)} className="inline-flex items-center gap-1 text-sm font-semibold text-brand-blue hover:underline">
                            <Eye className="h-4 w-4" /> View
                          </Link>
                          <button type="button" onClick={() => setFollowUpFor(h.id)} className="inline-flex min-h-8 items-center gap-1 rounded-md px-2 text-xs font-semibold text-brand-green hover:bg-emerald-50">
                            <PhoneCall className="h-3.5 w-3.5" /> Follow-up
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
      </Card>

      {/* Distribution + Indicator breakdown */}
      <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="min-h-[280px] p-5 shadow-sm">
          <h2 className="text-base font-semibold text-brand-ink">Household Risk Distribution</h2>
          <p className="mt-1 text-sm text-brand-gray">Household counts across current risk classifications.</p>
          {counts.total === 0 ? (
            <p className="py-10 text-center text-sm text-brand-gray">No distribution data available.</p>
          ) : (
            <div className="mt-5 flex flex-col items-center gap-6 sm:flex-row sm:justify-center">
              <div
                role="img"
                aria-label={`Risk distribution for ${counts.total} households`}
                className="relative h-40 w-40 shrink-0 rounded-full"
                style={{
                  background: `conic-gradient(${levelOrder.map((level, index) => {
                    const start = levelOrder.slice(0, index).reduce((sum, previous) => sum + counts[previous], 0) / counts.total * 100;
                    const end = start + counts[level] / counts.total * 100;
                    return `${levelTone[level].bar} ${start}% ${end}%`;
                  }).join(", ")})`,
                }}
              >
                <div className="absolute inset-3 flex flex-col items-center justify-center rounded-full bg-white">
                  <span className="text-2xl font-bold text-brand-ink">{counts.total}</span>
                  <span className="text-xs text-brand-gray">households</span>
                </div>
              </div>
              <div className="w-full max-w-xs space-y-2.5">
                {levelOrder.map((level) => {
                  const value = counts[level];
                  const percentage = Math.round((value / counts.total) * 100);
                  return (
                    <div key={level} className="flex items-center justify-between gap-3 text-sm">
                      <span className="flex min-w-0 items-center gap-2 text-brand-gray">
                        <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${levelTone[level].dot}`} />
                        <span className="truncate">{RISK_LEVEL_LABELS[level]}</span>
                      </span>
                      <span className="shrink-0 font-semibold text-brand-ink">{value} <span className="font-normal text-brand-gray">({percentage}%)</span></span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </Card>

        <Card className="min-h-[280px] p-5 shadow-sm">
          <h2 className="text-base font-semibold text-brand-ink">Top Household Risk Indicators</h2>
          <p className="mt-1 text-sm text-brand-gray">Most frequently recorded indicators across households.</p>
          {indicatorBreakdown.length === 0 ? (
            <p className="py-10 text-center text-sm text-brand-gray">No risk indicators recorded yet.</p>
          ) : (
            <div className="mt-5 space-y-3">
              {indicatorBreakdown.map(([label, val]) => (
                <div key={label}>
                  <div className="mb-1.5 flex items-center justify-between gap-3 text-sm">
                    <span className="min-w-0 truncate text-brand-ink">{label}</span>
                    <span className="shrink-0 font-semibold text-brand-ink">{val}</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                    <div className="h-full rounded-full bg-brand-blue" style={{ width: `${(val / maxIndicatorCount) * 100}%` }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* Risk by barangay */}
      <Card className="p-5 mb-6">
        <h3 className="text-base font-semibold text-brand-ink mb-4">Risk by Barangay</h3>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <thead>
              <tr className="bg-brand-bg text-left">
                <th className="px-3 py-2.5 font-medium text-brand-gray">Barangay</th>
                <th className="px-3 py-2.5 font-medium text-brand-gray">Priority</th>
                <th className="px-3 py-2.5 font-medium text-brand-gray">Intervention</th>
                <th className="px-3 py-2.5 font-medium text-brand-gray">Monitor</th>
                <th className="px-3 py-2.5 font-medium text-brand-gray">Stable</th>
                <th className="px-3 py-2.5 font-medium text-brand-gray text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {byBarangay.map(([name, c]) => (
                <tr key={name} className="hover:bg-brand-bg/50">
                  <td className="px-3 py-3 font-medium text-brand-ink">Barangay {name}</td>
                  <td className="px-3 py-3 text-brand-ink">{c.priority}</td>
                  <td className="px-3 py-3 text-brand-ink">{c.intervention}</td>
                  <td className="px-3 py-3 text-brand-ink">{c.monitor}</td>
                  <td className="px-3 py-3 text-brand-ink">{c.stable}</td>
                  <td className="px-3 py-3 text-right">
                    <button
                      onClick={() => {
                        // Open a barangay-scoped risk view: apply the barangay filter
                        // and clear the level filter so the household list + sections
                        // reflect only this barangay.
                        setBarangayFilter(name);
                        setLevelFilter("all");
                        setAppliedFilters((current) => ({ ...current, barangayFilter: name, levelFilter: "all" }));
                        window.scrollTo({ top: 0, behavior: "smooth" });
                      }}
                      className="inline-flex items-center gap-1 text-sm font-medium text-brand-blue hover:underline"
                    >
                      View <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
              {byBarangay.length === 0 && (
                <tr><td colSpan={6} className="px-3 py-8 text-center text-sm text-brand-gray">No barangay data available.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Household table */}
      <Card id="all-households" className="scroll-mt-6 overflow-hidden">
        <div className="border-b border-slate-200 px-5 py-4 flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-base font-semibold text-brand-ink">Household Risk List</h3>
          <div className="flex items-center gap-2">
            {barangayFilter !== "All" && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-blue/10 px-2.5 py-1 text-xs font-medium text-brand-blue">
                <MapPin className="h-3 w-3" /> Barangay {barangayFilter}
                <button
                  onClick={() => {
                    setBarangayFilter("All");
                    setAppliedFilters((current) => ({ ...current, barangayFilter: "All" }));
                  }}
                  aria-label="Clear barangay filter"
                  className="ml-1 text-brand-blue/70 hover:text-brand-blue"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            )}
            <span className="text-xs text-brand-gray">{filtered.length} households</span>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="bg-brand-bg text-left">
                <th className="px-5 py-3 font-medium text-brand-gray">Household</th>
                <th className="px-5 py-3 font-medium text-brand-gray">Barangay</th>
                <th className="px-5 py-3 font-medium text-brand-gray">Risk Level</th>
                <th className="px-5 py-3 font-medium text-brand-gray">Indicators</th>
                <th className="px-5 py-3 font-medium text-brand-gray">Last Visit</th>
                <th className="px-5 py-3 font-medium text-brand-gray">Follow-up</th>
                <th className="px-5 py-3 font-medium text-brand-gray text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {filtered.map((h) => {
                const tone = levelTone[h.risk?.level || RISK_LEVELS.STABLE];
                return (
                  <tr key={h.id} className="hover:bg-brand-bg/50">
                    <td className="px-5 py-3">
                      <p className="font-medium text-brand-ink">{h.head} Household</p>
                      <p className="text-xs text-brand-gray">{h.id}</p>
                    </td>
                    <td className="px-5 py-3 text-brand-gray">Barangay {h.barangay}</td>
                    <td className="px-5 py-3">
                      <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${tone.chip}`}>
                        <span className={`h-2 w-2 rounded-full ${tone.dot}`} /> {RISK_LEVEL_LABELS[h.risk?.level || RISK_LEVELS.STABLE]}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-brand-ink">{h.risk?.count ?? 0}</td>
                    <td className="px-5 py-3 text-brand-gray">{daysAgo(h.lastHouseholdVisit)}</td>
                    <td className="px-5 py-3 text-brand-gray">{h.workflowStatus || "—"}</td>
                    <td className="px-5 py-3 text-right">
                      <Link to={householdDetailPath(h.id)} className="inline-flex items-center gap-1 text-sm font-medium text-brand-blue hover:underline">
                        <EyeIcon /> View
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {filtered.length === 0 && !noData && (
          <p className="px-5 py-8 text-center text-sm text-brand-gray">No households match your filters.</p>
        )}
        {filtered.length === 0 && noData && (
          <p className="px-5 py-8 text-center text-sm text-brand-gray">No household risk data recorded yet.</p>
        )}
      </Card>

      {toast && (
        <div className="fixed bottom-4 right-4 z-[80] flex items-center gap-2 rounded-btn bg-brand-ink px-4 py-3 text-white shadow-lg">
          <span className="text-sm">{toast}</span>
        </div>
      )}

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
                  showToast(`Follow-up recorded for the ${target.surname} household.`);
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

function EyeIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}
