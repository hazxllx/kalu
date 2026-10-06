import React, { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  X, CheckCircle2, XCircle, FileWarning, User, MapPin, Calendar, Phone, Hash, History, Loader2, FileText,
  Shield,
} from "lucide-react";
import VerificationBadge from "@/features/verification/components/VerificationBadge";
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

function InfoCell({ icon: Icon, label, value }) {
  return (
    <div className="rounded-btn bg-brand-bg p-3">
      <div className="flex items-center gap-1.5">
        {Icon && <Icon className="w-3.5 h-3.5 text-brand-gray" strokeWidth={1.8} />}
        <p className="text-[11px] text-brand-gray uppercase tracking-wide">{label}</p>
      </div>
      <p className="mt-1 text-sm font-medium text-brand-ink">{value || "—"}</p>
    </div>
  );
}

function SectionTitle({ children }) {
  return <p className="mb-2.5 text-xs font-semibold uppercase tracking-wide text-brand-gray">{children}</p>;
}

/**
 * Review drawer for a resident registration.
 *
 * Shows the resident's submitted details and verification history and lets the
 * reviewer approve, reject (reason required) or request a resubmission. All
 * actions are performed by the backend; this component only collects the
 * reviewer's input and renders the result. The reviewer identity is derived
 * from the session on the server.
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

  const loadDocuments = useCallback(async () => {
    const docs = await fetchResidentDocuments(verification.id);
    setDocuments(docs);
  }, [verification.id]);

  useEffect(() => {
    let active = true;
    const residentId = verification?.id;
    if (!residentId) return undefined;
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
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      if (mode) setMode(null);
      else onClose();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [mode, onClose]);

  const reset = () => {
    setReason("");
    setRemarks("");
    setError("");
  };

  const openMode = (next) => {
    reset();
    setMode(next);
  };

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
    <div className="fixed inset-0 z-50">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="absolute inset-0 bg-brand-deep/60"
      />
      <motion.aside
        initial={{ x: "100%" }}
        animate={{ x: 0 }}
        exit={{ x: "100%" }}
        transition={{ type: "tween", duration: 0.25, ease: "easeOut" }}
        className="absolute right-0 top-0 flex h-full w-full flex-col bg-brand-bg shadow-2xl sm:max-w-xl"
        role="dialog"
        aria-modal="true"
        aria-label={`Verification review for ${verification.name}`}
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-brand-border bg-white px-5 py-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand-blue text-sm font-heading font-semibold text-white">
              {(verification.name || "?").split(" ").map((n) => n[0]).slice(0, 2).join("")}
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="truncate font-heading font-semibold text-brand-ink">{verification.name}</h3>
                <VerificationBadge status={status} size="sm" />
              </div>
              <p className="text-xs text-brand-gray">
                Reference <span className="font-stat font-medium">{verification.ref}</span> · Barangay {verification.barangay}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-brand-gray transition-colors hover:bg-brand-bg hover:text-brand-ink"
            aria-label="Close review panel"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
          <section>
            <SectionTitle>Registration Details</SectionTitle>
            <div className="grid grid-cols-2 gap-3">
              <InfoCell icon={User} label="Full Name" value={verification.name} />
              <InfoCell icon={Calendar} label="Date of Birth" value={formatDate(verification.birthDate)} />
              <InfoCell icon={User} label="Age" value={verification.age !== "" ? `${verification.age} years` : ""} />
              <InfoCell icon={User} label="Sex" value={verification.sex} />
              <InfoCell icon={User} label="Civil Status" value={verification.civilStatus} />
              <InfoCell icon={Phone} label="Contact Number" value={verification.contactNumber} />
              <InfoCell icon={MapPin} label="Barangay" value={verification.barangay} />
              <InfoCell icon={Calendar} label="Registration Date" value={formatDate(verification.registeredDate)} />
              {verification.isMinor && (
                <InfoCell
                  icon={Shield}
                  label="Minor verification path"
                  value={verification.minorVerificationMethod === "staff_alternative"
                    ? `Alternative verification — ${alternativeStatus || "pending review"}`
                    : "Student ID"}
                />
              )}
            </div>
            <div className="mt-3 grid grid-cols-1 gap-3">
              <InfoCell icon={MapPin} label="Address" value={verification.address} />
              <InfoCell icon={Hash} label="Reference Number" value={verification.ref} />
            </div>
          </section>

          {verification.isMinor && verification.minorVerificationMethod === "staff_alternative" && (
            <section className="rounded-btn border border-amber-200 bg-amber-50 p-4">
              <SectionTitle>Alternative Verification Review</SectionTitle>
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

          <section>
            <SectionTitle>Submitted Documents</SectionTitle>
            {docsLoading ? (
              <div className="flex items-center gap-2 rounded-btn bg-brand-bg p-3 text-sm text-brand-gray">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading documents…
              </div>
            ) : docsError ? (
              <p className="rounded-btn bg-brand-bg p-3 text-sm text-brand-danger">{docsError}</p>
            ) : documents.length === 0 ? (
              <p className="rounded-btn bg-brand-bg p-3 text-sm text-brand-gray">No documents were uploaded.</p>
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {documents.map((doc) => (
                  <div key={doc.id} className="overflow-hidden rounded-btn border border-brand-border bg-white">
                    <a
                      href={doc.url}
                      target="_blank"
                      rel="noreferrer"
                      className="group block transition-colors hover:border-brand-blue"
                      title={`Open ${DOC_LABELS[doc.documentType] || doc.documentType}`}
                    >
                      <div className="flex h-28 items-center justify-center overflow-hidden bg-brand-bg">
                        {isImageDoc(doc) ? (
                          <img src={doc.url} alt={DOC_LABELS[doc.documentType] || doc.documentType} className="h-full w-full object-cover" />
                        ) : (
                          <FileText className="h-8 w-8 text-brand-blue" strokeWidth={1.6} />
                        )}
                      </div>
                      <p className="truncate px-2.5 py-2 text-xs font-medium text-brand-ink">
                        {DOC_LABELS[doc.documentType] || doc.documentType}
                      </p>
                      <p className="px-2.5 pb-2 text-[11px] text-brand-gray">
                        {doc.verificationStatus === "approved" ? "Approved" : doc.verificationStatus === "rejected" ? "Rejected" : "Pending Review"}
                      </p>
                    </a>
                    {doc.documentType === "student_id" && doc.verificationStatus === "pending" && (
                      <div className="space-y-2 border-t border-brand-border p-2">
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
                      <p className="border-t border-rose-100 bg-rose-50 p-2 text-xs text-rose-800">
                        Rejection reason: {doc.rejectionReason}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
            {reviewError && <p className="mt-2 text-xs text-rose-700">{reviewError}</p>}
          </section>

          {verification.isMinor && (
            <section>
              <SectionTitle>Parent / Guardian Requests</SectionTitle>
              {guardianLinksError ? (
                <p className="rounded-btn bg-brand-bg p-3 text-sm text-brand-danger">{guardianLinksError}</p>
              ) : guardianLinks.length === 0 ? (
                <p className="rounded-btn bg-brand-bg p-3 text-sm text-brand-gray">No parent or guardian link request.</p>
              ) : (
                <div className="space-y-2">
                  {guardianLinks.map((link) => (
                    <div key={link.id} className="rounded-btn border border-brand-border bg-white p-3">
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
            </section>
          )}

          {documents.some((doc) => doc.screening?.status) && (
            <section>
              <SectionTitle>Automated Document Check</SectionTitle>
              <div className="space-y-2">
                {documents
                  .filter((doc) => doc.screening?.status)
                  .map((doc) => {
                    const meta = screeningLabel(doc.screening);
                    return (
                      <div
                        key={`screening-${doc.id}`}
                        className="rounded-btn border border-brand-border bg-white p-3"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-sm font-medium text-brand-ink">
                            {DOC_LABELS[doc.documentType] || doc.documentType}
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
            </section>
          )}

          {(verification.rejectionReason || verification.verifiedAt) && (
            <section className="rounded-btn border border-brand-border bg-white p-4">
              <SectionTitle>Previous Decision</SectionTitle>
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
            </section>
          )}

          {history.length > 0 && (
            <section className="rounded-btn border border-brand-border bg-white p-4">
              <div className="mb-3 flex items-center gap-2">
                <History className="h-4 w-4 text-brand-blue" strokeWidth={1.8} />
                <SectionTitle>Verification History</SectionTitle>
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
            </section>
          )}

          {/* Decision actions */}
          {!decided && (
            <section className="rounded-btn border border-brand-border bg-white p-4">
              <SectionTitle>Verification Decision</SectionTitle>
              {!mode && (
                <div className="space-y-2.5">
                  <button
                    onClick={() => openMode("approve")}
                    className="flex w-full items-center justify-center gap-2 rounded-btn bg-brand-blue py-3 text-sm font-medium text-white shadow-soft transition-colors hover:bg-brand-dark"
                  >
                    <CheckCircle2 className="w-4 h-4" /> Approve Resident
                  </button>
                  <button
                    onClick={() => openMode("resubmit")}
                    className="flex w-full items-center justify-center gap-2 rounded-btn border border-brand-border bg-white py-3 text-sm font-medium text-brand-gray transition-colors hover:bg-brand-bg"
                  >
                    <FileWarning className="w-4 h-4" /> Request Resubmission
                  </button>
                  <button
                    onClick={() => openMode("reject")}
                    className="flex w-full items-center justify-center gap-2 rounded-btn border border-brand-danger/30 bg-brand-danger/5 py-3 text-sm font-medium text-brand-danger transition-colors hover:bg-brand-danger/10"
                  >
                    <XCircle className="w-4 h-4" /> Reject Resident
                  </button>
                </div>
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
                      className="w-full resize-none rounded-btn border border-brand-border bg-white px-3 py-2.5 text-sm text-brand-ink outline-none transition-colors focus:border-brand-blue"
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
            </section>
          )}

          {decided && (
            <section className="rounded-btn border border-brand-border bg-white p-4">
              <SectionTitle>Decision Recorded</SectionTitle>
              <p className="text-sm text-brand-gray">
                This registration is <span className="font-medium text-brand-ink">{status.replace("_", " ")}</span>. Use the
                resident's history above to review the decision.
              </p>
            </section>
          )}
        </div>
      </motion.aside>
    </div>
  );
}
