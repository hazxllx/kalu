import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { MapPin, TrendingUp } from "lucide-react";

import PageHeader from "@/components/common/PageHeader";
import { Card, CardHeader } from "@/components/common/Card";
import StatCard from "@/components/common/StatCard";
import { useAuth } from "@/context/AuthContext";
import { getAssignedBarangay } from "@/lib/barangayScope";
import CommunityHealthMap from "@/features/analytics/components/CommunityHealthMap";
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

const iso = (d) => d.toISOString().slice(0, 10);

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

  const periodLabel = range.from && range.to ? `${range.from} to ${range.to}` : "All records";

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
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">Barangay</label>
              <select
                value={barangayFilter}
                onChange={(e) => { setBarangayFilter(e.target.value); setSelected(null); }}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-brand-blue"
              >
                <option value="All">All Barangays</option>
                {(mapData?.barangays || []).map((b) => (
                  <option key={b.id} value={b.name}>{b.name}</option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">Disease / Health Condition</label>
            <select
              value={condition}
              onChange={(e) => setCondition(e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-brand-blue"
            >
              <option value="All">All Conditions</option>
              {conditions.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">Date Range</label>
            <select
              value={preset}
              onChange={(e) => setPreset(e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-brand-blue"
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
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">From</label>
              <input type="date" value={custom.from} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-brand-blue" />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">To</label>
              <input type="date" value={custom.to} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-brand-blue" />
            </div>
          </div>
        )}
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Map */}
        <div className="lg:col-span-2">
          <Card className="p-5">
            <CardHeader
              title="Health Heatmap"
              subtitle={`${condition === "All" ? "All conditions" : condition} · ${periodLabel}`}
            />
            <div className="pt-4">
              <CommunityHealthMap
                barangays={barangays}
                center={center}
                loading={loading}
                error={error}
                onRetry={loadMap}
                onSelect={(b) => { setSelected(b); if (!isBarangayScoped) loadTrends(b.name); }}
                selectedName={selectedRow?.name || (isBarangayScoped ? assignedBarangay : null)}
              />
            </div>
          </Card>
        </div>

        {/* Barangay detail panel */}
        <div>
          <Card className="p-5">
            <CardHeader title="Barangay Details" subtitle={selectedRow ? selectedRow.name : "Select a barangay on the map"} />
            <div className="pt-4">
              {selectedRow ? (
                <div className="space-y-3 text-sm">
                  <DetailRow label="Selected Condition" value={condition === "All" ? "All conditions" : condition} />
                  <DetailRow label="Reporting Period" value={periodLabel} />
                  <DetailRow label="Total Cases" value={selectedRow.caseCount ?? 0} />
                  <DetailRow label="New Cases (this month)" value={selectedRow.newCases ?? 0} />
                  <DetailRow label="Active Cases" value={selectedRow.activeCases ?? 0} />
                  <DetailRow label="Completed / Resolved" value={selectedRow.completedCases ?? 0} />
                  <button
                    type="button"
                    onClick={() => loadTrends(selectedRow.name)}
                    className="mt-2 inline-flex items-center gap-2 rounded-lg bg-brand-blue px-4 py-2 text-sm font-semibold text-white hover:bg-brand-blue/90"
                  >
                    <TrendingUp className="h-4 w-4" /> View Health Trends
                  </button>
                </div>
              ) : (
                <p className="text-sm text-slate-500">
                  {isBarangayScoped
                    ? "Showing your assigned barangay. Trends are displayed below."
                    : "Click a barangay marker to see its case breakdown and trends."}
                </p>
              )}
            </div>
          </Card>
        </div>
      </div>

      {/* Health trends */}
      <Card className="mt-6 p-5">
        <CardHeader
          title="Health Trends"
          subtitle={`${condition === "All" ? "All conditions" : condition} · ${
            isBarangayScoped ? assignedBarangay : selectedRow?.name || (drillBarangay || "All authorized barangays")
          } · ${trends?.year || new Date(range.to || Date.now()).getFullYear()}`}
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
  );
}

function DetailRow({ label, value }) {
  return (
    <div className="flex items-center justify-between border-b border-slate-100 pb-2 last:border-b-0">
      <span className="text-slate-500">{label}</span>
      <span className="font-semibold text-slate-900">{value}</span>
    </div>
  );
}
