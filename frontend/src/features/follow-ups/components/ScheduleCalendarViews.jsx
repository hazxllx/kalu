import React from "react";
import { Card } from "@/components/common/Card";
import { CalendarDays, Check, Clock, MapPin, User, X } from "lucide-react";
import ScheduleStatusBadge, { ConfirmationBadge, STATUS_DOTS, STATUS_TONES } from "./ScheduleStatusBadge";
import { formatDateTime, formatTime, fromKey, monthGrid, sameDay, toKey, weekDays } from "../lib/scheduleDates";

/**
 * Shared calendar views for the follow-up schedule feature.
 *
 * Used by BOTH the Health Supervisor calendar and the Resident calendar so the
 * two roles always see identical dates, grouping, and event details from the
 * shared followUpScheduleStore — only the event label differs:
 *
 *   variant="supervisor" → events are labelled with the resident's name
 *   variant="resident"   → events are labelled with the follow-up time
 *
 * All views are read-only presentations; the parent page owns what happens
 * when an event is opened (`onOpenEvent`) or a day is selected (`onSelectDay`).
 */

const WEEKDAY_HEADERS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const eventTitle = (s, variant) =>
  variant === "resident" ? formatTime(s.time) : s.residentName;

const eventSubtitle = (s, variant) =>
  variant === "resident" ? `${s.location} · ${s.provider}` : `${formatTime(s.time)} · ${s.provider}`;

/** Month-chip tone: rejected resident responses are highlighted red. */
const chipTone = (s) =>
  s.confirmationStatus === "Rejected"
    ? "bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-400"
    : STATUS_TONES[s.status] || STATUS_TONES.Scheduled;

/* --------------------------------- Month --------------------------------- */

export function MonthView({ cursor, today, byDay, variant = "supervisor", onOpenEvent, onSelectDay }) {
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

export function WeekView({ cursor, today, byDay, variant = "supervisor", onOpenEvent, onSelectDay }) {
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

export function DayView({ cursor, byDay, variant = "supervisor", onOpenEvent }) {
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

/* ------------------------------ Detail modal ------------------------------ */

/**
 * Shared read-only follow-up detail modal. `actions` lets the Health
 * Supervisor page inject its Edit/Cancel/Delete controls; the Resident page
 * renders the modal without actions (residents cannot modify schedules).
 */
export function ScheduleDetailModal({ schedule, onClose, actions = null, variant = "supervisor" }) {
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
