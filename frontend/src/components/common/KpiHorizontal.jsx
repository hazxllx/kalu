import React from "react";

/**
 * Horizontal KPI Container with Divided Layout — KALUSAGAP V20 Standard
 *
 * Displays KPI metrics in a single horizontal container with vertical dividers.
 * Implements the Global RHU KPI Design Standard with:
 *
 * Design features:
 * - Single white container with subtle border
 * - Thin colored top accent line (3px) for each KPI section
 * - Vertical dividers between sections
 * - Equal-width columns (3 or 4 KPIs)
 * - Uppercase KPI label
 * - Large, prominent numerical value
 * - Short supporting description (optional)
 * - Color standards: Blue (general), Orange (pending), Green (completed), Red (high-risk)
 * - Responsive: Desktop (horizontal), Tablet (2-column), Mobile (stacked or 2-column)
 * - No excessive shadows, gradients, or decorative elements
 * - Professional, minimalist appearance
 *
 * Props:
 * - children: KpiHorizontal.Item components
 * - count: Number of KPI sections (3 or 4, default 4)
 * - className: Optional additional CSS classes
 * - loading: Optional boolean for loading state
 * - error: Optional error message
 *
 * Usage:
 * <KpiHorizontal count={3}>
 *   <KpiHorizontal.Item label="Total" value={100} tone="blue" description="All records" />
 *   <KpiHorizontal.Item label="Completed" value={50} tone="green" description="Successfully processed" />
 *   <KpiHorizontal.Item label="Pending" value={25} tone="amber" description="Awaiting action" />
 * </KpiHorizontal>
 *
 * Tone colors (consistent across all RHU modules):
 * - "blue": General totals, active workloads, information
 * - "green": Completed, successfully processed, active status
 * - "amber": Pending actions, upcoming deadlines
 * - "red": High-risk cases, overdue tasks, urgent concerns
 * - "teal": Referrals, assigned work, special status
 */
export default function KpiHorizontal({ 
  children, 
  count = 4, 
  className = "",
  loading = false,
  error = null 
}) {
  const gridClass = `kpi-horizontal-grid ${count === 3 ? "is-three" : ""} ${loading ? "is-loading" : ""} ${className}`;
  
  if (error) {
    return (
      <div className={`kpi-horizontal-error ${className}`}>
        <div className="kpi-error-message">{error}</div>
      </div>
    );
  }
  
  return <div className={gridClass}>{children}</div>;
}

/**
 * Individual KPI section within the horizontal container — KALUSAGAP V20
 *
 * Props:
 * - label: KPI label (typically uppercase)
 * - value: Numeric or string value
 * - tone: Color scheme (blue, green, amber, red, teal, indigo, slate)
 * - description: Optional short supporting text (max 1-2 lines)
 * - onClick: Optional click handler for interactive KPIs
 * - className: Optional additional CSS classes
 * - ariaLabel: Optional aria-label for accessibility
 *
 * Color meanings (consistent across all RHU modules):
 * - blue: General totals and active workloads
 * - green: Completed or successfully processed records
 * - amber: Pending actions and upcoming deadlines
 * - red: High-risk cases, overdue tasks, urgent concerns
 * - teal: Referrals and assigned work
 * - indigo: Scheduled or upcoming
 * - slate: Information or records
 */
KpiHorizontal.Item = function KpiHorizontalItem({
  label,
  value,
  tone = "blue",
  description = null,
  onClick = null,
  className = "",
  ariaLabel = null,
}) {
  const numeric = typeof value === "number" || (typeof value === "string" && /^[\d,.]+$/.test(value));
  
  // Map tones to their display values (used as data-tone attribute)
  const toneMap = {
    blue: "blue",
    green: "green",
    amber: "yellow",
    red: "danger",
    indigo: "blue",
    slate: "accent",
    teal: "accent",
  };
  
  const displayTone = toneMap[tone] || "blue";
  
  // Map tones to top accent line colors (3px solid)
  const accentColorMap = {
    blue: "#2563EB",      // Blue for general/information
    green: "#15945A",     // Green for success/completed
    yellow: "#D97706",    // Orange/Amber for pending
    danger: "#DC3545",    // Red for high-risk/urgent
    accent: "#0D9488",    // Teal for referrals
  };

  const accentColor = accentColorMap[displayTone];
  const Element = onClick ? "button" : "div";
  
  return (
    <Element
      type={onClick ? "button" : undefined}
      onClick={onClick}
      data-tone={displayTone}
      className={`kpi-metric ${onClick ? "kpi-metric-interactive" : ""} ${className}`}
      style={{ borderTopColor: accentColor }}
      aria-label={ariaLabel || label}
      title={description || label}
    >
      <div className="kpi-metric-label">{label}</div>
      <div className="kpi-metric-value" data-numeric={numeric}>
        {value}
      </div>
      {description && (
        <div className="kpi-metric-description" title={description}>
          {description}
        </div>
      )}
    </Element>
  );
};
