import React, { useMemo, useState } from "react";
import PageHeader from "@/components/common/PageHeader";
import { Card } from "@/components/common/Card";
import { useAuth } from "@/context/AuthContext";
import { residentFollowUpsApi } from "@/services/api";
import { DayView, MonthView, ScheduleDetailModal, WeekView } from "../components/ScheduleCalendarViews";
import ScheduleStatusBadge, { ConfirmationBadge, STATUS_DOTS } from "../components/ScheduleStatusBadge";
import { dayLabel, formatTime, fromKey, groupByDay, monthLabel, toKey, weekLabel } from "../lib/scheduleDates";
import {
  Bell, CalendarDays, ChevronLeft, ChevronRight, ShieldAlert, Clock, MapPin, CheckCircle2, Ban, X,
} from "lucide-react";

const VIEWS = [
  { key: "month", label: "Month" },
  { key: "week", label: "Week" },
  { key: "day", label: "Day" },
];

/** Statuses that still require the resident to attend/prepare. */
const UPCOMING_STATUSES = ["Scheduled", "Pending"];

/** Resident-safe follow-up (camelCase from the API) → calendar schedule shape. */
const mapToSchedule = (row) => ({
  id: row.id,
  date: row.scheduledDate || "",
  time: row.scheduledTime || "",
  location: row.location || "",
  provider: row.assignedProvider || "",
  instructions: row.instructions || "",
  purpose: row.purpose || "",
  status: row.status || "Scheduled",
  confirmationStatus: row.confirmationStatus || (row.requiresResidentResponse ? "Awaiting Confirmation" : null),
  respondedAt: row.respondedAt || "",
  rejectionReason: row.rejectionReason || "",
  requiresResidentResponse: row.requiresResidentResponse,
});

export default function ResidentFollowUpCalendar() {
  const { user } = useAuth();
  const [schedules, setSchedules] = useState([]);
  const [loaded, setLoaded] = useState(false);

  const reload = React.useCallback(
    () => residentFollowUpsApi
      .list()
      .then((result) => setSchedules((result?.rows || []).map(mapToSchedule)))
      .catch(() => setSchedules([]))
      .finally(() => setLoaded(true)),
    []
  );
  React.useEffect(() => { reload(); }, [reload]);

  // Both verified residents and pending (resident-limited) accounts may view and
  // respond to their own follow-ups. The resident-safe API already returns only
  // the signed-in resident's records, so no client-side owner filtering is done.
  if (user?.role !== "resident" && user?.role !== "resident-limited") {
    return (
      <>
        <PageHeader crumbs={["Follow-ups", "Schedule Calendar"]} title="My Follow-up Calendar" subtitle="Your scheduled follow-up activities." />
        <Card className="p-10 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-brand-danger/10">
            <ShieldAlert className="h-7 w-7 text-brand-danger" />
          </div>
          <h3 className="mt-4 text-lg font-semibold text-brand-ink">Unauthorized</h3>
          <p className="mx-auto mt-1.5 max-w-md text-sm text-brand-gray">
            Only residents can access the follow-up schedule calendar.
          </p>
        </Card>
      </>
    );
  }

  return <ResidentCalendarContent schedules={schedules} loaded={loaded} reload={reload} />;
}

function ResidentCalendarContent({ schedules, loaded, reload }) {
  const [view, setView] = useState("month");
  const [cursor, setCursor] = useState(() => new Date());
  const [selected, setSelected] = useState(null); // schedule id (detail modal)
  const [confirmTarget, setConfirmTarget] = useState(null); // schedule id
  const [rejectTarget, setRejectTarget] = useState(null); // schedule id
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState(null);

  const today = new Date();
  const todayKey = toKey(today);

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3200);
  };

  const approve = async (id) => {
    setBusy(true);
    try { await residentFollowUpsApi.approve(id); setConfirmTarget(null); setSelected(null); await reload(); showToast("Follow-up confirmed — see you at your appointment."); }
    catch (err) { showToast(err?.message || "Could not confirm the follow-up."); }
    finally { setBusy(false); }
  };
  const reject = async (id, reason) => {
    setBusy(true);
    try { await residentFollowUpsApi.reject(id, reason); setRejectTarget(null); setSelected(null); await reload(); showToast("Follow-up rejected — the health team has been notified."); }
    catch (err) { showToast(err?.message || "Could not reject the follow-up."); }
    finally { setBusy(false); }
  };

  /**
   * A schedule is confirmable/rejectable only while the follow-up itself is
   * still actionable (Scheduled/Pending) AND the resident has not responded
   * yet. Date, time, location, provider, and instructions are never editable.
   */
  const isActionable = (s) =>
    ["Scheduled", "Pending"].includes(s.status) &&
    (s.confirmationStatus || "Awaiting Confirmation") === "Awaiting Confirmation" &&
    s.requiresResidentResponse;

  const byDay = useMemo(() => groupByDay(schedules), [schedules]);

  /** Upcoming appointments (reminders): Scheduled/Pending from today onward. */
  const upcoming = useMemo(
    () =>
      schedules
        .filter((s) => UPCOMING_STATUSES.includes(s.status) && s.date >= todayKey)
        .sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`))
        .slice(0, 3),
    [schedules, todayKey]
  );

  /** Compact status counts so upcoming/completed/missed/cancelled are clear. */
  const counts = useMemo(() => {
    const c = { upcoming: 0, completed: 0, missed: 0, cancelled: 0 };
    schedules.forEach((s) => {
      if (s.status === "Completed") c.completed += 1;
      else if (s.status === "Missed") c.missed += 1;
      else if (s.status === "Cancelled") c.cancelled += 1;
      else c.upcoming += 1;
    });
    return c;
  }, [schedules]);

  const step = (dir) => {
    const d = new Date(cursor);
    if (view === "month") d.setMonth(d.getMonth() + dir);
    else if (view === "week") d.setDate(d.getDate() + 7 * dir);
    else d.setDate(d.getDate() + dir);
    setCursor(d);
  };

  const periodLabel =
    view === "month" ? monthLabel(cursor) : view === "week" ? weekLabel(cursor) : dayLabel(cursor);

  const selectedSchedule = selected ? schedules.find((s) => s.id === selected) : null;

  /* --------------------------- Empty state --------------------------- */
  if (loaded && schedules.length === 0) {
    return (
      <>
        <PageHeader
          crumbs={["Follow-ups", "Schedule Calendar"]}
          title="My Follow-up Calendar"
          subtitle="Your scheduled follow-up activities from the barangay health team."
        />
        <Card className="p-10 text-center">
          <CalendarDays className="mx-auto h-12 w-12 text-brand-gray/50" />
          <p className="mt-4 text-base font-semibold text-brand-ink">No Scheduled Follow-ups Yet</p>
          <p className="mx-auto mt-1.5 max-w-md text-sm text-brand-gray">
            When the Health Supervisor schedules a follow-up for you, it will appear here with its date,
            time, location, and instructions.
          </p>
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        crumbs={["Follow-ups", "Schedule Calendar"]}
        title="My Follow-up Calendar"
        subtitle="Your scheduled follow-up activities from the barangay health team."
      />

      {/* Upcoming follow-up summary (reminders) */}
      <Card className="p-5 mb-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-brand-ink sm:text-base">
            <Bell className="h-4 w-4 text-brand-blue" /> Upcoming Follow-ups
          </h3>
          {/* Status counts — upcoming / completed / missed / cancelled */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-brand-gray">
            <span className="inline-flex items-center gap-1.5"><span className={`h-2 w-2 rounded-full ${STATUS_DOTS.Scheduled}`} /> {counts.upcoming} upcoming</span>
            <span className="inline-flex items-center gap-1.5"><span className={`h-2 w-2 rounded-full ${STATUS_DOTS.Completed}`} /> {counts.completed} completed</span>
            <span className="inline-flex items-center gap-1.5"><span className={`h-2 w-2 rounded-full ${STATUS_DOTS.Missed}`} /> {counts.missed} missed</span>
            <span className="inline-flex items-center gap-1.5"><span className={`h-2 w-2 rounded-full ${STATUS_DOTS.Cancelled}`} /> {counts.cancelled} cancelled</span>
          </div>
        </div>

        {upcoming.length === 0 ? (
          <p className="py-4 text-center text-sm text-brand-gray">No upcoming follow-up appointments. You're all caught up.</p>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {upcoming.map((s) => {
              const isToday = s.date === todayKey;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setSelected(s.id)}
                  className={`rounded-2xl border p-4 text-left transition-colors hover:border-brand-blue ${
                    isToday ? "border-brand-blue/40 bg-brand-blue/5 dark:bg-brand-blue/10" : "border-slate-200 bg-white dark:border-border dark:bg-card"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-brand-gray">
                        {isToday ? "Today" : fromKey(s.date).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })}
                      </p>
                      <p className="mt-0.5 flex items-center gap-1.5 text-base font-semibold text-brand-ink">
                        <Clock className="h-4 w-4 text-brand-blue" /> {formatTime(s.time)}
                      </p>
                    </div>
                    <ScheduleStatusBadge value={s.status} />
                  </div>
                  <p className="mt-2 flex items-center gap-1.5 text-xs text-brand-gray">
                    <MapPin className="h-3.5 w-3.5 shrink-0" /> {s.location}
                  </p>
                  <p className="mt-1 truncate text-xs text-brand-gray">with {s.provider}</p>
                  <div className="mt-2">
                    <ConfirmationBadge value={s.confirmationStatus || "Awaiting Confirmation"} />
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </Card>

      {/* Calendar controls */}
      <Card className="p-4 mb-5">
        <div className="flex flex-wrap items-center gap-3">
          <div className="inline-flex rounded-btn border border-slate-200 bg-white p-0.5 dark:border-border dark:bg-card">
            {VIEWS.map((v) => (
              <button
                key={v.key}
                onClick={() => setView(v.key)}
                className={`rounded-btn px-3.5 py-2 text-sm font-medium transition-colors ${
                  view === v.key ? "bg-brand-blue text-white" : "text-brand-gray hover:text-brand-ink"
                }`}
              >
                {v.label}
              </button>
            ))}
          </div>
          <div className="inline-flex items-center gap-1">
            <button onClick={() => step(-1)} aria-label="Previous period" className="flex h-9 w-9 items-center justify-center rounded-btn border border-slate-200 bg-white text-brand-gray hover:bg-brand-bg dark:border-border dark:bg-card dark:hover:bg-hover">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              onClick={() => setCursor(new Date())}
              className="rounded-btn border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium text-brand-gray hover:bg-brand-bg dark:border-border dark:bg-card dark:hover:bg-hover"
            >
              Today
            </button>
            <button onClick={() => step(1)} aria-label="Next period" className="flex h-9 w-9 items-center justify-center rounded-btn border border-slate-200 bg-white text-brand-gray hover:bg-brand-bg dark:border-border dark:bg-card dark:hover:bg-hover">
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
          <p className="min-w-0 flex-1 truncate text-sm font-semibold text-brand-ink sm:text-center">{periodLabel}</p>
        </div>
      </Card>

      {/* Calendar view — read-only; events open the details modal */}
      {view === "month" ? (
        <MonthView cursor={cursor} today={today} byDay={byDay} variant="resident" onOpenEvent={setSelected} onSelectDay={(d) => { setCursor(d); setView("day"); }} />
      ) : view === "week" ? (
        <WeekView cursor={cursor} today={today} byDay={byDay} variant="resident" onOpenEvent={setSelected} onSelectDay={(d) => { setCursor(d); setView("day"); }} />
      ) : (
        <DayView cursor={cursor} byDay={byDay} variant="resident" onOpenEvent={setSelected} />
      )}

      {/* Read-only details — residents confirm or reject but never edit the
          appointment itself (date/time/location/provider/instructions). */}
      {selectedSchedule && (
        <ScheduleDetailModal
          schedule={selectedSchedule}
          variant="resident"
          onClose={() => setSelected(null)}
          actions={
            isActionable(selectedSchedule) ? (
              <>
                <button
                  onClick={() => { setConfirmTarget(selectedSchedule.id); setSelected(null); }}
                  className="inline-flex items-center gap-1.5 rounded-btn bg-brand-blue px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark"
                >
                  <CheckCircle2 className="h-4 w-4" /> Confirm Follow-up
                </button>
                <button
                  onClick={() => { setRejectTarget(selectedSchedule.id); setSelected(null); }}
                  className="inline-flex items-center gap-1.5 rounded-btn border border-brand-danger/30 bg-white px-4 py-2 text-sm font-medium text-brand-danger hover:bg-brand-danger/5 dark:bg-card"
                >
                  <Ban className="h-4 w-4" /> Reject Follow-up
                </button>
              </>
            ) : null
          }
        />
      )}

      {/* Confirm dialog */}
      {confirmTarget && (() => {
        const s = schedules.find((x) => x.id === confirmTarget);
        if (!s) return null;
        return (
          <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4">
            <Card className="w-full max-w-md">
              <div className="p-6">
                <h3 className="text-lg font-semibold text-brand-ink">Confirm Follow-up</h3>
                <p className="mt-2 text-sm leading-relaxed text-brand-gray">
                  Confirm that you will attend the scheduled follow-up on{" "}
                  <span className="font-medium text-brand-ink">
                    {fromKey(s.date).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
                  </span>{" "}
                  at <span className="font-medium text-brand-ink">{formatTime(s.time)}</span> ({s.location})?
                </p>
                <p className="mt-2 text-xs text-brand-gray">
                  The barangay health team will be notified of your confirmation.
                </p>
                <div className="mt-6 flex justify-end gap-3 border-t border-slate-200 pt-4 dark:border-border">
                  <button onClick={() => setConfirmTarget(null)} className="rounded-btn px-4 py-2 text-sm font-medium text-brand-gray hover:bg-brand-bg dark:hover:bg-hover">Cancel</button>
                  <button
                    disabled={busy}
                    onClick={() => approve(s.id)}
                    className="inline-flex items-center gap-1.5 rounded-btn bg-brand-blue px-5 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-60"
                  >
                    <CheckCircle2 className="h-4 w-4" /> Yes, I will attend
                  </button>
                </div>
              </div>
            </Card>
          </div>
        );
      })()}

      {/* Reject modal — reason is required */}
      {rejectTarget && (() => {
        const s = schedules.find((x) => x.id === rejectTarget);
        if (!s) return null;
        return (
          <RejectModal
            schedule={s}
            busy={busy}
            onClose={() => setRejectTarget(null)}
            onSubmit={(reason) => reject(s.id, reason)}
          />
        );
      })()}

      {toast && (
        <div className="fixed bottom-4 right-4 z-[90] flex items-center gap-2 rounded-btn bg-brand-ink px-4 py-3 text-white shadow-lg">
          <CheckCircle2 className="h-4 w-4 text-brand-green" />
          <span className="text-sm">{toast}</span>
        </div>
      )}
    </>
  );
}

/** Rejection modal: requires a reason before the schedule can be rejected. */
function RejectModal({ schedule, busy, onClose, onSubmit }) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");

  const handleSubmit = () => {
    if (!reason.trim()) {
      setError("Please provide a reason for rejecting the follow-up.");
      return;
    }
    onSubmit(reason.trim());
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4">
      <Card className="w-full max-w-md">
        <div className="p-6">
          <div className="mb-1 flex items-start justify-between gap-3">
            <div>
              <h3 className="text-lg font-semibold text-brand-ink">Reject Follow-up</h3>
              <p className="mt-0.5 text-sm text-brand-gray">
                {fromKey(schedule.date).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })} · {formatTime(schedule.time)} · {schedule.location}
              </p>
            </div>
            <button onClick={onClose} className="text-brand-gray hover:text-brand-ink" aria-label="Close">
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="mt-4">
            <label className="text-sm font-medium text-brand-ink">
              Reason for rejecting the follow-up schedule <span className="text-brand-danger">*</span>
            </label>
            <textarea
              rows={4}
              value={reason}
              onChange={(e) => { setReason(e.target.value); if (error) setError(""); }}
              placeholder="Please explain why you cannot attend the scheduled follow-up."
              className={`mt-1.5 w-full resize-none rounded-btn border bg-white px-3.5 py-2.5 text-sm outline-none transition-colors focus:border-brand-blue dark:bg-input dark:text-foreground ${
                error ? "border-brand-danger" : "border-slate-200 dark:border-border"
              }`}
            />
            {error && <p className="mt-1 text-xs text-brand-danger">{error}</p>}
          </div>

          <div className="mt-6 flex justify-end gap-3 border-t border-slate-200 pt-4 dark:border-border">
            <button onClick={onClose} className="rounded-btn px-4 py-2 text-sm font-medium text-brand-gray hover:bg-brand-bg dark:hover:bg-hover">Cancel</button>
            <button
              onClick={handleSubmit}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-btn bg-brand-danger px-5 py-2 text-sm font-medium text-white hover:bg-brand-danger/90 disabled:opacity-60"
            >
              <Ban className="h-4 w-4" /> Reject Follow-up
            </button>
          </div>
        </div>
      </Card>
    </div>
  );
}
