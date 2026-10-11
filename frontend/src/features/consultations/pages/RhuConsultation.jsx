import React, { useMemo, useState } from "react";
import PageHeader from "@/components/common/PageHeader";
import { Card } from "@/components/common/Card";
import StatCard from "@/components/common/StatCard";
import { CHECKUP_STATUS } from "@/lib/phnWorkflowMap";
import { usePhnWorkflow } from "@/hooks/usePhnWorkflow";
import PhnCheckupWorkbench, { CHECKUP_STATUS_TONES } from "@/features/consultations/components/PhnCheckupWorkbench";
import {
  partitionConsultationQueue,
  filterConsultationPatients,
} from "@/features/consultations/lib/consultationQueue";
import { Search, CheckCircle2, Stethoscope, RefreshCw, AlertCircle } from "lucide-react";

// Statuses that keep a patient in the ACTIVE consultation queue. Sourced from
// the shared status model so there is a single source of truth at the call site.
const ACTIVE_STATUSES = [CHECKUP_STATUS.WAITING, CHECKUP_STATUS.IN_CHECKUP];

/**
 * RHU Consultation Station.
 *
 * The second RHU station in the stakeholder workflow:
 *   Resident → RHU Triage → RHU Consultation (findings/assessment) → completed.
 *
 * It reuses the SAME persistent encounter the triage station submitted (the
 * `visits` queue via usePhnWorkflow source:"queue" → GET /phn/submissions) and
 * the SAME PhnCheckupWorkbench used by the PHN, so:
 *   - no duplicate resident/encounter is created,
 *   - the triage data entered upstream is shown read-only in the workbench,
 *   - findings/assessment/treatment/recommendations are recorded on the visit.
 *
 * The PHN assessment feature is unchanged — it reads the same queue. Backend
 * authorization (FEATURE_ROLES.consultationProcessing) admits both PHN and RHU.
 */

// RHU-facing labels for the shared pipeline statuses (the backend status model
// is unchanged; this only relabels for the consultation station).
const RHU_STATUS_LABEL = {
  [CHECKUP_STATUS.WAITING]: "Waiting for Consultation",
  [CHECKUP_STATUS.IN_CHECKUP]: "In Consultation",
  [CHECKUP_STATUS.COMPLETED]: "Completed",
};

const initials = (name) =>
  String(name || "")
    .split(" ")
    .filter(Boolean)
    .map((n) => n[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

const formatTime = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
};

export default function RhuConsultation() {
  const { patients, loading, error, refresh, startCheckup, completeCheckup } = usePhnWorkflow({ source: "queue" });

  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [activePatientId, setActivePatientId] = useState(null);
  const [toast, setToast] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const showToast = (message) => {
    setToast(message);
    setTimeout(() => setToast(null), 3000);
  };

  const handleRefresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await refresh();
    } finally {
      setRefreshing(false);
    }
  };

  const stats = useMemo(
    () => ({
      waiting: patients.filter((p) => p.status === CHECKUP_STATUS.WAITING).length,
      inConsult: patients.filter((p) => p.status === CHECKUP_STATUS.IN_CHECKUP).length,
      completed: patients.filter((p) => p.status === CHECKUP_STATUS.COMPLETED).length,
    }),
    [patients],
  );

  const filtered = useMemo(
    () => filterConsultationPatients(patients, { search: searchQuery, status: statusFilter }),
    [patients, searchQuery, statusFilter],
  );

  // Keep the referrals still awaiting / in consultation visually separate from
  // those already handled (completed). Membership follows the PERSISTED status
  // only — a completed encounter leaves the active queue but is retained under
  // "Completed" for history; nothing is deleted or re-statused to tidy the UI.
  const { active, handled } = useMemo(
    () => partitionConsultationQueue(filtered, ACTIVE_STATUSES),
    [filtered],
  );

  const activePatient = activePatientId ? patients.find((p) => p.id === activePatientId) || null : null;

  const handleAction = async (p) => {
    if (p.status === CHECKUP_STATUS.WAITING) {
      try {
        await startCheckup(p.id);
        showToast("Consultation started.");
        setActivePatientId(p.id);
      } catch (err) {
        showToast(err?.message || "Could not start the consultation.");
      }
    } else {
      setActivePatientId(p.id);
    }
  };

  const actionLabel = (p) => {
    if (p.status === CHECKUP_STATUS.WAITING) return "Open Consultation";
    if (p.status === CHECKUP_STATUS.IN_CHECKUP) return "Continue Consultation";
    return "View Consultation";
  };

  const handleComplete = async (patientId, recorded) => {
    try {
      await completeCheckup(patientId, recorded);
      showToast("Consultation completed successfully.");
      setActivePatientId(null);
    } catch (err) {
      showToast(err?.message || "Could not complete the consultation.");
    }
  };

  const renderRow = (p) => (
    <tr key={p.id} className="border-b border-brand-border last:border-0 hover:bg-brand-bg/50 transition-colors">
      <td className="px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 shrink-0 rounded-full bg-brand-blue text-white flex items-center justify-center text-xs font-semibold">
            {initials(p.patient)}
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-brand-ink">{p.patient}</p>
            <p className="truncate text-xs text-brand-gray">
              {[p.age ? `${p.age} yrs` : null, p.sex].filter(Boolean).join(" · ") || "—"}
            </p>
          </div>
        </div>
      </td>
      <td className="px-4 py-3">
        <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${p.barangay ? "bg-brand-blue/10 text-brand-blue" : "bg-slate-100 text-slate-600"}`}>
          {p.barangay || "Walk-in"}
        </span>
      </td>
      <td className="px-4 py-3 text-sm text-brand-ink">{p.reason || p.triage?.chiefComplaint || "—"}</td>
      <td className="px-4 py-3 text-sm text-brand-gray whitespace-nowrap">{formatTime(p.visitDate) || "—"}</td>
      <td className="px-4 py-3">
        <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${CHECKUP_STATUS_TONES[p.status] || "bg-slate-100 text-slate-600"}`}>
          <span className="w-1.5 h-1.5 rounded-full bg-current opacity-70" />
          {RHU_STATUS_LABEL[p.status] || p.status}
        </span>
      </td>
      <td className="px-4 py-3">
        <button
          onClick={() => handleAction(p)}
          className="text-sm font-medium text-brand-blue hover:underline whitespace-nowrap focus-visible:outline-none focus-visible:underline"
        >
          {actionLabel(p)}
        </button>
      </td>
    </tr>
  );

  const queueTable = (groupRows, { emptyIcon = null, emptyText } = {}) => (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead className="bg-brand-bg border-b border-brand-border">
          <tr>
            <th className="text-left text-xs font-semibold text-brand-gray uppercase tracking-wide px-4 py-3">Patient</th>
            <th className="text-left text-xs font-semibold text-brand-gray uppercase tracking-wide px-4 py-3">Barangay</th>
            <th className="text-left text-xs font-semibold text-brand-gray uppercase tracking-wide px-4 py-3">Reason for Visit</th>
            <th className="text-left text-xs font-semibold text-brand-gray uppercase tracking-wide px-4 py-3">Triage Completed</th>
            <th className="text-left text-xs font-semibold text-brand-gray uppercase tracking-wide px-4 py-3">Status</th>
            <th className="text-left text-xs font-semibold text-brand-gray uppercase tracking-wide px-4 py-3">Action</th>
          </tr>
        </thead>
        <tbody>
          {groupRows.length > 0 ? (
            groupRows.map(renderRow)
          ) : (
            <tr>
              <td colSpan={6} className="px-4 py-10 text-center text-sm text-brand-gray">
                {emptyIcon}
                {emptyText}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );

  return (
    <>
      <PageHeader
        crumbs={["Consultation"]}
        title="RHU Consultation Station"
        subtitle="Pick up completed triage encounters and record findings, assessment, and treatment."
      />

      {toast && (
        <div className="fixed bottom-4 right-4 z-[60] flex items-center gap-2 rounded-btn bg-brand-ink px-4 py-3 text-white shadow-lg">
          <CheckCircle2 className="w-4 h-4 text-brand-green" />
          <span className="text-sm">{toast}</span>
        </div>
      )}

      {error && (
        <Card className="mb-5 flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-center gap-2 text-sm text-brand-danger">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {error}
          </p>
          <button
            type="button"
            onClick={handleRefresh}
            disabled={refreshing}
            className="inline-flex items-center justify-center gap-1.5 rounded-btn border border-brand-border bg-white px-3 py-1.5 text-sm font-medium text-brand-ink transition-colors hover:bg-brand-bg disabled:opacity-60"
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} /> Try again
          </button>
        </Card>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        {[
          { label: "Waiting for Consultation", value: stats.waiting, icon: "ClipboardList", tone: "accent", index: 0 },
          { label: "In Consultation", value: stats.inConsult, icon: "Stethoscope", tone: "blue", index: 1 },
          { label: "Completed", value: stats.completed, icon: "CheckCircle2", tone: "green", index: 2 },
        ].map((stat) => (
          <StatCard key={stat.label} {...stat} />
        ))}
      </div>

      <Card className="p-4 mb-5">
        <div className="flex flex-col lg:flex-row gap-4 items-start lg:items-center justify-between">
          <div className="flex items-center gap-2 bg-brand-bg border border-brand-border rounded-btn px-3 py-2 flex-1 max-w-md w-full">
            <Search className="w-4 h-4 shrink-0 text-brand-gray" />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search patient..."
              className="bg-transparent text-sm outline-none w-full placeholder:text-brand-gray/70"
            />
          </div>
          <div className="flex w-full items-center gap-2 lg:w-auto">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="flex-1 bg-white border border-brand-border rounded-btn px-3 py-2 text-sm outline-none lg:flex-none"
            >
              <option value="All">All Statuses</option>
              {Object.values(CHECKUP_STATUS).map((s) => (
                <option key={s} value={s}>
                  {RHU_STATUS_LABEL[s] || s}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={handleRefresh}
              disabled={refreshing || loading}
              title="Refresh the queue"
              className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-btn border border-brand-border bg-white px-3 py-2 text-sm font-medium text-brand-ink transition-colors hover:bg-brand-bg disabled:opacity-60"
            >
              <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
              <span className="hidden sm:inline">Refresh</span>
            </button>
          </div>
        </div>
      </Card>

      {loading ? (
        <Card className="overflow-hidden">
          <div className="flex items-center justify-center gap-2 px-4 py-12 text-sm text-brand-gray">
            <RefreshCw className="h-4 w-4 animate-spin" /> Loading the consultation queue…
          </div>
        </Card>
      ) : (
        <div className="space-y-6">
          {/* Awaiting / in consultation — the ACTIVE queue. */}
          <Card className="overflow-hidden">
            <div className="flex items-center justify-between gap-3 border-b border-brand-border/70 px-4 py-3">
              <div>
                <h3 className="text-sm font-semibold text-brand-ink">Awaiting Consultation</h3>
                <p className="mt-0.5 text-xs text-brand-gray">
                  Referrals handed off from triage that still need a consultation.
                </p>
              </div>
              <span className="inline-flex shrink-0 items-center rounded-full bg-brand-blue/10 px-2.5 py-1 text-xs font-semibold text-brand-blue">
                {active.length} active
              </span>
            </div>
            {queueTable(active, {
              emptyIcon: <Stethoscope className="w-6 h-6 mx-auto mb-2 text-brand-gray/60" />,
              emptyText:
                patients.length === 0
                  ? "No encounters in the consultation queue yet."
                  : "No patients are awaiting consultation right now.",
            })}
          </Card>

          {/* Already handled — kept for history, out of the active queue. */}
          {handled.length > 0 && (
            <Card className="overflow-hidden">
              <div className="flex items-center justify-between gap-3 border-b border-brand-border/70 px-4 py-3">
                <div>
                  <h3 className="text-sm font-semibold text-brand-ink">Completed</h3>
                  <p className="mt-0.5 text-xs text-brand-gray">
                    Consultations already finished. Open one to view its recorded details.
                  </p>
                </div>
                <span className="inline-flex shrink-0 items-center rounded-full bg-brand-green/10 px-2.5 py-1 text-xs font-semibold text-brand-green">
                  {handled.length} done
                </span>
              </div>
              {queueTable(handled, { emptyText: "No completed consultations." })}
            </Card>
          )}
        </div>
      )}

      {activePatient && (
        <PhnCheckupWorkbench
          patient={activePatient}
          onClose={() => setActivePatientId(null)}
          onComplete={(recorded) => handleComplete(activePatient.id, recorded)}
        />
      )}
    </>
  );
}
