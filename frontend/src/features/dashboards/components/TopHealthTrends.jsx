import React from "react";

/**
 * Top 3 Health Trends — the Health Supervisor dashboard replacement for the
 * former Community Health Risk Overview.
 *
 * It lists the most frequently recorded conditions for the selected reporting
 * period, ranked 1–3, with the recorded case count. A trend indicator
 * (increasing / decreasing / unchanged) is shown ONLY when a comparable
 * previous period supplied data; otherwise the case count is shown on its own.
 *
 * All figures come from the already-scoped, already-classified analytics
 * response passed in by the dashboard. No condition, count or direction is ever
 * fabricated here.
 */

// Trend text carries its own label so the meaning never depends on colour or an
// arrow alone (accessibility: status is not communicated by colour only).
const TREND_LABELS = {
  increasing: "Increasing",
  decreasing: "Decreasing",
  unchanged: "Unchanged",
};

const TREND_GLYPHS = {
  increasing: "\u2191",
  decreasing: "\u2193",
  unchanged: "\u2192",
};

const TREND_TONES = {
  increasing: "text-brand-danger",
  decreasing: "text-brand-green",
  unchanged: "text-brand-gray",
};

function TrendIndicator({ direction }) {
  if (!direction) return null;
  return (
    <span
      className={`inline-flex items-center gap-1 text-[11px] font-medium ${TREND_TONES[direction] || "text-brand-gray"}`}
    >
      <span aria-hidden="true">{TREND_GLYPHS[direction]}</span>
      {TREND_LABELS[direction]}
    </span>
  );
}

export default function TopHealthTrends({
  trends = [],
  loading = false,
  error = "",
  emptyMessage = "No health trends available for this reporting period.",
}) {
  return (
    <div className="mt-1">
      {loading ? (
        <div className="space-y-3" aria-busy="true">
          {[0, 1, 2].map((row) => (
            <div key={row} className="animate-pulse space-y-2 border-b border-brand-border pb-3 last:border-b-0 last:pb-0">
              <div className="h-3 w-2/3 rounded-sm bg-brand-border/70" />
              <div className="h-2.5 w-1/3 rounded-sm bg-brand-border/50" />
            </div>
          ))}
        </div>
      ) : error ? (
        <p className="py-3 text-xs text-brand-gray">{error}</p>
      ) : trends.length === 0 ? (
        <p className="py-3 text-xs text-brand-gray">{emptyMessage}</p>
      ) : (
        <ol className="divide-y divide-brand-border">
          {trends.map((trend) => (
            <li key={trend.name} className="flex items-center gap-3 py-3 first:pt-1 last:pb-1">
              <span className="w-6 shrink-0 font-stat text-sm font-semibold text-brand-blue">
                {String(trend.rank).padStart(2, "0")}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-brand-ink" title={trend.name}>
                  {trend.name}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className="font-stat text-sm font-semibold text-brand-ink">
                  {trend.value}
                  <span className="ml-1 text-[11px] font-normal text-brand-gray">
                    {trend.value === 1 ? "case" : "cases"}
                  </span>
                </p>
                <TrendIndicator direction={trend.direction} />
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
