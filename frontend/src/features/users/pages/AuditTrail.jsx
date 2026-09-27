import React, { useCallback, useEffect, useMemo, useState } from "react";
import { format, isValid, parseISO } from "date-fns";
import { Download, Search, X, AlertCircle, Loader2 } from "lucide-react";

import PageHeader from "@/components/common/PageHeader";
import DataTable from "@/components/tables/DataTable";
import { auditTrailApi } from "@/services/api";

const PAGE_SIZE = 100;

const toTime = (value) => {
  if (!value) return null;
  const date = typeof value === "string" && value.includes("T") ? parseISO(value) : new Date(String(value).replace(" ", "T"));
  return isValid(date) ? date : null;
};

/** Render an entry's metadata as readable one-line detail. */
const describeDetails = (details) => {
  if (!details || typeof details !== "object") return "";
  return Object.entries(details)
    .filter(([, v]) => v !== null && v !== undefined && v !== "" && typeof v !== "object")
    .map(([k, v]) => `${k.replace(/_/g, " ")}: ${v}`)
    .join(" · ");
};

/**
 * System-wide Audit Trail (administrator only).
 *
 * Served by `GET /api/audit-trail`, which unions the audit tables the system
 * already writes — `health_audit_logs` (account approvals and rejections,
 * medical certificate decisions, record create/update/delete),
 * `resident_verification_logs` and `transfer_request_audit_logs` — and resolves
 * the actor from `profiles` on the server.
 *
 * This replaces the previous page, which merged browser-session `auditStore`
 * events and a localStorage permission matrix. Those were invisible to every
 * other user and vanished on refresh, so the trail could never show who
 * actually approved an account.
 *
 * The SYSTEM LOG is a different view of the system: it is the request-level
 * runtime log served by `/api/system-logs`.
 */
export default function AuditTrail() {
  const [rows, setRows] = useState([]);
  const [facets, setFacets] = useState({ actions: [], modules: [], sources: [] });
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [query, setQuery] = useState("");
  const [actionFilter, setActionFilter] = useState("");
  const [moduleFilter, setModuleFilter] = useState("");
  const [dateFilter, setDateFilter] = useState("");
  // Debounced so typing does not fire a request per keystroke.
  const [debouncedQuery, setDebouncedQuery] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query.trim()), 300);
    return () => clearTimeout(timer);
  }, [query]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const payload = await auditTrailApi.list({
        q: debouncedQuery || undefined,
        action: actionFilter || undefined,
        module: moduleFilter || undefined,
        // The API takes inclusive ISO bounds; a single date filters that day.
        from: dateFilter || undefined,
        to: dateFilter || undefined,
        limit: PAGE_SIZE,
      });
      setRows(payload?.rows || []);
      setTotal(payload?.total || 0);
      if (payload?.facets) setFacets(payload.facets);
    } catch (err) {
      setRows([]);
      setError(err?.message || "The audit trail could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [debouncedQuery, actionFilter, moduleFilter, dateFilter]);

  useEffect(() => {
    load();
  }, [load]);

  const tableRows = useMemo(
    () =>
      rows.map((entry) => {
        const date = toTime(entry.occurredAt);
        return {
          ...entry,
          time: date ? format(date, "yyyy-MM-dd HH:mm") : entry.occurredAt || "—",
          sortKey: date?.getTime() ?? 0,
        };
      }),
    [rows]
  );

  const columns = [
    { key: "time", label: "Timestamp" },
    { key: "actorName", label: "User" },
    { key: "actorRole", label: "Role" },
    { key: "action", label: "Action" },
    { key: "detailsText", label: "Detail" },
    { key: "source", label: "Source" },
  ];

  const hasFilters = Boolean(query || actionFilter || moduleFilter || dateFilter);

  return (
    <>
      <PageHeader
        crumbs={["Audit Trail"]}
        title="Audit Trail"
        subtitle="Record of account approvals, clinical record changes and verification decisions."
        action={
          <button
            onClick={() => {
              // Export exactly the rows the administrator is looking at.
              const blob = new Blob([JSON.stringify(tableRows, null, 2)], { type: "application/json" });
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

      {/* Search + action/module/date filters */}
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
        <select
          value={actionFilter}
          onChange={(e) => setActionFilter(e.target.value)}
          aria-label="Filter by action"
          className="rounded-btn border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none dark:border-border dark:bg-input dark:text-foreground"
        >
          <option value="">All Actions</option>
          {facets.actions.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        <select
          value={moduleFilter}
          onChange={(e) => setModuleFilter(e.target.value)}
          aria-label="Filter by module"
          className="rounded-btn border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none dark:border-border dark:bg-input dark:text-foreground"
        >
          <option value="">All Modules</option>
          {facets.modules.map((m) => <option key={m} value={m}>{m}</option>)}
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
              <X className="w-4 h-4" /> Clear
            </button>
          )}
        </div>
      </div>

      <div className="mb-3 flex items-center justify-between gap-3">
        <span className="num text-xs text-brand-gray">
          {loading ? "Loading..." : `${tableRows.length} of ${total} entries`}
        </span>
        {hasFilters && (
          <button
            onClick={() => { setQuery(""); setActionFilter(""); setModuleFilter(""); setDateFilter(""); }}
            className="inline-flex items-center gap-1 text-xs font-medium text-brand-blue hover:underline"
          >
            <X className="h-3.5 w-3.5" /> Clear all filters
          </button>
        )}
      </div>

      {error ? (
        <div className="flex items-center gap-2 rounded-2xl border border-brand-danger/20 bg-brand-danger/5 p-5 text-sm text-brand-danger">
          <AlertCircle className="h-4 w-4 shrink-0" /> {error}
        </div>
      ) : loading ? (
        <div className="flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white p-10 text-sm text-brand-gray dark:border-border dark:bg-card">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading audit entries...
        </div>
      ) : tableRows.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center shadow-card dark:border-border dark:bg-card">
          <p className="text-sm text-slate-600 dark:text-slate-400">
            {hasFilters ? "No entries match these filters." : "No audit entries have been recorded yet."}
          </p>
        </div>
      ) : (
        <DataTable
          columns={columns}
          rows={tableRows}
          renderCell={(key, row) => {
            if (key === "time") return <span className="whitespace-nowrap text-xs text-brand-gray">{row.time}</span>;
            if (key === "actorRole") {
              return row.actorRole ? <span className="text-brand-gray">{row.actorRole}</span> : <span className="text-brand-gray">—</span>;
            }
            if (key === "action") {
              return (
                <span className="block max-w-[320px] whitespace-normal">
                  {row.action}
                  {row.entityType && <span className="block text-xs text-brand-gray">{row.entityType}</span>}
                </span>
              );
            }
            if (key === "detailsText") {
              const text = row.resident || describeDetails(row.details);
              return <span className="block max-w-[380px] whitespace-normal text-brand-gray">{text || "—"}</span>;
            }
            if (key === "source") return <span className="text-brand-gray">{row.source || "—"}</span>;
            return row[key];
          }}
        />
      )}
    </>
  );
}
