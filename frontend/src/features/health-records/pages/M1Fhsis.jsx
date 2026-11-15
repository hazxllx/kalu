import React, { useEffect, useMemo, useState } from "react";
import { Download } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { Card } from "@/components/common/Card";
import ErrorState from "@/components/common/ErrorState";
import StatusBadge from "@/components/common/StatusBadge";
import DataTable from "@/components/tables/DataTable";
import TablePagination from "@/components/tables/TablePagination";
import { SkeletonTable } from "@/components/system/Skeleton";
import M1DrilldownDialog from "@/features/health-records/components/M1DrilldownDialog";
import M1IndicatorTable from "@/features/health-records/components/M1IndicatorTable";
import { useM1OfficialPrint } from "@/features/health-records/components/M1OfficialForm";
import M1PageHeader from "@/features/health-records/components/M1PageHeader";
import M1ReportingPeriod from "@/features/health-records/components/M1ReportingPeriod";
import TclTabs from "@/features/health-records/components/TclTabs";
import TclEmptyState from "@/features/health-records/components/TclEmptyState";
import { TclToolbar } from "@/features/health-records/components/TclToolbar";
import { HEALTH_SERVICE_TITLES } from "@/features/health-records/lib/healthServicesConfig";
import {
  PERIOD_TYPES,
  fhsisPeriodLabel,
  periodLabel as makePeriodLabel,
  quarterOfMonth0,
  reportingYearOptions,
  toReportParams,
} from "@/features/health-records/lib/reportingPeriod";
import { useAuth } from "@/context/AuthContext";
import { isHealthSupervisor, getSupervisorScope } from "@/lib/supervisorScope";
import { m1Api } from "@/services/api";

const PAGE_SIZE = 20;
const validYear = (value, fallback) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 2000 && parsed <= 2100 ? parsed : fallback;
};
const validMonth = (value, fallback) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 12 ? parsed - 1 : fallback;
};
const validQuarter = (value, fallback) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 4 ? parsed : fallback;
};

export default function M1Fhsis() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const now = new Date();
  const [period, setPeriod] = useState(() => PERIOD_TYPES.includes(searchParams.get("period")) ? searchParams.get("period") : "monthly");
  const [year, setYear] = useState(() => validYear(searchParams.get("year"), now.getFullYear()));
  const [month, setMonth] = useState(() => validMonth(searchParams.get("month"), now.getMonth()));
  const [quarter, setQuarter] = useState(() => validQuarter(searchParams.get("quarter"), quarterOfMonth0(now.getMonth())));
  const initialDate = searchParams.get("date");
  const [dailyDate, setDailyDate] = useState(() => /^\d{4}-\d{2}-\d{2}$/.test(initialDate || "")
    ? initialDate
    : year === now.getFullYear() && month === now.getMonth() ? now.toISOString().slice(0, 10) : `${year}-${String(month + 1).padStart(2, "0")}-01`);
  const [report, setReport] = useState(null);
  const [dailyRows, setDailyRows] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [retry, setRetry] = useState(0);
  const [activeTab, setActiveTab] = useState(null);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);
  const [selectedIndicator, setSelectedIndicator] = useState(null);
  const [drilldown, setDrilldown] = useState(null);
  const [drilldownError, setDrilldownError] = useState(null);
  const [drillRetry, setDrillRetry] = useState(0);
  const [printing, setPrinting] = useState(false);
  const { startPrint, portal, brandingError } = useM1OfficialPrint();
  const scope = isHealthSupervisor(user) ? getSupervisorScope(user) : null;
  const assignedBarangay = scope?.level === "barangay" ? scope.assignedBarangay : null;
  const descriptor = useMemo(() => ({ period, year, month, quarter }), [period, year, month, quarter]);
  const periodLabel = makePeriodLabel(descriptor);
  const years = useMemo(() => reportingYearOptions(year), [year]);

  const syncQuery = (next) => {
    const params = toReportParams({ ...descriptor, ...next });
    const updated = new URLSearchParams(searchParams);
    updated.set("period", params.period);
    updated.set("year", String(params.year));
    if (params.period === "monthly") updated.set("month", String(params.month));
    else updated.delete("month");
    if (params.period === "quarterly") updated.set("quarter", String(params.quarter));
    else updated.delete("quarter");
    if (params.period === "monthly") updated.set("date", next.dailyDate || dailyDate);
    else updated.delete("date");
    setSearchParams(updated, { replace: true });
  };
  const changePeriod = (value) => {
    setPeriod(value);
    const nextDate = !dailyDate.startsWith(`${year}-${String(month + 1).padStart(2, "0")}`) ? `${year}-${String(month + 1).padStart(2, "0")}-01` : dailyDate;
    if (value === "monthly") setDailyDate(nextDate);
    syncQuery({ period: value, dailyDate: nextDate });
  };
  const changeYear = (value) => {
    setYear(value);
    const nextDate = `${value}-${String(month + 1).padStart(2, "0")}-01`;
    if (period === "monthly") setDailyDate(nextDate);
    syncQuery({ year: value, dailyDate: nextDate });
  };
  const changeMonth = (value) => {
    setMonth(value);
    const monthPrefix = `${year}-${String(value + 1).padStart(2, "0")}`;
    const nextDate = dailyDate.startsWith(monthPrefix) ? dailyDate : `${monthPrefix}-01`;
    setDailyDate(nextDate);
    syncQuery({ month: value, dailyDate: nextDate });
  };
  const changeQuarter = (value) => { setQuarter(value); syncQuery({ quarter: value }); };
  const changeDailyDate = (value) => {
    setDailyDate(value);
    const updated = new URLSearchParams(searchParams);
    updated.set("date", value);
    setSearchParams(updated, { replace: true });
  };

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    setReport(null);
    setDailyRows(null);
    setSelectedIndicator(null);
    Promise.all([
      m1Api.report(toReportParams(descriptor)),
      period === "monthly" ? m1Api.daily(dailyDate) : Promise.resolve({ participants: [] }),
    ])
      .then(([reportResult, dailyResult]) => {
        if (!reportResult?.byCode || typeof reportResult.byCode !== "object" || !Array.isArray(dailyResult?.participants)) {
          throw new Error("Invalid M1 report response. Please try again.");
        }
        if (!active) return;
        setReport(reportResult);
        setDailyRows(dailyResult.participants);
      })
      .catch((loadError) => { if (active) setError(loadError?.message || "Unable to load the M1 report."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [descriptor, period, dailyDate, retry, user?.id]);

  useEffect(() => {
    if (!selectedIndicator) return undefined;
    let active = true;
    setDrilldown(null);
    setDrilldownError(null);
    m1Api.drilldown(selectedIndicator.code, toReportParams(descriptor))
      .then((result) => {
        if (!Array.isArray(result?.records)) throw new Error("Invalid underlying-record response.");
        if (active) setDrilldown(result.records);
      })
      .catch((loadError) => { if (active) setDrilldownError(loadError?.message || "Unable to load underlying records."); });
    return () => { active = false; };
  }, [selectedIndicator, descriptor, drillRetry]);

  useEffect(() => { setPage(1); }, [activeTab, search, pageSize, dailyRows]);

  const indicatorRows = Object.values(report?.byCode || {});
  const sections = [...new Set(indicatorRows.map((row) => row.section).filter(Boolean))];
  const tabs = [
    ...(period === "monthly" ? [{ value: "daily", label: "Daily Activity" }] : []),
    ...sections.map((section) => ({ value: section, label: `${section}. ${HEALTH_SERVICE_TITLES[section] || "Health Services"}` })),
  ];
  const selectedTab = tabs.find((tab) => tab.value === activeTab) || tabs[0];
  const sectionRows = selectedTab?.value === "daily" ? [] : indicatorRows.filter((row) => row.section === selectedTab?.value);
  const filteredDailyRows = (dailyRows || []).filter((row) => {
    const query = search.trim().toLowerCase();
    const resident = Array.isArray(row.resident) ? row.resident[0] : row.resident;
    return !query || [resident?.first_name, resident?.last_name, row.indicator, row.indicatorCode, row.status]
      .some((value) => String(value || "").toLowerCase().includes(query));
  }).map((row) => {
    const resident = Array.isArray(row.resident) ? row.resident[0] : row.resident;
    return { ...row, residentName: [resident?.first_name, resident?.middle_name, resident?.last_name].filter(Boolean).join(" ") || "Not recorded" };
  });
  const totalPages = Math.max(1, Math.ceil(filteredDailyRows.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pagedDailyRows = filteredDailyRows.slice((safePage - 1) * pageSize, safePage * pageSize);
  const activeIndicators = indicatorRows.filter((row) => Number(row.total) > 0).length;
  const sectionQuery = new URLSearchParams(toReportParams(descriptor)).toString();
  const dailyDateMin = `${year}-${String(month + 1).padStart(2, "0")}-01`;
  const dailyDateMax = `${year}-${String(month + 1).padStart(2, "0")}-${String(new Date(year, month + 1, 0).getDate()).padStart(2, "0")}`;

  const printReport = async () => {
    if (printing) return;
    setPrinting(true);
    try {
      const [freshReport, metaData] = await Promise.all([
        m1Api.report(toReportParams(descriptor)),
        m1Api.getMeta({ year, month: period === "monthly" ? month + 1 : period === "quarterly" ? (quarter - 1) * 3 + 1 : 1 }).catch(() => null),
      ]);
      await startPrint({
        data: freshReport?.byCode || {},
        header: {
          periodLabel: fhsisPeriodLabel(descriptor), year,
          municipality: metaData?.municipality || "", province: metaData?.province || "",
          projectedPopulation: metaData?.meta?.projected_population ?? "",
          barangay: metaData?.barangay?.name || assignedBarangay || "",
          preparedBy: metaData?.meta?.prepared_by || "",
        },
      });
    } catch (printError) {
      setError(printError?.message || "Unable to prepare the official M1 report.");
    } finally {
      setPrinting(false);
    }
  };

  return (
    <div className="min-w-0">
      <M1PageHeader
        title="Consolidated FHSIS Form M1"
        subtitle="Review municipal health-service indicators and case-level activity by reporting period."
        crumb="Consolidated Report"
      />
      <M1ReportingPeriod
        period={period}
        year={year}
        month={month}
        quarter={quarter}
        years={years}
        onPeriodChange={changePeriod}
        onYearChange={changeYear}
        onMonthChange={changeMonth}
        onQuarterChange={changeQuarter}
      />
      {brandingError && <Card role="alert" className="mb-4 p-3 text-sm text-brand-danger">{brandingError}</Card>}

      {loading ? <SkeletonTable rows={8} cols={4} className="ui-tcl-data-table" />
        : error ? <Card><ErrorState title="Unable to load the M1 report" message={error} onRetry={() => setRetry((value) => value + 1)} /></Card>
          : indicatorRows.length === 0 ? <TclEmptyState compact title="No M1 indicators" description={`No reporting data is available for ${periodLabel}.`} />
            : <>
              {/* Slim inline KPI summary strip — no cards, just text with separators */}
              <div className="mb-0 flex flex-wrap items-center gap-x-1 border-b border-[#DDE3EC] py-2 text-[12px] text-[#4B5A6E]">
                <span className="font-mono font-semibold tabular-nums text-[#1A3A5C]">{indicatorRows.length}</span>
                <span className="text-[#9AA5B4]">indicators</span>
                <span className="mx-1.5 text-[#DDE3EC]">·</span>
                <span className="font-mono font-semibold tabular-nums text-[#1A3A5C]">{activeIndicators}</span>
                <span className="text-[#9AA5B4]">with values</span>
                <span className="mx-1.5 text-[#DDE3EC]">·</span>
                <span className="font-mono font-semibold tabular-nums text-[#1A3A5C]">{sections.length}</span>
                <span className="text-[#9AA5B4]">sections</span>
                <span className="mx-1.5 text-[#DDE3EC]">·</span>
                <span className="text-[#4B5A6E]">{periodLabel}</span>
              </div>

              {/* Tab nav + Print button — same line */}
              <div className="flex items-center justify-between gap-2 border-b border-brand-border bg-brand-bg/70 px-2 py-1">
                <TclTabs
                  tabs={tabs}
                  active={selectedTab?.value}
                  onChange={setActiveTab}
                  label="FHSIS report sections"
                  className="!mb-0 !border-b-0 gap-1 flex-nowrap overflow-x-auto"
                  idPrefix="fhsis-sections"
                />
                <button
                  type="button"
                  onClick={printReport}
                  disabled={printing || loading || Boolean(error)}
                  className="mr-2 flex shrink-0 items-center gap-1.5 rounded-sm border border-[#DDE3EC] bg-white px-2.5 py-1 text-[11px] font-semibold text-[#1A3A5C] transition-colors hover:border-[#1A3A5C] disabled:opacity-50"
                >
                  <Download className="h-3.5 w-3.5" />
                  {printing ? "Preparing…" : "Print"}
                </button>
              </div>

              {/* Content panel — no white card wrapper, just border-t */}
              <div className="pt-3">
                {selectedTab?.value === "daily" ? (
                  <>
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
                      <span className="text-[11px] font-semibold uppercase tracking-widest text-[#6B7A8F]">
                        Daily Health-Service Activity
                        <span className="ml-2 font-mono font-normal normal-case tabular-nums text-[#9AA5B4]">{filteredDailyRows.length} records</span>
                      </span>
                      <label className="flex items-center gap-2 text-[11px] font-medium text-[#6B7A8F]">
                        Date
                        <input
                          type="date"
                          min={dailyDateMin}
                          max={dailyDateMax}
                          value={dailyDate}
                          onChange={(event) => changeDailyDate(event.target.value)}
                          className="ui-tcl-control ui-tcl-control-secondary"
                        />
                      </label>
                    </div>
                    <TclToolbar onSearch={setSearch} searchValue={search} showFilter={false} showExport={false} showRefresh={false} />
                    {filteredDailyRows.length === 0
                      ? <TclEmptyState compact type={search ? "search" : "empty"} title="No daily activity" description={`No M1 activity records were found for ${dailyDate}.`} />
                      : <>
                        <DataTable
                          rows={pagedDailyRows}
                          dense
                          compact
                          striped
                          mobileCards
                          stickyHeader
                          maxHeight="clamp(20rem, calc(100dvh - 18rem), 60vh)"
                          className="ui-tcl-data-table !rounded-sm !shadow-none border border-[#DDE3EC]"
                          tableClassName="min-w-[56rem]"
                          columns={[
                            { key: "date", label: "Date" },
                            { key: "residentName", label: "Resident", wrap: true },
                            { key: "section", label: "Section" },
                            { key: "indicatorCode", label: "Code", render: (row) => row.indicatorCode || "—" },
                            { key: "indicator", label: "Service / Indicator", wrap: true },
                            { key: "status", label: "Status", render: (row) => row.status ? <StatusBadge value={row.status} /> : "—" },
                          ]}
                        />
                        {filteredDailyRows.length > pageSize && (
                          <TablePagination
                            total={filteredDailyRows.length}
                            page={safePage}
                            pageSize={pageSize}
                            onPageChange={setPage}
                            onPageSizeChange={(value) => { setPageSize(value); setPage(1); }}
                            className="mt-3"
                          />
                        )}
                      </>
                    }
                  </>
                ) : (
                  <>
                    <div className="mb-2 flex items-baseline justify-between gap-4">
                      <span className="text-[11px] font-semibold uppercase tracking-widest text-[#6B7A8F]">
                        {selectedTab?.label}
                        <span className="ml-2 font-mono font-normal normal-case tabular-nums text-[#9AA5B4]">
                          {sectionRows.length} indicator{sectionRows.length !== 1 ? "s" : ""}
                        </span>
                      </span>
                      <Link
                        to={`/app/health_supervisor/m1-section/${selectedTab?.value}?${sectionQuery}`}
                        className="ui-tcl-control ui-tcl-control-secondary !min-h-8 !px-2.5 !text-xs"
                      >
                        Details
                      </Link>
                    </div>
                    <M1IndicatorTable rows={sectionRows} onView={setSelectedIndicator} />
                  </>
                )}
              </div>
            </>}
      <M1DrilldownDialog
        indicator={selectedIndicator}
        periodLabel={periodLabel}
        records={drilldown}
        error={drilldownError}
        onRetry={() => setDrillRetry((value) => value + 1)}
        onClose={() => setSelectedIndicator(null)}
      />
      {portal}
    </div>
  );
}
