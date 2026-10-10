import React from "react";
import { TYPE } from "@/lib/designTokens";

/**
 * Primary and secondary action buttons.
 *
 * Primary: solid navy, white text, used for the single most important action
 *   on a page or within a form (bottom right).
 * Secondary: outlined navy border, navy text — secondary actions, cancels,
 *   filters, and "view" links.
 *
 * Touch target minimum 44px height.
 */
export default function ActionButton({
  variant = "primary",
  children,
  onClick,
  type = "button",
  disabled = false,
  className = "",
  href,
  ...props
}) {
  const isPrimary = variant === "primary";

  const base = `inline-flex min-h-[44px] items-center justify-center gap-2 rounded-[8px] text-[13px] font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0B4A8F]/40 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-[#0D1826] ${isPrimary ? "text-white" : "text-[#0B4A8F]"}`;

  const styles = isPrimary
    ? {
        backgroundColor: "#0B4A8F",
        borderColor: "#0B4A8F",
        _hover: { backgroundColor: "#072F5F" },
        _disabled: { backgroundColor: "#9BB6D4", borderColor: "#9BB6D4", cursor: "not-allowed" },
      }
    : {
        backgroundColor: "white",
        borderColor: "#0B4A8F",
        _hover: { backgroundColor: "#F4F6FA" },
        _disabled: { borderColor: "#D6DEE8", color: "#8A95A4", cursor: "not-allowed" },
      };

  const combinedStyle = {
    ...styles,
    ...(!disabled && styles._hover),
    ...disabled && styles._disabled,
  };

  const content = (
    <span
      style={{
        fontFamily: TYPE.body.family,
        ...combinedStyle,
      }}
      className={className}
    >
      {children}
    </span>
  );

  if (href) {
    return (
      <a
        href={href}
        role="button"
        tabIndex={0}
        className={base}
        onClick={onClick}
        style={combinedStyle}
        {...props}
      >
        {children}
      </a>
    );
  }

  return (
    <button
      type={/** @type {"button"|"submit"|"reset"} */ (type)}
      onClick={onClick}
      disabled={disabled}
      className={base}
      style={combinedStyle}
      {...props}
    >
      {children}
    </button>
  );
}
