import React from "react";
import PageHeader from "@/components/shared/PageHeader";
import StatCard from "@/components/shared/StatCard";
import { Card } from "@/components/shared/Card";
import DataTable from "@/components/shared/DataTable";
import StatusBadge from "@/components/shared/Badge";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import { barangayOverview, monthlyConsultations } from "@/lib/mockData";
import { FileText, Calendar, Heart, BarChart3, Users, MapPin, Syringe, TrendingUp, ArrowRight, Eye } from "lucide-react";

const RECENT_REFERRALS = [
  { id: 1, resident: "Ana Villanueva", barangay: "San Jose", date: "July 10, 2026", status: "Pending" },
  { id: 2, resident: "Maria Santos", barangay: "San Jose", date: "July 8, 2026", status: "Accepted" },
  { id: 3, resident: "Grace Aquino", barangay: "Cadlan", date: "July 5, 2026", status: "Completed" },
  { id: 4, resident: "Carmen Reyes", barangay: "San Jose", date: "July 3, 2026", status: "Referred to Another Facility" },
  { id: 5, resident: "Lourdes Mendoza", barangay: "Cadlan", date: "July 1, 2026", status: "Pending" },
];

const QUICK_ACTIONS = [
  { icon: Users, label: "Resident Records", description: "View and manage resident health records", path: "/app/rhu/residents" },
  { icon: Calendar, label: "Schedule Follow-up", description: "Schedule patient follow-up appointments", path: "/app/rhu/followups" },
  { icon: Heart, label: "Health Programs", description: "Manage health programs and initiatives", path: "/app/rhu/programs" },
  { icon: BarChart3, label: "Generate Reports", description: "Generate health reports and analytics", path: "/app/rhu/reports" },
];

const BARANGAY_HEALTH_SUMMARY = [
  { barangay: "San Jose", residents: "2,140", highRisk: "34", vaccination: "91%" },
  { barangay: "Cadlan", residents: "1,865", highRisk: "19", vaccination: "88%" },
  { barangay: "Talisay", residents: "1,542", highRisk: "28", vaccination: "92%" },
  { barangay: "Anis", residents: "1,234", highRisk: "15", vaccination: "87%" },
  { barangay: "Maysuram", residents: "987", highRisk: "12", vaccination: "85%" },
  { barangay: "Curry", residents: "1,077", highRisk: "17", vaccination: "90%" },
];

const HEALTH_PROGRAMS = [
  { name: "Immunization", progress: 89 },
  { name: "Maternal Care", progress: 82 },
  { name: "Child Health", progress: 76 },
  { name: "Nutrition Program", progress: 74 },
  { name: "Senior Citizen Care", progress: 68 },
];

const REPORTS_SUMMARY = [
  { icon: FileText, title: "Consultation Reports", total: 312 },
  { icon: ArrowRight, title: "Referral Reports", total: 48 },
  { icon: Calendar, title: "Follow-up Reports", total: 86 },
  { icon: Heart, title: "Health Program Reports", total: 24 },
];

const STATUS_COLORS = {
  Pending: "bg-brand-accent/10 text-brand-accent",
  Accepted: "bg-brand-blue/10 text-brand-blue",
  Completed: "bg-brand-green/10 text-brand-green",
  "Referred to Another Facility": "bg-brand-purple/10 text-brand-purple",
};

const stats = [
  { icon: "Map", label: "Barangays", value: "6", tone: "accent" },
  { icon: "Users", label: "Total Residents", value: "12,845", tone: "blue" },
  { icon: "AlertTriangle", label: "High Risk Cases", value: "215", tone: "danger" },
  { icon: "Syringe", label: "Vaccination Coverage", value: "89%", tone: "green" },
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
      <PageHeader crumbs={["Home", "Dashboard"]} title="RHU Overview" subtitle="Manage consultations, treatments, referrals, and follow-ups across the municipality." />
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 sm:gap-4 mb-6">
        {stats.map((s, i) => <StatCard key={s.label} {...s} index={i} />)}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-5">
        <Card className="p-4 sm:p-6 lg:col-span-2">
          <h3 className="font-semibold text-brand-ink text-sm sm:text-base mb-4">Disease Trend — Monthly Consultations</h3>
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
            {RECENT_REFERRALS.slice(0, 5).map((r) => (
              <div key={r.id} className="flex items-center justify-between py-2 border-b border-brand-border last:border-0">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-brand-ink truncate">{r.resident}</p>
                  <p className="text-xs text-brand-gray">{r.barangay} • {r.date}</p>
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