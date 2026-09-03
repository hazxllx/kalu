import React from "react";
import { hhBadgeTone } from "../lib/householdOptions";

/**
 * Color-coded pill badge for household tracking values (HH Status, Approval
 * Status, Risk Level, Pending Sync). Same shape as the common StatusBadge but
 * with the household profiling color scheme.
 */
export default function HHBadge({ value, label, className = "" }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium font-body whitespace-nowrap ${hhBadgeTone(value)} ${className}`}
    >
      <span className="w-1.5 h-1.5 rounded-full bg-current opacity-70" />
      {label || value}
    </span>
  );
}
