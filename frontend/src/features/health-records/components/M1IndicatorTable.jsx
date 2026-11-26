// frontend/src/features/health-records/components/M1IndicatorTable.jsx
import React, { useMemo, useState } from "react";
import { Eye, Search } from "lucide-react";
import DataTable from "@/components/tables/DataTable";
import EmptyState from "@/components/common/EmptyState";

/**
 * M1IndicatorTable — Institutional data table for M1 health indicators.
 *
 * Requirements:
 * - Proper structured data table format (no cards)
 * - Required table columns: Indicator Code | Indicator Description | Total Cases | Action
 * - Exact indicator codes and descriptions preserved
 * - Wrap descriptions naturally without truncating
 * - Right-align numeric totals
 * - Subtle row dividers and restrained row-hover highlighting
 * - Last column holds the View action button
 * - Visually distinct header
 * - Horizontal scrolling supported on smaller screens
 * - Section summary showing the indicator count and an optional server-derived
 *   unique-record total (never a sum of overlapping parent/child indicators)
 * - Search filter by code or description
 */
export default function M1IndicatorTable({
  rows = [],
  onView,
  emptyText = "No indicators are available for this category.",
  summary = null,
  showGrouping = false,
  groupBy = null,
}) {
  const [searchQuery, setSearchQuery] = useState("");

  const filteredRows = useMemo(() => {
    if (!rows || !rows.length) return [];
    if (!searchQuery.trim()) return rows;
    const q = searchQuery.toLowerCase().trim();
    return rows.filter((r) =>
      String(r.sourceIdentifier || r.code || "").toLowerCase().includes(q) ||
      String(r.name || "").toLowerCase().includes(q)
    );
  }, [rows, searchQuery]);

  const columns = [
    {
      key: "code",
      label: "Indicator Code",
      className: "font-mono text-xs font-semibold text-brand-blue align-middle whitespace-nowrap w-32 min-w-[7.5rem]",
      render: (row) => row.sourceIdentifier || row.code,
    },
    {
      key: "name",
      label: "Indicator Description",
      wrap: true,
      className: "align-middle text-xs sm:text-sm text-brand-ink font-normal leading-relaxed",
      render: (row) => row.name,
    },
    {
      key: "total",
      label: "Total Cases",
      align: "right",
      className: "align-middle font-mono text-xs sm:text-sm font-semibold tabular-nums text-brand-ink whitespace-nowrap w-28 min-w-[6.5rem]",
      render: (row) => Number(row.total ?? 0),
    },
    {
      key: "action",
      label: "Action",
      align: "center",
      className: "align-middle whitespace-nowrap w-24 min-w-[5.5rem]",
      render: (row) => (
        <button
          type="button"
          onClick={() => onView(row)}
          title={`View underlying records for ${row.sourceIdentifier || row.code}`}
          className="ui-tcl-control ui-tcl-control-secondary !min-h-7 !px-2.5 !py-0.5 !text-xs inline-flex items-center gap-1.5 transition-colors hover:border-brand-blue hover:text-brand-blue"
        >
          <Eye className="h-3.5 w-3.5" aria-hidden="true" />
          <span>View</span>
        </button>
      ),
    },
  ];

  if (!rows || rows.length === 0) {
    return (
      <div className="rounded-md border border-brand-border bg-white">
        <EmptyState compact title="No M1 indicators" description={emptyText} />
      </div>
    );
  }

  return (
    <div className="rounded-md border border-brand-border bg-white overflow-hidden shadow-2xs">
      {/* Table toolbar / summary bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-brand-border bg-slate-50/80 px-3.5 py-2">
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs font-semibold text-brand-ink">
            {filteredRows.length} {filteredRows.length === 1 ? "indicator" : "indicators"}
          </span>
          {Number.isFinite(summary?.total) && <>
            <span className="text-slate-300">|</span>
            <span className="text-xs text-brand-gray font-medium" title={summary.note || undefined}>
              {summary.label || "Unique contributing records"}: <strong className="font-mono text-brand-ink">{summary.total}</strong>
            </span>
          </>}
        </div>

        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" aria-hidden="true" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter by code or description..."
              aria-label="Filter indicators"
              className="h-7 w-52 sm:w-64 rounded border border-brand-border bg-white pl-8 pr-2.5 text-xs text-brand-ink placeholder:text-slate-400 focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue"
            />
          </div>
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              className="text-xs text-brand-gray hover:text-brand-ink underline"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {filteredRows.length === 0 ? (
        <EmptyState
          compact
          kind="search"
          title="No matching M1 indicators"
          description={`No indicators match “${searchQuery}”.`}
          action={<button
            type="button"
            onClick={() => setSearchQuery("")}
            className="text-xs font-medium text-brand-blue hover:underline"
          >
            Reset filter
          </button>}
        />
      ) : (
        <DataTable
          rows={filteredRows}
          columns={columns}
          dense
          compact
          fitContainer
          mobileCards={false}
          striped
          stickyHeader
          emptyText={emptyText}
          className="ui-tcl-data-table !rounded-none !border-0 !shadow-none"
          tableClassName="w-full min-w-[38rem]"
        />
      )}
    </div>
  );
}
