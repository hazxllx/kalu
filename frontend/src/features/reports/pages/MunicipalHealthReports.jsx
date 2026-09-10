import React, { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import PageHeader from "@/components/common/PageHeader";
import { Card } from "@/components/common/Card";
import { useHouseholdRiskClusters } from "@/services/mock/householdRiskStore";
import { useMunicipalSubmissions } from "@/services/mock/municipalSubmissionsStore";
import { RISK_LEVELS } from "@/lib/householdRisk";
import {
  residents, households, followUps, referrals, immunizations, immunizationSessions,
  m1Records, barangayOverview, vaccinationCoverage, monthlyConsultations, topDiseases, recentHealthAlerts,
} from "@/services/mock/mockData";
import {
  Users, Home as HomeIcon, Stethoscope, Send, CalendarClock, AlertTriangle,
  FileText, Download, RefreshCw, X, ChevronRight, FileSpreadsheet,
} from "lucide-react";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from "recharts";

const DEFAULT_PERIOD = "September 2026";
const PERIODS = ["September 2026", "August 2026", "July 2026", "Q3 2026", "Annual 2026"];
const BARANGAY_OPTIONS = ["All Barangays", "San Isidro", "San Antonio", "Old San Roque"];
const REPORT_TYPES = ["All Reports", "Health Activity", "TCL", "M1", "Household Risk", "Referrals", "Immunization", "Maternal & Child Health"];
const TREND_METRICS = ["Consultations", "Referrals", "Follow-ups", "Household Visits"];

const levelTone = {
  [RISK_LEVELS.STABLE]: { chip: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400", dot: "bg-brand-green" },
  [RISK_LEVELS.MONITOR]: { chip: "bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400", dot: "bg-brand-yellow" },
  [RISK_LEVELS.INTERVENTION]: { chip: "bg-orange-50 text-orange-700 dark:bg-orange-500/15 dark:text-orange-400", dot: "bg-brand-accent" },
  [RISK_LEVELS.PRIORITY]: { chip: "bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-400", dot: "bg-brand-danger" },
};

/**
 * Summary card. Where a meaningful destination exists, the whole card is a
 * working Link; otherwise it renders as a plain card. No fake interactions.
 */
function Metric({ label, value, icon: Icon, tone, to }) {
  const inner = (
    <div className="flex h-full items-center gap-3">
      <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${tone}`}><Icon className="h-5 w-5" /></div>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-semibold uppercase leading-snug tracking-[0.08em] text-brand-gray">{label}</p>
        <p className="mt-0.5 text-2xl font-semibold leading-tight text-brand-ink">{value}</p>
      </div>
      {to && <ChevronRight className="h-4 w-4 shrink-0 text-brand-gray" />}
    </div>
  );
  return to ? (
    <Link to={to} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-card transition-colors hover:border-brand-blue/40 dark:border-border dark:bg-card">{inner}</Link>
  ) : (
    <Card className="p-4 shadow-card">{inner}</Card>
  );
}

function SectionHeader({ title, subtitle, action }) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0">
        <h3 className="text-sm font-semibold text-brand-ink sm:text-base">{title}</h3>
        {subtitle && <p className="mt-0.5 break-words text-xs leading-relaxed text-brand-gray">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

/** Compact labeled filter control used in the filter bar. */
function Filter({ label, value, onChange, options }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      <label className="text-[11px] font-semibold uppercase tracking-[0.1em] text-brand-gray">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-btn border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none transition-colors focus:border-brand-blue dark:border-border dark:bg-input dark:text-foreground"
      >
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );
}

export default function MunicipalHealthReports() {
  const clusters = useHouseholdRiskClusters();
  const submissions = useMunicipalSubmissions();

  const [period, setPeriod] = useState(DEFAULT_PERIOD);
  const [barangayFilter, setBarangayFilter] = useState("All Barangays");
  const [reportType, setReportType] = useState("All Reports");
  const [trendMetric, setTrendMetric] = useState("Consultations");
  const [phase, setPhase] = useState("ready");
  const [toast, setToast] = useState(null);

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const isAll = barangayFilter === "All Barangays";
  const brgy = isAll ? null : barangayFilter;

  const derived = useMemo(() => {
    const scope = (rows) => (brgy ? rows.filter((r) => r.barangay === brgy) : rows);

    const tcl = submissions.filter((s) => s.type === "TCL" && s.period === period);
    const m1 = submissions.filter((s) => s.type === "M1" && s.period === period);

    const riskByScope = brgy ? clusters.filter((c) => c.barangay === brgy) : clusters;
    const riskCounts = { priority: 0, intervention: 0, monitor: 0, stable: 0 };
    riskByScope.forEach((c) => {
      if (c.risk?.level === RISK_LEVELS.PRIORITY) riskCounts.priority += 1;
      else if (c.risk?.level === RISK_LEVELS.INTERVENTION) riskCounts.intervention += 1;
      else if (c.risk?.level === RISK_LEVELS.MONITOR) riskCounts.monitor += 1;
      else riskCounts.stable += 1;
    });

    const indicatorCounts = {};
    riskByScope.forEach((c) => (c.risk?.indicators || []).forEach((i) => {
      indicatorCounts[i.label] = (indicatorCounts[i.label] || 0) + 1;
    }));
    const topIndicators = Object.entries(indicatorCounts).sort((a, b) => b[1] - a[1]).slice(0, 5);

    const pendingReview = submissions.filter((s) => s.reviewStatus === "Pending Review" || s.status === "Under Review").length;
    const needsCorrection = submissions.filter((s) => s.reviewStatus === "Needs Correction" || s.reviewStatus === "Returned").length;

    return {
      residents: scope(residents).length || barangayOverview.find((b) => b.name === brgy)?.residents || barangayOverview.reduce((a, b) => a + b.residents, 0),
      households: scope(households).length || (brgy ? clusters.filter((c) => c.barangay === brgy).length : clusters.length),
      consultations: brgy ? (barangayOverview.find((b) => b.name === brgy)?.consultations || 94) : 312,
      referrals: scope(referrals).length || referrals.length,
      followUps: followUps.filter((f) => f.status === "Today" || f.status === "Upcoming").length,
      priority: riskCounts.priority,
      intervention: riskCounts.intervention,
      monitor: riskCounts.monitor,
      stable: riskCounts.stable,
      topIndicators,
      tclCount: tcl.length,
      m1Count: m1.length,
      pendingReview,
      needsCorrection,
      prenatal: m1Records.length,
      highRiskPregnancies: m1Records.filter((m) => m.risk === "High").length,
      prenatalFollowUps: m1Records.filter((m) => m.status === "Ongoing").length,
      childrenDue: new Set(immunizations.filter((i) => i.status === "Due").map((i) => i.child)).size,
      vaccinationsCompleted: immunizations.filter((i) => i.status === "Completed").length,
      missedVaccinations: new Set(immunizations.filter((i) => i.status === "Missed").map((i) => i.child)).size,
      coverageRate: vaccinationCoverage.length ? Math.round(vaccinationCoverage.reduce((a, b) => a + b.value, 0) / vaccinationCoverage.length) : 0,
      sessions: immunizationSessions.filter((s) => s.status === "Upcoming").length,
      totalReferrals: referrals.length,
      pendingReferrals: referrals.filter((r) => r.status === "Pending").length,
      receivedReferrals: referrals.filter((r) => r.status === "Received").length,
      completedReferrals: referrals.filter((r) => r.status === "Accepted" || r.status === "Completed").length,
      healthConditions: topDiseases.slice(0, 5),
    };
  }, [submissions, clusters, brgy, period]);

  const barangayRows = useMemo(
    () =>
      barangayOverview.map((b) => {
        const bcl = clusters.filter((c) => c.barangay === b.name);
        return {
          name: b.name,
          residents: b.residents,
          consultations: b.consultations || 94,
          referrals: referrals.length ? (b.name === "San Isidro" ? 4 : b.name === "San Antonio" ? 3 : 2) : 0,
          followUps: followUps.filter((f) => f.status === "Today" || f.status === "Upcoming").length,
          priority: bcl.filter((c) => c.risk?.level === RISK_LEVELS.PRIORITY).length,
        };
      }),
    [clusters]
  );

  const trendData = useMemo(() => {
    const base = monthlyConsultations.map((m) => ({ month: m.name || m.month, Consultations: m.value || m.consultations || 0 }));
    return base.map((m, i) => ({
      ...m,
      Referrals: [12, 15, 9, 18, 14, 11, 9, 13, 9, 16, 12, 14][i] || 10,
      "Follow-ups": [8, 11, 14, 9, 12, 10, 15, 9, 11, 13, 10, 12][i] || 10,
      "Household Visits": [6, 9, 7, 11, 8, 10, 6, 12, 9, 8, 10, 7][i] || 8,
    }));
  }, []);

  const needsAttention = useMemo(() => {
    const items = [];
    const incomplete = barangayRows.filter((b) => {
      const hasTcl = submissions.some((s) => s.type === "TCL" && s.barangay === b.name && s.period === period);
      const hasM1 = submissions.some((s) => s.type === "M1" && s.barangay === b.name && s.period === period);
      return !(hasTcl && hasM1);
    }).length;
    if (incomplete > 0) items.push({ label: `${incomplete} barangays have incomplete TCL/M1 submissions`, action: { label: "View Submissions", to: "/app/mho/submissions" } });
    if (derived.pendingReview > 0) items.push({ label: `${derived.pendingReview} submissions are pending review`, action: { label: "View Submissions", to: "/app/mho/submissions" } });
    if (derived.priority > 0) items.push({ label: `${derived.priority} households require Priority Review`, action: { label: "View Households", to: "/app/mho/households/risk-overview" } });
    if (derived.pendingReferrals > 0) items.push({ label: `${derived.pendingReferrals} referrals are pending`, action: { label: "View Referrals", to: "/app/mho/referrals" } });
    return items;
  }, [barangayRows, submissions, period, derived]);

  const recentActivity = useMemo(() => {
    const items = [];
    submissions.slice(0, 4).forEach((s) => items.push({ title: `${s.type} submitted by Barangay ${s.barangay}`, time: `${s.reference} · ${s.period}`, tag: "Submission" }));
    clusters.filter((c) => c.risk?.level === RISK_LEVELS.INTERVENTION || c.risk?.level === RISK_LEVELS.PRIORITY).slice(0, 2).forEach((c) => items.push({ title: `New household risk cluster — ${c.head} Household`, time: `Barangay ${c.barangay}`, tag: "Risk" }));
    recentHealthAlerts.slice(0, 2).forEach((a) => items.push({ title: a.msg || a.title, time: a.time, tag: a.level || "Alert" }));
    return items.slice(0, 6);
  }, [submissions, clusters, recentHealthAlerts]);

  const resetFilters = () => {
    setPeriod(DEFAULT_PERIOD);
    setBarangayFilter("All Barangays");
    setReportType("All Reports");
    setTrendMetric("Consultations");
  };

  const exportReport = (format) => {
    const scopeLabel = isAll ? "All Barangays" : brgy;
    showToast(`${format} export generated for ${period} · ${scopeLabel} · ${reportType}.`);
  };

  const generateReport = () => {
    const scopeLabel = isAll ? "All Barangays" : brgy;
    showToast(`Municipal report generated for ${period} · ${scopeLabel} · ${reportType}.`);
  };

  const filterCls = "rounded-btn border border-slate-200 dark:border-border bg-white dark:bg-input px-3 py-2.5 text-sm outline-none dark:text-foreground";

  // Loading skeleton
  if (phase === "loading") {
    return (
      <>
        <PageHeader crumbs={["Reports"]} title="Municipal Health Reports" subtitle="Monitor health activity, reporting completeness, risks, and early intervention across the municipality." />
        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-4 mb-6">
          {[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="h-28 animate-pulse rounded-2xl border border-slate-200 bg-slate-100" />)}
        </div>
        <div className="h-72 animate-pulse rounded-2xl border border-slate-200 bg-slate-100" />
      </>
    );
  }

  if (phase === "error") {
    return (
      <>
        <PageHeader crumbs={["Reports"]} title="Municipal Health Reports" subtitle="Monitor health activity, reporting completeness, risks, and early intervention across the municipality." />
        <Card className="p-10 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-brand-danger/10"><AlertTriangle className="h-7 w-7 text-brand-danger" /></div>
          <h3 className="mt-4 text-lg font-semibold text-brand-ink">Unable to Load Reports</h3>
          <p className="mt-1.5 text-sm text-brand-gray">We couldn't retrieve the latest municipal health data.</p>
          <button onClick={() => setPhase("ready")} className="mt-5 inline-flex items-center gap-2 rounded-btn bg-brand-blue px-5 py-2.5 text-sm font-medium text-white hover:bg-brand-dark"><RefreshCw className="h-4 w-4" /> Retry</button>
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        crumbs={["Reports"]}
        title="Municipal Health Reports"
        subtitle="Monitor health activity, reporting completeness, risks, and early intervention across the municipality."
        action={
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={() => exportReport("PDF")} className="inline-flex items-center gap-2 rounded-btn border border-brand-border bg-white px-3 py-2 text-xs font-medium text-brand-gray hover:bg-brand-bg dark:bg-card dark:hover:bg-hover"><Download className="h-3.5 w-3.5" /> Export PDF</button>
            <button onClick={() => exportReport("Excel")} className="inline-flex items-center gap-2 rounded-btn border border-brand-border bg-white px-3 py-2 text-xs font-medium text-brand-gray hover:bg-brand-bg dark:bg-card dark:hover:bg-hover"><FileSpreadsheet className="h-3.5 w-3.5" /> Export Excel</button>
            <button onClick={generateReport} className="inline-flex items-center gap-2 rounded-btn bg-brand-blue px-3 py-2 text-xs font-medium text-white hover:bg-brand-dark"><FileText className="h-3.5 w-3.5" /> Generate Report</button>
          </div>
        }
      />

      {toast && <div className="fixed bottom-4 right-4 z-[80] flex items-center gap-2 rounded-btn bg-brand-ink px-4 py-3 text-white shadow-lg"><span className="text-sm">{toast}</span></div>}

      {/* Filter bar — evenly sized, labeled, stacking on mobile */}
      <Card className="p-4 mb-6">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Filter label="Reporting Period" value={period} onChange={setPeriod} options={PERIODS} />
          <Filter label="Barangay" value={barangayFilter} onChange={setBarangayFilter} options={BARANGAY_OPTIONS} />
          <Filter label="Report Type" value={reportType} onChange={setReportType} options={REPORT_TYPES} />
          <div className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-brand-gray">&nbsp;</span>
            <button onClick={resetFilters} className="inline-flex h-[42px] items-center justify-center gap-1.5 rounded-btn border border-brand-border bg-white px-4 text-sm font-medium text-brand-gray hover:bg-brand-bg dark:bg-card dark:hover:bg-hover"><X className="h-4 w-4" /> Reset</button>
          </div>
        </div>
      </Card>

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4 mb-6">
        <Metric label="Registered Residents" value={derived.residents.toLocaleString()} icon={Users} tone="bg-brand-blue/10 text-brand-blue" to="/app/mho/households/risk-overview" />
        <Metric label="Households" value={derived.households} icon={HomeIcon} tone="bg-brand-accent/10 text-brand-accent" to="/app/mho/households/risk-overview" />
        <Metric label="Consultations" value={derived.consultations} icon={Stethoscope} tone="bg-brand-green/10 text-brand-green" />
        <Metric label="Referrals" value={derived.referrals} icon={Send} tone="bg-brand-yellow/15 text-[#B07E00]" to="/app/mho/referrals" />
        <Metric label="Active Follow-ups" value={derived.followUps} icon={CalendarClock} tone="bg-brand-accent/10 text-brand-accent" />
        <Metric label="Priority Households" value={derived.priority} icon={AlertTriangle} tone="bg-brand-danger/10 text-brand-danger" to="/app/mho/households/risk-overview" />
      </div>

      {/* Needs attention */}
      <Card className="p-5 mb-6">
        <SectionHeader title="Needs Attention" subtitle="Items requiring MHO review or follow-up." />
        {needsAttention.length === 0 ? (
          <p className="text-sm text-brand-gray">No items currently require attention.</p>
        ) : (
          <div className="space-y-2">
            {needsAttention.map((n, i) => (
              <div key={i} className="flex flex-wrap items-center justify-between gap-3 rounded-btn border border-slate-200 dark:border-border bg-white px-4 py-3">
                <p className="text-sm text-brand-ink">{n.label}</p>
                <Link to={n.action.to} className="inline-flex items-center gap-1 text-sm font-medium text-brand-blue hover:underline">{n.action.label} <ChevronRight className="h-3.5 w-3.5" /></Link>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Health activity trend */}
      {reportType === "All Reports" || reportType === "Health Activity" ? (
        <Card className="p-5 mb-6">
          <SectionHeader
            title="Municipal Health Activity"
            subtitle="Monthly activity across the municipality."
            action={
              <select value={trendMetric} onChange={(e) => setTrendMetric(e.target.value)} className={filterCls}>
                {TREND_METRICS.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            }
          />
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={trendData} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border, #D6DEE8)" />
                <XAxis dataKey="month" tick={{ fill: "var(--muted-foreground, #5B6B7C)", fontSize: 12 }} />
                <YAxis tick={{ fill: "var(--muted-foreground, #5B6B7C)", fontSize: 12 }} />
                <Tooltip contentStyle={{ background: "var(--popover, #fff)", border: "1px solid var(--border, #D6DEE8)", color: "var(--foreground, #10263f)", borderRadius: 8 }} labelStyle={{ color: "var(--foreground, #10263f)" }} />
                <Legend wrapperStyle={{ color: "var(--muted-foreground, #5B6B7C)", fontSize: 12 }} />
                <Bar dataKey={trendMetric} fill="#1B6EC2" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      ) : null}

      {/* Barangay health overview */}
      {reportType === "All Reports" || reportType === "Health Activity" ? (
        <Card className="p-5 mb-6">
          <SectionHeader title="Health Status by Barangay" subtitle="Residents, consultations, referrals, and follow-ups per barangay." />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] text-sm">
              <thead>
                <tr className="bg-brand-bg text-left">
                  <th className="px-4 py-2.5 font-medium text-brand-gray">Barangay</th>
                  <th className="px-4 py-2.5 font-medium text-brand-gray">Residents</th>
                  <th className="px-4 py-2.5 font-medium text-brand-gray">Consultations</th>
                  <th className="px-4 py-2.5 font-medium text-brand-gray">Referrals</th>
                  <th className="px-4 py-2.5 font-medium text-brand-gray">Follow-ups</th>
                  <th className="px-4 py-2.5 font-medium text-brand-gray">Priority</th>
                  <th className="px-4 py-2.5 font-medium text-brand-gray text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {barangayRows.map((b) => (
                  <tr key={b.name} className="hover:bg-brand-bg/50">
                    <td className="px-4 py-3 font-medium text-brand-ink">{b.name}</td>
                    <td className="px-4 py-3 text-brand-gray">{b.residents.toLocaleString()}</td>
                    <td className="px-4 py-3 text-brand-gray">{b.consultations}</td>
                    <td className="px-4 py-3 text-brand-gray">{b.referrals}</td>
                    <td className="px-4 py-3 text-brand-gray">{b.followUps}</td>
                    <td className="px-4 py-3"><span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-400"><span className="h-2 w-2 rounded-full bg-brand-danger" /> {b.priority}</span></td>
                    <td className="px-4 py-3 text-right">
                      <button onClick={() => { setBarangayFilter(b.name); setReportType("All Reports"); window.scrollTo({ top: 0, behavior: "smooth" }); }} className="inline-flex items-center gap-1 text-sm font-medium text-brand-blue hover:underline">View <ChevronRight className="h-3.5 w-3.5" /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}

      {/* TCL & M1 submission status */}
      {reportType === "All Reports" || reportType === "TCL" || reportType === "M1" ? (
        <Card className="p-5 mb-6">
          <SectionHeader title="Reporting Submission Status" subtitle={`TCL and M1 submissions for ${period}.`} action={<Link to="/app/mho/submissions" className="inline-flex items-center gap-1 text-sm font-medium text-brand-blue hover:underline">View Submissions <ChevronRight className="h-3.5 w-3.5" /></Link>} />
          <div className="space-y-4">
            {[["TCL", derived.tclCount], ["M1", derived.m1Count]].map(([label, count]) => {
              const pct = barangayRows.length ? Math.round((count / Math.max(barangayRows.length, 1)) * 100) : 0;
              return (
                <div key={label}>
                  <div className="flex items-center justify-between text-sm"><span className="text-brand-ink">{label}</span><span className="text-brand-gray">{count} / {barangayRows.length} barangays · {pct}%</span></div>
                  <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-slate-200"><div className="h-full rounded-full bg-brand-blue" style={{ width: `${pct}%` }} /></div>
                </div>
              );
            })}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
              <div className="rounded-btn bg-brand-bg/60 dark:bg-card-nested px-3 py-2.5"><p className="text-[11px] text-brand-gray uppercase tracking-wide">Pending Review</p><p className="text-lg font-semibold text-brand-ink">{derived.pendingReview}</p></div>
              <div className="rounded-btn bg-brand-bg/60 dark:bg-card-nested px-3 py-2.5"><p className="text-[11px] text-brand-gray uppercase tracking-wide">Needs Correction</p><p className="text-lg font-semibold text-brand-ink">{derived.needsCorrection}</p></div>
              <div className="rounded-btn bg-brand-bg/60 dark:bg-card-nested px-3 py-2.5"><p className="text-[11px] text-brand-gray uppercase tracking-wide">Missing</p><p className="text-lg font-semibold text-brand-ink">{Math.max(0, barangayRows.length * 2 - (derived.tclCount + derived.m1Count))}</p></div>
            </div>
          </div>
        </Card>
      ) : null}

      {/* Household risk & early intervention */}
      {reportType === "All Reports" || reportType === "Household Risk" ? (
        <Card className="p-5 mb-6">
          <SectionHeader title="Household Risk & Early Intervention" subtitle="Risk clusters from configured monitoring rules." action={<Link to="/app/mho/households/risk-overview" className="inline-flex items-center gap-1 text-sm font-medium text-brand-blue hover:underline">View Households <ChevronRight className="h-3.5 w-3.5" /></Link>} />
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 mb-4">
            {[
              { level: RISK_LEVELS.PRIORITY, label: "Priority Review", count: derived.priority },
              { level: RISK_LEVELS.INTERVENTION, label: "Needs Intervention", count: derived.intervention },
              { level: RISK_LEVELS.MONITOR, label: "Monitor", count: derived.monitor },
              { level: RISK_LEVELS.STABLE, label: "Stable", count: derived.stable },
            ].map((c) => (
              <div key={c.level} className="rounded-btn border border-slate-200 dark:border-border bg-white px-3 py-2.5">
                <p className="flex items-center gap-1.5 text-xs text-brand-gray"><span className={`h-2 w-2 rounded-full ${levelTone[c.level].dot}`} /> {c.label}</p>
                <p className="mt-0.5 text-xl font-semibold text-brand-ink">{c.count}</p>
              </div>
            ))}
          </div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-brand-gray">Top Risk Indicators</p>
          {derived.topIndicators.length > 0 ? (
            <div className="space-y-2">
              {derived.topIndicators.map(([label, val]) => {
                const max = derived.topIndicators[0][1] || 1;
                return (
                  <div key={label} className="flex items-center gap-3 text-sm">
                    <span className="w-56 min-w-0 truncate text-brand-ink">{label}</span>
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-200"><div className="h-full rounded-full bg-brand-accent" style={{ width: `${Math.max(6, (val / max) * 100)}%` }} /></div>
                    <span className="w-8 text-right font-semibold text-brand-ink">{val}</span>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-brand-gray">No risk indicators recorded.</p>
          )}
        </Card>
      ) : null}

      {/* Referrals + Immunization + Maternal */}
      {(reportType === "All Reports" || reportType === "Referrals" || reportType === "Immunization" || reportType === "Maternal & Child Health") ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 mb-6">
          {reportType === "All Reports" || reportType === "Referrals" ? (
            <Card className="p-5">
              <SectionHeader title="Referral Summary" action={<Link to="/app/mho/referrals" className="inline-flex items-center gap-1 text-sm font-medium text-brand-blue hover:underline">View <ChevronRight className="h-3.5 w-3.5" /></Link>} />
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: "Total Referrals", value: derived.totalReferrals },
                  { label: "Pending", value: derived.pendingReferrals },
                  { label: "Received", value: derived.receivedReferrals },
                  { label: "Completed", value: derived.completedReferrals },
                ].map((m) => (
                  <div key={m.label} className="rounded-btn bg-brand-bg/60 dark:bg-card-nested px-3 py-2.5">
                    <p className="text-[11px] text-brand-gray uppercase tracking-wide">{m.label}</p>
                    <p className="mt-0.5 text-lg font-semibold text-brand-ink">{m.value}</p>
                  </div>
                ))}
              </div>
            </Card>
          ) : null}

          {reportType === "All Reports" || reportType === "Immunization" ? (
            <Card className="p-5">
              <SectionHeader title="Immunization Monitoring" />
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-btn bg-brand-bg/60 dark:bg-card-nested px-3 py-2.5"><p className="text-[11px] text-brand-gray uppercase tracking-wide">Children Due</p><p className="mt-0.5 text-lg font-semibold text-brand-ink">{derived.childrenDue}</p></div>
                <div className="rounded-btn bg-brand-bg/60 dark:bg-card-nested px-3 py-2.5"><p className="text-[11px] text-brand-gray uppercase tracking-wide">Vaccinations Completed</p><p className="mt-0.5 text-lg font-semibold text-brand-ink">{derived.vaccinationsCompleted}</p></div>
                <div className="rounded-btn bg-brand-bg/60 dark:bg-card-nested px-3 py-2.5"><p className="text-[11px] text-brand-gray uppercase tracking-wide">Missed / Overdue</p><p className="mt-0.5 text-lg font-semibold text-brand-ink">{derived.missedVaccinations}</p></div>
                <div className="rounded-btn bg-brand-bg/60 dark:bg-card-nested px-3 py-2.5"><p className="text-[11px] text-brand-gray uppercase tracking-wide">Coverage Rate</p><p className="mt-0.5 text-lg font-semibold text-brand-ink">{derived.coverageRate}%</p></div>
              </div>
              <p className="mt-3 text-xs text-brand-gray">{derived.sessions} upcoming immunization sessions scheduled.</p>
            </Card>
          ) : null}

          {reportType === "All Reports" || reportType === "Maternal & Child Health" ? (
            <Card className="p-5">
              <SectionHeader title="Maternal & Child Health" />
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-btn bg-brand-bg/60 dark:bg-card-nested px-3 py-2.5"><p className="text-[11px] text-brand-gray uppercase tracking-wide">Prenatal Patients</p><p className="mt-0.5 text-lg font-semibold text-brand-ink">{derived.prenatal}</p></div>
                <div className="rounded-btn bg-brand-bg/60 dark:bg-card-nested px-3 py-2.5"><p className="text-[11px] text-brand-gray uppercase tracking-wide">High-Risk Pregnancies</p><p className="mt-0.5 text-lg font-semibold text-brand-ink">{derived.highRiskPregnancies}</p></div>
                <div className="rounded-btn bg-brand-bg/60 dark:bg-card-nested px-3 py-2.5"><p className="text-[11px] text-brand-gray uppercase tracking-wide">Active Prenatal Follow-ups</p><p className="mt-0.5 text-lg font-semibold text-brand-ink">{derived.prenatalFollowUps}</p></div>
                <div className="rounded-btn bg-brand-bg/60 dark:bg-card-nested px-3 py-2.5"><p className="text-[11px] text-brand-gray uppercase tracking-wide">Growth Monitoring</p><p className="mt-0.5 text-lg font-semibold text-brand-ink">{derived.childrenDue + derived.missedVaccinations}</p></div>
              </div>
            </Card>
          ) : null}
        </div>
      ) : null}

      {/* Top conditions + recent activity */}
      {reportType === "All Reports" ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card className="p-5">
            <SectionHeader title="Top Health Conditions" subtitle={`Most recorded conditions · ${period}`} />
            <div className="space-y-3">
              {derived.healthConditions.map((c) => {
                const maxVal = derived.healthConditions[0]?.value || derived.healthConditions[0]?.count || 1;
                return (
                  <div key={c.name || c.label}>
                    <div className="flex items-center justify-between text-sm"><span className="text-brand-ink">{c.name || c.label}</span><span className="text-brand-gray font-semibold">{c.count || c.value}</span></div>
                    <div className="mt-1.5 h-1.5 bg-slate-200 rounded-full overflow-hidden"><div className="h-full bg-brand-blue rounded-full" style={{ width: `${Math.max(6, ((c.count || c.value || 0) / maxVal) * 100)}%` }} /></div>
                  </div>
                );
              })}
            </div>
          </Card>

          <Card className="p-5">
            <SectionHeader title="Recent Municipal Activity" />
            <div className="space-y-1">
              {recentActivity.map((a, i) => (
                <div key={i} className="flex items-start gap-3 py-2.5 border-b border-brand-border last:border-0">
                  <span className="mt-0.5 inline-flex items-center gap-1 rounded-full bg-brand-light px-2 py-0.5 text-[11px] font-medium text-brand-blue dark:bg-brand-blue/15">{a.tag}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-brand-ink">{a.title}</p>
                    <p className="text-xs text-brand-gray">{a.time}</p>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      ) : null}
    </>
  );
}
