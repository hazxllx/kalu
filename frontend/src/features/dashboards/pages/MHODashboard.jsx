import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Map, Users, Stethoscope, Send, ShieldAlert, Activity, ClipboardList, ChevronRight, RefreshCw, AlertTriangle } from "lucide-react";
import PageHeader from "@/components/common/PageHeader";
import { Card } from "@/components/common/Card";
import { referralsApi, followUpsApi } from "@/services/api";
import { municipalSubmissionsApi } from "@/services/api/municipalSubmissionsApi";
import {
  fetchCommunityMap,
  fetchEarlyWarningData,
  fetchConditions,
} from "@/services/api/earlyWarningApi";
import CommunityHealthMap from "@/features/analytics/components/CommunityHealthMap";
import { formatDateRange, toLocalISODate } from "@/lib/dateUtils";

/**
 * Municipal Health Officer dashboard.
 *
 * The headline statistics and barangay breakdown are REAL, database-backed and
 * MUNICIPALITY-SCOPED: every figure comes from an existing endpoint whose scope
 * the backend derives from the authenticated MHO's session (never a client id):
 *   - /api/analytics/community-map      → barangays + residents + high-risk
 *   - /api/analytics/early-warning      → consultations (this month) + conditions
 *   - /api/referrals                    → health_referrals (municipality)
 *   - /api/operational/followups        → follow_ups (municipality)
 * A failed load surfaces an explicit error state — never a fake empty/zero.
 *
 * Submission review decisions come from the municipality-scoped persisted
 * review endpoint. The backend does not yet expose a persisted feed of
 * submitted-but-unreviewed TCL/M1 reports, so those totals are not inferred.
 */

const OPEN_REFERRAL_STATUSES = new Set(["Pending", "Accepted", "In Progress"]);
const todayIso = () => new Date().toISOString().slice(0, 10);
const isFollowUpDue = (f) =>
  !["Completed", "Cancelled"].includes(f.status) && f.scheduledDate && String(f.scheduledDate).slice(0, 10) <= todayIso();

const barangayOf = (row) => row?.resident?.barangay || "";

const MAP_PERIODS = [
  { value: "today", label: "Today" },
  { value: "week", label: "This Week" },
  { value: "month", label: "This Month" },
  { value: "3m", label: "Last 3 Months" },
  { value: "6m", label: "Last 6 Months" },
  { value: "year", label: "This Year" },
  { value: "custom", label: "Custom Range" },
  { value: "all", label: "All Records" },
];

const resolveMapRange = (period, custom) => {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  switch (period) {
    case "today":
      return { from: toLocalISODate(today), to: toLocalISODate(now) };
    case "week": {
      const monday = new Date(today);
      monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));
      return { from: toLocalISODate(monday), to: toLocalISODate(now) };
    }
    case "month":
      return { from: toLocalISODate(new Date(now.getFullYear(), now.getMonth(), 1)), to: toLocalISODate(now) };
    case "3m":
      return { from: toLocalISODate(new Date(now.getFullYear(), now.getMonth() - 3, now.getDate())), to: toLocalISODate(now) };
    case "6m":
      return { from: toLocalISODate(new Date(now.getFullYear(), now.getMonth() - 6, now.getDate())), to: toLocalISODate(now) };
    case "year":
      return { from: toLocalISODate(new Date(now.getFullYear(), 0, 1)), to: toLocalISODate(now) };
    case "custom":
      return { from: custom.from || null, to: custom.to || null };
    default:
      return { from: null, to: null };
  }
};

export default function MHODashboard() {
  const [map, setMap] = useState(null);
  const [referrals, setReferrals] = useState(null);
  const [followUps, setFollowUps] = useState(null);
  const [earlyWarning, setEarlyWarning] = useState(null);
  const [mapStatus, setMapStatus] = useState({ loading: true, error: null });
  const [referralsStatus, setReferralsStatus] = useState({ loading: true, error: null });
  const [followUpsStatus, setFollowUpsStatus] = useState({ loading: true, error: null });
  const [earlyWarningStatus, setEarlyWarningStatus] = useState({ loading: true, error: null });
  const [submissionReviews, setSubmissionReviews] = useState(null);
  const [submissionStatus, setSubmissionStatus] = useState({ loading: true, error: null });
  const [conditions, setConditions] = useState([]);
  const [conditionError, setConditionError] = useState(null);
  const [condition, setCondition] = useState("All");
  const [barangayFilter, setBarangayFilter] = useState("All");
  const [mapPeriod, setMapPeriod] = useState("year");
  const [customRange, setCustomRange] = useState({ from: "", to: "" });
  const [selectedName, setSelectedName] = useState(null);

  const mapRange = useMemo(() => resolveMapRange(mapPeriod, customRange), [mapPeriod, customRange]);

  const loadMap = useCallback(async () => {
    setMapStatus({ loading: true, error: null });
    try {
      const result = await fetchCommunityMap({
        condition,
        from: mapRange.from,
        to: mapRange.to,
      });
      setMap(result);
      setMapStatus({ loading: false, error: null });
    } catch (err) {
      setMap(null);
      setMapStatus({ loading: false, error: err?.message || "Unable to load community health data." });
    }
  }, [condition, mapRange.from, mapRange.to]);

  const loadReferrals = useCallback(async () => {
    setReferralsStatus({ loading: true, error: null });
    try {
      const result = await referralsApi.list();
      setReferrals((result?.rows || []).map((r) => ({ status: r.status, resident: r.resident })));
      setReferralsStatus({ loading: false, error: null });
    } catch (err) {
      setReferrals(null);
      setReferralsStatus({ loading: false, error: err?.message || "Unable to load referrals." });
    }
  }, []);

  const loadFollowUps = useCallback(async () => {
    setFollowUpsStatus({ loading: true, error: null });
    try {
      const result = await followUpsApi.list();
      setFollowUps((result?.rows || []).map((f) => ({
        status: f.status,
        scheduledDate: f.scheduled_date,
        resident: f.resident,
      })));
      setFollowUpsStatus({ loading: false, error: null });
    } catch (err) {
      setFollowUps(null);
      setFollowUpsStatus({ loading: false, error: err?.message || "Unable to load follow-ups." });
    }
  }, []);

  const loadEarlyWarning = useCallback(async () => {
    setEarlyWarningStatus({ loading: true, error: null });
    try {
      const result = await fetchEarlyWarningData();
      setEarlyWarning(result);
      setEarlyWarningStatus({ loading: false, error: null });
    } catch (err) {
      setEarlyWarning(null);
      setEarlyWarningStatus({ loading: false, error: err?.message || "Unable to load health trends." });
    }
  }, []);

  const loadSubmissionReviews = useCallback(async () => {
    setSubmissionStatus({ loading: true, error: null });
    try {
      const result = await municipalSubmissionsApi.listReviews();
      setSubmissionReviews(result);
      setSubmissionStatus({ loading: false, error: null });
    } catch (err) {
      setSubmissionReviews(null);
      setSubmissionStatus({ loading: false, error: err?.message || "Unable to load persisted submission reviews." });
    }
  }, []);

  const load = useCallback(() => {
    void Promise.all([loadMap(), loadReferrals(), loadFollowUps(), loadEarlyWarning(), loadSubmissionReviews()]);
  }, [loadMap, loadReferrals, loadFollowUps, loadEarlyWarning, loadSubmissionReviews]);

  useEffect(() => { void loadMap(); }, [loadMap]);
  useEffect(() => { void loadReferrals(); }, [loadReferrals]);
  useEffect(() => { void loadFollowUps(); }, [loadFollowUps]);
  useEffect(() => { void loadEarlyWarning(); }, [loadEarlyWarning]);
  useEffect(() => { void loadSubmissionReviews(); }, [loadSubmissionReviews]);
  useEffect(() => {
    let active = true;
    fetchConditions()
      .then((items) => { if (active) setConditions(items); })
      .catch((err) => { if (active) setConditionError(err?.message || "Unable to load condition filters."); });
    return () => { active = false; };
  }, []);

  const barangays = useMemo(() => map?.barangays || [], [map]);

  const stats = useMemo(() => {
    const totalResidents = barangays.reduce((sum, b) => sum + (b.residents || 0), 0);
    const highRisk = barangays.reduce((sum, b) => sum + (b.highRiskResidents || 0), 0);
    const pendingReferrals = (referrals || []).filter((r) => OPEN_REFERRAL_STATUSES.has(r.status)).length;
    return {
      totalBarangays: barangays.length,
      totalResidents,
      consultationsThisMonth: earlyWarning?.summary?.consultationsThisMonth ?? 0,
      totalReferrals: referrals?.length ?? 0,
      pendingReferrals,
      overdueFollowUps: (followUps || []).filter(isFollowUpDue).length,
      highRisk,
    };
  }, [barangays, referrals, followUps, earlyWarning]);

  const barangayRows = useMemo(() => barangays.map((b) => ({
    name: b.name,
    residents: b.residents || 0,
    highRisk: b.highRiskResidents || 0,
    pendingReferrals: (referrals || []).filter((r) => barangayOf(r) === b.name && OPEN_REFERRAL_STATUSES.has(r.status)).length,
    overdueFollowUps: (followUps || []).filter((f) => barangayOf(f) === b.name && isFollowUpDue(f)).length,
  })), [barangays, referrals, followUps]);

  const topConditions = useMemo(
    () => (earlyWarning?.diseaseDistribution || []).filter((c) => c.name !== "Others" && c.value > 0).slice(0, 5),
    [earlyWarning]
  );
  const maxCondition = topConditions.reduce((m, c) => Math.max(m, c.value), 0) || 1;

  // BUG-019: the reporting period is derived from the actual current date
  // ("Month YYYY"), never a hardcoded month/year.
  const currentPeriod = useMemo(
    () => new Date().toLocaleString("en-US", { month: "long", year: "numeric" }),
    [],
  );
  const periodReviews = (submissionReviews || []).filter((item) => item.period === currentPeriod);
  const tclReviews = periodReviews.filter((item) => String(item.submissionType).toUpperCase() === "TCL").length;
  const m1Reviews = periodReviews.filter((item) => String(item.submissionType).toUpperCase() === "M1").length;
  const pendingReviews = periodReviews.filter((item) => item.reviewStatus === "Pending Review" || item.status === "Under Review").length;
  const correctionReviews = periodReviews.filter((item) => item.reviewStatus === "Needs Correction" || item.reviewStatus === "Returned").length;

  const statValue = (status, value) => status.loading ? "…" : status.error ? "Unavailable" : value;
  const statCards = [
    { icon: Map, tone: "bg-brand-blue/10 text-brand-blue", label: "Total Barangays", value: statValue(mapStatus, stats.totalBarangays), status: mapStatus },
    { icon: Users, tone: "bg-brand-accent/10 text-brand-accent", label: "Registered Residents", value: statValue(mapStatus, stats.totalResidents), status: mapStatus },
    { icon: Stethoscope, tone: "bg-brand-green/10 text-brand-green", label: "Consultations (This Month)", value: statValue(earlyWarningStatus, stats.consultationsThisMonth), status: earlyWarningStatus },
    { icon: Send, tone: "bg-brand-yellow/15 text-[#B07E00]", label: "Total Referrals", value: statValue(referralsStatus, stats.totalReferrals), status: referralsStatus },
    { icon: ShieldAlert, tone: "bg-brand-danger/10 text-brand-danger", label: "High-Risk Residents", value: statValue(mapStatus, stats.highRisk), status: mapStatus },
  ];
  const loadErrors = [
    mapStatus.error && "community map",
    referralsStatus.error && "referrals",
    followUpsStatus.error && "follow-ups",
    earlyWarningStatus.error && "health trends",
    submissionStatus.error && "submission reviews",
  ].filter(Boolean);
  const selectedBarangay = barangays.find((b) => b.name === selectedName) || null;
  const visibleBarangays = useMemo(
    () => barangayFilter === "All" ? barangays : barangays.filter((b) => b.name === barangayFilter),
    [barangayFilter, barangays],
  );
  const periodLabel = mapRange.from || mapRange.to
    ? formatDateRange(mapRange.from, mapRange.to)
    : "All records";
  const reportingYear = mapRange.to || mapRange.from
    ? new Date(mapRange.to || mapRange.from).getFullYear()
    : "All years";

  return (
    <>
      <PageHeader crumbs={["Dashboard"]} title="Municipal Health Dashboard" subtitle="Municipality of Pili, Camarines Sur" />

      {loadErrors.length > 0 && (
        <Card className="mb-4 flex items-start justify-between gap-3 border-brand-danger/30 bg-brand-danger/5 p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-brand-danger" />
            <div>
              <p className="text-sm font-semibold text-brand-ink">Some municipal health data is unavailable</p>
              <p className="mt-0.5 text-xs text-brand-gray">
                Failed sections: {loadErrors.join(", ")}. Values are not treated as zero.
              </p>
            </div>
          </div>
          <button onClick={load} className="inline-flex shrink-0 items-center gap-2 rounded-btn border border-brand-border px-3 py-1.5 text-xs font-medium text-brand-ink hover:border-brand-blue hover:text-brand-blue transition-colors">
            <RefreshCw className="h-3.5 w-3.5" /> Retry
          </button>
        </Card>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-3 sm:gap-5">
        {statCards.map((s, i) => (
          <motion.div key={s.label} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}
            className="rounded-2xl border border-slate-200 bg-white shadow-card p-4 sm:p-5">
            <div className={`w-10 h-10 sm:w-11 sm:h-11 rounded-xl flex items-center justify-center ${s.tone}`}>
              <s.icon className="w-4 h-4 sm:w-5 sm:h-5" strokeWidth={1.8} />
            </div>
            <p className="mt-3 sm:mt-4 text-xs text-brand-gray uppercase tracking-wide">{s.label}</p>
            <p className="mt-1 text-xl sm:text-2xl font-stat font-bold text-brand-ink">{s.value}</p>
            {s.status.error && <p className="mt-1 text-xs text-brand-danger">Data unavailable</p>}
          </motion.div>
        ))}
      </div>

      <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 shadow-card">
        <div className="mb-3 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm font-semibold text-brand-ink">Health Heatmap</p>
            <p className="text-xs text-brand-gray">Municipality of Pili · {periodLabel}</p>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <label className="text-xs font-medium text-brand-gray">
              Condition
              <select
                value={condition}
                onChange={(event) => setCondition(event.target.value)}
                className="mt-1 block w-full rounded-input border border-brand-border bg-white px-3 py-2 text-sm text-brand-ink"
              >
                <option value="All">All conditions</option>
                {conditions.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            </label>
            <label className="text-xs font-medium text-brand-gray">
              Barangay
              <select
                value={barangayFilter}
                onChange={(event) => {
                  const value = event.target.value;
                  setBarangayFilter(value);
                  setSelectedName(value === "All" ? null : value);
                }}
                className="mt-1 block w-full rounded-input border border-brand-border bg-white px-3 py-2 text-sm text-brand-ink"
              >
                <option value="All">All barangays</option>
                {barangays.map((item) => <option key={item.id} value={item.name}>{item.name}</option>)}
              </select>
            </label>
            <label className="text-xs font-medium text-brand-gray">
              Reporting period
              <select
                value={mapPeriod}
                onChange={(event) => setMapPeriod(event.target.value)}
                className="mt-1 block w-full rounded-input border border-brand-border bg-white px-3 py-2 text-sm text-brand-ink"
              >
                {MAP_PERIODS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
            </label>
            {mapPeriod === "custom" && (
              <>
                <label className="text-xs font-medium text-brand-gray">
                  From
                  <input type="date" value={customRange.from} onChange={(event) => setCustomRange((range) => ({ ...range, from: event.target.value }))} className="mt-1 block w-full rounded-input border border-brand-border bg-white px-3 py-2 text-sm text-brand-ink" />
                </label>
                <label className="text-xs font-medium text-brand-gray">
                  To
                  <input type="date" value={customRange.to} onChange={(event) => setCustomRange((range) => ({ ...range, to: event.target.value }))} className="mt-1 block w-full rounded-input border border-brand-border bg-white px-3 py-2 text-sm text-brand-ink" />
                </label>
              </>
            )}
          </div>
        </div>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(260px,0.75fr)]">
          <CommunityHealthMap
            barangays={visibleBarangays}
            center={map?.center || null}
            loading={mapStatus.loading}
            error={mapStatus.error}
            onRetry={loadMap}
            onSelect={(barangay) => setSelectedName(barangay.name)}
            selectedName={selectedName}
          />
          <div className="rounded-xl border border-brand-border bg-slate-50 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-brand-gray">Relative case intensity</p>
            <div className="mt-3 space-y-2 text-xs text-brand-gray">
              <div className="flex items-center gap-2"><span className="h-3 w-3 rounded-full" style={{ backgroundColor: '#F6C453' }} /> Lower</div>
              <div className="flex items-center gap-2"><span className="h-3 w-3 rounded-full" style={{ backgroundColor: '#F59E0B' }} /> Moderate</div>
              <div className="flex items-center gap-2"><span className="h-3 w-3 rounded-full" style={{ backgroundColor: '#EA580C' }} /> Elevated</div>
              <div className="flex items-center gap-2"><span className="h-3 w-3 rounded-full" style={{ backgroundColor: '#B91C1C' }} /> Highest in scope</div>
              <div className="flex items-center gap-2"><span className="h-3 w-3 rounded-full" style={{ backgroundColor: '#94A3B8' }} /> No reported cases</div>
            </div>
            <div className="mt-4 border-t border-brand-border pt-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-brand-gray">Selected period</p>
              <p className="mt-1 text-sm font-medium text-brand-ink">{periodLabel}</p>
              <p className="mt-1 text-xs text-brand-gray">Reporting year: {reportingYear}</p>
              {conditionError && <p className="mt-2 text-xs text-brand-danger">{conditionError}</p>}
              {selectedBarangay ? (
                <div className="mt-3 border-t border-brand-border pt-3">
                  <p className="text-sm font-semibold text-brand-ink">{selectedBarangay.name}</p>
                  <p className="mt-1 text-xs text-brand-gray">{selectedBarangay.caseCount || 0} cases · {selectedBarangay.residents || 0} residents</p>
                  <p className="mt-1 text-xs text-brand-gray">{selectedBarangay.highRiskResidents || 0} high-risk residents</p>
                  <p className="mt-1 text-xs text-brand-gray">{selectedBarangay.activeCases || 0} active · {selectedBarangay.completedCases || 0} completed</p>
                  <p className="mt-1 text-xs text-brand-gray">Top condition: {selectedBarangay.topCondition?.name || "No recorded condition"} ({selectedBarangay.topCondition?.value || 0})</p>
                  {selectedBarangay.lastRecorded && <p className="mt-1 text-xs text-brand-gray">Last recorded: {selectedBarangay.lastRecorded}</p>}
                  {(selectedBarangay.conditions || []).filter((item) => item.value > 0).length > 0 && (
                    <ul className="mt-2 space-y-1 border-t border-brand-border pt-2 text-xs text-brand-gray">
                      {selectedBarangay.conditions.filter((item) => item.value > 0).slice(0, 5).map((item) => (
                        <li key={item.name} className="flex justify-between gap-2">
                          <span>{item.name}</span>
                          <span className="font-semibold text-brand-ink">{item.value}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ) : (
                <p className="mt-3 border-t border-brand-border pt-3 text-xs text-brand-gray">Select a barangay marker to see its aggregated health details.</p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Only persisted review decisions are available; original submission totals have no backend feed yet. */}
      <Link to="/app/mho/submissions" className="mt-6 mb-6 block rounded-2xl border border-slate-200 bg-white p-4 hover:border-brand-blue/40 transition-colors dark:border-border dark:bg-card">
        <div className="flex flex-wrap items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-blue/10 text-brand-blue">
            <ClipboardList className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-brand-ink">Submission Status</p>
            {submissionStatus.loading ? (
              <p className="mt-1 text-xs text-brand-gray">Loading persisted review decisions…</p>
            ) : submissionStatus.error ? (
              <p className="mt-1 text-xs text-brand-danger">{submissionStatus.error}</p>
            ) : (
              <>
                <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-brand-gray">
                  <span>TCL reviews this period: {tclReviews}</span>
                  <span>M1 reviews this period: {m1Reviews}</span>
                  <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-brand-yellow" /> {pendingReviews} under review</span>
                  <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-brand-accent" /> {correctionReviews} returned / needs correction</span>
                </p>
                <p className="mt-1 text-xs text-brand-gray">
                  Persisted review decisions for {currentPeriod}; submitted-but-unreviewed totals are not available from the backend.
                </p>
              </>
            )}
          </div>
          {submissionStatus.error && (
            <button
              type="button"
              onClick={(event) => { event.preventDefault(); event.stopPropagation(); void loadSubmissionReviews(); }}
              className="inline-flex items-center gap-1 rounded-btn border border-brand-border px-2.5 py-1.5 text-xs font-medium text-brand-ink hover:border-brand-blue hover:text-brand-blue"
            >
              <RefreshCw className="h-3 w-3" /> Retry
            </button>
          )}
          <ChevronRight className="h-4 w-4 shrink-0 text-brand-gray" />
        </div>
      </Link>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-5 mt-6">
        {/* Barangay breakdown — real municipality-scoped figures. */}
        <Card className="lg:col-span-2 p-4 sm:p-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-4 sm:mb-5 gap-2">
            <h3 className="font-semibold text-brand-ink text-sm sm:text-base">Barangay Health Summary</h3>
            <Activity className="w-4 h-4 text-brand-gray shrink-0" strokeWidth={1.8} />
          </div>
          {mapStatus.loading ? (
            <p className="text-sm text-brand-gray py-6 text-center">Loading barangay data…</p>
          ) : mapStatus.error ? (
            <div className="py-6 text-center">
              <p className="text-sm text-brand-danger">{mapStatus.error}</p>
              <button onClick={loadMap} className="mt-2 text-sm font-medium text-brand-blue hover:underline">Retry barangay data</button>
            </div>
          ) : barangayRows.length === 0 ? (
            <p className="text-sm text-brand-gray py-6 text-center">No barangays found for your municipality.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase tracking-wide text-brand-gray border-b border-brand-border">
                  <tr>
                    <th className="py-2 pr-3 font-semibold">Barangay</th>
                    <th className="py-2 px-3 font-semibold">Residents</th>
                    <th className="py-2 px-3 font-semibold">High-Risk</th>
                    <th className="py-2 px-3 font-semibold">Pending Referrals</th>
                    <th className="py-2 pl-3 font-semibold">Overdue Follow-ups</th>
                  </tr>
                </thead>
                <tbody>
                  {barangayRows.map((b) => (
                    <tr key={b.name} className="border-b border-brand-border last:border-0">
                      <td className="py-2.5 pr-3 font-medium text-brand-ink">{b.name}</td>
                      <td className="py-2.5 px-3 text-brand-ink">{b.residents}</td>
                      <td className="py-2.5 px-3 text-brand-ink">{b.highRisk}</td>
                      <td className="py-2.5 px-3 text-brand-ink">{referralsStatus.loading ? "…" : referralsStatus.error ? "Unavailable" : b.pendingReferrals}</td>
                      <td className="py-2.5 pl-3 text-brand-ink">{followUpsStatus.loading ? "…" : followUpsStatus.error ? "Unavailable" : b.overdueFollowUps}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        {/* Top Health Conditions — from the scoped Early Warning condition mix. */}
        <Card className="p-4 sm:p-6 h-fit">
          <h3 className="font-semibold text-brand-ink text-sm sm:text-base mb-4">Top Health Conditions</h3>
          {earlyWarningStatus.loading ? (
            <p className="text-sm text-brand-gray py-6 text-center">Loading…</p>
          ) : earlyWarningStatus.error ? (
            <div className="py-6 text-center">
              <p className="text-sm text-brand-danger">{earlyWarningStatus.error}</p>
              <button onClick={loadEarlyWarning} className="mt-2 text-sm font-medium text-brand-blue hover:underline">Retry health trends</button>
            </div>
          ) : topConditions.length === 0 ? (
            <p className="text-sm text-brand-gray py-6 text-center">No consultations recorded yet.</p>
          ) : (
            <div className="space-y-3">
              {topConditions.map((c) => (
                <div key={c.name}>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-brand-ink">{c.name}</span>
                    <span className="text-brand-gray font-stat font-bold">{c.value}</span>
                  </div>
                  <div className="mt-1.5 h-1.5 bg-brand-border rounded-full overflow-hidden">
                    <div className="h-full bg-brand-blue rounded-full" style={{ width: `${Math.round((c.value / maxCondition) * 100)}%` }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
