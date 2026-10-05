import React, { useEffect, useMemo, useState } from "react";
import { AlertCircle, CalendarDays, ChevronLeft, ChevronRight, Clock, MapPin, User } from "lucide-react";
import { Card } from "@/components/common/Card";
import { followUpsApi, healthServicesApi } from "@/services/api";
import { toLocalISODate } from "@/lib/dateUtils";
import { buildDayMap, buildMonthGrid, mapFollowUpEvent, mapHealthServiceEvent, monthRange, toDateKey } from "./scheduleCalendarUtils";

const weekdayHeaders = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const statusClass = {
  "follow-up": "bg-brand-blue/10 text-brand-blue",
  "health-service": "bg-brand-gold/20 text-brand-amber",
};

function formatStatus(value) {
  if (!value) return "Scheduled";
  return String(value).replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatEventTitle(event) {
  if (event.type === "health-service") {
    return event.label || "Health service";
  }
  return event.residentName || "Resident";
}

function formatEventSubtitle(event) {
  if (event.type === "health-service") {
    return `${event.residentName || "Resident"}${event.location ? ` · ${event.location}` : ""}`;
  }
  return `${event.time ? `${event.time}` : "Time TBD"}${event.location ? ` · ${event.location}` : ""}`;
}

export default function ScheduleCalendar({ selectedMonth = new Date() }) {
  const [monthDate, setMonthDate] = useState(() => new Date(selectedMonth.getFullYear(), selectedMonth.getMonth(), 1));
  const [selectedDate, setSelectedDate] = useState(() => new Date(selectedMonth.getFullYear(), selectedMonth.getMonth(), 1));
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const nextMonth = new Date(selectedMonth.getFullYear(), selectedMonth.getMonth(), 1);
    setMonthDate(nextMonth);
    setSelectedDate((current) => {
      if (current && current.getFullYear() === nextMonth.getFullYear() && current.getMonth() === nextMonth.getMonth()) {
        return current;
      }
      return nextMonth;
    });
  }, [selectedMonth]);

  const range = useMemo(() => monthRange(monthDate), [monthDate]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");

    Promise.all([
      followUpsApi.list({ from: range.from, to: range.to }),
      healthServicesApi.listAttendance({ from: range.from, to: range.to }),
    ])
      .then(([followUpResult, serviceResult]) => {
        if (!active) return;
        const followUps = (followUpResult?.rows || []).map(mapFollowUpEvent).filter(Boolean);
        const services = (serviceResult?.rows || []).map(mapHealthServiceEvent).filter(Boolean);
        setEvents([...followUps, ...services]);
      })
      .catch((err) => {
        if (!active) return;
        setEvents([]);
        setError(err?.message || "Unable to load the calendar schedule.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [range.from, range.to]);

  const byDay = useMemo(() => buildDayMap(events), [events]);
  const selectedKey = toLocalISODate(selectedDate);
  const selectedEvents = byDay[selectedKey] || [];

  const firstOfMonth = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
  const monthLabel = firstOfMonth.toLocaleDateString("en-US", { month: "long", year: "numeric" });

  const handleMonthStep = (direction) => {
    setMonthDate((current) => new Date(current.getFullYear(), current.getMonth() + direction, 1));
  };

  const isSelectedDay = (date) => {
    const same = toDateKey(date) === selectedKey;
    return same;
  };

  return (
    <section aria-label="Schedule calendar" className="space-y-3">
      <Card className="!rounded-card !border-brand-border !bg-brand-paper !shadow-none overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-brand-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <CalendarDays className="h-4 w-4 text-brand-blue" />
            <h2 className="font-heading text-sm font-semibold text-brand-ink">Schedule Calendar</h2>
          </div>
          <div className="flex items-center gap-2 self-start sm:self-auto">
            <button
              type="button"
              onClick={() => handleMonthStep(-1)}
              aria-label="Previous month"
              className="flex h-8 w-8 items-center justify-center rounded-sm border border-brand-border bg-brand-paper text-brand-ink hover:border-brand-gray"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <div className="min-w-[140px] text-center text-sm font-semibold text-brand-ink">{monthLabel}</div>
            <button
              type="button"
              onClick={() => handleMonthStep(1)}
              aria-label="Next month"
              className="flex h-8 w-8 items-center justify-center rounded-sm border border-brand-border bg-brand-paper text-brand-ink hover:border-brand-gray"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => {
                const today = new Date();
                const first = new Date(today.getFullYear(), today.getMonth(), 1);
                setMonthDate(first);
                setSelectedDate(today);
              }}
              className="rounded-sm border border-brand-border bg-brand-paper px-2.5 py-1.5 text-[11px] font-medium text-brand-ink hover:border-brand-gray"
            >
              Today
            </button>
          </div>
        </div>

        <div className="px-4 py-3">
          <div className="mb-3 flex flex-wrap items-center gap-2 text-[11px] text-brand-gray">
            <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-brand-blue" /> Follow-ups</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-brand-gold" /> Health Services</span>
          </div>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(260px,0.65fr)]">
            <div>
              <div className="grid grid-cols-7 border-b border-brand-border">
                {weekdayHeaders.map((day) => (
                  <div key={day} className="px-2 py-2 text-center text-[11px] font-semibold uppercase tracking-[0.12em] text-brand-gray">
                    {day}
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-7">
                {buildMonthGrid(monthDate).flat().map((day) => {
                  const dayKey = toDateKey(day);
                  const inMonth = day.getMonth() === monthDate.getMonth();
                  const dayEvents = byDay[dayKey] || [];
                  const selected = isSelectedDay(day);
                  return (
                    <button
                      key={dayKey}
                      type="button"
                      onClick={() => setSelectedDate(new Date(day.getFullYear(), day.getMonth(), day.getDate()))}
                      className={`min-h-[88px] border-b border-r border-brand-border p-1.5 text-left transition-colors hover:bg-brand-bg ${
                        !inMonth ? "bg-brand-bg/45 text-brand-gray/60" : "text-brand-ink"
                      } ${selected ? "bg-brand-blue/5 ring-1 ring-brand-blue" : ""}`}
                    >
                      <div className="flex items-center justify-between">
                        <span className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium ${
                          dayKey === toLocalISODate(new Date()) ? "bg-brand-blue text-white" : ""
                        }`}>
                          {day.getDate()}
                        </span>
                        {dayEvents.length > 0 && (
                          <span className="h-1.5 w-1.5 rounded-full bg-brand-blue" aria-hidden="true" />
                        )}
                      </div>
                      <div className="mt-1 space-y-1">
                        {dayEvents.slice(0, 2).map((event) => (
                          <span
                            key={`${event.id}-${event.type}`}
                            className={`inline-flex w-full items-center rounded-sm px-1.5 py-0.5 text-[10px] font-medium ${statusClass[event.type] || "bg-brand-bg text-brand-ink"}`}
                          >
                            {event.type === "health-service" ? event.label : event.residentName || "Resident"}
                          </span>
                        ))}
                        {dayEvents.length > 2 && (
                          <span className="block text-[10px] font-medium text-brand-blue">+{dayEvents.length - 2} more</span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="min-w-0">
              <div className="mb-3 rounded-sm border border-brand-border bg-brand-bg px-3 py-2">
                <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-brand-gray">Selected Date</p>
                <p className="mt-1 text-sm font-semibold text-brand-ink">
                  {selectedDate.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
                </p>
              </div>

              {loading ? (
                <div className="flex min-h-[180px] items-center justify-center rounded-sm border border-dashed border-brand-border bg-brand-bg/40 text-sm text-brand-gray">
                  Loading schedule…
                </div>
              ) : error ? (
                <div className="flex min-h-[180px] flex-col items-center justify-center gap-2 rounded-sm border border-dashed border-brand-border bg-brand-bg/40 p-4 text-center text-sm text-brand-gray">
                  <AlertCircle className="h-5 w-5 text-brand-danger" />
                  <span>{error}</span>
                </div>
              ) : selectedEvents.length === 0 ? (
                <div className="flex min-h-[180px] items-center justify-center rounded-sm border border-dashed border-brand-border bg-brand-bg/40 text-sm text-brand-gray">
                  No scheduled activities.
                </div>
              ) : (
                <div className="space-y-3">
                  {selectedEvents.map((event) => (
                    <div key={`${event.id}-${event.type}`} className="rounded-sm border border-brand-border bg-brand-paper p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="text-sm font-semibold text-brand-ink">{formatEventTitle(event)}</p>
                          <p className="mt-1 text-[11px] font-medium uppercase tracking-[0.08em] text-brand-gray">
                            {event.typeLabel}
                          </p>
                        </div>
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${statusClass[event.type] || "bg-brand-bg text-brand-ink"}`}>
                          {formatStatus(event.status)}
                        </span>
                      </div>

                      <div className="mt-3 space-y-1.5 text-xs text-brand-gray">
                        {event.type === "follow-up" && (
                          <div className="flex items-center gap-2">
                            <User className="h-3.5 w-3.5 text-brand-gray" />
                            <span>{event.residentName || "Resident"}</span>
                          </div>
                        )}
                        {event.type === "health-service" && (
                          <div className="flex items-center gap-2">
                            <User className="h-3.5 w-3.5 text-brand-gray" />
                            <span>{event.residentName || "Resident"}</span>
                          </div>
                        )}

                        <div className="flex items-center gap-2">
                          <Clock className="h-3.5 w-3.5 text-brand-gray" />
                          <span>{event.time || "Time not set"}</span>
                        </div>

                        {event.location && (
                          <div className="flex items-center gap-2">
                            <MapPin className="h-3.5 w-3.5 text-brand-gray" />
                            <span>{event.location}</span>
                          </div>
                        )}

                        {event.detail && (
                          <div className="pt-1 text-brand-ink">
                            {event.detail}
                          </div>
                        )}
                      </div>

                      <div className="mt-3 flex items-center justify-between gap-2 border-t border-brand-border pt-2 text-[11px]">
                        <span className="text-brand-gray">{formatEventSubtitle(event)}</span>
                        {event.type === "follow-up" ? (
                          <a href="/app/health_supervisor/followups" className="font-medium text-brand-blue hover:underline">Open</a>
                        ) : (
                          <a href="/app/health_supervisor/services" className="font-medium text-brand-blue hover:underline">Open</a>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </Card>
    </section>
  );
}
