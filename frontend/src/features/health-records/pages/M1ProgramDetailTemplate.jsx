// frontend/src/features/health-records/pages/M1ProgramDetailTemplate.jsx
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
import { useSyncStatus } from "@/hooks/useSyncStatus";
import OfflineCacheNotice from "@/features/offline/components/OfflineCacheNotice";
import { listM1ProgramOffline, getM1DrilldownOffline } from "@/services/offline/clinicalOfflineService";
import { m1Api } from "@/services/api";
import { getManilaDateTime } from "../../../../../shared/consultationClinical.js";

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

// Handles createM1ProgramDetailPage logic.
export function createM1ProgramDetailPage(programId, apiClients = {}) {
  return function M1ProgramDetail() {
    const { user } = useAuth();
    const { online, lastSyncedAt } = useSyncStatus();
    const program = getProgram(programId);
    const [searchParams, setSearchParams] = useSearchParams();
    const now = getManilaDateTime();
    const currentYear = Number(now.date.slice(0, 4));
    const currentMonth = Number(now.date.slice(5, 7)) - 1;
    const initialPeriod = PERIOD_TYPES.includes(searchParams.get("period")) ? searchParams.get("period") : "monthly";
    const [period, setPeriod] = useState(initialPeriod);
    const [year, setYear] = useState(() => yearInRange(searchParams.get("year"), currentYear));
    const [month, setMonth] = useState(() => monthFromQuery(searchParams.get("month"), currentMonth));
    const [quarter, setQuarter] = useState(() => quarterFromQuery(searchParams.get("quarter"), quarterOfMonth0(currentMonth)));
    const [indicatorData, setIndicatorData] = useState(null);
    const [indicatorSummary, setIndicatorSummary] = useState(null);
    const [records, setRecords] = useState([]);
    const [loadedRequestKey, setLoadedRequestKey] = useState(null);
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
    const [cacheInfo, setCacheInfo] = useState({ source: null, cachedAt: null, stale: false });
    const scopeKey = [user?.id, user?.role, user?.barangayId || user?.barangay, user?.municipalityId || user?.municipality].join("|");
    const requestKey = `${scopeKey}/${period}/${year}/${month}/${quarter}`;
    const currentReport = loadedRequestKey === requestKey;
    const showingLoading = loading || !currentReport && !error;

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
      setIndicatorSummary(null);
      setRecords([]);
      setCacheInfo({ source: null, cachedAt: null, stale: false });
      setSelectedIndicator(null);
      setDrilldown(null);
      setDrilldownError(null);
      const load = async () => {
        try {
          if (!program) throw new Error("Program not found");
          if (!user?.id) return;
          const result = await listM1ProgramOffline({
            ownerId: user.id,
            programId,
            params: toReportParams({ period, year, month, quarter }),
            fetchFn: apiClients.listRecords,
            online: () => online,
          });
          if (result?.program !== programId || !Array.isArray(result.records)
            || !result.indicators || typeof result.indicators !== "object" || Array.isArray(result.indicators)) {
            throw new Error("Invalid program report response. Please try again.");
          }
          for (const [code, row] of Object.entries(result.indicators)) {
            // Validate response structure
            if (row?.code !== code) {
              throw new Error(`Manual review required: Invalid indicator response for ${code}: code mismatch`);
            }
            if (typeof row.name !== "string" || !row.name.trim() || /^Indicator\s+\S+$/i.test(row.name.trim())) {
              throw new Error(`Manual review required: Catalog definition unavailable for ${code}: missing or invalid name`);
            }
            if (typeof row.subsection !== "string" || !row.subsection.trim()) {
              throw new Error(`Manual review required: Catalog definition unavailable for ${code}: missing subsection`);
            }
            if (program.fhsisSection && !(program.catalogSections || [program.fhsisSection]).includes(row.section)) {
              throw new Error(`Manual review required: Catalog definition unavailable for ${code}: section ${row.section} not in program`);
            }
            if (!Number.isFinite(row.total)) {
              throw new Error(`Manual review required: Reporting value unavailable for ${code}: total is not a number`);
            }
            if (programId === "prenatal" && !program.subsections.some((item) => item.catalogSubsection === row.subsection)) {
              throw new Error(`Manual review required: Catalog definition unavailable for ${code}: subsection "${row.subsection}" does not match program configuration`);
            }
          }
          if (result.summary != null && (!Number.isFinite(result.summary.total) || typeof result.summary.label !== "string")) {
            throw new Error("Invalid program summary response. Please try again.");
          }
          for (const field of ["visits", "unattributedVisits"]) {
            if (result[field] != null && (!Array.isArray(result[field]) || result[field].some((row) => !row || typeof row !== "object"))) {
              throw new Error("Invalid maternal visit evidence response. Please try again.");
            }
          }
          if (!active) return;
          setIndicatorData(result.indicators);
          setIndicatorSummary(result.summary || null);
          setRecords(result.records);
          setLoadedRequestKey(requestKey);
          setCacheInfo({
            source: result.source || "server",
            cachedAt: result.cachedAt ?? null,
            stale: Boolean(result.stale),
          });
        } catch (loadError) {
          if (active) setError(loadError?.message || "Unable to load program data");
        } finally {
          if (active) setLoading(false);
        }
      };
      load();
      return () => { active = false; };
    }, [period, year, month, quarter, program, user?.id, scopeKey, requestKey, retry, online]);

    useEffect(() => {
      if (!selectedIndicator || !user?.id) return undefined;
      let active = true;
      setDrilldown(null);
      setDrilldownError(null);
      getM1DrilldownOffline({
        ownerId: user.id,
        code: selectedIndicator.code,
        params: toReportParams({ period, year, month, quarter }),
        fetchFn: (code, params) => m1Api.drilldown(code, params),
        online: () => online,
      })
        .then(({ data: result }) => {
          if (!Array.isArray(result?.records)) throw new Error("Invalid underlying-record response");
          if (active) setDrilldown(result);
        })
        .catch((loadError) => { if (active) setDrilldownError(loadError?.message || "Unable to load underlying records"); });
      return () => { active = false; };
    }, [selectedIndicator, period, year, month, quarter, drillRetry, user?.id, scopeKey, online]);

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
      setDrilldown(null);
      setDrilldownError(null);
      setSelectedIndicator(row);
    };

    if (!program) return <ErrorState title="Program unavailable" message="The requested M1 program is not configured." />;

    return (
      <div className="min-w-0">
        {/* Compact page header */}
        <M1PageHeader title={program.title} subtitle={program.description} crumb={program.title} />

        {/* Slim period bar — border-b separator, no card box */}
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

        <OfflineCacheNotice
          source={cacheInfo.source}
          cachedAt={cacheInfo.cachedAt}
          lastSyncedAt={lastSyncedAt}
          stale={cacheInfo.stale}
          empty={programId === "enrollment" ? records.length === 0 : rows.length === 0}
          onRetry={() => setRetry((value) => value + 1)}
        />

        {showingLoading ? (
          <SkeletonTable rows={7} cols={4} className="ui-tcl-data-table" />
        ) : error ? (
          <Card><ErrorState title="Unable to load M1 data" message={error} onRetry={() => setRetry((value) => value + 1)} /></Card>
        ) : programId === "enrollment" ? (
          <section aria-labelledby="enrollment-register-heading">
            {/* Compact single-line enrollment toolbar */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#DDE3EC] bg-[#F7F8FA] px-0 py-2">
              <span id="enrollment-register-heading" className="text-[11px] font-semibold uppercase tracking-widest text-[#6B7A8F]">
                Program Enrollment Register
              </span>
              <span className="font-mono text-[11px] tabular-nums text-[#4B5A6E]">
                {filteredEnrollmentRows.length} records · {selectedPeriodLabel}
              </span>
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
            {/* Tabs immediately after the period bar — the tab IS the section heading */}
            {tabs.length > 1 && (
              <TclTabs
                tabs={tabs}
                active={selectedTab.value}
                onChange={setActiveTab}
                label={`${program.title} categories`}
                className="flex-nowrap overflow-x-auto rounded-t-card bg-brand-bg/70 px-1 pt-1 !mb-3"
                idPrefix={`${programId}-categories`}
                panelId={`${programId}-panel`}
              />
            )}
            {/* Indicator table — no redundant h2+count row between tabs and table */}
            <section
              role="tabpanel"
              id={`${programId}-panel`}
              aria-labelledby={tabs.length > 1 ? `${programId}-categories-${tabs.indexOf(selectedTab)}` : undefined}
              tabIndex={0}
            >
              <M1IndicatorTable rows={visibleRows} summary={indicatorSummary} onView={showIndicator} />
            </section>
          </>
        )}

        <M1DrilldownDialog
          indicator={currentReport ? selectedIndicator : null}
          periodLabel={selectedPeriodLabel}
          records={currentReport ? drilldown?.records ?? null : null}
          error={drilldownError}
          onRetry={() => setDrillRetry((value) => value + 1)}
          onClose={() => setSelectedIndicator(null)}
        />
      </div>
    );
  };
}

export default createM1ProgramDetailPage;
