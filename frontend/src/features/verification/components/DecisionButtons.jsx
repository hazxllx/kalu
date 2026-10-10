import React from "react";
import { CheckCircle2, XCircle, FileWarning, Loader2 } from "lucide-react";

/**
 * Shared decision controls for the Health Supervisor review modals (Resident
 * Verification and BHW Approval) so every equivalent approve / resubmit / reject
 * button looks and behaves identically. Only the appearance is shared here — the
 * calling modal keeps its own business logic, validation and status transitions.
 *
 * Visual language (reference: Resident Verification decision section):
 *   approve  → solid primary blue, white check-circle icon + white text
 *   resubmit → white background, neutral blue-gray border + text, alert icon
 *   reject   → very light red background, red border + red text, X-circle icon
 *
 * All three share the same ~56px height, 4–6px radius, typography, icon size,
 * padding and hover / focus-visible / disabled / loading states.
 */

const BASE =
  "inline-flex h-14 w-full items-center justify-center gap-2 rounded-btn px-4 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60";

const VARIANTS = {
  approve: {
    Icon: CheckCircle2,
    className: "bg-brand-blue text-white shadow-soft hover:bg-brand-dark focus-visible:ring-brand-blue",
  },
  resubmit: {
    Icon: FileWarning,
    className:
      "border border-brand-border bg-white text-brand-gray hover:bg-brand-bg hover:text-brand-ink focus-visible:ring-brand-blue",
  },
  reject: {
    Icon: XCircle,
    className:
      "border border-brand-danger/30 bg-brand-danger/5 text-brand-danger hover:bg-brand-danger/10 focus-visible:ring-brand-danger",
  },
};

/**
 * A single standardized decision button.
 *
 * @param {"approve"|"resubmit"|"reject"} variant
 * @param {boolean} [loading] show a spinner in place of the icon
 */
export function DecisionButton({
  variant = "approve",
  onClick,
  disabled = false,
  loading = false,
  children,
  type = "button",
  ...rest
}) {
  const meta = VARIANTS[variant] || VARIANTS.approve;
  const Icon = meta.Icon;
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`${BASE} ${meta.className}`}
      {...rest}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Icon className="h-4 w-4" />}
      {children}
    </button>
  );
}

/**
 * Equal-width decision button row.
 *
 * One row on desktop with 12px gaps; stacks to a single column on narrow
 * screens so the buttons never overflow horizontally.
 *
 * @param {2|3} [columns]
 */
export function DecisionButtonRow({ columns = 3, children }) {
  const cols = columns === 2 ? "sm:grid-cols-2" : "sm:grid-cols-3";
  return <div className={`grid grid-cols-1 gap-3 ${cols}`}>{children}</div>;
}

/** Shared remarks textarea styling used by both review modals. */
export const DECISION_TEXTAREA_CLASS =
  "w-full resize-none rounded-btn border border-brand-border bg-white px-3.5 py-2.5 text-sm text-brand-ink outline-none transition-colors focus:border-brand-blue dark:border-border dark:bg-input dark:text-foreground";
