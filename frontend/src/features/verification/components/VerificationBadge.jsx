import React from "react";
import { ShieldCheck, ShieldAlert, ShieldX } from "lucide-react";

const SIZES = {
  sm: { icon: "w-3 h-3", text: "text-[10px]", pad: "px-2 py-0.5", gap: "gap-1" },
  md: { icon: "w-3.5 h-3.5", text: "text-xs", pad: "px-2.5 py-1", gap: "gap-1.5" },
  lg: { icon: "w-4 h-4", text: "text-sm", pad: "px-3 py-1.5", gap: "gap-1.5" },
};

export default function VerificationBadge({ status = "pending", size = "md", showIcon = true, className = "" }) {
  const s = SIZES[size];
  const normalized = String(status).toLowerCase();
  const isVerified = normalized === "verified" || normalized === "approved";
  const isRejected = normalized === "rejected";
  const label = isVerified ? "Verified" : isRejected ? "Rejected" : "Pending Verification";
  const tone = isVerified
    ? "bg-emerald-50 text-emerald-700"
    : isRejected
      ? "bg-rose-50 text-rose-700"
      : "bg-amber-50 text-amber-700";

  return (
    <span className={`inline-flex items-center ${s.gap} ${s.pad} rounded-full ${s.text} font-body font-medium ${tone} ${className}`}>
      {showIcon && (isVerified
        ? <ShieldCheck className={s.icon} strokeWidth={2} />
        : isRejected
          ? <ShieldX className={s.icon} strokeWidth={2} />
          : <ShieldAlert className={s.icon} strokeWidth={2} />
      )}
      {label}
    </span>
  );
}