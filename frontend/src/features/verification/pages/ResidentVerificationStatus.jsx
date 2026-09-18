import React, { useCallback, useEffect, useState } from "react";
import PageHeader from "@/components/common/PageHeader";
import { Card } from "@/components/common/Card";
import { Skeleton } from "@/components/common/Skeleton";
import VerificationBanner from "@/features/verification/components/VerificationBanner";
import { fetchMyVerification } from "@/services/api/verificationsApi";
import { CheckCircle2, Clock, FileWarning, History, ShieldX } from "lucide-react";

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

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setState(await fetchMyVerification());
    } catch {
      setState(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const history = state?.history || [];

  return (
    <>
      <PageHeader
        crumbs={["Dashboard", "Verification Status"]}
        title="Verification Status"
        subtitle="Your registration is reviewed manually by the Health Supervisor of your barangay."
      />

      <div className="space-y-5">
        <VerificationBanner />

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
