import React from "react";

/**
 * Shared empty state: icon, title, description, and an optional action.
 * Used wherever a list or page has nothing to show so the pattern is
 * consistent across the app.
 *
 * @param {{icon?: any, title: string, description?: string, action?: any, compact?: boolean, className?: string}} props
 */
export default function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  compact = false,
  className = "",
}) {
  return (
    <div className={`ui-empty-state flex flex-col items-center justify-center px-6 ${compact ? "py-5" : "py-12"} text-center ${className}`}>
      {Icon && (
        <div className={`ui-state-icon flex items-center justify-center rounded-full bg-slate-100 dark:bg-card-nested ${compact ? "mb-3 h-8 w-8" : "mb-4 h-16 w-16"}`}>
          <Icon className={`${compact ? "h-4 w-4" : "h-8 w-8"} text-slate-400 dark:text-slate-500`} strokeWidth={1.8} aria-hidden="true" />
        </div>
      )}
      <h3 className="text-base font-semibold text-brand-ink">{title}</h3>
      {description && <p className="mt-1.5 max-w-md text-sm text-brand-gray">{description}</p>}
      {action && <div className={compact ? "mt-3" : "mt-5"}>{action}</div>}
    </div>
  );
}
