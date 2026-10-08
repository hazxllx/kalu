import React, { useEffect, useRef, useState } from "react";
import { Search, Filter, CheckSquare, Download } from "lucide-react";
import { TYPE, PALETTE, RADIUS, DENSITY } from "@/lib/designTokens";

/**
 * Canonical data table for directory/record screens.
 *
 * Behaviors:
 *   - sticky header on long lists
 *   - toolbar with search + filter dropdowns
 *   - row hover states with accessible hover actions (touch-friendly)
 *   - resident/name is the strongest element; barangay/program are secondary
 *   - tabular numerals right-aligned for counts and dates
 *   - sticky column group for primary actions
 *
 * Props:
 *   columns       [{ key, label, align?, width?, renderHeader?, sortable? }]
 *   rows          array of row objects
 *   renderCell    (key, row) -> ReactNode
 *   renderRow     (row, i) -> ReactNode (optional, for custom row content)
 *   onRowClick    (row) -> void
 *   hoverActions  (row) -> ReactNode (renders in sticky right column)
 *   rowKey        key of the row id field (default "id")
 *   emptyMessage  string for empty state
 *   loading       bool
 *   className
 */
export default function DataTable({
  columns = [],
  rows = [],
  renderCell,
  renderRow,
  rowKey = "id",
  rowActions = null,
  onRowClick,
  emptyMessage = "No records found.",
  loading = false,
  stickyFirst = true,
  stickyLast = false,
  className = "",
  ...toolbarProps
}) {
  const {
    searchPlaceholder = "Search...",
    filterOptions = null,
    onSearch = null,
    onFilter = null,
    filterValue = "",
    searchValue = "",
    onDownload = null,
    primaryAction = null,
  } = toolbarProps;

  const searchRef = useRef(null);
  const [search, setSearch] = useState(searchValue);
  const [filter, setFilter] = useState(filterValue);

  useEffect(() => { setSearch(searchValue || ""); }, [searchValue]);
  useEffect(() => { setFilter(filterValue || ""); }, [filterValue]);

  const filteredRows = rows.filter((row) => {
    if (search.trim()) {
      const q = search.toLowerCase();
      const hay = Object.values(row)
        .map((v) => String(v ?? "").toLowerCase())
        .join(" ");
      if (!hay.includes(q)) return false;
    }
    if (filter && filterOptions) {
      const f = filterOptions.find((o) => o.value === filter);
      if (!f) return true;
      const key = f.filterKey || f.value;
      if (String(row[key] ?? "").toLowerCase() !== f.value.toLowerCase()) return false;
    }
    return true;
  });

  if (loading) {
    return (
      <div className={`overflow-hidden rounded-[8px] border border-[#D6DEE8] dark:border-[#2A3645] ${className}`}>
        <div className="flex items-center gap-3 border-b border-[#E7ECF1] bg-[#F4F6FA] px-4 py-3 dark:border-[#2A3645] dark:bg-[#0D1826]">
          <div className="h-4 w-[140px] animate-pulse rounded bg-[#D6DEE8] dark:bg-[#2A3645]" />
          <div className="h-4 w-[120px] animate-pulse rounded bg-[#D6DEE8] dark:bg-[#2A3645]" />
          <div className="ml-auto h-8 w-[110px] animate-pulse rounded bg-[#D6DEE8] dark:bg-[#2A3645]" />
        </div>
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 border-b border-[#E7ECF1] px-4 py-3 dark:border-[#2A3645]">
            <div className="h-4 w-4 animate-pulse rounded-full bg-[#D6DEE8] dark:bg-[#2A3645]" />
            <div className="flex-1 space-y-2">
              <div className="h-3 w-1/3 animate-pulse rounded bg-[#D6DEE8] dark:bg-[#2A3645]" />
              <div className="h-3 w-1/4 animate-pulse rounded bg-[#D6DEE8] dark:bg-[#2A3645]" />
            </div>
            <div className="h-3 w-1/6 animate-pulse rounded bg-[#D6DEE8] dark:bg-[#2A3645]" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className={`overflow-hidden rounded-[8px] border border-[#D6DEE8] bg-white dark:border-[#2A3645] dark:bg-[#131E2C] ${className}`}>
      <div className="flex flex-col gap-3 border-b border-[#E7ECF1] bg-[#F4F6FA] px-4 py-3 dark:border-[#2A3645] dark:bg-[#0D1826] sm:flex-row sm:items-center sm:justify-between">
        {primaryAction && <div>{primaryAction}</div>}
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#8A95A4]" aria-hidden="true" />
            <input
              ref={searchRef}
              type="text"
              value={search}
              onChange={(e) => { setSearch(e.target.value); if (onSearch) onSearch(e.target.value); }}
              placeholder={searchPlaceholder}
              className="h-9 w-full rounded-[4px] border border-[#D6DEE8] bg-white py-1.5 pl-8 pr-3 text-[13px] outline-none transition-colors placeholder:text-[#8A95A4] focus:border-[#0B4A8F] dark:border-[#2A3645] dark:bg-[#131E2C] dark:text-[#E8EDF3] dark:placeholder:text-[#6E7986] dark:focus:border-[#1464A3]"
            />
          </div>
          {filterOptions && filterOptions.length > 0 && (
            <div className="relative">
              <Filter className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#8A95A4]" aria-hidden="true" />
              <select
                value={filter}
                onChange={(e) => { setFilter(e.target.value); if (onFilter) onFilter(e.target.value); }}
                className="h-9 appearance-none rounded-[4px] border border-[#D6DEE8] bg-white py-1.5 pl-8 pr-7 text-[13px] outline-none transition-colors focus:border-[#0B4A8F] dark:border-[#2A3645] dark:bg-[#131E2C] dark:text-[#E8EDF3] dark:focus:border-[#1464A3]"
              >
                <option value="">All</option>
                {filterOptions.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
          )}
        </div>
        {onDownload && (
          <button
            type="button"
            onClick={onDownload}
            className="inline-flex items-center gap-2 rounded-[4px] border border-[#D6DEE8] bg-white px-3 py-1.5 text-[13px] font-medium text-[#54637A] transition-colors hover:border-[#0B4A8F] hover:text-[#0B4A8F] dark:border-[#2A3645] dark:bg-[#131E2C] dark:text-[#9AA7B5] dark:hover:border-[#1464A3] dark:hover:text-[#1464A3]"
          >
            <Download className="h-3.5 w-3.5" /> Export
          </button>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full text-[13px]">
          <thead className="sticky top-0 bg-[#F4F6FA] text-[11px] font-semibold uppercase tracking-[0.08em] text-[#54637A] dark:bg-[#0D1826] dark:text-[#9AA7B5]">
            <tr>
              {columns.map((col, i) => (
                <th
                  key={col.key}
                  className={`px-4 py-2.5 text-left align-bottom ${col.align === "right" ? "text-right" : col.align === "center" ? "text-center" : "text-left"} ${stickyFirst && i === 0 ? "sticky left-0 z-[1] bg-[#F4F6FA] dark:bg-[#0D1826]" : ""} ${stickyLast && i === columns.length - 1 ? "sticky right-0 z-[1] bg-[#F4F6FA] dark:bg-[#0D1826]" : ""}`}
                  style={{ width: col.width || "auto" }}
                >
                  {col.renderHeader ? col.renderHeader(col) : col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredRows.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length + (rowActions ? 1 : 0)}
                  className="px-4 py-10 text-center text-[13px] text-[#54637A] dark:text-[#9AA7B5]"
                >
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              filteredRows.map((row, i) => (
                <tr
                  key={row[rowKey] ?? i}
                  onClick={() => onRowClick && onRowClick(row)}
                  className={`group border-b border-[#E7ECF1] transition-colors ${
                    onRowClick
                      ? "cursor-pointer hover:bg-[#F4F6FA] dark:hover:bg-[#0E1A29]"
                      : ""
                  } ${i % 2 === 0 ? "" : "bg-[#FBFCFE] dark:bg-[#0E1A29]"}`}
                >
                  {columns.map((col, j) => (
                    <td
                      key={col.key}
                      className={`px-4 py-2.5 align-top ${col.align === "right" ? "text-right" : col.align === "center" ? "text-center" : "text-left"} ${stickyFirst && j === 0 ? "sticky left-0 z-[1] bg-[#F4F6FA] group-hover:bg-[#F4F6FA] dark:bg-[#0D1826] dark:group-hover:bg-[#0D1826]" : ""}`}
                    >
                      {renderCell ? renderCell(col.key, row) : row[col.key] ?? "—"}
                    </td>
                  ))}
                  {rowActions && (
                    <td className="px-4 py-2.5 align-top">
                      <div className="flex items-center justify-end gap-2 opacity-100 md:opacity-0 md:group-hover:opacity-100">
                        {rowActions(row)}
                      </div>
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * Compact variant of a table row for dense work-queue lists.
 * Passed as renderRow for SummaryStrip-style previews.
 */
export function TableRowPreview({ row, columns, renderCell, onClick, children }) {
  return (
    <div
      onClick={onClick}
      className={`flex flex-col gap-2 rounded-[4px] border border-[#D6DEE8] bg-white p-3.5 transition-colors sm:flex-row sm:items-center ${onClick ? "cursor-pointer hover:border-[#0B4A8F] hover:bg-[#F4F6FA]" : ""} dark:border-[#2A3645] dark:bg-[#131E2C] dark:hover:border-[#1464A3] dark:hover:bg-[#0E1A29]`}
    >
      {children}
    </div>
  );
}
