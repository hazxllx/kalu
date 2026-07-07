import React from "react";
import { motion } from "framer-motion";
import PageHeader from "@/components/shared/PageHeader";
import { Card } from "@/components/shared/Card";
import StatusBadge from "@/components/shared/Badge";
import { Clock, User, Users } from "lucide-react";
import { healthServices } from "@/lib/mockData";

export default function HealthServicesPage() {
  return (
    <>
      <PageHeader crumbs={["Home", "Health Services"]} title="Health Services" subtitle="Ongoing healthcare services at the Barangay Health Station." />
      <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-5">
        {healthServices.map((s, i) => (
          <motion.div key={s.name} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
            <Card className="p-6">
              <div className="flex items-start justify-between">
                <h3 className="font-semibold text-brand-ink">{s.name}</h3>
                <StatusBadge value={s.status} />
              </div>
              <div className="mt-4 space-y-2 text-sm text-brand-gray">
                <p className="flex items-center gap-2"><Clock className="w-4 h-4 text-brand-accent" /> {s.schedule}</p>
                <p className="flex items-center gap-2"><User className="w-4 h-4 text-brand-blue" /> {s.personnel}</p>
                <p className="flex items-center gap-2"><Users className="w-4 h-4 text-brand-green" /> {s.enrolled} residents enrolled</p>
              </div>
            </Card>
          </motion.div>
        ))}
      </div>
    </>
  );
}