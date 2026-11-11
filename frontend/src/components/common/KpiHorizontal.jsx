import React from "react";

/**
 * Horizontal KPI Container with Divided Layout
 *
 * Displays KPI metrics in a single horizontal container with vertical dividers.
 * Uses the supervisor-metric-grid CSS pattern for consistent styling.
 *
 * Design features:
 * - White background with subtle border
 * - Vertical dividers between KPI sections
 * - Equal-width columns (3 or 4)
 * - Responsive: adapts columns on tablet and mobile
 * - No icons or decorative elements
 * - Clean, minimal, professional appearance
 *
 * Usage:
 * <KpiHorizontal count={3}>
 *   <KpiHorizontal.Item label="Label" value={100} tone="blue" description="Description" />
 *   <KpiHorizontal.Item label="Label" value={50} tone="green" description="Description" />
 *   <KpiHorizontal.Item label="Label" value={25} tone="amber" description="Description" />
 * </KpiHorizontal>
 */
export default function KpiHorizontal({ children, count = 4, className = "" }) {
  const gridClass = `supervisor-metric-grid ${count === 3 ? "is-three" : ""} ${className}`;
  return <div className={gridClass}>{children}</div>;
}

/**
 * Individual KPI section within the horizontal container.
 *
 * Props:
 * - label: KPI label (typically uppercase)
 * - value: Numeric or string value
 * - tone: Color scheme - "blue" (default), "green" (success), "amber" (pending), "danger" (high-risk)
 * - description: Optional short supporting text
 * - onClick: Optional click handler for interactive KPIs
 */
KpiHorizontal.Item = function KpiHorizontalItem({
  label,
  value,
  tone = "blue",
  description = null,
  onClick = null,
  className = "",
}) {
  const numeric = typeof value === "number" || (typeof value === "string" && /^[\d,.]+$/.test(value));
  
  // Map new tone names to legacy supervisor-metric tones
  const toneMap = {
    blue: "blue",
    green: "green",
    amber: "yellow",
    red: "danger",
    indigo: "blue",
    slate: "accent",
    teal: "accent",
  };
  
  const supervisorTone = toneMap[tone] || "blue";
  
  // Map tones to border colors for the top accent
  const borderColorMap = {
    blue: "#2563EB",
    green: "#15945A",
    yellow: "#D97706",
    danger: "#DC3545",
    accent: "#0D9488",
  };

  const Element = onClick ? "button" : "div";
  const borderColor = borderColorMap[supervisorTone];
  
  return (
    <Element
      type={onClick ? "button" : undefined}
      onClick={onClick}
      data-tone={supervisorTone}
      className={`supervisor-metric ${onClick ? "cursor-pointer" : ""} ${className}`}
      style={{ borderTop: `3px solid ${borderColor}` }}
    >
      <div className="supervisor-metric-label">{label}</div>
      <div className="supervisor-metric-value" data-numeric={numeric}>
        {value}
      </div>
      {description && <div className="supervisor-metric-description">{description}</div>}
    </Element>
  );
};
