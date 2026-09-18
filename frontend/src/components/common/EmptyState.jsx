import React from "react";

/**
 * Shared empty state: icon, title, description, and an optional action.
 * Used wherever a list or page has nothing to show so the pattern is
 * consistent across the app.
 */
export default function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className = "",
}) {
  return (
    <div className={`flex flex-col items-center justify-center px-6 py-12 text-center ${className}`}>
      {Icon && (
        <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-slate-100 dark:bg-card-nested">
          <Icon className="h-8 w-8 text-slate-400 dark:text-slate-500" strokeWidth={1.8} aria-hidden="true" />
        </div>
      )}
      <h3 className="text-base font-semibold text-brand-ink">{title}</h3>
      {description && <p className="mt-1.5 max-w-md text-sm text-brand-gray">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
