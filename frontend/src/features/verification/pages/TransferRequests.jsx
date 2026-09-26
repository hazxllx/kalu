import React, { useEffect, useState } from "react";
import { Check, ExternalLink, X } from "lucide-react";
import { api } from "@/services/api";

export default function TransferRequests() {
  const [requests, setRequests] = useState([]);
  const [residentIds, setResidentIds] = useState({});
  const [details, setDetails] = useState({});
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
    try {
      if (action === "approve" && !residentIds[request.id]?.trim()) return setError("Enter the existing resident ID for an approved transfer.");
      await api.post(`/transfer-requests/${request.id}/${action}`, action === "approve" ? { residentId: residentIds[request.id].trim() } : { reason: "Insufficient proof of transfer" });
      await load();
    } catch (err) { setError(err?.message || "The transfer decision could not be completed."); }
  };
  return (
    <main className="space-y-6 p-6">
      <header><p className="text-xs font-bold uppercase tracking-[0.16em] text-brand-blue">Verification</p><h1 className="mt-1 font-display text-2xl font-bold text-brand-dark">Transfer requests</h1><p className="mt-2 text-sm text-slate-500">Review documents and link only the existing resident record verified by your authorized team.</p></header>
      {error && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p>}
      <div className="space-y-3">{requests.map((request) => <article key={request.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-sm font-bold text-brand-ink">Request {request.id}</p><p className="text-xs uppercase tracking-wide text-slate-500">{request.status}</p></div><button type="button" onClick={() => review(request)} className="inline-flex items-center gap-1 text-xs font-semibold text-brand-blue">Review <ExternalLink className="h-3.5 w-3.5" /></button></div>{details[request.id] && <div className="mt-3 space-y-1 border-t border-slate-100 pt-3 text-xs">{details[request.id].documents.map((document) => <p key={document.id}><a href={document.url} target="_blank" rel="noreferrer" className="font-semibold text-brand-blue">{document.documentType}</a> <span className="text-slate-500">({document.verificationStatus})</span></p>)}</div>}<div className="mt-4 flex flex-wrap gap-2"><input value={residentIds[request.id] || ""} onChange={(event) => setResidentIds((current) => ({ ...current, [request.id]: event.target.value }))} placeholder="Existing resident ID" className="rounded-lg border border-slate-200 px-3 py-2 text-sm" /><button type="button" onClick={() => decide(request, "approve")} className="inline-flex items-center gap-1 rounded-lg bg-emerald-700 px-3 py-2 text-xs font-bold text-white"><Check className="h-3.5 w-3.5" /> Approve</button><button type="button" onClick={() => decide(request, "reject")} className="inline-flex items-center gap-1 rounded-lg border border-rose-200 px-3 py-2 text-xs font-bold text-rose-700"><X className="h-3.5 w-3.5" /> Reject</button></div></article>)}{!requests.length && <p className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">No pending transfer requests.</p>}</div>
    </main>
  );
}
