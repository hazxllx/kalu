import React from "react";
import { AlertTriangle } from "lucide-react";

/**
 * Reusable validation presentation.
 *
 * `FieldError` renders one field's message (with an id so inputs can set
 * `aria-describedby`). `ValidationSummary` renders the "please complete all
 * required fields" block and can focus the first invalid field when clicked.
 *
 * Styling matches the KALUSAGAP danger token used across the app.
 */

export function FieldError({ id, error, className = "" }) {
  if (!error) return null;
  return (
    <p id={id} role="alert" className={`mt-1 text-xs text-brand-danger ${className}`}>
      {error}
    </p>
  );
}

export function ValidationSummary({ errors = {}, title = "Please fix the highlighted fields.", onFocusField, className = "" }) {
  const entries = Object.entries(errors).filter(([, message]) => Boolean(message));
  if (entries.length === 0) return null;

  return (
    <div
      role="alert"
      aria-live="polite"
      className={`rounded-lg border border-brand-danger/30 bg-brand-danger/5 px-3.5 py-3 text-sm text-brand-danger ${className}`}
    >
      <p className="flex items-center gap-2 font-medium">
        <AlertTriangle className="h-4 w-4 shrink-0" strokeWidth={2} />
        {title}
      </p>
      <ul className="mt-1.5 list-disc space-y-0.5 pl-6 text-[12.5px]">
        {entries.map(([field, message]) => (
          <li key={field}>
            {onFocusField ? (
              <button type="button" onClick={() => onFocusField(field)} className="text-left underline underline-offset-2">
                {message}
              </button>
            ) : (
              message
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default { FieldError, ValidationSummary };
