import React, { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import PageHeader from "@/components/common/PageHeader";
import StatCard from "@/components/common/StatCard";
import { Card } from "@/components/common/Card";
import StatusBadge from "@/components/common/StatusBadge";
import ErrorState from "@/components/common/ErrorState";
import { SkeletonList } from "@/components/common/Skeleton";
import { useAuth } from "@/context/AuthContext";
import { householdsApi } from "@/services/api/householdsApi";
import { bhwDashboard } from "@/services/local/dashboardData";
import {
  fetchBhwHouseholds,
  householdRiskLevel,
  summarizeHouseholdConcerns,
} from "../lib/bhwDashboardData";
import { ChevronRight } from "lucide-react";

function formatDate(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString();
}

export default function BHWDashboard() {
  const { user } = useAuth();
  const [households, setHouseholds] = useState([]);
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
      const rows = await fetchBhwHouseholds((params) => householdsApi.list(params));
      if (currentRequest === requestId.current) setHouseholds(rows);
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

  return (
    <>
      <PageHeader
        crumbs={["Dashboard"]}
        title={`Good morning, ${firstName || "BHW"}`}
        subtitle={assignedBarangay ? `Here's what needs your attention today in ${assignedBarangay}.` : "Here's what needs your attention today."}
      />
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-3 sm:gap-4 mb-6">
        {bhwDashboard.map((s, i) => <StatCard key={s.label} {...s} index={i} />)}
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
              {households.slice(0, 4).map((household) => {
                const address = household.address ||
                  [household.streetAddress, household.purok || household.zone].filter(Boolean).join(", ");
                const registered = formatDate(household.createdAt);
                return (
                  <div key={household.id} className="flex flex-col sm:flex-row sm:items-center sm:justify-between border border-brand-border rounded-btn px-4 py-3 gap-2">
                    <div>
                      <p className="font-medium text-brand-ink text-sm">
                        {household.headName || `Household ${household.id}`}
                      </p>
                      <p className="text-xs text-brand-gray">
                        {[address, registered && `Registered ${registered}`].filter(Boolean).join(" · ") || household.id}
                      </p>
                    </div>
                    <StatusBadge value={householdRiskLevel(household)} />
                  </div>
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
