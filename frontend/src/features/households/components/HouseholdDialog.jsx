// frontend/src/features/households/components/HouseholdDialog.jsx
import React, { useLayoutEffect, useRef } from "react";

export default function HouseholdDialog({ label, onClose, className = "max-w-2xl", children }) {
  const ref = useRef(null);

  useLayoutEffect(() => {
    const dialog = ref.current;
    dialog.showModal();
    return () => dialog.close();
  }, []);

  return (
    <dialog
      ref={ref}
      aria-label={label}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      className={`m-auto max-h-[85vh] w-[calc(100vw-2rem)] overflow-hidden rounded-lg border-0 bg-transparent p-0 text-inherit backdrop:bg-black/50 ${className}`}
    >
      <div className="flex max-h-[85vh] min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-brand-border bg-white dark:bg-card">
        {children}
      </div>
    </dialog>
  );
}
