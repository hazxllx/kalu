import React, { useEffect, useState } from "react";
import { Loader2, FileText, Maximize2, Download } from "lucide-react";

const isImage = (mimeType) => String(mimeType || "").toLowerCase().startsWith("image/");

/**
 * Shared document-preview card used by both the Resident Verification and the
 * BHW Approval review modals so uploaded files are presented identically.
 *
 * Renders the resident/applicant's ACTUAL uploaded file from the backend-issued
 * signed URL (`doc.url`); it never fabricates a placeholder. Images keep their
 * aspect ratio (`object-contain`) on a neutral preview area with a predictable
 * height, report their own loading and error states, and open the shared
 * lightbox when clicked. A keyed instance per `doc.url` prevents a previous
 * applicant's cached image from lingering after switching records.
 *
 * @param {{ id:string, title?:string, filename?:string, mimeType?:string, url?:string, statusLabel?:string }} doc
 * @param {(doc:object) => void} [onEnlarge]
 * @param {(id:string) => Promise<string|null>} [onRefreshUrl] optional secure-link refresh
 * @param {React.ReactNode} [footer] optional extra controls rendered under the card
 */
export default function DocumentPreviewCard({ doc, onEnlarge, onRefreshUrl, footer }) {
  const [url, setUrl] = useState(doc?.url || "");
  const [state, setState] = useState(doc?.url ? "loading" : "error"); // 'loading' | 'loaded' | 'error'
  const [refreshing, setRefreshing] = useState(false);
  const image = isImage(doc?.mimeType);
  const title = doc?.title || doc?.filename || "Document";

  useEffect(() => {
    setUrl(doc?.url || "");
    setState(doc?.url ? "loading" : "error");
  }, [doc?.url]);

  const refreshUrl = async () => {
    if (!onRefreshUrl) return;
    setRefreshing(true);
    try {
      const nextUrl = await onRefreshUrl(doc.id);
      if (!nextUrl) throw new Error("no url");
      setUrl(nextUrl);
      setState("loading");
    } catch {
      setState("error");
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div className="flex flex-col">
      <article className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-border dark:bg-card">
        {image ? (
          <div className="relative flex h-48 items-center justify-center bg-brand-bg dark:bg-card-nested sm:h-52">
            {url && state !== "error" ? (
              <>
                <img
                  src={url}
                  alt={`${title}${doc?.filename && doc.filename !== title ? ` — ${doc.filename}` : ""}`}
                  loading="lazy"
                  onLoad={() => setState("loaded")}
                  onError={() => setState("error")}
                  className={`max-h-full max-w-full object-contain p-2 ${state === "loaded" ? "" : "invisible"}`}
                />
                {state === "loading" && (
                  <span className="absolute inset-0 flex items-center justify-center gap-2 text-sm text-brand-gray">
                    <Loader2 className="h-4 w-4 animate-spin" /> Loading image…
                  </span>
                )}
                {state === "loaded" && (
                  <button
                    type="button"
                    onClick={() => onEnlarge?.({ ...doc, url })}
                    className="absolute inset-0 cursor-zoom-in focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-blue"
                    aria-label={`Enlarge ${title}`}
                    title="Open larger image"
                  />
                )}
              </>
            ) : (
              <div className="flex flex-col items-center gap-2 px-4 text-center text-sm text-brand-gray">
                <p className="text-brand-danger">This document image could not be loaded.</p>
                {onRefreshUrl && (
                  <button
                    type="button"
                    onClick={refreshUrl}
                    disabled={refreshing}
                    className="rounded-btn border border-brand-border px-3 py-1.5 text-xs font-medium text-brand-blue hover:border-brand-blue disabled:opacity-60"
                  >
                    {refreshing ? "Refreshing link…" : "Refresh secure link"}
                  </button>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="flex h-48 flex-col items-center justify-center gap-2 bg-brand-bg text-brand-blue dark:bg-card-nested sm:h-52">
            <FileText className="h-10 w-10" strokeWidth={1.5} />
            <span className="text-[11px] font-medium uppercase tracking-wide text-brand-gray">
              {String(doc?.mimeType || "").includes("pdf") ? "PDF document" : "Document"}
            </span>
          </div>
        )}

        <div className="flex min-w-0 items-center justify-between gap-3 border-t border-slate-200 px-3 py-2.5 dark:border-border">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-brand-ink" title={title}>{title}</p>
            {doc?.filename && doc.filename !== title && (
              <p className="truncate text-xs text-brand-gray" title={doc.filename}>{doc.filename}</p>
            )}
            {doc?.statusLabel && <p className="truncate text-[11px] text-brand-gray">{doc.statusLabel}</p>}
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {image && state === "loaded" && (
              <button
                type="button"
                onClick={() => onEnlarge?.({ ...doc, url })}
                className="inline-flex items-center gap-1 rounded-btn border border-brand-border px-2 py-1.5 text-xs font-medium text-brand-blue transition-colors hover:border-brand-blue"
              >
                <Maximize2 className="h-3 w-3" /> View larger
              </button>
            )}
            {!image && (url ? (
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 rounded-btn border border-brand-border px-2 py-1.5 text-xs font-medium text-brand-blue transition-colors hover:border-brand-blue"
              >
                <Download className="h-3 w-3" /> Open document
              </a>
            ) : (
              <span className="text-xs text-brand-gray">Unavailable</span>
            ))}
          </div>
        </div>
      </article>
      {footer}
    </div>
  );
}
