import React from "react";

/**
 * Standardized Status Badge for follow-ups.
 * 
 * Every status must use a badge—no plain text.
 * Consistent styling across all status levels with:
 * - Soft background colors with dark text
 * - Rounded corners (6px)
 * - Medium font weight
 * - Proper vertical alignment
 * - Dark mode support
 */

export const STATUS_TONES = {
  Scheduled: "bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-400",
  Pending: "bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400",
  Completed: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400",
  Cancelled: "bg-slate-100 text-slate-700 dark:bg-slate-500/20 dark:text-slate-400",
  Overdue: "bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-400",
  Today: "bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-400",
  Upcoming: "bg-slate-50 text-slate-700 dark:bg-slate-500/15 dark:text-slate-400",
  Ongoing: "bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-400",
  Missed: "bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-400",
  Rejected: "bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-400",
};

export const STATUS_DOTS = {
  Scheduled: "bg-blue-600",
  Pending: "bg-amber-600",
  Completed: "bg-emerald-600",
  Cancelled: "bg-slate-500",
  Overdue: "bg-rose-600",
  Today: "bg-blue-600",
  Upcoming: "bg-slate-500",
  Ongoing: "bg-blue-600",
  Missed: "bg-rose-600",
  Rejected: "bg-rose-600",
};

export default function FollowUpStatusBadge({ value, showDot = true, className = "" }) {
  const tone = STATUS_TONES[value] || STATUS_TONES.Scheduled;
  const dot = STATUS_DOTS[value] || STATUS_DOTS.Scheduled;

  return (
    <span className={`inline-flex items-center gap-1.5 rounded-[6px] px-2.5 py-1 text-xs font-medium ${tone} ${className}`}>
      {showDot && <span className={`h-2 w-2 rounded-full ${dot}`} />}
      {value}
    </span>
  );
}
