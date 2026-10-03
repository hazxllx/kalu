import React from "react";

/**
 * Compact, formal risk badge for a resident's authoritative risk level.
 *
 * The level comes from the backend's persisted/computed risk result — this
 * component never computes risk itself. Tones follow the KALUSAGAP palette
 * (emerald / amber / rose), matching the existing status badges.
 */
const TONES = {
  Low: "bg-emerald-50 text-emerald-700",
  Moderate: "bg-amber-50 text-amber-700",
  High: "bg-rose-50 text-rose-700",
};

export default function RiskBadge({ level, className = "" }) {
  if (!level) {
    return (
      <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium bg-slate-100 text-slate-500 ${className}`}>
        Not assessed
      </span>
    );
  }
  const tone = TONES[level] || "bg-slate-100 text-slate-600";
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium font-body ${tone} ${className}`}>
      <span className="w-1.5 h-1.5 rounded-full bg-current opacity-70" />
      {level}
    </span>
  );
}
