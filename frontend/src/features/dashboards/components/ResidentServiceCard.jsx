// frontend/src/features/dashboards/components/ResidentServiceCard.jsx
import React from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight, Baby, ClipboardPlus, HeartPulse, Stethoscope, Syringe,
} from "lucide-react";
import { availabilityLine, formatServiceSchedule, formatWeekdays, formatWindow } from "@/features/health-services/lib/visitPlanFormat";
import { manilaDateKey } from "@/features/follow-ups/lib/scheduleDates";

const CATEGORY_ICONS = {
  Maternal: Baby,
  TCLS: ClipboardPlus,
  Immunization: Syringe,
  "Family Planning": HeartPulse,
  Consultation: Stethoscope,
  Other: Stethoscope,
};

const STATUS_STYLES = {
  Registered: "bg-blue-50 text-blue-700 dark:bg-blue-400/15 dark:text-blue-200",
  Attended: "bg-emerald-50 text-emerald-700 dark:bg-emerald-400/15 dark:text-emerald-200",
  Missed: "bg-rose-50 text-rose-700 dark:bg-rose-400/15 dark:text-rose-200",
  Cancelled: "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300",
  Available: "bg-emerald-50 text-emerald-700 dark:bg-emerald-400/15 dark:text-emerald-200",
  Upcoming: "bg-amber-50 text-amber-800 dark:bg-amber-300/15 dark:text-amber-200",
  Closed: "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300",
};

// Handles getServiceStatus logic.
function getServiceStatus(service) {
  if (service?.plan?.status) return service.plan.status;
  if (!service?.availability && service?.active === true) return "Available";
  const availability = availabilityLine(service);
  if (!availability.open) return "Closed";
  const startDate = service?.schedule?.startDate;
  return startDate && startDate > manilaDateKey() ? "Upcoming" : "Available";
}

// Handles getScheduleSummary logic.
function getScheduleSummary(service) {
  const datedSchedule = formatServiceSchedule(service?.schedule);
  if (datedSchedule) return datedSchedule;
  const weekdays = formatWeekdays(service?.weekdays || []);
  const window = formatWindow(service?.windowStart, service?.windowEnd);
  if (weekdays && window) return `${weekdays} · ${window}`;
  return weekdays || window;
}

/** Compact, database-backed service link used on the resident dashboards. */
export default function ResidentServiceCard({ service, to, statusOverride = null }) {
  const Icon = CATEGORY_ICONS[service.category] || Stethoscope;
  const status = statusOverride || getServiceStatus(service);
  const schedule = getScheduleSummary(service);

  return (
    <Link
      to={to}
      className="group flex min-h-[112px] min-w-0 items-start gap-3 rounded-md border border-brand-border bg-white p-3 transition-colors hover:border-brand-blue/40 hover:bg-brand-blue/[0.02] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue dark:border-border dark:bg-card dark:hover:border-brand-blue/60 dark:hover:bg-blue-400/[0.04]"
    >
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-brand-blue/10 text-brand-blue dark:bg-blue-400/15 dark:text-blue-300">
        <Icon className="h-[18px] w-[18px]" strokeWidth={1.8} aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="min-w-0 flex-1 line-clamp-2 text-sm font-semibold leading-snug text-brand-ink dark:text-foreground">{service.name}</span>
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${STATUS_STYLES[status] || STATUS_STYLES.Closed}`}>{status}</span>
        </span>
        <span className="mt-1 block truncate text-xs text-brand-gray dark:text-muted-foreground">
          {[service.category, service.location || service.facilityName || "Health service"].filter(Boolean).join(" · ")}
        </span>
        {service.description && (
          <span className="mt-1 block line-clamp-2 text-xs leading-relaxed text-brand-gray dark:text-muted-foreground">{service.description}</span>
        )}
        {schedule && <span className="mt-1 block truncate text-[11px] text-brand-gray/90 dark:text-muted-foreground">{schedule}</span>}
      </span>
      <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-brand-blue transition-transform group-hover:translate-x-0.5 dark:text-blue-300" aria-hidden="true" />
    </Link>
  );
}
