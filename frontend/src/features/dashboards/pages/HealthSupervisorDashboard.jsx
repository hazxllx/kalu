import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card } from "@/components/common/Card";
import PageHeader from "@/components/common/PageHeader";
import { usePhnWorkflow } from "@/hooks/usePhnWorkflow";
import { referralsApi, followUpsApi } from "@/services/api";
import {
  fetchEarlyWarningData,
  fetchCommunityMap,
} from "@/services/api/earlyWarningApi";
import {
  filterSupervisorRows,
  getSupervisorScope,
  supervisorVisibleBarangays,
} from "@/lib/supervisorScope";
import { riskOfPatient } from "@/lib/riskRules";
import { useAuth } from "@/context/AuthContext";
import CommunityHealthMap from "@/features/analytics/components/CommunityHealthMap";
import TopHealthTrends from "@/features/dashboards/components/TopHealthTrends";
import { buildTopHealthTrends } from "@/features/dashboards/components/healthTrendsUtils";
import ScheduleCalendar from "@/features/dashboards/components/ScheduleCalendar";
import { X, AlertTriangle, Clock, FileText, MapPin, TrendingUp } from "lucide-react";
import { toLocalISODate } from "@/lib/dateUtils";

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
  Medium: "bg-brand-gray/10 text-brand-gray",
  Low: "bg-brand-gray/10 text-brand-gray",
};

const ATTENTION_TONES = {
  "HIGH-RISK CASE": "bg-brand-danger/10 text-brand-danger",
  "PENDING REFERRAL": "bg-brand-gray/10 text-brand-gray",
  "OVERDUE FOLLOW-UP": "bg-brand-gray/10 text-brand-gray",
  "FOLLOW-UP DUE": "bg-brand-gray/10 text-brand-gray",
};

const getCaseReason = (item) => [item.detail, item.extra].filter(Boolean).join(" · ");
const truncateCaseReason = (reason) => (reason.length > 60 ? `${reason.slice(0, 59)}…` : reason);

// Quick filters for the Cases Requiring Attention list. Each maps to the
// synthetic `kind` tags assigned below so a resident never appears twice and a
// filter never fabricates a category.
const ATTENTION_FILTERS = [
  { id: "all", label: "All" },
  { id: "high-risk", label: "High Risk" },
  { id: "overdue", label: "Overdue" },
  { id: "pending-referral", label: "Pending Referrals" },
];

const matchesAttentionFilter = (item, filterId) => {
  switch (filterId) {
    case "high-risk":
      return item.kind === "HIGH-RISK CASE";
    case "overdue":
      return item.kind === "OVERDUE FOLLOW-UP" || item.kind === "FOLLOW-UP DUE";
    case "pending-referral":
      return item.kind === "PENDING REFERRAL";
    default:
      return true;
  }
};

export default function HealthSupervisorDashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const scope = getSupervisorScope(user);
  const [selectedPeriod, setSelectedPeriod] = useState(() => {
    const now = new Date();
    return { month: now.getMonth(), year: now.getFullYear() };
  });
  const now = new Date();
  const firstSelectableMonth = new Date(now.getFullYear(), now.getMonth() - 23, 1);
  const yearOptions = Array.from(
    { length: now.getFullYear() - firstSelectableMonth.getFullYear() + 1 },
    (_, index) => now.getFullYear() - index,
  );
  const monthOptions = (year) =>
    Array.from({ length: 12 }, (_, month) => month).filter((month) => {
      const optionDate = new Date(year, month, 1);
      return optionDate >= firstSelectableMonth && optionDate <= new Date(now.getFullYear(), now.getMonth(), 1);
    });
  const availableMonths = monthOptions(selectedPeriod.year);
  const selectedPeriodLabel = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(
    new Date(selectedPeriod.year, selectedPeriod.month, 1),
  );
  const selectedPeriodRange = useMemo(() => ({
    from: toLocalISODate(new Date(selectedPeriod.year, selectedPeriod.month, 1)),
    to: toLocalISODate(new Date(selectedPeriod.year, selectedPeriod.month + 1, 0)),
  }), [selectedPeriod.month, selectedPeriod.year]);

  const [communityMapData, setCommunityMapData] = useState(null);
  const [communityMapLoading, setCommunityMapLoading] = useState(true);
  const [communityMapError, setCommunityMapError] = useState("");
  const [communityMapRetry, setCommunityMapRetry] = useState(0);
  const [selectedMapBarangayName, setSelectedMapBarangayName] = useState(null);
  useEffect(() => {
    let active = true;
    setCommunityMapLoading(true);
    setCommunityMapError("");
    fetchCommunityMap(selectedPeriodRange)
      .then((data) => {
        if (!active) return;
        const mapBarangays = (data?.barangays || []).map((row) => {
          const filteredRow = { ...row };
          delete filteredRow.newCases;
          return filteredRow;
        });
        setCommunityMapData({
          ...data,
          // The map's legacy popup labels this field "New (this month)" and
          // calculates it against today's month, not the selected period.
          barangays: mapBarangays,
        });
      })
      .catch(() => {
        if (active) setCommunityMapError("Unable to load community health data.");
      })
      .finally(() => {
        if (active) setCommunityMapLoading(false);
      });
    return () => { active = false; };
  }, [selectedPeriodRange, communityMapRetry]);
  const selectedMapBarangay = communityMapData?.barangays?.find(
    (barangay) => barangay.name === selectedMapBarangayName,
  ) || null;

  const {
    patients: workflowPatients,
    loading: workflowLoading,
    error: workflowError,
  } = usePhnWorkflow({ source: "intake" });

  const [referrals, setReferrals] = useState([]);
  const [followUps, setFollowUps] = useState([]);
  const [earlyWarning, setEarlyWarning] = useState({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  // Freshness: set only when a load truly succeeds so the indicator never shows
  // a timestamp for failed or empty data.
  const [lastUpdated, setLastUpdated] = useState(null);

  const visibleBarangays = useMemo(() => supervisorVisibleBarangays(user), [user]);
  const barangayKey = visibleBarangays.join("|");

  const loadStats = useCallback(() => {
    setLoading(true);
    setLoadError(null);
    const barangays = barangayKey ? barangayKey.split("|") : [];
    return Promise.all([
      referralsApi.list(),
      followUpsApi.list(),
      Promise.all(barangays.map((b) => fetchEarlyWarningData(b))),
    ])
      .then(([referralResult, followUpResult, ewList]) => {
        setReferrals((referralResult?.rows || []).map(mapReferral));
        setFollowUps((followUpResult?.rows || []).map(mapFollowUp));
        const map = {};
        barangays.forEach((b, i) => { map[b] = ewList[i] || null; });
        setEarlyWarning(map);
        setLastUpdated(new Date());
      })
      .catch((err) => {
        setLoadError(err?.message || "Unable to load dashboard statistics. Please try again.");
        setReferrals([]);
        setFollowUps([]);
        setEarlyWarning({});
        setLastUpdated(null);
      })
      .finally(() => setLoading(false));
  }, [barangayKey]);

  useEffect(() => { loadStats(); }, [loadStats]);

  const visibleReferrals = referrals;
  const visibleFollowUps = followUps;

  const highRiskResidents = useMemo(
    () => Object.values(earlyWarning).reduce((sum, ew) => sum + (ew?.summary?.highRiskResidents || 0), 0),
    [earlyWarning]
  );

  // Previous equivalent reporting period (one calendar month earlier) used only
  // to derive a trend direction for the Top 3 Health Trends panel. The range
  // mirrors `selectedPeriodRange` exactly — same authorized scope, same length —
  // so the comparison is like-for-like. The scope itself always comes from the
  // authenticated session server-side, never from these client dates.
  const previousPeriodRange = useMemo(() => {
    const year = selectedPeriod.month === 0 ? selectedPeriod.year - 1 : selectedPeriod.year;
    const month = selectedPeriod.month === 0 ? 11 : selectedPeriod.month - 1;
    return {
      from: toLocalISODate(new Date(year, month, 1)),
      to: toLocalISODate(new Date(year, month + 1, 0)),
    };
  }, [selectedPeriod.month, selectedPeriod.year]);

  const [previousMapData, setPreviousMapData] = useState(null);
  const [previousMapError, setPreviousMapError] = useState(false);
  useEffect(() => {
    let active = true;
    setPreviousMapError(false);
    fetchCommunityMap(previousPeriodRange)
      .then((data) => { if (active) setPreviousMapData(data); })
      .catch(() => {
        if (active) {
          setPreviousMapData(null);
          setPreviousMapError(true);
        }
      });
    return () => { active = false; };
  }, [previousPeriodRange]);

  // Top 3 recorded conditions for the selected period, ranked by case count,
  // aggregated from the SAME scoped, server-classified community-map rows that
  // drive the map. A comparison is attached only when the previous period
  // returned usable rows; otherwise the panel shows the case count alone.
  const topHealthTrends = useMemo(
    () => buildTopHealthTrends(
      communityMapData?.barangays || [],
      previousMapError ? null : previousMapData?.barangays || null,
      { limit: 3 },
    ),
    [communityMapData, previousMapData, previousMapError],
  );

  const visiblePatients = useMemo(
    () => filterSupervisorRows(workflowPatients, user),
    [workflowPatients, user]
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
      activeCases: visiblePatients.filter((p) => p.status !== "Consultation Completed").length,
      highRisk: highRiskResidents,
      pendingReferrals: visibleReferrals.filter((r) => OPEN_REFERRAL_STATUSES.has(r.status)).length,
      overdueFollowUps: visibleFollowUps.filter(isFollowUpDue).length,
    };
  }, [visiblePatients, visibleReferrals, visibleFollowUps, highRiskResidents]);

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
          extra: `${r.facility || ""} · ${r.status || ""}`,
          action: "Review Referral",
        });
      });

    // Remaining referrals awaiting review.
    visibleReferrals
      .filter((r) => r.status === "Pending")
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

    // Overdue / due follow-ups (open and due today or earlier).
    visibleFollowUps
      .filter(isFollowUpDue)
      .forEach((f) => {
        const overdue = String(f.dueDate).slice(0, 10) < todayIso();
        items.push({
          key: `followup-${f.id}`,
          kind: overdue ? "OVERDUE FOLLOW-UP" : "FOLLOW-UP DUE",
          resident: f.resident,
          barangay: f.barangay || "RHU",
          detail: f.purpose,
          extra: `${f.dueDate || ""} · ${f.time || ""}`,
          action: "Review",
        });
      });

    // Urgent first: high-risk cases, then overdue follow-ups, then pending
    // referrals. Ordering stays stable even when a resident has several reasons.
    const rank = (item) =>
      item.kind === "HIGH-RISK CASE" ? 0
        : item.kind === "OVERDUE FOLLOW-UP" ? 1
          : item.kind === "FOLLOW-UP DUE" ? 2
            : 3;
    return [...items].sort((a, b) => rank(a) - rank(b));
  }, [visiblePatients, visibleReferrals, visibleFollowUps, patientByName]);

  // Quick-filter UI applied over the already-deduplicated attention list.
  const [attentionFilter, setAttentionFilter] = useState("all");
  const filteredCases = useMemo(
    () => cases.filter((item) => matchesAttentionFilter(item, attentionFilter)),
    [cases, attentionFilter],
  );
  const visibleCaseCount = Math.min(filteredCases.length, 6);
  const hasMoreCases = filteredCases.length > visibleCaseCount;

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

  const viewAllCases = () => {
    // Overdue follow-ups live on the Follow-ups page; everything else is
    // actioned from Referrals (or the resident directory for high-risk cases).
    if (attentionFilter === "overdue") navigate("/app/health_supervisor/followups");
    else navigate("/app/health_supervisor/referrals");
  };

  const casePatient = caseModal;

  const freshnessLabel = lastUpdated
    ? new Intl.DateTimeFormat(undefined, {
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      }).format(lastUpdated)
    : null;

  return (
    <main className="space-y-5 bg-brand-bg font-body">
      <PageHeader
        crumbs={["Health Monitoring"]}
        title="Health Supervisor Dashboard"
        subtitle={`${
          scope?.level === "barangay"
            ? `Barangay ${scope.assignedBarangay}`
            : "Municipal coverage"
        } · Health Supervisor · Reporting period: ${selectedPeriodLabel}`}
        action={
          <div className="flex max-w-full flex-wrap items-center gap-2">
            <select
              aria-label="Reporting month"
              value={selectedPeriod.month}
              onChange={(event) =>
                setSelectedPeriod((current) => ({ ...current, month: Number(event.target.value) }))
              }
              className="h-9 max-w-full rounded-sm border border-brand-border bg-brand-paper px-2 py-1.5 text-xs text-brand-ink outline-none focus:border-brand-blue"
            >
              {availableMonths.map((month) => (
                <option key={month} value={month}>
                  {new Intl.DateTimeFormat(undefined, { month: "long" }).format(new Date(2000, month, 1))}
                </option>
              ))}
            </select>
            <select
              aria-label="Reporting year"
              value={selectedPeriod.year}
              onChange={(event) => {
                const year = Number(event.target.value);
                const months = monthOptions(year);
                const month = months.includes(selectedPeriod.month)
                  ? selectedPeriod.month
                  : months[months.length - 1];
                setSelectedPeriod({ year, month });
              }}
              className="h-9 rounded-sm border border-brand-border bg-brand-paper px-2 py-1.5 text-xs text-brand-ink outline-none focus:border-brand-blue"
            >
              {yearOptions.map((year) => <option key={year} value={year}>{year}</option>)}
            </select>
            <button
              type="button"
              onClick={() => navigate("/app/health_supervisor/reports")}
              className="inline-flex h-9 items-center gap-1.5 rounded-sm border border-brand-border bg-brand-paper px-3 py-1.5 text-xs font-medium text-brand-ink transition-colors hover:border-brand-blue hover:text-brand-blue"
            >
              <FileText className="h-3.5 w-3.5" />
              View Reports
            </button>
          </div>
        }
      />

      <section aria-label="Key indicators">
        {loadError && (
          <Card className="!rounded-card mb-3 flex items-start justify-between gap-3 !border-brand-border !bg-brand-paper p-4 !shadow-none">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-brand-gray" />
              <div>
                <p className="text-sm font-semibold text-brand-ink">Couldn't load dashboard statistics</p>
                <p className="mt-0.5 text-xs text-brand-gray">{loadError}</p>
              </div>
            </div>
            <button
              onClick={loadStats}
              className="shrink-0 rounded-sm border border-brand-border px-3 py-1.5 text-xs font-medium text-brand-ink hover:border-brand-gray"
            >
              Retry
            </button>
          </Card>
        )}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[
            {
              label: "Pending Referrals",
              value: loading ? "…" : loadError ? "—" : stats.pendingReferrals,
              path: "/app/health_supervisor/referrals",
              tone: "text-brand-ink",
              dot: "bg-brand-gold/70",
            },
            {
              label: "Overdue Follow-ups",
              value: loading ? "…" : loadError ? "—" : stats.overdueFollowUps,
              path: "/app/health_supervisor/followups",
              tone: "text-brand-ink",
              dot: "bg-brand-gold/70",
            },
            {
              label: "High-Risk Cases",
              value: loading ? "…" : loadError ? "—" : stats.highRisk,
              path: "/app/health_supervisor/residents",
              tone: "text-brand-danger",
              dot: "bg-brand-danger",
            },
            {
              label: "Active Cases",
              value: workflowLoading ? "…" : workflowError ? "—" : stats.activeCases,
              path: "/app/health_supervisor/consultations",
              tone: "text-brand-blue",
              dot: "bg-brand-blue",
            },
          ].map((item) => (
            <button
              key={item.label}
              type="button"
              onClick={() => navigate(item.path)}
              className="group min-w-0 rounded-card border border-brand-border bg-brand-paper p-4 text-left transition-colors hover:border-brand-blue/70 hover:bg-brand-blue/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-gray"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-brand-gray">{item.label}</span>
                <span className={`h-2 w-2 rounded-full ${item.dot}`} aria-hidden="true" />
              </div>
              <p className={`mt-4 font-stat text-[30px] font-semibold leading-none tracking-tight ${item.tone}`}>
                {item.value}
              </p>
            </button>
          ))}
        </div>
      </section>

      <section aria-label="Operational overview" className="grid gap-4 xl:grid-cols-[minmax(0,1.55fr)_minmax(300px,0.8fr)]">
        <div className="min-w-0">
          <ScheduleCalendar selectedMonth={new Date(selectedPeriod.year, selectedPeriod.month, 1)} />
        </div>

        <div className="space-y-4">
          <Card className="!rounded-card min-w-0 !border-brand-border !bg-brand-paper p-4 !shadow-none">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-brand-gold shrink-0" aria-hidden="true" />
              <h2 className="font-heading text-sm font-semibold text-brand-blue">Top 3 Health Trends</h2>
            </div>
            <p className="mt-1 text-xs text-brand-gray">
              Most frequently recorded conditions within your authorized coverage · {selectedPeriodLabel}.
            </p>
            <TopHealthTrends
              trends={topHealthTrends}
              loading={communityMapLoading}
              error={communityMapError}
            />
          </Card>

          <Card className="!rounded-card min-w-0 !border-brand-border !bg-brand-paper p-4 !shadow-none">
            <div className="flex items-center gap-2">
              <MapPin className="h-4 w-4 text-brand-gold shrink-0" aria-hidden="true" />
              <h2 className="font-heading text-sm font-semibold text-brand-blue">Community Health Map</h2>
            </div>
            <p className="mt-1 text-xs text-brand-gray">
              Aggregated case activity for {selectedPeriodLabel} within your authorized coverage.
            </p>
            <div className="mt-3">
              <div className="[&_.leaflet-container]:!h-[270px] [&>div>div.mt-3]:hidden">
                <CommunityHealthMap
                  barangays={communityMapData?.barangays || []}
                  center={communityMapData?.center || null}
                  loading={communityMapLoading}
                  error={communityMapError}
                  onRetry={() => setCommunityMapRetry((count) => count + 1)}
                  onSelect={(barangay) => setSelectedMapBarangayName(barangay.name)}
                  selectedName={selectedMapBarangayName}
                />
              </div>
            </div>
            {selectedMapBarangay && (
              <div aria-live="polite" className="mt-3 rounded-sm border border-brand-border bg-brand-bg/60 p-3 text-xs">
                <p className="font-semibold text-brand-ink">{selectedMapBarangay.name}</p>
                <p className="mt-1 text-brand-gray">
                  {selectedMapBarangay.caseCount ?? 0} total cases · {selectedMapBarangay.activeCases ?? 0} active cases
                </p>
                {selectedMapBarangay.topCondition && (
                  <p className="text-brand-gray">
                    Top condition: {selectedMapBarangay.topCondition.name} ({selectedMapBarangay.topCondition.value})
                  </p>
                )}
              </div>
            )}
          </Card>
        </div>
      </section>

      <section aria-labelledby="attention-heading">
        <Card className="!rounded-card overflow-hidden !border-brand-border !bg-brand-paper p-0 !shadow-none">
          <div className="flex flex-col gap-3 px-4 pb-3 pt-4 sm:flex-row sm:items-start sm:justify-between">
             <div>
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-brand-gold shrink-0" aria-hidden="true" />
                <h2 id="attention-heading" className="font-heading text-sm font-semibold text-brand-blue">Cases Requiring Attention</h2>
              </div>
              <p className="mt-1 text-xs text-brand-gray">
                {scope?.level === "barangay"
                  ? `Cases within ${scope.assignedBarangay} that need supervisory action.`
                  : "Cases within your authorized coverage that need supervisory action."}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter attention cases">
              {ATTENTION_FILTERS.map((filter) => (
                <button
                  key={filter.id}
                  type="button"
                  onClick={() => setAttentionFilter(filter.id)}
                  aria-pressed={attentionFilter === filter.id}
                  className={`rounded-sm border px-2.5 py-1 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-gray ${
                    attentionFilter === filter.id
                      ? "border-brand-blue bg-brand-blue/10 text-brand-blue"
                      : "border-brand-border bg-brand-paper text-brand-gray hover:border-brand-gray"
                  }`}
                >
                  {filter.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            {filteredCases.length === 0 && (
              <p className="py-8 text-center text-[13px] text-brand-gray">
                No cases match this filter. Try another filter or clear the selection.
              </p>
            )}
            {filteredCases.slice(0, 6).map((item, index) => (
              <div
                key={item.key}
                className={`grid min-h-11 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-4 py-2 ${
                  index > 0 ? "border-t border-brand-border" : ""
                }`}
              >
                <div className="flex min-w-0 items-center gap-2">
                  <span className={`shrink-0 rounded-sm px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${ATTENTION_TONES[item.kind] || "bg-brand-gray/10 text-brand-gray"}`}>
                    {item.kind === "HIGH-RISK CASE"
                      ? "HIGH RISK"
                      : item.kind === "OVERDUE FOLLOW-UP"
                        ? "OVERDUE"
                        : item.kind === "FOLLOW-UP DUE"
                          ? "DUE"
                          : "REFERRAL"}
                  </span>
                  <p className="shrink-0 text-[13px] font-medium text-brand-ink">{item.resident}</p>
                  <span className="shrink-0 text-xs text-brand-gray">·</span>
                  <span className="shrink-0 text-xs text-brand-gray">
                    {item.barangay === "RHU" && scope?.level === "barangay" ? scope.assignedBarangay : item.barangay}
                  </span>
                  <span aria-hidden="true" className="shrink-0 text-xs text-brand-gray">·</span>
                  <p
                    title={getCaseReason(item)}
                    className="min-w-0 flex-1 truncate text-xs text-brand-gray"
                  >
                    {truncateCaseReason(getCaseReason(item))}
                  </p>
                </div>
                <button
                  onClick={() => handleCaseAction(item)}
                  className="shrink-0 inline-flex items-center gap-1 text-xs font-medium text-brand-blue hover:underline"
                >
                  Review <span aria-hidden="true">→</span>
                </button>
              </div>
            ))}
            {hasMoreCases && (
              <div className="border-t border-brand-border px-4 py-2">
                <button
                  type="button"
                  onClick={viewAllCases}
                  className="inline-flex items-center gap-1 text-xs font-medium text-brand-blue hover:underline"
                >
                  View all cases <span aria-hidden="true">→</span>
                </button>
              </div>
            )}
          </div>
        </Card>
      </section>

      {freshnessLabel && (
        <p className="flex items-center justify-end gap-1.5 text-xs text-brand-gray">
          <Clock className="h-3 w-3" />
          Last updated {freshnessLabel}
        </p>
      )}

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
    </main>
  );
}