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
 * Confirm / Can't Attend go through the existing secure endpoints
 * (`/resident/follow-ups/:id/approve|reject`); rejection requires a reason,
 * stored on the canonical follow-up. Residents never edit the appointment
 * itself (date/time/location/provider/instructions).
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
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  const [selected, setSelected] = useState(null); // follow-up id (detail modal)
  const [confirmTarget, setConfirmTarget] = useState(null); // follow-up id
  const [rejectTarget, setRejectTarget] = useState(null); // follow-up id
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
      .then((result) => setRows(result?.rows || []))
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

  const approve = async (id) => {
    setBusy(true);
    try {
      await residentFollowUpsApi.approve(id);
      setConfirmTarget(null); setSelected(null);
      await load();
      showToast("Follow-up confirmed — see you for your scheduled follow-up.");
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
              const actionable = presentation.actionable;
              return (
                <motion.div
                  key={f.id}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: Math.min(i * 0.035, 0.2) }}
                  className="min-w-0 break-words rounded-lg border border-brand-border bg-white p-4 transition-colors hover:border-brand-blue/30 [overflow-wrap:anywhere]"
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
                      {presentation.statusDetail && <span className="max-w-[220px] text-left text-[11px] leading-snug text-brand-gray sm:text-right">{presentation.statusDetail}</span>}
                    </div>
                  </div>

                  {f.instructions && (
                    <div className="mt-4 rounded-md border border-brand-border/70 bg-brand-bg/50 px-3.5 py-3">
                      <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-brand-gray">Instructions from your care team</p>
                      <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-relaxed text-brand-ink">{f.instructions.trim()}</p>
                    </div>
                  )}

                  {f.confirmationStatus === "Rejected" && f.rejectionReason && (
                    <div className="mt-3 rounded-btn border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
                      <span className="font-medium">You rejected this follow-up:</span> {f.rejectionReason}
                    </div>
                  )}

                  {actionable && (
                    <div className="mt-4 flex flex-wrap gap-2 border-t border-brand-border/70 pt-3">
                      <button
                        disabled={busy}
                        onClick={() => setConfirmTarget(f.id)}
                        className="inline-flex items-center gap-1.5 rounded-btn bg-brand-blue px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-60"
                      >
                        <CheckCircle2 className="h-4 w-4" /> Confirm
                      </button>
                      <button
                        disabled={busy}
                        onClick={() => setRejectTarget(f.id)}
                        className="inline-flex items-center gap-1.5 rounded-btn border border-brand-danger/40 bg-white px-4 py-2 text-sm font-medium text-brand-danger hover:bg-brand-danger/5 disabled:opacity-60 dark:bg-card"
                      >
                        <Ban className="h-4 w-4" /> Can't Attend
                      </button>
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
                  onClick={() => { setConfirmTarget(selectedSchedule.id); setSelected(null); }}
                  className="inline-flex items-center gap-1.5 rounded-btn bg-brand-blue px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark"
                >
                  <CheckCircle2 className="h-4 w-4" /> Confirm
                </button>
                <button
                  onClick={() => { setRejectTarget(selectedSchedule.id); setSelected(null); }}
                  className="inline-flex items-center gap-1.5 rounded-btn border border-brand-danger/30 bg-white px-4 py-2 text-sm font-medium text-brand-danger hover:bg-brand-danger/5 dark:bg-card"
                >
                  <Ban className="h-4 w-4" /> Can't Attend
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
          <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-label="Confirm Follow-up">
            <Card className="max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto break-words">
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
                    <CheckCircle2 className="h-4 w-4" /> Confirm
                  </button>
                </div>
              </div>
            </Card>
          </div>
        );
      })()}

      {/* Can't-attend modal — reason required */}
      {rejectTarget && (() => {
        const s = schedules.find((x) => x.id === rejectTarget);
        if (!s) return null;
        return <RejectModal schedule={s} busy={busy} onClose={() => setRejectTarget(null)} onSubmit={(reason) => reject(s.id, reason)} />;
      })()}

      {toast && (
        <div role="status" className="fixed bottom-4 right-4 z-[90] flex max-w-[calc(100vw-2rem)] items-center gap-2 rounded-btn bg-brand-ink px-4 py-3 text-white shadow-lg">
          <CheckCircle2 className="h-4 w-4 text-brand-green" />
          <span className="text-sm">{toast}</span>
        </div>
      )}
    </>
  );
}

/** The existing rejection workflow requires a reason before saving Can't Attend. */
function RejectModal({ schedule, busy, onClose, onSubmit }) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const canSubmit = reason.trim().length > 0 && !busy;
  const submit = () => {
    if (!reason.trim()) { setError("Please provide a reason for rejecting this scheduled follow-up."); return; }
    onSubmit(reason.trim());
  };
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-label="Can't Attend">
      <Card className="max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto break-words">
        <div className="p-6">
          <div className="mb-1 flex items-start justify-between gap-3">
            <div>
              <h3 className="text-lg font-semibold text-brand-ink">Can't Attend</h3>
              <p className="mt-0.5 text-sm text-brand-gray">
                {schedule.purpose || "Follow-up"} · {fmtDate(schedule.date)}{schedule.time ? ` · ${formatTime(schedule.time)}` : ""}
              </p>
            </div>
            <button onClick={onClose} className="text-brand-gray hover:text-brand-ink" aria-label="Close"><X className="h-5 w-5" /></button>
          </div>
          <p className="mt-2 text-sm text-brand-gray">Please tell your health team why you can't attend.</p>
          <div className="mt-4">
            <label htmlFor="follow-up-rejection-reason" className="text-sm font-medium text-brand-ink">Reason <span className="text-brand-danger">*</span></label>
            <textarea
              id="follow-up-rejection-reason"
              rows={4}
              value={reason}
              onChange={(e) => { setReason(e.target.value); if (error) setError(""); }}
              placeholder="Let your health worker know why you can't attend."
              className={`mt-1.5 w-full resize-none rounded-btn border bg-white px-3.5 py-2.5 text-sm outline-none transition-colors focus:border-brand-blue dark:bg-input dark:text-foreground ${error ? "border-brand-danger" : "border-slate-200 dark:border-border"}`}
            />
            {error && <p className="mt-1 text-xs text-brand-danger">{error}</p>}
          </div>
          <div className="mt-6 flex justify-end gap-3 border-t border-slate-200 pt-4 dark:border-border">
            <button onClick={onClose} className="rounded-btn px-4 py-2 text-sm font-medium text-brand-gray hover:bg-brand-bg dark:hover:bg-hover">Cancel</button>
            <button disabled={!canSubmit} onClick={submit} className="inline-flex items-center gap-1.5 rounded-btn bg-brand-danger px-5 py-2 text-sm font-medium text-white hover:bg-brand-danger/90 disabled:opacity-60 disabled:cursor-not-allowed">
              <Ban className="h-4 w-4" /> Submit
            </button>
          </div>
        </div>
      </Card>
    </div>
  );
}
