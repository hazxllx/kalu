import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import PageHeader from "@/components/common/PageHeader";
import KpiHorizontal from "@/components/common/KpiHorizontal";
import { Card } from "@/components/common/Card";
import StatusBadge from "@/components/common/StatusBadge";
import ErrorState from "@/components/common/ErrorState";
import { SkeletonList } from "@/components/common/Skeleton";
import { useAuth } from "@/context/AuthContext";
import { householdsApi } from "@/services/api/householdsApi";
import {
  fetchBhwHouseholds,
  householdRiskLevel,
  summarizeHouseholdConcerns,
} from "../lib/bhwDashboardData";
import { ChevronRight, Plus, Users } from "lucide-react";

function formatDate(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString();
}

export default function BHWDashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [households, setHouseholds] = useState([]);
  const [monitoring, setMonitoring] = useState(null);
  const [monitoringError, setMonitoringError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const requestId = useRef(0);
  const firstName = (user?.name || "").trim().split(" ")[0];
  const assignedBarangay = user?.assignedBarangay || user?.barangay;

  const loadHouseholds = useCallback(async () => {
    const currentRequest = ++requestId.current;
    setLoading(true);
    setError(null);
    try {
      const [rows, summary] = await Promise.all([
        fetchBhwHouseholds((params) => householdsApi.list(params)),
        householdsApi.monitoringSummary().catch((summaryError) => {
          setMonitoringError(summaryError?.message || "Unable to load visit monitoring.");
          return null;
        }),
      ]);
      if (currentRequest === requestId.current) {
        setHouseholds(rows);
        setMonitoring(summary);
        if (summary) setMonitoringError(null);
      }
    } catch (loadError) {
      if (currentRequest === requestId.current) {
        setError(loadError?.message || "Unable to load household data. Please try again.");
      }
    } finally {
      if (currentRequest === requestId.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadHouseholds();
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void loadHouseholds();
    };
    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      requestId.current += 1;
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [loadHouseholds]);

  const concernSummary = summarizeHouseholdConcerns(households);
  const highRiskCount = households.filter((household) => householdRiskLevel(household) === "High").length;
  const recentActivity = useMemo(() => (monitoring?.zones || [])
    .flatMap((zone) => (zone.households || []).map((household) => ({ ...household, purok: zone.purok })))
    .filter((household) => household.latestVisitDate)
    .sort((a, b) => String(b.latestVisitDate).localeCompare(String(a.latestVisitDate)))
    .slice(0, 5), [monitoring]);

  return (
    <>
      <PageHeader
        crumbs={["Dashboard"]}
        title={`Good morning, ${firstName || "BHW"}`}
        subtitle={assignedBarangay ? `Here's what needs your attention today in ${assignedBarangay}.` : "Here's what needs your attention today."}
      />
      <KpiHorizontal count={4} className="mb-6">
         <KpiHorizontal.Item label="HOUSEHOLDS IN BARANGAY" value={loading ? "…" : monitoring?.totalHouseholds ?? households.length} tone="blue" description="Total registered" />
         <KpiHorizontal.Item label="HOUSEHOLDS WITH VISIT" value={loading ? "…" : monitoring?.visitedHouseholds ?? "—"} tone="green" description="Recorded visit activity" />
         <KpiHorizontal.Item label="HOUSEHOLDS WITHOUT VISIT" value={loading ? "…" : monitoring?.householdsWithoutVisits ?? "—"} tone="amber" description="Pending visit" />
         <KpiHorizontal.Item label="HIGH-RISK HOUSEHOLDS" value={loading ? "…" : highRiskCount} tone="red" description="Risk assessment level" />
       </KpiHorizontal>

      <div className="mb-5 flex flex-wrap gap-2">
        <Link to="/app/bhw/households/new" className="inline-flex items-center gap-2 rounded-btn bg-brand-blue px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-dark"><Plus className="h-4 w-4" /> Add Household</Link>
        <Link to="/app/bhw/households" className="inline-flex items-center gap-2 rounded-btn border border-brand-border bg-white px-4 py-2.5 text-sm font-medium text-brand-ink hover:bg-brand-bg"><Users className="h-4 w-4" /> Household List</Link>
      </div>

      <div className="mb-5 grid grid-cols-1 gap-4 sm:gap-5 xl:grid-cols-2">
        <Card className="p-4 sm:p-6">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div><h3 className="text-sm font-semibold text-brand-ink sm:text-base">Household Activity by Purok / Zone</h3><p className="mt-1 text-xs text-brand-gray">See how many household profiles are in each area and the latest recorded activity.</p></div>
            <Link to="/app/bhw/households" className="flex shrink-0 items-center gap-1 text-sm font-medium text-brand-blue hover:underline">Details <ChevronRight className="h-4 w-4" /></Link>
          </div>
          {loading && !monitoring ? <SkeletonList rows={3} /> : monitoringError && !monitoring ? <p className="py-5 text-sm text-brand-danger">{monitoringError}</p> : !monitoring?.zones?.length ? <p className="py-5 text-center text-sm text-brand-gray">No Purok/Zone household data yet.</p> : (
            <div className="space-y-4">
              {monitoring.zones.map((zone) => {
                const latest = [...(zone.households || [])]
                  .filter((household) => household.latestVisitDate)
                  .sort((a, b) => String(b.latestVisitDate).localeCompare(String(a.latestVisitDate)))
                  .slice(0, 2);
                return <div key={zone.purok} className="rounded-lg border border-brand-border px-3.5 py-3">
                  <div className="flex items-center justify-between gap-3"><span className="font-medium text-brand-ink">{zone.purok}</span><span className="text-xs text-brand-gray">{zone.total} {zone.total === 1 ? "household" : "households"}</span></div>
                  {latest.length ? <div className="mt-2 space-y-1.5">
                    {latest.map((household) => <Link key={household.id} to={`/app/bhw/households/${household.id}`} className="flex items-center justify-between gap-3 text-xs hover:text-brand-blue"><span className="truncate text-brand-gray">{household.headName || `Household ${household.id}`} · {Number(household.latestVisitNumber) === 1 ? "Initial profile" : `Visit ${household.latestVisitNumber}`}</span><span className="shrink-0 text-brand-gray">{formatDate(household.latestVisitDate)}</span></Link>)}
                  </div> : <p className="mt-2 text-xs text-brand-gray">No visit date recorded yet.</p>}
                </div>;
              })}
            </div>
          )}
        </Card>

        <Card className="p-4 sm:p-6">
          <div className="mb-4 flex items-center justify-between gap-3"><h3 className="text-sm font-semibold text-brand-ink sm:text-base">Recent Household Activity</h3><Link to="/app/bhw/households" className="flex shrink-0 items-center gap-1 text-sm font-medium text-brand-blue hover:underline">View all <ChevronRight className="h-4 w-4" /></Link></div>
          {loading && !monitoring ? <SkeletonList rows={3} /> : recentActivity.length === 0 ? <p className="py-5 text-center text-sm text-brand-gray">No household visits recorded yet.</p> : (
            <div className="divide-y divide-brand-border">
              {recentActivity.map((activity) => <Link key={activity.id} to={`/app/bhw/households/${activity.id}`} className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0 hover:bg-brand-bg/40">
                <span className="min-w-0"><span className="block truncate text-sm font-medium text-brand-ink">{activity.headName || `Household ${activity.id}`}</span><span className="mt-0.5 block text-xs text-brand-gray">{activity.purok} · {Number(activity.latestVisitNumber) === 1 ? "Initial profile" : `Visit ${activity.latestVisitNumber}`}</span></span>
                <span className="shrink-0 text-xs text-brand-gray">{formatDate(activity.latestVisitDate)} <ChevronRight className="ml-1 inline h-3.5 w-3.5" /></span>
              </Link>)}
            </div>
          )}
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-5">
        <Card className="p-4 sm:p-6">
          <div className="flex items-center justify-between gap-3 mb-4">
            <h3 className="font-semibold text-brand-ink text-sm sm:text-base">Recent Household Profiles</h3>
            <Link to="/app/bhw/households" className="flex items-center gap-1 text-sm font-medium text-brand-blue hover:underline shrink-0">
              View All <ChevronRight className="w-4 h-4" />
            </Link>
          </div>
          {loading ? (
            <SkeletonList rows={3} />
          ) : error ? (
            <ErrorState
              title="Could not load household profiles"
              message={error}
              onRetry={() => void loadHouseholds()}
              className="py-6"
            />
          ) : households.length === 0 ? (
            <p className="text-sm text-brand-gray py-6 text-center">No household profiles yet.</p>
          ) : (
            <div className="space-y-3">
              {[...households].sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || ""))).slice(0, 4).map((household) => {
                const address = household.address ||
                  [household.streetAddress, household.purok || household.zone].filter(Boolean).join(", ");
                const registered = formatDate(household.createdAt);
                return (
                  <Link key={household.id} to={`/app/bhw/households/${household.id}`} className="flex flex-col sm:flex-row sm:items-center sm:justify-between border border-brand-border rounded-btn px-4 py-3 gap-2 hover:bg-brand-bg/50">
                    <div className="min-w-0">
                      <p className="font-medium text-brand-ink text-sm">
                        {household.headName || `Household ${household.id}`}
                      </p>
                      <p className="text-xs text-brand-gray">
                        {[address, registered && `Registered ${registered}`].filter(Boolean).join(" · ") || household.id}
                      </p>
                    </div>
                    <StatusBadge value={householdRiskLevel(household)} />
                  </Link>
                );
              })}
            </div>
          )}
        </Card>
        <Card className="p-4 sm:p-6">
          <h3 className="font-semibold text-brand-ink text-sm sm:text-base mb-4">Household Health Concerns</h3>
          {loading ? (
            <SkeletonList rows={3} />
          ) : error ? (
            <ErrorState
              title="Could not load household concerns"
              message={error}
              onRetry={() => void loadHouseholds()}
              className="py-6"
            />
          ) : concernSummary.length === 0 ? (
            <p className="text-sm text-brand-gray py-6 text-center">No household concerns recorded yet.</p>
          ) : (
            <div className="space-y-3">
              {concernSummary.map(({ concern, count, riskLevel }) => (
                <div key={concern} className="flex flex-col sm:flex-row sm:items-center sm:justify-between border border-brand-border rounded-btn px-4 py-3 gap-2">
                  <div>
                    <p className="font-medium text-brand-ink text-sm">{concern}</p>
                    <p className="text-xs text-brand-gray">Recorded as a household risk factor</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-xs bg-brand-light text-brand-blue px-2.5 py-1 rounded-full">
                      {count} {count === 1 ? "household" : "households"}
                    </span>
                    <StatusBadge value={riskLevel} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
