import React, { useState } from "react";
import PageHeader from "@/components/common/PageHeader";
import { Card } from "@/components/common/Card";
import VerificationBadge from "@/features/verification/components/VerificationBadge";
import {
  useMunicipalityApplications,
  municipalityStore,
  MUNICIPALITY_DOC_REQUIREMENTS,
  MUNICIPALITY_STATUSES,
} from "@/services/mock/municipalityStore";
import { Search, Building2, FileText, ShieldCheck, CheckCircle2, X } from "lucide-react";

const statusTone = (status) => {
  const s = String(status).toLowerCase();
  if (s.includes("approv")) return "verified";
  if (s.includes("reject")) return "rejected";
  if (s.includes("document")) return "pending";
  return "pending";
};

const formatDate = (iso) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
};

export default function MunicipalityApplications() {
  const applications = useMunicipalityApplications();
  const [query, setQuery] = useState("");
  const [reviewing, setReviewing] = useState(null);
  const [notes, setNotes] = useState("");
  const [toast, setToast] = useState(null);

  const filtered = applications.filter(
    (a) =>
      a.municipalityName.toLowerCase().includes(query.toLowerCase()) ||
      a.province.toLowerCase().includes(query.toLowerCase()) ||
      a.id.toLowerCase().includes(query.toLowerCase())
  );

  const showToast = (message) => {
    setToast(message);
    setTimeout(() => setToast(null), 3000);
  };

  const applyStatus = (status, providedNotes) => {
    if (!reviewing) return;
    const noteText = providedNotes !== undefined ? providedNotes : notes.trim();
    municipalityStore.setStatus(reviewing.id, status, noteText);
    setToast(`Application ${reviewing.id} marked as ${status}.`);
    setReviewing(null);
    setNotes("");
  };

  return (    <>
      <PageHeader
        crumbs={["Home", "Admin", "Municipality Applications"]}
        title="Municipality Applications"
        subtitle="Review and verify municipality / LGU registration applications."
        action={
          <span className="inline-flex items-center gap-2 rounded-full border border-brand-border bg-white px-3 py-1.5 text-xs font-medium text-brand-gray">
            <ShieldCheck className="h-3.5 w-3.5 text-brand-blue" /> {applications.length} applications
          </span>
        }
      />

      {toast && (
        <div className="fixed bottom-4 right-4 z-50 flex items-center gap-2 rounded-btn bg-brand-ink px-4 py-3 text-white shadow-lg">
          <CheckCircle2 className="h-4 w-4 text-brand-green" />
          <span className="text-sm">{toast}</span>
        </div>
      )}

      <Card className="overflow-hidden">
        <div className="border-b border-brand-border px-5 py-4">
          <div className="flex items-center gap-2 rounded-input border border-brand-border bg-brand-bg/60 px-3.5 py-2.5 max-w-sm">
            <Search className="h-4 w-4 text-brand-gray" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by municipality, province, or reference..."
              className="w-full bg-transparent text-sm outline-none"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-brand-bg text-left">
                <th className="px-5 py-3 font-medium text-brand-gray">Municipality</th>
                <th className="px-5 py-3 font-medium text-brand-gray">Reference</th>
                <th className="px-5 py-3 font-medium text-brand-gray">Submitted</th>
                <th className="px-5 py-3 font-medium text-brand-gray">Representative</th>
                <th className="px-5 py-3 font-medium text-brand-gray">Status</th>
                <th className="px-5 py-3 font-medium text-brand-gray text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-brand-border">
              {filtered.map((a) => (
                <tr key={a.id} className="hover:bg-brand-bg/50 transition-colors">
                  <td className="px-5 py-3.5">
                    <div className="flex items-center gap-2.5">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-blue/10 text-brand-blue">
                        <Building2 className="h-4 w-4" />
                      </span>
                      <div>
                        <p className="font-medium text-brand-ink">{a.municipalityName}</p>
                        <p className="text-xs text-brand-gray">{a.province} · {a.region}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-3.5">
                    <span className="font-stat text-xs font-semibold text-brand-ink">{a.id}</span>
                  </td>
                  <td className="px-5 py-3.5 text-brand-gray whitespace-nowrap">{formatDate(a.submittedAt)}</td>
                  <td className="px-5 py-3.5">
                    <p className="text-brand-ink">{a.representative}</p>
                    <p className="text-xs text-brand-gray">{a.position}</p>
                  </td>
                  <td className="px-5 py-3.5">
                    <VerificationBadge status={statusTone(a.status)} size="sm" />
                  </td>
                  <td className="px-5 py-3.5 text-right">
                    <button
                      onClick={() => setReviewing(a)}
                      className="inline-flex items-center gap-1 text-sm font-medium text-brand-blue hover:underline"
                    >
                      <FileText className="h-4 w-4" /> Review
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {filtered.length === 0 && (
          <p className="px-5 py-12 text-center text-sm text-brand-gray">No municipality applications found.</p>
        )}
      </Card>

      {/* Review drawer */}
      {reviewing && (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/60" onClick={() => setReviewing(null)} />
          <div className="absolute right-0 top-0 flex h-full w-full max-w-2xl flex-col bg-white shadow-2xl">
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-brand-border bg-white px-5 py-4">
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand-blue text-white">
                  <Building2 className="h-5 w-5" />
                </span>
                <div className="min-w-0">
                  <h3 className="truncate text-base font-semibold text-brand-ink">{reviewing.municipalityName}</h3>
                  <p className="text-xs text-brand-gray">{reviewing.id} · Submitted {formatDate(reviewing.submittedAt)}</p>
                </div>
              </div>
              <button onClick={() => setReviewing(null)} className="text-brand-gray hover:text-brand-ink" aria-label="Close">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
              <div className="flex items-center gap-2">
                <span className="text-sm text-brand-gray">Current status:</span>
                <VerificationBadge status={statusTone(reviewing.status)} size="sm" />
              </div>

              <section>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-brand-gray">Municipality Information</p>
                <div className="rounded-btn border border-brand-border bg-brand-bg/50 p-4 space-y-2 text-sm">
                  <p className="text-brand-ink"><span className="text-brand-gray">Name:</span> {reviewing.municipalityName}</p>
                  <p className="text-brand-ink"><span className="text-brand-gray">Province / Region:</span> {reviewing.province}, {reviewing.region}</p>
                  <p className="text-brand-ink"><span className="text-brand-gray">Address:</span> {reviewing.address}</p>
                  <p className="text-brand-ink"><span className="text-brand-gray">Contact:</span> {reviewing.contact}</p>
                  <p className="text-brand-ink"><span className="text-brand-gray">Email:</span> {reviewing.email}</p>
                </div>
              </section>

              <section>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-brand-gray">Authorized Representative</p>
                <div className="rounded-btn border border-brand-border bg-brand-bg/50 p-4 space-y-2 text-sm">
                  <p className="text-brand-ink"><span className="text-brand-gray">Name:</span> {reviewing.representative}</p>
                  <p className="text-brand-ink"><span className="text-brand-gray">Position:</span> {reviewing.position}</p>
                  <p className="text-brand-ink"><span className="text-brand-gray">Email:</span> {reviewing.repEmail}</p>
                  <p className="text-brand-ink"><span className="text-brand-gray">Contact:</span> {reviewing.repContact}</p>
                </div>
              </section>

              <section>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-brand-gray">Submitted Documents</p>
                <div className="space-y-2">
                  {MUNICIPALITY_DOC_REQUIREMENTS.map((req) => {
                    const file = reviewing.documents?.[req.key];
                    return (
                      <div key={req.key} className="flex items-center justify-between gap-3 rounded-btn border border-brand-border bg-white px-3.5 py-2.5">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-brand-ink">{req.label}</p>
                          <p className="text-[11px] text-brand-gray">
                            {req.required ? "Required" : "Optional"}
                          </p>
                        </div>
                        {file ? (
                          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-brand-green/10 px-2.5 py-1 text-xs font-medium text-brand-green">
                            <CheckCircle2 className="h-3.5 w-3.5" /> {file.name}
                          </span>
                        ) : (
                          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-500">
                            <X className="h-3.5 w-3.5" /> Not uploaded
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>

              <section className="rounded-btn border border-brand-border bg-white p-4">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-brand-gray">Decision</p>
                <div className="flex flex-wrap gap-2">
                  {MUNICIPALITY_STATUSES.filter((s) => s !== "Pending Verification").map((s) => (
                    <button
                      key={s}
                      onClick={() => applyStatus(s)}
                      className={`rounded-full border px-3.5 py-2 text-xs font-medium transition-colors ${
                        reviewing.status === s
                          ? "border-brand-blue bg-brand-blue text-white"
                          : "border-brand-border bg-white text-brand-gray hover:border-brand-blue"
                      }`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
                <div className="mt-3">
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-brand-gray">
                    Reason / notes <span className="normal-case font-normal">(required for Rejected / Requires Additional Documents)</span>
                  </label>
                  <textarea
                    rows={3}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="e.g. Additional authorization letter needed from the Sangguniang Bayan."
                    className="w-full resize-none rounded-btn border border-brand-border bg-white px-3.5 py-2.5 text-sm outline-none focus:border-brand-blue"
                  />
                </div>
                <div className="mt-2 flex flex-wrap justify-end gap-2">
                  {(reviewing.status === "Rejected" || reviewing.status === "Requires Additional Documents") && (
                    <button
                      onClick={() => {
                        if (!notes.trim()) {
                          showToast("Please add a reason before saving the decision.");
                          return;
                        }
                        applyStatus(reviewing.status, notes.trim());
                      }}
                      className="rounded-btn bg-brand-blue px-4 py-2 text-xs font-medium text-white hover:bg-brand-dark"
                    >
                      Save Decision &amp; Notes
                    </button>
                  )}
                </div>
                {reviewing.notes && (
                  <p className="mt-3 rounded-btn bg-brand-bg/60 px-3.5 py-2.5 text-sm text-brand-gray">
                    <span className="font-semibold text-brand-ink">Reviewer notes:</span> {reviewing.notes}
                  </p>
                )}
              </section>
            </div>

            <div className="shrink-0 border-t border-brand-border bg-white px-5 py-4 text-right">
              <button onClick={() => setReviewing(null)} className="rounded-btn px-4 py-2 text-sm font-medium text-brand-gray hover:bg-brand-bg">
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
