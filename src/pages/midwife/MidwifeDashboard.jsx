import React from "react";
import PageHeader from "@/components/shared/PageHeader";
import StatCard from "@/components/shared/StatCard";
import { Card } from "@/components/shared/Card";
import StatusBadge from "@/components/shared/Badge";
import { Plus, FileHeart, Send, CalendarCheck, ClipboardList } from "lucide-react";
import { midwifeStats, healthServices } from "@/lib/mockData";

const actions = [
  { icon: Plus, label: "New Consultation" },
  { icon: CalendarCheck, label: "Record Follow-up" },
  { icon: ClipboardList, label: "Update TCLS" },
  { icon: FileHeart, label: "Update M1" },
  { icon: Send, label: "Refer Patient" },
];

export default function MidwifeDashboard() {
  return (
    <>
      <PageHeader crumbs={["Home", "Dashboard"]} title="Welcome, Midwife Maria Dela Cruz" subtitle="Today's clinical summary for the Barangay Health Station." />
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 sm:gap-4 mb-6">
        {midwifeStats.map((s, i) => <StatCard key={s.label} {...s} index={i} />)}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-5">
        <Card className="p-4 sm:p-6 lg:col-span-2">
          <h3 className="font-semibold text-brand-ink text-sm sm:text-base mb-4">Ongoing Health Services</h3>
          <div className="space-y-3">
            {healthServices.slice(0, 5).map((s) => (
              <div key={s.name} className="flex flex-col sm:flex-row sm:items-center sm:justify-between border border-brand-border rounded-btn px-4 py-3 gap-2">
                <div>
                  <p className="font-medium text-brand-ink text-sm">{s.name}</p>
                  <p className="text-xs text-brand-gray">{s.schedule} · {s.enrolled} enrolled</p>
                </div>
                <StatusBadge value={s.status} />
              </div>
            ))}
          </div>
        </Card>

        <Card className="p-4 sm:p-6 h-fit">
          <h3 className="font-semibold text-brand-ink text-sm sm:text-base mb-4">Quick Actions</h3>
          <div className="space-y-2.5">
            {actions.map((a) => (
              <button key={a.label} className="w-full flex items-center gap-3 border border-brand-border rounded-btn px-4 py-3 text-sm font-medium text-brand-ink hover:border-brand-blue hover:bg-brand-light transition-colors">
                <a.icon className="w-4 h-4 text-brand-blue" /> {a.label}
              </button>
            ))}
          </div>
        </Card>
      </div>
    </>
  );
}