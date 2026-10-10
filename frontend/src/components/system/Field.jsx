import React from "react";
import { TYPE } from "@/lib/designTokens";

/**
 * Form field with label, error, and helper text.
 *
 * Layout:
 *   LABEL (with * for required)
 *   input / select / textarea
 *   helper text or error message
 *
 * Keeps every form in the app consistent.
 */
export default function Field({
  label,
  required = false,
  helper = "",
  error = "",
  children,
  className = "",
  id,
  ...props
}) {
  const hasError = Boolean(error);
  const borderClass = hasError
    ? "border-[#B3202C] focus:border-[#B3202C]"
    : "border-[#D6DEE8] focus:border-[#0B4A8F]";

  return (
    <div className={className}>
      {label && (
        <label
          htmlFor={id}
          className="mb-1 block text-[13px] font-medium text-[#12263F] dark:text-[#E8EDF3]"
          style={{ fontFamily: TYPE.body.family }}
        >
          {label} {required && <span className="text-[#B3202C]" style={{ fontFamily: TYPE.body.family }}>*</span>}
        </label>
      )}
      {children}
      {hasError ? (
        <p className="mt-1 text-[11px] font-medium text-[#B3202C]" style={{ fontFamily: TYPE.body.family }}>
          {error}
        </p>
      ) : helper ? (
        <p className="mt-1 text-[11px] text-[#54637A] dark:text-[#9AA7B5]" style={{ fontFamily: TYPE.body.family }}>
          {helper}
        </p>
      ) : null}
    </div>
  );
}
