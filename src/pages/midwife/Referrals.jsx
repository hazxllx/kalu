import React from "react";
import { motion } from "framer-motion";
import PageHeader from "@/components/shared/PageHeader";
import { Card } from "@/components/shared/Card";
import StatusBadge from "@/components/shared/Badge";
import { Send, ArrowDownLeft, Building2, FileText, Plus } from "lucide-react";
import { referrals } from "@/lib/mockData";

export default function Referrals() {
  return (
    <>
      <PageHeader crumbs={["Home", "Referrals"]} title="Referrals" subtitle="Track outgoing and incoming patient referrals."
        action={<button className="flex items-center gap-2 bg-brand-blue text-white px-5 py-2.5 rounded-btn text-sm font-medium hover:bg-brand-dark transition-colors"><Plus className="w-4 h-4" /> New Referral</button>} />
      <div className="grid lg:grid-cols-2 gap-5">
        {referrals.map((r, i) => (
          <motion.div key={r.resident} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }}>
            <Card className="p-6">
              <div className="flex items-center justify-between">
                <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full ${r.direction === "Outgoing" ? "bg-brand-accent/10 text-brand-accent" : "bg-brand-blue/10 text-brand-blue"}`}>
                  {r.direction === "Outgoing" ? <Send className="w-3.5 h-3.5" /> : <ArrowDownLeft className="w-3.5 h-3.5" />} {r.direction}
                </span>
                <StatusBadge value={r.status} />
              </div>
              <h3 className="mt-4 font-semibold text-brand-ink">{r.resident}</h3>
              <div className="mt-3 space-y-2 text-sm text-brand-gray">
                <p className="flex items-center gap-2"><Building2 className="w-4 h-4 text-brand-blue" /> {r.facility}</p>
                <p className="flex items-center gap-2"><FileText className="w-4 h-4 text-brand-blue" /> {r.reason}</p>
              </div>
            </Card>
          </motion.div>
        ))}
      </div>
    </>
  );
}