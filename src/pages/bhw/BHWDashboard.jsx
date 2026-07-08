import React from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import PageHeader from "@/components/shared/PageHeader";
import StatCard from "@/components/shared/StatCard";
import { Card } from "@/components/shared/Card";
import StatusBadge from "@/components/shared/Badge";
import { bhwDashboard, residents, followUps } from "@/lib/mockData";
import { ShieldCheck, ChevronRight } from "lucide-react";

const PENDING_VERIFICATIONS = [
  { name: "Juan Dela Cruz Reyes", ref: "KSG-2026-00428", date: "July 5, 2026" },
  { name: "Maria Santos Lopez", ref: "KSG-2026-00427", date: "July 4, 2026" },
  { name: "Roberto Aguilar Cruz", ref: "KSG-2026-00425", date: "July 4, 2026" },
];

export default function BHWDashboard() {
  return (
    <>
      <PageHeader crumbs={["Home", "Dashboard"]} title="Good morning, Maria" subtitle="Here's what needs your attention today in Barangay San Jose." />
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-3 sm:gap-4 mb-6">
        {bhwDashboard.map((s, i) => <StatCard key={s.label} {...s} index={i} />)}
      </div>

      {/* Pending Verifications Widget */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="mb-6">
        <Card className="overflow-hidden">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between px-4 sm:px-6 pt-4 sm:pt-5 pb-3 sm:pb-4 border-b border-brand-border gap-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-brand-yellow/15 flex items-center justify-center shrink-0">
                <ShieldCheck className="w-5 h-5 text-[#B07E00]" strokeWidth={1.8} />
              </div>
              <div>
                <h3 className="font-heading font-semibold text-brand-ink text-sm sm:text-base">Pending Resident Verifications</h3>
                <p className="text-xs text-brand-gray">{PENDING_VERIFICATIONS.length} residents awaiting identity review</p>
              </div>
            </div>
            <Link to="/app/bhw/verifications" className="flex items-center gap-1 text-sm font-medium text-brand-blue hover:underline shrink-0">
              View All <ChevronRight className="w-4 h-4" />
            </Link>
          </div>
          <div className="divide-y divide-brand-border">
            {PENDING_VERIFICATIONS.map((r) => (
              <div key={r.ref} className="flex flex-col sm:flex-row sm:items-center sm:justify-between px-4 sm:px-6 py-3 hover:bg-brand-bg/50 transition-colors gap-2">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full bg-brand-light text-brand-blue flex items-center justify-center text-xs font-heading font-semibold shrink-0">
                    {r.name.split(" ").map((n) => n[0]).slice(0, 2).join("")}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-brand-ink">{r.name}</p>
                    <p className="text-xs text-brand-gray">{r.ref} — {r.date}</p>
                  </div>
                </div>
                <Link to="/app/bhw/verification/review" className="text-sm font-medium text-brand-blue hover:underline shrink-0">Review</Link>
              </div>
            ))}
          </div>
        </Card>
      </motion.div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-5">
        <Card className="p-4 sm:p-6">
          <h3 className="font-semibold text-brand-ink text-sm sm:text-base mb-4">Today's Follow-ups</h3>
          <div className="space-y-3">
            {followUps.filter((f) => f.status === "Today").map((f) => (
              <div key={f.resident} className="flex flex-col sm:flex-row sm:items-center sm:justify-between border border-brand-border rounded-btn px-4 py-3 gap-2">
                <div>
                  <p className="font-medium text-brand-ink text-sm">{f.resident}</p>
                  <p className="text-xs text-brand-gray">{f.purpose} · {f.location}</p>
                </div>
                <StatusBadge value={f.priority} />
              </div>
            ))}
          </div>
        </Card>
        <Card className="p-4 sm:p-6">
          <h3 className="font-semibold text-brand-ink text-sm sm:text-base mb-4">High Risk Residents</h3>
          <div className="space-y-3">
            {residents.filter((r) => r.risk === "High").map((r) => (
              <div key={r.id} className="flex flex-col sm:flex-row sm:items-center sm:justify-between border border-brand-border rounded-btn px-4 py-3 gap-2">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full bg-brand-light text-brand-blue flex items-center justify-center text-sm font-semibold shrink-0">{r.name.split(" ").map(n=>n[0]).slice(0,2).join("")}</div>
                  <div>
                    <p className="font-medium text-brand-ink text-sm">{r.name}</p>
                    <p className="text-xs text-brand-gray">{r.age} yrs · {r.program}</p>
                  </div>
                </div>
                <StatusBadge value="High" />
              </div>
            ))}
          </div>
        </Card>
      </div>
    </>
  );
}