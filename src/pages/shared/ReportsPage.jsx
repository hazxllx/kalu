import React from "react";
import { motion } from "framer-motion";
import PageHeader from "@/components/shared/PageHeader";
import { Card } from "@/components/shared/Card";
import DataTable from "@/components/shared/DataTable";
import { FileText, Download, TrendingUp } from "lucide-react";
import { monthlyConsultations } from "@/lib/mockData";
import { ResponsiveContainer, BarChart, Bar, XAxis, Tooltip, CartesianGrid } from "recharts";

const reportList = [
  { name: "Consultation Summary", period: "June 2026", records: 610, status: "Ready" },
  { name: "Immunization Coverage", period: "June 2026", records: 428, status: "Ready" },
  { name: "Follow-up Completion Rate", period: "June 2026", records: 512, status: "Ready" },
  { name: "Referral Report", period: "June 2026", records: 84, status: "Ready" },
  { name: "TCLS Summary", period: "June 2026", records: 124, status: "Ready" },
  { name: "M1 Summary", period: "June 2026", records: 32, status: "Ready" },
];

export default function ReportsPage() {
  const columns = [
    { key: "name", label: "Report" },
    { key: "period", label: "Period" },
    { key: "records", label: "Records" },
    { key: "status", label: "" },
  ];
  return (
    <>
      <PageHeader crumbs={["Home", "Reports"]} title="Reports" subtitle="Generate and export health program reports."
        action={<button className="flex items-center gap-2 bg-brand-blue text-white px-5 py-2.5 rounded-btn text-sm font-medium hover:bg-brand-dark transition-colors"><FileText className="w-4 h-4" /> Generate Monthly Report</button>} />

      <div className="grid lg:grid-cols-3 gap-5 mb-6">
        <Card className="p-6 lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-brand-ink">Monthly Consultations</h3>
            <span className="flex items-center gap-1 text-sm text-brand-green"><TrendingUp className="w-4 h-4" /> +17%</span>
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={monthlyConsultations}>
              <CartesianGrid vertical={false} stroke="#E5EAF1" />
              <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: "#5B6472", fontSize: 12 }} />
              <Tooltip cursor={{ fill: "#EDF6FF" }} contentStyle={{ borderRadius: 12, border: "1px solid #E5EAF1" }} />
              <Bar dataKey="value" fill="#0B5CAD" radius={[6, 6, 0, 0]} maxBarSize={40} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
        <Card className="p-6 h-fit">
          <h3 className="font-semibold text-brand-ink mb-4">Quick Stats</h3>
          {[
            { label: "Daily Patient Count", value: "42" },
            { label: "Health Service Utilization", value: "88%" },
            { label: "Program Accomplishment", value: "94%" },
          ].map((s) => (
            <div key={s.label} className="flex justify-between py-3 border-b border-brand-border last:border-0">
              <span className="text-sm text-brand-gray">{s.label}</span>
              <span className="font-stat font-bold text-brand-ink">{s.value}</span>
            </div>
          ))}
        </Card>
      </div>

      <DataTable columns={columns} rows={reportList} renderCell={(key, row) =>
        key === "status"
          ? <button className="flex items-center gap-1.5 text-sm text-brand-blue font-medium hover:underline"><Download className="w-4 h-4" /> Export</button>
          : row[key]} />
    </>
  );
}