import React, { useCallback, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import { TrendingUp, TrendingDown, Activity, Send, MapPin, CalendarDays } from "lucide-react";
import PageHeader from "@/components/common/PageHeader";
import { Card } from "@/components/common/Card";
import KpiHorizontal from "@/components/common/KpiHorizontal";
import EmptyState from "@/components/common/EmptyState";
import { PageSkeleton } from "@/components/common/Skeleton";
import ErrorState from "@/components/common/ErrorState";
import { useAuth } from "@/context/AuthContext";
import { useTheme } from "@/context/ThemeContext";
import { usePermissions } from "@/context/PermissionsContext";
import { getSupervisorScope, HS_SCOPE } from "@/lib/supervisorScope";
import { getAssignedBarangay } from "@/lib/barangayScope";
import { toLocalISODate, formatDateRange } from "@/lib/dateUtils";
import { authorizedViewsApi } from "@/services/api/authorizedViewsApi";
import useAuthorizedData from "@/hooks/useAuthorizedData";
import { healthTrendScope, metricValue, lastActivityPeriod, optionalSeries } from "@/lib/legacyAnalytics";

const tooltipStyle = (darkMode) => ({
  fontSize: "12px",
  borderRadius: "8px",
  border: `1px solid ${darkMode ? "#334155" : "#E5EAF1"}`,
  backgroundColor: darkMode ? "#172334" : "#FFFFFF",
  color: darkMode ? "#E2E8F0" : "#12263F",
});

const SUMMARY_ICONS = [
  { icon: Activity, tone: "bg-brand-blue/10 text-brand-blue" },
  { icon: Send, tone: "bg-brand-yellow/15 text-[#B07E00]" },
  { icon: TrendingUp, tone: "bg-brand-green/10 text-brand-green" },
  { icon: TrendingDown, tone: "bg-brand-danger/10 text-brand-danger" },
];

const CONDITION_PALETTE = ["#0B5CAD", "#2A7DE1", "#F5B400", "#28B463", "#E74C3C", "#5B6472"];
const RISK_COLORS = { "Low Risk": "#28B463", "Moderate Risk": "#0B5CAD", "High Risk": "#F5B400", Critical: "#E74C3C", Unassessed: "#94A3B8" };
const SUPERVISOR_RISK_COLORS = { "Low Risk": "#357558", "Moderate Risk": "#A87B24", "High Risk": "#B3202C", Critical: "#871B27", Unassessed: "#94A3B8" };
const SUPERVISOR_CONDITION_PALETTE = ["#0B4A8F", "#457BA3", "#83A8BC", "#A78234", "#586877", "#C2CED9"];

export default function HealthTrends() {
  const { user } = useAuth();
  const { resolved } = useTheme();
  const { can } = usePermissions();
  const darkMode = resolved === "dark";
  const chartTooltipStyle = tooltipStyle(darkMode);
  const chartInk = darkMode ? "#CBD5E1" : "#5B6472";
  const chartGrid = darkMode ? "#334155" : "#E5EAF1";
  const supervisor = user?.role === "health_supervisor";
  const supervisorScope = getSupervisorScope(user);
  const canViewAnalytics = can("reports.analytics.view");
  // Barangay scope comes from the signed-in user's assignment — never from a
  // selector, URL or filter the user controls.
  const assignedBarangay = supervisor ? supervisorScope?.level === HS_SCOPE.BARANGAY ? supervisorScope.assignedBarangay : null : getAssignedBarangay(user);
  const [period, setPeriod] = useState("12m");
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });
  const [selectedQuarter, setSelectedQuarter] = useState(() => {
    const now = new Date();
    const q = Math.floor(now.getMonth() / 3) + 1;
    return { year: now.getFullYear(), quarter: q };
  });
  const [selectedYear, setSelectedYear] = useState(() => new Date().getFullYear());
  const activityRange = period === "monthly" ? (() => {
    const [year, month] = selectedMonth.split('-');
    const start = new Date(parseInt(year), parseInt(month) - 1, 1);
    const end = new Date(parseInt(year), parseInt(month), 0);
    return { from: toLocalISODate(start), to: toLocalISODate(end) };
  })() : period === "quarterly" ? (() => {
    const quarterStartMonth = (selectedQuarter.quarter - 1) * 3;
    const start = new Date(selectedQuarter.year, quarterStartMonth, 1);
    const end = new Date(selectedQuarter.year, quarterStartMonth + 3, 0);
    return { from: toLocalISODate(start), to: toLocalISODate(end) };
  })() : period === "yearly" ? (() => {
    const start = new Date(selectedYear, 0, 1);
    const end = new Date(selectedYear, 11, 31);
    return { from: toLocalISODate(start), to: toLocalISODate(end) };
  })() : lastActivityPeriod(period === "3m" ? 3 : period === "6m" ? 6 : 12);
  
  const activityCaption = period === "monthly" ? new Date(`${selectedMonth}-01`).toLocaleDateString("en-PH", { month: "long", year: "numeric" }) 
    : period === "quarterly" ? `Q${selectedQuarter.quarter} ${selectedQuarter.year}`
    : period === "yearly" ? `${selectedYear}`
    : formatDateRange(activityRange.from, activityRange.to);

  const muniRange = useMemo(() => {
    const now = new Date();
    const iso = (d) => toLocalISODate(d);
    if (period === "monthly") {
      const [year, month] = selectedMonth.split('-');
      const start = new Date(parseInt(year), parseInt(month) - 1, 1);
      const end = new Date(parseInt(year), parseInt(month), 0);
      return { from: iso(start), to: iso(end) };
    }
    if (period === "quarterly") {
      const quarterStartMonth = (selectedQuarter.quarter - 1) * 3;
      const start = new Date(selectedQuarter.year, quarterStartMonth, 1);
      const end = new Date(selectedQuarter.year, quarterStartMonth + 3, 0);
      return { from: iso(start), to: iso(end) };
    }
    if (period === "yearly") {
      const start = new Date(selectedYear, 0, 1);
      const end = new Date(selectedYear, 11, 31);
      return { from: iso(start), to: iso(end) };
    }
    const months = period === "3m" ? 3 : period === "6m" ? 6 : 12;
    return { from: iso(new Date(now.getFullYear(), now.getMonth() - months, now.getDate())), to: iso(now) };
  }, [period, selectedMonth, selectedQuarter, selectedYear]);

  const load = useCallback(async (options) => {
    if (supervisor && !assignedBarangay) throw new Error("A valid barangay assignment is required to view health trends.");
    if (supervisor && !canViewAnalytics) throw new Error("Your account is not permitted to view health analytics.");
    const getRangeForPeriod = () => {
      if (period === "monthly") {
        const [year, month] = selectedMonth.split('-');
        const start = new Date(parseInt(year), parseInt(month) - 1, 1);
        const end = new Date(parseInt(year), parseInt(month), 0);
        return { from: toLocalISODate(start), to: toLocalISODate(end) };
      }
      if (period === "quarterly") {
        const quarterStartMonth = (selectedQuarter.quarter - 1) * 3;
        const start = new Date(selectedQuarter.year, quarterStartMonth, 1);
        const end = new Date(selectedQuarter.year, quarterStartMonth + 3, 0);
        return { from: toLocalISODate(start), to: toLocalISODate(end) };
      }
      if (period === "yearly") {
        const start = new Date(selectedYear, 0, 1);
        const end = new Date(selectedYear, 11, 31);
        return { from: toLocalISODate(start), to: toLocalISODate(end) };
      }
      return lastActivityPeriod(period === '3m' ? 3 : period === '6m' ? 6 : 12);
    };
    const warningRequest = authorizedViewsApi.earlyWarning({ barangay: assignedBarangay, ...getRangeForPeriod() }, options);
    if (supervisor) {
      const ew = await warningRequest;
      if (ew.scope?.barangay !== assignedBarangay || ew.activity?.rows?.some((row) => row.barangay !== assignedBarangay)) throw new Error("Health trends are outside your assigned barangay.");
      return { ew, map: null };
    }
    const [ew, map] = await Promise.all([
      warningRequest,
      authorizedViewsApi.communityMap({ barangay: assignedBarangay, from: muniRange.from, to: muniRange.to }, options),
    ]);
    return { ew, map };
  }, [assignedBarangay, muniRange.from, muniRange.to, period, selectedMonth, selectedQuarter, selectedYear, supervisor, canViewAnalytics]);
  const resource = useAuthorizedData(load);
  const muniEW = resource.data?.ew;
  const muniMap = resource.data?.map;
  const loading = resource.loading;
  const muniLoading = resource.loading;
  const muniError = resource.error;
  const loadMunicipality = resource.refresh;
  
  const periodMonths = useMemo(() => {
    return period === "3m" ? 3 : period === "6m" ? 6 : period === "quarterly" ? 3 : period === "yearly" ? 12 : period === "monthly" ? 1 : 12;
  }, [period]);

  const serviceEntry = useCallback((name) => {
    return optionalSeries(muniEW, name, periodMonths, [assignedBarangay])?.find((row) => row.name === assignedBarangay);
  }, [muniEW, periodMonths, assignedBarangay]);
  
  const base = useMemo(() => {
    return healthTrendScope(muniEW, periodMonths);
  }, [muniEW, periodMonths]);
  
  const conditionPalette = supervisor ? SUPERVISOR_CONDITION_PALETTE : CONDITION_PALETTE;
  const riskPalette = supervisor ? SUPERVISOR_RISK_COLORS : RISK_COLORS;
  
  const scopedData = useMemo(() => {
    if (!base || !muniEW) return null;
    return {
      ...base,
      diseaseDistribution: base.diseaseDistribution.map((row, index) => ({
        ...row,
        color: conditionPalette[index % conditionPalette.length]
      })),
      riskDistribution: muniEW.riskDistribution.map((row) => ({
        ...row,
        color: riskPalette[row.name] || "#94A3B8"
      }))
    };
  }, [base, muniEW?.riskDistribution, conditionPalette, riskPalette]);

  if (resource.error) return <><PageHeader crumbs={supervisor ? ["Monitoring", "Health Trends"] : ["Analytics", "Health Trends"]} title="Health Trends" subtitle="Authorized recorded health activity." /><Card className="p-5"><ErrorState compact={supervisor} title="Health trends unavailable" message={resource.error} onRetry={resource.refresh} /></Card></>;
  if (supervisor && !assignedBarangay) return <><PageHeader crumbs={["Monitoring", "Health Trends"]} title="Health Trends" subtitle="Barangay assignment required" /><Card><ErrorState compact title="Health trends unavailable" message="No valid barangay assignment is available for this account. Municipal coverage is not available to an unassigned Health Supervisor." /></Card></>;
  if (assignedBarangay && !scopedData) return <><PageHeader crumbs={supervisor ? ["Monitoring", "Health Trends"] : ["Analytics", "Health Trends"]} title={`Brgy. ${assignedBarangay} Health Trends`} /><PageSkeleton /></>;

  /* ------------------------------------------------------------------ */
  /* Barangay-scoped view (Health Supervisor assigned to one barangay)   */
  /* ------------------------------------------------------------------ */
  if (assignedBarangay) {
    const s = scopedData;
    const completionRows = s.followUpCompletion;
    const completionAvailable = Array.isArray(completionRows) && completionRows.length > 0 && completionRows.every((row) => Number.isSafeInteger(row.numerator) && Number.isSafeInteger(row.denominator) && row.numerator >= 0 && row.numerator <= row.denominator);
    
    const enrollment = s.programCompliance?.find((row) => row.name === assignedBarangay);
    const participation = serviceEntry("programParticipation");
    const immunizations = serviceEntry("vaccinationCoverage");
    const childConsultations = serviceEntry("childHealthCoverage");
    const serviceMonth = enrollment?.month || participation?.month || immunizations?.month;
    const serviceDate = /^\d{4}-\d{2}$/.test(serviceMonth || "") ? new Date(`${serviceMonth}-01T12:00:00`) : null;
    const serviceMonthLabel = serviceDate && !Number.isNaN(serviceDate.getTime()) ? serviceDate.toLocaleDateString("en-PH", { month: "long", year: "numeric" }) : "Reporting month unavailable";
    const cards = [
      { ...SUMMARY_ICONS[0], label: "Consultations This Month", value: s.summary.consultationsThisMonth.value, change: s.summary.consultationsThisMonth.change, up: s.summary.consultationsThisMonth.up },
      { ...SUMMARY_ICONS[1], label: "Referrals This Month", value: s.summary.referralsThisMonth.value, change: s.summary.referralsThisMonth.change, up: s.summary.referralsThisMonth.up },
      { ...SUMMARY_ICONS[2], label: "Top Condition", value: s.summary.topCondition.name, change: s.summary.topCondition.cases, up: true },
      { ...SUMMARY_ICONS[3], label: "High-Risk Residents", value: s.summary.highRiskResidents.value, change: s.summary.highRiskResidents.change, up: s.summary.highRiskResidents.up },
    ];

    return (
      <div className={supervisor ? "supervisor-module" : "contents"}>
        {/* Compact Header */}
        <PageHeader
           crumbs={supervisor ? ["Monitoring", "Health Trends"] : ["Health Trends"]}
           title="Health Trends"
           subtitle={`Recorded health activity and risk monitoring for Barangay ${assignedBarangay}`}
        />

        {/* Compact Filter Toolbar */}
         <div className="border-b border-brand-border bg-white mb-6">
           <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between px-4 py-3 min-h-[60px]">
            {/* Left: Report Filters */}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
              <span className="text-xs font-semibold text-brand-gray uppercase tracking-wide">Report Filters</span>
              
              {/* Barangay Selector */}
              <div className="flex items-center gap-2 min-w-fit">
                <MapPin className="h-4 w-4 text-brand-blue shrink-0" aria-hidden="true" />
                <span className="text-sm font-medium text-brand-ink">{assignedBarangay}</span>
              </div>

              {/* Period Selector */}
              <div className="flex items-center gap-2">
                <CalendarDays className="h-4 w-4 text-brand-blue shrink-0" aria-hidden="true" />
                <select
                  id="health-trends-period"
                  aria-label="Reporting period"
                  value={period}
                  onChange={(e) => setPeriod(e.target.value)}
                  className="rounded-btn border border-brand-border bg-white px-2.5 py-1.5 text-sm font-medium text-brand-ink outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/30 min-w-[120px]"
                >
                  <option value="monthly">Monthly</option>
                  <option value="quarterly">Quarterly</option>
                  <option value="yearly">Yearly</option>
                  <option value="3m">Last 3 Months</option>
                  <option value="6m">Last 6 Months</option>
                  <option value="12m">Last 12 Months</option>
                </select>
              </div>

               {/* Date Selector Container (reserved space with consistent width) */}
               <div className="h-9 flex items-center min-w-[200px]">
                 {/* Month Selector (Monthly) */}
                 {period === "monthly" && (
                   <input
                     type="month"
                     value={selectedMonth}
                     onChange={(e) => setSelectedMonth(e.target.value)}
                     className="rounded-btn border border-brand-border bg-white px-2.5 py-1.5 text-sm font-medium text-brand-ink outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/30 w-[140px]"
                     aria-label="Select month"
                   />
                 )}

                 {/* Quarter Selector (Quarterly) */}
                 {period === "quarterly" && (
                   <div className="flex items-center gap-2 w-[200px]">
                     <select
                       value={selectedQuarter.quarter}
                       onChange={(e) => setSelectedQuarter({ ...selectedQuarter, quarter: parseInt(e.target.value) })}
                       className="rounded-btn border border-brand-border bg-white px-2.5 py-1.5 text-sm font-medium text-brand-ink outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/30 w-[60px]"
                       aria-label="Select quarter"
                     >
                       <option value={1}>Q1</option>
                       <option value={2}>Q2</option>
                       <option value={3}>Q3</option>
                       <option value={4}>Q4</option>
                     </select>
                     <input
                       type="number"
                       value={selectedQuarter.year}
                       onChange={(e) => setSelectedQuarter({ ...selectedQuarter, year: parseInt(e.target.value) })}
                       min="2020"
                       max="2099"
                       className="rounded-btn border border-brand-border bg-white px-2.5 py-1.5 text-sm font-medium text-brand-ink outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/30 w-[90px]"
                       aria-label="Select year"
                     />
                   </div>
                 )}

                 {/* Year Selector (Yearly) */}
                 {period === "yearly" && (
                   <input
                     type="number"
                     value={selectedYear}
                     onChange={(e) => setSelectedYear(parseInt(e.target.value))}
                     min="2020"
                     max="2099"
                     className="rounded-btn border border-brand-border bg-white px-2.5 py-1.5 text-sm font-medium text-brand-ink outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/30 w-[90px]"
                     aria-label="Select year"
                   />
                 )}
               </div>
            </div>

            {/* Right: Reporting Period Indicator */}
             <div className="flex items-baseline gap-1.5 lg:border-l lg:border-brand-border lg:pl-4 lg:ml-auto">
               <span className="text-xs font-semibold text-brand-gray uppercase tracking-wide">Period:</span>
               <span className="text-sm font-semibold text-brand-ink whitespace-nowrap">{activityCaption}</span>
             </div>
          </div>
        </div>

        {/* Summary */}
        {loading ? (
          <PageSkeleton />
        ) : (
        <>
        {supervisor ? <div className="supervisor-metric-grid mb-6">
          {cards.map((card, index) => <KpiHorizontal.Item key={card.label} label={card.label.toUpperCase()} value={card.value} tone={["blue", "amber", "blue", "red"][index]} description={index === 2 ? `${card.change}; all recorded consultations` : card.change} />)}
        </div> : <KpiHorizontal count={4} className="mb-6">
          {cards.map((c, i) => (
            <KpiHorizontal.Item key={c.label} label={c.label.toUpperCase()} value={c.value} tone={["blue", "amber", "blue", "red"][i]} description="" />
          ))}
        </KpiHorizontal>}

{/* Trends + Disease Distribution */}
        <div className={`grid lg:grid-cols-3 ${supervisor ? "gap-4 mb-6" : "gap-4 mb-6"}`}>
          <Card className={supervisor ? "lg:col-span-2 p-4" : "lg:col-span-2 p-5"}>
            <h3 className="text-sm font-semibold text-brand-ink dark:text-foreground mb-1">Consultation & Referral Trends</h3>
            <p className="text-xs text-brand-gray dark:text-muted-foreground mb-3">{activityCaption} — monthly recorded counts</p>
            {s.consultationTrends.some((row) => row.consultations > 0 || row.referrals > 0) ? <ResponsiveContainer width="100%" height={260}>
              <LineChart data={s.consultationTrends} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={chartGrid} />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: chartInk }} axisLine={{ stroke: chartGrid }} tickLine={false} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: chartInk }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={chartTooltipStyle} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line isAnimationActive={!supervisor} type="monotone" dataKey="consultations" name="Consultations" stroke={supervisor ? "#0B4A8F" : "#0B5CAD"} strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
                <Line isAnimationActive={!supervisor} type="monotone" dataKey="referrals" name="Referrals" stroke="#F5B400" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer> : <EmptyState compact title="No recorded activity in this period" description="No consultations or referrals for the selected period." />}
          </Card>

          <Card className={supervisor ? "p-4" : "p-5"}>
            <h3 className="text-sm font-semibold text-brand-ink dark:text-foreground mb-1">{supervisor ? "Recorded Conditions" : "Disease Distribution"}</h3>
            <p className="text-xs text-brand-gray dark:text-muted-foreground mb-3">{supervisor ? "Classified recorded complaints" : "Condition counts"}</p>
            {s.diseaseDistribution.some((row) => row.value > 0) ? <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie isAnimationActive={!supervisor} data={s.diseaseDistribution} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={45} outerRadius={70} paddingAngle={2}>
                  {s.diseaseDistribution.map((d) => <Cell key={d.name} fill={d.color} />)}
                </Pie>
                <Tooltip contentStyle={chartTooltipStyle} />
              </PieChart>
            </ResponsiveContainer> : <EmptyState compact title="No recorded conditions" description="No condition counts available." />}
            <div className="space-y-1 mt-3 max-h-24 overflow-y-auto">
              {s.diseaseDistribution.map((d) => (
                <div key={d.name} className="flex items-center gap-2 text-xs">
                  <span className="w-2 h-2 rounded-sm shrink-0" style={{ background: d.color }} />
                  <span className="flex-1 text-brand-ink dark:text-foreground">{d.name}</span>
                  <span className="text-brand-gray dark:text-muted-foreground font-semibold">{d.value}</span>
                </div>
              ))}
            </div>
          </Card>
        </div>

        {/* Maternal + Senior monitoring */}
        <div className={`grid lg:grid-cols-2 gap-4 mb-6`}>
          <Card className={supervisor ? "p-4" : "p-5"}>
            <h3 className="text-sm font-semibold text-brand-ink mb-1">Recorded Maternal Activity</h3>
            <p className="text-xs text-brand-gray mb-3">Unique residents with maternal records, {activityCaption}</p>
            {Array.isArray(s.maternalTrend) && s.maternalTrend.some((row) => row.count > 0) ? <ResponsiveContainer width="100%" height={220}>
              <LineChart data={s.maternalTrend} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={chartGrid} />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: chartInk }} axisLine={{ stroke: chartGrid }} tickLine={false} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: chartInk }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={chartTooltipStyle} />
                <Line isAnimationActive={!supervisor} type="monotone" dataKey="count" name="Residents" stroke="#0B4A8F" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer> : <EmptyState compact title="No recorded maternal activity" description="No maternal records for the selected period." />}
          </Card>

          <Card className={supervisor ? "p-4" : "p-5"}>
            <h3 className="text-sm font-semibold text-brand-ink mb-1">Recorded Senior Consultation Activity</h3>
            <p className="text-xs text-brand-gray mb-3">Unique residents aged 60+, {activityCaption}</p>
            {Array.isArray(s.seniorTrend) && s.seniorTrend.some((row) => row.count > 0) ? <ResponsiveContainer width="100%" height={220}>
              <LineChart data={s.seniorTrend} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={chartGrid} />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: chartInk }} axisLine={{ stroke: chartGrid }} tickLine={false} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: chartInk }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={chartTooltipStyle} />
                <Line isAnimationActive={!supervisor} type="monotone" dataKey="count" name="Residents" stroke="#28B463" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer> : <EmptyState compact title="No recorded senior activity" description="No senior consultations for the selected period." />}
          </Card>
        </div>

        {/* Risk + Program compliance */}
        <div className={`grid lg:grid-cols-2 gap-4`}>
          {supervisor ? <Card className="min-w-0 p-4">
            <h3 className="text-section font-semibold text-brand-ink">Follow-up Completion</h3>
            <p className="mb-3 mt-1 text-caption text-brand-gray">Recorded outcomes by scheduled month, {activityCaption}</p>
            {completionAvailable && completionRows.some((row) => row.denominator > 0) ? <div className="table-scroll max-h-64 overflow-auto">
              <table className="ui-table w-full text-left">
                <caption className="sr-only">Scheduled and completed follow-ups in the selected reporting period</caption>
                <thead className="sticky top-0 bg-brand-bg"><tr><th scope="col">Month</th><th scope="col" className="text-right">Scheduled</th><th scope="col" className="text-right">Completed</th><th scope="col" className="text-right">Completion</th></tr></thead>
                <tbody className="divide-y divide-brand-border">{completionRows.map((row) => <tr key={row.month}><td className="whitespace-nowrap">{row.month}</td><td className="text-right font-stat">{row.denominator}</td><td className="text-right font-stat">{row.numerator}</td><td className="text-right font-stat">{Number.isFinite(row.value) ? `${row.value}%` : "Not applicable"}</td></tr>)}</tbody>
              </table>
            </div> : <EmptyState compact title="No scheduled follow-ups in this period" description="A completion percentage requires scheduled follow-ups." />}
          </Card> : <Card className="p-5">
            <h3 className="font-semibold text-brand-ink mb-1">Risk Classification Distribution</h3>
            <p className="text-xs text-brand-gray mb-3">Latest recorded consultation per resident</p>
            {s.riskDistribution.some((row) => row.value > 0) ? <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie isAnimationActive={!supervisor} data={s.riskDistribution} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={2}>
                  {s.riskDistribution.map((d) => <Cell key={d.name} fill={d.color} />)}
                </Pie>
                <Tooltip contentStyle={chartTooltipStyle} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer> : <EmptyState compact title="No resident risk distribution" description="No consultation-based resident assessment counts available." />}
          </Card>}

          {supervisor ? <Card className="min-w-0 p-4">
            <h3 className="text-section font-semibold text-brand-ink">Health Service Activity</h3>
            <p className="mb-3 mt-1 text-caption text-brand-gray">{serviceMonthLabel} | Recorded counts</p>
            <dl className="divide-y divide-brand-border border-y border-brand-border">{[
              ["TCL enrolled residents", enrollment?.value],
              ["TCL recorded participants", participation?.value],
              ["Immunization records", immunizations?.value],
              ["Children with recorded consultations", childConsultations?.value],
            ].map(([label, value]) => <div key={label} className="flex items-start justify-between gap-3 py-2.5 text-ui"><dt className="text-brand-gray">{label}</dt><dd className="shrink-0 font-stat font-semibold text-brand-ink">{metricValue(value)}</dd></div>)}</dl>
            {can("services.view") && <Link to="/app/health_supervisor/services" className="mt-3 inline-flex text-ui font-medium text-brand-blue hover:underline">View Health Services</Link>}
          </Card> : <Card className="p-5">
            <h3 className="font-semibold text-brand-ink mb-1">Recorded TCL Enrollments</h3>
            <p className="text-xs text-brand-gray mb-3">Enrolled residents in {s.programCompliance?.[0]?.month || "the latest month"}</p>
            {Array.isArray(s.programCompliance) && s.programCompliance.some((row) => row.value > 0) ? <ResponsiveContainer width="100%" height={220}>
              <BarChart data={s.programCompliance} layout="vertical" margin={{ top: 5, right: 10, left: 10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={chartGrid} />
                <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11, fill: chartInk }} axisLine={{ stroke: chartGrid }} tickLine={false} />
                <YAxis dataKey="name" type="category" tick={{ fontSize: 10, fill: chartInk }} axisLine={false} tickLine={false} width={75} />
                <Tooltip contentStyle={chartTooltipStyle} cursor={{ fill: darkMode ? "#263548" : "#F8FBFF" }} />
                <Bar isAnimationActive={!supervisor} dataKey="value" name="Residents" fill="#0B5CAD" radius={[0, 4, 4, 0]} barSize={20} />
              </BarChart>
            </ResponsiveContainer> : <EmptyState compact title="No recorded TCL enrollments" description="No enrolled residents available." />}
          </Card>}
        </div>
        </>
        )}
      </div>
    );
  }

  /* ------------------------------------------------------------------ */
  /* Municipality-wide view (MHO — unchanged behaviour)                  */
  /* ------------------------------------------------------------------ */
  /* ------------------------------------------------------------------ */
  /* Municipality-wide view (MHO) — live figures from the analytics API. */
  /* early-warning → summary + 12-month trend + disease/risk mix;         */
  /* community-map → real per-barangay overview rows. No fabricated data. */
  /* ------------------------------------------------------------------ */
  const ew = muniEW || {};
  const sm = ew.summary || {};
  const trends = Array.isArray(ew.consultationTrends) ? ew.consultationTrends : [];
  const disease = (Array.isArray(ew.diseaseDistribution) ? ew.diseaseDistribution : [])
    .filter((x) => (x.value || 0) > 0)
    .map((x, i) => ({ ...x, color: CONDITION_PALETTE[i % CONDITION_PALETTE.length] }));
  const risk = (Array.isArray(ew.riskDistribution) ? ew.riskDistribution : [])
    .map((x) => ({ ...x, color: RISK_COLORS[x.name] || "#0B5CAD" }));
  const mapBarangays = Array.isArray(muniMap?.barangays) ? muniMap.barangays : [];

  const trendsHaveData = trends.some((t) => (t.consultations || 0) > 0 || (t.referrals || 0) > 0);
  const riskHaveData = risk.some((r) => (r.value || 0) > 0);

  const summaryCards = [
    { ...SUMMARY_ICONS[0], label: "Consultations This Month", value: metricValue(sm.consultationsThisMonth), sub: "recorded this month" },
    { ...SUMMARY_ICONS[1], label: "Referrals This Month", value: metricValue(sm.referralsThisMonth), sub: "created this month" },
    { ...SUMMARY_ICONS[2], label: "Top Condition", value: sm.topCondition || "No recorded condition", sub: `${sm.topConditionCases ?? 0} case${(sm.topConditionCases ?? 0) === 1 ? "" : "s"}` },
    { ...SUMMARY_ICONS[3], label: "High-Risk Residents", value: metricValue(sm.highRiskResidents), sub: "from recorded vitals" },
  ];

  const barangayStatus = (b) => {
    if ((b.highRiskResidents || 0) > 0) return { status: "Needs Attention", tone: "text-brand-danger bg-brand-danger/10", dot: "bg-brand-danger" };
    if ((b.caseCount || 0) > 0) return { status: "Monitoring", tone: "text-brand-blue bg-brand-blue/10", dot: "bg-brand-blue" };
    return { status: "No health data", tone: "text-brand-gray bg-brand-gray/10", dot: "bg-brand-gray" };
  };

  const consultationsByBarangay = mapBarangays.map((b) => ({ barangay: b.name, consultations: b.caseCount || 0 }));

  const periodSelect = (
    <div className="flex flex-wrap items-center gap-2">
      <label className="sr-only" htmlFor="municipal-health-trends-period">Reporting period</label>
      <select
        id="municipal-health-trends-period"
        value={period}
        onChange={(event) => setPeriod(event.target.value)}
        className="min-h-9 rounded-md border border-brand-border bg-white px-3 py-1.5 text-sm font-medium text-brand-ink outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/30"
      >
        <option value="monthly">Monthly</option>
        <option value="quarterly">Quarterly</option>
        <option value="yearly">Yearly</option>
        <option value="3m">Last 3 Months</option>
        <option value="6m">Last 6 Months</option>
        <option value="12m">Last 12 Months</option>
      </select>
      {period === "monthly" && (
        <input
          type="month"
          value={selectedMonth}
          onChange={(event) => setSelectedMonth(event.target.value)}
          aria-label="Select reporting month"
          className="min-h-9 rounded-md border border-brand-border bg-white px-2.5 py-1.5 text-sm text-brand-ink"
        />
      )}
      {period === "quarterly" && (
        <>
          <label className="sr-only" htmlFor="municipal-health-trends-quarter">Quarter</label>
          <select
            id="municipal-health-trends-quarter"
            value={selectedQuarter.quarter}
            onChange={(event) => setSelectedQuarter((current) => ({ ...current, quarter: Number(event.target.value) }))}
            className="min-h-9 rounded-md border border-brand-border bg-white px-2.5 py-1.5 text-sm text-brand-ink"
          >
            {[1, 2, 3, 4].map((quarter) => <option key={quarter} value={quarter}>Q{quarter}</option>)}
          </select>
          <label className="sr-only" htmlFor="municipal-health-trends-year">Reporting year</label>
          <input
            id="municipal-health-trends-year"
            type="number"
            min="2020"
            max="2099"
            value={selectedQuarter.year}
            onChange={(event) => setSelectedQuarter((current) => ({ ...current, year: Number(event.target.value) }))}
            className="min-h-9 w-24 rounded-md border border-brand-border bg-white px-2.5 py-1.5 text-sm text-brand-ink"
          />
        </>
      )}
      {period === "yearly" && (
        <>
          <label className="sr-only" htmlFor="municipal-health-trends-year-only">Reporting year</label>
          <input
            id="municipal-health-trends-year-only"
            type="number"
            min="2020"
            max="2099"
            value={selectedYear}
            onChange={(event) => setSelectedYear(Number(event.target.value))}
            className="min-h-9 w-24 rounded-md border border-brand-border bg-white px-2.5 py-1.5 text-sm text-brand-ink"
          />
        </>
      )}
    </div>
  );

  return (
    <>
      <PageHeader
        crumbs={["Health Trends"]}
        title="Health Trends"
        subtitle="Municipal health overview across all barangays"
        action={<div className="flex w-full flex-wrap items-center gap-2 md:w-auto md:justify-end">{periodSelect}</div>}
      />

      {muniLoading ? (
        <PageSkeleton />
      ) : muniError ? (
        <Card className="p-4">
          <ErrorState title="Unable to load municipal health data" message={muniError} onRetry={loadMunicipality} />
        </Card>
      ) : (
        <>
          {/* Summary */}
          <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-5">
            {summaryCards.map((c) => (
              <div key={c.label} className="rounded-2xl border border-slate-200 bg-white shadow-card p-5">
                <div className={`w-11 h-11 rounded-xl flex items-center justify-center ${c.tone}`}>
                  <c.icon className="w-5 h-5" strokeWidth={1.8} />
                </div>
                <p className="mt-4 text-xs text-brand-gray uppercase tracking-wide">{c.label}</p>
                <p className="mt-1 text-2xl font-stat font-bold text-brand-ink">{c.value}</p>
                <p className="mt-1 text-xs text-brand-gray">{c.sub}</p>
              </div>
            ))}
          </div>

          {/* Community Health Overview — real per-barangay rows from the map endpoint */}
          <Card className="p-4 sm:p-6 mt-6">
            <h3 className="font-semibold text-brand-ink text-sm sm:text-base mb-1">Community Health Overview</h3>
            <p className="text-xs text-brand-gray mb-4">Per-barangay health status across the municipality.</p>

            {mapBarangays.length === 0 ? (
              <p className="text-sm text-brand-gray">No barangay health summaries are available yet.</p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {mapBarangays.map((b) => {
                  const st = barangayStatus(b);
                  return (
                    <div key={b.id || b.name} className="bg-brand-light/30 rounded-lg p-4 border border-brand-border">
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-2">
                          <span className={`w-2 h-2 rounded-full ${st.dot}`} />
                          <span className="font-medium text-brand-ink text-sm">{b.name}</span>
                        </div>
                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${st.tone}`}>{st.status}</span>
                      </div>
                      <p className="mt-2 text-xs text-brand-gray">{(b.residents ?? 0).toLocaleString()} residents</p>
                      <p className="text-xs text-brand-gray">{b.caseCount ?? 0} consultations · {b.highRiskResidents ?? 0} high-risk</p>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>

          <div className="grid lg:grid-cols-3 gap-5 mt-6">
            <Card className="lg:col-span-2 p-6">
              <h3 className="font-semibold text-brand-ink mb-1">Consultation &amp; Referral Trends</h3>
              <p className="text-xs text-brand-gray mb-4">Monthly count over the past 12 months</p>
              {trendsHaveData ? (
                <ResponsiveContainer width="100%" height={280}>
                  <LineChart data={trends} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={chartGrid} />
                    <XAxis dataKey="month" tick={{ fontSize: 11, fill: chartInk }} axisLine={{ stroke: chartGrid }} tickLine={false} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: chartInk }} axisLine={false} tickLine={false} />
                    <Tooltip contentStyle={chartTooltipStyle} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Line type="monotone" dataKey="consultations" name="Consultations" stroke="#0B5CAD" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
                    <Line type="monotone" dataKey="referrals" name="Referrals" stroke="#F5B400" strokeWidth={2} dot={{ r: 3 }} />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex h-[280px] items-center justify-center rounded-xl border border-dashed border-brand-border bg-brand-bg text-center">
                  <p className="max-w-xs text-sm text-brand-gray">No consultations or referrals have been recorded in the last 12 months yet. This chart updates automatically as records are captured.</p>
                </div>
              )}
            </Card>

            <Card className="p-6">
              <h3 className="font-semibold text-brand-ink mb-1">Disease Distribution</h3>
              <p className="text-xs text-brand-gray mb-4">Top reported conditions</p>
              {disease.length > 0 ? (
                <>
                  <ResponsiveContainer width="100%" height={220}>
                    <PieChart>
                      <Pie data={disease} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={45} outerRadius={75} paddingAngle={2}>
                        {disease.map((dist) => <Cell key={dist.name} fill={dist.color} />)}
                      </Pie>
                      <Tooltip contentStyle={chartTooltipStyle} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="space-y-1.5 mt-2">
                    {disease.map((dist) => (
                      <div key={dist.name} className="flex items-center gap-2 text-xs">
                        <span className="w-2.5 h-2.5 rounded-sm" style={{ background: dist.color }} />
                        <span className="flex-1 text-brand-ink">{dist.name}</span>
                        <span className="text-brand-gray font-stat font-bold">{dist.value}</span>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div className="flex h-[220px] items-center justify-center rounded-xl border border-dashed border-brand-border bg-brand-bg text-center">
                  <p className="max-w-xs text-sm text-brand-gray">No conditions have been recorded from consultations yet.</p>
                </div>
              )}
            </Card>
          </div>

          <div className="grid lg:grid-cols-3 gap-5 mt-5">
            <Card className="lg:col-span-2 p-6">
              <h3 className="font-semibold text-brand-ink mb-1">Consultations by Barangay</h3>
              <p className="text-xs text-brand-gray mb-4">Recorded consultations per barangay ({formatDateRange(muniRange.from, muniRange.to)})</p>
              {consultationsByBarangay.length > 0 ? (
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={consultationsByBarangay} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={chartGrid} />
                    <XAxis dataKey="barangay" tick={{ fontSize: 10, fill: chartInk }} axisLine={{ stroke: chartGrid }} tickLine={false} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: chartInk }} axisLine={false} tickLine={false} />
                    <Tooltip contentStyle={chartTooltipStyle} cursor={{ fill: darkMode ? "#263548" : "#F8FBFF" }} />
                    <Bar dataKey="consultations" name="Consultations" fill="#0B5CAD" radius={[4, 4, 0, 0]} barSize={40} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex h-[260px] items-center justify-center rounded-xl border border-dashed border-brand-border bg-brand-bg text-center">
                  <p className="max-w-xs text-sm text-brand-gray">No barangays are available for your municipality yet.</p>
                </div>
              )}
            </Card>

            <Card className="p-6">
              <h3 className="font-semibold text-brand-ink mb-1">Risk Classification Distribution</h3>
              <p className="text-xs text-brand-gray mb-4">Municipality-wide resident risk levels</p>
              {riskHaveData ? (
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <Pie data={risk} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={2}>
                      {risk.map((dist) => <Cell key={dist.name} fill={dist.color} />)}
                    </Pie>
                    <Tooltip contentStyle={chartTooltipStyle} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex h-[220px] items-center justify-center rounded-xl border border-dashed border-brand-border bg-brand-bg text-center">
                  <p className="max-w-xs text-sm text-brand-gray">No consultations with vitals have been recorded yet, so no risk levels can be computed.</p>
                </div>
              )}
            </Card>
          </div>
        </>
      )}
    </>
  );
}
