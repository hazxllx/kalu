import React from "react";
import TclTabs from "./TclTabs";
import { MONTH_LABELS, PERIOD_TYPES, QUARTERS, QUARTER_RANGE_LABEL, periodLabel as formatPeriodLabel } from "../lib/reportingPeriod";

const PERIOD_TABS = PERIOD_TYPES.map((value) => ({ value, label: value[0].toUpperCase() + value.slice(1) }));

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
  const controlClass = variant === "header" ? "hs-control" : "ui-tcl-control ui-tcl-control-secondary";
  const selectors = (
    <>
      {variant === "header" && (
        <select aria-label="Reporting period" className={controlClass} value={period} onChange={(event) => onPeriodChange(event.target.value)}>
          {PERIOD_TABS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
        </select>
      )}
      <select aria-label="Reporting year" className={controlClass} value={year} onChange={(event) => onYearChange(Number(event.target.value))}>
        {years.map((item) => <option key={item} value={item}>{item}</option>)}
      </select>
      {period === "monthly" && (
        <select aria-label="Reporting month" className={controlClass} value={month} onChange={(event) => onMonthChange(Number(event.target.value))}>
          {MONTH_LABELS.map((item, index) => <option key={item} value={index}>{item}</option>)}
        </select>
      )}
      {period === "quarterly" && (
        <select aria-label="Reporting quarter" className={controlClass} value={quarter} onChange={(event) => onQuarterChange(Number(event.target.value))}>
          {QUARTERS.map((item) => <option key={item} value={item}>Q{item} · {QUARTER_RANGE_LABEL[item]}</option>)}
        </select>
      )}
    </>
  );

  if (variant === "header") {
    return (
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="M1 reporting period controls">
        {selectors}
        <span className="whitespace-nowrap text-[10px] font-semibold uppercase tracking-gov text-white/70">{label}</span>
      </div>
    );
  }

  return (
    <section className="mb-3 rounded-card border border-brand-border border-t-2 border-t-brand-rule bg-brand-bg/70 px-3 py-2.5" aria-label="Reporting period">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between">
        <TclTabs
          tabs={PERIOD_TABS}
          active={period}
          onChange={onPeriodChange}
          label="Reporting period"
          className="!mb-0 shrink-0 flex-nowrap overflow-x-auto rounded-t-card bg-brand-light/50 px-1 pt-1"
          idPrefix="m1-reporting-period"
        />
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Reporting date controls">
          {selectors}
          <span className="inline-flex min-h-11 items-center rounded-btn border border-brand-blue/15 bg-brand-light px-3 text-xs font-semibold text-brand-blue">{label}</span>
        </div>
      </div>
    </section>
  );
}
