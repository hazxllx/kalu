import React from "react";
import { motion } from "framer-motion";
import PageHeader from "@/components/common/PageHeader";
import { Card } from "@/components/common/Card";
import StatusBadge from "@/components/common/StatusBadge";
import { HeartPulse } from "lucide-react";

const programs = [
  { name: "Maternal & Child Health", enrolled: 428, coverage: 92, status: "Ongoing" },
  { name: "Expanded Program on Immunization", enrolled: 610, coverage: 89, status: "Ongoing" },
  { name: "Hypertension & Diabetes Care", enrolled: 340, coverage: 78, status: "Ongoing" },
  { name: "TB DOTS Program", enrolled: 96, coverage: 84, status: "Ongoing" },
  { name: "Family Planning", enrolled: 512, coverage: 71, status: "Ongoing" },
  { name: "Nutrition Program", enrolled: 280, coverage: 88, status: "Scheduled" },
];

export default function Programs() {
  return (
    <>
      <PageHeader crumbs={["Home", "Health Programs"]} title="Health Programs" subtitle="Municipal health programs and their coverage." />
      <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-5">
        {programs.map((p, i) => (
          <motion.div key={p.name} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
            <Card className="p-6">
              <div className="flex items-start justify-between">
                <div className="w-11 h-11 rounded-xl bg-brand-light text-brand-blue flex items-center justify-center"><HeartPulse className="w-5 h-5" /></div>
                <StatusBadge value={p.status} />
              </div>
              <h3 className="mt-4 font-semibold text-brand-ink">{p.name}</h3>
              <p className="text-sm text-brand-gray mt-1">{p.enrolled} residents enrolled</p>
              <div className="mt-4">
                <div className="flex justify-between text-xs text-brand-gray mb-1.5"><span>Coverage</span><span>{p.coverage}%</span></div>
                <div className="h-2 bg-brand-border rounded-full overflow-hidden"><div className="h-full bg-brand-green rounded-full" style={{ width: `${p.coverage}%` }} /></div>
              </div>
            </Card>
          </motion.div>
        ))}
      </div>
    </>
  );
}