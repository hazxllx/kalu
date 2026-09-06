import React from "react";
import { motion } from "framer-motion";
import Icon from "./Icon";

const TONES = {
  accent: "bg-brand-accent/10 text-brand-accent",
  blue: "bg-brand-blue/10 text-brand-blue",
  green: "bg-brand-green/10 text-brand-green",
  yellow: "bg-brand-yellow/15 text-[#B07E00]",
  danger: "bg-brand-danger/10 text-brand-danger",
};

export default function StatCard({ icon, label, value, tone = "accent", index = 0, onClick = null }) {
  const interactive = typeof onClick === "function";
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05, duration: 0.4 }}
      whileHover={{ y: interactive ? -3 : -2 }}
      onClick={onClick}
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      onKeyDown={interactive ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } } : undefined}
      className={`rounded-2xl border border-slate-200 bg-white p-5 shadow-card ${interactive ? "cursor-pointer hover:border-brand-blue focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/40" : ""}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className={`w-11 h-11 rounded-xl flex items-center justify-center ${TONES[tone]}`}>
          <Icon name={icon} className="w-5 h-5" strokeWidth={1.8} />
        </div>
        <div className="h-2.5 w-2.5 rounded-full bg-slate-200" />
      </div>
      <p className="mt-4 text-3xl font-stat font-extrabold text-slate-900 tracking-tight">{value}</p>
      <p className="mt-1 text-sm text-slate-600">{label}</p>
    </motion.div>
  );
}
