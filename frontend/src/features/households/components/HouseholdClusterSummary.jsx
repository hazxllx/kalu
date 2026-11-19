import React, { useCallback, useEffect, useState } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Card } from "@/components/common/Card";
import { householdRiskApi } from "@/services/api/householdRiskApi";
import { RISK_LEVELS, RISK_LEVEL_LABELS } from "@/lib/householdRisk";

const levels = [
  RISK_LEVELS.PRIORITY,
  RISK_LEVELS.INTERVENTION,
  RISK_LEVELS.MONITOR,
  RISK_LEVELS.STABLE,
  RISK_LEVELS.UNASSESSED,
];
const tones = {
  [RISK_LEVELS.PRIORITY]: "bg-rose-500",
  [RISK_LEVELS.INTERVENTION]: "bg-orange-500",
  [RISK_LEVELS.MONITOR]: "bg-amber-500",
  [RISK_LEVELS.STABLE]: "bg-emerald-500",
  [RISK_LEVELS.UNASSESSED]: "bg-slate-400",
};

export default function HouseholdClusterSummary() {
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setSummary(await householdRiskApi.getClusterSummary());
    } catch (failure) {
      setSummary(null);
      setError(failure?.payload?.error?.code === "HOUSEHOLD_CLUSTER_SCHEMA_REQUIRED"
        ? "Household cluster storage is unavailable. Apply the household cluster assignment migration and reload the API schema."
        : failure?.message || "Household cluster distribution is unavailable.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return (
    <Card className="mb-6 p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-brand-ink dark:text-foreground">Community Household Clusters</h2>
          <p className="mt-1 text-xs text-brand-gray dark:text-muted-foreground">
            Current persisted cluster assignments across {loading ? "…" : error ? "unavailable" : `${summary?.totalHouseholds ?? 0} households`} in your scope.
          </p>
        </div>
        {error && (
          <button onClick={load} className="inline-flex items-center gap-1.5 text-xs font-medium text-brand-blue hover:underline">
            <RefreshCw className="h-3.5 w-3.5" /> Retry
          </button>
        )}
      </div>

      {error ? (
        <div role="alert" className="mt-4 flex items-center gap-2 text-sm text-brand-danger">
          <AlertTriangle className="h-4 w-4 shrink-0" /> {error}
        </div>
      ) : loading ? (
        <div className="mt-5 h-24 animate-pulse rounded-xl bg-brand-bg dark:bg-card-nested" />
      ) : (
        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {levels.map((level) => {
            const row = summary?.riskDistribution?.find((item) => item.name === level);
            const count = row.value;
            const percent = summary?.totalHouseholds ? Math.round((count / summary.totalHouseholds) * 100) : 0;
            return (
              <div key={level} className="rounded-xl border border-brand-border p-3 dark:border-border">
                <div className="flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-2 text-sm font-medium text-brand-ink dark:text-foreground">
                    <span className={`h-2 w-2 rounded-full ${tones[level]}`} /> {RISK_LEVEL_LABELS[level]}
                  </span>
                  <span className="text-sm font-semibold text-brand-ink dark:text-foreground">{count}</span>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-brand-bg dark:bg-card-nested">
                  <div className={`h-full ${tones[level]}`} style={{ width: `${percent}%` }} />
                </div>
                <p className="mt-1 text-right text-[11px] text-brand-gray dark:text-muted-foreground">{percent}%</p>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
