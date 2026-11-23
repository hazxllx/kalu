import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertCircle, ArrowRight, Bell, CalendarClock, CheckCircle2, FileHeart, Lock,
  RefreshCw, Settings, ShieldCheck, UserRound,
} from "lucide-react";
import TransferStatusBanner from "@/features/verification/components/TransferStatusBanner";
import { useAuth } from "@/context/AuthContext";
import { healthServicesApi } from "@/services/api";
import ResidentServiceCard from "@/features/dashboards/components/ResidentServiceCard";

const HEALTH_SERVICES_PATH = "/app/resident-limited/services";

const AVAILABLE = [
  { icon: Bell, label: "Notifications", desc: "Read community updates and important account notices.", path: "/app/resident-limited/announcements", tone: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300" },
  { icon: UserRound, label: "My Profile", desc: "Review your personal information and contact details.", path: "/app/resident-limited/profile", tone: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300" },
  { icon: Settings, label: "Settings", desc: "Manage your password and account preferences.", path: "/app/resident-limited/settings", tone: "bg-slate-100 text-slate-700 dark:bg-slate-700/50 dark:text-slate-200" },
];

const LOCKED = [
  { icon: CalendarClock, label: "Follow-ups", desc: "Your scheduled and completed follow-up visits." },
  { icon: FileHeart, label: "My health records", desc: "Your consultation history and health records." },
];

export default function LimitedResidentDashboard() {
  const { user } = useAuth();
  const first = (user?.name || "Resident").trim().split(/\s+/)[0];
  const [servicesState, setServicesState] = useState("loading");
  const [services, setServices] = useState([]);
  const [servicesError, setServicesError] = useState(null);

  const loadServices = useCallback(async () => {
    setServicesState("loading");
    setServicesError(null);
    try {
      const result = await healthServicesApi.list();
      if (!Array.isArray(result?.rows)) throw new Error("The health-service response did not contain a catalog.");
      const barangayServices = result.rows.filter((service) => service.facilityType === "BHC");
      setServices(barangayServices);
      setServicesState("ready");
    } catch (error) {
      console.error("[resident-dashboard] Could not load health services.", error);
      setServicesError("Health services are temporarily unavailable. Please try again.");
      setServicesState("error");
    }
  }, []);

  useEffect(() => {
    void loadServices();
  }, [loadServices]);

  return (
    <div className="mx-auto w-full max-w-[1120px] space-y-4 sm:space-y-5">
      <section
        aria-label="Resident portal welcome"
        className="overflow-hidden rounded-lg border border-brand-deep bg-brand-dark text-white shadow-card"
      >
        <div aria-hidden="true" className="h-0.5 w-full bg-brand-gold/70" />
        <div className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#F59E0B]">Resident Portal</p>
            <h1 className="mt-1.5 font-heading text-xl font-semibold leading-tight tracking-tight text-white sm:text-2xl">
              Welcome, {first}
            </h1>
            <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-white/75">
              Your account is awaiting verification. You can browse available barangay health services while your account is being reviewed.
            </p>
          </div>
          <div className="inline-flex min-h-9 shrink-0 items-center gap-2 self-start rounded-full border border-brand-gold/40 bg-brand-gold/10 px-3 py-1.5 text-xs font-semibold text-[#F59E0B] sm:self-center">
            <ShieldCheck className="h-4 w-4" aria-hidden="true" /> Pending Verification
          </div>
        </div>
      </section>

      <TransferStatusBanner />

      <section aria-labelledby="pending-services-title" className="rounded-lg border border-brand-border bg-white p-4 dark:bg-card sm:p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 id="pending-services-title" className="text-base font-semibold text-brand-ink dark:text-foreground sm:text-lg">Health Services</h2>
            <p className="mt-1 text-sm text-brand-gray dark:text-muted-foreground">Browse services offered by your Barangay Health Center.</p>
          </div>
          <Link to={HEALTH_SERVICES_PATH} className="inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-md px-2.5 py-2 text-sm font-semibold text-brand-blue transition-colors hover:bg-brand-blue/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue dark:text-blue-300 dark:hover:bg-blue-400/10">
            View More <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </div>

        {servicesState === "loading" ? (
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3" aria-label="Loading health services" aria-busy="true">
            {[0, 1, 2].map((item) => <div key={item} className="flex min-h-[112px] gap-3 rounded-md border border-brand-border p-3 dark:border-border"><div className="h-9 w-9 shrink-0 animate-pulse rounded-md bg-brand-bg dark:bg-muted" /><div className="flex-1 space-y-2 py-1"><div className="h-4 w-3/4 animate-pulse rounded bg-brand-bg dark:bg-muted" /><div className="h-3 w-1/2 animate-pulse rounded bg-brand-bg dark:bg-muted" /><div className="h-3 w-full animate-pulse rounded bg-brand-bg dark:bg-muted" /></div></div>)}
          </div>
        ) : servicesState === "error" ? (
          <div className="flex flex-col gap-3 rounded-md border border-rose-200 bg-rose-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between dark:border-rose-900/50 dark:bg-rose-950/20">
            <p className="inline-flex items-center gap-2 text-sm text-rose-700 dark:text-rose-300" role="alert">
              <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" /> {servicesError}
            </p>
            <button type="button" onClick={() => void loadServices()} className="inline-flex min-h-9 shrink-0 items-center justify-center gap-2 self-start rounded-md border border-rose-300 bg-white px-3 py-1.5 text-sm font-semibold text-rose-800 hover:bg-rose-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 sm:self-auto dark:border-rose-800 dark:bg-rose-950/30 dark:text-rose-200 dark:hover:bg-rose-900/40">
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" /> Retry
            </button>
          </div>
        ) : services.length === 0 ? (
          <p className="rounded-md border border-dashed border-brand-border px-4 py-6 text-center text-sm text-brand-gray dark:border-border dark:text-muted-foreground">No health services are currently listed for your barangay.</p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {services.slice(0, 3).map((service) => <ResidentServiceCard key={service.id} service={service} to={HEALTH_SERVICES_PATH} />)}
          </div>
        )}
      </section>

      <section aria-labelledby="available-title">
        <h2 id="available-title" className="mb-3 text-base font-semibold text-brand-ink dark:text-foreground sm:text-lg">Available to You</h2>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {AVAILABLE.map((item) => (
            <Link key={item.label} to={item.path} className="group flex min-h-[92px] items-center gap-3 rounded-lg border border-brand-border bg-white p-3 transition-colors hover:border-brand-blue/40 hover:bg-brand-blue/[0.02] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue dark:border-border dark:bg-card dark:hover:border-brand-blue/60 dark:hover:bg-blue-400/[0.04]">
              <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-md ${item.tone}`}><item.icon className="h-[18px] w-[18px]" strokeWidth={1.8} aria-hidden="true" /></span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold leading-snug text-brand-ink dark:text-foreground">{item.label}</span>
                <span className="mt-1 block text-xs leading-relaxed text-brand-gray dark:text-muted-foreground">{item.desc}</span>
              </span>
              <ArrowRight className="h-4 w-4 shrink-0 text-brand-blue transition-transform group-hover:translate-x-0.5 dark:text-blue-300" aria-hidden="true" />
            </Link>
          ))}
        </div>
      </section>

      <section aria-labelledby="locked-title">
        <div className="mb-3">
          <h2 id="locked-title" className="text-base font-semibold text-brand-ink dark:text-foreground sm:text-lg">Available after verification</h2>
          <p className="mt-0.5 text-sm text-brand-gray dark:text-muted-foreground">These personal health features unlock once your account is verified.</p>
        </div>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
          {LOCKED.map((item) => (
            <div key={item.label} className="flex min-w-0 items-start gap-3 rounded-lg border border-dashed border-slate-300 bg-slate-50/80 p-3 dark:border-border dark:bg-card/70">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-slate-200/70 text-slate-500 dark:bg-slate-700/60 dark:text-slate-300"><item.icon className="h-[18px] w-[18px]" strokeWidth={1.8} aria-hidden="true" /></span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-semibold text-slate-600 dark:text-slate-300">{item.label}</h3>
                  <span className="inline-flex items-center gap-1 rounded-full bg-slate-200/80 px-2 py-1 text-[11px] font-semibold text-slate-600 dark:bg-slate-700 dark:text-slate-300"><Lock className="h-3 w-3" /> Locked</span>
                </div>
                <p className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-muted-foreground">{item.desc}</p>
                <p className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400"><CheckCircle2 className="h-3.5 w-3.5" /> Unlocks after account verification</p>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
