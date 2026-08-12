import React from "react";

const TONES = {
  Low: "bg-emerald-50 text-emerald-700",
  Medium: "bg-amber-50 text-amber-700",
  High: "bg-rose-50 text-rose-700",
  Active: "bg-emerald-50 text-emerald-700",
  Inactive: "bg-slate-100 text-slate-600",
  Ongoing: "bg-brand-blue/10 text-brand-blue",
  Scheduled: "bg-amber-50 text-amber-700",
  Upcoming: "bg-brand-accent/10 text-brand-accent",
  Completed: "bg-emerald-50 text-emerald-700",
  Today: "bg-brand-accent/10 text-brand-accent",
  Missed: "bg-rose-50 text-rose-700",
  Pending: "bg-amber-50 text-amber-700",
  Accepted: "bg-emerald-50 text-emerald-700",
  Received: "bg-brand-blue/10 text-brand-blue",
  Due: "bg-amber-50 text-amber-700",
  Monitoring: "bg-brand-accent/10 text-brand-accent",
  Healthy: "bg-emerald-50 text-emerald-700",
  "Pending Sync": "bg-amber-100 text-amber-700",
};

export default function StatusBadge({ value, className = "" }) {
  const tone = TONES[value] || "bg-slate-100 text-slate-600";
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium font-body ${tone} ${className}`}>
      <span className="w-1.5 h-1.5 rounded-full bg-current opacity-70" />
      {value}
    </span>
  );
}