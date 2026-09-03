import React, { useEffect, useMemo, useState } from "react";
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import { TrendingUp, TrendingDown, Activity, Send, MapPin } from "lucide-react";
import PageHeader from "@/components/common/PageHeader";
import { Card } from "@/components/common/Card";
import { useAuth } from "@/context/AuthContext";
import { getAssignedBarangay } from "@/lib/barangayScope";
import { resolveEarlyWarningData } from "@/services/mock/mockEarlyWarning";
import { fetchEarlyWarningData } from "@/services/api/earlyWarningApi";

const tooltipStyle = { fontSize: "12px", borderRadius: "8px", border: "1px solid #E5EAF1" };

const SUMMARY_ICONS = [
  { icon: Activity, tone: "bg-brand-blue/10 text-brand-blue" },
  { icon: Send, tone: "bg-brand-yellow/15 text-[#B07E00]" },
  { icon: TrendingUp, tone: "bg-brand-green/10 text-brand-green" },
  { icon: TrendingDown, tone: "bg-brand-danger/10 text-brand-danger" },
];

const CONDITION_PALETTE = ["#0B5CAD", "#2A7DE1", "#F5B400", "#28B463", "#E74C3C", "#5B6472"];
const RISK_COLORS = { "Low Risk": "#28B463", "Moderate Risk": "#0B5CAD", "High Risk": "#F5B400", Critical: "#E74C3C" };

/** Live server figures override the mock values; shape stays the same. */
const mergeLiveScopedData = (base, live) => ({
  ...base,
  consultationTrends: live.consultationTrends?.length ? live.consultationTrends : base.consultationTrends,
  diseaseDistribution: live.diseaseDistribution?.length
    ? live.diseaseDistribution.map((d, i) => ({ ...d, color: CONDITION_PALETTE[i % CONDITION_PALETTE.length] }))
    : base.diseaseDistribution,
  riskDistribution: live.riskDistribution?.length
    ? live.riskDistribution.map((d) => ({ ...d, color: RISK_COLORS[d.name] || "#0B5CAD" }))
    : base.riskDistribution,
  summary: live.summary
    ? {
        consultationsThisMonth: {
          ...base.summary.consultationsThisMonth,
          value: String(live.summary.consultationsThisMonth ?? base.summary.consultationsThisMonth.value),
        },
        referralsThisMonth: {
          ...base.summary.referralsThisMonth,
          value: String(live.summary.referralsThisMonth ?? base.summary.referralsThisMonth.value),
        },
        topCondition: {
          name: live.summary.topCondition || base.summary.topCondition.name,
          cases: live.summary.topConditionCases != null ? `${live.summary.topConditionCases} cases` : base.summary.topCondition.cases,
        },
        highRiskResidents: {
          ...base.summary.highRiskResidents,
          value: String(live.summary.highRiskResidents ?? base.summary.highRiskResidents.value),
        },
      }
    : base.summary,
});

export default function HealthTrends() {
  const { user } = useAuth();
  // Barangay scope comes from the signed-in user's assignment — never from a
  // selector, URL or filter the user controls.
  const assignedBarangay = getAssignedBarangay(user);
  const [period, setPeriod] = useState("12m");
  const [liveData, setLiveData] = useState(null);

  const baseData = useMemo(() => resolveEarlyWarningData(assignedBarangay), [assignedBarangay]);

  // Barangay-scoped callers pull live figures from the API, which enforces
  // the same assignment on the server. Unreachable API (local dev) simply
  // keeps the scoped dataset above.
  useEffect(() => {
    if (!assignedBarangay) return undefined;
    let cancelled = false;
    fetchEarlyWarningData()
      .then((payload) => {
        if (!cancelled && payload) setLiveData(payload);
      })
      .catch(() => {
        /* API unavailable — keep the scoped mock dataset */
      });
    return () => {
      cancelled = true;
    };
  }, [assignedBarangay]);

  const scopedData = useMemo(
    () => (assignedBarangay && liveData ? mergeLiveScopedData(baseData, liveData) : baseData),
    [assignedBarangay, baseData, liveData],
  );

  const periodSelect = (
    <select
      value={period}
      onChange={(e) => setPeriod(e.target.value)}
      className="bg-white border border-brand-border rounded-btn px-3 py-2 text-sm outline-none focus:border-brand-blue"
    >
      <option value="3m">Last 3 Months</option>
      <option value="6m">Last 6 Months</option>
      <option value="12m">Last 12 Months</option>
    </select>
  );

  /* ------------------------------------------------------------------ */
  /* Barangay-scoped view (Health Supervisor assigned to one barangay)   */
  /* ------------------------------------------------------------------ */
  if (assignedBarangay) {
    const s = scopedData;
    const cards = [
      { ...SUMMARY_ICONS[0], label: "Consultations This Month", value: s.summary.consultationsThisMonth.value, change: s.summary.consultationsThisMonth.change, up: s.summary.consultationsThisMonth.up },
      { ...SUMMARY_ICONS[1], label: "Referrals This Month", value: s.summary.referralsThisMonth.value, change: s.summary.referralsThisMonth.change, up: s.summary.referralsThisMonth.up },
      { ...SUMMARY_ICONS[2], label: "Top Condition", value: s.summary.topCondition.name, change: s.summary.topCondition.cases, up: true },
      { ...SUMMARY_ICONS[3], label: "High-Risk Residents", value: s.summary.highRiskResidents.value, change: s.summary.highRiskResidents.change, up: s.summary.highRiskResidents.up },
    ];

    return (
      <>
        <PageHeader
          crumbs={["Home", "Health Trends"]}
          title="Health Trends"
          subtitle={`Health overview for Barangay ${assignedBarangay}`}
          action={
            <div className="flex flex-wrap items-center gap-2">
              <div
                className="flex items-center gap-2 rounded-btn border border-brand-border bg-brand-light/40 px-3 py-2 text-sm font-medium text-brand-ink"
                title="Your account is assigned to this barangay"
              >
                <MapPin className="w-4 h-4 text-brand-blue" /> Barangay {assignedBarangay}
              </div>
              {periodSelect}
            </div>
          }
        />

        {/* Summary */}
        <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-5">
          {cards.map((c) => (
            <div key={c.label} className="bg-white rounded-card border border-brand-border shadow-card p-5">
              <div className={`w-11 h-11 rounded-xl flex items-center justify-center ${c.tone}`}>
                <c.icon className="w-5 h-5" strokeWidth={1.8} />
              </div>
              <p className="mt-4 text-xs text-brand-gray uppercase tracking-wide">{c.label}</p>
              <div className="mt-1 flex items-baseline gap-2">
                <p className="text-2xl font-stat font-bold text-brand-ink">{c.value}</p>
                <span className={`text-xs font-medium ${c.up ? "text-brand-green" : "text-brand-danger"} flex items-center gap-0.5`}>
                  {c.up ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />} {c.change}
                </span>
              </div>
            </div>
          ))}
        </div>

        {/* Community Health Overview — assigned barangay only */}
        <Card className="p-4 sm:p-6 mt-6">
          <h3 className="font-semibold text-brand-ink text-sm sm:text-base mb-1">Community Health Overview</h3>
          <p className="text-xs text-brand-gray mb-4">Barangay {s.barangayOverview.name} — your assigned barangay.</p>
          <div className="grid lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2">
              <div className="flex justify-center">
                <img
                  src="/background-map.png"
                  alt={`Barangay ${s.barangayOverview.name}`}
                  className="w-full max-h-[420px] sm:max-h-[460px] object-contain"
                />
              </div>
              <div className="flex flex-wrap items-center gap-4 mt-4 text-xs text-brand-gray">
                <div className="flex items-center gap-1.5">
                  <span className={`w-2 h-2 rounded-full ${s.barangayOverview.dot}`} />
                  <span>{s.barangayOverview.name}</span>
                </div>
              </div>
            </div>
            <div className="space-y-3">
              <div className="bg-brand-light/30 rounded-lg p-4 border border-brand-border">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${s.barangayOverview.dot}`} />
                    <span className="font-medium text-brand-ink text-sm">{s.barangayOverview.name}</span>
                  </div>
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${s.barangayOverview.tone}`}>
                    {s.barangayOverview.status}
                  </span>
                </div>
                <p className="mt-2 text-xs text-brand-gray">{s.barangayOverview.residents}</p>
                <p className="text-xs text-brand-gray">{s.barangayOverview.consultations}</p>
                <p className="mt-2 text-xs text-brand-gray leading-relaxed">{s.barangayOverview.description}</p>
              </div>
            </div>
          </div>
        </Card>

        {/* Trends + Disease Distribution */}
        <div className="grid lg:grid-cols-3 gap-5 mt-6">
          <Card className="lg:col-span-2 p-6">
            <h3 className="font-semibold text-brand-ink mb-1">Consultation &amp; Referral Trends</h3>
            <p className="text-xs text-brand-gray mb-4">Monthly count for Barangay {s.barangayOverview.name}</p>
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={s.consultationTrends} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E5EAF1" />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: "#5B6472" }} axisLine={{ stroke: "#E5EAF1" }} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: "#5B6472" }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={tooltipStyle} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line type="monotone" dataKey="consultations" name="Consultations" stroke="#0B5CAD" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
                <Line type="monotone" dataKey="referrals" name="Referrals" stroke="#F5B400" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </Card>

          <Card className="p-6">
            <h3 className="font-semibold text-brand-ink mb-1">Disease Distribution</h3>
            <p className="text-xs text-brand-gray mb-4">Top reported conditions</p>
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={s.diseaseDistribution} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={45} outerRadius={75} paddingAngle={2}>
                  {s.diseaseDistribution.map((d) => <Cell key={d.name} fill={d.color} />)}
                </Pie>
                <Tooltip contentStyle={tooltipStyle} />
              </PieChart>
            </ResponsiveContainer>
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
        <div className="grid lg:grid-cols-2 gap-5 mt-5">
          <Card className="p-6">
            <h3 className="font-semibold text-brand-ink mb-1">Maternal Health Services Trend</h3>
            <p className="text-xs text-brand-gray mb-4">Monthly prenatal services</p>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={s.maternalTrend} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E5EAF1" />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: "#5B6472" }} axisLine={{ stroke: "#E5EAF1" }} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: "#5B6472" }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={tooltipStyle} />
                <Line type="monotone" dataKey="count" name="Prenatal services" stroke="#0B5CAD" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </Card>

          <Card className="p-6">
            <h3 className="font-semibold text-brand-ink mb-1">Senior Citizen Monitoring Trend</h3>
            <p className="text-xs text-brand-gray mb-4">Monthly monitoring records</p>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={s.seniorTrend} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E5EAF1" />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: "#5B6472" }} axisLine={{ stroke: "#E5EAF1" }} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: "#5B6472" }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={tooltipStyle} />
                <Line type="monotone" dataKey="count" name="Monitoring records" stroke="#28B463" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </Card>
        </div>

        {/* Risk + Program compliance */}
        <div className="grid lg:grid-cols-2 gap-5 mt-5">
          <Card className="p-6">
            <h3 className="font-semibold text-brand-ink mb-1">Risk Classification Distribution</h3>
            <p className="text-xs text-brand-gray mb-4">Resident risk levels in Barangay {s.barangayOverview.name}</p>
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={s.riskDistribution} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={2}>
                  {s.riskDistribution.map((d) => <Cell key={d.name} fill={d.color} />)}
                </Pie>
                <Tooltip contentStyle={tooltipStyle} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          </Card>

          <Card className="p-6">
            <h3 className="font-semibold text-brand-ink mb-1">Health Program Compliance</h3>
            <p className="text-xs text-brand-gray mb-4">Program completion percentages</p>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={s.programCompliance} layout="vertical" margin={{ top: 5, right: 10, left: 80, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E5EAF1" />
                <XAxis type="number" tick={{ fontSize: 11, fill: "#5B6472" }} axisLine={{ stroke: "#E5EAF1" }} tickLine={false} />
                <YAxis dataKey="program" type="category" tick={{ fontSize: 10, fill: "#5B6472" }} axisLine={false} tickLine={false} width={75} />
                <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "#F8FBFF" }} />
                <Bar dataKey="rate" name="Completion Rate (%)" fill="#0B5CAD" radius={[0, 4, 4, 0]} barSize={20} />
              </BarChart>
            </ResponsiveContainer>
          </Card>
        </div>
      </>
    );
  }

  /* ------------------------------------------------------------------ */
  /* Municipality-wide view (MHO — unchanged behaviour)                  */
  /* ------------------------------------------------------------------ */
  const d = baseData;
  return (
    <>
      <PageHeader
        crumbs={["Home", "Health Trends"]}
        title="Health Trends"
        subtitle="Municipal health overview across all barangays"
        action={periodSelect}
      />

      <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-5">
        {d.summary.map((s, i) => {
          const icon = SUMMARY_ICONS[i % SUMMARY_ICONS.length];
          return (
            <div key={s.label} className="bg-white rounded-card border border-brand-border shadow-card p-5">
              <div className={`w-11 h-11 rounded-xl flex items-center justify-center ${icon.tone}`}>
                <icon.icon className="w-5 h-5" strokeWidth={1.8} />
              </div>
              <p className="mt-4 text-xs text-brand-gray uppercase tracking-wide">{s.label}</p>
              <div className="mt-1 flex items-baseline gap-2">
                <p className="text-2xl font-stat font-bold text-brand-ink">{s.value}</p>
                <span className={`text-xs font-medium ${s.up ? "text-brand-green" : "text-brand-danger"} flex items-center gap-0.5`}>
                  {s.up ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />} {s.change}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Community Health Overview */}
      <Card className="p-4 sm:p-6 mt-6">
        <h3 className="font-semibold text-brand-ink text-sm sm:text-base mb-1">Community Health Overview</h3>
        <p className="text-xs text-brand-gray mb-4">Hover over highlighted barangays for quick statistics. Click to view detailed analytics.</p>

        <div className="grid lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2">
            <div className="flex justify-center">
              <img
                src="/background-map.png"
                alt="Community Health Map"
                className="w-full max-h-[420px] sm:max-h-[460px] object-contain"
              />
            </div>
            <div className="flex flex-wrap items-center gap-4 mt-4 text-xs text-brand-gray">
              {d.barangayCards.map((b) => (
                <div key={b.name} className="flex items-center gap-1.5">
                  <span className={`w-2 h-2 rounded-full ${b.dot}`} />
                  <span>{b.name}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            {d.barangayCards.map((b) => (
              <div key={b.name} className="bg-brand-light/30 rounded-lg p-4 border border-brand-border">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${b.dot}`} />
                    <span className="font-medium text-brand-ink text-sm">{b.name}</span>
                  </div>
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${b.tone}`}>{b.status}</span>
                </div>
                <p className="mt-2 text-xs text-brand-gray">{b.residents}</p>
                <p className="text-xs text-brand-gray">{b.consultations}</p>
              </div>
            ))}
          </div>
        </div>
      </Card>

      {/* Summary Status Cards */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5 mt-6">
        {d.statusCards.map((c) => (
          <div key={c.title} className="bg-white rounded-card border border-brand-border shadow-card p-5">
            <div className="flex items-center gap-2 mb-3">
              <span className={`w-2 h-2 rounded-full ${c.dot}`} />
              <h4 className="font-semibold text-brand-ink text-sm">{c.title}</h4>
            </div>
            <p className="text-2xl font-stat font-bold text-brand-ink">{c.value}</p>
            <p className="text-xs text-brand-gray mt-1">residents</p>
            <p className={`text-lg font-bold mt-2 ${c.text}`}>{c.percent}</p>
            <p className="text-xs text-brand-gray mt-3 leading-relaxed">{c.description}</p>
          </div>
        ))}
      </div>

      <div className="grid lg:grid-cols-3 gap-5 mt-6">
        <Card className="lg:col-span-2 p-6">
          <h3 className="font-semibold text-brand-ink mb-1">Consultation &amp; Referral Trends</h3>
          <p className="text-xs text-brand-gray mb-4">Monthly count over the past 12 months</p>
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={d.consultationTrends} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E5EAF1" />
              <XAxis dataKey="month" tick={{ fontSize: 11, fill: "#5B6472" }} axisLine={{ stroke: "#E5EAF1" }} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: "#5B6472" }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={tooltipStyle} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Line type="monotone" dataKey="consultations" name="Consultations" stroke="#0B5CAD" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
              <Line type="monotone" dataKey="referrals" name="Referrals" stroke="#F5B400" strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </Card>

        <Card className="p-6">
          <h3 className="font-semibold text-brand-ink mb-1">Disease Distribution</h3>
          <p className="text-xs text-brand-gray mb-4">Top reported conditions</p>
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie data={d.diseaseDistribution} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={45} outerRadius={75} paddingAngle={2}>
                {d.diseaseDistribution.map((dist) => <Cell key={dist.name} fill={dist.color} />)}
              </Pie>
              <Tooltip contentStyle={tooltipStyle} />
            </PieChart>
          </ResponsiveContainer>
          <div className="space-y-1.5 mt-2">
            {d.diseaseDistribution.map((dist) => (
              <div key={dist.name} className="flex items-center gap-2 text-xs">
                <span className="w-2.5 h-2.5 rounded-sm" style={{ background: dist.color }} />
                <span className="flex-1 text-brand-ink">{dist.name}</span>
                <span className="text-brand-gray font-stat font-bold">{dist.value}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <div className="grid lg:grid-cols-3 gap-5 mt-5">
        <Card className="lg:col-span-2 p-6">
          <h3 className="font-semibold text-brand-ink mb-1">Monthly Consultation Count by Barangay</h3>
          <p className="text-xs text-brand-gray mb-4">Comparison across 6 barangays</p>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={d.barangayComparison} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E5EAF1" />
              <XAxis dataKey="barangay" tick={{ fontSize: 10, fill: "#5B6472" }} axisLine={{ stroke: "#E5EAF1" }} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: "#5B6472" }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "#F8FBFF" }} />
              <Bar dataKey="consultations" name="Consultations" fill="#0B5CAD" radius={[4, 4, 0, 0]} barSize={28} />
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card className="p-6">
          <h3 className="font-semibold text-brand-ink mb-4">Barangay Comparison</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-brand-border text-left">
                  <th className="pb-2 text-xs font-medium text-brand-gray uppercase">Barangay</th>
                  <th className="pb-2 text-xs font-medium text-brand-gray text-right">Consult.</th>
                  <th className="pb-2 text-xs font-medium text-brand-gray text-right">Referrals</th>
                  <th className="pb-2 text-xs font-medium text-brand-gray text-right">Risk</th>
                </tr>
              </thead>
              <tbody>
                {d.barangayComparison.map((b) => (
                  <tr key={b.barangay} className="border-b border-brand-border last:border-0">
                    <td className="py-2.5 text-sm font-medium text-brand-ink">{b.barangay}</td>
                    <td className="py-2.5 text-right text-sm font-stat font-bold text-brand-ink">{b.consultations}</td>
                    <td className="py-2.5 text-right text-sm text-brand-gray">{b.referrals}</td>
                    <td className="py-2.5 text-right text-sm text-brand-danger font-medium">{b.highRisk}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      {/* Barangay Health Analytics */}
      <div className="mt-8">
        <h2 className="text-xl font-semibold text-brand-ink mb-2">Barangay Health Analytics</h2>
        <p className="text-sm text-brand-gray mb-6">Comparative health statistics submitted by every barangay</p>

        <div className="grid sm:grid-cols-2 gap-5">
          <Card className="p-6">
            <h3 className="font-semibold text-brand-ink mb-1">Referral Completion Rate per Barangay</h3>
            <p className="text-xs text-brand-gray mb-4">Efficiency of resident referral completion</p>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={d.referralCompletion} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E5EAF1" />
                <XAxis dataKey="barangay" tick={{ fontSize: 10, fill: "#5B6472" }} axisLine={{ stroke: "#E5EAF1" }} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: "#5B6472" }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "#F8FBFF" }} />
                <Bar dataKey="rate" name="Completion Rate (%)" fill="#0B5CAD" radius={[4, 4, 0, 0]} barSize={28} />
              </BarChart>
            </ResponsiveContainer>
          </Card>

          <Card className="p-6">
            <h3 className="font-semibold text-brand-ink mb-1">Maternal Health Services Trend</h3>
            <p className="text-xs text-brand-gray mb-4">Monthly prenatal services by barangay</p>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={d.maternalTrend} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E5EAF1" />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: "#5B6472" }} axisLine={{ stroke: "#E5EAF1" }} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: "#5B6472" }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={tooltipStyle} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line type="monotone" dataKey="sanJose" name="San Jose" stroke="#0B5CAD" strokeWidth={2} dot={{ r: 3 }} />
                <Line type="monotone" dataKey="sanIsidro" name="San Isidro" stroke="#2A7DE1" strokeWidth={2} dot={{ r: 3 }} />
                <Line type="monotone" dataKey="oldSanRoque" name="Old San Roque" stroke="#E74C3C" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </Card>

          <Card className="p-6">
            <h3 className="font-semibold text-brand-ink mb-1">Child Health Services Coverage</h3>
            <p className="text-xs text-brand-gray mb-4">Completed child health services per barangay</p>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={d.childHealthCoverage} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E5EAF1" />
                <XAxis dataKey="barangay" tick={{ fontSize: 10, fill: "#5B6472" }} axisLine={{ stroke: "#E5EAF1" }} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: "#5B6472" }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "#F8FBFF" }} />
                <Bar dataKey="services" name="Services" fill="#28B463" radius={[4, 4, 0, 0]} barSize={28} />
              </BarChart>
            </ResponsiveContainer>
          </Card>

          <Card className="p-6">
            <h3 className="font-semibold text-brand-ink mb-1">Senior Citizen Monitoring Trend</h3>
            <p className="text-xs text-brand-gray mb-4">Monthly monitoring records by barangay</p>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={d.seniorTrend} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E5EAF1" />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: "#5B6472" }} axisLine={{ stroke: "#E5EAF1" }} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: "#5B6472" }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={tooltipStyle} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line type="monotone" dataKey="sanJose" name="San Jose" stroke="#0B5CAD" strokeWidth={2} dot={{ r: 3 }} />
                <Line type="monotone" dataKey="sanIsidro" name="San Isidro" stroke="#2A7DE1" strokeWidth={2} dot={{ r: 3 }} />
                <Line type="monotone" dataKey="oldSanRoque" name="Old San Roque" stroke="#E74C3C" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </Card>

          <Card className="p-6">
            <h3 className="font-semibold text-brand-ink mb-1">Health Program Participation</h3>
            <p className="text-xs text-brand-gray mb-4">Program participation across barangays</p>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={d.programParticipation} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E5EAF1" />
                <XAxis dataKey="barangay" tick={{ fontSize: 10, fill: "#5B6472" }} axisLine={{ stroke: "#E5EAF1" }} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: "#5B6472" }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "#F8FBFF" }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="maternal" name="Maternal Care" fill="#0B5CAD" radius={[4, 4, 0, 0]} barSize={12} />
                <Bar dataKey="immunization" name="Immunization" fill="#28B463" radius={[4, 4, 0, 0]} barSize={12} />
                <Bar dataKey="nutrition" name="Nutrition" fill="#F5B400" radius={[4, 4, 0, 0]} barSize={12} />
                <Bar dataKey="tb" name="TB Monitoring" fill="#E74C3C" radius={[4, 4, 0, 0]} barSize={12} />
                <Bar dataKey="familyPlanning" name="Family Planning" fill="#5B6472" radius={[4, 4, 0, 0]} barSize={12} />
              </BarChart>
            </ResponsiveContainer>
          </Card>

          <Card className="p-6">
            <h3 className="font-semibold text-brand-ink mb-1">Monthly Consultations Submitted</h3>
            <p className="text-xs text-brand-gray mb-4">Consultations submitted by each barangay</p>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={d.monthlyConsultations} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E5EAF1" />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: "#5B6472" }} axisLine={{ stroke: "#E5EAF1" }} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: "#5B6472" }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "#F8FBFF" }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="sanJose" name="San Jose" fill="#0B5CAD" stackId="a" barSize={20} />
                <Bar dataKey="sanIsidro" name="San Isidro" fill="#2A7DE1" stackId="a" barSize={20} />
                <Bar dataKey="oldSanRoque" name="Old San Roque" fill="#E74C3C" stackId="a" barSize={20} />
              </BarChart>
            </ResponsiveContainer>
          </Card>

          <Card className="p-6">
            <h3 className="font-semibold text-brand-ink mb-1">Monthly Referrals Submitted</h3>
            <p className="text-xs text-brand-gray mb-4">Referrals created by each barangay</p>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={d.monthlyReferrals} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E5EAF1" />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: "#5B6472" }} axisLine={{ stroke: "#E5EAF1" }} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: "#5B6472" }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "#F8FBFF" }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="sanJose" name="San Jose" fill="#0B5CAD" stackId="a" barSize={20} />
                <Bar dataKey="sanIsidro" name="San Isidro" fill="#2A7DE1" stackId="a" barSize={20} />
                <Bar dataKey="oldSanRoque" name="Old San Roque" fill="#E74C3C" stackId="a" barSize={20} />
              </BarChart>
            </ResponsiveContainer>
          </Card>

          <Card className="p-6">
            <h3 className="font-semibold text-brand-ink mb-1">Risk Classification Distribution</h3>
            <p className="text-xs text-brand-gray mb-4">Municipality-wide resident risk levels</p>
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={d.riskDistribution} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={2}>
                  {d.riskDistribution.map((dist) => <Cell key={dist.name} fill={dist.color} />)}
                </Pie>
                <Tooltip contentStyle={tooltipStyle} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          </Card>

          <Card className="p-6">
            <h3 className="font-semibold text-brand-ink mb-1">Top Reported Diseases by Barangay</h3>
            <p className="text-xs text-brand-gray mb-4">Disease prevalence across barangays</p>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={d.diseasesByBarangay} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E5EAF1" />
                <XAxis dataKey="barangay" tick={{ fontSize: 10, fill: "#5B6472" }} axisLine={{ stroke: "#E5EAF1" }} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: "#5B6472" }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "#F8FBFF" }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="hypertension" name="Hypertension" fill="#0B5CAD" radius={[4, 4, 0, 0]} barSize={12} />
                <Bar dataKey="diabetes" name="Diabetes" fill="#2A7DE1" radius={[4, 4, 0, 0]} barSize={12} />
                <Bar dataKey="respiratory" name="Respiratory" fill="#F5B400" radius={[4, 4, 0, 0]} barSize={12} />
                <Bar dataKey="malnutrition" name="Malnutrition" fill="#28B463" radius={[4, 4, 0, 0]} barSize={12} />
                <Bar dataKey="anemia" name="Anemia" fill="#E74C3C" radius={[4, 4, 0, 0]} barSize={12} />
              </BarChart>
            </ResponsiveContainer>
          </Card>

          <Card className="p-6">
            <h3 className="font-semibold text-brand-ink mb-1">Health Program Compliance</h3>
            <p className="text-xs text-brand-gray mb-4">Municipality-wide program completion percentages</p>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={d.programCompliance} layout="vertical" margin={{ top: 5, right: 10, left: 80, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E5EAF1" />
                <XAxis type="number" tick={{ fontSize: 11, fill: "#5B6472" }} axisLine={{ stroke: "#E5EAF1" }} tickLine={false} />
                <YAxis dataKey="program" type="category" tick={{ fontSize: 10, fill: "#5B6472" }} axisLine={false} tickLine={false} width={75} />
                <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "#F8FBFF" }} />
                <Bar dataKey="rate" name="Completion Rate (%)" fill="#0B5CAD" radius={[0, 4, 4, 0]} barSize={20} />
              </BarChart>
            </ResponsiveContainer>
          </Card>
        </div>
      </div>
    </>
  );
}
