import React from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

/**
 * Shared error state: icon, title, message, and a retry action.
 * `onRetry` is optional — without it the state is informational only.
 */
export default function ErrorState({
  title = "Something went wrong",
  message,
  onRetry,
  retryLabel = "Try Again",
  className = "",
}) {
  return (
    <div
      role="alert"
      className={`flex flex-col items-center justify-center px-6 py-12 text-center ${className}`}
    >
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-rose-50 dark:bg-rose-500/10">
        <AlertTriangle className="h-8 w-8 text-brand-danger" strokeWidth={1.8} aria-hidden="true" />
      </div>
      <h3 className="text-base font-semibold text-brand-ink">{title}</h3>
      {message && <p className="mt-1.5 max-w-md text-sm text-brand-gray">{message}</p>}
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-5 inline-flex items-center gap-2 rounded-btn bg-brand-blue px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-dark"
        >
          <RefreshCw className="h-4 w-4" /> {retryLabel}
        </button>
      )}
    </div>
  );
}
