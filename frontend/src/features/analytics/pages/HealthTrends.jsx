import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import { TrendingUp, TrendingDown, Activity, Send, MapPin } from "lucide-react";
import PageHeader from "@/components/common/PageHeader";
import { Card } from "@/components/common/Card";
import { PageSkeleton } from "@/components/common/Skeleton";
import ErrorState from "@/components/common/ErrorState";
import { useAuth } from "@/context/AuthContext";
import { getAssignedBarangay } from "@/lib/barangayScope";
import { resolveEarlyWarningData } from "@/services/local/earlyWarning";
import { fetchEarlyWarningData, fetchCommunityMap } from "@/services/api/earlyWarningApi";

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
  // Barangay scope comes from the signed-in user's assignment â€” never from a
  // selector, URL or filter the user controls.
  const assignedBarangay = getAssignedBarangay(user);
  const [period, setPeriod] = useState("12m");
  const [liveData, setLiveData] = useState(null);
  const [loading, setLoading] = useState(Boolean(assignedBarangay));

  const baseData = useMemo(() => resolveEarlyWarningData(assignedBarangay), [assignedBarangay]);

  // Barangay-scoped callers pull live figures from the API, which enforces
  // the same assignment on the server. The figures render behind a skeleton
  // until the request settles; an unavailable API simply leaves the empty
  // dataset (and the page's empty states) in place.
  useEffect(() => {
    if (!assignedBarangay) {
      setLoading(false);
      return undefined;
    }
    let cancelled = false;
    fetchEarlyWarningData()
      .then((payload) => {
        if (!cancelled && payload) setLiveData(payload);
      })
      .catch(() => {
        /* API unavailable â€” the empty dataset is shown instead */
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [assignedBarangay]);

  const scopedData = useMemo(
    () => (assignedBarangay && liveData ? mergeLiveScopedData(baseData, liveData) : baseData),
    [assignedBarangay, baseData, liveData],
  );

  /* ------------------------------------------------------------------ */
  /* Municipality-wide live data (MHO / unassigned).                     */
  /* The server resolves the municipality scope from the session; this   */
  /* view sends NO barangay id and cannot widen scope. `early-warning`   */
  /* supplies the summary, 12-month trend, disease + risk distributions; */
  /* `community-map` supplies the real per-barangay overview rows.       */
  /* ------------------------------------------------------------------ */
  const [muniEW, setMuniEW] = useState(null);
  const [muniMap, setMuniMap] = useState(null);
  const [muniLoading, setMuniLoading] = useState(!assignedBarangay);
  const [muniError, setMuniError] = useState(null);

  const muniRange = useMemo(() => {
    const now = new Date();
    const iso = (d) => d.toISOString().slice(0, 10);
    const months = period === "3m" ? 3 : period === "6m" ? 6 : 12;
    return { from: iso(new Date(now.getFullYear(), now.getMonth() - months, now.getDate())), to: iso(now) };
  }, [period]);

  const loadMunicipality = useCallback(() => {
    setMuniLoading(true);
    setMuniError(null);
    let cancelled = false;
    Promise.all([
      fetchEarlyWarningData().catch(() => null),
      fetchCommunityMap({ from: muniRange.from, to: muniRange.to }).catch(() => null),
    ])
      .then(([ew, map]) => {
        if (cancelled) return;
        setMuniEW(ew);
        setMuniMap(map);
        if (!ew && !map) setMuniError("Unable to load municipal health data.");
      })
      .finally(() => { if (!cancelled) setMuniLoading(false); });
    return () => { cancelled = true; };
  }, [muniRange.from, muniRange.to]);

  useEffect(() => {
    if (assignedBarangay) return undefined;
    return loadMunicipality();
  }, [assignedBarangay, loadMunicipality]);

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
          crumbs={["Health Trends"]}
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
        {loading ? (
          <PageSkeleton />
        ) : (
        <>
        <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-5">
          {cards.map((c) => (
            <div key={c.label} className="rounded-2xl border border-slate-200 bg-white shadow-card p-5">
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

        {/* Community Health Risk Overview — assigned barangay only.
            KALUSAGAP does not use maps; this is a health/risk summary. */}
        <Card className="p-4 sm:p-6 mt-6">
          <h3 className="font-semibold text-brand-ink text-sm sm:text-base mb-1">Community Health Risk Overview</h3>
          <p className="text-xs text-brand-gray mb-4">Barangay {s.barangayOverview.name} — resident risk levels from recorded consultations.</p>
          {(() => {
            const riskValue = (name) => Number(s.riskDistribution.find((d) => d.name === name)?.value || 0);
            const high = riskValue("High Risk");
            const moderate = riskValue("Moderate Risk");
            const low = riskValue("Low Risk");
            const assessed = high + moderate + low;
            const highPct = assessed > 0 ? Math.round((high / assessed) * 100) : null;
            const rows = [
              { label: "High Risk", value: high, tone: "text-brand-danger", bar: "bg-brand-danger" },
              { label: "Moderate Risk", value: moderate, tone: "text-brand-blue", bar: "bg-brand-blue" },
              { label: "Low Risk", value: low, tone: "text-brand-green", bar: "bg-brand-green" },
            ];
            return (
              <div className="grid gap-6 lg:grid-cols-3">
                <div className="lg:col-span-2 space-y-3">
                  {rows.map((r) => {
                    const p = assessed > 0 ? Math.round((r.value / assessed) * 100) : 0;
                    return (
                      <div key={r.label}>
                        <div className="mb-1 flex items-center justify-between text-sm">
                          <span className="text-brand-gray">{r.label}</span>
                          <span className={`font-stat font-bold ${r.tone}`}>{r.value}</span>
                        </div>
                        <div className="h-2 overflow-hidden rounded-full bg-brand-border">
                          <div className={`h-full rounded-full ${r.bar}`} style={{ width: `${p}%` }} />
                        </div>
                      </div>
                    );
                  })}
                  {assessed === 0 && (
                    <p className="text-xs text-brand-gray">No consultations with vitals have been recorded yet, so no risk levels can be computed for this barangay.</p>
                  )}
                </div>
                <div className="space-y-3">
                  <div className="rounded-lg border border-brand-border bg-brand-light/30 p-4">
                    <p className="text-[11px] uppercase tracking-wide text-brand-gray">High-Risk Residents</p>
                    <div className="mt-1 flex items-baseline gap-2">
                      <p className="text-2xl font-stat font-bold text-brand-ink">{high}</p>
                      {highPct != null && <span className="text-xs font-medium text-brand-danger">{highPct}% of assessed</span>}
                    </div>
                    <p className="mt-2 text-xs text-brand-gray">Residents assessed: {assessed}</p>
                  </div>
                  <div className="rounded-lg border border-brand-border bg-brand-light/30 p-4">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-brand-ink">{s.barangayOverview.name}</span>
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${s.barangayOverview.tone}`}>{s.barangayOverview.status}</span>
                    </div>
                    <p className="mt-2 text-xs text-brand-gray">{s.barangayOverview.residents}</p>
                    <p className="text-xs text-brand-gray">{s.barangayOverview.consultations}</p>
                  </div>
                </div>
              </div>
            );
          })()}
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
        )}
      </>
    );
  }

  /* ------------------------------------------------------------------ */
  /* Municipality-wide view (MHO â€” unchanged behaviour)                  */
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
    { ...SUMMARY_ICONS[0], label: "Consultations This Month", value: sm.consultationsThisMonth ?? 0, sub: "recorded this month" },
    { ...SUMMARY_ICONS[1], label: "Referrals This Month", value: sm.referralsThisMonth ?? 0, sub: "created this month" },
    { ...SUMMARY_ICONS[2], label: "Top Condition", value: (sm.topConditionCases ?? 0) > 0 ? sm.topCondition : "—", sub: (sm.topConditionCases ?? 0) > 0 ? `${sm.topConditionCases} case${sm.topConditionCases === 1 ? "" : "s"}` : "No data yet" },
    { ...SUMMARY_ICONS[3], label: "High-Risk Residents", value: sm.highRiskResidents ?? 0, sub: "from recorded vitals" },
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
        action={periodSelect}
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
              <p className="text-xs text-brand-gray mb-4">Recorded consultations per barangay ({muniRange.from} to {muniRange.to})</p>
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
