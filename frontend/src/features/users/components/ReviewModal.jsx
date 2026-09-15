import React, { useEffect, useRef } from "react";
import { X } from "lucide-react";

/**
 * Shared centered review modal (Admin).
 *
 * The single detail-view container used by Staff Registration Requests and
 * Health Supervisor Verification so both features share exactly the same
 * layout, spacing, styling and interaction pattern: a centered dialog (never a
 * side drawer) with a fixed header, a scrollable body, Escape/backdrop close,
 * and background-scroll locking while open.
 */
export default function ReviewModal({ title, subtitle, status, onClose, children }) {
  // Keep the latest close handler without re-binding listeners every render.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Escape closes the modal; the page behind cannot scroll while it is open.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onCloseRef.current();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, []);

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" role="dialog" aria-modal="true">
      {/* Subtle backdrop — clicking outside closes the modal */}
      <div className="absolute inset-0 bg-black/50" onClick={() => onCloseRef.current()} />
      <div className="relative flex max-h-[calc(100dvh-2rem)] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-border dark:bg-card">
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 px-5 py-4 dark:border-border">
          <div className="min-w-0">
            <p className="truncate text-base font-semibold text-brand-ink">{title}</p>
            {subtitle && <p className="truncate text-xs text-brand-gray">{subtitle}</p>}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {status}
            <button onClick={() => onCloseRef.current()} className="text-brand-gray hover:text-brand-ink" aria-label="Close">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">{children}</div>
      </div>
    </div>
  );
}

/** Bordered content section with the shared uppercase label used inside the modal. */
export function ModalSection({ label, children }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-border dark:bg-card">
      {label && <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-brand-gray">{label}</p>}
      {children}
    </section>
  );
}

/** Label / value detail row shared by every review modal. */
export function ModalRow({ label, value }) {
  return (
    <div className="flex items-start justify-between gap-3 text-sm">
      <p className="shrink-0 text-brand-gray">{label}</p>
      <p className="min-w-0 break-words text-right font-medium text-brand-ink">{value}</p>
    </div>
  );
}
