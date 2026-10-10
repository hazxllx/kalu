import React, { useEffect, useMemo, useState } from "react";
import { Users, Loader2, Search, X, CalendarCheck } from "lucide-react";
import StatusBadge from "@/components/common/StatusBadge";
import { appointmentsApi } from "@/services/api";
import { statusLabel, formatDate, formatTime, effectiveSchedule, weekdayOf, slotTimes, WEEKDAYS } from "../lib/appointmentStatus";

const STATUS_OPTIONS = [
  { value: "", label: "All statuses" },
  { value: "pending", label: "Pending" },
  { value: "reschedule_proposed", label: "Reschedule Proposed" },
  { value: "approved", label: "Approved" },
  { value: "completed", label: "Completed" },
  { value: "missed", label: "Missed" },
  { value: "declined", label: "Declined" },
  { value: "cancelled", label: "Cancelled" },
];

const controlCls =
  "h-9 rounded-btn border border-brand-border bg-white px-3 text-sm text-brand-ink outline-none transition-colors focus:border-brand-blue";

/** How the shown date/time should be labeled for a given status. */
const scheduleKind = (status) => {
  if (["approved", "completed", "missed"].includes(status)) return "Confirmed";
  if (status === "reschedule_proposed") return "Proposed";
  return "Requested";
};

/**
 * Service-oriented appointment roster for the Health Supervisor. Groups the
 * already barangay-scoped appointment set by health service, shows per-service
 * counts, and — for a chosen service + date — a confirmed daily roster with
 * slot capacity. Pending requests are shown but never counted as confirmed
 * attendance or consumed capacity (only approved appointments are). All data is
 * derived client-side from the records the backend already scoped to the
 * caller's barangay; actions reuse the shared StaffAppointmentModal via onOpen.
 */
export default function ServiceRoster({ appointments = [], services = [], loading = false, onOpen }) {
  const [serviceId, setServiceId] = useState("");
  const [date, setDate] = useState("");
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [schedules, setSchedules] = useState([]);

  // Per-service counts from the real (barangay-scoped) appointment set.
  const summaries = useMemo(() => {
    const map = new Map();
    for (const a of appointments) {
      const cur = map.get(a.serviceId) || { total: 0, pending: 0, approved: 0, completed: 0, name: a.service };
      cur.total += 1;
      if (a.status === "pending" || a.status === "reschedule_proposed") cur.pending += 1;
      else if (a.status === "approved") cur.approved += 1;
      else if (a.status === "completed") cur.completed += 1;
      cur.name = cur.name || a.service;
      map.set(a.serviceId, cur);
    }
    return map;
  }, [appointments]);

  // Service chips: the barangay catalog, plus any service that has appointments.
  const serviceList = useMemo(() => {
    const byId = new Map();
    for (const s of services) byId.set(s.id, { id: s.id, name: s.name });
    for (const [id, info] of summaries) if (!byId.has(id)) byId.set(id, { id, name: info.name || "Service" });
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [services, summaries]);

  // Default to the first service that actually has requests, else the first.
  useEffect(() => {
    if (serviceId && serviceList.some((s) => s.id === serviceId)) return;
    const withReqs = serviceList.find((s) => (summaries.get(s.id)?.total || 0) > 0);
    setServiceId((withReqs || serviceList[0])?.id || "");
  }, [serviceList, summaries, serviceId]);

  // Capacity info for the selected service.
  useEffect(() => {
    if (!serviceId) {
      setSchedules([]);
      return;
    }
    let active = true;
    appointmentsApi
      .listSchedules(serviceId)
      .then((res) => {
        if (active) setSchedules(res?.rows || []);
      })
      .catch(() => {
        if (active) setSchedules([]);
      });
    return () => {
      active = false;
    };
  }, [serviceId]);

  const summary = serviceId ? summaries.get(serviceId) || { total: 0, pending: 0, approved: 0, completed: 0 } : null;
  const filtersActive = Boolean(date || status || search.trim());

  const roster = useMemo(() => {
    if (!serviceId) return [];
    const q = search.trim().toLowerCase();
    const rank = { pending: 0, reschedule_proposed: 1, approved: 2 };
    return appointments
      .filter((a) => {
        if (a.serviceId !== serviceId) return false;
        if (status && a.status !== status) return false;
        if (date && effectiveSchedule(a).date !== date) return false;
        if (q) {
          const hay = `${a.resident || ""} ${a.reference || ""}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      })
      .sort((a, b) => {
        const ra = rank[a.status] ?? 9;
        const rb = rank[b.status] ?? 9;
        if (ra !== rb) return ra - rb;
        const sa = effectiveSchedule(a);
        const sb = effectiveSchedule(b);
        return `${sa.date} ${sa.time}`.localeCompare(`${sb.date} ${sb.time}`);
      });
  }, [appointments, serviceId, status, date, search]);

  // Confirmed daily roster for the selected service + date (capacity aware).
  const daily = useMemo(() => {
    if (!serviceId || !date) return null;
    const wd = weekdayOf(date);
    const slotCapacity = new Map(); // "HH:MM" -> capacity
    for (const s of schedules) {
      if (s.active === false || s.weekday !== wd) continue;
      for (const t of slotTimes(s.startTime, s.endTime, s.slotMinutes)) {
        slotCapacity.set(t, Math.max(slotCapacity.get(t) || 0, s.capacityPerSlot));
      }
    }
    const approved = appointments
      .filter((a) => a.serviceId === serviceId && a.status === "approved" && a.confirmedDate === date)
      .map((a) => ({ ...a, time: formatTime(a.confirmedTime), rawTime: a.confirmedTime }))
      .sort((a, b) => String(a.rawTime).localeCompare(String(b.rawTime)));
    const pendingCount = appointments.filter(
      (a) => a.serviceId === serviceId && ["pending", "reschedule_proposed"].includes(a.status) && effectiveSchedule(a).date === date,
    ).length;

    // Group approved by confirmed time for the capacity view.
    const bySlot = new Map();
    for (const a of approved) {
      const t = a.confirmedTime ? String(a.confirmedTime).slice(0, 5) : "";
      if (!bySlot.has(t)) bySlot.set(t, []);
      bySlot.get(t).push(a);
    }
    const slots = [...new Set([...slotCapacity.keys(), ...bySlot.keys()])].filter(Boolean).sort();
    return {
      hasSchedule: slotCapacity.size > 0,
      weekdayLabel: WEEKDAYS[wd],
      approvedCount: approved.length,
      pendingCount,
      slots: slots.map((t) => ({
        time: t,
        capacity: slotCapacity.get(t) || null,
        residents: (bySlot.get(t) || []).map((a) => a.resident),
      })),
    };
  }, [appointments, schedules, serviceId, date]);

  const clearFilters = () => {
    setDate("");
    setStatus("");
    setSearch("");
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 rounded-card border border-brand-border bg-white px-6 py-12 text-sm text-brand-gray">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading services…
      </div>
    );
  }

  if (serviceList.length === 0) {
    return (
      <div className="flex flex-col items-center gap-1.5 rounded-card border border-brand-border bg-white px-6 py-10 text-center">
        <CalendarCheck className="h-6 w-6 text-brand-gray/60" />
        <p className="text-sm font-semibold text-brand-ink">No services configured</p>
        <p className="text-xs text-brand-gray">Services offered by your barangay will appear here.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Service selector */}
      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
        {serviceList.map((s) => {
          const c = summaries.get(s.id) || { total: 0, pending: 0 };
          const activeSel = s.id === serviceId;
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => setServiceId(s.id)}
              className={`flex shrink-0 flex-col gap-0.5 rounded-card border px-3 py-2 text-left transition-colors ${
                activeSel ? "border-brand-blue bg-brand-light" : "border-brand-border bg-white hover:border-brand-blue/50"
              }`}
            >
              <span className={`text-sm font-medium ${activeSel ? "text-brand-blue" : "text-brand-ink"}`}>{s.name}</span>
              <span className="flex items-center gap-2 text-xs text-brand-gray">
                <span>{c.total} total</span>
                {c.pending > 0 && <span className="rounded-full bg-amber-50 px-1.5 py-0.5 font-medium text-amber-700">{c.pending} pending</span>}
              </span>
            </button>
          );
        })}
      </div>

      {serviceId && (
        <>
          {/* Selected-service summary */}
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-card border border-brand-border bg-brand-border sm:grid-cols-4">
            {[
              { label: "Total requests", value: summary.total },
              { label: "Pending", value: summary.pending },
              { label: "Approved", value: summary.approved },
              { label: "Completed", value: summary.completed },
            ].map((m) => (
              <div key={m.label} className="bg-white px-4 py-3">
                <p className="text-2xl font-semibold tabular-nums text-brand-ink">{m.value}</p>
                <p className="text-xs text-brand-gray">{m.label}</p>
              </div>
            ))}
          </div>

          {/* Filters */}
          <div className="flex flex-wrap items-center gap-2">
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={`${controlCls} w-[9.5rem]`} aria-label="Filter by date" />
            <select value={status} onChange={(e) => setStatus(e.target.value)} className={controlCls} aria-label="Filter by status">
              {STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <div className="relative min-w-[10rem] flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-brand-gray" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search resident or reference"
                className={`${controlCls} w-full pl-8`}
              />
            </div>
            {filtersActive && (
              <button type="button" onClick={clearFilters} className="inline-flex h-9 items-center gap-1.5 rounded-btn px-3 text-sm font-medium text-brand-gray transition-colors hover:bg-brand-light hover:text-brand-ink">
                <X className="h-3.5 w-3.5" /> Clear
              </button>
            )}
          </div>

          {/* Confirmed daily roster (capacity aware) */}
          {date && daily && (
            <div className="rounded-card border border-brand-border bg-white">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-brand-border px-4 py-2.5">
                <p className="text-sm font-semibold text-brand-ink">
                  Confirmed roster — {formatDate(date)} <span className="font-normal text-brand-gray">({daily.weekdayLabel})</span>
                </p>
                <p className="text-xs text-brand-gray">
                  <span className="font-medium text-brand-ink">{daily.approvedCount}</span> approved · {daily.pendingCount} pending (not confirmed)
                </p>
              </div>
              {!daily.hasSchedule && daily.approvedCount === 0 ? (
                <p className="px-4 py-3 text-sm text-brand-gray">No clinic hours configured for this day.</p>
              ) : daily.slots.length === 0 ? (
                <p className="px-4 py-3 text-sm text-brand-gray">No confirmed appointments for this date.</p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {daily.slots.map((slot) => (
                    <li key={slot.time} className="flex items-start justify-between gap-3 px-4 py-2 text-sm">
                      <div className="flex items-center gap-2">
                        <span className="w-16 shrink-0 font-medium text-brand-ink">{formatTime(slot.time)}</span>
                        <span className="text-brand-gray">
                          {slot.residents.length > 0 ? slot.residents.join(", ") : <span className="text-brand-gray/70">Open</span>}
                        </span>
                      </div>
                      {slot.capacity != null && (
                        <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${slot.residents.length >= slot.capacity ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-700"}`}>
                          {slot.residents.length}/{slot.capacity}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* Roster table */}
          <div className="overflow-hidden rounded-card border border-brand-border bg-white">
            {roster.length === 0 ? (
              <div className="flex flex-col items-center gap-1.5 px-6 py-10 text-center">
                <Users className="h-6 w-6 text-brand-gray/60" />
                <p className="text-sm font-semibold text-brand-ink">{filtersActive ? "No matching appointments" : "No appointment requests for this service yet"}</p>
                <p className="text-xs text-brand-gray">{filtersActive ? "Try adjusting the selected filters." : "Resident requests for this service will appear here."}</p>
                {filtersActive && (
                  <button type="button" onClick={clearFilters} className="mt-1 rounded-btn border border-brand-border px-3 py-1.5 text-xs font-medium text-brand-blue transition-colors hover:border-brand-blue hover:bg-brand-light">
                    Clear filters
                  </button>
                )}
              </div>
            ) : (
              <>
                {/* Desktop */}
                <div className="hidden md:block">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-brand-border text-left text-[11px] font-semibold uppercase tracking-wide text-brand-gray">
                        <th className="px-4 py-2.5 font-semibold">Resident</th>
                        <th className="px-4 py-2.5 font-semibold">Appointment date</th>
                        <th className="px-4 py-2.5 font-semibold">Time slot</th>
                        <th className="px-4 py-2.5 font-semibold">Status</th>
                        <th className="px-4 py-2.5 font-semibold">Requested on</th>
                        <th className="px-4 py-2.5 text-right font-semibold">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {roster.map((appt) => {
                        const sched = effectiveSchedule(appt);
                        const kind = scheduleKind(appt.status);
                        return (
                          <tr key={appt.id} className="border-b border-slate-100 last:border-0 hover:bg-brand-bg/60">
                            <td className="px-4 py-2.5">
                              <p className="font-medium text-brand-ink">{appt.resident}</p>
                              <p className="font-mono text-xs text-brand-gray">{appt.reference}</p>
                            </td>
                            <td className="whitespace-nowrap px-4 py-2.5">
                              <span className="text-brand-ink">{formatDate(sched.date)}</span>
                              <span className={`ml-1.5 text-[10px] font-medium uppercase tracking-wide ${kind === "Confirmed" ? "text-brand-green" : "text-brand-gray"}`}>{kind}</span>
                            </td>
                            <td className="whitespace-nowrap px-4 py-2.5 text-brand-ink">{formatTime(sched.time)}</td>
                            <td className="px-4 py-2.5"><StatusBadge value={statusLabel(appt.status)} /></td>
                            <td className="whitespace-nowrap px-4 py-2.5 text-brand-gray">{formatDate(appt.createdAt)}</td>
                            <td className="px-4 py-2.5 text-right">
                              <button
                                type="button"
                                onClick={() => onOpen?.(appt)}
                                className="rounded-btn border border-brand-border px-2.5 py-1 text-xs font-medium text-brand-blue transition-colors hover:border-brand-blue hover:bg-brand-light"
                              >
                                {["pending", "reschedule_proposed"].includes(appt.status) ? "Process" : "View"}
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Mobile */}
                <div className="divide-y divide-slate-100 md:hidden">
                  {roster.map((appt) => {
                    const sched = effectiveSchedule(appt);
                    const kind = scheduleKind(appt.status);
                    return (
                      <button key={appt.id} type="button" onClick={() => onOpen?.(appt)} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-brand-bg/60">
                        <div className="min-w-0">
                          <p className="truncate font-medium text-brand-ink">{appt.resident}</p>
                          <p className="truncate text-xs text-brand-gray">
                            {formatDate(sched.date)} {formatTime(sched.time)} · <span className="uppercase">{kind}</span>
                          </p>
                        </div>
                        <StatusBadge value={statusLabel(appt.status)} />
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
