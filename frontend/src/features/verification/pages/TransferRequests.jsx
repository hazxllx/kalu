import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AlertCircle, ArrowRight, ChevronRight, Inbox, Loader2, RefreshCw } from "lucide-react";
import { usePermissions } from "@/context/PermissionsContext";
import { api } from "@/services/api";
import VerificationQueueToolbar from "@/features/verification/components/VerificationQueueToolbar";
import ReviewModal, { ModalSection, InfoGrid, InfoItem } from "@/features/users/components/ReviewModal";
import {
  DecisionButton,
  DecisionButtonRow,
  DECISION_TEXTAREA_CLASS,
} from "@/features/verification/components/DecisionButtons";
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
    await api.post(`/transfer-requests/${request.id}/${action}`, body);
    setNotice(
      action === "approve"
        ? "Transfer approved. The resident has been reassigned to the destination barangay."
        : action === "reject"
          ? "Transfer rejected. The resident has been notified."
          : "Resubmission requested. The resident has been notified to make corrections.",
    );
    closeReview();
    await load();
  }, [canReviewTransfers, closeReview, load]);

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
 * Centered transfer-request detail modal with the approve / reject /
 * request-resubmission actions. The rejection-reason and resubmission-
 * instructions fields appear only when their action is selected, and the matching
 * text is required before the decision is submitted. All buttons disable while a
 * decision is processing to prevent duplicate submissions.
 */
function TransferReviewModal({ request, onClose, onDecide }) {
  const [detail, setDetail] = useState(null);
  const [docsLoading, setDocsLoading] = useState(true);
  const [docsError, setDocsError] = useState("");
  const [pendingAction, setPendingAction] = useState(null); // null | 'reject' | 'resubmit'
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [lightboxIndex, setLightboxIndex] = useState(null);
  const fieldRef = useRef(null);

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
    setPendingAction(null);
    setText("");
    setError("");
    api
      .get(`/transfer-requests/${request.id}/review`)
      .then((result) => { if (active) setDetail(result); })
      .catch((err) => { if (active) setDocsError(err?.message || "The transfer documents could not be loaded."); })
      .finally(() => { if (active) setDocsLoading(false); });
    return () => { active = false; };
  }, [request.id]);

  // Focus the revealed field so keyboard users land on it immediately.
  useEffect(() => {
    if (pendingAction) fieldRef.current?.focus();
  }, [pendingAction]);

  const resident = detail?.resident;
  const documents = detail?.documents || [];

  const docCards = useMemo(
    () =>
      documents.map((d) => ({
        id: d.id,
        title: d.documentType || "Document",
        filename: d.fileName,
        mimeType: guessMime(d.fileName),
        url: d.url,
        statusLabel: d.verificationStatus ? `Status: ${d.verificationStatus}` : "",
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
    setPendingAction(action);
    setText("");
    setError("");
  };

  const cancelAction = () => {
    if (busy) return;
    setPendingAction(null);
    setText("");
    setError("");
  };

  const run = async (action, payload) => {
    setError("");
    setBusy(action);
    try {
      await onDecide(request, action, payload);
      // On success the parent closes the modal and this component unmounts.
    } catch (err) {
      setError(err?.message || "The transfer decision could not be completed.");
      setBusy("");
    }
  };

  const confirmReject = () => {
    const reason = text.trim();
    if (!reason) {
      setError("Enter a reason before rejecting a transfer request.");
      return;
    }
    run("reject", reason);
  };

  const confirmResubmit = () => {
    const instructions = text.trim();
    if (!instructions) {
      setError("Enter instructions before requesting a resubmission.");
      return;
    }
    run("request-resubmission", instructions);
  };

  const route = [request.fromBarangay, request.toBarangay].filter(Boolean).join(" → ");

  return (
    <ReviewModal
      name={request.residentName || "Resident"}
      reference={request.healthRecordNo || undefined}
      meta={route || undefined}
      status={<StatusChip status={request.status} />}
      onClose={onClose}
      busy={Boolean(busy)}
      ariaLabel={`Transfer request review for ${request.residentName || "resident"}`}
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

      {awaitingReview && canDecide && (
        <ModalSection label="Transfer Decision">
          {!pendingAction ? (
            <DecisionButtonRow columns={3}>
              <DecisionButton
                variant="approve"
                loading={busy === "approve"}
                disabled={Boolean(busy)}
                onClick={() => run("approve")}
              >
                Approve Transfer
              </DecisionButton>
              <DecisionButton
                variant="resubmit"
                disabled={Boolean(busy)}
                onClick={() => selectAction("resubmit")}
              >
                Request Resubmission
              </DecisionButton>
              <DecisionButton
                variant="reject"
                disabled={Boolean(busy)}
                onClick={() => selectAction("reject")}
              >
                Reject
              </DecisionButton>
            </DecisionButtonRow>
          ) : (
            <div className="space-y-3">
              <div>
                <label
                  htmlFor="transfer-decision-field"
                  className="mb-1 block text-xs font-semibold uppercase tracking-wide text-brand-gray"
                >
                  {pendingAction === "reject" ? "Rejection reason" : "Resubmission instructions"}
                </label>
                <textarea
                  id="transfer-decision-field"
                  ref={fieldRef}
                  rows={3}
                  value={text}
                  onChange={(e) => { setText(e.target.value); if (error) setError(""); }}
                  placeholder={
                    pendingAction === "reject"
                      ? "Explain why this transfer is being rejected. The resident will see this reason."
                      : "Describe exactly what the resident must correct and resubmit."
                  }
                  className={DECISION_TEXTAREA_CLASS}
                />
                {error && <p className="mt-1 text-xs text-brand-danger">{error}</p>}
              </div>
              <DecisionButton
                variant={pendingAction === "reject" ? "reject" : "resubmit"}
                loading={busy === (pendingAction === "reject" ? "reject" : "request-resubmission")}
                disabled={Boolean(busy)}
                onClick={pendingAction === "reject" ? confirmReject : confirmResubmit}
              >
                {pendingAction === "reject" ? "Confirm Rejection" : "Confirm Resubmission Request"}
              </DecisionButton>
              <button
                type="button"
                onClick={cancelAction}
                disabled={Boolean(busy)}
                className="w-full rounded-btn px-4 py-2 text-sm font-medium text-brand-gray transition-colors hover:text-brand-ink disabled:cursor-not-allowed disabled:opacity-60 dark:hover:text-foreground"
              >
                Cancel
              </button>
            </div>
          )}
        </ModalSection>
      )}

      {awaitingReview && !canDecide && (
        <p className="flex items-center gap-1.5 rounded-xl border border-brand-border bg-brand-bg/60 px-3.5 py-2.5 text-sm text-brand-gray dark:border-border dark:bg-card-nested">
          <AlertCircle className="h-4 w-4 shrink-0" />
          Only the receiving barangay&apos;s authorized health supervisor can decide this request.
        </p>
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
