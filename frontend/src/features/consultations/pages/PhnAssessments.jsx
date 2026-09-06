import React, { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import PageHeader from "@/components/common/PageHeader";
import { Card } from "@/components/common/Card";
import {
  CHECKUP_STATUS,
  useWorkflowStore,
  startPatientCheckup,
  completePatientCheckup,
  setCheckupOutcome,
  workflowHelpers,
} from "@/services/mock/mockWorkflowStore";
import PhnCheckupWorkbench, { CHECKUP_STATUS_TONES } from "@/features/consultations/components/PhnCheckupWorkbench";
import { filterRowsByScope, phnFilterOptions, rowMatchesOption, scopeLabel } from "@/lib/phnScope";
import { riskOfPatient } from "@/lib/riskRules";
import { consultationLocationFor } from "@/lib/consultationLocations";
import { useAuth } from "@/context/AuthContext";
import { Search, CheckCircle2, Users, ClipboardCheck, UserCheck, AlertTriangle } from "lucide-react";

const EMPTY_STATE = {
  "Waiting for PHN": "bg-brand-accent/10 text-brand-accent",
  "In Check-up": "bg-brand-blue/10 text-brand-blue",
  "Consultation Completed": "bg-brand-green/10 text-brand-green",
};

const RISK_TONES = {
  High: "bg-brand-danger/10 text-brand-danger",
  Medium: "bg-brand-yellow/15 text-[#B07E00]",
  Low: "bg-brand-green/10 text-brand-green",
};

const OUTCOME_MAP = {
  referral: "Referral Required",
  followup: "Follow-up Required",
  monitoring: "Continue Monitoring",
  service: "Health Service Needed",
};

const RiskBadge = ({ level }) => (
  <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${RISK_TONES[level] || RISK_TONES.Low}`}>
    {level}
  </span>
);

const buildDraftBase = (patient) => ({
  resident: patient?.patient || "",
  age: patient?.age ?? "",
  sex: patient?.sex || "",
  barangay: patient?.barangay || null,
  consultationLocation: consultationLocationFor(patient || {}),
  reason: patient?.reason || patient?.triage?.chiefComplaint || "",
  findings: patient?.checkup?.assessment || "",
  riskLevel: patient?.checkup?.riskLevel || "",
  clinicalNotes: patient?.checkup?.clinicalNotes || "",
  recommendations: patient?.checkup?.recommendations || "",
  visitDate: patient?.visitDate || "",
});

export default function PhnCheckups() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const store = useWorkflowStore();

  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [barangayFilter, setBarangayFilter] = useState("All");
  const [activePatientId, setActivePatientId] = useState(null);
  const [toast, setToast] = useState(null);

  const visiblePatients = useMemo(
    () => filterRowsByScope(store.patients, user),
    [store.patients, user]
  );

  const showToast = (message) => {
    setToast(message);
    setTimeout(() => setToast(null), 3000);
  };

  const stats = useMemo(() => {
    const today = workflowHelpers.todayLong();
    return {
      waiting: visiblePatients.filter((p) => p.status === CHECKUP_STATUS.WAITING).length,
      inCheckup: visiblePatients.filter((p) => p.status === CHECKUP_STATUS.IN_CHECKUP).length,
      priority: visiblePatients.filter((p) => riskOfPatient(p).level === "High").length,
      completed: visiblePatients.filter(
        (p) => p.status === CHECKUP_STATUS.COMPLETED && p.checkup?.completedAt === today
      ).length,
    };
  }, [visiblePatients]);

  const filtered = visiblePatients.filter((p) => {
    const matchesSearch =
      searchQuery === "" || p.patient.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = statusFilter === "All" || p.status === statusFilter;
    const matchesBarangay = rowMatchesOption(p, barangayFilter, user);
    return matchesSearch && matchesStatus && matchesBarangay;
  });

  const completedToday = useMemo(() => {
    const today = workflowHelpers.todayLong();
    return visiblePatients
      .filter((p) => p.status === CHECKUP_STATUS.COMPLETED && p.checkup?.completedAt === today)
      .sort((a, b) => String(b.checkup?.completedAt || "").localeCompare(String(a.checkup?.completedAt || "")));
  }, [visiblePatients]);

  const filterOptions = phnFilterOptions(user);

  // Allow other pages (e.g. the PHN dashboard "Start Check-up" action) to
  // deep-open the consultation workbench for a patient.
  useEffect(() => {
    const openId = location.state?.openCheckup;
    if (openId && visiblePatients.some((p) => p.id === openId)) {
      setActivePatientId(openId);
      navigate(location.pathname, { replace: true });
    }
  }, [location.state, location.pathname, navigate, visiblePatients]);

  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(null), 3000);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [toast]);

  const activePatient = activePatientId
    ? store.patients.find((p) => p.id === activePatientId) || null
    : null;

  const handleStart = (patient) => {
    startPatientCheckup(patient.id, user?.name);
    showToast("Check-up started.");
    setActivePatientId(patient.id);
  };

  const handleContinue = (patient) => {
    setActivePatientId(patient.id);
  };

  const handleView = (patient) => {
    setActivePatientId(patient.id);
  };

  const handleComplete = (patientId, recorded) => {
    completePatientCheckup(patientId, recorded, user?.name);
    showToast("Check-up completed successfully.");
  };

  const handleOutcome = (kind) => {
    if (!activePatient) return;
    const patient = activePatient;
    const outcome = OUTCOME_MAP[kind] || "No Further Action";
    setCheckupOutcome(patient.id, outcome);
    const base = buildDraftBase({ ...patient, checkup: { ...(patient.checkup || {}), outcome } });
    setActivePatientId(null);
    if (kind === "referral") {
      navigate("/app/phn/referrals", { state: { referralDraft: base } });
    } else if (kind === "followup") {
      navigate("/app/phn/followups", { state: { followUpDraft: base } });
    } else if (kind === "monitoring" || kind === "service") {
      navigate("/app/phn/services", { state: { serviceDraft: { ...base, kind } } });
    }
  };

  const actionLabel = (p) => {
    if (p.status === CHECKUP_STATUS.WAITING) return "Start Check-up";
    if (p.status === CHECKUP_STATUS.IN_CHECKUP) return "Continue Check-up";
    return "View Check-up";
  };

  const handleAction = (p) => {
    if (p.status === CHECKUP_STATUS.WAITING) handleStart(p);
    else if (p.status === CHECKUP_STATUS.IN_CHECKUP) handleContinue(p);
    else handleView(p);
  };

  return (
    <>
      <PageHeader
        crumbs={["Home", "PHN Check-ups"]}
        title="PHN Check-ups"
        subtitle="Conduct and manage patient check-ups within your assigned coverage."
      />

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-4 right-4 z-[60] flex items-center gap-2 rounded-btn bg-brand-ink px-4 py-3 text-white shadow-lg animate-in slide-in-from-bottom-2">
          <CheckCircle2 className="w-4 h-4 text-brand-green" />
          <span className="text-sm">{toast}</span>
        </div>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
        {[
          { label: "Waiting for PHN", value: stats.waiting, icon: Users, tone: "bg-brand-accent/10 text-brand-accent" },
          { label: "In Check-up", value: stats.inCheckup, icon: ClipboardCheck, tone: "bg-brand-blue/10 text-brand-blue" },
          { label: "Priority Cases", value: stats.priority, icon: AlertTriangle, tone: "bg-brand-danger/10 text-brand-danger" },
          { label: "Completed Today", value: stats.completed, icon: UserCheck, tone: "bg-brand-green/10 text-brand-green" },
        ].map((stat) => (
          <Card key={stat.label} className="p-5">
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${stat.tone}`}>
                <stat.icon className="w-5 h-5" />
              </div>
              <div>
                <p className="text-sm text-brand-gray">{stat.label}</p>
                <p className="text-2xl font-semibold text-brand-ink mt-0.5">{stat.value}</p>
              </div>
            </div>
          </Card>
        ))}
      </div>

      {/* Filters */}
      <Card className="p-4 mb-5">
        <div className="flex flex-col lg:flex-row gap-4 items-start lg:items-center justify-between">
          <div className="flex items-center gap-2 bg-brand-bg border border-brand-border rounded-btn px-3 py-2 flex-1 max-w-md">
            <Search className="w-4 h-4 text-brand-gray" />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search patient..."
              className="bg-transparent text-sm outline-none w-full placeholder:text-brand-gray/70"
            />
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <select
              value={barangayFilter}
              onChange={(e) => setBarangayFilter(e.target.value)}
              className="bg-white border border-brand-border rounded-btn px-3 py-2 text-sm outline-none"
            >
              {filterOptions.map((b) => (
                <option key={b} value={b}>{b === "All" ? "All Accessible" : b === "RHU" ? "RHU-level" : b}</option>
              ))}
            </select>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="bg-white border border-brand-border rounded-btn px-3 py-2 text-sm outline-none"
            >
              <option value="All">All Statuses</option>
              {Object.values(CHECKUP_STATUS).map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
        </div>
      </Card>

      {/* Check-ups Table */}
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-brand-bg border-b border-brand-border">
              <tr>
                <th className="text-left text-xs font-semibold text-brand-gray uppercase tracking-wide px-4 py-3">Patient</th>
                <th className="text-left text-xs font-semibold text-brand-gray uppercase tracking-wide px-4 py-3">Barangay</th>
                <th className="text-left text-xs font-semibold text-brand-gray uppercase tracking-wide px-4 py-3">Reason for Visit</th>
                <th className="text-left text-xs font-semibold text-brand-gray uppercase tracking-wide px-4 py-3">Risk</th>
                <th className="text-left text-xs font-semibold text-brand-gray uppercase tracking-wide px-4 py-3">Status</th>
                <th className="text-left text-xs font-semibold text-brand-gray uppercase tracking-wide px-4 py-3">Action</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => {
                const risk = riskOfPatient(p);
                return (
                  <tr key={p.id} className="border-b border-brand-border hover:bg-brand-bg/50 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-full bg-brand-blue text-white flex items-center justify-center text-xs font-semibold">
                          {p.patient.split(" ").map((n) => n[0]).slice(0, 2).join("")}
                        </div>
                        <div>
                          <p className="text-sm font-medium text-brand-ink">{p.patient}</p>
                          <p className="text-xs text-brand-gray">{p.age} yrs · {p.sex}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${p.barangay ? "bg-brand-blue/10 text-brand-blue" : "bg-slate-100 text-slate-600"}`}>
                        {scopeLabel(p, user)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-brand-ink">{p.reason || p.triage?.chiefComplaint}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <RiskBadge level={risk.level} />
                        <span className="text-[11px] text-brand-gray max-w-[150px] truncate" title={risk.reason}>
                          {risk.reason}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${CHECKUP_STATUS_TONES[p.status] || EMPTY_STATE[p.status] || "bg-slate-100 text-slate-600"}`}>
                        <span className="w-1.5 h-1.5 rounded-full bg-current opacity-70" />
                        {p.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => handleAction(p)}
                        className="text-sm font-medium text-brand-blue hover:underline whitespace-nowrap"
                      >
                        {actionLabel(p)}
                      </button>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-sm text-brand-gray">
                    No check-ups match the selected filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Today's Completed Check-ups */}
      <Card className="p-4 sm:p-6 mt-5">
        <div className="flex items-center justify-between gap-3 mb-4">
          <div>
            <h3 className="font-semibold text-brand-ink text-sm sm:text-base">Today's Completed Check-ups</h3>
            <p className="text-xs text-brand-gray mt-0.5">Recently completed PHN consultations.</p>
          </div>
          <UserCheck className="w-4 h-4 text-brand-gray shrink-0" />
        </div>
        <div className="overflow-x-auto -mx-1">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-brand-bg border-b border-brand-border text-left">
                <th className="px-4 py-2.5 text-xs font-semibold text-brand-gray uppercase tracking-wide">Patient</th>
                <th className="px-4 py-2.5 text-xs font-semibold text-brand-gray uppercase tracking-wide">Reason</th>
                <th className="px-4 py-2.5 text-xs font-semibold text-brand-gray uppercase tracking-wide">Risk</th>
                <th className="px-4 py-2.5 text-xs font-semibold text-brand-gray uppercase tracking-wide">Outcome</th>
                <th className="px-4 py-2.5 text-xs font-semibold text-brand-gray uppercase tracking-wide text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {completedToday.map((p) => (
                <tr key={p.id} className="border-b border-brand-border last:border-0">
                  <td className="px-4 py-3">
                    <p className="font-medium text-brand-ink">{p.patient}</p>
                    <p className="text-xs text-brand-gray">{scopeLabel(p, user)}</p>
                  </td>
                  <td className="px-4 py-3 text-brand-ink">{p.reason || p.triage?.chiefComplaint}</td>
                  <td className="px-4 py-3"><RiskBadge level={riskOfPatient(p).level} /></td>
                  <td className="px-4 py-3 text-brand-ink">{p.checkup?.outcome || "No Further Action"}</td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => handleView(p)}
                      className="text-sm font-medium text-brand-blue hover:underline whitespace-nowrap"
                    >
                      View
                    </button>
                  </td>
                </tr>
              ))}
              {completedToday.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-sm text-brand-gray">
                    No completed check-ups today.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Check-up workbench (start / continue / view) */}
      {activePatient && (
        <PhnCheckupWorkbench
          patient={activePatient}
          onClose={() => setActivePatientId(null)}
          onComplete={(recorded) => handleComplete(activePatient.id, recorded)}
          onOutcome={
            activePatient.status === CHECKUP_STATUS.COMPLETED && activePatient.checkup
              ? handleOutcome
              : undefined
          }
        />
      )}
    </>
  );
}
