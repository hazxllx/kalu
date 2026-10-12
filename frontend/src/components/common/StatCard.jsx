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

// Solid tone used for the subtle colored bottom indicator (opt-in).
const BAR_TONES = {
  accent: "bg-brand-accent",
  blue: "bg-brand-blue",
  green: "bg-brand-green",
  yellow: "bg-brand-yellow",
  danger: "bg-brand-danger",
};

/**
 * Shared KPI card.
 *
 * Backwards compatible: existing call sites pass only
 * `{ icon, label, value, tone, index, onClick }` and render exactly as before
 * (a lightly tinted icon square and a muted top-right dot).
 *
 * Opt-in props used by the compact PHN Check-ups dashboard:
 *   - compact:   trims padding and type scale so four cards fit one row.
 *   - indicator: draws a subtle colored bottom bar (tone-matched) instead of
 *                the top-right dot, matching the reference KPI treatment.
 *   - active:    highlights the card when it represents the active filter.
 */
export default function StatCard({
  icon,
  label,
  value,
  tone = "accent",
  index = 0,
  onClick = null,
  compact = false,
  indicator = false,
  active = false,
}) {
  const interactive = typeof onClick === "function";
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05, duration: 0.4 }}
      whileHover={{ y: interactive ? -3 : -2 }}
      onClick={onClick}
      role={interactive ? "button" : undefined}
      aria-pressed={interactive ? active : undefined}
      tabIndex={interactive ? 0 : undefined}
      onKeyDown={
        interactive
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
      className={`relative overflow-hidden rounded-2xl border bg-white shadow-card ${compact ? "p-4" : "p-5"} ${
        active ? "border-brand-blue ring-1 ring-brand-blue/30" : "border-slate-200"
      } ${interactive ? "cursor-pointer hover:border-brand-blue focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/40" : ""}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div
          className={`flex items-center justify-center ${compact ? "w-9 h-9 rounded-lg" : "w-11 h-11 rounded-xl"} ${TONES[tone] || TONES.accent}`}
        >
          <Icon name={icon} className={compact ? "w-4 h-4" : "w-5 h-5"} strokeWidth={1.8} />
        </div>
        {!indicator && <div className="h-2.5 w-2.5 rounded-full bg-slate-200" />}
      </div>
      <p
        className={`font-stat font-extrabold tracking-tight text-slate-900 ${compact ? "mt-2.5 text-2xl" : "mt-4 text-3xl"}`}
      >
        {value}
      </p>
      <p className={`mt-1 text-slate-600 ${compact ? "text-xs" : "text-sm"}`}>{label}</p>
      {indicator && (
        <div aria-hidden="true" className={`absolute inset-x-0 bottom-0 h-1 ${BAR_TONES[tone] || BAR_TONES.accent}`} />
      )}
    </motion.div>
  );
}
