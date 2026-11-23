import React, { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Card } from "@/components/common/Card";
import { api } from "@/services/api";
import { fetchMyVerification } from "@/services/api/verificationsApi";
import { useAuth } from "@/context/AuthContext";

const STATUS_LABELS = {
  pending: "Pending review",
  under_review: "Under review",
  resubmission_required: "Corrections needed",
  approved: "Approved",
  rejected: "Rejected",
  cancelled: "Cancelled",
};
const dateLabel = (value) => {
  if (!value) return "Not recorded";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Not recorded" : date.toLocaleString("en-PH", {
    timeZone: "Asia/Manila", year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });
};

export default function SubmittedRequests() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const selectedId = params.get("request") || "";
  const [history, setHistory] = useState([]);
  const [registration, setRegistration] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [registrationError, setRegistrationError] = useState("");
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    setHistory([]);
    setRegistration(null);
    setRegistrationError("");
    Promise.allSettled([
      api.get("/transfer-requests/context"),
      fetchMyVerification(),
    ]).then(([transferResult, verificationResult]) => {
      if (!active) return;
      if (transferResult.status === "fulfilled") {
        setHistory(transferResult.value?.history || []);
      } else {
        setError(transferResult.reason?.message || "Unable to load your submitted transfer requests.");
      }
      if (verificationResult.status === "fulfilled") {
        const result = verificationResult.value;
        const submittedByUser = result?.verification?.submittedByCurrentUser === true;
        setRegistration(result?.hasResidentRecord && submittedByUser ? result.verification : null);
      } else {
        setRegistrationError(verificationResult.reason?.message || "Unable to load your resident registration status.");
      }
      setLoading(false);
    });
    return () => { active = false; };
  }, [revision, user?.id]);

  useEffect(() => {
    let active = true;
    setDetail(null);
    setDetailError("");
    setDetailLoading(Boolean(selectedId));
    if (selectedId) {
      api.get(`/transfer-requests/me/${encodeURIComponent(selectedId)}`)
        .then((result) => {
          if (!result?.transfer) throw new Error("Transfer request not found.");
          if (active) setDetail(result.transfer);
        })
        .catch((err) => { if (active) setDetailError(err?.message || "Unable to load this request."); })
        .finally(() => { if (active) setDetailLoading(false); });
    }
    return () => { active = false; };
  }, [selectedId, revision]);

  const selectRequest = (id) => {
    setParams((current) => {
      const next = new URLSearchParams(current);
      if (id) next.set("request", id);
      else next.delete("request");
      return next;
    }, { preventScrollReset: true });
  };

  return (
    <Card id="submitted-requests" className="scroll-mt-6 rounded-lg p-5 shadow-none">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-lg text-brand-ink">Submitted Requests</h2>
          <p className="mt-1 text-xs text-brand-gray">Your resident registration and residency transfer requests.</p>
        </div>
        <button type="button" onClick={() => setRevision((value) => value + 1)} disabled={loading || detailLoading} className="text-xs font-semibold text-brand-blue disabled:opacity-50">Refresh requests</button>
      </div>
      {loading ? <p role="status" className="mt-4 text-sm text-brand-gray">Loading submitted requests...</p>
        : <>
          {error && <p role="alert" className="mt-4 text-sm text-brand-danger">{error}</p>}
          {registrationError && <p role="alert" className="mt-2 text-sm text-brand-danger">{registrationError}</p>}
          {!error && !registrationError && history.length === 0 && !registration
            ? <p className="mt-4 text-sm text-brand-gray">You have no submitted requests yet.</p>
            : (registration || history.length > 0) && <ul className="mt-4 divide-y divide-brand-border">
              {registration && (
                <li className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold uppercase tracking-wide text-brand-gray">Resident registration</p>
                    <p className="mt-1 break-words text-sm font-medium text-brand-ink">
                      {registration.barangay ? `Barangay ${registration.barangay}` : "Resident verification"}
                    </p>
                    <p className="mt-1 text-xs text-brand-gray">Submitted {dateLabel(registration.submittedAt)}</p>
                    <p className="mt-1 text-xs font-semibold text-brand-blue">{STATUS_LABELS[registration.status] || registration.status}</p>
                  </div>
                </li>
              )}
              {history.map((request) => (
                <li key={request.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold uppercase tracking-wide text-brand-gray">Residency transfer</p>
                    <p className="break-words text-sm font-medium text-brand-ink">{request.fromBarangay || "Previous barangay"} to {request.toBarangay || "Destination barangay"}</p>
                    <p className="mt-1 text-xs text-brand-gray">Submitted {dateLabel(request.submittedAt)}</p>
                    <p className="mt-1 text-xs font-semibold text-brand-blue">{STATUS_LABELS[request.status] || request.status}</p>
                  </div>
                  <button type="button" aria-expanded={selectedId === request.id} onClick={() => selectRequest(selectedId === request.id ? "" : request.id)} className="shrink-0 rounded-btn border border-brand-border px-3 py-2 text-xs font-semibold text-brand-blue">
                    {selectedId === request.id ? "Close details" : "View request"}
                  </button>
                </li>
              ))}
            </ul>}
        </>}
      {detailLoading && <p role="status" className="mt-4 text-sm text-brand-gray">Loading request details...</p>}
      {detailError && <p role="alert" className="mt-4 text-sm text-brand-danger">{detailError}</p>}
      {detail && !detailLoading && (
        <section aria-label="Transfer request details" className="mt-4 rounded-lg border border-brand-border bg-brand-bg p-4">
          <h3 className="text-sm font-semibold text-brand-ink">Residency transfer · {STATUS_LABELS[detail.status] || detail.status}</h3>
          <p className="mt-2 break-words text-sm text-brand-ink">{detail.fromBarangay || "Previous barangay"} to {detail.toBarangay || "Destination barangay"}</p>
          <dl className="mt-3 grid gap-3 text-xs sm:grid-cols-2">
            <div><dt className="text-brand-gray">Submitted</dt><dd className="mt-1 text-brand-ink">{dateLabel(detail.submittedAt)}</dd></div>
            <div><dt className="text-brand-gray">Reviewed</dt><dd className="mt-1 text-brand-ink">{dateLabel(detail.reviewedAt)}</dd></div>
          </dl>
          {detail.reason && <p className="mt-3 whitespace-pre-wrap break-words text-sm text-brand-ink">Reason: {detail.reason}</p>}
          {detail.rejectionReason && <p className="mt-3 whitespace-pre-wrap break-words text-sm text-brand-danger">Rejection reason: {detail.rejectionReason}</p>}
          {detail.resubmissionInstructions && <p className="mt-3 whitespace-pre-wrap break-words text-sm text-brand-ink">Correction instructions: {detail.resubmissionInstructions}</p>}
          <h4 className="mt-4 text-xs font-semibold text-brand-ink">Submitted documents</h4>
          {(detail.documents || []).length === 0 ? <p className="mt-2 text-xs text-brand-gray">No documents attached.</p> : (
            <ul className="mt-2 space-y-2">
              {detail.documents.map((document) => (
                <li key={document.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-brand-border bg-white px-3 py-2 text-xs">
                  <span className="min-w-0 break-words text-brand-ink">{document.fileName}</span>
                  {document.url ? <a href={document.url} target="_blank" rel="noreferrer" className="shrink-0 font-semibold text-brand-blue underline">View document</a> : <span className="text-brand-gray">Document link unavailable</span>}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-xs text-brand-gray">Documents are read-only. Refresh requests to renew expired document links.</p>
          {detail.status === "resubmission_required" && <Link to="/register/transfer" className="mt-4 inline-block text-sm font-semibold text-brand-blue underline">Provide corrections and resubmit</Link>}
        </section>
      )}
    </Card>
  );
}
