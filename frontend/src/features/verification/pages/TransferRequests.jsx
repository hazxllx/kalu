import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  FileWarning,
  Inbox,
  Loader2,
  RefreshCw,
  XCircle,
} from "lucide-react";
import { usePermissions } from "@/context/PermissionsContext";
import { api } from "@/services/api";
import VerificationQueueToolbar from "@/features/verification/components/VerificationQueueToolbar";
import ReviewModal, { ModalSection, InfoGrid, InfoItem } from "@/features/users/components/ReviewModal";
import { DECISION_TEXTAREA_CLASS } from "@/features/verification/components/DecisionButtons";
import DocumentPreviewCard from "@/features/verification/components/DocumentPreviewCard";
import ImageLightbox from "@/features/verification/components/ImageLightbox";

const STATUS_META = {
  pending: { label: "Pending Review", chip: "bg-amber-100 text-amber-700" },
  under_review: { label: "Under Review", chip: "bg-amber-100 text-amber-700" },
  resubmission_required: { label: "Resubmission Required", chip: "bg-sky-100 text-sky-700" },
  approved: { label: "Approved", chip: "bg-emerald-100 text-emerald-700" },
  rejected: { label: "Rejected", chip: "bg-rose-100 text-rose-700" },
  cancelled: { label: "Cancelled", chip: "bg-slate-100 text-slate-500" },
};

const STATUS_FILTERS = [
  { value: "pending", label: "Pending Review" },
  { value: "resubmission_required", label: "Resubmission Required" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
  { value: "all", label: "All statuses" },
];

// Compact 5-column row/header layout shared by the list header and each request
// row so the columns line up exactly. Collapses to a single stacked column on
// mobile so nothing overflows horizontally.
const ROW_GRID =
  "sm:grid-cols-[minmax(0,2.2fr)_minmax(0,2.4fr)_minmax(0,1.3fr)_auto_auto]";

const formatDate = (value) => {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
};

const metaFor = (status) =>
  STATUS_META[status] || { label: status || "Unknown", chip: "bg-slate-100 text-slate-500" };

/** Restrained status pill shared by the list and the modal header. */
function StatusChip({ status }) {
  const meta = metaFor(status);
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${meta.chip}`}
    >
      {meta.label}
    </span>
  );
}

// Infer a MIME type from the file name so image documents render inline
// previews (the review payload only carries the file name, not a MIME type).
const guessMime = (fileName) => {
  const ext = String(fileName || "").split(".").pop()?.toLowerCase() || "";
  if (["jpg", "jpeg", "png", "gif", "webp", "bmp", "heic", "heif"].includes(ext)) {
    return `image/${ext === "jpg" ? "jpeg" : ext}`;
  }
  if (ext === "pdf") return "application/pdf";
  return "";
};

const DOCUMENT_LABELS = {
  transfer_proof_of_address: "Proof of address",
  transfer_previous_health_record: "Previous health record",
};

const documentStatusLabel = (status, url) => {
  if (!url) return "Unavailable — unable to inspect";
  if (status === "rejected") return "Invalid — correction required";
  if (status === "resubmission_required") return "Correction required";
  if (status === "approved" || status === "verified") return "Verified";
  if (status === "pending") return "Uploaded — not yet verified";
  return status ? `Status: ${status.replaceAll("_", " ")}` : "Status not recorded";
};

const documentStatusClass = (status, url) => {
  if (!url || status === "rejected" || status === "resubmission_required") return "text-rose-700";
  if (status === "approved" || status === "verified") return "text-emerald-700";
  return "text-amber-800";
};

const auditActionLabel = (action) => ({
  transfer_request_submitted: "Request submitted",
  transfer_request_resubmitted: "Corrected request resubmitted",
  transfer_request_approved: "Transfer approved",
  resident_barangay_updated: "Resident assigned to destination barangay",
  transfer_request_rejected: "Transfer rejected",
  transfer_request_resubmission_requested: "Corrections requested",
  transfer_document_uploaded: "Supporting document uploaded",
  transfer_document_replaced: "Supporting document replaced",
  transfer_document_removed: "Supporting document removed",
  transfer_request_cancelled: "Request cancelled",
}[action] || String(action || "Request updated").replaceAll("_", " "));

/**
 * Resident Transfer Requests — the authorized receiving Health Supervisor's
 * queue of incoming transfer requests for their barangay (also usable by
 * municipality-wide PHN/MHO). Scope, resident identity and the decision
 * authority (`canDecide`) are all resolved server-side; this page never sends a
 * resident id or barangay. Renders standalone or embedded inside the
 * Verifications & Approvals tabs.
 *
 * The queue is a compact, scannable list; the full request detail and the
 * approve / reject / request-resubmission actions open in a centered modal.
 */
export default function TransferRequests({ embedded = false }) {
  const { can } = usePermissions();
  const canReviewTransfers = can("residents.transfer.approve");
  const [searchParams, setSearchParams] = useSearchParams();
  const deepLinkId = searchParams.get("request") || "";

  const [requests, setRequests] = useState([]);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("pending");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [reviewId, setReviewId] = useState("");

  const load = useCallback(async () => {
    if (!canReviewTransfers) return;
    setLoading(true);
    setError("");
    try {
      // Fetch everything once; filtering/search is client-side so switching
      // filters is instant and the result count stays accurate.
      const result = await api.get("/transfer-requests/queue", { params: { status: "all" } });
      setRequests(result.rows || []);
    } catch (err) {
      setError(err?.message || "Transfer requests could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [canReviewTransfers]);

  useEffect(() => { load(); }, [load]);

  const clearDeepLink = useCallback(() => {
    if (!deepLinkId) return;
    const next = new URLSearchParams(searchParams);
    next.delete("request");
    setSearchParams(next, { replace: true });
  }, [deepLinkId, searchParams, setSearchParams]);

  const closeReview = useCallback(() => {
    setReviewId("");
    clearDeepLink();
  }, [clearDeepLink]);

  // Auto-open a request linked from a notification (?request=<id>).
  useEffect(() => {
    if (!deepLinkId || loading) return;
    if (requests.some((r) => r.id === deepLinkId)) {
      setReviewId((current) => current || deepLinkId);
    }
  }, [deepLinkId, loading, requests]);

  // Perform a decision via the existing transfer APIs. Resolves on success and
  // throws on failure so the modal can surface an inline error; the resident
  // being transferred is derived from the request server-side.
  const decide = useCallback(async (request, action, text) => {
    if (!canReviewTransfers) throw new Error("Your role cannot review transfer requests.");
    setNotice("");
    let body = {};
    if (action === "reject") body = { reason: text };
    if (action === "request-resubmission") body = { instructions: text };
    const result = await api.post(`/transfer-requests/${request.id}/${action}`, body);
    if (result?.transfer?.status) {
      setRequests((current) => current.map((row) => row.id === request.id
        ? { ...row, status: result.transfer.status }
        : row));
    }
    setNotice(
      action === "approve"
        ? "Transfer approved. The resident has been reassigned to the destination barangay."
        : action === "reject"
          ? "Transfer rejected. The resident has been notified."
          : "Resubmission requested. The resident has been notified to make corrections.",
    );
    await load();
  }, [canReviewTransfers, load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return requests.filter((r) => {
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (!q) return true;
      return [r.residentName, r.healthRecordNo, r.fromBarangay, r.toBarangay, r.id]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(q));
    });
  }, [requests, query, statusFilter]);

  const reviewRequest = useMemo(
    () => requests.find((r) => r.id === reviewId) || null,
    [requests, reviewId],
  );

  if (!canReviewTransfers) {
    return (
      <main className={embedded ? "" : "p-6"}>
        <p role="status" className="rounded-card border border-brand-border bg-white p-4 text-sm text-brand-gray dark:border-border dark:bg-card">
          Your role does not have permission to review resident transfer requests.
        </p>
      </main>
    );
  }

  const Wrapper = embedded ? "div" : "main";

  return (
    <Wrapper className={embedded ? "space-y-4" : "space-y-6 p-6"}>
      {!embedded && (
        <header>
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-brand-blue">Verification</p>
          <h1 className="mt-1 font-display text-2xl font-bold text-brand-dark">Resident Transfer Requests</h1>
          <p className="mt-2 text-sm text-brand-gray">
            Review each incoming request and approve to update the resident&apos;s current barangay. Approving keeps the same resident record, Health Record Number, and all existing health history.
          </p>
        </header>
      )}

      {notice && (
        <p role="status" className="rounded-card border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{notice}</p>
      )}
      {error && (
        <p role="alert" className="rounded-card border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p>
      )}

      <section className="overflow-hidden rounded-card border border-brand-border bg-white dark:border-border dark:bg-card">
        {/* Compact toolbar: search + status filter + refresh + request count */}
        <VerificationQueueToolbar
          filters={STATUS_FILTERS}
          status={statusFilter}
          onStatusChange={setStatusFilter}
          searchValue={query}
          onSearchChange={setQuery}
          searchPlaceholder="Search resident, record no., or barangay"
          resultText={`${filtered.length} request${filtered.length === 1 ? "" : "s"}`}
        >
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="inline-flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-input border border-brand-border px-3 text-[13px] font-medium text-brand-gray transition-colors hover:text-brand-ink disabled:opacity-60 dark:border-border dark:hover:text-foreground"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
          </button>
        </VerificationQueueToolbar>

        {loading ? (
          <div className="flex items-center justify-center gap-2 px-6 py-12 text-sm text-brand-gray">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading transfer requests…
          </div>
        ) : filtered.length === 0 ? (
          <div className="px-6 py-14 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-brand-bg">
              <Inbox className="h-7 w-7 text-brand-gray" strokeWidth={1.5} />
            </div>
            <p className="mt-4 text-sm font-medium text-brand-ink">No transfer requests</p>
            <p className="mt-1 text-xs text-brand-gray">
              {requests.length === 0
                ? "There are no incoming transfer requests for your barangay yet."
                : "Nothing matches this filter."}
            </p>
          </div>
        ) : (
          <>
            {/* Column headers (desktop only) */}
            <div
              className={`hidden border-b border-brand-border bg-brand-bg/50 px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-brand-gray dark:border-border dark:bg-card-nested sm:grid sm:items-center sm:gap-3 ${ROW_GRID}`}
            >
              <span>Resident</span>
              <span>Transfer</span>
              <span>Submitted</span>
              <span>Status</span>
              <span className="justify-self-end">Action</span>
            </div>

            <ul className="divide-y divide-brand-border dark:divide-border">
              {filtered.map((request) => {
                const name = request.residentName || "Resident";
                return (
                  <li
                    key={request.id}
                    className={`grid grid-cols-1 items-start gap-1.5 px-4 py-3 transition-colors hover:bg-brand-bg/40 dark:hover:bg-card-nested sm:items-center sm:gap-3 sm:py-2.5 ${ROW_GRID}`}
                  >
                    {/* Resident */}
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-brand-ink dark:text-foreground">{name}</p>
                      {request.healthRecordNo && (
                        <p className="truncate text-xs text-brand-gray">{request.healthRecordNo}</p>
                      )}
                    </div>

                    {/* Transfer route */}
                    <div className="flex min-w-0 items-center gap-1.5 text-sm text-brand-ink dark:text-foreground">
                      <span className="truncate">{request.fromBarangay || "—"}</span>
                      <ArrowRight className="h-3.5 w-3.5 shrink-0 text-brand-gray" aria-label="to" />
                      <span className="truncate font-medium">{request.toBarangay || "—"}</span>
                    </div>

                    {/* Submitted */}
                    <p className="text-xs text-brand-gray sm:text-[13px]">
                      <span className="font-medium sm:hidden">Submitted: </span>
                      {formatDate(request.submittedAt || request.createdAt)}
                    </p>

                    {/* Status */}
                    <div>
                      <StatusChip status={request.status} />
                    </div>

                    {/* Review action */}
                    <div className="sm:justify-self-end">
                      <button
                        type="button"
                        onClick={() => setReviewId(request.id)}
                        className="inline-flex h-9 w-full items-center justify-center gap-1 rounded-btn border border-brand-border px-3 text-[13px] font-semibold text-brand-blue transition-colors hover:border-brand-blue hover:bg-brand-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue dark:border-border dark:hover:bg-card-nested sm:w-auto"
                        aria-label={`Review transfer request for ${name}`}
                      >
                        Review <ChevronRight className="h-4 w-4" />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </section>

      {reviewRequest && (
        <TransferReviewModal
          request={reviewRequest}
          onClose={closeReview}
          onDecide={decide}
        />
      )}
    </Wrapper>
  );
}

/**
 * Centered transfer-request review with a persistent decision footer. Decisions
 * stay server-authoritative; the modal refreshes its status/history after saving.
 */
function TransferReviewModal({ request, onClose, onDecide }) {
  const [detail, setDetail] = useState(null);
  const [docsLoading, setDocsLoading] = useState(true);
  const [docsError, setDocsError] = useState("");
  const [decisionPrompt, setDecisionPrompt] = useState(null); // 'approve' | 'reject' | 'resubmit'
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [historyError, setHistoryError] = useState("");
  const [lightboxIndex, setLightboxIndex] = useState(null);
  const fieldRef = useRef(null);
  const confirmRef = useRef(null);

  const meta = metaFor(request.status);
  const canDecide =
    request.canDecide &&
    request.status !== "approved" &&
    request.status !== "rejected" &&
    request.status !== "cancelled";
  const awaitingReview = request.status === "pending" || request.status === "under_review";

  // The queue row carries no documents or signed URLs; fetch the full request
  // (with fresh, short-lived signed URLs) when the modal opens.
  useEffect(() => {
    let active = true;
    setDetail(null);
    setDocsLoading(true);
    setDocsError("");
    setLightboxIndex(null);
    setDecisionPrompt(null);
    setText("");
    setError("");
    setHistoryError("");
    api
      .get(`/transfer-requests/${request.id}/review`)
      .then((result) => { if (active) setDetail(result); })
      .catch((err) => { if (active) setDocsError(err?.message || "The transfer documents could not be loaded."); })
      .finally(() => { if (active) setDocsLoading(false); });
    return () => { active = false; };
  }, [request.id]);

  // Focus the revealed explanation field for keyboard users.
  useEffect(() => {
    if (decisionPrompt === "approve") confirmRef.current?.focus();
    else if (decisionPrompt) fieldRef.current?.focus();
  }, [decisionPrompt]);

  useEffect(() => {
    if (!decisionPrompt) return undefined;
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        event.preventDefault();
        if (busy) return;
        setDecisionPrompt(null);
        setText("");
        setError("");
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [decisionPrompt, busy]);

  const resident = detail?.resident;
  const documents = detail?.documents || [];
  const decisionHistory = detail?.decisionHistory || [];

  const docCards = useMemo(
    () =>
      documents.map((d) => ({
        id: d.id,
        title: DOCUMENT_LABELS[d.documentType] || String(d.documentType || "Document").replaceAll("_", " "),
        filename: d.fileName,
        mimeType: d.mimeType || guessMime(d.fileName),
        url: d.url,
        statusLabel: documentStatusLabel(d.verificationStatus, d.url),
        statusClassName: documentStatusClass(d.verificationStatus, d.url),
        verificationStatus: d.verificationStatus,
        rejectionReason: d.rejectionReason,
      })),
    [documents],
  );

  const imageDocs = useMemo(
    () =>
      docCards
        .filter((d) => String(d.mimeType).startsWith("image/"))
        .map((d) => ({ id: d.id, title: d.title, url: d.url })),
    [docCards],
  );

  const openLightbox = (doc) => {
    const idx = imageDocs.findIndex((d) => d.id === doc.id);
    if (idx >= 0) setLightboxIndex(idx);
  };

  const refreshDocumentUrl = async (documentId) => {
    const result = await api.get(`/transfer-requests/${request.id}/review`);
    setDetail(result);
    return result?.documents?.find((d) => d.id === documentId)?.url || null;
  };

  const infoItems = [
    { label: "Resident", value: request.residentName || resident?.name },
    { label: "Health Record No.", value: request.healthRecordNo || resident?.healthRecordNo },
    { label: "From barangay", value: request.fromBarangay },
    { label: "To barangay", value: request.toBarangay },
    { label: "Submitted", value: formatDate(request.submittedAt || request.createdAt) },
    { label: "Status", value: meta.label },
  ];

  const selectAction = (action) => {
    setDecisionPrompt(action);
    setText("");
    setError("");
  };

  const cancelAction = () => {
    if (busy) return;
    setDecisionPrompt(null);
    setText("");
    setError("");
  };

  const run = async (action, payload) => {
    setError("");
    setBusy(action);
    try {
      await onDecide(request, action, payload);
      setBusy("");
      setDecisionPrompt(null);
      setText("");
      try {
        const result = await api.get(`/transfer-requests/${request.id}/review`);
        setDetail(result);
        setHistoryError("");
      } catch {
        setHistoryError("The decision was saved, but request history could not be refreshed.");
      }
    } catch (err) {
      setError(err?.message || "The transfer decision could not be completed.");
      setBusy("");
    }
  };

  const confirmReasonDecision = () => {
    const reason = text.trim();
    if (reason.length < 5) {
      setError("Enter a meaningful explanation of at least 5 characters.");
      return;
    }
    if (reason.length > 1000) {
      setError("The explanation must be 1000 characters or fewer.");
      return;
    }
    run(decisionPrompt === "reject" ? "reject" : "request-resubmission", reason);
  };

  const route = [request.fromBarangay, request.toBarangay].filter(Boolean).join(" → ");
  const supportingDoc = documents.find((doc) => doc.documentType === "transfer_proof_of_address");
  const supportingDocInvalid = supportingDoc
    && ["rejected", "resubmission_required"].includes(supportingDoc.verificationStatus);
  const supportingDocUnreadable = supportingDoc && !supportingDoc.url;
  const canAccept = !docsLoading
    && !docsError
    && Boolean(supportingDoc)
    && !supportingDocInvalid
    && !supportingDocUnreadable;

  return (
    <ReviewModal
      name={request.residentName || "Resident"}
      reference={request.healthRecordNo || undefined}
      meta={route || undefined}
      status={<StatusChip status={request.status} />}
      onClose={onClose}
      closeGuard={() => !decisionPrompt}
      busy={Boolean(busy)}
      ariaLabel={`Transfer request review for ${request.residentName || "resident"}`}
      footer={awaitingReview && canDecide ? (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 sm:gap-3">
          <button
            type="button"
            onClick={() => selectAction("approve")}
            disabled={Boolean(busy) || !canAccept}
            title={!canAccept ? "The required proof of address must be available for review before acceptance." : undefined}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-btn bg-emerald-700 px-3 text-sm font-semibold text-white transition-colors hover:bg-emerald-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy === "approve" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            Accept Transfer
          </button>
          <button
            type="button"
            onClick={() => selectAction("resubmit")}
            disabled={Boolean(busy)}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-btn border border-amber-300 bg-amber-50 px-3 text-sm font-semibold text-amber-900 transition-colors hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy === "request-resubmission" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Request Resubmission
          </button>
          <button
            type="button"
            onClick={() => selectAction("reject")}
            disabled={Boolean(busy)}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-btn border border-rose-300 bg-rose-50 px-3 text-sm font-semibold text-rose-800 transition-colors hover:bg-rose-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy === "reject" ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />}
            Reject Transfer
          </button>
        </div>
      ) : null}
    >
      <ModalSection label="Request Information">
        <InfoGrid>
          {infoItems.map((item) => (
            <InfoItem key={item.label} label={item.label} value={item.value} />
          ))}
          {request.reason && <InfoItem label="Reason for transfer" value={request.reason} full />}
        </InfoGrid>
      </ModalSection>

      {request.status === "resubmission_required" && request.resubmissionInstructions && (
        <p className="rounded-xl border border-sky-200 bg-sky-50 px-3.5 py-2.5 text-sm text-sky-800">
          <span className="font-semibold">Resubmission requested:</span> {request.resubmissionInstructions}
        </p>
      )}
      {request.status === "rejected" && request.rejectionReason && (
        <p className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-sm text-rose-700">
          <span className="font-semibold">Rejection reason:</span> {request.rejectionReason}
        </p>
      )}

      <ModalSection label="Supporting Documents">
        {!supportingDoc && !docsLoading && (
          <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            Required proof of address is missing. Review the request carefully before deciding.
          </p>
        )}
        {supportingDocInvalid && (
          <p className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
            The uploaded proof of address is marked invalid or needs correction.
            {supportingDoc.rejectionReason ? ` ${supportingDoc.rejectionReason}` : ""}
          </p>
        )}
        {supportingDocUnreadable && (
          <p className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
            The proof of address could not be opened for review. Refresh the document link or request a replacement before deciding.
          </p>
        )}
        {docsLoading ? (
          <p className="flex items-center gap-2 text-sm text-brand-gray">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading documents…
          </p>
        ) : docsError ? (
          <p className="text-sm text-brand-danger">{docsError}</p>
        ) : docCards.length > 0 ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {docCards.map((doc) => (
              <DocumentPreviewCard
                key={doc.id}
                doc={doc}
                onEnlarge={openLightbox}
                onRefreshUrl={refreshDocumentUrl}
                filenameWrap
                statusClassName={doc.statusClassName}
              />
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-brand-border bg-brand-bg px-4 py-8 text-center">
            <p className="text-sm font-medium text-brand-ink">No documents were uploaded</p>
            <p className="text-xs text-brand-gray">This transfer request has no supporting documents to review.</p>
          </div>
        )}
      </ModalSection>

      {awaitingReview && !canDecide && (
        <p className="flex items-center gap-1.5 rounded-xl border border-brand-border bg-brand-bg/60 px-3.5 py-2.5 text-sm text-brand-gray dark:border-border dark:bg-card-nested">
          <AlertCircle className="h-4 w-4 shrink-0" />
          Only the receiving barangay&apos;s authorized health supervisor can decide this request.
        </p>
      )}

      {historyError && <p role="status" className="text-sm text-amber-800">{historyError}</p>}
      {decisionHistory.length > 0 && (
        <ModalSection label="Request History">
          <ol className="space-y-3">
            {decisionHistory.map((entry, index) => (
              <li key={`${entry.action}-${entry.createdAt}-${index}`} className="flex items-start justify-between gap-4 border-b border-slate-100 pb-2 last:border-b-0 last:pb-0">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-brand-ink">{auditActionLabel(entry.action)}</p>
                  <p className="mt-0.5 text-xs text-brand-gray">{entry.actorName || "Reviewer"}</p>
                  {(entry.metadata?.reason || entry.metadata?.instructions) && (
                    <p className="mt-1 break-words text-xs text-brand-gray">
                      {entry.metadata.reason || entry.metadata.instructions}
                    </p>
                  )}
                </div>
                <time className="shrink-0 text-right text-xs text-brand-gray">
                  {entry.createdAt ? new Date(entry.createdAt).toLocaleString() : "—"}
                </time>
              </li>
            ))}
          </ol>
        </ModalSection>
      )}

      {decisionPrompt && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-950/50 p-4">
          <section
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="transfer-decision-title"
            aria-describedby="transfer-decision-description"
            className="max-h-[calc(100dvh-2rem)] w-full max-w-lg overflow-y-auto rounded-xl border border-slate-200 bg-white p-5 shadow-2xl"
          >
            <h2 id="transfer-decision-title" className="text-base font-semibold text-brand-ink">
              {decisionPrompt === "approve"
                ? "Confirm residency transfer"
                : decisionPrompt === "reject"
                  ? "Reject transfer request"
                  : "Request corrections"}
            </h2>
            {decisionPrompt === "approve" ? (
              <p id="transfer-decision-description" className="mt-3 text-sm leading-6 text-brand-gray">
                Accepting this request will approve the residency transfer for{" "}
                <span className="font-semibold text-brand-ink">{request.residentName || resident?.name || "this resident"}</span>{" "}
                to <span className="font-semibold text-brand-ink">{request.toBarangay || "the destination barangay"}</span>.
                Their resident record and health history will remain linked to their account.
              </p>
            ) : (
              <div className="mt-3">
                <p id="transfer-decision-description" className="mb-3 text-sm leading-6 text-brand-gray">
                  {decisionPrompt === "reject"
                    ? "Rejection denies this transfer request; the resident will remain assigned to their current barangay. Provide the reason the resident will receive."
                    : "Explain what information or documents the resident must correct. The request will remain editable and can be resubmitted for review."}
                </p>
                <label htmlFor="transfer-decision-field" className="mb-1 block text-sm font-medium text-brand-ink">
                  {decisionPrompt === "reject" ? "Reason for Rejection" : "Reason for Resubmission"}
                </label>
                <textarea
                  id="transfer-decision-field"
                  ref={fieldRef}
                  rows={4}
                  maxLength={1000}
                  required
                  value={text}
                  onChange={(e) => { setText(e.target.value); if (error) setError(""); }}
                  placeholder={decisionPrompt === "reject"
                    ? "Explain why this request is denied."
                    : "Identify the information or supporting documents that need correction."}
                  className={DECISION_TEXTAREA_CLASS}
                />
                <p className="mt-1 text-right text-xs text-brand-gray">{text.length}/1000</p>
              </div>
            )}
            {error && <p role="alert" className="mt-2 text-sm font-medium text-brand-danger">{error}</p>}
            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={cancelAction}
                disabled={Boolean(busy)}
                className="h-10 rounded-btn border border-brand-border px-4 text-sm font-medium text-brand-gray hover:bg-brand-bg disabled:cursor-not-allowed disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                ref={confirmRef}
                onClick={() => decisionPrompt === "approve" ? run("approve") : confirmReasonDecision()}
                disabled={Boolean(busy) || (decisionPrompt === "approve" && !canAccept) || (decisionPrompt !== "approve" && text.trim().length < 5)}
                className={`inline-flex h-10 items-center justify-center gap-2 rounded-btn px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60 ${
                  decisionPrompt === "approve"
                    ? "bg-emerald-700 hover:bg-emerald-800"
                    : decisionPrompt === "reject"
                      ? "bg-rose-700 hover:bg-rose-800"
                      : "bg-amber-700 hover:bg-amber-800"
                }`}
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : decisionPrompt === "approve" ? <CheckCircle2 className="h-4 w-4" /> : decisionPrompt === "reject" ? <XCircle className="h-4 w-4" /> : <FileWarning className="h-4 w-4" />}
                {busy
                  ? "Processing…"
                  : decisionPrompt === "approve"
                    ? "Confirm Accept"
                    : decisionPrompt === "reject"
                      ? "Confirm Rejection"
                      : "Request Resubmission"}
              </button>
            </div>
          </section>
        </div>
      )}

      {lightboxIndex !== null && imageDocs[lightboxIndex] && (
        <ImageLightbox
          images={imageDocs}
          index={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
          onNavigate={setLightboxIndex}
        />
      )}
    </ReviewModal>
  );
}
