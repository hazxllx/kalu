import React from "react";

const TONES = {
  Low: "bg-brand-green/10 text-brand-green",
  Medium: "bg-brand-yellow/15 text-[#B07E00]",
  High: "bg-brand-danger/10 text-brand-danger",
  Active: "bg-brand-green/10 text-brand-green",
  Inactive: "bg-slate-100 text-brand-gray",
  Ongoing: "bg-brand-blue/10 text-brand-blue",
  Scheduled: "bg-brand-yellow/15 text-[#B07E00]",
  Upcoming: "bg-brand-accent/10 text-brand-accent",
  Completed: "bg-brand-green/10 text-brand-green",
  Today: "bg-brand-accent/10 text-brand-accent",
  Missed: "bg-brand-danger/10 text-brand-danger",
  Pending: "bg-brand-yellow/15 text-[#B07E00]",
  Accepted: "bg-brand-green/10 text-brand-green",
  Received: "bg-brand-blue/10 text-brand-blue",
  Due: "bg-brand-yellow/15 text-[#B07E00]",
  Monitoring: "bg-brand-accent/10 text-brand-accent",
  Healthy: "bg-brand-green/10 text-brand-green",
  "Pending Sync": "bg-amber-100 text-amber-700",
};

export default function StatusBadge({ value, className = "" }) {
  const tone = TONES[value] || "bg-slate-100 text-brand-gray";
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium font-body ${tone} ${className}`}>
      <span className="w-1.5 h-1.5 rounded-full bg-current opacity-70" />
      {value}
    </span>
  );
}