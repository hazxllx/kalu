import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AlertCircle, ArrowRight, Download, Filter, KeyRound, Loader2, Search, ShieldCheck } from "lucide-react";

import PageHeader from "@/components/common/PageHeader";
import { Card } from "@/components/common/Card";
import Icon from "@/components/common/Icon";
import { usePermissions } from "@/context/PermissionsContext";
import { systemLogsApi } from "@/services/api";
import {
  ALL_PERMISSION_IDS,
  MANAGED_ROLES,
  PERMISSION_MODULES,
  ROLE_POLICY,
  countGranted,
  countGrantedInModule,
} from "@/lib/permissions";

/**
 * Roles overview.
 *
 * Reads the live permission matrix so each role's card reflects exactly what an
 * administrator has granted on the Role & Permissions page — the two screens
 * can never drift apart.
 */
const RolesOverview = () => {
  const { permissionsForRole } = usePermissions();
  const total = ALL_PERMISSION_IDS.length;

  return (
    <>
      <PageHeader
        crumbs={["Roles"]}
        title="Roles"
        subtitle="System roles, their responsibilities and how much of the permission catalogue each one currently holds."
        action={
          <Link
            to="/app/admin/permissions"
            className="inline-flex items-center gap-2 rounded-btn bg-brand-blue px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-dark"
          >
            <KeyRound className="h-4 w-4" strokeWidth={1.9} />
            Manage permissions
          </Link>
        }
      />

      <div className="space-y-4">
        {MANAGED_ROLES.map((role) => {
          const permissions = permissionsForRole(role.id);
          const granted = countGranted(permissions);
          const activeModules = PERMISSION_MODULES.filter(
            (mod) => countGrantedInModule(mod.id, permissions).on > 0,
          );

          return (
            <Card key={role.id} className="p-5">
              <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                <div className="flex min-w-0 items-start gap-4">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-light text-brand-blue">
                    <Icon name={role.icon} className="h-5 w-5" strokeWidth={1.8} />
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-heading font-semibold text-brand-ink">{role.label}</p>
                      {ROLE_POLICY[role.id] && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-brand-goldpale px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em] text-brand-amber">
                          <ShieldCheck className="h-3 w-3" strokeWidth={2.2} />
                          Guard-railed
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-sm text-brand-gray">{role.description}</p>
                    <div className="mt-2.5 flex flex-wrap gap-1.5">
                      {activeModules.length === 0 ? (
                        <span className="text-xs text-slate-400">No modules enabled</span>
                      ) : (
                        activeModules.map((mod) => {
                          const { on, total: modTotal } = countGrantedInModule(mod.id, permissions);
                          return (
                            <span
                              key={mod.id}
                              className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-medium text-slate-600"
                            >
                              {mod.short} <span className="num text-slate-400">{on}/{modTotal}</span>
                            </span>
                          );
                        })
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-4 md:flex-col md:items-end md:gap-2">
                  <span className="num text-sm text-brand-gray">
                    <span className="font-semibold text-brand-ink">{granted}</span>/{total} permissions
                  </span>
                  <Link
                    to="/app/admin/permissions"
                    className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-blue hover:underline"
                  >
                    Configure
                    <ArrowRight className="h-4 w-4" strokeWidth={2} />
                  </Link>
                </div>
              </div>
            </Card>
          );
        })}
      </div>
    </>
  );
};

const OUTCOME_TONES = {
  Success: "bg-brand-green/10 text-brand-green",
  Failed: "bg-brand-goldpale text-brand-amber",
  Error: "bg-brand-danger/10 text-brand-danger",
};

const formatStamp = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? String(iso) : d.toLocaleString("en-US", { hour12: false });
};

/**
 * System Logs (administrator only) — the request-level runtime log served by
 * `GET /api/system-logs`.
 *
 * Rows are written by the API's request logger into `public.system_logs` and
 * carry the method, path, status code, duration and acting role. The logger
 * deliberately records no bodies, headers, tokens or query strings, so no
 * personal health data or credential can reach this view.
 *
 * This is NOT the Audit Trail: that is the business-event record
 * (`/api/audit-trail`), while this is the technical request log. The previous
 * version of this page rendered a hardcoded empty array, so it could never
 * show anything at all.
 */
const SystemLogs = () => {
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [modules, setModules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [status, setStatus] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query.trim()), 300);
    return () => clearTimeout(timer);
  }, [query]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const payload = await systemLogsApi.list({
        q: debouncedQuery || undefined,
        status: status || undefined,
        limit: 100,
      });
      setRows(payload?.rows || []);
      setTotal(payload?.total || 0);
      if (payload?.facets?.modules) setModules(payload.facets.modules);
    } catch (err) {
      setRows([]);
      setError(err?.message || "The system log could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [debouncedQuery, status]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <>
      <PageHeader
        crumbs={["Logs"]}
        title="System Logs"
        subtitle="Request-level runtime log — which endpoint was called, by whom, and with what result."
        action={
          <button
            onClick={() => {
              const blob = new Blob([JSON.stringify(rows, null, 2)], { type: "application/json" });
              const url = URL.createObjectURL(blob);
              const link = document.createElement("a");
              link.href = url;
              link.download = "kalusagap-system-logs.json";
              link.click();
              URL.revokeObjectURL(url);
            }}
            className="flex items-center gap-2 bg-brand-blue text-white px-4 py-2.5 rounded-btn text-sm font-medium hover:bg-brand-dark transition-colors"
          >
            <Download className="w-4 h-4" /> Export Logs
          </button>
        }
      />

      <Card className="p-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between mb-4">
          <div className="flex items-center gap-2 bg-brand-bg border border-brand-border rounded-input px-3.5 py-2.5 w-full md:max-w-sm">
            <Search className="w-4 h-4 text-brand-gray" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search path, method, or user..."
              className="bg-transparent text-sm outline-none w-full"
            />
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-2 bg-brand-bg border border-brand-border rounded-input px-3.5 py-2.5">
              <Filter className="w-4 h-4 text-brand-gray" />
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                aria-label="Filter by outcome"
                className="bg-transparent text-sm outline-none"
              >
                <option value="">All Status</option>
                <option value="success">Success</option>
                <option value="error">Failed / Error</option>
              </select>
            </div>
          </div>
        </div>

        {error && (
          <div className="mb-4 flex items-center gap-2 rounded-btn border border-brand-danger/20 bg-brand-danger/5 px-3.5 py-2.5 text-sm text-brand-danger">
            <AlertCircle className="w-4 h-4 shrink-0" /> {error}
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-brand-gray">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading system log...
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b border-brand-border text-brand-gray">
                  <th className="py-3 pr-3">Timestamp</th>
                  <th className="py-3 pr-3">User</th>
                  <th className="py-3 pr-3">Role</th>
                  <th className="py-3 pr-3">Request</th>
                  <th className="py-3 pr-3">Module</th>
                  <th className="py-3 pr-3">Status</th>
                  <th className="py-3">Duration</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((log) => (
                  <tr key={log.id} className="border-b border-brand-border last:border-0">
                    <td className="whitespace-nowrap py-3 pr-3 text-brand-ink">{formatStamp(log.occurredAt)}</td>
                    <td className="py-3 pr-3 text-brand-ink">{log.actorName}</td>
                    <td className="py-3 pr-3 text-brand-gray">{log.actorRole || "—"}</td>
                    <td className="py-3 pr-3">
                      <span className="font-mono text-xs text-brand-ink">
                        <span className="font-semibold">{log.method}</span> {log.path}
                      </span>
                    </td>
                    <td className="py-3 pr-3 text-brand-gray">{log.module}</td>
                    <td className="py-3 pr-3">
                      <span className={`text-xs px-2 py-1 rounded-full ${OUTCOME_TONES[log.outcome] || OUTCOME_TONES.Success}`}>
                        {log.statusCode} {log.outcome}
                      </span>
                    </td>
                    <td className="num py-3 text-brand-gray">{log.durationMs} ms</td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-brand-gray">No system log entries match these filters.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-4 flex items-center justify-between text-sm text-brand-gray">
          <span>Showing {rows.length} of {total} entries</span>
          {modules.length > 0 && (
            <span className="text-xs text-slate-400">
              {modules.length} module{modules.length === 1 ? "" : "s"} seen
            </span>
          )}
        </div>
      </Card>
    </>
  );
};

export default function SystemManagementPage({ variant }) {
  if (variant === "roles") return <RolesOverview />;
  return <SystemLogs />;
}
