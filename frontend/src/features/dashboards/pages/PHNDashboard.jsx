import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import PageHeader from "@/components/common/PageHeader";
import StatCard from "@/components/common/StatCard";
import { Card } from "@/components/common/Card";
import StatusBadge from "@/components/common/StatusBadge";
import {
  REFERRAL_STATUSES,
  barangayCommunity,
  phnAlerts,
} from "@/services/mock/mockPhnData";
import {
  CHECKUP_STATUS,
  useWorkflowStore,
  startPatientCheckup,
  patchReferral,
  workflowHelpers,
} from "@/services/mock/mockWorkflowStore";
import { filterRowsByScope, getPHNScope, isPHN, scopeLabel } from "@/lib/phnScope";
import { riskOfPatient } from "@/lib/riskRules";
import { useAuth } from "@/context/AuthContext";
import {
  Users, Activity, CalendarClock, ClipboardList, X, CheckCircle2, MapPin, ChevronRight, Clock, Bell, UserPlus,
} from "lucide-react";

const REFERRAL_STATUS_TONES = {
  "For Review": "bg-amber-50 text-amber-700",
  Accepted: "bg-emerald-50 text-emerald-700",
  Pending: "bg-amber-50 text-amber-700",
  "Follow-up Required": "bg-brand-accent/10 text-brand-accent",
  Completed: "bg-emerald-50 text-emerald-700",
};

const FOLLOWUP_STATUS_TONES = {
  Scheduled: "bg-brand-blue/10 text-brand-blue",
  "Due Today": "bg-brand-accent/10 text-brand-accent",
  Overdue: "bg-rose-50 text-rose-700",
  Completed: "bg-emerald-50 text-emerald-700",
  Cancelled: "bg-slate-100 text-slate-600",
};

const QUEUE_STATUS_TONES = {
  "Waiting for PHN": "bg-brand-accent/10 text-brand-accent",
  "In Check-up": "bg-brand-blue/10 text-brand-blue",
  "Consultation Completed": "bg-emerald-50 text-emerald-700",
};

const RISK_TONES = {
  High: "bg-brand-danger/10 text-brand-danger",
  Medium: "bg-brand-yellow/15 text-[#B07E00]",
  Low: "bg-brand-green/10 text-brand-green",
};

const ALERT_LEVELS = {
  critical: { dot: "bg-red-500", tone: "bg-brand-danger/10 text-brand-danger", label: "Critical" },
  warning: { dot: "bg-amber-400", tone: "bg-brand-yellow/15 text-[#B07E00]", label: "Warning" },
};

const QUICK_ACTIONS = [
  { icon: UserPlus, label: "PHN Check-ups", path: "/app/phn/consultations" },
  { icon: ClipboardList, label: "Review Referrals", path: "/app/phn/referrals" },
  { icon: CalendarClock, label: "View Follow-ups", path: "/app/phn/followups" },
  { icon: Activity, label: "View Reports", path: "/app/phn/reports" },
];

const welcomeFor = (user) => {
  const first = (user?.name || "Ana Villanueva").split(" ")[0];
  return `Welcome, Nurse ${first}`;
};

const subtitleFor = (user) => {
  const scope = getPHNScope(user);
  if (scope && scope.level === "barangay") {
    return `Today's health summary for ${scope.assignedBarangay} and the Rural Health Unit.`;
  }
  return "Today's RHU health summary.";
};

export default function PHNDashboard() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const scope = getPHNScope(user);
  const isPhn = isPHN(user);
  const assigned = scope && scope.level === "barangay" ? scope.assignedBarangay : null;
  const welcome = welcomeFor(user);
  const subtitle = subtitleFor(user);

  const store = useWorkflowStore();

  // Every collection is re-filtered by the signed-in PHN's scope before render
  // so dashboard counts can never leak another barangay's data.
  const allPatients = useMemo(() => filterRowsByScope(store.patients, user), [store.patients, user]);
  const visibleQueue = useMemo(
    () => allPatients.filter((p) => p.status === CHECKUP_STATUS.WAITING),
    [allPatients]
  );
  const visibleInCheckup = useMemo(
    () => allPatients.filter((p) => p.status === CHECKUP_STATUS.IN_CHECKUP),
    [allPatients]
  );
  const visibleCompleted = useMemo(
    () => allPatients.filter((p) => p.status === CHECKUP_STATUS.COMPLETED),
    [allPatients]
  );
  const visibleReferrals = useMemo(() => filterRowsByScope(store.referrals, user), [store.referrals, user]);
  const visibleFollowUps = useMemo(() => filterRowsByScope(store.followUps, user), [store.followUps, user]);
  const visibleAlerts = useMemo(() => filterRowsByScope(phnAlerts, user), [user]);
  const visibleServices = useMemo(() => filterRowsByScope(store.services, user), [store.services, user]);

  const [barangayDetail, setBarangayDetail] = useState(null);
  const [reviewReferral, setReviewReferral] = useState(null);
  const [referralStatus, setReferralStatus] = useState("");
  const [alertDetail, setAlertDetail] = useState(null);
  const [servicesModal, setServicesModal] = useState(false);
  const [toast, setToast] = useState(null);

  const showToast = (message) => {
    setToast(message);
    setTimeout(() => setToast(null), 3000);
  };

  const anyModalOpen = Boolean(barangayDetail || reviewReferral || alertDetail || servicesModal);

  useEffect(() => {
    if (!anyModalOpen) return undefined;
    document.body.style.overflow = "hidden";
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      setBarangayDetail(null);
      setReviewReferral(null);
      setAlertDetail(null);
      setServicesModal(false);
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "";
      document.removeEventListener("keydown", onKey);
    };
  }, [anyModalOpen]);

  // Overview table is only meaningful for a barangay-assigned PHN — it lists
  // their own assigned barangay only. Unassigned PHNs see a compact check-up
  // summary instead.
  const communityRows = useMemo(() => {
    if (scope && scope.level === "barangay") {
      const row = barangayCommunity.find((b) => b.name === scope.assignedBarangay) || barangayCommunity[0];
      const brgyActive = allPatients.filter(
        (p) => p.barangay === scope.assignedBarangay && p.status !== CHECKUP_STATUS.COMPLETED
      ).length;
      return [
        {
          ...row,
          activeCases: row.activeCases + brgyActive,
          referrals: visibleReferrals.filter((r) => r.barangay === scope.assignedBarangay && r.status !== "Completed").length,
          followUps: visibleFollowUps.filter((f) => f.barangay === scope.assignedBarangay && f.status !== "Completed" && f.status !== "Cancelled").length,
        },
      ];
    }
    return [];
  }, [scope, allPatients, visibleReferrals, visibleFollowUps]);

  const stats = useMemo(() => {
    const today = workflowHelpers.todayLong();
    return [
      {
        icon: "Users",
        label: "Patients for Check-up",
        value: String(visibleQueue.length),
        tone: "accent",
        onClick: () => navigate("/app/phn/consultations"),
      },
      {
        icon: "Activity",
        label: "In Check-up",
        value: String(visibleInCheckup.length),
        tone: "blue",
        onClick: () => navigate("/app/phn/consultations"),
      },
      {
        icon: "CalendarCheck",
        label: "Completed Today",
        value: String(visibleCompleted.filter((p) => p.checkup?.completedAt === today).length),
        tone: "green",
        onClick: () => navigate("/app/phn/consultations"),
      },
      {
        icon: "Send",
        label: "Pending Referrals",
        value: String(visibleReferrals.filter((r) => r.status !== "Completed").length),
        tone: "yellow",
        onClick: () => navigate("/app/phn/referrals"),
      },
      {
        icon: "CalendarClock",
        label: "Follow-ups Due",
        value: String(visibleFollowUps.filter((f) => f.status === "Scheduled" || f.status === "Due Today" || f.status === "Overdue").length),
        tone: "blue",
        onClick: () => navigate("/app/phn/followups"),
      },
      {
        icon: "Stethoscope",
        label: "Health Services Today",
        value: String(visibleServices.length),
        tone: "green",
        onClick: () => navigate("/app/phn/services"),
      },
    ];
  }, [visibleQueue, visibleInCheckup, visibleCompleted, visibleReferrals, visibleFollowUps, visibleServices, navigate]);

  const dueFollowUps = visibleFollowUps
    .filter((f) => f.status === "Due Today" || f.status === "Overdue" || (f.status === "Scheduled" && f.dueDate === "Tomorrow"))
    .slice(0, 4);

  const handleReview = (referral) => {
    setReviewReferral(referral);
    setReferralStatus(referral.status);
  };

  const handleReferralStatusSave = () => {
    if (!reviewReferral || !referralStatus) return;
    patchReferral(reviewReferral.id, { status: referralStatus });
    setReviewReferral(null);
    setReferralStatus("");
    showToast("Referral updated successfully.");
  };

  const startCheckup = (patient) => {
    startPatientCheckup(patient.id, user?.name);
    showToast("Check-up started.");
    navigate("/app/phn/consultations", { state: { openCheckup: patient.id } });
  };

  return (
    <>
      <PageHeader
        crumbs={["Home", "Dashboard"]}
        title={welcome}
        subtitle={subtitle}
      />

      {/* Coverage chip */}
      {isPhn && (
        <div className="-mt-3 mb-5 flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-brand-border bg-white px-3 py-1 text-xs font-medium text-brand-gray">
            <MapPin className="w-3.5 h-3.5 text-brand-blue" />
            Coverage: {scope.level === "barangay" ? `${scope.assignedBarangay} + RHU` : "RHU"}
          </span>
        </div>
      )}

      {/* Toast */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            className="fixed bottom-4 right-4 z-[60] flex items-center gap-2 rounded-btn bg-brand-ink px-4 py-3 shadow-lg"
          >
            <CheckCircle2 className="h-4 w-4 text-brand-green" />
            <span className="text-sm text-white">{toast}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 sm:gap-4 mb-6">
        {stats.map((s, i) => (
          <StatCard
            key={s.label}
            icon={s.icon}
            label={s.label}
            value={s.value}
            tone={s.tone}
            index={i}
            onClick={s.onClick}
          />
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-5">
        {/* Patients for Check-up — single queue source, scope-filtered */}
        <Card id="queue" className="p-4 sm:p-6 lg:col-span-2 scroll-mt-24">
          <div className="flex items-center justify-between gap-3 mb-4">
            <div>
              <h3 className="font-semibold text-brand-ink text-sm sm:text-base">
                {assigned ? `Patients for Check-up (${assigned})` : "Patients for Check-up"}
              </h3>
              <p className="text-xs text-brand-gray mt-0.5">
                Patients who completed triage and are waiting for PHN consultation.
              </p>
            </div>
            <Users className="w-4 h-4 text-brand-gray shrink-0" />
          </div>
          <div className="overflow-x-auto -mx-1">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-brand-bg border-b border-brand-border text-left">
                  <th className="px-4 py-2.5 text-xs font-semibold text-brand-gray uppercase tracking-wide">Patient</th>
                  <th className="px-4 py-2.5 text-xs font-semibold text-brand-gray uppercase tracking-wide">Barangay</th>
                  <th className="px-4 py-2.5 text-xs font-semibold text-brand-gray uppercase tracking-wide">Reason for Visit</th>
                  <th className="px-4 py-2.5 text-xs font-semibold text-brand-gray uppercase tracking-wide">Risk</th>
                  <th className="px-4 py-2.5 text-xs font-semibold text-brand-gray uppercase tracking-wide">Status</th>
                  <th className="px-4 py-2.5 text-xs font-semibold text-brand-gray uppercase tracking-wide text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {visibleQueue.map((q) => {
                  const risk = riskOfPatient(q);
                  return (
                    <tr key={q.id} className="border-b border-brand-border last:border-0 hover:bg-brand-bg/50 transition-colors">
                      <td className="px-4 py-3">
                        <p className="font-medium text-brand-ink">{q.patient}</p>
                        <p className="text-xs text-brand-gray">{q.age} yrs · {q.sex}</p>
                      </td>
                      <td className="px-4 py-3 text-brand-ink">
                        <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${q.barangay ? "bg-brand-blue/10 text-brand-blue" : "bg-slate-100 text-slate-600"}`}>
                          {scopeLabel(q, user)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-brand-ink">{q.reason || q.triage?.chiefComplaint}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${RISK_TONES[risk.level] || RISK_TONES.Low}`}>
                          {risk.level}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${QUEUE_STATUS_TONES[q.status] || "bg-slate-100 text-slate-600"}`}>
                          <span className="w-1.5 h-1.5 rounded-full bg-current opacity-70" />
                          {q.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => startCheckup(q)}
                          className="text-sm font-medium text-brand-blue hover:underline whitespace-nowrap"
                        >
                          Start Check-up
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {visibleQueue.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-sm text-brand-gray">
                      No patients are waiting for check-up within your scope.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>

        {/* Right rail — assigned: community overview; unassigned: check-up progress */}
        <Card className="p-4 sm:p-6 h-fit">
          {assigned ? (
            <>
              <div className="flex items-center justify-between gap-3 mb-4">
                <div>
                  <h3 className="font-semibold text-brand-ink text-sm sm:text-base">Community Health Overview</h3>
                  <p className="text-xs text-brand-gray mt-0.5">{assigned}</p>
                </div>
                <MapPin className="w-4 h-4 text-brand-gray shrink-0" />
              </div>
              <div className="overflow-x-auto -mx-1">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-brand-bg border-b border-brand-border text-left">
                      <th className="px-4 py-2.5 text-xs font-semibold text-brand-gray uppercase tracking-wide">Metric</th>
                      <th className="px-4 py-2.5 text-xs font-semibold text-brand-gray uppercase tracking-wide text-right">Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {communityRows.length > 0 &&
                      [
                        { label: "Active Cases", value: communityRows[0].activeCases },
                        { label: "Pending Referrals", value: communityRows[0].referrals },
                        { label: "Follow-ups", value: communityRows[0].followUps },
                        { label: "Priority Cases", value: communityRows[0].priorityCases },
                      ].map((m) => (
                        <tr key={m.label} className="border-b border-brand-border last:border-0">
                          <td className="px-4 py-2.5 text-brand-ink">{m.label}</td>
                          <td className="px-4 py-2.5 text-right font-semibold text-brand-ink">{m.value}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
              <button
                onClick={() => setBarangayDetail(communityRows[0])}
                className="mt-4 text-sm font-medium text-brand-blue hover:underline"
              >
                View Details
              </button>
            </>
          ) : (
            <>
              <div className="flex items-center justify-between gap-3 mb-4">
                <div>
                  <h3 className="font-semibold text-brand-ink text-sm sm:text-base">Check-up Progress</h3>
                  <p className="text-xs text-brand-gray mt-0.5">RHU-level check-up activity today</p>
                </div>
                <Activity className="w-4 h-4 text-brand-gray shrink-0" />
              </div>
              <div className="space-y-3">
                {[
                  { label: "Waiting for PHN", value: visibleQueue.length, tone: "text-brand-accent bg-brand-accent/10" },
                  { label: "In Check-up", value: visibleInCheckup.length, tone: "text-brand-blue bg-brand-blue/10" },
                  { label: "Consultation Completed", value: visibleCompleted.length, tone: "text-brand-green bg-brand-green/10" },
                ].map((row) => (
                  <div key={row.label} className="flex items-center justify-between rounded-btn bg-brand-bg/60 border border-brand-border px-4 py-3">
                    <span className="text-sm text-brand-ink">{row.label}</span>
                    <span className={`rounded-full px-2.5 py-1 text-sm font-semibold ${row.tone}`}>{row.value}</span>
                  </div>
                ))}
                <button
                  onClick={() => navigate("/app/phn/consultations")}
                  className="mt-1 text-sm font-medium text-brand-blue hover:underline"
                >
                  Open PHN Check-ups
                </button>
              </div>
            </>
          )}
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-5 mt-4 sm:mt-5">
        {/* Referrals */}
        <Card className="p-4 sm:p-6">
          <div className="flex items-center justify-between gap-3 mb-4">
            <h3 className="font-semibold text-brand-ink text-sm sm:text-base">Referrals Requiring Attention</h3>
            <button onClick={() => navigate("/app/phn/referrals")} className="flex items-center gap-1 text-sm font-medium text-brand-blue hover:underline shrink-0">
              View All <ChevronRight className="w-4 h-4" />
            </button>
          </div>
          <div className="space-y-3">
            {visibleReferrals.filter((r) => r.status !== "Completed").slice(0, 4).map((r) => (
              <div key={r.id} className="border border-brand-border rounded-btn px-4 py-3">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium text-brand-ink text-sm">{r.resident}</p>
                    <p className="text-xs text-brand-gray">
                      {r.barangay || "RHU"} · {r.reason}
                    </p>
                  </div>
                  <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium shrink-0 ${REFERRAL_STATUS_TONES[r.status] || "bg-slate-100 text-slate-600"}`}>
                    <span className="w-1.5 h-1.5 rounded-full bg-current opacity-70" /> {r.status}
                  </span>
                </div>
                <div className="flex items-center gap-3 mt-3">
                  <button onClick={() => handleReview(r)} className="text-xs font-medium text-brand-blue hover:underline">Review</button>
                  <span className="text-brand-border">|</span>
                  <button onClick={() => handleReview(r)} className="text-xs font-medium text-brand-blue hover:underline">View</button>
                  <span className="text-brand-border">|</span>
                  <button onClick={() => handleReview(r)} className="text-xs font-medium text-brand-blue hover:underline">Update Status</button>
                </div>
              </div>
            ))}
            {visibleReferrals.filter((r) => r.status !== "Completed").length === 0 && (
              <p className="text-sm text-brand-gray py-6 text-center">No referrals require attention.</p>
            )}
          </div>
        </Card>

        {/* Follow-ups Due */}
        <Card className="p-4 sm:p-6">
          <div className="flex items-center justify-between gap-3 mb-4">
            <h3 className="font-semibold text-brand-ink text-sm sm:text-base">Follow-ups Due</h3>
            <button onClick={() => navigate("/app/phn/followups")} className="flex items-center gap-1 text-sm font-medium text-brand-blue hover:underline shrink-0">
              View All <ChevronRight className="w-4 h-4" />
            </button>
          </div>
          <div className="space-y-3">
            {dueFollowUps.length === 0 && <p className="text-sm text-brand-gray py-6 text-center">No follow-ups due.</p>}
            {dueFollowUps.map((f) => (
              <div key={f.id} className="flex flex-col sm:flex-row sm:items-center sm:justify-between border border-brand-border rounded-btn px-4 py-3 gap-2">
                <div className="min-w-0">
                  <p className="font-medium text-brand-ink text-sm">
                    {f.resident} <span className="text-brand-gray font-normal">— {f.barangay || "RHU"} — {f.purpose}</span>
                  </p>
                  <p className="text-xs text-brand-gray flex items-center gap-1 mt-0.5"><Clock className="w-3 h-3" /> {f.dueDate} · {f.time}</p>
                </div>
                <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium shrink-0 ${FOLLOWUP_STATUS_TONES[f.status] || "bg-slate-100 text-slate-600"}`}>
                  <span className="w-1.5 h-1.5 rounded-full bg-current opacity-70" /> {f.status}
                </span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-5 mt-4 sm:mt-5">
        {/* Community Health Alerts */}
        <Card className="p-4 sm:p-6">
          <div className="flex items-center justify-between gap-3 mb-4">
            <h3 className="font-semibold text-brand-ink text-sm sm:text-base">Community Health Alerts</h3>
            <Bell className="w-4 h-4 text-brand-gray shrink-0" strokeWidth={1.8} />
          </div>
          <div className="space-y-3">
            {visibleAlerts.map((a) => {
              const level = ALERT_LEVELS[a.level] || ALERT_LEVELS.warning;
              return (
                <div key={a.id} className="border border-brand-border rounded-btn px-4 py-3">
                  <div className="flex items-start gap-2.5">
                    <span className={`mt-1 w-2.5 h-2.5 rounded-full shrink-0 ${level.dot}`} />
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-brand-ink text-sm">{a.type}</p>
                      <p className="text-xs text-brand-gray mt-0.5">{a.barangay || "RHU"} — {a.description}</p>
                      <button onClick={() => setAlertDetail(a)} className="text-xs font-medium text-brand-blue hover:underline mt-2">Review</button>
                    </div>
                  </div>
                </div>
              );
            })}
            {visibleAlerts.length === 0 && (
              <p className="text-sm text-brand-gray py-6 text-center">No alerts within your scope.</p>
            )}
          </div>
        </Card>

        {/* Today's Health Services */}
        <Card className="p-4 sm:p-6">
          <div className="flex items-center justify-between gap-3 mb-4">
            <h3 className="font-semibold text-brand-ink text-sm sm:text-base">Today's Health Services</h3>
            <button onClick={() => setServicesModal(true)} className="text-sm font-medium text-brand-blue hover:underline shrink-0">View Services</button>
          </div>
          <div className="space-y-2.5">
            {visibleServices.slice(0, 5).map((s) => (
              <div key={s.id} className="flex items-center justify-between border border-brand-border rounded-btn px-4 py-2.5 gap-2">
                <div className="min-w-0">
                  <p className="font-medium text-brand-ink text-sm truncate">{s.name}</p>
                  <p className="text-xs text-brand-gray">{s.barangay || "RHU"} · {s.count}</p>
                </div>
                <StatusBadge value={s.status === "Ongoing" ? "Ongoing" : s.status === "Completed" ? "Completed" : "Scheduled"} />
              </div>
            ))}
            {visibleServices.length === 0 && (
              <p className="text-sm text-brand-gray py-6 text-center">No health services today within your scope.</p>
            )}
          </div>
        </Card>
      </div>

      {/* Quick actions */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-4 sm:mt-5">
        {QUICK_ACTIONS.map((a) => (
          <button
            key={a.label}
            onClick={() => navigate(a.path)}
            className="flex items-center justify-center gap-2 border border-brand-border rounded-btn px-4 py-3 text-sm font-medium text-brand-ink hover:border-brand-blue hover:bg-brand-light transition-colors"
          >
            <a.icon className="w-4 h-4 text-brand-blue" /> {a.label}
          </button>
        ))}
      </div>

      {/* Barangay Details Modal (assigned PHN only) */}
      <AnimatePresence>
        {barangayDetail && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setBarangayDetail(null)}>
            <motion.div
              initial={{ opacity: 0, y: 12, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.98 }}
              className="w-full max-w-md"
              onClick={(e) => e.stopPropagation()}
            >
              <Card role="dialog" aria-modal="true" aria-label={`${barangayDetail.name} details`} className="overflow-hidden">
                <div className="flex shrink-0 items-center justify-between border-b border-brand-border px-6 py-4">
                  <div>
                    <h3 className="text-base font-semibold text-brand-ink">Barangay {barangayDetail.name}</h3>
                    <p className="text-xs text-brand-gray mt-0.5">Community health summary</p>
                  </div>
                  <button onClick={() => setBarangayDetail(null)} className="flex h-9 w-9 items-center justify-center rounded-lg text-brand-gray transition-colors hover:bg-brand-bg hover:text-brand-ink" aria-label="Close modal">
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <div className="px-6 py-4">
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    {[
                      { label: "Active Cases", value: barangayDetail.activeCases },
                      { label: "Pending Referrals", value: barangayDetail.referrals },
                      { label: "Follow-ups Due", value: barangayDetail.followUps },
                      { label: "Priority Cases", value: barangayDetail.priorityCases },
                    ].map((row) => (
                      <div key={row.label} className="rounded-btn bg-brand-bg px-3 py-2.5">
                        <p className="text-[11px] text-brand-gray uppercase tracking-wide">{row.label}</p>
                        <p className="mt-0.5 font-semibold text-brand-ink">{row.value}</p>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="flex shrink-0 justify-end gap-3 border-t border-brand-border bg-white px-6 py-4">
                  <button onClick={() => setBarangayDetail(null)} className="px-4 py-2 rounded-btn text-sm font-medium text-brand-gray hover:bg-brand-bg transition-colors">Close</button>
                </div>
              </Card>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Review Referral Modal */}
      <AnimatePresence>
        {reviewReferral && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setReviewReferral(null)}>
            <motion.div
              initial={{ opacity: 0, y: 12, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.98 }}
              className="w-full max-w-md"
              onClick={(e) => e.stopPropagation()}
            >
              <Card role="dialog" aria-modal="true" aria-label="Review referral" className="flex max-h-[90vh] flex-col overflow-hidden">
                <div className="flex shrink-0 items-center justify-between border-b border-brand-border px-6 py-4">
                  <h3 className="text-base font-semibold text-brand-ink">Review Referral</h3>
                  <button onClick={() => setReviewReferral(null)} className="flex h-9 w-9 items-center justify-center rounded-lg text-brand-gray transition-colors hover:bg-brand-bg hover:text-brand-ink" aria-label="Close modal">
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto px-6 py-4">
                  <div className="space-y-4">
                    <div>
                      <h4 className="text-xs font-semibold text-brand-gray uppercase tracking-wide mb-3">Patient Information</h4>
                      <div className="grid grid-cols-2 gap-3 text-sm">
                        <p className="text-brand-gray">Name: <span className="text-brand-ink">{reviewReferral.resident}</span></p>
                        <p className="text-brand-gray">Barangay: <span className="text-brand-ink">{reviewReferral.barangay || "RHU"}</span></p>
                        <p className="text-brand-gray">Age: <span className="text-brand-ink">{reviewReferral.age}</span></p>
                        <p className="text-brand-gray">Referral No.: <span className="text-brand-ink">{reviewReferral.referralNo}</span></p>
                      </div>
                    </div>
                    <div>
                      <h4 className="text-xs font-semibold text-brand-gray uppercase tracking-wide mb-3">Referral Information</h4>
                      <div className="grid grid-cols-2 gap-3 text-sm">
                        <p className="text-brand-gray">Reason: <span className="text-brand-ink">{reviewReferral.reason}</span></p>
                        <p className="text-brand-gray">Facility: <span className="text-brand-ink">{reviewReferral.facility}</span></p>
                        <p className="text-brand-gray">Date: <span className="text-brand-ink">{reviewReferral.date}</span></p>
                        <p className="text-brand-gray">Referred by: <span className="text-brand-ink">{reviewReferral.referringPersonnel}</span></p>
                        <p className="text-brand-gray">Priority: <span className="text-brand-ink">{reviewReferral.priority}</span></p>
                        <p className="text-brand-gray">
                          Status: <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${REFERRAL_STATUS_TONES[reviewReferral.status]}`}>{reviewReferral.status}</span>
                        </p>
                      </div>
                    </div>
                    {reviewReferral.notes && (
                      <div>
                        <h4 className="text-xs font-semibold text-brand-gray uppercase tracking-wide mb-2">Notes</h4>
                        <p className="text-sm text-brand-ink">{reviewReferral.notes}</p>
                      </div>
                    )}
                    <div>
                      <label className="text-sm font-medium text-brand-ink block mb-1.5">Update Status <span className="text-red-500">*</span></label>
                      <select
                        value={referralStatus}
                        onChange={(e) => setReferralStatus(e.target.value)}
                        className="w-full bg-white border border-brand-border rounded-btn px-3 py-2.5 text-sm outline-none focus:border-brand-blue"
                      >
                        {REFERRAL_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </div>
                  </div>
                </div>
                <div className="flex shrink-0 justify-end gap-3 border-t border-brand-border bg-white px-6 py-4">
                  <button onClick={() => setReviewReferral(null)} className="px-4 py-2 rounded-btn text-sm font-medium text-brand-gray hover:bg-brand-bg transition-colors">Cancel</button>
                  <button onClick={handleReferralStatusSave} className="px-4 py-2 rounded-btn text-sm font-medium bg-brand-blue text-white hover:bg-brand-dark transition-colors">Update Status</button>
                </div>
              </Card>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Alert Review Modal */}
      <AnimatePresence>
        {alertDetail && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setAlertDetail(null)}>
            <motion.div
              initial={{ opacity: 0, y: 12, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.98 }}
              className="w-full max-w-md"
              onClick={(e) => e.stopPropagation()}
            >
              <Card role="dialog" aria-modal="true" aria-label="Review community health alert" className="overflow-hidden">
                <div className="flex shrink-0 items-center justify-between border-b border-brand-border px-6 py-4">
                  <h3 className="text-base font-semibold text-brand-ink">Community Health Alert</h3>
                  <button onClick={() => setAlertDetail(null)} className="flex h-9 w-9 items-center justify-center rounded-lg text-brand-gray transition-colors hover:bg-brand-bg hover:text-brand-ink" aria-label="Close modal">
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <div className="px-6 py-4">
                  <div className="flex items-center gap-2.5 mb-4">
                    <span className={`w-2.5 h-2.5 rounded-full ${(ALERT_LEVELS[alertDetail.level] || ALERT_LEVELS.warning).dot}`} />
                    <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${(ALERT_LEVELS[alertDetail.level] || ALERT_LEVELS.warning).tone}`}>
                      {(ALERT_LEVELS[alertDetail.level] || ALERT_LEVELS.warning).label}
                    </span>
                    <span className="text-xs text-brand-gray">{alertDetail.status}</span>
                  </div>
                  <div className="space-y-3 text-sm">
                    <div className="flex justify-between"><span className="text-brand-gray">Alert type</span><span className="font-medium text-brand-ink">{alertDetail.type}</span></div>
                    <div className="flex justify-between"><span className="text-brand-gray">Affected area</span><span className="font-medium text-brand-ink">{alertDetail.barangay || "RHU (all barangays)"}</span></div>
                    <div className="flex justify-between"><span className="text-brand-gray">Number of cases</span><span className="font-medium text-brand-ink">{alertDetail.cases}</span></div>
                    <div className="flex justify-between"><span className="text-brand-gray">Date detected</span><span className="font-medium text-brand-ink">{alertDetail.detected}</span></div>
                    <div>
                      <p className="text-brand-gray mb-1">Description</p>
                      <p className="text-brand-ink">{alertDetail.description}</p>
                    </div>
                    <div>
                      <p className="text-brand-gray mb-1">Recommended action</p>
                      <p className="text-brand-ink">{alertDetail.recommendedAction}</p>
                    </div>
                  </div>
                </div>
                <div className="flex shrink-0 justify-end gap-3 border-t border-brand-border bg-white px-6 py-4">
                  <button onClick={() => setAlertDetail(null)} className="px-4 py-2 rounded-btn text-sm font-medium text-brand-gray hover:bg-brand-bg transition-colors">Close</button>
                </div>
              </Card>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Today's Services Modal */}
      <AnimatePresence>
        {servicesModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setServicesModal(false)}>
            <motion.div
              initial={{ opacity: 0, y: 12, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.98 }}
              className="w-full max-w-md"
              onClick={(e) => e.stopPropagation()}
            >
              <Card role="dialog" aria-modal="true" aria-label="Today's health services" className="flex max-h-[90vh] flex-col overflow-hidden">
                <div className="flex shrink-0 items-center justify-between border-b border-brand-border px-6 py-4">
                  <div>
                    <h3 className="text-base font-semibold text-brand-ink">Today's Health Services</h3>
                    <p className="text-xs text-brand-gray mt-0.5">{assigned ? `RHU + ${assigned}` : "RHU-level services"}</p>
                  </div>
                  <button onClick={() => setServicesModal(false)} className="flex h-9 w-9 items-center justify-center rounded-lg text-brand-gray transition-colors hover:bg-brand-bg hover:text-brand-ink" aria-label="Close modal">
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto px-6 py-4">
                  <div className="space-y-3">
                    {visibleServices.map((s) => (
                      <div key={s.id} className="border border-brand-border rounded-btn px-4 py-3">
                        <div className="flex items-center justify-between gap-2">
                          <p className="font-medium text-brand-ink text-sm">{s.name}</p>
                          <StatusBadge value={s.status === "Ongoing" ? "Ongoing" : s.status === "Completed" ? "Completed" : "Scheduled"} />
                        </div>
                        <p className="text-xs text-brand-gray mt-1">{s.barangay || "RHU"} · {s.count} · {s.time} · {s.personnel}</p>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="flex shrink-0 justify-end gap-3 border-t border-brand-border bg-white px-6 py-4">
                  <button onClick={() => setServicesModal(false)} className="px-4 py-2 rounded-btn text-sm font-medium text-brand-gray hover:bg-brand-bg transition-colors">Close</button>
                </div>
              </Card>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  );
}
