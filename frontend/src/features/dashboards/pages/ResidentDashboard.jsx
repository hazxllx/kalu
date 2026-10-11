import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { CalendarClock, ShieldCheck, Stethoscope, Activity, CalendarDays, Clock, MapPin, ArrowRight } from "lucide-react";
import PageHeader from "@/components/common/PageHeader";
import { Card } from "@/components/common/Card";
import TransferStatusBanner from "@/features/verification/components/TransferStatusBanner";
import { residentsApi, residentFollowUpsApi, referralsApi, visitPlansApi } from "@/services/api";
import { useAuth } from "@/context/AuthContext";
import { availabilityLine, formatServiceSchedule, formatWeekdays, formatWindow, formatDeadline } from "@/features/health-services/lib/visitPlanFormat";

const timelineColor = {
  green: "bg-brand-green", accent: "bg-brand-accent", blue: "bg-brand-blue",
  yellow: "bg-brand-yellow", danger: "bg-brand-danger",
};

const formatLongDate = (iso) => {
  if (!iso) return "";
  const d = new Date(String(iso).length === 10 ? `${iso}T00:00:00` : iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
};

const todayIso = () => new Date().toISOString().slice(0, 10);

// Statuses that represent an approved / confirmed upcoming follow-up. A pending,
// rejected or cancelled follow-up is not shown as "upcoming".
const UPCOMING_STATUSES = new Set(["Scheduled", "Today", "Upcoming", "Ongoing"]);

const riskTone = (risk) => {
  const r = String(risk || "").toLowerCase();
  if (r === "high") return "bg-brand-danger/10 text-brand-danger";
  if (r === "moderate" || r === "medium") return "bg-brand-yellow/15 text-[#B07E00]";
  if (r === "low") return "bg-brand-green/10 text-brand-green";
  return "bg-brand-green/10 text-brand-green";
};

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
  const [followUps, setFollowUps] = useState([]);
  const [referrals, setReferrals] = useState([]);
  const [services, setServices] = useState(null); // null = not yet loaded; [] = loaded, none offered
  const [servicesError, setServicesError] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    // Each source is independent; a failure in one (e.g. referrals) must never
    // blank the whole dashboard, so they are settled individually.
    Promise.allSettled([
      residentsApi.myHealthRecords(),
      residentFollowUpsApi.list(),
      referralsApi.list(),
      // Barangay-scoped, backend-authoritative services directory. Scope,
      // eligibility and availability are all enforced server-side (and mirrored
      // by Supabase RLS); the client sends no barangay/resident id.
      visitPlansApi.directory(),
    ])
      .then(([healthRes, followUpRes, referralRes, servicesRes]) => {
        if (!active) return;
        if (healthRes.status === "fulfilled") setHealth(healthRes.value || null);
        if (followUpRes.status === "fulfilled") setFollowUps(followUpRes.value?.rows || []);
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

  // Next approved/confirmed upcoming follow-up (earliest future/today date).
  const upcomingFollowUp = useMemo(() => {
    const today = todayIso();
    return (followUps || [])
      .filter((f) => UPCOMING_STATUSES.has(f.status) && f.scheduledDate && f.scheduledDate >= today)
      .sort((a, b) => String(a.scheduledDate).localeCompare(String(b.scheduledDate)))[0] || null;
  }, [followUps]);

  const lastCheckUp = health?.lastConsultationDate || health?.consultations?.[0]?.date || "";
  const riskLevel = health?.riskLevel || "";

  const cards = [
    {
      icon: CalendarClock,
      tone: "bg-brand-accent/10 text-brand-accent",
      label: "Upcoming Follow-up",
      main: upcomingFollowUp ? formatLongDate(upcomingFollowUp.scheduledDate) : "No upcoming follow-up",
      sub: upcomingFollowUp
        ? [upcomingFollowUp.location, upcomingFollowUp.status ? `Status: ${upcomingFollowUp.status}` : null].filter(Boolean).join(" · ")
        : "",
    },
    {
      icon: ShieldCheck,
      tone: riskTone(riskLevel),
      label: "Health Risk Level",
      main: riskLevel || "No health risk assessment yet",
      sub: riskLevel ? "Based on your latest check-up" : "",
    },
    {
      icon: Stethoscope,
      tone: "bg-brand-yellow/15 text-[#B07E00]",
      label: "Last Check-up",
      main: lastCheckUp ? formatLongDate(lastCheckUp) : "No check-up recorded",
      sub: "",
    },
  ];

  // Chronological, newest-first health timeline built from the resident's own
  // records (consultations, follow-ups, referrals). No internal ids, staff-only
  // remarks or other residents' data are included.
  const timeline = useMemo(() => {
    const events = [];
    (health?.consultations || []).forEach((c) => {
      if (!c.date) return;
      events.push({ date: c.date, type: "Health Consultation", title: c.status ? c.status.replace(/\b\w/g, (m) => m.toUpperCase()) : "Consultation", desc: c.chiefComplaint || "", color: "blue" });
    });
    (followUps || []).forEach((f) => {
      if (!f.scheduledDate) return;
      events.push({ date: f.scheduledDate, type: "Follow-Up", title: f.status || "Scheduled", desc: f.location || "", color: "green" });
    });
    (referrals || []).forEach((r) => {
      const date = r.referral_date || r.referralDate || r.created_at || r.createdAt;
      if (!date) return;
      events.push({ date: String(date).slice(0, 10), type: "Referral", title: r.status || "Referral", desc: r.destination_facility || r.receiving_facility || "", color: "accent" });
    });
    if (riskLevel && lastCheckUp) {
      events.push({ date: lastCheckUp, type: "Health Risk Assessment", title: `${riskLevel} Risk`, desc: "", color: riskLevel.toLowerCase() === "high" ? "danger" : riskLevel.toLowerCase() === "moderate" ? "yellow" : "green" });
    }
    return events.sort((a, b) => String(b.date).localeCompare(String(a.date)));
  }, [health, followUps, referrals, riskLevel, lastCheckUp]);

  return (
    <>
      <PageHeader
        crumbs={["Dashboard"]}
        title={`Welcome back, ${first}`}
        subtitle="Here's an overview of your health at a glance."
      />

      <TransferStatusBanner />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5">
        {cards.map((c, i) => (
          <motion.div key={c.label} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }}
            className="rounded-2xl border border-slate-200 bg-white shadow-card p-4 sm:p-5 dark:border-border dark:bg-card">
            <div className={`w-10 h-10 sm:w-11 sm:h-11 rounded-xl flex items-center justify-center ${c.tone}`}><c.icon className="w-4 h-4 sm:w-5 sm:h-5" strokeWidth={1.8} /></div>
            <p className="mt-3 sm:mt-4 text-xs text-brand-gray uppercase tracking-wide">{c.label}</p>
            <p className="mt-1 text-lg sm:text-xl font-semibold text-brand-ink">{loading ? "Loading…" : c.main}</p>
            {!loading && c.sub && <p className="mt-0.5 text-sm text-brand-gray line-clamp-2">{c.sub}</p>}
          </motion.div>
        ))}
      </div>

      <Card className="mt-6 p-4 sm:p-6">
        <div className="flex items-start justify-between gap-3 mb-4 sm:mb-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-brand-blue/10 flex items-center justify-center">
              <Activity className="w-5 h-5 text-brand-blue" strokeWidth={1.8} />
            </div>
            <div>
              <h3 className="font-semibold text-brand-ink text-sm sm:text-base">Ongoing Health Services</h3>
              <p className="text-sm text-brand-gray">Services available to your barangay</p>
            </div>
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
          <p className="text-sm text-brand-gray py-6 text-center">Loading available services…</p>
        )}

        {!loading && servicesError && (
          <p className="text-sm text-brand-gray py-6 text-center">
            We couldn't load your health services right now. Please refresh to try again.
          </p>
        )}

        {!loading && !servicesError && services && services.length === 0 && (
          <div className="rounded-lg border border-dashed border-brand-border bg-brand-bg px-5 py-8 text-center">
            <p className="text-sm font-medium text-brand-ink">
              No health services are currently available for your barangay.
            </p>
            <p className="mt-1 text-sm text-brand-gray">Please check again later for upcoming services.</p>
          </div>
        )}

        {!loading && !servicesError && services && services.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {services.map((svc, i) => {
              const st = deriveServiceState(svc);
              const schedule = scheduleSummary(svc);
              const registerBy = formatDeadline(svc?.schedule?.registrationDeadline);
              return (
                <motion.div
                  key={svc.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.03 }}
                >
                  <Link
                    to={HEALTH_SERVICES_PATH}
                    className="group block h-full rounded-lg border border-brand-border bg-brand-bg p-3 transition-colors hover:border-brand-blue/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-medium text-brand-ink leading-snug line-clamp-2">{svc.name}</p>
                      <span className={`shrink-0 inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${st.tone}`}>
                        {st.label}
                      </span>
                    </div>

                    <div className="mt-2 space-y-1 text-[12px] text-brand-gray">
                      {svc.category && (
                        <p className="inline-flex items-center rounded border border-brand-border bg-white px-1.5 py-0.5 text-[11px] font-medium text-brand-gray">
                          {svc.category}
                        </p>
                      )}
                      {svc.facilityName && (
                        <p className="flex items-center gap-1.5">
                          <MapPin className="w-3.5 h-3.5 shrink-0 text-brand-blue" strokeWidth={1.8} />
                          <span className="truncate">{svc.facilityName}</span>
                        </p>
                      )}
                      {schedule && (
                        <p className="flex items-center gap-1.5">
                          <CalendarDays className="w-3.5 h-3.5 shrink-0 text-brand-blue" strokeWidth={1.8} />
                          <span className="truncate">{schedule}</span>
                        </p>
                      )}
                      {registerBy && (
                        <p className="flex items-center gap-1.5">
                          <Clock className="w-3.5 h-3.5 shrink-0 text-brand-blue" strokeWidth={1.8} />
                          <span className="truncate">Register by {registerBy}</span>
                        </p>
                      )}
                      {st.note && !schedule && (
                        <p className="text-slate-400">{st.note}</p>
                      )}
                    </div>
                  </Link>
                </motion.div>
              );
            })}
          </div>
        )}
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-5 mt-6">
        <Card className="lg:col-span-2 p-4 sm:p-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-4 sm:mb-6 gap-2">
            <h3 className="font-semibold text-brand-ink text-sm sm:text-base">Health Timeline</h3>
          </div>
          <div className="relative pl-4 sm:pl-6">
            <div className="absolute left-[5px] sm:left-[7px] top-1 bottom-1 w-px bg-brand-border" />
            {loading && (
              <p className="text-sm text-brand-gray py-6 text-center">Loading your health activity…</p>
            )}
            {!loading && timeline.length === 0 && (
              <p className="text-sm text-brand-gray py-6 text-center">No health activity recorded yet.</p>
            )}
            {!loading && timeline.map((t, i) => (
              <motion.div key={`${t.type}-${t.date}-${i}`} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.05 }} className="relative pb-5 sm:pb-7 last:pb-0">
                <span className={`absolute -left-4 sm:-left-6 top-1 w-3 sm:w-3.5 h-3 sm:h-3.5 rounded-full ring-4 ring-white dark:ring-card ${timelineColor[t.color] || "bg-brand-blue"}`} />
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-medium text-brand-blue bg-brand-light px-2 py-0.5 rounded-full">{t.type}</span>
                  <span className="text-xs text-brand-gray">{formatLongDate(t.date)}</span>
                </div>
                <p className="mt-1.5 font-medium text-brand-ink">{t.title}</p>
                {t.desc && <p className="text-sm text-brand-gray line-clamp-2">{t.desc}</p>}
              </motion.div>
            ))}
          </div>
        </Card>
      </div>
    </>
  );
}