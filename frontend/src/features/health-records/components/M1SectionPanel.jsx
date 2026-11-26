// frontend/src/features/health-records/components/M1SectionPanel.jsx
import React from "react";
import { ChevronRight } from "lucide-react";
import { Link } from "react-router-dom";
import M1IndicatorTable from "./M1IndicatorTable";

/**
 * M1SectionPanel — Compact section display with organized layout.
 * 
 * Replaces the need to scroll through multiple tabs by organizing
 * indicators into a focused, single-view panel per section.
 * 
 * Features:
 * - Section title with indicator count
 * - Link to detailed section page
 * - Compact indicator table
 * - Minimal vertical padding and margins
 */
export default function M1SectionPanel({
  section,
  sectionLabel,
  indicators = [],
  onViewIndicator,
  sectionQuery = "",
}) {
  const indicatorCount = indicators.length;

  return (
    <section className="space-y-3 rounded-lg bg-white p-4 border border-brand-border/50">
      {/* Header with title and indicator count */}
      <div className="flex items-baseline justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-semibold text-brand-ink">
            {sectionLabel}
          </h3>
          <p className="mt-0.5 text-xs text-brand-gray">
            {indicatorCount} indicator{indicatorCount !== 1 ? "s" : ""}
          </p>
        </div>
        <Link
          to={`/app/health_supervisor/m1-section/${section}?${sectionQuery}`}
          className="ui-tcl-control ui-tcl-control-secondary !min-h-8 !px-2.5 !text-xs whitespace-nowrap flex items-center gap-1"
          title={`View detailed ${sectionLabel}`}
        >
          Details
          <ChevronRight className="h-3.5 w-3.5" />
        </Link>
      </div>

      {/* Indicator table */}
      <M1IndicatorTable
        rows={indicators}
        onView={onViewIndicator}
        emptyText={`No indicators available for ${sectionLabel}`}
      />
    </section>
  );
}
