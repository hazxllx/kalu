import React, { useCallback, useEffect, useRef } from "react";
import { X } from "lucide-react";

/**
 * Shared centered review modal shell.
 *
 * The single detail-view container used by the Health Supervisor's Resident
 * Verification and BHW Approval workflows so both features share exactly the
 * same shell: a centered dialog (never a side drawer) with a circular-avatar
 * header, a fixed header + single scrollable body, Escape / backdrop close,
 * focus management, and background-scroll locking while open.
 *
 * Design: white surface, thin neutral border, soft shadow, ~16px radius,
 * responsive width capped near 1040px, max height 90vh, and a z-index above the
 * sidebar, navigation, dropdowns and page content.
 *
 * @param {string} name       Resident/applicant full name (drives the avatar initials)
 * @param {string} [reference] Reference number shown in the header sub-line
 * @param {string} [meta]      Barangay / professional role shown in the header sub-line
 * @param {React.ReactNode} [status] Status badge rendered on the right of the header
 * @param {() => void} onClose Close handler
 * @param {() => boolean} [closeGuard] Return false to veto a backdrop/Escape close
 * @param {boolean} [busy] When true, every close affordance is disabled
 * @param {React.RefObject} [initialFocusRef] Element focused when the modal opens
 */
export default function ReviewModal({
  name,
  reference,
  meta,
  status,
  onClose,
  closeGuard,
  busy = false,
  initialFocusRef,
  ariaLabel,
  children,
}) {
  const stateRef = useRef({ busy, closeGuard, onClose });
  stateRef.current = { busy, closeGuard, onClose };
  const closeBtnRef = useRef(null);

  const requestClose = useCallback(() => {
    const current = stateRef.current;
    if (current.busy) return;
    if (current.closeGuard && !current.closeGuard()) return;
    current.onClose?.();
  }, []);

  // Escape closes the modal; the page behind cannot scroll while it is open.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") requestClose();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [requestClose]);

  // Move focus into the dialog on open and restore it on close.
  useEffect(() => {
    const previouslyFocused = document.activeElement;
    (initialFocusRef?.current || closeBtnRef.current)?.focus();
    return () => {
      if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus();
    };
  }, [initialFocusRef]);

  const initials =
    (name || "?").trim().split(/\s+/).map((n) => n[0]).slice(0, 2).join("").toUpperCase() || "?";

  const subline = [reference ? `Ref ${reference}` : "", meta || ""].filter(Boolean).join(" · ");

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" role="presentation">
      {/* Semi-transparent backdrop — clicking outside closes the modal */}
      <div className="absolute inset-0 bg-black/50" onClick={requestClose} />
      <div
        className="relative flex max-h-[90vh] w-full flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-border dark:bg-card"
        style={{ maxWidth: "min(1040px, calc(100vw - 32px))" }}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel || name}
        tabIndex={-1}
      >
        {/* Sticky header — identity stays visible while the body scrolls */}
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-white px-5 py-4 dark:border-border dark:bg-card">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand-blue text-sm font-heading font-semibold text-white">
              {initials}
            </div>
            <div className="min-w-0">
              <p className="truncate text-base font-semibold text-brand-ink dark:text-foreground">{name}</p>
              {subline && (
                <p className="truncate text-xs text-brand-gray">
                  {reference ? (
                    <>Ref <span className="font-stat font-medium">{reference}</span>{meta ? ` · ${meta}` : ""}</>
                  ) : (
                    meta
                  )}
                </p>
              )}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {status}
            <button
              ref={closeBtnRef}
              onClick={requestClose}
              className="flex h-9 w-9 items-center justify-center rounded-lg text-brand-gray transition-colors hover:bg-brand-bg hover:text-brand-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue dark:hover:bg-card-nested"
              aria-label="Close dialog"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Single scrollable body */}
        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">{children}</div>
      </div>
    </div>
  );
}

/** Bordered content section with the shared uppercase label used inside the modal. */
export function ModalSection({ label, children, className = "" }) {
  return (
    <section className={`rounded-xl border border-slate-200 bg-white p-4 dark:border-border dark:bg-card ${className}`}>
      {label && <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-brand-gray">{label}</p>}
      {children}
    </section>
  );
}

/** Responsive two-column information grid: two columns on desktop, one on mobile. */
export function InfoGrid({ children, className = "" }) {
  return <dl className={`grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2 ${className}`}>{children}</dl>;
}

/** Standardized label / value pair with consistent typography and empty handling. */
export function InfoItem({ label, value, full = false }) {
  const empty = value === null || value === undefined || value === "";
  return (
    <div className={`min-w-0 border-b border-slate-100 pb-2 dark:border-border/60 ${full ? "sm:col-span-2" : ""}`}>
      <dt className="text-[11px] font-medium uppercase tracking-wide text-brand-gray">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium text-brand-ink break-words dark:text-foreground">{empty ? "—" : value}</dd>
    </div>
  );
}

/** Label / value detail row (kept for backward compatibility). */
export function ModalRow({ label, value }) {
  return (
    <div className="flex items-start justify-between gap-3 text-sm">
      <p className="shrink-0 text-brand-gray">{label}</p>
      <p className="min-w-0 break-words text-right font-medium text-brand-ink">{value}</p>
    </div>
  );
}
