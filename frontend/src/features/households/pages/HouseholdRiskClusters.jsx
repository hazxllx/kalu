import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import PageHeader from "@/components/common/PageHeader";
import { Card } from "@/components/common/Card";
import EmptyState from "@/components/common/EmptyState";
import ErrorState from "@/components/common/ErrorState";
import { SkeletonList } from "@/components/common/Skeleton";
import { householdsApi } from "@/services/api";
import {
  HOUSEHOLD_RISK_META as RISK_META,
  normalizeHouseholdRiskLevel as normalizeLevel,
  householdRiskRank,
  countByRiskLevel,
} from "@/lib/householdRiskLevel";
import {
  Search, Home, ShieldAlert, X, Users, ClipboardList,
} from "lucide-react";

/**
 * Household Risk Clusters (BHW / Health Supervisor).
 *
 * Backed by the REAL, scope-enforced households endpoint (GET /api/households):
 * the backend limits the result to the caller's barangay (BHW / assigned HS) or
 * municipality (unassigned HS) and computes `riskLevel` server-side from the
 * ported household-risk rules (backend/src/utils/householdRisk.js). This page
 * only groups those authorized households by their server risk classification —
 * it does NOT run a second risk algorithm and never fabricates data.
 *
 * The risk-level mapping lives in `@/lib/householdRiskLevel` (single source of
 * truth), identical to Household Profiling and the Health Supervisor dashboard.
 */

/** Household detail base path for the current role area (bhw / health_supervisor). */
function useRoleBasePath() {
  const location = useLocation();
  const parts = location.pathname.split("/").filter(Boolean);
  const appIdx = parts.indexOf("app");
  const role = appIdx >= 0 && parts[appIdx + 1] ? parts[appIdx + 1] : "bhw";
  return `/app/${role}`;
}

export default function HouseholdRiskClusters() {
  const basePath = useRoleBasePath();

  const [households, setHouseholds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  const [query, setQuery] = useState("");
  const [levelFilter, setLevelFilter] = useState("all");
  const [detailId, setDetailId] = useState(null);

  /** Load the scope-enforced household list from the API. */
  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const result = await householdsApi.list({ limit: 100 });
      setHouseholds(result?.rows || []);
    } catch (err) {
      setHouseholds([]);
      setLoadError(err?.message || "Unable to load household risk clusters.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Real, server-computed counts per risk level.
  const counts = useMemo(() => countByRiskLevel(households), [households]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return households
      .filter((h) => levelFilter === "all" || normalizeLevel(h.riskLevel) === levelFilter)
      .filter(
        (h) =>
          !q ||
          String(h.headName || "").toLowerCase().includes(q) ||
          String(h.barangay || "").toLowerCase().includes(q) ||
          String(h.id || "").toLowerCase().includes(q)
      )
      .sort(
        (a, b) =>
          householdRiskRank(b.riskLevel) - householdRiskRank(a.riskLevel) ||
          (b.riskScore ?? 0) - (a.riskScore ?? 0)
      );
  }, [households, levelFilter, query]);

  const detail = detailId ? households.find((h) => h.id === detailId) : null;

  const CARDS = [
    { key: "High", label: "High Risk", value: counts.High },
    { key: "Moderate", label: "Moderate Risk", value: counts.Moderate },
    { key: "Low", label: "Low Risk", value: counts.Low },
    { key: "all", label: "Total Households", value: households.length, plain: true },
  ];

  return (
    <>
      <PageHeader
        crumbs={["Early Intervention", "Household Risk Clusters"]}
        title="Household Risk Clusters"
        subtitle="Households grouped by their server-computed risk classification — for early intervention, not diagnosis."
      />

      {/* Cluster overview counts (real, server-computed classification). */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4 mb-5">
        {CARDS.map((c) => {
          const active = levelFilter === c.key;
          const meta = RISK_META[c.key];
          return (
            <button
              key={c.key}
              onClick={() => setLevelFilter(c.plain ? "all" : active ? "all" : c.key)}
              disabled={c.plain}
              className={`rounded-2xl border p-4 text-left transition-colors ${
                active && !c.plain
                  ? "border-brand-blue bg-brand-light/60"
                  : "border-slate-200 bg-white hover:border-brand-blue/40"
              } ${c.plain ? "cursor-default" : ""}`}
            >
              <p className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-brand-gray">
                {meta && <span className={`h-2.5 w-2.5 rounded-full ${meta.dot}`} />}
                {c.label}
              </p>
              <p className="mt-1 text-3xl font-semibold text-brand-ink">
                {loading ? "…" : loadError ? "—" : c.value}
              </p>
            </button>
          );
        })}
      </div>

      <Card className="overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-slate-200 px-5 py-4 sm:flex-row sm:items-center">
          <div className="flex w-full items-center gap-2 rounded-input border border-slate-200 bg-brand-bg/60 px-3.5 py-2.5 sm:max-w-sm">
            <Search className="h-4 w-4 text-brand-gray" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by household, barangay, or ID..."
              className="w-full bg-transparent text-sm outline-none"
            />
          </div>
          {!loading && !loadError && (
            <p className="text-xs text-brand-gray sm:ml-auto">{filtered.length} households</p>
          )}
        </div>

        <div className="p-5">
          {/* LOADING */}
          {loading && <SkeletonList rows={6} />}

          {/* ERROR — never shown as an empty "0 households" state. */}
          {!loading && loadError && (
            <ErrorState
              title="Unable to load household risk clusters"
              message={loadError}
              onRetry={load}
            />
          )}

          {/* EMPTY — genuinely no households in scope. */}
          {!loading && !loadError && households.length === 0 && (
            <EmptyState
              icon={Home}
              title="No household risk clusters found"
              description="Household records will appear here once they are registered for your barangay."
              className="py-8"
            />
          )}

          {/* EMPTY after search / filter. */}
          {!loading && !loadError && households.length > 0 && filtered.length === 0 && (
            <EmptyState
              icon={Search}
              title="No matching household risk clusters"
              description="Try a different search term or clear the risk-level filter."
              className="py-8"
            />
          )}

          {/* RESULTS */}
          {!loading && !loadError && filtered.length > 0 && (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {filtered.map((h) => {
                const level = normalizeLevel(h.riskLevel);
                const meta = RISK_META[level];
                const factors = Array.isArray(h.riskFactors) ? h.riskFactors : [];
                return (
                  <div key={h.id} className="rounded-2xl border border-slate-200 bg-white p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-brand-ink">{h.headName} Household</p>
                        <p className="text-xs text-brand-gray">{h.id} · {h.barangay}</p>
                      </div>
                      <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${meta.chip}`}>
                        <span className={`h-2 w-2 rounded-full ${meta.dot}`} /> {meta.label}
                      </span>
                    </div>
                    <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                      <div className="rounded-btn bg-brand-bg px-2.5 py-2">
                        <p className="text-brand-gray">Risk score</p>
                        <p className="font-semibold text-brand-ink">{h.riskScore ?? 0}/100</p>
                      </div>
                      <div className="rounded-btn bg-brand-bg px-2.5 py-2">
                        <p className="text-brand-gray">Members</p>
                        <p className="font-semibold text-brand-ink">{h.memberCount ?? 0}</p>
                      </div>
                      <div className="rounded-btn bg-brand-bg px-2.5 py-2">
                        <p className="text-brand-gray">Factors</p>
                        <p className="font-semibold text-brand-ink">{factors.length}</p>
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        onClick={() => setDetailId(h.id)}
                        className="inline-flex items-center gap-1 rounded-btn border border-brand-border bg-white px-3 py-1.5 text-xs font-medium text-brand-blue hover:border-brand-blue dark:bg-card"
                      >
                        <ShieldAlert className="h-3.5 w-3.5" /> Risk Details
                      </button>
                      <Link
                        to={`${basePath}/households`}
                        className="inline-flex items-center gap-1 rounded-btn border border-brand-border bg-white px-3 py-1.5 text-xs font-medium text-brand-ink hover:border-brand-blue dark:bg-card"
                      >
                        <Home className="h-3.5 w-3.5" /> Open Profiling
                      </Link>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </Card>

      {/* Detail drawer — real server risk factors + classification. */}
      {detail && (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/60" onClick={() => setDetailId(null)} />
          <div className="absolute right-0 top-0 flex h-full w-full max-w-xl flex-col bg-white shadow-2xl dark:bg-card">
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
              <div>
                <h3 className="text-base font-semibold text-brand-ink">{detail.headName} Household</h3>
                <p className="text-xs text-brand-gray">{detail.id} · {detail.barangay} · {detail.purok}</p>
              </div>
              <button onClick={() => setDetailId(null)} className="text-brand-gray hover:text-brand-ink" aria-label="Close">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
              <section className="rounded-2xl border border-slate-200 bg-white p-4 dark:bg-card">
                <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-brand-gray">Risk Classification</p>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  <div className="rounded-btn bg-brand-bg px-3 py-2.5">
                    <p className="text-[11px] uppercase tracking-wide text-brand-gray">Level</p>
                    <p className="mt-0.5 flex items-center gap-1.5 text-sm font-semibold text-brand-ink">
                      <span className={`h-2 w-2 rounded-full ${RISK_META[normalizeLevel(detail.riskLevel)].dot}`} />
                      {RISK_META[normalizeLevel(detail.riskLevel)].label}
                    </p>
                  </div>
                  <div className="rounded-btn bg-brand-bg px-3 py-2.5">
                    <p className="text-[11px] uppercase tracking-wide text-brand-gray">Risk Score</p>
                    <p className="mt-0.5 text-sm font-semibold text-brand-ink">{detail.riskScore ?? 0}/100</p>
                  </div>
                  <div className="rounded-btn bg-brand-bg px-3 py-2.5">
                    <p className="text-[11px] uppercase tracking-wide text-brand-gray">Members</p>
                    <p className="mt-0.5 text-sm font-semibold text-brand-ink">{detail.memberCount ?? 0}</p>
                  </div>
                </div>
                <p className="mt-3 text-xs text-brand-gray">
                  Classification reflects the configured household monitoring criteria (water source, sanitation,
                  vulnerable members and income) — it is not a clinical diagnosis.
                </p>
              </section>

              <section className="rounded-2xl border border-slate-200 bg-white p-4 dark:bg-card">
                <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-brand-gray">Contributing Risk Factors</p>
                {Array.isArray(detail.riskFactors) && detail.riskFactors.length > 0 ? (
                  <ul className="space-y-1.5">
                    {detail.riskFactors.map((f) => (
                      <li key={f} className="flex items-start gap-2 text-sm text-brand-ink">
                        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-brand-accent" />
                        {f}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-brand-gray">No significant risk factors detected.</p>
                )}
              </section>

              {Array.isArray(detail.flags) && detail.flags.length > 0 && (
                <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-amber-800">Auto-Flags</p>
                  <ul className="space-y-1.5">
                    {detail.flags.map((f) => (
                      <li key={f} className="flex items-start gap-2 text-sm text-amber-800">
                        <ClipboardList className="mt-0.5 h-4 w-4 shrink-0" />
                        {f}
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              <div className="flex flex-wrap gap-2">
                <Link
                  to={`${basePath}/households`}
                  className="inline-flex items-center gap-1.5 rounded-btn bg-brand-blue px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark"
                >
                  <Users className="h-4 w-4" /> Open Household Profiling
                </Link>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
