import React from "react";
import { Search } from "lucide-react";

/**
 * Shared toolbar for the verification queues.
 *
 * Layout intent:
 *   Desktop — the search field takes most of the width, while the status filter
 *     and result count sit grouped on the right, vertically aligned.
 *   Mobile  — everything stacks full-width so nothing overflows the viewport.
 */
export default function VerificationQueueToolbar({
  filters,
  status,
  onStatusChange,
  searchValue,
  onSearchChange,
  searchPlaceholder,
  children = null,
  resultText,
}) {
  return (
    <div className="flex flex-col gap-2.5 border-b border-brand-border bg-brand-bg/30 px-4 py-3 dark:border-border dark:bg-card-nested/40 sm:flex-row sm:items-center sm:gap-3 sm:px-5">
      <label className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-input border border-brand-border bg-white px-3 transition-colors focus-within:border-brand-blue focus-within:ring-2 focus-within:ring-brand-blue/20 dark:border-border dark:bg-input">
        <Search className="h-4 w-4 shrink-0 text-brand-gray" aria-hidden="true" />
        <input
          type="search"
          value={searchValue}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder={searchPlaceholder}
          aria-label={searchPlaceholder}
          className="min-w-0 flex-1 bg-transparent text-sm text-brand-ink outline-none placeholder:text-brand-gray/70 dark:text-foreground"
        />
      </label>

      <div className="flex w-full flex-col gap-2.5 sm:w-auto sm:flex-row sm:items-center sm:gap-2.5">
        <select
          value={status}
          onChange={(event) => onStatusChange(event.target.value)}
          aria-label="Filter by status"
          className="h-10 w-full rounded-input border border-brand-border bg-white px-3 text-sm text-brand-ink outline-none transition-colors focus:border-brand-blue focus-visible:ring-2 focus-visible:ring-brand-blue dark:border-border dark:bg-input dark:text-foreground sm:w-auto sm:min-w-[150px]"
        >
          {filters.map((filter) => (
            <option key={filter.value} value={filter.value}>{filter.label}</option>
          ))}
        </select>
        {children}
      </div>

      {resultText && (
        <span className="whitespace-nowrap text-xs font-medium tabular-nums text-brand-gray sm:shrink-0">
          {resultText}
        </span>
      )}
    </div>
  );
}