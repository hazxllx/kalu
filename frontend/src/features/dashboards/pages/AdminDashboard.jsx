import React, { useEffect, useState } from "react";
import PageHeader from "@/components/common/PageHeader";
import { Card } from "@/components/common/Card";
import { api, auditTrailApi, systemLogsApi } from "@/services/api";

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
  const [activity, setActivity] = useState({ state: "loading", rows: [] });
  const [systemLogs, setSystemLogs] = useState({ state: "loading", rows: [] });
  const [health, setHealth] = useState({ state: "loading", data: null });

  useEffect(() => {
    let active = true;

    Promise.allSettled([
      auditTrailApi.list({ limit: 5 }),
      systemLogsApi.list({ limit: 1 }),
      api.get("/health"),
    ]).then(([auditResult, logsResult, healthResult]) => {
      if (!active) return;
      setActivity(auditResult.status === "fulfilled"
        ? { state: "loaded", rows: auditResult.value?.rows || [] }
        : { state: "error", rows: [] });
      setSystemLogs(logsResult.status === "fulfilled"
        ? { state: "loaded", rows: logsResult.value?.rows || [] }
        : { state: "error", rows: [] });
      setHealth(healthResult.status === "fulfilled"
        ? { state: "loaded", data: healthResult.value }
        : { state: "error", data: null });
    });

    return () => { active = false; };
  }, []);

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
      value: activity.state === "loading" ? "Checking…" : activity.state === "loaded" ? "Available" : "Unavailable",
      detail: activity.state === "loaded" ? `${activity.rows.length} recent events` : "Admin audit source",
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
      <PageHeader crumbs={["Dashboard"]} title="System Overview" subtitle="Platform health, usage, and recent activity." />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-5">
        <Card className="p-4 sm:p-6 lg:col-span-2">
          <h3 className="font-semibold text-brand-ink text-sm sm:text-base mb-4">Recent Activity</h3>
          <div className="space-y-3">
            {activity.state === "loading" && (
              <p className="text-sm text-brand-gray py-6 text-center" role="status">Loading recent activity…</p>
            )}
            {activity.state === "error" && (
              <p className="text-sm text-brand-danger py-6 text-center" role="alert">Recent activity could not be loaded.</p>
            )}
            {activity.state === "loaded" && activity.rows.length === 0 && (
              <p className="text-sm text-brand-gray py-6 text-center">No recent activity.</p>
            )}
            {activity.rows.map((entry) => (
              <div key={entry.id} className="flex flex-col sm:flex-row sm:items-start gap-3 border-b border-brand-border pb-3 last:border-0 last:pb-0">
                <div className="w-9 h-9 rounded-full bg-brand-light text-brand-blue flex items-center justify-center text-xs font-semibold shrink-0">
                  {(entry.actorName || "System").split(/\s+/).map((part) => part[0]).slice(0, 2).join("").toUpperCase()}
                </div>
                <div className="flex-1">
                  <p className="text-sm text-brand-ink"><span className="font-medium">{entry.actorName || "System"}</span>{entry.actorRole && <> · <span className="text-brand-gray">{entry.actorRole}</span></>}</p>
                  <p className="text-sm text-brand-gray">{entry.action}</p>
                </div>
                <span className="text-xs text-brand-gray sm:text-right">{formatTime(entry.occurredAt)}</span>
              </div>
            ))}
          </div>
        </Card>
        <Card className="p-4 sm:p-6 h-fit">
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
