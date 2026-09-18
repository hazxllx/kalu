import React, { useMemo, useState } from "react";
import PageHeader from "@/components/common/PageHeader";
import { Card } from "@/components/common/Card";
import ReviewModal, { ModalSection, ModalRow } from "@/features/users/components/ReviewModal";
import { useSupervisorVerifications, supervisorVerificationStore, SUPERVISOR_STATUSES } from "@/services/local/supervisorVerificationStore";
import { useAuditEvents, auditStore } from "@/services/local/auditStore";
import { useAuth } from "@/context/AuthContext";
import { Search, ShieldCheck, CheckCircle2, Ban, ChevronRight, FileQuestion, Stethoscope } from "lucide-react";

/* Status badge tones for the verification workflow. */
const TONES = {
  "Pending Verification": "bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400",
  "PHN Endorsed": "bg-brand-blue/10 text-brand-blue dark:bg-brand-blue/15",
  Verified: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400",
  Rejected: "bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-400",
  "Requires Correction": "bg-orange-50 text-orange-700 dark:bg-orange-500/15 dark:text-orange-400",
};

function StatusBadge({ value }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${TONES[value] || TONES["Pending Verification"]}`}>
      <span className="h-2 w-2 rounded-full bg-current opacity-70" /> {value}
    </span>
  );
}

const formatDate = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
};

/**
 * Health Supervisor Account Verification (Admin, frontend only).
 *
 * Separate from resident verification. Admin reviews pending supervisor
 * accounts — assigned barangay, uploaded document status, and the PHN
 * endorsement note — then approves, rejects, or requires correction. A PHN
 * endorsement can also be recorded against an account before the decision.
 */
export default function SupervisorVerifications() {
  const { user } = useAuth();
  const accounts = useSupervisorVerifications();
  const audit = useAuditEvents(); // re-render on audit updates

  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [detail, setDetail] = useState(null); // account id
  const [toast, setToast] = useState(null);

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(null), 3200); };
  // Record every verification decision in the shared audit trail.
  const log = (action, description, status = "Success") =>
    auditStore.addEvent({ user: user?.name || "Admin", role: "Admin", action, description, status });

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return accounts
      .filter((a) => statusFilter === "All" || a.status === statusFilter)
      .filter((a) => !q || a.name.toLowerCase().includes(q) || a.email.toLowerCase().includes(q) || a.assignedBarangay.toLowerCase().includes(q))
      .sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt));
  }, [accounts, query, statusFilter, audit]);

  const detailRecord = detail ? accounts.find((a) => a.id === detail) : null;

  /** Apply an admin decision from the modal. */
  const decide = (status, reason) => {
    if (!detailRecord) return;
    supervisorVerificationStore.setStatus(detailRecord.id, status, { reason, by: user?.name || "Admin" });
    log(
      status === "Verified" ? "Health Supervisor verified" : "Health Supervisor rejected",
      status === "Verified"
        ? `Verified Health Supervisor account of ${detailRecord.name} (${detailRecord.assignedBarangay}).`
        : `${status} for Health Supervisor account of ${detailRecord.name}${reason ? ` — ${reason}` : ""}.`,
      status === "Verified" ? "Success" : "Warning"
    );
    showToast(`Account ${detailRecord.id} marked as ${status}.`);
    setDetail(null);
  };

  /** Record a PHN endorsement note against the account. */
  const endorse = (note) => {
    if (!detailRecord) return;
    supervisorVerificationStore.endorse(detailRecord.id, note, { by: user?.name || "Admin" });
    showToast("PHN endorsement recorded.");
    setDetail(null);
  };

  return (
    <>
      <PageHeader
        crumbs={["Supervisor Verification"]}
        title="Health Supervisor Verification"
        subtitle="Review and verify Health Supervisor accounts and their barangay assignments."
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
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name, email, or barangay..." className="w-full bg-transparent text-sm outline-none placeholder:text-slate-400 dark:placeholder:text-slate-500" />
          </div>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="rounded-btn border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none dark:border-border dark:bg-input dark:text-foreground">
            <option value="All">All Statuses</option>
            {SUPERVISOR_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <span className="ml-auto text-xs text-brand-gray">{filtered.length} accounts</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="bg-brand-bg text-left">
                <th className="px-5 py-3 font-medium text-brand-gray">Account</th>
                <th className="px-5 py-3 font-medium text-brand-gray">Assigned Barangay</th>
                <th className="px-5 py-3 font-medium text-brand-gray">Documents</th>
                <th className="px-5 py-3 font-medium text-brand-gray">Submitted</th>
                <th className="px-5 py-3 font-medium text-brand-gray">Status</th>
                <th className="px-5 py-3 font-medium text-brand-gray text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-border">
              {filtered.map((a) => (
                <tr key={a.id} className="hover:bg-brand-bg/50">
                  <td className="px-5 py-3">
                    <p className="font-medium text-brand-ink">{a.name}</p>
                    <p className="text-xs text-brand-gray">{a.email}</p>
                  </td>
                  <td className="px-5 py-3 text-brand-gray">{a.assignedBarangay}</td>
                  <td className="px-5 py-3">
                    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${a.documentStatus === "Complete" ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400" : "bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400"}`}>
                      {a.documentStatus}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-brand-gray whitespace-nowrap">{formatDate(a.submittedAt)}</td>
                  <td className="px-5 py-3"><StatusBadge value={a.status} /></td>
                  <td className="px-5 py-3 text-right">
                    <button onClick={() => setDetail(a.id)} className="inline-flex items-center gap-1 text-sm font-medium text-brand-blue hover:underline">
                      Review <ChevronRight className="h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {filtered.length === 0 && (
          <div className="px-5 py-12 text-center">
            <ShieldCheck className="mx-auto h-8 w-8 text-brand-gray/50" />
            <p className="mt-3 text-sm font-medium text-brand-ink">No Accounts Found</p>
            <p className="mt-1 text-xs text-brand-gray">No Health Supervisor accounts match the current filters.</p>
          </div>
        )}
      </Card>

      {/* Review modal */}
      {detailRecord && (
        <VerificationModal
          record={detailRecord}
          onClose={() => setDetail(null)}
          onDecide={decide}
          onEndorse={endorse}
        />
      )}
    </>
  );
}

/** Centered account review modal with PHN endorsement and admin decision actions. */
function VerificationModal({ record, onClose, onDecide, onEndorse }) {
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  const actionable = record.status !== "Verified" && record.status !== "Rejected";

  const rows = [
    { label: "Account", value: `${record.name} (${record.email})` },
    { label: "Contact", value: record.contact },
    { label: "Assigned Barangay", value: record.assignedBarangay },
    { label: "Document Status", value: record.documentStatus },
    { label: "Submitted", value: formatDate(record.submittedAt) },
    { label: "Reviewed By", value: record.reviewedBy || "—" },
    { label: "Reviewed At", value: record.reviewedAt ? formatDate(record.reviewedAt) : "—" },
  ];

  // A reason is required when rejecting or requiring correction.
  const submit = (status) => {
    if ((status === "Rejected" || status === "Requires Correction") && !input.trim()) {
      setError("Please provide a reason for this decision.");
      return;
    }
    onDecide(status, input.trim());
  };

  const endorse = () => {
    if (!input.trim()) {
      setError("Please provide a PHN endorsement note.");
      return;
    }
    onEndorse(input.trim());
  };

  return (
    <ReviewModal
      title={record.name}
      subtitle={`${record.id} · ${record.assignedBarangay}`}
      status={<StatusBadge value={record.status} />}
      onClose={onClose}
    >
      <ModalSection label="Account Details">
        <div className="space-y-2">
          {rows.map((r) => <ModalRow key={r.label} label={r.label} value={r.value} />)}
        </div>
      </ModalSection>

      <ModalSection label="Uploaded Documents">
        <div className="space-y-2">
          {record.documents.map((d) => (
            <div key={d} className="flex items-center justify-between gap-3 rounded-btn border border-slate-200 dark:border-border bg-white px-3.5 py-2.5">
              <p className="text-sm font-medium text-brand-ink">{d}</p>
              <CheckCircle2 className="h-4 w-4 shrink-0 text-brand-green" />
            </div>
          ))}
          {record.documents.length === 0 && <p className="text-sm text-brand-gray">No documents uploaded.</p>}
        </div>
      </ModalSection>

      {record.phnNote && (
        <p className="rounded-btn border border-brand-blue/15 bg-brand-light/50 px-3.5 py-2.5 text-sm text-brand-gray dark:bg-card-nested">
          <span className="flex items-center gap-1.5 font-semibold text-brand-ink"><Stethoscope className="h-3.5 w-3.5" /> PHN Endorsement</span>
          <span className="mt-1 block">{record.phnNote}</span>
        </p>
      )}

      {record.reason && (
        <p className="rounded-btn border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-sm text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
          <span className="font-semibold">Reason:</span> {record.reason}
        </p>
      )}

      {actionable && (
        <section className="rounded-2xl border border-brand-blue/15 bg-brand-light/50 p-4 dark:bg-card-nested">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-brand-gray">Review</p>
          <textarea
            rows={3}
            value={input}
            onChange={(e) => { setInput(e.target.value); if (error) setError(""); }}
            placeholder="PHN endorsement note, or the rejection / correction reason..."
            className="w-full resize-none rounded-btn border border-slate-200 dark:border-border bg-white dark:bg-input px-3.5 py-2.5 text-sm outline-none focus:border-brand-blue dark:text-foreground"
          />
          {error && <p className="mt-1 text-xs text-brand-danger">{error}</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            <button onClick={endorse} className="inline-flex items-center gap-1.5 rounded-btn border border-brand-border bg-white px-4 py-2 text-sm font-medium text-brand-ink hover:bg-brand-bg dark:bg-card dark:hover:bg-hover">
              <Stethoscope className="h-4 w-4" /> Record PHN Endorsement
            </button>
            <button onClick={() => submit("Verified")} className="inline-flex items-center gap-1.5 rounded-btn bg-brand-blue px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark">
              <CheckCircle2 className="h-4 w-4" /> Approve
            </button>
            <button onClick={() => submit("Requires Correction")} className="inline-flex items-center gap-1.5 rounded-btn border border-brand-border bg-white px-4 py-2 text-sm font-medium text-brand-gray hover:bg-brand-bg dark:bg-card dark:hover:bg-hover">
              <FileQuestion className="h-4 w-4" /> Require Correction
            </button>
            <button onClick={() => submit("Rejected")} className="inline-flex items-center gap-1.5 rounded-btn border border-brand-danger/30 bg-brand-danger/5 px-4 py-2 text-sm font-medium text-brand-danger hover:bg-brand-danger/10">
              <Ban className="h-4 w-4" /> Reject
            </button>
          </div>
        </section>
      )}
    </ReviewModal>
  );
}
