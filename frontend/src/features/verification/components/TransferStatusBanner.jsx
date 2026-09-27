import React, { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { ArrowRight, BadgeCheck, Clock, FileText, ShieldAlert } from "lucide-react";
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
    tone: "border-amber-200 bg-amber-50",
    iconWrap: "border-amber-200 bg-white text-amber-700",
    chip: "text-amber-700 bg-amber-100",
    message: "Your residency transfer request is currently being reviewed by the health office.",
    Icon: Clock,
  },
  transfer_approved: {
    label: "Transfer Approved",
    tone: "border-emerald-200 bg-emerald-50",
    iconWrap: "border-emerald-200 bg-white text-emerald-700",
    chip: "text-emerald-700 bg-emerald-100",
    message: "Your residency transfer has been approved. Your current barangay has been updated and your existing health record remains associated with your account.",
    Icon: BadgeCheck,
  },
  transfer_rejected: {
    label: "Transfer Rejected",
    tone: "border-rose-200 bg-rose-50",
    iconWrap: "border-rose-200 bg-white text-rose-700",
    chip: "text-rose-700 bg-rose-100",
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
    <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="mb-6">
      <Card className={`p-6 ${meta.tone}`}>
        <div className="flex items-start gap-4">
          <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border ${meta.iconWrap}`}>
            <Icon className="h-6 w-6" strokeWidth={1.8} aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-brand-gray">Residency transfer</p>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <h2 className="font-heading text-lg font-semibold text-brand-ink">{meta.label}</h2>
              <span className={`inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-[0.06em] ${meta.chip}`}>
                {(transfer.fromBarangay || "—")}
                <ArrowRight className="mx-1 inline h-3 w-3" />
                {(transfer.toBarangay || "—")}
              </span>
            </div>
            <p className="mt-1.5 max-w-xl text-sm leading-relaxed text-brand-gray">{meta.message}</p>

            {transfer.submittedAt && (
              <p className="mt-2 text-xs text-brand-gray">
                Submitted on <span className="font-medium text-brand-ink">{formatDate(transfer.submittedAt)}</span>
              </p>
            )}

            {transfer.residencyStatus === "transfer_rejected" && transfer.rejectionReason && (
              <p className="mt-3 rounded-lg border border-brand-danger/20 bg-white px-3 py-2 text-xs text-brand-ink">
                <span className="font-semibold">Reason:</span> {transfer.rejectionReason}
              </p>
            )}

            {healthRecords.length > 0 && (
              <div className="mt-4">
                <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-brand-gray">Imported health record</p>
                <ul className="mt-1.5 space-y-1.5">
                  {healthRecords.map((doc) => (
                    <li key={doc.id} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs">
                      <FileText className="h-4 w-4 shrink-0 text-brand-blue" />
                      <span className="min-w-0 flex-1 truncate text-brand-ink">{doc.fileName}</span>
                      <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 font-bold uppercase tracking-wide text-amber-700">
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
        </div>
      </Card>
    </motion.div>
  );
}
