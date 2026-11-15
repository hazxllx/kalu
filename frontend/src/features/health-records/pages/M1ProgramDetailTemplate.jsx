import React, { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Card } from "@/components/common/Card";
import ErrorState from "@/components/common/ErrorState";
import StatusBadge from "@/components/common/StatusBadge";
import DataTable from "@/components/tables/DataTable";
import TablePagination from "@/components/tables/TablePagination";
import { SkeletonTable } from "@/components/system/Skeleton";
import M1IndicatorTable from "@/features/health-records/components/M1IndicatorTable";
import M1DrilldownDialog from "@/features/health-records/components/M1DrilldownDialog";
import M1PageHeader from "@/features/health-records/components/M1PageHeader";
import M1ReportingPeriod from "@/features/health-records/components/M1ReportingPeriod";
import TclEmptyState from "@/features/health-records/components/TclEmptyState";
import TclTabs from "@/features/health-records/components/TclTabs";
import { TclToolbar } from "@/features/health-records/components/TclToolbar";
import { getProgram } from "@/features/health-records/lib/m1ProgramConfig";
import {
  PERIOD_TYPES,
  periodLabel as makePeriodLabel,
  quarterOfMonth0,
  reportingYearOptions,
  toReportParams,
} from "@/features/health-records/lib/reportingPeriod";
import { useAuth } from "@/context/AuthContext";
import { m1Api } from "@/services/api";

const PAGE_SIZE = 20;
const yearInRange = (value, fallback) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 2000 && parsed <= 2100 ? parsed : fallback;
};
const monthFromQuery = (value, fallback) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 12 ? parsed - 1 : fallback;
};
const quarterFromQuery = (value, fallback) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 4 ? parsed : fallback;
};

export function createM1ProgramDetailPage(programId, apiClients = {}) {
  return function M1ProgramDetail() {
    const { user } = useAuth();
    const program = getProgram(programId);
    const [searchParams, setSearchParams] = useSearchParams();
    const now = new Date();
    const initialPeriod = PERIOD_TYPES.includes(searchParams.get("period")) ? searchParams.get("period") : "monthly";
    const [period, setPeriod] = useState(initialPeriod);
    const [year, setYear] = useState(() => yearInRange(searchParams.get("year"), now.getFullYear()));
    const [month, setMonth] = useState(() => monthFromQuery(searchParams.get("month"), now.getMonth()));
    const [quarter, setQuarter] = useState(() => quarterFromQuery(searchParams.get("quarter"), quarterOfMonth0(now.getMonth())));
    const [indicatorData, setIndicatorData] = useState(null);
    const [records, setRecords] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [retry, setRetry] = useState(0);
    const [activeTab, setActiveTab] = useState(null);
    const [recordSearch, setRecordSearch] = useState("");
    const [recordStatus, setRecordStatus] = useState("");
    const [recordPage, setRecordPage] = useState(1);
    const [recordPageSize, setRecordPageSize] = useState(PAGE_SIZE);
    const [selectedIndicator, setSelectedIndicator] = useState(null);
    const [drilldown, setDrilldown] = useState(null);
    const [drilldownError, setDrilldownError] = useState(null);
    const [drillRetry, setDrillRetry] = useState(0);

    const syncPeriodQuery = (next) => {
      const descriptor = { period, year, month, quarter, ...next };
      const params = toReportParams(descriptor);
      const updated = new URLSearchParams(searchParams);
      updated.set("period", params.period);
      updated.set("year", String(params.year));
      if (params.period === "monthly") updated.set("month", String(params.month));
      else updated.delete("month");
      if (params.period === "quarterly") updated.set("quarter", String(params.quarter));
      else updated.delete("quarter");
      setSearchParams(updated, { replace: true });
    };
    const changePeriod = (value) => { setPeriod(value); syncPeriodQuery({ period: value }); };
    const changeYear = (value) => { setYear(value); syncPeriodQuery({ year: value }); };
    const changeMonth = (value) => { setMonth(value); syncPeriodQuery({ month: value }); };
    const changeQuarter = (value) => { setQuarter(value); syncPeriodQuery({ quarter: value }); };

    useEffect(() => {
      let active = true;
      setLoading(true);
      setError(null);
      setIndicatorData(null);
      setRecords([]);
      setSelectedIndicator(null);
      const load = async () => {
        try {
          if (!program) throw new Error("Program not found");
          const result = await apiClients.listRecords(toReportParams({ period, year, month, quarter }));
          if (result?.program !== programId || !Array.isArray(result.records)
            || !result.indicators || typeof result.indicators !== "object" || Array.isArray(result.indicators)) {
            throw new Error("Invalid program report response. Please try again.");
          }
          for (const [code, row] of Object.entries(result.indicators)) {
            // Validate response structure
            if (row?.code !== code) {
              throw new Error(`Invalid indicator response for ${code}: code mismatch`);
            }
            if (typeof row.name !== "string" || !row.name.trim() || /^Indicator\s+\S+$/i.test(row.name.trim())) {
              throw new Error(`Catalog definition unavailable for ${code}: missing or invalid name`);
            }
            if (typeof row.subsection !== "string" || !row.subsection.trim()) {
              throw new Error(`Catalog definition unavailable for ${code}: missing subsection`);
            }
            if (program.fhsisSection && !(program.catalogSections || [program.fhsisSection]).includes(row.section)) {
              throw new Error(`Catalog definition unavailable for ${code}: section ${row.section} not in program`);
            }
            if (!Number.isFinite(row.total)) {
              throw new Error(`Reporting value unavailable for ${code}: total is not a number`);
            }
            if (programId === "prenatal" && !program.subsections.some((item) => item.catalogSubsection === row.subsection)) {
              throw new Error(`Catalog definition unavailable for ${code}: subsection "${row.subsection}" does not match program configuration`);
            }
          }
          if (!active) return;
          setIndicatorData(result.indicators);
          setRecords(result.records);
        } catch (loadError) {
          if (active) setError(loadError?.message || "Unable to load program data");
        } finally {
          if (active) setLoading(false);
        }
      };
      load();
      return () => { active = false; };
    }, [period, year, month, quarter, program, user?.id, retry]);

    useEffect(() => {
      if (!selectedIndicator) return undefined;
      let active = true;
      setDrilldown(null);
      setDrilldownError(null);
      m1Api.drilldown(selectedIndicator.code, toReportParams({ period, year, month, quarter }))
        .then((result) => {
          if (!Array.isArray(result?.records)) throw new Error("Invalid underlying-record response");
          if (active) setDrilldown(result);
        })
        .catch((loadError) => { if (active) setDrilldownError(loadError?.message || "Unable to load underlying records"); });
      return () => { active = false; };
    }, [selectedIndicator, period, year, month, quarter, drillRetry]);

    useEffect(() => { setRecordPage(1); }, [recordSearch, recordStatus, records]);

    const descriptor = useMemo(() => ({ period, year, month, quarter }), [period, year, month, quarter]);
    const selectedPeriodLabel = makePeriodLabel(descriptor);
    const years = useMemo(() => reportingYearOptions(year), [year]);
    const rows = Object.values(indicatorData || {});
    const subsections = program?.subsections?.length && program.subsections.every((item) => item.catalogSubsection)
      ? program.subsections
      : [...new Set(rows.map((row) => row.subsection))].map((name) => ({ id: name, title: name, catalogSubsection: name }));
    const tabs = subsections.map((subsection) => ({ value: subsection.id, label: subsection.title, subsection }));
    const selectedTab = tabs.find((tab) => tab.value === activeTab) || tabs[0];
    const visibleRows = selectedTab ? rows.filter((row) => row.subsection === selectedTab.subsection.catalogSubsection) : [];
    const enrollmentStatuses = [...new Set(records.map((record) => record.status).filter(Boolean))];
    const enrollmentFilterOptions = [{ value: "", label: "All Status" }, ...enrollmentStatuses.map((value) => ({ value, label: value }))];
    const enrollmentRows = records.map((record) => {
      const resident = Array.isArray(record.resident) ? record.resident[0] : record.resident;
      return {
        ...record,
        residentName: [resident?.first_name, resident?.middle_name, resident?.last_name].filter(Boolean).join(" ") || record.resident_id || "Not recorded",
        programName: record.program || "Not recorded",
        registeredAt: record.created_at?.slice(0, 10) || "Not recorded",
        nextVisit: record.next_visit || "Not scheduled",
      };
    });
    const filteredEnrollmentRows = enrollmentRows.filter((record) => {
      const query = recordSearch.trim().toLowerCase();
      const matchesQuery = !query || [record.residentName, record.programName, record.status, record.nextVisit]
        .some((value) => String(value || "").toLowerCase().includes(query));
      return matchesQuery && (!recordStatus || record.status === recordStatus);
    });
    const enrollmentPageCount = Math.max(1, Math.ceil(filteredEnrollmentRows.length / recordPageSize));
    const safeEnrollmentPage = Math.min(recordPage, enrollmentPageCount);
    const pagedEnrollmentRows = filteredEnrollmentRows.slice((safeEnrollmentPage - 1) * recordPageSize, safeEnrollmentPage * recordPageSize);
    const showIndicator = (row) => {
      setSelectedIndicator(row);
    };

    if (!program) return <ErrorState title="Program unavailable" message="The requested M1 program is not configured." />;

    return (
      <div className="min-w-0">
        <M1PageHeader title={program.title} subtitle={program.description} crumb={program.title} />
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

        {loading ? (
          <SkeletonTable rows={7} cols={4} className="ui-tcl-data-table" />
        ) : error ? (
          <Card><ErrorState title="Unable to load M1 data" message={error} onRetry={() => setRetry((value) => value + 1)} /></Card>
        ) : programId === "enrollment" ? (
          <section aria-labelledby="enrollment-register-heading">
            <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
              <div><h2 id="enrollment-register-heading" className="text-base font-semibold text-brand-ink">Program Enrollment Register</h2><p className="mt-0.5 text-xs text-brand-gray">{filteredEnrollmentRows.length} records · {selectedPeriodLabel}</p></div>
            </div>
            <TclToolbar
              onSearch={setRecordSearch}
              searchValue={recordSearch}
              onFilter={setRecordStatus}
              filterValue={recordStatus}
              filterOptions={enrollmentFilterOptions}
              showExport={false}
              showRefresh={false}
            />
            {filteredEnrollmentRows.length === 0 ? (
              <TclEmptyState type={recordSearch || recordStatus ? "filter" : "empty"} title="No program enrollments" description={`No enrollment records are available for ${selectedPeriodLabel}.`} compact />
            ) : (
              <>
                <DataTable
                  rows={pagedEnrollmentRows}
                  dense
                  compact
                  striped
                  mobileCards
                  stickyHeader
                  maxHeight="60vh"
                  className="ui-tcl-data-table !rounded-card !shadow-none"
                  tableClassName="min-w-[48rem]"
                  columns={[
                    { key: "residentName", label: "Resident", wrap: true },
                    { key: "programName", label: "Program", wrap: true },
                    { key: "registeredAt", label: "Registered" },
                    { key: "status", label: "Status", render: (record) => <StatusBadge value={record.status || "Not recorded"} /> },
                    { key: "nextVisit", label: "Next Visit" },
                  ]}
                />
                {filteredEnrollmentRows.length > recordPageSize && <TablePagination total={filteredEnrollmentRows.length} page={safeEnrollmentPage} pageSize={recordPageSize} onPageChange={setRecordPage} onPageSizeChange={(value) => { setRecordPageSize(value); setRecordPage(1); }} className="mt-3" />}
              </>
            )}
          </section>
        ) : rows.length === 0 ? (
          <TclEmptyState title="No indicator data" description={`No ${program.title.toLowerCase()} indicators are available for ${selectedPeriodLabel}.`} compact />
        ) : (
          <>
            {tabs.length > 1 && (
              <TclTabs tabs={tabs} active={selectedTab.value} onChange={setActiveTab} label={`${program.title} categories`} className="flex-nowrap overflow-x-auto rounded-t-card bg-brand-bg/70 px-1 pt-1" idPrefix={`${programId}-categories`} panelId={`${programId}-panel`} />
            )}
            <section role="tabpanel" id={`${programId}-panel`} aria-labelledby={tabs.length > 1 ? `${programId}-categories-${tabs.indexOf(selectedTab)}` : undefined} tabIndex={0}>
              <div className="mb-2 flex items-center justify-between gap-3">
                <h2 className="text-sm font-semibold text-brand-ink">{selectedTab?.label || program.title}</h2>
                <span className="text-xs text-brand-gray">{visibleRows.length} indicators</span>
              </div>
              <M1IndicatorTable rows={visibleRows} onView={showIndicator} />
            </section>
          </>
        )}

        <M1DrilldownDialog indicator={selectedIndicator} periodLabel={selectedPeriodLabel} records={drilldown?.records ?? null} error={drilldownError} onRetry={() => setDrillRetry((value) => value + 1)} onClose={() => setSelectedIndicator(null)} />
      </div>
    );
  };
}

export default createM1ProgramDetailPage;
