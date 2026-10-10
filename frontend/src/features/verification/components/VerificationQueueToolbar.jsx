import React from "react";
import { Search } from "lucide-react";

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
    <div className="flex flex-col gap-2 border-b border-brand-border px-4 py-3 dark:border-border sm:flex-row sm:items-center sm:px-5">
      <label className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-input border border-brand-border bg-white px-3 dark:border-border dark:bg-input sm:min-w-[220px]">
        <Search className="h-4 w-4 shrink-0 text-brand-gray" aria-hidden="true" />
        <input
          type="search"
          value={searchValue}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder={searchPlaceholder}
          aria-label={searchPlaceholder}
          className="min-w-0 flex-1 bg-transparent text-[13px] text-brand-ink outline-none placeholder:text-brand-gray/70 dark:text-foreground"
        />
      </label>
      <select
        value={status}
        onChange={(event) => onStatusChange(event.target.value)}
        aria-label="Filter by status"
        className="h-10 w-full rounded-input border border-brand-border bg-white px-3 text-[13px] text-brand-ink outline-none focus:border-brand-blue focus-visible:ring-2 focus-visible:ring-brand-blue dark:border-border dark:bg-input dark:text-foreground sm:w-auto sm:min-w-[142px]"
      >
        {filters.map((filter) => (
          <option key={filter.value} value={filter.value}>{filter.label}</option>
        ))}
      </select>
      {children}
      {resultText && (
        <span className="whitespace-nowrap text-xs tabular-nums text-brand-gray sm:ml-auto">{resultText}</span>
      )}
    </div>
  );
}
