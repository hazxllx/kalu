import React, { useState } from "react";
import { X, Loader2 } from "lucide-react";
import { Card } from "@/components/common/Card";
import StatusBadge from "@/components/common/StatusBadge";
import DatePicker from "@/components/common/DatePicker";
import TimePicker from "@/components/common/TimePicker";
import { appointmentsApi } from "@/services/api";
import { statusLabel, formatDate, formatTime, todayISO } from "../lib/appointmentStatus";

/**
 * Staff decision panel for one appointment. Exposes only the actions valid for
 * the current status; the backend re-enforces every transition and barangay
 * scope. Reasons are required where the workflow requires them (decline).
 */
export default function StaffAppointmentModal({ appointment, onClose, onChanged, showToast }) {
  const [mode, setMode] = useState(null); // approve | decline | propose | cancel
  const [date, setDate] = useState("");
  const [time, setTime] = useState("09:00");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (!appointment) return null;
  const appt = appointment;

  const done = (msg, rec) => {
    showToast?.(msg);
    onChanged?.(rec);
    onClose?.();
  };

  const guard = async (fn) => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (err) {
      setError(err?.message || "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const approve = () =>
    guard(async () => {
      const payload = mode === "approve" && date && time ? { date, time } : {};
      const res = await appointmentsApi.approve(appt.id, payload);
      done("Appointment approved", res?.record);
    });

  const decline = () =>
    guard(async () => {
      if (!note.trim()) {
        setError("A reason is required to decline.");
        return;
      }
      const res = await appointmentsApi.decline(appt.id, note.trim());
      done("Request declined", res?.record);
    });

  const propose = () =>
    guard(async () => {
      if (!date || !time) {
        setError("Select a proposed date and time.");
        return;
      }
      const res = await appointmentsApi.propose(appt.id, { date, time, note: note.trim() });
      done("Alternative schedule proposed", res?.record);
    });

  const cancel = () =>
    guard(async () => {
      const res = await appointmentsApi.cancel(appt.id, note.trim());
      done("Appointment cancelled", res?.record);
    });

  const outcome = (status) =>
    guard(async () => {
      const res = await appointmentsApi.outcome(appt.id, status, note.trim());
      done(status === "completed" ? "Marked completed" : "Marked missed", res?.record);
    });

  const Row = ({ label, value }) =>
    value ? (
      <div className="flex justify-between gap-4 py-1.5 text-sm">
        <span className="text-brand-gray">{label}</span>
        <span className="text-right font-medium text-brand-ink">{value}</span>
      </div>
    ) : null;

  const actionBtn =
    "inline-flex items-center gap-2 rounded-btn px-3.5 py-2 text-sm font-medium transition-colors disabled:opacity-60";

  const needsDate = mode === "approve" || mode === "propose";
  const needsNote = mode === "decline" || mode === "propose" || mode === "cancel";

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-label="Manage appointment">
      <Card className="flex max-h-[92vh] w-full max-w-md flex-col overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold text-brand-ink">{appt.service || "Appointment"}</h2>
            <p className="text-xs text-brand-gray">
              {appt.reference} · {appt.resident}
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded-btn p-1.5 text-brand-gray hover:bg-brand-light" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          <div className="mb-2">
            <StatusBadge value={statusLabel(appt.status)} />
          </div>
          <div className="divide-y divide-slate-100">
            <Row label="Resident" value={appt.resident} />
            <Row label="Requested" value={`${formatDate(appt.requestedDate)} · ${formatTime(appt.requestedTime)}`} />
            <Row
              label="Confirmed"
              value={appt.confirmedDate ? `${formatDate(appt.confirmedDate)} · ${formatTime(appt.confirmedTime)}` : ""}
            />
            <Row
              label="Proposed"
              value={appt.proposedDate ? `${formatDate(appt.proposedDate)} · ${formatTime(appt.proposedTime)}` : ""}
            />
            <Row label="Location" value={appt.barangay} />
            <Row label="Reason" value={appt.reason} />
            <Row label="Note" value={appt.decisionReason} />
          </div>

          {mode && (
            <div className="mt-4 space-y-3 rounded-btn border border-brand-border bg-brand-bg px-3.5 py-3">
              {needsDate && (
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-xs font-medium text-brand-ink">{mode === "approve" ? "Confirm date" : "Proposed date"}</label>
                    <div className="mt-1">
                      <DatePicker value={date} onChange={setDate} min={todayISO()} placeholder="Select…" />
                    </div>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-brand-ink">Time</label>
                    <div className="mt-1">
                      <TimePicker value={time} onChange={setTime} />
                    </div>
                  </div>
                </div>
              )}
              {mode === "approve" && (
                <p className="text-xs text-brand-gray">Leave the date empty to confirm the requested schedule.</p>
              )}
              {needsNote && (
                <div>
                  <label className="text-xs font-medium text-brand-ink">
                    {mode === "decline" ? "Reason (required)" : "Note (optional)"}
                  </label>
                  <textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    rows={2}
                    maxLength={500}
                    className="mt-1 w-full resize-none rounded-btn border border-brand-border bg-white px-3 py-2 text-sm outline-none focus:border-brand-blue"
                  />
                </div>
              )}
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setMode(null)} className={`${actionBtn} text-brand-gray hover:bg-brand-light`}>
                  Back
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={mode === "approve" ? approve : mode === "decline" ? decline : mode === "propose" ? propose : cancel}
                  className={`${actionBtn} bg-brand-blue text-white hover:bg-brand-dark`}
                >
                  {busy && <Loader2 className="h-4 w-4 animate-spin" />} Confirm
                </button>
              </div>
            </div>
          )}

          {error && <p className="mt-3 text-sm text-brand-danger">{error}</p>}
        </div>

        {!mode && (
          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-200 px-5 py-4">
            {["pending", "reschedule_proposed"].includes(appt.status) && (
              <>
                <button type="button" onClick={() => setMode("decline")} className={`${actionBtn} border border-brand-danger text-brand-danger hover:bg-rose-50`}>
                  Decline
                </button>
                {appt.status === "pending" && (
                  <button type="button" onClick={() => { setMode("propose"); setDate(appt.requestedDate); setTime(appt.requestedTime || "09:00"); }} className={`${actionBtn} border border-brand-border text-brand-ink hover:bg-brand-light`}>
                    Propose New Time
                  </button>
                )}
                <button type="button" onClick={() => { setMode("approve"); }} className={`${actionBtn} bg-brand-blue text-white hover:bg-brand-dark`}>
                  Approve
                </button>
              </>
            )}
            {appt.status === "approved" && (
              <>
                <button type="button" onClick={() => outcome("missed")} disabled={busy} className={`${actionBtn} border border-brand-border text-brand-ink hover:bg-brand-light`}>
                  Mark Missed
                </button>
                <button type="button" onClick={() => outcome("completed")} disabled={busy} className={`${actionBtn} bg-brand-green text-white hover:opacity-90`}>
                  Mark Completed
                </button>
              </>
            )}
            {["pending", "reschedule_proposed", "approved"].includes(appt.status) && (
              <button type="button" onClick={() => setMode("cancel")} className={`${actionBtn} text-brand-gray hover:bg-brand-light`}>
                Cancel
              </button>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
