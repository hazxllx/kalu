// frontend/src/features/health-records/components/M1DrilldownDialog.jsx
import React, { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import ErrorState from "@/components/common/ErrorState";
import StatusBadge from "@/components/common/StatusBadge";
import DataTable from "@/components/tables/DataTable";
import TablePagination from "@/components/tables/TablePagination";
import { SkeletonTable } from "@/components/system/Skeleton";
import TclEmptyState from "./TclEmptyState";
import { formatDetailsStructured } from "../lib/m1DetailFormatter";

const PAGE_SIZE = 20;
const recordDate = (record) => record.date || record.service_date || record.completion_date || record.assessment_date
  || record.consultation_date || record.enrollment_date || record.next_visit || record.created_at?.slice(0, 10) || "Not recorded";
const fullName = (record) => record ? [record.firstName || record.first_name, record.middleName || record.middle_name, record.lastName || record.last_name].filter(Boolean).join(" ") : "";

// Renders or manages M1DrilldownDialog logic.
export default function M1DrilldownDialog({ indicator, periodLabel, records = null, error = null, onRetry, onClose }) {
  const [page, setPage] = useState(1);
  const dialogRef = useRef(null);
  const returnFocusRef = useRef(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const rows = records || [];
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageRows = rows.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)
    .map((record, index) => ({ ...record, rowId: record.id || `${safePage}-${index}` }));

  useEffect(() => { setPage(1); }, [indicator?.code]);
  useEffect(() => {
    if (!indicator || typeof document === "undefined") return undefined;
    returnFocusRef.current = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialogRef.current?.focus();
    const onKeyDown = (event) => { if (event.key === "Escape") onCloseRef.current(); };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
      returnFocusRef.current?.focus?.();
    };
  }, [indicator]);

  if (!indicator) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="m1-drilldown-title" className="max-h-[90vh] w-full max-w-5xl overflow-y-auto rounded-card border border-brand-border bg-white shadow-card outline-none">
        <div className="sticky top-0 z-20 flex items-start justify-between gap-3 border-b border-brand-border bg-white px-4 py-3">
          <div><h2 id="m1-drilldown-title" className="font-semibold text-brand-ink">{indicator.name}</h2><p className="mt-0.5 text-xs text-brand-gray">{indicator.code} · {periodLabel}</p></div>
          <button type="button" onClick={onClose} className="ui-tcl-control ui-tcl-control-secondary !min-h-9 !px-2.5" aria-label="Close underlying records"><X className="h-4 w-4" /></button>
        </div>
        <div className="p-4">
          {error ? <ErrorState compact title="Underlying records unavailable" message={error} onRetry={onRetry} />
            : records === null ? <SkeletonTable rows={5} cols={4} />
              : rows.length === 0 ? <TclEmptyState compact title="No underlying records" description={`No case-level records are attributed to this indicator for ${periodLabel}.`} />
                : <>
                  <DataTable
                    rows={pageRows}
                    dense compact striped mobileCards stickyHeader maxHeight="min(62vh, calc(100dvh - 16rem))"
                    className="ui-tcl-data-table !rounded-card !shadow-none"
                    tableClassName="min-w-[64rem]"
                    columns={[
                      { key: "subject", label: "Resident / Household", wrap: true, render: (record) => fullName(Array.isArray(record.resident) ? record.resident[0] : record.resident) || record.member?.name || record.household?.head_name || record.household_id || record.resident_id || record.id || "Not recorded" },
                      { key: "date", label: "Date", render: recordDate },
                      { key: "demographics", label: "Age / Sex", render: (record) => [record.ageGroup || record.age_group, record.sex].filter(Boolean).join(" / ") || "Not recorded" },
                      { key: "status", label: "Status", render: (record) => record.status ? <StatusBadge value={record.status} /> : "Not recorded" },
                      { key: "value", label: "Value", align: "right", render: (record) => record.value ?? record.total ?? "Recorded" },
                      { key: "details", label: "Details", wrap: true, render: (record) => {
                        const details = formatDetailsStructured(record.detail);
                        return details.count ? <ul className="space-y-1">{details.fields.map((field) => <li key={`${field.label}-${field.value}`}><span className="font-medium">{field.label}:</span> {field.value}</li>)}</ul> : "Not recorded";
                      } },
                    ]}
                  />
                  {rows.length > PAGE_SIZE && <TablePagination total={rows.length} page={safePage} pageSize={PAGE_SIZE} onPageChange={setPage} className="mt-3" />}
                </>}
        </div>
      </div>
    </div>
  );
}
