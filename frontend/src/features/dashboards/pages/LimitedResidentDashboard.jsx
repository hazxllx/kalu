import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import {
  ArrowRight, Bell, CalendarClock, CheckCircle2, FileHeart, Lock,
  Settings, ShieldCheck, UserRound,
} from "lucide-react";
import TransferStatusBanner from "@/features/verification/components/TransferStatusBanner";
import { useAuth } from "@/context/AuthContext";
import { visitPlansApi } from "@/services/api";
import ResidentServiceCard from "@/features/dashboards/components/ResidentServiceCard";

const HEALTH_SERVICES_PATH = "/app/resident-limited/services";

const AVAILABLE = [
  { icon: Bell, label: "Notifications", desc: "Read community updates and account notices.", path: "/app/resident-limited/announcements", tone: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300" },
  { icon: UserRound, label: "My profile", desc: "Review your information and update your contact number.", path: "/app/resident-limited/profile", tone: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300" },
  { icon: Settings, label: "Settings", desc: "Manage your password and display preferences.", path: "/app/resident-limited/settings", tone: "bg-slate-100 text-slate-700 dark:bg-slate-700/50 dark:text-slate-200" },
];

const LOCKED = [
  { icon: CalendarClock, label: "Follow-ups", desc: "Your scheduled and completed follow-up visits." },
  { icon: FileHeart, label: "My health records", desc: "Your consultation history and health records." },
];

const cardMotion = (index) => ({
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.22, delay: index * 0.04 },
});

export default function LimitedResidentDashboard() {
  const { user } = useAuth();
  const first = (user?.name || "Resident").trim().split(/\s+/)[0];
  const [servicesState, setServicesState] = useState("loading");
  const [services, setServices] = useState([]);

  useEffect(() => {
    let active = true;
    visitPlansApi.directory()
      .then((result) => {
        if (!active) return;
        const barangayServices = (result?.facilities || [])
          .filter((facility) => facility.type === "BHC")
          .flatMap((facility) => (facility.services || []).map((service) => ({
            ...service,
            facilityName: service.facilityName || facility.name,
          })));
        setServices(barangayServices);
        setServicesState("ready");
      })
      .catch(() => active && setServicesState("error"));
    return () => { active = false; };
  }, []);

  return (
    <div className="mx-auto w-full max-w-[1120px] space-y-5 sm:space-y-6">
      <section className="overflow-hidden rounded-2xl border border-blue-900/20 bg-gradient-to-br from-[#12355b] via-[#164a78] to-[#0d2947] p-5 text-white shadow-sm sm:p-7 lg:p-8">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-blue-200">Resident portal</p>
            <h1 className="mt-2 font-display text-2xl font-semibold leading-tight sm:text-3xl">Welcome, {first}</h1>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-blue-100 sm:text-base">
              Your account is awaiting verification. You can browse your barangay’s health services and manage your profile while it is being reviewed.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2 self-start rounded-full border border-amber-200/25 bg-amber-300/10 px-3.5 py-2 text-sm font-semibold text-amber-100 sm:self-center">
            <ShieldCheck className="h-4 w-4" aria-hidden="true" /> Pending verification
          </div>
        </div>
      </section>

      <TransferStatusBanner />

      <section aria-labelledby="pending-services-title" className="rounded-2xl border border-brand-border bg-white p-4 shadow-sm dark:bg-card sm:p-5 lg:p-6">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-brand-blue dark:text-blue-300">From your barangay</p>
            <h2 id="pending-services-title" className="mt-1 text-base font-semibold text-brand-ink dark:text-foreground sm:text-lg">Health services</h2>
            <p className="mt-1 text-sm text-brand-gray dark:text-muted-foreground">Browse services offered by your Barangay Health Center.</p>
          </div>
          <Link to={HEALTH_SERVICES_PATH} className="inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-lg border border-brand-border px-3 py-2 text-sm font-semibold text-brand-blue transition-colors hover:bg-brand-blue/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue dark:border-border dark:text-blue-300 dark:hover:bg-blue-400/10">
            View more <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </div>

        {servicesState === "loading" ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-label="Loading health services">
            {[0, 1, 2].map((item) => <div key={item} className="flex gap-3 rounded-xl border border-brand-border p-3 dark:border-border"><div className="h-[76px] w-[60px] shrink-0 animate-pulse rounded-lg bg-brand-bg dark:bg-muted" /><div className="flex-1 space-y-2 py-1"><div className="h-4 w-3/4 animate-pulse rounded bg-brand-bg dark:bg-muted" /><div className="h-3 w-1/2 animate-pulse rounded bg-brand-bg dark:bg-muted" /></div></div>)}
          </div>
        ) : servicesState === "error" ? (
          <p className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/20 dark:text-rose-300">Health services could not be loaded. Open the directory to try again.</p>
        ) : services.length === 0 ? (
          <p className="rounded-xl border border-dashed border-brand-border px-4 py-6 text-center text-sm text-brand-gray dark:border-border dark:text-muted-foreground">No health services are currently listed for your barangay.</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {services.slice(0, 3).map((service) => <ResidentServiceCard key={service.id} service={service} to={HEALTH_SERVICES_PATH} />)}
          </div>
        )}
      </section>

      <section aria-labelledby="available-title">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 id="available-title" className="text-base font-semibold text-brand-ink dark:text-foreground sm:text-lg">Available to you</h2>
            <p className="mt-0.5 text-sm text-brand-gray dark:text-muted-foreground">Your active account features.</p>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 sm:gap-4">
          {AVAILABLE.map((item, index) => (
            <motion.div key={item.label} {...cardMotion(index)}>
              <Link to={item.path} className="group flex h-full min-h-[158px] flex-col rounded-xl border border-brand-border bg-white p-4 shadow-sm transition duration-200 hover:-translate-y-0.5 hover:border-brand-blue/40 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue dark:border-border dark:bg-card dark:hover:border-brand-blue/60 sm:p-5">
                <span className={`grid h-10 w-10 place-items-center rounded-xl ${item.tone}`}><item.icon className="h-5 w-5" strokeWidth={1.8} aria-hidden="true" /></span>
                <h3 className="mt-3 text-sm font-semibold leading-snug text-brand-ink dark:text-foreground">{item.label}</h3>
                <p className="mt-1 flex-1 text-xs leading-relaxed text-brand-gray dark:text-muted-foreground">{item.desc}</p>
                <span className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-brand-blue dark:text-blue-300">Open <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" /></span>
              </Link>
            </motion.div>
          ))}
        </div>
      </section>

      <section aria-labelledby="locked-title">
        <div className="mb-3">
          <h2 id="locked-title" className="text-base font-semibold text-brand-ink dark:text-foreground sm:text-lg">Available after verification</h2>
          <p className="mt-0.5 text-sm text-brand-gray dark:text-muted-foreground">These personal health features unlock once your account is verified.</p>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 sm:gap-4">
          {LOCKED.map((item, index) => (
            <motion.div key={item.label} {...cardMotion(index + AVAILABLE.length)} className="flex min-w-0 items-start gap-3 rounded-xl border border-dashed border-slate-300 bg-slate-50/80 p-4 dark:border-border dark:bg-card/70 sm:gap-4 sm:p-5">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-slate-200/70 text-slate-500 dark:bg-slate-700/60 dark:text-slate-300"><item.icon className="h-5 w-5" strokeWidth={1.8} aria-hidden="true" /></span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-semibold text-slate-600 dark:text-slate-300">{item.label}</h3>
                  <span className="inline-flex items-center gap-1 rounded-full bg-slate-200/80 px-2 py-1 text-[11px] font-semibold text-slate-600 dark:bg-slate-700 dark:text-slate-300"><Lock className="h-3 w-3" /> Locked</span>
                </div>
                <p className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-muted-foreground">{item.desc}</p>
                <p className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400"><CheckCircle2 className="h-3.5 w-3.5" /> Unlocks after account verification</p>
              </div>
            </motion.div>
          ))}
        </div>
      </section>
    </div>
  );
}
