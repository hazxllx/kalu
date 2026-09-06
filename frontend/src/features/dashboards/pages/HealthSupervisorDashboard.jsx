import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import PageHeader from "@/components/common/PageHeader";
import StatCard from "@/components/common/StatCard";
import { Card } from "@/components/common/Card";
import { useWorkflowStore } from "@/services/mock/mockWorkflowStore";
import { phnAlerts, barangayCommunity } from "@/services/mock/mockPhnData";
import {
  filterSupervisorRows,
  getSupervisorScope,
  supervisorVisibleBarangays,
} from "@/lib/supervisorScope";
import { riskOfPatient } from "@/lib/riskRules";
import { useAuth } from "@/context/AuthContext";
import { X, ChevronRight, Eye } from "lucide-react";

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

  // Every dataset below is filtered to the supervisor's assigned coverage
  // BEFORE rendering/search/counts so no other barangay can leak through.
  const visiblePatients = useMemo(
    () => filterSupervisorRows(workflow.patients, user),
    [workflow.patients, user]
  );
  const visibleReferrals = useMemo(
    () => filterSupervisorRows(workflow.referrals, user),
    [workflow.referrals, user]
  );
  const visibleFollowUps = useMemo(
    () => filterSupervisorRows(workflow.followUps, user),
    [workflow.followUps, user]
  );
  const visibleAlerts = useMemo(
    () => filterSupervisorRows(phnAlerts, user),
    [user]
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
    const highRiskPatients = visiblePatients.filter((p) => riskOf(p).level === "High");
    const highRiskReferrals = visibleReferrals.filter(
      (r) => r.priority === "High" && r.status !== "Completed"
    );
    const highRiskNames = new Set([
      ...highRiskPatients.map((p) => p.patient),
      ...highRiskReferrals.map((r) => r.resident),
    ]);
    return {
      activeCases: visiblePatients.filter((p) => p.status !== "Consultation Completed").length,
      highRisk: highRiskNames.size,
      pendingReferrals: visibleReferrals.filter(
        (r) => r.status === "For Review" || r.status === "Pending" || r.status === "Accepted"
      ).length,
      overdueFollowUps: visibleFollowUps.filter(
        (f) => f.status === "Overdue" || f.status === "Due Today"
      ).length,
      alerts: visibleAlerts.length,
    };
  }, [visiblePatients, visibleReferrals, visibleFollowUps, visibleAlerts]);

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
      .filter(
        (r) =>
          r.priority === "High" &&
          (r.status === "For Review" || r.status === "Pending" || r.status === "Accepted")
      )
      .forEach((r) => {
        push({
          key: `high-referral-${r.id}`,
          kind: "HIGH-RISK CASE",
          resident: r.resident,
          barangay: r.barangay || "RHU",
          detail: r.reason,
          extra: `${r.facility || ""} · ${r.status || ""}`,
          action: "Review Referral",
        });
      });

    // Remaining referrals awaiting review.
    visibleReferrals
      .filter((r) => r.status === "For Review" || r.status === "Pending")
      .slice(0, 3)
      .forEach((r) => {
        push({
          key: `referral-${r.id}`,
          kind: "PENDING REFERRAL",
          resident: r.resident,
          barangay: r.barangay || "RHU",
          detail: r.reason,
          extra: `${r.facility || ""} · ${r.priority || ""}`,
          action: "Review Referral",
        });
      });

    // Overdue / due follow-ups.
    visibleFollowUps
      .filter((f) => f.status === "Overdue" || f.status === "Due Today")
      .slice(0, 2)
      .forEach((f) => {
        items.push({
          key: `followup-${f.id}`,
          kind: f.status === "Overdue" ? "OVERDUE FOLLOW-UP" : "FOLLOW-UP DUE",
          resident: f.resident,
          barangay: f.barangay || "RHU",
          detail: f.purpose,
          extra: `${f.dueDate || ""} · ${f.time || ""}`,
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
      const base = barangayCommunity.find((b) => b.name === name) || {
        residents: 0,
        activeCases: 0,
        referrals: 0,
        followUps: 0,
        priorityCases: 0,
      };
      return {
        name,
        residents: base.residents,
        activeCases: base.activeCases,
        highRisk: base.priorityCases,
        communicable: communicableCount(name),
        pendingReferrals: base.referrals,
        overdueFollowUps: base.followUps,
      };
    });
  }, [attentionBarangays, visiblePatients]);

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
        crumbs={["Home", "Dashboard"]}
        title="Health Monitoring"
        subtitle="Monitor health cases, services, referrals, follow-ups, and community health alerts."
      />

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-3 sm:gap-4 mb-6">
        <StatCard icon="Users" label="Active Cases" value={stats.activeCases} tone="blue" />
        <StatCard icon="AlertTriangle" label="High-Risk Cases" value={stats.highRisk} tone="danger" />
        <StatCard icon="Send" label="Pending Referrals" value={stats.pendingReferrals} tone="yellow" />
        <StatCard icon="CalendarClock" label="Overdue Follow-ups" value={stats.overdueFollowUps} tone="accent" />
        <StatCard icon="Bell" label="Health Alerts" value={stats.alerts} tone="blue" />
      </div>

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
                <p className="mt-1 text-xs text-brand-gray">{a.barangay || "RHU"} · {a.status}</p>
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
                  {casePatient.barangay || "RHU"} · {casePatient.reason || casePatient.triage?.chiefComplaint}
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
                    {casePatient.triage?.chiefComplaint || casePatient.reason} — BP {casePatient.triage?.bloodPressure || "—"}, T {casePatient.triage?.temperature ? `${casePatient.triage.temperature}°C` : "—"}
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
}
