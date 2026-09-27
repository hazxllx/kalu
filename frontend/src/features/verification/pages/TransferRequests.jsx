import React, { useEffect, useState } from "react";
import { ArrowRight, Check, ExternalLink, X } from "lucide-react";
import { api } from "@/services/api";

export default function TransferRequests() {
  const [requests, setRequests] = useState([]);
  const [details, setDetails] = useState({});
  const [reasons, setReasons] = useState({});
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");

  const load = async () => {
    try { const result = await api.get("/transfer-requests/queue"); setRequests(result.rows || []); }
    catch (err) { setError(err?.message || "Transfer requests could not be loaded."); }
  };
  useEffect(() => { load(); }, []);

  const review = async (request) => {
    try { const result = await api.get(`/transfer-requests/${request.id}/review`); setDetails((current) => ({ ...current, [request.id]: result })); }
    catch (err) { setError(err?.message || "The transfer documents could not be loaded."); }
  };

  const decide = async (request, action) => {
    setError("");
    try {
      if (action === "reject" && !reasons[request.id]?.trim()) {
        return setError("Enter a reason before rejecting a transfer request.");
      }
      setBusyId(request.id);
      // The resident being transferred is derived from the request server-side —
      // a reviewer never selects or types a resident id.
      await api.post(
        `/transfer-requests/${request.id}/${action}`,
        action === "reject" ? { reason: reasons[request.id].trim() } : {},
      );
      await load();
    } catch (err) { setError(err?.message || "The transfer decision could not be completed."); }
    finally { setBusyId(""); }
  };

  return (
    <main className="space-y-6 p-6">
      <header>
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-brand-blue">Verification</p>
        <h1 className="mt-1 font-display text-2xl font-bold text-brand-dark">Transfer requests</h1>
        <p className="mt-2 text-sm text-slate-500">
          Review each request and approve to update the resident&apos;s current barangay. Approving keeps the same resident record and all existing health history.
        </p>
      </header>
      {error && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p>}
      <div className="space-y-3">
        {requests.map((request) => {
          const detail = details[request.id];
          const resident = detail?.resident;
          return (
            <article key={request.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-bold text-brand-ink">
                    {request.fromBarangay || "—"} <ArrowRight className="mx-1 inline h-3.5 w-3.5 text-slate-400" /> {request.toBarangay || "—"}
                  </p>
                  <p className="text-xs uppercase tracking-wide text-slate-500">Request {request.id} · {request.status}</p>
                </div>
                <button type="button" onClick={() => review(request)} className="inline-flex items-center gap-1 text-xs font-semibold text-brand-blue">
                  Review <ExternalLink className="h-3.5 w-3.5" />
                </button>
              </div>
              {detail && (
                <div className="mt-3 space-y-2 border-t border-slate-100 pt-3 text-xs">
                  {resident && (
                    <p className="text-brand-ink">
                      <span className="font-semibold">Resident:</span> {resident.name} ({resident.id})
                    </p>
                  )}
                  {request.reason && <p className="text-slate-500"><span className="font-semibold">Reason:</span> {request.reason}</p>}
                  <div className="space-y-1">
                    {detail.documents.map((document) => (
                      <p key={document.id}>
                        <a href={document.url} target="_blank" rel="noreferrer" className="font-semibold text-brand-blue">{document.fileName || document.documentType}</a>
                        <span className="text-slate-500"> ({document.verificationStatus})</span>
                      </p>
                    ))}
                    {!detail.documents.length && <p className="text-slate-400">No documents uploaded.</p>}
                  </div>
                </div>
              )}
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <input
                  value={reasons[request.id] || ""}
                  onChange={(event) => setReasons((current) => ({ ...current, [request.id]: event.target.value }))}
                  placeholder="Rejection reason (required to reject)"
                  className="min-w-[220px] flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
                <button type="button" disabled={busyId === request.id} onClick={() => decide(request, "approve")} className="inline-flex items-center gap-1 rounded-lg bg-emerald-700 px-3 py-2 text-xs font-bold text-white disabled:opacity-60">
                  <Check className="h-3.5 w-3.5" /> Approve
                </button>
                <button type="button" disabled={busyId === request.id} onClick={() => decide(request, "reject")} className="inline-flex items-center gap-1 rounded-lg border border-rose-200 px-3 py-2 text-xs font-bold text-rose-700 disabled:opacity-60">
                  <X className="h-3.5 w-3.5" /> Reject
                </button>
              </div>
            </article>
          );
        })}
        {!requests.length && <p className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">No pending transfer requests.</p>}
      </div>
    </main>
  );
}
