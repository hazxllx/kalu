import React from "react";
import EmptyState from "@/components/common/EmptyState";
import ErrorState from "@/components/common/ErrorState";

/** A labelled count chart derived only from recorded condition totals. */
export default function TopHealthTrends({ trends = [], loading = false, error = "", onRetry, compact = false }) {
  if (loading) return <p role="status" className="py-5 text-ui text-brand-gray">Loading recorded conditions...</p>;
  if (error) return <ErrorState compact title="Health conditions unavailable" message={error} onRetry={onRetry} />;
  if (!trends.length) return <EmptyState compact title="No classified conditions recorded" description="Condition totals appear when matching complaints are recorded in this reporting period." />;

  const maximum = Math.max(...trends.flatMap((trend) => [trend.value, trend.previousValue || 0]));
  const comparing = trends.some((trend) => trend.direction !== null);
  return (
    <div className={compact ? "hs-conditions" : "pt-3"}>
      <div className={`${compact ? "mb-2" : "mb-3"} flex flex-wrap items-center justify-between gap-2 text-caption text-brand-gray`}>
        <span>Recorded cases</span>
        {comparing && <span className="flex items-center gap-3"><span className="inline-flex items-center gap-1"><span className="h-1 w-3 bg-brand-blue" aria-hidden="true" />Current</span><span className="inline-flex items-center gap-1"><span className="h-2 w-px bg-slate-400" aria-hidden="true" />Previous</span></span>}
      </div>
      <ol className={compact ? "space-y-2.5" : "space-y-3.5"} aria-label="Most recorded conditions by case count">
        {trends.map((trend) => (
          <li key={trend.name} className="min-w-0">
            <div className="mb-1.5 flex items-baseline justify-between gap-3">
              <span className="min-w-0 text-ui font-medium text-brand-ink">{trend.name}</span>
              <span className="flex shrink-0 items-baseline gap-2"><span className="font-stat text-base font-semibold tabular-nums text-brand-ink">{trend.value.toLocaleString()}</span><TrendIndicator trend={trend} /></span>
            </div>
            <div className="relative h-1 bg-brand-bg" role="img" aria-label={`${trend.name}: ${trend.value} recorded cases${trend.previousValue !== null ? `, previously ${trend.previousValue}` : ""}`}>
              <div className="h-1 bg-brand-blue" style={{ width: `${trend.value / maximum * 100}%` }} />
              {trend.direction && <span aria-hidden="true" className="absolute -top-0.5 h-2 w-px bg-slate-400" style={{ left: `calc(${(trend.previousValue || 0) / maximum * 100}% - 1px)` }} />}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

function TrendIndicator({ trend }) {
  if (!trend.direction || !Number.isFinite(trend.previousValue)) return null;
  const glyph = trend.direction === "up" ? "+" : trend.direction === "down" ? "-" : "=";
  const label = `Previous period: ${trend.previousValue.toLocaleString()} recorded cases`;
  return <span className="inline-flex shrink-0 text-caption leading-none text-brand-gray" title={label} aria-label={label}>{glyph}{Math.abs(trend.value - trend.previousValue)}</span>;
}
