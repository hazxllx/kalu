import React from "react";
import { Plus, Search, Download, RefreshCw } from "lucide-react";

/**
 * Unified TCL toolbar component used across all TCL pages.
 * Standardizes: search field, status/category filters, export action, new record button.
 */
export function TclToolbar({
  onSearch,
  searchValue = "",
  onFilter,
  filterValue = "",
  filterOptions = [],
  onRefresh,
  onExport,
  onNew,
  newLabel = "New Record",
  showExport = true,
  showRefresh = true,
  loading = false,
}) {
  return (
    <div className="ui-tcl-toolbar">
      <div className="ui-tcl-toolbar-search">
        {/* Search field */}
        <Search className="h-4 w-4 shrink-0 text-brand-gray" aria-hidden="true" />
        <input
            type="search"
            value={searchValue}
            onChange={(e) => onSearch && onSearch(e.target.value)}
            placeholder="Search records…"
            aria-label="Search records"
            className="w-full bg-transparent text-sm text-brand-ink outline-none placeholder:text-brand-gray"
        />
      </div>

        {/* Actions */}
        <div className="ui-tcl-toolbar-actions">
          {showRefresh && (
            <button
              onClick={onRefresh}
              disabled={loading}
              className="ui-tcl-control ui-tcl-control-secondary"
              title="Refresh"
            >
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
          {showExport && onExport && (
            <button
              onClick={onExport}
              disabled={loading}
              className="ui-tcl-control ui-tcl-control-secondary"
              title="Export"
            >
              <Download className="h-4 w-4" aria-hidden="true" />
              <span>Export</span>
            </button>
          )}
          {onNew && (
            <button
              onClick={onNew}
              disabled={loading}
              className="ui-tcl-control ui-tcl-control-primary"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              {newLabel}
            </button>
          )}
        </div>

      {/* Status/filter selector if provided */}
      {filterOptions.length > 0 && onFilter && (
        <div className="flex w-full flex-wrap gap-2">
          {filterOptions.map((option) => (
            <button
              key={option.value}
              onClick={() => onFilter(option.value)}
              className={`rounded-btn border px-3.5 py-2 text-sm font-semibold transition-colors ${
                filterValue === option.value
                  ? "bg-brand-blue text-white border-brand-blue"
                  : "bg-white text-brand-gray border-brand-border hover:border-brand-blue hover:text-brand-blue"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Unified button styles for TCL actions.
 */
export const TclButtonClasses = {
  primary: "ui-tcl-control ui-tcl-control-primary",
  secondary: "ui-tcl-control ui-tcl-control-secondary",
  ghost: "inline-flex items-center gap-2 rounded-btn px-3 py-2.5 text-sm font-medium text-brand-gray hover:text-brand-blue transition-colors disabled:opacity-50",
  danger: "inline-flex items-center gap-2 rounded-btn bg-brand-danger px-4 py-2.5 text-sm font-medium text-white hover:bg-red-700 transition-colors disabled:opacity-50",
  icon: "inline-flex items-center justify-center h-9 w-9 rounded-btn border border-brand-border bg-white hover:border-brand-blue hover:bg-brand-light transition-colors",
};

/**
 * Consistent status filter options for TCL programs.
 */
export const TCL_STATUS_FILTERS = [
  { value: "", label: "All Status" },
  { value: "Active", label: "Active" },
  { value: "Monitoring", label: "Monitoring" },
  { value: "Inactive", label: "Inactive" },
];

/**
 * Consistent program category filters.
 */
export const TCL_PROGRAM_FILTERS = [
  { value: "", label: "All Programs" },
  { value: "Maternal", label: "Maternal" },
  { value: "NCD", label: "NCD" },
  { value: "Oral", label: "Oral Health" },
  { value: "Environmental", label: "Environmental" },
];
