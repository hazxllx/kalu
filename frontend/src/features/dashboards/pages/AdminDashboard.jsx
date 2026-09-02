import React from "react";
import PageHeader from "@/components/common/PageHeader";
import StatCard from "@/components/common/StatCard";
import { Card } from "@/components/common/Card";
import { adminStats, auditLogs } from "@/services/mock/mockData";

export default function AdminDashboard() {
  return (
    <>
      <PageHeader crumbs={["Home", "Dashboard"]} title="System Overview" subtitle="Platform health, usage, and recent activity." />
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 sm:gap-4 mb-6">
        {adminStats.map((s, i) => <StatCard key={s.label} {...s} index={i} />)}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-5">
        <Card className="p-4 sm:p-6 lg:col-span-2">
          <h3 className="font-semibold text-brand-ink text-sm sm:text-base mb-4">Recent Activity</h3>
          <div className="space-y-3">
            {auditLogs.slice(0, 5).map((l, i) => (
              <div key={i} className="flex flex-col sm:flex-row sm:items-start gap-3 border-b border-brand-border pb-3 last:border-0 last:pb-0">
                <div className="w-9 h-9 rounded-full bg-brand-light text-brand-blue flex items-center justify-center text-xs font-semibold shrink-0">{l.user.split(" ").map(n=>n[0]).slice(0,2).join("")}</div>
                <div className="flex-1">
                  <p className="text-sm text-brand-ink"><span className="font-medium">{l.user}</span> · <span className="text-brand-gray">{l.role}</span></p>
                  <p className="text-sm text-brand-gray">{l.action}</p>
                </div>
                <span className="text-xs text-brand-gray whitespace-nowrap">{l.time.split(" ")[1]}</span>
              </div>
            ))}
          </div>
        </Card>
        <Card className="p-4 sm:p-6 h-fit">
          <h3 className="font-semibold text-brand-ink text-sm sm:text-base mb-4">System Health</h3>
          {[
            { label: "Server Uptime", value: "99.98%", color: "bg-brand-green" },
            { label: "Storage Used", value: "62%", color: "bg-brand-accent" },
            { label: "Last Backup", value: "2h ago", color: "bg-brand-blue" },
            { label: "Active Sessions", value: "37", color: "bg-brand-yellow" },
          ].map((s) => (
            <div key={s.label} className="flex items-center justify-between py-3 border-b border-brand-border last:border-0">
              <span className="text-sm text-brand-gray flex items-center gap-2"><span className={`w-2 h-2 rounded-full ${s.color}`} />{s.label}</span>
              <span className="font-stat font-bold text-brand-ink">{s.value}</span>
            </div>
          ))}
        </Card>
      </div>
    </>
  );
}