import React, { useEffect, useState } from "react";
import PageHeader from "@/components/common/PageHeader";
import StatCard from "@/components/common/StatCard";
import { Card } from "@/components/common/Card";
import { SkeletonList } from "@/components/common/Skeleton";
import { usersApi, auditTrailApi } from "@/services/api";

/**
 * System Administrator overview.
 *
 * Statistics are read live from the admin-only endpoints:
 *   - account counts come from GET /users (profiles) using the exact-count
 *     totals returned for the whole directory and per status filter,
 *   - recent activity comes from GET /audit-trail.
 * No mock/placeholder data is used; every tile shows the real persisted value
 * or an empty/loading state.
 */

const initialsOf = (name) =>
  String(name || "")
    .split(" ")
    .filter(Boolean)
    .map((n) => n[0])
    .slice(0, 2)
    .join("")
    .toUpperCase() || "?";

const formatTime = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
};

export default function AdminDashboard() {
  const [counts, setCounts] = useState({ total: null, active: null, pending: null, disabled: null });
  const [activity, setActivity] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      setError("");
      try {
        // Each list runs with limit:1 so the server returns only the exact
        // total for that filter (no rows transferred). The audit list is
        // tolerant: a failure there must not blank the whole dashboard.
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
    return () => {
      active = false;
    };
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

  return (
    <>
      <PageHeader crumbs={["Dashboard"]} title="System Overview" subtitle="Platform accounts and recent activity." />

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
    </>
  );
}
