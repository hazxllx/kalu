import React from "react";
import { FileText } from "lucide-react";
import { recordStatusTone, hasSnapshot } from "@/features/reports/lib/reportSnapshot";

/**
 * Renders a persisted report snapshot — the immutable content captured when the
 * report was submitted. It reads ONLY from the stored snapshot (summary totals,
 * columns, rows, metadata) and never touches the live source APIs, so a report
 * opened long after submission shows exactly what was sent.
 *
 * Falls back to an explicit "content unavailable" state for legacy rows that
 * were submitted before snapshotting existed (content is null / malformed).
 */
export default function ReportSnapshotView({ content }) {
  if (!hasSnapshot(content)) {
    return (
      <div className="rounded-btn border border-dashed border-brand-border p-6 text-center">
        <FileText className="mx-auto h-7 w-7 text-brand-gray/40" />
        <p className="mt-2 text-sm font-medium text-brand-ink">Report content unavailable</p>
        <p className="mt-1 text-xs text-brand-gray">
          This report was submitted before full content was captured, so its original contents cannot be displayed.
        </p>
      </div>
    );
  }

  const summary = content.summary || null;
  const columns = Array.isArray(content.columns) ? content.columns : [];
  const rows = Array.isArray(content.rows) ? content.rows : [];
  const generated = content.generatedAt
    ? new Date(content.generatedAt)
    : null;
  const generatedLabel = generated && !Number.isNaN(generated.getTime())
    ? generated.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })
    : null;

  return (
    <div className="space-y-4">
      {/* Snapshot metadata */}
      <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
        {[
          ["Reporting Period", content.reportPeriod || "—"],
          ["Scope", content.scope || content.barangay || "—"],
          ["Type", content.reportType || "—"],
          ["Generated", generatedLabel || "—"],
        ].map(([label, value]) => (
          <div key={label} className="rounded-btn border border-brand-border bg-brand-bg/40 p-2.5">
            <p className="text-[11px] uppercase tracking-wide text-brand-gray">{label}</p>
            <p className="mt-0.5 font-medium text-brand-ink">{value}</p>
          </div>
        ))}
      </div>

      {/* Summary */}
      {summary && (
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-2 rounded-btn bg-brand-blue/10 px-3 py-1.5 text-sm font-medium text-brand-blue">
              Total records: {summary.total ?? 0}
            </span>
            {Object.entries(summary.byStatus || {}).map(([status, count]) => (
              <span key={status} className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${recordStatusTone(status)}`}>
                {status}: {count}
              </span>
            ))}
          </div>
          {summary.periodFiltered === false && (
            <p className="mt-2 text-xs text-brand-gray">
              Totals reflect all records in scope at submission time (these records did not carry a per-record date for the selected month).
            </p>
          )}
        </div>
      )}

      {content.note && <p className="text-xs text-brand-gray">{content.note}</p>}

      {/* Included records table */}
      {columns.length > 0 && (
        rows.length === 0 ? (
          <div className="rounded-btn border border-dashed border-brand-border p-6 text-center">
            <p className="text-sm font-medium text-brand-ink">No records in this report</p>
            <p className="mt-1 text-xs text-brand-gray">This report was submitted without any detail rows for the period.</p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-btn border border-brand-border">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="bg-brand-bg">
                <tr>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-brand-gray">#</th>
                  {columns.map((c, ci) => (
                    <th key={`${c.label}-${ci}`} className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-brand-gray">{c.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((cells, ri) => (
                  <tr key={ri} className="border-t border-brand-border">
                    <td className="px-4 py-2.5 text-brand-gray">{ri + 1}</td>
                    {columns.map((c, ci) => {
                      const value = cells?.[ci] ?? "—";
                      return (
                        <td key={`${ri}-${ci}`} className="px-4 py-2.5 text-brand-ink">
                          {c.badge
                            ? <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${recordStatusTone(value)}`}>{value}</span>
                            : value}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}
      {columns.length > 0 && rows.length > 0 && (
        <p className="text-xs text-brand-gray">
          Showing {rows.length} record{rows.length === 1 ? "" : "s"} — the exact set submitted with this report.
        </p>
      )}
    </div>
  );
}
