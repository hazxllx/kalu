import React from "react";
import { Card } from "@/components/common/Card";
import EmptyState from "@/components/common/EmptyState";
import { CalendarDays, Check, Clock, MapPin, User, X } from "lucide-react";
import { buildMonthGrid, calendarEventKey, formatCalendarStatus, parseCalendarDate, toDateKey } from "@/features/dashboards/components/scheduleCalendarUtils";
import ScheduleStatusBadge, { ConfirmationBadge, STATUS_DOTS, STATUS_TONES } from "./ScheduleStatusBadge";
import { formatDateTime, formatTime, fromKey, monthGrid, sameDay, toKey, weekDays } from "../lib/scheduleDates";

/**
 * Shared calendar views for the follow-up schedule feature.
 *
 * Used by BOTH the Health Supervisor calendar and the Resident calendar so the
 * two roles use the same date grouping. Each page supplies its authorized
 * API/offline records; presentation="supervisor" opts into the mixed-source,
 * compact calendar without changing resident callers.
 *
 *   variant="supervisor" → events are labelled with the resident's name
 *   variant="resident"   → events are labelled with the follow-up time
 *
 * All views are read-only presentations; the parent page owns what happens
 * when an event is opened (`onOpenEvent`) or a day is selected (`onSelectDay`).
 */

const WEEKDAY_HEADERS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const AGENDA_PAGE_SIZE = 25;
const activityTime = (event) => event.time ? formatTime(event.time) : "Time not specified";

/** Restrained category indicator colors, kept consistent across every view. */
const CATEGORY_DOT = (event) => {
  if (event.type === "follow-up") return "bg-brand-blue";
  if (event.type === "health-service") {
    const category = String(event.category || "").toLowerCase();
    if (category.includes("consult")) return "bg-brand-sky";
    return "bg-brand-green";
  }
  return "bg-brand-gray";
};
const CATEGORY_LABEL = (event) => {
  if (event.type === "follow-up") return "Follow-up";
  if (event.type === "health-service") return event.category || "Health service";
  return "Activity";
};
const MAX_MONTH_INDICATORS = 3;

/** Compact single-line event indicator: a category dot + short label. */
function EventIndicator({ event, onOpenEvent, variant = "supervisor", preview = false }) {
  const label = variant === "supervisor" ? event.residentName || event.label : event.label;
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onOpenEvent(calendarEventKey(event)); }}
      className="flex w-full min-w-0 items-center gap-1.5 truncate rounded px-1 py-[3px] text-left hover:bg-brand-bg focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-blue"
      aria-label={`${event.typeLabel}: ${event.label}. ${activityTime(event)}. Category: ${CATEGORY_LABEL(event)}. Status: ${formatCalendarStatus(event.status)}.`}
      title={`${event.label} · ${event.residentName || ""} · ${activityTime(event)} · ${formatCalendarStatus(event.status)}`}
    >
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${CATEGORY_DOT(event)}`} aria-hidden="true" />
      <span className="truncate text-caption text-brand-ink">{label}</span>
      {preview && <span className="ml-auto shrink-0 text-[10px] font-medium text-brand-gold" aria-label="Preview sample">· preview</span>}
    </button>
  );
}

function ActivityPagination({ page, total, pageSize, onChange }) {
  const pages = Math.ceil(total / pageSize);
  if (pages <= 1) return null;
  return (
    <nav aria-label="Activity pages" className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-brand-border pt-3">
      <span className="text-caption text-brand-gray">{page * pageSize + 1}-{Math.min((page + 1) * pageSize, total)} of {total} activities</span>
      <div className="flex items-center gap-2">
        <button type="button" className="supervisor-button" disabled={page === 0} onClick={() => onChange(page - 1)} aria-label="Previous activity page">Previous</button>
        <span className="text-caption text-brand-gray">{page + 1} / {pages}</span>
        <button type="button" className="supervisor-button" disabled={page + 1 >= pages} onClick={() => onChange(page + 1)} aria-label="Next activity page">Next</button>
      </div>
    </nav>
  );
}

function ActivityEmpty({ loading, incomplete, title }) {
  return loading ? <p role="status" className="py-3 text-ui text-brand-gray">Loading activities...</p> : (
    <EmptyState
      compact
      title={incomplete ? "Activity list is incomplete" : title}
      description={incomplete ? "A source is unavailable or showing device records. Retry above to verify this date." : "No activities match this date and the current filters."}
    />
  );
}

/* Clean single-row activity entry used by the selected-day panel and agenda.
   Supervisor layout: time — resident name on the primary line, with the
   activity description and provider · status below. */
function ScheduleRow({ event, onOpenEvent }) {
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpenEvent(calendarEventKey(event))}
        className="flex w-full min-w-0 items-start gap-3 px-3 py-2.5 text-left hover:bg-brand-bg focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-blue"
        aria-label={`${event.typeLabel}: ${event.residentName || event.label}. ${event.label}. ${activityTime(event)}. Provider: ${event.provider || "Not recorded"}. Status: ${formatCalendarStatus(event.status)}.`}
      >
        <span className="w-20 shrink-0 pt-0.5 text-caption text-brand-gray">{activityTime(event)}</span>
        <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${CATEGORY_DOT(event)}`} aria-hidden="true" />
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5">
            <span className="truncate text-ui font-medium text-brand-ink">{event.residentName || event.label}</span>
            {event.preview && <span className="shrink-0 text-[10px] font-medium text-brand-gold" aria-label="Preview sample">preview</span>}
          </span>
          <span className="mt-0.5 block truncate text-caption text-brand-gray">{event.label}</span>
          <span className="mt-0.5 block truncate text-caption text-brand-gray">
            {event.provider ? `Provider: ${event.provider}` : "Provider: Not recorded"}
            <span className="mx-1.5 text-brand-border" aria-hidden="true">·</span>
            {formatCalendarStatus(event.status)}
          </span>
        </span>
        <span className="mt-0.5 hidden shrink-0 text-caption font-medium text-brand-blue sm:block">View</span>
      </button>
    </li>
  );
}

/** Compact vertical list (no grouping) for the selected-day panel. */
function ScheduleRowList({ events, onOpenEvent, emptyTitle = "No activities for this day" }) {
  if (!events.length) {
    return <p className="px-3 py-6 text-center text-ui text-brand-gray">{emptyTitle}</p>;
  }
  return (
    <ul className="divide-y divide-brand-border">
      {events.map((event) => <ScheduleRow key={calendarEventKey(event)} event={event} onOpenEvent={onOpenEvent} />)}
    </ul>
  );
}

const eventTitle = (s, variant) =>
  variant === "resident" ? formatTime(s.time) : s.residentName;

const eventSubtitle = (s, variant) =>
  variant === "resident" ? `${s.location} · ${s.provider}` : `${formatTime(s.time)} · ${s.provider}`;

/** Month-chip tone: awaiting-response gold, rejected red, else the status tone. */
const chipTone = (s) => {
  if (s.confirmationStatus === "Rejected")
    return "bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-400";
  if (s.confirmationStatus === "Awaiting Confirmation")
    return "bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400";
  return STATUS_TONES[s.status] || STATUS_TONES.Scheduled;
};

/* --------------------------------- Month --------------------------------- */

export function MonthView({ cursor, today, byDay, variant = "supervisor", presentation = "default", selectedDay = null, onOpenEvent, onSelectDay }) {
  if (presentation === "supervisor") {
    const selectedKey = toDateKey(selectedDay);
    return (
      <section className="supervisor-panel" aria-label="Month calendar">
        <div className="grid grid-cols-7 border-b border-brand-border bg-brand-bg">
          {WEEKDAY_HEADERS.map((day) => <p key={day} className="py-2 text-center text-caption font-medium text-brand-gray">{day}</p>)}
        </div>
        <div className="grid grid-cols-7">
          {buildMonthGrid(cursor).flat().map((day) => {
            const key = toDateKey(day);
            const list = byDay[key] || [];
            const inMonth = day.getMonth() === cursor.getMonth();
            const isToday = key === toDateKey(today);
            const selected = key === selectedKey;
            const hidden = Math.max(0, list.length - MAX_MONTH_INDICATORS);
            return (
              <div key={key} className={`flex h-28 min-w-0 flex-col overflow-hidden border-b border-r border-brand-border p-1 sm:h-32 ${!inMonth ? "bg-brand-bg/60" : ""} ${isToday && !selected ? "bg-brand-blue/5" : ""} ${selected ? "bg-brand-blue/5 ring-2 ring-inset ring-brand-blue" : ""}`}>
                <button
                  type="button"
                  onClick={() => onSelectDay(day)}
                  aria-pressed={selected}
                  aria-label={`Select ${day.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}. ${list.length} loaded activities.`}
                  className="flex h-5 shrink-0 items-center justify-between gap-1 rounded px-0.5 text-left text-caption hover:text-brand-blue focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-blue"
                >
                  <span className={`inline-flex h-5 min-w-5 items-center justify-center rounded px-0.5 font-semibold ${isToday ? "bg-brand-blue text-white" : inMonth ? "text-brand-ink" : "text-brand-gray"}`}>{day.getDate()}</span>
                  {isToday && <span className="truncate text-[10px] font-medium text-brand-blue">Today</span>}
                </button>
                {list.length ? (
                  <div className="mt-0.5 min-w-0 space-y-[1px]">
                    {list.slice(0, MAX_MONTH_INDICATORS).map((event) => <EventIndicator key={calendarEventKey(event)} event={event} variant={variant} preview={event.preview} onOpenEvent={onOpenEvent} />)}
                  </div>
                ) : <div className="flex-1" />}
                {hidden > 0 ? (
                  <button type="button" onClick={() => onSelectDay(day)} className="mt-auto truncate rounded px-1 text-left text-caption font-medium text-brand-blue hover:underline" aria-label={`View all ${list.length} activities on ${key}`}>+{hidden} more</button>
                ) : <div className="flex-1" />}
              </div>
            );
          })}
        </div>
      </section>
    );
  }
  return (
    <Card className="overflow-hidden">
      <div className="hidden grid-cols-7 border-b border-slate-200 bg-brand-bg sm:grid dark:border-border">
        {WEEKDAY_HEADERS.map((d) => (
          <p key={d} className="px-2 py-2 text-center text-[11px] font-semibold uppercase tracking-wide text-brand-gray">{d}</p>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {monthGrid(cursor).flat().map((day) => {
          const inMonth = day.getMonth() === cursor.getMonth();
          const isToday = sameDay(day, today);
          const list = byDay[toKey(day)] || [];
          const shown = list.slice(0, 2);
          return (
            <button
              key={toKey(day)}
              type="button"
              onClick={() => onSelectDay(day)}
              className={`min-h-[76px] border-b border-r border-slate-200 p-1.5 text-left align-top transition-colors hover:bg-brand-bg/50 sm:min-h-[104px] dark:border-border dark:hover:bg-hover ${
                !inMonth ? "bg-slate-50/60 dark:bg-background/40" : ""
              }`}
            >
              <span
                className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium ${
                  isToday ? "bg-brand-blue text-white" : inMonth ? "text-brand-ink" : "text-brand-gray/50"
                }`}
              >
                {day.getDate()}
              </span>

              {/* Mobile: compact status dots */}
              <div className="mt-0.5 flex flex-wrap gap-0.5 sm:hidden">
                {list.slice(0, 4).map((s) => (
                  <span key={s.id} className={`h-1.5 w-1.5 rounded-full ${STATUS_DOTS[s.status] || STATUS_DOTS.Scheduled}`} />
                ))}
                {list.length > 4 && <span className="text-[9px] text-brand-gray">+{list.length - 4}</span>}
              </div>

              {/* sm+: event chips (rejected responses shown in red) */}
              <div className="mt-1 hidden space-y-0.5 sm:block">
                {shown.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={(e) => { e.stopPropagation(); onOpenEvent(s.id); }}
                    className={`flex w-full items-center gap-1 truncate rounded px-1.5 py-0.5 text-left text-[10px] font-medium ${chipTone(s)}`}
                    title={`${eventTitle(s, variant)} · ${s.status}${s.confirmationStatus ? ` · ${s.confirmationStatus}` : ""}`}
                  >
                    {s.confirmationStatus === "Confirmed" && <Check className="h-2.5 w-2.5 shrink-0 text-brand-green" aria-hidden="true" />}
                    {s.confirmationStatus === "Rejected" && <X className="h-2.5 w-2.5 shrink-0" aria-hidden="true" />}
                    <span className="truncate">{eventTitle(s, variant)}</span>
                  </button>
                ))}
                {list.length > 2 && (
                  <span className="block w-full truncate px-1.5 text-left text-[10px] font-medium text-brand-blue">
                    +{list.length - 2} more
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </Card>
  );
}

/* ---------------------------------- Week ---------------------------------- */

export function WeekView({ cursor, today, byDay, variant = "supervisor", presentation = "default", selectedDay = null, onOpenEvent, onSelectDay }) {
  if (presentation === "supervisor") {
    return (
      <section className="grid grid-cols-7 gap-2" aria-label="Week calendar">
        {weekDays(cursor).map((day) => {
          const key = toDateKey(day);
          const list = byDay[key] || [];
          const selected = key === toDateKey(selectedDay);
          return (
            <div key={key} className={`supervisor-panel self-start p-2 ${selected ? "ring-2 ring-brand-blue" : ""}`}>
              <button type="button" onClick={() => onSelectDay(day)} aria-pressed={selected} aria-label={`Select ${key}. ${list.length} loaded activities.`} className="mb-2 block w-full text-left hover:text-brand-blue">
                <span className="block text-caption text-brand-gray">{day.toLocaleDateString("en-US", { weekday: "short" })}</span>
                <span className="text-section font-semibold text-brand-ink">{day.getDate()}</span>
                {key === toDateKey(today) && <span className="ml-1 text-caption text-brand-blue">Today</span>}
              </button>
              {list.length ? <div className="min-w-0 space-y-0.5">{list.slice(0, MAX_MONTH_INDICATORS).map((event) => <EventIndicator key={calendarEventKey(event)} event={event} variant={variant} preview={event.preview} onOpenEvent={onOpenEvent} />)}</div>
                : <p className="text-caption text-brand-gray">No loaded activities</p>}
              {list.length > MAX_MONTH_INDICATORS && <button type="button" onClick={() => onSelectDay(day)} className="mt-2 truncate text-caption font-medium text-brand-blue hover:underline">+{list.length - MAX_MONTH_INDICATORS} more</button>}
            </div>
          );
        })}
      </section>
    );
  }
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-7">
      {weekDays(cursor).map((day) => {
        const list = byDay[toKey(day)] || [];
        const isToday = sameDay(day, today);
        return (
          <Card key={toKey(day)} className={`p-3 ${isToday ? "ring-1 ring-brand-blue" : ""}`}>
            <div className="mb-2 flex items-center justify-between gap-2">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-brand-gray">
                  {day.toLocaleDateString("en-US", { weekday: "short" })}
                </p>
                <p className={`text-lg font-semibold ${isToday ? "text-brand-blue" : "text-brand-ink"}`}>{day.getDate()}</p>
              </div>
              <button onClick={() => onSelectDay(day)} className="text-[11px] font-medium text-brand-blue hover:underline">
                Day view
              </button>
            </div>
            {list.length === 0 ? (
              <p className="py-4 text-center text-xs text-brand-gray">No schedules</p>
            ) : (
              <div className="space-y-1.5">
                {list.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => onOpenEvent(s.id)}
                    className="w-full rounded-btn border border-slate-200 bg-white px-2.5 py-2 text-left transition-colors hover:border-brand-blue dark:border-border dark:bg-card"
                  >
                    <p className="truncate text-xs font-semibold text-brand-ink">{eventTitle(s, variant)}</p>
                    <p className="mt-0.5 truncate text-[11px] text-brand-gray">{eventSubtitle(s, variant)}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-1">
                      <ScheduleStatusBadge value={s.status} />
                      {s.confirmationStatus && <ConfirmationBadge value={s.confirmationStatus} />}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}

/* ----------------------------------- Day ----------------------------------- */

export function DayView({ cursor, byDay, variant = "supervisor", presentation = "default", loading = false, incomplete = false, onOpenEvent }) {
  if (presentation === "supervisor") return <SupervisorDayView cursor={cursor} byDay={byDay} loading={loading} incomplete={incomplete} onOpenEvent={onOpenEvent} />;
  const list = byDay[toKey(cursor)] || [];
  return (
    <Card className="p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-brand-ink sm:text-base">
          {cursor.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
        </h3>
        <span className="text-xs text-brand-gray">{list.length} scheduled</span>
      </div>
      {list.length === 0 ? (
        <div className="py-10 text-center">
          <CalendarDays className="mx-auto h-10 w-10 text-brand-gray/50" />
          <p className="mt-3 text-sm font-medium text-brand-ink">No Schedules for This Day</p>
          <p className="mt-1 text-xs text-brand-gray">Select another date to view its follow-ups.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {list.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => onOpenEvent(s.id)}
              className="flex w-full flex-wrap items-center justify-between gap-3 rounded-btn border border-slate-200 bg-white px-4 py-3 text-left transition-colors hover:border-brand-blue dark:border-border dark:bg-card"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-brand-ink">{eventTitle(s, variant)}</p>
                <p className="mt-0.5 text-xs text-brand-gray">{eventSubtitle(s, variant)}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <ScheduleStatusBadge value={s.status} />
                {s.confirmationStatus && <ConfirmationBadge value={s.confirmationStatus} />}
              </div>
            </button>
          ))}
        </div>
      )}
    </Card>
  );
}

function SupervisorDayView({ cursor, byDay, loading, incomplete, onOpenEvent }) {
  const key = toDateKey(cursor);
  const list = byDay[key] || [];
  const previewCount = list.filter((event) => event.preview).length;
  return (
    <section className="supervisor-panel flex flex-col h-full" aria-label="Selected date activities">
      <div className="border-b border-brand-border px-4 py-3 shrink-0">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div className="min-w-0">
            <p className="text-caption text-brand-gray">Selected date</p>
            <h2 className="mt-0.5 break-words text-section font-semibold text-brand-ink">{cursor.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}</h2>
          </div>
          <p className="shrink-0 text-caption font-medium text-brand-ink">
            {!list.length && (incomplete || loading) ? "Awaiting complete source data"
              : `${list.length} ${list.length === 1 ? "activity" : "activities"}`}
          </p>
        </div>
        {previewCount > 0 && <p className="mt-1.5 text-caption text-brand-gray">Includes {previewCount} preview sample follow-up{previewCount === 1 ? "" : "s"} (not saved).</p>}
      </div>
      <div className="flex-1 overflow-y-auto min-h-0">
        {list.length ? <ScheduleRowList events={list} onOpenEvent={onOpenEvent} />
          : <ActivityEmpty loading={loading} incomplete={incomplete} title="No activities for this day" />}
      </div>
    </section>
  );
}

export function AgendaView({ events, selectedDay, loading = false, incomplete = false, onSelectDay, onOpenEvent }) {
  const selectedKey = toDateKey(selectedDay);
  const index = events.findIndex((event) => event.date >= selectedKey);
  const initialPage = Math.floor(Math.max(0, index) / AGENDA_PAGE_SIZE);
  const [pagination, setPagination] = React.useState({ events: null, selectedKey: "", page: 0 });
  const page = pagination.events === events && pagination.selectedKey === selectedKey ? pagination.page : initialPage;
  const visible = events.slice(page * AGENDA_PAGE_SIZE, (page + 1) * AGENDA_PAGE_SIZE);
  const days = new Map();
  visible.forEach((event) => {
    if (!days.has(event.date)) days.set(event.date, []);
    days.get(event.date).push(event);
  });
  return (
    <section className="supervisor-panel p-4" aria-label="Monthly activity agenda">
      <div className="supervisor-section-heading">
        <h2>Agenda</h2>
        <p>{!events.length && (incomplete || loading) ? "Awaiting complete source data" : `${events.length} ${incomplete || loading ? "loaded " : ""}activities`} / Up to {AGENDA_PAGE_SIZE} per page</p>
      </div>
      {visible.length ? <div className="space-y-5">
        {[...days].map(([date, list]) => (
          <section key={date} aria-label={`Activities on ${date}`}>
            <button type="button" onClick={() => onSelectDay(parseCalendarDate(date))} aria-pressed={date === selectedKey} className={`mb-2 border-b-2 pb-1 text-left text-section font-semibold ${date === selectedKey ? "border-brand-blue text-brand-blue" : "border-transparent text-brand-ink"}`}>
              {parseCalendarDate(date).toLocaleDateString("en-US", { weekday: "short", month: "long", day: "numeric", year: "numeric" })}
            </button>
            <ScheduleRowList events={list} onOpenEvent={onOpenEvent} />
          </section>
        ))}
      </div> : <ActivityEmpty loading={loading} incomplete={incomplete} title="No activities in this month" />}
      <ActivityPagination page={page} total={events.length} pageSize={AGENDA_PAGE_SIZE} onChange={(next) => setPagination({ events, selectedKey, page: next })} />
    </section>
  );
}

/* ------------------------------ Detail modal ------------------------------ */

/**
 * Shared read-only follow-up detail modal. `actions` lets the Health
 * Supervisor page inject its Edit/Cancel/Delete controls; the Resident page
 * renders the modal without actions (residents cannot modify schedules).
 */
export function ScheduleDetailModal({ schedule, onClose, actions = null, variant = "supervisor", presentation = "default", error = "" }) {
  const dialogRef = React.useRef(null);
  React.useEffect(() => {
    if (presentation !== "supervisor") return undefined;
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, [presentation]);
  if (presentation === "supervisor") {
    const service = schedule.type === "health-service";
    const date = parseCalendarDate(schedule.date);
    const details = [
      ["Resident", schedule.residentName],
      ["Resident ID", schedule.residentId || "Not recorded"],
      ["Date", date ? date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }) : "Date not specified"],
      ["Time", activityTime(schedule)],
      ["Category", service ? schedule.category || "Not recorded" : "Follow-up"],
      ["Status", formatCalendarStatus(schedule.status)],
      ...(service ? [
        ["Service ID", schedule.serviceId || "Not recorded"],
        ...(schedule.recordedBy ? [["Recorded by", schedule.recordedBy]] : []),
        ...(schedule.attendedAt ? [["Attendance recorded", formatDateTime(schedule.attendedAt)]] : []),
      ] : [
        ["Healthcare provider", schedule.provider || "Not recorded"],
        ["Location", schedule.location || "Not recorded"],
        ["Priority", schedule.priority || "Not recorded"],
        ...(schedule.completedAt ? [["Completed", formatDateTime(schedule.completedAt)]] : []),
      ]),
    ];
    return (
      <dialog ref={dialogRef} aria-labelledby="supervisor-activity-title" onCancel={(event) => { event.preventDefault(); onClose(); }} className="supervisor-modal m-auto max-h-[90vh] w-[calc(100%_-_2rem)] max-w-xl overflow-y-auto rounded border border-brand-border bg-card p-4 text-brand-ink backdrop:bg-black/50 sm:p-5">
        <div className="mb-4 flex items-start justify-between gap-3 border-b border-brand-border pb-3">
          <div className="min-w-0">
            <p className="text-caption text-brand-gray">{service ? "Health-service attendance" : "Follow-up details"}</p>
            <h2 id="supervisor-activity-title" className="mt-0.5 break-words text-section font-semibold">{schedule.label}</h2>
          </div>
          <button type="button" onClick={onClose} className="supervisor-button is-icon" aria-label="Close activity details"><X className="h-4 w-4" aria-hidden="true" /></button>
        </div>
        <dl className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
          {details.map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-caption text-brand-gray">{label}</dt><dd className="mt-0.5 break-words text-ui">{value}</dd></div>)}
        </dl>
        <div className="mt-4 border-t border-brand-border pt-3">
          <p className="text-caption text-brand-gray">{service ? "Attendance notes" : "Follow-up instructions"}</p>
          <p className="mt-1 whitespace-pre-wrap break-words text-ui">{(service ? schedule.detail : schedule.instructions) || "No notes recorded."}</p>
        </div>
        {schedule.confirmationStatus && <div className="mt-4 border-t border-brand-border pt-3">
          <p className="text-caption text-brand-gray">Resident confirmation</p>
          <p className="mt-1 text-ui font-medium">{schedule.confirmationStatus}</p>
          {schedule.respondedAt && <p className="mt-1 text-caption text-brand-gray">Responded {formatDateTime(schedule.respondedAt)}</p>}
          {schedule.rejectionReason && <p className="mt-2 whitespace-pre-wrap break-words text-ui">Rejection reason: {schedule.rejectionReason}</p>}
        </div>}
        {schedule.offline && <p className="mt-4 text-caption text-brand-gray">Saved on this device / {schedule.syncStatus || "Pending sync"}. Resident confirmation and visibility to other staff may await synchronization.</p>}
        {schedule.cached && !schedule.offline && <p className="mt-4 text-caption text-brand-gray">Showing a saved device record, which may be out of date. Reconnect and retry the follow-up source to verify the current record.</p>}
        {error && <p role="alert" className="mt-4 border-l-2 border-brand-danger pl-3 text-ui text-brand-danger">{error}</p>}
        <div className="mt-4 flex flex-wrap justify-end gap-2 border-t border-brand-border pt-3">{actions}<button type="button" onClick={onClose} className="supervisor-button">Close</button></div>
      </dialog>
    );
  }
  const rows = [
    ...(variant === "supervisor"
      ? [{ icon: User, label: "Resident", value: `${schedule.residentName} (${schedule.residentId || "—"})` }]
      : []),
    { icon: Clock, label: "Date & Time", value: `${fromKey(schedule.date).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })} · ${formatTime(schedule.time)}` },
    { icon: MapPin, label: "Location", value: schedule.location },
    { icon: User, label: "Healthcare Provider", value: schedule.provider },
  ];
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4">
      <Card className="max-h-[92vh] w-full max-w-lg overflow-y-auto">
        <div className="p-6">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <h3 className="text-lg font-semibold text-brand-ink">Follow-up Details</h3>
              <p className="mt-0.5 text-sm text-brand-gray">
                {variant === "resident" ? "Your scheduled follow-up" : schedule.residentName}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <ScheduleStatusBadge value={schedule.status} />
              <button onClick={onClose} className="text-brand-gray hover:text-brand-ink" aria-label="Close">
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>

          <div className="space-y-3">
            {rows.map((r) => (
              <div key={r.label} className="flex items-start gap-3 rounded-btn bg-brand-bg/60 px-3.5 py-2.5 dark:bg-card-nested">
                <r.icon className="mt-0.5 h-4 w-4 shrink-0 text-brand-blue" strokeWidth={1.8} />
                <div className="min-w-0">
                  <p className="text-[11px] uppercase tracking-wide text-brand-gray">{r.label}</p>
                  <p className="mt-0.5 text-sm font-medium text-brand-ink">{r.value}</p>
                </div>
              </div>
            ))}
            <div className="rounded-btn bg-brand-bg/60 px-3.5 py-2.5 dark:bg-card-nested">
              <p className="text-[11px] uppercase tracking-wide text-brand-gray">Follow-up Instructions</p>
              <p className="mt-0.5 text-sm text-brand-ink">{schedule.instructions || "No instructions recorded."}</p>
            </div>

            {/* Resident confirmation — shared by both roles; the supervisor
                sees the resident's response (and rejection reason) here without
                creating or editing anything. */}
            {schedule.confirmationStatus && (
              <div className="rounded-btn bg-brand-bg/60 px-3.5 py-2.5 dark:bg-card-nested">
                <p className="text-[11px] uppercase tracking-wide text-brand-gray">
                  {variant === "resident" ? "Confirmation" : "Resident Confirmation"}
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <ConfirmationBadge value={schedule.confirmationStatus} />
                  {schedule.respondedAt && (
                    <p className="text-xs text-brand-gray">Responded {formatDateTime(schedule.respondedAt)}</p>
                  )}
                </div>
                {schedule.confirmationStatus === "Rejected" && schedule.rejectionReason && (
                  <div className="mt-2 rounded-btn border border-rose-200 bg-rose-50 px-3 py-2 dark:border-rose-500/30 dark:bg-rose-500/10">
                    <p className="text-[11px] uppercase tracking-wide text-rose-600 dark:text-rose-400">
                      Reason for rejecting the follow-up schedule
                    </p>
                    <p className="mt-0.5 text-sm text-rose-700 dark:text-rose-300">{schedule.rejectionReason}</p>
                  </div>
                )}
              </div>
            )}
            {/* Resident response prompt — shown only while the follow-up is
                awaiting the resident's decision. The Confirm / Reject controls
                themselves are injected via `actions` (rendered in the footer)
                so the same secure workflow is used from the calendar and the
                list. */}
            {variant === "resident" && schedule.confirmationStatus === "Awaiting Confirmation" && (
              <div className="rounded-btn border border-amber-200 bg-amber-50 px-3.5 py-3 dark:border-amber-500/30 dark:bg-amber-500/10">
                <p className="text-[11px] uppercase tracking-wide text-amber-700 dark:text-amber-400">Follow-up Response</p>
                <p className="mt-1 text-sm text-amber-800 dark:text-amber-200">
                  Your health team scheduled this follow-up for you. Please confirm whether you can attend, or reject it with a reason.
                </p>
              </div>
            )}
          </div>

          <div className="mt-6 flex flex-wrap justify-end gap-3 border-t border-slate-200 pt-4 dark:border-border">
            {actions}
            <button onClick={onClose} className="rounded-btn px-4 py-2 text-sm font-medium text-brand-gray hover:bg-brand-bg dark:hover:bg-hover">Close</button>
          </div>
        </div>
      </Card>
    </div>
  );
}
