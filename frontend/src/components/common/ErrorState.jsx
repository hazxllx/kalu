import React from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

/**
 * Shared error state: icon, title, message, and a retry action.
 * `onRetry` is optional — without it the state is informational only.
 */
export default function ErrorState({
  title = "Something went wrong",
  message,
  onRetry = null,
  retryLabel = "Try Again",
  compact = false,
  className = "",
}) {
  return (
    <div
      role="alert"
      className={`ui-error-state flex flex-col items-center justify-center px-6 ${compact ? "py-5" : "py-12"} text-center ${className}`}
    >
      <div className={`ui-state-icon flex items-center justify-center rounded-full bg-rose-50 dark:bg-rose-500/10 ${compact ? "mb-3 h-8 w-8" : "mb-4 h-16 w-16"}`}>
        <AlertTriangle className={`${compact ? "h-4 w-4" : "h-8 w-8"} text-brand-danger`} strokeWidth={1.8} aria-hidden="true" />
      </div>
      <h3 className="text-base font-semibold text-brand-ink">{title}</h3>
      {message && <p className="mt-1.5 max-w-md text-sm text-brand-gray">{message}</p>}
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className={`${compact ? "mt-3" : "mt-5"} inline-flex items-center gap-2 rounded-btn bg-brand-blue px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-dark`}
        >
          <RefreshCw className="h-4 w-4" /> {retryLabel}
        </button>
      )}
    </div>
  );
}
