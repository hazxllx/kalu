import React from "react";

/**
 * Standardized Priority Badge for follow-ups.
 * 
 * Consistent styling across all priority levels with:
 * - Soft background colors with dark text
 * - Rounded corners (6px)
 * - Medium font weight
 * - Proper vertical alignment
 * - Dark mode support
 */

export const PRIORITY_TONES = {
  Low: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400",
  Medium: "bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400",
  High: "bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-400",
};

export const PRIORITY_DOTS = {
  Low: "bg-emerald-600",
  Medium: "bg-amber-600",
  High: "bg-rose-600",
};

export default function PriorityBadge({ value, showDot = true, className = "" }) {
  const tone = PRIORITY_TONES[value] || PRIORITY_TONES.Medium;
  const dot = PRIORITY_DOTS[value] || PRIORITY_DOTS.Medium;

  return (
    <span className={`inline-flex items-center gap-1.5 rounded-[6px] px-2.5 py-1 text-xs font-medium ${tone} ${className}`}>
      {showDot && <span className={`h-2 w-2 rounded-full ${dot}`} />}
      {value}
    </span>
  );
}
