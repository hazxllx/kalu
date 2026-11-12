import React from "react";
import { SearchX, ClipboardList } from "lucide-react";

/**
 * TCL-specific empty state with consistent styling and messaging across all programs.
 * Distinguishes between truly empty database, no results matching search/filters,
 * and loading states.
 */
export default function TclEmptyState({
  icon: Icon,
  title,
  description,
  action,
  type = "empty", // "empty" | "search" | "filter"
  compact = false,
}) {
  const messages = {
    empty: {
      defaultTitle: "No records yet",
      defaultDescription: "Records for this program will appear here.",
    },
    search: {
      defaultTitle: "No results found",
      defaultDescription: "Try adjusting your search terms.",
    },
    filter: {
      defaultTitle: "No results matching filters",
      defaultDescription: "Try adjusting your filter criteria.",
    },
  };

  const { defaultTitle, defaultDescription } = messages[type] || messages.empty;

  const StateIcon = Icon || (type === "search" || type === "filter" ? SearchX : ClipboardList);
  return (
    <div className={`ui-tcl-empty-state ${compact ? "min-h-0 py-8" : ""}`}>
      <div>
        <div className="ui-tcl-empty-state-icon mx-auto mb-4">
          <StateIcon className="h-7 w-7" strokeWidth={1.8} aria-hidden="true" />
        </div>
        <h3 className="text-base font-semibold text-brand-ink">{title || defaultTitle}</h3>
        <p className="mx-auto mt-1.5 max-w-md text-sm text-brand-gray">{description || defaultDescription}</p>
        {action && <div className="mt-5">{action}</div>}
      </div>
    </div>
  );
}
