import React from "react";
import { motion } from "framer-motion";
import PageHeader from "@/components/shared/PageHeader";
import { Card } from "@/components/shared/Card";
import { MapPin, Users, AlertTriangle, Syringe } from "lucide-react";
import { barangayOverview } from "@/lib/mockData";

export default function Barangays() {
  return (
    <>
      <PageHeader crumbs={["Home", "Barangays"]} title="Barangays" subtitle="Health profile of every connected barangay." />
      <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-5">
        {barangayOverview.map((b, i) => (
          <motion.div key={b.name} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }} whileHover={{ y: -4 }}>
            <Card className="p-6">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-xl bg-brand-light text-brand-blue flex items-center justify-center"><MapPin className="w-5 h-5" /></div>
                <h3 className="font-semibold text-brand-ink">Brgy. {b.name}</h3>
              </div>
              <div className="mt-5 space-y-3 text-sm">
                <p className="flex items-center justify-between"><span className="flex items-center gap-2 text-brand-gray"><Users className="w-4 h-4" /> Residents</span><span className="font-medium text-brand-ink">{b.residents.toLocaleString()}</span></p>
                <p className="flex items-center justify-between"><span className="flex items-center gap-2 text-brand-gray"><AlertTriangle className="w-4 h-4" /> High Risk</span><span className="font-medium text-brand-danger">{b.highRisk}</span></p>
                <p className="flex items-center justify-between"><span className="flex items-center gap-2 text-brand-gray"><Syringe className="w-4 h-4" /> Vax Coverage</span><span className="font-medium text-brand-green">{b.coverage}</span></p>
              </div>
            </Card>
          </motion.div>
        ))}
      </div>
    </>
  );
}