import React, { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import PageHeader from "@/components/common/PageHeader";
import { Card } from "@/components/common/Card";
import { householdsApi } from "@/services/api/householdsApi";
import { householdRiskApi } from "@/services/api/householdRiskApi";
import { toRiskCluster, daysSince } from "../lib/riskClusterAdapter";
import {
  RISK_LEVELS, RISK_LEVEL_LABELS, householdRiskBasis,
} from "@/lib/householdRisk";
import {
  Home, PhoneCall, UserPlus, ArrowUpRight, RefreshCw, ChevronRight, Users, MapPin, FileText, Activity, CalendarDays, Plus,
} from "lucide-react";
import { FollowUpModal, AssignWorkerModal, EscalateModal } from "../components/RiskActionModals";

const levelTone = {
  [RISK_LEVELS.STABLE]: { chip: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400", dot: "bg-brand-green" },
  [RISK_LEVELS.MONITOR]: { chip: "bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400", dot: "bg-brand-yellow" },
  [RISK_LEVELS.INTERVENTION]: { chip: "bg-orange-50 text-orange-700 dark:bg-orange-500/15 dark:text-orange-400", dot: "bg-brand-accent" },
  [RISK_LEVELS.PRIORITY]: { chip: "bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-400", dot: "bg-brand-danger" },
};

const formatDate = (iso) => {
  if (!iso) return "—";
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
};

const newVisitRequestId = () => globalThis.crypto?.randomUUID?.()
  || 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.floor(Math.random() * 16);
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
const todayLocal = () => {
  const date = new Date();
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 10);
};
const VISIT_REASONS = ["Updating Household Information", "Verification", "Follow-up", "Monitoring", "Other"];
const visitLabel = (number) => {
  const n = Number(number);
  const words = { 1: "First Visit", 2: "Second Visit", 3: "Third Visit", 4: "Fourth Visit", 5: "Fifth Visit" };
  if (words[n]) return words[n];
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" }[n % 10] || "th");
  return `${n}${suffix} Visit`;
};

/** Information cell used across the risk profile. */
function InfoCell({ icon: Icon, label, value }) {
  return (
    <div className="rounded-btn bg-brand-bg/60 dark:bg-card-nested px-3 py-2.5">
      <div className="flex items-center gap-1.5">
        {Icon && <Icon className="h-3.5 w-3.5 text-brand-gray" strokeWidth={1.8} />}
        <p className="text-[11px] text-brand-gray uppercase tracking-wide">{label}</p>
      </div>
      <p className="mt-1 text-sm font-medium text-brand-ink">{value || "—"}</p>
    </div>
  );
}

export default function HouseholdRiskDetail() {
  const { id } = useParams();
  const { user } = useAuth();

  const [phase, setPhase] = useState("loading"); // loading | ready | error | notfound
  const [loadError, setLoadError] = useState(null);
  const [household, setHousehold] = useState(null);
  const [action, setAction] = useState(null); // followup | assign | escalate
  const [toast, setToast] = useState(null);
  const [visits, setVisits] = useState([]);
  const [visitDate, setVisitDate] = useState(todayLocal());
  const [visitReason, setVisitReason] = useState("Follow-up");
  const [visitRequestId, setVisitRequestId] = useState(newVisitRequestId());
  const [savingVisit, setSavingVisit] = useState(false);
  const [visitError, setVisitError] = useState("");

  // Load the real household (server risk classification + members) and merge
  // its persisted risk workflow. Out-of-scope households resolve as 404 (the
  // server never leaks existence across barangay/municipality scope).
  const load = useCallback(async () => {
    if (!id) {
      setPhase("notfound");
      return;
    }
    setPhase("loading");
    setLoadError(null);
    try {
      const res = await householdsApi.get(id);
      const record = res?.household || null;
      if (!record) {
        setHousehold(null);
        setPhase("notfound");
        return;
      }
      const [workflow, visitResult] = await Promise.all([
        householdRiskApi.getWorkflow(id).catch(() => null),
        user?.role === "bhw" ? householdsApi.listVisits(id) : Promise.resolve({ visits: [] }),
      ]);
      setVisits(Array.isArray(visitResult?.visits) ? visitResult.visits : []);
      setHousehold(toRiskCluster(record, workflow));
      setPhase("ready");
    } catch (err) {
      if (err?.status === 404) {
        setHousehold(null);
        setPhase("notfound");
        return;
      }
      setLoadError(err);
      setPhase("error");
    }
  }, [id, user?.role]);

  useEffect(() => {
    load();
  }, [load]);

  const showToast = (message) => {
    setToast(message);
    setTimeout(() => setToast(null), 3000);
  };

  // Persist a workflow change, then refresh from the server so the on-screen
  // state always reflects the authoritative persisted record.
  const persistWorkflow = async (patch, successMessage) => {
    try {
      await householdRiskApi.saveWorkflow(id, patch);
      showToast(successMessage);
      await load();
    } catch (err) {
      showToast(err?.message || "Could not save the change.");
    }
  };

  const saveVisit = async () => {
    if (!visitDate || savingVisit) return;
    setSavingVisit(true);
    setVisitError("");
    try {
      await householdsApi.createVisit(id, { visitDate, requestId: visitRequestId, visitReason, updatedSections: [] });
      setVisitDate(todayLocal());
      setVisitReason("Follow-up");
      setVisitRequestId(newVisitRequestId());
      await load();
      showToast("Household visit recorded.");
    } catch (error) {
      setVisitError(error?.message || "Could not record the household visit. Try again.");
    } finally {
      setSavingVisit(false);
    }
  };

  const backPath = locationPathForRole();

  const basis = household ? householdRiskBasis({ level: household.risk.level, count: household.risk.count, indicators: household.risk.indicators }) : null;

  // Loading skeleton
  if (phase === "loading") {
    return (
      <>
        <PageHeader crumbs={["Households", "Household Details"]} title="Household Risk Profile" subtitle="Loading household information..." />
        <div className="h-40 animate-pulse rounded-2xl border border-slate-200 bg-slate-100" />
        <div className="mt-4 h-72 animate-pulse rounded-2xl border border-slate-200 bg-slate-100" />
      </>
    );
  }

  // Not found
  if (phase === "notfound" || (phase === "ready" && !household)) {
    return (
      <>
        <PageHeader crumbs={["Households", "Household Details"]} title="Household Risk Profile" subtitle="Household record" />
        <Card className="p-10 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-brand-danger/10">
            <Home className="h-7 w-7 text-brand-danger" />
          </div>
          <h3 className="mt-4 text-lg font-semibold text-brand-ink">Household Not Found</h3>
          <p className="mx-auto mt-1.5 max-w-md text-sm text-brand-gray">
            The household record could not be found or you may not have permission to access it.
          </p>
          <Link to={backPath} className="mt-5 inline-flex items-center gap-2 rounded-btn bg-brand-blue px-5 py-2.5 text-sm font-medium text-white hover:bg-brand-dark">
            Back to Risk Overview
          </Link>
        </Card>
      </>
    );
  }

  // Error
  if (phase === "error") {
    return (
      <>
        <PageHeader crumbs={["Households", "Household Details"]} title="Household Risk Profile" subtitle="Household record" />
        <Card className="p-10 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-brand-danger/10">
            <RefreshCw className="h-7 w-7 text-brand-danger" />
          </div>
          <h3 className="mt-4 text-lg font-semibold text-brand-ink">Unable to Load Household</h3>
          <p className="mx-auto mt-1.5 max-w-md text-sm text-brand-gray">
            We couldn't retrieve the household information.
          </p>
          <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
            <button
              onClick={() => load()}
              className="inline-flex items-center gap-2 rounded-btn bg-brand-blue px-5 py-2.5 text-sm font-medium text-white hover:bg-brand-dark"
            >
              <RefreshCw className="h-4 w-4" /> Retry
            </button>
            <Link to={backPath} className="rounded-btn border border-brand-border bg-white px-5 py-2.5 text-sm font-medium text-brand-gray hover:bg-brand-bg dark:hover:bg-hover">
              Back to Risk Overview
            </Link>
          </div>
          {loadError && <p className="mt-4 text-xs text-brand-gray">Technical error: {loadError.message}</p>}
        </Card>
      </>
    );
  }

  const h = household;
  const tone = levelTone[h.risk.level];

  return (
    <>
      <PageHeader
        crumbs={["Households", "Household Details"]}
        title={`${h.head} Household`}
        subtitle={`${h.id} · Barangay ${h.barangay}`}
        action={
          <span className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-brand-gray dark:border-border dark:bg-card dark:text-slate-300">
            <Activity className="h-3.5 w-3.5 text-brand-blue" /> Household Risk Profile
          </span>
        }
      />

      {toast && (
        <div className="fixed bottom-4 right-4 z-[80] flex items-center gap-2 rounded-btn bg-brand-ink px-4 py-3 text-white shadow-lg">
          <span className="text-sm">{toast}</span>
        </div>
      )}

      <div className="space-y-5">
        {/* Household information */}
        <Card className="p-5">
          <h3 className="mb-4 text-sm font-semibold text-brand-ink">Household Information</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <InfoCell icon={Home} label="Household ID" value={h.id} />
            <InfoCell icon={MapPin} label="Barangay" value={h.barangay} />
            <InfoCell icon={MapPin} label="Purok" value={h.purok || "—"} />
            <InfoCell icon={Home} label="Address" value={h.address || "—"} />
            <InfoCell icon={Users} label="Household Members" value={h.members} />
            <InfoCell icon={UserPlus} label="Assigned Worker" value={h.assignedWorker || "—"} />
            <InfoCell icon={Activity} label="Follow-up Status" value={h.workflowStatus || "—"} />
            <InfoCell icon={FileText} label="Last Assessment" value={formatDate(h.lastAssessment)} />
          </div>
        </Card>

        {user?.role === "bhw" && (
          <Card className="p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-brand-ink">Visit Tracking</h3>
                <p className="mt-1 text-sm text-brand-gray">A visit number is assigned for this household after the visit is saved.</p>
              </div>
              {visits[0] && (
                <span className="rounded-full bg-brand-blue/10 px-3 py-1 text-xs font-semibold text-brand-blue">
                  Latest: {visitLabel(visits[0].visitNumber)}
                </span>
              )}
            </div>

            <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
              <label className="w-full max-w-xs text-sm font-medium text-brand-ink">
                Visit date
                <input
                  type="date"
                  value={visitDate}
                  onChange={(event) => {
                    setVisitDate(event.target.value);
                    setVisitRequestId(newVisitRequestId());
                  }}
                  className="mt-1.5 w-full rounded-input border border-brand-border bg-white px-3.5 py-2.5 text-sm text-brand-ink outline-none focus:border-brand-blue"
                />
              </label>
              <label className="w-full max-w-xs text-sm font-medium text-brand-ink">
                Visit reason
                <select
                  value={visitReason}
                  onChange={(event) => setVisitReason(event.target.value)}
                  className="mt-1.5 w-full rounded-input border border-brand-border bg-white px-3.5 py-2.5 text-sm text-brand-ink outline-none focus:border-brand-blue"
                >
                  {VISIT_REASONS.map((reason) => <option key={reason} value={reason}>{reason}</option>)}
                </select>
              </label>
              <button
                type="button"
                onClick={saveVisit}
                disabled={!visitDate || savingVisit}
                className="inline-flex min-h-10 items-center justify-center gap-2 rounded-btn bg-brand-blue px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Plus className="h-4 w-4" /> {savingVisit ? "Saving…" : "Record Visit"}
              </button>
            </div>
            {visitError && <p role="alert" className="mt-2 text-sm text-red-600">{visitError}</p>}

            <div className="mt-5">
              {visits.length ? (
                <ol className="space-y-2">
                  {visits.map((visit, index) => (
                    <li key={visit.id} className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3 ${index === 0 ? "border-brand-blue/30 bg-brand-blue/5" : "border-brand-border bg-white"}`}>
                      <div className="flex min-w-0 items-center gap-3">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-blue/10 text-brand-blue">
                          <CalendarDays className="h-4 w-4" />
                        </span>
                        <div>
                          <p className="text-sm font-semibold text-brand-ink">{visitLabel(visit.visitNumber)}{index === 0 ? " · Most recent" : ""}</p>
                          <p className="text-sm text-brand-gray">{formatDate(visit.visitDate)}</p>
                          <p className="text-xs text-brand-gray">{visit.visitReason || "Follow-up"}</p>
                          {visit.updatedSections?.length > 0 && (
                            <p className="mt-1 text-xs text-brand-gray">Updated: {visit.updatedSections.join(", ")}</p>
                          )}
                        </div>
                      </div>
                      <div className="text-right text-xs text-brand-gray">
                        {visit.recordedByName && <p>Recorded by {visit.recordedByName}</p>}
                        {visit.status && <p className="mt-0.5">{visit.status}</p>}
                      </div>
                      {visit.profileSnapshot && (
                        <details className="w-full border-t border-brand-border pt-2">
                          <summary className="cursor-pointer text-xs font-medium text-brand-blue">View profile saved at this visit</summary>
                          <div className="mt-2 grid gap-2 text-xs text-brand-gray sm:grid-cols-2">
                            <p>Head: {visit.profileSnapshot.headName || "—"}</p>
                            <p>Zone / Purok: {visit.profileSnapshot.purok || "—"}</p>
                            <p>Address: {visit.profileSnapshot.streetAddress || "—"}</p>
                            <p>Respondent: {[visit.profileSnapshot.respondentFirst, visit.profileSnapshot.respondentLast].filter(Boolean).join(" ") || "—"}</p>
                            <p>Water source: {visit.profileSnapshot.waterSource || "—"}</p>
                            <p>Toilet facility: {visit.profileSnapshot.toiletType || "—"}</p>
                            <p className="sm:col-span-2">Members: {(visit.profileSnapshot.members || []).map((member) => member.name).filter(Boolean).join(", ") || "—"}</p>
                          </div>
                        </details>
                      )}
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="rounded-xl border border-dashed border-brand-border px-4 py-5 text-center text-sm text-brand-gray">No visits recorded yet. The first saved visit will be numbered First Visit.</p>
              )}
            </div>
          </Card>
        )}

        {/* Risk & Early Intervention */}
        <Card className="p-5">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <h3 className="text-sm font-semibold text-brand-ink">Risk &amp; Early Intervention</h3>
            <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium ${tone.chip}`}>
              <span className={`h-2 w-2 rounded-full ${tone.dot}`} /> {RISK_LEVEL_LABELS[h.risk.level]}
            </span>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
            <InfoCell icon={Activity} label="Risk Level" value={RISK_LEVEL_LABELS[h.risk.level]} />
            <InfoCell icon={FileText} label="Risk Indicators" value={h.risk.count} />
            <InfoCell icon={Activity} label="Risk Score" value={h.risk.score} />
            <InfoCell icon={Home} label="Last Household Visit" value={daysSince(h.lastHouseholdVisit) === null ? "—" : `${daysSince(h.lastHouseholdVisit)} days ago`} />
          </div>

          {/* Basis + contributing indicators */}
          <div className="rounded-2xl border border-slate-200 dark:border-border bg-brand-bg/60 dark:bg-card-nested p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-brand-gray mb-1">Risk Classification Basis</p>
            <p className="text-sm text-brand-ink">{basis.headline}</p>
            {basis.contributing.length > 0 ? (
              <ul className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-1">
                {basis.contributing.map((c) => (
                  <li key={c} className="flex items-start gap-2 text-sm text-brand-gray">
                    <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-accent" /> {c}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-sm text-brand-gray">No significant indicators detected.</p>
            )}
            <p className="mt-3 text-sm text-brand-ink">{h.risk.recommendedAction}</p>
            <p className="mt-1 text-xs text-brand-gray">
              Risk Score reflects configured household monitoring criteria — it is not a clinical diagnosis.
            </p>
          </div>

          {/* Risk history */}
          <div className="mt-4 rounded-2xl border border-slate-200 dark:border-border bg-white p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-brand-gray mb-3">Risk History</p>
            {h.history.length > 0 ? (
              <div className="space-y-1.5">
                {h.history.map((entry) => (
                  <div key={`${entry.month}-${entry.year}`} className="flex items-center justify-between gap-3 text-sm">
                    <span className="text-brand-gray">{entry.month} {entry.year}</span>
                    <span className="inline-flex items-center gap-1.5 text-brand-ink">
                      <span className={`h-2 w-2 rounded-full ${levelTone[entry.level].dot}`} /> {RISK_LEVEL_LABELS[entry.level]}
                      <span className="ml-1.5 text-xs text-brand-gray">({entry.count} indicators)</span>
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-brand-gray">No risk history recorded yet.</p>
            )}
          </div>

          {/* Intervention / follow-up history */}
          <div className="mt-4 rounded-2xl border border-slate-200 dark:border-border bg-white p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-brand-gray mb-2">Intervention History</p>
            {h.lastFollowUpAt || h.escalation ? (
              <div className="space-y-1.5 text-sm">
                {h.lastFollowUpAt && (
                  <p className="text-brand-gray">
                    Last follow-up recorded on <span className="font-medium text-brand-ink">{formatDate(h.lastFollowUpAt)}</span> · Attempt #{h.followUpCount || 1}
                  </p>
                )}
                {h.escalation && (
                  <p className="text-brand-gray">
                    Escalated to <span className="font-medium text-brand-ink">{h.escalation.assignment}</span> on {formatDate(h.escalation.at?.slice(0, 10))}
                    {h.escalation.reason ? ` — ${h.escalation.reason}` : ""}
                  </p>
                )}
              </div>
            ) : (
              <p className="text-sm text-brand-gray">No interventions recorded yet.</p>
            )}
          </div>
        </Card>

        {/* Actions */}
        <Card className="p-5">
          <div className="flex flex-wrap gap-2">
            <button onClick={() => setAction("followup")} className="inline-flex items-center gap-1.5 rounded-btn bg-brand-blue px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark">
              <PhoneCall className="h-4 w-4" /> Create Follow-up
            </button>
            <button onClick={() => setAction("assign")} className="inline-flex items-center gap-1.5 rounded-btn border border-brand-border bg-white px-4 py-2 text-sm font-medium text-brand-ink hover:bg-brand-bg dark:bg-card dark:hover:bg-hover">
              <UserPlus className="h-4 w-4" /> Assign Health Worker
            </button>
            <button onClick={() => setAction("escalate")} className="inline-flex items-center gap-1.5 rounded-btn border border-brand-border bg-white px-4 py-2 text-sm font-medium text-brand-danger hover:bg-brand-danger/5 dark:bg-card">
              <ArrowUpRight className="h-4 w-4" /> Escalate
            </button>
            <Link to={backPath} className="inline-flex items-center gap-1.5 rounded-btn border border-brand-border bg-white px-4 py-2 text-sm font-medium text-brand-gray hover:bg-brand-bg dark:bg-card dark:hover:bg-hover">
              <ChevronRight className="h-4 w-4 rotate-180" /> Back to Risk Overview
            </Link>
          </div>
        </Card>
      </div>

      {action === "followup" && (
        <FollowUpModal
          household={h}
          onClose={() => setAction(null)}
          onSave={(status, notes) => {
            const followUpCount = (h.followUpCount || 0) + 1;
            const lastFollowUpAt = new Date().toISOString().slice(0, 10);
            setAction(null);
            persistWorkflow(
              { workflowStatus: status, followUpCount, lastFollowUpAt, lastNote: notes },
              `Follow-up recorded for the ${h.surname} household.`
            );
          }}
        />
      )}
      {action === "assign" && (
        <AssignWorkerModal
          household={h}
          onClose={() => setAction(null)}
          onSave={(worker, role) => {
            setAction(null);
            persistWorkflow(
              { assignedWorker: worker, assignedWorkerRole: role, assignmentAt: new Date().toISOString() },
              `Worker assigned to the ${h.surname} household.`
            );
          }}
        />
      )}
      {action === "escalate" && (
        <EscalateModal
          household={h}
          onClose={() => setAction(null)}
          onSave={(reason) => {
            setAction(null);
            persistWorkflow(
              { workflowStatus: "Escalated", escalation: { reason, assignment: "Public Health Nurse", at: new Date().toISOString() } },
              `Case escalated for the ${h.surname} household.`
            );
          }}
        />
      )}
    </>
  );
}

/**
 * Derive the "back" path from the current role area. Only PHN and Health
 * Supervisor have a Household Risk Overview; the BHW (data-collection only)
 * returns to the Household Profiling list instead.
 */
function locationPathForRole() {
  const raw = typeof window !== "undefined" ? window.location.pathname : "/app/health_supervisor/households";
  const parts = raw.split("/").filter(Boolean);
  const appIdx = parts.indexOf("app");
  const role = appIdx >= 0 && parts[appIdx + 1] ? parts[appIdx + 1] : "health_supervisor";
  const base = `/app/${role}`;
  if (role === "phn" || role === "health_supervisor") return `${base}/households/risk-overview`;
  return `${base}/households`;
}
