import React, { useEffect, useState } from "react";
import PageHeader from "@/components/common/PageHeader";
import StatCard from "@/components/common/StatCard";
import { Card } from "@/components/common/Card";
import { SkeletonList } from "@/components/common/Skeleton";
import { api, usersApi, auditTrailApi, systemLogsApi } from "@/services/api";

/**
 * System Administrator overview.
 *
 * Combines two live, mock-free data sources:
 *   - Account statistics (V6): account counts come from GET /users (profiles)
 *     using the exact-count totals returned for the whole directory and per
 *     status filter; recent activity comes from GET /audit-trail.
 *   - Platform health (V7): API status/uptime come from GET /health and request
 *     logging availability from GET /system-logs.
 * Every tile shows the real persisted value or an empty/loading state.
 */

const initialsOf = (name) =>
  String(name || "")
    .split(" ")
    .filter(Boolean)
    .map((n) => n[0])
    .slice(0, 2)
    .join("")
    .toUpperCase() || "?";

const formatTime = (value) => {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : new Intl.DateTimeFormat("en-PH", { dateStyle: "medium", timeStyle: "short" }).format(date);
};

const formatUptime = (seconds) => {
  if (!Number.isFinite(seconds)) return "Unavailable";
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return [days && `${days}d`, hours && `${hours}h`, `${minutes}m`].filter(Boolean).join(" ");
};

export default function AdminDashboard() {
  const [counts, setCounts] = useState({ total: null, active: null, pending: null, disabled: null });
  const [activity, setActivity] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [systemLogs, setSystemLogs] = useState({ state: "loading", rows: [] });
  const [health, setHealth] = useState({ state: "loading", data: null });

  useEffect(() => {
    let active = true;

    // Account statistics + recent activity (V6). Each list runs with limit:1 so
    // the server returns only the exact total for that filter (no rows
    // transferred). The audit list is tolerant: a failure there must not blank
    // the whole dashboard.
    (async () => {
      setLoading(true);
      setError("");
      try {
        const [all, act, pend, dis, audit] = await Promise.all([
          usersApi.list({ limit: 1 }),
          usersApi.list({ status: "active", limit: 1 }),
          usersApi.list({ status: "pending_verification", limit: 1 }),
          usersApi.list({ status: "disabled", limit: 1 }),
          auditTrailApi.list({ limit: 6 }).catch(() => ({ rows: [] })),
        ]);
        if (!active) return;
        setCounts({
          total: all?.total ?? 0,
          active: act?.total ?? 0,
          pending: pend?.total ?? 0,
          disabled: dis?.total ?? 0,
        });
        setActivity(Array.isArray(audit?.rows) ? audit.rows.slice(0, 6) : []);
      } catch (err) {
        if (active) setError(err?.message || "Could not load the system overview.");
      } finally {
        if (active) setLoading(false);
      }
    })();

    // Platform health diagnostics (V7): independent and tolerant of failure so
    // a health probe outage never blanks the account statistics above.
    Promise.allSettled([
      systemLogsApi.list({ limit: 1 }),
      api.get("/health"),
    ]).then(([logsResult, healthResult]) => {
      if (!active) return;
      setSystemLogs(logsResult.status === "fulfilled"
        ? { state: "loaded", rows: logsResult.value?.rows || [] }
        : { state: "error", rows: [] });
      setHealth(healthResult.status === "fulfilled"
        ? { state: "loaded", data: healthResult.value }
        : { state: "error", data: null });
    });

    return () => { active = false; };
  }, []);

  const fmt = (n) => (n === null || n === undefined ? "—" : Number(n).toLocaleString());
  const stats = [
    { icon: "Users", label: "Total Accounts", value: fmt(counts.total), tone: "blue" },
    { icon: "UserCheck", label: "Active Accounts", value: fmt(counts.active), tone: "green" },
    { icon: "ShieldAlert", label: "Pending Activation", value: fmt(counts.pending), tone: "yellow" },
    { icon: "Lock", label: "Disabled Accounts", value: fmt(counts.disabled), tone: "danger" },
  ];

  const total = counts.total || 0;
  const pct = (n) => (total > 0 ? Math.round(((n || 0) / total) * 100) : 0);
  const breakdown = [
    { label: "Active", value: counts.active, color: "bg-brand-green", width: pct(counts.active) },
    { label: "Pending Activation", value: counts.pending, color: "bg-brand-yellow", width: pct(counts.pending) },
    { label: "Disabled", value: counts.disabled, color: "bg-brand-danger", width: pct(counts.disabled) },
  ];

  const diagnostics = [
    {
      label: "API status",
      value: health.state === "loading" ? "Checking…" : health.data?.status === "ok" ? "Operational" : "Unavailable",
      detail: health.data?.message || (health.state === "error" ? "Health check failed" : ""),
    },
    {
      label: "API uptime",
      value: health.state === "loading" ? "Checking…" : formatUptime(health.data?.uptimeSeconds),
      detail: "Current process",
    },
    {
      label: "Audit trail",
      value: loading ? "Checking…" : error ? "Unavailable" : "Available",
      detail: !loading && !error ? `${activity.length} recent events` : "Admin audit source",
    },
    {
      label: "Request logging",
      value: systemLogs.state === "loading" ? "Checking…" : systemLogs.state === "loaded" ? "Available" : "Unavailable",
      detail: systemLogs.rows[0]
        ? `Last request ${formatTime(systemLogs.rows[0].occurredAt)}`
        : systemLogs.state === "loaded" ? "No logged requests" : "Admin request log source",
    },
  ];

  return (
    <>
      <PageHeader crumbs={["Dashboard"]} title="System Overview" subtitle="Platform accounts, health, and recent activity." />

      {error && <Card className="mb-5 p-4 text-sm text-brand-danger">{error}</Card>}

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 sm:gap-4 mb-6">
        {stats.map((s, i) => (
          <StatCard key={s.label} {...s} index={i} />
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-5">
        <Card className="p-4 sm:p-6 lg:col-span-2">
          <h3 className="font-semibold text-brand-ink text-sm sm:text-base mb-4">Recent Activity</h3>
          {loading ? (
            <SkeletonList rows={5} />
          ) : activity.length === 0 ? (
            <p className="text-sm text-brand-gray py-6 text-center">No recent activity.</p>
          ) : (
            <div className="space-y-3">
              {activity.map((l, i) => (
                <div
                  key={l.id || i}
                  className="flex flex-col sm:flex-row sm:items-start gap-3 border-b border-brand-border pb-3 last:border-0 last:pb-0"
                >
                  <div className="w-9 h-9 rounded-full bg-brand-light text-brand-blue flex items-center justify-center text-xs font-semibold shrink-0">
                    {initialsOf(l.actorName)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-brand-ink">
                      <span className="font-medium">{l.actorName || "System"}</span>
                      {l.actorRole ? <span className="text-brand-gray"> · {l.actorRole}</span> : null}
                    </p>
                    <p className="text-sm text-brand-gray">{[l.action, l.module].filter(Boolean).join(" · ")}</p>
                  </div>
                  <span className="text-xs text-brand-gray whitespace-nowrap">{formatTime(l.occurredAt)}</span>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card className="p-4 sm:p-6 h-fit">
          <h3 className="font-semibold text-brand-ink text-sm sm:text-base mb-4">Accounts by Status</h3>
          {loading ? (
            <SkeletonList rows={3} />
          ) : (
            <div className="space-y-4">
              {breakdown.map((b) => (
                <div key={b.label}>
                  <div className="flex items-center justify-between text-sm mb-1.5">
                    <span className="text-brand-gray flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full ${b.color}`} />
                      {b.label}
                    </span>
                    <span className="font-stat font-bold text-brand-ink">{fmt(b.value)}</span>
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
                    <div className={`h-full ${b.color}`} style={{ width: `${b.width}%` }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <div className="mt-4 sm:mt-5">
        <Card className="p-4 sm:p-6">
          <h3 className="font-semibold text-brand-ink text-sm sm:text-base mb-4">System Health</h3>
          {diagnostics.map((item) => (
            <div key={item.label} className="flex items-center justify-between gap-3 py-3 border-b border-brand-border last:border-0">
              <div>
                <span className="text-sm text-brand-gray">{item.label}</span>
                {item.detail && <p className="mt-0.5 text-xs text-brand-gray">{item.detail}</p>}
              </div>
              <span className="font-stat font-bold text-brand-ink text-right">{item.value}</span>
            </div>
          ))}
        </Card>
      </div>
    </>
  );
}
