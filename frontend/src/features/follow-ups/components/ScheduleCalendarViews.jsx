import React from "react";
import TablePagination from "@/components/tables/TablePagination";
import { Card } from "@/components/common/Card";
import UniversalDetailsModal from "@/components/common/UniversalDetailsModal";
import PriorityBadge from "./PriorityBadge";
import FollowUpStatusBadge from "./FollowUpStatusBadge";
import { Bell, CalendarClock, CalendarDays, Check, ChevronRight, Clock, HeartPulse, MapPin, Plus, Stethoscope, TriangleAlert, User, Users, X } from "lucide-react";
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
  if (event.type === "calendar-activity") return "bg-brand-blue";
  if (event.type === "health-service") {
    const category = String(event.category || "").toLowerCase();
    if (category.includes("consult")) return "bg-brand-sky";
    return "bg-brand-green";
  }
  return "bg-brand-gray";
};
const CATEGORY_LABEL = (event) => {
  if (event.type === "follow-up") return "Follow-up";
  if (event.type === "calendar-activity") return event.activityType || "Personal activity";
  if (event.type === "health-service") return event.category || "Health service";
  return "Activity";
};
const MAX_MONTH_INDICATORS = 2;
const ACTIVITY_ICONS = {
  Reminder: Bell,
  "Follow-up": CalendarClock,
  Meeting: Users,
  "Field Visit": MapPin,
  "Health Activity": HeartPulse,
  Other: CalendarDays,
};

/** Compact single-line event indicator: a category dot + short label. */
function EventIndicator({ event, onOpenEvent, onSelectDay, variant = "supervisor", preview = false }) {
  const label = event.label || (variant === "supervisor" ? event.residentName : "");
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onSelectDay?.(event.date ? parseCalendarDate(event.date) : null); onOpenEvent(calendarEventKey(event)); }}
      className="flex w-full min-w-0 items-center gap-1 truncate rounded px-1 py-px text-left hover:bg-brand-bg focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-blue"
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
    <TablePagination
      total={total}
      page={page + 1}
      pageSize={pageSize}
      onPageChange={(nextPage) => onChange(nextPage - 1)}
      showPageSize={false}
      itemLabel="activities"
      className="mt-4"
    />
  );
}

function ActivityEmpty({ loading = false, incomplete = false, title = "Nothing scheduled", description = "Activities added for this date will appear here.", incompleteMessage = "Some activities could not be loaded.", onRetry = undefined, onAction = undefined, actionLabel = "Add Activity" }) {
  if (loading || incomplete) return (
    <div role="status" className="flex items-center gap-2 px-3 py-2 text-caption text-brand-gray">
      {incomplete && <TriangleAlert className="h-3.5 w-3.5 shrink-0 self-start mt-0.5 text-brand-amber" strokeWidth={1.8} aria-hidden="true" />}
      <p className="min-w-0 flex-1 break-words">{incomplete ? incompleteMessage : "Loading activities..."}</p>
      {incomplete && onRetry && <button type="button" onClick={onRetry} disabled={loading} className="supervisor-button is-quiet schedule-inline-action">Retry</button>}
    </div>
  );
  return (
    <div className="flex flex-col items-center px-4 py-7 text-center">
      <CalendarDays className="h-6 w-6 text-brand-gray/60" strokeWidth={1.5} aria-hidden="true" />
      <h3 className="mt-3 text-ui font-medium text-brand-ink">{title}</h3>
      <p className="mt-1 max-w-[16rem] text-ui text-brand-gray">{description}</p>
      {onAction && <button type="button" onClick={onAction} className="supervisor-button is-quiet schedule-inline-action mt-3">{actionLabel}</button>}
    </div>
  );
}

/** Title-first activity rows shared by the supervisor day panel and agenda. */
function ScheduleRow({ event, onOpenEvent }) {
  const personal = event.type === "calendar-activity";
  const Icon = event.type === "follow-up" ? CalendarClock
    : event.type === "health-service" ? Stethoscope
      : ACTIVITY_ICONS[event.activityType] || CalendarDays;
  const status = formatCalendarStatus(event.status);
  const metadata = personal ? CATEGORY_LABEL(event)
    : event.provider ? `Provider: ${event.provider}`
      : event.recordedBy ? `Recorded by: ${event.recordedBy}`
        : event.type === "follow-up" ? "Provider not recorded" : CATEGORY_LABEL(event);
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpenEvent(calendarEventKey(event))}
        className="group flex w-full min-w-0 items-start gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-brand-bg/60 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-blue"
        aria-label={`View ${event.typeLabel}: ${event.label}.${event.residentName ? ` Resident: ${event.residentName}.` : ""}${event.time ? ` ${formatTime(event.time)}.` : ""} ${metadata}. Status: ${status}.`}
      >
        <Icon className="mt-0.5 h-4 w-4 shrink-0 text-brand-blue" strokeWidth={1.7} aria-hidden="true" />
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 flex-wrap items-start justify-between gap-x-2 gap-y-1">
            <span className="min-w-0 flex-1 basis-32 break-words text-ui font-medium text-brand-ink [overflow-wrap:anywhere]">{event.label}</span>
            <ScheduleStatusBadge value={status} compact />
          </span>
          {event.residentName && <span className="mt-0.5 block break-words text-ui text-brand-gray">{event.residentName}</span>}
          <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-caption text-brand-gray">
            <span className="min-w-0 break-words [overflow-wrap:anywhere]">{metadata}</span>
            {event.time && <time dateTime={event.time} className="shrink-0 tabular-nums">{formatTime(event.time)}</time>}
            {event.preview && <span className="shrink-0 text-[10px] font-medium text-brand-gold" aria-label="Preview sample">preview</span>}
          </span>
        </span>
        <ChevronRight className="h-3.5 w-3.5 shrink-0 self-center text-brand-gray/60 group-hover:text-brand-blue" strokeWidth={1.8} aria-hidden="true" />
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
    <ul className="divide-y divide-brand-border/60">
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
      <section className="supervisor-panel schedule-month-panel" aria-label="Month calendar">
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
              <div key={key} onClick={() => onSelectDay(day)} className={`schedule-month-cell flex min-w-0 cursor-pointer flex-col overflow-hidden border-b border-r border-brand-border p-1 ${!inMonth ? "bg-brand-bg/60" : ""} ${isToday && !selected ? "bg-brand-blue/5" : ""} ${selected ? "bg-brand-blue/5 ring-2 ring-inset ring-brand-blue" : ""}`}>
                <button
                  type="button"
                  onClick={() => onSelectDay(day)}
                  aria-pressed={selected}
                  aria-label={`Select ${day.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}. ${list.length} loaded activities.`}
                  className="flex h-5 shrink-0 items-center justify-between gap-1 rounded px-0.5 text-left text-caption hover:text-brand-blue focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-blue"
                >
                  <span className={`inline-flex h-5 min-w-5 items-center justify-center rounded px-0.5 font-semibold ${isToday ? "bg-brand-blue text-white" : inMonth ? "text-brand-ink" : "text-brand-gray"}`}>{day.getDate()}</span>
                  {isToday && <span className="truncate text-[10px] font-medium text-brand-blue">Today</span>}
                  {list.length > 1 && <span className="ml-auto rounded-full bg-brand-blue/10 px-1.5 text-[10px] font-medium text-brand-blue">{list.length}</span>}
                </button>
                {list.length ? (
                  <div className="mt-0.5 min-w-0 space-y-[1px]">
                    {list.slice(0, MAX_MONTH_INDICATORS).map((event) => <EventIndicator key={calendarEventKey(event)} event={event} variant={variant} preview={event.preview} onOpenEvent={onOpenEvent} onSelectDay={() => onSelectDay(day)} />)}
                  </div>
                ) : null}
                {hidden > 0 ? (
                  <button type="button" onClick={() => onSelectDay(day)} className="mt-0.5 shrink-0 truncate rounded px-1 text-left text-[10px] font-medium leading-[14px] text-brand-blue hover:underline" aria-label={`View all ${list.length} activities on ${key}`}>+{hidden} more</button>
                ) : null}
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
              {list.length ? <div className="min-w-0 space-y-0.5">{list.slice(0, MAX_MONTH_INDICATORS).map((event) => <EventIndicator key={calendarEventKey(event)} event={event} variant={variant} preview={event.preview} onOpenEvent={onOpenEvent} onSelectDay={() => onSelectDay(day)} />)}</div>
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

export function DayView({ cursor, byDay, variant = "supervisor", presentation = "default", loading = false, incomplete = false, incompleteMessage = undefined, onRetry = undefined, filtersActive = false, onClearFilters = undefined, onOpenEvent, onAddActivity = undefined, canAddActivity = false }) {
  if (presentation === "supervisor") return <SupervisorDayView cursor={cursor} byDay={byDay} loading={loading} incomplete={incomplete} incompleteMessage={incompleteMessage} onRetry={onRetry} filtersActive={filtersActive} onClearFilters={onClearFilters} onOpenEvent={onOpenEvent} onAddActivity={onAddActivity} canAddActivity={canAddActivity} />;
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

function SupervisorDayView({ cursor, byDay, loading, incomplete, incompleteMessage, onRetry, filtersActive, onClearFilters, onOpenEvent, onAddActivity, canAddActivity }) {
  const key = toDateKey(cursor);
  const list = byDay[key] || [];
  const count = list.length || (!loading && !incomplete)
    ? `${list.length} ${list.length === 1 ? "activity" : "activities"}${incomplete || loading ? " loaded" : ""}`
    : loading ? "Loading..." : "Not verified";
  return (
    <section className="supervisor-panel schedule-day-panel" aria-label="Selected date activities">
      <header className="schedule-day-header border-b border-brand-border">
        <div className="schedule-day-heading min-w-0">
          <h2 className="break-words text-base font-semibold leading-6 text-brand-ink">
            <time dateTime={key}>{cursor.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}</time>
          </h2>
          <p className="mt-0.5 text-caption text-brand-gray">{cursor.toLocaleDateString("en-US", { weekday: "long" })}</p>
        </div>
        <p className="schedule-day-count text-caption tabular-nums text-brand-gray">{count}</p>
        {canAddActivity && <button type="button" onClick={onAddActivity} className="supervisor-button schedule-add-action"><Plus className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />Add Activity</button>}
      </header>
      {(loading || incomplete) && <ActivityEmpty loading={loading} incomplete={incomplete} incompleteMessage={incompleteMessage} onRetry={onRetry} />}
      <div className="schedule-day-body" aria-busy={loading}>
        {list.length ? <ScheduleRowList events={list} onOpenEvent={onOpenEvent} /> : !loading && !incomplete && <ActivityEmpty
          title={filtersActive ? "No matching activities" : "Nothing scheduled"}
          description={filtersActive ? "Try adjusting or clearing your calendar filters." : "Activities added for this date will appear here."}
          onAction={filtersActive ? onClearFilters : undefined}
          actionLabel="Clear filters"
        />}
      </div>
    </section>
  );
}

export function AgendaView({ events, selectedDay, loading = false, incomplete = false, onRetry = undefined, onSelectDay, onOpenEvent }) {
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
        <p>{!events.length && (incomplete || loading) ? loading ? "Loading..." : "Not verified" : `${events.length} ${incomplete || loading ? "loaded " : ""}activities`} / Up to {AGENDA_PAGE_SIZE} per page</p>
      </div>
      {(loading || incomplete) && <ActivityEmpty loading={loading} incomplete={incomplete} onRetry={onRetry} />}
      {visible.length ? <div className="space-y-5">
        {[...days].map(([date, list]) => (
          <section key={date} aria-label={`Activities on ${date}`}>
            <button type="button" onClick={() => onSelectDay(parseCalendarDate(date))} aria-pressed={date === selectedKey} className={`mb-2 border-b-2 pb-1 text-left text-section font-semibold ${date === selectedKey ? "border-brand-blue text-brand-blue" : "border-transparent text-brand-ink"}`}>
              {parseCalendarDate(date).toLocaleDateString("en-US", { weekday: "short", month: "long", day: "numeric", year: "numeric" })}
            </button>
            <ScheduleRowList events={list} onOpenEvent={onOpenEvent} />
          </section>
        ))}
      </div> : !loading && !incomplete && <ActivityEmpty title="No activities in this month" description="No activities match this month and the current filters." />}
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
    if (presentation === "supervisor") return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previousOverflow; };
  }, [presentation]);
  React.useEffect(() => {
    if (presentation !== "supervisor") return undefined;
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, [presentation]);
  if (presentation === "supervisor") {
    const service = schedule.type === "health-service";
    const date = parseCalendarDate(schedule.date);
    if (schedule.type === "calendar-activity") {
      return (
        <UniversalDetailsModal
          open={Boolean(schedule)}
          onClose={onClose}
          record={{
            title: schedule.label,
            category: [schedule.activityType, "Personal activity"].filter(Boolean).join(" · "),
            status: schedule.status ? formatCalendarStatus(schedule.status) : "",
            description: schedule.notes,
            information: [
              { label: "Date", value: date?.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" }) },
              { label: "Time", value: schedule.time ? activityTime(schedule) : "" },
              { label: "Linked resident", value: schedule.residentId ? schedule.residentName || schedule.residentId : "" },
              { label: "Location", value: schedule.location },
            ],
            sections: error ? [{
              title: "Action status",
              content: <p role="alert" className="text-brand-danger">{error}</p>,
            }] : [],
          }}
          actions={actions}
        />
      );
    }
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
    if (service) {
      return (
        <dialog ref={dialogRef} aria-labelledby="supervisor-activity-title" onCancel={(event) => { event.preventDefault(); onClose(); }} className="supervisor-modal m-auto max-h-[90vh] w-[calc(100%_-_2rem)] max-w-xl overflow-y-auto rounded border border-brand-border bg-card p-4 text-brand-ink backdrop:bg-black/50 sm:p-5">
          <div className="mb-4 flex items-start justify-between gap-3 border-b border-brand-border pb-3">
            <div className="min-w-0">
              <p className="text-caption text-brand-gray">Health-service attendance</p>
              <h2 id="supervisor-activity-title" className="mt-0.5 break-words text-section font-semibold">{schedule.label}</h2>
            </div>
            <button type="button" onClick={onClose} className="supervisor-button is-icon" aria-label="Close activity details"><X className="h-4 w-4" aria-hidden="true" /></button>
          </div>
          <dl className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
            {details.map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-caption text-brand-gray">{label}</dt><dd className="mt-0.5 break-words text-ui">{value}</dd></div>)}
          </dl>
          <div className="mt-4 border-t border-brand-border pt-3">
            <p className="text-caption text-brand-gray">Attendance notes</p>
            <p className="mt-1 whitespace-pre-wrap break-words text-ui">{schedule.detail || "No notes recorded."}</p>
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
    return (
      <dialog ref={dialogRef} aria-labelledby="supervisor-activity-title" onCancel={(event) => { event.preventDefault(); onClose(); }} className="supervisor-modal m-auto flex max-h-[85dvh] w-[calc(100%_-_2rem)] flex-col overflow-hidden rounded border border-brand-border bg-card p-4 text-brand-ink backdrop:bg-black/50 sm:w-[92vw] sm:max-w-[840px] sm:p-5">
        <div className="mb-3 flex shrink-0 items-start justify-between gap-3 border-b border-brand-border pb-3">
          <div className="min-w-0">
            <p className="text-caption text-brand-gray">Follow-up details</p>
            <h2 id="supervisor-activity-title" className="mt-0.5 break-words text-section font-semibold">{schedule.label}</h2>
          </div>
          <button type="button" onClick={onClose} className="supervisor-button is-icon" aria-label="Close activity details"><X className="h-4 w-4" aria-hidden="true" /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <dl className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
            {details.map(([label, value]) => (
              <div key={label} className="min-w-0">
                <dt className="text-caption text-brand-gray">{label}</dt>
                <dd className="mt-0.5 break-words [overflow-wrap:anywhere] text-ui">
                  {label === "Status"
                    ? <FollowUpStatusBadge value={value} />
                    : label === "Priority" && schedule.priority
                      ? <PriorityBadge value={schedule.priority} />
                      : value}
                </dd>
              </div>
            ))}
          </dl>
          <div className="mt-4 border-t border-brand-border pt-3">
            <p className="text-caption text-brand-gray">Follow-up instructions</p>
            <p className="mt-1 whitespace-pre-wrap break-words [overflow-wrap:anywhere] text-ui">{schedule.instructions || "No notes recorded."}</p>
          </div>
          {schedule.confirmationStatus && <div className="mt-4 border-t border-brand-border pt-3">
            <p className="text-caption text-brand-gray">Resident confirmation</p>
            <p className="mt-1 text-ui font-medium">{schedule.confirmationStatus}</p>
            {schedule.respondedAt && <p className="mt-1 text-caption text-brand-gray">Responded {formatDateTime(schedule.respondedAt)}</p>}
            {schedule.rejectionReason && <p className="mt-2 whitespace-pre-wrap break-words [overflow-wrap:anywhere] text-ui">Rejection reason: {schedule.rejectionReason}</p>}
          </div>}
          {schedule.offline && <p className="mt-4 text-caption text-brand-gray">Saved on this device / {schedule.syncStatus || "Pending sync"}. Resident confirmation and visibility to other staff may await synchronization.</p>}
          {schedule.cached && !schedule.offline && <p className="mt-4 text-caption text-brand-gray">Showing a saved device record, which may be out of date. Reconnect and retry the follow-up source to verify the current record.</p>}
          {error && <p role="alert" className="mt-4 border-l-2 border-brand-danger pl-3 text-ui text-brand-danger">{error}</p>}
        </div>
        <div className="mt-3 flex shrink-0 flex-wrap justify-end gap-2 border-t border-brand-border pt-3">{actions}<button type="button" onClick={onClose} className="supervisor-button">Close</button></div>
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
    <div className="fixed inset-0 z-[70] flex items-center justify-center overflow-hidden bg-black/50 p-3 sm:p-4" role="dialog" aria-modal="true" aria-label="Follow-up Details">
      <Card className="flex max-h-[85dvh] w-[calc(100vw-1.5rem)] min-w-0 flex-col overflow-hidden break-words [overflow-wrap:anywhere] sm:w-[92vw] sm:max-w-[840px]">
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-brand-border px-4 py-3 dark:border-border sm:px-6">
            <div>
              <h3 className="text-lg font-semibold text-brand-ink">Follow-up Details</h3>
              <p className="mt-0.5 text-sm text-brand-gray">
                {variant === "resident" ? "Your scheduled follow-up" : schedule.residentName}
              </p>
            </div>
            <div className="flex items-start gap-2">
              <div className="flex min-w-0 flex-col items-end gap-1">
                <ScheduleStatusBadge value={schedule.status} />
                {schedule.statusDetail && <span className="max-w-[220px] text-right text-[11px] leading-snug text-brand-gray">{schedule.statusDetail}</span>}
              </div>
              <button onClick={onClose} className="text-brand-gray hover:text-brand-ink" aria-label="Close">
                <X className="h-5 w-5" />
              </button>
            </div>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 py-4 pb-6 sm:px-6">
          <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
            {rows.map((r) => (
              <div key={r.label} className="flex min-w-0 items-start gap-3 rounded-btn bg-brand-bg/60 px-3.5 py-2.5 dark:bg-card-nested">
                <r.icon className="mt-0.5 h-4 w-4 shrink-0 text-brand-blue" strokeWidth={1.8} />
                <div className="min-w-0">
                  <p className="text-[11px] uppercase tracking-wide text-brand-gray">{r.label}</p>
                  <p className="mt-0.5 whitespace-pre-wrap break-words text-sm font-medium text-brand-ink">{r.value}</p>
                </div>
              </div>
            ))}
            <div className="min-w-0 rounded-btn bg-brand-bg/60 px-3.5 py-2.5 dark:bg-card-nested sm:col-span-2">
              <p className="text-[11px] uppercase tracking-wide text-brand-gray">Follow-up Instructions</p>
              <p className="mt-0.5 whitespace-pre-wrap break-words [overflow-wrap:anywhere] text-sm text-brand-ink">{schedule.instructions || "No instructions recorded."}</p>
            </div>

            {/* Resident confirmation — shared by both roles; the supervisor
                sees the resident's response (and rejection reason) here without
                creating or editing anything. */}
            {schedule.confirmationStatus && variant !== "resident" && (
              <div className="min-w-0 rounded-btn bg-brand-bg/60 px-3.5 py-2.5 dark:bg-card-nested sm:col-span-2">
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
                    <p className="mt-0.5 whitespace-pre-wrap break-words [overflow-wrap:anywhere] text-sm text-rose-700 dark:text-rose-300">{schedule.rejectionReason}</p>
                  </div>
                )}
              </div>
            )}
            {variant === "resident" && (schedule.statusDetail || schedule.respondedAt || schedule.rejectionReason) && (
              <div className="min-w-0 rounded-btn bg-brand-bg/60 px-3.5 py-2.5 dark:bg-card-nested sm:col-span-2">
                <p className="text-[11px] uppercase tracking-wide text-brand-gray">Status details</p>
                {schedule.statusDetail && <p className="mt-1 whitespace-pre-wrap break-words [overflow-wrap:anywhere] text-sm text-brand-ink">{schedule.statusDetail}</p>}
                {schedule.respondedAt && <p className="mt-1 text-xs text-brand-gray">Response recorded {formatDateTime(schedule.respondedAt)}</p>}
                {schedule.rejectionReason && <p className="mt-1 whitespace-pre-wrap break-words [overflow-wrap:anywhere] text-sm text-brand-ink">Reason: {schedule.rejectionReason}</p>}
              </div>
            )}
            {/* Resident response prompt — shown only while the follow-up is
                awaiting the resident's decision. The Confirm / Reject controls
                themselves are injected via `actions` (rendered in the footer)
                so the same secure workflow is used from the calendar and the
                list. */}
            {variant === "resident" && schedule.confirmationStatus === "Awaiting Confirmation" && (
              <div className="rounded-btn border border-amber-200 bg-amber-50 px-3.5 py-3 dark:border-amber-500/30 dark:bg-amber-500/10 sm:col-span-2">
                <p className="text-[11px] uppercase tracking-wide text-amber-700 dark:text-amber-400">Follow-up Response</p>
                <p className="mt-1 text-sm text-amber-800 dark:text-amber-200">
                  Your health team scheduled this follow-up for you. Please confirm whether you can attend, or reject it with a reason.
                </p>
              </div>
            )}
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap justify-end gap-3 border-t border-slate-200 px-4 py-3 dark:border-border sm:px-6">
            {actions}
            <button onClick={onClose} className="rounded-btn px-4 py-2 text-sm font-medium text-brand-gray hover:bg-brand-bg dark:hover:bg-hover">Close</button>
        </div>
      </Card>
    </div>
  );
}
