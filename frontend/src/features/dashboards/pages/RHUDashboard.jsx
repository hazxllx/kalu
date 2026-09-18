import React from "react";
import PageHeader from "@/components/common/PageHeader";
import StatCard from "@/components/common/StatCard";
import { Card } from "@/components/common/Card";
import DataTable from "@/components/tables/DataTable";
import StatusBadge from "@/components/common/StatusBadge";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import { barangayOverview, monthlyConsultations } from "@/services/local/dashboardData";
import { FileText, Calendar, BarChart3, Eye, Activity, HeartPulse } from "lucide-react";

const RECENT_REFERRALS = [];

const QUICK_ACTIONS = [
  { icon: Activity, label: "Triage", description: "Send a patient to the PHN for check-up", path: "/app/rhu_personnel/triage" },
  { icon: HeartPulse, label: "Health Programs", description: "Manage health programs and initiatives", path: "/app/rhu_personnel/programs" },
  { icon: FileText, label: "Referrals", description: "Review RHU referral activity", path: "/app/rhu_personnel/dashboard" },
  { icon: Calendar, label: "Notifications", description: "Check your notifications", path: "/app/rhu_personnel/notifications" },
];

const BARANGAY_HEALTH_SUMMARY = [];

const HEALTH_PROGRAMS = [];

const REPORTS_SUMMARY = [];

const stats = [
  { icon: "Map", label: "Barangays", value: "—", tone: "accent" },
  { icon: "Users", label: "Total Residents", value: "—", tone: "blue" },
  { icon: "AlertTriangle", label: "High Risk Cases", value: "—", tone: "danger" },
  { icon: "Syringe", label: "Vaccination Coverage", value: "—", tone: "green" },
];

export default function RHUDashboard() {
  const columns = [
    { key: "name", label: "Barangay" },
    { key: "residents", label: "Residents" },
    { key: "highRisk", label: "High Risk" },
    { key: "coverage", label: "Vax Coverage" },
  ];

  const renderCell = (row, column) => {
    return row[column.key];
  };
  return (
    <>
      <PageHeader crumbs={["Dashboard"]} title="RHU Overview" subtitle="Manage consultations, treatments, referrals, and follow-ups across the municipality." />
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 sm:gap-4 mb-6">
        {stats.map((s, i) => <StatCard key={s.label} {...s} index={i} />)}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-5">
        <Card className="p-4 sm:p-6 lg:col-span-2">
          <h3 className="font-semibold text-brand-ink text-sm sm:text-base mb-4">Disease Trend â€” Monthly Consultations</h3>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={monthlyConsultations}>
              <CartesianGrid vertical={false} stroke="#E5EAF1" />
              <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: "#5B6472", fontSize: 11 }} />
              <YAxis axisLine={false} tickLine={false} tick={{ fill: "#5B6472", fontSize: 11 }} />
              <Tooltip contentStyle={{ borderRadius: 12, border: "1px solid #E5EAF1" }} />
              <Line type="monotone" dataKey="value" stroke="#0B5CAD" strokeWidth={3} dot={{ r: 4, fill: "#0B5CAD" }} />
            </LineChart>
          </ResponsiveContainer>
        </Card>
        <Card className="p-4 sm:p-6 h-fit">
          <h3 className="font-semibold text-brand-ink text-sm sm:text-base mb-4">Recent Referrals</h3>
          <div className="space-y-3">
            {RECENT_REFERRALS.length === 0 && (
              <p className="text-sm text-brand-gray py-6 text-center">No referrals available yet.</p>
            )}
            {RECENT_REFERRALS.slice(0, 5).map((r) => (
              <div key={r.id} className="flex items-center justify-between py-2 border-b border-brand-border last:border-0">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-brand-ink truncate">{r.resident}</p>
                  <p className="text-xs text-brand-gray">{r.barangay} â€¢ {r.date}</p>
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge value={r.status} />
                  <button className="p-1 text-brand-blue hover:bg-brand-light rounded">
                    <Eye className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
          <button className="w-full mt-4 text-sm font-medium text-brand-blue hover:underline">
            View All Referrals
          </button>
        </Card>
      </div>

      {/* Quick Actions */}
      <div className="mt-6">
        <h3 className="font-semibold text-brand-ink text-sm sm:text-base mb-4">Quick Actions</h3>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {QUICK_ACTIONS.map((action) => (
            <Card key={action.label} className="p-4 hover:border-brand-blue transition-colors cursor-pointer">
              <div className="flex items-start gap-3">
                <div className="p-2 bg-brand-blue/10 rounded-lg">
                  <action.icon className="w-5 h-5 text-brand-blue" />
                </div>
                <div className="flex-1">
                  <h4 className="font-semibold text-brand-ink text-sm">{action.label}</h4>
                  <p className="text-xs text-brand-gray mt-1">{action.description}</p>
                </div>
              </div>
            </Card>
          ))}
        </div>
      </div>

      {/* Barangay Health Summary & Health Program Progress */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-5 mt-6">
        <Card className="p-4 sm:p-6">
          <h3 className="font-semibold text-brand-ink text-sm sm:text-base mb-4">Barangay Health Summary</h3>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-brand-bg border-b border-brand-border">
                <tr>
                  <th className="text-left text-xs font-semibold text-brand-gray uppercase tracking-wide px-3 py-2">Barangay</th>
                  <th className="text-left text-xs font-semibold text-brand-gray uppercase tracking-wide px-3 py-2">Residents</th>
                  <th className="text-left text-xs font-semibold text-brand-gray uppercase tracking-wide px-3 py-2">High Risk</th>
                  <th className="text-left text-xs font-semibold text-brand-gray uppercase tracking-wide px-3 py-2">Vaccination</th>
                </tr>
              </thead>
              <tbody>
                {BARANGAY_HEALTH_SUMMARY.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-3 py-8 text-center text-sm text-brand-gray">No data available yet.</td>
                  </tr>
                )}
                {BARANGAY_HEALTH_SUMMARY.map((b) => (
                  <tr key={b.barangay} className="border-b border-brand-border hover:bg-brand-bg/50">
                    <td className="px-3 py-2 text-sm text-brand-ink">{b.barangay}</td>
                    <td className="px-3 py-2 text-sm text-brand-ink">{b.residents}</td>
                    <td className="px-3 py-2 text-sm text-brand-ink">{b.highRisk}</td>
                    <td className="px-3 py-2 text-sm text-brand-ink">{b.vaccination}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card className="p-4 sm:p-6">
          <h3 className="font-semibold text-brand-ink text-sm sm:text-base mb-4">Health Program Progress</h3>
          <div className="space-y-4">
            {HEALTH_PROGRAMS.length === 0 && (
              <p className="text-sm text-brand-gray py-6 text-center">No data available yet.</p>
            )}
            {HEALTH_PROGRAMS.map((program) => (
              <div key={program.name}>
                <div className="flex justify-between text-sm mb-1.5">
                  <span className="text-brand-gray">{program.name}</span>
                  <span className="font-medium text-brand-ink">{program.progress}%</span>
                </div>
                <div className="h-2 bg-brand-border rounded-full overflow-hidden">
                  <div className="h-full bg-brand-blue rounded-full transition-all" style={{ width: `${program.progress}%` }} />
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Reports Summary */}
      <div className="mt-6">
        <h3 className="font-semibold text-brand-ink text-sm sm:text-base mb-4">Reports Summary</h3>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {REPORTS_SUMMARY.length === 0 && (
            <p className="text-sm text-brand-gray py-6 text-center sm:col-span-2 lg:col-span-4">No reports available yet.</p>
          )}
          {REPORTS_SUMMARY.map((report) => (
            <Card key={report.title} className="p-4">
              <div className="flex items-center gap-3 mb-3">
                <div className="p-2 bg-brand-blue/10 rounded-lg">
                  <report.icon className="w-5 h-5 text-brand-blue" />
                </div>
                <div>
                  <h4 className="font-semibold text-brand-ink text-sm">{report.title}</h4>
                  <p className="text-xs text-brand-gray">{report.total} reports</p>
                </div>
              </div>
            </Card>
          ))}
        </div>
        <div className="mt-4 text-right">
          <button className="flex items-center gap-2 bg-brand-blue text-white px-4 py-2 rounded-btn text-sm font-medium hover:bg-brand-dark transition-colors ml-auto">
            <BarChart3 className="w-4 h-4" /> Generate Report
          </button>
        </div>
      </div>
      <div className="mt-6">
        <h3 className="font-semibold text-brand-ink text-sm sm:text-base mb-4">Barangay Overview</h3>
        <DataTable columns={columns} rows={barangayOverview} renderCell={renderCell} />
      </div>
    </>
  );
}