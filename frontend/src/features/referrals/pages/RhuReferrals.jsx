import React, { useMemo, useState } from "react";
import PageHeader from "@/components/common/PageHeader";
import { Card } from "@/components/common/Card";
import { useReferralTracking, referralTrackingStore, REFERRAL_STATUSES } from "@/services/mock/referralTrackingStore";
import { useAuditEvents } from "@/services/mock/auditStore";
import { Search, FileText, X, CheckCircle2, ChevronRight } from "lucide-react";

/* Status + priority badge tones shared by the RHU and MHO referral pages. */
const STATUS_TONES = {
  Pending: "bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400",
  Accepted: "bg-brand-blue/10 text-brand-blue dark:bg-brand-blue/15",
  "In Progress": "bg-brand-accent/10 text-brand-accent",
  Completed: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400",
  Cancelled: "bg-slate-100 text-slate-500 dark:bg-slate-500/20 dark:text-slate-400",
};
const PRIORITY_TONES = {
  High: "bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-400",
  Medium: "bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400",
  Low: "bg-slate-100 text-slate-600 dark:bg-slate-500/20 dark:text-slate-300",
};

export function ReferralStatusBadge({ value }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_TONES[value] || STATUS_TONES.Pending}`}>
      <span className="h-2 w-2 rounded-full bg-current opacity-70" /> {value}
    </span>
  );
}

export function PriorityBadge({ value }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${PRIORITY_TONES[value] || PRIORITY_TONES.Medium}`}>
      {value}
    </span>
  );
}

export const formatDate = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
};

export const formatDateTime = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
};

/**
 * RHU Referral Management (frontend only).
 *
 * List + search + status/priority filters + detail drawer with an update-status
 * action. Uses the SAME shared referral-tracking store as the MHO tracking
 * page, so both roles always see the same referrals and timeline.
 */
export default function RhuReferrals() {
  const { user } = useAuth();
  const referrals = useReferralTracking();
  const audit = useAuditEvents(); // re-render on audit updates

  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [priorityFilter, setPriorityFilter] = useState("All");
  const [detail, setDetail] = useState(null); // referral id
  const [toast, setToast] = useState(null);

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(null), 3200); };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return referrals
      .filter((r) => statusFilter === "All" || r.status === statusFilter)
      .filter((r) => priorityFilter === "All" || r.priority === priorityFilter)
      .filter((r) => !q || r.resident.toLowerCase().includes(q) || r.receivingFacility.toLowerCase().includes(q) || r.referringPersonnel.toLowerCase().includes(q))
      .sort((a, b) => new Date(b.date) - new Date(a.date));
  }, [referrals, query, statusFilter, priorityFilter, audit]);

  const detailRecord = detail ? referrals.find((r) => r.id === detail) : null;

  /** Update a referral status and append its timeline entry. */
  const handleUpdateStatus = (status, notes) => {
    if (!detailRecord) return;
    referralTrackingStore.updateStatus(detailRecord.id, status, {
      by: user?.name || "RHU Personnel",
      notes,
    });
    showToast(`Referral ${detailRecord.id} marked as ${status}.`);
    setDetail(null);
  };

  return (
    <>
      <PageHeader
        crumbs={["Referrals"]}
        title="Referral Management"
        subtitle="Manage resident referrals to RHU and higher-level healthcare facilities."
      />

      {toast && (
        <div className="fixed bottom-4 right-4 z-[90] flex items-center gap-2 rounded-btn bg-brand-ink px-4 py-3 text-white shadow-lg">
          <CheckCircle2 className="h-4 w-4 text-brand-green" />
          <span className="text-sm">{toast}</span>
        </div>
      )}

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 px-5 py-4 dark:border-border">
          <div className="flex min-w-[220px] flex-1 items-center gap-2 rounded-input border border-slate-200 bg-brand-bg/60 px-3.5 py-2.5 dark:border-border dark:bg-input sm:max-w-sm">
            <Search className="h-4 w-4 shrink-0 text-brand-gray" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search resident, facility, or personnel..." className="w-full bg-transparent text-sm outline-none placeholder:text-slate-400 dark:placeholder:text-slate-500" />
          </div>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="rounded-btn border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none dark:border-border dark:bg-input dark:text-foreground">
            <option value="All">All Statuses</option>
            {REFERRAL_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value)} className="rounded-btn border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none dark:border-border dark:bg-input dark:text-foreground">
            <option value="All">All Priorities</option>
            {["High", "Medium", "Low"].map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          <span className="ml-auto text-xs text-brand-gray">{filtered.length} referrals</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm">
            <thead>
              <tr className="bg-brand-bg text-left">
                <th className="px-5 py-3 font-medium text-brand-gray">Reference</th>
                <th className="px-5 py-3 font-medium text-brand-gray">Resident</th>
                <th className="px-5 py-3 font-medium text-brand-gray">Receiving Facility</th>
                <th className="px-5 py-3 font-medium text-brand-gray">Reason</th>
                <th className="px-5 py-3 font-medium text-brand-gray">Priority</th>
                <th className="px-5 py-3 font-medium text-brand-gray">Date</th>
                <th className="px-5 py-3 font-medium text-brand-gray">Status</th>
                <th className="px-5 py-3 font-medium text-brand-gray text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-border">
              {filtered.map((r) => (
                <tr key={r.id} className="hover:bg-brand-bg/50">
                  <td className="px-5 py-3 font-medium text-brand-ink">{r.id}</td>
                  <td className="px-5 py-3">
                    <p className="font-medium text-brand-ink">{r.resident}</p>
                    <p className="text-xs text-brand-gray">{r.barangay}</p>
                  </td>
                  <td className="px-5 py-3 text-brand-gray">{r.receivingFacility}</td>
                  <td className="px-5 py-3 text-brand-gray">{r.reason}</td>
                  <td className="px-5 py-3"><PriorityBadge value={r.priority} /></td>
                  <td className="px-5 py-3 text-brand-gray whitespace-nowrap">{formatDate(r.date)}</td>
                  <td className="px-5 py-3"><ReferralStatusBadge value={r.status} /></td>
                  <td className="px-5 py-3 text-right">
                    <button onClick={() => setDetail(r.id)} className="inline-flex items-center gap-1 text-sm font-medium text-brand-blue hover:underline">
                      View <ChevronRight className="h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {filtered.length === 0 && (
          <div className="px-5 py-12 text-center">
            <FileText className="mx-auto h-8 w-8 text-brand-gray/50" />
            <p className="mt-3 text-sm font-medium text-brand-ink">No Referrals Found</p>
            <p className="mt-1 text-xs text-brand-gray">No referrals match the current filters.</p>
          </div>
        )}
      </Card>

      {/* Detail drawer with update-status action */}
      {detailRecord && (
        <ReferralDrawer
          record={detailRecord}
          actor={user?.name || "RHU Personnel"}
          onClose={() => setDetail(null)}
          onUpdateStatus={handleUpdateStatus}
        />
      )}
    </>
  );
}

/**
 * Shared referral detail drawer (used by the RHU management page and exported
 * for reuse). Shows full referral info, notes, and the progress timeline, plus
 * an update-status action with an optional tracking note.
 */
export function ReferralDrawer({ record, actor: _actor, onClose, onUpdateStatus }) {
  const [status, setStatus] = useState(record.status);
  const [notes, setNotes] = useState("");

  const rows = [
    { label: "Resident", value: `${record.resident} · ${record.barangay}` },
    { label: "Referring Personnel", value: record.referringPersonnel },
    { label: "Receiving Facility", value: record.receivingFacility },
    { label: "Assigned Personnel", value: record.assignedPersonnel || "—" },
    { label: "Referral Reason", value: record.reason },
    { label: "Referral Date", value: formatDate(record.date) },
    { label: "Latest Update", value: record.history.length ? formatDateTime(record.history[record.history.length - 1].at) : "—" },
  ];

  return (
    <div className="fixed inset-0 z-[70]">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="absolute right-0 top-0 flex h-full w-full max-w-xl flex-col bg-white shadow-2xl dark:bg-card">
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 px-5 py-4 dark:border-border">
          <div className="min-w-0">
            <p className="truncate text-base font-semibold text-brand-ink">{record.id}</p>
            <p className="text-xs text-brand-gray">{record.resident} · {record.receivingFacility}</p>
          </div>
          <div className="flex items-center gap-2">
            <ReferralStatusBadge value={record.status} />
            <button onClick={onClose} className="text-brand-gray hover:text-brand-ink" aria-label="Close"><X className="h-5 w-5" /></button>
          </div>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
          <section className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-border dark:bg-card">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-brand-gray">Referral Details</p>
            <div className="space-y-2">
              {rows.map((r) => (
                <div key={r.label} className="flex items-start justify-between gap-3 text-sm">
                  <p className="shrink-0 text-brand-gray">{r.label}</p>
                  <p className="min-w-0 text-right font-medium text-brand-ink">{r.value}</p>
                </div>
              ))}
            </div>
            {record.notes && (
              <p className="mt-3 rounded-btn bg-brand-bg/60 px-3.5 py-2.5 text-sm text-brand-gray dark:bg-card-nested">
                <span className="font-semibold text-brand-ink">Notes:</span> {record.notes}
              </p>
            )}
          </section>

          {/* Progress timeline */}
          <section className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-border dark:bg-card">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-brand-gray">Referral Progress</p>
            <div className="space-y-3">
              {[...record.history].reverse().map((h, i) => (
                <div key={i} className="flex items-start gap-3">
                  <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${STATUS_TONES[h.status] ? "bg-current " + (STATUS_TONES[h.status].split(" ")[0]) : "bg-slate-300"}`} />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-brand-ink">{h.status}</p>
                    <p className="text-xs text-brand-gray">{h.notes}</p>
                    <p className="text-[11px] text-brand-gray">{h.by} · {formatDateTime(h.at)}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Update status */}
          <section className="rounded-2xl border border-brand-blue/15 bg-brand-light/50 p-4 dark:bg-card-nested">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-brand-gray">Update Status</p>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="w-full rounded-btn border border-slate-200 dark:border-border bg-white dark:bg-input px-3.5 py-2.5 text-sm outline-none cursor-pointer dark:text-foreground"
            >
              {REFERRAL_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional tracking note..."
              className="mt-3 w-full resize-none rounded-btn border border-slate-200 dark:border-border bg-white dark:bg-input px-3.5 py-2.5 text-sm outline-none focus:border-brand-blue dark:text-foreground"
            />
            <div className="mt-3 flex justify-end">
              <button
                onClick={() => onUpdateStatus(status, notes.trim())}
                disabled={status === record.status}
                className="inline-flex items-center gap-1.5 rounded-btn bg-brand-blue px-5 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-50"
              >
                <CheckCircle2 className="h-4 w-4" /> Save Update
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
