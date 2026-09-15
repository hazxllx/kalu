import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import PageHeader from "@/components/common/PageHeader";
import { Card } from "@/components/common/Card";
import MedicalCertificateModal, { CertificateStatusBadge } from "@/features/certificates/components/MedicalCertificateModal";
import { useMedicalCertificates, medicalCertificateStore, ALLOWED_TRANSITIONS } from "@/services/mock/medicalCertificateStore";
import { auditStore } from "@/services/mock/auditStore";
import { useAuth } from "@/context/AuthContext";
import { Search, FileText, Plus, X, ChevronRight, CheckCircle2 } from "lucide-react";

const formatDate = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
};

/** Valid next statuses for the MHO workflow (Draft→For Review→Approved/Rejected→Issued). */
const nextStatusesFor = (status) => ALLOWED_TRANSITIONS[status] || [];

/**
 * Medical Certificates list.
 *
 * - All roles see the register for their authorized scope.
 * - Triage / PHN rows open a read-only certificate view (they prepare
 *   certificates from the patient workflow, not from this list).
 * - The MHO can change a certificate's status — by clicking the status badge
 *   in the row, or via "Change Status" in the certificate details.
 */
export default function MedicalCertificates() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const certificates = useMedicalCertificates();
  const isMho = user?.role === "mho";
  const base = user?.role ? `/app/${user.role}` : "";

  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [selected, setSelected] = useState(null);
  const [statusTarget, setStatusTarget] = useState(null); // certificate id (MHO status change)
  const [toast, setToast] = useState(null);

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return certificates
      .filter((c) => statusFilter === "All" || c.status === statusFilter)
      .filter(
        (c) =>
          !q ||
          c.reference.toLowerCase().includes(q) ||
          c.patient.toLowerCase().includes(q) ||
          c.patientId.toLowerCase().includes(q) ||
          c.barangay.toLowerCase().includes(q)
      )
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }, [certificates, query, statusFilter]);

  const statuses = ["All", ...medicalStatuses()];

  /** MHO saves a new status from the Change Status modal (transition-validated). */
  const handleStatusChange = (newStatus, remarks) => {
    const cert = certificates.find((c) => c.id === statusTarget);
    setStatusTarget(null);
    if (!cert) return;
    // Guard against invalid transitions (belt-and-braces; the dropdown already
    // only offers valid next statuses).
    if (!nextStatusesFor(cert.status).includes(newStatus)) return;
    medicalCertificateStore.setStatus(cert.id, newStatus, {
      by: user?.name || "MHO",
      notes: remarks,
    });
    auditStore.addEvent({
      user: user?.name || "MHO",
      role: "Municipal Health Officer",
      action: "Certificate status changed",
      description: `Set certificate ${cert.reference} from ${cert.status} to ${newStatus}.`,
    });
    showToast(`Certificate ${cert.reference} status changed to ${newStatus}.`);
  };

  return (
    <>
      <PageHeader
        crumbs={["Medical Certificates"]}
        title="Medical Certificates"
        subtitle={isMho ? "Review, approve, and issue medical certificates for the municipality." : "Medical certificate register for your authorized scope."}
        action={
          <button
            onClick={() => navigate(`${base}/certificates/new`)}
            className="inline-flex items-center gap-2 rounded-btn bg-brand-blue px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-dark"
          >
            <Plus className="h-4 w-4" /> Create Certificate
          </button>
        }
      />

      {toast && (
        <div className="fixed bottom-4 right-4 z-[80] flex items-center gap-2 rounded-btn bg-brand-ink px-4 py-3 text-white shadow-lg">
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
              placeholder="Search reference, patient, or barangay..."
              className="w-full bg-transparent text-sm outline-none placeholder:text-slate-400 dark:placeholder:text-slate-500"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-btn border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none dark:border-border dark:bg-input dark:text-foreground"
          >
            {statuses.map((s) => <option key={s} value={s}>{s === "All" ? "All Statuses" : s}</option>)}
          </select>
          {statusFilter !== "All" && (
            <button onClick={() => setStatusFilter("All")} className="inline-flex items-center gap-1 text-xs font-medium text-brand-blue hover:underline">
              <X className="h-3.5 w-3.5" /> Clear
            </button>
          )}
          <span className="ml-auto text-xs text-brand-gray">{filtered.length} certificates</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm">
            <thead>
              <tr className="bg-brand-bg text-left">
                <th className="px-5 py-3 font-medium text-brand-gray">Reference</th>
                <th className="px-5 py-3 font-medium text-brand-gray">Patient</th>
                <th className="px-5 py-3 font-medium text-brand-gray">Barangay</th>
                <th className="px-5 py-3 font-medium text-brand-gray">Purpose</th>
                <th className="px-5 py-3 font-medium text-brand-gray">Examined</th>
                <th className="px-5 py-3 font-medium text-brand-gray">Prepared By</th>
                <th className="px-5 py-3 font-medium text-brand-gray">Status</th>
                <th className="px-5 py-3 font-medium text-brand-gray text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-border">
              {filtered.map((c) => (
                <tr key={c.id} className="hover:bg-brand-bg/50">
                  <td className="px-5 py-3 font-medium text-brand-ink">{c.reference}</td>
                  <td className="px-5 py-3">
                    <p className="font-medium text-brand-ink">{c.patient}</p>
                    <p className="text-xs text-brand-gray">{c.patientId}</p>
                  </td>
                  <td className="px-5 py-3 text-brand-gray">{c.barangay}</td>
                  <td className="px-5 py-3 text-brand-gray">{c.purpose}</td>
                  <td className="px-5 py-3 text-brand-gray whitespace-nowrap">{formatDate(c.dateOfExamination)}</td>
                  <td className="px-5 py-3 text-brand-gray">{c.preparedBy}</td>
                  <td className="px-5 py-3">
                    {isMho ? (
                      <button
                        type="button"
                        onClick={() => setStatusTarget(c.id)}
                        title="Change status"
                        aria-label={`Change status of certificate ${c.reference}`}
                        className="rounded-full transition-opacity hover:opacity-75 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue"
                      >
                        <CertificateStatusBadge value={c.status} />
                      </button>
                    ) : (
                      <CertificateStatusBadge value={c.status} />
                    )}
                  </td>
                  <td className="px-5 py-3 text-right">
                    <button
                      onClick={() => setSelected(c.id)}
                      className="inline-flex items-center gap-1 text-sm font-medium text-brand-blue hover:underline"
                    >
                      {isMho && c.status === "For Review" ? "Review" : "View"} <ChevronRight className="h-3.5 w-3.5" />
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
            <p className="mt-3 text-sm font-medium text-brand-ink">No Medical Certificates Found</p>
            <p className="mt-1 text-xs text-brand-gray">No certificates match the current filters.</p>
          </div>
        )}
      </Card>

      {selected && (() => {
        const cert = certificates.find((c) => c.id === selected);
        if (!cert) return null;
        return (
          <MedicalCertificateModal
            mode={isMho && cert.status === "For Review" ? "review" : "view"}
            certificate={cert}
            currentUser={user?.name || ""}
            currentUserRole={user?.role || ""}
            onClose={() => setSelected(null)}
            onRequestStatusChange={
              isMho
                ? (target) => { setSelected(null); setStatusTarget(target.id); }
                : undefined
            }
            onSaved={(status) => {
              showToast(`Certificate ${cert.reference} marked as ${status}.`);
            }}
          />
        );
      })()}

      {/* MHO status change */}
      {statusTarget && (() => {
        const cert = certificates.find((c) => c.id === statusTarget);
        if (!cert) return null;
        return (
          <StatusChangeModal
            certificate={cert}
            onClose={() => setStatusTarget(null)}
            onSave={handleStatusChange}
          />
        );
      })()}
    </>
  );
}

/**
 * Change Status modal (MHO only). Shows the certificate context — purpose,
 * patient, examined date, prepared by, current status — plus a new-status
 * dropdown and an optional remarks/reason field. Every change is recorded in
 * the certificate's audit trail by the store.
 */
function StatusChangeModal({ certificate, onClose, onSave }) {
  // Only the allowed next statuses for the current status are selectable.
  const allowed = nextStatusesFor(certificate.status);
  const [newStatus, setNewStatus] = useState(allowed[0] || "");
  const [remarks, setRemarks] = useState("");
  const [showIssueConfirm, setShowIssueConfirm] = useState(false);

  const isUnchanged = !newStatus || newStatus === certificate.status;

  const infoRows = [
    { label: "Purpose", value: certificate.purpose },
    { label: "Patient", value: `${certificate.patient} (${certificate.patientId})` },
    { label: "Examined Date", value: formatDate(certificate.dateOfExamination) },
    { label: "Prepared By", value: `${certificate.preparedBy}${certificate.preparedByRole ? ` (${certificate.preparedByRole})` : ""}` },
  ];

  return (
    <div className="fixed inset-0 z-[85] flex items-center justify-center bg-black/50 p-4">
      <div className="relative w-full max-w-md">
        <Card className="max-h-[92vh] overflow-y-auto">
        <div className="p-6">
          <div className="mb-1 flex items-start justify-between gap-3">
            <div>
              <h3 className="text-lg font-semibold text-brand-ink">Change Status</h3>
              <p className="mt-0.5 text-sm text-brand-gray">{certificate.reference}</p>
            </div>
            <button onClick={onClose} className="text-brand-gray hover:text-brand-ink" aria-label="Close">
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Certificate context */}
          <div className="mt-4 space-y-2.5 rounded-2xl border border-slate-200 bg-white p-4 dark:border-border dark:bg-card">
            {infoRows.map((row) => (
              <div key={row.label} className="flex items-start justify-between gap-3 text-sm">
                <p className="shrink-0 text-brand-gray">{row.label}</p>
                <p className="min-w-0 text-right font-medium text-brand-ink">{row.value || "—"}</p>
              </div>
            ))}
            <div className="flex items-center justify-between gap-3 border-t border-slate-200 pt-2.5 text-sm dark:border-border">
              <p className="text-brand-gray">Current Status</p>
              <CertificateStatusBadge value={certificate.status} />
            </div>
          </div>

          {/* New status + remarks */}
          <div className="mt-4 space-y-4">
            <div>
              <label className="text-sm font-medium text-brand-ink">
                New Status <span className="text-brand-danger">*</span>
              </label>
              {allowed.length > 0 ? (
                <select
                  value={newStatus}
                  onChange={(e) => setNewStatus(e.target.value)}
                  className="mt-1.5 w-full rounded-btn border border-slate-200 bg-white px-3.5 py-2.5 text-sm outline-none transition-colors focus:border-brand-blue dark:border-border dark:bg-input dark:text-foreground"
                >
                  {allowed.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              ) : (
                <p className="mt-1.5 rounded-btn border border-slate-200 bg-brand-bg/60 px-3.5 py-2.5 text-sm text-brand-gray dark:border-border dark:bg-card-nested">
                  This certificate is final — no further status changes are allowed.
                </p>
              )}
              {allowed.length > 0 && newStatus === certificate.status && (
                <p className="mt-1 text-xs text-brand-gray">
                  Select a different status to update this certificate.
                </p>
              )}
            </div>
            <div>
              <label className="text-sm font-medium text-brand-ink">Remarks / Reason</label>
              <textarea
                rows={3}
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                placeholder="Optional remarks or reason for the status change..."
                className="mt-1.5 w-full resize-none rounded-btn border border-slate-200 bg-white px-3.5 py-2.5 text-sm outline-none transition-colors focus:border-brand-blue dark:border-border dark:bg-input dark:text-foreground"
              />
            </div>
          </div>

          <div className="mt-6 flex justify-end gap-3 border-t border-slate-200 pt-4 dark:border-border">
            <button onClick={onClose} className="rounded-btn px-4 py-2 text-sm font-medium text-brand-gray hover:bg-brand-bg dark:hover:bg-hover">
              Cancel
            </button>
            <button
              onClick={() => {
                // Issuing is irreversible — require confirmation first.
                if (newStatus === "Issued") setShowIssueConfirm(true);
                else onSave(newStatus, remarks.trim());
              }}
              disabled={isUnchanged}
              className="inline-flex items-center gap-1.5 rounded-btn bg-brand-blue px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-50"
            >
              <CheckCircle2 className="h-4 w-4" /> Save Changes
            </button>
          </div>
        </div>
      </Card>

      {/* Issuing confirmation — required before the Issued status is applied. */}
      {showIssueConfirm && (
        <div className="absolute inset-0 z-[5] flex items-center justify-center bg-black/50 p-4">
          <Card className="w-full max-w-sm">
            <div className="p-6">
              <h3 className="text-lg font-semibold text-brand-ink">Issue this certificate?</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-brand-gray">
                Issuing makes <span className="font-medium text-brand-ink">{certificate.reference}</span> official and
                final — its status can no longer be changed.
              </p>
              <div className="mt-6 flex justify-end gap-3">
                <button onClick={() => setShowIssueConfirm(false)} className="rounded-btn px-4 py-2 text-sm font-medium text-brand-gray hover:bg-brand-bg dark:hover:bg-hover">Cancel</button>
                <button
                  onClick={() => { setShowIssueConfirm(false); onSave("Issued", remarks.trim()); }}
                  className="rounded-btn bg-brand-blue px-5 py-2 text-sm font-medium text-white hover:bg-brand-dark"
                >
                  Issue Certificate
                </button>
              </div>
            </div>
          </Card>
        </div>
      )}
      </div>
    </div>
  );
}

function medicalStatuses() {
  return ["Draft", "For Review", "Approved", "Issued", "Rejected", "Cancelled"];
}
