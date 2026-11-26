// frontend/src/components/common/RiskBadge.jsx
import React from "react";
import { canonicalRiskLevel, RISK_PRESENTATION } from "@/lib/riskLevel";

/**
 * Compact, formal risk badge for a resident's authoritative risk level.
 *
 * The level comes from the backend's persisted/computed risk result — this
 * component never computes risk itself. Tones follow the KALUSAGAP palette
 * (emerald / amber / rose), matching the existing status badges.
 */
export default function RiskBadge({ level, assessmentStatus = null, className = "", mediumLabel = "Moderate", unassessedLabel = "Unassessed" }) {
  const label = canonicalRiskLevel(level) || (assessmentStatus === "incomplete" ? "Incomplete" : unassessedLabel);
  const incompleteTone = "bg-orange-50 text-orange-800 dark:bg-orange-950/40 dark:text-orange-300";
  if (label === "Incomplete") {
    return <span className={`ui-status-badge inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium font-body ${incompleteTone} ${className}`}>
      <span aria-hidden="true" className="w-1.5 h-1.5 rounded-full bg-current opacity-70" />Incomplete
    </span>;
  }
  const tone = RISK_PRESENTATION[label].badge;
  return (
    <span className={`ui-status-badge inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium font-body ${tone} ${className}`}>
      <span aria-hidden="true" className="w-1.5 h-1.5 rounded-full bg-current opacity-70" />
      {label === "Moderate" ? mediumLabel : label}
    </span>
  );
}
