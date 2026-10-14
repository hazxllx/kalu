import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import PageHeader from "@/components/common/PageHeader";
import { Card } from "@/components/common/Card";
import MedicalCertificateModal, { CertificateStatusBadge } from "@/features/certificates/components/MedicalCertificateModal";
import { useCertificateMeta, useCertificateRegister } from "@/features/certificates/hooks/useCertificateRegister";
import { useAuth } from "@/context/AuthContext";
import { canInitiateCertificate } from "@/lib/rhuStations";
import { isMedicalCertificateReviewer } from "@/features/certificates/lib/certificatePermissions";
import { Search, FileText, Plus, X, ChevronRight, AlertCircle, Loader2 } from "lucide-react";

const formatDate = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
};

/**
 * Medical Certificates register.
 *
 * Served by `GET /api/medical-certificates`, scoped server-side to the caller's
 * barangay (Health Supervisor) or municipality (PHN, MHO, RHU Personnel). The
 * status vocabulary and legal transitions come from `GET /meta`, and every
 * status change is a `PATCH /:id/status` that the service re-validates — an
 * illegal transition is refused by the API, not just hidden in the dropdown.
 */
export default function MedicalCertificates() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const meta = useCertificateMeta();
  const { rows: certificates, loading, error, refresh } = useCertificateRegister();
  const isReviewer = isMedicalCertificateReviewer(user);
  const canPrepare = isReviewer;
  // A Triage-station RHU Personnel may initiate a request (but not approve/issue).
  const canInitiate = canPrepare || canInitiateCertificate(user);
  const base = user?.role ? `/app/${user.role}` : "";

  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [selected, setSelected] = useState(null);
  const [editTarget, setEditTarget] = useState(null);
  const [toast, setToast] = useState(null);

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const has = (value) => String(value ?? "").toLowerCase().includes(q);
    return (Array.isArray(certificates) ? certificates : [])
      .filter((c) => statusFilter === "All" || c.status === statusFilter)
      .filter(
        (c) =>
          !q ||
          has(c.reference) ||
          has(c.patient) ||
          has(c.patientId) ||
          has(c.barangay)
      )
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [certificates, query, statusFilter]);

  const statuses = ["All", ...(meta.statuses || [])];

  return (
    <>
      <PageHeader
        crumbs={["Medical Certificates"]}
        title="Medical Certificates"
        subtitle={isReviewer ? "Review, approve, and issue medical certificates for your scope." : canInitiate ? "Initiate medical certificate requests; the PHN / MHO review and issue them." : "Medical certificate register for your authorized scope."}
        action={canInitiate && (
          <button
            onClick={() => navigate(`${base}/certificates/new`)}
            className="inline-flex items-center gap-2 rounded-btn bg-brand-blue px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-dark"
          >
            <Plus className="h-4 w-4" /> {isReviewer ? "Create Certificate" : "Request Certificate"}
          </button>
        )}
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
          <span className="ml-auto text-xs text-brand-gray">
            {loading ? "Loading..." : `${filtered.length} certificate${filtered.length === 1 ? "" : "s"}`}
          </span>
        </div>

        {error && (
          <div className="flex items-center gap-2 border-b border-brand-danger/20 bg-brand-danger/5 px-5 py-3 text-sm text-brand-danger">
            <AlertCircle className="h-4 w-4 shrink-0" /> {error}
          </div>
        )}

        {!error && (
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
                  <th className="px-5 py-3 text-right font-medium text-brand-gray">Action</th>
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
                    <td className="px-5 py-3 text-brand-gray">{c.barangay || "—"}</td>
                    <td className="px-5 py-3 text-brand-gray">{c.purpose}</td>
                    <td className="whitespace-nowrap px-5 py-3 text-brand-gray">{formatDate(c.dateOfExamination)}</td>
                    <td className="px-5 py-3 text-brand-gray">{c.preparedBy}</td>
                    <td className="px-5 py-3">
                      <CertificateStatusBadge value={c.status} />
                    </td>
                    <td className="px-5 py-3 text-right">
                      <div className="inline-flex items-center justify-end gap-3">
                        {isReviewer && ["Draft", "For Review"].includes(c.status) && (
                          <button onClick={() => setEditTarget(c.id)} className="text-sm font-medium text-brand-blue hover:underline">Edit</button>
                        )}
                        <button
                          onClick={() => setSelected(c.id)}
                          className="inline-flex items-center gap-1 text-sm font-medium text-brand-blue hover:underline"
                        >
                          {isReviewer && c.status === "For Review" ? "Review" : "View"} <ChevronRight className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {!loading && !error && filtered.length === 0 && (
          <div className="px-5 py-12 text-center">
            <FileText className="mx-auto h-8 w-8 text-brand-gray/50" />
            <p className="mt-3 text-sm font-medium text-brand-ink">No Medical Certificates Found</p>
            <p className="mt-1 text-xs text-brand-gray">No certificates match the current filters.</p>
          </div>
        )}

        {loading && (
          <div className="flex items-center justify-center gap-2 px-5 py-12 text-sm text-brand-gray">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading certificates...
          </div>
        )}
      </Card>

      {selected && (() => {
        const cert = certificates.find((c) => c.id === selected);
        if (!cert) return null;
        return (
          <MedicalCertificateModal
            mode={isReviewer && ["For Review", "Approved"].includes(cert.status) ? "review" : "view"}
            certificate={cert}
            currentUser={user?.name || ""}
            currentUserRole={user?.role || ""}
            purposes={meta.purposes}
            onClose={() => setSelected(null)}
            onSaved={async (status) => {
              showToast(`Certificate ${cert.reference} marked as ${status}.`);
              await refresh();
            }}
          />
        );
      })()}

      {editTarget && (() => {
        const cert = certificates.find((c) => c.id === editTarget);
        if (!cert) return null;
        return (
          <MedicalCertificateModal
            key={cert.id}
            mode="edit"
            certificate={cert}
            currentUser={user?.name || ""}
            currentUserRole={user?.role || ""}
            purposes={meta.purposes}
            onClose={() => setEditTarget(null)}
            onSaved={async () => {
              showToast(`Certificate ${cert.reference} updated.`);
              setEditTarget(null);
              await refresh();
            }}
          />
        );
      })()}

    </>
  );
}
