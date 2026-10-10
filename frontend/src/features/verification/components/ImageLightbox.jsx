import React, { useEffect, useState } from "react";
import { X, Download, ChevronLeft, ChevronRight, ImageOff, Loader2 } from "lucide-react";

/**
 * Shared image lightbox used by the Resident Verification and BHW Approval
 * review modals so document enlargement looks and behaves identically.
 *
 * Rendered on top of the details modal (z-[120]). Closing it (button, backdrop,
 * or Escape) only clears the lightbox and leaves the underlying details modal
 * mounted and untouched — the Escape listener uses the capture phase and stops
 * propagation so the modal behind it never also closes. Supports keyboard and
 * on-screen navigation across multiple images.
 *
 * @param {{ id:string, title?:string, url:string }[]} images
 * @param {number} index
 * @param {() => void} onClose
 * @param {(nextIndex:number) => void} onNavigate
 */
export default function ImageLightbox({ images = [], index = 0, onClose, onNavigate }) {
  const [state, setState] = useState("loading"); // 'loading' | 'loaded' | 'error'
  const doc = images[index];

  useEffect(() => {
    setState("loading");
  }, [index, doc?.url]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose?.();
      } else if (e.key === "ArrowRight" && images.length > 1) {
        onNavigate?.((index + 1) % images.length);
      } else if (e.key === "ArrowLeft" && images.length > 1) {
        onNavigate?.((index - 1 + images.length) % images.length);
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [index, images.length, onClose, onNavigate]);

  if (!doc) return null;
  const label = doc.title || "Document image";
  const multiple = images.length > 1;

  return (
    <div
      className="fixed inset-0 z-[120] flex flex-col items-center justify-center bg-black/85 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`${label} preview`}
      onClick={onClose}
    >
      <div className="absolute right-4 top-4 flex items-center gap-2">
        <a
          href={doc.url}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
          aria-label="Open image in a new tab"
        >
          <Download className="h-5 w-5" />
        </a>
        <button
          type="button"
          onClick={onClose}
          className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
          aria-label="Close image preview"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {multiple && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onNavigate?.((index - 1 + images.length) % images.length); }}
          className="absolute left-3 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20 sm:left-6"
          aria-label="Previous image"
        >
          <ChevronLeft className="h-6 w-6" />
        </button>
      )}

      <div className="flex max-h-[82vh] max-w-[92vw] items-center justify-center" onClick={(e) => e.stopPropagation()}>
        {state === "loading" && (
          <div className="absolute flex items-center gap-2 text-sm text-white/80">
            <Loader2 className="h-5 w-5 animate-spin" /> Loading image…
          </div>
        )}
        {state === "error" ? (
          <div className="flex flex-col items-center gap-2 text-center text-white/80">
            <ImageOff className="h-10 w-10" strokeWidth={1.4} />
            <span className="text-sm">This image could not be loaded.</span>
          </div>
        ) : (
          <img
            src={doc.url}
            alt={label}
            onLoad={() => setState("loaded")}
            onError={() => setState("error")}
            className={`max-h-[82vh] max-w-[92vw] rounded-lg object-contain shadow-2xl ${state === "loaded" ? "" : "invisible"}`}
          />
        )}
      </div>

      {multiple && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onNavigate?.((index + 1) % images.length); }}
          className="absolute right-3 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20 sm:right-6"
          aria-label="Next image"
        >
          <ChevronRight className="h-6 w-6" />
        </button>
      )}

      <div className="mt-4 flex flex-col items-center gap-0.5 text-center" onClick={(e) => e.stopPropagation()}>
        <p className="text-sm font-medium text-white">{label}</p>
        {multiple && <p className="text-xs text-white/70">{index + 1} of {images.length}</p>}
      </div>
    </div>
  );
}
