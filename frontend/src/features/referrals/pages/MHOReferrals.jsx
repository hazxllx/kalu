import React, { useMemo, useState } from "react";
import PageHeader from "@/components/common/PageHeader";
import { Card } from "@/components/common/Card";
import { useReferralTracking, referralTrackingStore } from "@/services/local/referralTrackingStore";
import { ReferralStatusBadge, PriorityBadge, formatDate, formatDateTime, ReferralDrawer } from "./RhuReferrals";
import { useAuth } from "@/context/AuthContext";
import { Search, Send, ChevronRight, CheckCircle2 } from "lucide-react";

const STATUS_OPTIONS = ["All", "Pending", "Accepted", "In Progress", "Completed", "Cancelled"];

/**
 * MHO Referral Tracking.
 *
 * Municipal view over the SHARED referral-tracking store (the same data the
 * RHU Referral Management page manages): list + search + filters, a detail
 * drawer with the referral timeline, tracking notes, and status updates. The
 * MHO monitors referrals across participating barangays without bypassing role
 * permissions — resident-level clinical records stay with the owning roles.
 */
export default function MHOReferrals() {
  const { user } = useAuth();
  const referrals = useReferralTracking();

  const [query, setQuery] = useState("");
  const [barangay, setBarangay] = useState("All");
  const [status, setStatus] = useState("All");
  const [detail, setDetail] = useState(null); // referral id
  const [toast, setToast] = useState(null);

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(null), 3200); };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return referrals
      .filter((r) => barangay === "All" || r.barangay === barangay)
      .filter((r) => status === "All" || r.status === status)
      .filter((r) => !q || r.resident.toLowerCase().includes(q) || r.receivingFacility.toLowerCase().includes(q) || r.reason.toLowerCase().includes(q))
      .sort((a, b) => new Date(b.date) - new Date(a.date));
  }, [referrals, barangay, status, query]);

  const detailRecord = detail ? referrals.find((r) => r.id === detail) : null;

  /** MHO updates referral status / tracking note on the shared store. */
  const handleUpdateStatus = (newStatus, notes) => {
    if (!detailRecord) return;
    referralTrackingStore.updateStatus(detailRecord.id, newStatus, {
      by: user?.name || "MHO",
      notes,
    });
    showToast(`Referral ${detailRecord.id} marked as ${newStatus}.`);
    setDetail(null);
  };

  // Municipality summary of the current filters.
  const counts = useMemo(() => {
    const c = { total: filtered.length, pending: 0, active: 0, completed: 0 };
    filtered.forEach((r) => {
      if (r.status === "Pending") c.pending += 1;
      else if (r.status === "Accepted" || r.status === "In Progress") c.active += 1;
      else if (r.status === "Completed") c.completed += 1;
    });
    return c;
  }, [filtered]);

  return (
    <>
      <PageHeader
        crumbs={["Referrals"]}
        title="Referral Tracking"
        subtitle="Monitor referred residents and track referral progress across participating barangays."
      />

      {toast && (
        <div className="fixed bottom-4 right-4 z-[90] flex items-center gap-2 rounded-btn bg-brand-ink px-4 py-3 text-white shadow-lg">
          <CheckCircle2 className="h-4 w-4 text-brand-green" />
          <span className="text-sm">{toast}</span>
        </div>
      )}

      {/* Municipality summary */}
      <div className="mb-5 grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: "Total Referrals", value: counts.total },
          { label: "Pending", value: counts.pending },
          { label: "Active", value: counts.active },
          { label: "Completed", value: counts.completed },
        ].map((c) => (
          <Card key={c.label} className="flex items-center gap-3 p-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-blue/10 text-brand-blue"><Send className="h-5 w-5" /></div>
            <div className="min-w-0">
              <p className="text-xs text-brand-gray uppercase tracking-wide">{c.label}</p>
              <p className="text-2xl font-semibold text-brand-ink">{c.value}</p>
            </div>
          </Card>
        ))}
      </div>

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 px-5 py-4 dark:border-border">
          <div className="flex min-w-[220px] flex-1 items-center gap-2 rounded-input border border-slate-200 bg-brand-bg/60 px-3.5 py-2.5 dark:border-border dark:bg-input sm:max-w-sm">
            <Search className="h-4 w-4 shrink-0 text-brand-gray" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search resident, facility, or reason..." className="w-full bg-transparent text-sm outline-none placeholder:text-slate-400 dark:placeholder:text-slate-500" />
          </div>
          <select value={barangay} onChange={(e) => setBarangay(e.target.value)} className="rounded-btn border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none dark:border-border dark:bg-input dark:text-foreground">
            <option value="All">All Barangays</option>
            {["San Isidro", "San Antonio", "Old San Roque"].map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
          <select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-btn border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none dark:border-border dark:bg-input dark:text-foreground">
            {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s === "All" ? "All Statuses" : s}</option>)}
          </select>
          <span className="ml-auto text-xs text-brand-gray">{filtered.length} referrals</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm">
            <thead>
              <tr className="bg-brand-bg text-left">
                <th className="px-5 py-3 font-medium text-brand-gray">Reference</th>
                <th className="px-5 py-3 font-medium text-brand-gray">Resident</th>
                <th className="px-5 py-3 font-medium text-brand-gray">Barangay</th>
                <th className="px-5 py-3 font-medium text-brand-gray">Receiving Facility</th>
                <th className="px-5 py-3 font-medium text-brand-gray">Priority</th>
                <th className="px-5 py-3 font-medium text-brand-gray">Referral Date</th>
                <th className="px-5 py-3 font-medium text-brand-gray">Latest Update</th>
                <th className="px-5 py-3 font-medium text-brand-gray">Status</th>
                <th className="px-5 py-3 font-medium text-brand-gray text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-border">
              {filtered.map((r) => {
                const latest = r.history[r.history.length - 1];
                return (
                  <tr key={r.id} className="hover:bg-brand-bg/50">
                    <td className="px-5 py-3 font-medium text-brand-ink">{r.id}</td>
                    <td className="px-5 py-3 font-medium text-brand-ink">{r.resident}</td>
                    <td className="px-5 py-3 text-brand-gray">{r.barangay}</td>
                    <td className="px-5 py-3 text-brand-gray">{r.receivingFacility}</td>
                    <td className="px-5 py-3"><PriorityBadge value={r.priority} /></td>
                    <td className="px-5 py-3 text-brand-gray whitespace-nowrap">{formatDate(r.date)}</td>
                    <td className="px-5 py-3 text-brand-gray whitespace-nowrap">{latest ? formatDateTime(latest.at) : "—"}</td>
                    <td className="px-5 py-3"><ReferralStatusBadge value={r.status} /></td>
                    <td className="px-5 py-3 text-right">
                      <button onClick={() => setDetail(r.id)} className="inline-flex items-center gap-1 text-sm font-medium text-brand-blue hover:underline">
                        Track <ChevronRight className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {filtered.length === 0 && (
          <div className="px-5 py-12 text-center">
            <Send className="mx-auto h-8 w-8 text-brand-gray/50" />
            <p className="mt-3 text-sm font-medium text-brand-ink">No Referrals Found</p>
            <p className="mt-1 text-xs text-brand-gray">No referrals match the current filters.</p>
          </div>
        )}
      </Card>

      {/* Tracking drawer (shared with the RHU management page) */}
      {detailRecord && (
        <ReferralDrawer
          record={detailRecord}
          actor={user?.name || "MHO"}
          onClose={() => setDetail(null)}
          onUpdateStatus={handleUpdateStatus}
        />
      )}
    </>
  );
}
