import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import PageHeader from "@/components/common/PageHeader";
import { Card } from "@/components/common/Card";
import ReviewModal, { ModalSection, ModalRow } from "@/features/users/components/ReviewModal";
import { staffAccountsApi } from "@/services/api";
import { useAuth } from "@/context/AuthContext";
import { Search, CheckCircle2, Ban, ChevronRight, FileText, Loader2, AlertCircle, ShieldCheck } from "lucide-react";

/* Status badge tones shared by the list and detail views. */
const TONES = {
  pending: "bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400",
  approved: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400",
  rejected: "bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-400",
};

const STATUS_LABELS = { pending: "Pending", approved: "Approved", rejected: "Rejected" };
const STATUS_FILTERS = ["pending", "approved", "rejected", "all"];

const ROLE_LABELS = {
  bhw: "Barangay Health Worker",
  health_supervisor: "Health Supervisor",
  rhu_personnel: "RHU Personnel",
  resident: "Resident",
  phn: "Public Health Nurse",
  mho: "Municipal Health Officer",
};

/**
 * What the signed-in reviewer may approve, matching
 * `backend/src/config/staffApprovals.js`. The server enforces the same rule and
 * returns 403 for anything outside it; this copy is only used to explain the
 * page to the reviewer.
 */
const APPROVAL_AUTHORITY = {
  phn: ["Health Supervisor", "RHU Personnel"],
  health_supervisor: ["BHW", "Resident"],
};

function StatusBadge({ value }) {
  const tone = TONES[value] || TONES.pending;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${tone}`}>
      <span className="h-2 w-2 rounded-full bg-current opacity-70" /> {STATUS_LABELS[value] || value}
    </span>
  );
}

const formatDate = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? String(iso)
    : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
};

const shortId = (id) => (id ? String(id).slice(0, 8).toUpperCase() : "—");

/**
 * Health Personnel Account Approvals (PHN and Health Supervisor).
 *
 * Replaces the browser-only `StaffRequests` / `SupervisorVerifications` pages,
 * which wrote decisions to local storage that no other role could see and that
 * never touched a real account. This queue is served by
 * `GET /api/staff-accounts/queue`, which returns only the request roles the
 * signed-in reviewer is responsible for, and every decision goes through
 * `POST /api/staff-accounts/:id/approve|reject` so the profile is actually
 * activated (or locked) and a real `health_audit_logs` entry is written.
 *
 *   PHN               approves Health Supervisor and RHU Personnel accounts
 *   Health Supervisor approves BHW and Resident accounts
 *   System Admin / MHO have no approval queue and 403 on every route here.
 */
export default function StaffAccountApprovals() {
  const { user } = useAuth();
  const roleKey = user?.role;

  const [rows, setRows] = useState([]);
  const [status, setStatus] = useState("pending");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [detailId, setDetailId] = useState(null);
  const [toast, setToast] = useState(null);

  // Only re-query when a filter actually changes; typing filters the loaded
  // rows locally so the reviewer is not firing a request per keystroke.
  const load = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const payload = await staffAccountsApi.listQueue({ status, limit: 200 });
      setRows(payload?.rows || []);
    } catch (err) {
      setRows([]);
      setLoadError(err?.message || "The approval queue could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.fullName?.toLowerCase().includes(q) ||
        r.email?.toLowerCase().includes(q) ||
        r.licenseNo?.toLowerCase().includes(q),
    );
  }, [rows, query]);

  const detailRecord = detailId ? rows.find((r) => r.id === detailId) || null : null;

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3200);
  };

  /** Apply a decision, then reload so the row shows its real new state. */
  const decide = async (record, decision, reason) => {
    if (decision === "reject" && !reason.trim()) {
      throw new Error("A rejection reason is required.");
    }
    if (decision === "approve") {
      await staffAccountsApi.approve(record.id, reason.trim() ? { remarks: reason.trim() } : {});
    } else {
      await staffAccountsApi.reject(record.id, { reason: reason.trim() });
    }
    setDetailId(null);
    showToast(
      decision === "approve"
        ? `${record.fullName} approved — the account is now active and can sign in.`
        : `${record.fullName} rejected. The account remains locked.`,
    );
    await load();
  };

  const authority = APPROVAL_AUTHORITY[roleKey] || [];

  return (
    <>
      <PageHeader
        crumbs={["Account Approvals"]}
        title="Health Personnel Account Approvals"
        subtitle={
          authority.length
            ? `You approve ${authority.join(" and ")} accounts. Approving an account activates it immediately.`
            : "Your role is not an account approval authority."
        }
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
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search name, email, or license..."
              className="w-full bg-transparent text-sm outline-none placeholder:text-slate-400 dark:placeholder:text-slate-500"
            />
          </div>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="rounded-btn border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none dark:border-border dark:bg-input dark:text-foreground"
          >
            {STATUS_FILTERS.map((s) => (
              <option key={s} value={s}>{s === "all" ? "All Statuses" : STATUS_LABELS[s]}</option>
            ))}
          </select>
          <span className="ml-auto text-xs text-brand-gray">
            {loading ? "Loading..." : `${filtered.length} request${filtered.length === 1 ? "" : "s"}`}
          </span>
        </div>

        {loadError && (
          <div className="flex items-center gap-2 border-b border-brand-danger/20 bg-brand-danger/5 px-5 py-3 text-sm text-brand-danger">
            <AlertCircle className="h-4 w-4 shrink-0" /> {loadError}
          </div>
        )}

        {!loadError && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="bg-brand-bg text-left">
                  <th className="px-5 py-3 font-medium text-brand-gray">Reference</th>
                  <th className="px-5 py-3 font-medium text-brand-gray">Applicant</th>
                  <th className="px-5 py-3 font-medium text-brand-gray">Role</th>
                  <th className="px-5 py-3 font-medium text-brand-gray">Assignment</th>
                  <th className="px-5 py-3 font-medium text-brand-gray">Submitted</th>
                  <th className="px-5 py-3 font-medium text-brand-gray">Status</th>
                  <th className="px-5 py-3 text-right font-medium text-brand-gray">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-border">
                {filtered.map((r) => (
                  <tr key={r.id} className="hover:bg-brand-bg/50">
                    <td className="px-5 py-3 font-mono text-xs text-brand-gray">{shortId(r.id)}</td>
                    <td className="px-5 py-3">
                      <p className="font-medium text-brand-ink">{r.fullName}</p>
                      <p className="text-xs text-brand-gray">{r.email}</p>
                    </td>
                    <td className="px-5 py-3 text-brand-gray">{ROLE_LABELS[r.role] || r.position || "—"}</td>
                    <td className="px-5 py-3 text-brand-gray">{r.barangay || r.facility || "—"}</td>
                    <td className="whitespace-nowrap px-5 py-3 text-brand-gray">{formatDate(r.submittedAt)}</td>
                    <td className="px-5 py-3"><StatusBadge value={r.status} /></td>
                    <td className="px-5 py-3 text-right">
                      <button
                        onClick={() => setDetailId(r.id)}
                        className="inline-flex items-center gap-1 text-sm font-medium text-brand-blue hover:underline"
                      >
                        View <ChevronRight className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {!loading && !loadError && filtered.length === 0 && (
          <div className="px-5 py-12 text-center">
            {authority.length ? (
              <ShieldCheck className="mx-auto h-8 w-8 text-brand-gray/50" />
            ) : (
              <AlertCircle className="mx-auto h-8 w-8 text-brand-gray/50" />
            )}
            <p className="mt-3 text-sm font-medium text-brand-ink">
              {authority.length ? "No Account Requests Found" : "Not an Approval Authority"}
            </p>
            <p className="mt-1 text-xs text-brand-gray">
              {authority.length
                ? "No requests match the current filters."
                : "Account approvals are handled by the PHN and the Health Supervisor."}
            </p>
          </div>
        )}

        {loading && (
          <div className="flex items-center justify-center gap-2 px-5 py-12 text-sm text-brand-gray">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading approval queue...
          </div>
        )}
      </Card>

      {detailRecord && (
        <RequestReviewModal record={detailRecord} onClose={() => setDetailId(null)} onDecide={decide} />
      )}
    </>
  );
}

/** Centered request detail modal with the approve / reject decision actions. */
function RequestReviewModal({ record, onClose, onDecide }) {
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const firstField = useRef(null);

  useEffect(() => {
    firstField.current?.focus();
  }, []);

  const pending = record.status === "pending";

  const rows = [
    { label: "Reference", value: record.id },
    { label: "Applicant", value: `${record.fullName} (${record.email})` },
    { label: "Contact", value: record.phone || "—" },
    { label: "Position", value: record.position || "—" },
    { label: "Assigned Role", value: ROLE_LABELS[record.role] || record.role },
    { label: "Municipality / LGU", value: record.municipality || "—" },
    { label: "Barangay", value: record.barangay || "—" },
    { label: "Health Facility", value: record.facility || "—" },
    { label: "Professional License", value: record.licenseNo || "Not applicable" },
    { label: "License Expiration", value: record.licenseExpiry ? formatDate(record.licenseExpiry) : "Not applicable" },
    { label: "Submitted", value: formatDate(record.submittedAt) },
    { label: "Reviewed By", value: record.decidedBy || "—" },
    { label: "Reviewed At", value: record.decidedAt ? formatDate(record.decidedAt) : "—" },
  ];

  const run = async (decision) => {
    if (decision === "reject" && notes.trim().length < 5) {
      setError("Please provide a rejection reason of at least 5 characters.");
      return;
    }
    setError("");
    setBusy(decision);
    try {
      await onDecide(record, decision, notes.trim());
    } catch (err) {
      setError(err?.message || "The decision could not be saved.");
    } finally {
      setBusy("");
    }
  };

  return (
    <ReviewModal
      title={record.fullName}
      subtitle={`${ROLE_LABELS[record.role] || record.role} · submitted ${formatDate(record.submittedAt)}`}
      status={<StatusBadge value={record.status} />}
      onClose={onClose}
    >
      <ModalSection label="Request Information">
        <div className="space-y-2">
          {rows.map((r) => <ModalRow key={r.label} label={r.label} value={r.value} />)}
        </div>
      </ModalSection>

      <ModalSection label="Supporting Documents">
        <div className="space-y-2">
          {(record.documents || []).map((d, i) => (
            <div
              key={`${d.type || d.name}-${i}`}
              className="flex items-center justify-between gap-3 rounded-btn border border-slate-200 bg-white px-3.5 py-2.5 dark:border-border"
            >
              <p className="text-sm font-medium text-brand-ink">{d.type || d.name}</p>
              <FileText className="h-4 w-4 shrink-0 text-brand-gray" />
            </div>
          ))}
          {(record.documents || []).length === 0 && (
            <p className="text-sm text-brand-gray">No documents uploaded.</p>
          )}
        </div>
      </ModalSection>

      {record.rejectionReason && (
        <p className="rounded-btn bg-brand-bg/60 px-3.5 py-2.5 text-sm text-brand-gray dark:bg-card-nested">
          <span className="font-semibold text-brand-ink">Decision reason:</span> {record.rejectionReason}
        </p>
      )}

      {pending && (
        <section className="rounded-2xl border border-brand-blue/15 bg-brand-light/50 p-4 dark:bg-card-nested">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-brand-gray">Decision</p>
          <textarea
            ref={firstField}
            rows={3}
            value={notes}
            onChange={(e) => { setNotes(e.target.value); if (error) setError(""); }}
            placeholder="Remarks (optional when approving; a reason is required when rejecting)"
            className="w-full resize-none rounded-btn border border-slate-200 bg-white px-3.5 py-2.5 text-sm outline-none focus:border-brand-blue dark:border-border dark:bg-input dark:text-foreground"
          />
          {error && <p className="mt-1 text-xs text-brand-danger">{error}</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              onClick={() => run("approve")}
              disabled={Boolean(busy)}
              className="inline-flex items-center gap-1.5 rounded-btn bg-brand-blue px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-60"
            >
              {busy === "approve" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              Approve &amp; Activate
            </button>
            <button
              onClick={() => run("reject")}
              disabled={Boolean(busy)}
              className="inline-flex items-center gap-1.5 rounded-btn border border-brand-danger/30 bg-brand-danger/5 px-4 py-2 text-sm font-medium text-brand-danger hover:bg-brand-danger/10 disabled:opacity-60"
            >
              {busy === "reject" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Ban className="h-4 w-4" />}
              Reject
            </button>
          </div>
        </section>
      )}
    </ReviewModal>
  );
}
