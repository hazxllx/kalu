import React, { useCallback, useEffect, useState } from "react";
import { Trash2, Plus, Loader2, CalendarRange, Ban } from "lucide-react";
import DatePicker from "@/components/common/DatePicker";
import TimePicker from "@/components/common/TimePicker";
import { appointmentsApi } from "@/services/api";
import { WEEKDAYS, formatDate, formatTime, todayISO } from "../lib/appointmentStatus";

/**
 * Compact availability workspace for a selected service: operating days/hours,
 * slot length, per-slot capacity, and closure dates. Role + barangay scope and
 * all validation/concurrency protection are enforced by the backend; existing
 * confirmed appointments are never invalidated by schedule edits. Reuses the
 * same appointmentsApi schedule/closure endpoints — no behavior change.
 */
export default function ScheduleManager({ services, showToast }) {
  const [serviceId, setServiceId] = useState("");
  const [schedules, setSchedules] = useState([]);
  const [blackouts, setBlackouts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(null); // { type: 'schedule'|'closure', id }

  const emptyForm = { weekday: "1", startTime: "08:00", endTime: "12:00", slotMinutes: "30", capacityPerSlot: "1" };
  const [form, setForm] = useState(emptyForm);
  const [blackForm, setBlackForm] = useState({ date: "", reason: "" });

  const load = useCallback(() => {
    if (!serviceId) {
      setSchedules([]);
      setBlackouts([]);
      return;
    }
    setLoading(true);
    setError("");
    Promise.all([appointmentsApi.listSchedules(serviceId), appointmentsApi.listBlackouts(serviceId)])
      .then(([s, b]) => {
        setSchedules(s?.rows || []);
        setBlackouts(b?.rows || []);
      })
      .catch((err) => setError(err?.message || "Unable to load the schedule."))
      .finally(() => setLoading(false));
  }, [serviceId]);

  useEffect(() => {
    load();
  }, [load]);

  const addSchedule = async () => {
    setBusy(true);
    setError("");
    try {
      await appointmentsApi.createSchedule({
        serviceId,
        weekday: Number(form.weekday),
        startTime: form.startTime,
        endTime: form.endTime,
        slotMinutes: Number(form.slotMinutes),
        capacityPerSlot: Number(form.capacityPerSlot),
      });
      showToast?.("Clinic hours added");
      setForm(emptyForm);
      load();
    } catch (err) {
      setError(err?.message || "Could not add the schedule.");
    } finally {
      setBusy(false);
    }
  };

  const removeSchedule = async (id) => {
    setBusy(true);
    setConfirm(null);
    try {
      await appointmentsApi.deleteSchedule(id);
      showToast?.("Clinic hours removed");
      load();
    } catch (err) {
      setError(err?.message || "Could not remove the schedule.");
    } finally {
      setBusy(false);
    }
  };

  const addBlackout = async () => {
    if (!blackForm.date) {
      setError("Select a closure date.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await appointmentsApi.createBlackout({ serviceId, date: blackForm.date, reason: blackForm.reason });
      showToast?.("Closure added");
      setBlackForm({ date: "", reason: "" });
      load();
    } catch (err) {
      setError(err?.message || "Could not add the closure.");
    } finally {
      setBusy(false);
    }
  };

  const removeBlackout = async (id) => {
    setBusy(true);
    setConfirm(null);
    try {
      await appointmentsApi.deleteBlackout(id);
      showToast?.("Closure removed");
      load();
    } catch (err) {
      setError(err?.message || "Could not remove the closure.");
    } finally {
      setBusy(false);
    }
  };

  const inputCls = "h-9 rounded-btn border border-brand-border bg-white px-2.5 text-sm text-brand-ink outline-none focus:border-brand-blue";
  const confirmMatches = (type, id) => confirm && confirm.type === type && confirm.id === id;

  const sortedSchedules = [...schedules].sort((a, b) => a.weekday - b.weekday || a.startTime.localeCompare(b.startTime));
  const sortedBlackouts = [...blackouts].sort((a, b) => a.date.localeCompare(b.date));

  return (
    <div className="overflow-hidden rounded-card border border-brand-border bg-white">
      {/* Service selector header */}
      <div className="flex flex-col gap-2 border-b border-brand-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <CalendarRange className="h-4 w-4 text-brand-blue" />
          <div>
            <p className="text-sm font-semibold text-brand-ink">Service availability</p>
            <p className="text-xs text-brand-gray">Set clinic days, hours, slot length and capacity.</p>
          </div>
        </div>
        <select
          value={serviceId}
          onChange={(e) => setServiceId(e.target.value)}
          className={`${inputCls} w-full sm:w-64`}
          aria-label="Select a service to configure"
        >
          <option value="">Select a service…</option>
          {services.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>

      {!serviceId ? (
        <div className="flex flex-col items-center gap-1.5 px-6 py-10 text-center">
          <CalendarRange className="h-6 w-6 text-brand-gray/60" />
          <p className="text-sm font-semibold text-brand-ink">Choose a service</p>
          <p className="text-xs text-brand-gray">Select a service above to view and manage its availability.</p>
        </div>
      ) : loading ? (
        <div className="flex items-center justify-center gap-2 px-6 py-10 text-sm text-brand-gray">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading schedule…
        </div>
      ) : (
        <>
          {/* Clinic hours */}
          <section className="px-4 py-3">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-brand-gray">Clinic hours</p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-brand-border text-left text-[11px] font-semibold uppercase tracking-wide text-brand-gray">
                    <th className="py-2 pr-3 font-semibold">Day</th>
                    <th className="py-2 pr-3 font-semibold">Hours</th>
                    <th className="py-2 pr-3 font-semibold">Slot</th>
                    <th className="py-2 pr-3 font-semibold">Capacity</th>
                    <th className="py-2" />
                  </tr>
                </thead>
                <tbody>
                  {sortedSchedules.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-3 text-sm text-brand-gray">
                        No clinic hours configured yet.
                      </td>
                    </tr>
                  ) : (
                    sortedSchedules.map((s) => (
                      <tr key={s.id} className="border-b border-slate-100 last:border-0">
                        <td className="whitespace-nowrap py-2 pr-3 font-medium text-brand-ink">{WEEKDAYS[s.weekday]}</td>
                        <td className="whitespace-nowrap py-2 pr-3 text-brand-ink">
                          {formatTime(s.startTime)} – {formatTime(s.endTime)}
                        </td>
                        <td className="py-2 pr-3 text-brand-ink">{s.slotMinutes}m</td>
                        <td className="py-2 pr-3 text-brand-ink">{s.capacityPerSlot}/slot</td>
                        <td className="py-2 text-right">
                          {confirmMatches("schedule", s.id) ? (
                            <span className="inline-flex items-center gap-1.5">
                              <span className="text-xs text-brand-gray">Remove?</span>
                              <button type="button" onClick={() => removeSchedule(s.id)} disabled={busy} className="rounded-btn bg-brand-danger px-2 py-1 text-xs font-medium text-white hover:opacity-90">
                                Yes
                              </button>
                              <button type="button" onClick={() => setConfirm(null)} className="rounded-btn border border-brand-border px-2 py-1 text-xs font-medium text-brand-gray hover:bg-brand-light">
                                No
                              </button>
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setConfirm({ type: "schedule", id: s.id })}
                              disabled={busy}
                              className="rounded-btn p-1.5 text-brand-gray hover:bg-rose-50 hover:text-brand-danger"
                              aria-label="Remove clinic hours"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* Add clinic hours */}
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5 sm:items-end">
              <label className="flex flex-col gap-1 text-[11px] font-medium text-brand-gray">
                Day
                <select value={form.weekday} onChange={(e) => setForm({ ...form, weekday: e.target.value })} className={inputCls}>
                  {WEEKDAYS.map((d, i) => (
                    <option key={d} value={i}>
                      {d}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-[11px] font-medium text-brand-gray">
                Start
                <TimePicker value={form.startTime} onChange={(v) => setForm({ ...form, startTime: v })} />
              </label>
              <label className="flex flex-col gap-1 text-[11px] font-medium text-brand-gray">
                End
                <TimePicker value={form.endTime} onChange={(v) => setForm({ ...form, endTime: v })} />
              </label>
              <label className="flex flex-col gap-1 text-[11px] font-medium text-brand-gray">
                Slot (min)
                <input type="number" min="5" max="480" value={form.slotMinutes} onChange={(e) => setForm({ ...form, slotMinutes: e.target.value })} className={inputCls} />
              </label>
              <label className="flex flex-col gap-1 text-[11px] font-medium text-brand-gray">
                Capacity
                <input type="number" min="1" max="100" value={form.capacityPerSlot} onChange={(e) => setForm({ ...form, capacityPerSlot: e.target.value })} className={inputCls} />
              </label>
              <div className="col-span-2 sm:col-span-5">
                <button
                  type="button"
                  onClick={addSchedule}
                  disabled={busy}
                  className="inline-flex items-center gap-2 rounded-btn bg-brand-blue px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-dark disabled:opacity-60"
                >
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Add Clinic Hours
                </button>
              </div>
            </div>
          </section>

          {/* Closures */}
          <section className="border-t border-brand-border px-4 py-3">
            <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-brand-gray">
              <Ban className="h-3.5 w-3.5" /> Closures
            </p>
            <div className="space-y-1.5">
              {sortedBlackouts.length === 0 ? (
                <p className="text-sm text-brand-gray">No closures scheduled.</p>
              ) : (
                sortedBlackouts.map((b) => (
                  <div key={b.id} className="flex items-center justify-between gap-3 rounded-btn border border-brand-border px-3 py-1.5">
                    <span className="min-w-0 truncate text-sm text-brand-ink">
                      {formatDate(b.date)}
                      {b.reason ? <span className="text-brand-gray"> — {b.reason}</span> : null}
                    </span>
                    {confirmMatches("closure", b.id) ? (
                      <span className="inline-flex shrink-0 items-center gap-1.5">
                        <button type="button" onClick={() => removeBlackout(b.id)} disabled={busy} className="rounded-btn bg-brand-danger px-2 py-1 text-xs font-medium text-white hover:opacity-90">
                          Remove
                        </button>
                        <button type="button" onClick={() => setConfirm(null)} className="rounded-btn border border-brand-border px-2 py-1 text-xs font-medium text-brand-gray hover:bg-brand-light">
                          Keep
                        </button>
                      </span>
                    ) : (
                      <button type="button" onClick={() => setConfirm({ type: "closure", id: b.id })} disabled={busy} className="shrink-0 rounded-btn p-1.5 text-brand-gray hover:bg-rose-50 hover:text-brand-danger" aria-label="Remove closure">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                ))
              )}
            </div>
            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-[11rem_1fr_auto] sm:items-end">
              <label className="flex flex-col gap-1 text-[11px] font-medium text-brand-gray">
                Date
                <DatePicker value={blackForm.date} onChange={(v) => setBlackForm({ ...blackForm, date: v })} min={todayISO()} placeholder="Select…" />
              </label>
              <label className="flex flex-col gap-1 text-[11px] font-medium text-brand-gray">
                Reason (optional)
                <input value={blackForm.reason} onChange={(e) => setBlackForm({ ...blackForm, reason: e.target.value })} maxLength={500} className={inputCls} />
              </label>
              <button
                type="button"
                onClick={addBlackout}
                disabled={busy}
                className="inline-flex h-9 items-center justify-center gap-2 rounded-btn bg-brand-blue px-4 text-sm font-medium text-white transition-colors hover:bg-brand-dark disabled:opacity-60"
              >
                <Plus className="h-4 w-4" /> Add Closure
              </button>
            </div>
          </section>
        </>
      )}

      {error && <p className="border-t border-brand-border px-4 py-2.5 text-sm text-brand-danger">{error}</p>}
    </div>
  );
}
