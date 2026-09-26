import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import PageHeader from "@/components/common/PageHeader";
import StatCard from "@/components/common/StatCard";
import { Card } from "@/components/common/Card";
import { useWorkflowStore } from "@/services/local/workflowStore";
import { referralsApi, followUpsApi, householdsApi } from "@/services/api";
import { fetchEarlyWarningData } from "@/services/api/earlyWarningApi";
import {
  filterSupervisorRows,
  getSupervisorScope,
  supervisorVisibleBarangays,
} from "@/lib/supervisorScope";
import { riskOfPatient } from "@/lib/riskRules";
import { useAuth } from "@/context/AuthContext";
import { Link } from "react-router-dom";
import { X, ChevronRight, Eye, AlertTriangle } from "lucide-react";

// Referral statuses that count as "still pending" (mirrors the DB check
// constraint on public.health_referrals — Completed/Cancelled are terminal).
const OPEN_REFERRAL_STATUSES = new Set(["Pending", "Accepted", "In Progress"]);
const todayIso = () => new Date().toISOString().slice(0, 10);

/** persisted health_referrals row → the flat shape the dashboard renders. */
const mapReferral = (row) => ({
  id: row.id,
  resident: row.resident
    ? [row.resident.first_name, row.resident.middle_name, row.resident.last_name].filter(Boolean).join(" ")
    : "Resident",
  barangay: row.resident?.barangay || "",
  reason: row.reason || "",
  facility: row.destination_facility || "",
  priority: row.priority || "Medium",
  status: row.status || "Pending",
});

/** persisted follow_ups row → the flat shape the dashboard renders. */
const mapFollowUp = (row) => ({
  id: row.id,
  resident: row.resident
    ? [row.resident.first_name, row.resident.middle_name, row.resident.last_name].filter(Boolean).join(" ")
    : "Resident",
  barangay: row.resident?.barangay || "",
  purpose: row.purpose || "",
  dueDate: row.scheduled_date || "",
  time: row.scheduled_time ? String(row.scheduled_time).slice(0, 5) : "",
  status: row.status || "Scheduled",
});

/** A follow-up is "overdue/attention" when it is still open and due today or earlier. */
const isFollowUpDue = (f) =>
  !["Completed", "Cancelled"].includes(f.status) && f.dueDate && String(f.dueDate).slice(0, 10) <= todayIso();

const RISK_TONES = {
  High: "bg-brand-danger/10 text-brand-danger",
  Medium: "bg-brand-yellow/15 text-[#B07E00]",
  Low: "bg-brand-green/10 text-brand-green",
};

const ATTENTION_TONES = {
  "HIGH-RISK CASE": "bg-brand-danger/10 text-brand-danger",
  "PENDING REFERRAL": "bg-brand-yellow/15 text-[#B07E00]",
  "OVERDUE FOLLOW-UP": "bg-brand-accent/10 text-brand-accent",
  "FOLLOW-UP DUE": "bg-brand-accent/10 text-brand-accent",
  "HEALTH ALERT": "bg-brand-blue/10 text-brand-blue",
};

const LEVEL_TONES = {
  critical: "bg-brand-danger/10 text-brand-danger",
  warning: "bg-brand-yellow/15 text-[#B07E00]",
};

const ATTR_RISK_TERMS = ["communicable", "tb", "tuberculosis", "cough", "dengue", "infection"];

const hasTerm = (text, terms) =>
  terms.some((t) => String(text || "").toLowerCase().includes(t));

export default function HealthSupervisorDashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const scope = getSupervisorScope(user);
  const workflow = useWorkflowStore();

  // DATABASE-BACKED sources:
  //   - referrals   -> /api/referrals            (health_referrals)
  //   - followUps   -> /api/operational/followups (follow_ups)
  //   - households  -> /api/households            (server-computed risk_level)
  //   - earlyWarn   -> /api/analytics/early-warning (risk assessment per barangay)
  // Every one enforces the caller's barangay/municipality scope SERVER-SIDE;
  // no barangay id from this component can widen it.
  const [referrals, setReferrals] = useState([]);
  const [followUps, setFollowUps] = useState([]);
  const [households, setHouseholds] = useState([]);
  const [earlyWarning, setEarlyWarning] = useState({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  // Barangays this supervisor may see: their one assigned barangay, or every
  // barangay when municipality-wide. Used to drive the per-barangay early
  // warning fetch (the server still authorizes each barangay).
  const visibleBarangays = useMemo(() => supervisorVisibleBarangays(user), [user]);
  const barangayKey = visibleBarangays.join("|");

  const loadStats = useCallback(() => {
    setLoading(true);
    setLoadError(null);
    const barangays = barangayKey ? barangayKey.split("|") : [];
    return Promise.all([
      referralsApi.list(),
      followUpsApi.list(),
      householdsApi.list({ limit: 100 }),
      Promise.all(barangays.map((b) => fetchEarlyWarningData(b))),
    ])
      .then(([referralResult, followUpResult, householdResult, ewList]) => {
        setReferrals((referralResult?.rows || []).map(mapReferral));
        setFollowUps((followUpResult?.rows || []).map(mapFollowUp));
        setHouseholds(householdResult?.rows || []);
        const map = {};
        barangays.forEach((b, i) => { map[b] = ewList[i] || null; });
        setEarlyWarning(map);
      })
      .catch((err) => {
        // A backend failure must NOT masquerade as zero counts — surface it.
        setLoadError(err?.message || "Unable to load dashboard statistics. Please try again.");
        setReferrals([]);
        setFollowUps([]);
        setHouseholds([]);
        setEarlyWarning({});
      })
      .finally(() => setLoading(false));
  }, [barangayKey]);

  useEffect(() => { loadStats(); }, [loadStats]);

  // Server already scopes these to the supervisor's coverage; the values are
  // real database rows, not workflowStore data.
  const visibleReferrals = referrals;
  const visibleFollowUps = followUps;

  // Real high-risk residents come from the Early Warning risk assessment
  // (server-computed from recorded vitals), summed across the supervisor's
  // visible barangays.
  const highRiskResidents = useMemo(
    () => Object.values(earlyWarning).reduce((sum, ew) => sum + (ew?.summary?.highRiskResidents || 0), 0),
    [earlyWarning]
  );

  // Community Health Alerts are derived from the real Early Warning status:
  // a barangay with any high-risk resident raises one alert. No fabricated
  // alerts and no invented thresholds.
  const visibleAlerts = useMemo(() => {
    const alerts = [];
    Object.entries(earlyWarning).forEach(([brgy, ew]) => {
      const high = ew?.summary?.highRiskResidents || 0;
      if (high > 0) {
        alerts.push({
          id: `ew-${brgy}`,
          type: `${high} high-risk resident${high > 1 ? "s" : ""}`,
          level: high >= 3 ? "critical" : "warning",
          barangay: brgy,
          status: ew?.status || "Needs Attention",
        });
      }
    });
    return alerts;
  }, [earlyWarning]);

  // Patients (RHU triage -> PHN check-up queue) have NO backend source: they
  // are an in-session PHN workflow, not a persisted entity. They stay on the
  // workflow store and are filtered to the supervisor's coverage before use.
  const visiblePatients = useMemo(
    () => filterSupervisorRows(workflow.patients, user),
    [workflow.patients, user]
  );

  const [caseModal, setCaseModal] = useState(null);

  const patientByName = useMemo(() => {
    const map = {};
    visiblePatients.forEach((p) => {
      map[p.patient] = p;
    });
    return map;
  }, [visiblePatients]);

  const riskOf = (patient) => riskOfPatient(patient);

  const stats = useMemo(() => {
    return {
      // Active Cases = PHN check-up queue (workflow, no backend) — see note above.
      activeCases: visiblePatients.filter((p) => p.status !== "Consultation Completed").length,
      // High-Risk Cases = real Early Warning risk assessment (server-computed).
      highRisk: highRiskResidents,
      pendingReferrals: visibleReferrals.filter((r) => OPEN_REFERRAL_STATUSES.has(r.status)).length,
      overdueFollowUps: visibleFollowUps.filter(isFollowUpDue).length,
      alerts: visibleAlerts.length,
    };
  }, [visiblePatients, visibleReferrals, visibleFollowUps, visibleAlerts, highRiskResidents]);

  const cases = useMemo(() => {
    const items = [];
    const represented = new Set();
    const push = (item) => {
      if (represented.has(item.resident)) return;
      represented.add(item.resident);
      items.push(item);
    };

    // Auto high-risk patients in the check-up workflow.
    visiblePatients
      .filter((p) => riskOf(p).level === "High")
      .forEach((p) => {
        push({
          key: `case-${p.id}`,
          kind: "HIGH-RISK CASE",
          resident: p.patient,
          barangay: p.barangay || "RHU",
          detail: p.reason || p.triage?.chiefComplaint || "High-risk check-up case",
          extra: riskOf(p).reason,
          action: "Review Case",
          residentId: p.id,
        });
      });

    // High-priority referrals awaiting action (e.g. high-risk maternal cases).
    visibleReferrals
      .filter((r) => r.priority === "High" && OPEN_REFERRAL_STATUSES.has(r.status))
      .forEach((r) => {
        push({
          key: `high-referral-${r.id}`,
          kind: "HIGH-RISK CASE",
          resident: r.resident,
          barangay: r.barangay || "RHU",
          detail: r.reason,
          extra: `${r.facility || ""} Â· ${r.status || ""}`,
          action: "Review Referral",
        });
      });

    // Remaining referrals awaiting review.
    visibleReferrals
      .filter((r) => r.status === "Pending")
      .slice(0, 3)
      .forEach((r) => {
        push({
          key: `referral-${r.id}`,
          kind: "PENDING REFERRAL",
          resident: r.resident,
          barangay: r.barangay || "RHU",
          detail: r.reason,
          extra: `${r.facility || ""} Â· ${r.priority || ""}`,
          action: "Review Referral",
        });
      });

    // Overdue / due follow-ups (open and due today or earlier).
    visibleFollowUps
      .filter(isFollowUpDue)
      .slice(0, 2)
      .forEach((f) => {
        const overdue = String(f.dueDate).slice(0, 10) < todayIso();
        items.push({
          key: `followup-${f.id}`,
          kind: overdue ? "OVERDUE FOLLOW-UP" : "FOLLOW-UP DUE",
          resident: f.resident,
          barangay: f.barangay || "RHU",
          detail: f.purpose,
          extra: `${f.dueDate || ""} Â· ${f.time || ""}`,
          action: "Review",
        });
      });
    return items.slice(0, 6);
  }, [visiblePatients, visibleReferrals, visibleFollowUps, patientByName]);

  const attentionBarangays = useMemo(() => supervisorVisibleBarangays(user), [user]);

  const communityRows = useMemo(() => {
    const communicableCount = (brgy) =>
      visiblePatients.filter(
        (p) =>
          p.barangay === brgy &&
          hasTerm(
            [p.reason, p.triage?.notes, p.reason, p.triage?.chiefComplaint].filter(Boolean).join(" "),
            ATTR_RISK_TERMS
          )
      ).length;
    return attentionBarangays.map((name) => {
      const ew = earlyWarning[name] || null;
      return {
        name,
        // Residents + High-Risk are DATABASE-BACKED (Early Warning / residents).
        residents: ew?.summary?.residents ?? 0,
        highRisk: ew?.summary?.highRiskResidents ?? 0,
        // Active Cases = PHN check-up queue (workflow, no backend source).
        activeCases: visiblePatients.filter((p) => p.barangay === name && p.status !== "Consultation Completed").length,
        // Communicable has no persisted disease classification yet — derived
        // from the local check-up queue reasons (see limitations).
        communicable: communicableCount(name),
        // Pending Referrals + Overdue Follow-ups are DATABASE-BACKED, grouped
        // from the scoped API rows by barangay.
        pendingReferrals: visibleReferrals.filter((r) => r.barangay === name && OPEN_REFERRAL_STATUSES.has(r.status)).length,
        overdueFollowUps: visibleFollowUps.filter((f) => f.barangay === name && isFollowUpDue(f)).length,
      };
    });
  }, [attentionBarangays, earlyWarning, visiblePatients, visibleReferrals, visibleFollowUps]);

  const handleCaseAction = (item) => {
    if (item.action === "Review Case") {
      const patient = item.residentId != null ? patientByName[item.resident] : null;
      if (patient) setCaseModal(patient);
      else navigate("/app/health_supervisor/residents");
    } else if (item.action === "Review Referral") {
      navigate("/app/health_supervisor/referrals");
    } else {
      navigate("/app/health_supervisor/followups");
    }
  };

  const casePatient = caseModal;

  return (
    <>
      <PageHeader
        crumbs={["Dashboard"]}
        title="Health Monitoring"
        subtitle={
          scope && scope.level === "barangay"
            ? `Barangay ${scope.assignedBarangay} â€” monitor health cases, services, referrals, follow-ups, and community health alerts for your assigned barangay.`
            : "Monitor health cases, services, referrals, follow-ups, and community health alerts."
        }
      />

      {/* Backend failure for the database-backed statistics — surfaced, never
          silently shown as zero. */}
      {loadError && (
        <Card className="mb-4 flex items-start justify-between gap-3 border-brand-danger/30 bg-brand-danger/5 p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-brand-danger" />
            <div>
              <p className="text-sm font-semibold text-brand-ink">Couldn't load dashboard statistics</p>
              <p className="mt-0.5 text-xs text-brand-gray">{loadError}</p>
            </div>
          </div>
          <button onClick={loadStats} className="shrink-0 rounded-btn border border-brand-border px-3 py-1.5 text-xs font-medium text-brand-ink hover:border-brand-blue hover:text-brand-blue transition-colors">
            Retry
          </button>
        </Card>
      )}

      {/* Summary cards. High-Risk, Pending Referrals, Overdue Follow-ups and
          Health Alerts are real DB-backed counts (— while loading or on error,
          never a fake 0). Active Cases is the local PHN check-up queue. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-3 sm:gap-4 mb-6">
        <StatCard icon="Users" label="Active Cases" value={stats.activeCases} tone="blue" />
        <StatCard icon="AlertTriangle" label="High-Risk Cases" value={loading ? "…" : loadError ? "—" : stats.highRisk} tone="danger" />
        <StatCard icon="Send" label="Pending Referrals" value={loading ? "…" : loadError ? "—" : stats.pendingReferrals} tone="yellow" />
        <StatCard icon="CalendarClock" label="Overdue Follow-ups" value={loading ? "…" : loadError ? "—" : stats.overdueFollowUps} tone="accent" />
        <StatCard icon="Bell" label="Health Alerts" value={loading ? "…" : loadError ? "—" : stats.alerts} tone="blue" />
      </div>

      {/* Household Risk Clusters — real server-computed household risk. */}
      <RiskClusterStrip households={households} loading={loading} error={loadError} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-5">
        {/* Cases Requiring Attention */}
        <Card className="p-4 sm:p-6 lg:col-span-2 h-fit">
          <div className="flex items-center justify-between gap-3 mb-4">
            <div>
              <h3 className="font-semibold text-brand-ink text-sm sm:text-base">Cases Requiring Attention</h3>
              <p className="text-xs text-brand-gray mt-0.5">
                {scope && scope.level === "barangay"
                  ? `Cases within ${scope.assignedBarangay} that need supervisory action.`
                  : "Cases that need supervisory action."}
              </p>
            </div>
            <Eye className="w-4 h-4 text-brand-gray shrink-0" />
          </div>
          <div className="space-y-3">
            {cases.length === 0 && (
              <p className="text-sm text-brand-gray py-6 text-center">No cases require attention.</p>
            )}
            {cases.map((item) => (
              <div key={item.key} className="border border-brand-border rounded-btn px-4 py-3">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${ATTENTION_TONES[item.kind] || "bg-slate-100 text-slate-600"}`}>
                        {item.kind}
                      </span>
                      <p className="font-medium text-brand-ink text-sm">{item.resident}</p>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${item.barangay && item.barangay !== "RHU" ? "bg-brand-blue/10 text-brand-blue" : "bg-slate-100 text-slate-600"}`}>
                        {item.barangay === "RHU" && scope && scope.level === "barangay" ? scope.assignedBarangay : item.barangay}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-brand-gray truncate">{item.detail}</p>
                    {item.extra && <p className="text-[11px] text-brand-gray/80">{item.extra}</p>}
                  </div>
                  <button
                    onClick={() => handleCaseAction(item)}
                    className="flex shrink-0 items-center gap-1 text-sm font-medium text-brand-blue hover:underline self-start sm:self-auto"
                  >
                    {item.action} <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </Card>

        {/* Alerts + shortcuts */}
        <Card className="p-4 sm:p-6 h-fit">
          <h3 className="font-semibold text-brand-ink text-sm sm:text-base mb-4">Community Health Alerts</h3>
          <div className="space-y-3">
            {visibleAlerts.length === 0 && (
              <p className="text-sm text-brand-gray py-4 text-center">No alerts within your coverage.</p>
            )}
            {visibleAlerts.map((a) => (
              <div key={a.id} className="border border-brand-border rounded-btn px-4 py-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium text-brand-ink">{a.type}</p>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${LEVEL_TONES[a.level] || LEVEL_TONES.warning}`}>
                    {a.level}
                  </span>
                </div>
                <p className="mt-1 text-xs text-brand-gray">{a.barangay || "RHU"} Â· {a.status}</p>
              </div>
            ))}
          </div>
          <div className="mt-4 border-t border-brand-border pt-4">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-brand-gray mb-2">Oversight</p>
            <div className="flex flex-wrap gap-2">
              {[
                { label: "Referrals", path: "/app/health_supervisor/referrals" },
                { label: "Follow-ups", path: "/app/health_supervisor/followups" },
                { label: "Residents", path: "/app/health_supervisor/residents" },
                { label: "Health Services", path: "/app/health_supervisor/services" },
              ].map((l) => (
                <button
                  key={l.label}
                  onClick={() => navigate(l.path)}
                  className="rounded-btn border border-brand-border px-3 py-1.5 text-xs font-medium text-brand-ink hover:border-brand-blue hover:text-brand-blue transition-colors"
                >
                  {l.label}
                </button>
              ))}
            </div>
          </div>
        </Card>
      </div>

      {/* Community Health Monitoring */}
      <Card className="p-4 sm:p-6 mt-4 sm:mt-5">
        <div className="flex items-center justify-between gap-3 mb-4">
          <div>
            <h3 className="font-semibold text-brand-ink text-sm sm:text-base">Community Health Monitoring</h3>
            <p className="text-xs text-brand-gray mt-0.5">
              Barangay-level aggregate indicators within your coverage.
            </p>
          </div>
          <button
            onClick={() => navigate("/app/health_supervisor/trends")}
            className="flex items-center gap-1 text-sm font-medium text-brand-blue hover:underline shrink-0"
          >
            View Trends <ChevronRight className="w-4 h-4" />
          </button>
        </div>
        <div className="overflow-x-auto -mx-1">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-brand-bg border-b border-brand-border text-left">
                <th className="px-4 py-2.5 text-xs font-semibold text-brand-gray uppercase tracking-wide">Barangay</th>
                <th className="px-4 py-2.5 text-xs font-semibold text-brand-gray uppercase tracking-wide text-right">Residents</th>
                <th className="px-4 py-2.5 text-xs font-semibold text-brand-gray uppercase tracking-wide text-right">Active Cases</th>
                <th className="px-4 py-2.5 text-xs font-semibold text-brand-gray uppercase tracking-wide text-right">High-Risk Cases</th>
                <th className="px-4 py-2.5 text-xs font-semibold text-brand-gray uppercase tracking-wide text-right">Communicable</th>
                <th className="px-4 py-2.5 text-xs font-semibold text-brand-gray uppercase tracking-wide text-right">Pending Referrals</th>
                <th className="px-4 py-2.5 text-xs font-semibold text-brand-gray uppercase tracking-wide text-right">Overdue Follow-ups</th>
              </tr>
            </thead>
            <tbody>
              {communityRows.map((row) => (
                <tr key={row.name} className="border-b border-brand-border last:border-0">
                  <td className="px-4 py-3 font-medium text-brand-ink">{row.name}</td>
                  <td className="px-4 py-3 text-right text-brand-ink">{row.residents}</td>
                  <td className="px-4 py-3 text-right text-brand-ink">{row.activeCases}</td>
                  <td className="px-4 py-3 text-right">
                    <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${row.highRisk > 0 ? RISK_TONES.High : RISK_TONES.Low}`}>{row.highRisk}</span>
                  </td>
                  <td className="px-4 py-3 text-right text-brand-ink">{row.communicable}</td>
                  <td className="px-4 py-3 text-right text-brand-ink">{row.pendingReferrals}</td>
                  <td className="px-4 py-3 text-right text-brand-ink">{row.overdueFollowUps}</td>
                </tr>
              ))}
              {communityRows.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-sm text-brand-gray">
                    No coverage assigned.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Resident case modal (read-only oversight view) */}
      {casePatient && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setCaseModal(null)}>
          <Card role="dialog" aria-modal="true" aria-label={`Case review for ${casePatient.patient}`} className="w-full max-w-lg flex max-h-[90vh] flex-col overflow-hidden">
            <div className="flex shrink-0 items-center justify-between border-b border-brand-border px-6 py-4">
              <div>
                <h3 className="text-base font-semibold text-brand-ink">{casePatient.patient}</h3>
                <p className="text-xs text-brand-gray mt-0.5">
                  {casePatient.barangay || "RHU"} Â· {casePatient.reason || casePatient.triage?.chiefComplaint}
                </p>
              </div>
              <button onClick={() => setCaseModal(null)} className="flex h-9 w-9 items-center justify-center rounded-lg text-brand-gray hover:bg-brand-bg hover:text-brand-ink" aria-label="Close modal">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-4">
              <div className="space-y-4 text-sm">
                <div className="grid grid-cols-2 gap-3">
                  <p className="text-brand-gray">Age: <span className="text-brand-ink">{casePatient.age} yrs</span></p>
                  <p className="text-brand-gray">Sex: <span className="text-brand-ink">{casePatient.sex}</span></p>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-brand-gray mb-2">Triage</p>
                  <p className="text-brand-ink">
                    {casePatient.triage?.chiefComplaint || casePatient.reason} â€” BP {casePatient.triage?.bloodPressure || "â€”"}, T {casePatient.triage?.temperature ? `${casePatient.triage.temperature}Â°C` : "â€”"}
                  </p>
                  {casePatient.triage?.notes && <p className="text-xs text-brand-gray mt-1">{casePatient.triage.notes}</p>}
                </div>
                <div className="rounded-btn border border-brand-border px-4 py-3">
                  <div className="flex items-center gap-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-brand-gray">Risk Level</p>
                    <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${RISK_TONES[riskOf(casePatient).level] || RISK_TONES.Low}`}>
                      {riskOf(casePatient).level}
                    </span>
                  </div>
                  <p className="mt-1.5 text-xs text-brand-gray">{riskOf(casePatient).reason}</p>
                </div>
              </div>
            </div>
            <div className="flex shrink-0 justify-end gap-3 border-t border-brand-border px-6 py-4">
              <button onClick={() => setCaseModal(null)} className="px-4 py-2 rounded-btn text-sm font-medium text-brand-gray hover:bg-brand-bg transition-colors">
                Close
              </button>
            </div>
          </Card>
        </div>
      )}
    </>
  );

  function RiskClusterStrip({ households: rows = [], loading: isLoading, error }) {
    // Counts come from the REAL server-computed household risk classification
    // (public.households.risk_level: High / Moderate / Low), scoped to the
    // supervisor's coverage by the /api/households endpoint.
    const counts = {
      high: rows.filter((h) => h.riskLevel === "High").length,
      moderate: rows.filter((h) => h.riskLevel === "Moderate").length,
      low: rows.filter((h) => h.riskLevel === "Low").length,
    };
    const summary = isLoading
      ? "Loading household risk…"
      : error
        ? "Household risk unavailable — retry above."
        : null;
    return (
      <Link to="/app/health_supervisor/households/risk-clusters" className="mb-6 flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 hover:border-brand-blue/40 transition-colors">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-blue/10 text-brand-blue">
          <AlertTriangle className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-brand-ink">Household Risk Clusters</p>
          {summary ? (
            <p className="text-xs text-brand-gray">{summary}</p>
          ) : (
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-brand-gray">
              <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-brand-danger" /> {counts.high} High risk</span>
              <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-brand-accent" /> {counts.moderate} Moderate risk</span>
              <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-brand-green" /> {counts.low} Low risk</span>
            </p>
          )}
        </div>
        <ChevronRight className="h-4 w-4 shrink-0 text-brand-gray" />
      </Link>
    );
  }
}
