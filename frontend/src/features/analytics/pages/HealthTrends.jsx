import React, { useCallback, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import { TrendingUp, TrendingDown, Activity, Send, MapPin, CalendarDays, ChevronDown } from "lucide-react";
import PageHeader from "@/components/common/PageHeader";
import { Card } from "@/components/common/Card";
import StatCard from "@/components/common/StatCard";
import EmptyState from "@/components/common/EmptyState";
import { PageSkeleton } from "@/components/common/Skeleton";
import ErrorState from "@/components/common/ErrorState";
import { useAuth } from "@/context/AuthContext";
import { usePermissions } from "@/context/PermissionsContext";
import { getSupervisorScope, HS_SCOPE } from "@/lib/supervisorScope";
import { getAssignedBarangay } from "@/lib/barangayScope";
import { toLocalISODate, formatDateRange } from "@/lib/dateUtils";
import { authorizedViewsApi } from "@/services/api/authorizedViewsApi";
import useAuthorizedData from "@/hooks/useAuthorizedData";
import { healthTrendScope, metricValue, lastActivityPeriod, optionalSeries } from "@/lib/legacyAnalytics";

const tooltipStyle = { fontSize: "12px", borderRadius: "8px", border: "1px solid #E5EAF1" };

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
  const { can } = usePermissions();
  const supervisor = user?.role === "health_supervisor";
  const supervisorScope = getSupervisorScope(user);
  const canViewAnalytics = can("reports.analytics.view");
  // Barangay scope comes from the signed-in user's assignment — never from a
  // selector, URL or filter the user controls.
  const assignedBarangay = supervisor ? supervisorScope?.level === HS_SCOPE.BARANGAY ? supervisorScope.assignedBarangay : null : getAssignedBarangay(user);
  const [period, setPeriod] = useState("12m");
  const activityRange = lastActivityPeriod(period === "3m" ? 3 : period === "6m" ? 6 : 12);
  const activityCaption = formatDateRange(activityRange.from, activityRange.to);

  const muniRange = useMemo(() => {
    const now = new Date();
    // Local calendar days only — toISOString() would shift the boundary back a
    // day (and, at year start, back a year) under Philippine time.
    const iso = (d) => toLocalISODate(d);
    const months = period === "3m" ? 3 : period === "6m" ? 6 : 12;
    return { from: iso(new Date(now.getFullYear(), now.getMonth() - months, now.getDate())), to: iso(now) };
  }, [period]);

  const load = useCallback(async (options) => {
    if (supervisor && !assignedBarangay) throw new Error("A valid barangay assignment is required to view health trends.");
    if (supervisor && !canViewAnalytics) throw new Error("Your account is not permitted to view health analytics.");
    const warningRequest = authorizedViewsApi.earlyWarning({ barangay: assignedBarangay, ...lastActivityPeriod(period === '3m' ? 3 : period === '6m' ? 6 : 12) }, options);
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
  }, [assignedBarangay, muniRange.from, muniRange.to, period, supervisor, canViewAnalytics]);
  const resource = useAuthorizedData(load);
  const muniEW = resource.data?.ew;
  const muniMap = resource.data?.map;
  const loading = resource.loading;
  const muniLoading = resource.loading;
  const muniError = resource.error;
  const loadMunicipality = resource.refresh;
  const base = healthTrendScope(muniEW, period === "3m" ? 3 : period === "6m" ? 6 : 12);
  const conditionPalette = supervisor ? SUPERVISOR_CONDITION_PALETTE : CONDITION_PALETTE;
  const riskPalette = supervisor ? SUPERVISOR_RISK_COLORS : RISK_COLORS;
  const scopedData = base && { ...base, diseaseDistribution: base.diseaseDistribution.map((row, index) => ({ ...row, color: conditionPalette[index % conditionPalette.length] })), riskDistribution: muniEW.riskDistribution.map((row) => ({ ...row, color: riskPalette[row.name] || "#94A3B8" })) };

const periodSelect = (
    <div className={supervisor ? "supervisor-input flex max-w-full items-center gap-2" : "flex h-10 max-w-full items-center gap-2 rounded-btn border border-white/25 bg-white/10 px-3 text-white"}>
      <CalendarDays className={`h-4 w-4 shrink-0 ${supervisor ? "text-brand-gray" : "text-brand-goldlight"}`} aria-hidden="true" />
      <label htmlFor="health-trends-period" className={`shrink-0 text-xs font-medium ${supervisor ? "text-brand-gray" : "text-white/75"}`}>
        Period
      </label>
      <div className="relative flex min-w-0 items-center">
        <select
          id="health-trends-period"
          aria-label="Reporting period"
          value={period}
          onChange={(e) => setPeriod(e.target.value)}
          className={supervisor ? "h-control min-w-[7.5rem] appearance-none bg-transparent pr-6 text-ui font-medium text-brand-ink outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/30" : "h-9 min-w-0 appearance-none bg-transparent pr-5 text-sm font-medium text-white outline-none focus-visible:ring-2 focus-visible:ring-brand-goldlight/70"}
        >
          <option className="bg-white text-brand-ink" value="3m">Last 3 Months</option>
          <option className="bg-white text-brand-ink" value="6m">Last 6 Months</option>
          <option className="bg-white text-brand-ink" value="12m">Last 12 Months</option>
        </select>
        <ChevronDown className={`pointer-events-none absolute right-0 h-4 w-4 ${supervisor ? "text-brand-gray" : "text-white/75"}`} aria-hidden="true" />
      </div>
    </div>
  );

  if (resource.error) return <><PageHeader crumbs={["Analytics", "Health Trends"]} title="Health Trends" subtitle="Authorized recorded health activity." action={periodSelect} /><Card className="p-5"><ErrorState compact={supervisor} title="Health trends unavailable" message={resource.error} onRetry={resource.refresh} /></Card></>;
  if (supervisor && !assignedBarangay) return <><PageHeader crumbs={["Health Trends"]} title="Health Trends" subtitle="Barangay assignment required" /><Card><ErrorState compact title="Health trends unavailable" message="No valid barangay assignment is available for this account. Municipal coverage is not available to an unassigned Health Supervisor." /></Card></>;
  if (assignedBarangay && !scopedData) return <><PageHeader crumbs={["Analytics", "Health Trends"]} title={`Brgy. ${assignedBarangay} Health Trends`} action={periodSelect} /><PageSkeleton /></>;

  /* ------------------------------------------------------------------ */
  /* Barangay-scoped view (Health Supervisor assigned to one barangay)   */
  /* ------------------------------------------------------------------ */
  if (assignedBarangay) {
    const s = scopedData;
    const completionRows = s.followUpCompletion;
    const completionAvailable = Array.isArray(completionRows) && completionRows.length > 0 && completionRows.every((row) => Number.isSafeInteger(row.numerator) && Number.isSafeInteger(row.denominator) && row.numerator >= 0 && row.numerator <= row.denominator);
    const serviceEntry = (name) => optionalSeries(muniEW, name, period === "3m" ? 3 : period === "6m" ? 6 : 12, [assignedBarangay])?.find((row) => row.name === assignedBarangay);
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
        <PageHeader
          crumbs={["Health Trends"]}
          title="Health Trends"
          subtitle={`Recorded health activity and risk monitoring for Barangay ${assignedBarangay}`}
action={
            <div className="flex w-full flex-wrap items-center gap-2.5 md:w-auto md:flex-nowrap md:justify-end">
              <div
                className={supervisor ? "supervisor-input flex max-w-full items-center gap-2 text-ui" : "flex h-10 max-w-full items-center gap-2 rounded-btn border border-white/25 bg-white/10 px-3 text-sm font-medium text-white"}
                title="Your account is assigned to this barangay"
              >
                <MapPin className={`h-4 w-4 shrink-0 ${supervisor ? "text-brand-gray" : "text-brand-goldlight"}`} aria-hidden="true" />
                <span className="truncate">Barangay {assignedBarangay}</span>
              </div>
              {periodSelect}
            </div>
          }
        />

        {/* Summary */}
        {loading ? (
          <PageSkeleton />
        ) : (
        <>
        {supervisor ? <div className="supervisor-metric-grid mb-4">
          {cards.map((card, index) => <StatCard key={card.label} variant="ledger" label={card.label} value={card.value} description={index === 2 ? `${card.change}; all recorded consultations` : card.change} tone={["blue", "yellow", "accent", "danger"][index]} />)}
        </div> : <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-5">
          {cards.map((c) => (
            <div key={c.label} className="rounded-2xl border border-slate-200 bg-white shadow-card p-5">
              <div className={`w-11 h-11 rounded-xl flex items-center justify-center ${c.tone}`}>
                <c.icon className="w-5 h-5" strokeWidth={1.8} />
              </div>
              <p className="mt-4 text-xs text-brand-gray uppercase tracking-wide">{c.label}</p>
              <div className="mt-1 flex items-baseline gap-2">
                <p className="text-2xl font-stat font-bold text-brand-ink">{c.value}</p>
                <span className={`text-xs font-medium ${c.up ? "text-brand-green" : "text-brand-danger"} flex items-center gap-0.5`}>
                  {c.up !== null && (c.up ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />)} {c.change}
                </span>
              </div>
            </div>
          ))}
        </div>}
        {supervisor && <p className="mb-4 text-caption text-brand-gray">Monthly activity: {activityCaption}. Headline counts retain their labelled current-month or all-record definitions; the selected period changes the monthly charts.</p>}

{/* Trends + Disease Distribution */}
        <div className={`grid lg:grid-cols-3 ${supervisor ? "gap-4 mt-4" : "gap-5 mt-6"}`}>
          <Card className={`lg:col-span-2 ${supervisor ? "p-4" : "p-6"}`}>
            <h3 className="font-semibold text-brand-ink mb-1">Consultation &amp; Referral Trends</h3>
            <p className="text-xs text-brand-gray mb-4">Monthly recorded counts, {activityCaption}. Current month is partial.</p>
            {s.consultationTrends.some((row) => row.consultations > 0 || row.referrals > 0) ? <ResponsiveContainer width="100%" height={supervisor ? 240 : 280}>
              <LineChart data={s.consultationTrends} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E5EAF1" />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: "#5B6472" }} axisLine={{ stroke: "#E5EAF1" }} tickLine={false} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#5B6472" }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={tooltipStyle} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line isAnimationActive={!supervisor} type="monotone" dataKey="consultations" name="Consultations" stroke={supervisor ? "#0B4A8F" : "#0B5CAD"} strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
                <Line isAnimationActive={!supervisor} type="monotone" dataKey="referrals" name="Referrals" stroke="#F5B400" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer> : <EmptyState compact title="No recorded activity in this period" description="The authorized aggregate contains no consultations or referrals for the selected monthly window." />}
          </Card>

          <Card className={supervisor ? "p-4" : "p-6"}>
            <h3 className="font-semibold text-brand-ink mb-1">{supervisor ? "Recorded Conditions" : "Disease Distribution"}</h3>
            <p className="text-xs text-brand-gray mb-4">{supervisor ? "Classified recorded complaints across all available records, not confirmed diagnoses or unique residents." : "Condition counts across all recorded consultations, not unique residents."}</p>
            {s.diseaseDistribution.some((row) => row.value > 0) ? <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie isAnimationActive={!supervisor} data={s.diseaseDistribution} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={45} outerRadius={75} paddingAngle={2}>
                  {s.diseaseDistribution.map((d) => <Cell key={d.name} fill={d.color} />)}
                </Pie>
                <Tooltip contentStyle={tooltipStyle} />
              </PieChart>
            </ResponsiveContainer> : <EmptyState compact title="No recorded conditions" description="No condition counts were returned from authorized consultations." />}
            <div className="space-y-1.5 mt-2">
              {s.diseaseDistribution.map((d) => (
                <div key={d.name} className="flex items-center gap-2 text-xs">
                  <span className="w-2.5 h-2.5 rounded-sm" style={{ background: d.color }} />
                  <span className="flex-1 text-brand-ink">{d.name}</span>
                  <span className="text-brand-gray font-stat font-bold">{d.value}</span>
                </div>
              ))}
              {s.diseaseDistribution.length === 0 && (
                <p className="text-xs text-brand-gray">No conditions recorded yet.</p>
              )}
            </div>
          </Card>
        </div>

        {/* Maternal + Senior monitoring */}
        <div className={`grid lg:grid-cols-2 ${supervisor ? "gap-4 mt-4" : "gap-5 mt-5"}`}>
          <Card className={supervisor ? "p-4" : "p-6"}>
            <h3 className="font-semibold text-brand-ink mb-1">Recorded Maternal Activity</h3>
            <p className="text-xs text-brand-gray mb-4">Unique residents with maternal records per month, {activityCaption}.</p>
            {Array.isArray(s.maternalTrend) && s.maternalTrend.some((row) => row.count > 0) ? <ResponsiveContainer width="100%" height={200}>
              <LineChart data={s.maternalTrend} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E5EAF1" />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: "#5B6472" }} axisLine={{ stroke: "#E5EAF1" }} tickLine={false} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#5B6472" }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={tooltipStyle} />
                <Line isAnimationActive={!supervisor} type="monotone" dataKey="count" name="Residents" stroke="#0B4A8F" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer> : <EmptyState compact title={Array.isArray(s.maternalTrend) && s.maternalTrend.every((row) => Number.isFinite(row.count)) ? "No recorded maternal activity" : "Maternal activity unavailable"} description={Array.isArray(s.maternalTrend) && s.maternalTrend.every((row) => Number.isFinite(row.count)) ? "No maternal records were returned for the selected monthly window." : "The aggregate source did not provide complete monthly maternal counts."} />}
          </Card>

          <Card className={supervisor ? "p-4" : "p-6"}>
            <h3 className="font-semibold text-brand-ink mb-1">Recorded Senior Consultation Activity</h3>
            <p className="text-xs text-brand-gray mb-4">Unique residents aged 60 or older at the encounter, {activityCaption}.</p>
            {Array.isArray(s.seniorTrend) && s.seniorTrend.some((row) => row.count > 0) ? <ResponsiveContainer width="100%" height={200}>
              <LineChart data={s.seniorTrend} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E5EAF1" />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: "#5B6472" }} axisLine={{ stroke: "#E5EAF1" }} tickLine={false} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#5B6472" }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={tooltipStyle} />
                <Line isAnimationActive={!supervisor} type="monotone" dataKey="count" name="Residents" stroke="#28B463" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer> : <EmptyState compact title={Array.isArray(s.seniorTrend) && s.seniorTrend.every((row) => Number.isFinite(row.count)) ? "No recorded senior activity" : "Senior activity unavailable"} description={Array.isArray(s.seniorTrend) && s.seniorTrend.every((row) => Number.isFinite(row.count)) ? "No senior consultations were returned for the selected monthly window." : "The aggregate source did not provide complete monthly senior counts."} />}
          </Card>
        </div>

        {/* Risk + Program compliance */}
        <div className={`grid lg:grid-cols-2 ${supervisor ? "gap-4 mt-4" : "gap-5 mt-5"}`}>
          {supervisor ? <Card className="min-w-0 p-4">
            <h3 className="text-section font-semibold text-brand-ink">Follow-up Completion</h3>
            <p className="mb-3 mt-1 text-caption text-brand-gray">Recorded outcomes by scheduled month, {activityCaption}.</p>
            {completionAvailable && completionRows.some((row) => row.denominator > 0) ? <div className="table-scroll max-h-64 overflow-auto">
              <table className="ui-table w-full text-left">
                <caption className="sr-only">Scheduled and completed follow-ups in the selected reporting period</caption>
                <thead className="sticky top-0 bg-brand-bg"><tr><th scope="col">Month</th><th scope="col" className="text-right">Scheduled</th><th scope="col" className="text-right">Completed</th><th scope="col" className="text-right">Completion</th></tr></thead>
                <tbody className="divide-y divide-brand-border">{completionRows.map((row) => <tr key={row.month}><td className="whitespace-nowrap">{row.month}</td><td className="text-right font-stat">{row.denominator}</td><td className="text-right font-stat">{row.numerator}</td><td className="text-right font-stat">{Number.isFinite(row.value) ? `${row.value}%` : "Not applicable"}</td></tr>)}</tbody>
              </table>
            </div> : <EmptyState compact title={completionAvailable ? "No scheduled follow-ups in this period" : "Follow-up completion unavailable"} description={completionAvailable ? "A completion percentage requires scheduled follow-ups." : "The aggregate source did not provide complete scheduled and completed counts."} />}
          </Card> : <Card className="p-6">
            <h3 className="font-semibold text-brand-ink mb-1">Risk Classification Distribution</h3>
            <p className="text-xs text-brand-gray mb-4">Latest recorded consultation per resident; includes unassessed residents with a consultation.</p>
            {s.riskDistribution.some((row) => row.value > 0) ? <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie isAnimationActive={!supervisor} data={s.riskDistribution} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={2}>
                  {s.riskDistribution.map((d) => <Cell key={d.name} fill={d.color} />)}
                </Pie>
                <Tooltip contentStyle={tooltipStyle} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer> : <EmptyState compact title="No resident risk distribution" description="No consultation-based resident assessment counts were returned. A risk percentage cannot be calculated." />}
          </Card>}

          {supervisor ? <Card className="min-w-0 p-4">
            <h3 className="text-section font-semibold text-brand-ink">Health Service Activity</h3>
            <p className="mb-3 mt-1 text-caption text-brand-gray">{serviceMonthLabel} | Recorded counts, not population coverage rates</p>
            <dl className="divide-y divide-brand-border border-y border-brand-border">{[
              ["TCL enrolled residents", enrollment?.value],
              ["TCL recorded participants", participation?.value],
              ["Immunization records", immunizations?.value],
              ["Children with recorded consultations", childConsultations?.value],
            ].map(([label, value]) => <div key={label} className="flex items-start justify-between gap-3 py-2.5 text-ui"><dt className="text-brand-gray">{label}</dt><dd className="shrink-0 font-stat font-semibold text-brand-ink">{metricValue(value)}</dd></div>)}</dl>
            {can("services.view") && <Link to="/app/health_supervisor/services" className="mt-3 inline-flex text-ui font-medium text-brand-blue hover:underline">View Health Services</Link>}
          </Card> : <Card className="p-6">
            <h3 className="font-semibold text-brand-ink mb-1">Recorded TCL Enrollments</h3>
            <p className="text-xs text-brand-gray mb-4">Recorded enrolled residents in {s.programCompliance?.[0]?.month || "the latest reported month"}; not a compliance percentage.</p>
            {Array.isArray(s.programCompliance) && s.programCompliance.some((row) => row.value > 0) ? <ResponsiveContainer width="100%" height={200}>
              <BarChart data={s.programCompliance} layout="vertical" margin={{ top: 5, right: 10, left: 10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E5EAF1" />
                <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11, fill: "#5B6472" }} axisLine={{ stroke: "#E5EAF1" }} tickLine={false} />
                <YAxis dataKey="name" type="category" tick={{ fontSize: 10, fill: "#5B6472" }} axisLine={false} tickLine={false} width={75} />
                <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "#F8FBFF" }} />
                <Bar isAnimationActive={!supervisor} dataKey="value" name="Residents" fill="#0B5CAD" radius={[0, 4, 4, 0]} barSize={20} />
              </BarChart>
            </ResponsiveContainer> : <EmptyState compact title={Array.isArray(s.programCompliance) && s.programCompliance.every((row) => Number.isFinite(row.value)) ? "No recorded TCL enrollments" : "TCL enrollments unavailable"} description={Array.isArray(s.programCompliance) && s.programCompliance.every((row) => Number.isFinite(row.value)) ? "No enrolled residents were returned for the latest reported month." : "The aggregate source did not provide complete enrollment counts."} />}
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
                    <CartesianGrid strokeDasharray="3 3" stroke="#E5EAF1" />
                    <XAxis dataKey="month" tick={{ fontSize: 11, fill: "#5B6472" }} axisLine={{ stroke: "#E5EAF1" }} tickLine={false} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#5B6472" }} axisLine={false} tickLine={false} />
                    <Tooltip contentStyle={tooltipStyle} />
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
                      <Tooltip contentStyle={tooltipStyle} />
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
                    <CartesianGrid strokeDasharray="3 3" stroke="#E5EAF1" />
                    <XAxis dataKey="barangay" tick={{ fontSize: 10, fill: "#5B6472" }} axisLine={{ stroke: "#E5EAF1" }} tickLine={false} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#5B6472" }} axisLine={false} tickLine={false} />
                    <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "#F8FBFF" }} />
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
                    <Tooltip contentStyle={tooltipStyle} />
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
