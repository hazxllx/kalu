import React from "react";
import { motion } from "framer-motion";
import PageHeader from "@/components/shared/PageHeader";
import { Card } from "@/components/shared/Card";
import { Users, Droplet, Home, Wallet, Plus } from "lucide-react";
import { households } from "@/lib/mockData";

function riskColor(score) {
  if (score >= 60) return "text-brand-danger bg-brand-danger/10";
  if (score >= 40) return "text-[#B07E00] bg-brand-yellow/15";
  return "text-brand-green bg-brand-green/10";
}

export default function Households() {
  return (
    <>
      <PageHeader crumbs={["Home", "Household Profiling"]} title="Household Profiling" subtitle="Household conditions and risk assessment across the barangay."
        action={<button className="flex items-center gap-2 bg-brand-blue text-white px-5 py-2.5 rounded-btn text-sm font-medium hover:bg-brand-dark transition-colors"><Plus className="w-4 h-4" /> Add Household</button>} />
      <div className="grid md:grid-cols-2 gap-5">
        {households.map((h, i) => (
          <motion.div key={h.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }}>
            <Card className="p-6">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs text-brand-gray">{h.id}</p>
                  <h3 className="font-semibold text-brand-ink mt-0.5">{h.address}</h3>
                </div>
                <div className={`text-center rounded-xl px-3 py-2 ${riskColor(h.riskScore)}`}>
                  <p className="font-stat font-bold text-lg leading-none">{h.riskScore}</p>
                  <p className="text-[10px] uppercase tracking-wide mt-0.5">Risk</p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 mt-5 text-sm">
                <p className="flex items-center gap-2 text-brand-gray"><Users className="w-4 h-4 text-brand-blue" /> {h.members} members</p>
                <p className="flex items-center gap-2 text-brand-gray"><Wallet className="w-4 h-4 text-brand-blue" /> {h.income}</p>
                <p className="flex items-center gap-2 text-brand-gray"><Droplet className="w-4 h-4 text-brand-blue" /> {h.water}</p>
                <p className="flex items-center gap-2 text-brand-gray"><Home className="w-4 h-4 text-brand-blue" /> {h.toilet}</p>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                {h.concerns.map((c) => <span key={c} className="text-xs bg-brand-light text-brand-blue px-2.5 py-1 rounded-full">{c}</span>)}
              </div>
            </Card>
          </motion.div>
        ))}
      </div>
    </>
  );
}