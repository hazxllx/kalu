import React from "react";

/** Compact page controls for long directory and workflow lists. */
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
    <div className={`flex flex-wrap items-center justify-between gap-2 rounded-xl border border-brand-border bg-white px-3 py-2 text-xs text-brand-gray ${className}`} aria-label="List pagination">
      <span aria-live="polite">Showing {first}–{last} of {total}</span>
      <div className="flex items-center gap-2">
        <label className="flex items-center gap-1.5">
          <span>Rows</span>
          <select
            value={pageSize}
            onChange={(event) => onPageSizeChange(Number(event.target.value))}
            className="rounded-lg border border-brand-border bg-white px-2 py-1 text-xs text-brand-ink"
            aria-label="Rows per page"
          >
            {[8, 12, 20].map((size) => <option key={size} value={size}>{size}</option>)}
          </select>
        </label>
        <span className="whitespace-nowrap">Page {Math.min(page, count)} of {count}</span>
        <button type="button" onClick={() => onPageChange(Math.max(1, page - 1))} disabled={page <= 1} className="rounded-lg border border-brand-border px-2.5 py-1 text-brand-ink hover:bg-brand-bg disabled:cursor-not-allowed disabled:opacity-40">Previous</button>
        <button type="button" onClick={() => onPageChange(Math.min(count, page + 1))} disabled={page >= count} className="rounded-lg border border-brand-border px-2.5 py-1 text-brand-ink hover:bg-brand-bg disabled:cursor-not-allowed disabled:opacity-40">Next</button>
      </div>
    </div>
  );
}
