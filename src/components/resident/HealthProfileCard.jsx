import React from "react";
import { motion } from "framer-motion";
import { HeartPulse, ArrowRight, Check } from "lucide-react";

const FIELDS = [
  "Blood Type", "Height & Weight (BMI)", "Medical Conditions", "Allergies",
  "Current Medications", "Vaccination Status", "PWD Status",
  "Senior Citizen Status", "Pregnancy Status", "Emergency Contact",
];

export default function HealthProfileCard() {
  const completed = 3;
  const pct = Math.round((completed / FIELDS.length) * 100);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-white rounded-card border border-brand-border shadow-card overflow-hidden"
    >
      <div className="bg-gradient-to-r from-brand-blue to-brand-dark px-6 py-5 flex items-center gap-4">
        <div className="w-12 h-12 rounded-xl bg-white/15 flex items-center justify-center shrink-0">
          <HeartPulse className="w-6 h-6 text-white" strokeWidth={1.8} />
        </div>
        <div className="flex-1">
          <h3 className="font-heading font-semibold text-white text-lg">Complete Your Health Profile</h3>
          <p className="text-sm text-white/80 mt-0.5">Provide additional health details to help your health worker serve you better.</p>
        </div>
      </div>

      <div className="p-6">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-brand-ink">Profile Completion</span>
          <span className="text-sm font-stat font-bold text-brand-blue">{pct}%</span>
        </div>
        <div className="h-2 bg-brand-border rounded-full overflow-hidden">
          <motion.div initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 0.6 }} className="h-full bg-brand-blue rounded-full" />
        </div>

        <div className="mt-5 grid sm:grid-cols-2 gap-x-4 gap-y-2.5">
          {FIELDS.map((f, i) => (
            <div key={f} className="flex items-center gap-2">
              <div className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 ${i < completed ? "bg-brand-green/15" : "bg-brand-bg border border-brand-border"}`}>
                {i < completed && <Check className="w-3 h-3 text-brand-green" strokeWidth={3} />}
              </div>
              <span className={`text-sm ${i < completed ? "text-brand-ink font-medium" : "text-brand-gray"}`}>{f}</span>
            </div>
          ))}
        </div>

        <div className="mt-6 flex flex-col sm:flex-row gap-3">
          <button className="flex-1 flex items-center justify-center gap-2 bg-brand-blue text-white py-3 rounded-btn text-sm font-medium hover:bg-brand-dark transition-colors shadow-soft">
            Complete Health Profile <ArrowRight className="w-4 h-4" />
          </button>
          <button className="flex items-center justify-center gap-2 border border-brand-border text-brand-gray py-3 px-5 rounded-btn text-sm font-medium hover:bg-brand-bg transition-colors">
            Remind Me Later
          </button>
        </div>
      </div>
    </motion.div>
  );
}