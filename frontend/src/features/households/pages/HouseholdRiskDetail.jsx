import React, { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import PageHeader from "@/components/common/PageHeader";
import { Card } from "@/components/common/Card";
import { useHouseholdRiskClusters, householdRiskStore } from "@/services/mock/householdRiskStore";
import {
  RISK_LEVELS, RISK_LEVEL_LABELS, householdRiskBasis,
} from "@/lib/householdRisk";
import {
  Home, PhoneCall, UserPlus, ArrowUpRight, RefreshCw, ChevronRight, Users, MapPin, FileText, Activity,
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
  const clusters = useHouseholdRiskClusters();

  const [phase, setPhase] = useState("loading"); // loading | ready | error | notfound
  const [loadError, setLoadError] = useState(null);
  const [action, setAction] = useState(null); // followup | assign | escalate
  const [toast, setToast] = useState(null);

  const household = useMemo(
    () => clusters.find((h) => h.id === id) || null,
    [clusters, id]
  );

  // Simulated load so the loading + error states are demonstrable; a real API
  // would resolve from the request lifecycle instead.
  useEffect(() => {
    setPhase("loading");
    const t = setTimeout(() => {
      setLoadError(null);
      if (!id || !clusters.some((h) => h.id === id)) {
        setPhase("notfound");
        return;
      }
      setPhase("ready");
    }, 350);
    return () => clearTimeout(t);
  }, [id, clusters]);

  const showToast = (message) => {
    setToast(message);
    setTimeout(() => setToast(null), 3000);
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
              onClick={() => {
                setPhase("loading");
                setTimeout(() => { setLoadError(null); setPhase(household ? "ready" : "notfound"); }, 350);
              }}
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
            <InfoCell icon={Home} label="Last Household Visit" value={householdRiskStore.daysSince(h.lastHouseholdVisit) === null ? "—" : `${householdRiskStore.daysSince(h.lastHouseholdVisit)} days ago`} />
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
            householdRiskStore.recordFollowUp(h.id, { status, notes });
            setAction(null);
            showToast(`Follow-up recorded for the ${h.surname} household.`);
          }}
        />
      )}
      {action === "assign" && (
        <AssignWorkerModal
          household={h}
          onClose={() => setAction(null)}
          onSave={(worker, role) => {
            householdRiskStore.assignWorker(h.id, { worker, role });
            setAction(null);
            showToast(`Worker assigned to the ${h.surname} household.`);
          }}
        />
      )}
      {action === "escalate" && (
        <EscalateModal
          household={h}
          onClose={() => setAction(null)}
          onSave={(reason) => {
            householdRiskStore.escalateHousehold(h.id, { reason, assignment: "Public Health Nurse" });
            setAction(null);
            showToast(`Case escalated for the ${h.surname} household.`);
          }}
        />
      )}
    </>
  );
}

/** Derive the "back to risk overview" path from the current role area. */
function locationPathForRole() {
  const raw = typeof window !== "undefined" ? window.location.pathname : "/app/mho/households/risk-overview";
  const parts = raw.split("/").filter(Boolean);
  const appIdx = parts.indexOf("app");
  if (appIdx >= 0 && parts[appIdx + 1]) {
    return `/${parts.slice(0, appIdx + 2).join("/")}/households/risk-overview`;
  }
  return "/app/mho/households/risk-overview";
}
