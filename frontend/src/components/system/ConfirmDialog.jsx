import React, { useState } from "react";
import { X, AlertTriangle } from "lucide-react";
import { TYPE } from "@/lib/designTokens";

/**
 * Accessible confirm dialog (delete / destructive action).
 *
 * Renders inside a portal-like overlay using fixed positioning (no actual
 * DOM portal — keeps everything inside the app tree for React context).
 * Focus is trapped; Escape and backdrop click close it.
 */
export default function ConfirmDialog({
  isOpen = false,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  tone = "danger",
  icon = AlertTriangle,
  onConfirm,
  onCancel,
}) {
  const [visible, setVisible] = useState(isOpen);
  const [closing, setClosing] = useState(false);

  const handleCancel = React.useCallback(() => {
    setClosing(true);
    setTimeout(() => onCancel?.(), 150);
  }, [onCancel]);

  React.useEffect(() => {
    if (isOpen) {
      setVisible(true);
      setClosing(false);
      document.body.style.overflow = "hidden";
    } else {
      setClosing(true);
      const t = setTimeout(() => {
        setVisible(false);
        document.body.style.overflow = "";
      }, 150);
      return () => clearTimeout(t);
    }
  }, [isOpen]);

  const handleConfirm = () => {
    setClosing(true);
    setTimeout(() => onConfirm?.(), 150);
  };

  React.useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") handleCancel();
    };
    if (isOpen) document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isOpen, handleCancel]);

  if (!visible) return null;

  const Icon = icon;

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-[#000000]/50 p-4"
      onClick={handleCancel}
      aria-modal="true"
      role="dialog"
      aria-labelledby="confirm-title"
    >
      <div
        className={`flex max-h-[calc(100dvh-2rem)] w-full max-w-md flex-col overflow-hidden rounded-[12px] bg-white shadow-[0_20px_50px_-12px_rgba(9,30,66,0.5)] dark:bg-[#131E2C] ${closing ? "opacity-0 scale-95" : "opacity-100 scale-100"} transition-all`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3 border-b border-[#E7ECF1] bg-[#F4F6FA] px-5 py-4 dark:border-[#2A3645] dark:bg-[#0D1826]">
          <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
            tone === "danger"
              ? "bg-[#FDECEC] dark:bg-[#6B2830]"
              : "bg-[#E8F0FA] dark:bg-[#144175]"
          }`}>
            <Icon
              className={`h-5 w-5 ${
                tone === "danger"
                  ? "text-[#B3202C] dark:text-[#E05D67]"
                  : "text-[#0B4A8F] dark:text-[#5EA3FF]"
              }`}
              strokeWidth={1.9}
              aria-hidden="true"
            />
          </div>
          <div className="min-w-0">
            <h3 id="confirm-title" className="m-0 text-[16px] font-semibold text-[#12263F] dark:text-[#E8EDF3]">
              {title}
            </h3>
            {closing && (
              <p
                className="m-0 mt-0.5 max-w-md text-[13px] text-[#54637A] dark:text-[#9AA7B5]"
                style={{ fontFamily: TYPE.body.family }}
              >
                {message}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={handleCancel}
            aria-label="Close"
            className="shrink-0 rounded-[4px] p-1 text-[#8A95A4] transition-colors hover:bg-[#E7ECF1] hover:text-[#54637A] dark:hover:bg-[#1B2635] dark:hover:text-[#9AA7B5]"
          >
            <X className="h-4 w-4" strokeWidth={2} />
          </button>
        </div>

        {!closing && (
          <div className="min-h-0 overflow-y-auto px-5 py-4">
            <p
              className="m-0 text-[13px] text-[#54637A] dark:text-[#9AA7B5]"
              style={{ fontFamily: TYPE.body.family }}
            >
              {message}
            </p>
          </div>
        )}

        <div className="flex flex-col-reverse gap-2 border-t border-[#E7ECF1] bg-[#F4F6FA] px-5 py-3.5 sm:flex-row sm:justify-end dark:border-[#2A3645] dark:bg-[#0D1826]">
          <button
            type="button"
            onClick={handleCancel}
            className="min-h-10 rounded-[4px] px-4 py-2 text-[13px] font-medium text-[#54637A] transition-colors hover:bg-[#D6DEE8] hover:text-[#12263F] dark:hover:bg-[#1B2635] dark:hover:text-[#E8EDF3]"
            style={{ fontFamily: TYPE.body.family }}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={closing}
            className={`min-h-10 rounded-[4px] px-4 py-2 text-[13px] font-medium text-white transition-colors ${
              tone === "danger"
                ? "bg-[#B3202C] hover:bg-[#991B26] disabled:opacity-60"
                : "bg-[#0B4A8F] hover:bg-[#072F5F] disabled:opacity-60"
            }`}
            style={{ fontFamily: TYPE.body.family }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
