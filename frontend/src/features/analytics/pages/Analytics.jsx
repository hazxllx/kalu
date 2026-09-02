import React, { useState } from "react";
import { motion } from "framer-motion";
import PageHeader from "@/components/common/PageHeader";
import { Card } from "@/components/common/Card";
import CommunityHealthMap from "@/features/analytics/components/CommunityHealthMap";
import BarangaySidePanel from "@/features/analytics/components/BarangaySidePanel";
import HealthStatusSummary from "@/features/analytics/components/HealthStatusSummary";
import HealthAlertsFeed from "@/features/analytics/components/HealthAlertsFeed";
import {
  ResponsiveContainer, BarChart, Bar, LineChart, Line, AreaChart, Area,
  XAxis, YAxis, Tooltip, CartesianGrid, Legend, Cell, PieChart, Pie,
} from "recharts";
import {
  highlightedBarangays, comparisonMonthlyConsultations, diseaseDonutData,
  comparisonFollowUpTrend, comparisonVaccinationCoverage, comparisonReferralCompletion,
  comparisonMaternalTrend, comparisonChildHealth, comparisonSeniorTrend,
  comparisonProgramParticipation, healthStatusSummary, recentHealthAlerts,
} from "@/services/mock/mockData";

const CHART_COLORS = { "San Jose": "#28B463", "San Isidro": "#2A7DE1", "Old San Roque": "#E67E22" };
const DONUT_COLORS = ["#0B5CAD", "#2A7DE1", "#28B463", "#F5B400", "#E74C3C"];
const tooltipStyle = { borderRadius: 12, border: "1px solid #E5EAF1", fontSize: 12, fontFamily: "DM Sans" };
const tickStyle = { fill: "#5B6472", fontSize: 12, fontFamily: "DM Sans" };
const legendStyle = { fontSize: 12, fontFamily: "DM Sans" };

function ChartCard({ title, subtitle, children, delay = 0 }) {
  return (
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay, duration: 0.4 }}>
      <Card className="p-6 h-full">
        <div className="mb-4">
          <h3 className="font-heading font-semibold text-brand-ink">{title}</h3>
          {subtitle && <p className="text-xs text-brand-gray mt-0.5">{subtitle}</p>}
        </div>
        <ResponsiveContainer width="100%" height={260}>
          {children}
        </ResponsiveContainer>
      </Card>
    </motion.div>
  );
}

function AreaGradients({ idPrefix }) {
  return (
    <defs>
      {["San Jose", "San Isidro", "Old San Roque"].map((name, i) => (
        <linearGradient key={i} id={`grad-${idPrefix}-${i}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={CHART_COLORS[name]} stopOpacity={0.25} />
          <stop offset="100%" stopColor={CHART_COLORS[name]} stopOpacity={0} />
        </linearGradient>
      ))}
    </defs>
  );
}

export default function Analytics() {
  const [selected, setSelected] = useState(null);

  return (
    <>
      <PageHeader crumbs={["Home", "Analytics"]} title="Analytics" subtitle="Community health insights across highlighted barangays." />

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
                  className="w-full flex items-center justify-between bg-white border border-brand-border rounded-card p-4 text-left shadow-card hover:shadow-deep transition-shadow"
                >
                  <div className="flex items-center gap-3">
                    <span className="w-3 h-3 rounded-full" style={{ background: b.color }} />
                    <div>
                      <p className="font-body font-medium text-brand-ink">{b.name}</p>
                      <p className="text-xs text-brand-gray">{b.population.toLocaleString()} residents · {b.consultations} consultations</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-brand-gray">Status</p>
                    <p className="text-sm font-body font-medium" style={{ color: b.color }}>{b.healthStatus}</p>
                  </div>
                </motion.button>
              ))}
            </div>
          </div>
        </Card>
      </motion.div>

      {/* Health Status Summary */}
      <HealthStatusSummary summary={healthStatusSummary} />

      {/* Community Health Trends */}
      <div className="mt-8">
        <h2 className="font-heading font-semibold text-brand-ink text-lg mb-4">Community Health Trends</h2>
        <div className="grid lg:grid-cols-2 gap-5">
          {/* Monthly Consultations — Line Chart */}
          <ChartCard title="Monthly Consultations" subtitle="Consultation volume over 6 months" delay={0.05}>
            <LineChart data={comparisonMonthlyConsultations}>
              <CartesianGrid vertical={false} stroke="#E5EAF1" />
              <XAxis dataKey="month" axisLine={false} tickLine={false} tick={tickStyle} />
              <YAxis axisLine={false} tickLine={false} tick={tickStyle} />
              <Tooltip contentStyle={tooltipStyle} />
              <Legend wrapperStyle={legendStyle} />
              <Line type="monotone" dataKey="San Jose" stroke={CHART_COLORS["San Jose"]} strokeWidth={2.5} dot={{ r: 3 }} />
              <Line type="monotone" dataKey="San Isidro" stroke={CHART_COLORS["San Isidro"]} strokeWidth={2.5} dot={{ r: 3 }} />
              <Line type="monotone" dataKey="Old San Roque" stroke={CHART_COLORS["Old San Roque"]} strokeWidth={2.5} dot={{ r: 3 }} />
            </LineChart>
          </ChartCard>

          {/* Disease Distribution — Donut Chart */}
          <ChartCard title="Disease Distribution" subtitle="Combined case counts across 3 barangays" delay={0.1}>
            <PieChart>
              <Pie data={diseaseDonutData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={55} outerRadius={90} paddingAngle={2}>
                {diseaseDonutData.map((_, i) => <Cell key={i} fill={DONUT_COLORS[i]} />)}
              </Pie>
              <Tooltip contentStyle={tooltipStyle} />
              <Legend wrapperStyle={legendStyle} />
            </PieChart>
          </ChartCard>

          {/* Follow-up Completion — Area Chart */}
          <ChartCard title="Follow-up Completion Rate" subtitle="Monthly trend across barangays" delay={0.15}>
            <AreaChart data={comparisonFollowUpTrend}>
              <AreaGradients idPrefix="fu" />
              <CartesianGrid vertical={false} stroke="#E5EAF1" />
              <XAxis dataKey="month" axisLine={false} tickLine={false} tick={tickStyle} />
              <YAxis axisLine={false} tickLine={false} tick={tickStyle} domain={[60, 100]} />
              <Tooltip contentStyle={tooltipStyle} />
              <Legend wrapperStyle={legendStyle} />
              <Area type="monotone" dataKey="San Jose" stroke={CHART_COLORS["San Jose"]} strokeWidth={2} fill="url(#grad-fu-0)" />
              <Area type="monotone" dataKey="San Isidro" stroke={CHART_COLORS["San Isidro"]} strokeWidth={2} fill="url(#grad-fu-1)" />
              <Area type="monotone" dataKey="Old San Roque" stroke={CHART_COLORS["Old San Roque"]} strokeWidth={2} fill="url(#grad-fu-2)" />
            </AreaChart>
          </ChartCard>

          {/* Vaccination Coverage — Bar Chart */}
          <ChartCard title="Vaccination Coverage" subtitle="Current coverage by barangay" delay={0.2}>
            <BarChart data={comparisonVaccinationCoverage}>
              <CartesianGrid vertical={false} stroke="#E5EAF1" />
              <XAxis dataKey="name" axisLine={false} tickLine={false} tick={tickStyle} />
              <YAxis axisLine={false} tickLine={false} tick={tickStyle} domain={[0, 100]} />
              <Tooltip cursor={{ fill: "#EDF6FF" }} contentStyle={tooltipStyle} />
              <Bar dataKey="value" radius={[6, 6, 0, 0]} maxBarSize={56}>
                {comparisonVaccinationCoverage.map((e, i) => <Cell key={i} fill={CHART_COLORS[e.name]} />)}
              </Bar>
            </BarChart>
          </ChartCard>

          {/* Referral Completion — Bar Chart */}
          <ChartCard title="Referral Completion" subtitle="Completion rate by barangay" delay={0.25}>
            <BarChart data={comparisonReferralCompletion}>
              <CartesianGrid vertical={false} stroke="#E5EAF1" />
              <XAxis dataKey="name" axisLine={false} tickLine={false} tick={tickStyle} />
              <YAxis axisLine={false} tickLine={false} tick={tickStyle} domain={[0, 100]} />
              <Tooltip cursor={{ fill: "#EDF6FF" }} contentStyle={tooltipStyle} />
              <Bar dataKey="value" radius={[6, 6, 0, 0]} maxBarSize={56}>
                {comparisonReferralCompletion.map((e, i) => <Cell key={i} fill={CHART_COLORS[e.name]} />)}
              </Bar>
            </BarChart>
          </ChartCard>

          {/* Maternal Health — Area Chart */}
          <ChartCard title="Maternal Health Services" subtitle="Monthly service coverage trend" delay={0.3}>
            <AreaChart data={comparisonMaternalTrend}>
              <AreaGradients idPrefix="mh" />
              <CartesianGrid vertical={false} stroke="#E5EAF1" />
              <XAxis dataKey="month" axisLine={false} tickLine={false} tick={tickStyle} />
              <YAxis axisLine={false} tickLine={false} tick={tickStyle} domain={[60, 100]} />
              <Tooltip contentStyle={tooltipStyle} />
              <Legend wrapperStyle={legendStyle} />
              <Area type="monotone" dataKey="San Jose" stroke={CHART_COLORS["San Jose"]} strokeWidth={2} fill="url(#grad-mh-0)" />
              <Area type="monotone" dataKey="San Isidro" stroke={CHART_COLORS["San Isidro"]} strokeWidth={2} fill="url(#grad-mh-1)" />
              <Area type="monotone" dataKey="Old San Roque" stroke={CHART_COLORS["Old San Roque"]} strokeWidth={2} fill="url(#grad-mh-2)" />
            </AreaChart>
          </ChartCard>

          {/* Child Health — Bar Chart */}
          <ChartCard title="Child Health Services" subtitle="Service coverage by barangay" delay={0.35}>
            <BarChart data={comparisonChildHealth}>
              <CartesianGrid vertical={false} stroke="#E5EAF1" />
              <XAxis dataKey="name" axisLine={false} tickLine={false} tick={tickStyle} />
              <YAxis axisLine={false} tickLine={false} tick={tickStyle} domain={[0, 100]} />
              <Tooltip cursor={{ fill: "#EDF6FF" }} contentStyle={tooltipStyle} />
              <Bar dataKey="value" radius={[6, 6, 0, 0]} maxBarSize={56}>
                {comparisonChildHealth.map((e, i) => <Cell key={i} fill={CHART_COLORS[e.name]} />)}
              </Bar>
            </BarChart>
          </ChartCard>

          {/* Senior Citizen Monitoring — Line Chart */}
          <ChartCard title="Senior Citizen Monitoring" subtitle="Monthly monitoring coverage trend" delay={0.4}>
            <LineChart data={comparisonSeniorTrend}>
              <CartesianGrid vertical={false} stroke="#E5EAF1" />
              <XAxis dataKey="month" axisLine={false} tickLine={false} tick={tickStyle} />
              <YAxis axisLine={false} tickLine={false} tick={tickStyle} domain={[60, 100]} />
              <Tooltip contentStyle={tooltipStyle} />
              <Legend wrapperStyle={legendStyle} />
              <Line type="monotone" dataKey="San Jose" stroke={CHART_COLORS["San Jose"]} strokeWidth={2.5} dot={{ r: 3 }} />
              <Line type="monotone" dataKey="San Isidro" stroke={CHART_COLORS["San Isidro"]} strokeWidth={2.5} dot={{ r: 3 }} />
              <Line type="monotone" dataKey="Old San Roque" stroke={CHART_COLORS["Old San Roque"]} strokeWidth={2.5} dot={{ r: 3 }} />
            </LineChart>
          </ChartCard>

          {/* Health Program Participation — Bar Chart */}
          <ChartCard title="Health Program Participation" subtitle="Participation rate by barangay" delay={0.45}>
            <BarChart data={comparisonProgramParticipation}>
              <CartesianGrid vertical={false} stroke="#E5EAF1" />
              <XAxis dataKey="name" axisLine={false} tickLine={false} tick={tickStyle} />
              <YAxis axisLine={false} tickLine={false} tick={tickStyle} domain={[0, 100]} />
              <Tooltip cursor={{ fill: "#EDF6FF" }} contentStyle={tooltipStyle} />
              <Bar dataKey="value" radius={[6, 6, 0, 0]} maxBarSize={56}>
                {comparisonProgramParticipation.map((e, i) => <Cell key={i} fill={CHART_COLORS[e.name]} />)}
              </Bar>
            </BarChart>
          </ChartCard>
        </div>
      </div>

      {/* Recent Health Alerts */}
      <div className="mt-8">
        <h2 className="font-heading font-semibold text-brand-ink text-lg mb-4">Recent Health Alerts</h2>
        <HealthAlertsFeed alerts={recentHealthAlerts} />
      </div>

      {/* Side Panel */}
      {selected && <BarangaySidePanel barangay={selected} onClose={() => setSelected(null)} />}
    </>
  );
}