import React, { useCallback, useEffect, useState } from "react";
import PageHeader from "@/components/common/PageHeader";
import { Card } from "@/components/common/Card";
import { Skeleton } from "@/components/common/Skeleton";
import VerificationBanner from "@/features/verification/components/VerificationBanner";
import { fetchMyVerification } from "@/services/api/verificationsApi";
import { fetchMyDocuments } from "@/services/api/verificationsApi";
import { guardianLinksApi } from "@/services/api/guardianLinksApi";
import { postFormData } from "@/services/api/apiClient";
import { useAuth } from "@/context/AuthContext";
import { CheckCircle2, Clock, FileWarning, History, ShieldX, UploadCloud } from "lucide-react";

/**
 * Resident-facing verification status page.
 *
 * Shows the current manual-verification status, the reason when a resubmission
 * is required, and the audit history of the resident's OWN registration. The
 * data comes from the backend; nothing here can change the status.
 */

const ACTION_META = {
  submitted: { label: "Registration submitted", Icon: Clock, tone: "text-brand-blue bg-brand-light" },
  approved: { label: "Approved by Health Supervisor", Icon: CheckCircle2, tone: "text-emerald-700 bg-emerald-50" },
  rejected: { label: "Reviewed — action required", Icon: ShieldX, tone: "text-rose-700 bg-rose-50" },
  resubmitted: { label: "Resubmitted for review", Icon: FileWarning, tone: "text-brand-blue bg-brand-light" },
};

const formatDateTime = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
};

const statusLabel = (status) =>
  ({
    pending: "Pending Verification",
    approved: "Approved",
    rejected: "Rejected",
    resubmission_required: "Resubmission Required",
  })[status] || "Pending Verification";

export default function ResidentVerificationStatus() {
  const [state, setState] = useState(null);
  const [loading, setLoading] = useState(true);
  const [documents, setDocuments] = useState([]);
  const [documentsError, setDocumentsError] = useState("");
  const [guardianState, setGuardianState] = useState(null);
  const [incomingRequests, setIncomingRequests] = useState([]);
  const [guardianError, setGuardianError] = useState("");
  const [guardianNotice, setGuardianNotice] = useState("");
  const [guardianEmail, setGuardianEmail] = useState("");
  const [guardianRelationship, setGuardianRelationship] = useState("");
  const [studentFile, setStudentFile] = useState(null);
  const [studentBusy, setStudentBusy] = useState(false);
  const [studentError, setStudentError] = useState("");
  const [guardianBusy, setGuardianBusy] = useState(false);
  const { refreshProfile } = useAuth();

  const load = useCallback(async () => {
    setLoading(true);
    guardianLinksApi.getMine()
      .then(setGuardianState)
      .catch(() => setGuardianError("Parent/guardian link status could not be loaded."));
    guardianLinksApi.getIncoming()
      .then(setIncomingRequests)
      .catch(() => setGuardianError("Incoming parent/guardian requests could not be loaded."));
    try {
      const result = await fetchMyVerification();
      setState(result);
      if (result?.verification?.id) {
        fetchMyDocuments(result.verification.id)
          .then(setDocuments)
          .catch(() => setDocumentsError("Your documents could not be loaded. Please retry."));
      }
      // If the manual review has been approved, re-resolve the account profile
      // so the session's role flips from 'resident-limited' to 'resident' and
      // the full resident area unlocks immediately — no re-login required.
      if (result?.verification?.status === "approved") {
        refreshProfile?.();
      }
    } catch {
      setState(null);
    } finally {
      setLoading(false);
    }
  }, [refreshProfile]);

  useEffect(() => {
    const message = sessionStorage.getItem("guardianLinkNotice");
    if (message) {
      setGuardianNotice(message);
      sessionStorage.removeItem("guardianLinkNotice");
    }
  }, []);

  const reloadGuardianLinks = async () => {
    const [own, incoming] = await Promise.all([
      guardianLinksApi.getMine(),
      guardianLinksApi.getIncoming(),
    ]);
    setGuardianState(own);
    setIncomingRequests(incoming);
    setGuardianError("");
  };

  const requestGuardianLink = async (event) => {
    event.preventDefault();
    setGuardianBusy(true);
    setGuardianError("");
    try {
      await guardianLinksApi.request({ email: guardianEmail, relationshipType: guardianRelationship });
      setGuardianNotice("If an eligible account matches, its holder can review the request after signing in. Staff verification is also required.");
      setGuardianEmail("");
      await reloadGuardianLinks();
    } catch (error) {
      setGuardianError(error?.message || "The parent/guardian request could not be submitted.");
    } finally {
      setGuardianBusy(false);
    }
  };

  const cancelGuardianLink = async () => {
    setGuardianBusy(true);
    setGuardianError("");
    try {
      await guardianLinksApi.cancel();
      await reloadGuardianLinks();
    } catch (error) {
      setGuardianError(error?.message || "The pending link request could not be cancelled.");
    } finally {
      setGuardianBusy(false);
    }
  };

  const respondToGuardian = async (id, decision) => {
    setGuardianBusy(true);
    setGuardianError("");
    try {
      await guardianLinksApi.respond(id, decision);
      await reloadGuardianLinks();
    } catch (error) {
      setGuardianError(error?.message || "The parent/guardian request could not be updated.");
    } finally {
      setGuardianBusy(false);
    }
  };

  const replaceStudentId = async (event) => {
    event.preventDefault();
    if (!studentFile || !verification?.id) return;
    setStudentBusy(true);
    setStudentError("");
    try {
      const formData = new FormData();
      formData.append("file", studentFile);
      formData.append("documentType", "student_id");
      formData.append("residentId", verification.id);
      await postFormData("/resident-documents/upload", formData);
      const updated = await fetchMyDocuments(verification.id);
      setDocuments(updated);
      setStudentFile(null);
    } catch (error) {
      setStudentError(error?.message || "The student ID could not be uploaded. It has not been marked rejected.");
    } finally {
      setStudentBusy(false);
    }
  };

  useEffect(() => {
    load();
  }, [load]);

  const history = state?.history || [];
  const verification = state?.verification;
  const completeness = verification?.completeness === true || verification?.completeness === "complete";
  const currentStatus = verification?.status;
  const studentDocument = documents.find((document) => document.documentType === "student_id");
  const guardianLink = guardianState?.links?.[0] || null;
  const guardianLinkStatus = guardianState?.status || "skipped";
  const canRequestGuardianLink = guardianState?.isMinor
    && !["pending_verification", "verified"].includes(guardianLinkStatus);

  return (
    <>
      <PageHeader
        crumbs={["Dashboard", "Verification Status"]}
        title="Verification Status"
        subtitle="Your registration is reviewed manually by the Health Supervisor of your barangay."
      />

      <div className="space-y-5">
        <VerificationBanner />

        {verification && (
          <Card className="space-y-3 p-5">
            <p className="flex flex-wrap gap-x-2 text-sm">
              <span className="font-semibold text-brand-ink">Completeness:</span>
              <span className={completeness ? "text-brand-green" : "text-brand-danger"}>
                {completeness ? "Complete" : "Incomplete"}
              </span>
            </p>
            <div className="text-sm">
              <p className="flex flex-wrap gap-x-2">
                <span className="font-semibold text-brand-ink">Verification:</span>
                <span className="text-brand-gray">
                  {currentStatus === "approved"
                    ? "Approved"
                    : currentStatus === "rejected"
                      ? "Rejected"
                      : "Pending review"}
                </span>
              </p>
              {currentStatus === "rejected" && verification.rejectionReason && (
                <p className="mt-1 text-brand-danger">
                  Rejection reason: {verification.rejectionReason}
                </p>
              )}
              {currentStatus === "pending" && (
                <p className="mt-1 text-brand-gray">
                  {completeness
                    ? "Waiting for reviewer."
                    : "Missing or unreadable documents. Resubmit to continue."}
                </p>
              )}
            </div>
          </Card>
        )}

        {verification?.isMinor && (
          <>
            <Card className="space-y-3 p-5">
              <div>
                <h3 className="font-semibold text-brand-ink">Student ID Verification</h3>
                <p className="mt-1 text-sm text-brand-gray">
                  {documentsError || (studentDocument
                    ? `${studentDocument.fileName} · ${studentDocument.verificationStatus === "approved" ? "Approved" : studentDocument.verificationStatus === "rejected" ? "Rejected" : "Pending Review"}`
                    : "No student ID has been submitted.")}
                </p>
                {studentDocument?.url && (
                  <a href={studentDocument.url} target="_blank" rel="noreferrer" className="mt-2 inline-block text-sm text-brand-blue underline">
                    View submitted student ID
                  </a>
                )}
                {studentDocument?.verificationStatus === "rejected" && studentDocument.rejectionReason && (
                  <p className="mt-2 text-sm text-brand-danger">Reason: {studentDocument.rejectionReason}</p>
                )}
              </div>
              {(!studentDocument || studentDocument.verificationStatus === "rejected") && (
                <form onSubmit={replaceStudentId} className="space-y-2">
                  <label className="block text-sm font-medium text-brand-ink" htmlFor="replacement-student-id">
                    {studentDocument ? "Replace rejected student ID" : "Upload student ID"}
                  </label>
                  <input
                    id="replacement-student-id"
                    type="file"
                    accept=".png,.jpg,.jpeg,.pdf"
                    onChange={(event) => setStudentFile(event.target.files?.[0] || null)}
                    className="block w-full text-sm"
                  />
                  {studentFile && <p className="text-xs text-brand-gray">{studentFile.name}</p>}
                  <button
                    type="submit"
                    disabled={!studentFile || studentBusy}
                    className="inline-flex items-center gap-2 rounded bg-brand-blue px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
                  >
                    <UploadCloud className="h-4 w-4" />
                    {studentBusy ? "Uploading…" : "Submit for staff review"}
                  </button>
                  {studentError && <p role="alert" className="text-sm text-brand-danger">{studentError}</p>}
                </form>
              )}
            </Card>

            <Card className="space-y-3 p-5">
              <div>
                <h3 className="font-semibold text-brand-ink">Parent / Guardian Link</h3>
                <p className="mt-1 text-sm text-brand-gray">
                  Status: {guardianLinkStatus === "pending_guardian_acceptance"
                    ? "Pending account-holder acceptance"
                    : guardianLinkStatus === "pending_verification"
                      ? "Accepted; pending staff verification"
                      : guardianLinkStatus === "verified"
                        ? "Confirmed by staff"
                        : guardianLinkStatus === "rejected"
                          ? "Rejected"
                          : guardianLinkStatus === "cancelled"
                            ? "Cancelled"
                            : "Skipped / no active link"}
                </p>
                {guardianLink?.verificationNote && <p className="text-sm text-brand-danger">Reason: {guardianLink.verificationNote}</p>}
                {guardianNotice && <p role="status" className="text-sm text-brand-blue">{guardianNotice}</p>}
                {["pending_guardian_acceptance", "pending_verification"].includes(guardianLinkStatus) && (
                  <button
                    type="button"
                    disabled={guardianBusy}
                    onClick={() => cancelGuardianLink()}
                    className="mt-2 rounded border border-brand-border px-3 py-2 text-sm font-semibold text-brand-ink disabled:opacity-50"
                  >
                    Cancel pending request
                  </button>
                )}
              </div>
              {canRequestGuardianLink && (
                <form onSubmit={requestGuardianLink} className="space-y-3 border-t border-brand-border pt-3">
                  <p className="text-xs leading-relaxed text-brand-gray">
                    Request a link to an existing account. The account holder must accept and staff must verify the relationship. Entering an email does not give anyone access to your records.
                  </p>
                  <label className="block text-sm font-medium text-brand-ink" htmlFor="guardian-email-status">Parent or guardian registered email</label>
                  <input
                    id="guardian-email-status"
                    type="email"
                    autoComplete="email"
                    required
                    value={guardianEmail}
                    onChange={(event) => setGuardianEmail(event.target.value)}
                    className="w-full rounded border border-brand-border bg-white px-3 py-2 text-sm"
                  />
                  <label className="block text-sm font-medium text-brand-ink" htmlFor="guardian-relationship-status">Relationship</label>
                  <select
                    id="guardian-relationship-status"
                    required
                    value={guardianRelationship}
                    onChange={(event) => setGuardianRelationship(event.target.value)}
                    className="w-full rounded border border-brand-border bg-white px-3 py-2 text-sm"
                  >
                    <option value="">Select relationship</option>
                    <option value="father">Father</option>
                    <option value="mother">Mother</option>
                    <option value="legal_guardian">Legal guardian</option>
                    <option value="grandparent">Grandparent</option>
                    <option value="other_family_member">Other family member</option>
                    <option value="other">Other</option>
                  </select>
                  <button type="submit" disabled={guardianBusy} className="rounded bg-brand-blue px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">
                    {guardianBusy ? "Submitting…" : "Request link"}
                  </button>
                </form>
              )}
              {guardianError && <p role="alert" className="text-sm text-brand-danger">{guardianError}</p>}
            </Card>
          </>
        )}

        {(incomingRequests.length > 0 || guardianError) && (
          <Card className="space-y-3 p-5">
            <h3 className="font-semibold text-brand-ink">Incoming parent / guardian requests</h3>
            {incomingRequests.map((request) => (
              <div key={request.id} className="rounded border border-brand-border p-3">
              <p className="text-sm text-brand-ink">
                {request.minor?.name || "A minor resident"} · {request.relationshipLabel}
              </p>
              <p className="mt-1 text-xs text-brand-gray">
                Accepting a request does not grant access; staff verification is still required.
              </p>
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  disabled={guardianBusy}
                  onClick={() => respondToGuardian(request.id, "accepted")}
                  className="rounded bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                >
                  Accept
                </button>
                <button
                  type="button"
                  disabled={guardianBusy}
                  onClick={() => respondToGuardian(request.id, "rejected")}
                  className="rounded bg-rose-700 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                >
                  Reject
                </button>
              </div>
              </div>
            ))}
            {guardianError && <p role="alert" className="text-sm text-brand-danger">{guardianError}</p>}
          </Card>
        )}

        {state?.verification?.status === "pending" && (
          <Card className="p-5">
            <p className="text-sm font-semibold text-brand-ink">While you wait</p>
            <ul className="mt-2 space-y-1.5 text-sm text-brand-gray">
              <li>• Your registration is in the barangay review queue.</li>
              <li>• The Health Supervisor may contact you to confirm your details.</li>
              <li>• Health records and consultation features unlock after approval.</li>
            </ul>
          </Card>
        )}

        <Card className="overflow-hidden">
          <div className="flex items-center gap-2 border-b border-brand-border px-6 py-4">
            <History className="h-4 w-4 text-brand-blue" strokeWidth={1.8} />
            <h3 className="font-heading text-sm font-semibold text-brand-ink">Verification history</h3>
          </div>
          <div className="px-6 py-5">
            {loading ? (
              <div className="space-y-3">
                <Skeleton className="h-4 w-1/3" />
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-4 w-1/2" />
              </div>
            ) : history.length === 0 ? (
              <p className="text-sm text-brand-gray">No verification activity recorded yet.</p>
            ) : (
              <ol className="space-y-4">
                {history.map((entry) => {
                  const meta = ACTION_META[entry.action] || ACTION_META.submitted;
                  const { Icon } = meta;
                  return (
                    <li key={entry.id} className="flex items-start gap-3">
                      <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${meta.tone}`}>
                        <Icon className="h-4 w-4" strokeWidth={1.9} />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-brand-ink">{meta.label}</p>
                        <p className="text-xs text-brand-gray">
                          {formatDateTime(entry.createdAt)}
                          {entry.previousStatus && entry.newStatus
                            ? ` · ${statusLabel(entry.previousStatus)} → ${statusLabel(entry.newStatus)}`
                            : ""}
                        </p>
                        {entry.reason && <p className="mt-1 text-xs text-brand-ink">Reason: {entry.reason}</p>}
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </div>
        </Card>
      </div>
    </>
  );
}
