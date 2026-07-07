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

export default function StatCard({ icon, label, value, tone = "accent", index = 0 }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05, duration: 0.4 }}
      whileHover={{ y: -3 }}
      className="bg-white rounded-card border border-brand-border shadow-card p-5"
    >
      <div className={`w-11 h-11 rounded-xl flex items-center justify-center ${TONES[tone]}`}>
        <Icon name={icon} className="w-5 h-5" strokeWidth={1.8} />
      </div>
      <p className="mt-4 text-3xl font-stat font-extrabold text-brand-ink tracking-tight">{value}</p>
      <p className="mt-1 text-sm text-brand-gray">{label}</p>
    </motion.div>
  );
}