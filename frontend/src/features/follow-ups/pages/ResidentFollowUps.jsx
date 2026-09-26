import React, { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import PageHeader from "@/components/common/PageHeader";
import { Card } from "@/components/common/Card";
import { residentFollowUpsApi } from "@/services/api";
import ScheduleStatusBadge, { ConfirmationBadge } from "../components/ScheduleStatusBadge";
import {
  Calendar, CheckCircle2, XCircle, Clock, MapPin, User, AlertCircle, Ban, X, CalendarClock, ShieldCheck,
} from "lucide-react";

/**
 * Resident Follow-ups — the resident's own follow-up activities with a real
 * confirmation workflow (approve / reject). Data comes from the resident-safe
 * API (`/resident/follow-ups`); the backend derives ownership from the session,
 * so this page only ever shows the signed-in resident's own follow-ups. A
 * follow-up that requires a response shows an "Action Required" banner with
 * Approve / Reject actions. Rejecting requires a reason.
 *
 * Available to both verified residents and pending (resident-limited) accounts:
 * responding to a follow-up request does not require full verification.
 */

const fmtDate = (d) => {
  if (!d) return "—";
  const parsed = new Date(`${d}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? d : parsed.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
};
const fmtTime = (t) => {
  if (!t) return "";
  const [h, m] = String(t).split(":");
  const hour = ((Number(h) + 11) % 12) + 1;
  const ampm = Number(h) < 12 ? "AM" : "PM";
  return `${hour}:${m ?? "00"} ${ampm}`;
};

const isActionable = (f) =>
  f.requiresResidentResponse && f.status === "Pending" && (f.confirmationStatus || "Awaiting Confirmation") === "Awaiting Confirmation";

export default function ResidentFollowUps() {
  const [followUps, setFollowUps] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [selected, setSelected] = useState(null);
  const [rejectTarget, setRejectTarget] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [toast, setToast] = useState(null);

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(null), 3200); };

  const load = useCallback(() => {
    setLoading(true);
    setLoadError(null);
    return residentFollowUpsApi
      .list()
      .then((result) => setFollowUps(result?.rows || []))
      .catch((err) => setLoadError(err?.message || "Unable to load your follow-ups. Please try again."))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const stats = useMemo(() => ({
    actionRequired: followUps.filter(isActionable).length,
    upcoming: followUps.filter((f) => ["Scheduled", "Upcoming", "Today", "Ongoing"].includes(f.status)).length,
    completed: followUps.filter((f) => f.status === "Completed").length,
    cancelled: followUps.filter((f) => f.status === "Cancelled").length,
  }), [followUps]);

  const sorted = useMemo(
    () => [...followUps].sort((a, b) => {
      if (isActionable(a) !== isActionable(b)) return isActionable(a) ? -1 : 1; // action-required first
      return `${a.scheduledDate}${a.scheduledTime}`.localeCompare(`${b.scheduledDate}${b.scheduledTime}`);
    }),
    [followUps]
  );

  const approve = async (id) => {
    setBusyId(id);
    try {
      await residentFollowUpsApi.approve(id);
      showToast("Follow-up approved — see you at your appointment.");
      setSelected(null);
      await load();
    } catch (err) {
      showToast(err?.message || "Could not approve the follow-up.");
    } finally {
      setBusyId(null);
    }
  };

  const reject = async (id, reason) => {
    setBusyId(id);
    try {
      await residentFollowUpsApi.reject(id, reason);
      showToast("Follow-up rejected — the health team has been notified.");
      setRejectTarget(null);
      setSelected(null);
      await load();
    } catch (err) {
      showToast(err?.message || "Could not reject the follow-up.");
    } finally {
      setBusyId(null);
    }
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
            <Calendar className="w-12 h-12 text-brand-gray/50 mx-auto mb-4" />
            <p className="text-brand-gray">No follow-up appointments have been scheduled yet.</p>
            <p className="mt-1 text-xs text-brand-gray">When your health worker schedules a follow-up, it will appear here.</p>
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
                          <h4 className="font-medium text-brand-ink">{f.purpose || "Follow-up"}</h4>
                          <div className="flex flex-wrap items-center gap-4 mt-2 text-sm text-brand-gray">
                            <span className="flex items-center gap-1"><Calendar className="w-4 h-4" /> {fmtDate(f.scheduledDate)}</span>
                            {f.scheduledTime && <span className="flex items-center gap-1"><Clock className="w-4 h-4" /> {fmtTime(f.scheduledTime)}</span>}
                            {f.location && <span className="flex items-center gap-1"><MapPin className="w-4 h-4" /> {f.location}</span>}
                            {f.assignedProvider && <span className="flex items-center gap-1"><User className="w-4 h-4" /> {f.assignedProvider}</span>}
                          </div>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 sm:flex-col sm:items-end">
                      <ScheduleStatusBadge value={f.status === "Pending" ? "Pending" : f.status} />
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
                        disabled={busyId === f.id}
                        onClick={() => approve(f.id)}
                        className="inline-flex items-center gap-1.5 rounded-btn bg-brand-blue px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-60"
                      >
                        <CheckCircle2 className="h-4 w-4" /> Approve
                      </button>
                      <button
                        disabled={busyId === f.id}
                        onClick={() => setRejectTarget(f)}
                        className="inline-flex items-center gap-1.5 rounded-btn border border-brand-danger/40 bg-white px-4 py-2 text-sm font-medium text-brand-danger hover:bg-brand-danger/5 disabled:opacity-60 dark:bg-card"
                      >
                        <Ban className="h-4 w-4" /> Reject
                      </button>
                    </div>
                  )}
                  {f.confirmationStatus === "Confirmed" && (
                    <p className="mt-3 flex items-center gap-1.5 text-xs font-medium text-brand-green">
                      <ShieldCheck className="h-4 w-4" /> You confirmed this follow-up.
                    </p>
                  )}
                </motion.div>
              );
            })}
          </div>
        )}
      </Card>

      {rejectTarget && (
        <RejectModal
          followUp={rejectTarget}
          busy={busyId === rejectTarget.id}
          onClose={() => setRejectTarget(null)}
          onSubmit={(reason) => reject(rejectTarget.id, reason)}
        />
      )}

      {toast && (
        <div className="fixed bottom-4 right-4 z-[90] flex items-center gap-2 rounded-btn bg-brand-ink px-4 py-3 text-white shadow-lg">
          <CheckCircle2 className="h-4 w-4 text-brand-green" />
          <span className="text-sm">{toast}</span>
        </div>
      )}
    </>
  );
}

function RejectModal({ followUp, busy, onClose, onSubmit }) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const submit = () => {
    if (!reason.trim()) { setError("Please provide a reason for rejecting the follow-up."); return; }
    onSubmit(reason.trim());
  };
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4">
      <Card className="w-full max-w-md">
        <div className="p-6">
          <div className="mb-1 flex items-start justify-between gap-3">
            <div>
              <h3 className="text-lg font-semibold text-brand-ink">Reject Follow-up</h3>
              <p className="mt-0.5 text-sm text-brand-gray">{followUp.purpose} · {fmtDate(followUp.scheduledDate)}</p>
            </div>
            <button onClick={onClose} className="text-brand-gray hover:text-brand-ink" aria-label="Close"><X className="h-5 w-5" /></button>
          </div>
          <div className="mt-4">
            <label className="text-sm font-medium text-brand-ink">Reason for rejecting <span className="text-brand-danger">*</span></label>
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
            <button disabled={busy} onClick={submit} className="inline-flex items-center gap-1.5 rounded-btn bg-brand-danger px-5 py-2 text-sm font-medium text-white hover:bg-brand-danger/90 disabled:opacity-60">
              <Ban className="h-4 w-4" /> Reject Follow-up
            </button>
          </div>
        </div>
      </Card>
    </div>
  );
}
