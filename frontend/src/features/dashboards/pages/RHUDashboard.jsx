import { useCallback, useEffect, useState } from "react";
import { Card } from "@/components/common/Card";
import { Activity, ArrowRight, Bell, CalendarDays, HeartPulse, RefreshCw, Stethoscope } from "lucide-react";
import { Link } from "react-router-dom";
import { notificationsApi } from "@/services/api";
import { phnWorkflowApi } from "@/services/api/phnWorkflow";

const QUICK_ACTIONS = [
  { icon: Stethoscope, label: "Open Triage", path: "/app/rhu_personnel/triage" },
  { icon: HeartPulse, label: "Health Programs", path: "/app/rhu_personnel/programs" },
  { icon: Bell, label: "View Notifications", path: "/app/rhu_personnel/notifications" },
];

const localDayStart = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  date.setHours(0, 0, 0, 0);
  return date.getTime();
};

const formatTime = (value) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Time unavailable"
    : date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
};

const rowsFrom = (result) => result?.rows || result || [];

export default function RHUDashboard() {
  const [data, setData] = useState({ visits: [], notifications: [] });
  const [errors, setErrors] = useState({ visits: null, notifications: null });
  const [loading, setLoading] = useState(true);

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    const [visitsResult, notificationsResult] = await Promise.allSettled([
      phnWorkflowApi.listMyIntake(),
      notificationsApi.list(),
    ]);

    setData((current) => ({
      visits: visitsResult.status === "fulfilled" ? visitsResult.value : current.visits,
      notifications: notificationsResult.status === "fulfilled"
        ? rowsFrom(notificationsResult.value)
        : current.notifications,
    }));
    setErrors({
      visits: visitsResult.status === "rejected" ? "Unable to load triage activity." : null,
      notifications: notificationsResult.status === "rejected" ? "Unable to load notifications." : null,
    });
    setLoading(false);
  }, []);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  const todayStart = localDayStart(new Date());
  const visitsToday = data.visits.filter((visit) => localDayStart(visit.visitDate) === todayStart);
  const unreadNotifications = data.notifications.filter((notification) => !notification.read_at);
  const recentNotifications = data.notifications.slice(0, 3);
  const todayActivity = [
    ...visitsToday.map((visit) => ({ kind: "Triage recorded", at: visit.visitDate })),
    ...data.notifications
      .filter((notification) => localDayStart(notification.created_at) === todayStart)
      .map((notification) => ({ kind: "Notification received", at: notification.created_at })),
  ].sort((left, right) => new Date(right.at).getTime() - new Date(left.at).getTime());
  const todayLabel = new Date().toLocaleDateString([], { weekday: "long", month: "long", day: "numeric", year: "numeric" });

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 border-b border-slate-200 pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase text-brand-blue">Municipal Rural Health Unit</p>
          <h1 className="mt-1 text-2xl font-semibold text-brand-ink">RHU Operations</h1>
          <p className="mt-1 text-sm text-brand-gray">Overview of today's RHU activities and pending tasks.</p>
        </div>
        <div className="flex items-center justify-between gap-3 sm:justify-end">
          <p className="text-sm text-brand-gray">{todayLabel}</p>
          <button
            type="button"
            onClick={loadDashboard}
            disabled={loading}
            aria-label="Refresh dashboard"
            title="Refresh dashboard"
            className="inline-flex h-9 w-9 items-center justify-center rounded-btn border border-slate-200 text-brand-gray transition-colors hover:border-brand-blue hover:text-brand-blue disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </header>
      <section aria-labelledby="summary-heading">
        <div className="mb-3 flex items-center justify-between">
          <h2 id="summary-heading" className="text-base font-semibold text-brand-ink">Operational Summary</h2>
          {loading && <span className="text-xs text-brand-gray">Updating…</span>}
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <SummaryCard icon={Activity} label="Today's Triage" value={errors.visits ? "—" : loading ? "…" : visitsToday.length} detail={errors.visits || "Visits recorded today"} />
          <SummaryCard icon={HeartPulse} label="Health Programs" value="—" detail="Program data unavailable" />
          <SummaryCard icon={Bell} label="Notifications" value={errors.notifications ? "—" : loading ? "…" : unreadNotifications.length} detail={errors.notifications || "Unread operational notifications"} />
          <SummaryCard icon={CalendarDays} label="Pending Tasks" value="—" detail="No RHU task feed is available" />
        </div>
      </section>

      <section aria-labelledby="quick-actions-heading">
        <h2 id="quick-actions-heading" className="mb-3 text-base font-semibold text-brand-ink">Quick Actions</h2>
        <div className="flex flex-wrap gap-2">
          {QUICK_ACTIONS.map((action) => (
            <Link key={action.label} to={action.path} className="inline-flex min-h-10 items-center gap-2 rounded-btn border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-brand-ink transition-colors hover:border-brand-blue hover:text-brand-blue focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue">
              <action.icon className="h-4 w-4 text-brand-blue" />
              {action.label}
              <ArrowRight className="h-3.5 w-3.5 text-brand-gray" />
            </Link>
          ))}
        </div>
      </section>

      <div className="grid items-start gap-5 xl:grid-cols-2">
        <section aria-labelledby="attention-heading">
          <h2 id="attention-heading" className="mb-3 text-base font-semibold text-brand-ink">Needs Attention</h2>
          <Card className="p-4">
            {errors.notifications ? (
              <LoadError message={errors.notifications} onRetry={loadDashboard} />
            ) : loading ? (
              <p className="text-sm text-brand-gray" aria-live="polite">Loading RHU actions…</p>
            ) : unreadNotifications.length > 0 ? (
              <ul className="divide-y divide-slate-100">
                {unreadNotifications.slice(0, 3).map((notification) => (
                  <li key={notification.id} className="flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0">
                    <span className="min-w-0 text-sm font-medium text-brand-ink">{notification.title || "Unread notification"}</span>
                    <span className="shrink-0 text-xs text-brand-gray">{formatTime(notification.created_at)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <div>
                <p className="text-sm font-semibold text-brand-ink">You're all caught up.</p>
                <p className="mt-1 text-sm text-brand-gray">No pending RHU actions at this time.</p>
              </div>
            )}
          </Card>
        </section>

        <section aria-labelledby="programs-heading">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 id="programs-heading" className="text-base font-semibold text-brand-ink">Health Programs</h2>
            <Link to="/app/rhu_personnel/programs" className="inline-flex items-center gap-1 text-sm font-medium text-brand-blue hover:underline">
              View Health Programs <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
          <Card className="p-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <ProgramMetric label="Active Programs" value="Not available" />
              <ProgramMetric label="Upcoming Activities" value="Not available" />
            </div>
            <div className="mt-4 border-t border-slate-100 pt-3">
              <p className="text-xs font-medium text-brand-gray">Recent Program Activity</p>
              <p className="mt-1 text-sm text-brand-ink">Program activity data is not available yet.</p>
            </div>
          </Card>
        </section>

        <section aria-labelledby="activity-heading">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 id="activity-heading" className="text-base font-semibold text-brand-ink">Today's Activity</h2>
            {errors.visits && <button type="button" onClick={loadDashboard} className="text-xs font-medium text-brand-blue hover:underline">Retry</button>}
          </div>
          <Card className="p-4">
            {loading ? (
              <p className="text-sm text-brand-gray" aria-live="polite">Loading today's activity…</p>
            ) : errors.visits ? (
              <LoadError message={errors.visits} onRetry={loadDashboard} />
            ) : todayActivity.length === 0 ? (
              <p className="text-sm text-brand-gray">No RHU activity recorded today.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {todayActivity.slice(0, 5).map((item, index) => (
                  <li key={`${item.kind}-${item.at}-${index}`} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                    <span className="flex min-w-0 items-center gap-2 text-sm text-brand-ink"><Activity className="h-4 w-4 shrink-0 text-brand-blue" />{item.kind}</span>
                    <time className="shrink-0 text-xs text-brand-gray">{formatTime(item.at)}</time>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </section>

        <section aria-labelledby="notifications-heading">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <h2 id="notifications-heading" className="text-base font-semibold text-brand-ink">Notifications</h2>
              <p className="mt-0.5 text-xs text-brand-gray">
                {errors.notifications ? "Unread count unavailable" : loading ? "Loading…" : `${unreadNotifications.length} unread`}
              </p>
            </div>
            <Link to="/app/rhu_personnel/notifications" className="inline-flex items-center gap-1 text-sm font-medium text-brand-blue hover:underline">
              View all <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
          <Card className="p-4">
            {errors.notifications ? (
              <LoadError message={errors.notifications} onRetry={loadDashboard} />
            ) : loading ? (
              <p className="text-sm text-brand-gray" aria-live="polite">Loading notifications…</p>
            ) : recentNotifications.length === 0 ? (
              <p className="text-sm text-brand-gray">No notifications yet.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {recentNotifications.map((notification) => (
                  <li key={notification.id} className="flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0">
                    <span className="flex min-w-0 items-start gap-2 text-sm text-brand-ink">
                      <Bell className="mt-0.5 h-4 w-4 shrink-0 text-brand-blue" />
                      <span className="min-w-0 break-words">{notification.title || "Operational notification"}</span>
                    </span>
                    <time className="shrink-0 text-xs text-brand-gray">{formatTime(notification.created_at)}</time>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </section>
      </div>
    </div>
  );
}

function SummaryCard({ icon: Icon, label, value, detail }) {
  return (
    <Card className="flex min-h-28 items-start gap-3 p-4">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-blue/10 text-brand-blue"><Icon className="h-4.5 w-4.5" /></span>
      <div className="min-w-0">
        <p className="text-xs font-medium text-brand-gray">{label}</p>
        <p className="mt-1 text-2xl font-semibold tabular-nums text-brand-ink">{value}</p>
        <p className="mt-0.5 break-words text-xs text-brand-gray">{detail}</p>
      </div>
    </Card>
  );
}

function ProgramMetric({ label, value }) {
  return (
    <div>
      <p className="text-xs text-brand-gray">{label}</p>
      <p className="mt-1 text-sm font-semibold text-brand-ink">{value}</p>
    </div>
  );
}

function LoadError({ message, onRetry }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2" role="alert">
      <p className="text-sm text-brand-gray">{message}</p>
      <button type="button" onClick={onRetry} className="text-sm font-medium text-brand-blue hover:underline">Try again</button>
    </div>
  );
}