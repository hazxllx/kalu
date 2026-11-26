// frontend/src/features/health-records/components/M1ReportingPeriod.jsx
import React from "react";
import { Calendar } from "lucide-react";
import TclTabs from "./TclTabs";
import {
  MONTH_LABELS,
  PERIOD_TYPES,
  QUARTERS,
  QUARTER_RANGE_LABEL,
  periodLabel as formatPeriodLabel,
} from "../lib/reportingPeriod";

const PERIOD_TABS = PERIOD_TYPES.map((value) => ({
  value,
  label: value[0].toUpperCase() + value.slice(1),
}));

// Renders or manages M1ReportingPeriod logic.
export default function M1ReportingPeriod({
  period,
  year,
  month,
  quarter,
  years,
  onPeriodChange,
  onYearChange,
  onMonthChange,
  onQuarterChange,
  variant = "detail",
}) {
  const label = formatPeriodLabel({ period, year, month, quarter });
  const controlClass =
    variant === "header"
      ? "hs-control"
      : variant === "directory"
        ? "h-9 rounded-btn border border-brand-border bg-white px-2.5 text-xs font-medium text-brand-ink outline-none hover:border-brand-blue/50 focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/15 dark:border-border dark:bg-card dark:text-foreground"
      : "rounded-md border border-brand-border bg-white px-2.5 py-1 text-xs font-medium text-brand-ink shadow-2xs hover:border-brand-blue/50 focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue cursor-pointer transition-colors";

  const selectors = (
    <>
      {(variant === "header" || variant === "directory") && (
        <select
          aria-label="Reporting period"
          className={controlClass}
          value={period}
          onChange={(event) => onPeriodChange(event.target.value)}
        >
          {PERIOD_TABS.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
      )}
      <select
        aria-label="Reporting year"
        className={controlClass}
        value={year}
        onChange={(event) => onYearChange(Number(event.target.value))}
      >
        {years.map((item) => (
          <option key={item} value={item}>
            {item}
          </option>
        ))}
      </select>
      {period === "monthly" && (
        <select
          aria-label="Reporting month"
          className={controlClass}
          value={month}
          onChange={(event) => onMonthChange(Number(event.target.value))}
        >
          {MONTH_LABELS.map((item, index) => (
            <option key={item} value={index}>
              {item}
            </option>
          ))}
        </select>
      )}
      {period === "quarterly" && (
        <select
          aria-label="Reporting quarter"
          className={controlClass}
          value={quarter}
          onChange={(event) => onQuarterChange(Number(event.target.value))}
        >
          {QUARTERS.map((item) => (
            <option key={item} value={item}>
              Q{item} · {QUARTER_RANGE_LABEL[item]}
            </option>
          ))}
        </select>
      )}
    </>
  );

  // Header variant: inline controls in page header area
  if (variant === "header") {
    return (
      <div
        className="flex flex-wrap items-center gap-2"
        role="group"
        aria-label="M1 reporting period controls"
      >
        {selectors}
        <span className="whitespace-nowrap text-[10px] font-semibold uppercase tracking-gov text-white/70">
          {label}
        </span>
      </div>
    );
  }

  if (variant === "directory") {
    return (
      <div
        className="flex min-w-0 flex-wrap items-center gap-2"
        role="group"
        aria-label="M1 reporting period controls"
      >
        <span className="mr-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-brand-gray dark:text-muted-foreground">
          Reporting period
        </span>
        {selectors}
      </div>
    );
  }

  // Detail variant: slim inline bar, border-b and border-t separator style
  return (
    <div
      className="mb-3.5 flex flex-wrap items-center justify-between gap-2.5 rounded-lg border-y border-t-brand-rule border-b-brand-rule bg-brand-bg/70 px-3.5 py-1.5 shadow-2xs"
      role="group"
      aria-label="Reporting period"
    >
      <div className="flex flex-wrap items-center gap-2.5">
        {/* Period type selector */}
        <TclTabs
          tabs={PERIOD_TABS}
          active={period}
          onChange={onPeriodChange}
          label="Reporting period type"
          className="!mb-0 !border-b-0 gap-1"
          idPrefix="period-type-tab"
        />

        {/* Divider */}
        <span className="hidden h-4 w-px bg-brand-border sm:inline-block" aria-hidden="true" />

        {/* Year / month / quarter selectors */}
        <div className="flex items-center gap-2">
          {selectors}
        </div>
      </div>

      {/* Period label badge */}
      <div className="inline-flex items-center gap-1.5 rounded-md border border-brand-border bg-white px-2.5 py-1 text-xs font-semibold text-brand-blue shadow-2xs">
        <Calendar className="h-3.5 w-3.5 text-brand-blue" aria-hidden="true" />
        <span>{label}</span>
      </div>
    </div>
  );
}
