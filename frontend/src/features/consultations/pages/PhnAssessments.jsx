import React, { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import PageHeader from "@/components/common/PageHeader";
import { Card } from "@/components/common/Card";
import StatCard from "@/components/common/StatCard";
import { CHECKUP_STATUS } from "@/lib/phnWorkflowMap";
import { usePhnWorkflow } from "@/hooks/usePhnWorkflow";
import PhnCheckupWorkbench, { CHECKUP_STATUS_TONES } from "@/features/consultations/components/PhnCheckupWorkbench";
import { filterRowsByScope, scopeLabel, phnFilterOptions, rowMatchesOption } from "@/lib/phnScope";
import { usePhnCoverage } from "@/context/PhnCoverageContext";
import { riskOfPatient } from "@/lib/riskRules";
import { matchesCheckupSearch, isScheduledToday } from "@/features/consultations/lib/consultationQueue";
import { consultationLocationFor } from "@/lib/consultationLocations";
import { useAuth } from "@/context/AuthContext";
import { Search, CheckCircle2, Stethoscope, ClipboardCheck, Eye } from "lucide-react";

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

const PAGE_SIZE = 10;

const RiskBadge = ({ level }) => (
  <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${RISK_TONES[level] || RISK_TONES.Low}`}>
    {level}
  </span>
);

/** Format a stored visit date into a compact two-line schedule, or null. */
const formatScheduled = (raw) => {
  if (!raw) return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  return {
    date: d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }),
    time: d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }),
  };
};

const initialsOf = (name = "") =>
  name
    .split(" ")
    .filter(Boolean)
    .map((n) => n[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

const buildDraftBase = (patient) => ({
  // The resident's real id lets the referral page file the referral directly
  // instead of making the PHN re-select the patient from the directory.
  residentId: patient?.id || "",
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
  const { coverage } = usePhnCoverage();
  const navigate = useNavigate();
  const location = useLocation();
  // BUG-008: the check-up pipeline is the persistent PHN queue (DB-backed), not
  // a browser store. Mutations persist to /phn and refresh from the database.
  const { patients: workflowPatients, startCheckup, completeCheckup } =
    usePhnWorkflow({ source: "queue" });

  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [riskFilter, setRiskFilter] = useState("All");
  const [barangayFilter, setBarangayFilter] = useState("All");
  const [todayOnly, setTodayOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [activePatientId, setActivePatientId] = useState(null);
  const [toast, setToast] = useState(null);

  const visiblePatients = useMemo(
    () => filterRowsByScope(workflowPatients, user, coverage),
    [workflowPatients, user, coverage]
  );

  // Barangay is reference-only for a PHN (RHU scope), so the filter is only
  // offered when the current role actually has selectable barangays and the
  // data supports it — never as a permission bypass.
  const barangayOptions = useMemo(() => phnFilterOptions(user), [user]);
  const showBarangayFilter = barangayOptions.length > 1;

  const showToast = (message) => {
    setToast(message);
    setTimeout(() => setToast(null), 3000);
  };

  const stats = useMemo(() => {
    return {
      waiting: visiblePatients.filter((p) => p.status === CHECKUP_STATUS.WAITING).length,
      inCheckup: visiblePatients.filter((p) => p.status === CHECKUP_STATUS.IN_CHECKUP).length,
      priority: visiblePatients.filter((p) => riskOfPatient(p).level === "High").length,
      today: visiblePatients.filter((p) => isScheduledToday(p)).length,
    };
  }, [visiblePatients]);

  const filtered = useMemo(
    () =>
      visiblePatients.filter((p) => {
        if (!matchesCheckupSearch(p, searchQuery)) return false;
        if (statusFilter !== "All" && p.status !== statusFilter) return false;
        if (riskFilter !== "All" && riskOfPatient(p).level !== riskFilter) return false;
        if (showBarangayFilter && barangayFilter !== "All" && !rowMatchesOption(p, barangayFilter, user)) return false;
        if (todayOnly && !isScheduledToday(p)) return false;
        return true;
      }),
    [visiblePatients, searchQuery, statusFilter, riskFilter, barangayFilter, showBarangayFilter, todayOnly, user]
  );

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));

  // Reset to the first page whenever the result set changes.
  useEffect(() => {
    setPage(1);
  }, [searchQuery, statusFilter, riskFilter, barangayFilter, todayOnly]);

  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);

  const paginated = useMemo(
    () => filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [filtered, page]
  );

  const rangeStart = filtered.length === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const rangeEnd = Math.min(page * PAGE_SIZE, filtered.length);

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
    ? workflowPatients.find((p) => p.id === activePatientId) || null
    : null;

  const toggleStatus = (s) => setStatusFilter((cur) => (cur === s ? "All" : s));
  const toggleRisk = (r) => setRiskFilter((cur) => (cur === r ? "All" : r));
  const toggleToday = () => setTodayOnly((v) => !v);

  const handleStart = async (patient) => {
    try {
      await startCheckup(patient.id);
      showToast("Check-up started.");
      setActivePatientId(patient.id);
    } catch (err) {
      showToast(err?.message || "Could not start the check-up.");
    }
  };

  const handleContinue = (patient) => {
    setActivePatientId(patient.id);
  };

  const handleView = (patient) => {
    setActivePatientId(patient.id);
  };

  const handleComplete = async (patientId, recorded) => {
    try {
      await completeCheckup(patientId, recorded);
      showToast("Check-up completed successfully.");
    } catch (err) {
      showToast(err?.message || "Could not complete the check-up.");
    }
  };

  const handleOutcome = (kind) => {
    if (!activePatient) return;
    const patient = activePatient;
    const outcome = OUTCOME_MAP[kind] || "No Further Action";
    // The outcome only routes the PHN to the next persistent workflow
    // (referral / follow-up / health service), each of which saves through its
    // own backend endpoint. No browser-only workflow write remains here.
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

  const actionMeta = (p) => {
    if (p.status === CHECKUP_STATUS.WAITING) return { label: "Start Check-up", short: "Start", Glyph: Stethoscope };
    if (p.status === CHECKUP_STATUS.IN_CHECKUP) return { label: "Continue Check-up", short: "Continue", Glyph: ClipboardCheck };
    return { label: "View Check-up", short: "View", Glyph: Eye };
  };

  const handleAction = (p) => {
    if (p.status === CHECKUP_STATUS.WAITING) handleStart(p);
    else if (p.status === CHECKUP_STATUS.IN_CHECKUP) handleContinue(p);
    else handleView(p);
  };

  const kpis = [
    {
      label: "Waiting for PHN",
      value: stats.waiting,
      icon: "Users",
      tone: "accent",
      active: statusFilter === CHECKUP_STATUS.WAITING,
      onClick: () => toggleStatus(CHECKUP_STATUS.WAITING),
    },
    {
      label: "In Check-up",
      value: stats.inCheckup,
      icon: "ClipboardCheck",
      tone: "green",
      active: statusFilter === CHECKUP_STATUS.IN_CHECKUP,
      onClick: () => toggleStatus(CHECKUP_STATUS.IN_CHECKUP),
    },
    {
      label: "Priority Cases",
      value: stats.priority,
      icon: "AlertTriangle",
      tone: "danger",
      active: riskFilter === "High",
      onClick: () => toggleRisk("High"),
    },
    {
      label: "Total Today",
      value: stats.today,
      icon: "CalendarDays",
      tone: "blue",
      active: todayOnly,
      onClick: toggleToday,
    },
  ];

  const selectCls =
    "bg-white border border-brand-border rounded-btn px-3 py-2 text-sm text-brand-ink outline-none focus:border-brand-blue";

  return (
    <>
      <PageHeader
        dense
        crumbs={["PHN Check-ups"]}
        title="PHN Check-ups"
        subtitle="Conduct and manage patient check-ups and assessments."
      />

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-4 right-4 z-[60] flex items-center gap-2 rounded-btn bg-brand-ink px-4 py-3 text-white shadow-lg animate-in slide-in-from-bottom-2">
          <CheckCircle2 className="w-4 h-4 text-brand-green" />
          <span className="text-sm">{toast}</span>
        </div>
      )}

      <div className="space-y-4">
        {/* KPI cards */}
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
          {kpis.map((stat, i) => (
            <StatCard
              key={stat.label}
              compact
              indicator
              label={stat.label}
              value={stat.value}
              icon={stat.icon}
              tone={stat.tone}
              index={i}
              active={stat.active}
              onClick={stat.onClick}
            />
          ))}
        </div>

        {/* Search + filters toolbar */}
        <Card className="p-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
            <div className="flex items-center gap-2 bg-brand-bg border border-brand-border rounded-btn px-3 py-2 flex-1 min-w-0 lg:max-w-md">
              <Search className="w-4 h-4 shrink-0 text-brand-gray" />
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search patient name, ID, or reason..."
                aria-label="Search check-ups"
                className="bg-transparent text-sm outline-none w-full placeholder:text-brand-gray/70"
              />
            </div>
            <div className="flex flex-wrap items-center gap-2 lg:ml-auto">
              {showBarangayFilter && (
                <select
                  value={barangayFilter}
                  onChange={(e) => setBarangayFilter(e.target.value)}
                  aria-label="Filter by barangay"
                  className={selectCls}
                >
                  {barangayOptions.map((b) => (
                    <option key={b} value={b}>
                      {b === "All" ? "All Barangays" : b}
                    </option>
                  ))}
                </select>
              )}
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                aria-label="Filter by status"
                className={selectCls}
              >
                <option value="All">All Statuses</option>
                {Object.values(CHECKUP_STATUS).map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
              <select
                value={riskFilter}
                onChange={(e) => setRiskFilter(e.target.value)}
                aria-label="Filter by risk level"
                className={selectCls}
              >
                <option value="All">All Risk Levels</option>
                <option value="High">High Risk</option>
                <option value="Medium">Medium Risk</option>
                <option value="Low">Low Risk</option>
              </select>
            </div>
          </div>
        </Card>

        {/* Check-ups table */}
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-brand-bg border-b border-brand-border">
                <tr>
                  <th className="text-left text-[11px] font-semibold text-brand-gray uppercase tracking-wide px-4 py-2.5">Patient</th>
                  <th className="text-left text-[11px] font-semibold text-brand-gray uppercase tracking-wide px-4 py-2.5">Barangay</th>
                  <th className="text-left text-[11px] font-semibold text-brand-gray uppercase tracking-wide px-4 py-2.5">Reason for Visit</th>
                  <th className="text-left text-[11px] font-semibold text-brand-gray uppercase tracking-wide px-4 py-2.5">Risk</th>
                  <th className="text-left text-[11px] font-semibold text-brand-gray uppercase tracking-wide px-4 py-2.5">Status</th>
                  <th className="text-left text-[11px] font-semibold text-brand-gray uppercase tracking-wide px-4 py-2.5">Scheduled</th>
                  <th className="text-right text-[11px] font-semibold text-brand-gray uppercase tracking-wide px-4 py-2.5">Action</th>
                </tr>
              </thead>
              <tbody>
                {paginated.map((p) => {
                  const risk = riskOfPatient(p);
                  const meta = actionMeta(p);
                  const schedule = formatScheduled(p.visitDate || p.triage?.date);
                  const reason = p.reason || p.triage?.chiefComplaint || "—";
                  return (
                    <tr key={p.id} className="border-b border-brand-border last:border-0 hover:bg-brand-bg/50 transition-colors">
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 shrink-0 rounded-full bg-brand-blue text-white flex items-center justify-center text-[11px] font-semibold">
                            {initialsOf(p.patient)}
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-brand-ink truncate max-w-[180px]" title={p.patient}>
                              {p.patient}
                            </p>
                            <p className="text-xs text-brand-gray">
                              {p.age ? `${p.age} yrs` : "—"}
                              {p.sex ? ` · ${p.sex}` : ""}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-2.5">
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${p.barangay ? "bg-brand-blue/10 text-brand-blue" : "bg-slate-100 text-slate-600"}`}>
                          {scopeLabel(p, user)}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="block text-sm text-brand-ink truncate max-w-[220px]" title={reason}>
                          {reason}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        <span title={risk.reason}>
                          <RiskBadge level={risk.level} />
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ${CHECKUP_STATUS_TONES[p.status] || EMPTY_STATE[p.status] || "bg-slate-100 text-slate-600"}`}>
                          <span className="w-1.5 h-1.5 rounded-full bg-current opacity-70" />
                          {p.status}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        {schedule ? (
                          <div className="leading-tight">
                            <p className="text-sm text-brand-ink whitespace-nowrap">{schedule.date}</p>
                            <p className="text-xs text-brand-gray whitespace-nowrap">{schedule.time}</p>
                          </div>
                        ) : (
                          <span className="text-sm text-brand-gray">—</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <button
                          onClick={() => handleAction(p)}
                          aria-label={meta.label}
                          title={meta.label}
                          className="inline-flex items-center gap-1.5 rounded-btn border border-brand-border px-2.5 py-1.5 text-xs font-medium text-brand-blue hover:bg-brand-blue/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/40 whitespace-nowrap"
                        >
                          <meta.Glyph className="w-3.5 h-3.5" />
                          <span>{meta.short}</span>
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-10 text-center text-sm text-brand-gray">
                      No check-ups match the selected filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {filtered.length > 0 && pageCount > 1 && (
            <nav
              aria-label="Check-ups pagination"
              className="flex flex-col gap-3 border-t border-brand-border px-4 py-3 text-xs text-brand-gray sm:flex-row sm:items-center sm:justify-between"
            >
              <span>
                Showing {rangeStart}–{rangeEnd} of {filtered.length} check-ups
              </span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className="rounded-btn border border-brand-border px-3 py-1.5 font-medium text-brand-blue hover:bg-brand-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Previous
                </button>
                <span aria-current="page" className="min-w-9 rounded-btn bg-brand-blue px-3 py-1.5 text-center font-semibold text-white">
                  {page}
                </span>
                <button
                  type="button"
                  disabled={page >= pageCount}
                  onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
                  className="rounded-btn border border-brand-border px-3 py-1.5 font-medium text-brand-blue hover:bg-brand-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Next
                </button>
              </div>
            </nav>
          )}
        </Card>
      </div>

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
