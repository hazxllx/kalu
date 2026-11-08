import React from "react";

const SIZES = {
  sm: { text: "text-xs", pad: "px-2 py-0.5" },
  md: { text: "text-xs", pad: "px-2.5 py-1" },
  lg: { text: "text-sm", pad: "px-3 py-1.5" },
};

/**
 * Compact, restrained status pill for the verification module.
 *
 * A single, low-chroma tone per state — no icons, no gradients — so the table
 * reads cleanly and the status stays scannable at a glance:
 *
 *   Pending .............. amber
 *   Under Review ......... blue
 *   Approved / Verified .. green
 *   Rejected ............. red
 *   Resubmission required. soft amber (a "needs action" state)
 *   Anything else ........ neutral gray
 */
export default function VerificationBadge({ status = "pending", size = "md", className = "" }) {
  const s = SIZES[size];
  const normalized = String(status).toLowerCase();
  const isVerified = normalized === "verified" || normalized === "approved";
  const isRejected = normalized === "rejected";
  const isUnderReview = normalized === "under_review" || normalized === "under-review" || normalized === "reviewing";
  const isResubmission = normalized === "resubmission_required" || normalized.includes("return");

  const label = isVerified
    ? "Approved"
    : isUnderReview
      ? "Under Review"
      : isResubmission
        ? "Resubmission Required"
        : isRejected
          ? "Rejected"
          : normalized === "pending"
            ? "Pending"
            : String(status || "Pending").replaceAll("_", " ");

  const tone = isVerified
    ? "bg-emerald-50 text-emerald-700"
    : isRejected
      ? "bg-rose-50 text-rose-700"
      : isUnderReview
        ? "bg-sky-50 text-sky-700"
        : isResubmission
          ? "bg-amber-50 text-amber-700"
          : normalized === "pending"
            ? "bg-amber-50 text-amber-700"
            : "bg-slate-100 text-slate-600";

  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-full font-body font-medium ${s.text} ${s.pad} ${tone} ${className}`}
    >
      {label}
    </span>
  );
}