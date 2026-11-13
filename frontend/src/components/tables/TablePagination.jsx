import React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

/**
 * TablePagination - Responsive pagination controls for tables and lists
 * 
 * Features:
 * - Mobile-friendly layout that stacks on small screens
 * - Touch-friendly button sizes (44px minimum)
 * - Accessible labels and ARIA attributes
 * - Dark mode support
 * - Compact display of page information
 * 
 * Props:
 * - total: Total number of items
 * - page: Current page number (1-indexed)
 * - pageSize: Number of items per page
 * - onPageChange: Function to handle page changes
 * - onPageSizeChange: Function to handle page size changes
 * - className: Additional classes
 */
export default function TablePagination({
  total,
  page,
  pageSize,
  onPageChange,
  onPageSizeChange,
  className = "",
}) {
  const count = Math.max(1, Math.ceil(total / pageSize));
  const first = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = Math.min(total, page * pageSize);
  
  return (
    <div 
      className={`flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 rounded-lg border border-brand-border dark:border-border bg-white dark:bg-card px-3 py-3 sm:py-2 text-xs text-brand-gray dark:text-muted-foreground ${className}`}
      aria-label="List pagination"
    >
      {/* Results summary */}
      <span aria-live="polite" className="text-center sm:text-left">
        Showing <span className="font-semibold text-brand-ink dark:text-foreground">{first}–{last}</span> of{" "}
        <span className="font-semibold text-brand-ink dark:text-foreground">{total}</span>
      </span>
      
      {/* Pagination controls */}
      <div className="flex flex-wrap items-center justify-center sm:justify-end gap-2 sm:gap-3">
        {/* Page size selector */}
        <label className="flex items-center gap-1.5">
          <span className="hidden sm:inline">Rows</span>
          <span className="sm:hidden">Show</span>
          <select
            value={pageSize}
            onChange={(event) => onPageSizeChange(Number(event.target.value))}
            className="rounded-lg border border-brand-border dark:border-border bg-white dark:bg-input px-2 py-1.5 text-xs text-brand-ink dark:text-foreground min-h-[36px] sm:min-h-0"
            aria-label="Rows per page"
          >
            {[8, 12, 20, 50].map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>
        
        {/* Page indicator */}
        <span className="whitespace-nowrap hidden sm:inline">
          Page <span className="font-semibold text-brand-ink dark:text-foreground">{Math.min(page, count)}</span> of{" "}
          <span className="font-semibold text-brand-ink dark:text-foreground">{count}</span>
        </span>
        
        {/* Mobile page indicator */}
        <span className="whitespace-nowrap sm:hidden text-xs">
          {Math.min(page, count)} / {count}
        </span>
        
        {/* Navigation buttons */}
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onPageChange(Math.max(1, page - 1))}
            disabled={page <= 1}
            className="flex items-center justify-center gap-1.5 rounded-lg border border-brand-border dark:border-border px-2.5 sm:px-3 py-2 min-h-[44px] sm:min-h-[36px] text-brand-ink dark:text-foreground bg-white dark:bg-input hover:bg-brand-bg dark:hover:bg-hover disabled:cursor-not-allowed disabled:opacity-40 transition-colors"
            aria-label="Go to previous page"
          >
            <ChevronLeft className="h-4 w-4" />
            <span className="hidden sm:inline">Previous</span>
          </button>
          
          <button
            type="button"
            onClick={() => onPageChange(Math.min(count, page + 1))}
            disabled={page >= count}
            className="flex items-center justify-center gap-1.5 rounded-lg border border-brand-border dark:border-border px-2.5 sm:px-3 py-2 min-h-[44px] sm:min-h-[36px] text-brand-ink dark:text-foreground bg-white dark:bg-input hover:bg-brand-bg dark:hover:bg-hover disabled:cursor-not-allowed disabled:opacity-40 transition-colors"
            aria-label="Go to next page"
          >
            <span className="hidden sm:inline">Next</span>
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
