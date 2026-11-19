import React, { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import PageHeader from "@/components/common/PageHeader";
import { Card } from "@/components/common/Card";
import TablePagination from "@/components/tables/TablePagination";
import { residentFollowUpsApi } from "@/services/api";
import { ScheduleDetailModal } from "../components/ScheduleCalendarViews";
import ScheduleStatusBadge from "../components/ScheduleStatusBadge";
import { formatTime } from "../lib/scheduleDates";
import {
  getResidentFollowUpPresentation,
  summarizeResidentFollowUps,
} from "../lib/residentFollowUpPresentation";
import {
  CalendarDays, CheckCircle2, Clock, MapPin, User, AlertCircle, Ban, X,
} from "lucide-react";

/**
 * My Follow-ups (resident).
 *
 * A single list-based view of the resident's own follow-ups, driven by the
 * canonical resident-safe API (`/resident/follow-ups`). The backend derives
 * ownership from the session, so only the signed-in resident's follow-ups are
 * ever returned (no client-side owner filtering).
 *
 * Residents respond through the schedule-request API; they never update the
 * appointment or service progress directly.
 */

const isActionable = (followUp) => getResidentFollowUpPresentation(followUp).actionable;

/** Human date for a YYYY-MM-DD value, parsed at LOCAL midnight (no UTC shift). */
const fmtDate = (d) => {
  if (!d) return "—";
  const parsed = new Date(`${d}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? d : parsed.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
};

/** Resident-safe follow-up (camelCase) → detail-modal schedule shape. */
const mapToSchedule = (row) => {
  const presentation = getResidentFollowUpPresentation(row);
  return {
    id: row.id,
    date: row.scheduledDate || "",
    time: row.scheduledTime || "",
    location: row.location || "",
    provider: row.assignedProvider || "",
    instructions: row.instructions || "",
    purpose: row.purpose || "",
    status: presentation.statusLabel,
    scheduleResponseStatus: row.scheduleResponseStatus || "Awaiting Response",
    statusDetail: presentation.statusDetail,
    confirmationStatus: row.confirmationStatus || (presentation.awaitingResponse ? "Awaiting Confirmation" : null),
    respondedAt: row.respondedAt || "",
    rejectionReason: row.rejectionReason || "",
    requiresResidentResponse: row.requiresResidentResponse,
  };
};

function FollowUpStat({ label, value, hint, tone }) {
  const accent = {
    amber: "border-b-brand-gold",
    blue: "border-b-brand-blue",
    green: "border-b-brand-green",
    red: "border-b-brand-danger",
  }[tone];

  return (
    <div className={`flex min-h-[112px] flex-col gap-1 rounded-lg border border-brand-border border-b-2 bg-white px-4 py-3.5 ${accent}`}>
      <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-brand-gray">{label}</span>
      <span className="font-display text-2xl leading-none text-brand-ink tabular-nums">{value}</span>
      <span className="mt-auto pt-1 text-[11px] leading-snug text-brand-gray">{hint}</span>
    </div>
  );
}

export default function ResidentFollowUps() {
  const [rows, setRows] = useState([]);
  const [referrals, setReferrals] = useState([]);
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  const [selected, setSelected] = useState(null); // follow-up id (detail modal)
  const [rejectTarget, setRejectTarget] = useState(null); // follow-up id
  const [rescheduleTarget, setRescheduleTarget] = useState(null);
  const [scheduleForm, setScheduleForm] = useState({ dateTime: "", reason: "" });
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState(null);
  const [followUpPage, setFollowUpPage] = useState(1);
  const [followUpPageSize, setFollowUpPageSize] = useState(8);

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(null), 3200); };

  const load = useCallback(() => {
    setLoading(true);
    setLoadError(null);
    return residentFollowUpsApi
      .list()
      .then((result) => { setRows(result?.rows || []); setReferrals(result?.referrals || []); setRequests(result?.scheduleRequests || []); })
      .catch((err) => setLoadError(err?.message || "Unable to load your follow-ups. Please try again."))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const schedules = useMemo(() => rows.map(mapToSchedule), [rows]);

  const stats = useMemo(() => summarizeResidentFollowUps(rows), [rows]);

  const sorted = useMemo(
    () => [...rows].sort((a, b) => {
      const priority = { actionRequired: 0, upcoming: 1, completed: 2, cancelled: 3 };
      const aCategory = getResidentFollowUpPresentation(a).category;
      const bCategory = getResidentFollowUpPresentation(b).category;
      if (aCategory !== bCategory) return priority[aCategory] - priority[bCategory];
      return `${a.scheduledDate}${a.scheduledTime}`.localeCompare(`${b.scheduledDate}${b.scheduledTime}`);
    }),
    [rows]
  );
  const pageRows = sorted.slice((followUpPage - 1) * followUpPageSize, followUpPage * followUpPageSize);
  useEffect(() => {
    setFollowUpPage((page) => Math.min(page, Math.max(1, Math.ceil(sorted.length / followUpPageSize))));
  }, [sorted.length, followUpPageSize]);

  const selectedSchedule = selected ? schedules.find((s) => s.id === selected) : null;

  const requestScheduleChange = async ({ targetType, targetId, requestType, proposedSchedule = null, reason = "" }) => {
    setBusy(true);
    try {
      await residentFollowUpsApi.request({ targetType, targetId, requestType, proposedSchedule, reason });
      setRejectTarget(null); setRescheduleTarget(null); setSelected(null);
      await load();
      showToast(requestType === "attendance" ? "Attendance confirmed. Your service is still scheduled." : "Your request was sent to the responsible health team.");
    } catch (err) { showToast(err?.message || "Could not submit your schedule request."); }
    finally { setBusy(false); }
  };

  const requestByTarget = useMemo(() => {
    const latest = new Map();
    for (const request of requests) {
      const key = request.referral_id ? `referral:${request.referral_id}` : `follow_up:${request.follow_up_id}`;
      if (!latest.has(key)) latest.set(key, request);
    }
    return latest;
  }, [requests]);

  return (
    <>
      <PageHeader
        crumbs={["Follow-ups"]}
        title="My Follow-ups"
        subtitle="Review the follow-ups your health team scheduled for you, and respond to appointments that need your attention."
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <FollowUpStat label="Action required" value={stats.actionRequired} hint="Awaiting response, overdue or missed" tone="amber" />
        <FollowUpStat label="Upcoming" value={stats.upcoming} hint="Future appointments" tone="blue" />
        <FollowUpStat label="Completed" value={stats.completed} hint="Finished visits" tone="green" />
        <FollowUpStat label="Cancelled" value={stats.cancelled} hint="Rejected or cancelled" tone="red" />
      </div>

      <section className="space-y-3">
        <h2 className="font-mono text-[10px] uppercase tracking-[0.16em] text-brand-gray">Referrals</h2>
        {referrals.length ? referrals.map((referral) => {
          const request = requestByTarget.get(`referral:${referral.canonicalId || referral.id}`);
          const schedule = referral.scheduledAt ? new Date(referral.scheduledAt).toLocaleString("en-PH", { timeZone: "Asia/Manila", dateStyle: "medium", timeStyle: "short" }) : "Not scheduled";
          const outside = referral.external || !["rhu", "barangay_health_station"].includes(referral.facilityType);
          const open = !["Completed", "Rejected", "Cancelled"].includes(referral.status) && request?.status !== "Pending Approval";
          return <Card key={referral.id} className="p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0"><p className="font-semibold text-brand-ink">{referral.reason || "Referral"}</p><p className="mt-1 text-sm text-brand-gray">{referral.receivingFacility || "Receiving facility unavailable"} · {schedule}</p>{referral.assignedRecipient && <p className="mt-1 text-xs text-brand-gray">Assigned to {referral.assignedRecipient}</p>}</div>
              <div className="flex flex-wrap gap-2 text-xs"><span className="rounded-full bg-brand-blue/10 px-2.5 py-1 text-brand-blue">Schedule: {referral.scheduleResponseStatus}</span><span className="rounded-full bg-brand-bg px-2.5 py-1 text-brand-ink">Progress: {referral.status}</span></div>
            </div>
            {request?.status === "Pending Approval" && <p className="mt-3 text-xs text-brand-gray">Request pending: {request.request_type} · {request.reason}</p>}
            {outside ? <p className="mt-3 text-sm text-amber-700 dark:text-amber-300">Coordinate schedule changes directly with the receiving facility.</p> : open && <div className="mt-3 flex flex-wrap gap-2 border-t border-brand-border pt-3">
              <button disabled={busy || referral.scheduleResponseStatus === "Attendance Confirmed"} onClick={() => requestScheduleChange({ targetType: "referral", targetId: referral.canonicalId || referral.id, requestType: "attendance" })} className="rounded-btn bg-brand-blue px-3 py-2 text-xs font-medium text-white disabled:opacity-50">Confirm Attendance</button>
              <button disabled={busy} onClick={() => { setRescheduleTarget({ targetType: "referral", targetId: referral.canonicalId || referral.id }); setScheduleForm({ dateTime: "", reason: "" }); }} className="rounded-btn border border-brand-border px-3 py-2 text-xs font-medium text-brand-ink disabled:opacity-50">Request Reschedule</button>
              <button disabled={busy} onClick={() => setRejectTarget({ targetType: "referral", targetId: referral.canonicalId || referral.id, purpose: referral.reason, date: schedule })} className="rounded-btn border border-brand-danger/30 px-3 py-2 text-xs font-medium text-brand-danger disabled:opacity-50">Request Cancellation</button>
            </div>}
          </Card>;
        }) : <Card className="p-5 text-sm text-brand-gray">No referrals are linked to your account.</Card>}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-mono text-[10px] uppercase tracking-[0.16em] text-brand-gray">Your follow-ups</h2>

        {loading ? (
          <div className="py-12 text-center">
            <CalendarDays className="w-10 h-10 text-brand-gray/50 mx-auto mb-3 animate-pulse" />
            <p className="text-sm text-brand-gray">Loading your follow-ups…</p>
          </div>
        ) : loadError ? (
          <div className="py-12 text-center">
            <AlertCircle className="w-10 h-10 text-brand-danger mx-auto mb-3" />
            <p className="text-sm font-medium text-brand-ink">{loadError}</p>
            <button onClick={load} className="mt-4 rounded-btn bg-brand-blue px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark">Try Again</button>
          </div>
        ) : sorted.length === 0 ? (
          <>
            <div className="text-center py-12">
              <CalendarDays className="w-10 h-10 text-brand-gray/50 mx-auto mb-3" />
              <p className="text-sm text-brand-gray">No follow-ups scheduled yet.</p>
              <p className="mt-1 text-xs text-brand-gray">When your health team schedules a follow-up, it will appear here.</p>
            </div>
            <TablePagination total={0} page={1} pageSize={followUpPageSize} onPageChange={setFollowUpPage} onPageSizeChange={(size) => { setFollowUpPageSize(size); setFollowUpPage(1); }} className="mt-4" />
          </>
        ) : (
          <>
          <div className="space-y-3">
            {pageRows.map((f, i) => {
              const presentation = getResidentFollowUpPresentation(f);
              const latestScheduleRequest = requestByTarget.get(`follow_up:${f.id}`);
              const actionable = presentation.actionable && latestScheduleRequest?.status !== "Pending Approval";
              return (
                <motion.div
                  key={f.id}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: Math.min(i * 0.035, 0.2) }}
                  className="rounded-lg border border-brand-border bg-white p-4 transition-colors hover:border-brand-blue/30"
                >
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="flex min-w-0 flex-1 items-start gap-3">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-brand-blue/10 bg-brand-blue/5">
                        <CalendarDays className="h-4 w-4 text-brand-blue" aria-hidden="true" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <button onClick={() => setSelected(f.id)} className="text-left font-display text-base font-semibold leading-snug text-brand-ink hover:text-brand-blue">
                            {f.purpose || "Follow-up"}
                        </button>
                        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-brand-gray">
                          <span className="inline-flex items-center gap-1.5"><CalendarDays className="h-3.5 w-3.5 text-brand-blue/70" />{fmtDate(f.scheduledDate)}</span>
                          {f.scheduledTime && <span className="inline-flex items-center gap-1.5"><Clock className="h-3.5 w-3.5 text-brand-blue/70" />{formatTime(f.scheduledTime)}</span>}
                          {f.location && <span className="inline-flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5 text-brand-blue/70" />{f.location}</span>}
                          {f.assignedProvider && <span className="inline-flex items-center gap-1.5"><User className="h-3.5 w-3.5 text-brand-blue/70" />{f.assignedProvider}</span>}
                        </div>
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-col items-start gap-1 sm:items-end">
                      <ScheduleStatusBadge value={presentation.statusLabel} />
                      <span className="rounded-full bg-brand-blue/10 px-2.5 py-1 text-[11px] font-medium text-brand-blue">Schedule: {f.scheduleResponseStatus || "Awaiting Response"}</span>
                      <span className="rounded-full bg-brand-bg px-2.5 py-1 text-[11px] font-medium text-brand-ink">Service: {f.status === "Ongoing" ? "In Progress" : f.status || "Scheduled"}</span>
                      {presentation.statusDetail && <span className="max-w-[220px] text-left text-[11px] leading-snug text-brand-gray sm:text-right">{presentation.statusDetail}</span>}
                    </div>
                  </div>

                  {f.instructions && (
                    <div className="mt-4 rounded-md border border-brand-border/70 bg-brand-bg/50 px-3.5 py-3">
                      <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-brand-gray">Instructions from your care team</p>
                      <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-relaxed text-brand-ink">{f.instructions.trim()}</p>
                    </div>
                  )}

                  {latestScheduleRequest?.status === "Pending Approval" && <p className="mt-3 rounded-btn bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-500/10 dark:text-amber-200">Schedule request pending staff review: {latestScheduleRequest.reason}</p>}

                  {f.confirmationStatus === "Rejected" && f.rejectionReason && (
                    <div className="mt-3 rounded-btn border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
                      <span className="font-medium">You rejected this follow-up:</span> {f.rejectionReason}
                    </div>
                  )}

                  {actionable && (
                    <div className="mt-4 flex flex-wrap gap-2 border-t border-brand-border/70 pt-3">
                      <button
                        disabled={busy || f.scheduleResponseStatus === "Attendance Confirmed"}
                        onClick={() => requestScheduleChange({ targetType: "follow_up", targetId: f.id, requestType: "attendance" })}
                        className="inline-flex items-center gap-1.5 rounded-btn bg-brand-blue px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-60"
                      >
                        <CheckCircle2 className="h-4 w-4" /> Confirm Attendance
                      </button>
                      <button
                        disabled={busy}
                        onClick={() => setRejectTarget({ targetType: "follow_up", targetId: f.id, purpose: f.purpose, date: fmtDate(f.scheduledDate) })}
                        className="inline-flex items-center gap-1.5 rounded-btn border border-brand-danger/40 bg-white px-4 py-2 text-sm font-medium text-brand-danger hover:bg-brand-danger/5 disabled:opacity-60 dark:bg-card"
                      >
                        <Ban className="h-4 w-4" /> Request Cancellation
                      </button>
                      <button disabled={busy} onClick={() => { setRescheduleTarget({ targetType: "follow_up", targetId: f.id }); setScheduleForm({ dateTime: "", reason: "" }); }} className="inline-flex items-center gap-1.5 rounded-btn border border-brand-border bg-white px-4 py-2 text-sm font-medium text-brand-ink hover:bg-brand-bg disabled:opacity-60 dark:bg-card">Request Reschedule</button>
                    </div>
                  )}
                </motion.div>
              );
            })}
          </div>
          <TablePagination total={sorted.length} page={followUpPage} pageSize={followUpPageSize} onPageChange={setFollowUpPage} onPageSizeChange={(size) => { setFollowUpPageSize(size); setFollowUpPage(1); }} className="mt-4" />
          </>
        )}
      </section>

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
                  disabled={busy || selectedSchedule.scheduleResponseStatus === "Attendance Confirmed"}
                  onClick={() => requestScheduleChange({ targetType: "follow_up", targetId: selectedSchedule.id, requestType: "attendance" })}
                  className="inline-flex items-center gap-1.5 rounded-btn bg-brand-blue px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark"
                >
                  <CheckCircle2 className="h-4 w-4" /> Confirm
                </button>
                <button
                  disabled={busy}
                  onClick={() => { setRejectTarget({ targetType: "follow_up", targetId: selectedSchedule.id, purpose: selectedSchedule.purpose, date: selectedSchedule.date }); setSelected(null); }}
                  className="inline-flex items-center gap-1.5 rounded-btn border border-brand-danger/30 bg-white px-4 py-2 text-sm font-medium text-brand-danger hover:bg-brand-danger/5 dark:bg-card"
                >
                  <Ban className="h-4 w-4" /> Request Cancellation
                </button>
                <button disabled={busy} onClick={() => { setRescheduleTarget({ targetType: "follow_up", targetId: selectedSchedule.id }); setScheduleForm({ dateTime: "", reason: "" }); setSelected(null); }} className="rounded-btn border border-brand-border px-4 py-2 text-sm font-medium text-brand-ink">Request Reschedule</button>
              </>
            ) : null
          }
        />
      )}

      {/* Can't-attend modal — reason required */}
      {rejectTarget && (() => {
        return <RejectModal schedule={rejectTarget} busy={busy} onClose={() => setRejectTarget(null)} onSubmit={(reason) => requestScheduleChange({ targetType: rejectTarget.targetType || "follow_up", targetId: rejectTarget.targetId || rejectTarget.id, requestType: "cancellation", reason })} />;
      })()}
      {rescheduleTarget && <RescheduleModal
        value={scheduleForm}
        setValue={setScheduleForm}
        busy={busy}
        onClose={() => setRescheduleTarget(null)}
        onSubmit={() => requestScheduleChange({ targetType: rescheduleTarget.targetType || "follow_up", targetId: rescheduleTarget.targetId || rescheduleTarget.id, requestType: "reschedule", proposedSchedule: scheduleForm.dateTime, reason: scheduleForm.reason })}
      />}

      {toast && (
        <div className="fixed bottom-4 right-4 z-[90] flex items-center gap-2 rounded-btn bg-brand-ink px-4 py-3 text-white shadow-lg">
          <CheckCircle2 className="h-4 w-4 text-brand-green" />
          <span className="text-sm">{toast}</span>
        </div>
      )}
    </>
  );
}

/** Request cancellation while leaving the approved appointment unchanged. */
function RejectModal({ schedule, busy, onClose, onSubmit }) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const canSubmit = reason.trim().length > 0 && !busy;
  const submit = () => {
    if (!reason.trim()) { setError("Please provide a cancellation reason."); return; }
    onSubmit(reason.trim());
  };
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4">
      <Card className="w-full max-w-md">
        <div className="p-6">
          <div className="mb-1 flex items-start justify-between gap-3">
            <div>
              <h3 className="text-lg font-semibold text-brand-ink">Request Cancellation</h3>
              <p className="mt-0.5 text-sm text-brand-gray">{schedule.purpose || "Scheduled service"} · {schedule.date || "Existing schedule"}</p>
            </div>
            <button onClick={onClose} className="text-brand-gray hover:text-brand-ink" aria-label="Close"><X className="h-5 w-5" /></button>
          </div>
          <p className="mt-2 text-sm text-brand-gray">Your schedule remains active until the responsible health team reviews and approves this request.</p>
          <div className="mt-4">
            <label className="text-sm font-medium text-brand-ink">Reason <span className="text-brand-danger">*</span></label>
            <textarea
              rows={4}
              value={reason}
              onChange={(e) => { setReason(e.target.value); if (error) setError(""); }}
              placeholder="Explain why you are requesting cancellation."
              className={`mt-1.5 w-full resize-none rounded-btn border bg-white px-3.5 py-2.5 text-sm outline-none transition-colors focus:border-brand-blue dark:bg-input dark:text-foreground ${error ? "border-brand-danger" : "border-slate-200 dark:border-border"}`}
            />
            {error && <p className="mt-1 text-xs text-brand-danger">{error}</p>}
          </div>
          <div className="mt-6 flex justify-end gap-3 border-t border-slate-200 pt-4 dark:border-border">
            <button onClick={onClose} className="rounded-btn px-4 py-2 text-sm font-medium text-brand-gray hover:bg-brand-bg dark:hover:bg-hover">Cancel</button>
            <button disabled={!canSubmit} onClick={submit} className="inline-flex items-center gap-1.5 rounded-btn bg-brand-danger px-5 py-2 text-sm font-medium text-white hover:bg-brand-danger/90 disabled:opacity-60 disabled:cursor-not-allowed">
              <Ban className="h-4 w-4" /> Send Request
            </button>
          </div>
        </div>
      </Card>
    </div>
  );
}

function RescheduleModal({ value, setValue, busy, onClose, onSubmit }) {
  const [error, setError] = useState("");
  const minDateTime = (() => { const date = new Date(Date.now() + 60_000); return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16); })();
  const submit = () => {
    if (!value.dateTime || value.dateTime <= minDateTime) { setError("Choose a future date and time."); return; }
    if (!value.reason.trim()) { setError("A reason is required."); return; }
    setError(""); onSubmit();
  };
  return <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4"><Card className="w-full max-w-md"><div className="p-6">
    <div className="flex items-start justify-between gap-3"><div><h3 className="text-lg font-semibold text-brand-ink">Request Reschedule</h3><p className="mt-1 text-sm text-brand-gray">Your current appointment stays active until staff approves the proposed time.</p></div><button onClick={onClose} aria-label="Close"><X className="h-5 w-5" /></button></div>
    <label className="mt-4 block text-sm font-medium text-brand-ink">Proposed date and time<input type="datetime-local" min={minDateTime} value={value.dateTime} onChange={(event) => setValue((prior) => ({ ...prior, dateTime: event.target.value }))} className="mt-1.5 w-full rounded-btn border border-brand-border bg-white px-3 py-2 text-sm dark:bg-input" /></label>
    <label className="mt-4 block text-sm font-medium text-brand-ink">Reason<textarea rows={3} value={value.reason} onChange={(event) => setValue((prior) => ({ ...prior, reason: event.target.value }))} className="mt-1.5 w-full rounded-btn border border-brand-border bg-white px-3 py-2 text-sm dark:bg-input" /></label>
    {error && <p className="mt-2 text-xs text-brand-danger">{error}</p>}
    <div className="mt-5 flex justify-end gap-2"><button onClick={onClose} className="rounded-btn px-3 py-2 text-sm text-brand-gray">Back</button><button disabled={busy} onClick={submit} className="rounded-btn bg-brand-blue px-4 py-2 text-sm font-medium text-white disabled:opacity-60">Send Request</button></div>
  </div></Card></div>;
}
