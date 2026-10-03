import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { MapPin, TrendingUp, RotateCcw } from "lucide-react";

import PageHeader from "@/components/common/PageHeader";
import { Card, CardHeader } from "@/components/common/Card";
import StatCard from "@/components/common/StatCard";
import { useAuth } from "@/context/AuthContext";
import { getAssignedBarangay } from "@/lib/barangayScope";
import CommunityHealthMap from "@/features/analytics/components/CommunityHealthMap";
import { toLocalISODate, formatDateRange, formatLongDate, currentYear } from "@/lib/dateUtils";
import {
  fetchCommunityMap,
  fetchCommunityMapTrends,
  fetchConditions,
} from "@/services/api/earlyWarningApi";

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const DATE_PRESETS = [
  { id: "today", label: "Today" },
  { id: "week", label: "This Week" },
  { id: "month", label: "This Month" },
  { id: "3m", label: "Last 3 Months" },
  { id: "6m", label: "Last 6 Months" },
  { id: "year", label: "This Year" },
  { id: "custom", label: "Custom Range" },
];

// Local-day ISO formatter. Using LOCAL calendar components (never UTC) keeps
// the default range anchored to the Philippine calendar day: without this,
// new Date(year, 0, 1) at UTC+8 serialises to the previous year's Dec 31.
const iso = (d) => toLocalISODate(d);

/** Resolve a preset (or custom range) into inclusive {from, to} ISO dates. */
function resolveRange(preset, custom) {
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  switch (preset) {
    case "today":
      return { from: iso(startOfDay), to: iso(now) };
    case "week": {
      const day = startOfDay.getDay(); // 0 = Sun
      const monday = new Date(startOfDay);
      monday.setDate(startOfDay.getDate() - ((day + 6) % 7));
      return { from: iso(monday), to: iso(now) };
    }
    case "month":
      return { from: iso(new Date(now.getFullYear(), now.getMonth(), 1)), to: iso(now) };
    case "3m":
      return { from: iso(new Date(now.getFullYear(), now.getMonth() - 3, now.getDate())), to: iso(now) };
    case "6m":
      return { from: iso(new Date(now.getFullYear(), now.getMonth() - 6, now.getDate())), to: iso(now) };
    case "year":
      return { from: iso(new Date(now.getFullYear(), 0, 1)), to: iso(now) };
    case "custom":
      return { from: custom.from || null, to: custom.to || null };
    default:
      return { from: null, to: null };
  }
}

/**
 * Community Health Monitoring — disease/health trends by barangay.
 *
 * Serves MHO, PHN (both municipality-wide over the Municipality of Pili) and
 * Health Supervisor (their assigned barangay ONLY). The geographic scope is
 * always resolved by the backend from the authenticated session; this page
 * only sends filters (condition / date / an optional drill-down barangay that a
 * municipality-wide caller is allowed to view). A Health Supervisor cannot
 * select another barangay — the selector is locked to their assignment and the
 * server rejects any other value.
 */
export default function CommunityMonitoring() {
  const { user } = useAuth();
  const assignedBarangay = getAssignedBarangay(user); // non-null only for Health Supervisor
  const isBarangayScoped = Boolean(assignedBarangay);
  const municipalityLabel = user?.municipality || "Pili";

  const [conditions, setConditions] = useState([]);
  const [condition, setCondition] = useState("All");
  const [preset, setPreset] = useState("year");
  const [custom, setCustom] = useState({ from: "", to: "" });
  const [barangayFilter, setBarangayFilter] = useState("All"); // municipality-wide only
  const [showHouseholds, setShowHouseholds] = useState(false); // household marker layer toggle

  const [mapData, setMapData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState(null);

  const [trends, setTrends] = useState(null);
  const [trendsLoading, setTrendsLoading] = useState(false);

  const range = useMemo(() => resolveRange(preset, custom), [preset, custom]);

  // The drill-down barangay sent to the API: a municipality-wide caller may pick
  // one of their barangays; a barangay-scoped caller never sends one (the server
  // forces their assignment).
  const drillBarangay = isBarangayScoped ? null : barangayFilter !== "All" ? barangayFilter : null;

  useEffect(() => {
    let cancelled = false;
    fetchConditions()
      .then((list) => { if (!cancelled) setConditions(list); })
      .catch(() => { /* leave the "All" option only */ });
    return () => { cancelled = true; };
  }, []);

  const loadMap = useCallback(() => {
    setLoading(true);
    setError("");
    return fetchCommunityMap({
      barangay: drillBarangay,
      condition,
      from: range.from,
      to: range.to,
    })
      .then((res) => setMapData(res))
      .catch(() => setError("Unable to load community health data."))
      .finally(() => setLoading(false));
  }, [drillBarangay, condition, range.from, range.to]);

  useEffect(() => { loadMap(); }, [loadMap]);

  const barangays = mapData?.barangays || [];
  const summary = mapData?.summary || { totalCases: 0, affectedBarangays: 0, newCases: 0, activeCases: 0, completedCases: 0 };
  const center = mapData?.center || null;

  // When the map re-loads, keep the selected barangay's figures fresh.
  const selectedRow = useMemo(() => {
    if (!selected) return null;
    return barangays.find((b) => b.name === selected.name) || selected;
  }, [selected, barangays]);

  // A barangay-scoped Health Supervisor is implicitly focused on their single
  // assigned barangay, so the detail card is populated from that row without
  // requiring a map click. A municipality-wide caller must pick a barangay.
  const detailRow = useMemo(
    () => (isBarangayScoped ? barangays[0] || null : selectedRow),
    [isBarangayScoped, barangays, selectedRow],
  );

  const filtersDirty =
    condition !== "All" ||
    preset !== "year" ||
    Boolean(custom.from) ||
    Boolean(custom.to) ||
    (!isBarangayScoped && barangayFilter !== "All");

  const resetFilters = useCallback(() => {
    setCondition("All");
    setPreset("year");
    setCustom({ from: "", to: "" });
    setBarangayFilter("All");
    setSelected(null);
  }, []);

  const loadTrends = useCallback((barangayName) => {
    setTrendsLoading(true);
    fetchCommunityMapTrends({
      barangay: isBarangayScoped ? null : barangayName || drillBarangay,
      condition,
      year: new Date(range.to || Date.now()).getFullYear(),
    })
      .then((res) => setTrends(res))
      .catch(() => setTrends(null))
      .finally(() => setTrendsLoading(false));
  }, [isBarangayScoped, drillBarangay, condition, range.to]);

  // Auto-load trends for a barangay-scoped supervisor (single barangay focus).
  useEffect(() => {
    if (isBarangayScoped) loadTrends(assignedBarangay);
  }, [isBarangayScoped, assignedBarangay, loadTrends]);

  // Readable range for card subtitles, e.g. "Jan 1, 2026 – Sep 27, 2026".
  const periodLabel = range.from || range.to ? formatDateRange(range.from, range.to) : "All records";
  const trendsYear = trends?.year || currentYear(new Date(range.to || Date.now()));

  const trendData = (trends?.monthly || MONTH_LABELS.map((m) => ({ month: m, cases: 0 })));

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        crumbs={["Monitoring", "Community Monitoring"]}
        title="Community Health Monitoring"
        subtitle={
          isBarangayScoped
            ? `Assigned Barangay: ${assignedBarangay} — aggregated health cases and disease trends for your barangay.`
            : `Municipality of ${municipalityLabel} — aggregated health cases and disease trends across authorized barangays.`
        }
        action={
          <div className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-brand-ink" title="Your authorized geographic scope">
            <MapPin className="h-4 w-4 text-brand-blue" />
            {isBarangayScoped ? `Brgy. ${assignedBarangay}` : `Municipality of ${municipalityLabel}`}
          </div>
        }
      />

      {/* Summary cards */}
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard icon="Activity" tone="blue" index={0} label={isBarangayScoped ? "Total Health Cases" : "Total Cases"} value={summary.totalCases ?? 0} />
        {isBarangayScoped ? (
          <StatCard icon="TrendingUp" tone="green" index={1} label="New Cases" value={summary.newCases ?? 0} />
        ) : (
          <StatCard icon="Map" tone="accent" index={1} label="Affected Barangays" value={summary.affectedBarangays ?? 0} />
        )}
        <StatCard icon="TrendingUp" tone="yellow" index={2} label="New Cases" value={summary.newCases ?? 0} />
        <StatCard icon="AlertTriangle" tone="danger" index={3} label={isBarangayScoped ? "Active Cases / Follow-ups" : "Active Cases"} value={summary.activeCases ?? 0} />
      </div>

      {/* Filters */}
      <Card className="mb-6 p-5">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {!isBarangayScoped && (
            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-brand-gray">Barangay</label>
              <select
                value={barangayFilter}
                onChange={(e) => { setBarangayFilter(e.target.value); setSelected(null); }}
                className="h-10 w-full rounded-btn border border-slate-200 bg-white px-3 text-sm outline-none focus:border-brand-blue"
              >
                <option value="All">All Barangays</option>
                {(mapData?.barangays || []).map((b) => (
                  <option key={b.id} value={b.name}>{b.name}</option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-brand-gray">Disease / Health Condition</label>
            <select
              value={condition}
              onChange={(e) => setCondition(e.target.value)}
              className="h-10 w-full rounded-btn border border-slate-200 bg-white px-3 text-sm outline-none focus:border-brand-blue"
            >
              <option value="All">All Conditions</option>
              {conditions.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-brand-gray">Date Range</label>
            <select
              value={preset}
              onChange={(e) => setPreset(e.target.value)}
              className="h-10 w-full rounded-btn border border-slate-200 bg-white px-3 text-sm outline-none focus:border-brand-blue"
            >
              {DATE_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
            </select>
          </div>
        </div>

        {preset === "custom" && (
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-brand-gray">From</label>
              <input type="date" value={custom.from} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))}
                className="h-10 w-full rounded-btn border border-slate-200 bg-white px-3 text-sm outline-none focus:border-brand-blue" />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-brand-gray">To</label>
              <input type="date" value={custom.to} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))}
                className="h-10 w-full rounded-btn border border-slate-200 bg-white px-3 text-sm outline-none focus:border-brand-blue" />
            </div>
          </div>
        )}

        <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-4">
          <p className="text-xs text-brand-gray">
            Showing <span className="font-semibold text-brand-ink">{condition === "All" ? "all conditions" : condition}</span>
            {" · "}
            <span className="font-semibold text-brand-ink">{periodLabel}</span>
          </p>
          <button
            type="button"
            onClick={resetFilters}
            disabled={!filtersDirty}
            className="inline-flex items-center gap-1.5 rounded-btn border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-brand-ink transition-colors hover:border-brand-blue hover:text-brand-blue disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RotateCcw className="h-3.5 w-3.5" /> Reset Filters
          </button>
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Left / main column: Health Heatmap + Health Trends */}
        <div className="space-y-6 lg:col-span-2">
          <Card className="p-5">
            <CardHeader
              title="Health Heatmap"
              subtitle={`${condition === "All" ? "All conditions" : condition} · ${periodLabel}`}
            />
            <div className="pt-3">
              <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-brand-ink">
                <input
                  type="checkbox"
                  checked={showHouseholds}
                  onChange={(e) => setShowHouseholds(e.target.checked)}
                  className="h-4 w-4 accent-brand-blue"
                />
                Show household markers (active cases)
              </label>
            </div>
            <div className="pt-4">
              <CommunityHealthMap
                barangays={barangays}
                center={center}
                loading={loading}
                error={error}
                onRetry={loadMap}
                onClearFilters={filtersDirty ? resetFilters : null}
                onSelect={(b) => { setSelected(b); if (!isBarangayScoped) loadTrends(b.name); }}
                selectedName={selectedRow?.name || (isBarangayScoped ? assignedBarangay : null)}
                showHouseholds={showHouseholds}
                householdBarangay={isBarangayScoped ? assignedBarangay : drillBarangay}
              />
            </div>
          </Card>

          {/* Health Trends */}
          <Card className="p-5">
            <CardHeader
              title="Health Trends"
              subtitle={`${condition === "All" ? "All conditions" : condition} · ${
                isBarangayScoped ? assignedBarangay : selectedRow?.name || (drillBarangay || "All authorized barangays")
              } · ${trendsYear}`}
            />
            <div className="pt-4">
              {trendsLoading ? (
                <div className="flex h-[280px] items-center justify-center text-sm text-slate-500">Loading trends…</div>
              ) : (
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={trendData} margin={{ top: 8, right: 16, left: -8, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#EEF2F7" />
                    <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                    <Tooltip contentStyle={{ fontSize: "12px", borderRadius: "8px", border: "1px solid #E5EAF1" }} />
                    <Bar dataKey="cases" name="Cases" fill="#0B5CAD" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </Card>
        </div>

        {/* Right column: Barangay detail panel */}
        <div>
          <Card className="p-5">
            <CardHeader
              title="Barangay Details"
              subtitle={condition === "All" ? "All conditions" : condition}
            />
            <div className="pt-4">
              {detailRow ? (
                <BarangayDetail
                  row={detailRow}
                  periodLabel={periodLabel}
                  showTrendsButton={!isBarangayScoped}
                  onViewTrends={() => loadTrends(detailRow.name)}
                />
              ) : (
                <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-6 py-10 text-center">
                  <span className="flex h-11 w-11 items-center justify-center rounded-full bg-brand-blue/10 text-brand-blue">
                    <MapPin className="h-5 w-5" strokeWidth={1.6} />
                  </span>
                  <p className="text-sm font-semibold text-brand-ink">Select a barangay</p>
                  <p className="max-w-xs text-xs text-slate-500">
                    Click a barangay on the map to see its case breakdown, top condition and trends.
                  </p>
                </div>
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

/** Database-driven detail card for one barangay. */
function BarangayDetail({ row, periodLabel, showTrendsButton, onViewTrends }) {
  const activeCases = row.activeCases ?? 0;
  const top = row.topCondition || { name: "No recorded condition", value: 0 };
  const hasTop = Number(top.value) > 0;
  const conditions = (row.conditions || []).filter((c) => Number(c.value) > 0);
  const hasConditions = conditions.length > 0;
  const lastRecorded = row.lastRecorded ? formatLongDate(row.lastRecorded) : null;

  return (
    <div className="space-y-4 text-sm">
      <div>
        <p className="text-lg font-semibold text-brand-ink">{row.name}</p>
        <p className="text-xs text-slate-500">{periodLabel}</p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-slate-200 bg-white px-3 py-2.5">
          <p className="text-xs font-medium text-slate-500">Active health cases</p>
          <p className="text-xl font-semibold text-brand-ink">{activeCases}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white px-3 py-2.5">
          <p className="text-xs font-medium text-slate-500">Total cases</p>
          <p className="text-xl font-semibold text-brand-ink">{row.caseCount ?? 0}</p>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white px-3 py-2.5">
        <p className="text-xs font-medium text-slate-500">Top condition</p>
        <p className="text-base font-semibold text-brand-ink">{top.name}</p>
        <p className="text-xs text-slate-500">{hasTop ? `${top.value} ${top.value === 1 ? "case" : "cases"}` : "0 cases"}</p>
      </div>

      <div className="flex items-center justify-between border-b border-slate-100 pb-2">
        <span className="text-slate-500">Last recorded</span>
        <span className="font-semibold text-slate-900">{lastRecorded || "—"}</span>
      </div>

      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-brand-gray">Health conditions</p>
        {hasConditions ? (
          <ul className="space-y-1.5">
            {conditions.map((c) => (
              <li key={c.name} className="flex items-center justify-between border-b border-slate-100 pb-1.5 last:border-b-0">
                <span className="text-slate-600">{c.name}</span>
                <span className="font-semibold text-slate-900">{c.value}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-lg bg-slate-50 px-3 py-3 text-xs text-slate-500">
            No health conditions recorded for this period.
          </p>
        )}
      </div>

      {showTrendsButton && (
        <button
          type="button"
          onClick={onViewTrends}
          className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-brand-blue px-4 py-2 text-sm font-semibold text-white hover:bg-brand-blue/90"
        >
          <TrendingUp className="h-4 w-4" /> View Health Trends
        </button>
      )}
    </div>
  );
}
