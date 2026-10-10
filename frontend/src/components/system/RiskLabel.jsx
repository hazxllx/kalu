import React from "react";
import { TYPE } from "@/lib/designTokens";
import StatusIndicator from "./StatusIndicator";

/**
 * Authoritative risk label for a resident's risk level.
 *
 * Risk is high-stakes health data, so it gets a restrained tinted label
 * rather than a plain dot. High risk is the strongest treatment (tinted +
 * bold). Medium/Low keep a subtle tint with lower contrast. Not assessed is
 * gray dot only, no tint, to avoid false urgency.
 */
const RISK_TONES = {
  High: { dot: "#B3202C", label: "#B3202C", tint: "rgba(179,32,44,0.08)" },
  Medium: { dot: "#B98A1E", label: "#B98A1E", tint: "rgba(185,138,30,0.10)" },
  Low: { dot: "#1F7A4C", label: "#1F7A4C", tint: "rgba(31,122,76,0.08)" },
};

export default function RiskLabel({ level, className = "" }) {
  if (!level) {
    return (
      <StatusIndicator value="Not assessed" size="sm" className={className} />
    );
  }

  const tone = RISK_TONES[level] || RISK_TONES.Medium;
  const isDark = document.documentElement.classList.contains("dark");
  const dotColor = isDark ? { ...tone, dot: tone.label } : tone; // amber stays amber in dark

  const isHigh = level === "High";

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-[4px] px-2 py-0.5 ${className}`}
      style={{
        fontFamily: TYPE.body.family,
        fontSize: "12px",
        color: tone.label,
        backgroundColor: tone.tint,
        fontWeight: isHigh ? 700 : 600,
      }}
    >
      <span
        className={`inline-block shrink-0 rounded-full h-1.5 w-1.5`}
        style={{ backgroundColor: dotColor.dot }}
        aria-hidden="true"
      />
      {level}
    </span>
  );
}

/**
 * Backward-compatible bridge for existing RiskBadge consumers.
 */
export function RiskBadge({ level, className = "" }) {
  return <RiskLabel level={level} className={className} />;
}
