import React, { useState } from "react";
import { motion } from "framer-motion";
import { CalendarClock, ShieldCheck, Stethoscope, ShieldAlert, Activity } from "lucide-react";
import PageHeader from "@/components/shared/PageHeader";
import { Card } from "@/components/shared/Card";
import StatusBadge from "@/components/shared/Badge";
import VerificationBadge from "@/components/shared/VerificationBadge";
import VerificationModal from "@/components/shared/VerificationModal";
import { residentDashboard, residentTimeline } from "@/lib/mockData";

const timelineColor = {
  green: "bg-brand-green", accent: "bg-brand-accent", blue: "bg-brand-blue",
  yellow: "bg-brand-yellow", danger: "bg-brand-danger",
};

export default function ResidentDashboard() {
  const [verifyModal, setVerifyModal] = useState(false);
  const verified = true;
  const cards = [
    { icon: CalendarClock, tone: "bg-brand-accent/10 text-brand-accent", label: "Upcoming Follow-up", main: residentDashboard.followUp.date, sub: `${residentDashboard.followUp.time} · ${residentDashboard.followUp.place}` },
    { icon: ShieldCheck, tone: "bg-brand-green/10 text-brand-green", label: "Health Risk Level", main: residentDashboard.risk, sub: "Stable — keep it up!" },
    { icon: Stethoscope, tone: "bg-brand-yellow/15 text-[#B07E00]", label: "Last Check-up", main: residentDashboard.lastCheck, sub: "General Consultation" },
  ];

  return (
    <>
      <PageHeader
        crumbs={["Home", "Dashboard"]}
        title={<span className="flex items-center gap-3">Welcome back, Maria Santos <VerificationBadge status={verified ? "verified" : "pending"} /></span>}
        subtitle="Here's an overview of your health at a glance."
      />

      {!verified && (
        <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="mb-6">
          <div className="bg-brand-yellow/10 border border-brand-yellow/20 rounded-card p-5 flex items-start gap-4">
            <div className="w-10 h-10 rounded-xl bg-brand-yellow/20 flex items-center justify-center shrink-0">
              <ShieldAlert className="w-5 h-5 text-[#B07E00]" strokeWidth={1.8} />
            </div>
            <div className="flex-1">
              <h3 className="font-heading font-semibold text-brand-ink">Account Verification Required</h3>
              <p className="mt-1 text-sm text-brand-gray">
                Some features remain unavailable until your Barangay Health Worker completes your verification.
              </p>
            </div>
            <button
              onClick={() => setVerifyModal(true)}
              className="shrink-0 bg-brand-blue text-white px-4 py-2.5 rounded-btn text-sm font-medium hover:bg-brand-dark transition-colors"
            >
              View Verification Status
            </button>
          </div>
        </motion.div>
      )}


      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5">
        {cards.map((c, i) => (
          <motion.div key={c.label} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }}
            className="bg-white rounded-card border border-brand-border shadow-card p-4 sm:p-5">
            <div className={`w-10 h-10 sm:w-11 sm:h-11 rounded-xl flex items-center justify-center ${c.tone}`}><c.icon className="w-4 h-4 sm:w-5 sm:h-5" strokeWidth={1.8} /></div>
            <p className="mt-3 sm:mt-4 text-xs text-brand-gray uppercase tracking-wide">{c.label}</p>
            <p className="mt-1 text-lg sm:text-xl font-semibold text-brand-ink">{c.main}</p>
            <p className="mt-0.5 text-sm text-brand-gray line-clamp-2">{c.sub}</p>
          </motion.div>
        ))}
      </div>

      <Card className="mt-6 p-4 sm:p-6">
        <div className="flex items-center gap-3 mb-4 sm:mb-6">
          <div className="w-10 h-10 rounded-xl bg-brand-blue/10 flex items-center justify-center">
            <Activity className="w-5 h-5 text-brand-blue" strokeWidth={1.8} />
          </div>
          <div>
            <h3 className="font-semibold text-brand-ink text-sm sm:text-base">Ongoing Health Services</h3>
            <p className="text-sm text-brand-gray">Services currently available at the health center</p>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {[
            "Medical Consultation",
            "Dental Services",
            "Immunization",
            "Risk Assessment / Visual Acuity / PWD Screening",
            "Distribution of Hypertension / Diabetic Medication",
            "Cervical Screening",
            "Nutrition Operation Timbang",
            "Nutrition Deworming",
            "Nutrition Micronutrient Supplement",
            "TB Program",
            "Family Planning",
            "Pre-Natal",
            "Adolescent Health",
            "HIV Screening (as scheduled)",
            "Anti-Rabies Vaccination"
          ].map((service, i) => (
            <motion.div
              key={service}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.03 }}
              className="rounded-lg border border-brand-border bg-brand-bg p-3 text-sm text-brand-ink hover:border-brand-blue/30 transition-colors"
            >
              {service}
            </motion.div>
          ))}
        </div>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-5 mt-6">
        <Card className="lg:col-span-2 p-4 sm:p-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-4 sm:mb-6 gap-2">
            <h3 className="font-semibold text-brand-ink text-sm sm:text-base">Health Timeline</h3>
            <StatusBadge value="Active" />
          </div>
          <div className="relative pl-4 sm:pl-6">
            <div className="absolute left-[5px] sm:left-[7px] top-1 bottom-1 w-px bg-brand-border" />
            {residentTimeline.map((t, i) => (
              <motion.div key={i} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.08 }} className="relative pb-5 sm:pb-7 last:pb-0">
                <span className={`absolute -left-4 sm:-left-6 top-1 w-3 sm:w-3.5 h-3 sm:h-3.5 rounded-full ring-4 ring-white ${timelineColor[t.color]}`} />
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-medium text-brand-blue bg-brand-light px-2 py-0.5 rounded-full">{t.type}</span>
                  <span className="text-xs text-brand-gray">{t.date}</span>
                </div>
                <p className="mt-1.5 font-medium text-brand-ink">{t.title}</p>
                <p className="text-sm text-brand-gray line-clamp-2">{t.desc}</p>
              </motion.div>
            ))}
          </div>
        </Card>
      </div>

      <VerificationModal open={verifyModal} onClose={() => setVerifyModal(false)} />
    </>
  );
}