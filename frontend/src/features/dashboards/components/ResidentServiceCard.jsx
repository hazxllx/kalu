import React, { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Stethoscope } from "lucide-react";
import { availabilityLine, formatServiceSchedule, formatWeekdays, formatWindow, formatDeadline } from "@/features/health-services/lib/visitPlanFormat";
import { manilaDateKey } from "@/features/follow-ups/lib/scheduleDates";

const STATE_STYLES = {
  Registered: "bg-brand-blue/10 text-brand-blue dark:bg-blue-400/20 dark:text-blue-200",
  Attended: "bg-brand-green/10 text-brand-green dark:bg-emerald-400/20 dark:text-emerald-200",
  Missed: "bg-brand-danger/10 text-brand-danger dark:bg-rose-400/20 dark:text-rose-200",
  Cancelled: "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300",
  Available: "bg-brand-green/10 text-brand-green dark:bg-emerald-400/20 dark:text-emerald-200",
  Upcoming: "bg-brand-yellow/15 text-[#9A6B00] dark:bg-amber-300/15 dark:text-amber-200",
  Closed: "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300",
};

function getServiceState(service) {
  const planStatus = service?.plan?.status;
  if (planStatus) {
    return { label: planStatus, tone: STATE_STYLES[planStatus] || STATE_STYLES.Registered, note: "" };
  }

  const availability = availabilityLine(service);
  if (availability.open) {
    const startDate = service?.schedule?.startDate;
    const upcoming = startDate && startDate > manilaDateKey();
    return {
      label: upcoming ? "Upcoming" : "Available",
      tone: upcoming ? STATE_STYLES.Upcoming : STATE_STYLES.Available,
      note: availability.text,
    };
  }
  return { label: "Closed", tone: STATE_STYLES.Closed, note: availability.text };
}

function getScheduleSummary(service) {
  const datedSchedule = formatServiceSchedule(service?.schedule);
  if (datedSchedule) return datedSchedule;
  const weekdays = formatWeekdays(service?.weekdays || []);
  const timeWindow = formatWindow(service?.windowStart, service?.windowEnd);
  if (weekdays && timeWindow) return `${weekdays} · ${timeWindow}`;
  return weekdays || timeWindow || "";
}

/** Shared resident-facing health-service card for pending and verified accounts. */
export default function ResidentServiceCard({ service, to }) {
  const [imageFailed, setImageFailed] = useState(false);
  const state = getServiceState(service);
  const schedule = getScheduleSummary(service);
  const deadline = formatDeadline(service?.schedule?.registrationDeadline);

  return (
    <Link
      to={to}
      className="group block min-w-0 overflow-hidden rounded-xl border border-brand-border bg-white shadow-sm transition-colors hover:border-brand-blue/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue dark:border-border dark:bg-card"
    >
      <div className="relative aspect-[4/5] overflow-hidden bg-brand-dark">
        {service.pubmatUrl && !imageFailed ? (
          <img
            src={service.pubmatUrl}
            alt={`${service.name} service poster`}
            loading="lazy"
            onError={() => setImageFailed(true)}
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
          />
        ) : (
          <div className="grid h-full place-items-center bg-gradient-to-br from-brand-blue to-brand-dark">
            <Stethoscope className="h-8 w-8 text-white/75" strokeWidth={1.6} aria-hidden="true" />
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-brand-dark via-brand-dark/45 to-transparent" />
        <span className={`absolute left-3 top-3 inline-flex max-w-[calc(100%-1.5rem)] truncate rounded-full px-2.5 py-1 text-[11px] font-semibold ${state.tone}`}>
          {state.label}
        </span>
        <div className="absolute inset-x-4 bottom-4 min-w-0">
          {service.category && <p className="truncate text-[11px] font-semibold uppercase tracking-[0.12em] text-brand-gold">{service.category}</p>}
          <h3 className="mt-1 line-clamp-2 font-display text-lg font-semibold leading-snug text-white">{service.name}</h3>
          <p className="mt-1 truncate text-xs font-medium text-white/80">{service.facilityName || "Health service"}</p>
          {schedule && <p className="mt-0.5 line-clamp-2 text-xs text-white/70">{schedule}</p>}
        </div>
      </div>
      <div className="flex min-h-12 flex-wrap items-center justify-between gap-2 px-4 py-3 text-xs text-brand-gray dark:text-muted-foreground">
        <span className="inline-flex min-w-0 items-center gap-1.5">
          <span className="truncate">{service.facilityName || "Health service"}</span>
        </span>
        {deadline ? (
          <span className="inline-flex items-center gap-1.5">Register by {deadline}</span>
        ) : !schedule && state.note ? (
          <span>{state.note}</span>
        ) : (
          <span className="inline-flex items-center gap-1 text-brand-blue dark:text-blue-300">View service <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" /></span>
        )}
      </div>
    </Link>
  );
}
