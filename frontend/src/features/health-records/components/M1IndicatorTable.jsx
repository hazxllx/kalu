import React, { useMemo } from "react";
import { Eye } from "lucide-react";
import DataTable from "@/components/tables/DataTable";

/**
 * M1IndicatorTable — Compact, premium indicator display.
 * 
 * Features:
 * - Organized by indicator code with full descriptions
 * - Compact row height with tabular numerals for alignment
 * - Professional institutional styling
 * - Optional drill-down action
 * - Responsive mobile card layout
 */
export default function M1IndicatorTable({ 
  rows, 
  onView, 
  emptyText = "No indicators are available for this category.",
  showGrouping = false,
  groupBy = null,
}) {
  // Group indicators if requested
  const groupedRows = useMemo(() => {
    if (!showGrouping || !groupBy || !rows) return rows;
    
    const groups = new Map();
    for (const row of rows) {
      const groupKey = row[groupBy];
      if (!groups.has(groupKey)) {
        groups.set(groupKey, []);
      }
      groups.get(groupKey).push(row);
    }
    return groups;
  }, [rows, showGrouping, groupBy]);

  const columns = [
    {
      key: "code",
      label: "Code",
      width: "auto",
      className: "font-mono text-xs font-semibold text-brand-blue align-top whitespace-nowrap",
      render: (row) => row.sourceIdentifier || row.code,
    },
    {
      key: "name",
      label: "Indicator Name",
      wrap: true,
      className: "align-top text-sm text-brand-ink",
    },
    {
      key: "total",
      label: "Value",
      align: "right",
      className: "align-top font-semibold tabular-nums text-brand-ink whitespace-nowrap",
    },
  ];

  if (onView) {
    columns.push({
      key: "action",
      label: "",
      align: "center",
      width: "auto",
      hideOnMobile: false,
      render: (row) => (
        <button 
          type="button" 
          onClick={() => onView(row)} 
          title="View underlying records"
          className="ui-tcl-control ui-tcl-control-secondary !min-h-8 !px-2 !py-1 !text-xs hover:bg-brand-light transition-colors"
        >
          <Eye className="h-3.5 w-3.5" aria-hidden="true" />
          <span className="hidden sm:inline">View</span>
        </button>
      ),
    });
  }

  if (!rows || rows.length === 0) {
    return (
      <div className="rounded-lg border border-brand-border bg-white p-6 text-center">
        <p className="text-sm text-brand-gray">{emptyText}</p>
      </div>
    );
  }

  return (
    <DataTable
      rows={rows}
      columns={columns}
      dense
      compact
      fitContainer
      mobileCards
      striped
      stickyHeader
      emptyText={emptyText}
      className="ui-tcl-data-table !rounded-lg !shadow-none border border-brand-border"
      tableClassName="w-full min-w-[42rem]"
    />
  );
}
