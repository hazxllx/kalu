import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  Check,
  Info,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  ShieldAlert,
  Trash2,
  X,
} from "lucide-react";
import PageHeader from "@/components/common/PageHeader";
import { Card } from "@/components/common/Card";
import ErrorState from "@/components/common/ErrorState";
import { riskConfigApi } from "@/services/api";
import {
  getRiskConfig,
  saveRiskConfig,
  resetRiskConfig,
  DEFAULT_RISK_CONFIG,
} from "@/lib/householdRisk";
import { householdRiskStore } from "@/services/local/householdRiskStore";

// ----- Resident risk criteria option sets (Sections A & B) -----
const FIELD_OPTIONS = [
  { value: "systolic", label: "Systolic BP (mmHg)" },
  { value: "diastolic", label: "Diastolic BP (mmHg)" },
  { value: "o2sat", label: "SpO2 / O2 saturation (%)" },
  { value: "temperature", label: "Temperature (°C)" },
  { value: "pulse", label: "Pulse rate (bpm)" },
  { value: "respiratory", label: "Respiratory rate (/min)" },
  { value: "bmi", label: "Body mass index (kg/m²)" },
];

const OPERATOR_OPTIONS = [
  { value: "gte", label: "≥ — at least" },
  { value: "gt", label: "> — greater than" },
  { value: "lte", label: "≤ — at most" },
  { value: "lt", label: "< — less than" },
  { value: "eq", label: "= — equals" },
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

// Human-readable trigger descriptions for household indicators (display only).
const INDICATOR_TRIGGER = {
  multiple_members_followup: "2+ members in the household require follow-up",
  missed_vaccination: "Scheduled vaccination was not attended",
  overdue_vaccination: "Vaccination past its due date",
  missed_appointments: "One or more appointments missed",
  unresolved_referrals: "Referral has not been completed or closed",
  repeated_missed_followups: "Multiple follow-up visits missed consecutively",
  child_growth_concern: "Child growth measurements outside expected range",
  nutrition_concern: "Nutrition assessment flagged a concern",
  maternal_followup: "Maternal record requires follow-up visit",
  multiple_monitoring_flags: "Several active monitoring flags on the household",
  long_no_visit: "No household visit recorded in an extended period",
  repeated_encounters: "Same health concern seen on multiple encounters",
  incomplete_records: "Household health records have missing or incomplete fields",
  environmental_concern: "Environmental or community health risk identified",
};

const inputClass =
  "mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm outline-none transition-colors placeholder:text-slate-400 focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/15";
const labelClass = "text-xs font-medium text-slate-600";
const sectionLabelClass = "text-xs font-medium text-slate-500 tracking-wide";

const operatorLabel = (op) =>
  OPERATOR_OPTIONS.find((o) => o.value === op)?.label || op;
const fieldLabel = (f) =>
  FIELD_OPTIONS.find((o) => o.value === f)?.label || f;

const describeCondition = (c) =>
  c.operator === "between"
    ? `${fieldLabel(c.field)} ${c.value} – ${c.value2}`
    : `${fieldLabel(c.field)} ${operatorLabel(c.operator).split(" ")[0]} ${c.value}`;

// Small helper: compare two rule configs for dirtiness.
const rulesEqual = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Toast helper component
function Toast({ message, tone = "default", onDismiss }) {
  useEffect(() => {
    const t = setTimeout(onDismiss, 3400);
    return () => clearTimeout(t);
  }, [onDismiss]);
  return (
    <div
      role="status"
      className={`fixed bottom-4 right-4 z-50 flex items-center gap-2 rounded-md px-4 py-3 text-sm shadow-lg ${
        tone === "error"
          ? "bg-rose-600 text-white"
          : tone === "success"
            ? "bg-emerald-600 text-white"
            : "bg-slate-900 text-white"
      }`}
    >
      {tone === "error" && <AlertCircle className="h-4 w-4 shrink-0" />}
      {tone === "success" && <Check className="h-4 w-4 shrink-0" />}
      <span>{message}</span>
      <button onClick={onDismiss} className="ml-2 opacity-60 hover:opacity-100" aria-label="Dismiss">
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

// Lightweight confirm dialog (no extra dependency)
function ConfirmDialog({ open, title, description, confirmLabel = "Confirm", variant = "default", onConfirm, onCancel }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-5 shadow-xl">
        <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
        {description && <p className="mt-1.5 text-sm leading-relaxed text-slate-600">{description}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className={`rounded-md px-4 py-2 text-sm font-medium text-white ${
              variant === "danger" ? "bg-rose-600 hover:bg-rose-700" : "bg-brand-blue hover:bg-brand-dark"
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// Indicator inline edit modal (compact)
function IndicatorEditModal({ indicator, onSave, onClose }) {
  const [label, setLabel] = useState(indicator?.label || "");
  const [weight, setWeight] = useState(String(indicator?.weight ?? 0));
  const [escalation, setEscalation] = useState(Boolean(indicator?.escalation));
  const [active, setActive] = useState(indicator?.active !== false);

  const handleSave = () => {
    const w = Number(weight);
    if (!label.trim()) return;
    if (!Number.isFinite(w) || w < 0 || w > 100) return;
    onSave({ ...indicator, label: label.trim(), weight: w, escalation, active });
  };

  if (!indicator) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-5 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-sm font-semibold text-slate-900">Edit indicator</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="mt-1 text-xs text-slate-500">Key: {indicator.key}</p>
        <div className="mt-4 space-y-3">
          <div>
            <label className={labelClass}>Indicator name</label>
            <input value={label} onChange={(e) => setLabel(e.target.value)} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Weight (score contribution)</label>
            <input type="number" min="0" max="100" value={weight} onChange={(e) => setWeight(e.target.value)} className={inputClass} />
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={escalation} onChange={(e) => setEscalation(e.target.checked)} className="h-4 w-4 rounded border-slate-300 accent-brand-blue" />
            Triggers escalation (additional review)
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="h-4 w-4 rounded border-slate-300 accent-brand-blue" />
            Active
          </label>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
            Cancel
          </button>
          <button onClick={handleSave} className="rounded-md bg-brand-blue px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark">
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

export default function RiskInterventionSettings() {
  // ----- Resident risk (backend) state -----
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [toast, setToast] = useState(null);
  const [busy, setBusy] = useState(false);

  const [thresholds, setThresholds] = useState({ moderateMin: 40, highMin: 70 });
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_CRITERION);
  const [formError, setFormError] = useState(null);

  // Confirm dialogs
  const [confirmRecalc, setConfirmRecalc] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);

  // ----- Early intervention (local) state -----
  const [rules, setRules] = useState(() => getRiskConfig());
  const [savedRules, setSavedRules] = useState(() => getRiskConfig());
  const [indicatorSearch, setIndicatorSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [editingIndicator, setEditingIndicator] = useState(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  // Track whether rules have diverged from their saved state.
  const rulesDirty = useMemo(() => !rulesEqual(rules, savedRules), [rules, savedRules]);

  // Warn on unload if unsaved household-rule changes exist.
  useEffect(() => {
    if (!rulesDirty) return;
    const handler = (e) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [rulesDirty]);

  const showToast = useCallback((msg, tone = "default") => {
    setToast({ msg, tone });
  }, []);
  const dismissToast = useCallback(() => setToast(null), []);

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
    const fresh = getRiskConfig();
    setRules(fresh);
    setSavedRules(fresh);
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
    if (!Number.isFinite(mod) || !Number.isFinite(high)) {
      showToast("Thresholds must be numbers.", "error");
      return;
    }
    if (mod < 1) {
      showToast("The moderate threshold must be at least 1.", "error");
      return;
    }
    if (high <= mod) {
      showToast("The high threshold must be greater than the moderate threshold.", "error");
      return;
    }
    setBusy(true);
    try {
      await riskConfigApi.updateThresholds({ moderateMin: mod, highMin: high });
      showToast("Risk thresholds updated. Residents were recalculated.", "success");
      await load();
    } catch (err) {
      showToast(err?.message || "Could not update thresholds.", "error");
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
      showToast("Criterion saved. Residents were recalculated.", "success");
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
      showToast(err?.message || "Could not update the criterion.", "error");
    } finally {
      setBusy(false);
    }
  };

  const removeCriterion = async (c) => {
    setBusy(true);
    try {
      await riskConfigApi.deleteCriterion(c.code);
      showToast("Criterion removed. Residents were recalculated.", "success");
      await load();
    } catch (err) {
      showToast(err?.message || "Could not remove the criterion.", "error");
    } finally {
      setBusy(false);
    }
    setConfirmDelete(null);
  };

  const recalculate = async () => {
    setBusy(true);
    try {
      const res = await riskConfigApi.recalculate();
      showToast(
        `Recalculated ${res?.updated ?? 0} resident record${(res?.updated ?? 0) === 1 ? "" : "s"}.`,
        "success",
      );
    } catch (err) {
      showToast(err?.message || "Could not recalculate.", "error");
    } finally {
      setBusy(false);
    }
    setConfirmRecalc(false);
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

  const handleIndicatorEdit = (updated) => {
    setRules((c) => ({
      ...c,
      indicators: c.indicators.map((i) =>
        i.key === updated.key ? { ...i, ...updated } : i,
      ),
    }));
    setEditingIndicator(null);
  };

  const toggleIndicatorActive = (key) =>
    setRules((c) => ({
      ...c,
      indicators: c.indicators.map((i) =>
        i.key === key ? { ...i, active: i.active === false ? true : false } : i,
      ),
    }));

  const handleSaveRules = () => {
    const t = rules.thresholds || {};
    const monitor = Number(t.monitorScore);
    const intervention = Number(t.interventionScore);
    const priority = Number(t.priorityScore);
    if (![monitor, intervention, priority].every(Number.isFinite)) {
      showToast("Thresholds must be numbers.", "error");
      return;
    }
    if (monitor < 1) {
      showToast("The Monitor threshold must be at least 1.", "error");
      return;
    }
    if (!(monitor < intervention && intervention < priority)) {
      showToast("Thresholds must increase: Monitor < Needs Intervention < Priority Review.", "error");
      return;
    }
    saveRiskConfig(rules);
    householdRiskStore.refresh();
    setSavedRules(JSON.parse(JSON.stringify(rules)));
    showToast("Early intervention rules saved.", "success");
  };

  const handleResetRules = () => {
    const fresh = resetRiskConfig();
    householdRiskStore.refresh();
    setRules(fresh);
    setSavedRules(JSON.parse(JSON.stringify(fresh)));
    showToast("Early intervention rules reset to defaults.", "success");
    setConfirmReset(false);
  };

  const handleDiscardRules = () => {
    setRules(JSON.parse(JSON.stringify(savedRules)));
    setConfirmDiscard(false);
    showToast("Unsaved changes discarded.", "default");
  };

  const mod = Number(thresholds.moderateMin);
  const high = Number(thresholds.highMin);
  const residentRiskReady = !loading && !error;

  // Early-intervention indicator filtering
  const totalIndicators = rules.indicators.length;
  const indicatorQuery = indicatorSearch.trim().toLowerCase();
  let visibleIndicators = rules.indicators;
  if (indicatorQuery) {
    visibleIndicators = visibleIndicators.filter(
      (i) => i.label.toLowerCase().includes(indicatorQuery) || i.key.toLowerCase().includes(indicatorQuery),
    );
  }
  if (statusFilter === "active") {
    visibleIndicators = visibleIndicators.filter((i) => i.active !== false);
  } else if (statusFilter === "inactive") {
    visibleIndicators = visibleIndicators.filter((i) => i.active === false);
  } else if (statusFilter === "escalation") {
    visibleIndicators = visibleIndicators.filter((i) => Boolean(i.escalation));
  }

  const activeCount = rules.indicators.filter((i) => i.active !== false).length;

  return (
    <>
      <PageHeader
        crumbs={["Admin", "Risk & Intervention Settings"]}
        title="Risk & Intervention Settings"
        subtitle="Configure resident risk classification, early intervention rules, and follow-up policies."
      />

      <div className="space-y-5">
        {/* ============ Section A: Risk Classification ============ */}
        <Card className="p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-slate-900">Risk Classification</h2>
              <p className="mt-1 max-w-2xl text-xs leading-relaxed text-slate-500">
                Each resident receives a total risk score — the sum of weights for criteria whose conditions are met by their
                recorded health data. The score is then classified into Low, Moderate, or High using the thresholds below.
                Adjusting thresholds immediately reclassifies all residents.
              </p>
            </div>
            <button
              onClick={() => setConfirmRecalc(true)}
              disabled={busy || !residentRiskReady}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              <RefreshCw className="h-3.5 w-3.5" /> Recalculate residents
            </button>
          </div>

          {loading ? (
            <div className="mt-5 h-40 animate-pulse rounded-lg bg-slate-100" />
          ) : error ? (
            <div className="mt-5">
              <ErrorState title="Unable to load risk settings" message={error} onRetry={load} />
            </div>
          ) : (
            <>
              {/* Classification summary cards */}
              <div className="mt-5">
                <p className={sectionLabelClass + " mb-2"}>Current classification ranges</p>
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 p-4">
                    <div className="flex items-center justify-between">
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-medium text-emerald-700">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Low
                      </span>
                      <span className="font-stat text-sm font-semibold text-slate-900">0 – {Math.max(mod - 1, 0)}</span>
                    </div>
                    <p className="mt-2 text-xs leading-relaxed text-slate-500">Score below the moderate threshold. Routine monitoring.</p>
                  </div>
                  <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-4">
                    <div className="flex items-center justify-between">
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-700">
                        <span className="h-1.5 w-1.5 rounded-full bg-amber-500" /> Moderate
                      </span>
                      <span className="font-stat text-sm font-semibold text-slate-900">
                        {mod} – {Math.max(high - 1, mod)}
                      </span>
                    </div>
                    <p className="mt-2 text-xs leading-relaxed text-slate-500">Score meets the moderate threshold. Follow-up recommended.</p>
                  </div>
                  <div className="rounded-lg border border-rose-200 bg-rose-50/60 p-4">
                    <div className="flex items-center justify-between">
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-100 px-2.5 py-1 text-xs font-medium text-rose-700">
                        <span className="h-1.5 w-1.5 rounded-full bg-rose-500" /> High
                      </span>
                      <span className="font-stat text-sm font-semibold text-slate-900">{high}+</span>
                    </div>
                    <p className="mt-2 text-xs leading-relaxed text-slate-500">Score meets the high threshold. Priority review required.</p>
                  </div>
                </div>
                <p className="mt-2 flex items-center gap-1.5 text-[11px] text-slate-400">
                  <Info className="h-3 w-3 shrink-0" /> Boundaries are inclusive at the lower end. Example: a score of {mod} is Moderate.
                </p>
              </div>

              {/* Threshold inputs — visually separated from the summary */}
              <div className="mt-5 rounded-lg border border-slate-200 bg-slate-50/50 p-4">
                <h3 className="text-xs font-semibold text-slate-700">Edit thresholds</h3>
                <p className="mt-1 text-xs text-slate-500">High must be greater than Moderate. Saving recomputes every resident.</p>
                <div className="mt-3 grid max-w-lg gap-4 sm:grid-cols-2">
                  <div>
                    <label className={labelClass} htmlFor="thresh-moderate">
                      Moderate starts at
                    </label>
                    <input
                      id="thresh-moderate"
                      type="number"
                      min={1}
                      value={thresholds.moderateMin}
                      onChange={(e) =>
                        setThresholds((p) => ({
                          ...p,
                          moderateMin: e.target.value === "" ? "" : Number(e.target.value),
                        }))
                      }
                      className={inputClass}
                    />
                    <p className="mt-1 text-[11px] text-slate-400">Scores ≥ this value are Moderate or higher.</p>
                  </div>
                  <div>
                    <label className={labelClass} htmlFor="thresh-high">
                      High starts at
                    </label>
                    <input
                      id="thresh-high"
                      type="number"
                      min={1}
                      value={thresholds.highMin}
                      onChange={(e) =>
                        setThresholds((p) => ({
                          ...p,
                          highMin: e.target.value === "" ? "" : Number(e.target.value),
                        }))
                      }
                      className={inputClass}
                    />
                    <p className="mt-1 text-[11px] text-slate-400">Scores ≥ this value are High.</p>
                  </div>
                </div>
                <div className="mt-4">
                  <button
                    onClick={saveThresholds}
                    disabled={busy}
                    className="inline-flex items-center gap-1.5 rounded-md bg-brand-blue px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-50"
                  >
                    <Save className="h-4 w-4" /> Save thresholds
                  </button>
                </div>
              </div>
            </>
          )}
        </Card>

        {/* ============ Section B: Risk Criteria ============ */}
        <Card className="p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-slate-900">Risk Criteria</h2>
              <p className="mt-1 max-w-2xl text-xs leading-relaxed text-slate-500">
                Each criterion adds its score when a resident&apos;s recorded health data satisfies the condition. Changes are
                saved to the backend and recompute every resident&apos;s risk.
              </p>
            </div>
            <button
              onClick={openNew}
              disabled={!residentRiskReady}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-brand-blue px-3.5 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-50"
            >
              <Plus className="h-4 w-4" /> Add criterion
            </button>
          </div>

          {loading ? (
            <div className="mt-4 h-40 animate-pulse rounded-lg bg-slate-100" />
          ) : error ? (
            <p className="mt-4 text-sm text-slate-500">Risk criteria are unavailable until the configuration loads.</p>
          ) : (
            <>
              <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200">
                <table className="w-full min-w-[560px] text-sm">
                  <thead>
                    <tr className="bg-slate-50 text-left text-xs text-slate-500">
                      <th className="px-3 py-2.5 font-medium">Criterion</th>
                      <th className="px-3 py-2.5 font-medium">Condition</th>
                      <th className="px-3 py-2.5 text-right font-medium">Score</th>
                      <th className="px-3 py-2.5 font-medium">Status</th>
                      <th className="px-3 py-2.5 text-right font-medium">
                        <span className="sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {criteria.length === 0 && (
                      <tr>
                        <td className="px-3 py-6 text-center text-sm text-slate-400" colSpan={5}>
                          No criteria configured. Add one to start classifying residents.
                        </td>
                      </tr>
                    )}
                    {criteria.map((c) => (
                      <tr key={c.code} className="hover:bg-slate-50/60">
                        <td className="px-3 py-2.5">
                          <p className="text-sm text-slate-900">{c.name}</p>
                          <p className="text-xs text-slate-400">{c.code}</p>
                        </td>
                        <td className="px-3 py-2.5 text-xs leading-relaxed text-slate-500">{describeCondition(c)}</td>
                        <td className="px-3 py-2.5 text-right font-stat text-sm text-slate-900">+{c.weight}</td>
                        <td className="px-3 py-2.5">
                          <button
                            onClick={() => toggleCriterion(c)}
                            disabled={busy}
                            className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                              c.enabled ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"
                            }`}
                          >
                            {c.enabled ? "Active" : "Inactive"}
                          </button>
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="flex items-center justify-end gap-2">
                            <button
                              onClick={() => openEdit(c)}
                              className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-brand-blue hover:bg-brand-blue/10"
                            >
                              <Pencil className="h-3.5 w-3.5" /> Edit
                            </button>
                            <button
                              onClick={() => setConfirmDelete(c)}
                              className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-rose-600 hover:bg-rose-50"
                            >
                              <Trash2 className="h-3.5 w-3.5" /> Remove
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-3 flex items-center gap-1.5 text-xs text-slate-400">
                <ShieldAlert className="h-3.5 w-3.5 shrink-0" /> A resident&apos;s risk level is never edited directly — it is
                always derived from recorded health data and these criteria.
              </p>
            </>
          )}
        </Card>

        {/* ============ Section C: Early Intervention Rules ============ */}
        <Card className="overflow-hidden">
          {/* Header */}
          <div className="border-b border-slate-100 px-5 py-4 sm:px-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-sm font-semibold text-slate-900">Early Intervention Rules</h2>
                <p className="mt-1 max-w-2xl text-xs leading-relaxed text-slate-500">
                  Household risk indicators, their weights, and the score thresholds that determine when monitoring,
                  intervention, or priority review is triggered. Scores use a separate scale from resident risk.
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {rulesDirty && (
                  <span className="hidden items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700 sm:inline-flex">
                    <span className="h-1.5 w-1.5 rounded-full bg-amber-500" /> Unsaved changes
                  </span>
                )}
                <button
                  onClick={() => (rulesDirty ? setConfirmDiscard(true) : null)}
                  disabled={!rulesDirty}
                  className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-40"
                >
                  <X className="h-3.5 w-3.5" /> Discard
                </button>
                <button
                  onClick={() => setConfirmReset(true)}
                  className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50"
                >
                  <RotateCcw className="h-3.5 w-3.5" /> Reset
                </button>
                <button
                  onClick={handleSaveRules}
                  disabled={!rulesDirty}
                  className="inline-flex items-center gap-1.5 rounded-md bg-brand-blue px-3.5 py-2 text-xs font-medium text-white hover:bg-brand-dark disabled:opacity-40"
                >
                  <Save className="h-3.5 w-3.5" /> Save rules
                </button>
              </div>
            </div>
            {rulesDirty && (
              <p className="mt-2 text-xs font-medium text-amber-600 sm:hidden">You have unsaved changes.</p>
            )}
          </div>

          {/* Response thresholds */}
          <div className="px-5 py-4 sm:px-6">
            <h3 className="text-xs font-semibold text-slate-700">Response thresholds</h3>
            <p className="mt-1 text-xs text-slate-500">
              Thresholds are compared against the household&apos;s total indicator score. They must increase from left to right.
            </p>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              {[
                { key: "monitorScore", label: "Monitor", hint: "Score ≥ this → Monitor" },
                { key: "interventionScore", label: "Needs Intervention", hint: "Score ≥ this → Intervention" },
                { key: "priorityScore", label: "Priority Review", hint: "Score ≥ this → Priority" },
              ].map((t) => (
                <div key={t.key}>
                  <label className={labelClass} htmlFor={`thr-${t.key}`}>
                    {t.label}
                  </label>
                  <input
                    id={`thr-${t.key}`}
                    type="number"
                    min="0"
                    value={rules.thresholds[t.key] ?? DEFAULT_RISK_CONFIG.thresholds[t.key]}
                    onChange={(e) => setRuleThreshold(t.key, e.target.value)}
                    className={inputClass}
                  />
                  <p className="mt-1 text-[11px] text-slate-400">{t.hint}</p>
                </div>
              ))}
            </div>
            <div className="mt-2 flex items-center gap-1.5 rounded bg-slate-50 px-3 py-2 text-xs text-slate-500">
              <Info className="h-3.5 w-3.5 shrink-0 text-slate-400" />
              A household is classified by the highest threshold its total score meets. Escalation indicators can also promote to
              Priority when combined with the count threshold below.
            </div>
          </div>

          {/* Filters */}
          <div className="flex flex-wrap items-center gap-2 border-y border-slate-100 bg-slate-50/50 px-5 py-3 sm:px-6">
            <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input
                type="search"
                value={indicatorSearch}
                onChange={(e) => setIndicatorSearch(e.target.value)}
                placeholder="Search indicators…"
                aria-label="Search indicators"
                className="h-8 w-full rounded-md border border-slate-200 bg-white pl-8 pr-3 text-sm outline-none placeholder:text-slate-400 focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/15"
              />
            </div>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              aria-label="Filter by status"
              className="h-8 rounded-md border border-slate-200 bg-white px-2.5 text-xs text-slate-600 outline-none focus:border-brand-blue"
            >
              <option value="all">All indicators</option>
              <option value="active">Active only</option>
              <option value="inactive">Inactive only</option>
              <option value="escalation">Escalation only</option>
            </select>
            <span className="ml-auto text-xs text-slate-400">
              {visibleIndicators.length === totalIndicators
                ? `${totalIndicators} indicators · ${activeCount} active`
                : `${visibleIndicators.length} of ${totalIndicators} · ${activeCount} active`}
            </span>
          </div>

          {/* Indicators table — no fixed height, no nested scroll */}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs text-slate-500">
                  <th className="w-[28%] px-4 py-2.5 font-medium">Risk Indicator</th>
                  <th className="px-3 py-2.5 font-medium">Description / Trigger</th>
                  <th className="w-[84px] px-3 py-2.5 text-center font-medium">Weight</th>
                  <th className="w-[88px] px-3 py-2.5 text-center font-medium">Escalation</th>
                  <th className="w-[88px] px-3 py-2.5 text-center font-medium">Status</th>
                  <th className="w-[96px] px-3 py-2.5 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visibleIndicators.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-sm text-slate-400">
                      {indicatorQuery || statusFilter !== "all"
                        ? "No indicators match the current search or filter."
                        : "No indicators configured."}
                    </td>
                  </tr>
                )}
                {visibleIndicators.map((ind) => {
                  const isActive = ind.active !== false;
                  const trigger = INDICATOR_TRIGGER[ind.key] || "—";
                  return (
                    <tr key={ind.key} className={`hover:bg-slate-50/60 ${!isActive ? "opacity-60" : ""}`}>
                      <td className="px-4 py-2.5">
                        <p className="text-sm leading-snug text-slate-900">{ind.label}</p>
                        <p className="text-xs text-slate-400">{ind.key}</p>
                      </td>
                      <td className="px-3 py-2.5">
                        <p className="max-w-[360px] text-xs leading-relaxed text-slate-500">{trigger}</p>
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        <input
                          type="number"
                          min="0"
                          max="100"
                          value={ind.weight}
                          onChange={(e) => setIndicatorWeight(ind.key, e.target.value)}
                          aria-label={`Weight for ${ind.label}`}
                          className="h-7 w-16 rounded border border-slate-200 bg-white px-2 text-center text-sm outline-none focus:border-brand-blue focus:ring-1 focus:ring-brand-blue/20"
                        />
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        <label className="inline-flex items-center justify-center">
                          <input
                            type="checkbox"
                            checked={Boolean(ind.escalation)}
                            onChange={(e) => setIndicatorEscalation(ind.key, e.target.checked)}
                            aria-label={`Escalation for ${ind.label}`}
                            className="h-4 w-4 rounded border-slate-300 accent-brand-blue"
                          />
                        </label>
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        <span
                          className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                            isActive ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"
                          }`}
                        >
                          {isActive ? "Active" : "Inactive"}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => setEditingIndicator(ind)}
                            className="rounded px-2 py-1 text-xs font-medium text-brand-blue hover:bg-brand-blue/10"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => toggleIndicatorActive(ind.key)}
                            className="rounded px-2 py-1 text-xs font-medium text-slate-500 hover:bg-slate-100"
                          >
                            {isActive ? "Disable" : "Enable"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Follow-up & escalation */}
          <div className="border-t border-slate-100 bg-slate-50/50 px-5 py-4 sm:px-6">
            <h3 className="text-xs font-semibold text-slate-700">Follow-up &amp; escalation</h3>
            <p className="mt-1 text-xs text-slate-500">How follow-ups and automatic escalation are handled.</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <div>
                <label className={labelClass}>Priority indicator count</label>
                <input
                  type="number"
                  min="0"
                  value={rules.thresholds.priorityCount ?? DEFAULT_RISK_CONFIG.thresholds.priorityCount}
                  onChange={(e) => setRuleThreshold("priorityCount", e.target.value)}
                  className={inputClass}
                />
                <p className="mt-1 text-[11px] text-slate-400">If this many indicators are present and one has escalation, promote to Priority.</p>
              </div>
              <div>
                <label className={labelClass}>Follow-up timeframe (days)</label>
                <input
                  type="number"
                  min="0"
                  value={rules.followUpTimeframeDays ?? DEFAULT_RISK_CONFIG.followUpTimeframeDays}
                  onChange={(e) =>
                    setRules((c) => ({
                      ...c,
                      followUpTimeframeDays: Number(e.target.value) || 14,
                    }))
                  }
                  className={inputClass}
                />
                <p className="mt-1 text-[11px] text-slate-400">Days before a household is considered overdue for follow-up.</p>
              </div>
              <div>
                <label className={labelClass}>Escalate after follow-ups</label>
                <input
                  type="number"
                  min="0"
                  value={rules.escalationAfterFollowUps ?? DEFAULT_RISK_CONFIG.escalationAfterFollowUps}
                  onChange={(e) =>
                    setRules((c) => ({
                      ...c,
                      escalationAfterFollowUps: Number(e.target.value) || 3,
                    }))
                  }
                  className={inputClass}
                />
                <p className="mt-1 text-[11px] text-slate-400">Unsuccessful follow-ups before automatic escalation.</p>
              </div>
            </div>
          </div>

          {/* Sticky action bar when dirty */}
          {rulesDirty && (
            <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-3 border-t border-amber-200 bg-amber-50 px-5 py-3 sm:px-6">
              <p className="flex items-center gap-1.5 text-xs font-medium text-amber-700">
                <AlertTriangle className="h-3.5 w-3.5" /> You have unsaved changes to early intervention rules.
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setConfirmDiscard(true)}
                  className="rounded-md border border-slate-200 bg-white px-3.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
                >
                  Discard
                </button>
                <button
                  onClick={handleSaveRules}
                  className="rounded-md bg-brand-blue px-3.5 py-1.5 text-xs font-medium text-white hover:bg-brand-dark"
                >
                  Save rules
                </button>
              </div>
            </div>
          )}
        </Card>
      </div>

      {/* Criterion modal (Section B) */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true">
          <Card className="max-h-[90vh] w-full max-w-xl overflow-y-auto">
            <div className="p-5 sm:p-6">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-900">{editing ? "Edit criterion" : "Add criterion"}</h3>
                <button onClick={() => setShowModal(false)} className="text-slate-400 hover:text-slate-600" aria-label="Close">
                  <X className="h-5 w-5" />
                </button>
              </div>
              {formError && (
                <div className="mt-3 rounded-md border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-sm text-rose-700">{formError}</div>
              )}
              <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className={labelClass}>Code</label>
                  <input
                    value={form.code}
                    disabled={Boolean(editing)}
                    onChange={(e) => setForm((p) => ({ ...p, code: e.target.value }))}
                    placeholder="e.g. bp_systolic_high"
                    className={`${inputClass} ${editing ? "bg-slate-50 text-slate-400" : ""}`}
                  />
                </div>
                <div>
                  <label className={labelClass}>Name</label>
                  <input value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} className={inputClass} />
                </div>
                <div className="sm:col-span-2">
                  <label className={labelClass}>Description</label>
                  <input value={form.description} onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} className={inputClass} />
                </div>
                <div>
                  <label className={labelClass}>Health data field</label>
                  <select value={form.field} onChange={(e) => setForm((p) => ({ ...p, field: e.target.value }))} className={inputClass}>
                    {FIELD_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={labelClass}>Operator</label>
                  <select value={form.operator} onChange={(e) => setForm((p) => ({ ...p, operator: e.target.value }))} className={inputClass}>
                    {OPERATOR_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={labelClass}>Value</label>
                  <input type="number" value={form.value} onChange={(e) => setForm((p) => ({ ...p, value: e.target.value }))} className={inputClass} />
                </div>
                {form.operator === "between" && (
                  <div>
                    <label className={labelClass}>Upper value</label>
                    <input type="number" value={form.value2} onChange={(e) => setForm((p) => ({ ...p, value2: e.target.value }))} className={inputClass} />
                  </div>
                )}
                <div>
                  <label className={labelClass}>Score (weight)</label>
                  <input type="number" min={0} value={form.weight} onChange={(e) => setForm((p) => ({ ...p, weight: e.target.value }))} className={inputClass} />
                </div>
                <div>
                  <label className={labelClass}>Priority</label>
                  <input
                    type="number"
                    value={form.priority}
                    onChange={(e) => setForm((p) => ({ ...p, priority: Number(e.target.value) || 100 }))}
                    className={inputClass}
                  />
                </div>
                <label className="flex items-center gap-2 pt-5 text-sm text-slate-700">
                  <input type="checkbox" checked={form.enabled} onChange={(e) => setForm((p) => ({ ...p, enabled: e.target.checked }))} className="h-4 w-4 rounded border-slate-300 accent-brand-blue" />
                  Active
                </label>
              </div>
              <div className="mt-6 flex justify-end gap-2">
                <button onClick={() => setShowModal(false)} className="rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">
                  Cancel
                </button>
                <button
                  onClick={saveCriterion}
                  disabled={busy}
                  className="rounded-md bg-brand-blue px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-50"
                >
                  {busy ? "Saving…" : "Save criterion"}
                </button>
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* Indicator edit modal */}
      {editingIndicator && (
        <IndicatorEditModal indicator={editingIndicator} onSave={handleIndicatorEdit} onClose={() => setEditingIndicator(null)} />
      )}

      {/* Confirm dialogs */}
      <ConfirmDialog
        open={confirmRecalc}
        title="Recalculate all residents?"
        description="This recomputes the risk score and level for every resident using the current criteria and thresholds."
        confirmLabel="Recalculate"
        onConfirm={recalculate}
        onCancel={() => setConfirmRecalc(false)}
      />
      <ConfirmDialog
        open={!!confirmDelete}
        title={`Remove "${confirmDelete?.name || confirmDelete?.code}"?`}
        description="This criterion will be deleted and all residents will be recalculated. This cannot be undone."
        confirmLabel="Remove"
        variant="danger"
        onConfirm={() => removeCriterion(confirmDelete)}
        onCancel={() => setConfirmDelete(null)}
      />
      <ConfirmDialog
        open={confirmReset}
        title="Reset early intervention rules?"
        description="All indicator weights, thresholds, and follow-up settings will return to their defaults. Unsaved changes will be lost."
        confirmLabel="Reset to defaults"
        variant="danger"
        onConfirm={handleResetRules}
        onCancel={() => setConfirmReset(false)}
      />
      <ConfirmDialog
        open={confirmDiscard}
        title="Discard unsaved changes?"
        description="Your edits to early intervention rules have not been saved and will be lost."
        confirmLabel="Discard changes"
        variant="danger"
        onConfirm={handleDiscardRules}
        onCancel={() => setConfirmDiscard(false)}
      />

      {toast && <Toast message={toast.msg} tone={toast.tone} onDismiss={dismissToast} />}
    </>
  );
}
