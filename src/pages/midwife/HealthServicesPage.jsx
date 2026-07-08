import React from "react";
import { motion } from "framer-motion";
import PageHeader from "@/components/shared/PageHeader";
import StatusBadge from "@/components/shared/Badge";
import { Stethoscope, Syringe, Heart, Shield } from "lucide-react";

const MIDWIFE_SERVICES = [
  {
    name: "Medical Consultation",
    date: "Monday – Friday",
    time: "8:00 AM – 12:00 PM",
    description: "General consultation and assessment.",
    status: "Available",
    icon: Stethoscope,
    iconBg: "bg-brand-green/10",
    iconColor: "text-brand-green",
  },
  {
    name: "Immunization",
    date: "Tuesday & Thursday",
    time: "1:00 PM – 3:00 PM",
    description: "Routine vaccination services.",
    status: "Weekly",
    icon: Syringe,
    iconBg: "bg-brand-blue/10",
    iconColor: "text-brand-blue",
  },
  {
    name: "Cervical Screening",
    date: "Last Thursday",
    time: "8:00 AM – 12:00 PM",
    description: "Women's preventive screening services.",
    status: "Monthly",
    icon: Shield,
    iconBg: "bg-brand-yellow/15",
    iconColor: "text-[#B07E00]",
  },
  {
    name: "Distribution of Hypertension / Diabetic Medication",
    date: "Monday & Wednesday",
    time: "8:00 AM – 12:00 PM",
    description: "Medication distribution for chronic disease management.",
    status: "Scheduled",
    icon: Heart,
    iconBg: "bg-brand-purple/10",
    iconColor: "text-brand-purple",
  },
];

export default function HealthServicesPage() {
  return (
    <>
      <PageHeader crumbs={["Home", "Health Services"]} title="Health Services" subtitle="Ongoing healthcare services at the Barangay Health Station." />
      <div className="grid sm:grid-cols-2 gap-4 sm:gap-5">
        {MIDWIFE_SERVICES.map((s, i) => (
          <motion.div key={s.name} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}
            className="bg-white rounded-card border border-brand-border shadow-card p-4 sm:p-5 h-full flex flex-col">
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-3 flex-1">
                <div className={`w-9 h-9 sm:w-10 sm:h-10 rounded-xl ${s.iconBg} flex items-center justify-center shrink-0`}>
                  <s.icon className={`w-4 h-4 sm:w-5 sm:h-5 ${s.iconColor}`} strokeWidth={1.8} />
                </div>
                <h3 className="font-semibold text-brand-ink text-sm sm:text-base leading-tight">{s.name}</h3>
              </div>
              <StatusBadge value={s.status} />
            </div>
            <div className="space-y-1.5 text-sm text-brand-gray flex-1">
              <p className="text-brand-ink font-medium">{s.date}</p>
              <p>{s.time}</p>
              <p className="line-clamp-1">{s.description}</p>
            </div>
          </motion.div>
        ))}
      </div>
    </>
  );
}