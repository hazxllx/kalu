import React, { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { CalendarClock, ShieldCheck, Stethoscope, ShieldAlert, Activity } from "lucide-react";
import PageHeader from "@/components/common/PageHeader";
import { Card } from "@/components/common/Card";
import VerificationBadge from "@/features/verification/components/VerificationBadge";
import VerificationModal from "@/features/verification/components/VerificationModal";
import TransferStatusBanner from "@/features/verification/components/TransferStatusBanner";
import { residentsApi, residentFollowUpsApi, referralsApi } from "@/services/api";
import { useAuth } from "@/context/AuthContext";

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

export default function ResidentDashboard() {
  const { user } = useAuth();
  const [verifyModal, setVerifyModal] = useState(false);

  const [loading, setLoading] = useState(true);
  const [health, setHealth] = useState(null); // { resident, riskLevel, lastConsultationDate, consultations }
  const [followUps, setFollowUps] = useState([]);
  const [referrals, setReferrals] = useState([]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    // Each source is independent; a failure in one (e.g. referrals) must never
    // blank the whole dashboard, so they are settled individually.
    Promise.allSettled([
      residentsApi.myHealthRecords(),
      residentFollowUpsApi.list(),
      referralsApi.list(),
    ])
      .then(([healthRes, followUpRes, referralRes]) => {
        if (!active) return;
        if (healthRes.status === "fulfilled") setHealth(healthRes.value || null);
        if (followUpRes.status === "fulfilled") setFollowUps(followUpRes.value?.rows || []);
        if (referralRes.status === "fulfilled") setReferrals(referralRes.value?.rows || referralRes.value?.records || []);
      })
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, []);

  const displayName = user?.name || health?.resident?.name || "Resident";
  const first = displayName.split(" ")[0];

  // Verification status comes from the resident's real record, not a hardcoded flag.
  const verificationStatus = health?.resident?.verificationStatus || user?.status || "";
  const verified = ["verified", "approved", "active"].includes(String(verificationStatus).toLowerCase());

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
        title={<span className="flex items-center gap-3">Welcome back, {first} <VerificationBadge status={verified ? "verified" : "pending"} /></span>}
        subtitle="Here's an overview of your health at a glance."
      />

      <TransferStatusBanner />

      {!verified && (
        <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="mb-6">
          <div className="bg-brand-yellow/10 border border-brand-yellow/20 rounded-2xl p-5 flex items-start gap-4">
            <div className="w-10 h-10 rounded-xl bg-brand-yellow/20 flex items-center justify-center shrink-0">
              <ShieldAlert className="w-5 h-5 text-[#B07E00]" strokeWidth={1.8} />
            </div>
            <div className="flex-1">
              <h3 className="font-heading font-semibold text-brand-ink">Account Verification Required</h3>
              <p className="mt-1 text-sm text-brand-gray">
                Some features remain unavailable until your Barangay Health Worker completes your verification.
              </p>
            </div>
            <button
              onClick={() => setVerifyModal(true)}
              className="shrink-0 bg-brand-blue text-white px-4 py-2.5 rounded-btn text-sm font-medium hover:bg-brand-dark transition-colors"
            >
              View Verification Status
            </button>
          </div>
        </motion.div>
      )}


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
        <div className="flex items-center gap-3 mb-4 sm:mb-6">
          <div className="w-10 h-10 rounded-xl bg-brand-blue/10 flex items-center justify-center">
            <Activity className="w-5 h-5 text-brand-blue" strokeWidth={1.8} />
          </div>
          <div>
            <h3 className="font-semibold text-brand-ink text-sm sm:text-base">Ongoing Health Services</h3>
            <p className="text-sm text-brand-gray">Services currently available at the health center</p>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {[
            "Medical Consultation",
            "Dental Services",
            "Immunization",
            "Risk Assessment / Visual Acuity / PWD Screening",
            "Distribution of Hypertension / Diabetic Medication",
            "Cervical Screening",
            "Nutrition Operation Timbang",
            "Nutrition Deworming",
            "Nutrition Micronutrient Supplement",
            "TB Program",
            "Family Planning",
            "Pre-Natal",
            "Adolescent Health",
            "HIV Screening (as scheduled)",
            "Anti-Rabies Vaccination"
          ].map((service, i) => (
            <motion.div
              key={service}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.03 }}
              className="rounded-lg border border-brand-border bg-brand-bg p-3 text-sm text-brand-ink hover:border-brand-blue/30 transition-colors"
            >
              {service}
            </motion.div>
          ))}
        </div>
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

      <VerificationModal open={verifyModal} onClose={() => setVerifyModal(false)} />
    </>
  );
}