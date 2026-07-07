import React from "react";
import { motion } from "framer-motion";
import PageHeader from "@/components/shared/PageHeader";
import Icon from "@/components/shared/Icon";
import { Clock, ClipboardCheck } from "lucide-react";
import { services } from "@/lib/mockData";

const details = {
  Consultation: { hours: "Mon–Fri, 8:00 AM – 12:00 PM", req: "Barangay ID, PhilHealth (optional)" },
  Immunization: { hours: "Tue & Thu, 1:00 PM – 3:00 PM", req: "Child's immunization card" },
  "Maternal Care": { hours: "Wed, 9:00 AM – 12:00 PM", req: "Prenatal booklet" },
  "Child Health": { hours: "Mon & Fri, 9:00 AM – 11:00 AM", req: "Child's health record" },
  "Senior Citizen Care": { hours: "Last Fri of month", req: "Senior Citizen ID" },
  "Family Planning": { hours: "Wed, 1:00 PM – 4:00 PM", req: "Valid ID" },
  "Dental Services": { hours: "Thu, 8:00 AM – 12:00 PM", req: "Barangay ID" },
  "Medical Certificates": { hours: "Mon–Fri, 8:00 AM – 4:00 PM", req: "Barangay ID, purpose" },
};

export default function HealthServices() {
  return (
    <>
      <PageHeader crumbs={["Home", "Health Services"]} title="Health Services" subtitle="Available services, hours, and requirements at your barangay." />
      <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-5">
        {services.map((s, i) => {
          const d = details[s.name] || {};
          return (
            <motion.div key={s.name} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }} whileHover={{ y: -4 }}
              className="bg-white rounded-card border border-brand-border shadow-card p-6">
              <div className="w-12 h-12 rounded-xl bg-brand-light text-brand-blue flex items-center justify-center"><Icon name={s.icon} className="w-6 h-6" strokeWidth={1.6} /></div>
              <h3 className="mt-4 font-semibold text-brand-ink">{s.name}</h3>
              <div className="mt-3 space-y-2 text-sm text-brand-gray">
                <p className="flex gap-2"><Clock className="w-4 h-4 shrink-0 mt-0.5 text-brand-accent" /> {d.hours}</p>
                <p className="flex gap-2"><ClipboardCheck className="w-4 h-4 shrink-0 mt-0.5 text-brand-green" /> {d.req}</p>
              </div>
              <button className="mt-5 w-full border border-brand-border rounded-btn py-2.5 text-sm font-medium text-brand-blue hover:bg-brand-light transition-colors">Book Inquiry</button>
            </motion.div>
          );
        })}
      </div>
    </>
  );
}