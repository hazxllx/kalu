import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, X, RefreshCw, Pencil, Trash2, ShieldAlert } from "lucide-react";
import PageHeader from "@/components/common/PageHeader";
import { Card } from "@/components/common/Card";
import { PageSkeleton } from "@/components/common/Skeleton";
import ErrorState from "@/components/common/ErrorState";
import RiskBadge from "@/components/common/RiskBadge";
import { riskConfigApi } from "@/services/api";

/**
 * Risk Assessment Settings (System Administrator).
 *
 * The ONE place the resident risk configuration is edited: the Low/Moderate/High
 * thresholds and the scoring criteria. The backend is authoritative — it stores
 * the configuration, recomputes every affected resident on save, and never
 * trusts a client-supplied risk score/level. This page only reads and writes the
 * configuration through /api/risk-config.
 */
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

const operatorLabel = (op) => OPERATOR_OPTIONS.find((o) => o.value === op)?.label || op;
const fieldLabel = (f) => FIELD_OPTIONS.find((o) => o.value === f)?.label || f;

const describeCondition = (c) =>
  c.operator === "between"
    ? `${fieldLabel(c.field)} ${c.value}–${c.value2}`
    : `${fieldLabel(c.field)} ${operatorLabel(c.operator).split(" ")[0]} ${c.value}`;

export default function RiskAssessmentSettings() {
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

  const criteria = useMemo(
    () => [...(config?.criteria || [])].sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0)),
    [config],
  );

  const saveThresholds = async () => {
    setBusy(true);
    try {
      await riskConfigApi.updateThresholds({
        moderateMin: Number(thresholds.moderateMin),
        highMin: Number(thresholds.highMin),
      });
      showToast("Risk thresholds updated. Residents were recalculated.");
      await load();
    } catch (err) {
      showToast(err?.message || "Could not update thresholds.");
    } finally {
      setBusy(false);
    }
  };

  const openNew = () => {
    setEditing(null);
    setForm(EMPTY_CRITERION);
    setFormError(null);
    setShowModal(true);
  };

  const openEdit = (c) => {
    setEditing(c.code);
    setForm({ ...EMPTY_CRITERION, ...c, value: c.value ?? "", value2: c.value2 ?? "", weight: c.weight ?? "" });
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
      showToast(`Recalculated ${res?.updated ?? 0} resident record${(res?.updated ?? 0) === 1 ? "" : "s"}.`);
    } catch (err) {
      showToast(err?.message || "Could not recalculate.");
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <PageSkeleton />;
  if (error) {
    return (
      <Card className="p-4">
        <ErrorState title="Unable to load risk settings" message={error} onRetry={load} />
      </Card>
    );
  }

  const mod = Number(thresholds.moderateMin);
  const high = Number(thresholds.highMin);

  return (
    <>
      <PageHeader
        crumbs={["Risk Assessment Settings"]}
        title="Risk Assessment Settings"
        subtitle="Configure the resident risk scoring criteria and classification thresholds. Changes recompute every resident's risk."
        action={
          <button
            onClick={recalculate}
            disabled={busy}
            className="flex items-center gap-2 rounded-btn border border-brand-border bg-white px-4 py-2.5 text-sm font-medium text-brand-ink hover:bg-brand-bg disabled:opacity-60"
          >
            <RefreshCw className="w-4 h-4" /> Recalculate residents
          </button>
        }
      />

      {/* Thresholds */}
      <Card className="p-6 mb-5">
        <h3 className="font-semibold text-brand-ink mb-1">Classification Thresholds</h3>
        <p className="text-xs text-brand-gray mb-4">
          A resident's total score is classified against these cutoffs.
        </p>
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="rounded-lg border border-brand-border bg-brand-light/30 p-4">
            <div className="flex items-center justify-between">
              <RiskBadge level="Low" />
              <span className="text-sm font-stat font-bold text-brand-ink">0–{Math.max(mod - 1, 0)}</span>
            </div>
          </div>
          <div className="rounded-lg border border-brand-border bg-brand-light/30 p-4">
            <div className="flex items-center justify-between">
              <RiskBadge level="Moderate" />
              <span className="text-sm font-stat font-bold text-brand-ink">{mod}–{Math.max(high - 1, mod)}</span>
            </div>
          </div>
          <div className="rounded-lg border border-brand-border bg-brand-light/30 p-4">
            <div className="flex items-center justify-between">
              <RiskBadge level="High" />
              <span className="text-sm font-stat font-bold text-brand-ink">{high}+</span>
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
              onChange={(e) => setThresholds((p) => ({ ...p, moderateMin: Number(e.target.value) }))}
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>High starts at</label>
            <input
              type="number"
              min={1}
              value={thresholds.highMin}
              onChange={(e) => setThresholds((p) => ({ ...p, highMin: Number(e.target.value) }))}
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
      </Card>

      {/* Criteria */}
      <Card className="p-6">
        <div className="flex items-center justify-between mb-1">
          <h3 className="font-semibold text-brand-ink">Risk Criteria</h3>
          <button
            onClick={openNew}
            className="flex items-center gap-2 rounded-btn bg-brand-blue px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark"
          >
            <Plus className="w-4 h-4" /> Add Criterion
          </button>
        </div>
        <p className="text-xs text-brand-gray mb-4">
          Each criterion adds its score when a resident's recorded health data satisfies the condition.
        </p>
        <div className="overflow-x-auto rounded-lg border border-brand-border">
          <table className="w-full text-sm">
            <thead className="bg-brand-light/40 text-brand-gray">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Criterion</th>
                <th className="px-3 py-2 text-left font-medium">Condition</th>
                <th className="px-3 py-2 text-right font-medium">Score</th>
                <th className="px-3 py-2 text-left font-medium">Status</th>
                <th className="px-3 py-2 text-right font-medium" />
              </tr>
            </thead>
            <tbody>
              {criteria.length === 0 && (
                <tr>
                  <td className="px-3 py-4 text-brand-gray" colSpan={5}>No criteria configured.</td>
                </tr>
              )}
              {criteria.map((c) => (
                <tr key={c.code} className="border-t border-brand-border">
                  <td className="px-3 py-2">
                    <p className="font-medium text-brand-ink">{c.name}</p>
                    <p className="text-xs text-brand-gray">{c.code}</p>
                  </td>
                  <td className="px-3 py-2 text-brand-gray">{describeCondition(c)}</td>
                  <td className="px-3 py-2 text-right font-stat font-medium text-brand-ink">+{c.weight}</td>
                  <td className="px-3 py-2">
                    <button
                      onClick={() => toggleCriterion(c)}
                      disabled={busy}
                      className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                        c.enabled ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"
                      }`}
                    >
                      {c.enabled ? "Active" : "Inactive"}
                    </button>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center justify-end gap-3">
                      <button onClick={() => openEdit(c)} className="flex items-center gap-1 text-brand-blue text-sm font-medium hover:underline">
                        <Pencil className="w-4 h-4" /> Edit
                      </button>
                      <button onClick={() => removeCriterion(c)} className="flex items-center gap-1 text-brand-danger text-sm font-medium hover:underline">
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
          <ShieldAlert className="w-3.5 h-3.5" /> A resident's risk level is never edited directly; it is always derived from recorded health data and these criteria.
        </p>
      </Card>

      {/* Criterion modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <Card className="w-full max-w-xl max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-brand-ink">{editing ? "Edit Criterion" : "Add Criterion"}</h3>
                <button onClick={() => setShowModal(false)} className="text-brand-gray hover:text-brand-ink">
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
                    onChange={(e) => setForm((p) => ({ ...p, code: e.target.value }))}
                    placeholder="e.g. bp_systolic_high"
                    className={`${inputClass} ${editing ? "bg-brand-bg text-brand-gray" : ""}`}
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
                    {FIELD_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className={labelClass}>Operator</label>
                  <select value={form.operator} onChange={(e) => setForm((p) => ({ ...p, operator: e.target.value }))} className={inputClass}>
                    {OPERATOR_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
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
                  <input type="number" value={form.priority} onChange={(e) => setForm((p) => ({ ...p, priority: Number(e.target.value) || 100 }))} className={inputClass} />
                </div>
                <div className="flex items-center gap-2 mt-6">
                  <input id="enabled" type="checkbox" checked={form.enabled} onChange={(e) => setForm((p) => ({ ...p, enabled: e.target.checked }))} />
                  <label htmlFor="enabled" className={labelClass}>Active</label>
                </div>
              </div>

              <div className="flex justify-end gap-3 mt-6">
                <button onClick={() => setShowModal(false)} className="px-4 py-2 rounded-btn text-sm font-medium text-brand-gray hover:bg-brand-bg">Cancel</button>
                <button onClick={saveCriterion} disabled={busy} className="rounded-btn bg-brand-blue px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-60">
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
