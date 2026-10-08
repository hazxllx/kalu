import React from "react";
import { TYPE, PALETTE } from "@/lib/designTokens";

/**
 * Restrained status indicator: colored dot + text label.
 *
 * Color is reserved for meaning. No filled pill background for routine
 * statuses — the dot carries the color, the text carries the label. Only
 * risk levels that need urgency (High) receive a restrained tinted label.
 *
 * Tone mapping (mirrors existing status values across the app):
 *   completed / active / verified / accepted / healthy / available
 *     -> green
 *   pending / scheduled / upcoming / due / monitoring / ongoing / received
 *     -> amber
 *   overdue / missed / rejected / unavailable / cancelled / in_progress
 *     -> rose
 *   neutral / inactive / none
 *     -> gray (dot only, no emphasis)
 */
const STATUS_TONES = {
  // Green: completed, active, verified, accepted, healthy, available, submitted
  green: [
    "completed", "active", "verified", "Accepted", "Healthy", "Available",
    "Submitted to MHO", "Submitted to RHU", "Generated", "In Check-up", "Completed Today",
    "Verified", "On Track", "Confirmed", "Linked", "Approved", "Resolved", "Clean",
  ],
  // Amber: pending, scheduled, upcoming, due, monitoring, ongoing, received
  amber: [
    "pending", "scheduled", "upcoming", "Due", "Monitoring", "Ongoing", "Received",
    "Pending", "Accepted", "In Progress", "In Progress", "Due Today", "Scheduled",
    "Pending Activation", "Pending Verification", "Waiting", "Open", "In Review",
  ],
  // Rose: overdue, missed, rejected, unavailable, cancelled
  rose: [
    "overdue", "missed", "Rejected", "Unavailable", "Cancelled", "High",
    "Overdue", "Overdue", "Cancelled", "Expired", "Failed", "Declined",
  ],
};

function toneFor(value) {
  const v = String(value || "").toLowerCase().trim();
  if (STATUS_TONES.green.some((t) => t.toLowerCase() === v)) return "green";
  if (STATUS_TONES.amber.some((t) => t.toLowerCase() === v)) return "amber";
  if (STATUS_TONES.rose.some((t) => t.toLowerCase() === v)) return "rose";
  return "neutral";
}

const DOT = {
  green: "#1F7A4C",
  amber: "#B98A1E",
  rose: "#B3202C",
  neutral: "#8A95A4",
  dark: {
    green: "#4BB57A",
    amber: "#D9A42E",
    rose: "#E05D67",
    neutral: "#6E7986",
  },
};

const LABEL = {
  green: "#1F7A4C",
  amber: "#B98A1E",
  rose: "#B3202C",
  neutral: "#8A95A4",
  dark: {
    green: "#4BB57A",
    amber: "#D9A42E",
    rose: "#E05D67",
    neutral: "#9AA7B5",
  },
};

const TINT = {
  green: "rgba(31,122,76,0.08)",
  amber: "rgba(185,138,30,0.10)",
  rose: "rgba(179,32,44,0.08)",
};

export default function StatusIndicator({ value, tinted = false, size = "sm", className = "", labelClass }) {
  const tone = toneFor(value);
  const isDark = document.documentElement.classList.contains("dark");
  const dotColor = isDark ? DOT.dark[tone] : DOT[tone];
  const labelColor = isDark ? LABEL.dark[tone] : LABEL[tone];
  const dotSize = size === "lg" ? "h-2.5 w-2.5" : "h-1.5 w-1.5";
  const textBase = size === "lg" ? "14px" : "12px";

  if (!labelClass && !tinted) {
    return (
      <span className={`inline-flex items-center gap-1.5 ${className}`} style={{ fontFamily: TYPE.body.family }}>
        <span
          className={`inline-block shrink-0 rounded-full ${dotSize}`}
          style={{ backgroundColor: dotColor }}
          aria-hidden="true"
        />
        <span className="text-[#54637A] dark:text-[#9AA7B5]"
              style={{
                fontSize: textBase,
                color: labelColor,
                fontWeight: tone === "rose" ? 600 : 500,
              }}>
          {value}
        </span>
      </span>
    );
  }

  if (tinted) {
    return (
      <span className={`inline-flex items-center gap-1 rounded-[4px] px-2 py-0.5 ${className}`}
            style={{
              fontFamily: TYPE.body.family,
              fontSize: textBase,
              color: labelColor,
              backgroundColor: TINT[tone],
              fontWeight: 600,
            }}>
        <span
          className={`inline-block shrink-0 rounded-full ${dotSize}`}
          style={{ backgroundColor: dotColor }}
          aria-hidden="true"
        />
        {value}
      </span>
    );
  }

  return (
    <span className={`inline-flex items-center gap-1 ${className}`} style={{ fontFamily: TYPE.body.family }}>
      <span
        className={`inline-block shrink-0 rounded-full ${dotSize}`}
        style={{ backgroundColor: dotColor }}
        aria-hidden="true"
      />
      <span className={labelClass}>{value}</span>
    </span>
  );
}

/**
 * Backward-compatible bridge for existing StatusBadge consumers.
 */
export function StatusBadge({ value, className = "" }) {
  return <StatusIndicator value={value} className={className} />;
}
