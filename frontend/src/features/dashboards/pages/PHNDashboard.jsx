import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";

import PageHeader from "@/components/common/PageHeader";
import { Card } from "@/components/common/Card";
import ErrorState from "@/components/common/ErrorState";
import EmptyState from "@/components/common/EmptyState";
import { Skeleton, SkeletonTable } from "@/components/common/Skeleton";
import { useAuth } from "@/context/AuthContext";
import { usePhnCoverage } from "@/context/PhnCoverageContext";
import { filterRowsByScope } from "@/lib/phnScope";
import { CHECKUP_STATUS } from "@/lib/phnWorkflowMap";
import { riskOfPatient } from "@/lib/riskRules";
import {
  countFollowUpsDue,
  countPendingReferrals,
  formatManilaLongDate,
  isPendingReferral,
  mapFollowUpRow,
  mapHighRiskResident,
  mapReferralRow,
  queueCounts,
  sortQueueByRisk,
} from "@/lib/phnDashboard";
import { usePhnDashboardData } from "@/features/dashboards/hooks/usePhnDashboardData";
import {
  Activity,
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  Clock,
  RefreshCw,
  Send,
  TrendingUp,
  UserPlus,
  Users,
} from "lucide-react";

/* --------------------------------- Styling -------------------------------- */

const KPI_TONES = {
  accent: "bg-brand-accent/10 text-brand-accent",
  blue: "bg-brand-blue/10 text-brand-blue",
  yellow: "bg-brand-yellow/15 text-[#B07E00]",
  danger: "bg-brand-danger/10 text-brand-danger",
  green: "bg-brand-green/10 text-brand-green",
};

const RISK_TONES = {
  High: "bg-brand-danger/10 text-brand-danger",
  Medium: "bg-brand-yellow/15 text-[#B07E00]",
  Low: "bg-brand-green/10 text-brand-green",
};

const FOLLOWUP_STATUS_TONES = {
  Overdue: "bg-brand-danger/10 text-brand-danger",
  Today: "bg-brand-accent/10 text-brand-accent",
  Scheduled: "bg-brand-blue/10 text-brand-blue",
  Upcoming: "bg-brand-gray/10 text-brand-gray",
  Ongoing: "bg-brand-blue/10 text-brand-blue",
  Missed: "bg-brand-danger/10 text-brand-danger",
  Completed: "bg-brand-green/10 text-brand-green",
  Cancelled: "bg-brand-gray/10 text-brand-gray",
  Rejected: "bg-brand-gray/10 text-brand-gray",
};

const REFERRAL_STATUS_TONES = {
  Pending: "bg-brand-yellow/15 text-[#B07E00]",
  Accepted: "bg-brand-blue/10 text-brand-blue",
  "In Progress": "bg-brand-accent/10 text-brand-accent",
  Completed: "bg-brand-green/10 text-brand-green",
  Cancelled: "bg-brand-gray/10 text-brand-gray",
};

const REFERRAL_PRIORITY_TONES = {
  High: "bg-brand-danger/10 text-brand-danger",
  Medium: "bg-brand-yellow/15 text-[#B07E00]",
  Low: "bg-brand-green/10 text-brand-green",
};

const QUICK_ACTIONS = [
  { icon: UserPlus, label: "PHN Check-ups", path: "/app/phn/consultations" },
  { icon: ClipboardList, label: "Review Referrals", path: "/app/phn/referrals" },
  { icon: CalendarClock, label: "View Follow-ups", path: "/app/phn/followups" },
  { icon: TrendingUp, label: "View Reports", path: "/app/phn/reports" },
];

const welcomeFor = (user) => {
  const first = (user?.name || "").trim().split(" ")[0];
  return first ? `Welcome, Nurse ${first}` : "Welcome, Nurse";
};

/* ------------------------------- Primitives ------------------------------- */

function Pill({ value, tones }) {
  const tone = tones[value] || "bg-slate-100 text-slate-600";
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${tone}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
      {value}
    </span>
  );
}

function SectionHeader({ title, subtitle, action = null, icon: Icon = null }) {
  return (
    <div className="mb-4 flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h3 className="text-sm font-semibold text-brand-ink sm:text-base">{title}</h3>
        {subtitle && <p className="mt-0.5 text-xs text-brand-gray">{subtitle}</p>}
      </div>
      {action ||
        (Icon ? <Icon className="h-4 w-4 shrink-0 text-brand-gray" strokeWidth={1.8} /> : null)}
    </div>
  );
}

/**
 * A compact, actionable priority indicator.
 *
 * Renders the real count only when its request succeeded. While loading it
 * shows a placeholder; on failure it shows an error affordance that retries the
 * exact failed request instead of a misleading zero.
 */
function KpiCard({ icon: Icon, label, value, hint, tone, loading, error, onClick, onRetry, index = 0 }) {
  const failed = Boolean(error);
  return (
    <motion.button
      type="button"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.04, duration: 0.3 }}
      onClick={failed ? onRetry : onClick}
      aria-label={failed ? `Retry loading ${label}` : `${label}: ${loading ? "loading" : value}`}
      className="flex flex-col rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-card transition-colors hover:border-brand-blue focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/40"
    >
      <div className="flex items-center justify-between gap-2">
        <span className={`flex h-9 w-9 items-center justify-center rounded-xl ${KPI_TONES[tone]}`}>
          <Icon className="h-[18px] w-[18px]" strokeWidth={1.9} />
        </span>
        {failed ? (
          <RefreshCw className="h-4 w-4 text-brand-danger" strokeWidth={1.9} />
        ) : (
          <ChevronRight className="h-4 w-4 text-slate-300" strokeWidth={1.9} />
        )}
      </div>

      {loading ? (
        <Skeleton className="mt-3 h-7 w-12" />
      ) : failed ? (
        <span className="mt-3 text-2xl font-stat font-extrabold text-slate-300">—</span>
      ) : (
        <span className="mt-3 text-2xl font-stat font-extrabold tracking-tight text-slate-900">{value}</span>
      )}

      <span className="mt-1 text-sm font-medium text-slate-700">{label}</span>
      {loading ? (
        <Skeleton className="mt-1 h-3 w-16" />
      ) : failed ? (
        <span className="mt-0.5 text-[11px] text-brand-danger">Couldn’t load — tap to retry</span>
      ) : hint ? (
        <span className="mt-0.5 text-[11px] text-brand-gray">{hint}</span>
      ) : null}
    </motion.button>
  );
}

/** A work section that always communicates loading, error (with retry) and empty. */
function WorkSection({ title, subtitle, icon, onViewAll, loading, error, onRetry, isEmpty, emptyText, children }) {
  return (
    <Card className="p-4 sm:p-5">
      <SectionHeader
        title={title}
        subtitle={subtitle}
        icon={icon}
        action={
          onViewAll ? (
            <button
              type="button"
              onClick={onViewAll}
              className="flex shrink-0 items-center gap-1 text-sm font-medium text-brand-blue hover:underline"
            >
              View all <ChevronRight className="h-4 w-4" />
            </button>
          ) : null
        }
      />

      {loading ? (
        <div className="space-y-2.5">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full rounded-btn" />
          ))}
        </div>
      ) : error ? (
        <ErrorState title="Couldn’t load this section" message={error} onRetry={onRetry} className="py-6" />
      ) : isEmpty ? (
        <p className="py-6 text-center text-sm text-brand-gray">{emptyText}</p>
      ) : (
        <div className="space-y-2.5">{children}</div>
      )}
    </Card>
  );
}

/* -------------------------------- Dashboard ------------------------------- */

export default function PHNDashboard() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { coverage } = usePhnCoverage();
  const { queue, followUps, referrals, residents } = usePhnDashboardData();

  const [toast, setToast] = useState(null);

  const showToast = (message) => {
    setToast(message);
    setTimeout(() => setToast(null), 3000);
  };

  const today = useMemo(() => formatManilaLongDate(), []);

  // Patients in the persistent RHU → PHN pipeline (municipality-scoped by the
  // backend; the PHN is RHU-based and not limited by residence barangay).
  const scopedPatients = useMemo(
    () => filterRowsByScope(queue.patients, user, coverage),
    [queue.patients, user, coverage]
  );
  const counts = useMemo(() => queueCounts(scopedPatients), [scopedPatients]);
  const waitingQueue = useMemo(
    () => sortQueueByRisk(scopedPatients.filter((p) => p.status === CHECKUP_STATUS.WAITING)),
    [scopedPatients]
  );

  const followUpRows = useMemo(() => followUps.rows.map(mapFollowUpRow), [followUps.rows]);
  const followUpsDue = useMemo(() => countFollowUpsDue(followUps.rows), [followUps.rows]);
  const followUpsOverdue = useMemo(
    () => followUpRows.filter((f) => f.isOverdue).length,
    [followUpRows]
  );
  const dueFollowUpList = useMemo(
    () =>
      followUpRows
        .filter((f) => f.isOverdue || f.isDueToday)
        .sort((a, b) => Number(b.isOverdue) - Number(a.isOverdue))
        .slice(0, 4),
    [followUpRows]
  );

  const referralRows = useMemo(() => referrals.rows.map(mapReferralRow), [referrals.rows]);
  const pendingReferrals = useMemo(() => countPendingReferrals(referrals.rows), [referrals.rows]);
  const pendingReferralList = useMemo(
    () =>
      referralRows
        .filter((r) => isPendingReferral({ status: r.status }))
        .sort((a, b) => {
          const rank = { High: 0, Medium: 1, Low: 2 };
          const diff = (rank[a.priority] ?? 1) - (rank[b.priority] ?? 1);
          return diff !== 0 ? diff : String(b.referralDate).localeCompare(String(a.referralDate));
        })
        .slice(0, 4),
    [referralRows]
  );

  const highRiskRows = useMemo(
    () => residents.rows.filter((r) => (r.riskLevel ?? r.risk_level) === "High").map(mapHighRiskResident),
    [residents.rows]
  );

  const handleStartCheckup = async (patient) => {
    try {
      await queue.startCheckup(patient.id);
      showToast("Check-up started.");
      navigate("/app/phn/consultations", { state: { openCheckup: patient.id } });
    } catch (err) {
      showToast(err?.message || "Could not start the check-up.");
    }
  };

  return (
    <>
      <PageHeader
        crumbs={["Dashboard"]}
        title={welcomeFor(user)}
        subtitle="Here are the patients and tasks that need your attention today."
        action={
          <div className="text-left md:text-right">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-brand-gray">Today</p>
            <p className="text-sm font-medium text-brand-ink">{today}</p>
          </div>
        }
      />

      {/* Four compact priority indicators */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <KpiCard
          index={0}
          icon={Users}
          tone="accent"
          label="Waiting for PHN"
          value={counts.waiting}
          hint="Completed triage — ready for consultation"
          loading={queue.loading}
          error={queue.error}
          onClick={() => navigate("/app/phn/consultations")}
          onRetry={queue.reload}
        />
        <KpiCard
          index={1}
          icon={CalendarClock}
          tone="blue"
          label="Follow-ups Due"
          value={followUpsDue}
          hint={followUpsOverdue > 0 ? `${followUpsOverdue} overdue` : "Due today or overdue"}
          loading={followUps.loading}
          error={followUps.error}
          onClick={() => navigate("/app/phn/followups")}
          onRetry={followUps.reload}
        />
        <KpiCard
          index={2}
          icon={Send}
          tone="yellow"
          label="Pending Referrals"
          value={pendingReferrals}
          hint="Pending, accepted or in progress"
          loading={referrals.loading}
          error={referrals.error}
          onClick={() => navigate("/app/phn/referrals")}
          onRetry={referrals.reload}
        />
        <KpiCard
          index={3}
          icon={AlertTriangle}
          tone="danger"
          label="High-Risk Cases"
          value={highRiskRows.length}
          hint="Requiring PHN review"
          loading={residents.loading}
          error={residents.error}
          onClick={() => navigate("/app/phn/residents")}
          onRetry={residents.reload}
        />
      </div>

      {/* Priority work queue */}
      <Card id="queue" className="mt-4 scroll-mt-24 p-4 sm:p-6 sm:mt-5">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-brand-ink sm:text-base">Patients for Check-up (RHU)</h3>
              {!queue.loading && !queue.error && (
                <span className="rounded-full bg-brand-accent/10 px-2.5 py-0.5 text-xs font-semibold text-brand-accent">
                  {counts.waiting} waiting
                </span>
              )}
            </div>
            <p className="mt-0.5 text-xs text-brand-gray">
              Patients who completed triage and are waiting for PHN consultation, highest risk first.
            </p>
          </div>
          <button
            type="button"
            onClick={() => navigate("/app/phn/consultations")}
            className="flex shrink-0 items-center gap-1 text-sm font-medium text-brand-blue hover:underline"
          >
            View full queue <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        {queue.loading ? (
          <SkeletonTable rows={4} cols={6} />
        ) : queue.error ? (
          <ErrorState
            title="Couldn’t load the check-up queue"
            message={queue.error}
            onRetry={queue.reload}
            className="py-8"
          />
        ) : waitingQueue.length === 0 ? (
          <EmptyState
            icon={Users}
            title="No patients are waiting for check-up"
            description="Patients appear here as soon as triage hands them off to the PHN."
          />
        ) : (
          <div className="overflow-x-auto -mx-1">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-brand-border bg-brand-bg text-left">
                  {["Patient", "Barangay", "Reason for Visit", "Risk", "Status", ""].map((h) => (
                    <th
                      key={h || "action"}
                      className="px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-brand-gray"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {waitingQueue.map((q) => {
                  const risk = riskOfPatient(q);
                  return (
                    <tr key={q.id} className="border-b border-brand-border last:border-0 hover:bg-brand-bg/50">
                      <td className="px-4 py-3">
                        <p className="font-medium text-brand-ink">{q.patient}</p>
                        <p className="text-xs text-brand-gray">
                          {[q.age && `${q.age} yrs`, q.sex].filter(Boolean).join(" · ")}
                        </p>
                      </td>
                      <td className="px-4 py-3 text-brand-ink">{q.barangay || "RHU"}</td>
                      <td className="px-4 py-3 text-brand-ink">{q.reason || q.triage?.chiefComplaint || "—"}</td>
                      <td className="px-4 py-3">
                        <Pill value={risk.level} tones={RISK_TONES} />
                      </td>
                      <td className="px-4 py-3">
                        <Pill value={q.status} tones={{}} />
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => handleStartCheckup(q)}
                          className="whitespace-nowrap text-sm font-medium text-brand-blue hover:underline"
                        >
                          Start Check-up
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Follow-ups + referrals requiring action */}
      <div className="mt-4 grid grid-cols-1 gap-4 sm:mt-5 lg:grid-cols-2 sm:gap-5">
        <WorkSection
          title="Follow-ups Requiring Attention"
          subtitle="Overdue and due-today follow-ups across the RHU."
          icon={CalendarClock}
          loading={followUps.loading}
          error={followUps.error}
          onRetry={followUps.reload}
          isEmpty={dueFollowUpList.length === 0}
          emptyText="No follow-ups are due or overdue."
          onViewAll={() => navigate("/app/phn/followups")}
        >
          {dueFollowUpList.map((f) => (
            <div key={f.id} className="flex items-center justify-between gap-3 rounded-btn border border-brand-border px-4 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-brand-ink">
                  {f.residentName}
                  {f.barangay && <span className="font-normal text-brand-gray"> · {f.barangay}</span>}
                </p>
                <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-brand-gray">
                  <Clock className="h-3 w-3 shrink-0" />
                  {f.scheduledDate || "No date"}
                  {f.scheduledTime ? ` · ${f.scheduledTime}` : ""} · {f.purpose}
                </p>
              </div>
              <Pill value={f.status} tones={FOLLOWUP_STATUS_TONES} />
            </div>
          ))}
        </WorkSection>

        <WorkSection
          title="Referrals Requiring Action"
          subtitle="Referrals still pending, accepted or in progress."
          icon={Send}
          loading={referrals.loading}
          error={referrals.error}
          onRetry={referrals.reload}
          isEmpty={pendingReferralList.length === 0}
          emptyText="No referrals require action."
          onViewAll={() => navigate("/app/phn/referrals")}
        >
          {pendingReferralList.map((r) => (
            <div key={r.id} className="flex items-center justify-between gap-3 rounded-btn border border-brand-border px-4 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-brand-ink">
                  {r.residentName}
                  {r.barangay && <span className="font-normal text-brand-gray"> · {r.barangay}</span>}
                </p>
                <p className="mt-0.5 truncate text-xs text-brand-gray">
                  {r.destinationFacility || "—"} · {r.reason || "No reason recorded"}
                </p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <Pill value={r.status} tones={REFERRAL_STATUS_TONES} />
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${REFERRAL_PRIORITY_TONES[r.priority] || REFERRAL_PRIORITY_TONES.Medium}`}>
                  {r.priority}
                </span>
              </div>
            </div>
          ))}
        </WorkSection>
      </div>

      {/* High-risk cases + check-up progress */}
      <div className="mt-4 grid grid-cols-1 gap-4 sm:mt-5 lg:grid-cols-3 sm:gap-5">
        <div className="lg:col-span-2">
          <WorkSection
            title="High-Risk Cases Requiring Review"
            subtitle="Residents classified High by the system's risk assessment."
            icon={AlertTriangle}
            loading={residents.loading}
            error={residents.error}
            onRetry={residents.reload}
            isEmpty={highRiskRows.length === 0}
            emptyText="No high-risk residents in your scope."
            onViewAll={() => navigate("/app/phn/residents")}
          >
            {highRiskRows.slice(0, 4).map((r) => (
              <div key={r.id} className="flex items-center justify-between gap-3 rounded-btn border border-brand-border px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-brand-ink">{r.name}</p>
                  <p className="mt-0.5 text-xs text-brand-gray">{r.barangay || "RHU"}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {r.riskScore != null && (
                    <span className="text-xs text-brand-gray">Score {r.riskScore}</span>
                  )}
                  <Pill value={r.riskLevel} tones={RISK_TONES} />
                </div>
              </div>
            ))}
          </WorkSection>
        </div>

        <Card className="p-4 sm:p-5">
          <SectionHeader title="Check-up Progress" subtitle="RHU activity today" icon={Activity} />
          <div className="space-y-2.5">
            {[
              { label: "Waiting for PHN", value: counts.waiting, tone: "text-brand-accent bg-brand-accent/10" },
              { label: "In Check-up", value: counts.inCheckup, tone: "text-brand-blue bg-brand-blue/10" },
              { label: "Completed Today", value: counts.completedToday, tone: "text-brand-green bg-brand-green/10" },
            ].map((row) => (
              <div
                key={row.label}
                className="flex items-center justify-between rounded-btn border border-brand-border bg-brand-bg/60 px-4 py-2.5"
              >
                <span className="text-sm text-brand-ink">{row.label}</span>
                {queue.loading ? (
                  <Skeleton className="h-6 w-8" />
                ) : queue.error ? (
                  <span className="text-sm font-semibold text-slate-300">—</span>
                ) : (
                  <span className={`rounded-full px-2.5 py-1 text-sm font-semibold ${row.tone}`}>{row.value}</span>
                )}
              </div>
            ))}
            {queue.error && (
              <button
                type="button"
                onClick={queue.reload}
                className="flex items-center gap-1.5 text-xs font-medium text-brand-danger hover:underline"
              >
                <RefreshCw className="h-3.5 w-3.5" /> Retry
              </button>
            )}
            <button
              type="button"
              onClick={() => navigate("/app/phn/consultations")}
              className="mt-1 text-sm font-medium text-brand-blue hover:underline"
            >
              Open PHN Check-ups
            </button>
          </div>
        </Card>
      </div>

      {/* Quick actions */}
      <div className="mt-4 grid grid-cols-2 gap-3 sm:mt-5 lg:grid-cols-4">
        {QUICK_ACTIONS.map((a) => (
          <button
            key={a.label}
            type="button"
            onClick={() => navigate(a.path)}
            className="flex items-center justify-center gap-2 rounded-btn border border-brand-border bg-white px-4 py-3 text-sm font-medium text-brand-ink transition-colors hover:border-brand-blue hover:bg-brand-light"
          >
            <a.icon className="h-4 w-4 text-brand-blue" /> {a.label}
          </button>
        ))}
      </div>

      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            className="fixed bottom-4 right-4 z-[60] flex items-center gap-2 rounded-btn bg-brand-ink px-4 py-3 shadow-lg"
          >
            <CheckCircle2 className="h-4 w-4 text-brand-green" />
            <span className="text-sm text-white">{toast}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
