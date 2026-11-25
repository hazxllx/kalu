import React, { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { usePermissions } from "@/context/PermissionsContext";
import { getHouseholdDetailAccess, loadHouseholdDetailData } from "../lib/riskDetailAccess";
import PageHeader from "@/components/common/PageHeader";
import { Card } from "@/components/common/Card";
import { householdsApi } from "@/services/api/householdsApi";
import { householdRiskApi } from "@/services/api/householdRiskApi";
import { toRiskCluster, daysSince, normalizeHouseholdSnapshot } from "../lib/riskClusterAdapter";
import {
  RISK_LEVELS, RISK_LEVEL_LABELS,
} from "@/lib/householdRisk";
import { WATER_SOURCE_LABELS, TOILET_LABELS } from "../lib/householdOptions";
import {
  Home, PhoneCall, UserPlus, ArrowUpRight, RefreshCw, ChevronRight, Users, MapPin, FileText, Activity, CalendarDays, Plus,
} from "lucide-react";
import { FollowUpModal, AssignWorkerModal, EscalateModal } from "../components/RiskActionModals";

const levelTone = {
  [RISK_LEVELS.STABLE]: { chip: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400", dot: "bg-brand-green" },
  [RISK_LEVELS.MONITOR]: { chip: "bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400", dot: "bg-brand-yellow" },
  [RISK_LEVELS.INTERVENTION]: { chip: "bg-orange-50 text-orange-700 dark:bg-orange-500/15 dark:text-orange-400", dot: "bg-brand-accent" },
  [RISK_LEVELS.PRIORITY]: { chip: "bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-400", dot: "bg-brand-danger" },
  [RISK_LEVELS.UNASSESSED]: { chip: "bg-slate-100 text-slate-600 dark:bg-slate-500/15 dark:text-slate-400", dot: "bg-slate-400" },
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
    <div className="min-w-0 rounded-btn bg-brand-bg/60 dark:bg-card-nested px-3 py-2.5 [overflow-wrap:anywhere]">
      <div className="flex items-center gap-1.5">
        {Icon && <Icon className="h-3.5 w-3.5 text-brand-gray" strokeWidth={1.8} />}
        <p className="text-[11px] text-brand-gray uppercase tracking-wide">{label}</p>
      </div>
      <p className="mt-1 break-words text-sm font-medium text-brand-ink">{value === null || value === undefined || value === "" ? "—" : value}</p>
    </div>
  );
}

const assessmentValue = (value) => {
  if (value === true) return "Yes";
  if (value === false) return "No";
  if (Array.isArray(value)) return value.length ? value.join(", ") : "Not recorded";
  if (value === null || value === undefined || (typeof value === "string" && !value.trim())) return "Not recorded";
  if (typeof value === "string" && ["true", "false"].includes(value.trim().toLowerCase())) {
    return value.trim().toLowerCase() === "true" ? "Yes" : "No";
  }
  return String(value);
};

const assessmentStatus = (householdStatus) => {
  if (householdStatus === "Submitted") return "Submitted";
  if (householdStatus === "Approved") return "Completed";
  if (["Pending", "Ongoing", "Needs Update"].includes(householdStatus)) return "Draft";
  return householdStatus || "Not recorded";
};

const formatAssessmentDate = (value) => {
  if (!value) return "Not recorded";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
};

const environmentalFieldLabels = {
  assessment_date: "Date accomplished",
  se_status: "SE status",
  water_supply_type: "Type of water supply",
  water_supply_other: "Water supply — other",
  within_premises: "Located within premises",
  available_247: "Available 24/7",
  water_micro_validation_date: "Microbiological validation date",
  water_micro_result: "Microbiological validation result",
  water_physico_date: "Physico-chemical test date",
  water_physico_result: "Physico-chemical test result",
  sanitary_facility_type: "Type of sanitary facility",
  unsanitary_facility_type: "Type of unsanitary facility",
  open_defecation: "Open defecation",
  toilet_not_shared: "Toilet not shared",
  excreta_disposal: "Excreta disposal/treatment",
  waste_segregation: "Waste segregation",
  waste_backyard_composting: "Backyard composting",
  waste_recycling: "Recycling/reuse",
  waste_collected: "Municipal collection",
  waste_others: "Other waste practice",
  remarks: "Remarks",
};

function AssessmentDetails({ household, visits, assessmentRecords }) {
  const latestVisit = visits?.[0] || null;
  const snapshot = normalizeHouseholdSnapshot(household?.assessmentProfile || latestVisit?.profileSnapshot || household || null);
  const memberRows = Array.isArray(snapshot?.members)
    ? snapshot.members
    : (Array.isArray(household?.assessmentProfile?.members) ? household.assessmentProfile.members : []);
  const latestEnvironmental = assessmentRecords?.[0] || null;
  const environmentalData = latestEnvironmental?.data || {};

  const profileFields = [
    ["Household head", snapshot?.headName],
    ["Number of families", snapshot?.families],
    ["Monthly income", snapshot?.monthlyIncome],
    ["Household status", snapshot?.hhStatus],
    ["Approval status", snapshot?.approvalStatus],
    ["Assigned BHW", snapshot?.collectorName],
    ["Respondent", [snapshot?.respondentFirst, snapshot?.respondentLast].filter(Boolean).join(" ")],
    ["Mother's maiden name", snapshot?.respondentMaiden],
  ];

  const demographicFields = [
    ["NHTS household status", snapshot?.nhts],
    ["Indigenous People status", snapshot?.ip],
    ["PhilHealth member", snapshot?.philhealthMember],
    ["PhilHealth ID", snapshot?.philhealthId],
    ["PhilHealth category", snapshot?.philhealthCategory],
  ];

  const environmentFields = [
    ["Water source", WATER_SOURCE_LABELS[snapshot?.waterSource] || snapshot?.waterSource],
    ["Water source type", snapshot?.waterType],
    ["Distance to water source", snapshot?.waterDistance],
    ["Water availability", snapshot?.waterAvailability],
    ["Water treatment practiced", snapshot?.waterTreated],
    ["Treatment methods", snapshot?.treatmentMethods],
    ["Toilet facility", TOILET_LABELS[snapshot?.toiletType] || snapshot?.toiletType],
    ["Sanitation facility access", snapshot?.sanitationAccess],
    ["Waste disposal", snapshot?.wasteDisposal],
    ["Waste segregation practiced", snapshot?.wasteSegregation],
  ];

  return (
    <Card className="p-5">
      <div className="mb-3">
        <h3 className="text-sm font-semibold text-brand-ink">Household Assessment Details</h3>
        <p className="mt-1 text-sm text-brand-gray">Complete saved information from the BHW assessment.</p>
      </div>
      {!snapshot && !latestEnvironmental ? (
        <p className="rounded-xl border border-dashed border-brand-border px-4 py-5 text-center text-sm text-brand-gray">No completed household assessment is recorded.</p>
      ) : (
        <div className="space-y-2">
          <details open className="rounded-xl border border-brand-border bg-white">
            <summary className="cursor-pointer list-none px-4 py-3 text-sm font-semibold text-brand-ink">Assessment Information</summary>
            <div className="grid grid-cols-1 gap-3 border-t border-brand-border p-4 sm:grid-cols-2">
              <InfoCell label="Assessment status" value={assessmentStatus(snapshot?.hhStatus)} />
              <InfoCell label="Date submitted" value={latestVisit?.createdAt ? formatAssessmentDate(latestVisit.createdAt) : (snapshot?.createdAt ? formatAssessmentDate(snapshot.createdAt) : "Not recorded")} />
              <InfoCell label="BHW who conducted assessment" value={latestVisit?.recordedByName || snapshot?.collectorName} />
              <InfoCell label="Date of household visit" value={latestVisit?.visitDate ? formatDate(latestVisit.visitDate) : "Not recorded"} />
              <InfoCell label="Last updated" value={snapshot?.updatedAt ? formatAssessmentDate(snapshot.updatedAt) : "Not recorded"} />
              <InfoCell label="Assessment reason" value={latestVisit?.visitReason} />
            </div>
          </details>

          <details open className="rounded-xl border border-brand-border bg-white">
            <summary className="cursor-pointer list-none px-4 py-3 text-sm font-semibold text-brand-ink">Household Profile</summary>
            <div className="grid grid-cols-1 gap-3 border-t border-brand-border p-4 sm:grid-cols-2">
              {[...profileFields, ...demographicFields].map(([label, value]) => <InfoCell key={label} label={label} value={assessmentValue(value)} />)}
            </div>
          </details>

          <details open className="rounded-xl border border-brand-border bg-white">
            <summary className="cursor-pointer list-none px-4 py-3 text-sm font-semibold text-brand-ink">Household Members</summary>
            <div className="border-t border-brand-border p-4">
              {Array.isArray(memberRows) && memberRows.length ? (
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  {memberRows.map((member, index) => (
                    <div key={member.id || `${member.name}-${index}`} className="min-w-0 rounded-xl bg-brand-bg/60 p-3 [overflow-wrap:anywhere]">
                      <p className="text-sm font-semibold text-brand-ink">{member.name || "Not recorded"}</p>
                      <dl className="mt-2 grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
                        {[["Relationship", member.relationship], ["Sex", member.sex], ["Birth date", member.birthday], ["Age", member.age], ["Classification", member.classification], ["Contact", member.contact], ["Person with disability", member.isPwd], ["PhilHealth", member.philhealth], ["Family planning", member.fpMethod], ["Quarter status", member.quarterStatus]].map(([label, value]) => (
                          <div key={label}><dt className="text-brand-gray">{label}</dt><dd className="mt-0.5 font-medium text-brand-ink">{assessmentValue(value)}</dd></div>
                        ))}
                      </dl>
                    </div>
                  ))}
                </div>
              ) : <p className="text-sm text-brand-gray">Not recorded</p>}
            </div>
          </details>

          <details open className="rounded-xl border border-brand-border bg-white">
            <summary className="cursor-pointer list-none px-4 py-3 text-sm font-semibold text-brand-ink">Water and Sanitation</summary>
            <div className="grid grid-cols-1 gap-3 border-t border-brand-border p-4 sm:grid-cols-2">
              {environmentFields.map(([label, value]) => <InfoCell key={label} label={label} value={assessmentValue(value)} />)}
              {latestEnvironmental && [
                ["Environmental assessment date", latestEnvironmental.assessment_date],
                ["SE status", latestEnvironmental.se_status],
                ["Sanitary facility", latestEnvironmental.sanitary_facility_type],
                ["Unsanitary facility", latestEnvironmental.unsanitary_facility_type],
                ["Open defecation", latestEnvironmental.open_defecation],
                ["Remarks", latestEnvironmental.remarks],
              ].map(([label, value]) => <InfoCell key={label} label={label} value={assessmentValue(value)} />)}
            </div>
          </details>

          {latestEnvironmental && (
            <details open className="rounded-xl border border-brand-border bg-white">
              <summary className="cursor-pointer list-none px-4 py-3 text-sm font-semibold text-brand-ink">Environmental Conditions</summary>
              <div className="grid grid-cols-1 gap-3 border-t border-brand-border p-4 sm:grid-cols-2">
                {Object.entries({ ...latestEnvironmental, ...environmentalData }).filter(([key]) => key !== "id" && key !== "data" && !["household_id", "municipality_id", "barangay_id", "created_by", "created_at", "updated_at", "has_basic_safe_water", "has_sanitary_toilet", "complete_sanitation", "open_defecation", "sanitary_facility_type", "unsanitary_facility_type", "assessment_date", "se_status", "water_supply_type", "water_supply_other", "within_premises", "available_247", "remarks"].includes(key)).map(([key, value]) => (
                  <InfoCell key={key} label={environmentalFieldLabels[key] || key.replaceAll("_", " ")} value={assessmentValue(value)} />
                ))}
                {["water_supply_type", "water_supply_other", "within_premises", "available_247"].map((key) => (
                  <InfoCell key={key} label={environmentalFieldLabels[key]} value={assessmentValue(latestEnvironmental[key] ?? environmentalData[key])} />
                ))}
              </div>
            </details>
          )}

          {assessmentRecords?.length > 1 && (
            <details className="rounded-xl border border-brand-border bg-white">
              <summary className="cursor-pointer list-none px-4 py-3 text-sm font-semibold text-brand-ink">Previous Environmental Assessments</summary>
              <div className="space-y-3 border-t border-brand-border p-4">
                {assessmentRecords.slice(1).map((record) => (
                  <details key={record.id} className="rounded-lg border border-brand-border p-3">
                    <summary className="cursor-pointer text-sm font-medium text-brand-ink">{record.assessment_date ? formatDate(record.assessment_date) : "Assessment date not recorded"}{record.created_at ? ` · ${formatAssessmentDate(record.created_at)}` : ""}</summary>
                    <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                      {Object.entries({ ...record, ...(record.data || {}) }).filter(([key]) => key !== "id" && !["household_id", "municipality_id", "barangay_id", "created_by", "created_at", "updated_at", "data"].includes(key)).map(([key, value]) => (
                        <InfoCell key={key} label={environmentalFieldLabels[key] || key.replaceAll("_", " ")} value={assessmentValue(value)} />
                      ))}
                    </div>
                  </details>
                ))}
              </div>
            </details>
          )}
        </div>
      )}
    </Card>
  );
}

export default function HouseholdRiskDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const { can } = usePermissions();
  const access = getHouseholdDetailAccess({ user, can });
  const { canViewWorkflow, canEditWorkflow, canCreateVisits } = access;

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
  const [savingClusterLevel, setSavingClusterLevel] = useState(false);

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
      const loaded = await loadHouseholdDetailData({
        id,
        access: { canViewWorkflow: access.canViewWorkflow, canViewVisits: access.canViewVisits },
        getHousehold: (targetId) => householdsApi.get(targetId),
        getWorkflow: (targetId) => householdRiskApi.getWorkflow(targetId),
        listVisits: (targetId) => householdsApi.listVisits(targetId),
      });
      if (!loaded) {
        setHousehold(null);
        setPhase("notfound");
        return;
      }
      setVisits(loaded.visits);
      setHousehold(toRiskCluster(loaded.record, loaded.workflow));
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
  }, [id, access.canViewWorkflow, access.canViewVisits]);

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
      throw err;
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

  // Loading skeleton
  if (phase === "loading") {
    return (
      <>
        <PageHeader crumbs={["Community Risk", "Household Risk Overview", "Household Details"]} title="Household Risk Profile" subtitle="Loading household information..." />
        <div className="h-40 animate-pulse rounded-2xl border border-slate-200 bg-slate-100" />
        <div className="mt-4 h-72 animate-pulse rounded-2xl border border-slate-200 bg-slate-100" />
      </>
    );
  }

  // Not found
  if (phase === "notfound" || (phase === "ready" && !household)) {
    return (
      <>
        <PageHeader crumbs={["Community Risk", "Household Risk Overview", "Household Details"]} title="Household Risk Profile" subtitle="Household record" />
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
        <PageHeader crumbs={["Community Risk", "Household Risk Overview", "Household Details"]} title="Household Risk Profile" subtitle="Household record" />
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
  const tone = levelTone[h.risk.level] || levelTone[RISK_LEVELS.UNASSESSED];
  const riskLabel = RISK_LEVEL_LABELS[h.risk.level] || RISK_LEVEL_LABELS[RISK_LEVELS.UNASSESSED];
  const clusterAssignmentLabel = h.risk.level === RISK_LEVELS.UNASSESSED
    ? "Unassigned"
    : riskLabel;

  const saveClusterLevel = async (level) => {
    setSavingClusterLevel(true);
    try {
      await persistWorkflow(
        { riskClusterLevel: level || null },
        level ? `Cluster assignment changed to ${RISK_LEVEL_LABELS[level]}.` : "Cluster assignment cleared.",
      );
    } catch {
      // persistWorkflow displays the server error in the page toast.
    } finally {
      setSavingClusterLevel(false);
    }
  };

  return (
    <>
      <PageHeader
        crumbs={["Households", "Household Details"]}
        title={`${h.head} Household`}
        subtitle={`${h.id} · Barangay ${h.barangay}`}
        action={
          <div className="flex flex-wrap items-center gap-2">
            {canEditWorkflow && (
              <>
                <button onClick={() => setAction("followup")} className="inline-flex h-11 items-center gap-1.5 rounded-btn bg-brand-blue px-3.5 text-sm font-medium text-white hover:bg-brand-dark">
                  <PhoneCall className="h-4 w-4" /> Record Household Follow-up
                </button>
                <button onClick={() => setAction("assign")} className="inline-flex h-11 items-center gap-1.5 rounded-btn border border-brand-border bg-white px-3.5 text-sm font-medium text-brand-ink hover:bg-brand-bg dark:bg-card dark:hover:bg-hover">
                  <UserPlus className="h-4 w-4" /> Assign Health Worker
                </button>
                <button onClick={() => setAction("escalate")} className="inline-flex h-11 items-center gap-1.5 rounded-btn border border-brand-border bg-white px-3.5 text-sm font-medium text-brand-danger hover:bg-brand-danger/5 dark:bg-card">
                  <ArrowUpRight className="h-4 w-4" /> Escalate
                </button>
              </>
            )}
             <Link to={backPath} className="inline-flex h-11 items-center gap-1.5 rounded-btn border border-brand-border bg-white px-3.5 text-sm font-medium text-brand-gray hover:bg-brand-bg dark:bg-card dark:hover:bg-hover">
               <ChevronRight className="h-4 w-4 rotate-180" /> {user?.role === "bhw" ? "Back to Households" : "Back to Risk Overview"}
            </Link>
          </div>
        }
      />

      {toast && (
        <div role="status" className="fixed bottom-4 right-4 z-[80] flex max-w-[calc(100%-2rem)] items-center gap-2 rounded-btn bg-brand-ink px-4 py-3 text-white shadow-lg">
          <span className="text-sm">{toast}</span>
        </div>
      )}

      <div className="space-y-5">
        {/* Household information */}
        <Card className="p-5">
          <h3 className="mb-4 text-sm font-semibold text-brand-ink">Household Information</h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <InfoCell icon={Home} label="Household ID" value={h.id} />
            <InfoCell icon={MapPin} label="Barangay" value={h.barangay} />
            <InfoCell icon={MapPin} label="Purok" value={h.purok || "—"} />
            <InfoCell icon={Home} label="Address" value={h.address || "—"} />
            <InfoCell icon={Users} label="Household Members" value={h.members} />
            {canViewWorkflow && (
              <>
                <InfoCell icon={UserPlus} label="Assigned Worker" value={h.assignedWorker || "—"} />
                <InfoCell icon={Activity} label="Follow-up Status" value={h.workflowStatus || "—"} />
              </>
            )}
            <InfoCell icon={FileText} label="Last Assessment" value={formatDate(h.lastAssessment)} />
          </div>
        </Card>

        <AssessmentDetails
          household={h}
          visits={visits}
          assessmentRecords={h.assessmentRecords}
        />

        {access.canViewVisits && (
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

            {canCreateVisits && <form onSubmit={(event) => { event.preventDefault(); saveVisit(); }} className="mt-4 grid grid-cols-1 items-end gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)_auto]">
              <label className="min-w-0 text-sm font-medium text-brand-ink">
                Visit date
                <input
                  type="date"
                  required
                  value={visitDate}
                  onChange={(event) => {
                    setVisitDate(event.target.value);
                    setVisitRequestId(newVisitRequestId());
                  }}
                  className="mt-1.5 block min-h-11 w-full min-w-0 max-w-full rounded-input border border-brand-border bg-white px-3.5 py-2.5 text-sm text-brand-ink outline-none focus:border-brand-blue"
                />
              </label>
              <label className="min-w-0 text-sm font-medium text-brand-ink">
                Visit reason
                <select
                  value={visitReason}
                  onChange={(event) => setVisitReason(event.target.value)}
                  className="mt-1.5 block min-h-11 w-full min-w-0 rounded-input border border-brand-border bg-white px-3.5 py-2.5 text-sm text-brand-ink outline-none focus:border-brand-blue"
                >
                  {VISIT_REASONS.map((reason) => <option key={reason} value={reason}>{reason}</option>)}
                </select>
              </label>
              <button
                type="submit"
                disabled={!visitDate || savingVisit}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-btn bg-brand-blue px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-60 sm:col-span-2 sm:justify-self-start lg:col-span-1"
              >
                <Plus className="h-4 w-4" /> {savingVisit ? "Saving…" : "Record Visit"}
              </button>
             </form>}
            {visitError && <p role="alert" className="mt-2 text-sm text-red-600">{visitError}</p>}

            <div className="mt-5">
              {visits.length ? (
                <ol className="space-y-2">
                  {visits.map((visit, index) => (
                    <li key={visit.id} className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3 [overflow-wrap:anywhere] ${index === 0 ? "border-brand-blue/30 bg-brand-blue/5" : "border-brand-border bg-white"}`}>
                      <div className="flex min-w-0 items-center gap-3">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-blue/10 text-brand-blue">
                          <CalendarDays className="h-4 w-4" />
                        </span>
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-brand-ink">{visitLabel(visit.visitNumber)}{index === 0 ? " · Most recent" : ""}</p>
                          <p className="text-sm text-brand-gray">{formatDate(visit.visitDate)}</p>
                          <p className="text-xs text-brand-gray">{visit.visitReason || "Follow-up"}</p>
                          {visit.updatedSections?.length > 0 && (
                            <p className="mt-1 text-xs text-brand-gray">Updated: {visit.updatedSections.join(", ")}</p>
                          )}
                        </div>
                      </div>
                      <div className="min-w-0 text-xs text-brand-gray sm:text-right">
                        {visit.recordedByName && <p>Recorded by {visit.recordedByName}</p>}
                        {visit.status && <p className="mt-0.5">{visit.status}</p>}
                      </div>
                      {visit.profileSnapshot && (
                        <details className="w-full border-t border-brand-border pt-2">
                          <summary className="min-h-11 cursor-pointer py-3 text-sm font-medium text-brand-blue">View profile saved at this visit</summary>
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
              <span className={`h-2 w-2 rounded-full ${tone.dot}`} /> {clusterAssignmentLabel}
            </span>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
            <InfoCell icon={Activity} label="Cluster Assignment" value={clusterAssignmentLabel} />
            <InfoCell icon={FileText} label="Environmental Risk" value={h.environmentalRisk.level || "Unassessed"} />
            <InfoCell icon={Activity} label="Environmental Score" value={h.environmentalRisk.score ?? "—"} />
            <InfoCell icon={Home} label="Last Household Visit" value={daysSince(h.lastHouseholdVisit || visits[0]?.visitDate) === null ? "—" : `${daysSince(h.lastHouseholdVisit || visits[0]?.visitDate)} days ago`} />
          </div>

          {canEditWorkflow && (
            <label className="mt-4 block max-w-sm text-sm font-medium text-brand-ink">
              Community cluster assignment
              <select
                value={h.riskClusterLevel === RISK_LEVELS.UNASSESSED ? "" : h.riskClusterLevel}
                disabled={savingClusterLevel}
                onChange={(event) => { void saveClusterLevel(event.target.value); }}
                className="mt-1.5 block min-h-11 w-full rounded-input border border-brand-border bg-white px-3.5 py-2.5 text-sm text-brand-ink outline-none focus:border-brand-blue"
              >
                <option value="">Unassigned</option>
                {[RISK_LEVELS.PRIORITY, RISK_LEVELS.INTERVENTION, RISK_LEVELS.MONITOR, RISK_LEVELS.STABLE].map((level) => (
                  <option key={level} value={level}>{RISK_LEVEL_LABELS[level]}</option>
                ))}
              </select>
              <span className="mt-1 block text-xs font-normal text-brand-gray">This is an explicit community assignment and is separate from environmental risk.</span>
            </label>
          )}

          {/* Keep the independent environmental assessment distinct from the cluster assignment. */}
          <div className="rounded-2xl border border-slate-200 dark:border-border bg-brand-bg/60 dark:bg-card-nested p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-brand-gray mb-1">Environmental Assessment</p>
            {h.environmentalRisk.factors.length > 0 ? (
              <ul className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-1">
                {h.environmentalRisk.factors.map((factor) => (
                  <li key={factor} className="flex items-start gap-2 text-sm text-brand-gray">
                    <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-accent" /> {factor}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-sm text-brand-gray">No environmental factors are recorded.</p>
            )}
            <p className="mt-1 text-xs text-brand-gray">
              Environmental values are shown separately and do not determine the community cluster assignment.
            </p>
          </div>

          {canViewWorkflow && (
          <>
          {/* Risk history */}
          <div className="mt-4 rounded-2xl border border-slate-200 dark:border-border bg-white p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-brand-gray mb-3">Risk History</p>
            {h.history.length > 0 ? (
              <div className="space-y-1.5">
                {h.history.map((entry) => (
                  <div key={`${entry.month}-${entry.year}`} className="flex items-center justify-between gap-3 text-sm">
                    <span className="text-brand-gray">{entry.month} {entry.year}</span>
                    <span className="inline-flex items-center gap-1.5 text-brand-ink">
                      <span className={`h-2 w-2 rounded-full ${(levelTone[entry.level] || levelTone[RISK_LEVELS.UNASSESSED]).dot}`} /> {RISK_LEVEL_LABELS[entry.level] || RISK_LEVEL_LABELS[RISK_LEVELS.UNASSESSED]}
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
          </>
          )}
        </Card>
      </div>

      {canEditWorkflow && action === "followup" && (
        <FollowUpModal
          household={h}
          onClose={() => setAction(null)}
          onSave={async (status, notes) => {
            const followUpCount = (h.followUpCount || 0) + 1;
            const lastFollowUpAt = new Date().toISOString().slice(0, 10);
            await persistWorkflow(
              { workflowStatus: status, followUpCount, lastFollowUpAt, lastNote: notes },
              `Follow-up recorded for the ${h.surname} household.`
            );
            setAction(null);
          }}
        />
      )}
      {canEditWorkflow && action === "assign" && (
        <AssignWorkerModal
          household={h}
          onClose={() => setAction(null)}
          onSave={async (worker, role) => {
            await persistWorkflow(
              { assignedWorker: worker, assignedWorkerRole: role, assignmentAt: new Date().toISOString() },
              `Worker assigned to the ${h.surname} household.`
            );
            setAction(null);
          }}
        />
      )}
      {canEditWorkflow && action === "escalate" && (
        <EscalateModal
          household={h}
          onClose={() => setAction(null)}
          onSave={async (reason) => {
            await persistWorkflow(
              { workflowStatus: "Escalated", escalation: { reason, assignment: "Public Health Nurse", at: new Date().toISOString() } },
              `Case escalated for the ${h.surname} household.`
            );
            setAction(null);
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
