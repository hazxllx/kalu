import React from "react";
import { motion } from "framer-motion";
import PageHeader from "@/components/common/PageHeader";
import { Card } from "@/components/common/Card";
import StatusBadge from "@/components/common/StatusBadge";
import { Baby, Calendar, Activity } from "lucide-react";
import { m1Records } from "@/services/mock/mockData";

export default function M1Records() {
  return (
    <>
      <PageHeader crumbs={["Home", "M1 Records"]} title="M1 — Maternal Records" subtitle="Manage maternal health records for prenatal clients." />
      <div className="grid lg:grid-cols-2 gap-5">
        {m1Records.map((m, i) => (
          <motion.div key={m.resident} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }}>
            <Card className="p-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-11 h-11 rounded-xl bg-brand-light text-brand-blue flex items-center justify-center"><Baby className="w-5 h-5" /></div>
                  <div>
                    <h3 className="font-semibold text-brand-ink">{m.resident}</h3>
                    <p className="text-xs text-brand-gray">Prenatal · {m.prenatalVisits} visits</p>
                  </div>
                </div>
                <StatusBadge value={m.risk} />
              </div>
              <div className="grid grid-cols-2 gap-4 mt-5 text-sm">
                <div className="bg-brand-bg rounded-btn p-3">
                  <p className="text-xs text-brand-gray flex items-center gap-1.5"><Calendar className="w-3.5 h-3.5" /> LMP</p>
                  <p className="font-medium text-brand-ink mt-1">{m.lmp}</p>
                </div>
                <div className="bg-brand-bg rounded-btn p-3">
                  <p className="text-xs text-brand-gray flex items-center gap-1.5"><Calendar className="w-3.5 h-3.5" /> Expected Delivery</p>
                  <p className="font-medium text-brand-ink mt-1">{m.edd}</p>
                </div>
              </div>
              <div className="mt-4">
                <div className="flex justify-between text-xs text-brand-gray mb-1.5"><span>Prenatal progress</span><span>{m.prenatalVisits}/8 visits</span></div>
                <div className="h-2 bg-brand-border rounded-full overflow-hidden">
                  <div className="h-full bg-brand-blue rounded-full" style={{ width: `${(m.prenatalVisits / 8) * 100}%` }} />
                </div>
              </div>
              <div className="mt-4 flex items-center gap-2 text-sm text-brand-gray">
                <Activity className="w-4 h-4 text-brand-green" /> Status: <span className="text-brand-ink font-medium">{m.status}</span>
              </div>
            </Card>
          </motion.div>
        ))}
      </div>
    </>
  );
}