// frontend/src/components/common/FormModal.jsx
import React, { useId } from "react";
import { X } from "lucide-react";

const SIZE_CLASSES = {
  standard: "max-w-[52rem]",
  large: "max-w-[70rem]",
};

export function FormModalHeader({ title, description, onClose, closeDisabled = false, titleId, descriptionId }) {
  const generatedId = useId();
  const resolvedTitleId = titleId || `form-modal-title-${generatedId}`;
  const resolvedDescriptionId = descriptionId || `${resolvedTitleId}-description`;

  return (
    <header className="relative isolate flex shrink-0 items-start justify-between gap-4 overflow-hidden border-b border-brand-border bg-[#EFF6FF] px-4 py-3 dark:border-border dark:bg-[#14263A] sm:px-5">
      <div aria-hidden="true" className="pointer-events-none absolute -right-12 -top-20 h-44 w-44 rounded-full border-[22px] border-brand-blue/10 dark:border-blue-300/10" />
      <div className="relative z-10 flex min-w-0 items-start gap-3">
        <span aria-hidden="true" className="mt-0.5 h-10 w-1 shrink-0 rounded-full bg-brand-blue" />
        <div className="min-w-0">
          <h2 id={resolvedTitleId} className="break-words text-lg font-bold text-brand-ink dark:text-foreground">{title}</h2>
          {description && <p id={resolvedDescriptionId} className="mt-1 break-words text-sm text-brand-gray dark:text-muted-foreground">{description}</p>}
        </div>
      </div>
      <button
        type="button"
        onClick={onClose}
        disabled={closeDisabled}
        className="relative z-10 -mr-1 -mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-btn text-brand-gray transition-colors hover:bg-white/70 hover:text-brand-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/40 disabled:cursor-not-allowed disabled:opacity-60 dark:text-muted-foreground dark:hover:bg-card/70 dark:hover:text-foreground"
        aria-label="Close"
      >
        <X className="h-5 w-5" />
      </button>
    </header>
  );
}

export default function FormModal({
  title,
  description,
  onClose,
  children,
  footer,
  size = "standard",
  closeDisabled = false,
  bodyClassName = "",
  labelledBy,
  closeOnBackdrop = false,
  dialogClassName = "",
  overlayClassName = "",
}) {
  const generatedId = useId();
  const titleId = labelledBy || `form-modal-title-${generatedId}`;
  const descriptionId = `${titleId}-description`;

  return (
    <div
      className={`fixed inset-0 z-[70] flex items-center justify-center overflow-hidden bg-black/50 p-2 sm:p-4 ${overlayClassName}`}
      onMouseDown={(event) => {
        if (closeOnBackdrop && event.target === event.currentTarget && !closeDisabled) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        className={`flex max-h-[90dvh] min-h-0 w-[calc(100vw-1rem)] flex-col overflow-hidden rounded-card border border-brand-border bg-white shadow-xl dark:border-border dark:bg-card sm:w-[92vw] ${SIZE_CLASSES[size] || SIZE_CLASSES.standard} ${dialogClassName}`}
      >
        <FormModalHeader
          title={title}
          description={description}
          onClose={onClose}
          closeDisabled={closeDisabled}
          titleId={titleId}
          descriptionId={descriptionId}
        />

        <div className={`min-h-0 flex-1 overflow-y-auto overscroll-contain bg-white px-4 py-4 dark:bg-card sm:px-6 ${bodyClassName}`}>
          {children}
        </div>

        {footer && (
          <footer className="shrink-0 border-t border-brand-border bg-white px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] dark:border-border dark:bg-card sm:px-5">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end [&>button]:min-h-10 [&>button]:w-full [&>button]:justify-center sm:[&>button]:w-auto">
              {footer}
            </div>
          </footer>
        )}
      </section>
    </div>
  );
}
