import React, { useMemo, useState } from "react";
import PageHeader from "@/components/common/PageHeader";
import { Card } from "@/components/common/Card";
import ReviewModal, { ModalSection, ModalRow } from "@/features/users/components/ReviewModal";
import { useStaffRequests, staffRequestStore, REQUEST_STATUSES } from "@/services/mock/staffRequestStore";
import { useAuditEvents, auditStore } from "@/services/mock/auditStore";
import { useAuth } from "@/context/AuthContext";
import { Search, FileText, CheckCircle2, Ban, ChevronRight, FileQuestion } from "lucide-react";

/* Status badge tones shared by the list and detail views. */
const TONES = {
  Pending: "bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400",
  Approved: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400",
  Rejected: "bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-400",
  "Requires Additional Documents": "bg-brand-blue/10 text-brand-blue dark:bg-brand-blue/15",
};

function StatusBadge({ value }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${TONES[value] || TONES.Pending}`}>
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
 * Staff Registration Requests (Admin, frontend only).
 *
 * Review queue with search, status filter, a centered detail modal, and the
 * review actions Approve / Reject / Request Additional Documents. Notes are
 * required when rejecting or requesting documents. Every decision writes an
 * audit event.
 */
export default function StaffRequests() {
  const { user } = useAuth();
  const requests = useStaffRequests();
  const audit = useAuditEvents(); // re-render on audit updates

  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [detail, setDetail] = useState(null); // request id
  const [toast, setToast] = useState(null);

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(null), 3200); };
  // Record each review decision in the shared audit trail.
  const log = (action, description, status = "Success") =>
    auditStore.addEvent({ user: user?.name || "Admin", role: "Admin", action, description, status });

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return requests
      .filter((r) => statusFilter === "All" || r.status === statusFilter)
      .filter((r) => !q || r.name.toLowerCase().includes(q) || r.email.toLowerCase().includes(q) || r.position.toLowerCase().includes(q))
      .sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt));
  }, [requests, query, statusFilter, audit]);

  const detailRecord = detail ? requests.find((r) => r.id === detail) : null;

  /** Apply a review decision from the detail modal. */
  const decide = (status, notes) => {
    if (!detailRecord) return;
    staffRequestStore.setStatus(detailRecord.id, status, { notes, by: user?.name || "Admin" });
    if (status === "Approved") log("Staff request approved", `Approved staff request of ${detailRecord.name}.`);
    if (status === "Rejected") log("Staff request rejected", `Rejected staff request — ${notes}.`, "Warning");
    if (status === "Requires Additional Documents") log("Staff request documents requested", `Requested documents from ${detailRecord.name}.`, "Info");
    showToast(`Request ${detailRecord.id} marked as ${status}.`);
    setDetail(null);
  };

  return (
    <>
      <PageHeader
        crumbs={["Staff Requests"]}
        title="Staff Registration Requests"
        subtitle="Review and process staff account registration requests."
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
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name, email, or position..." className="w-full bg-transparent text-sm outline-none placeholder:text-slate-400 dark:placeholder:text-slate-500" />
          </div>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="rounded-btn border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none dark:border-border dark:bg-input dark:text-foreground">
            <option value="All">All Statuses</option>
            {REQUEST_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <span className="ml-auto text-xs text-brand-gray">{filtered.length} requests</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="bg-brand-bg text-left">
                <th className="px-5 py-3 font-medium text-brand-gray">Request</th>
                <th className="px-5 py-3 font-medium text-brand-gray">Applicant</th>
                <th className="px-5 py-3 font-medium text-brand-gray">Position</th>
                <th className="px-5 py-3 font-medium text-brand-gray">Barangay</th>
                <th className="px-5 py-3 font-medium text-brand-gray">Submitted</th>
                <th className="px-5 py-3 font-medium text-brand-gray">Status</th>
                <th className="px-5 py-3 font-medium text-brand-gray text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-border">
              {filtered.map((r) => (
                <tr key={r.id} className="hover:bg-brand-bg/50">
                  <td className="px-5 py-3 font-medium text-brand-ink">{r.id}</td>
                  <td className="px-5 py-3">
                    <p className="font-medium text-brand-ink">{r.name}</p>
                    <p className="text-xs text-brand-gray">{r.email}</p>
                  </td>
                  <td className="px-5 py-3 text-brand-gray">{r.position}</td>
                  <td className="px-5 py-3 text-brand-gray">{r.barangay || "—"}</td>
                  <td className="px-5 py-3 text-brand-gray whitespace-nowrap">{formatDate(r.submittedAt)}</td>
                  <td className="px-5 py-3"><StatusBadge value={r.status} /></td>
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
            <p className="mt-3 text-sm font-medium text-brand-ink">No Staff Requests Found</p>
            <p className="mt-1 text-xs text-brand-gray">No requests match the current filters.</p>
          </div>
        )}
      </Card>

      {/* Detail + review modal */}
      {detailRecord && <RequestModal record={detailRecord} onClose={() => setDetail(null)} onDecide={decide} />}
    </>
  );
}

/** Centered request detail modal with review actions and required-notes validation. */
function RequestModal({ record, onClose, onDecide }) {
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const pending = record.status === "Pending" || record.status === "Requires Additional Documents";

  const rows = [
    { label: "Applicant", value: `${record.name} (${record.email})` },
    { label: "Contact", value: record.contact },
    { label: "Position", value: record.position },
    { label: "Barangay", value: record.barangay || "—" },
    // Health Personnel applications carry richer professional detail; the
    // seeded demo rows omit these, so they are only shown when present.
    ...(record.role ? [{ label: "Health Personnel Role", value: record.role }] : []),
    ...(record.municipality ? [{ label: "Municipality / LGU", value: record.municipality }] : []),
    ...(record.facility ? [{ label: "Health Facility", value: record.facility }] : []),
    ...(record.department ? [{ label: "Department / Office", value: record.department }] : []),
    ...(record.employmentStatus ? [{ label: "Employment Status", value: record.employmentStatus }] : []),
    ...(record.yearsOfService ? [{ label: "Years of Service", value: record.yearsOfService }] : []),
    ...(record.licenseNumber ? [{ label: "Professional License", value: record.licenseNumber }] : []),
    ...(record.licenseExpiry ? [{ label: "License Expiration", value: formatDate(record.licenseExpiry) }] : []),
    { label: "Submitted", value: formatDate(record.submittedAt) },
    { label: "Reviewed By", value: record.reviewedBy || "—" },
    { label: "Reviewed At", value: record.reviewedAt ? formatDate(record.reviewedAt) : "—" },
  ];

  // Notes are required when rejecting or requesting additional documents.
  const submit = (status) => {
    if ((status === "Rejected" || status === "Requires Additional Documents") && !notes.trim()) {
      setError("Please provide a note for this decision.");
      return;
    }
    onDecide(status, notes.trim());
  };

  return (
    <ReviewModal
      title={record.name}
      subtitle={`${record.id} · ${record.position}`}
      status={<StatusBadge value={record.status} />}
      onClose={onClose}
    >
      <ModalSection label="Request Information">
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

      {record.notes && (
        <p className="rounded-btn bg-brand-bg/60 px-3.5 py-2.5 text-sm text-brand-gray dark:bg-card-nested">
          <span className="font-semibold text-brand-ink">Notes:</span> {record.notes}
        </p>
      )}

      {pending && (
        <section className="rounded-2xl border border-brand-blue/15 bg-brand-light/50 p-4 dark:bg-card-nested">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-brand-gray">Decision</p>
          <textarea
            rows={3}
            value={notes}
            onChange={(e) => { setNotes(e.target.value); if (error) setError(""); }}
            placeholder="Notes / rejection reason (required when rejecting or requesting documents)..."
            className="w-full resize-none rounded-btn border border-slate-200 dark:border-border bg-white dark:bg-input px-3.5 py-2.5 text-sm outline-none focus:border-brand-blue dark:text-foreground"
          />
          {error && <p className="mt-1 text-xs text-brand-danger">{error}</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            <button onClick={() => submit("Approved")} className="inline-flex items-center gap-1.5 rounded-btn bg-brand-blue px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark">
              <CheckCircle2 className="h-4 w-4" /> Approve
            </button>
            <button onClick={() => submit("Requires Additional Documents")} className="inline-flex items-center gap-1.5 rounded-btn border border-brand-border bg-white px-4 py-2 text-sm font-medium text-brand-ink hover:bg-brand-bg dark:bg-card dark:hover:bg-hover">
              <FileQuestion className="h-4 w-4" /> Request Documents
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
