import React from "react";

/**
 * Standardized KPI Grid Wrapper
 *
 * Provides consistent responsive grid layout for KPI cards across all PHN modules.
 *
 * Responsive breakpoints:
 * - Mobile (default): 1 column
 * - Mobile: 1 column (2 from 640px when space allows)
 * - Tablet: 2 columns
 * - Laptop: 3 columns
 * - Desktop: 4 columns
 *
 * When only 3 KPIs exist, uses 3-column layout on desktop for balance.
 * Maintains consistent gap spacing and alignment.
 *
 * Usage:
 * <KpiGrid count={4}>
 *   <StatCard icon="Users" label="Total" value={100} tone="blue" />
 *   <StatCard icon="CheckCircle" label="Completed" value={80} tone="green" />
 *   <StatCard icon="Clock" label="Pending" value={15} tone="amber" />
 *   <StatCard icon="AlertTriangle" label="Overdue" value={5} tone="red" />
 * </KpiGrid>
 */
export default function KpiGrid({
  children,
  count = 4,
  className = "",
  gap = "gap-4 sm:gap-5",
}) {
  // Determine grid columns based on card count
  // 3 cards: 3-column layout on desktop (balanced)
  // 4+ cards: 4-column layout on desktop (standard)
  const isThreeCard = count === 3;
  const gridClass = `grid w-full ${gap} ${
    isThreeCard
      ? "grid-cols-1 sm:grid-cols-2 laptop:grid-cols-3"
      : "grid-cols-1 sm:grid-cols-2 laptop:grid-cols-3 desktop:grid-cols-4"
  }`;

  return <div className={`${gridClass} ${className}`}>{children}</div>;
}
