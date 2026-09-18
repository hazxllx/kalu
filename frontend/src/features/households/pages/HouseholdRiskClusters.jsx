import React, { useMemo, useState } from "react";
import PageHeader from "@/components/common/PageHeader";
import { Card } from "@/components/common/Card";
import { useAuth } from "@/context/AuthContext";
import { getSupervisorScope, HS_SCOPE } from "@/lib/supervisorScope";
import {
  useHouseholdRiskClusters,
  householdRiskStore,
} from "@/services/local/householdRiskStore";
import { RISK_LEVELS, RISK_LEVEL_LABELS, RISK_WORKFLOW_STATUSES, householdRiskBasis } from "@/lib/householdRisk";
import { Link } from "react-router-dom";
import {
  Search, PhoneCall, ArrowUpRight, Home, CheckCircle2, X,
} from "lucide-react";

const levelTone = {
  [RISK_LEVELS.STABLE]: { chip: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400", dot: "bg-brand-green" },
  [RISK_LEVELS.MONITOR]: { chip: "bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400", dot: "bg-brand-yellow" },
  [RISK_LEVELS.INTERVENTION]: { chip: "bg-orange-50 text-orange-700 dark:bg-orange-500/15 dark:text-orange-400", dot: "bg-brand-accent" },
  [RISK_LEVELS.PRIORITY]: { chip: "bg-rose-50 text-rose-700", dot: "bg-brand-danger" },
};

const formatDate = (iso) => {
  if (!iso) return "—";
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
};

/** Household detail base path for the current role area. */
function locationPathForRole() {
  const raw = typeof window !== "undefined" ? window.location.pathname : "/app/bhw/households/risk-clusters";
  const parts = raw.split("/").filter(Boolean);
  const appIdx = parts.indexOf("app");
  const role = appIdx >= 0 && parts[appIdx + 1] ? parts[appIdx + 1] : "bhw";
  return `/app/${role}`;
}

export default function HouseholdRiskClusters() {
  const { user } = useAuth();
  const clusters = useHouseholdRiskClusters();
  const scope = getSupervisorScope(user);
  const scopedBarangays =
    scope && scope.level === HS_SCOPE.BARANGAY ? [scope.assignedBarangay] : null;

  const scoped = useMemo(
    () => clusters.filter((c) => !scopedBarangays || scopedBarangays.includes(c.barangay)),
    [clusters, scopedBarangays]
  );

  const [query, setQuery] = useState("");
  const [levelFilter, setLevelFilter] = useState("all");
  const [detailId, setDetailId] = useState(null);
  const [followUpFor, setFollowUpFor] = useState(null);
  const [escalateFor, setEscalateFor] = useState(null);
  const [toast, setToast] = useState(null);

  const counts = useMemo(() => {
    const c = { priority: 0, intervention: 0, monitor: 0, stable: 0 };
    scoped.forEach((h) => {
      if (h.risk.level === RISK_LEVELS.PRIORITY) c.priority += 1;
      else if (h.risk.level === RISK_LEVELS.INTERVENTION) c.intervention += 1;
      else if (h.risk.level === RISK_LEVELS.MONITOR) c.monitor += 1;
      else c.stable += 1;
    });
    return c;
  }, [scoped]);

  const filtered = useMemo(
    () =>
      scoped
        .filter((h) => levelFilter === "all" || h.risk.level === levelFilter)
        .filter(
          (h) =>
            h.head.toLowerCase().includes(query.toLowerCase()) ||
            h.barangay.toLowerCase().includes(query.toLowerCase()) ||
            h.id.toLowerCase().includes(query.toLowerCase())
        )
        .sort((a, b) => b.risk.score - a.risk.score),
    [scoped, levelFilter, query]
  );

  const detail = detailId ? scoped.find((h) => h.id === detailId) : null;
  const followUpTarget = followUpFor ? scoped.find((h) => h.id === followUpFor) : null;
  const escalateTarget = escalateFor ? scoped.find((h) => h.id === escalateFor) : null;

  const showToast = (message) => {
    setToast(message);
    setTimeout(() => setToast(null), 3000);
  };

  return (
    <>
      <PageHeader
        crumbs={["Early Intervention", "Household Risk Clusters"]}
        title="Household Risk Clusters"
        subtitle="Identify households where multiple health-monitoring indicators cluster — for early intervention, not diagnosis."
      />

      {toast && (
        <div className="fixed bottom-4 right-4 z-[60] flex items-center gap-2 rounded-btn bg-brand-ink px-4 py-3 text-white shadow-lg animate-in slide-in-from-bottom-2">
          <CheckCircle2 className="h-4 w-4 text-brand-green" />
          <span className="text-sm">{toast}</span>
        </div>
      )}

      {/* Cluster overview counts */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4 mb-5">
        {[
          { key: RISK_LEVELS.PRIORITY, label: "Priority Review", value: counts.priority },
          { key: RISK_LEVELS.INTERVENTION, label: "Needs Intervention", value: counts.intervention },
          { key: RISK_LEVELS.MONITOR, label: "Monitor", value: counts.monitor },
          { key: RISK_LEVELS.STABLE, label: "Stable", value: counts.stable },
        ].map((c) => (
          <button
            key={c.key}
            onClick={() => setLevelFilter(levelFilter === c.key ? "all" : c.key)}
            className={`rounded-2xl border p-4 text-left transition-colors ${
              levelFilter === c.key
                ? "border-brand-blue bg-brand-light/60"
                : "border-slate-200 bg-white hover:border-brand-blue/40"
            }`}
          >
            <p className="text-xs text-brand-gray uppercase tracking-wide flex items-center gap-1.5">
              <span className={`w-2.5 h-2.5 rounded-full ${levelTone[c.key].dot}`} /> {c.label}
            </p>
            <p className="mt-1 text-3xl font-semibold text-brand-ink">{c.value}</p>
          </button>
        ))}
      </div>

      <Card className="overflow-hidden">
        <div className="border-b border-slate-200 px-5 py-4 flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="flex items-center gap-2 rounded-input border border-slate-200 bg-brand-bg/60 px-3.5 py-2.5 w-full sm:max-w-sm">
            <Search className="h-4 w-4 text-brand-gray" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by household, barangay, or ID..."
              className="w-full bg-transparent text-sm outline-none"
            />
          </div>
          <p className="text-xs text-brand-gray sm:ml-auto">{filtered.length} households</p>
        </div>

        {/* Priority household cards */}
        <div className="p-5">
          {filtered.length === 0 ? (
            <p className="py-10 text-center text-sm text-brand-gray">No household risk clusters match.</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {filtered.map((h) => {
                const tone = levelTone[h.risk.level] || levelTone[RISK_LEVELS.STABLE];
                const days = householdRiskStore.daysSince(h.lastHouseholdVisit);
                return (
                  <div key={h.id} className="rounded-2xl border border-slate-200 bg-white p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-brand-ink">{h.head} Household</p>
                        <p className="text-xs text-brand-gray">{h.id} · {h.barangay}</p>
                      </div>
                      <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${tone.chip}`}>
                        <span className={`h-2 w-2 rounded-full ${tone.dot}`} /> {RISK_LEVEL_LABELS[h.risk.level]}
                      </span>
                    </div>
                    <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                      <div className="rounded-btn bg-brand-bg px-2.5 py-2">
                        <p className="text-brand-gray">Indicators</p>
                        <p className="font-semibold text-brand-ink">{h.risk.count}</p>
                      </div>
                      <div className="rounded-btn bg-brand-bg px-2.5 py-2">
                        <p className="text-brand-gray">Members</p>
                        <p className="font-semibold text-brand-ink">{h.members}</p>
                      </div>
                      <div className="rounded-btn bg-brand-bg px-2.5 py-2">
                        <p className="text-brand-gray">Last visit</p>
                        <p className="font-semibold text-brand-ink">{days === null ? "—" : `${days}d ago`}</p>
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Link to={`${locationPathForRole()}/households/${h.id}`} className="inline-flex items-center gap-1 rounded-btn border border-brand-border bg-white px-3 py-1.5 text-xs font-medium text-brand-blue hover:border-brand-blue dark:bg-card">
                        <Home className="h-3.5 w-3.5" /> View Household
                      </Link>
                      <button onClick={() => setFollowUpFor(h.id)} className="inline-flex items-center gap-1 rounded-btn border border-brand-border bg-white px-3 py-1.5 text-xs font-medium text-brand-green hover:border-brand-green dark:bg-card">
                        <PhoneCall className="h-3.5 w-3.5" /> Create Follow-up
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </Card>

      {/* Detail drawer */}
      {detail && (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/60" onClick={() => setDetailId(null)} />
          <div className="absolute right-0 top-0 flex h-full w-full max-w-2xl flex-col bg-white shadow-2xl">
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
              <div>
                <h3 className="text-base font-semibold text-brand-ink">{detail.head} Household</h3>
                <p className="text-xs text-brand-gray">{detail.id} · {detail.barangay} · {detail.purok}</p>
              </div>
              <button onClick={() => setDetailId(null)} className="text-brand-gray hover:text-brand-ink" aria-label="Close">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
              {/* Risk & early intervention summary */}
              <section className="rounded-2xl border border-slate-200 bg-white p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-brand-gray mb-3">Risk &amp; Early Intervention</p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="rounded-btn bg-brand-bg px-3 py-2.5">
                    <p className="text-[11px] text-brand-gray uppercase tracking-wide">Current Status</p>
                    <p className="mt-0.5 flex items-center gap-1.5 text-sm font-semibold text-brand-ink">
                      <span className={`h-2 w-2 rounded-full ${levelTone[detail.risk.level].dot}`} /> {RISK_LEVEL_LABELS[detail.risk.level]}
                    </p>
                  </div>
                  <div className="rounded-btn bg-brand-bg px-3 py-2.5">
                    <p className="text-[11px] text-brand-gray uppercase tracking-wide">Risk Indicators</p>
                    <p className="mt-0.5 text-sm font-semibold text-brand-ink">{detail.risk.count}</p>
                  </div>
                  <div className="rounded-btn bg-brand-bg px-3 py-2.5">
                    <p className="text-[11px] text-brand-gray uppercase tracking-wide">Last Assessment</p>
                    <p className="mt-0.5 text-sm font-semibold text-brand-ink">{formatDate(detail.lastAssessment)}</p>
                  </div>
                  <div className="rounded-btn bg-brand-bg px-3 py-2.5">
                    <p className="text-[11px] text-brand-gray uppercase tracking-wide">Last Household Visit</p>
                    <p className="mt-0.5 text-sm font-semibold text-brand-ink">{formatDate(detail.lastHouseholdVisit)}</p>
                  </div>
                </div>
              </section>

              {/* Identified indicators */}
              <section className="rounded-2xl border border-slate-200 bg-white p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-brand-gray mb-3">Identified Indicators</p>
                {detail.risk.indicators.length > 0 ? (
                  <ul className="space-y-1.5">
                    {detail.risk.indicators.map((ind) => (
                      <li key={ind.key} className="flex items-start gap-2 text-sm text-brand-ink">
                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-brand-green" />
                        {ind.label}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-brand-gray">No significant indicators detected.</p>
                )}
              </section>

              {/* Risk classification — basis + contributing indicators */}
              <section className="rounded-2xl border border-slate-200 bg-white p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-brand-gray mb-1">Risk Classification</p>
                <p className="text-base font-semibold text-brand-ink">{RISK_LEVEL_LABELS[detail.risk.level]}</p>
                <p className="mt-2 text-xs text-brand-gray">
                  <span className="font-medium text-brand-ink">Basis:</span>{" "}
                  {householdRiskBasis({ level: detail.risk.level, count: detail.risk.count, indicators: detail.risk.indicators }).headline}
                </p>
                {detail.risk.indicators.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {detail.risk.indicators.map((ind) => (
                      <li key={ind.key} className="flex items-start gap-2 text-xs text-brand-gray">
                        <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-green" />
                        {ind.label}
                      </li>
                    ))}
                  </ul>
                )}
                <p className="mt-2 text-xs text-brand-gray">
                  <span className="font-medium text-brand-ink">Risk Score:</span> {detail.risk.score} · classification reflects configured monitoring criteria, not a clinical diagnosis.
                </p>
              </section>

              {/* Recommended action */}
              <section className="rounded-2xl border border-brand-blue/15 bg-brand-light/50 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-brand-gray mb-1">Recommended Action</p>
                <p className="text-sm text-brand-ink">{detail.risk.recommendedAction}</p>
                <p className="mt-2 text-xs text-brand-gray">Assigned worker: {detail.assignedWorker || "—"} · Workflow: {detail.workflowStatus}</p>
              </section>

              {/* Risk history */}
              <section className="rounded-2xl border border-slate-200 bg-white p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-brand-gray mb-3">Risk History</p>
                <div className="space-y-1.5">
                  {detail.history.map((h) => (
                    <div key={`${h.month}-${h.year}`} className="flex items-center justify-between gap-3 text-sm">
                      <span className="text-brand-gray">{h.month} {h.year}</span>
                      <span className="inline-flex items-center gap-1.5 text-brand-ink">
                        <span className={`h-2 w-2 rounded-full ${levelTone[h.level].dot}`} /> {RISK_LEVEL_LABELS[h.level]}
                        <span className="ml-1.5 text-xs text-brand-gray">({h.count} indicators)</span>
                      </span>
                    </div>
                  ))}
                </div>
              </section>

              <div className="flex flex-wrap gap-2">
                <button onClick={() => { const id = detail.id; setDetailId(null); setFollowUpFor(id); }} className="inline-flex items-center gap-1.5 rounded-btn bg-brand-blue px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark">
                  <PhoneCall className="h-4 w-4" /> Create Follow-up
                </button>
                <button
                  onClick={() => {
                    householdRiskStore.resolveHousehold(detail.id, { outcome: "Resolved" });
                    showToast(`Risk resolved for the ${detail.surname} household.`);
                    setDetailId(null);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-btn border border-brand-border bg-white px-4 py-2 text-sm font-medium text-brand-green hover:border-brand-green"
                >
                  <CheckCircle2 className="h-4 w-4" /> Mark Resolved
                </button>
                <button onClick={() => { const id = detail.id; setDetailId(null); setEscalateFor(id); }} className="inline-flex items-center gap-1.5 rounded-btn border border-brand-border bg-white px-4 py-2 text-sm font-medium text-brand-danger hover:border-brand-danger">
                  <ArrowUpRight className="h-4 w-4" /> Escalate Case
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Follow-up modal */}
      {followUpTarget && (
        <FollowUpModal
          household={followUpTarget}
          onClose={() => setFollowUpFor(null)}
          onSave={(status, notes) => {
            householdRiskStore.recordFollowUp(followUpTarget.id, { status, notes });
            showToast(`Follow-up recorded for the ${followUpTarget.surname} household.`);
            setFollowUpFor(null);
          }}
        />
      )}

      {/* Escalation modal */}
      {escalateTarget && (
        <EscalationModal
          household={escalateTarget}
          onClose={() => setEscalateFor(null)}
          onSave={(reason) => {
            householdRiskStore.escalateHousehold(escalateTarget.id, { reason, assignment: "Public Health Nurse" });
            showToast(`Case escalated for the ${escalateTarget.surname} household.`);
            setEscalateFor(null);
          }}
        />
      )}
    </>
  );
}

function FollowUpModal({ household, onClose, onSave }) {
  const [status, setStatus] = useState(RISK_WORKFLOW_STATUSES[1]);
  const [notes, setNotes] = useState("");
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
      <Card className="w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          <div className="flex items-start justify-between gap-3 mb-1">
            <div>
              <h3 className="text-lg font-semibold text-brand-ink">Create Follow-up</h3>
              <p className="text-sm text-brand-gray mt-0.5">{household.head} Household · {household.barangay}</p>
            </div>
            <button onClick={onClose} className="text-brand-gray hover:text-brand-ink"><X className="w-5 h-5" /></button>
          </div>
          <div className="mt-4 space-y-4">
            <div>
              <label className="text-sm font-medium text-brand-ink">Follow-up Status</label>
              <select value={status} onChange={(e) => setStatus(e.target.value)} className="mt-1.5 w-full rounded-btn border border-slate-200 bg-white px-3.5 py-2.5 text-sm outline-none focus:border-brand-blue">
                {RISK_WORKFLOW_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="text-sm font-medium text-brand-ink">Notes / Findings</label>
              <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Assessment notes from the household visit..." className="mt-1.5 w-full resize-none rounded-btn border border-slate-200 bg-white px-3.5 py-2.5 text-sm outline-none focus:border-brand-blue" />
            </div>
            <div className="flex justify-end gap-3 border-t border-slate-200 pt-4">
              <button onClick={onClose} className="rounded-btn px-4 py-2 text-sm font-medium text-brand-gray hover:bg-brand-bg">Cancel</button>
              <button onClick={() => onSave(status, notes.trim())} className="rounded-btn bg-brand-blue px-5 py-2 text-sm font-medium text-white hover:bg-brand-dark">Save Follow-up</button>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}

function EscalationModal({ household, onClose, onSave }) {
  const [reason, setReason] = useState("");
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
      <Card className="w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          <div className="flex items-start justify-between gap-3 mb-1">
            <div>
              <h3 className="text-lg font-semibold text-brand-ink">Escalate Case</h3>
              <p className="text-sm text-brand-gray mt-0.5">{household.head} Household</p>
            </div>
            <button onClick={onClose} className="text-brand-gray hover:text-brand-ink"><X className="w-5 h-5" /></button>
          </div>
          <div className="mt-4 space-y-4">
            <div className="rounded-btn border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-sm text-amber-800">
              <span className="font-semibold">Reason:</span> {household.followUpCount} follow-up attempt(s) have not fully resolved the identified concerns.
            </div>
            <div>
              <label className="text-sm font-medium text-brand-ink">Current assignment</label>
              <p className="mt-1 text-sm text-brand-ink">{household.assignedWorker || "Barangay Health Worker"}</p>
            </div>
            <div>
              <label className="text-sm font-medium text-brand-ink">Recommended escalation</label>
              <p className="mt-1 text-sm text-brand-ink">Public Health Nurse</p>
            </div>
            <div>
              <label className="text-sm font-medium text-brand-ink">Reason for escalation</label>
              <textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Describe why this case should be escalated..." className="mt-1.5 w-full resize-none rounded-btn border border-slate-200 bg-white px-3.5 py-2.5 text-sm outline-none focus:border-brand-blue" />
            </div>
            <div className="flex justify-end gap-3 border-t border-slate-200 pt-4">
              <button onClick={onClose} className="rounded-btn px-4 py-2 text-sm font-medium text-brand-gray hover:bg-brand-bg">Cancel</button>
              <button onClick={() => onSave(reason.trim())} className="rounded-btn bg-brand-danger px-5 py-2 text-sm font-medium text-white hover:bg-brand-danger/90">Escalate Case</button>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}
