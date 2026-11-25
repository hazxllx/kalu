import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import PageHeader from "@/components/common/PageHeader";
import { Card } from "@/components/common/Card";
import ErrorState from "@/components/common/ErrorState";
import { useAuth } from "@/context/AuthContext";
import { usePermissions } from "@/context/PermissionsContext";
import { getSupervisorScope, HS_SCOPE } from "@/lib/supervisorScope";
import { calendarActivitiesApi, healthServicesApi } from "@/services/api";
import {
  createFollowUpOffline,
  listFollowUpsOffline,
  listFollowUpResidentsOffline,
  updateFollowUpOffline,
} from "@/services/offline/followUpOfflineService";
import { useSyncStatus } from "@/hooks/useSyncStatus";
import {
  buildDayMap, calendarEventKey, calendarVisibleRange, formatCalendarStatus,
  isCalendarEventInBarangay, mapFollowUpEvent, mapHealthServiceEvent,
  parseCalendarDate, readCalendarRows, stepCalendarDate, toDateKey,
} from "@/features/dashboards/components/scheduleCalendarUtils";
import { DayView, MonthView, ScheduleDetailModal } from "../components/ScheduleCalendarViews";
import { dayLabel, isPastSameDaySchedule, manilaDateKey, monthLabel, weekLabel } from "../lib/scheduleDates";
import { followUpActionAvailability } from "../lib/followUpActions";
import { Ban, CheckCircle2, ChevronLeft, ChevronRight, Clock, Pencil, X } from "lucide-react";

const FOLLOW_UP_STATUSES = ["Pending", "Scheduled", "Today", "Upcoming", "Ongoing", "Completed", "Missed", "Cancelled"];
const VIEWS = ["month", "week", "day", "agenda"];
const mobileCalendar = () => window.matchMedia("(max-width: 767px)").matches;
const initialDate = (params) => parseCalendarDate(params.get("date")) || parseCalendarDate(manilaDateKey());
const sourceState = () => ({ range: "", rows: [], loading: true, error: "", source: "" });
const CALENDAR_ACTIVITY_TYPES = ["Reminder", "Follow-up", "Meeting", "Field Visit", "Health Activity", "Other"];

const inputCls = (error) => `supervisor-input mt-1 w-full ${error ? "!border-brand-danger" : ""}`;
const mapCalendarActivity = (row, residents = [], assignedBarangay = "") => {
  const resident = residents.find((candidate) => String(candidate.id) === String(row.resident_id));
  return {
    id: row.id,
    type: "calendar-activity",
    typeLabel: "Personal activity",
    activityType: row.activity_type,
    label: row.title,
    date: row.activity_date,
    time: row.activity_time ? String(row.activity_time).slice(0, 5) : "",
    notes: row.notes || "",
    residentId: row.resident_id || "",
    residentName: resident?.name || "",
    residentBarangay: assignedBarangay,
    status: "Scheduled",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

function Field({ label, required = false, error = "", children }) {
  return (
    <div>
      <label className="block text-caption font-medium text-brand-ink">
        <span>{label}{required && <span className="text-brand-danger"> *</span>}</span>
        {children}
      </label>
      {error && <p role="alert" className="mt-1 text-caption text-brand-danger">{error}</p>}
    </div>
  );
}

function ScheduleFormModal({ initial, date, residents, residentsLoading, residentsError, onRetryResidents, providers, locations, canComplete, saving, error, onClose, onSave }) {
  const [form, setForm] = useState(() => initial ? { ...initial } : {
    residentId: "", residentName: "", purpose: "", date, time: "", location: "", provider: "",
    priority: "Medium", instructions: "", status: "Scheduled", requiresResidentResponse: true,
  });
  const [errors, setErrors] = useState(/** @type {Record<string, string>} */ ({}));
  const dialogRef = useRef(null);
  const providerList = React.useId();
  const locationList = React.useId();
  const isNew = !initial;
  const scheduleChanged = Boolean(initial) && (
    String(form.date || "") !== String(initial.date || "") ||
    String(form.time || "").slice(0, 5) !== String(initial.time || "").slice(0, 5)
  );
  const availability = followUpActionAvailability({ ...initial, scheduled_date: form.date, scheduled_time: form.time }, { canEdit: true, canComplete });
  const statuses = FOLLOW_UP_STATUSES.filter((status) => {
    if (status === "Completed") return !isNew && availability.complete;
    if (status === "Missed") return !isNew && availability.missed;
    if (status === "Cancelled") return !isNew && availability.cancel;
    return true;
  });
  const statusOptions = [...new Set([...statuses, initial?.status, form.status].filter(Boolean))];

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog.showModal();
    return () => dialog.close();
  }, []);

  const set = (key, value) => {
    setForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: "" }));
  };
  const submit = (event) => {
    event.preventDefault();
    if (saving) return;
    const next = /** @type {Record<string, string>} */ ({});
    if (isNew && !residents.some((resident) => String(resident.id) === String(form.residentId))) next.residentId = "Select a resident from the authorized list.";
    if (!String(form.purpose || "").trim()) next.purpose = "Purpose is required.";
    if (!parseCalendarDate(form.date)) next.date = "Select a valid follow-up date.";
    else if (form.date < manilaDateKey()) next.date = "Choose a future date; past follow-up schedules cannot be saved.";
    if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(form.time || "")) next.time = "Select a valid follow-up time.";
    else if (isPastSameDaySchedule(form.date, form.time)) next.time = "That time has already passed today. Choose a later time or another date.";
    if (!String(form.provider || "").trim()) next.provider = "Healthcare provider is required.";
    if (scheduleChanged && !String(form.scheduleChangeReason || "").trim()) next.scheduleChangeReason = "A reason is required when changing the schedule.";
    if (initial && !scheduleChanged && form.purpose === initial.purpose && form.provider === initial.provider && form.location === initial.location && form.priority === initial.priority && form.instructions === initial.instructions && form.status === initial.status) {
      next.form = "There are no changes to save.";
    }
    setErrors(next);
    if (!Object.keys(next).length) {
      if (scheduleChanged && !window.confirm("Changing this appointment will ask the resident to confirm the new date and time. Continue?")) return;
      onSave(form);
    }
  };

  return (
    <dialog ref={dialogRef} aria-labelledby="schedule-form-title" onCancel={(event) => { event.preventDefault(); if (!saving) onClose(); }} className="supervisor-modal m-auto max-h-[90vh] w-[calc(100%_-_2rem)] max-w-xl overflow-y-auto rounded border border-brand-border bg-card p-4 text-brand-ink backdrop:bg-black/50 sm:p-5">
      <form onSubmit={submit} noValidate className="supervisor-form">
        <div className="mb-4 flex items-start justify-between gap-3 border-b border-brand-border pb-3">
          <div>
            <h2 id="schedule-form-title" className="text-section font-semibold">{isNew ? "Schedule follow-up" : "Edit / reschedule follow-up"}</h2>
            <p className="mt-1 text-caption text-brand-gray">Use the resident's existing follow-up record and actual appointment details.</p>
          </div>
          <button type="button" onClick={onClose} disabled={saving} className="supervisor-button is-icon" aria-label="Close follow-up form"><X className="h-4 w-4" aria-hidden="true" /></button>
        </div>
        {error && <p role="alert" className="mb-3 border-l-2 border-brand-danger pl-3 text-ui text-brand-danger">{error}</p>}
        {errors.form && <p role="alert" className="mb-3 border-l-2 border-brand-danger pl-3 text-ui text-brand-danger">{errors.form}</p>}
        <div className="space-y-3">
          <Field label="Resident" required error={errors.residentId}>
            {isNew ? <select required value={form.residentId} disabled={saving || residentsLoading || Boolean(residentsError)} aria-invalid={Boolean(errors.residentId)} onChange={(event) => {
              const resident = residents.find((row) => String(row.id) === event.target.value);
              setForm((current) => ({ ...current, residentId: resident?.id || "", residentName: resident?.name || "" }));
              setErrors((current) => ({ ...current, residentId: "" }));
            }} className={inputCls(errors.residentId)}>
              <option value="">{residentsLoading ? "Loading residents..." : "Select a resident"}</option>
              {residents.map((resident) => <option key={resident.id} value={resident.id}>{resident.name || "Name not recorded"} / {resident.id}</option>)}
            </select> : <input readOnly value={`${form.residentName} / ${form.residentId}`} className={inputCls()} />}
          </Field>
          {isNew && <div className="flex flex-wrap items-center justify-between gap-2 text-caption text-brand-gray">
            <span>{residentsError || (residentsLoading ? "Loading the resident directory." : residents.length ? "Up to 200 authorized residents are available here. Names are distinguished by resident ID." : "No authorized residents were loaded. Reconnect or refresh the resident directory.")}</span>
            <button type="button" onClick={onRetryResidents} disabled={saving || residentsLoading} className="supervisor-button is-quiet">Refresh residents</button>
          </div>}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Purpose" required error={errors.purpose}><input required value={form.purpose} onChange={(event) => set("purpose", event.target.value)} aria-invalid={Boolean(errors.purpose)} className={inputCls(errors.purpose)} /></Field>
            <Field label="Status"><select value={form.status} onChange={(event) => set("status", event.target.value)} className={inputCls()}>{statusOptions.map((status) => <option key={status} disabled={!statuses.includes(status) && status !== initial?.status}>{status}</option>)}</select></Field>
            <Field label="Follow-up date" required error={errors.date}><input required type="date" value={form.date} onChange={(event) => set("date", event.target.value)} aria-invalid={Boolean(errors.date)} className={inputCls(errors.date)} /></Field>
            <Field label="Follow-up time" required error={errors.time}><input required type="time" value={form.time} onChange={(event) => set("time", event.target.value)} aria-invalid={Boolean(errors.time)} className={inputCls(errors.time)} /></Field>
            <Field label="Location"><input value={form.location} list={locationList} onChange={(event) => set("location", event.target.value)} className={inputCls()} /><datalist id={locationList}>{locations.map((location) => <option key={location} value={location} />)}</datalist></Field>
            <Field label="Healthcare provider" required error={errors.provider}><input required value={form.provider} list={providerList} onChange={(event) => set("provider", event.target.value)} aria-invalid={Boolean(errors.provider)} className={inputCls(errors.provider)} /><datalist id={providerList}>{providers.map((provider) => <option key={provider} value={provider} />)}</datalist></Field>
            <Field label="Priority"><select value={form.priority} onChange={(event) => set("priority", event.target.value)} className={inputCls()}><option>High</option><option>Medium</option><option>Low</option></select></Field>
          </div>
          <Field label="Follow-up instructions"><textarea rows={3} value={form.instructions} onChange={(event) => set("instructions", event.target.value)} className={`${inputCls()} !h-auto resize-y py-2`} /></Field>
          {!isNew && scheduleChanged && <Field label="Reason for rescheduling" required error={errors.scheduleChangeReason}><textarea rows={3} value={form.scheduleChangeReason || ""} onChange={(event) => set("scheduleChangeReason", event.target.value)} aria-invalid={Boolean(errors.scheduleChangeReason)} className={`${inputCls(errors.scheduleChangeReason)} !h-auto resize-y py-2`} placeholder="Explain why this appointment is changing" /></Field>}
          {isNew && <label className="flex items-start gap-2 border-t border-brand-border pt-3 text-ui">
            <input type="checkbox" checked={form.requiresResidentResponse} onChange={(event) => set("requiresResidentResponse", event.target.checked)} className="mt-1 h-4 w-4" />
            <span>Require resident confirmation<span className="mt-0.5 block text-caption text-brand-gray">The resident must confirm before the follow-up is scheduled. A rejection cancels it; the supervisor cannot change the resident's decision.</span></span>
          </label>}
        </div>
        <div className="mt-4 flex justify-end gap-2 border-t border-brand-border pt-3">
          <button type="button" onClick={onClose} disabled={saving} className="supervisor-button">Cancel</button>
          <button type="submit" disabled={saving || (isNew && (residentsLoading || Boolean(residentsError) || !residents.length))} className="supervisor-button is-primary"><CheckCircle2 className="h-4 w-4" aria-hidden="true" />{saving ? "Saving..." : isNew ? "Add schedule" : "Save changes"}</button>
        </div>
      </form>
    </dialog>
  );
}

function ActivityFormModal({ initial, date, residents, residentsLoading, residentsError, onRetryResidents, saving, error, onClose, onSave }) {
  const [form, setForm] = useState(() => ({
    title: initial?.label || "",
    activityType: initial?.activityType || "Reminder",
    date: initial?.date || date,
    time: initial?.time || "",
    notes: initial?.notes || "",
    residentId: initial?.residentId || "",
  }));
  const dialogRef = useRef(null);
  const [errors, setErrors] = useState(/** @type {Record<string, string>} */ ({}));
  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    dialog?.querySelector("input")?.focus();
    return () => dialog?.close();
  }, []);

  const set = (key, value) => {
    setForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: "" }));
  };
  const submit = (event) => {
    event.preventDefault();
    if (saving) return;
    const next = /** @type {Record<string, string>} */ ({});
    if (!form.title.trim()) next.title = "Activity title is required.";
    if (!CALENDAR_ACTIVITY_TYPES.includes(form.activityType)) next.activityType = "Select a valid activity type.";
    if (!parseCalendarDate(form.date)) next.date = "Select a valid date.";
    setErrors(next);
    if (!Object.keys(next).length) onSave(form);
  };

  return (
    <dialog ref={dialogRef} aria-labelledby="calendar-activity-form-title" aria-describedby="calendar-activity-form-description" onCancel={(event) => { event.preventDefault(); if (!saving) onClose(); }} className="supervisor-modal schedule-activity-modal m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%_-_2rem)] max-w-lg overflow-y-auto rounded border border-brand-border bg-card p-4 text-brand-ink backdrop:bg-black/40 sm:p-5">
      <form onSubmit={submit} noValidate className="supervisor-form">
        <div className="mb-4 flex items-start justify-between gap-3 border-b border-brand-border pb-3">
          <div>
            <h2 id="calendar-activity-form-title" className="text-base font-semibold">{initial ? "Edit activity" : "Add Activity"}</h2>
            <p id="calendar-activity-form-description" className="mt-1 text-caption text-brand-gray">A personal calendar activity, visible only to you.</p>
          </div>
          <button type="button" onClick={onClose} disabled={saving} className="supervisor-button is-icon is-quiet" aria-label="Close activity form"><X className="h-4 w-4" aria-hidden="true" /></button>
        </div>
        {error && <p role="alert" className="mb-3 border-l-2 border-brand-danger pl-3 text-ui text-brand-danger">{error}</p>}
        <div className="space-y-4">
          <fieldset className="min-w-0">
            <legend className="mb-2 text-ui font-semibold text-brand-ink">Activity details</legend>
            <div className="space-y-3">
              <Field label="Activity title" required error={errors.title}>
                <input required maxLength={120} value={form.title} onChange={(event) => set("title", event.target.value)} aria-invalid={Boolean(errors.title)} className={inputCls(errors.title)} />
              </Field>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Activity type" required error={errors.activityType}>
                  <select value={form.activityType} onChange={(event) => set("activityType", event.target.value)} aria-invalid={Boolean(errors.activityType)} className={inputCls(errors.activityType)}>
                    {CALENDAR_ACTIVITY_TYPES.map((type) => <option key={type}>{type}</option>)}
                  </select>
                </Field>
                <Field label="Linked resident (optional)">
                  <select value={form.residentId} disabled={residentsLoading || Boolean(residentsError)} onChange={(event) => set("residentId", event.target.value)} className={inputCls()}>
                    <option value="">{residentsLoading ? "Loading residents..." : residentsError ? "Resident list unavailable" : "No linked resident"}</option>
                    {residents.map((resident) => <option key={resident.id} value={resident.id}>{resident.name || "Name not recorded"} / {resident.id}</option>)}
                  </select>
                </Field>
              </div>
              {residentsError && <div className="flex items-center justify-between gap-2 text-caption text-brand-gray"><span>{residentsError}</span><button type="button" onClick={onRetryResidents} disabled={saving || residentsLoading} className="supervisor-button is-quiet schedule-inline-action">Retry</button></div>}
            </div>
          </fieldset>
          <fieldset className="min-w-0">
            <legend className="mb-2 text-ui font-semibold text-brand-ink">Schedule &amp; notes</legend>
            <div className="space-y-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Date" required error={errors.date}>
                  <input required type="date" value={form.date} onChange={(event) => set("date", event.target.value)} aria-invalid={Boolean(errors.date)} className={inputCls(errors.date)} />
                </Field>
                <Field label="Time (optional)">
                  <input type="time" value={form.time} onChange={(event) => set("time", event.target.value)} className={inputCls()} />
                </Field>
              </div>
              <Field label="Notes / description">
                <textarea rows={3} maxLength={2000} value={form.notes} onChange={(event) => set("notes", event.target.value)} className={`${inputCls()} !h-auto resize-y py-2`} />
              </Field>
            </div>
          </fieldset>
        </div>
        <div className="mt-4 flex justify-end gap-2 border-t border-brand-border pt-3">
          <button type="button" onClick={onClose} disabled={saving} className="supervisor-button">Cancel</button>
          <button type="submit" disabled={saving} className="supervisor-button is-primary">{saving ? "Saving..." : "Save Activity"}</button>
        </div>
      </form>
    </dialog>
  );
}

export default function FollowUpCalendar() {
  const { user } = useAuth();
  const { can } = usePermissions();
  const scope = getSupervisorScope(user);
  const assignedBarangay = scope?.level === HS_SCOPE.BARANGAY ? scope.assignedBarangay : null;
  const viewFollowUps = can("followups.view");
  const viewServices = can("services.view");
  const viewActivities = user?.role === "health_supervisor";
  const access = [viewFollowUps, viewServices, viewActivities, can("followups.create"), can("followups.edit"), can("followups.complete")];
  let error = "";
  if (user?.role !== "health_supervisor") error = "Only Health Supervisors can access this schedule calendar.";
  else if (!assignedBarangay) error = "A valid barangay assignment is required. Calendar data is not loaded until your account assignment is available.";
  else if (!viewFollowUps && !viewServices && !viewActivities) error = "Your account does not have permission to view calendar activities.";
  if (error) return <>
    <PageHeader dense crumbs={["Monitoring & Reports", "Schedule Calendar"]} title="Schedule Calendar" subtitle="Follow-ups and health-service attendance for your assigned barangay." />
    <Card><ErrorState compact title="Calendar unavailable" message={error} /></Card>
  </>;

  // Remount on account, scope or capability changes so no previous data or open
  // mutation form survives a change in authorization.
  return <FollowUpCalendarContent key={`${user.id}:${assignedBarangay}:${access.join(":")}`} user={user} assignedBarangay={assignedBarangay} />;
}

function FollowUpCalendarContent({ user, assignedBarangay }) {
  const { can } = usePermissions();
  const canViewFollowUps = can("followups.view");
  const canViewServices = can("services.view");
  const canCreate = canViewFollowUps && can("followups.create");
  const canEdit = canViewFollowUps && can("followups.edit");
  const canComplete = canViewFollowUps && can("followups.complete");
  const canManageActivities = user.role === "health_supervisor";
  const [params] = useSearchParams();
  const requestedDate = params.get("date");
  const requestedView = params.get("view");
  const requestedFollowUp = params.get("followup");
  const [mobile, setMobile] = useState(mobileCalendar);
  const [view, setView] = useState(() => VIEWS.includes(requestedView) ? requestedView : mobileCalendar() ? "agenda" : "month");
  const currentView = mobile && (view === "month" || view === "week") ? "agenda" : view;
  const [cursor, setCursor] = useState(() => initialDate(params));
  const [selectedDay, setSelectedDay] = useState(() => initialDate(params));
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [providerFilter, setProviderFilter] = useState("all");
  const [followUps, setFollowUps] = useState(sourceState);
  const [services, setServices] = useState(sourceState);
  const [calendarActivities, setCalendarActivities] = useState(sourceState);
  const [followUpRefresh, setFollowUpRefresh] = useState(0);
  const [serviceRefresh, setServiceRefresh] = useState(0);
  const [activityRefresh, setActivityRefresh] = useState(0);
  const [linkRefresh, setLinkRefresh] = useState(0);
  const [linkState, setLinkState] = useState({ loading: false, error: "" });
  const [selected, setSelected] = useState(null);
  const [formTarget, setFormTarget] = useState(null);
  const [activityTarget, setActivityTarget] = useState(null);
  const [residents, setResidents] = useState({ rows: [], loading: false, error: "" });
  const [residentRefresh, setResidentRefresh] = useState(0);
  const [saving, setSaving] = useState(false);
  const [activitySaving, setActivitySaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [activityError, setActivityError] = useState("");
  const [detailError, setDetailError] = useState("");
  const [toast, setToast] = useState(null);
  const active = useRef(true);
  const busy = useRef(false);
  const followUpRequest = useRef(0);
  const { lastSyncedAt } = useSyncStatus();
  const range = calendarVisibleRange(cursor, currentView);
  const rangeKey = `${range.from}:${range.to}`;
  const today = parseCalendarDate(manilaDateKey());
  const followUpState = followUps.range === rangeKey ? followUps : sourceState();
  const serviceState = services.range === rangeKey ? services : sourceState();
  const activityState = calendarActivities.range === rangeKey ? calendarActivities : sourceState();

  useEffect(() => {
    active.current = true;
    return () => { active.current = false; followUpRequest.current += 1; };
  }, []);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 767px)");
    const change = (event) => setMobile(event.matches);
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);

  useEffect(() => {
    const date = parseCalendarDate(requestedDate);
    if (date) { setCursor(date); setSelectedDay(date); setSelected(null); }
  }, [requestedDate]);

  useEffect(() => {
    if (VIEWS.includes(requestedView)) setView(requestedView);
  }, [requestedView]);

  useEffect(() => {
    let current = true;
    const request = ++followUpRequest.current;
    const valid = () => current && request === followUpRequest.current;
    if (!canViewFollowUps) return () => { current = false; };
    // Keep this range's retrieved rows visible while a source is refreshed.
    setFollowUps((state) => state.range === rangeKey ? { ...state, loading: true } : { ...sourceState(), range: rangeKey });
    let origin = { source: "cache", error: "" };
    listFollowUpsOffline({ ownerId: user.id, params: { from: range.from, to: range.to }, onSource: (state) => { origin = state; } })
      .then((response) => {
        const rows = readCalendarRows(response, "Follow-ups").map((row) => ({ ...mapFollowUpEvent(row), cached: origin.source === "cache" }))
          .filter((event) => isCalendarEventInBarangay(event, assignedBarangay) && event.date >= range.from && event.date <= range.to);
        if (!valid()) return;
        setFollowUps({ range: rangeKey, rows, loading: false, error: origin.error, source: origin.source });
        setSelected((event) => event?.type === "follow-up" && event.date >= range.from && event.date <= range.to
          ? rows.find((row) => String(row.id) === String(event.id)) || null : event);
      })
      .catch((error) => {
        if (valid()) setFollowUps((state) => ({ ...state, loading: false, error: error?.message || "Unable to load follow-ups." }));
      });
    return () => { current = false; };
  }, [assignedBarangay, canViewFollowUps, followUpRefresh, lastSyncedAt, range.from, range.to, rangeKey, user.id]);

  useEffect(() => {
    let current = true;
    if (!canViewServices) return () => { current = false; };
    setServices((state) => state.range === rangeKey ? { ...state, loading: true } : { ...sourceState(), range: rangeKey });
    healthServicesApi.listAttendance({ from: range.from, to: range.to })
      .then((response) => {
        const rows = readCalendarRows(response, "Health-service attendance").map(mapHealthServiceEvent)
          .filter((event) => isCalendarEventInBarangay(event, assignedBarangay) && event.date >= range.from && event.date <= range.to);
        if (!current) return;
        setServices({ range: rangeKey, rows, loading: false, error: "", source: "server" });
        setSelected((event) => event?.type === "health-service" && event.date >= range.from && event.date <= range.to
          ? rows.find((row) => String(row.id) === String(event.id)) || null : event);
      })
      .catch((error) => {
        if (current) setServices((state) => ({ ...state, loading: false, error: error?.message || "Unable to load health-service attendance." }));
      });
    return () => { current = false; };
  }, [assignedBarangay, canViewServices, lastSyncedAt, range.from, range.to, rangeKey, serviceRefresh]);

  useEffect(() => {
    let current = true;
    if (!canManageActivities) return () => { current = false; };
    setCalendarActivities((state) => state.range === rangeKey ? { ...state, loading: true } : { ...sourceState(), range: rangeKey });
    calendarActivitiesApi.list({ from: range.from, to: range.to })
      .then((response) => {
        const rows = readCalendarRows(response, "Personal calendar activities");
        if (current) setCalendarActivities({ range: rangeKey, rows, loading: false, error: "", source: "server" });
      })
      .catch((error) => {
        if (current) setCalendarActivities((state) => ({ ...state, loading: false, error: error?.message || "Unable to load personal calendar activities." }));
      });
    return () => { current = false; };
  }, [activityRefresh, canManageActivities, range.from, range.to, rangeKey]);

  useEffect(() => {
    let current = true;
    const needsResidentList = formTarget === "new" || activityTarget === "new" || activityTarget?.type === "calendar-activity";
    if (!needsResidentList || (!canCreate && !canManageActivities)) return () => { current = false; };
    setResidents({ rows: [], loading: true, error: "" });
    listFollowUpResidentsOffline({ ownerId: user.id, params: { limit: 200 } })
      .then((response) => {
        const rows = readCalendarRows(response, "Resident directory").map((resident) => ({
          id: resident.id,
          name: [resident.firstName, resident.middleName, resident.lastName].filter(Boolean).join(" ").trim(),
          barangay: resident.barangay || "",
        })).filter((resident) => isCalendarEventInBarangay({ residentBarangay: resident.barangay }, assignedBarangay));
        if (current) setResidents({ rows, loading: false, error: "" });
      })
      .catch((error) => {
        if (current) setResidents({ rows: [], loading: false, error: error?.message || "Unable to load authorized residents." });
      });
    return () => { current = false; };
  }, [activityTarget, assignedBarangay, canCreate, canManageActivities, formTarget, residentRefresh, user.id]);

  useEffect(() => {
    let current = true;
    if (!requestedFollowUp) { setLinkState({ loading: false, error: "" }); return () => { current = false; }; }
    if (!canViewFollowUps) { setLinkState({ loading: false, error: "You do not have permission to open this follow-up." }); return () => { current = false; }; }
    setSelected(null);
    setDetailError("");
    setLinkState({ loading: true, error: "" });
    let origin = { source: "cache", error: "" };
    // The API has no single-record GET. Resolve the actual ID against its
    // authorized list, including pending device records, not a display name.
    listFollowUpsOffline({ ownerId: user.id, onSource: (state) => { origin = state; } })
      .then((response) => {
        const event = readCalendarRows(response, "Follow-ups").map(mapFollowUpEvent)
          .find((row) => String(row.id) === requestedFollowUp && isCalendarEventInBarangay(row, assignedBarangay));
        if (!current) return;
        if (!event) throw new Error(origin.source === "cache"
          ? "This follow-up is not in the authorized records saved on this device. Reconnect to verify its availability."
          : "This follow-up was not found in your assigned barangay or is no longer available.");
        const date = parseCalendarDate(event.date);
        if (!date) throw new Error("This follow-up does not have a valid scheduled date.");
        setCursor(date);
        setSelectedDay(date);
        setSelected({ ...event, cached: origin.source === "cache" });
        setDetailError("");
        setLinkState({ loading: false, error: origin.source === "cache" ? "Opened a saved follow-up. Reconnect to verify the current record." : "" });
      })
      .catch((error) => {
        if (current) setLinkState({ loading: false, error: error?.message || "Unable to open the requested follow-up." });
      });
    return () => { current = false; };
  }, [assignedBarangay, canViewFollowUps, linkRefresh, requestedFollowUp, user.id]);

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState !== "visible") return;
      setFollowUpRefresh((value) => value + 1);
      setServiceRefresh((value) => value + 1);
      setActivityRefresh((value) => value + 1);
    };
    window.addEventListener("focus", refresh);
    window.addEventListener("online", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      window.removeEventListener("online", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(null), 6000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const events = useMemo(() => {
    return [
      ...(canViewFollowUps && followUps.range === rangeKey ? followUps.rows : []),
      ...(canViewServices && services.range === rangeKey ? services.rows : []),
      ...(canManageActivities && activityState.range === rangeKey
        ? activityState.rows.map((row) => mapCalendarActivity(row, residents.rows, assignedBarangay))
        : []),
    ];
  }, [activityState.range, activityState.rows, assignedBarangay, canManageActivities, canViewFollowUps, canViewServices, followUps.range, followUps.rows, rangeKey, residents.rows, services.range, services.rows]);
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return events.filter((event) => {
      if (!isCalendarEventInBarangay(event, assignedBarangay)) return false;
      if (categoryFilter.startsWith("type:") && event.type !== categoryFilter.slice(5)) return false;
      if (categoryFilter.startsWith("category:") && (event.type !== "health-service" || event.category !== categoryFilter.slice(9))) return false;
      if (statusFilter !== "all" && formatCalendarStatus(event.status) !== statusFilter) return false;
      if (providerFilter !== "all" && event.provider !== providerFilter) return false;
      return !query || [event.id, event.residentName, event.residentId, event.label, event.category, event.provider, event.activityType, event.notes]
        .some((value) => String(value || "").toLowerCase().includes(query));
    });
  }, [assignedBarangay, categoryFilter, events, providerFilter, search, statusFilter]);
  const byDay = useMemo(() => buildDayMap(filtered), [filtered]);
  const agendaEvents = useMemo(() => Object.keys(byDay).sort().flatMap((date) => byDay[date]), [byDay]);
  const categories = [...new Set([
    ...events.filter((event) => event.type === "health-service").map((event) => event.category).filter(Boolean),
    ...(categoryFilter.startsWith("category:") ? [categoryFilter.slice(9)] : []),
  ])].sort();
  const statuses = [...new Set([
    ...(canViewFollowUps ? FOLLOW_UP_STATUSES : []), ...events.map((event) => formatCalendarStatus(event.status)),
    ...(statusFilter !== "all" ? [statusFilter] : []),
  ])].sort();
  const providers = [...new Set(events.filter((event) => event.type === "follow-up").map((event) => event.provider).filter(Boolean))].sort();
  const locations = [...new Set(events.filter((event) => event.type === "follow-up").map((event) => event.location).filter(Boolean))].sort();
  const providerOptions = [...new Set([...providers, ...(providerFilter !== "all" ? [providerFilter] : [])])].sort();
  const sources = [canViewFollowUps && followUpState, canViewServices && serviceState, canManageActivities && activityState].filter(Boolean);
  const loading = sources.some((source) => source.loading);
  const incomplete = sources.some((source) => Boolean(source.error) || source.source === "cache");
  const filtersActive = Boolean(search || categoryFilter !== "all" || statusFilter !== "all" || providerFilter !== "all");
  const period = currentView === "month" || currentView === "agenda" ? monthLabel(cursor) : currentView === "week" ? weekLabel(cursor) : dayLabel(cursor);
  const selectedEvent = selected && isCalendarEventInBarangay(selected, assignedBarangay) &&
    (selected.type === "follow-up" ? canViewFollowUps
      : selected.type === "health-service" ? canViewServices
        : canManageActivities) ? selected : null;
  const selectedActions = followUpActionAvailability({ ...selectedEvent, scheduled_date: selectedEvent?.date, scheduled_time: selectedEvent?.time }, { canEdit, canComplete });
  const showToast = (message, error = false) => { if (active.current) setToast({ message, error }); };
  const selectDate = (date) => { setCursor(date); setSelectedDay(date); };
  const clearFilters = () => { setSearch(""); setCategoryFilter("all"); setStatusFilter("all"); setProviderFilter("all"); };
  const retrySources = () => {
    if (canViewFollowUps && (followUpState.error || followUpState.source === "cache")) setFollowUpRefresh((value) => value + 1);
    if (canViewServices && serviceState.error) setServiceRefresh((value) => value + 1);
    if (canManageActivities && activityState.error) setActivityRefresh((value) => value + 1);
  };
  const handleSaveActivity = async (form) => {
    setActivityError("");
    if (!canManageActivities) {
      setActivityError("Only a Health Supervisor can manage personal calendar activities.");
      return;
    }
    if (activitySaving) return;
    setActivitySaving(true);
    try {
      const payload = {
        title: form.title.trim(),
        activityType: form.activityType,
        date: form.date,
        time: form.time || null,
        notes: form.notes.trim() || null,
        residentId: form.residentId || null,
      };
      const result = activityTarget?.type === "calendar-activity"
        ? await calendarActivitiesApi.update(activityTarget.id, payload)
        : await calendarActivitiesApi.create(payload);
      const row = result?.record;
      readCalendarRows(row ? [row] : [], "Saved personal activity");
      const date = parseCalendarDate(row.activity_date);
      if (!date) throw new Error("The saved activity did not include a valid date. Refresh the calendar to verify it.");
      selectDate(date);
      setActivityTarget(null);
      setSelected(null);
      setActivityRefresh((value) => value + 1);
      showToast(activityTarget?.type === "calendar-activity" ? "Activity updated." : "Activity saved.");
    } catch (error) {
      if (active.current) setActivityError(error?.message || "Could not save the activity.");
    } finally {
      if (active.current) setActivitySaving(false);
    }
  };

  const handleDeleteActivity = async (event) => {
    if (!window.confirm(`Delete "${event.label}"? This cannot be undone.`)) return;
    setDetailError("");
    setActivitySaving(true);
    try {
      await calendarActivitiesApi.remove(event.id);
      setCalendarActivities((state) => ({
        ...state,
        rows: state.rows.filter((row) => String(row.id) !== String(event.id)),
      }));
      setSelected(null);
      setActivityRefresh((value) => value + 1);
      showToast("Activity deleted.");
    } catch (error) {
      if (active.current) setDetailError(error?.message || "Could not delete the activity.");
    } finally {
      if (active.current) setActivitySaving(false);
    }
  };

  const persistFollowUp = async ({ target, record, permission, message, resident = null }) => {
    if (busy.current) throw new Error("A follow-up change is already being saved.");
    if (!active.current || !can("followups.view") || !can(permission) || !assignedBarangay) throw new Error("You do not have permission to make this follow-up change.");
    if (target && (target.type !== "follow-up" || !isCalendarEventInBarangay(target, assignedBarangay))) throw new Error("This follow-up is outside your assigned barangay.");
    if (!target && (!resident || !isCalendarEventInBarangay({ residentBarangay: resident.barangay }, assignedBarangay))) throw new Error("Select an authorized resident before scheduling a follow-up.");
    if (target) {
      const actions = followUpActionAvailability({ ...target, scheduled_date: record.scheduled_date || target.date, scheduled_time: record.scheduled_time || target.time }, { canEdit: can("followups.edit"), canComplete: can("followups.complete") });
      if (permission === "followups.edit" && !actions.edit) throw new Error("This follow-up is no longer editable.");
      if (record.status === "Completed" && (!can("followups.complete") || !actions.complete)) throw new Error("This follow-up cannot be completed. Verify its date and resident confirmation.");
      if (record.status === "Missed" && (!can("followups.complete") || !actions.missed)) throw new Error("This follow-up cannot be marked missed. Verify its date and resident confirmation.");
      const revision = Number(target.revision);
      const hasRevision = Number.isInteger(revision) && revision >= 1;
      if (!hasRevision && !target.updatedAt) throw new Error("This follow-up has no current server revision. Refresh the calendar and try again.");
    }
    busy.current = true;
    setSaving(true);
    try {
      const writeRecord = target
        ? { ...record, ...(Number.isInteger(Number(target.revision)) && Number(target.revision) >= 1
          ? { expected_revision: Number(target.revision) }
          : { expected_updated_at: target.updatedAt }) }
        : record;
      const result = target
        ? await updateFollowUpOffline({ ownerId: user.id, followUpId: target.id, record: writeRecord })
        : await createFollowUpOffline({ ownerId: user.id, record });
      if (!active.current) return null;
      const row = result?.record || result;
      readCalendarRows([row], "Saved follow-up");
      // Offline updates return a partial record; merge it with the same actual
      // resident/appointment instead of replacing its identity with defaults.
      const mapped = mapFollowUpEvent({ ...target, ...record, ...row,
        residentName: row.residentName && row.residentName !== "Resident" ? row.residentName : target?.residentName || resident?.name,
        residentBarangay: row.resident?.barangay ?? row.barangay ?? target?.residentBarangay ?? resident?.barangay,
        offline: Boolean(result?.queued || row.offline),
        syncStatus: row.syncStatus || (result?.queued ? "Pending Sync" : ""),
      });
      if (!isCalendarEventInBarangay(mapped, assignedBarangay)) throw new Error("The saved follow-up response is outside your assigned barangay. Refresh the schedule to verify the record.");
      followUpRequest.current += 1;
      setFollowUps((state) => ({ ...state, rows: [mapped, ...state.rows.filter((event) => String(event.id) !== String(mapped.id))]
        .filter((event) => event.date >= range.from && event.date <= range.to) }));
      setFollowUpRefresh((value) => value + 1);
      showToast(result?.queued ? `${message} Saved on this device; it will sync when a connection is available. Resident visibility may await synchronization.` : message);
      return mapped;
    } finally {
      busy.current = false;
      if (active.current) setSaving(false);
    }
  };

  const patchSchedule = async (event, status, message) => {
    try {
      await persistFollowUp({ target: event, record: { status }, permission: ["Completed", "Missed"].includes(status) ? "followups.complete" : "followups.edit", message });
      if (active.current) setSelected(null);
    } catch (error) {
      if (active.current) setDetailError(error?.message || "Could not save the follow-up change.");
    }
  };

  const handleSave = async (form) => {
    setFormError("");
    const isNew = formTarget === "new";
    const resident = isNew ? residents.rows.find((row) => String(row.id) === String(form.residentId)) : null;
    const record = {
      purpose: String(form.purpose).trim(), scheduled_date: form.date, scheduled_time: form.time,
      location: String(form.location || "").trim(), priority: form.priority,
      assigned_provider: String(form.provider).trim(), notes: form.instructions,
      ...(isNew || (!scheduleChanged && form.status !== formTarget?.status) ? { status: form.status } : {}),
      ...(isNew ? { residentId: resident?.id, _offlineBarangay: resident?.barangay || "", _offlineResidentName: resident?.name || "", requiresResidentResponse: form.requiresResidentResponse } : {}),
      ...(!isNew && form.scheduleChangeReason ? { schedule_change_reason: String(form.scheduleChangeReason).trim() } : {}),
    };
    try {
      const event = await persistFollowUp({ target: isNew ? null : formTarget, record, resident,
        permission: isNew ? "followups.create" : "followups.edit", message: isNew ? "Follow-up schedule added." : "Follow-up schedule updated." });
      if (!active.current || !event) return;
      selectDate(parseCalendarDate(event.date));
      setFormTarget(null);
      setSelected(null);
    } catch (error) { if (active.current) setFormError(error?.message || "Could not save the follow-up schedule."); }
  };

  const openEvent = (key) => {
    const event = events.find((row) => calendarEventKey(row) === key);
    if (event) { setDetailError(""); setSelected(event); }
  };

  return (
    <div className="supervisor-module supervisor-calendar min-w-0">
      <PageHeader dense crumbs={["Monitoring & Reports", "Schedule Calendar"]} title="Schedule Calendar"
        subtitle={`${assignedBarangay} / Follow-ups, health-service attendance, and personal activities.`} />

      {requestedDate && !parseCalendarDate(requestedDate) && <p role="alert" className="mb-3 text-ui text-brand-danger">The linked date is invalid. Showing today's calendar instead.</p>}
      {linkState.loading && <p role="status" className="mb-3 text-ui text-brand-gray">Opening the authorized follow-up...</p>}
      {linkState.error && <Card className="mb-3"><ErrorState compact title="Requested follow-up" message={linkState.error} onRetry={canViewFollowUps ? () => setLinkRefresh((value) => value + 1) : undefined} /></Card>}
       
      <div className="supervisor-panel mb-3 px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-section font-semibold text-brand-ink">{monthLabel(cursor)}</h2>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {canCreate && <button type="button" onClick={() => { setFormError(""); setFormTarget("new"); }} className="supervisor-button is-quiet schedule-inline-action">Schedule follow-up</button>}
            <button type="button" onClick={() => selectDate(stepCalendarDate(cursor, "month", -1))} aria-label="Previous month" className="supervisor-button is-icon schedule-nav-action"><ChevronLeft className="h-4 w-4" aria-hidden="true" /></button>
            <button type="button" onClick={() => selectDate(parseCalendarDate(manilaDateKey()))} className="supervisor-button schedule-nav-action">Today</button>
            <button type="button" onClick={() => selectDate(stepCalendarDate(cursor, "month", 1))} aria-label="Next month" className="supervisor-button is-icon schedule-nav-action"><ChevronRight className="h-4 w-4" aria-hidden="true" /></button>
          </div>
        </div>
      </div>

      {/* Filters Section */}
      <section className="supervisor-panel mb-3 p-3" aria-label="Calendar filters">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <label className="min-w-0 text-caption text-brand-gray">
            Search activities
            <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Resident, ID or activity" className="supervisor-input mt-1 w-full" />
          </label>
          <label className="min-w-0 text-caption text-brand-gray">
            Category
            <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)} className="supervisor-input mt-1 w-full">
              <option value="all">All activities</option>
              {canViewFollowUps && <option value="type:follow-up">Follow-ups</option>}
              {canViewServices && <option value="type:health-service">Health services</option>}
              {canManageActivities && <option value="type:calendar-activity">Personal activities</option>}
              {categories.length > 0 && <optgroup label="Health-service categories">{categories.map((category) => <option key={category} value={`category:${category}`}>{category}</option>)}</optgroup>}
            </select>
          </label>
          <label className="min-w-0 text-caption text-brand-gray">
            Status
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="supervisor-input mt-1 w-full">
              <option value="all">All Status</option>
              {statuses.map((status) => <option key={status} value={status}>{status}</option>)}
            </select>
          </label>
          <label className="min-w-0 text-caption text-brand-gray">
            Follow-up provider
            <select value={providerFilter} onChange={(event) => setProviderFilter(event.target.value)} className="supervisor-input mt-1 w-full" disabled={!canViewFollowUps}>
              <option value="all">All providers</option>
              {providerOptions.map((provider) => <option key={provider} value={provider}>{provider}</option>)}
            </select>
          </label>
          <label className="min-w-0 text-caption text-brand-gray">
            Selected date
            <input type="date" value={toDateKey(selectedDay)} onChange={(event) => { const date = parseCalendarDate(event.target.value); if (date) selectDate(date); }} className="supervisor-input mt-1 w-full" />
          </label>
        </div>
        {filtersActive && <div className="mt-3"><button type="button" onClick={clearFilters} className="supervisor-button is-quiet"><X className="h-4 w-4" aria-hidden="true" />Clear filters</button></div>}
      </section>

      <div className="schedule-calendar-layout">
        <MonthView presentation="supervisor" cursor={cursor} today={today} selectedDay={selectedDay} byDay={byDay} onOpenEvent={openEvent} onSelectDay={selectDate} />
        <DayView presentation="supervisor" cursor={selectedDay} byDay={byDay} loading={loading} incomplete={incomplete} onOpenEvent={openEvent}
          incompleteMessage={sources.some((source) => Boolean(source.error)) ? "Some activities could not be loaded." : "Showing saved activities. Retry to verify this date."}
          onRetry={retrySources} filtersActive={filtersActive} onClearFilters={clearFilters}
          canAddActivity={canManageActivities} onAddActivity={() => { setActivityError(""); setActivityTarget("new"); }} />
      </div>

      {selectedEvent && <ScheduleDetailModal presentation="supervisor" schedule={selectedEvent} error={detailError} onClose={() => setSelected(null)} actions={selectedEvent.type === "calendar-activity" ? <>
        <button type="button" disabled={activitySaving} onClick={() => { setActivityError(""); setActivityTarget(selectedEvent); setSelected(null); }} className="supervisor-button is-primary"><Pencil className="h-4 w-4" aria-hidden="true" />Edit</button>
        <button type="button" disabled={activitySaving} onClick={() => handleDeleteActivity(selectedEvent)} className="supervisor-button">Delete</button>
      </> : selectedEvent.type === "follow-up" ? <>
        {selectedActions.complete && <button type="button" disabled={saving} onClick={() => patchSchedule(selectedEvent, "Completed", "Follow-up marked completed.")} className="supervisor-button"><CheckCircle2 className="h-4 w-4" aria-hidden="true" />Complete</button>}
        {selectedActions.missed && <button type="button" disabled={saving} onClick={() => patchSchedule(selectedEvent, "Missed", "Follow-up marked missed.")} className="supervisor-button"><Clock className="h-4 w-4" aria-hidden="true" />Mark missed</button>}
        {selectedActions.cancel && <button type="button" disabled={saving} onClick={() => patchSchedule(selectedEvent, "Cancelled", "Follow-up cancelled.")} className="supervisor-button"><Ban className="h-4 w-4" aria-hidden="true" />Cancel follow-up</button>}
        {selectedActions.edit && <button type="button" disabled={saving} onClick={() => { setFormError(""); setFormTarget(selectedEvent); setSelected(null); }} className="supervisor-button is-primary"><Pencil className="h-4 w-4" aria-hidden="true" />Edit / reschedule</button>}
      </> : <Link to="/app/health_supervisor/services" className="supervisor-button">Open health services</Link>} />}

      {formTarget && <ScheduleFormModal initial={formTarget === "new" ? null : formTarget} date={toDateKey(selectedDay)} residents={residents.rows} residentsLoading={residents.loading} residentsError={residents.error} onRetryResidents={() => setResidentRefresh((value) => value + 1)} providers={providers} locations={locations} canComplete={canComplete} saving={saving} error={formError} onClose={() => { if (!saving) setFormTarget(null); }} onSave={handleSave} />}
      {activityTarget && <ActivityFormModal initial={activityTarget === "new" ? null : activityTarget} date={toDateKey(selectedDay)}
        residents={residents.rows} residentsLoading={residents.loading} residentsError={residents.error}
        onRetryResidents={() => setResidentRefresh((value) => value + 1)} saving={activitySaving} error={activityError}
        onClose={() => { if (!activitySaving) setActivityTarget(null); }} onSave={handleSaveActivity} />}
      {toast && <div role={toast.error ? "alert" : "status"} className="supervisor-panel fixed inset-x-4 bottom-4 z-[80] flex max-w-xl items-start gap-2 p-3 text-ui text-brand-ink shadow-sm sm:left-auto"><span>{toast.message}</span><button type="button" className="supervisor-button is-icon" onClick={() => setToast(null)} aria-label="Dismiss notification"><X className="h-4 w-4" aria-hidden="true" /></button></div>}
    </div>
  );
}
