import React from "react";

/**
 * Shared follow-up schedule status badge.
 *
 * One status vocabulary + visual language for BOTH the Health Supervisor and
 * Resident calendars: Scheduled · Pending · Completed · Missed · Cancelled.
 * No emojis — semantic dots + labels that stay readable in Light and Dark Mode.
 */

export const STATUS_TONES = {
  Scheduled: "bg-brand-blue/10 text-brand-blue dark:bg-brand-blue/15",
  Pending: "bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400",
  Completed: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400",
  Missed: "bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-400",
  Cancelled: "bg-slate-100 text-slate-500 dark:bg-slate-500/20 dark:text-slate-400",
};

export const STATUS_DOTS = {
  Scheduled: "bg-brand-blue",
  Pending: "bg-amber-400",
  Completed: "bg-brand-green",
  Missed: "bg-brand-danger",
  Cancelled: "bg-slate-400",
};

export default function ScheduleStatusBadge({ value }) {
  const tone = STATUS_TONES[value] || STATUS_TONES.Scheduled;
  const dot = STATUS_DOTS[value] || STATUS_DOTS.Scheduled;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${tone}`}>
      <span className={`h-2 w-2 rounded-full ${dot}`} /> {value}
    </span>
  );
}

/**
 * Resident confirmation badge — SEPARATE from the follow-up status.
 * Rejected uses a red/warning tone so the Health Supervisor can spot
 * rejected schedules at a glance.
 */
export const CONFIRMATION_TONES = {
  "Awaiting Confirmation": "bg-slate-100 text-slate-500 dark:bg-slate-500/20 dark:text-slate-400",
  Confirmed: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400",
  Rejected: "bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-400",
};

export const CONFIRMATION_DOTS = {
  "Awaiting Confirmation": "bg-slate-400",
  Confirmed: "bg-brand-green",
  Rejected: "bg-brand-danger",
};

export function ConfirmationBadge({ value }) {
  const tone = CONFIRMATION_TONES[value] || CONFIRMATION_TONES["Awaiting Confirmation"];
  const dot = CONFIRMATION_DOTS[value] || CONFIRMATION_DOTS["Awaiting Confirmation"];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${tone}`}>
      <span className={`h-2 w-2 rounded-full ${dot}`} /> {value}
    </span>
  );
}
