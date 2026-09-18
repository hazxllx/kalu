import React, { useEffect, useState } from "react";
import PageHeader from "@/components/common/PageHeader";
import { Card } from "@/components/common/Card";
import {
  getRiskConfig,
  saveRiskConfig,
  resetRiskConfig,
  DEFAULT_RISK_CONFIG,
} from "@/lib/householdRisk";
import { householdRiskStore } from "@/services/local/householdRiskStore";
import { Check, RotateCcw, Save } from "lucide-react";

export default function RiskRuleConfig() {
  const [config, setConfig] = useState(() => getRiskConfig());
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setConfig(getRiskConfig());
  }, []);

  const setIndicatorWeight = (key, weight) =>
    setConfig((c) => ({
      ...c,
      indicators: c.indicators.map((i) => (i.key === key ? { ...i, weight: Number(weight) || 0 } : i)),
    }));

  const setThreshold = (key, value) =>
    setConfig((c) => ({ ...c, thresholds: { ...c.thresholds, [key]: Number(value) || 0 } }));

  const setIndicatorEscalation = (key, escalation) =>
    setConfig((c) => ({
      ...c,
      indicators: c.indicators.map((i) => (i.key === key ? { ...i, escalation } : i)),
    }));

  const handleSave = () => {
    saveRiskConfig(config);
    householdRiskStore.refresh();
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleReset = () => {
    setConfig(resetRiskConfig());
    householdRiskStore.refresh();
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <>
      <PageHeader
        crumbs={["Admin", "Early Intervention Rules"]}
        title="Early Intervention Rules"
        subtitle="Configure household risk indicators, weights, thresholds, and escalation conditions."
        action={
          <div className="flex items-center gap-2">
            <button
              onClick={handleReset}
              className="inline-flex items-center gap-2 border border-brand-border bg-white px-4 py-2.5 rounded-btn text-sm font-medium text-brand-gray hover:bg-brand-bg"
            >
              <RotateCcw className="w-4 h-4" /> Reset
            </button>
            <button
              onClick={handleSave}
              className="inline-flex items-center gap-2 bg-brand-blue px-4 py-2.5 rounded-btn text-sm font-medium text-white hover:bg-brand-dark"
            >
              {saved ? <Check className="w-4 h-4" /> : <Save className="w-4 h-4" />} {saved ? "Saved" : "Save Rules"}
            </button>
          </div>
        }
      />

      <div className="space-y-5">
        {/* Thresholds */}
        <Card className="p-5">
          <h3 className="font-semibold text-brand-ink text-sm sm:text-base mb-1">Risk Thresholds</h3>
          <p className="text-xs text-brand-gray mb-4">
            Score thresholds map the clustered indicator weight total to a risk level.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-2xl">
            {[
              { key: "monitorScore", label: "Monitor (score ≥)" },
              { key: "interventionScore", label: "Needs Intervention (score ≥)" },
              { key: "priorityScore", label: "Priority Review (score ≥)" },
            ].map((t) => (
              <div key={t.key}>
                <label className="text-sm font-medium text-brand-ink">{t.label}</label>
                <input
                  type="number"
                  value={config.thresholds[t.key] ?? DEFAULT_RISK_CONFIG.thresholds[t.key]}
                  onChange={(e) => setThreshold(t.key, e.target.value)}
                  className="mt-1.5 w-full rounded-btn border border-slate-200 bg-white px-3.5 py-2.5 text-sm outline-none focus:border-brand-blue"
                />
              </div>
            ))}
          </div>
          <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-2xl">
            <div>
              <label className="text-sm font-medium text-brand-ink">Priority indicator count</label>
              <input
                type="number"
                value={config.thresholds.priorityCount ?? DEFAULT_RISK_CONFIG.thresholds.priorityCount}
                onChange={(e) => setThreshold("priorityCount", e.target.value)}
                className="mt-1.5 w-full rounded-btn border border-slate-200 bg-white px-3.5 py-2.5 text-sm outline-none focus:border-brand-blue"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-brand-ink">Follow-up timeframe (days)</label>
              <input
                type="number"
                value={config.followUpTimeframeDays ?? DEFAULT_RISK_CONFIG.followUpTimeframeDays}
                onChange={(e) => setConfig((c) => ({ ...c, followUpTimeframeDays: Number(e.target.value) || 14 }))}
                className="mt-1.5 w-full rounded-btn border border-slate-200 bg-white px-3.5 py-2.5 text-sm outline-none focus:border-brand-blue"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-brand-ink">Escalate after follow-ups</label>
              <input
                type="number"
                value={config.escalationAfterFollowUps ?? DEFAULT_RISK_CONFIG.escalationAfterFollowUps}
                onChange={(e) => setConfig((c) => ({ ...c, escalationAfterFollowUps: Number(e.target.value) || 3 }))}
                className="mt-1.5 w-full rounded-btn border border-slate-200 bg-white px-3.5 py-2.5 text-sm outline-none focus:border-brand-blue"
              />
            </div>
          </div>
        </Card>

        {/* Indicator weights */}
        <Card className="p-5">
          <h3 className="font-semibold text-brand-ink text-sm sm:text-base mb-1">Risk Indicators</h3>
          <p className="text-xs text-brand-gray mb-4">
            Configure the weight of each indicator. Marking an indicator as "Escalation" promotes a
            household to Priority Review when the priority indicator count threshold is met.
          </p>
          <div className="overflow-x-auto rounded-btn border border-slate-200">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-brand-bg text-left">
                  <th className="px-4 py-2.5 font-medium text-brand-gray">Indicator</th>
                  <th className="px-4 py-2.5 font-medium text-brand-gray w-28">Weight</th>
                  <th className="px-4 py-2.5 font-medium text-brand-gray w-32">Escalation</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {config.indicators.map((ind) => (
                  <tr key={ind.key}>
                    <td className="px-4 py-2.5 text-brand-ink">{ind.label}</td>
                    <td className="px-4 py-2.5">
                      <input
                        type="number"
                        min="0"
                        value={ind.weight}
                        onChange={(e) => setIndicatorWeight(ind.key, e.target.value)}
                        className="w-20 rounded-btn border border-slate-200 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-brand-blue"
                      />
                    </td>
                    <td className="px-4 py-2.5">
                      <label className="flex items-center gap-2 text-sm text-brand-ink">
                        <input
                          type="checkbox"
                          checked={Boolean(ind.escalation)}
                          onChange={(e) => setIndicatorEscalation(ind.key, e.target.checked)}
                          className="h-4 w-4 accent-brand-blue"
                        />
                        Escalation
                      </label>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </>
  );
}
