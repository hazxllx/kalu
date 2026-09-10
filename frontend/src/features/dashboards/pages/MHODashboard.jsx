import React, { useMemo } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Map, Users, Stethoscope, Send, ShieldAlert, Activity, ClipboardList, ChevronRight } from "lucide-react";
import PageHeader from "@/components/common/PageHeader";
import { Card } from "@/components/common/Card";
import StatusBadge from "@/components/common/StatusBadge";
import { useMunicipalSubmissions } from "@/services/mock/municipalSubmissionsStore";

const STATS = [
  { icon: Map, tone: "bg-brand-blue/10 text-brand-blue", label: "Total Barangays", value: "3" },
  { icon: Users, tone: "bg-brand-accent/10 text-brand-accent", label: "Registered Residents", value: "1,248" },
  { icon: Stethoscope, tone: "bg-brand-green/10 text-brand-green", label: "Total Consultations", value: "3,420" },
  { icon: Send, tone: "bg-brand-yellow/15 text-[#B07E00]", label: "Total Referrals", value: "186" },
  { icon: ShieldAlert, tone: "bg-brand-danger/10 text-brand-danger", label: "High-Risk Residents", value: "47" },
];

const ACTIVITY = [
  { type: "Referral", title: "New referral from San Isidro", desc: "Resident referred to Bicol Regional Training and Teaching Hospital", time: "2 hours ago", badge: "Pending" },
  { type: "Consultation", title: "Consultation records submitted", desc: "Barangay San Antonio submitted 12 consultation records", time: "5 hours ago", badge: "Received" },
  { type: "Alert", title: "High-risk resident identified", desc: "Hypertension Stage 2 — Barangay San Isidro", time: "8 hours ago", badge: "High" },
  { type: "Referral", title: "Referral status updated", desc: "Barangay San Antonio referral marked as Accepted", time: "1 day ago", badge: "Accepted" },
  { type: "Report", title: "Monthly municipal report available", desc: "June 2026 municipal health summary is ready for review", time: "2 days ago", badge: "Completed" },
];

export default function MHODashboard() {
  const submissions = useMunicipalSubmissions();
  const submissionStatus = useMemo(() => {
    const tcl = submissions.filter((s) => s.type === "TCL");
    const m1 = submissions.filter((s) => s.type === "M1");
    return {
      tclSubmitted: tcl.filter((s) => s.period === "September 2026").length,
      m1Submitted: m1.filter((s) => s.period === "September 2026").length,
      pending: submissions.filter((s) => s.reviewStatus === "Pending Review" || s.status === "Under Review").length,
      needsCorrection: submissions.filter((s) => s.reviewStatus === "Needs Correction" || s.reviewStatus === "Returned").length,
      totalBarangays: 3,
    };
  }, [submissions]);

  return (
    <>
      <PageHeader crumbs={["Dashboard"]} title="Municipal Health Dashboard" subtitle="Municipality of Pili, Camarines Sur" />

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-3 sm:gap-5">
        {STATS.map((s, i) => (
          <motion.div key={s.label} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}
            className="rounded-2xl border border-slate-200 bg-white shadow-card p-4 sm:p-5">
            <div className={`w-10 h-10 sm:w-11 sm:h-11 rounded-xl flex items-center justify-center ${s.tone}`}>
              <s.icon className="w-4 h-4 sm:w-5 sm:h-5" strokeWidth={1.8} />
            </div>
            <p className="mt-3 sm:mt-4 text-xs text-brand-gray uppercase tracking-wide">{s.label}</p>
            <p className="mt-1 text-xl sm:text-2xl font-stat font-bold text-brand-ink">{s.value}</p>
          </motion.div>
        ))}
      </div>

      {/* Submission status */}
      <Link to="/app/mho/submissions" className="mt-6 mb-6 block rounded-2xl border border-slate-200 bg-white p-4 hover:border-brand-blue/40 transition-colors dark:border-border dark:bg-card">
        <div className="flex flex-wrap items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-blue/10 text-brand-blue">
            <ClipboardList className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-brand-ink">Submission Status</p>
            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-brand-gray">
              <span>TCL {submissionStatus.tclSubmitted} / {submissionStatus.totalBarangays} submitted</span>
              <span>M1 {submissionStatus.m1Submitted} / {submissionStatus.totalBarangays} submitted</span>
              <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-brand-yellow" /> {submissionStatus.pending} pending review</span>
              <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-brand-accent" /> {submissionStatus.needsCorrection} needs correction</span>
            </p>
          </div>
          <ChevronRight className="h-4 w-4 shrink-0 text-brand-gray" />
        </div>
      </Link>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-5 mt-6">
        <Card className="lg:col-span-2 p-4 sm:p-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-4 sm:mb-5 gap-2">
            <h3 className="font-semibold text-brand-ink text-sm sm:text-base">Recent Activity</h3>
            <Activity className="w-4 h-4 text-brand-gray shrink-0" strokeWidth={1.8} />
          </div>
          <div className="space-y-1">
            {ACTIVITY.map((a, i) => (
              <div key={i} className="flex items-start gap-3 py-3 border-b border-brand-border last:border-0">
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-medium text-brand-blue bg-brand-light px-2 py-0.5 rounded-full">{a.type}</span>
                    <span className="text-xs text-brand-gray">{a.time}</span>
                  </div>
                  <p className="mt-1.5 text-sm font-medium text-brand-ink">{a.title}</p>
                  <p className="text-sm text-brand-gray line-clamp-2">{a.desc}</p>
                </div>
                <StatusBadge value={a.badge} />
              </div>
            ))}
          </div>
        </Card>

        <Card className="p-4 sm:p-6 h-fit">
          <h3 className="font-semibold text-brand-ink text-sm sm:text-base mb-4">Top Health Conditions</h3>
          <div className="space-y-3">
            {[
              { name: "Hypertension", count: 342, pct: 28 },
              { name: "Diabetes Mellitus", count: 189, pct: 15 },
              { name: "Respiratory Infections", count: 156, pct: 13 },
              { name: "Malnutrition", count: 98, pct: 8 },
              { name: "Anemia", count: 74, pct: 6 },
            ].map((c) => (
              <div key={c.name}>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-brand-ink">{c.name}</span>
                  <span className="text-brand-gray font-stat font-bold">{c.count}</span>
                </div>
                <div className="mt-1.5 h-1.5 bg-brand-border rounded-full overflow-hidden">
                  <div className="h-full bg-brand-blue rounded-full" style={{ width: `${c.pct * 3}%` }} />
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </>
  );
}