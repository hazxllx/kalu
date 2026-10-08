import React from "react";
import { TYPE, PALETTE, RADIUS } from "@/lib/designTokens";

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

/**
 * Group of fields under a labeled section.
 *
 * Layout:
 *   SECTION LABEL (uppercase eyebrow + title)
 *   field grid
 */
export default function FieldGroup({
  title,
  eyebrow = "",
  description = "",
  children,
  className = "",
}) {
  return (
    <div className={`mb-6 ${className}`}>
      {(title || eyebrow) && (
        <div className="mb-3">
          {eyebrow && (
            <p
              className="mb-0.5 text-[10px] font-semibold uppercase tracking-[0.22em] text-[#0B4A8F] dark:text-[#1464A3]"
              style={{
                fontFamily: TYPE.eyebrow.family,
                fontSize: "10px",
                fontWeight: 600,
                letterSpacing: TYPE.eyebrow.letter,
              }}
            >
              {eyebrow}
            </p>
          )}
          {title && (
            <h3 className="m-0 text-[15px] font-semibold text-[#12263F] dark:text-[#E8EDF3]"
                style={{
                  fontFamily: TYPE.h3.family,
                  fontSize: TYPE.h3.base,
                  fontWeight: TYPE.h3.weight,
                  lineHeight: TYPE.h3.line,
                }}>
              {title}
            </h3>
          )}
          {description && (
            <p className="m-0 mt-1 text-[11px] text-[#54637A] dark:text-[#9AA7B5]"
               style={{ fontFamily: TYPE.caption.family }}>
              {description}
            </p>
          )}
        </div>
      )}
      {children}
    </div>
  );
}
