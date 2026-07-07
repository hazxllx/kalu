import React from "react";
import PageHeader from "@/components/shared/PageHeader";
import StatCard from "@/components/shared/StatCard";
import { Card } from "@/components/shared/Card";
import DataTable from "@/components/shared/DataTable";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import { barangayOverview, monthlyConsultations } from "@/lib/mockData";

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
  return (
    <>
      <PageHeader crumbs={["Home", "Dashboard"]} title="RHU Overview" subtitle="Municipality of Pili — community health at a glance." />
      <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
        {stats.map((s, i) => <StatCard key={s.label} {...s} index={i} />)}
      </div>
      <div className="grid lg:grid-cols-3 gap-5">
        <Card className="p-6 lg:col-span-2">
          <h3 className="font-semibold text-brand-ink mb-4">Disease Trend — Monthly Consultations</h3>
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={monthlyConsultations}>
              <CartesianGrid vertical={false} stroke="#E5EAF1" />
              <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: "#5B6472", fontSize: 12 }} />
              <YAxis axisLine={false} tickLine={false} tick={{ fill: "#5B6472", fontSize: 12 }} />
              <Tooltip contentStyle={{ borderRadius: 12, border: "1px solid #E5EAF1" }} />
              <Line type="monotone" dataKey="value" stroke="#0B5CAD" strokeWidth={3} dot={{ r: 4, fill: "#0B5CAD" }} />
            </LineChart>
          </ResponsiveContainer>
        </Card>
        <Card className="p-6 h-fit">
          <h3 className="font-semibold text-brand-ink mb-4">Referral Status</h3>
          {[
            { label: "Pending", value: 12, color: "bg-brand-yellow" },
            { label: "Accepted", value: 48, color: "bg-brand-green" },
            { label: "Completed", value: 84, color: "bg-brand-blue" },
          ].map((r) => (
            <div key={r.label} className="mb-4">
              <div className="flex justify-between text-sm mb-1.5"><span className="text-brand-gray">{r.label}</span><span className="font-medium text-brand-ink">{r.value}</span></div>
              <div className="h-2 bg-brand-border rounded-full overflow-hidden"><div className={`h-full ${r.color} rounded-full`} style={{ width: `${r.value}%` }} /></div>
            </div>
          ))}
        </Card>
      </div>
      <div className="mt-6">
        <h3 className="font-semibold text-brand-ink mb-4">Barangay Overview</h3>
        <DataTable columns={columns} rows={barangayOverview} />
      </div>
    </>
  );
}