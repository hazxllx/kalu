import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  CheckCircle2, XCircle, History, Loader2, FileText,
} from "lucide-react";
import VerificationBadge from "@/features/verification/components/VerificationBadge";
import ReviewModal, { ModalSection, InfoGrid, InfoItem } from "@/features/users/components/ReviewModal";
import DocumentPreviewCard from "@/features/verification/components/DocumentPreviewCard";
import ImageLightbox from "@/features/verification/components/ImageLightbox";
import { DecisionButton, DecisionButtonRow, DECISION_TEXTAREA_CLASS } from "@/features/verification/components/DecisionButtons";
import { REJECTION_REASONS } from "@/services/local/verifications";
import {
  fetchResidentDocuments,
  reviewMinorAlternative,
  reviewResidentDocument,
} from "@/services/api/verificationsApi";
import { guardianLinksApi } from "@/services/api/guardianLinksApi";

const DOC_LABELS = {
  government_id_front: "ID Front",
  government_id_back: "ID Back",
  identity_photo: "Photo Holding ID",
  proof_of_residency: "Proof of Residency",
  barangay_certificate: "Barangay Certificate",
  barangay_clearance: "Barangay Clearance",
  government_id: "Government ID",
  student_id: "Student ID Verification",
};

const docLabel = (doc) => DOC_LABELS[doc?.documentType] || doc?.fileName || doc?.documentType || "Document";

const isImageDoc = (doc) => String(doc?.mimeType || "").startsWith("image/");

// Staff-facing labels for the deterministic automated screening result. The
// automated check is ADVISORY: "Rejected" here never blocks a staff member from
// viewing the document or making the final decision.
const SCREENING_STATUS_META = {
  pending_manual_review: { label: "Accepted for staff review", tone: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  automated_flagged: { label: "Manual review required", tone: "bg-amber-50 text-amber-700 border-amber-200" },
  automated_rejected: { label: "Rejected by pre-screen", tone: "bg-rose-50 text-rose-700 border-rose-200" },
};

const SCREENING_REASON_LABEL = {
  DOCUMENT_INDICATORS_DETECTED: "Document-specific text detected.",
  NO_DOCUMENT_INDICATORS: "No document-specific text detected.",
  NO_PERSON_DETECTED: "The photo does not clearly show a person holding the ID.",
  DOCUMENT_TYPE_MISMATCH: "Document does not match the selected government ID type.",
  ID_SIDE_FIELDS_CONFLICT: "Some labelled details differ across the submitted ID sides; staff review is required.",
  ID_SIDE_FIELDS_CONSISTENT: "Available labelled fields did not conflict; this is not proof of authenticity and staff review is still required.",
  ID_SIDE_COMPARISON_INCONCLUSIVE: "There was not enough overlapping OCR information to compare both sides.",
  DOCUMENT_SIDE_INCONCLUSIVE: "The ID side could not be conclusively screened; staff review is required.",
  ID_TYPE_UNCONFIRMED: "The selected ID type could not be automatically confirmed; staff review is required.",
  IMAGE_REQUIRES_MANUAL_REVIEW: "Image received for manual review.",
  DOCUMENT_NOT_AUTOMATICALLY_SCREENED: "File type is not automatically screened.",
  OCR_UNAVAILABLE: "Automated text check unavailable; needs manual review.",
  NO_MEANINGFUL_TEXT: "No readable document text detected.",
  INSUFFICIENT_RESOLUTION: "Image resolution is insufficient.",
  BLANK_IMAGE: "Image appears blank.",
  TOO_DARK: "Image is too dark to read.",
  TOO_BRIGHT: "Image has too much glare or brightness.",
  LOW_IMAGE_QUALITY: "Image quality is insufficient.",
  INVALID_FILE_TYPE: "File type is not supported.",
  FILE_TOO_LARGE: "File size is too large.",
  CORRUPTED_FILE: "File appears to be corrupted.",
};

const screeningLabel = (screening) => {
  if (!screening?.status) return null;
  return SCREENING_STATUS_META[screening.status] || null;
};

const screeningReason = (screening) => {
  if (!screening?.reason) return "";
  const [pairReason, sideReason] = String(screening.reason).split(";SIDE:");
  const [reasonCode, fieldList] = pairReason.split("|");
  const pairLabel = SCREENING_REASON_LABEL[reasonCode] || "Automated check completed.";
  const fieldLabels = {
    name: "name",
    surname: "surname",
    givenName: "given name",
    middleName: "middle name",
    dateOfBirth: "date of birth",
    idNumber: "ID number",
  };
  const conflictingFields = fieldList
    ? fieldList.split(",").map((field) => fieldLabels[field]).filter(Boolean)
    : [];
  const detail = conflictingFields.length
    ? ` Conflicting labelled fields: ${conflictingFields.join(", ")}.`
    : "";
  const sideLabel = sideReason ? SCREENING_REASON_LABEL[sideReason] : "";
  return `${pairLabel}${detail}${sideLabel && sideReason !== reasonCode ? ` Side check: ${sideLabel}` : ""}`;
};

const docStatusLabel = (status) => {
  if (status === "approved") return "Approved";
  if (status === "rejected") return "Rejected";
  if (status === "resubmission_required") return "Resubmission required";
  return "Pending Review";
};

const formatDate = (value) => {
  if (!value) return "—";
  const d = new Date(String(value).length === 10 ? `${value}T00:00:00` : value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
};

const formatDateTime = (value) => {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString("en-US", { month: "long", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
};

/**
 * Review modal for a resident registration (Health Supervisor).
 *
 * Uses the shared ReviewModal shell, information grid, document-preview card and
 * image lightbox so it matches the BHW Approval modal exactly, while keeping the
 * resident-specific fields, minor-verification paths, automated screening notes
 * and the approve / reject / resubmission workflow. All decisions are performed
 * by the backend; this component only collects the reviewer's input. The
 * reviewer identity and barangay scope are derived from the session on the
 * server.
 */
export default function VerificationReviewDrawer({
  verification,
  history = [],
  onClose,
  onApprove,
  onReject,
  onRequestResubmission,
  submitting = false,
}) {
  const [mode, setMode] = useState(null); // 'approve' | 'reject' | 'resubmit'
  const [reason, setReason] = useState("");
  const [remarks, setRemarks] = useState("");
  const [error, setError] = useState("");
  const [documents, setDocuments] = useState([]);
  const [docsLoading, setDocsLoading] = useState(true);
  const [docsError, setDocsError] = useState("");
  const [guardianLinks, setGuardianLinks] = useState([]);
  const [guardianLinksError, setGuardianLinksError] = useState("");
  const [reviewReason, setReviewReason] = useState("");
  const [reviewError, setReviewError] = useState("");
  const [reviewBusy, setReviewBusy] = useState(false);
  const [alternativeStatus, setAlternativeStatus] = useState(verification.minorAlternativeStatus);
  const [lightboxIndex, setLightboxIndex] = useState(null);

  const loadDocuments = useCallback(async () => {
    const docs = await fetchResidentDocuments(verification.id);
    setDocuments(docs);
  }, [verification.id]);

  // Reset per-resident state and fetch the SELECTED resident's documents only.
  // Clearing `documents` up front prevents a previous resident's images from
  // lingering while the new request is in flight.
  useEffect(() => {
    let active = true;
    const residentId = verification?.id;
    if (!residentId) return undefined;
    setDocuments([]);
    setLightboxIndex(null);
    setDocsLoading(true);
    setDocsError("");
    fetchResidentDocuments(residentId)
      .then((docs) => { if (active) setDocuments(docs); })
      .catch(() => { if (active) setDocsError("Could not load the submitted documents."); })
      .finally(() => { if (active) setDocsLoading(false); });
    return () => { active = false; };
  }, [verification?.id]);

  useEffect(() => {
    let active = true;
    if (!verification?.isMinor) return undefined;
    guardianLinksApi.listForMinor(verification.id)
      .then((links) => { if (active) setGuardianLinks(links); })
      .catch(() => { if (active) setGuardianLinksError("Could not load guardian relationship requests."); });
    return () => { active = false; };
  }, [verification?.id, verification?.isMinor]);

  const imageDocs = useMemo(
    () => documents.filter(isImageDoc).map((doc) => ({ id: doc.id, title: docLabel(doc), url: doc.url })),
    [documents],
  );

  const openLightbox = useCallback((doc) => {
    const idx = imageDocs.findIndex((d) => d.id === doc.id);
    if (idx >= 0) setLightboxIndex(idx);
  }, [imageDocs]);

  const reviewStudentDocument = async (doc, decision) => {
    if (decision === "rejected" && reviewReason.trim().length < 5) {
      setReviewError("Enter a rejection reason of at least 5 characters.");
      return;
    }
    setReviewError("");
    setReviewBusy(true);
    try {
      await reviewResidentDocument(
        verification.id,
        doc.id,
        decision,
        decision === "rejected" ? reviewReason.trim() : "",
      );
      await loadDocuments();
      setReviewReason("");
    } catch (error) {
      setReviewError(error?.message || "The student ID review could not be saved.");
    } finally {
      setReviewBusy(false);
    }
  };

  const reviewAlternative = async (decision) => {
    if (decision === "rejected" && reviewReason.trim().length < 5) {
      setReviewError("Enter a rejection reason of at least 5 characters.");
      return;
    }
    setReviewError("");
    setReviewBusy(true);
    try {
      const result = await reviewMinorAlternative(
        verification.id,
        decision,
        decision === "rejected" ? reviewReason.trim() : "",
      );
      setAlternativeStatus(result?.verification?.minorAlternativeStatus || decision);
      setReviewReason("");
    } catch (error) {
      setReviewError(error?.message || "The alternative verification review could not be saved.");
    } finally {
      setReviewBusy(false);
    }
  };

  const reviewGuardianLink = async (linkId, decision) => {
    if (decision === "rejected" && reviewReason.trim().length < 5) {
      setReviewError("Enter a relationship rejection reason of at least 5 characters.");
      return;
    }
    setReviewError("");
    setReviewBusy(true);
    try {
      const updated = await guardianLinksApi.review(
        linkId,
        decision,
        decision === "rejected" ? reviewReason.trim() : "",
      );
      setGuardianLinks((items) => items.map((item) => item.id === linkId ? updated.guardianLink || updated : item));
      setReviewReason("");
    } catch (error) {
      setReviewError(error?.message || "The guardian relationship review could not be saved.");
    } finally {
      setReviewBusy(false);
    }
  };

  const reset = () => {
    setReason("");
    setRemarks("");
    setError("");
  };

  const openMode = (next) => {
    reset();
    setMode(next);
  };

  // Escape / backdrop first cancel an open decision form (so an in-progress
  // decision is never silently discarded by closing the whole modal), then
  // close the modal. The lightbox owns its own Escape via the capture phase.
  const closeGuard = useCallback(() => {
    if (mode) {
      setMode(null);
      return false;
    }
    return true;
  }, [mode]);

  const submitReject = () => {
    if (submitting) return;
    if (!reason) return setError("Please select a rejection reason.");
    if (reason === "Other" && remarks.trim().length < 5) {
      return setError('Please describe the reason (at least 5 characters) when choosing "Other".');
    }
    setError("");
    return onReject({ reason, remarks: remarks.trim() });
  };

  const submitResubmission = () => {
    if (submitting) return;
    if (!reason) return setError("Please select a reason for the resubmission request.");
    if (reason === "Other" && remarks.trim().length < 5) {
      return setError('Please describe the reason (at least 5 characters) when choosing "Other".');
    }
    setError("");
    return onRequestResubmission({ reason, remarks: remarks.trim() });
  };

  const status = verification.status || "pending";
  const decided = status !== "pending";

  return (
    <ReviewModal
      name={verification.name}
      reference={verification.ref}
      meta={verification.barangay ? `Barangay ${verification.barangay}` : ""}
      status={<VerificationBadge status={status} size="sm" />}
      onClose={onClose}
      closeGuard={closeGuard}
      busy={submitting}
      ariaLabel={`Verification review for ${verification.name}`}
    >
      <ModalSection label="Registration Details">
        <InfoGrid>
          <InfoItem label="Full Name" value={verification.name} />
          <InfoItem label="Date of Birth" value={formatDate(verification.birthDate)} />
          <InfoItem label="Age" value={verification.age !== "" && verification.age != null ? `${verification.age} years` : ""} />
          <InfoItem label="Sex" value={verification.sex} />
          <InfoItem label="Civil Status" value={verification.civilStatus} />
          <InfoItem label="Contact Number" value={verification.contactNumber} />
          <InfoItem label="Barangay" value={verification.barangay} />
          <InfoItem label="Registration Date" value={formatDate(verification.registeredDate)} />
          <InfoItem label="Address" value={verification.address} full />
          <InfoItem label="Reference Number" value={verification.ref} />
          {verification.isMinor && (
            <InfoItem
              label="Minor verification path"
              value={verification.minorVerificationMethod === "staff_alternative"
                ? `Alternative verification — ${alternativeStatus || "pending review"}`
                : "Student ID"}
            />
          )}
        </InfoGrid>
      </ModalSection>

      {verification.isMinor && verification.minorVerificationMethod === "staff_alternative" && (
        <section className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-amber-800">Alternative Verification Review</p>
          <p className="text-sm text-amber-950">
            Status: {alternativeStatus || "pending review"}
            {verification.minorAlternativeReason ? ` — ${verification.minorAlternativeReason}` : ""}
          </p>
          {alternativeStatus !== "approved" && (
            <div className="mt-3 space-y-2">
              {alternativeStatus === "rejected" && (
                <p className="text-xs text-rose-700">A replacement student ID can be uploaded instead.</p>
              )}
              <textarea
                value={reviewReason}
                onChange={(event) => setReviewReason(event.target.value)}
                maxLength={2000}
                placeholder="Required when rejecting"
                className="w-full rounded border border-brand-border bg-white p-2 text-sm"
              />
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={reviewBusy}
                  onClick={() => reviewAlternative("approved")}
                  className="rounded bg-emerald-700 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
                >
                  Approve alternative
                </button>
                <button
                  type="button"
                  disabled={reviewBusy}
                  onClick={() => reviewAlternative("rejected")}
                  className="rounded bg-rose-700 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
                >
                  Reject alternative
                </button>
              </div>
            </div>
          )}
        </section>
      )}

      <ModalSection label="Submitted Documents">
        {docsLoading ? (
          <div className="flex items-center gap-2 rounded-xl bg-brand-bg p-3 text-sm text-brand-gray">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading documents…
          </div>
        ) : docsError ? (
          <p className="rounded-xl bg-brand-bg p-3 text-sm text-brand-danger">{docsError}</p>
        ) : documents.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-brand-border bg-brand-bg px-4 py-8 text-center">
            <FileText className="h-8 w-8 text-brand-gray" strokeWidth={1.5} />
            <p className="text-sm font-medium text-brand-ink">No documents were uploaded</p>
            <p className="text-xs text-brand-gray">This resident has no submitted documents to review.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {documents.map((doc) => (
              <DocumentPreviewCard
                key={doc.id}
                doc={{
                  id: doc.id,
                  title: docLabel(doc),
                  filename: doc.fileName,
                  mimeType: doc.mimeType,
                  url: doc.url,
                  statusLabel: docStatusLabel(doc.verificationStatus),
                }}
                onEnlarge={openLightbox}
                footer={
                  <>
                    {doc.documentType === "student_id" && doc.verificationStatus === "pending" && (
                      <div className="mt-2 space-y-2 rounded-xl border border-brand-border bg-white p-2">
                        <input
                          value={reviewReason}
                          onChange={(event) => setReviewReason(event.target.value)}
                          maxLength={2000}
                          placeholder="Reason required to reject"
                          className="w-full rounded border border-brand-border p-2 text-xs"
                        />
                        <div className="flex gap-2">
                          <button
                            type="button"
                            disabled={reviewBusy}
                            onClick={() => reviewStudentDocument(doc, "approved")}
                            className="rounded bg-emerald-700 px-2 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                          >
                            Approve
                          </button>
                          <button
                            type="button"
                            disabled={reviewBusy}
                            onClick={() => reviewStudentDocument(doc, "rejected")}
                            className="rounded bg-rose-700 px-2 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                          >
                            Reject
                          </button>
                        </div>
                      </div>
                    )}
                    {doc.documentType === "student_id" && doc.rejectionReason && (
                      <p className="mt-2 rounded-xl border border-rose-100 bg-rose-50 p-2 text-xs text-rose-800">
                        Rejection reason: {doc.rejectionReason}
                      </p>
                    )}
                  </>
                }
              />
            ))}
          </div>
        )}
        {reviewError && <p className="mt-2 text-xs text-rose-700">{reviewError}</p>}
      </ModalSection>

      {verification.isMinor && (
        <ModalSection label="Parent / Guardian Requests">
          {guardianLinksError ? (
            <p className="rounded-xl bg-brand-bg p-3 text-sm text-brand-danger">{guardianLinksError}</p>
          ) : guardianLinks.length === 0 ? (
            <p className="rounded-xl bg-brand-bg p-3 text-sm text-brand-gray">No parent or guardian link request.</p>
          ) : (
            <div className="space-y-2">
              {guardianLinks.map((link) => (
                <div key={link.id} className="rounded-xl border border-brand-border bg-white p-3">
                  <p className="text-sm font-medium text-brand-ink">
                    {link.guardian?.firstName} {link.guardian?.lastName} — {link.relationshipLabel}
                  </p>
                  <p className="mt-1 text-xs text-brand-gray">
                    Status: {link.verificationStatus.replace(/_/g, " ")}
                  </p>
                  {link.verificationNote && <p className="mt-1 text-xs text-rose-700">{link.verificationNote}</p>}
                  {link.verificationStatus === "pending_verification" && (
                    <div className="mt-2 flex gap-2">
                      <button
                        type="button"
                        disabled={reviewBusy}
                        onClick={() => reviewGuardianLink(link.id, "verified")}
                        className="rounded bg-emerald-700 px-2 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                      >
                        Verify relationship
                      </button>
                      <button
                        type="button"
                        disabled={reviewBusy}
                        onClick={() => reviewGuardianLink(link.id, "rejected")}
                        className="rounded bg-rose-700 px-2 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                      >
                        Reject relationship
                      </button>
                    </div>
                  )}
                </div>
              ))}
              <textarea
                value={reviewReason}
                onChange={(event) => setReviewReason(event.target.value)}
                maxLength={2000}
                placeholder="Relationship rejection reason (required for rejection)"
                className="w-full rounded border border-brand-border bg-white p-2 text-sm"
              />
            </div>
          )}
        </ModalSection>
      )}

      {documents.some((doc) => doc.screening?.status) && (
        <ModalSection label="Automated Document Check">
          <div className="space-y-2">
            {documents
              .filter((doc) => doc.screening?.status)
              .map((doc) => {
                const meta = screeningLabel(doc.screening);
                return (
                  <div
                    key={`screening-${doc.id}`}
                    className="rounded-xl border border-brand-border bg-white p-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-medium text-brand-ink">
                        {docLabel(doc)}
                      </p>
                      {meta && (
                        <span className={`rounded-full border px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${meta.tone}`}>
                          {meta.label}
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-brand-gray">{screeningReason(doc.screening)}</p>
                  </div>
                );
              })}
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-brand-gray">
            This is a rule-based readability pre-check only. It does not authenticate the document;
            the final decision remains with authorized staff.
          </p>
        </ModalSection>
      )}

      {(verification.rejectionReason || verification.verifiedAt) && (
        <ModalSection label="Previous Decision">
          <div className="space-y-2 text-sm">
            {verification.verifiedAt && (
              <div className="flex items-center justify-between gap-3">
                <p className="text-brand-gray">Reviewed</p>
                <p className="font-medium text-brand-ink">{formatDateTime(verification.verifiedAt)}</p>
              </div>
            )}
            {verification.rejectionReason && (
              <div className="border-t border-brand-border pt-2">
                <p className="text-brand-gray">Reason</p>
                <p className="mt-1 font-medium text-brand-ink">{verification.rejectionReason}</p>
              </div>
            )}
          </div>
        </ModalSection>
      )}

      {history.length > 0 && (
        <ModalSection label="Verification History">
          <div className="mb-3 flex items-center gap-2">
            <History className="h-4 w-4 text-brand-blue" strokeWidth={1.8} />
            <span className="text-xs font-semibold uppercase tracking-wide text-brand-gray">Timeline</span>
          </div>
          <ol className="space-y-3">
            {history.map((entry) => (
              <li key={entry.id} className="text-sm">
                <p className="font-medium text-brand-ink capitalize">{entry.action}</p>
                <p className="text-xs text-brand-gray">
                  {formatDateTime(entry.createdAt)}
                  {entry.previousStatus && entry.newStatus ? ` · ${entry.previousStatus} → ${entry.newStatus}` : ""}
                </p>
                {entry.reason && <p className="mt-0.5 text-xs text-brand-ink">Reason: {entry.reason}</p>}
              </li>
            ))}
          </ol>
        </ModalSection>
      )}

      {/* Decision actions */}
      {!decided && (
        <ModalSection label="Verification Decision">
          {!mode && (
            <DecisionButtonRow columns={3}>
              <DecisionButton variant="approve" onClick={() => openMode("approve")}>
                Approve Resident
              </DecisionButton>
              <DecisionButton variant="resubmit" onClick={() => openMode("resubmit")}>
                Request Resubmission
              </DecisionButton>
              <DecisionButton variant="reject" onClick={() => openMode("reject")}>
                Reject Resident
              </DecisionButton>
            </DecisionButtonRow>
          )}

          {mode === "approve" && (
            <div className="space-y-3">
              <p className="text-sm text-brand-gray">
                Approve <span className="font-medium text-brand-ink">{verification.name}</span>? The resident will gain
                full access to resident features.
              </p>
              <div className="flex justify-end gap-3">
                <button onClick={() => setMode(null)} disabled={submitting} className="rounded-btn px-4 py-2 text-sm font-medium text-brand-gray hover:bg-brand-bg">
                  Cancel
                </button>
                <button
                  onClick={() => onApprove()}
                  disabled={submitting}
                  className="flex items-center gap-2 rounded-btn bg-brand-blue px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-dark disabled:opacity-60"
                >
                  {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                  Confirm approval
                </button>
              </div>
            </div>
          )}

          {(mode === "reject" || mode === "resubmit") && (
            <div className="space-y-3.5">
              <p className="text-sm text-brand-gray">
                {mode === "reject"
                  ? `Select the reason for rejecting ${verification.name}'s registration.`
                  : `Select the reason for requesting a resubmission from ${verification.name}.`}
              </p>
              <div className="space-y-1.5">
                {REJECTION_REASONS.map((r) => (
                  <label
                    key={r}
                    className={`flex cursor-pointer items-center gap-2.5 rounded-btn border px-3.5 py-2.5 text-sm transition-colors ${
                      reason === r ? "border-brand-danger/40 bg-brand-danger/5 text-brand-ink" : "border-brand-border bg-white text-brand-ink hover:bg-brand-bg"
                    }`}
                  >
                    <input
                      type="radio"
                      name="rejection-reason"
                      checked={reason === r}
                      onChange={() => {
                        setReason(r);
                        setError("");
                      }}
                      className="h-4 w-4 accent-brand-danger"
                    />
                    {r}
                  </label>
                ))}
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-brand-ink">
                  Remarks {reason === "Other" && <span className="text-red-500">*</span>}
                </label>
                <textarea
                  rows={3}
                  value={remarks}
                  onChange={(e) => {
                    setRemarks(e.target.value);
                    setError("");
                  }}
                  placeholder="Add details the resident should see..."
                  className={DECISION_TEXTAREA_CLASS}
                />
              </div>
              {error && <p className="text-xs text-red-600">{error}</p>}
              <div className="flex items-center justify-end gap-3">
                <button onClick={() => setMode(null)} disabled={submitting} className="rounded-btn px-4 py-2 text-sm font-medium text-brand-gray hover:bg-brand-bg">
                  Cancel
                </button>
                <button
                  onClick={mode === "reject" ? submitReject : submitResubmission}
                  disabled={submitting}
                  className="flex items-center gap-2 rounded-btn bg-brand-danger px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-danger/90 disabled:opacity-60"
                >
                  {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <XCircle className="w-4 h-4" />}
                  {mode === "reject" ? "Confirm rejection" : "Confirm request"}
                </button>
              </div>
            </div>
          )}
        </ModalSection>
      )}

      {decided && (
        <ModalSection label="Decision Recorded">
          <p className="text-sm text-brand-gray">
            This registration is <span className="font-medium text-brand-ink">{status.replace("_", " ")}</span>. Use the
            resident's history above to review the decision.
          </p>
        </ModalSection>
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
