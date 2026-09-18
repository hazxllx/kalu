import React, { useMemo, useState } from "react";
import { format, isValid, parseISO } from "date-fns";
import { ArrowRight, Download, Search, X } from "lucide-react";

import PageHeader from "@/components/common/PageHeader";
import DataTable from "@/components/tables/DataTable";
import { usePermissions } from "@/context/PermissionsContext";
import { useAuditEvents } from "@/services/local/auditStore";

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
 * Merges three sources:
 *   1. the shared audit store (logins, user admin, staff requests, supervisor
 *      verification, certificate decisions, resident edits),
 *   2. the permission-change trail written by the Role & Permissions page,
 *   3. the seeded system-activity mock list.
 *
 * Search, action, role, and date filters apply across all of them.
 */
export default function AuditTrail() {
  const { auditEntries } = usePermissions();
  const events = useAuditEvents();

  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [actionFilter, setActionFilter] = useState("All");
  const [roleFilter, setRoleFilter] = useState("All");
  const [dateFilter, setDateFilter] = useState("");

  // Distinct actions/roles present across all sources (for the dropdowns).
  const actionOptions = useMemo(() => {
    const set = new Set(events.map((e) => e.action));
    return ["All", ...Array.from(set).sort()];
  }, [events]);
  const roleOptions = useMemo(() => {
    const set = new Set(events.map((e) => e.role));
    return ["All", ...Array.from(set).sort()];
  }, [events]);

  const rows = useMemo(() => {
    // Shared audit-store events.
    const storeEvents = events.map((e) => ({
      id: e.id,
      kind: "activity",
      sortKey: toTime(e.timestamp)?.getTime() ?? 0,
      time: toTime(e.timestamp) ? format(toTime(e.timestamp), "yyyy-MM-dd HH:mm") : e.timestamp,
      user: e.user,
      role: e.role,
      action: e.action,
      description: e.description,
      status: e.status,
      ip: "—",
      dateKey: e.timestamp.slice(0, 10),
    }));

    // Permission-change trail from the Role & Permissions page.
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
        description: "",
        status: "Success",
        ip: "—",
        module: entry.moduleLabel,
        previousValue: entry.previousValue,
        newValue: entry.newValue,
        dateKey: String(entry.timestamp).slice(0, 10),
      };
    });

    const q = query.trim().toLowerCase();
    return [...permissions, ...storeEvents]
      .filter((row) => filter === "all" || row.kind === filter)
      .filter((row) => actionFilter === "All" || row.action === actionFilter)
      .filter((row) => roleFilter === "All" || row.role === roleFilter)
      .filter((row) => !dateFilter || row.dateKey === dateFilter)
      .filter((row) => !q || `${row.user} ${row.role} ${row.action} ${row.description}`.toLowerCase().includes(q))
      .sort((a, b) => b.sortKey - a.sortKey);
  }, [auditEntries, events, filter, query, actionFilter, roleFilter, dateFilter]);

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
        crumbs={["Audit Trail"]}
        title="Audit Trail"
        subtitle="Complete record of system activity and access changes."
        action={
          <button
            onClick={() => {
              // Export the current filtered rows as a JSON file (frontend only).
              const blob = new Blob([JSON.stringify(rows, null, 2)], { type: "application/json" });
              const url = URL.createObjectURL(blob);
              const link = document.createElement("a");
              link.href = url;
              link.download = "kalusagap-audit-trail.json";
              link.click();
              URL.revokeObjectURL(url);
            }}
            className="flex items-center gap-2 border border-brand-border bg-white px-4 py-2.5 rounded-btn text-sm font-medium text-brand-ink hover:border-brand-blue transition-colors"
          >
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

      {/* Search + action/role/date filters */}
      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="flex items-center gap-2 rounded-input border border-slate-200 bg-brand-bg/60 px-3 py-2.5 dark:border-border dark:bg-input">
          <Search className="h-4 w-4 shrink-0 text-brand-gray" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search user, role, or action..."
            className="w-full bg-transparent text-sm outline-none placeholder:text-slate-400 dark:placeholder:text-slate-500"
          />
        </div>
        <select value={actionFilter} onChange={(e) => setActionFilter(e.target.value)} className="rounded-btn border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none dark:border-border dark:bg-input dark:text-foreground">
          {actionOptions.map((a) => <option key={a} value={a}>{a === "All" ? "All Actions" : a}</option>)}
        </select>
        <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)} className="rounded-btn border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none dark:border-border dark:bg-input dark:text-foreground">
          {roleOptions.map((r) => <option key={r} value={r}>{r === "All" ? "All Roles" : r}</option>)}
        </select>
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={dateFilter}
            onChange={(e) => setDateFilter(e.target.value)}
            aria-label="Filter by date"
            className="min-w-0 flex-1 rounded-btn border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none dark:border-border dark:bg-input dark:text-foreground"
          />
          {dateFilter && (
            <button onClick={() => setDateFilter("")} aria-label="Clear date filter" className="inline-flex items-center gap-1 whitespace-nowrap rounded-btn border border-brand-border bg-white px-3 py-2.5 text-sm font-medium text-brand-gray hover:bg-brand-bg dark:bg-card dark:hover:bg-hover">
              <X className="h-4 w-4" /> Clear
            </button>
          )}
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center shadow-card dark:border-border dark:bg-card">
          <p className="text-sm text-slate-600 dark:text-slate-400">No entries recorded for these filters yet.</p>
        </div>
      ) : (
        <DataTable
          columns={columns}
          rows={rows}
          renderCell={(key, row) => {
            if (key === "ip") return <span className="font-mono text-xs text-brand-gray">{row.ip}</span>;
            if (key === "change") {
              if (row.kind !== "permission") return <span className="text-brand-gray">{row.description || "—"}</span>;
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
