import React, { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import PageHeader from "@/components/common/PageHeader";
import { Card } from "@/components/common/Card";
import { useHouseholdRiskClusters, householdRiskStore } from "@/services/local/householdRiskStore";
import {
  RISK_LEVELS, RISK_LEVEL_LABELS, RISK_CLASSIFICATION_BASIS, getRiskConfig,
} from "@/lib/householdRisk";
import { BARANGAYS } from "@/lib/barangays";
import { FollowUpModal } from "../components/RiskActionModals";
import {
  Search, Home, ShieldCheck, AlertTriangle, PhoneCall, X, ChevronRight, Users, Info, MapPin, RefreshCw,
} from "lucide-react";

const levelTone = {
  [RISK_LEVELS.STABLE]: { chip: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400", dot: "bg-brand-green", bar: "#1F7A4C" },
  [RISK_LEVELS.MONITOR]: { chip: "bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400", dot: "bg-brand-yellow", bar: "#B98A1E" },
  [RISK_LEVELS.INTERVENTION]: { chip: "bg-orange-50 text-orange-700 dark:bg-orange-500/15 dark:text-orange-400", dot: "bg-brand-accent", bar: "#1B6EC2" },
  [RISK_LEVELS.PRIORITY]: { chip: "bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-400", dot: "bg-brand-danger", bar: "#B3202C" },
};

const levelOrder = [RISK_LEVELS.PRIORITY, RISK_LEVELS.INTERVENTION, RISK_LEVELS.MONITOR, RISK_LEVELS.STABLE];

const formatDate = (iso) => {
  if (!iso) return "—";
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
};

const daysAgo = (iso) => {
  const d = householdRiskStore.daysSince(iso);
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
  const [phase, setPhase] = useState("ready"); // "loading" | "error" | "ready"

  const clusters = useHouseholdRiskClusters();

  // --- Filters ---
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
    clusters.forEach((h) => (h.risk?.indicators || []).forEach((i) => seen.add(i.key)));
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
      if (indicatorFilter !== "all" && !(h.risk?.indicators || []).some((i) => i.key === indicatorFilter)) return false;
      if (startDate || endDate) {
        const last = h.lastHouseholdVisit || h.lastAssessment || "";
        if (last && startDate && last < startDate) return false;
        if (last && endDate && last > endDate) return false;
      }
      if (q) {
        const hay = `${h.head} ${h.id} ${h.barangay} ${h.surname || ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [clusters, query, barangayFilter, levelFilter, indicatorFilter, followUpFilter, startDate, endDate]);

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

  const priorityList = useMemo(
    () =>
      clusters
        .filter((h) => h.risk?.level === RISK_LEVELS.PRIORITY || h.risk?.level === RISK_LEVELS.INTERVENTION)
        .sort((a, b) => (b.risk?.score || 0) - (a.risk?.score || 0)),
    [clusters]
  );

  const maxIndicatorCount = indicatorBreakdown.length ? indicatorBreakdown[0][1] : 1;

  const clearFilters = () => {    setQuery("");
    setBarangayFilter("All");
    setLevelFilter("all");
    setIndicatorFilter("all");
    setFollowUpFilter("all");
    setStartDate("");
    setEndDate("");
  };

  // ------------------------------- States ---------------------------------
  if (phase === "loading") {
    return (
      <>
        <PageHeader crumbs={["Households Risk Overview"]} title="Household Risk Overview" subtitle="Identify households with multiple health-risk indicators and prioritize early intervention across the municipality." />
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
        <PageHeader crumbs={["Households Risk Overview"]} title="Household Risk Overview" subtitle="Identify households with multiple health-risk indicators and prioritize early intervention across the municipality." />
        <Card className="p-10 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-brand-danger/10">
            <AlertTriangle className="h-7 w-7 text-brand-danger" />
          </div>
          <h3 className="mt-4 text-lg font-semibold text-brand-ink">Unable to Load Household Risk Data</h3>
          <p className="mx-auto mt-1.5 max-w-md text-sm text-brand-gray">
            We couldn&apos;t retrieve the latest household risk information.
          </p>
          <button onClick={() => setPhase("ready")} className="mt-5 inline-flex items-center gap-2 rounded-btn bg-brand-blue px-5 py-2.5 text-sm font-medium text-white hover:bg-brand-dark">
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
        crumbs={["Households Risk Overview"]}
        title="Household Risk Overview"
        subtitle="Identify households with multiple health-risk indicators and prioritize early intervention across the municipality."
        action={
          <Link
            to={earlyWarningPath()}
            className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-brand-blue hover:border-brand-blue dark:border-border dark:bg-card dark:text-slate-300"
          >
            <AlertTriangle className="h-3.5 w-3.5" /> Early Intervention
          </Link>
        }
      />

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-4 mb-6">
        <Card className="p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-brand-blue/10 text-brand-blue flex items-center justify-center shrink-0"><Users className="w-5 h-5" /></div>
          <div><p className="text-xs text-brand-gray uppercase tracking-wide">Total Households</p><p className="text-2xl font-semibold text-brand-ink">{counts.total}</p></div>
        </Card>
        {[
          { level: RISK_LEVELS.PRIORITY, label: "Priority Review" },
          { level: RISK_LEVELS.INTERVENTION, label: "Needs Intervention" },
          { level: RISK_LEVELS.MONITOR, label: "Monitor" },
          { level: RISK_LEVELS.STABLE, label: "Stable" },
        ].map((c) => (
          <button
            key={c.level}
            onClick={() => setLevelFilter(levelFilter === c.level ? "all" : c.level)}
            className={`rounded-2xl border p-4 text-left transition-colors ${levelFilter === c.level ? "border-brand-blue bg-brand-light/60" : "border-slate-200 bg-white hover:border-brand-blue/40"}`}
          >
            <p className="text-xs text-brand-gray uppercase tracking-wide flex items-center gap-1.5">
              <span className={`w-2.5 h-2.5 rounded-full ${levelTone[c.level].dot}`} /> {c.label}
            </p>
            <p className="mt-1 text-2xl font-semibold text-brand-ink">{counts[c.level]}</p>
          </button>
        ))}
      </div>

      {/* Filters */}
      <Card className="p-4 mb-6">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 rounded-input border border-slate-200 dark:border-border bg-brand-bg/60 dark:bg-input px-3 py-2.5 min-w-[200px] flex-1 sm:flex-none">
            <Search className="h-4 w-4 shrink-0 text-brand-gray dark:text-slate-400" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search household, ID, barangay..." className="w-full bg-transparent text-sm outline-none placeholder:text-slate-400 dark:placeholder:text-slate-500" />
          </div>
          <select value={barangayFilter} onChange={(e) => setBarangayFilter(e.target.value)} className="rounded-btn border border-slate-200 dark:border-border bg-white dark:bg-input px-3 py-2.5 text-sm outline-none text-brand-ink dark:text-foreground">
            <option value="All">All Barangays</option>
            {BARANGAYS.map((b) => <option key={b} value={b}>{b}</option>)}
            {byBarangay.filter(([n]) => !BARANGAYS.includes(n)).map(([n]) => <option key={n} value={n}>{n}</option>)}
          </select>
          <select value={levelFilter} onChange={(e) => setLevelFilter(e.target.value)} className="rounded-btn border border-slate-200 dark:border-border bg-white dark:bg-input px-3 py-2.5 text-sm outline-none text-brand-ink dark:text-foreground">
            <option value="all">All Risk Levels</option>
            {levelOrder.map((l) => <option key={l} value={l}>{RISK_LEVEL_LABELS[l]}</option>)}
          </select>
          <select value={indicatorFilter} onChange={(e) => setIndicatorFilter(e.target.value)} className="rounded-btn border border-slate-200 dark:border-border bg-white dark:bg-input px-3 py-2.5 text-sm outline-none text-brand-ink dark:text-foreground max-w-[220px]">
            <option value="all">All Indicators</option>
            {indicatorOptions.map((k) => {
              const def = getRiskConfig().indicators.find((i) => i.key === k);
              return <option key={k} value={k}>{def?.label || k}</option>;
            })}
          </select>
          <select value={followUpFilter} onChange={(e) => setFollowUpFilter(e.target.value)} className="rounded-btn border border-slate-200 dark:border-border bg-white dark:bg-input px-3 py-2.5 text-sm outline-none text-brand-ink dark:text-foreground">
            <option value="all">All Follow-up</option>
            <option value="required">Required</option>
            <option value="scheduled">Scheduled</option>
            <option value="overdue">Overdue</option>
            <option value="resolved">Resolved</option>
          </select>
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="rounded-btn border border-slate-200 dark:border-border bg-white dark:bg-input px-3 py-2.5 text-sm outline-none text-brand-ink dark:text-foreground" />
          <span className="text-xs text-brand-gray">—</span>
          <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="rounded-btn border border-slate-200 dark:border-border bg-white dark:bg-input px-3 py-2.5 text-sm outline-none text-brand-ink dark:text-foreground" />
          <button onClick={clearFilters} className="inline-flex items-center gap-1.5 rounded-btn border border-brand-border bg-white px-3 py-2.5 text-sm font-medium text-brand-gray hover:bg-brand-bg">
            <X className="h-4 w-4" /> Clear Filters
          </button>
        </div>
      </Card>

      {/* Empty state */}
      {noData && (
        <Card className="p-10 text-center mb-6">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50">
            <ShieldCheck className="h-7 w-7 text-emerald-600" />
          </div>
          <h3 className="mt-4 text-lg font-semibold text-brand-ink">All Households Are Currently Stable</h3>
          <p className="mx-auto mt-1.5 max-w-md text-sm text-brand-gray">
            No household risk clusters requiring intervention have been identified based on the current monitoring rules. This is a good outcome.
          </p>
          <a href="/app/bhw/households" className="mt-5 inline-flex items-center gap-2 rounded-btn bg-brand-blue px-5 py-2.5 text-sm font-medium text-white hover:bg-brand-dark">
            <Home className="h-4 w-4" /> View All Households
          </a>
        </Card>
      )}

      {/* Priority households */}
      <Card className="p-5 mb-6">
        <div className="flex items-center justify-between gap-3 mb-4">
          <h3 className="font-semibold text-brand-ink">Priority Households</h3>
          <span className="text-xs text-brand-gray">{priorityList.length} households</span>
        </div>
        {priorityList.length === 0 ? (
          <p className="py-6 text-center text-sm text-brand-gray">
            {noData ? "No household risk data has been recorded yet." : "No households currently require immediate review."}
          </p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {priorityList.map((h) => {
              const tone = levelTone[h.risk.level] || levelTone[RISK_LEVELS.STABLE];
              return (
                <div key={h.id} className="rounded-2xl border border-slate-200 bg-white p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-brand-ink">{h.head} Household</p>
                      <p className="text-xs text-brand-gray">{h.id} · Barangay {h.barangay}</p>
                    </div>
                    <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${tone.chip}`}>
                      <span className={`h-2 w-2 rounded-full ${tone.dot}`} /> {RISK_LEVEL_LABELS[h.risk.level]}
                    </span>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                    <div className="rounded-btn bg-brand-bg px-2.5 py-2"><p className="text-brand-gray">Risk Indicators</p><p className="font-semibold text-brand-ink">{h.risk.count}</p></div>
                    <div className="rounded-btn bg-brand-bg px-2.5 py-2"><p className="text-brand-gray">Last Visit</p><p className="font-semibold text-brand-ink">{daysAgo(h.lastHouseholdVisit)}</p></div>
                    <div className="rounded-btn bg-brand-bg px-2.5 py-2"><p className="text-brand-gray">Last Assessment</p><p className="font-semibold text-brand-ink">{formatDate(h.lastAssessment)}</p></div>
                    <div className="rounded-btn bg-brand-bg px-2.5 py-2"><p className="text-brand-gray">Follow-up</p><p className="font-semibold text-brand-ink">{h.workflowStatus || "—"}</p></div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Link to={householdDetailPath(h.id)} className="inline-flex items-center gap-1.5 rounded-btn border border-brand-border bg-white px-3 py-1.5 text-xs font-medium text-brand-blue hover:border-brand-blue dark:bg-card">
                      <Home className="h-3.5 w-3.5" /> View Household
                    </Link>
                    <button onClick={() => setFollowUpFor(h.id)} className="inline-flex items-center gap-1.5 rounded-btn border border-brand-border bg-white px-3 py-1.5 text-xs font-medium text-brand-green hover:border-brand-green dark:bg-card">
                      <PhoneCall className="h-3.5 w-3.5" /> Create Follow-up
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* Distribution + Indicator breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        <Card className="p-5">
          <h3 className="font-semibold text-brand-ink text-sm mb-4">Household Risk Distribution</h3>
          {counts.total === 0 ? (
            <p className="py-8 text-center text-sm text-brand-gray">No distribution data available.</p>
          ) : (
            <div className="space-y-3">
              {levelOrder.map((l) => {
                const val = counts[l];
                const pct = counts.total ? Math.round((val / counts.total) * 100) : 0;
                return (
                  <div key={l}>
                    <div className="flex items-center justify-between text-sm">
                      <span className="flex items-center gap-1.5 text-brand-ink">
                        <span className={`h-2 w-2 rounded-full ${levelTone[l].dot}`} /> {RISK_LEVEL_LABELS[l]}
                      </span>
                      <span className="font-semibold text-brand-ink">{val} · {pct}%</span>
                    </div>
                    <div className="mt-1.5 h-2.5 w-full overflow-hidden rounded-full bg-slate-200">
                      <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: levelTone[l].bar }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        <Card className="p-5 lg:col-span-2">
          <h3 className="font-semibold text-brand-ink text-sm mb-4">Top Household Risk Indicators</h3>
          {indicatorBreakdown.length === 0 ? (
            <p className="py-8 text-center text-sm text-brand-gray">No risk indicators recorded yet.</p>
          ) : (
            <div className="space-y-2.5">
              {indicatorBreakdown.map(([label, val]) => (
                <div key={label} className="flex items-center gap-3 text-sm">
                  <span className="w-64 min-w-0 truncate text-brand-ink sm:w-72">{label}</span>
                  <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-slate-200">
                    <div className="h-full rounded-full bg-brand-blue" style={{ width: `${Math.max(8, (val / maxIndicatorCount) * 100)}%` }} />
                  </div>
                  <span className="w-8 text-right font-semibold text-brand-ink">{val}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* Basis of risk classification */}
      <Card className="p-5 mb-6">
        <div className="flex items-center gap-2 mb-1">
          <h3 className="font-semibold text-brand-ink text-sm">Basis of Risk Classification</h3>
          <span className="group relative inline-flex">
            <Info className="h-4 w-4 text-brand-gray cursor-help" strokeWidth={1.8} />
            <span className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 w-64 -translate-x-1/2 rounded-btn border border-slate-200 bg-white p-3 text-xs leading-relaxed text-brand-gray opacity-0 shadow-float transition-opacity group-hover:opacity-100">
              Risk classifications are based on configured household health-monitoring indicators and workflow rules. They are intended to support early intervention and do not constitute a medical diagnosis.
            </span>
          </span>
        </div>
        <p className="text-xs text-brand-gray mb-4">
          Household risk levels are determined by the presence, number, persistence, and configured priority of health-related risk indicators recorded in the system.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {levelOrder.map((l) => {
            const basis = RISK_CLASSIFICATION_BASIS[l];
            return (
              <div key={l} className="rounded-btn border border-slate-200 dark:border-border bg-brand-bg/60 dark:bg-card-nested p-4">
                <p className="flex items-center gap-1.5 text-sm font-semibold text-brand-ink">
                  <span className={`h-2 w-2 rounded-full ${levelTone[l].dot}`} /> {RISK_LEVEL_LABELS[l]}
                </p>
                <p className="mt-1 text-xs text-brand-gray">
                  <span className="font-medium text-brand-ink">Basis:</span> {basis.summary}
                </p>
                <p className="mt-2 text-xs text-brand-gray">
                  <span className="font-medium text-brand-ink">Typical state:</span>
                </p>
                <ul className="mt-1 space-y-0.5 text-xs text-brand-gray">
                  {basis.typicalState.slice(0, 3).map((t) => (
                    <li key={t} className="flex items-start gap-1.5"><span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-brand-gray/60" /> {t}</li>
                  ))}
                </ul>
                <p className="mt-2 text-xs text-brand-gray">
                  <span className="font-medium text-brand-ink">Recommended response:</span> {basis.recommendedResponse}
                </p>
              </div>
            );
          })}
        </div>
      </Card>

      {/* Risk by barangay */}
      <Card className="p-5 mb-6">
        <h3 className="font-semibold text-brand-ink text-sm mb-4">Risk by Barangay</h3>
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
                        setViewingBarangay(null);
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
      <Card className="overflow-hidden">
        <div className="border-b border-slate-200 px-5 py-4 flex flex-wrap items-center justify-between gap-3">
          <h3 className="font-semibold text-brand-ink">Household Risk List</h3>
          <div className="flex items-center gap-2">
            {barangayFilter !== "All" && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-blue/10 px-2.5 py-1 text-xs font-medium text-brand-blue">
                <MapPin className="h-3 w-3" /> Barangay {barangayFilter}
                <button onClick={() => setBarangayFilter("All")} aria-label="Clear barangay filter" className="ml-1 text-brand-blue/70 hover:text-brand-blue">
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
              householdRiskStore.recordFollowUp(target.id, { status, notes });
              showToast(`Follow-up recorded for the ${target.surname} household.`);
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
