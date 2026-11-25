import React from "react";
import { FileSearch, Inbox, SearchX, SlidersHorizontal } from "lucide-react";

/**
 * Shared empty state: icon, title, description, and an optional action.
 * Used wherever a list or page has nothing to show so the pattern is
 * consistent across the app.
 *
 * `kind` keeps the four common states visually and verbally distinct without
 * requiring every feature to recreate the surrounding layout.
 *
 * @param {{icon?: any, title?: string, description?: string, action?: any, compact?: boolean, className?: string, kind?: "empty"|"search"|"filter"|"unavailable"}} props
 */
export default function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  compact = false,
  className = "",
  kind = "empty",
}) {
  const defaults = {
    empty: {
      icon: Inbox,
      title: "No records yet",
      description: "Records will appear here once they are available.",
    },
    search: {
      icon: SearchX,
      title: "No matching records",
      description: "Try a different search term or clear your search.",
    },
    filter: {
      icon: SlidersHorizontal,
      title: "No records match these filters",
      description: "Adjust or clear your filters to see available records.",
    },
    unavailable: {
      icon: FileSearch,
      title: "No data available",
      description: "There is no applicable information for the selected period.",
    },
  };
  const fallback = defaults[kind] || defaults.empty;
  const StateIcon = Icon || fallback.icon;

  return (
    <div className={`ui-empty-state flex flex-col items-center justify-center px-6 ${compact ? "py-5" : "py-12"} text-center ${className}`}>
      {StateIcon && (
        <div className={`ui-state-icon flex items-center justify-center rounded-full bg-slate-100 dark:bg-card-nested ${compact ? "mb-3 h-8 w-8" : "mb-4 h-16 w-16"}`}>
          <StateIcon className={`${compact ? "h-4 w-4" : "h-8 w-8"} text-brand-blue/70 dark:text-blue-300`} strokeWidth={1.8} aria-hidden="true" />
        </div>
      )}
      <h3 className="text-base font-semibold text-brand-ink">{title || fallback.title}</h3>
      {(description || fallback.description) && <p className="mt-1.5 max-w-md text-sm text-brand-gray">{description || fallback.description}</p>}
      {action && <div className={compact ? "mt-3" : "mt-5"}>{action}</div>}
    </div>
  );
}
