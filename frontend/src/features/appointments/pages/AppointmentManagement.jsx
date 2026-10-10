import React, { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarClock, CalendarCheck, Search, Loader2, RefreshCw, AlertTriangle, CalendarRange } from "lucide-react";
import StatusBadge from "@/components/common/StatusBadge";
import { appointmentsApi, healthServicesApi } from "@/services/api";
import StaffAppointmentModal from "../components/StaffAppointmentModal";
import ScheduleManager from "../components/ScheduleManager";
import ServiceRoster from "../components/ServiceRoster";
import { statusLabel, formatDate, formatTime, effectiveSchedule, todayISO } from "../lib/appointmentStatus";

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

const PAGE_SIZE = 25;

const controlCls =
  "h-10 rounded-btn border border-brand-border bg-white px-3 text-sm text-brand-ink outline-none transition-colors focus:border-brand-blue";

/**
 * Barangay-scoped staff appointment management. The whole barangay set is
 * fetched once (scope enforced by the backend); counts and all filters
 * (status / service / date / search) are derived client-side so changing a
 * filter never triggers a refetch. A successful action refetches to refresh
 * the records and the overview counts while preserving the active filters.
 */
export default function AppointmentManagement() {
  const [tab, setTab] = useState("requests");
  const [all, setAll] = useState([]);
  const [services, setServices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  const [status, setStatus] = useState("pending");
  const [serviceId, setServiceId] = useState("");
  const [date, setDate] = useState("");
  const [search, setSearch] = useState("");
  const [visible, setVisible] = useState(PAGE_SIZE);

  const [selected, setSelected] = useState(null);
  const [toast, setToast] = useState(null);

  const showToast = useCallback((msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3200);
  }, []);

  const load = useCallback(() => {
    setLoading(true);
    setLoadError(null);
    return appointmentsApi
      .list()
      .then((res) => setAll(res?.rows || []))
      .catch((err) => setLoadError(err?.message || "Unable to load appointments."))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    healthServicesApi
      .list()
      .then((res) => setServices(res?.rows || res?.records || []))
      .catch(() => setServices([]));
  }, []);

  const counts = useMemo(() => {
    const today = todayISO();
    let pending = 0;
    let approved = 0;
    let todayCount = 0;
    let completed = 0;
    for (const a of all) {
      if (a.status === "pending") pending += 1;
      else if (a.status === "approved") {
        approved += 1;
        if ((a.confirmedDate || a.requestedDate) === today) todayCount += 1;
      } else if (a.status === "completed") completed += 1;
    }
    return { pending, approved, today: todayCount, completed };
  }, [all]);

  const filtersActive = Boolean(status || serviceId || date || search.trim());

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rank = { pending: 0, reschedule_proposed: 1, approved: 2 };
    return all
      .filter((a) => {
        if (status && a.status !== status) return false;
        if (serviceId && a.serviceId !== serviceId) return false;
        if (date && effectiveSchedule(a).date !== date) return false;
        if (q) {
          const hay = `${a.resident || ""} ${a.reference || ""} ${a.service || ""}`.toLowerCase();
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
  }, [all, status, serviceId, date, search]);

  useEffect(() => {
    setVisible(PAGE_SIZE);
  }, [status, serviceId, date, search]);

  const clearFilters = () => {
    setStatus("");
    setServiceId("");
    setDate("");
    setSearch("");
  };

  const metrics = [
    { key: "pending", label: "Pending", value: counts.pending },
    { key: "approved", label: "Approved", value: counts.approved },
    { key: "today", label: "Today", value: counts.today },
    { key: "completed", label: "Completed", value: counts.completed },
  ];

  const shown = filtered.slice(0, visible);

  return (
    <div>
      {/* Compact header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-[22px] font-semibold leading-tight tracking-tight text-brand-ink dark:text-foreground">Appointment Management</h1>
          <p className="mt-1 text-[13px] text-brand-gray">Review resident requests and manage service availability for your barangay.</p>
        </div>
        {tab === "requests" ? (
          <button
            type="button"
            onClick={() => setTab("schedule")}
            className="inline-flex items-center justify-center gap-2 rounded-btn border border-brand-border bg-white px-4 py-2 text-sm font-medium text-brand-ink transition-colors hover:border-brand-blue hover:text-brand-blue"
          >
            <CalendarRange className="h-4 w-4" /> Manage Schedule
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setTab("requests")}
            className="inline-flex items-center justify-center gap-2 rounded-btn border border-brand-border bg-white px-4 py-2 text-sm font-medium text-brand-ink transition-colors hover:border-brand-blue hover:text-brand-blue"
          >
            <CalendarClock className="h-4 w-4" /> View Requests
          </button>
        )}
      </div>

      {/* Tabs on the ruler line */}
      <div className="mt-4 flex items-center gap-8 border-b border-brand-border dark:border-border">
        {[
          { key: "requests", label: "Requests" },
          { key: "roster", label: "Service Roster" },
          { key: "schedule", label: "Schedule" },
        ].map((t) => {
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`-mb-px min-h-10 shrink-0 border-b-2 px-1 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-blue ${
                active
                  ? "border-brand-blue font-semibold text-brand-ink dark:text-foreground"
                  : "border-transparent font-medium text-brand-gray hover:text-brand-ink"
              }`}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {tab === "requests" ? (
        <div className="mt-4">
          {/* Overview strip */}
          <div className="mb-5 grid grid-cols-2 gap-px overflow-hidden rounded-card border border-brand-border bg-brand-border sm:grid-cols-4">
            {metrics.map((m) => (
              <div key={m.key} className="bg-white px-5 py-3.5 dark:bg-card">
                <p className="text-[26px] font-semibold leading-none tabular-nums text-brand-ink dark:text-foreground">{m.value}</p>
                <p className="mt-1 text-[11px] font-medium uppercase tracking-wide text-brand-gray">{m.label}</p>
              </div>
            ))}
          </div>

          {/* Filter toolbar */}
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <select value={status} onChange={(e) => setStatus(e.target.value)} className={controlCls} aria-label="Filter by status">
              {STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <select value={serviceId} onChange={(e) => setServiceId(e.target.value)} className={`${controlCls} max-w-[12rem]`} aria-label="Filter by service">
              <option value="">All services</option>
              {services.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className={`${controlCls} w-[9.5rem]`}
              aria-label="Filter by date"
            />
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
              <button
                type="button"
                onClick={clearFilters}
                className="inline-flex h-10 items-center px-1 text-sm font-medium text-brand-gray underline-offset-2 transition-colors hover:text-brand-ink hover:underline"
              >
                Clear
              </button>
            )}
          </div>

          {/* Results */}
          <div className="overflow-hidden rounded-card border border-brand-border bg-white">
            {loading ? (
              <div className="flex items-center justify-center gap-2 px-6 py-12 text-sm text-brand-gray">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading appointments…
              </div>
            ) : loadError ? (
              <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
                <AlertTriangle className="h-6 w-6 text-brand-danger" />
                <p className="text-sm font-semibold text-brand-ink">Unable to load appointments</p>
                <p className="max-w-sm text-xs text-brand-gray">{loadError}</p>
                <button
                  type="button"
                  onClick={load}
                  className="mt-1 inline-flex items-center gap-1.5 rounded-btn bg-brand-blue px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-dark"
                >
                  <RefreshCw className="h-3.5 w-3.5" /> Try Again
                </button>
              </div>
            ) : filtered.length === 0 ? (
              <EmptyRequests
                filtersActive={filtersActive}
                hasAny={all.length > 0}
                onClear={clearFilters}
              />
            ) : (
              <>
                {/* Desktop table */}
                <div className="hidden md:block">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-brand-border text-left text-[11px] font-medium uppercase tracking-wide text-brand-gray">
                        <th className="px-4 py-2.5">Resident</th>
                        <th className="px-4 py-2.5">Service</th>
                        <th className="px-4 py-2.5">Requested schedule</th>
                        <th className="px-4 py-2.5">Status</th>
                        <th className="px-4 py-2.5">Submitted</th>
                        <th className="px-4 py-2.5 text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {shown.map((appt) => {
                        const sched = effectiveSchedule(appt);
                        return (
                          <tr key={appt.id} className="border-b border-slate-100 last:border-0 hover:bg-brand-bg/60">
                            <td className="px-4 py-2.5">
                              <p className="font-medium text-brand-ink">{appt.resident}</p>
                              <p className="font-mono text-xs tabular-nums text-brand-gray">{appt.reference}</p>
                            </td>
                            <td className="whitespace-nowrap px-4 py-2.5 text-brand-ink">{appt.service}</td>
                            <td className="whitespace-nowrap px-4 py-2.5 tabular-nums text-brand-ink">
                              {formatDate(sched.date)}
                              <span className="text-brand-gray"> · {formatTime(sched.time)}</span>
                            </td>
                            <td className="px-4 py-2.5">
                              <StatusBadge value={statusLabel(appt.status)} />
                            </td>
                            <td className="whitespace-nowrap px-4 py-2.5 tabular-nums text-brand-gray">{formatDate(appt.createdAt)}</td>
                            <td className="px-4 py-2.5 text-right">
                              <button
                                type="button"
                                onClick={() => setSelected(appt)}
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

                {/* Mobile cards */}
                <div className="divide-y divide-slate-100 md:hidden">
                  {shown.map((appt) => {
                    const sched = effectiveSchedule(appt);
                    return (
                      <button
                        key={appt.id}
                        type="button"
                        onClick={() => setSelected(appt)}
                        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-brand-bg/60"
                      >
                        <div className="min-w-0">
                          <p className="truncate font-medium text-brand-ink">{appt.resident}</p>
                          <p className="truncate text-xs text-brand-gray">
                            {appt.service} · {formatDate(sched.date)} {formatTime(sched.time)}
                          </p>
                        </div>
                        <StatusBadge value={statusLabel(appt.status)} />
                      </button>
                    );
                  })}
                </div>

                {/* Footer: count + show more */}
                <div className="flex items-center justify-between gap-3 border-t border-brand-border px-4 py-2.5 text-xs text-brand-gray">
                  <span>
                    Showing {Math.min(visible, filtered.length)} of {filtered.length}
                  </span>
                  {filtered.length > visible && (
                    <button
                      type="button"
                      onClick={() => setVisible((v) => v + PAGE_SIZE)}
                      className="rounded-btn px-2.5 py-1 font-medium text-brand-blue transition-colors hover:bg-brand-light"
                    >
                      Show more
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      ) : tab === "roster" ? (
        <div className="mt-4">
          <ServiceRoster appointments={all} services={services} loading={loading} onOpen={setSelected} />
        </div>
      ) : (
        <div className="mt-4">
          <ScheduleManager services={services} showToast={showToast} />
        </div>
      )}

      {selected && (
        <StaffAppointmentModal
          appointment={selected}
          onClose={() => setSelected(null)}
          onChanged={() => load()}
          showToast={showToast}
        />
      )}

      {toast && (
        <div className="fixed bottom-4 right-4 z-[80] flex items-center gap-2 rounded-btn bg-brand-ink px-4 py-3 text-white shadow-float">
          <CalendarCheck className="h-4 w-4 text-brand-goldlight" />
          <span className="text-sm">{toast}</span>
        </div>
      )}
    </div>
  );
}

/** Compact, proportionate empty state inside the results area. */
function EmptyRequests({ filtersActive, hasAny, onClear }) {
  if (filtersActive && hasAny) {
    return (
      <div className="flex min-h-[220px] flex-col items-center justify-center px-6 py-10 text-center">
        <CalendarClock className="h-6 w-6 text-brand-gray" strokeWidth={1.75} aria-hidden="true" />
        <p className="mt-3 text-sm font-semibold text-brand-ink">No matching appointments</p>
        <p className="mt-1 text-[13px] text-brand-gray">Try adjusting the selected filters.</p>
        <button
          type="button"
          onClick={onClear}
          className="mt-3 text-[13px] font-medium text-brand-gray underline-offset-2 transition-colors hover:text-brand-ink hover:underline"
        >
          Clear filters
        </button>
      </div>
    );
  }
  return (
    <div className="flex min-h-[220px] flex-col items-center justify-center px-6 py-10 text-center">
      <CalendarCheck className="h-6 w-6 text-brand-gray" strokeWidth={1.75} aria-hidden="true" />
      <p className="mt-3 text-sm font-semibold text-brand-ink">No appointment requests yet</p>
      <p className="mt-1 text-[13px] text-brand-gray">New resident requests will appear here once submitted.</p>
    </div>
  );
}
