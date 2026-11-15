import React, { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { Card } from "@/components/common/Card";
import ErrorState from "@/components/common/ErrorState";
import { SkeletonTable } from "@/components/system/Skeleton";
import M1DrilldownDialog from "@/features/health-records/components/M1DrilldownDialog";
import M1DataEntryModal from "@/features/health-records/components/M1DataEntryModal";
import M1IndicatorTable from "@/features/health-records/components/M1IndicatorTable";
import M1PageHeader from "@/features/health-records/components/M1PageHeader";
import M1ReportingPeriod from "@/features/health-records/components/M1ReportingPeriod";
import TclEmptyState from "@/features/health-records/components/TclEmptyState";
import TclTabs from "@/features/health-records/components/TclTabs";
import {
  PERIOD_TYPES,
  periodLabel as makePeriodLabel,
  quarterOfMonth0,
  reportingYearOptions,
  toReportParams,
} from "@/features/health-records/lib/reportingPeriod";
import { useAuth } from "@/context/AuthContext";
import { isHealthSupervisor, getSupervisorScope } from "@/lib/supervisorScope";
import { m1Api } from "@/services/api";

const SECTION_TITLES = {
  A: "Family Planning Services",
  B: "Maternal Care and Services",
  C: "Child Care, Immunization and Nutrition",
  D: "Oral Care and Services",
  E: "Infectious Disease Prevention and Control",
  F: "Non-Communicable Disease Prevention and Control",
  G: "Environmental Health and Sanitation",
  H: "Mortality and Natality",
};
const validYear = (value, fallback) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 2000 && parsed <= 2100 ? parsed : fallback;
};

export default function M1SectionDetail() {
  const route = useParams();
  const section = String(route.section || "").toUpperCase();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuth();
  const now = new Date();
  const [period, setPeriod] = useState(() => PERIOD_TYPES.includes(searchParams.get("period")) ? searchParams.get("period") : "monthly");
  const [year, setYear] = useState(() => validYear(searchParams.get("year"), now.getFullYear()));
  const [month, setMonth] = useState(() => {
    const value = Number(searchParams.get("month"));
    return Number.isInteger(value) && value >= 1 && value <= 12 ? value - 1 : now.getMonth();
  });
  const [quarter, setQuarter] = useState(() => {
    const value = Number(searchParams.get("quarter"));
    return Number.isInteger(value) && value >= 1 && value <= 4 ? value : quarterOfMonth0(now.getMonth());
  });
  const [rows, setRows] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [retry, setRetry] = useState(0);
  const [activeTab, setActiveTab] = useState(null);
  const [selectedIndicator, setSelectedIndicator] = useState(null);
  const [drilldown, setDrilldown] = useState(null);
  const [drilldownError, setDrilldownError] = useState(null);
  const [drillRetry, setDrillRetry] = useState(0);
  const [entryOpen, setEntryOpen] = useState(false);
  const descriptor = useMemo(() => ({ period, year, month, quarter }), [period, year, month, quarter]);
  const periodLabel = makePeriodLabel(descriptor);
  const years = useMemo(() => reportingYearOptions(year), [year]);
  const scope = isHealthSupervisor(user) ? getSupervisorScope(user) : null;
  const assignedBarangay = scope?.level === "barangay" ? scope.assignedBarangay : user?.barangay;

  const syncQuery = (next) => {
    const params = toReportParams({ ...descriptor, ...next });
    const updated = new URLSearchParams(searchParams);
    updated.set("period", params.period);
    updated.set("year", String(params.year));
    if (params.period === "monthly") updated.set("month", String(params.month));
    else updated.delete("month");
    if (params.period === "quarterly") updated.set("quarter", String(params.quarter));
    else updated.delete("quarter");
    setSearchParams(updated, { replace: true });
  };
  const changePeriod = (value) => { setPeriod(value); syncQuery({ period: value }); };
  const changeYear = (value) => { setYear(value); syncQuery({ year: value }); };
  const changeMonth = (value) => { setMonth(value); syncQuery({ month: value }); };
  const changeQuarter = (value) => { setQuarter(value); syncQuery({ quarter: value }); };

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    setRows(null);
    setSelectedIndicator(null);
    if (!Object.hasOwn(SECTION_TITLES, section)) {
      setError("The requested FHSIS section is invalid.");
      setLoading(false);
      return () => { active = false; };
    }
    m1Api.report(toReportParams(descriptor))
      .then((response) => {
        if (!response?.byCode || typeof response.byCode !== "object") throw new Error("Invalid M1 report response.");
        const sectionRows = Object.values(response.byCode).filter((row) => row.section === section);
        if (sectionRows.some((row) => typeof row.name !== "string" || !Number.isFinite(row.total))) throw new Error("Section indicator definitions are incomplete.");
        if (active) setRows(sectionRows);
      })
      .catch((loadError) => { if (active) setError(loadError?.message || "Unable to load section data."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [section, descriptor, retry, user?.id]);

  useEffect(() => {
    if (!selectedIndicator) return undefined;
    let active = true;
    setDrilldown(null);
    setDrilldownError(null);
    m1Api.drilldown(selectedIndicator.code, toReportParams(descriptor))
      .then((response) => {
        if (!Array.isArray(response?.records)) throw new Error("Invalid underlying-record response.");
        if (active) setDrilldown(response.records);
      })
      .catch((loadError) => { if (active) setDrilldownError(loadError?.message || "Unable to load underlying records."); });
    return () => { active = false; };
  }, [selectedIndicator, descriptor, drillRetry]);

  const subsections = [...new Set((rows || []).map((row) => row.subsection).filter(Boolean))];
  const tabs = subsections.map((value) => ({ value, label: value }));
  const selectedTab = tabs.find((tab) => tab.value === activeTab) || tabs[0];
  const visibleRows = selectedTab ? (rows || []).filter((row) => row.subsection === selectedTab.value) : [];
  const overviewParams = new URLSearchParams(toReportParams(descriptor)).toString();
  const overviewTo = `/app/health_supervisor/m1-fhsis?${overviewParams}`;

  return (
    <div className="min-w-0">
      <M1PageHeader
        title={SECTION_TITLES[section] || "FHSIS Section"}
        subtitle={`Section ${section || "Unknown"} · ${periodLabel}${assignedBarangay ? ` · Brgy. ${assignedBarangay}` : ""}`}
        crumb={`Section ${section || "Unknown"}`}
        backTo={overviewTo}
        backLabel="Back to Consolidated Report"
      />
      <M1ReportingPeriod period={period} year={year} month={month} quarter={quarter} years={years} onPeriodChange={changePeriod} onYearChange={changeYear} onMonthChange={changeMonth} onQuarterChange={changeQuarter} />
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-base font-semibold text-brand-ink">Section {section} Indicators</h2><p className="mt-0.5 text-xs text-brand-gray">{periodLabel}</p></div>{period === "monthly" && <button type="button" onClick={() => setEntryOpen(true)} className="ui-tcl-control ui-tcl-control-primary">Enter Reporting Figures</button>}</div>
      {loading ? <SkeletonTable rows={8} cols={4} className="ui-tcl-data-table" />
        : error ? <Card><ErrorState title="Unable to load FHSIS section" message={error} onRetry={() => setRetry((value) => value + 1)} /></Card>
          : !rows?.length ? <TclEmptyState compact title="No section indicators" description={`No indicators are available for Section ${section} in ${periodLabel}.`} />
            : <>
              {tabs.length > 1 && <TclTabs tabs={tabs} active={selectedTab.value} onChange={setActiveTab} label={`Section ${section} categories`} className="flex-nowrap overflow-x-auto rounded-t-card bg-brand-bg/70 px-1 pt-1" idPrefix={`m1-section-${section}`} panelId="m1-section-panel" />}
              <section id="m1-section-panel" role="tabpanel" aria-labelledby={tabs.length > 1 ? `m1-section-${section}-${tabs.indexOf(selectedTab)}` : undefined} tabIndex={0}>
                <div className="mb-2 flex items-center justify-between gap-3"><h2 className="text-sm font-semibold text-brand-ink">{selectedTab?.label || SECTION_TITLES[section]}</h2><span className="text-xs text-brand-gray">{visibleRows.length} indicators</span></div>
                <M1IndicatorTable rows={visibleRows} onView={setSelectedIndicator} />
              </section>
            </>}
      <M1DrilldownDialog indicator={selectedIndicator} periodLabel={periodLabel} records={drilldown} error={drilldownError} onRetry={() => setDrillRetry((value) => value + 1)} onClose={() => setSelectedIndicator(null)} />
      {entryOpen && <M1DataEntryModal initialSection={section} initialYear={year} initialMonth={month + 1} onClose={() => setEntryOpen(false)} onSaved={() => setRetry((value) => value + 1)} />}
    </div>
  );
}
