import React from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import {
  Bell, Stethoscope, User, Settings,
  FileHeart, ClipboardList, CalendarClock, Lock, ArrowRight,
} from "lucide-react";
import PageHeader from "@/components/shared/PageHeader";
import VerificationBanner from "@/components/shared/VerificationBanner";
import VerificationBadge from "@/components/shared/VerificationBadge";

const AVAILABLE = [
  { icon: Stethoscope, label: "Health Services", desc: "Browse available health services and schedules.", path: "/app/resident-limited/services", tone: "bg-brand-blue/10 text-brand-blue" },
  { icon: Bell, label: "Notifications", desc: "View barangay updates and reminders.", path: "/app/resident-limited/announcements", tone: "bg-brand-accent/10 text-brand-accent" },
  { icon: User, label: "My Profile", desc: "View and update your personal information.", path: "/app/resident-limited/profile", tone: "bg-brand-green/10 text-brand-green" },
  { icon: Settings, label: "Settings", desc: "Manage your account settings and preferences.", path: "/app/resident-limited/settings", tone: "bg-brand-gray/10 text-brand-gray" },
];

const LOCKED = [
  { icon: FileHeart, label: "My Health Records", desc: "Personal and medical history records." },
  { icon: ClipboardList, label: "Consultation History", desc: "Past consultations and treatment records." },
  { icon: CalendarClock, label: "Follow-ups", desc: "Scheduled and completed follow-up visits." },
];

export default function LimitedResidentDashboard() {
  return (
    <>
      <PageHeader
        crumbs={["Home", "Dashboard"]}
        title="Welcome, Juan"
        subtitle="Your account is pending verification. Some features are temporarily locked."
      />

      <div className="mb-6">
        <VerificationBanner />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4 sm:gap-5">
        {AVAILABLE.map((m, i) => (
          <motion.div key={m.label} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
            <Link to={m.path} className="block bg-white rounded-card border border-brand-border shadow-card p-4 sm:p-5 hover:shadow-float hover:border-brand-blue/30 transition-all group">
              <div className={`w-10 h-10 sm:w-11 sm:h-11 rounded-xl flex items-center justify-center ${m.tone}`}>
                <m.icon className="w-4 h-4 sm:w-5 sm:h-5" strokeWidth={1.8} />
              </div>
              <h3 className="mt-3 sm:mt-4 font-heading font-semibold text-brand-ink text-sm">{m.label}</h3>
              <p className="mt-1 text-xs text-brand-gray line-clamp-2">{m.desc}</p>
              <div className="mt-3 flex items-center gap-1.5 text-xs font-medium text-brand-blue opacity-0 group-hover:opacity-100 transition-opacity">
                Open <ArrowRight className="w-3.5 h-3.5" />
              </div>
            </Link>
          </motion.div>
        ))}

        {LOCKED.map((m, i) => (
          <motion.div key={m.label} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: (AVAILABLE.length + i) * 0.05 }}
            className="bg-white rounded-card border border-brand-border shadow-card p-4 sm:p-5 relative overflow-hidden">
            <div className="flex items-start justify-between">
              <div className="w-10 h-10 sm:w-11 sm:h-11 rounded-xl flex items-center justify-center bg-slate-100 text-brand-gray">
                <m.icon className="w-4 h-4 sm:w-5 sm:h-5" strokeWidth={1.8} />
              </div>
              <div className="flex items-center gap-1.5 text-xs font-body font-medium text-brand-gray/60 bg-slate-50 rounded-full px-2.5 py-1">
                <Lock className="w-3 h-3" strokeWidth={2} /> Locked
              </div>
            </div>
            <h3 className="mt-3 sm:mt-4 font-heading font-semibold text-brand-gray text-sm">{m.label}</h3>
            <p className="mt-1 text-xs text-brand-gray/70 line-clamp-2">{m.desc}</p>
            <div className="mt-3 bg-brand-bg rounded-btn px-3 py-2">
              <p className="text-xs text-brand-gray">Available after account verification.</p>
            </div>
          </motion.div>
        ))}
      </div>
    </>
  );
}