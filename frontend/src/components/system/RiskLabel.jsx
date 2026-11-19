import React from "react";
import { TYPE } from "@/lib/designTokens";
import { canonicalRiskLevel, RISK_PRESENTATION } from "@/lib/riskLevel";

/**
 * Authoritative risk label for a resident's risk level.
 *
 * Risk is high-stakes health data, so it gets a restrained tinted label
 * rather than a plain dot. High risk is the strongest treatment (tinted +
 * bold). Moderate/Low keep a subtle tint with lower contrast. Unassessed
 * uses the neutral badge tone.
 */
export default function RiskLabel({ level, className = "" }) {
  const label = canonicalRiskLevel(level) || "Unassessed";
  const tone = RISK_PRESENTATION[label];
  const isHigh = label === "High" || label === "Critical";

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-[4px] px-2 py-0.5 ${tone.badge} ${className}`}
      style={{
        fontFamily: TYPE.body.family,
        fontSize: "12px",
        fontWeight: isHigh ? 700 : 600,
      }}
    >
      <span
        className={`inline-block shrink-0 rounded-full h-1.5 w-1.5`}
        style={{ backgroundColor: "currentColor" }}
        aria-hidden="true"
      />
      {label}
    </span>
  );
}

/**
 * Backward-compatible bridge for existing RiskBadge consumers.
 */
export function RiskBadge({ level, className = "" }) {
  return <RiskLabel level={level} className={className} />;
}
