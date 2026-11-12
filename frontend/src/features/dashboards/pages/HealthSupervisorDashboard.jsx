import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { AnimatePresence, MotionConfig, motion, useReducedMotion } from "framer-motion";
import { ArrowRight, ArrowUpRight, CalendarClock, CalendarDays, ChevronLeft, ChevronRight, Download, MapPin, Send, Stethoscope, UserRound } from "lucide-react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card } from "@/components/common/Card";
import KpiHorizontal from "@/components/common/KpiHorizontal";
import StatusBadge from "@/components/common/StatusBadge";
import EmptyState from "@/components/common/EmptyState";
import ErrorState from "@/components/common/ErrorState";
import { useAuth } from "@/context/AuthContext";
import { usePermissions } from "@/context/PermissionsContext";
import useAuthorizedData from "@/hooks/useAuthorizedData";
import { referralsApi, followUpsApi, residentsApi, consultationsApi, healthServicesApi } from "@/services/api";
import { fetchEarlyWarningData, fetchCommunityMap } from "@/services/api/earlyWarningApi";
import { authorizedViewsApi } from "@/services/api/authorizedViewsApi";
import { buildBarangayHealthOverview } from "@/services/api/monitoringApi";
import { getSupervisorScope } from "@/lib/supervisorScope";
import { loadServerRows } from "@/lib/serverRows";
import { toLocalISODate } from "@/lib/dateUtils";
import { manilaDateKey, fromKey, formatTime } from "@/features/follow-ups/lib/scheduleDates";
import CommunityHealthMap from "@/features/analytics/components/CommunityHealthMap";
import TopHealthTrends from "@/features/dashboards/components/TopHealthTrends";
import HealthSupervisorPageHeader from "@/features/dashboards/components/HealthSupervisorPageHeader";
import { buildTopHealthTrends } from "@/features/dashboards/components/healthTrendsUtils";
import { mapFollowUpEvent, mapHealthServiceEvent } from "@/features/dashboards/components/scheduleCalendarUtils";
import { downloadCsv } from "@/features/health-records/lib/programFormExport";
import {
  requireDashboardRows, recordsForBarangay, isOpenFollowUp, isOverdueFollowUp,
  buildMonitoringPriorities, enrichMonitoringCases, matchesMonitoringFilter,
  upcomingActivities, requireSupervisorMap, riskDistributionRows, dashboardGreeting,
  previousFourMonths, openedCaseSeries, highRiskCaseSeries, followUpPerformance, monitoringCasesCsv,
} from "@/features/dashboards/components/supervisorDashboardData";

const BASE = "/app/health_supervisor";
const PAGE_SIZE = 5;
const FILTERS = [
  { id: "all", label: "All" }, { id: "high-risk", label: "High Risk" },
  { id: "overdue", label: "Overdue" }, { id: "pending-referral", label: "Pending Referrals" },
];
const RISK_COLORS = { "Low Risk": "#367B59", "Moderate Risk": "#B18A32", "High Risk": "#B3202C", Unassessed: "#CBD5E1" };
const dateLabel = (value, options = {}) => {
  if (!value) return "Date not recorded";
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(value)) ? new Date(`${value}T00:00:00+08:00`) : new Date(value);
  return Number.isNaN(date.getTime()) ? "Date not recorded" : new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", month: "short", day: "numeric", ...options }).format(date);
};

function SourceErrors({ errors }) {
  if (!errors.length) return null;
  return <div className="hs-source-errors" role="alert">{errors.map(({ label, message, retry }) => <div key={label}><p><strong>{label}: </strong>{message}</p><button type="button" onClick={retry} aria-label={`Retry ${label.toLowerCase()}`}>Retry</button></div>)}</div>;
}

export default function HealthSupervisorDashboard() {
  const { user, refreshProfile } = useAuth();
  const { can } = usePermissions();
  const assignedBarangay = getSupervisorScope(user)?.assignedBarangay;
  const reducedMotion = useReducedMotion();
  const canAnalytics = can("reports.analytics.view");
  const canResidents = can("residents.directory.view");
  const canReferrals = can("referrals.view") || can("referrals.history.view");
  const canOpenReferrals = can("referrals.view");
  const canFollowUps = can("followups.view");
  const canConsultations = can("consultation.requests.view");
  const canServices = can("services.view");
  const canReports = can("reports.view");
  const canExport = can("reports.export");
  const [localTime, setLocalTime] = useState(() => new Date());
  const [today, setToday] = useState(manilaDateKey);
  const [selectedPeriod, setSelectedPeriod] = useState(() => { const date = fromKey(manilaDateKey()); return { month: date.getMonth(), year: date.getFullYear() }; });
  const [attentionFilter, setAttentionFilter] = useState("all");
  const [attentionPage, setAttentionPage] = useState(0);
  const [mapMetric, setMapMetric] = useState("highRiskResidents");
  const [selectedMapName, setSelectedMapName] = useState(null);
  const [exportError, setExportError] = useState("");
  const registerMenu = useRef(null);

  useEffect(() => {
    const update = () => { setLocalTime(new Date()); setToday(manilaDateKey()); };
    const closeMenu = (event) => { if (registerMenu.current && !registerMenu.current.contains(event.target)) registerMenu.current.removeAttribute("open"); };
    const escape = (event) => { if (event.key === "Escape") registerMenu.current?.removeAttribute("open"); };
    const clock = window.setInterval(update, 60000);
    window.addEventListener("focus", update);
    document.addEventListener("pointerdown", closeMenu);
    document.addEventListener("keydown", escape);
    return () => { clearInterval(clock); window.removeEventListener("focus", update); document.removeEventListener("pointerdown", closeMenu); document.removeEventListener("keydown", escape); };
  }, []);

  const currentDate = fromKey(today);
  const firstMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() - 23, 1);
  const years = Array.from({ length: currentDate.getFullYear() - firstMonth.getFullYear() + 1 }, (_, i) => currentDate.getFullYear() - i);
  const monthOptions = (year) => Array.from({ length: 12 }, (_, month) => month).filter((month) => new Date(year, month, 1) >= firstMonth && new Date(year, month, 1) <= new Date(currentDate.getFullYear(), currentDate.getMonth(), 1));
  const periodLabel = new Date(selectedPeriod.year, selectedPeriod.month, 1).toLocaleDateString("en-PH", { month: "long", year: "numeric" });
  const periodRange = useMemo(() => ({ from: toLocalISODate(new Date(selectedPeriod.year, selectedPeriod.month, 1)), to: toLocalISODate(new Date(selectedPeriod.year, selectedPeriod.month + 1, 0)) }), [selectedPeriod]);
  const previousRange = useMemo(() => ({ from: toLocalISODate(new Date(selectedPeriod.year, selectedPeriod.month - 1, 1)), to: toLocalISODate(new Date(selectedPeriod.year, selectedPeriod.month, 0)) }), [selectedPeriod]);
  const trendMonths = useMemo(() => previousFourMonths(selectedPeriod.year, selectedPeriod.month), [selectedPeriod]);
  const trendRange = useMemo(() => ({ from: `${trendMonths[0].key}-01`, to: toLocalISODate(new Date(selectedPeriod.year, selectedPeriod.month, 0)) }), [trendMonths, selectedPeriod]);
  const trendLabel = `${dateLabel(trendRange.from, { day: undefined })} - ${dateLabel(trendRange.to, { day: undefined, year: "numeric" })}`;
  const upcomingRange = useMemo(() => { const end = fromKey(today); end.setDate(end.getDate() + 30); return { from: today, to: toLocalISODate(end) }; }, [today]);

  const loadOverview = useCallback(async () => {
    if (!assignedBarangay || !canAnalytics) return null;
    const data = await fetchEarlyWarningData(assignedBarangay, periodRange);
    if (data.scope?.barangay !== assignedBarangay || data.activity?.rows?.some((row) => row.barangay !== assignedBarangay)) throw new Error("The monitoring response is outside your assigned barangay.");
    return { ...buildBarangayHealthOverview(data, assignedBarangay), riskDistribution: data.riskDistribution };
  }, [assignedBarangay, canAnalytics, periodRange]);
  const overview = useAuthorizedData(loadOverview);
  const loadCurrentCases = useCallback(async () => !assignedBarangay || !canAnalytics ? null : requireSupervisorMap(await fetchCommunityMap({ barangay: assignedBarangay }), assignedBarangay), [assignedBarangay, canAnalytics]);
  const currentCases = useAuthorizedData(loadCurrentCases);
  const loadPeriodMap = useCallback(async () => !assignedBarangay || !canAnalytics ? null : requireSupervisorMap(await fetchCommunityMap({ barangay: assignedBarangay, ...periodRange }), assignedBarangay), [assignedBarangay, canAnalytics, periodRange]);
  const periodMap = useAuthorizedData(loadPeriodMap);
  const loadPreviousMap = useCallback(async () => !assignedBarangay || !canAnalytics ? null : requireSupervisorMap(await fetchCommunityMap({ barangay: assignedBarangay, ...previousRange }), assignedBarangay), [assignedBarangay, canAnalytics, previousRange]);
  const previousMap = useAuthorizedData(loadPreviousMap);
  const loadReferrals = useCallback(async ({ ownerId }) => !assignedBarangay || !canReferrals ? null : recordsForBarangay(requireDashboardRows(await referralsApi.list(undefined, { ownerId }), "referrals"), assignedBarangay), [assignedBarangay, canReferrals]);
  const referrals = useAuthorizedData(loadReferrals);
  const loadFollowUps = useCallback(async () => !assignedBarangay || !canFollowUps ? null : recordsForBarangay(requireDashboardRows(await followUpsApi.list(), "follow-ups"), assignedBarangay), [assignedBarangay, canFollowUps]);
  const followUps = useAuthorizedData(loadFollowUps);
  const loadResidents = useCallback(async ({ ownerId }) => !assignedBarangay || !canResidents ? null : recordsForBarangay(await loadServerRows((params) => residentsApi.list({ ...params, barangay: assignedBarangay }, { ownerId })), assignedBarangay), [assignedBarangay, canResidents]);
  const residents = useAuthorizedData(loadResidents);
  // Opening-time trends require all authorized records, not an encounter-date subset.
  const loadConsultations = useCallback(async ({ ownerId }) => !assignedBarangay || !canConsultations ? null : recordsForBarangay(await loadServerRows((params) => consultationsApi.list(params, { ownerId }), 500), assignedBarangay), [assignedBarangay, canConsultations]);
  const consultations = useAuthorizedData(loadConsultations);
  const loadServices = useCallback(async () => !assignedBarangay || !canServices ? null : recordsForBarangay(requireDashboardRows(await healthServicesApi.listAttendance(upcomingRange), "health-service schedule"), assignedBarangay), [assignedBarangay, canServices, upcomingRange]);
  const services = useAuthorizedData(loadServices);
  const loadHighRiskTrend = useCallback(async ({ ownerId }) => {
    if (!assignedBarangay || !canAnalytics) return null;
    const years = [...new Set(trendMonths.map((month) => month.year))];
    const data = await Promise.all(years.map((year) => authorizedViewsApi.communityTrends({ barangay: assignedBarangay, riskLevel: "High", year, ...trendRange }, { ownerId })));
    return highRiskCaseSeries(data, trendMonths, assignedBarangay);
  }, [assignedBarangay, canAnalytics, trendMonths, trendRange]);
  const highRiskTrend = useAuthorizedData(loadHighRiskTrend);

  const cases = useMemo(() => {
    const data = { residents: residents.data || [], referrals: referrals.data || [], followUps: followUps.data || [], consultations: consultations.data || [], barangay: assignedBarangay, today };
    return enrichMonitoringCases(buildMonitoringPriorities(data), data);
  }, [residents.data, referrals.data, followUps.data, consultations.data, assignedBarangay, today]);
  const filteredCases = cases.filter((item) => matchesMonitoringFilter(item, attentionFilter));
  const pageCount = Math.max(1, Math.ceil(filteredCases.length / PAGE_SIZE));
  const page = Math.min(attentionPage, pageCount - 1);
  const visibleCases = filteredCases.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const prioritySources = [{ allowed: canResidents, label: "Resident assessments", state: residents }, { allowed: canReferrals, label: "Referrals", state: referrals }, { allowed: canFollowUps, label: "Follow-ups", state: followUps }, { allowed: canConsultations, label: "Consultations", state: consultations }].filter((source) => source.allowed);
  const priorityErrors = prioritySources.filter(({ state }) => state.error).map(({ label, state }) => ({ label, message: state.error, retry: state.refresh }));
  const prioritiesLoading = prioritySources.some(({ state }) => state.loading);
  const filterAvailable = (id) => id === "all" ? priorityErrors.length ? cases.length > 0 : prioritySources.some(({ state }) => Array.isArray(state.data)) : id === "high-risk" ? canResidents && !residents.error : id === "overdue" ? canFollowUps && !followUps.error : canReferrals && !referrals.error;
  const registerLinks = [{ label: "Resident Directory", href: `${BASE}/residents`, allowed: canResidents, filter: "high-risk" }, { label: "Consultation Records", href: `${BASE}/consultations`, allowed: canConsultations }, { label: "Follow-up Monitoring", href: `${BASE}/followups?status=Overdue`, allowed: canFollowUps, filter: "overdue" }, { label: "Referral Register", href: `${BASE}/referrals?status=Pending`, allowed: canOpenReferrals, filter: "pending-referral" }].filter((link) => link.allowed && (attentionFilter === "all" || link.filter === attentionFilter));
  const exportCases = () => {
    try { setExportError(""); downloadCsv(`KALUSAGAP-attention-${String(assignedBarangay).replace(/[^a-z0-9]+/gi, "-")}-${today}.csv`, monitoringCasesCsv(filteredCases)); }
    catch (error) { setExportError(error?.message || "The monitoring records could not be exported."); }
  };
  const openedTrend = useMemo(() => {
    if (!consultations.data) return { data: null, error: "" };
    try { return { data: openedCaseSeries(consultations.data, trendMonths), error: "" }; }
    catch (error) { return { data: null, error: error.message }; }
  }, [consultations.data, trendMonths]);
  const caseTrend = useMemo(() => trendMonths.map((month, index) => ({ ...month, opened: openedTrend.data?.[index]?.opened ?? null, highRisk: highRiskTrend.data?.[index]?.highRisk ?? null })), [trendMonths, openedTrend.data, highRiskTrend.data]);
  const hasTrend = caseTrend.some((row) => row.opened > 0 || row.highRisk > 0);
  const trendErrors = [...(consultations.error || openedTrend.error ? [{ label: "Cases opened", message: consultations.error || openedTrend.error, retry: consultations.refresh }] : []), ...(highRiskTrend.error ? [{ label: "High-risk findings", message: highRiskTrend.error, retry: highRiskTrend.refresh }] : [])];
  const mapOptions = [{ value: "highRiskResidents", label: "High-risk residents" }, { value: "activeCases", label: "Active health cases" }, { value: "caseCount", label: "Recorded cases" }, ...(periodMap.data?.conditionTotals || []).filter((row) => row.value > 0).map((row) => ({ value: `condition:${row.name}`, label: row.name }))];
  const condition = mapMetric.startsWith("condition:") ? mapMetric.slice(10) : null;
  useEffect(() => {
    if (condition && !periodMap.loading && periodMap.data && !periodMap.data.conditionTotals.some((row) => row.name === condition && row.value > 0)) setMapMetric("caseCount");
  }, [condition, periodMap.loading, periodMap.data]);
  const mapSource = mapMetric === "highRiskResidents" ? currentCases : periodMap;
  const mapContext = mapMetric === "highRiskResidents" ? "Latest recorded resident risk" : periodLabel;
  const scheduleErrors = [...(canFollowUps && followUps.error ? [{ label: "Follow-ups", message: followUps.error, retry: followUps.refresh }] : []), ...(canServices && services.error ? [{ label: "Health services", message: services.error, retry: services.refresh }] : [])];
  const activities = useMemo(() => upcomingActivities([...(followUps.data || []).filter(isOpenFollowUp).map(mapFollowUpEvent), ...(services.data || []).map(mapHealthServiceEvent)].filter(Boolean), upcomingRange.from, upcomingRange.to), [followUps.data, services.data, upcomingRange]);
  const people = new Map((residents.data || []).map((row) => [row.id, row]));
  const conditions = useMemo(() => buildTopHealthTrends(periodMap.data?.barangays || [], previousMap.loading || previousMap.error ? null : previousMap.data?.barangays || null, { limit: 3 }), [periodMap.data, previousMap.data, previousMap.loading, previousMap.error]);
  const riskRows = riskDistributionRows(overview.data?.riskDistribution);
  const riskTotal = riskRows?.reduce((sum, row) => sum + row.value, 0) || 0;
  const performance = followUpPerformance(followUps.data, periodRange, today);
  const metricValue = (allowed, source, value) => !allowed ? "No access" : source.loading ? "Loading" : source.error ? null : value ?? null;
  const statistics = [
    { label: "High-Risk Residents", value: metricValue(canAnalytics, overview, overview.data?.metrics.residentRisk.high), description: "Residents requiring priority health attention", tone: "red", href: canResidents ? `${BASE}/residents?risk=High` : null },
    { label: "Overdue Follow-ups", value: metricValue(canFollowUps, followUps, followUps.data?.filter((row) => isOverdueFollowUp(row, today)).length), description: "Follow-ups past their scheduled due dates", tone: "red", href: canFollowUps ? `${BASE}/followups?status=Overdue` : null },
    { label: "Pending Referrals", value: metricValue(canAnalytics, overview, overview.data?.metrics.pendingReferrals), description: "Referrals awaiting receiving or action", tone: "amber", href: canOpenReferrals ? `${BASE}/referrals?status=Pending` : null },
    { label: "Active Health Cases", value: metricValue(canAnalytics, currentCases, currentCases.data?.summary.activeCases), description: "Currently open consultation and TB records", tone: "green", href: canConsultations ? `${BASE}/consultations` : null },
  ];
  const intro = { hidden: { opacity: 0, y: reducedMotion ? 0 : 7 }, visible: { opacity: 1, y: 0, transition: { duration: reducedMotion ? 0 : 0.28 } } };

  return <MotionConfig reducedMotion="user"><motion.div className="hs-dashboard" key={`${user?.id}:${assignedBarangay}`} initial="hidden" animate="visible" variants={{ visible: { transition: { staggerChildren: reducedMotion ? 0 : 0.045 } } }}>
    <HealthSupervisorPageHeader
      title={`${dashboardGreeting(localTime)}${user?.name ? `, ${user.name}` : ""}`}
      subtitle="Here's an overview of your health supervision activities."
      meta={
        <span className="inline-flex items-center gap-2 whitespace-nowrap">
          <span className="text-[10px] font-semibold uppercase tracking-gov text-brand-goldlight">KALUSAGAP</span>
          <span className="text-[10px] uppercase tracking-gov text-white/70">{assignedBarangay ? `Barangay ${assignedBarangay}` : "Barangay assignment unavailable"}</span>
        </span>
      }
      action={
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Reporting period controls">
          <select className="hs-control" aria-label="Reporting month" value={selectedPeriod.month} onChange={(event) => setSelectedPeriod((current) => ({ ...current, month: Number(event.target.value) }))}>{monthOptions(selectedPeriod.year).map((month) => <option key={month} value={month}>{new Date(2000, month, 1).toLocaleDateString("en-PH", { month: "long" })}</option>)}</select>
          <select className="hs-control hs-year-control" aria-label="Reporting year" value={selectedPeriod.year} onChange={(event) => { const year = Number(event.target.value); const months = monthOptions(year); setSelectedPeriod({ year, month: months.includes(selectedPeriod.month) ? selectedPeriod.month : months[months.length - 1] }); }}>{years.map((year) => <option key={year} value={year}>{year}</option>)}</select>
          {canReports ? <Link className="hs-button hs-button-primary" to={`${BASE}/reports`}>View Reports<ArrowUpRight aria-hidden="true" /></Link> : <button className="hs-button hs-button-primary" type="button" disabled title="Reports permission is required">View Reports<ArrowUpRight aria-hidden="true" /></button>}
        </div>
      }
    />

    <motion.section className="hs-statistics" aria-label="Operational statistics" variants={intro}><KpiHorizontal count={4}>{statistics.map((stat) => <KpiHorizontal.Item key={stat.label} label={stat.label.toUpperCase()} value={stat.value} description={stat.description} tone={stat.tone} />)}</KpiHorizontal>{(overview.error || currentCases.error) && <SourceErrors errors={[...(overview.error ? [{ label: "Operational statistics", message: overview.error, retry: overview.refresh }] : []), ...(currentCases.error ? [{ label: "Active cases", message: currentCases.error, retry: currentCases.refresh }] : [])]} />}</motion.section>

    {!assignedBarangay ? <Card><ErrorState compact title="Barangay assignment unavailable" message="Refresh your account information before opening community records." onRetry={refreshProfile} retryLabel="Refresh Account" /></Card> : <>
      <motion.section className="hs-quick-actions" aria-labelledby="quick-actions-heading" variants={intro}><h2 id="quick-actions-heading" className="hs-eyebrow">Quick Actions</h2><div>
        {[{ label: "Consults", Icon: Stethoscope, href: `${BASE}/consultations`, allowed: canConsultations }, { label: "Follow-ups", Icon: CalendarClock, href: `${BASE}/followups`, allowed: canFollowUps }, { label: "Referrals", Icon: Send, href: `${BASE}/referrals`, allowed: canOpenReferrals }].filter((action) => action.allowed).map(({ label, Icon, href }) => <Link className="hs-shortcut" to={href} key={label}><span><Icon aria-hidden="true" /></span>{label}</Link>)}
      </div></motion.section>

      <div className="hs-main-grid">
        <motion.section className="hs-panel hs-attention-panel" aria-labelledby="attention-heading" variants={intro}>
          <header className="hs-panel-header"><div className="hs-title-group"><h2 id="attention-heading">Cases Requiring Attention</h2></div><div className="hs-panel-actions">
            <button type="button" className="hs-button" onClick={exportCases} disabled={!canExport || !filteredCases.length || prioritiesLoading || priorityErrors.length > 0} title={!canExport ? "Export permission is required" : "Export all records matching the selected filter"}><Download aria-hidden="true" />Export</button>
            {registerLinks.length === 1 ? <Link className="hs-button" to={registerLinks[0].href} title={`Open ${registerLinks[0].label}`}>View All<ArrowUpRight aria-hidden="true" /></Link> : registerLinks.length ? <details ref={registerMenu} className="hs-register-menu"><summary className="hs-button">View All<ArrowUpRight aria-hidden="true" /></summary><nav aria-label="Choose an existing monitoring register">{registerLinks.map((link) => <Link to={link.href} key={link.href} onClick={() => registerMenu.current?.removeAttribute("open")}>{link.label}<ArrowUpRight aria-hidden="true" /></Link>)}</nav></details> : <button type="button" className="hs-button" disabled>View All<ArrowUpRight aria-hidden="true" /></button>}
          </div></header>
          <p className="hs-panel-description">Residents with high-risk assessments, unresolved cases, referrals or follow-ups requiring review.</p>
          <div className="hs-case-filters" role="group" aria-label="Filter cases requiring attention">{FILTERS.map((filter) => <button key={filter.id} type="button" aria-pressed={attentionFilter === filter.id} title={priorityErrors.length ? "Available source records only; retry failed sources for complete counts" : "Authorized monitoring records"} onClick={() => { setAttentionFilter(filter.id); setAttentionPage(0); }}><span>{filter.label}</span><span>{prioritiesLoading ? "..." : !filterAvailable(filter.id) ? "--" : `${cases.filter((item) => matchesMonitoringFilter(item, filter.id)).length}${priorityErrors.length ? "+" : ""}`}</span></button>)}</div>
          <SourceErrors errors={priorityErrors} />{exportError && <p className="hs-inline-error" role="alert">{exportError}</p>}
          <AnimatePresence initial={false} mode="wait"><motion.div key={`${attentionFilter}:${page}`} initial={{ opacity: reducedMotion ? 1 : 0 }} animate={{ opacity: 1 }} exit={{ opacity: reducedMotion ? 1 : 0 }} transition={{ duration: reducedMotion ? 0 : 0.12 }}>
            {prioritiesLoading && !cases.length ? <p className="hs-loading" role="status">Loading authorized monitoring records...</p> : visibleCases.length ? <ul className="hs-case-list">{visibleCases.map((item) => {
              const clickable = item.category === "Resident assessment" ? can("residents.profile.view") : item.category === "Referral" ? canOpenReferrals : true;
              const content = <><div className="hs-case-first-line"><h3>{item.resident}</h3><span className={`hs-risk-badge ${item.riskLevel === "High" ? "is-high" : item.riskLevel === "Moderate" ? "is-medium" : item.riskLevel === "Low" ? "is-low" : "is-unassessed"}`}>{item.riskLabel}</span>{clickable && <ArrowRight className="hs-case-arrow" aria-hidden="true" />}</div><p className="hs-case-concern" title={`${item.category}: ${item.detail}`}>{item.priority !== "High Risk" ? `${item.priority}: ` : ""}{item.detail}</p><div className="hs-case-metadata"><span title={item.areaBasis}><MapPin aria-hidden="true" />{item.area}</span><span title={item.dateLabel}><CalendarDays aria-hidden="true" />{dateLabel(item.date, { year: "numeric" })}</span><span title={item.responsible || "No responsible-personnel name was provided"}><UserRound aria-hidden="true" />{item.responsible || "Personnel not recorded"}</span></div></>;
              return <li key={item.key}>{clickable ? <Link to={item.href} aria-label={`${item.action} for ${item.resident}`}>{content}</Link> : <article>{content}</article>}</li>;
            })}</ul> : <EmptyState compact title={priorityErrors.length ? "No cases in the available sources" : !prioritySources.length ? "Monitoring access unavailable" : "No cases match this filter"} description={priorityErrors.length ? "Retry the unavailable sources to complete this list." : "Cases requiring clinical or supervisory review appear here."} />}
          </motion.div></AnimatePresence>
          <footer className="hs-case-pagination"><span>{filteredCases.length ? `Showing ${page * PAGE_SIZE + 1}-${Math.min((page + 1) * PAGE_SIZE, filteredCases.length)} of ${filteredCases.length}${priorityErrors.length ? " available records" : " records"}` : prioritiesLoading ? "Checking records" : priorityErrors.length ? "Some record sources are unavailable" : !prioritySources.length ? "Register access is unavailable" : "0 matching records"}</span><div><button type="button" className="hs-page-button" aria-label="Previous case page" disabled={page === 0} onClick={() => setAttentionPage(page - 1)}><ChevronLeft aria-hidden="true" /></button><span>{page + 1} / {pageCount}</span><button type="button" className="hs-page-button" aria-label="Next case page" disabled={page === pageCount - 1} onClick={() => setAttentionPage(page + 1)}><ChevronRight aria-hidden="true" /></button></div></footer>
        </motion.section>

        <div className="hs-main-sidebar">
          <motion.section className="hs-panel hs-map-panel" aria-labelledby="map-heading" variants={intro}>
            <header className="hs-panel-header"><div><h2 id="map-heading">Community Health Map</h2></div><select className="hs-control hs-metric-select" aria-label="Community map metric" value={mapMetric} onChange={(event) => setMapMetric(event.target.value)}>{mapOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></header>
            <div className="hs-map-content">{canAnalytics ? <CommunityHealthMap variant="dashboard" height={260} barangays={mapSource.data?.barangays || []} center={mapSource.data?.center || null} loading={mapSource.loading} error={mapSource.error} onRetry={mapSource.refresh} showCountLabels showNewCases={false} periodLabel={mapContext} displayMetric={condition ? "caseCount" : mapMetric} metricLabel={mapOptions.find((option) => option.value === mapMetric)?.label || condition || "Recorded cases"} visibleConditions={condition ? [condition] : null} selectedName={selectedMapName} onSelect={(row) => setSelectedMapName(row.name)} detailsHref={`${BASE}/trends`} /> : <EmptyState compact title="Map access unavailable" description="Analytics permission is required." />}</div>
            <footer className="hs-panel-footer">{canAnalytics ? <Link to={`${BASE}/trends`}>Open health trends<ArrowUpRight aria-hidden="true" /></Link> : <span>Health trends requires analytics access</span>}</footer>
          </motion.section>
          <motion.section className="hs-panel hs-trends-panel" aria-labelledby="case-trends-heading" variants={intro}>
            <header className="hs-panel-header"><div><h2 id="case-trends-heading">Case Trends</h2><p>{trendLabel}</p></div>{canReports && <Link to={`${BASE}/reports`} className="hs-text-link">Reports<ArrowUpRight aria-hidden="true" /></Link>}</header>
            <SourceErrors errors={trendErrors} />
            {(canConsultations && consultations.loading) || (canAnalytics && highRiskTrend.loading) ? <p className="hs-loading" role="status">Loading four-month case trends...</p> : hasTrend ? <><div className="hs-line-chart" role="img" aria-label="Case records opened and high-risk case findings over the previous four completed months"><ResponsiveContainer width="100%" height={148}><LineChart data={caseTrend} margin={{ top: 8, right: 9, left: -12, bottom: 0 }}><CartesianGrid vertical={false} stroke="#DDE5EF" strokeDasharray="2 4" /><XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: "#667991" }} tickMargin={8} /><YAxis allowDecimals={false} axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: "#667991" }} width={36} tickCount={3} /><Tooltip contentStyle={{ fontSize: 11, borderRadius: 3, border: "1px solid #D6DEE8", boxShadow: "0 2px 8px #102E5010" }} labelFormatter={(_label, payload) => payload[0]?.payload?.key || _label} />{openedTrend.data && <Line type="monotone" dataKey="opened" name="Cases opened" stroke="#124C80" strokeWidth={1.8} dot={false} activeDot={{ r: 3 }} connectNulls={false} isAnimationActive={!reducedMotion} animationDuration={420} />}{highRiskTrend.data && <Line type="monotone" dataKey="highRisk" name="High-risk findings" stroke="#B28A31" strokeWidth={1.8} dot={false} activeDot={{ r: 3 }} connectNulls={false} isAnimationActive={!reducedMotion} animationDuration={420} />}</LineChart></ResponsiveContainer></div><div className="hs-chart-legend">{openedTrend.data && <span><i style={{ background: "#124C80" }} />Cases opened</span>}{highRiskTrend.data && <span><i style={{ background: "#B28A31" }} />High-risk findings</span>}</div><p className="hs-chart-note">Opened: record creation dates. High-risk: recorded cases under current assessment rules.</p></> : <EmptyState compact title={trendErrors.length ? "Available trend data has no recorded cases" : !canAnalytics && !canConsultations ? "Trend access unavailable" : "No case activity in these months"} description="Historical values are shown only when authorized records are available." />}
          </motion.section>
        </div>
      </div>

      <div className="hs-bottom-grid">
        <motion.section className="hs-panel hs-upcoming-panel" aria-labelledby="upcoming-heading" variants={intro}>
          <header className="hs-panel-header"><div><h2 id="upcoming-heading">Upcoming Activities</h2><p>Next scheduled services and follow-ups</p></div>{(canFollowUps || canServices) && <Link to={`${BASE}/followup-calendar`} className="hs-text-link">View Schedule<ArrowUpRight aria-hidden="true" /></Link>}</header>
          <SourceErrors errors={scheduleErrors} />
          {(canFollowUps && followUps.loading) || (canServices && services.loading) ? <p className="hs-loading" role="status">Loading scheduled activities...</p> : activities.length ? <ul className="hs-activity-list">{activities.map((event) => {
            const person = people.get(event.residentId);
            const location = event.location || (person?.zone ? `Zone ${person.zone}` : "Location not recorded");
            return <li key={`${event.type}-${event.id}`}><Link to={`${BASE}/followup-calendar?date=${event.dateKey}`}><time dateTime={event.dateKey}><strong>{fromKey(event.dateKey).getDate()}</strong><span>{dateLabel(event.dateKey, { day: undefined, month: "short" })}</span></time><div className="hs-activity-info"><h3>{event.label}</h3><p><span>{event.time ? formatTime(event.time) : "Time not specified"}</span><span>{location}</span><span>{event.typeLabel}</span></p></div><StatusBadge value={event.status} /></Link></li>;
          })}</ul> : <EmptyState compact title={scheduleErrors.length ? "No activities in the available sources" : !canFollowUps && !canServices ? "Schedule access unavailable" : "No upcoming activities"} description="The next 30 days of scheduled follow-ups and services appear here." />}
          <footer className="hs-panel-footer"><span>Next 30 days | Philippine time</span></footer>
        </motion.section>

        <motion.section className="hs-panel hs-insights-panel" aria-labelledby="insights-heading" variants={intro}>
          <header className="hs-panel-header"><div><h2 id="insights-heading">Community Health Insights</h2><p>{periodLabel}</p></div>{canReports && <Link to={`${BASE}/reports`} className="hs-text-link">Reports<ArrowUpRight aria-hidden="true" /></Link>}</header>
          <div className="hs-insight-section"><h3>Common Conditions</h3>{canAnalytics ? <><TopHealthTrends compact trends={conditions} loading={periodMap.loading} error={periodMap.error} onRetry={periodMap.refresh} /><p className="hs-insight-note">Classified complaint records, not confirmed diagnoses.{previousMap.error ? " Previous comparison unavailable." : conditions.some((row) => row.direction) ? " Compared with the preceding month." : " No reliable preceding-period comparison."}</p>{previousMap.error && <button className="hs-inline-retry" type="button" onClick={previousMap.refresh}>Retry comparison</button>}</> : <p className="hs-muted">Analytics access is required.</p>}</div>
          <div className="hs-insight-section"><h3>Resident Risk Distribution</h3>{overview.loading && canAnalytics ? <p className="hs-muted" role="status">Loading assessments...</p> : !riskRows ? <p className="hs-muted">Risk distribution unavailable.</p> : <><div className="hs-risk-bar" role="img" aria-label={riskRows.map((row) => `${row.name}: ${row.value}`).join(", ")}>{riskRows.filter((row) => row.value > 0).map((row) => <motion.span key={row.name} initial={{ width: 0 }} animate={{ width: `${riskTotal ? row.value / riskTotal * 100 : 0}%` }} transition={{ duration: reducedMotion ? 0 : 0.35 }} style={{ backgroundColor: RISK_COLORS[row.name] }} />)}</div><dl className="hs-risk-legend">{riskRows.map((row) => <div key={row.name}><dt><i style={{ background: RISK_COLORS[row.name] }} />{row.name === "Moderate Risk" ? "Medium" : row.name.replace(" Risk", "")}</dt><dd>{row.value.toLocaleString()}</dd></div>)}</dl></>}</div>
          <div className="hs-insight-section hs-followup-performance"><div className="hs-followup-heading"><h3>Follow-up Performance</h3><strong>{followUps.loading ? "Loading" : performance?.percentage != null ? `${performance.percentage}%` : "--"}</strong></div>{performance ? <><dl><div><dt>Completed</dt><dd>{performance.completed}</dd></div><div><dt>Pending</dt><dd>{performance.pending}</dd></div><div><dt>Overdue</dt><dd className="hs-urgent">{performance.overdue}</dd></div></dl><div className="hs-followup-bar" role="img" aria-label={`${performance.completed} completed, ${performance.pending} pending, ${performance.overdue} overdue, ${performance.other} other outcomes`}>
            {[{ key: "completed", color: "#367B59" }, { key: "pending", color: "#B18A32" }, { key: "overdue", color: "#B3202C" }, { key: "other", color: "#D5DEE9" }].map((part) => <motion.span key={part.key} initial={{ width: 0 }} animate={{ width: `${performance.scheduled ? performance[part.key] / performance.scheduled * 100 : 0}%` }} transition={{ duration: reducedMotion ? 0 : 0.35 }} style={{ backgroundColor: part.color }} />)}
          </div><p className="hs-insight-note">{performance.scheduled ? `${performance.scheduled} scheduled in this period; current outcomes. Grey includes missed/cancelled records.` : "No scheduled follow-ups in this period; a completion rate cannot be calculated."}</p></> : <p className="hs-muted">{followUps.error ? "Follow-up performance unavailable." : !canFollowUps ? "Follow-up access is required." : "Loading scheduled outcomes..."}</p>}{followUps.error && <button type="button" className="hs-inline-retry" onClick={followUps.refresh}>Retry follow-up data</button>}</div>
        </motion.section>
      </div>
    </>}
  </motion.div></MotionConfig>;
}
