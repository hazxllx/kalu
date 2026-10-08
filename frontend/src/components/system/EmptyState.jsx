import React from "react";
import { TYPE, PALETTE } from "@/lib/designTokens";

/**
 * Calm, specific empty states for each app context.
 *
 * No decorative tinted tiles. Small understated illustration (lucide icon in a
 * subtle dot), a sentence of plain language, and an optional primary action.
 */
export default function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  variant = "default",
  className = "",
}) {
  const base = "flex min-h-[160px] flex-col items-center justify-center text-center";

  // A few preset styles for the most common empty contexts.
  const variants = {
    default: "gap-4 py-10",
    inline: "py-6",
    centered: "gap-4 py-12",
    list: "gap-3 py-10",
  };

  return (
    <div className={`${base} ${variants[variant]} ${className}`}>
      {Icon && (
        <span
          className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-full bg-[#E7ECF1] dark:bg-[#1B2635]"
          aria-hidden="true"
        >
          <Icon className="h-5 w-5 text-[#8A95A4] dark:text-[#6E7986]" strokeWidth={1.8} />
        </span>
      )}
      <h3 className="m-0 text-[16px] font-semibold text-[#12263F] dark:text-[#E8EDF3]">{title}</h3>
      {description && (
        <p className="m-0 mt-1 max-w-md text-[13px] text-[#54637A] dark:text-[#9AA7B5]">{description}</p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

/** Context-specific presets with ready-made copy, still generic enough to
 * compose from EmptyState above. Keep these for consistency. */
export const EmptyStatePresets = {
  noResults: (extra) => ({
    icon: null,
    title: "No records found",
    description: "Try adjusting your search or filters, or clear them to see everything.",
    ...extra,
  }),
  emptyWorkQueue: () => ({
    icon: "CheckCircle2",
    title: "No check-ups waiting",
    description: "New triage completions will appear here as they are handed to the PHN.",
  }),
  emptyReferrals: () => ({
    icon: "Send",
    title: "No referrals yet",
    description: "Referrals to the RHU or a higher-level facility will be listed here.",
  }),
  emptyFollowUps: () => ({
    icon: "CalendarClock",
    title: "No follow-ups due",
    description: "Upcoming and overdue follow-ups will appear here.",
  }),
  emptyHouseholds: () => ({
    icon: "Home",
    title: "No household profiles yet",
    description: "Start by recording your first household during profiling.",
  }),
  emptyServices: () => ({
    icon: "Activity",
    title: "No health services yet",
    description: "Create a health service, scope it to a facility or barangay, and assign personnel.",
  }),
  emptyNotifications: () => ({
    icon: "Bell",
    title: "You're all caught up",
    description: "No new notifications at the moment.",
  }),
  emptyReports: () => ({
    icon: "BarChart3",
    title: "No reports generated",
    description: "Generate a monthly health report to see it listed here.",
  }),
};
