import React, { useEffect, useState } from "react";

import PageHeader from "@/components/common/PageHeader";
import StatCard from "@/components/common/StatCard";
import { Card } from "@/components/common/Card";
import { SkeletonList } from "@/components/common/Skeleton";
import { usersApi, auditTrailApi, systemLogsApi, api } from "@/services/api";

/**
 * System Administrator overview.
 *
 * Displays:
 * - account statistics from the admin user directory
 * - recent audit activity
 * - system/API health diagnostics
 *
 * All displayed operational values are retrieved from live API sources.
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
    : new Intl.DateTimeFormat("en-PH", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(date);
};

const formatUptime = (seconds) => {
  if (!Number.isFinite(seconds)) return "Unavailable";

  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  return [
    days && `${days}d`,
    hours && `${hours}h`,
    `${minutes}m`,
  ]
    .filter(Boolean)
    .join(" ");
};

export default function AdminDashboard() {
  const [counts, setCounts] = useState({
    total: null,
    active: null,
    pending: null,
    disabled: null,
  });

  const [activity, setActivity] = useState([]);
  const [systemLogs, setSystemLogs] = useState({
    state: "loading",
    rows: [],
  });

  const [health, setHealth] = useState({
    state: "loading",
    data: null,
  });

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    (async () => {
      setLoading(true);
      setError("");

      const [
        accountsResult,
        activeResult,
        pendingResult,
        disabledResult,
        auditResult,
        logsResult,
        healthResult,
      ] = await Promise.allSettled([
        usersApi.list({ limit: 1 }),
        usersApi.list({
          status: "active",
          limit: 1,
        }),
        usersApi.list({
          status: "pending_verification",
          limit: 1,
        }),
        usersApi.list({
          status: "disabled",
          limit: 1,
        }),
        auditTrailApi.list({ limit: 6 }),
        systemLogsApi.list({ limit: 1 }),
        api.get("/health"),
      ]);

      if (!active) return;

      if (
        accountsResult.status === "fulfilled" &&
        activeResult.status === "fulfilled" &&
        pendingResult.status === "fulfilled" &&
        disabledResult.status === "fulfilled"
      ) {
        setCounts({
          total: accountsResult.value?.total ?? 0,
          active: activeResult.value?.total ?? 0,
          pending: pendingResult.value?.total ?? 0,
          disabled: disabledResult.value?.total ?? 0,
        });
      } else {
        setError("Could not load the account overview.");
      }

      setActivity(
        auditResult.status === "fulfilled" &&
          Array.isArray(auditResult.value?.rows)
          ? auditResult.value.rows.slice(0, 6)
          : [],
      );

      setSystemLogs(
        logsResult.status === "fulfilled"
          ? {
              state: "loaded",
              rows: logsResult.value?.rows || [],
            }
          : {
              state: "error",
              rows: [],
            },
      );

      setHealth(
        healthResult.status === "fulfilled"
          ? {
              state: "loaded",
              data: healthResult.value,
            }
          : {
              state: "error",
              data: null,
            },
      );

      setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, []);

  const fmt = (value) =>
    value === null || value === undefined
      ? "—"
      : Number(value).toLocaleString();

  const stats = [
    {
      icon: "Users",
      label: "Total Accounts",
      value: fmt(counts.total),
      tone: "blue",
    },
    {
      icon: "UserCheck",
      label: "Active Accounts",
      value: fmt(counts.active),
      tone: "green",
    },
    {
      icon: "ShieldAlert",
      label: "Pending Activation",
      value: fmt(counts.pending),
      tone: "yellow",
    },
    {
      icon: "Lock",
      label: "Disabled Accounts",
      value: fmt(counts.disabled),
      tone: "danger",
    },
  ];

  const diagnostics = [
    {
      label: "API status",
      value:
        health.state === "loading"
          ? "Checking…"
          : health.data?.status === "ok"
            ? "Operational"
            : "Unavailable",
      detail:
        health.data?.message ||
        (health.state === "error"
          ? "Health check failed"
          : ""),
    },
    {
      label: "API uptime",
      value:
        health.state === "loading"
          ? "Checking…"
          : formatUptime(health.data?.uptimeSeconds),
      detail: "Current process",
    },
    {
      label: "Audit trail",
      value:
        activity.length > 0
          ? "Available"
          : auditStatus(activity),
      detail:
        activity.length > 0
          ? `${activity.length} recent events`
          : "Admin audit source",
    },
    {
      label: "Request logging",
      value:
        systemLogs.state === "loading"
          ? "Checking…"
          : systemLogs.state === "loaded"
            ? "Available"
            : "Unavailable",
      detail: systemLogs.rows[0]
        ? `Last request ${formatTime(
            systemLogs.rows[0].occurredAt,
          )}`
        : systemLogs.state === "loaded"
          ? "No logged requests"
          : "Admin request log source",
    },
  ];

  return (
    <>
      <PageHeader
        crumbs={["Dashboard"]}
        title="System Overview"
        subtitle="Platform health, accounts, and recent activity."
      />

      {error && (
        <Card className="mb-5 p-4 text-sm text-brand-danger">
          {error}
        </Card>
      )}

      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map((stat, index) => (
          <StatCard
            key={stat.label}
            {...stat}
            index={index}
          />
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:gap-5 lg:grid-cols-3">
        <Card className="p-4 sm:p-6 lg:col-span-2">
          <h3 className="mb-4 text-sm font-semibold text-brand-ink sm:text-base">
            Recent Activity
          </h3>

          {loading ? (
            <SkeletonList rows={5} />
          ) : activity.length === 0 ? (
            <p className="py-6 text-center text-sm text-brand-gray">
              No recent activity.
            </p>
          ) : (
            <div className="space-y-3">
              {activity.map((entry, index) => (
                <div
                  key={entry.id || index}
                  className="flex flex-col gap-3 border-b border-brand-border pb-3 last:border-0 last:pb-0 sm:flex-row sm:items-start"
                >
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-light text-xs font-semibold text-brand-blue">
                    {initialsOf(entry.actorName)}
                  </div>

                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-brand-ink">
                      <span className="font-medium">
                        {entry.actorName || "System"}
                      </span>

                      {entry.actorRole ? (
                        <span className="text-brand-gray">
                          {" "}
                          · {entry.actorRole}
                        </span>
                      ) : null}
                    </p>

                    <p className="text-sm text-brand-gray">
                      {[
                        entry.action,
                        entry.module,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </div>

                  <span className="whitespace-nowrap text-xs text-brand-gray">
                    {formatTime(entry.occurredAt)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card className="h-fit p-4 sm:p-6">
          <h3 className="mb-4 text-sm font-semibold text-brand-ink sm:text-base">
            System Health
          </h3>

          <div>
            {diagnostics.map((item) => (
              <div
                key={item.label}
                className="flex items-center justify-between gap-3 border-b border-brand-border py-3 last:border-0"
              >
                <div>
                  <span className="text-sm text-brand-gray">
                    {item.label}
                  </span>

                  {item.detail && (
                    <p className="mt-0.5 text-xs text-brand-gray">
                      {item.detail}
                    </p>
                  )}
                </div>

                <span className="font-stat text-right font-bold text-brand-ink">
                  {item.value}
                </span>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </>
  );
}

function auditStatus(activity) {
  return Array.isArray(activity)
    ? "Available"
    : "Unavailable";
}
