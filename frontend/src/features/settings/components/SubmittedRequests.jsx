import React, { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Card } from "@/components/common/Card";
import { api } from "@/services/api";
import { fetchMyVerification } from "@/services/api/verificationsApi";
import { useAuth } from "@/context/AuthContext";
import { RefreshCw } from "lucide-react";
import VerificationBanner from "@/features/verification/components/VerificationBanner";

const STATUS_LABELS = {
  pending: "Pending",
  under_review: "Under Review",
  resubmission_required: "Corrections needed",
  approved: "Approved",
  rejected: "Rejected",
  cancelled: "Cancelled",
};
const STATUS_TONES = {
  pending: "bg-amber-50 text-amber-800 ring-amber-200",
  under_review: "bg-blue-50 text-blue-800 ring-blue-200",
  resubmission_required: "bg-amber-50 text-amber-800 ring-amber-200",
  approved: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  rejected: "bg-rose-50 text-rose-800 ring-rose-200",
  cancelled: "bg-slate-100 text-slate-700 ring-slate-200",
};
const statusKey = (value) => String(value || "").toLowerCase().replace(/[\s-]+/g, "_");
const statusLabel = (value) => STATUS_LABELS[statusKey(value)] || (value || "Status unavailable");
const statusTone = (value) => STATUS_TONES[statusKey(value)] || "bg-slate-100 text-slate-700 ring-slate-200";
const dateLabel = (value) => {
  if (!value) return "Not recorded";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not recorded";
  const datePart = date.toLocaleDateString("en-US", {
    timeZone: "Asia/Manila", year: "numeric", month: "long", day: "numeric",
  });
  const timePart = date.toLocaleTimeString("en-US", {
    timeZone: "Asia/Manila", hour: "numeric", minute: "2-digit",
  });
  return `${datePart} · ${timePart}`;
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

  const requests = [
    ...(registration ? [{
      id: "registration",
      type: "Resident registration",
      status: registration.status,
      location: registration.barangay ? `Barangay ${registration.barangay}` : "Barangay not recorded",
      submittedAt: registration.submittedAt,
      registration: true,
    }] : []),
    ...history.map((request) => ({
      id: request.id,
      type: "Residency transfer",
      status: request.status,
      location: `From ${request.fromBarangay || "Previous barangay"} to ${request.toBarangay || "Destination barangay"}`,
      submittedAt: request.submittedAt,
      registration: false,
    })),
  ].sort((a, b) => {
    const timeA = new Date(a.submittedAt || 0).getTime();
    const timeB = new Date(b.submittedAt || 0).getTime();
    return (Number.isNaN(timeB) ? 0 : timeB) - (Number.isNaN(timeA) ? 0 : timeA);
  });

  return (
    <Card id="submitted-requests" className="scroll-mt-6 rounded-xl border border-brand-border p-4 shadow-none sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-heading text-xl font-semibold text-brand-ink">Submitted Requests</h2>
          <p className="mt-1 text-sm text-brand-gray">Your resident registration and residency transfer requests.</p>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <VerificationBanner compact refreshKey={revision} />
          <button
            type="button"
            onClick={() => setRevision((value) => value + 1)}
            disabled={loading || detailLoading}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-brand-gray transition-colors hover:bg-brand-bg hover:text-brand-blue disabled:opacity-50"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            Refresh Requests
          </button>
        </div>
      </div>
      {loading ? <p role="status" className="mt-4 text-sm text-brand-gray">Loading submitted requests...</p>
        : <>
          {error && <p role="alert" className="mt-4 text-sm text-brand-danger">{error}</p>}
          {registrationError && <p role="alert" className="mt-2 text-sm text-brand-danger">{registrationError}</p>}
          {!error && !registrationError && requests.length === 0 ? (
            <div className="mt-5 border-t border-brand-border pt-4">
              <p className="text-sm font-medium text-brand-ink">No submitted requests yet.</p>
              <p className="mt-1 text-sm text-brand-gray">Your registration and residency transfer requests will appear here.</p>
            </div>
          ) : requests.length > 0 && (
            <ul className="mt-4 divide-y divide-brand-border border-t border-brand-border">
              {requests.map((request) => (
                <li key={request.id} className="flex min-w-0 flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold uppercase tracking-[0.08em] text-brand-gray">{request.type}</p>
                    <p className="mt-1 break-words text-[15px] font-medium text-brand-ink">{request.location}</p>
                    <p className="mt-1 text-sm text-brand-gray">Submitted {dateLabel(request.submittedAt)}</p>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">
                    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${statusTone(request.status)}`}>
                      {statusLabel(request.status)}
                    </span>
                    {!request.registration && (
                      <button
                        type="button"
                        aria-expanded={selectedId === request.id}
                        onClick={() => selectRequest(selectedId === request.id ? "" : request.id)}
                        className="min-h-8 rounded-md px-2 text-xs font-medium text-brand-blue transition-colors hover:bg-blue-50"
                      >
                        {selectedId === request.id ? "Close details" : "View request"}
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>}
      {detailLoading && <p role="status" className="mt-4 text-sm text-brand-gray">Loading request details...</p>}
      {detailError && <p role="alert" className="mt-4 text-sm text-brand-danger">{detailError}</p>}
      {detail && !detailLoading && (
        <section aria-label="Transfer request details" className="mt-4 rounded-lg border border-brand-border bg-brand-bg p-4">
          <h3 className="text-sm font-semibold text-brand-ink">Residency transfer · {statusLabel(detail.status)}</h3>
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
