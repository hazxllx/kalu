import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Map, Users, Stethoscope, Send, ShieldAlert, Activity, ClipboardList, ChevronRight, RefreshCw, AlertTriangle } from "lucide-react";
import PageHeader from "@/components/common/PageHeader";
import { Card } from "@/components/common/Card";
import { useMunicipalSubmissions } from "@/services/local/municipalSubmissionsStore";
import { referralsApi, followUpsApi } from "@/services/api";
import { fetchCommunityMap, fetchEarlyWarningData } from "@/services/api/earlyWarningApi";

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
 * Submission Status remains on the local municipal-submissions store: there is
 * no persisted backend equivalent for it yet (documented limitation), so it is
 * NOT fabricated as database-backed.
 */

const OPEN_REFERRAL_STATUSES = new Set(["Pending", "Accepted", "In Progress"]);
const todayIso = () => new Date().toISOString().slice(0, 10);
const isFollowUpDue = (f) =>
  !["Completed", "Cancelled"].includes(f.status) && f.scheduledDate && String(f.scheduledDate).slice(0, 10) <= todayIso();

const barangayOf = (row) => row?.resident?.barangay || "";

export default function MHODashboard() {
  const submissions = useMunicipalSubmissions();

  const [map, setMap] = useState(null);
  const [referrals, setReferrals] = useState([]);
  const [followUps, setFollowUps] = useState([]);
  const [earlyWarning, setEarlyWarning] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    setLoadError(null);
    return Promise.all([
      fetchCommunityMap(),
      referralsApi.list(),
      followUpsApi.list(),
      fetchEarlyWarningData(),
    ])
      .then(([mapRes, referralRes, followUpRes, ewRes]) => {
        setMap(mapRes || { barangays: [] });
        setReferrals((referralRes?.rows || []).map((r) => ({
          status: r.status,
          resident: r.resident,
        })));
        setFollowUps((followUpRes?.rows || []).map((f) => ({
          status: f.status,
          scheduledDate: f.scheduled_date,
          resident: f.resident,
        })));
        setEarlyWarning(ewRes || null);
      })
      .catch((err) => {
        // Never convert a backend failure into empty data.
        setLoadError(err?.message || "Unable to load municipal health data.");
        setMap(null);
        setReferrals([]);
        setFollowUps([]);
        setEarlyWarning(null);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const barangays = useMemo(() => map?.barangays || [], [map]);

  const stats = useMemo(() => {
    const totalResidents = barangays.reduce((sum, b) => sum + (b.residents || 0), 0);
    const highRisk = barangays.reduce((sum, b) => sum + (b.highRiskResidents || 0), 0);
    const pendingReferrals = referrals.filter((r) => OPEN_REFERRAL_STATUSES.has(r.status)).length;
    return {
      totalBarangays: barangays.length,
      totalResidents,
      consultationsThisMonth: earlyWarning?.summary?.consultationsThisMonth ?? 0,
      totalReferrals: referrals.length,
      pendingReferrals,
      overdueFollowUps: followUps.filter(isFollowUpDue).length,
      highRisk,
    };
  }, [barangays, referrals, followUps, earlyWarning]);

  const barangayRows = useMemo(() => barangays.map((b) => ({
    name: b.name,
    residents: b.residents || 0,
    highRisk: b.highRiskResidents || 0,
    pendingReferrals: referrals.filter((r) => barangayOf(r) === b.name && OPEN_REFERRAL_STATUSES.has(r.status)).length,
    overdueFollowUps: followUps.filter((f) => barangayOf(f) === b.name && isFollowUpDue(f)).length,
  })), [barangays, referrals, followUps]);

  const topConditions = useMemo(
    () => (earlyWarning?.diseaseDistribution || []).filter((c) => c.name !== "Others" && c.value > 0).slice(0, 5),
    [earlyWarning]
  );
  const maxCondition = topConditions.reduce((m, c) => Math.max(m, c.value), 0) || 1;

  // Submission Status has no persisted backend equivalent — kept local.
  const submissionStatus = useMemo(() => ({
    tclSubmitted: submissions.filter((s) => s.type === "TCL" && s.period === "September 2026").length,
    m1Submitted: submissions.filter((s) => s.type === "M1" && s.period === "September 2026").length,
    pending: submissions.filter((s) => s.reviewStatus === "Pending Review" || s.status === "Under Review").length,
    needsCorrection: submissions.filter((s) => s.reviewStatus === "Needs Correction" || s.reviewStatus === "Returned").length,
    totalBarangays: barangays.length,
  }), [submissions, barangays.length]);

  const dash = loading ? "…" : loadError ? "—" : undefined;
  const statCards = [
    { icon: Map, tone: "bg-brand-blue/10 text-brand-blue", label: "Total Barangays", value: dash ?? stats.totalBarangays },
    { icon: Users, tone: "bg-brand-accent/10 text-brand-accent", label: "Registered Residents", value: dash ?? stats.totalResidents },
    { icon: Stethoscope, tone: "bg-brand-green/10 text-brand-green", label: "Consultations (This Month)", value: dash ?? stats.consultationsThisMonth },
    { icon: Send, tone: "bg-brand-yellow/15 text-[#B07E00]", label: "Total Referrals", value: dash ?? stats.totalReferrals },
    { icon: ShieldAlert, tone: "bg-brand-danger/10 text-brand-danger", label: "High-Risk Residents", value: dash ?? stats.highRisk },
  ];

  return (
    <>
      <PageHeader crumbs={["Dashboard"]} title="Municipal Health Dashboard" subtitle="Municipality of Pili, Camarines Sur" />

      {loadError && (
        <Card className="mb-4 flex items-start justify-between gap-3 border-brand-danger/30 bg-brand-danger/5 p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-brand-danger" />
            <div>
              <p className="text-sm font-semibold text-brand-ink">Couldn't load municipal health data</p>
              <p className="mt-0.5 text-xs text-brand-gray">{loadError}</p>
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
          </motion.div>
        ))}
      </div>

      {/* Submission status — local municipal-submissions store (no persisted backend equivalent). */}
      <Link to="/app/mho/submissions" className="mt-6 mb-6 block rounded-2xl border border-slate-200 bg-white p-4 hover:border-brand-blue/40 transition-colors dark:border-border dark:bg-card">
        <div className="flex flex-wrap items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-blue/10 text-brand-blue">
            <ClipboardList className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-brand-ink">Submission Status</p>
            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-brand-gray">
              <span>TCL {submissionStatus.tclSubmitted} / {submissionStatus.totalBarangays} submitted</span>
              <span>M1 {submissionStatus.m1Submitted} / {submissionStatus.totalBarangays} submitted</span>
              <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-brand-yellow" /> {submissionStatus.pending} pending review</span>
              <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-brand-accent" /> {submissionStatus.needsCorrection} needs correction</span>
            </p>
          </div>
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
          {loading ? (
            <p className="text-sm text-brand-gray py-6 text-center">Loading barangay data…</p>
          ) : loadError ? (
            <p className="text-sm text-brand-danger py-6 text-center">{loadError}</p>
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
                      <td className="py-2.5 px-3 text-brand-ink">{b.pendingReferrals}</td>
                      <td className="py-2.5 pl-3 text-brand-ink">{b.overdueFollowUps}</td>
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
          {loading ? (
            <p className="text-sm text-brand-gray py-6 text-center">Loading…</p>
          ) : loadError ? (
            <p className="text-sm text-brand-danger py-6 text-center">Unavailable.</p>
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
