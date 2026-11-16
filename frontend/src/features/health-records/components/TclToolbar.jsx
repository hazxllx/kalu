import React, { useEffect, useId, useRef, useState } from "react";
import { Check, ChevronDown, Download, Filter, Plus, Search } from "lucide-react";

/**
 * Unified TCL toolbar component used across all TCL pages.
 * Standardizes: search field, status/category filters, export action, new record button.
 */
export function TclToolbar({
  onSearch = undefined,
  searchValue = "",
  onFilter = undefined,
  filterValue = "",
  filterOptions = [],
  filterVariant = "buttons",
  filterLabel = "Filter",
  onExport = undefined,
  onNew = undefined,
  newLabel = "New Record",
  loading = false,
}) {
  const [filterMenuOpen, setFilterMenuOpen] = useState(false);
  const filterRootRef = useRef(null);
  const filterTriggerRef = useRef(null);
  const filterOptionRefs = useRef([]);
  const filterMenuId = useId();
  const selectedFilterIndex = Math.max(0, filterOptions.findIndex((option) => option.value === filterValue));
  const selectedFilter = filterOptions[selectedFilterIndex] || { label: "All Status" };
  const usesDropdown = filterVariant === "dropdown" && filterOptions.length > 0 && Boolean(onFilter);

  useEffect(() => {
    if (!filterMenuOpen) return undefined;
    const handlePointerDown = (event) => {
      if (!filterRootRef.current?.contains(event.target)) setFilterMenuOpen(false);
    };
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        setFilterMenuOpen(false);
        filterTriggerRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [filterMenuOpen]);

  useEffect(() => {
    if (filterMenuOpen) filterOptionRefs.current[selectedFilterIndex]?.focus();
  }, [filterMenuOpen, selectedFilterIndex]);

  const focusFilterOption = (index) => {
    filterOptionRefs.current[index]?.focus();
  };

  const handleFilterMenuKeyDown = (event) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const currentIndex = filterOptionRefs.current.findIndex((option) => option === document.activeElement);
      const startIndex = currentIndex < 0 ? selectedFilterIndex : currentIndex;
      const direction = event.key === "ArrowDown" ? 1 : -1;
      focusFilterOption((startIndex + direction + filterOptions.length) % filterOptions.length);
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      focusFilterOption(event.key === "Home" ? 0 : filterOptions.length - 1);
    } else if (event.key === "Tab") {
      setFilterMenuOpen(false);
    }
  };

  const statusIndicatorClass = (value) => {
    if (value === "Active") return "bg-emerald-500";
    if (value === "Delivered") return "bg-blue-500";
    if (value === "Transferred") return "bg-violet-500";
    if (value === "Inactive") return "bg-gray-400";
    return "bg-brand-blue";
  };

  return (
    <div className={`ui-tcl-toolbar${usesDropdown ? " ui-tcl-toolbar--filter-dropdown" : ""}`}>
      <div className="ui-tcl-toolbar-search">
        {/* Search field */}
        <Search className="h-4 w-4 shrink-0 text-brand-gray" aria-hidden="true" />
        <input
          type="search"
          value={searchValue}
          onChange={(e) => onSearch?.(e.target.value)}
          placeholder="Search Records"
          aria-label="Search records"
          className="w-full bg-transparent text-sm text-brand-ink outline-none placeholder:text-brand-gray"
        />
      </div>

      {usesDropdown && (
        <div className="ui-tcl-filter-dropdown" ref={filterRootRef}>
          <button
            ref={filterTriggerRef}
            type="button"
            className="ui-tcl-filter-trigger"
            onClick={() => setFilterMenuOpen((open) => !open)}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                setFilterMenuOpen(true);
              }
            }}
            aria-label={`${filterLabel}: ${selectedFilter.label}`}
            aria-haspopup="menu"
            aria-expanded={filterMenuOpen}
            aria-controls={filterMenuId}
          >
            <Filter className="h-4 w-4 shrink-0 text-brand-gray" aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate text-left">{filterLabel}: {selectedFilter.label}</span>
            <ChevronDown className={`h-4 w-4 shrink-0 text-brand-gray${filterMenuOpen ? " rotate-180" : ""}`} aria-hidden="true" />
          </button>
          {filterMenuOpen && (
            <div
              id={filterMenuId}
              role="menu"
              aria-label={`${filterLabel} options`}
              className="ui-tcl-filter-menu"
              onKeyDown={handleFilterMenuKeyDown}
            >
              {filterOptions.map((option, index) => {
                const isSelected = option.value === filterValue;
                return (
                  <button
                    key={option.value}
                    ref={(element) => { filterOptionRefs.current[index] = element; }}
                    type="button"
                    role="menuitemradio"
                    aria-checked={isSelected}
                    tabIndex={isSelected ? 0 : -1}
                    className={`ui-tcl-filter-option${isSelected ? " is-selected" : ""}`}
                    onClick={() => {
                      onFilter(option.value);
                      setFilterMenuOpen(false);
                      filterTriggerRef.current?.focus();
                    }}
                  >
                    <span className={`ui-tcl-filter-indicator ${statusIndicatorClass(option.value)}`} aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate">{option.label}</span>
                    {isSelected && <Check className="h-4 w-4 shrink-0 text-brand-blue" aria-hidden="true" />}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Actions */}
      {(onExport || onNew) && (
        <div className="ui-tcl-toolbar-actions">
          {onExport && (
            <button
              type="button"
              onClick={onExport}
              disabled={loading}
              className="ui-tcl-control ui-tcl-control-secondary"
              title="Export records"
            >
              <Download className="h-4 w-4" aria-hidden="true" />
              <span>Export</span>
            </button>
          )}
          {onNew && (
            <button
              type="button"
              onClick={onNew}
              disabled={loading}
              className="ui-tcl-control ui-tcl-control-primary"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              <span>{newLabel}</span>
            </button>
          )}
        </div>
      )}

      {/* Status/filter selector if provided */}
      {!usesDropdown && filterOptions.length > 0 && onFilter && (
        <div className="flex w-full flex-wrap gap-2">
          {filterOptions.map((option) => (
            <button
              type="button"
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
