import React from "react";

export default function VerificationPagination({
  page,
  pageCount,
  total,
  onPageChange,
}) {
  if (pageCount <= 1) return null;

  const start = (page - 1) * 10 + 1;
  const end = Math.min(page * 10, total);

  return (
    <nav
      aria-label="Request table pagination"
      className="flex flex-col gap-3 border-t border-brand-border px-4 py-3 text-xs text-brand-gray dark:border-border sm:flex-row sm:items-center sm:justify-between sm:px-5"
    >
      <span>Showing {start}–{end} of {total} requests</span>
      <div className="flex items-center gap-1">
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          className="rounded-btn border border-brand-border px-3 py-1.5 font-medium text-brand-blue hover:bg-brand-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue disabled:cursor-not-allowed disabled:opacity-50 dark:border-border dark:hover:bg-card-nested"
        >
          Previous
        </button>
        <span aria-current="page" className="min-w-9 rounded-btn bg-brand-blue px-3 py-1.5 text-center font-semibold text-white">
          {page}
        </span>
        <button
          type="button"
          disabled={page >= pageCount}
          onClick={() => onPageChange(page + 1)}
          className="rounded-btn border border-brand-border px-3 py-1.5 font-medium text-brand-blue hover:bg-brand-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue disabled:cursor-not-allowed disabled:opacity-50 dark:border-border dark:hover:bg-card-nested"
        >
          Next
        </button>
      </div>
    </nav>
  );
}
