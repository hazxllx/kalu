// frontend/src/features/analytics/components/RiskOverview.jsx
import React from "react";
import { normalizeRiskDistribution, RISK_PRESENTATION } from "@/lib/riskLevel";

const RISK_ROWS = [
  "High", "Moderate", "Low", "Unassessed",
];

export default function RiskOverview({
  distribution = [],
  compact = false,
  loading = false,
  error = "",
  emptyMessage = "No consultations with vitals have been recorded yet, so no risk levels can be computed.",
}) {
  const normalized = normalizeRiskDistribution(distribution);
  const labels = normalized.some((row) => row.name === "Critical") ? ["Critical", ...RISK_ROWS] : RISK_ROWS;
  const counts = labels.map((label) => ({
    label,
    color: RISK_PRESENTATION[label].bar,
    valueColor: RISK_PRESENTATION[label].text,
    value: normalized.find((row) => row.name === label)?.value || 0,
  }));
  const assessed = counts.reduce((total, row) => total + row.value, 0);

  if (loading) {
    return <p className="text-xs text-brand-gray">Loading resident risk levels…</p>;
  }
  if (error) {
    return <p className="text-xs text-brand-gray">{error}</p>;
  }

  return (
    <div className={`ui-risk-overview ${compact ? "space-y-2" : "space-y-3"}`}>
      {counts.map((row) => {
        const percentage = assessed > 0 ? Math.round((row.value / assessed) * 100) : 0;
        return (
          <div key={row.label} className={compact ? "h-8" : ""}>
            <div className={`flex items-center justify-between ${compact ? "mb-1 h-4" : "mb-1 text-sm"}`}>
              <span className={`${compact ? "text-[13px] font-medium text-brand-ink" : "text-brand-gray"}`}>
                {row.label}
              </span>
              <span className={`font-stat text-[13px] font-semibold ${compact ? "text-brand-ink" : row.valueColor}`}>
                {row.value}
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-brand-border">
              <div className={`h-full rounded-full ${row.color}`} style={{ width: `${percentage}%` }} />
            </div>
          </div>
        );
      })}
      {!counts.some((row) => row.label !== "Unassessed" && row.value > 0) && (
        <p className="text-xs text-brand-gray">
          {emptyMessage}
        </p>
      )}
    </div>
  );
}
