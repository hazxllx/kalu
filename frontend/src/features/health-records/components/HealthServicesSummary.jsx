import React from "react";
import { Info, RefreshCw, ArrowRight } from "lucide-react";
import { Skeleton } from "@/components/common/Skeleton";
import {
  HEALTH_SERVICES,
  SERVICE_SOURCE_LABEL,
} from "@/features/health-records/lib/healthServicesConfig";

/**
 * Health Services — the FHSIS M1 service launcher + service summary.
 *
 * Presentation follows the existing M1 section-workspace language: a flat,
 * single panel with subtle borders, a compact reporting-period status bar, and
 * a dense administrative table — no floating cards, pill badges, oversized
 * icons or decorative chrome.
 *
 * Data flow is unchanged. Counts are NOT computed here. The parent reads the
 * single barangay-scoped M1 aggregation API (GET /m1/report → byCode[].section)
 * that also drives the official M1 form; a `null` count means "loading /
 * unavailable" and is never rendered as 0.
 */

const SOURCE_ACCENT = {
  m1: { bar: "bg-brand-blue", text: "text-brand-gray" },
  operational: { bar: "bg-brand-green", text: "text-brand-gray" },
};

/** Loading placeholder for one summary row (used while counts load). */
function SummaryRowSkeleton() {
  return (
    <div className="flex items-center gap-4 px-4 py-3">
      <Skeleton className="h-6 w-6 shrink-0 rounded-sm" />
      <div className="flex-1 space-y-1.5">
        <Skeleton className="h-3 w-2/5" />
        <Skeleton className="h-2.5 w-3/5" />
      </div>
      <Skeleton className="h-5 w-14 shrink-0" />
    </div>
  );
}

/** One desktop table row. */
function ServiceRow({ service, count, onOpen }) {
  const Icon = service.icon;
  const accent = SOURCE_ACCENT[service.source] || SOURCE_ACCENT.m1;
  const records = count == null ? "—" : count;
  const countLabel = count == null ? "indicators" : (Number(count) === 1 ? "indicator" : "indicators");
  const actionLabel = "View M1";

  return (
    <tr
      onClick={() => onOpen(service)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(service);
        }
      }}
      tabIndex={0}
      role="link"
      aria-label={`Open ${service.name}`}
      className="cursor-pointer border-t border-brand-border first:border-t-0 transition-colors hover:bg-brand-bg/40 focus-visible:bg-brand-bg/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/30"
    >
      <td className="px-4 py-3">
        <span className="flex items-center gap-2.5">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[3px] bg-brand-bg text-brand-gray">
            <Icon className="h-3.5 w-3.5" aria-hidden="true" />
          </span>
          <span className="text-[15px] font-semibold leading-tight text-brand-ink">{service.name}</span>
        </span>
      </td>
      <td className="px-4 py-3">
        <span className="block max-w-[20rem] truncate text-[13px] leading-snug text-brand-gray">
          {service.description}
        </span>
      </td>
      <td className="px-4 py-3 text-right align-middle">
        <span className="inline-flex items-baseline gap-1.5">
          <span className="font-stat text-lg font-bold leading-none tabular-nums text-brand-ink">{records}</span>
          <span className="text-[11px] font-medium uppercase tracking-wide text-brand-gray">{countLabel}</span>
        </span>
      </td>
      <td className="px-4 py-3 align-middle">
        <span className={`inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide ${accent.text}`}>
          <span aria-hidden="true" className={`h-3 w-[3px] shrink-0 rounded-[1px] ${accent.bar}`} />
          {SERVICE_SOURCE_LABEL[service.source] || service.source}
        </span>
      </td>
      <td className="px-4 py-3 text-right align-middle">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onOpen(service);
          }}
          className="group inline-flex items-center gap-1.5 text-[13px] font-semibold text-brand-blue transition-colors hover:text-brand-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/30"
        >
          {actionLabel}
          <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
        </button>
      </td>
    </tr>
  );
}

/** One compact mobile block. */
function ServiceBlock({ service, count, onOpen }) {
  const Icon = service.icon;
  const accent = SOURCE_ACCENT[service.source] || SOURCE_ACCENT.m1;
  const records = count == null ? "—" : count;
  const countLabel = count == null ? "indicators" : (Number(count) === 1 ? "indicator" : "indicators");
  const actionLabel = "View M1";

  return (
    <div
      role="link"
      tabIndex={0}
      onClick={() => onOpen(service)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(service);
        }
      }}
      aria-label={`Open ${service.name}`}
      className="flex items-start justify-between gap-3 border-b border-brand-border px-4 py-3 last:border-b-0 transition-colors hover:bg-brand-bg/40 focus-visible:bg-brand-bg/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/30"
    >
      <div className="flex min-w-0 items-start gap-3">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[3px] bg-brand-bg text-brand-gray">
          <Icon className="h-3.5 w-3.5" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <p className="text-[15px] font-semibold leading-tight text-brand-ink">{service.name}</p>
          <p className="mt-0.5 truncate text-xs leading-snug text-brand-gray">{service.description}</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
            <span className="text-brand-gray">
              Records: <span className="font-stat font-bold tabular-nums text-brand-ink">{records}</span>{" "}
              <span className="text-[11px] uppercase tracking-wide">{countLabel}</span>
            </span>
            <span className={`inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide ${accent.text}`}>
              <span aria-hidden="true" className={`h-3 w-[3px] shrink-0 rounded-[1px] ${accent.bar}`} />
              {SERVICE_SOURCE_LABEL[service.source] || service.source}
            </span>
          </div>
        </div>
      </div>
      <span className="inline-flex shrink-0 items-center gap-1 text-[13px] font-semibold text-brand-blue">
        {actionLabel}
        <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
      </span>
    </div>
  );
}

/**
 * @param {{
 *   periodLabel: string,
 *   countsBySection: Record<string, number|null>,
 *   countsLoading: boolean,
 *   countsError: string|null,
 *   onRetryCounts: () => void,
 *   onOpenService: (svc: object) => void,
 * }} props
 */
export default function HealthServicesSummary(props) {
  const {
    periodLabel,
    countsBySection,
    countsLoading,
    countsError,
    onRetryCounts,
    onOpenService,
  } = props;

  const rows = HEALTH_SERVICES.map((svc) => {
    const count = countsBySection[svc.key] ?? null;
    return { service: svc, count };
  });

  // Dynamic status-bar values (all real, none hardcoded).
  const totalReportedIndicators = rows.reduce(
    (sum, r) => sum + (r.count == null ? 0 : r.count),
    0,
  );
  const operationalSources = HEALTH_SERVICES.filter(
    (s) => s.source === "operational",
  ).length;
  const servicesWithRecords = rows.filter((r) => r.count > 0).length;
  const allZero =
    !rows.some((r) => r.count == null) && totalReportedIndicators === 0;

  const stats = [
    { value: HEALTH_SERVICES.length, label: "Health services", strong: true, accent: true },
    { value: countsLoading ? "—" : totalReportedIndicators, label: "Reported indicators", strong: true },
    { value: operationalSources, label: "Operational sources", strong: true },
    { value: countsLoading ? "—" : servicesWithRecords, label: "With reported values", strong: true },
  ];

  return (
    <section className="mt-6 overflow-hidden rounded-btn border border-brand-border bg-white">
      {/* Header: the parent M1 workspace owns the reporting-period selector. */}
      <div className="flex flex-wrap items-center justify-between gap-x-8 gap-y-3 border-b border-brand-border px-5 py-4">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold leading-tight text-brand-ink">Health Services</h2>
          <p className="mt-0.5 text-[13px] text-brand-gray">Manage service records and M1 reporting data</p>
        </div>
        <span className="text-xs text-brand-gray">Selected period: <strong className="text-brand-ink">{periodLabel}</strong></span>
      </div>

      {/* M1 reporting note (subtle, uses the selected period). */}
      <div className="flex items-start gap-2.5 border-b border-brand-border bg-brand-bg/50 px-5 py-2.5">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-blue" aria-hidden="true" />
        <p className="text-xs leading-relaxed text-brand-gray">
          <span className="font-semibold text-brand-ink">M1 reporting.</span> Operational records are automatically
          consolidated into the M1 report for <span className="font-medium text-brand-ink">{periodLabel}</span>.
        </p>
      </div>

      {/* Reporting-period summary / status bar */}
      <div className="flex flex-wrap items-stretch border-b border-brand-border">
        {stats.map((stat, i) => (
          <div
            key={i}
            className="flex min-w-[9.5rem] flex-1 flex-col justify-center gap-1 border-r border-brand-border px-5 py-3 last:border-r-0"
          >
            <p
              className={`font-stat text-lg font-bold leading-none tabular-nums ${
                stat.strong ? (stat.accent ? "text-brand-blue" : "text-brand-ink") : "text-brand-ink"
              }`}
            >
              {stat.value}
            </p>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-brand-gray">{stat.label}</p>
          </div>
        ))}
      </div>

      {/* Service Summary section header */}
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 px-5 pb-2 pt-4">
        <div>
          <h3 className="text-[13px] font-semibold uppercase tracking-wide text-brand-ink">Service Summary</h3>
          <p className="mt-1 text-xs text-brand-gray">
            {periodLabel} reporting period · Overview of health-service activity and the source used for M1 reporting.
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs">
          {countsLoading ? (
            <span className="text-brand-gray">Updating…</span>
          ) : countsError ? (
            <button
              type="button"
              onClick={onRetryCounts}
              className="inline-flex items-center gap-1 font-medium text-brand-blue hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/30"
            >
              <RefreshCw className="h-3 w-3" aria-hidden="true" /> Retry
            </button>
          ) : (
            <span className="text-brand-gray">{HEALTH_SERVICES.length} services listed</span>
          )}
        </div>
      </div>

      {countsError && (
        <div className="mx-5 mt-2 rounded-[3px] bg-brand-danger/5 px-3.5 py-2.5 text-xs text-brand-danger">
          Unable to load record counts.{" "}
          <button
            type="button"
            onClick={onRetryCounts}
            className="font-semibold underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-danger/30"
          >
            Try again
          </button>
        </div>
      )}

      {/* Desktop table */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-brand-bg/50 text-left">
              <th className="px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-brand-gray">Service</th>
              <th className="px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-brand-gray">Description</th>
              <th className="px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-brand-gray">Reported indicators</th>
              <th className="px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-brand-gray">Reporting source</th>
              <th className="px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-brand-gray">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-brand-border">
            {countsLoading && !countsError
              ? Array.from({ length: HEALTH_SERVICES.length }).map((_, i) => (
                  <tr key={i}>
                    <td colSpan={5} className="px-0 py-0">
                      <SummaryRowSkeleton />
                    </td>
                  </tr>
                ))
              : rows.map(({ service, count }) => (
                  <ServiceRow
                    key={service.key}
                    service={service}
                    count={count}
                    onOpen={onOpenService}
                  />
                ))}
          </tbody>
        </table>
      </div>

      {/* Mobile structured blocks */}
      <div className="md:hidden">
        {countsLoading && !countsError
          ? Array.from({ length: HEALTH_SERVICES.length }).map((_, i) => (
              <div key={i} className="border-b border-brand-border px-0 py-0 last:border-b-0">
                <SummaryRowSkeleton />
              </div>
            ))
          : rows.map(({ service, count }) => (
              <ServiceBlock
                key={service.key}
                service={service}
                count={count}
                onOpen={onOpenService}
              />
            ))}
      </div>

      {/* Empty state — keep the whole list visible, add a subtle note. */}
      {allZero && !countsLoading && !countsError && (
        <p className="border-t border-brand-border px-5 py-3 text-center text-xs text-brand-gray">
          No service records have been recorded for this reporting period yet.
        </p>
      )}
    </section>
  );
}