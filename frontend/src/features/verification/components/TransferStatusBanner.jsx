import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowRight, BadgeCheck, Clock, FileText, RotateCcw, ShieldAlert } from "lucide-react";
import { Card } from "@/components/common/Card";
import { api } from "@/services/api";

/**
 * Resident-facing residency-transfer status.
 *
 * Reads the resident's OWN latest transfer request (`GET /transfer-requests/me`)
 * and shows its real, canonical state — so the dashboard never implies a
 * transfer is complete while it is still pending. While pending the resident may
 * VIEW (read-only) the health record they uploaded; they can never edit the
 * official record from here. Renders nothing when there is no active/decided
 * transfer, so a resident who has never transferred sees their normal dashboard.
 */

const META = {
  transfer_pending: {
    label: "Transfer Pending",
    heading: "Your transfer request is being reviewed",
    chip: "border-brand-gold/40 bg-brand-gold/15 text-brand-dark",
    message: "Your residency transfer request is currently being reviewed by the health office.",
    Icon: Clock,
  },
  transfer_approved: {
    label: "Transfer Approved",
    heading: "Your residency transfer has been approved",
    chip: "border-brand-green/25 bg-brand-green/10 text-brand-green",
    message: "Your residency transfer has been approved. Your current barangay has been updated and your existing health record remains associated with your account.",
    Icon: BadgeCheck,
  },
  transfer_resubmission: {
    label: "Corrections Needed",
    heading: "A few details before your transfer can be approved",
    chip: "border-brand-gold/40 bg-brand-gold/15 text-brand-dark",
    message: "The health office needs corrections before your residency transfer can be approved. Review the instructions below and resubmit your request.",
    Icon: RotateCcw,
  },
  transfer_rejected: {
    label: "Transfer Rejected",
    heading: "Your transfer request was not approved",
    chip: "border-brand-danger/25 bg-brand-danger/10 text-brand-danger",
    message: "Your residency transfer request was rejected. Your current barangay and health records are unchanged.",
    Icon: ShieldAlert,
  },
};

const formatDate = (iso) => {
  if (!iso) return "";
  const d = new Date(String(iso).length === 10 ? `${iso}T00:00:00` : iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
};

export default function TransferStatusBanner() {
  const [transfer, setTransfer] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const result = await api.get("/transfer-requests/me");
        if (active) setTransfer(result?.transfer || null);
      } catch {
        if (active) setTransfer(null);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, []);

  if (loading || !transfer) return null;
  // Drafts and cancelled requests are working/withdrawn state — not shown.
  const meta = META[transfer.residencyStatus];
  if (!meta) return null;

  const { Icon } = meta;
  const healthRecords = (transfer.documents || []).filter((d) => d.kind === "imported_health_record");

  return (
    <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="mb-5">
      <Card className="overflow-hidden rounded-lg border border-brand-border bg-white p-0 shadow-none">
        <div className="flex flex-col gap-4 p-5 md:p-6">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-mono text-[9px] uppercase tracking-[0.15em] text-brand-gray">Residency transfer</p>
            <span className="h-1 w-1 rounded-full bg-brand-border" />
            <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[9px] font-semibold uppercase tracking-[0.1em] ${meta.chip}`}>
              <Icon className="h-3 w-3" strokeWidth={1.8} aria-hidden="true" />
              {meta.label}
            </span>
          </div>

          <div className="flex flex-col gap-3">
            <h2 className="max-w-2xl font-display text-xl leading-tight text-brand-ink">{meta.heading}</h2>
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-brand-border bg-brand-bg px-2.5 py-1 text-[11px] font-medium text-brand-blue">{transfer.fromBarangay || "—"}</span>
              <ArrowRight className="h-3.5 w-3.5 text-brand-gray" aria-hidden="true" />
              <span className="rounded-full border border-brand-border bg-brand-bg px-2.5 py-1 text-[11px] font-medium text-brand-blue">{transfer.toBarangay || "—"}</span>
            </div>
            <p className="max-w-2xl text-[13px] leading-relaxed text-brand-gray">{meta.message}</p>
          </div>

            {transfer.submittedAt && (
              <p className="font-mono text-[10px] uppercase tracking-[0.09em] text-brand-gray">
                Submitted on <span className="font-medium text-brand-ink">{formatDate(transfer.submittedAt)}</span>
              </p>
            )}

            {transfer.residencyStatus === "transfer_rejected" && transfer.rejectionReason && (
              <p className="rounded-lg border border-brand-border bg-brand-bg px-4 py-3 text-[13px] leading-relaxed text-brand-ink">
                <span className="font-semibold">Reason</span>
                <span className="mt-1 block">{transfer.rejectionReason}</span>
              </p>
            )}

            {transfer.residencyStatus === "transfer_resubmission" && (
              <div>
                {transfer.resubmissionInstructions && (
                  <p className="rounded-lg border border-brand-border bg-brand-bg px-4 py-3 text-[13px] leading-relaxed text-brand-ink">
                    <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.13em] text-brand-gray">Instruction</span>
                    <span className="mt-1 block">{transfer.resubmissionInstructions}</span>
                  </p>
                )}
                <Link
                  to="/register/transfer"
                  className="mt-3 inline-flex items-center gap-2 rounded-full bg-brand-blue px-4 py-2 text-[12px] font-semibold text-white transition-colors hover:bg-brand-dark"
                >
                  Provide corrections & resubmit <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </div>
            )}

            {healthRecords.length > 0 && (
              <div>
                <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-brand-gray">Imported health record</p>
                <ul className="mt-2 space-y-2">
                  {healthRecords.map((doc) => (
                    <li key={doc.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-brand-border px-4 py-3 text-xs">
                      <FileText className="h-4 w-4 shrink-0 text-brand-blue" />
                      <span className="min-w-0 flex-1 truncate text-brand-ink">{doc.fileName}</span>
                      <span className="shrink-0 rounded-full bg-brand-gold/15 px-2.5 py-1 font-mono text-[9px] font-semibold uppercase tracking-[0.08em] text-brand-dark">
                        Pending verification
                      </span>
                      {doc.url && (
                        <a href={doc.url} target="_blank" rel="noreferrer" className="shrink-0 font-semibold text-brand-blue underline">
                          View
                        </a>
                      )}
                    </li>
                  ))}
                </ul>
                <p className="mt-1.5 text-[11px] text-brand-gray">
                  This uploaded record is read-only and awaiting verification by authorized health personnel.
                </p>
              </div>
            )}
        </div>
      </Card>
    </motion.div>
  );
}
