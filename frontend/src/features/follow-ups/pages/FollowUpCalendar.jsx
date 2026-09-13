import React, { useMemo, useState } from "react";
import PageHeader from "@/components/common/PageHeader";
import { Card } from "@/components/common/Card";
import { useAuth } from "@/context/AuthContext";
import { useResidents } from "@/services/mock/residentStore";
import {
  useFollowUpSchedules,
  followUpScheduleStore,
  SCHEDULE_STATUSES,
  PROVIDERS,
  LOCATIONS,
} from "@/services/mock/followUpScheduleStore";
import { DayView, MonthView, ScheduleDetailModal, WeekView } from "../components/ScheduleCalendarViews";
import { dayLabel, groupByDay, monthLabel, toKey, weekLabel } from "../lib/scheduleDates";
import {
  CalendarDays, ChevronLeft, ChevronRight, Plus, X, Search, ShieldAlert, Pencil, Trash2, Ban, CheckCircle2,
} from "lucide-react";

/* --------------------------- Form (supervisor) ---------------------------- */

const inputCls = (error) =>
  `mt-1.5 w-full rounded-btn border bg-white px-3.5 py-2.5 text-sm outline-none transition-colors focus:border-brand-blue dark:bg-input dark:text-foreground ${
    error ? "border-brand-danger" : "border-slate-200 dark:border-border"
  }`;
const labelCls = "text-sm font-medium text-brand-ink";

function Field({ label, required, error, children }) {
  return (
    <div>
      <label className={labelCls}>
        {label} {required && <span className="text-brand-danger">*</span>}
      </label>
      {children}
      {error && <p className="mt-1 text-xs text-brand-danger">{error}</p>}
    </div>
  );
}

const EMPTY_FORM = () => ({
  residentName: "",
  residentId: "",
  date: toKey(new Date()),
  time: "09:00",
  location: LOCATIONS[0],
  provider: PROVIDERS[0],
  instructions: "",
  status: "Scheduled",
});

function ScheduleFormModal({ initial, residentNames, onClose, onSave }) {
  const [form, setForm] = useState(() => (initial ? { ...initial } : EMPTY_FORM()));
  const [errors, setErrors] = useState({});

  const set = (key) => (value) => {
    setForm((p) => ({ ...p, [key]: value }));
    if (errors[key]) setErrors((p) => ({ ...p, [key]: "" }));
  };

  const validate = () => {
    const next = {};
    if (!form.residentName.trim()) next.residentName = "Resident name is required.";
    if (!form.date) next.date = "Follow-up date is required.";
    if (!form.time) next.time = "Follow-up time is required.";
    if (!form.provider) next.provider = "Healthcare provider is required.";
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4">
      <Card className="max-h-[92vh] w-full max-w-lg overflow-y-auto">
        <div className="p-6">
          <div className="mb-1 flex items-start justify-between gap-3">
            <div>
              <h3 className="text-lg font-semibold text-brand-ink">{initial ? "Edit Follow-up Schedule" : "Add Follow-up Schedule"}</h3>
              <p className="mt-0.5 text-sm text-brand-gray">Schedule a follow-up activity for a resident.</p>
            </div>
            <button onClick={onClose} className="text-brand-gray hover:text-brand-ink" aria-label="Close">
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="mt-4 space-y-4">
            <Field label="Resident Name" required error={errors.residentName}>
              <input
                type="text"
                list="followup-resident-names"
                value={form.residentName}
                onChange={(e) => set("residentName")(e.target.value)}
                placeholder="Search or enter resident name..."
                className={inputCls(errors.residentName)}
              />
              <datalist id="followup-resident-names">
                {residentNames.map((n) => <option key={n} value={n} />)}
              </datalist>
            </Field>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Resident ID">
                <input type="text" value={form.residentId} onChange={(e) => set("residentId")(e.target.value)} placeholder="e.g. R-1024" className={inputCls()} />
              </Field>
              <Field label="Status">
                <select value={form.status} onChange={(e) => set("status")(e.target.value)} className={`${inputCls()} cursor-pointer`}>
                  {SCHEDULE_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </Field>
              <Field label="Follow-up Date" required error={errors.date}>
                <input type="date" value={form.date} onChange={(e) => set("date")(e.target.value)} className={inputCls(errors.date)} />
              </Field>
              <Field label="Follow-up Time" required error={errors.time}>
                <input type="time" value={form.time} onChange={(e) => set("time")(e.target.value)} className={inputCls(errors.time)} />
              </Field>
              <Field label="Location">
                <select value={form.location} onChange={(e) => set("location")(e.target.value)} className={`${inputCls()} cursor-pointer`}>
                  {LOCATIONS.map((l) => <option key={l} value={l}>{l}</option>)}
                </select>
              </Field>
              <Field label="Assigned Healthcare Provider" required error={errors.provider}>
                <select value={form.provider} onChange={(e) => set("provider")(e.target.value)} className={inputCls(errors.provider)}>
                  {PROVIDERS.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </Field>
            </div>
            <Field label="Follow-up Instructions">
              <textarea
                rows={3}
                value={form.instructions}
                onChange={(e) => set("instructions")(e.target.value)}
                placeholder="Instructions for the follow-up visit..."
                className={`${inputCls()} resize-none`}
              />
            </Field>
          </div>

          <div className="mt-6 flex justify-end gap-3 border-t border-slate-200 pt-4 dark:border-border">
            <button onClick={onClose} className="rounded-btn px-4 py-2 text-sm font-medium text-brand-gray hover:bg-brand-bg dark:hover:bg-hover">Cancel</button>
            <button
              onClick={() => { if (validate()) onSave(form); }}
              className="inline-flex items-center gap-1.5 rounded-btn bg-brand-blue px-5 py-2 text-sm font-medium text-white hover:bg-brand-dark"
            >
              <CheckCircle2 className="h-4 w-4" /> {initial ? "Save Changes" : "Add Schedule"}
            </button>
          </div>
        </div>
      </Card>
    </div>
  );
}

/* ------------------------------ Main page -------------------------------- */

const VIEWS = [
  { key: "month", label: "Month" },
  { key: "week", label: "Week" },
  { key: "day", label: "Day" },
];

export default function FollowUpCalendar() {
  const { user } = useAuth();
  const schedules = useFollowUpSchedules();
  const residents = useResidents();

  // Health Supervisor only — the route already sits inside the supervisor's
  // protected area; this guard is a second line of defense.
  if (user?.role !== "health_supervisor") {
    return (
      <>
        <PageHeader crumbs={["Follow-ups", "Schedule Calendar"]} title="Follow-up Schedule Calendar" subtitle="Scheduled follow-up activities for the barangay." />
        <Card className="p-10 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-brand-danger/10">
            <ShieldAlert className="h-7 w-7 text-brand-danger" />
          </div>
          <h3 className="mt-4 text-lg font-semibold text-brand-ink">Unauthorized</h3>
          <p className="mx-auto mt-1.5 max-w-md text-sm text-brand-gray">
            Only the Health Supervisor can access the Follow-up Schedule Calendar.
          </p>
        </Card>
      </>
    );
  }

  return (
    <FollowUpCalendarContent
      schedules={schedules}
      residentNames={residents.map((r) => r.name).sort((a, b) => a.localeCompare(b))}
    />
  );
}

function FollowUpCalendarContent({ schedules, residentNames }) {
  const [view, setView] = useState("month");
  const [cursor, setCursor] = useState(() => new Date());
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [providerFilter, setProviderFilter] = useState("All");
  const [selected, setSelected] = useState(null); // schedule id (detail modal)
  const [formTarget, setFormTarget] = useState(null); // null | "new" | schedule
  const [toast, setToast] = useState(null);

  const today = new Date();

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  /** Filtered schedules (search + status + provider). */
  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return schedules.filter((s) => {
      if (statusFilter !== "All" && s.status !== statusFilter) return false;
      if (providerFilter !== "All" && s.provider !== providerFilter) return false;
      if (q) {
        const hay = `${s.residentName} ${s.residentId}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [schedules, searchQuery, statusFilter, providerFilter]);

  const byDay = useMemo(() => groupByDay(filtered), [filtered]);

  const filtersActive = searchQuery !== "" || statusFilter !== "All" || providerFilter !== "All";
  const clearFilters = () => {
    setSearchQuery("");
    setStatusFilter("All");
    setProviderFilter("All");
  };

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

  const handleSave = (form) => {
    if (formTarget && formTarget !== "new") {
      followUpScheduleStore.updateSchedule(formTarget.id, form);
      showToast("Follow-up schedule updated.");
    } else {
      followUpScheduleStore.addSchedule(form);
      showToast("Follow-up schedule added.");
      setCursor(new Date(form.date));
    }
    setFormTarget(null);
    setSelected(null);
  };

  return (
    <>
      <PageHeader
        crumbs={["Follow-ups", "Schedule Calendar"]}
        title="Follow-up Schedule Calendar"
        subtitle="View, schedule, and manage follow-up activities for residents in your barangay."
        action={
          <button
            onClick={() => setFormTarget("new")}
            className="inline-flex items-center gap-2 rounded-btn bg-brand-blue px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-dark"
          >
            <Plus className="h-4 w-4" /> Add Schedule
          </button>
        }
      />

      {toast && (
        <div className="fixed bottom-4 right-4 z-[80] flex items-center gap-2 rounded-btn bg-brand-ink px-4 py-3 text-white shadow-lg">
          <span className="text-sm">{toast}</span>
        </div>
      )}

      {/* Controls */}
      <Card className="p-4 mb-5">
        <div className="flex flex-wrap items-center gap-3">
          {/* View toggle */}
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
          {/* Period navigation */}
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

        {/* Filters */}
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="flex items-center gap-2 rounded-input border border-slate-200 bg-brand-bg/60 px-3 py-2.5 dark:border-border dark:bg-input">
            <Search className="h-4 w-4 shrink-0 text-brand-gray" />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search resident name or ID..."
              className="w-full bg-transparent text-sm outline-none placeholder:text-slate-400 dark:placeholder:text-slate-500"
            />
          </div>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="rounded-btn border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none dark:border-border dark:bg-input dark:text-foreground">
            <option value="All">All Statuses</option>
            {SCHEDULE_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select value={providerFilter} onChange={(e) => setProviderFilter(e.target.value)} className="rounded-btn border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none dark:border-border dark:bg-input dark:text-foreground">
            <option value="All">All Providers</option>
            {PROVIDERS.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          <div className="flex items-center gap-2">
            <input
              type="date"
              onChange={(e) => { if (e.target.value) { setCursor(new Date(e.target.value + "T00:00:00")); setView("day"); } }}
              className="min-w-0 flex-1 rounded-btn border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none dark:border-border dark:bg-input dark:text-foreground"
              aria-label="Jump to date"
            />
            {filtersActive && (
              <button onClick={clearFilters} className="inline-flex items-center gap-1 whitespace-nowrap rounded-btn border border-brand-border bg-white px-3 py-2.5 text-sm font-medium text-brand-gray hover:bg-brand-bg dark:bg-card dark:hover:bg-hover">
                <X className="h-4 w-4" /> Clear
              </button>
            )}
          </div>
        </div>
      </Card>

      {/* Calendar view */}
      {filtered.length === 0 ? (
        <Card className="p-10 text-center">
          <CalendarDays className="mx-auto h-10 w-10 text-brand-gray/50" />
          <p className="mt-3 text-sm font-medium text-brand-ink">No Follow-up Schedules Found</p>
          <p className="mt-1 text-xs text-brand-gray">
            {filtersActive ? "No schedules match the current filters." : "There are no scheduled follow-ups yet."}
          </p>
          <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
            {filtersActive && (
              <button onClick={clearFilters} className="rounded-btn border border-brand-border bg-white px-4 py-2 text-sm font-medium text-brand-blue hover:bg-brand-bg dark:bg-card dark:hover:bg-hover">
                Clear Filters
              </button>
            )}
            <button onClick={() => setFormTarget("new")} className="rounded-btn bg-brand-blue px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark">
              Add Schedule
            </button>
          </div>
        </Card>
      ) : view === "month" ? (
        <MonthView cursor={cursor} today={today} byDay={byDay} onOpenEvent={setSelected} onSelectDay={(d) => { setCursor(d); setView("day"); }} />
      ) : view === "week" ? (
        <WeekView cursor={cursor} today={today} byDay={byDay} onOpenEvent={setSelected} onSelectDay={(d) => { setCursor(d); setView("day"); }} />
      ) : (
        <DayView cursor={cursor} byDay={byDay} onOpenEvent={setSelected} />
      )}

      {/* Detail modal */}
      {selectedSchedule && (
        <ScheduleDetailModal
          schedule={selectedSchedule}
          onClose={() => setSelected(null)}
          actions={
            <>
              <button
                onClick={() => { followUpScheduleStore.deleteSchedule(selectedSchedule.id); setSelected(null); showToast("Follow-up schedule removed."); }}
                className="inline-flex items-center gap-1.5 rounded-btn border border-brand-danger/30 bg-white px-4 py-2 text-sm font-medium text-brand-danger hover:bg-brand-danger/5 dark:bg-card"
              >
                <Trash2 className="h-4 w-4" /> Delete
              </button>
              {selectedSchedule.status !== "Cancelled" && (
                <button
                  onClick={() => { followUpScheduleStore.cancelSchedule(selectedSchedule.id); setSelected(null); showToast("Follow-up schedule cancelled."); }}
                  className="inline-flex items-center gap-1.5 rounded-btn border border-brand-border bg-white px-4 py-2 text-sm font-medium text-brand-gray hover:bg-brand-bg dark:bg-card dark:hover:bg-hover"
                >
                  <Ban className="h-4 w-4" /> Cancel Schedule
                </button>
              )}
              <button
                onClick={() => { setFormTarget(selectedSchedule); setSelected(null); }}
                className="inline-flex items-center gap-1.5 rounded-btn bg-brand-blue px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark"
              >
                <Pencil className="h-4 w-4" /> Edit
              </button>
            </>
          }
        />
      )}

      {/* Add / Edit modal */}
      {formTarget && (
        <ScheduleFormModal
          initial={formTarget === "new" ? null : formTarget}
          residentNames={residentNames}
          onClose={() => setFormTarget(null)}
          onSave={handleSave}
        />
      )}
    </>
  );
}
