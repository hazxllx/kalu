import React, { useMemo, useState } from "react";
import { format, isValid, parseISO } from "date-fns";
import { ArrowRight, Download } from "lucide-react";

import PageHeader from "@/components/common/PageHeader";
import DataTable from "@/components/tables/DataTable";
import { usePermissions } from "@/context/PermissionsContext";
import { auditLogs } from "@/services/mock/mockData";

const FILTERS = [
  { id: "all", label: "All activity" },
  { id: "permission", label: "Permission changes" },
  { id: "activity", label: "System activity" },
];

const ValuePill = ({ value }) => (
  <span
    className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em] ${
      value ? "bg-brand-light text-brand-blue" : "bg-slate-100 text-slate-500"
    }`}
  >
    {value ? "Allowed" : "Denied"}
  </span>
);

const toTime = (value) => {
  const date = typeof value === "string" && value.includes("T") ? parseISO(value) : new Date(String(value).replace(" ", "T"));
  return isValid(date) ? date : null;
};

/**
 * System-wide audit trail.
 *
 * Merges recorded system activity with the permission-change trail written by
 * the Role & Permissions page, so every privilege grant or removal is visible
 * here alongside everything else — with the account, the role affected, the
 * previous value, the new value and the timestamp.
 */
export default function AuditTrail() {
  const { auditEntries } = usePermissions();
  const [filter, setFilter] = useState("all");

  const rows = useMemo(() => {
    const activity = auditLogs.map((log, index) => ({
      id: `activity-${index}`,
      kind: "activity",
      sortKey: toTime(log.time)?.getTime() ?? 0,
      time: log.time,
      user: log.user,
      role: log.role,
      action: log.action,
      ip: log.ip,
    }));

    const permissions = auditEntries.map((entry) => {
      const date = toTime(entry.timestamp);
      return {
        id: entry.id,
        kind: "permission",
        sortKey: date?.getTime() ?? 0,
        time: date ? format(date, "yyyy-MM-dd HH:mm") : "—",
        user: entry.actorName,
        role: entry.actorRoleLabel,
        action: entry.summary,
        ip: "—",
        module: entry.moduleLabel,
        previousValue: entry.previousValue,
        newValue: entry.newValue,
      };
    });

    return [...permissions, ...activity]
      .filter((row) => filter === "all" || row.kind === filter)
      .sort((a, b) => b.sortKey - a.sortKey);
  }, [auditEntries, filter]);

  const columns = [
    { key: "time", label: "Timestamp" },
    { key: "user", label: "User" },
    { key: "role", label: "Role" },
    { key: "action", label: "Action" },
    { key: "change", label: "Change" },
    { key: "ip", label: "IP Address" },
  ];

  return (
    <>
      <PageHeader
        crumbs={["Home", "Audit Trail"]}
        title="Audit Trail"
        subtitle="Complete record of system activity and access changes."
        action={
          <button className="flex items-center gap-2 border border-brand-border bg-white px-4 py-2.5 rounded-btn text-sm font-medium text-brand-ink hover:border-brand-blue transition-colors">
            <Download className="w-4 h-4" /> Export Logs
          </button>
        }
      />

      <div className="mb-5 flex flex-wrap items-center gap-2">
        {FILTERS.map((option) => (
          <button
            key={option.id}
            type="button"
            onClick={() => setFilter(option.id)}
            className={`rounded-btn border px-3.5 py-2 text-sm font-medium transition-colors ${
              filter === option.id
                ? "border-brand-blue bg-brand-light text-brand-blue"
                : "border-brand-border bg-white text-brand-ink hover:border-brand-rule"
            }`}
          >
            {option.label}
          </button>
        ))}
        <span className="num ml-auto text-xs text-brand-gray">{rows.length} entries</span>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center shadow-card">
          <p className="text-sm text-slate-600">No entries recorded for this filter yet.</p>
        </div>
      ) : (
        <DataTable
          columns={columns}
          rows={rows}
          renderCell={(key, row) => {
            if (key === "ip") return <span className="font-mono text-xs text-brand-gray">{row.ip}</span>;
            if (key === "change") {
              if (row.kind !== "permission") return <span className="text-brand-gray">—</span>;
              return (
                <span className="inline-flex items-center gap-1.5">
                  <ValuePill value={row.previousValue} />
                  <ArrowRight className="h-3 w-3 text-slate-400" strokeWidth={2.4} />
                  <ValuePill value={row.newValue} />
                </span>
              );
            }
            if (key === "action") {
              return (
                <span className="block max-w-[420px] whitespace-normal">
                  {row.action}
                  {row.module && <span className="block text-xs text-brand-gray">{row.module}</span>}
                </span>
              );
            }
            return row[key];
          }}
        />
      )}
    </>
  );
}
