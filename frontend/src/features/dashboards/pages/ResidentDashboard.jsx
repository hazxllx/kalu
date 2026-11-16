import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { CalendarDays, Clock, MapPin, Stethoscope, ArrowRight } from "lucide-react";
import PageHeader from "@/components/common/PageHeader";
import TransferStatusBanner from "@/features/verification/components/TransferStatusBanner";
import ResidentHealthSnapshot from "@/features/dashboards/components/ResidentHealthSnapshot";
import { residentsApi, residentFollowUpsApi, referralsApi, visitPlansApi } from "@/services/api";
import { useAuth } from "@/context/AuthContext";
import { availabilityLine, formatServiceSchedule, formatWeekdays, formatWindow, formatDeadline } from "@/features/health-services/lib/visitPlanFormat";
import { manilaDateKey } from "@/features/follow-ups/lib/scheduleDates";
import { getResidentFollowUpPresentation } from "@/features/follow-ups/lib/residentFollowUpPresentation";

const formatLongDate = (iso) => {
  if (!iso) return "";
  const d = new Date(String(iso).length === 10 ? `${iso}T00:00:00` : iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
};

const todayIso = () => manilaDateKey();

// The resident Health Services directory — the single, backend-driven source of
// truth for registration. Dashboard cards deep-link here so the resident can see
// requirements, schedule and deadline, then register.
const HEALTH_SERVICES_PATH = "/app/resident/health-services";

const STATE_STYLES = {
  Registered: "bg-brand-blue/10 text-brand-blue",
  Attended: "bg-brand-green/10 text-brand-green",
  Missed: "bg-brand-danger/10 text-brand-danger",
  Cancelled: "bg-slate-100 text-slate-500",
  Available: "bg-brand-green/10 text-brand-green",
  Upcoming: "bg-brand-yellow/15 text-[#B07E00]",
  Closed: "bg-slate-100 text-slate-500",
};

/**
 * Derive the resident-facing state of one service from the authoritative backend
 * fields only. A resident's own plan status wins; otherwise the server's
 * `availability` result decides open/closed. "Upcoming" is shown when the service
 * is open but its configured start date is still in the future. Nothing here is
 * inferred from the service name, and capacity/"Full" is never fabricated (the
 * visit-plan model tracks no capacity).
 */
const deriveServiceState = (svc) => {
  const planStatus = svc?.plan?.status || null;
  if (planStatus) {
    return { label: planStatus, tone: STATE_STYLES[planStatus] || STATE_STYLES.Registered, note: "" };
  }
  const avail = availabilityLine(svc);
  if (avail.open) {
    const start = svc?.schedule?.startDate;
    const upcoming = start && start > todayIso();
    return {
      label: upcoming ? "Upcoming" : "Available",
      tone: upcoming ? STATE_STYLES.Upcoming : STATE_STYLES.Available,
      note: avail.text,
    };
  }
  return { label: "Closed", tone: STATE_STYLES.Closed, note: avail.text };
};

/** One-line schedule summary from the real configured fields, or "". */
const scheduleSummary = (svc) => {
  const dated = formatServiceSchedule(svc?.schedule);
  if (dated) return dated;
  const days = formatWeekdays(svc?.weekdays || []);
  const window = formatWindow(svc?.windowStart, svc?.windowEnd);
  if (days && window) return `${days} · ${window}`;
  return days || window || "";
};

export default function ResidentDashboard() {
  const { user } = useAuth();

  const [loading, setLoading] = useState(true);
  const [health, setHealth] = useState(null); // { resident, riskLevel, lastConsultationDate, consultations }
  const [healthError, setHealthError] = useState("");
  const [followUps, setFollowUps] = useState([]);
  const [followUpsLoading, setFollowUpsLoading] = useState(true);
  const [followUpsError, setFollowUpsError] = useState("");
  const [referrals, setReferrals] = useState([]);
  const [services, setServices] = useState(null); // null = not yet loaded; [] = loaded, none offered
  const [servicesError, setServicesError] = useState(false);

  const loadFollowUps = React.useCallback(() => {
    setFollowUpsLoading(true);
    setFollowUpsError("");
    return residentFollowUpsApi.list()
      .then((result) => setFollowUps(result?.rows || []))
      .catch((error) => setFollowUpsError(error?.message || "Unable to load follow-ups."))
      .finally(() => setFollowUpsLoading(false));
  }, []);

  useEffect(() => {
    loadFollowUps();
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") loadFollowUps();
    };
    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [loadFollowUps]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    // Each source is independent; a failure in one (e.g. referrals) must never
    // blank the whole dashboard, so they are settled individually.
    Promise.allSettled([
      residentsApi.myHealthRecords(),
      referralsApi.list(),
      // Barangay-scoped, backend-authoritative services directory. Scope,
      // eligibility and availability are all enforced server-side (and mirrored
      // by Supabase RLS); the client sends no barangay/resident id.
      visitPlansApi.directory(),
    ])
      .then(([healthRes, referralRes, servicesRes]) => {
        if (!active) return;
        if (healthRes.status === "fulfilled") {
          setHealth(healthRes.value || null);
          setHealthError("");
        } else {
          setHealthError("Unable to load your health record.");
        }
        if (referralRes.status === "fulfilled") setReferrals(referralRes.value?.rows || referralRes.value?.records || []);
        if (servicesRes.status === "fulfilled") {
          const facilities = servicesRes.value?.facilities || [];
          // Flatten the facility groups into a single ordered list, carrying the
          // resolved facility name onto each service for display.
          setServices(
            facilities.flatMap((f) =>
              (f.services || []).map((svc) => ({ ...svc, facilityName: svc.facilityName || f.name })),
            ),
          );
        } else {
          setServicesError(true);
        }
      })
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, []);

  const displayName = user?.name || health?.resident?.name || "Resident";
  const first = displayName.split(" ")[0];

  // Chronological, newest-first health timeline built from the resident's own
  // records (consultations, follow-ups, referrals). No internal ids, staff-only
  // remarks or other residents' data are included.
  const timeline = useMemo(() => {
    const events = [];
    const today = todayIso();
    (health?.consultations || []).forEach((c) => {
      if (!c.date || String(c.date).slice(0, 10) > today) return;
      events.push({
        date: c.date,
        type: "Health consultation",
        title: c.chiefComplaint || "Consultation recorded",
        desc: c.status ? c.status.replace(/\b\w/g, (m) => m.toUpperCase()) : "",
      });
      const measurements = [
        ["BP", c.vitals?.bloodPressure, "mmHg"],
        ["Pulse", c.vitals?.pulseRate, "bpm"],
        ["BMI", c.vitals?.bmi, ""],
      ]
        .filter(([, value]) => value !== null && value !== undefined && String(value).trim() !== "")
        .map(([label, value, unit]) => `${label} ${value}${unit ? ` ${unit}` : ""}`);
      if (measurements.length) {
        events.push({
          date: c.date,
          type: "Vital signs",
          title: "Measurements recorded",
          desc: measurements.join(" · "),
        });
      }
    });
    (followUps || []).forEach((f) => {
      if (!f.scheduledDate || String(f.scheduledDate).slice(0, 10) > today) return;
      const presentation = getResidentFollowUpPresentation(f);
      events.push({ date: f.scheduledDate, type: "Follow-up", title: presentation.statusLabel, desc: f.location || "" });
    });
    (referrals || []).forEach((r) => {
      const date = r.referral_date || r.referralDate || r.created_at || r.createdAt;
      if (!date || String(date).slice(0, 10) > today) return;
      events.push({ date: String(date).slice(0, 10), type: "Referral", title: r.status || "Referral", desc: r.destination_facility || r.receiving_facility || "" });
    });
    return events.sort((a, b) => String(b.date).localeCompare(String(a.date)));
  }, [health, followUps, referrals]);

  return (
    <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-5">
      <PageHeader
        crumbs={["Dashboard"]}
        title={`Welcome back, ${first}`}
        subtitle="Here are your health updates and services that need your attention."
        action={(
          <div className="text-left md:text-right">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-white/75">Today</p>
            <p className="text-sm font-medium text-white">{formatLongDate(todayIso())}</p>
          </div>
        )}
      />

      <ResidentHealthSnapshot
        health={health}
        healthError={healthError}
        followUps={followUps}
        followUpsLoading={followUpsLoading}
        followUpsError={followUpsError}
        timeline={timeline}
        loading={loading}
      />

      <TransferStatusBanner />

      <section className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-brand-gray">Ongoing health services</p>
            <h2 className="mt-1.5 font-display text-xl leading-tight text-brand-ink sm:text-2xl">Services available to your barangay</h2>
          </div>
          {services && services.length > 0 && (
            <Link
              to={HEALTH_SERVICES_PATH}
              className="hidden sm:inline-flex items-center gap-1 text-sm font-medium text-brand-blue hover:underline shrink-0"
            >
              View all <ArrowRight className="w-4 h-4" strokeWidth={1.8} />
            </Link>
          )}
        </div>

        {loading && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2].map((item) => <div key={item} className="aspect-[4/5] animate-pulse rounded-lg bg-brand-light" />)}
          </div>
        )}

        {!loading && servicesError && (
          <p className="rounded-lg border border-brand-border bg-white px-5 py-6 text-center text-sm text-brand-gray">
            We couldn't load your health services right now. Please refresh to try again.
          </p>
        )}

        {!loading && !servicesError && services && services.length === 0 && (
          <div className="rounded-lg border border-dashed border-brand-border bg-white px-5 py-8 text-center">
            <p className="text-sm font-medium text-brand-ink">
              No health services are currently available for your barangay.
            </p>
            <p className="mt-1 text-sm text-brand-gray">Please check again later for upcoming services.</p>
          </div>
        )}

        {!loading && !servicesError && services && services.length > 0 && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {services.map((service) => (
              <ResidentServicePoster key={service.id} service={service} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function ResidentServicePoster({ service }) {
  const state = deriveServiceState(service);
  const schedule = scheduleSummary(service);
  const deadline = formatDeadline(service?.schedule?.registrationDeadline);

  return (
    <Link
      to={HEALTH_SERVICES_PATH}
      className="group block overflow-hidden rounded-lg border border-brand-border bg-white transition-colors hover:border-brand-blue/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue"
    >
      <div className="relative aspect-[4/5] overflow-hidden bg-brand-dark">
        {service.pubmatUrl ? (
          <img
            src={service.pubmatUrl}
            alt={`${service.name} service poster`}
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
          />
        ) : (
          <div className="grid h-full place-items-center bg-gradient-to-br from-brand-blue to-brand-dark">
            <Stethoscope className="h-12 w-12 text-white/55" strokeWidth={1.4} aria-hidden="true" />
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-brand-dark via-brand-dark/45 to-transparent" />
        <span className={`absolute left-3 top-3 inline-flex rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] ${state.tone}`}>
          {state.label}
        </span>
        <div className="absolute inset-x-4 bottom-4">
          {service.category && <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-brand-gold">{service.category}</p>}
          <h3 className="mt-1 font-display text-lg leading-snug text-white">{service.name}</h3>
          <p className="mt-1 truncate font-mono text-[9px] uppercase tracking-[0.08em] text-white/70">{service.facilityName}</p>
          {schedule && <p className="mt-0.5 font-mono text-[9px] uppercase tracking-[0.08em] text-white/55">{schedule}</p>}
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-xs text-brand-gray">
        <span className="inline-flex min-w-0 items-center gap-1.5">
          <MapPin className="h-3.5 w-3.5 shrink-0 text-brand-blue" aria-hidden="true" />
          <span className="truncate">{service.facilityName || "Health service"}</span>
        </span>
        {deadline && (
          <span className="inline-flex items-center gap-1.5">
            <CalendarDays className="h-3.5 w-3.5 shrink-0 text-brand-blue" aria-hidden="true" />
            <span>Register by {deadline}</span>
          </span>
        )}
        {!schedule && !deadline && state.note && <span className="inline-flex items-center gap-1.5"><Clock className="h-3.5 w-3.5" />{state.note}</span>}
      </div>
    </Link>
  );
}
