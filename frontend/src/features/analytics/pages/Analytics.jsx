import React, { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import PageHeader from "@/components/common/PageHeader";
import { Card } from "@/components/common/Card";
import CommunityHealthMap from "@/features/analytics/components/CommunityHealthMap";
import ErrorState from "@/components/common/ErrorState";
import { SkeletonStatGrid } from "@/components/common/Skeleton";
import StatCard from "@/components/common/StatCard";
import useAuthorizedData from "@/hooks/useAuthorizedData";
import { authorizedViewsApi } from "@/services/api/authorizedViewsApi";
import { getBarangayHealthOverview } from "@/services/api/monitoringApi";
import { metricValue, optionalSeries, lastActivityPeriod } from "@/lib/legacyAnalytics";
import { useAuth } from "@/context/AuthContext";
import { X } from "lucide-react";
import {
  ResponsiveContainer, BarChart, Bar, LineChart, Line, AreaChart, Area,
  XAxis, YAxis, Tooltip, CartesianGrid, Legend, Cell, PieChart, Pie,
} from "recharts";

const CHART_COLORS = { "San Antonio": "#28B463", "San Isidro": "#2A7DE1", "Old San Roque": "#E67E22" };
const DONUT_COLORS = ["#0B5CAD", "#2A7DE1", "#28B463", "#F5B400", "#E74C3C"];
const tooltipStyle = { borderRadius: 12, border: "1px solid #E5EAF1", fontSize: 12, fontFamily: "DM Sans" };
const tickStyle = { fill: "#5B6472", fontSize: 12, fontFamily: "DM Sans" };
const legendStyle = { fontSize: 12, fontFamily: "DM Sans" };

function ChartCard({ title, subtitle, children, data, delay = 0 }) {
  return (
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay, duration: 0.4 }}>
      <Card className="p-6 h-full">
        <div className="mb-4">
          <h3 className="font-heading font-semibold text-brand-ink">{title}</h3>
          {subtitle && <p className="text-xs text-brand-gray mt-0.5">{subtitle}</p>}
        </div>
        {!Array.isArray(data) ? <p className="flex h-[260px] items-center justify-center text-center text-sm text-brand-gray">This metric is unavailable from the authorized API. No coverage or completion rate has been inferred.</p> : data.length === 0 || data.every((row) => Object.hasOwn(row, 'value') && row.value === null) ? <p className="flex h-[260px] items-center justify-center text-sm text-brand-gray">No matching recorded activity or completion denominator for this metric.</p> : <ResponsiveContainer width="100%" height={260}>
          {children}
        </ResponsiveContainer>}
      </Card>
    </motion.div>
  );
}

function AreaGradients({ idPrefix, names }) {
  return (
    <defs>
      {names.map((name, i) => (
        <linearGradient key={i} id={`grad-${idPrefix}-${i}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={CHART_COLORS[name] || DONUT_COLORS[i % DONUT_COLORS.length]} stopOpacity={0.25} />
          <stop offset="100%" stopColor={CHART_COLORS[name] || DONUT_COLORS[i % DONUT_COLORS.length]} stopOpacity={0} />
        </linearGradient>
      ))}
    </defs>
  );
}

export default function Analytics() {
  const { user } = useAuth();
  const [selected, setSelected] = useState(null);
  const load = useCallback(async (options) => {
    const [earlyWarning, map] = await Promise.all([authorizedViewsApi.earlyWarning(lastActivityPeriod(), options), authorizedViewsApi.communityMap({}, options)]);
    return { earlyWarning, map };
  }, []);
  const resource = useAuthorizedData(load);
  useEffect(() => setSelected(null), [user?.id]);
  const data = resource.data?.earlyWarning;
  const names = (resource.data?.map?.barangays || []).map((row) => row.name);
  const highlightedBarangays = (resource.data?.map?.barangays || []).map((row, index) => ({ ...row, population: row.residents, consultations: row.caseCount, color: CHART_COLORS[row.name] || DONUT_COLORS[index % DONUT_COLORS.length], healthStatus: row.registryAvailable === false ? "Registry unavailable" : row.highRiskResidents > 0 ? "High-risk records present" : "Recorded health profile" }));
  const comparisonMonthlyConsultations = data?.consultationTrends?.slice(-6) || [];
  const diseaseDonutData = data?.diseaseDistribution || [];
  const comparisonFollowUpTrend = optionalSeries(data, "followUpCompletion", 6, names);
  const comparisonVaccinationCoverage = optionalSeries(data, "vaccinationCoverage", 12, names);
  const comparisonReferralCompletion = optionalSeries(data, "referralCompletion", 12, names);
  const comparisonMaternalTrend = optionalSeries(data, "maternalTrend", 6, names);
  const comparisonChildHealth = optionalSeries(data, "childHealthCoverage", 12, names);
  const comparisonSeniorTrend = optionalSeries(data, "seniorTrend", 6, names);
  const comparisonProgramParticipation = optionalSeries(data, "programParticipation", 12, names);
  const header = <PageHeader crumbs={["Analytics"]} title="Analytics" subtitle="Authorized community health aggregates and recorded case trends." />;
  if (resource.loading) return <>{header}<SkeletonStatGrid count={3} /></>;
  if (resource.error || !data) return <>{header}<ErrorState title="Analytics unavailable" message={resource.error || "The server did not return the aggregate."} onRetry={resource.refresh} /></>;

  return (
    <>
      {header}

      {/* Community Health Overview */}
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
        <Card className="p-6 md:p-8 mb-6">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h3 className="font-heading font-semibold text-brand-ink text-lg">Community Health Overview</h3>
              <p className="text-sm text-brand-gray mt-0.5">Hover over highlighted barangays for quick stats. Click to view detailed analytics.</p>
            </div>
          </div>
          <div className="grid lg:grid-cols-2 gap-8 items-center">
            <CommunityHealthMap barangays={highlightedBarangays} onSelect={setSelected} />
            <div className="space-y-3">
              {highlightedBarangays.map((b) => (
                <motion.button
                  key={b.name}
                  onClick={() => setSelected(b)}
                  whileHover={{ y: -3 }}
                  className="w-full flex items-center justify-between bg-white border border-brand-border rounded-2xl p-4 text-left shadow-card hover:shadow-deep transition-shadow"
                >
                  <div className="flex items-center gap-3">
                    <span className="w-3 h-3 rounded-full" style={{ background: b.color }} />
                    <div>
                      <p className="font-body font-medium text-brand-ink">{b.name}</p>
                      <p className="text-xs text-brand-gray">{metricValue(b.population)} residents · {metricValue(b.consultations)} consultations</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-brand-gray">Status</p>
                    <p className="text-sm font-body font-medium" style={{ color: b.color }}>{b.healthStatus}</p>
                  </div>
                </motion.button>
              ))}
              {highlightedBarangays.length === 0 && <p className="text-sm text-brand-gray">No authorized barangays were returned.</p>}
            </div>
          </div>
        </Card>
      </motion.div>

      {/* Health Status Summary */}
      <div className="grid gap-4 sm:grid-cols-3">{data.riskDistribution.map((risk, index) => <StatCard key={risk.name} label={`${risk.name} Recorded Risk Assessments`} value={metricValue(risk.value)} icon="Activity" index={index} tone={risk.name === "High" ? "danger" : "blue"} />)}</div>

      {/* Community Health Trends */}
      <div className="mt-8">
        <h2 className="font-heading font-semibold text-brand-ink text-lg mb-4">Community Health Trends</h2>
        <div className="grid lg:grid-cols-2 gap-5">
          {/* Monthly Consultations — Line Chart */}
          <ChartCard title="Monthly Consultations" subtitle="Authorized scope, latest six returned months" data={comparisonMonthlyConsultations} delay={0.05}>
            <LineChart data={comparisonMonthlyConsultations}>
              <CartesianGrid vertical={false} stroke="#E5EAF1" />
              <XAxis dataKey="month" axisLine={false} tickLine={false} tick={tickStyle} />
              <YAxis axisLine={false} tickLine={false} tick={tickStyle} />
              <Tooltip contentStyle={tooltipStyle} />
              <Legend wrapperStyle={legendStyle} />
              <Line type="monotone" dataKey="consultations" name="Consultations" stroke="#2A7DE1" strokeWidth={2.5} dot={{ r: 3 }} />
            </LineChart>
          </ChartCard>

          {/* Disease Distribution — Donut Chart */}
          <ChartCard title="Disease Distribution" subtitle="Recorded diagnoses within the authorized scope" data={diseaseDonutData} delay={0.1}>
            <PieChart>
              <Pie data={diseaseDonutData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={55} outerRadius={90} paddingAngle={2}>
                {diseaseDonutData.map((_, i) => <Cell key={i} fill={DONUT_COLORS[i]} />)}
              </Pie>
              <Tooltip contentStyle={tooltipStyle} />
              <Legend wrapperStyle={legendStyle} />
            </PieChart>
          </ChartCard>

          {/* Follow-up Completion — Area Chart */}
          <ChartCard title="Recorded Follow-up Completion" subtitle="Completed / recorded scheduled follow-ups, including missed and cancelled" data={comparisonFollowUpTrend} delay={0.15}>
            <AreaChart data={comparisonFollowUpTrend}>
              <AreaGradients idPrefix="fu" names={names} />
              <CartesianGrid vertical={false} stroke="#E5EAF1" />
              <XAxis dataKey="month" axisLine={false} tickLine={false} tick={tickStyle} />
              <YAxis axisLine={false} tickLine={false} tick={tickStyle} domain={[0, 100]} />
              <Tooltip contentStyle={tooltipStyle} />
              <Legend wrapperStyle={legendStyle} />
              {names.map((name, i) => <Area key={name} type="monotone" dataKey={name} stroke={CHART_COLORS[name] || DONUT_COLORS[i % DONUT_COLORS.length]} strokeWidth={2} fill={`url(#grad-fu-${i})`} />)}
            </AreaChart>
          </ChartCard>

          {/* Vaccination Coverage — Bar Chart */}
          <ChartCard title="Recorded Immunizations" subtitle="Latest reported month; records include Due/Missed, not administered doses or official coverage" data={comparisonVaccinationCoverage} delay={0.2}>
            <BarChart data={comparisonVaccinationCoverage}>
              <CartesianGrid vertical={false} stroke="#E5EAF1" />
              <XAxis dataKey="name" axisLine={false} tickLine={false} tick={tickStyle} />
              <YAxis axisLine={false} tickLine={false} tick={tickStyle} domain={[0, "auto"]} allowDecimals={false} />
              <Tooltip cursor={{ fill: "#EDF6FF" }} contentStyle={tooltipStyle} />
              <Bar dataKey="value" radius={[6, 6, 0, 0]} maxBarSize={56}>
                {comparisonVaccinationCoverage?.map((e, i) => <Cell key={i} fill={CHART_COLORS[e.name]} />)}
              </Bar>
            </BarChart>
          </ChartCard>

          {/* Referral Completion — Bar Chart */}
          <ChartCard title="Recorded Referral Completion" subtitle="Completed / created referrals in the reporting period, including rejected and cancelled" data={comparisonReferralCompletion} delay={0.25}>
            <BarChart data={comparisonReferralCompletion}>
              <CartesianGrid vertical={false} stroke="#E5EAF1" />
              <XAxis dataKey="name" axisLine={false} tickLine={false} tick={tickStyle} />
              <YAxis axisLine={false} tickLine={false} tick={tickStyle} domain={[0, 100]} />
              <Tooltip cursor={{ fill: "#EDF6FF" }} contentStyle={tooltipStyle} />
              <Bar dataKey="value" radius={[6, 6, 0, 0]} maxBarSize={56}>
                {comparisonReferralCompletion?.map((e, i) => <Cell key={i} fill={CHART_COLORS[e.name]} />)}
              </Bar>
            </BarChart>
          </ChartCard>

          {/* Maternal Health — Area Chart */}
          <ChartCard title="Recorded Maternal Activity" subtitle="Unique residents with maternal records per month" data={comparisonMaternalTrend} delay={0.3}>
            <AreaChart data={comparisonMaternalTrend}>
              <AreaGradients idPrefix="mh" names={names} />
              <CartesianGrid vertical={false} stroke="#E5EAF1" />
              <XAxis dataKey="month" axisLine={false} tickLine={false} tick={tickStyle} />
              <YAxis axisLine={false} tickLine={false} tick={tickStyle} domain={[0, "auto"]} allowDecimals={false} />
              <Tooltip contentStyle={tooltipStyle} />
              <Legend wrapperStyle={legendStyle} />
              {names.map((name, i) => <Area key={name} type="monotone" dataKey={name} stroke={CHART_COLORS[name] || DONUT_COLORS[i % DONUT_COLORS.length]} strokeWidth={2} fill={`url(#grad-mh-${i})`} />)}
            </AreaChart>
          </ChartCard>

          {/* Child Health — Bar Chart */}
          <ChartCard title="Recorded Minor Consultation Activity" subtitle="Latest month; residents under 18 at encounter, unknown ages excluded" data={comparisonChildHealth} delay={0.35}>
            <BarChart data={comparisonChildHealth}>
              <CartesianGrid vertical={false} stroke="#E5EAF1" />
              <XAxis dataKey="name" axisLine={false} tickLine={false} tick={tickStyle} />
              <YAxis axisLine={false} tickLine={false} tick={tickStyle} domain={[0, "auto"]} allowDecimals={false} />
              <Tooltip cursor={{ fill: "#EDF6FF" }} contentStyle={tooltipStyle} />
              <Bar dataKey="value" radius={[6, 6, 0, 0]} maxBarSize={56}>
                {comparisonChildHealth?.map((e, i) => <Cell key={i} fill={CHART_COLORS[e.name]} />)}
              </Bar>
            </BarChart>
          </ChartCard>

          {/* Senior Citizen Monitoring — Line Chart */}
          <ChartCard title="Recorded Senior Consultation Activity" subtitle="Unique residents aged 60 or older at encounter, per month" data={comparisonSeniorTrend} delay={0.4}>
            <LineChart data={comparisonSeniorTrend}>
              <CartesianGrid vertical={false} stroke="#E5EAF1" />
              <XAxis dataKey="month" axisLine={false} tickLine={false} tick={tickStyle} />
              <YAxis axisLine={false} tickLine={false} tick={tickStyle} domain={[0, "auto"]} allowDecimals={false} />
              <Tooltip contentStyle={tooltipStyle} />
              <Legend wrapperStyle={legendStyle} />
              {names.map((name, i) => <Line key={name} type="monotone" dataKey={name} stroke={CHART_COLORS[name] || DONUT_COLORS[i % DONUT_COLORS.length]} strokeWidth={2.5} dot={{ r: 3 }} />)}
            </LineChart>
          </ChartCard>

          {/* Health Program Participation — Bar Chart */}
          <ChartCard title="Recorded TCL Participation" subtitle="Latest month; residents with a stored last-visit date, not a compliance percentage" data={comparisonProgramParticipation} delay={0.45}>
            <BarChart data={comparisonProgramParticipation}>
              <CartesianGrid vertical={false} stroke="#E5EAF1" />
              <XAxis dataKey="name" axisLine={false} tickLine={false} tick={tickStyle} />
              <YAxis axisLine={false} tickLine={false} tick={tickStyle} domain={[0, "auto"]} allowDecimals={false} />
              <Tooltip cursor={{ fill: "#EDF6FF" }} contentStyle={tooltipStyle} />
              <Bar dataKey="value" radius={[6, 6, 0, 0]} maxBarSize={56}>
                {comparisonProgramParticipation?.map((e, i) => <Cell key={i} fill={CHART_COLORS[e.name]} />)}
              </Bar>
            </BarChart>
          </ChartCard>
        </div>
      </div>

      {/* Recent Health Alerts */}
      <div className="mt-8">
        <h2 className="font-heading font-semibold text-brand-ink text-lg mb-4">Recent Health Alerts</h2>
        {Array.isArray(data.recentHealthAlerts) ? data.recentHealthAlerts.length ? <div className="space-y-3">{data.recentHealthAlerts.map((alert) => <Card key={alert.id} className="p-4"><p className="text-sm">{alert.message || alert.msg}</p><p className="text-xs text-brand-gray">{alert.createdAt || alert.time || "Timestamp not recorded"}</p></Card>)}</div> : <Card className="p-5 text-sm text-brand-gray">No health alerts were returned for this scope.</Card> : <Card className="p-5 text-sm text-brand-gray">A health-alert feed is not supplied by this aggregate. Alerts have not been inferred from case counts.</Card>}
      </div>

      {/* Side Panel */}
      {selected && <AuthorizedBarangayPanel barangay={selected} onClose={() => setSelected(null)} />}
    </>
  );
}

function AuthorizedBarangayPanel({ barangay, onClose }) {
  const load = useCallback(async (options) => {
    const data = await authorizedViewsApi.earlyWarning({ barangay: barangay.name }, options);
    const overview = await getBarangayHealthOverview(barangay.name, { load: () => Promise.resolve(data) });
    return { data, overview };
  }, [barangay.id, barangay.name]);
  const resource = useAuthorizedData(load);
  const metrics = resource.data?.overview?.metrics;
  const data = resource.data?.data;
  return <div className="fixed inset-0 z-50 flex justify-end"><button aria-label="Close barangay detail" onClick={onClose} className="absolute inset-0 bg-black/30 backdrop-blur-sm" /><aside role="dialog" aria-modal="true" className="relative h-full w-full max-w-md overflow-y-auto bg-brand-bg shadow-float"><div className="gradient-hero flex items-center justify-between p-6 text-white"><h2 className="text-xl font-semibold">{barangay.name}</h2><button onClick={onClose} aria-label="Close"><X className="h-5 w-5" /></button></div><div className="space-y-5 p-5">{resource.loading ? <SkeletonStatGrid count={4} /> : resource.error ? <ErrorState message={resource.error} onRetry={resource.refresh} /> : <>
    <Card className="p-5"><h3 className="mb-4 text-sm font-semibold">Barangay Information</h3><div className="grid grid-cols-2 gap-4">{[["Residents", metrics.totalResidents], ["Households", metrics.totalHouseholds], ["Consultations This Month", metrics.consultationsThisMonth], ["High-Risk Residents", metrics.highRiskResidents], ["Active Follow-ups", metrics.activeFollowUps], ["Pending Follow-ups", metrics.pendingFollowUps], ["Pending Referrals", metrics.pendingReferrals], ["Immunization Records", metrics.immunizationRecords]].map(([label, number]) => <div key={label}><p className="text-xs text-brand-gray">{label}</p><p className="text-lg font-semibold">{metricValue(number)}</p></div>)}</div></Card>
    <ChartCard title="Monthly Consultations" data={data.consultationTrends}><LineChart data={data.consultationTrends}><XAxis dataKey="month" /><YAxis /><Tooltip /><Line dataKey="consultations" stroke="#2A7DE1" /></LineChart></ChartCard>
    <ChartCard title="Disease Trends" data={data.diseaseDistribution}><BarChart data={data.diseaseDistribution}><XAxis dataKey="name" /><YAxis /><Tooltip /><Bar dataKey="value" fill="#2A7DE1" /></BarChart></ChartCard>
    <Card className="p-5 text-sm text-brand-gray">Worker assignment, vaccination coverage, completed-follow-up rates and program enrollment must come from their respective authorized record sources. This aggregate does not provide those fields; none are guessed.</Card>
    <ChartCard title="Monthly Referral Summary" data={data.referralTrends}><BarChart data={data.referralTrends}><XAxis dataKey="month" /><YAxis /><Tooltip /><Bar dataKey="referrals" fill="#0B5CAD" /></BarChart></ChartCard>
  </>}</div></aside></div>;
}
