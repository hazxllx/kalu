import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Plus,
  X,
  RefreshCw,
  Pencil,
  Trash2,
  ShieldAlert,
  Check,
  RotateCcw,
  Save,
  Search,
} from "lucide-react";
import PageHeader from "@/components/common/PageHeader";
import { Card } from "@/components/common/Card";
import ErrorState from "@/components/common/ErrorState";
import RiskBadge from "@/components/common/RiskBadge";
import { riskConfigApi } from "@/services/api";
import {
  getRiskConfig,
  saveRiskConfig,
  resetRiskConfig,
  DEFAULT_RISK_CONFIG,
} from "@/lib/householdRisk";
import { householdRiskStore } from "@/services/local/householdRiskStore";

/**
 * Risk & Intervention Settings — unified admin page.
 *
 * This page merges the former "Risk Assessment" and "Early Intervention Rules"
 * pages into one interface, while deliberately keeping the two underlying
 * scoring systems and persistence layers separate:
 *
 *  - Resident Risk (Sections A & B): server-authoritative config stored in
 *    Supabase via `riskConfigApi`. Scores are a weighted sum of recorded vitals
 *    classified as Low / Moderate / High (default cutoffs 40 / 70). Saving
 *    recomputes every resident on the backend.
 *
 *  - Early Intervention (Sections C & D): household indicator rules stored
 *    locally (session) via `@/lib/householdRisk`. Scores are a sum of indicator
 *    weights classified as Stable / Monitor / Intervention / Priority (default
 *    cutoffs 2 / 5 / 8). These numbers are NOT on the same scale as resident
 *    risk scores and are never combined with them.
 *
 * Each section owns its own Save/Reset action so administrators never have to
 * save an unrelated section.
 */

// ----- Resident risk criteria option sets (Sections A & B) -----
const FIELD_OPTIONS = [
  { value: "systolic", label: "Systolic blood pressure (mmHg)" },
  { value: "diastolic", label: "Diastolic blood pressure (mmHg)" },
  { value: "o2sat", label: "Oxygen saturation / SpO2 (%)" },
  { value: "temperature", label: "Temperature (°C)" },
  { value: "pulse", label: "Pulse rate (bpm)" },
  { value: "respiratory", label: "Respiratory rate (/min)" },
  { value: "bmi", label: "Body mass index (kg/m²)" },
];

const OPERATOR_OPTIONS = [
  { value: "gte", label: "≥ (at least)" },
  { value: "gt", label: "> (greater than)" },
  { value: "lte", label: "≤ (at most)" },
  { value: "lt", label: "< (less than)" },
  { value: "eq", label: "= (equals)" },
  { value: "between", label: "between (inclusive)" },
];

const EMPTY_CRITERION = {
  code: "",
  name: "",
  description: "",
  field: "systolic",
  operator: "gte",
  value: "",
  value2: "",
  weight: "",
  enabled: true,
  priority: 100,
};

const inputClass =
  "mt-1 w-full bg-white border border-brand-border rounded-input px-3 py-2 text-sm outline-none focus:border-brand-blue";
const labelClass = "text-sm font-medium text-brand-ink";
const ruleInputClass =
  "mt-1 h-9 w-full rounded-btn border border-slate-200 bg-white px-3 text-sm outline-none focus:border-brand-blue";

const operatorLabel = (op) =>
  OPERATOR_OPTIONS.find((o) => o.value === op)?.label || op;
const fieldLabel = (f) =>
  FIELD_OPTIONS.find((o) => o.value === f)?.label || f;

const describeCondition = (c) =>
  c.operator === "between"
    ? `${fieldLabel(c.field)} ${c.value}–${c.value2}`
    : `${fieldLabel(c.field)} ${operatorLabel(c.operator).split(" ")[0]} ${c.value}`;

export default function RiskInterventionSettings() {
  // ----- Resident risk (backend) state -----
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [toast, setToast] = useState(null);
  const [busy, setBusy] = useState(false);

  const [thresholds, setThresholds] = useState({ moderateMin: 40, highMin: 70 });
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null); // existing code or null for new
  const [form, setForm] = useState(EMPTY_CRITERION);
  const [formError, setFormError] = useState(null);

  // ----- Early intervention (local) state -----
  const [rules, setRules] = useState(() => getRiskConfig());
  const [rulesSaved, setRulesSaved] = useState(false);
  const [indicatorSearch, setIndicatorSearch] = useState("");

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3200);
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await riskConfigApi.get();
      setConfig(data);
      setThresholds({
        moderateMin: data?.thresholds?.moderateMin ?? 40,
        highMin: data?.thresholds?.highMin ?? 70,
      });
    } catch (err) {
      setError(err?.message || "Could not load the risk configuration.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    setRules(getRiskConfig());
  }, []);

  const criteria = useMemo(
    () =>
      [...(config?.criteria || [])].sort(
        (a, b) => (a.priority ?? 0) - (b.priority ?? 0),
      ),
    [config],
  );

  // ---------- Section A: thresholds ----------
  const saveThresholds = async () => {
    const mod = Number(thresholds.moderateMin);
    const high = Number(thresholds.highMin);
    // Validate to prevent invalid or overlapping classifications. The backend
    // and DB also enforce high > moderate; we surface it client-side first.
    if (!Number.isFinite(mod) || !Number.isFinite(high)) {
      showToast("Thresholds must be numbers.");
      return;
    }
    if (mod < 1) {
      showToast("The moderate threshold must be at least 1.");
      return;
    }
    if (high <= mod) {
      showToast("The high threshold must be greater than the moderate threshold.");
      return;
    }
    setBusy(true);
    try {
      await riskConfigApi.updateThresholds({ moderateMin: mod, highMin: high });
      showToast("Risk thresholds updated. Residents were recalculated.");
      await load();
    } catch (err) {
      showToast(err?.message || "Could not update thresholds.");
    } finally {
      setBusy(false);
    }
  };

  // ---------- Section B: criteria CRUD ----------
  const openNew = () => {
    setEditing(null);
    setForm(EMPTY_CRITERION);
    setFormError(null);
    setShowModal(true);
  };

  const openEdit = (c) => {
    setEditing(c.code);
    setForm({
      ...EMPTY_CRITERION,
      ...c,
      value: c.value ?? "",
      value2: c.value2 ?? "",
      weight: c.weight ?? "",
    });
    setFormError(null);
    setShowModal(true);
  };

  const saveCriterion = async () => {
    setFormError(null);
    if (!form.name.trim() || (!editing && !form.code.trim())) {
      setFormError("A code and name are required.");
      return;
    }
    setBusy(true);
    try {
      await riskConfigApi.saveCriterion({
        ...form,
        code: (editing || form.code).trim(),
        exists: Boolean(editing),
        value: Number(form.value),
        value2: form.operator === "between" ? Number(form.value2) : null,
        weight: Number(form.weight),
        priority: Number(form.priority) || 100,
        enabled: Boolean(form.enabled),
      });
      setShowModal(false);
      showToast("Criterion saved. Residents were recalculated.");
      await load();
    } catch (err) {
      if (err?.status === 422 && Array.isArray(err?.payload?.error?.details)) {
        setFormError(err.payload.error.details.join(" "));
      } else {
        setFormError(err?.message || "Could not save the criterion.");
      }
    } finally {
      setBusy(false);
    }
  };

  const toggleCriterion = async (c) => {
    setBusy(true);
    try {
      await riskConfigApi.saveCriterion({ ...c, exists: true, enabled: !c.enabled });
      await load();
    } catch (err) {
      showToast(err?.message || "Could not update the criterion.");
    } finally {
      setBusy(false);
    }
  };

  const removeCriterion = async (c) => {
    setBusy(true);
    try {
      await riskConfigApi.deleteCriterion(c.code);
      showToast("Criterion removed. Residents were recalculated.");
      await load();
    } catch (err) {
      showToast(err?.message || "Could not remove the criterion.");
    } finally {
      setBusy(false);
    }
  };

  const recalculate = async () => {
    setBusy(true);
    try {
      const res = await riskConfigApi.recalculate();
      showToast(
        `Recalculated ${res?.updated ?? 0} resident record${
          (res?.updated ?? 0) === 1 ? "" : "s"
        }.`,
      );
    } catch (err) {
      showToast(err?.message || "Could not recalculate.");
    } finally {
      setBusy(false);
    }
  };

  // ---------- Sections C & D: early intervention rules ----------
  const setIndicatorWeight = (key, weight) =>
    setRules((c) => ({
      ...c,
      indicators: c.indicators.map((i) =>
        i.key === key ? { ...i, weight: Number(weight) || 0 } : i,
      ),
    }));

  const setRuleThreshold = (key, value) =>
    setRules((c) => ({
      ...c,
      thresholds: { ...c.thresholds, [key]: Number(value) || 0 },
    }));

  const setIndicatorEscalation = (key, escalation) =>
    setRules((c) => ({
      ...c,
      indicators: c.indicators.map((i) =>
        i.key === key ? { ...i, escalation } : i,
      ),
    }));

  const handleSaveRules = () => {
    // Preserve entered values on failure: validate before persisting and only
    // commit when the household-score thresholds are a valid ascending order.
    const t = rules.thresholds || {};
    const monitor = Number(t.monitorScore);
    const intervention = Number(t.interventionScore);
    const priority = Number(t.priorityScore);
    if (![monitor, intervention, priority].every(Number.isFinite)) {
      showToast("Thresholds must be numbers.");
      return;
    }
    if (monitor < 1) {
      showToast("The Monitor threshold must be at least 1.");
      return;
    }
    if (!(monitor < intervention && intervention < priority)) {
      showToast(
        "Thresholds must increase: Monitor < Needs Intervention < Priority Review.",
      );
      return;
    }
    saveRiskConfig(rules);
    householdRiskStore.refresh();
    setRulesSaved(true);
    showToast("Early intervention rules saved.");
    setTimeout(() => setRulesSaved(false), 2000);
  };

  const handleResetRules = () => {
    setRules(resetRiskConfig());
    householdRiskStore.refresh();
    setRulesSaved(true);
    setTimeout(() => setRulesSaved(false), 2000);
  };

  const mod = Number(thresholds.moderateMin);
  const high = Number(thresholds.highMin);

  const residentRiskReady = !loading && !error;

  // Early-intervention indicator search (view-only filter; never mutates config).
  const totalIndicators = rules.indicators.length;
  const indicatorQuery = indicatorSearch.trim().toLowerCase();
  const visibleIndicators = indicatorQuery
    ? rules.indicators.filter((i) =>
        i.label.toLowerCase().includes(indicatorQuery),
      )
    : rules.indicators;

  return (
    <>
      <PageHeader
        crumbs={["Admin", "Risk & Intervention Settings"]}
        title="Risk & Intervention Settings"
        subtitle="Configure resident risk classification, early intervention rules, and follow-up policies in one place."
      />

      <div className="space-y-5">
        {/* ============ Section A: Risk Classification ============ */}
        <Card className="p-6">
          <div className="flex flex-wrap items-start justify-between gap-3 mb-1">
            <div>
              <h3 className="font-semibold text-brand-ink">
                Section A · Risk Classification
              </h3>
              <p className="mt-1 text-xs text-brand-gray">
                A resident&apos;s total risk score (a weighted sum of recorded
                vitals) is classified against these cutoffs. Ranges below are
                derived from the thresholds you set.
              </p>
            </div>
            <button
              onClick={recalculate}
              disabled={busy || !residentRiskReady}
              className="flex items-center gap-2 rounded-btn border border-brand-border bg-white px-4 py-2.5 text-sm font-medium text-brand-ink hover:bg-brand-bg disabled:opacity-60"
            >
              <RefreshCw className="w-4 h-4" /> Recalculate residents
            </button>
          </div>

          {loading ? (
            <div className="mt-4 h-40 animate-pulse rounded-lg bg-slate-100" />
          ) : error ? (
            <div className="mt-4">
              <ErrorState
                title="Unable to load risk settings"
                message={error}
                onRetry={load}
              />
            </div>
          ) : (
            <>
              <div className="mt-4 grid gap-4 sm:grid-cols-3">
                <div className="rounded-lg border border-brand-border bg-brand-light/30 p-4">
                  <div className="flex items-center justify-between">
                    <RiskBadge level="Low" />
                    <span className="text-sm font-stat font-bold text-brand-ink">
                      0–{Math.max(mod - 1, 0)}
                    </span>
                  </div>
                </div>
                <div className="rounded-lg border border-brand-border bg-brand-light/30 p-4">
                  <div className="flex items-center justify-between">
                    <RiskBadge level="Moderate" />
                    <span className="text-sm font-stat font-bold text-brand-ink">
                      {mod}–{Math.max(high - 1, mod)}
                    </span>
                  </div>
                </div>
                <div className="rounded-lg border border-brand-border bg-brand-light/30 p-4">
                  <div className="flex items-center justify-between">
                    <RiskBadge level="High" />
                    <span className="text-sm font-stat font-bold text-brand-ink">
                      {high}+
                    </span>
                  </div>
                </div>
              </div>
              <div className="mt-4 grid gap-4 sm:grid-cols-2 max-w-lg">
                <div>
                  <label className={labelClass}>Moderate starts at</label>
                  <input
                    type="number"
                    min={1}
                    value={thresholds.moderateMin}
                    onChange={(e) =>
                      setThresholds((p) => ({
                        ...p,
                        moderateMin: Number(e.target.value),
                      }))
                    }
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>High starts at</label>
                  <input
                    type="number"
                    min={1}
                    value={thresholds.highMin}
                    onChange={(e) =>
                      setThresholds((p) => ({
                        ...p,
                        highMin: Number(e.target.value),
                      }))
                    }
                    className={inputClass}
                  />
                </div>
              </div>
              <div className="mt-4">
                <button
                  onClick={saveThresholds}
                  disabled={busy}
                  className="rounded-btn bg-brand-blue px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-60"
                >
                  Save thresholds
                </button>
              </div>
            </>
          )}
        </Card>

        {/* ============ Section B: Risk Criteria ============ */}
        <Card className="p-6">
          <div className="flex items-center justify-between mb-1">
            <h3 className="font-semibold text-brand-ink">
              Section B · Risk Criteria
            </h3>
            <button
              onClick={openNew}
              disabled={!residentRiskReady}
              className="flex items-center gap-2 rounded-btn bg-brand-blue px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-60"
            >
              <Plus className="w-4 h-4" /> Add Criterion
            </button>
          </div>
          <p className="text-xs text-brand-gray mb-4">
            Each criterion adds its score when a resident&apos;s recorded health
            data satisfies the condition. Changes are saved to the backend and
            recompute every resident&apos;s risk.
          </p>

          {loading ? (
            <div className="h-40 animate-pulse rounded-lg bg-slate-100" />
          ) : error ? (
            <p className="text-sm text-brand-gray">
              Risk criteria are unavailable until the configuration loads.
            </p>
          ) : (
            <>
              <div className="overflow-x-auto rounded-lg border border-brand-border">
                <table className="w-full text-sm">
                  <thead className="bg-brand-light/40 text-brand-gray">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">
                        Criterion
                      </th>
                      <th className="px-3 py-2 text-left font-medium">
                        Condition
                      </th>
                      <th className="px-3 py-2 text-right font-medium">Score</th>
                      <th className="px-3 py-2 text-left font-medium">Status</th>
                      <th className="px-3 py-2 text-right font-medium" />
                    </tr>
                  </thead>
                  <tbody>
                    {criteria.length === 0 && (
                      <tr>
                        <td className="px-3 py-4 text-brand-gray" colSpan={5}>
                          No criteria configured.
                        </td>
                      </tr>
                    )}
                    {criteria.map((c) => (
                      <tr key={c.code} className="border-t border-brand-border">
                        <td className="px-3 py-2">
                          <p className="font-medium text-brand-ink">{c.name}</p>
                          <p className="text-xs text-brand-gray">{c.code}</p>
                        </td>
                        <td className="px-3 py-2 text-brand-gray">
                          {describeCondition(c)}
                        </td>
                        <td className="px-3 py-2 text-right font-stat font-medium text-brand-ink">
                          +{c.weight}
                        </td>
                        <td className="px-3 py-2">
                          <button
                            onClick={() => toggleCriterion(c)}
                            disabled={busy}
                            className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                              c.enabled
                                ? "bg-emerald-50 text-emerald-700"
                                : "bg-slate-100 text-slate-500"
                            }`}
                          >
                            {c.enabled ? "Active" : "Inactive"}
                          </button>
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex items-center justify-end gap-3">
                            <button
                              onClick={() => openEdit(c)}
                              className="flex items-center gap-1 text-brand-blue text-sm font-medium hover:underline"
                            >
                              <Pencil className="w-4 h-4" /> Edit
                            </button>
                            <button
                              onClick={() => removeCriterion(c)}
                              className="flex items-center gap-1 text-brand-danger text-sm font-medium hover:underline"
                            >
                              <Trash2 className="w-4 h-4" /> Remove
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-3 flex items-center gap-1.5 text-xs text-brand-gray">
                <ShieldAlert className="w-3.5 h-3.5" /> A resident&apos;s risk
                level is never edited directly; it is always derived from
                recorded health data and these criteria.
              </p>
            </>
          )}
        </Card>

        {/* ============ Section C: Early Intervention Rules ============ */}
        <Card className="p-5">
          {/* 1. Section title + actions */}
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="font-semibold text-brand-ink">
                Early Intervention Rules
              </h3>
              <p className="mt-0.5 text-xs text-brand-gray">
                Set when households need monitoring, intervention, or priority
                review.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleResetRules}
                className="inline-flex items-center gap-1.5 rounded-btn border border-brand-border bg-white px-3 py-2 text-sm font-medium text-brand-gray hover:bg-brand-bg"
              >
                <RotateCcw className="w-4 h-4" /> Reset
              </button>
              <button
                onClick={handleSaveRules}
                className="inline-flex items-center gap-1.5 rounded-btn bg-brand-blue px-3 py-2 text-sm font-medium text-white hover:bg-brand-dark"
              >
                {rulesSaved ? (
                  <Check className="w-4 h-4" />
                ) : (
                  <Save className="w-4 h-4" />
                )}
                {rulesSaved ? "Saved" : "Save Rules"}
              </button>
            </div>
          </div>

          {/* 2. Compact response thresholds */}
          <div className="mt-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {[
                { key: "monitorScore", label: "Monitor" },
                { key: "interventionScore", label: "Needs Intervention" },
                { key: "priorityScore", label: "Priority Review" },
              ].map((t) => (
                <div key={t.key}>
                  <label className="block text-xs font-medium text-brand-ink">
                    {t.label}
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={
                      rules.thresholds[t.key] ??
                      DEFAULT_RISK_CONFIG.thresholds[t.key]
                    }
                    onChange={(e) => setRuleThreshold(t.key, e.target.value)}
                    className={ruleInputClass}
                  />
                </div>
              ))}
            </div>
            <p className="mt-1.5 text-[11px] text-brand-gray">
              Thresholds use the total household indicator score.
            </p>
          </div>

          {/* 3. Risk indicators table */}
          <div className="mt-5">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h4 className="text-sm font-medium text-brand-ink">
                Risk Indicators
                <span className="ml-2 text-xs font-normal text-brand-gray">
                  {indicatorQuery
                    ? `${visibleIndicators.length} of ${totalIndicators}`
                    : `${totalIndicators} total`}
                </span>
              </h4>
              {totalIndicators > 6 && (
                <div className="relative">
                  <Search
                    className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-brand-gray"
                    aria-hidden="true"
                  />
                  <input
                    type="search"
                    value={indicatorSearch}
                    onChange={(e) => setIndicatorSearch(e.target.value)}
                    placeholder="Search indicators"
                    aria-label="Search indicators"
                    className="h-9 w-full rounded-btn border border-slate-200 bg-white pl-8 pr-3 text-sm outline-none focus:border-brand-blue sm:w-56"
                  />
                </div>
              )}
            </div>
            <div className="overflow-hidden rounded-btn border border-slate-200">
              <div className="max-h-96 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 z-10">
                    <tr className="bg-brand-bg text-left text-xs text-brand-gray">
                      <th className="px-3 py-2 font-medium">Indicator</th>
                      <th className="w-20 px-3 py-2 text-center font-medium">
                        Weight
                      </th>
                      <th className="w-24 px-3 py-2 text-center font-medium">
                        Escalation
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {visibleIndicators.length === 0 && (
                      <tr>
                        <td
                          colSpan={3}
                          className="px-3 py-4 text-center text-xs text-brand-gray"
                        >
                          No indicators match &quot;{indicatorSearch}&quot;.
                        </td>
                      </tr>
                    )}
                    {visibleIndicators.map((ind) => (
                      <tr key={ind.key} className="hover:bg-brand-bg/40">
                        <td className="px-3 py-1.5 text-brand-ink">
                          {ind.label}
                        </td>
                        <td className="px-3 py-1.5 text-center">
                          <input
                            type="number"
                            min="0"
                            value={ind.weight}
                            onChange={(e) =>
                              setIndicatorWeight(ind.key, e.target.value)
                            }
                            aria-label={`Weight for ${ind.label}`}
                            className="h-8 w-16 rounded-btn border border-slate-200 bg-white px-2 text-center text-sm outline-none focus:border-brand-blue"
                          />
                        </td>
                        <td className="px-3 py-1.5 text-center">
                          <input
                            type="checkbox"
                            checked={Boolean(ind.escalation)}
                            onChange={(e) =>
                              setIndicatorEscalation(ind.key, e.target.checked)
                            }
                            aria-label={`Escalation for ${ind.label}`}
                            className="h-4 w-4 accent-brand-blue align-middle"
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* 4. Follow-up & escalation settings (belong to this section) */}
          <div className="mt-5 border-t border-slate-100 pt-4">
            <h4 className="mb-2 text-sm font-medium text-brand-ink">
              Follow-up &amp; Escalation
            </h4>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div>
                <label className="block text-xs font-medium text-brand-ink">
                  Priority indicator count
                </label>
                <input
                  type="number"
                  min="0"
                  value={
                    rules.thresholds.priorityCount ??
                    DEFAULT_RISK_CONFIG.thresholds.priorityCount
                  }
                  onChange={(e) =>
                    setRuleThreshold("priorityCount", e.target.value)
                  }
                  className={ruleInputClass}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-brand-ink">
                  Follow-up timeframe (days)
                </label>
                <input
                  type="number"
                  min="0"
                  value={
                    rules.followUpTimeframeDays ??
                    DEFAULT_RISK_CONFIG.followUpTimeframeDays
                  }
                  onChange={(e) =>
                    setRules((c) => ({
                      ...c,
                      followUpTimeframeDays: Number(e.target.value) || 14,
                    }))
                  }
                  className={ruleInputClass}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-brand-ink">
                  Escalate after follow-ups
                </label>
                <input
                  type="number"
                  min="0"
                  value={
                    rules.escalationAfterFollowUps ??
                    DEFAULT_RISK_CONFIG.escalationAfterFollowUps
                  }
                  onChange={(e) =>
                    setRules((c) => ({
                      ...c,
                      escalationAfterFollowUps: Number(e.target.value) || 3,
                    }))
                  }
                  className={ruleInputClass}
                />
              </div>
            </div>
          </div>
        </Card>
      </div>

      {/* Criterion modal (Section B) */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <Card className="w-full max-w-xl max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-brand-ink">
                  {editing ? "Edit Criterion" : "Add Criterion"}
                </h3>
                <button
                  onClick={() => setShowModal(false)}
                  className="text-brand-gray hover:text-brand-ink"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              {formError && (
                <div className="mb-4 rounded-btn border border-brand-danger/30 bg-brand-danger/5 px-3.5 py-3 text-sm text-brand-danger">
                  {formError}
                </div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className={labelClass}>Code</label>
                  <input
                    value={form.code}
                    disabled={Boolean(editing)}
                    onChange={(e) =>
                      setForm((p) => ({ ...p, code: e.target.value }))
                    }
                    placeholder="e.g. bp_systolic_high"
                    className={`${inputClass} ${
                      editing ? "bg-brand-bg text-brand-gray" : ""
                    }`}
                  />
                </div>
                <div>
                  <label className={labelClass}>Name</label>
                  <input
                    value={form.name}
                    onChange={(e) =>
                      setForm((p) => ({ ...p, name: e.target.value }))
                    }
                    className={inputClass}
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className={labelClass}>Description</label>
                  <input
                    value={form.description}
                    onChange={(e) =>
                      setForm((p) => ({ ...p, description: e.target.value }))
                    }
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>Health data field</label>
                  <select
                    value={form.field}
                    onChange={(e) =>
                      setForm((p) => ({ ...p, field: e.target.value }))
                    }
                    className={inputClass}
                  >
                    {FIELD_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={labelClass}>Operator</label>
                  <select
                    value={form.operator}
                    onChange={(e) =>
                      setForm((p) => ({ ...p, operator: e.target.value }))
                    }
                    className={inputClass}
                  >
                    {OPERATOR_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={labelClass}>Value</label>
                  <input
                    type="number"
                    value={form.value}
                    onChange={(e) =>
                      setForm((p) => ({ ...p, value: e.target.value }))
                    }
                    className={inputClass}
                  />
                </div>
                {form.operator === "between" && (
                  <div>
                    <label className={labelClass}>Upper value</label>
                    <input
                      type="number"
                      value={form.value2}
                      onChange={(e) =>
                        setForm((p) => ({ ...p, value2: e.target.value }))
                      }
                      className={inputClass}
                    />
                  </div>
                )}
                <div>
                  <label className={labelClass}>Score (weight)</label>
                  <input
                    type="number"
                    min={0}
                    value={form.weight}
                    onChange={(e) =>
                      setForm((p) => ({ ...p, weight: e.target.value }))
                    }
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>Priority</label>
                  <input
                    type="number"
                    value={form.priority}
                    onChange={(e) =>
                      setForm((p) => ({
                        ...p,
                        priority: Number(e.target.value) || 100,
                      }))
                    }
                    className={inputClass}
                  />
                </div>
                <div className="flex items-center gap-2 mt-6">
                  <input
                    id="enabled"
                    type="checkbox"
                    checked={form.enabled}
                    onChange={(e) =>
                      setForm((p) => ({ ...p, enabled: e.target.checked }))
                    }
                  />
                  <label htmlFor="enabled" className={labelClass}>
                    Active
                  </label>
                </div>
              </div>
              <div className="flex justify-end gap-3 mt-6">
                <button
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 rounded-btn text-sm font-medium text-brand-gray hover:bg-brand-bg"
                >
                  Cancel
                </button>
                <button
                  onClick={saveCriterion}
                  disabled={busy}
                  className="rounded-btn bg-brand-blue px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-60"
                >
                  {busy ? "Saving..." : "Save Criterion"}
                </button>
              </div>
            </div>
          </Card>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-4 right-4 bg-brand-ink text-white px-4 py-3 rounded-btn shadow-lg z-50">
          <span className="text-sm">{toast}</span>
        </div>
      )}
    </>
  );
}
