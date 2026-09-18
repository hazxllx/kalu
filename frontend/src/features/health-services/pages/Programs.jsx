import React from "react";
import { motion } from "framer-motion";
import PageHeader from "@/components/common/PageHeader";
import { Card } from "@/components/common/Card";
import StatusBadge from "@/components/common/StatusBadge";
import { HeartPulse } from "lucide-react";

const programs = [];

export default function Programs() {
  return (
    <>
      <PageHeader crumbs={["Health Programs"]} title="Health Programs" subtitle="Municipal health programs and their coverage." />
      {programs.length === 0 ? (
        <Card className="p-12 text-center">
          <HeartPulse className="mx-auto h-10 w-10 text-brand-gray/50" />
          <p className="mt-3 text-sm text-brand-gray">No health programs yet.</p>
        </Card>
      ) : (
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
      )}
    </>
  );
}