import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import PageHeader from "@/components/common/PageHeader";
import TransferStatusBanner from "@/features/verification/components/TransferStatusBanner";
import ResidentHealthSnapshot from "@/features/dashboards/components/ResidentHealthSnapshot";
import ResidentServiceCard from "@/features/dashboards/components/ResidentServiceCard";
import { residentsApi, residentFollowUpsApi, referralsApi, visitPlansApi } from "@/services/api";
import { useAuth } from "@/context/AuthContext";
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
    <div className="mx-auto flex w-full max-w-[1120px] flex-col gap-5 sm:gap-6">
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

      <section aria-labelledby="resident-services-title" className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-brand-gray dark:text-muted-foreground">Ongoing health services</p>
            <h2 id="resident-services-title" className="mt-1 font-display text-lg font-semibold leading-tight text-brand-ink dark:text-foreground sm:text-xl">Services available to your barangay</h2>
          </div>
          {services && services.length > 0 && (
            <Link
              to={HEALTH_SERVICES_PATH}
              className="inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-lg border border-brand-border px-3 py-2 text-sm font-semibold text-brand-blue transition-colors hover:bg-brand-blue/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue dark:border-border dark:text-blue-300 dark:hover:bg-blue-400/10"
            >
              View all <ArrowRight className="h-4 w-4" strokeWidth={1.8} />
            </Link>
          )}
        </div>

        {loading && (
          <div className="grid gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3">
            {[0, 1, 2].map((item) => <div key={item} className="aspect-[4/5] animate-pulse rounded-lg bg-brand-light" />)}
          </div>
        )}

        {!loading && servicesError && (
          <p className="rounded-lg border border-brand-border bg-white px-5 py-6 text-center text-sm text-brand-gray dark:border-border dark:bg-card dark:text-muted-foreground">
            We couldn't load your health services right now. Please refresh to try again.
          </p>
        )}

        {!loading && !servicesError && services && services.length === 0 && (
          <div className="rounded-lg border border-dashed border-brand-border bg-white px-5 py-8 text-center dark:border-border dark:bg-card">
            <p className="text-sm font-medium text-brand-ink dark:text-foreground">
              No health services are currently available for your barangay.
            </p>
            <p className="mt-1 text-sm text-brand-gray dark:text-muted-foreground">Please check again later for upcoming services.</p>
          </div>
        )}

        {!loading && !servicesError && services && services.length > 0 && (
          <div className="grid gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3">
            {services.map((service) => (
              <ResidentServiceCard key={service.id} service={service} to={HEALTH_SERVICES_PATH} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
