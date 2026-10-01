import React, { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import PageHeader from "@/components/common/PageHeader";
import { Card } from "@/components/common/Card";
import { residentFollowUpsApi } from "@/services/api";
import { ScheduleDetailModal } from "../components/ScheduleCalendarViews";
import ScheduleStatusBadge, { ConfirmationBadge } from "../components/ScheduleStatusBadge";
import { formatTime } from "../lib/scheduleDates";
import { followUpDisplayStatus } from "../lib/scheduleDates";
import {
  Calendar, CalendarDays, CheckCircle2, XCircle, Clock, MapPin, User, AlertCircle, Ban, X, CalendarClock,
} from "lucide-react";

/**
 * My Follow-ups (resident).
 *
 * A single list-based view of the resident's own follow-ups, driven by the
 * canonical resident-safe API (`/resident/follow-ups`). The backend derives
 * ownership from the session, so only the signed-in resident's follow-ups are
 * ever returned (no client-side owner filtering).
 *
 * Confirm / Reject go through the existing secure endpoints
 * (`/resident/follow-ups/:id/approve|reject`); rejection requires a reason,
 * stored on the canonical follow-up. Residents never edit the appointment
 * itself (date/time/location/provider/instructions).
 */

/** A follow-up the resident can still respond to (confirm/reject). */
const isActionable = (f) =>
  ["Scheduled", "Pending"].includes(f.status) &&
  f.confirmationStatus !== "Confirmed" &&
  f.confirmationStatus !== "Rejected";

/** Statuses counted as "Upcoming" (a confirmed/scheduled future visit). */
const UPCOMING_STATUSES = ["Scheduled", "Today"];

/** Human date for a YYYY-MM-DD value, parsed at LOCAL midnight (no UTC shift). */
const fmtDate = (d) => {
  if (!d) return "—";
  const parsed = new Date(`${d}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? d : parsed.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
};

/** Resident-safe follow-up (camelCase) → detail-modal schedule shape. */
const mapToSchedule = (row) => ({
  id: row.id,
  date: row.scheduledDate || "",
  time: row.scheduledTime || "",
  location: row.location || "",
  provider: row.assignedProvider || "",
  instructions: row.instructions || "",
  purpose: row.purpose || "",
  status: followUpDisplayStatus(row.status, row.scheduledDate),
  confirmationStatus: row.confirmationStatus || (row.requiresResidentResponse ? "Awaiting Confirmation" : null),
  respondedAt: row.respondedAt || "",
  rejectionReason: row.rejectionReason || "",
  requiresResidentResponse: row.requiresResidentResponse,
});

export default function ResidentFollowUps() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  const [selected, setSelected] = useState(null); // follow-up id (detail modal)
  const [confirmTarget, setConfirmTarget] = useState(null); // follow-up id
  const [rejectTarget, setRejectTarget] = useState(null); // follow-up id
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState(null);

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(null), 3200); };

  const load = useCallback(() => {
    setLoading(true);
    setLoadError(null);
    return residentFollowUpsApi
      .list()
      .then((result) => setRows(result?.rows || []))
      .catch((err) => setLoadError(err?.message || "Unable to load your follow-ups. Please try again."))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const schedules = useMemo(() => rows.map(mapToSchedule), [rows]);

  const stats = useMemo(() => ({
    actionRequired: rows.filter(isActionable).length,
    // Confirmed/scheduled visits that no longer need a response (mutually
    // exclusive with Action Required so a follow-up is never counted twice).
    upcoming: rows.filter((f) => UPCOMING_STATUSES.includes(followUpDisplayStatus(f.status, f.scheduledDate)) && !isActionable(f)).length,
    completed: rows.filter((f) => f.status === "Completed").length,
    cancelled: rows.filter((f) => f.status === "Cancelled").length,
  }), [rows]);

  const sorted = useMemo(
    () => [...rows].sort((a, b) => {
      if (isActionable(a) !== isActionable(b)) return isActionable(a) ? -1 : 1; // action-required first
      return `${a.scheduledDate}${a.scheduledTime}`.localeCompare(`${b.scheduledDate}${b.scheduledTime}`);
    }),
    [rows]
  );

  const selectedSchedule = selected ? schedules.find((s) => s.id === selected) : null;

  const approve = async (id) => {
    setBusy(true);
    try {
      await residentFollowUpsApi.approve(id);
      setConfirmTarget(null); setSelected(null);
      await load();
      showToast("Follow-up confirmed — see you at your appointment.");
    } catch (err) {
      showToast(err?.message || "Could not confirm the follow-up.");
    } finally { setBusy(false); }
  };

  const reject = async (id, reason) => {
    setBusy(true);
    try {
      await residentFollowUpsApi.reject(id, reason);
      setRejectTarget(null); setSelected(null);
      await load();
      showToast("Follow-up rejected — the health team has been notified.");
    } catch (err) {
      showToast(err?.message || "Could not reject the follow-up.");
    } finally { setBusy(false); }
  };

  const StatCard = ({ icon: Icon, tone, label, value, hint }) => (
    <Card className="p-5">
      <div className="flex items-center gap-3 mb-3">
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${tone}`}>
          <Icon className="w-5 h-5" />
        </div>
        <div>
          <p className="text-sm text-brand-gray">{label}</p>
          <p className="text-2xl font-semibold text-brand-ink mt-1">{value}</p>
        </div>
      </div>
      <p className="text-xs text-brand-gray">{hint}</p>
    </Card>
  );

  return (
    <>
      <PageHeader
        crumbs={["Follow-ups"]}
        title="My Follow-ups"
        subtitle="Review the follow-ups your health team scheduled for you, and confirm or reject the ones that need your response."
      />

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard icon={AlertCircle} tone="bg-amber-100 text-amber-700" label="Action Required" value={stats.actionRequired} hint="Awaiting your response" />
        <StatCard icon={CalendarClock} tone="bg-brand-blue/10 text-brand-blue" label="Upcoming" value={stats.upcoming} hint="Confirmed / scheduled visits" />
        <StatCard icon={CheckCircle2} tone="bg-brand-green/10 text-brand-green" label="Completed" value={stats.completed} hint="Completed visits" />
        <StatCard icon={XCircle} tone="bg-brand-danger/10 text-brand-danger" label="Cancelled" value={stats.cancelled} hint="Rejected / cancelled" />
      </div>

      <Card className="p-6">
        <h3 className="font-semibold text-brand-ink mb-4">Your Follow-up Appointments</h3>

        {loading ? (
          <div className="py-12 text-center">
            <Calendar className="w-10 h-10 text-brand-gray/50 mx-auto mb-3 animate-pulse" />
            <p className="text-sm text-brand-gray">Loading your follow-ups…</p>
          </div>
        ) : loadError ? (
          <div className="py-12 text-center">
            <AlertCircle className="w-10 h-10 text-brand-danger mx-auto mb-3" />
            <p className="text-sm font-medium text-brand-ink">{loadError}</p>
            <button onClick={load} className="mt-4 rounded-btn bg-brand-blue px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark">Try Again</button>
          </div>
        ) : sorted.length === 0 ? (
          <div className="text-center py-12">
            <CalendarDays className="w-12 h-12 text-brand-gray/50 mx-auto mb-4" />
            <p className="text-brand-gray">No follow-up appointments scheduled yet.</p>
            <p className="mt-1 text-xs text-brand-gray">When your health team schedules a follow-up, it will appear here.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {sorted.map((f, i) => {
              const actionable = isActionable(f);
              return (
                <motion.div
                  key={f.id}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.04 }}
                  className={`rounded-xl border p-4 transition-colors ${
                    actionable ? "border-amber-300 bg-amber-50/60 dark:bg-amber-500/5" : "border-brand-border hover:border-brand-blue/30"
                  }`}
                >
                  {actionable && (
                    <div className="mb-3 flex items-center gap-2 rounded-btn bg-amber-100 px-3 py-1.5 text-xs font-semibold text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">
                      <AlertCircle className="h-3.5 w-3.5" /> Action Required — please confirm or reject this follow-up
                    </div>
                  )}
                  <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
                    <div className="flex-1">
                      <div className="flex items-start gap-3">
                        <div className="w-10 h-10 rounded-xl bg-brand-blue/10 flex items-center justify-center shrink-0">
                          <Calendar className="w-5 h-5 text-brand-blue" />
                        </div>
                        <div className="flex-1">
                          <button onClick={() => setSelected(f.id)} className="text-left font-medium text-brand-ink hover:text-brand-blue">
                            {f.purpose || "Follow-up"}
                          </button>
                          <div className="flex flex-wrap items-center gap-4 mt-2 text-sm text-brand-gray">
                            <span className="flex items-center gap-1"><Calendar className="w-4 h-4" /> {fmtDate(f.scheduledDate)}</span>
                            {f.scheduledTime && <span className="flex items-center gap-1"><Clock className="w-4 h-4" /> {formatTime(f.scheduledTime)}</span>}
                            {f.location && <span className="flex items-center gap-1"><MapPin className="w-4 h-4" /> {f.location}</span>}
                            {f.assignedProvider && <span className="flex items-center gap-1"><User className="w-4 h-4" /> {f.assignedProvider}</span>}
                          </div>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 sm:flex-col sm:items-end">
                      <ScheduleStatusBadge value={followUpDisplayStatus(f.status, f.scheduledDate)} />
                      {f.confirmationStatus && <ConfirmationBadge value={f.confirmationStatus} />}
                    </div>
                  </div>

                  {f.instructions && (
                    <p className="mt-3 rounded-btn bg-brand-bg/60 px-3 py-2 text-sm text-brand-ink dark:bg-card-nested">{f.instructions}</p>
                  )}

                  {f.confirmationStatus === "Rejected" && f.rejectionReason && (
                    <div className="mt-3 rounded-btn border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
                      <span className="font-medium">You rejected this follow-up:</span> {f.rejectionReason}
                    </div>
                  )}

                  {actionable && (
                    <div className="mt-4 flex flex-wrap gap-3 border-t border-amber-200/70 pt-3 dark:border-amber-500/20">
                      <button
                        disabled={busy}
                        onClick={() => setConfirmTarget(f.id)}
                        className="inline-flex items-center gap-1.5 rounded-btn bg-brand-blue px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-60"
                      >
                        <CheckCircle2 className="h-4 w-4" /> Confirm Follow-up
                      </button>
                      <button
                        disabled={busy}
                        onClick={() => setRejectTarget(f.id)}
                        className="inline-flex items-center gap-1.5 rounded-btn border border-brand-danger/40 bg-white px-4 py-2 text-sm font-medium text-brand-danger hover:bg-brand-danger/5 disabled:opacity-60 dark:bg-card"
                      >
                        <Ban className="h-4 w-4" /> Reject
                      </button>
                    </div>
                  )}
                </motion.div>
              );
            })}
          </div>
        )}
      </Card>

      {/* Read-only details — residents confirm/reject but never edit the appointment. */}
      {selectedSchedule && (
        <ScheduleDetailModal
          schedule={selectedSchedule}
          variant="resident"
          onClose={() => setSelected(null)}
          actions={
            isActionable(rows.find((r) => r.id === selectedSchedule.id) || {}) ? (
              <>
                <button
                  onClick={() => { setConfirmTarget(selectedSchedule.id); setSelected(null); }}
                  className="inline-flex items-center gap-1.5 rounded-btn bg-brand-blue px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark"
                >
                  <CheckCircle2 className="h-4 w-4" /> Confirm Follow-up
                </button>
                <button
                  onClick={() => { setRejectTarget(selectedSchedule.id); setSelected(null); }}
                  className="inline-flex items-center gap-1.5 rounded-btn border border-brand-danger/30 bg-white px-4 py-2 text-sm font-medium text-brand-danger hover:bg-brand-danger/5 dark:bg-card"
                >
                  <Ban className="h-4 w-4" /> Reject
                </button>
              </>
            ) : null
          }
        />
      )}

      {/* Confirm dialog */}
      {confirmTarget && (() => {
        const s = schedules.find((x) => x.id === confirmTarget);
        if (!s) return null;
        return (
          <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4">
            <Card className="w-full max-w-md">
              <div className="p-6">
                <h3 className="text-lg font-semibold text-brand-ink">Confirm Follow-up</h3>
                <p className="mt-2 text-sm leading-relaxed text-brand-gray">
                  Your health team scheduled this follow-up for you. Confirm that you can attend on{" "}
                  <span className="font-medium text-brand-ink">{fmtDate(s.date)}</span>
                  {s.time ? <> at <span className="font-medium text-brand-ink">{formatTime(s.time)}</span></> : null}
                  {s.location ? <> ({s.location})</> : null}?
                </p>
                <p className="mt-2 text-xs text-brand-gray">The barangay health team will be notified of your confirmation.</p>
                <div className="mt-6 flex justify-end gap-3 border-t border-slate-200 pt-4 dark:border-border">
                  <button onClick={() => setConfirmTarget(null)} className="rounded-btn px-4 py-2 text-sm font-medium text-brand-gray hover:bg-brand-bg dark:hover:bg-hover">Cancel</button>
                  <button disabled={busy} onClick={() => approve(s.id)} className="inline-flex items-center gap-1.5 rounded-btn bg-brand-blue px-5 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-60">
                    <CheckCircle2 className="h-4 w-4" /> Confirm Follow-up
                  </button>
                </div>
              </div>
            </Card>
          </div>
        );
      })()}

      {/* Reject modal — reason required */}
      {rejectTarget && (() => {
        const s = schedules.find((x) => x.id === rejectTarget);
        if (!s) return null;
        return <RejectModal schedule={s} busy={busy} onClose={() => setRejectTarget(null)} onSubmit={(reason) => reject(s.id, reason)} />;
      })()}

      {toast && (
        <div className="fixed bottom-4 right-4 z-[90] flex items-center gap-2 rounded-btn bg-brand-ink px-4 py-3 text-white shadow-lg">
          <CheckCircle2 className="h-4 w-4 text-brand-green" />
          <span className="text-sm">{toast}</span>
        </div>
      )}
    </>
  );
}

/** Rejection modal: reason required (trimmed) before the follow-up can be rejected. */
function RejectModal({ schedule, busy, onClose, onSubmit }) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const canSubmit = reason.trim().length > 0 && !busy;
  const submit = () => {
    if (!reason.trim()) { setError("Please provide a reason for rejecting this scheduled follow-up."); return; }
    onSubmit(reason.trim());
  };
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4">
      <Card className="w-full max-w-md">
        <div className="p-6">
          <div className="mb-1 flex items-start justify-between gap-3">
            <div>
              <h3 className="text-lg font-semibold text-brand-ink">Reject Follow-up</h3>
              <p className="mt-0.5 text-sm text-brand-gray">
                {schedule.purpose || "Follow-up"} · {fmtDate(schedule.date)}{schedule.time ? ` · ${formatTime(schedule.time)}` : ""}
              </p>
            </div>
            <button onClick={onClose} className="text-brand-gray hover:text-brand-ink" aria-label="Close"><X className="h-5 w-5" /></button>
          </div>
          <p className="mt-2 text-sm text-brand-gray">Please provide a reason for rejecting this scheduled follow-up.</p>
          <div className="mt-4">
            <label className="text-sm font-medium text-brand-ink">Reason for rejection <span className="text-brand-danger">*</span></label>
            <textarea
              rows={4}
              value={reason}
              onChange={(e) => { setReason(e.target.value); if (error) setError(""); }}
              placeholder="Let your health worker know why you cannot attend."
              className={`mt-1.5 w-full resize-none rounded-btn border bg-white px-3.5 py-2.5 text-sm outline-none transition-colors focus:border-brand-blue dark:bg-input dark:text-foreground ${error ? "border-brand-danger" : "border-slate-200 dark:border-border"}`}
            />
            {error && <p className="mt-1 text-xs text-brand-danger">{error}</p>}
          </div>
          <div className="mt-6 flex justify-end gap-3 border-t border-slate-200 pt-4 dark:border-border">
            <button onClick={onClose} className="rounded-btn px-4 py-2 text-sm font-medium text-brand-gray hover:bg-brand-bg dark:hover:bg-hover">Cancel</button>
            <button disabled={!canSubmit} onClick={submit} className="inline-flex items-center gap-1.5 rounded-btn bg-brand-danger px-5 py-2 text-sm font-medium text-white hover:bg-brand-danger/90 disabled:opacity-60 disabled:cursor-not-allowed">
              <Ban className="h-4 w-4" /> Reject Follow-up
            </button>
          </div>
        </div>
      </Card>
    </div>
  );
}
