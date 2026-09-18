import React, { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { AlertTriangle, BadgeCheck, Clock, Loader2, RefreshCw, RotateCcw, ShieldAlert } from "lucide-react";

import { Card } from "@/components/common/Card";
import { fetchMyVerification, resubmitOwnVerification } from "@/services/api/verificationsApi";
import { registrationApi } from "@/services/api";

/**
 * Dashboard banner for the resident's manual verification state.
 *
 * Reads the real status from the backend (`GET /verifications/me`). There is no
 * fake refresh timer: "Refresh" re-fetches, and the status is only ever changed
 * by a Health Supervisor decision on the server.
 */

const META = {
  pending: {
    label: "Pending Verification",
    tone: "border-amber-200 bg-amber-50",
    iconWrap: "border-amber-200 bg-white text-amber-700",
    chip: "text-amber-700 bg-amber-100",
    message: "Your registration is pending Health Supervisor review.",
    Icon: Clock,
  },
  approved: {
    label: "Approved by Health Supervisor",
    tone: "border-emerald-200 bg-emerald-50",
    iconWrap: "border-emerald-200 bg-white text-emerald-700",
    chip: "text-emerald-700 bg-emerald-100",
    message: "Your registration has been approved. You now have full access to resident features.",
    Icon: BadgeCheck,
  },
  rejected: {
    label: "Registration Rejected",
    tone: "border-rose-200 bg-rose-50",
    iconWrap: "border-rose-200 bg-white text-rose-700",
    chip: "text-rose-700 bg-rose-100",
    message: "Your registration was rejected. Please review the reason and resubmit.",
    Icon: ShieldAlert,
  },
  resubmission_required: {
    label: "Resubmission Required",
    tone: "border-amber-200 bg-amber-50",
    iconWrap: "border-amber-200 bg-white text-amber-700",
    chip: "text-amber-700 bg-amber-100",
    message: "The Health Supervisor asked for your registration to be corrected and resubmitted.",
    Icon: AlertTriangle,
  },
};

const formatDate = (iso) => {
  if (!iso) return "";
  const d = new Date(String(iso).length === 10 ? `${iso}T00:00:00` : iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
};

export default function VerificationBanner() {
  const [state, setState] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [resubmitting, setResubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      let next = await fetchMyVerification();

      // If the resident confirmed their email after registration, the resident
      // record may not exist yet. Finish creating it from the payload the
      // registration page kept, then re-read the real status. One-time,
      // authenticated server call — the client never sets a status.
      if (!next.hasResidentRecord) {
        let pending = null;
        try {
          const raw = sessionStorage.getItem("pendingResidentRegistration");
          pending = raw ? JSON.parse(raw) : null;
        } catch {
          pending = null;
        }
        if (pending?.resident) {
          try {
            await registrationApi.registerResident(pending);
            sessionStorage.removeItem("pendingResidentRegistration");
            sessionStorage.removeItem("registrationNeedsConfirmation");
            next = await fetchMyVerification();
          } catch {
            /* fall through to the no-record state below */
          }
        }
      }

      setState(next);
    } catch {
      setError("We could not load your verification status. Please try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleResubmit = async () => {
    if (!state?.verification?.id) return;
    setResubmitting(true);
    setError("");
    try {
      await resubmitOwnVerification(state.verification.id);
      await load();
    } catch (err) {
      setError(err?.message || "We could not resubmit your registration. Please try again.");
    } finally {
      setResubmitting(false);
    }
  };

  if (loading) {
    return (
      <Card className="flex items-center gap-4 p-6" role="status" aria-label="Loading verification status">
        <div className="h-12 w-12 shrink-0 animate-pulse rounded-xl bg-slate-100" />
        <div className="flex-1 space-y-2">
          <div className="h-4 w-40 animate-pulse rounded bg-slate-100" />
          <div className="h-3 w-2/3 animate-pulse rounded bg-slate-100" />
        </div>
      </Card>
    );
  }

  const status = state?.verification?.status || "pending";
  const meta = META[status] || META.pending;
  const { Icon } = meta;
  const verification = state?.verification;
  const canResubmit = status === "rejected" || status === "resubmission_required";

  if (state && state.hasResidentRecord === false) {
    return (
      <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}>
        <Card className="border-slate-200 p-6">
          <p className="text-sm font-semibold text-brand-ink">No resident record is linked to your account yet.</p>
          <p className="mt-1 text-sm text-brand-gray">
            Please contact your Barangay Health Station or the RHU so your resident record can be completed.
          </p>
        </Card>
      </motion.div>
    );
  }

  return (
    <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}>
      <Card className={`p-6 ${meta.tone}`}>
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-4">
            <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border ${meta.iconWrap}`}>
              <Icon className="h-6 w-6" strokeWidth={1.8} aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-brand-gray">Verification status</p>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <h2 className="font-heading text-lg font-semibold text-brand-ink">{meta.label}</h2>
                <span className={`inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-[0.06em] ${meta.chip}`}>
                  Manual review
                </span>
              </div>
              <p className="mt-1.5 max-w-xl text-sm leading-relaxed text-brand-gray">{meta.message}</p>

              {verification?.submittedAt && (
                <p className="mt-2 text-xs text-brand-gray">
                  Submitted on <span className="font-medium text-brand-ink">{formatDate(verification.submittedAt)}</span>
                  {verification.barangay ? ` · Barangay ${verification.barangay}` : ""}
                </p>
              )}

              {canResubmit && verification?.rejectionReason && (
                <p className="mt-3 rounded-lg border border-brand-danger/20 bg-white px-3 py-2 text-xs text-brand-ink">
                  <span className="font-semibold">Reason:</span> {verification.rejectionReason}
                </p>
              )}
            </div>
          </div>

          <div className="flex shrink-0 flex-col items-stretch gap-2 sm:items-end">
            {canResubmit && (
              <button
                type="button"
                onClick={handleResubmit}
                disabled={resubmitting}
                className="inline-flex items-center justify-center gap-2 rounded-btn bg-brand-blue px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-dark disabled:opacity-60"
              >
                {resubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
                {resubmitting ? "Resubmitting…" : "Resubmit registration"}
              </button>
            )}
            {!canResubmit && status !== "approved" && (
              <button
                type="button"
                onClick={load}
                className="inline-flex items-center justify-center gap-2 rounded-btn border border-brand-border bg-white px-4 py-2 text-sm font-medium text-brand-gray transition-colors hover:bg-brand-bg"
              >
                <RefreshCw className="h-4 w-4" /> Refresh status
              </button>
            )}
          </div>
        </div>

        {error && (
          <p role="alert" className="mt-4 flex items-center gap-2 text-sm font-medium text-brand-danger">
            <ShieldAlert className="h-4 w-4 shrink-0" /> {error}
          </p>
        )}
      </Card>
    </motion.div>
  );
}
