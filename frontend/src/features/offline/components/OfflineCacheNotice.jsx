// frontend/src/features/offline/components/OfflineCacheNotice.jsx
import React from "react";
import { RefreshCw, WifiOff } from "lucide-react";

const formatSyncDateTime = (timestamp) => {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return "";
  try {
    return new Date(timestamp).toLocaleString();
  } catch {
    return "";
  }
};

/**
 * Minimalist, read-only offline cache indicator for clinical views.
 *
 * Shown only when data originates from the local IndexedDB cache (`source === 'cache'`),
 * following the KALUSAGAP blue palette with no emojis or oversized banners.
 *
 * @param {object} props
 * @param {'server'|'cache'|null|undefined} props.source
 * @param {number|null|undefined} [props.cachedAt]
 * @param {number|null|undefined} [props.lastSyncedAt]
 * @param {boolean} [props.stale]
 * @param {boolean} [props.empty]
 * @param {Function} [props.onRetry]
 * @param {string} [props.className]
 */
export default function OfflineCacheNotice({
  source,
  cachedAt = null,
  lastSyncedAt = null,
  stale = false,
  empty = false,
  onRetry,
  className = "",
}) {
  if (source !== "cache") return null;

  const syncTimestamp = Number.isFinite(cachedAt) && cachedAt > 0
    ? cachedAt
    : (Number.isFinite(lastSyncedAt) && lastSyncedAt > 0 ? lastSyncedAt : null);
  const formattedTime = formatSyncDateTime(syncTimestamp);

  return (
    <div
      role="status"
      aria-live="polite"
      className={`mb-4 flex flex-wrap items-center justify-between gap-2 rounded-btn border px-3.5 py-2 text-xs ${
        stale
          ? "border-brand-amber/35 bg-brand-goldpale text-brand-ink"
          : "border-brand-blue/25 bg-brand-light text-brand-ink"
      } ${className}`.trim()}
    >
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 min-w-0">
        <WifiOff
          className={`h-3.5 w-3.5 shrink-0 ${stale ? "text-brand-amber" : "text-brand-blue"}`}
          aria-hidden="true"
        />
        <span className="font-medium">
          {empty ? "No saved records available offline." : "Offline — Showing saved records"}
        </span>
        {formattedTime && (
          <span className="text-brand-gray">
            Last synchronized: {formattedTime}
          </span>
        )}
        {stale && !empty && (
          <span className="font-medium text-brand-amber">
            Cached data may be outdated.
          </span>
        )}
      </div>
      {typeof onRetry === "function" && (
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex shrink-0 items-center gap-1 font-semibold text-brand-blue hover:underline"
        >
          <RefreshCw className="h-3 w-3" aria-hidden="true" />
          Retry
        </button>
      )}
    </div>
  );
}
