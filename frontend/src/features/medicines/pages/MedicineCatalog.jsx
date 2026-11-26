// frontend/src/features/medicines/pages/MedicineCatalog.jsx
import React, { useCallback, useEffect, useMemo, useState } from "react";
import PageHeader from "@/components/common/PageHeader";
import { Card } from "@/components/common/Card";
import { ButtonSelectGroup } from "@/components/system";
import { AlertTriangle, Info, Pill, Plus, Save, Search, X } from "lucide-react";
import { medicinesApi, bpConfigApi } from "@/services/api";
import { useToast } from "@/components/ui/use-toast";
import { DEFAULT_BP_THRESHOLDS } from "@/features/consultations/utils/bpClassification";

const inputCls =
  "w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm outline-none transition-colors placeholder:text-slate-400 focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/15";
const labelCls = "text-xs font-medium text-slate-600";

// BP threshold definitions with plain-language explanations.
const THRESHOLD_GROUPS = [
  {
    category: "Elevated Blood Pressure",
    tone: "border-amber-400",
    dot: "bg-amber-500",
    fields: [{ key: "elevatedSystolicMin", label: "Systolic starting value", hint: "Elevated when systolic is at or above this value and diastolic is below Stage 1." }],
  },
  {
    category: "Stage 1 Hypertension",
    tone: "border-orange-400",
    dot: "bg-orange-500",
    fields: [
      { key: "stage1SystolicMin", label: "Systolic starting value", hint: "Systolic reaching this value qualifies." },
      { key: "stage1DiastolicMin", label: "Diastolic starting value", hint: "Diastolic reaching this value also qualifies." },
    ],
  },
  {
    category: "Stage 2 Hypertension",
    tone: "border-rose-400",
    dot: "bg-rose-500",
    fields: [
      { key: "stage2SystolicMin", label: "Systolic starting value", hint: "Systolic reaching this value qualifies." },
      { key: "stage2DiastolicMin", label: "Diastolic starting value", hint: "Diastolic reaching this value also qualifies." },
    ],
  },
  {
    category: "Hypertensive Urgency or Emergency",
    tone: "border-amber-500 bg-amber-50/40",
    dot: "bg-amber-600",
    fields: [
      { key: "crisisSystolicMin", label: "Systolic starting value", hint: "Systolic reaching this value requires urgent clinical review." },
      { key: "crisisDiastolicMin", label: "Diastolic starting value", hint: "Diastolic reaching this value requires urgent clinical review." },
    ],
  },
];

const validateBpThresholds = (values) => {
  const fieldErrors = {};
  Object.keys(DEFAULT_BP_THRESHOLDS).forEach((key) => {
    const value = values[key];
    if (value === "" || value === null || value === undefined || !Number.isFinite(Number(value))) {
      fieldErrors[key] = "Enter a numeric threshold.";
    } else if (Number(value) < 1 || Number(value) > 300) {
      fieldErrors[key] = "Use a value from 1 to 300 mmHg.";
    }
  });
  if (Object.keys(fieldErrors).length) return fieldErrors;

  if (!(Number(values.lowSystolicMax) < Number(values.elevatedSystolicMin)
    && Number(values.elevatedSystolicMin) < Number(values.stage1SystolicMin)
    && Number(values.stage1SystolicMin) < Number(values.stage2SystolicMin)
    && Number(values.stage2SystolicMin) < Number(values.crisisSystolicMin))) {
    fieldErrors.elevatedSystolicMin = "Systolic thresholds must increase from Elevated through Crisis.";
  }
  if (!(Number(values.lowDiastolicMax) < Number(values.stage1DiastolicMin)
    && Number(values.stage1DiastolicMin) < Number(values.stage2DiastolicMin)
    && Number(values.stage2DiastolicMin) < Number(values.crisisDiastolicMin))) {
    fieldErrors.stage1DiastolicMin = "Diastolic thresholds must increase from Stage 1 through Crisis.";
  }
  return fieldErrors;
};

const formatBelow = (value) =>
  value === "" || !Number.isFinite(Number(value)) ? "—" : `Below ${value}`;
const formatRange = (start, next) => {
  const lower = Number(start);
  const upper = Number(next) - 1;
  return start === "" || next === "" || !Number.isFinite(lower) || !Number.isFinite(upper)
    ? "—"
    : `${lower}–${upper}`;
};

const emptyMedicine = () => ({
  genericName: "",
  brandName: "",
  strength: "",
  dosageForm: "",
  category: "",
  source: "local",
  indication: "",
  safetyNotes: "",
  contraindications: "",
  prescriptionRequirement: "rx",
  dosageInstructions: "",
  active: true,
});

const RxBadge = ({ requirement }) => {
  const isRx = requirement === "rx";
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${
        isRx ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700"
      }`}
      title={isRx ? "Prescription required" : "Over-the-counter"}
    >
      {isRx ? "Rx" : "OTC"}
    </span>
  );
};

const formatVerified = (iso) => {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString();
  } catch {
    return "";
  }
};

function ConfirmDialog({ open, title, description, confirmLabel = "Confirm", onConfirm, onCancel }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-5 shadow-xl">
        <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
        {description && <p className="mt-1.5 text-sm leading-relaxed text-slate-600">{description}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onCancel} className="rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
            Cancel
          </button>
          <button onClick={onConfirm} className="rounded-md bg-brand-blue px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark">
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function MedicineCatalog() {
  const { toast } = useToast();
  const [activeSection, setActiveSection] = useState("bp");

  // ---- BP thresholds ---------------------------------------------------
  const [thresholds, setThresholds] = useState({ ...DEFAULT_BP_THRESHOLDS });
  const [savedThresholds, setSavedThresholds] = useState({ ...DEFAULT_BP_THRESHOLDS });
  const [serverDefaults, setServerDefaults] = useState({ ...DEFAULT_BP_THRESHOLDS });
  const [thresholdErrors, setThresholdErrors] = useState({});
  const [thresholdSource, setThresholdSource] = useState("default");
  const [savingThresholds, setSavingThresholds] = useState(false);
  const [confirmBpReset, setConfirmBpReset] = useState(false);
  const thresholdsDirty = useMemo(
    () => JSON.stringify(thresholds) !== JSON.stringify(savedThresholds),
    [thresholds, savedThresholds],
  );
  const thresholdsCanReset = thresholdsDirty
    || (thresholdSource === "configured" && JSON.stringify(savedThresholds) !== JSON.stringify(serverDefaults));

  const loadBpConfig = useCallback(async () => {
    try {
      const cfg = await bpConfigApi.get();
      const defaults = { ...DEFAULT_BP_THRESHOLDS, ...(cfg?.defaults || {}) };
      const loaded = { ...defaults, ...(cfg?.thresholds || {}) };
      setServerDefaults(defaults);
      setThresholds(loaded);
      setSavedThresholds(loaded);
      setThresholdSource(cfg?.source || "default");
      setThresholdErrors({});
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Could not load blood-pressure settings",
        description: err?.message || "Please try again.",
      });
    }
  }, [toast]);
  useEffect(() => {
    loadBpConfig();
  }, [loadBpConfig]);

  const updateThreshold = (key, value) => {
    const next = { ...thresholds, [key]: value === "" ? "" : Number(value) };
    setThresholds(next);
    setThresholdErrors(validateBpThresholds(next));
  };

  const saveThresholds = async () => {
    const errors = validateBpThresholds(thresholds);
    setThresholdErrors(errors);
    if (Object.keys(errors).length) return;
    setSavingThresholds(true);
    try {
      const cfg = await bpConfigApi.updateThresholds(thresholds);
      const defaults = { ...serverDefaults, ...(cfg?.defaults || {}) };
      const saved = { ...defaults, ...(cfg?.thresholds || thresholds) };
      setServerDefaults(defaults);
      setThresholds(saved);
      setSavedThresholds(saved);
      setThresholdSource(cfg?.source || "configured");
      setThresholdErrors({});
      toast({ title: "Blood-pressure thresholds saved." });
    } catch (err) {
      const details = err?.payload?.error?.details;
      const message = Array.isArray(details) ? details.join(" ") : err?.message || "Could not save thresholds.";
      toast({ variant: "destructive", title: "Could not save thresholds", description: message });
    } finally {
      setSavingThresholds(false);
    }
  };

  const handleBpReset = () => {
    setThresholds({ ...serverDefaults });
    setThresholdErrors({});
    setConfirmBpReset(false);
  };

  // ---- Medicine catalog ------------------------------------------------
  const [medicines, setMedicines] = useState([]);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyMedicine());
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  const loadMedicines = () => {
    setLoading(true);
    medicinesApi
      .list({ includeInactive: true })
      .then((res) => setMedicines(res?.medicines || []))
      .catch(() => setMedicines([]))
      .finally(() => setLoading(false));
  };
  useEffect(loadMedicines, []);

  const filtered = useMemo(() => {
    let rows = medicines;
    const q = query.trim().toLowerCase();
    if (q) {
      rows = rows.filter((m) =>
        [m.genericName, m.brandName, m.strength, m.dosageForm, m.category].some((f) =>
          String(f || "").toLowerCase().includes(q),
        ),
      );
    }
    if (statusFilter === "active") rows = rows.filter((m) => m.active !== false);
    else if (statusFilter === "inactive") rows = rows.filter((m) => m.active === false);
    return rows;
  }, [medicines, query, statusFilter]);

  const activeCount = medicines.filter((m) => m.active !== false).length;

  const openNew = () => {
    setEditing(null);
    setForm(emptyMedicine());
    setFormError("");
    setModalOpen(true);
  };

  const openEdit = (medicine) => {
    setEditing(medicine);
    setForm({
      genericName: medicine.genericName || "",
      brandName: medicine.brandName || "",
      strength: medicine.strength || "",
      dosageForm: medicine.dosageForm || "",
      category: medicine.category || "",
      source: medicine.source || "local",
      indication: medicine.indication || "",
      safetyNotes: medicine.safetyNotes || "",
      contraindications: medicine.contraindications || "",
      prescriptionRequirement: medicine.prescriptionRequirement || "rx",
      dosageInstructions: medicine.dosageInstructions || "",
      active: medicine.active !== false,
    });
    setFormError("");
    setModalOpen(true);
  };

  const saveMedicine = () => {
    if (!form.genericName.trim()) {
      setFormError("Generic name is required.");
      return;
    }
    setFormError("");
    setSaving(true);
    const request = editing ? medicinesApi.update(editing.id, form) : medicinesApi.create(form);
    request
      .then(() => {
        toast({ title: editing ? "Medicine updated." : "Medicine added to the catalog." });
        setModalOpen(false);
        loadMedicines();
      })
      .catch((err) => {
        const details = err?.payload?.error?.details;
        const msg = Array.isArray(details) ? details.join(" ") : err?.message || "Please try again.";
        setFormError(msg);
      })
      .finally(() => setSaving(false));
  };

  const toggleActive = (medicine) => {
    medicinesApi
      .setActive(medicine.id, medicine.active === false)
      .then(() => {
        toast({ title: medicine.active === false ? "Medicine reactivated." : "Medicine deactivated." });
        loadMedicines();
      })
      .catch((err) => {
        toast({ variant: "destructive", title: "Could not update medicine", description: err?.message || "Please try again." });
      });
  };

  return (
    <>
      <PageHeader
        management
        crumbs={[{ label: "Admin", to: "/app/admin/dashboard" }, "Medicine & BP"]}
        title="Medicine & BP"
        subtitle="Manage the medicine catalog and blood-pressure classification thresholds."
      />

      <nav aria-label="Medicine and blood-pressure settings" className="mb-4 overflow-x-auto border-b border-slate-200">
        <div className="flex min-w-max gap-1">
          {[
            { id: "bp", label: "Blood Pressure Classification" },
            { id: "medicines", label: "Medicine Catalog" },
          ].map(({ id, label }) => (
            <button
              key={id}
              type="button"
              onClick={() => setActiveSection(id)}
              aria-current={activeSection === id ? "page" : undefined}
              className={`-mb-px inline-flex h-10 items-center border-b-2 px-3 text-sm font-medium transition-colors ${
                activeSection === id
                  ? "border-brand-dark text-brand-dark"
                  : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-800"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </nav>

      <div className="space-y-5">
        {/* ============ BP Classification ============ */}
        {activeSection === "bp" && (
        <Card className="overflow-hidden">
          <div className="px-5 py-4 sm:px-6">
            <h2 className="text-sm font-semibold text-slate-900">Blood Pressure Classification</h2>
            <p className="mt-1 max-w-2xl text-xs leading-relaxed text-slate-500">
              Thresholds determine how a recorded reading (systolic/diastolic in mmHg) is classified for screening. This is
              guidance only — not a diagnosis. Readings in different categories use the more severe one.
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
              <span className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium border-slate-200 bg-white text-slate-600">
                Source: {thresholdSource === "configured" ? "Configured (saved)" : "Defaults (not yet customized)"}
              </span>
              {thresholdSource !== "configured" && (
                <span className="text-xs text-slate-400">Save to store your thresholds on the server.</span>
              )}
              {thresholdsDirty && (
                <span className="text-xs font-medium text-amber-700">The table includes unsaved draft values.</span>
              )}
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs text-slate-500">
                  <th className="px-4 py-2.5 font-medium">Classification</th>
                  <th className="px-3 py-2.5 font-medium">Systolic (mmHg)</th>
                  <th className="px-3 py-2.5 font-medium">Diastolic (mmHg)</th>
                  <th className="px-3 py-2.5 font-medium">Interpretation</th>
                  <th className="px-3 py-2.5 font-medium">Source</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {[
                  { label: "Normal", key: "normal", systolic: formatBelow(thresholds.elevatedSystolicMin), diastolic: formatBelow(thresholds.stage1DiastolicMin), tone: "bg-emerald-50 text-emerald-800", dot: "bg-emerald-500", interpretation: "Within the configured screening range; assess low readings in clinical context.", source: thresholdsDirty ? "draft" : thresholdSource },
                  { label: "Elevated Blood Pressure", key: "elevated", systolic: formatRange(thresholds.elevatedSystolicMin, thresholds.stage1SystolicMin), diastolic: formatBelow(thresholds.stage1DiastolicMin), tone: "bg-amber-50 text-amber-800", dot: "bg-amber-500", interpretation: "Elevated systolic reading; recheck and monitor.", source: thresholdsDirty ? "draft" : thresholdSource },
                  { label: "Stage 1 Hypertension", key: "stage1", systolic: formatRange(thresholds.stage1SystolicMin, thresholds.stage2SystolicMin), diastolic: formatRange(thresholds.stage1DiastolicMin, thresholds.stage2DiastolicMin), tone: "bg-orange-50 text-orange-800", dot: "bg-orange-500", interpretation: "Either measurement may qualify; arrange appropriate clinical assessment.", source: thresholdsDirty ? "draft" : thresholdSource },
                  { label: "Stage 2 Hypertension", key: "stage2", systolic: thresholds.stage2SystolicMin === "" ? "—" : `${thresholds.stage2SystolicMin} or higher`, diastolic: thresholds.stage2DiastolicMin === "" ? "—" : `${thresholds.stage2DiastolicMin} or higher`, tone: "bg-rose-50 text-rose-800", dot: "bg-rose-500", interpretation: "Either measurement may qualify; prompt assessment is needed.", source: thresholdsDirty ? "draft" : thresholdSource },
                  { label: "Hypertensive Urgency or Emergency", key: "crisis", systolic: thresholds.crisisSystolicMin === "" ? "—" : `${thresholds.crisisSystolicMin} or higher`, diastolic: thresholds.crisisDiastolicMin === "" ? "—" : `${thresholds.crisisDiastolicMin} or higher`, tone: "bg-red-50 text-red-800", dot: "bg-red-600", interpretation: "Crisis-range measurement; urgent clinical review is required.", source: thresholdsDirty ? "draft" : thresholdSource },
                ].map((r) => (
                  <tr key={r.key} className="hover:bg-slate-50/50">
                    <td className="px-4 py-2.5">
                      <span className={`inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-xs font-medium ${r.tone}`}>
                        <span className={`h-1.5 w-1.5 rounded-full ${r.dot}`} /> {r.label}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-xs text-slate-600">{r.systolic}</td>
                    <td className="px-3 py-2.5 text-xs text-slate-600">{r.diastolic}</td>
                    <td className="px-3 py-2.5 text-xs leading-relaxed text-slate-500">{r.interpretation}</td>
                    <td className="px-3 py-2.5">
                      <span className={`inline-flex rounded px-2 py-0.5 text-xs ${r.source === "configured" ? "bg-brand-blue/10 text-brand-blue" : r.source === "draft" ? "bg-amber-50 text-amber-700" : "bg-slate-100 text-slate-500"}`}>
                        {r.source === "configured" ? "Configured" : r.source === "draft" ? "Unsaved draft" : "Default"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mx-5 my-3 space-y-1.5 border-l-2 border-brand-blue/40 bg-slate-50 px-3.5 py-2.5 sm:mx-6">
            <p className="flex items-start gap-2 text-xs leading-relaxed text-slate-600">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-blue" />
              Systolic or diastolic measurements can determine classification. When measurements fall into different categories, use the more severe category.
            </p>
          </div>
          <div className="mx-5 my-3 flex gap-2.5 border-l-2 border-amber-500 bg-amber-50/70 px-3.5 py-2.5 sm:mx-6">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <p className="text-xs leading-relaxed text-amber-800">
              <span className="font-medium">Crisis readings</span> require urgent clinical review. A numerical reading alone does not establish a medical emergency; symptoms and possible organ effects require clinical assessment.
            </p>
          </div>

          {/* Editable thresholds — subtle, clearly separate from the reference table */}
          <div className="border-t border-slate-100 bg-slate-50/30 px-5 py-4 sm:px-6">
            <div>
              <h3 className="text-xs font-semibold text-slate-700">Edit thresholds</h3>
              <p className="mt-1 text-xs text-slate-500">Values must be numeric, within range, and increase by classification.</p>
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {THRESHOLD_GROUPS.map((group) => (
                <section key={group.category} className={`border-l-2 px-3 py-3 ${group.tone}`}>
                  <h4 className="flex items-center gap-2 text-xs font-semibold text-slate-800">
                    <span className={`h-2 w-2 rounded-full ${group.dot}`} />
                    {group.category}
                  </h4>
                  <div className="mt-3 grid gap-3">
                    {group.fields.map((field) => (
                      <div key={field.key}>
                        <label className="block text-xs font-medium text-slate-600" htmlFor={`bp-${field.key}`}>
                          {field.label}
                        </label>
                        <div className="mt-1 flex">
                          <input
                            id={`bp-${field.key}`}
                            type="number"
                            min="1"
                            max="300"
                            step="1"
                            value={thresholds[field.key]}
                            onChange={(e) => updateThreshold(field.key, e.target.value)}
                            aria-invalid={Boolean(thresholdErrors[field.key])}
                            aria-describedby={thresholdErrors[field.key] ? `bp-${field.key}-error` : `bp-${field.key}-hint`}
                            className={`${inputCls} min-w-0 rounded-r-none ${thresholdErrors[field.key] ? "border-rose-500 focus:border-rose-500 focus:ring-rose-500/15" : ""}`}
                          />
                          <span className="inline-flex items-center rounded-r-md border border-l-0 border-slate-200 bg-slate-50 px-3 text-xs text-slate-500">
                            mmHg
                          </span>
                        </div>
                        {thresholdErrors[field.key] ? (
                          <p id={`bp-${field.key}-error`} role="alert" className="mt-1 text-[11px] text-rose-700">
                            {thresholdErrors[field.key]}
                          </p>
                        ) : (
                          <p id={`bp-${field.key}-hint`} className="mt-1 text-[11px] text-slate-400">{field.hint}</p>
                        )}
                      </div>
                    ))}
                  </div>
                </section>
              ))}
            </div>
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <button
                onClick={() => setConfirmBpReset(true)}
                disabled={!thresholdsCanReset || savingThresholds}
                className="rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
              >
                Reset
              </button>
              <button
                onClick={saveThresholds}
                disabled={savingThresholds || !thresholdsDirty}
                className="inline-flex items-center gap-1.5 rounded-md bg-brand-blue px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-50"
              >
                <Save className="h-4 w-4" /> {savingThresholds ? "Saving…" : "Save Thresholds"}
              </button>
            </div>
          </div>
        </Card>
        )}

        {/* ============ Medicine Catalog ============ */}
        {activeSection === "medicines" && (
        <Card className="overflow-hidden">
          <div className="px-5 py-4 sm:px-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-sm font-semibold text-slate-900">Medicine Catalog</h2>
                <p className="mt-1 max-w-2xl text-xs leading-relaxed text-slate-500">
                  Generic-first catalog, searchable by generic or brand name.
                </p>
              </div>
              <button
                onClick={openNew}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-brand-blue px-3.5 py-2 text-sm font-medium text-white hover:bg-brand-dark"
              >
                <Plus className="h-4 w-4" /> Add medicine
              </button>
            </div>

            {/* Search + filters */}
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <div className="flex min-w-0 flex-1 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 sm:min-w-[200px] sm:max-w-sm">
                <Search className="h-4 w-4 shrink-0 text-slate-400" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search generic, brand, strength…"
                  aria-label="Search medicines"
                  className="w-full bg-transparent text-sm outline-none placeholder:text-slate-400"
                />
                {query && (
                  <button onClick={() => setQuery("")} className="text-slate-400 hover:text-slate-600" aria-label="Clear search">
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                aria-label="Filter by status"
                className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-600 outline-none focus:border-brand-blue"
              >
                <option value="">All Status</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
              <span className="ml-auto text-xs text-slate-400">
                {filtered.length === medicines.length
                  ? `${medicines.length} medicines · ${activeCount} active`
                  : `${filtered.length} of ${medicines.length} · ${activeCount} active`}
              </span>
            </div>
          </div>

          {/* Table — page-level scroll only */}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[700px] text-sm">
              <thead>
                <tr className="border-y border-slate-200 bg-slate-50 text-left text-xs text-slate-500">
                  <th className="px-4 py-2.5 font-medium">Generic / Brand</th>
                  <th className="px-3 py-2.5 font-medium">Strength</th>
                  <th className="px-3 py-2.5 font-medium">Form</th>
                  <th className="px-3 py-2.5 font-medium">Category</th>
                  <th className="px-3 py-2.5 font-medium">Type</th>
                  <th className="px-3 py-2.5 font-medium">Status</th>
                  <th className="px-3 py-2.5 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((m) => (
                  <tr key={m.id} className="hover:bg-slate-50/60">
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <Pill className="h-3.5 w-3.5 shrink-0 text-brand-blue" />
                        <div className="min-w-0">
                          <p className="truncate text-sm text-slate-900">{m.genericName}</p>
                          {m.brandName && <p className="truncate text-xs text-slate-400">{m.brandName}</p>}
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-xs text-slate-600">{m.strength || "—"}</td>
                    <td className="px-3 py-2.5 text-xs text-slate-600">{m.dosageForm || "—"}</td>
                    <td className="px-3 py-2.5 text-xs text-slate-500">{m.category || "—"}</td>
                    <td className="px-3 py-2.5">
                      <RxBadge requirement={m.prescriptionRequirement} />
                    </td>
                    <td className="px-3 py-2.5">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                          m.active !== false ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"
                        }`}
                      >
                        {m.active !== false ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => openEdit(m)}
                          className="rounded px-2 py-1 text-xs font-medium text-brand-blue hover:bg-brand-blue/10"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => toggleActive(m)}
                          className="rounded px-2 py-1 text-xs font-medium text-slate-500 hover:bg-slate-100"
                        >
                          {m.active !== false ? "Deactivate" : "Reactivate"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {loading ? (
              <p className="py-8 text-center text-sm text-slate-400">Loading catalog…</p>
            ) : filtered.length === 0 ? (
              <p className="py-8 text-center text-sm text-slate-400">
                {query || statusFilter ? "No medicines match the current search or filter." : "No medicines found."}
              </p>
            ) : null}
          </div>

          {/* Last-updated hint */}
          {medicines.length > 0 && (
            <div className="border-t border-slate-100 bg-slate-50/50 px-5 py-2.5 sm:px-6">
              <p className="text-xs text-slate-400">
                {medicines.some((m) => m.updatedAt || m.createdAt)
                  ? `Last updated: ${formatVerified(medicines[0]?.updatedAt || medicines[0]?.createdAt) || "—"}`
                  : ""}
              </p>
            </div>
          )}
        </Card>
        )}
      </div>

      {/* Add / edit modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true">
          <Card className="max-h-[90vh] w-full max-w-xl overflow-y-auto">
            <div className="p-5 sm:p-6">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-900">{editing ? "Edit medicine" : "Add medicine"}</h3>
                <button onClick={() => setModalOpen(false)} className="text-slate-400 hover:text-slate-600" aria-label="Close">
                  <X className="h-5 w-5" />
                </button>
              </div>
              {formError && (
                <div className="mt-3 rounded-md border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-sm text-rose-700">{formError}</div>
              )}

              <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <label className={labelCls}>
                    Generic name <span className="text-rose-500">*</span>
                  </label>
                  <input value={form.genericName} onChange={(e) => setForm({ ...form, genericName: e.target.value })} className={`${inputCls} mt-1`} placeholder="e.g. Paracetamol" />
                </div>
                <div>
                  <label className={labelCls}>Brand name(s)</label>
                  <input value={form.brandName} onChange={(e) => setForm({ ...form, brandName: e.target.value })} placeholder="e.g. Biogesic" className={`${inputCls} mt-1`} />
                </div>
                <div>
                  <label className={labelCls}>Strength / concentration</label>
                  <input value={form.strength} onChange={(e) => setForm({ ...form, strength: e.target.value })} placeholder="e.g. 500 mg" className={`${inputCls} mt-1`} />
                </div>
                <div>
                  <label className={labelCls}>Dosage form</label>
                  <input value={form.dosageForm} onChange={(e) => setForm({ ...form, dosageForm: e.target.value })} placeholder="e.g. Tablet, Syrup" className={`${inputCls} mt-1`} />
                </div>
                <div>
                  <label className={labelCls}>Category</label>
                  <input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="e.g. Analgesic" className={`${inputCls} mt-1`} />
                </div>
                <div className="sm:col-span-2">
                  <label className={labelCls}>Intended use / indication</label>
                  <textarea value={form.indication} onChange={(e) => setForm({ ...form, indication: e.target.value })} placeholder="What this medicine is used for" rows={2} className={`${inputCls} mt-1`} />
                  <p className="mt-1 text-[11px] text-slate-400">Plain-language description of what the medicine treats.</p>
                </div>
                <div className="sm:col-span-2">
                  <label className={labelCls}>Basic safety notes</label>
                  <textarea value={form.safetyNotes} onChange={(e) => setForm({ ...form, safetyNotes: e.target.value })} placeholder="e.g. Take with food; may cause drowsiness" rows={2} className={`${inputCls} mt-1`} />
                </div>
                <div className="sm:col-span-2">
                  <label className={labelCls}>Contraindications</label>
                  <textarea value={form.contraindications} onChange={(e) => setForm({ ...form, contraindications: e.target.value })} placeholder="When this medicine should not be used" rows={2} className={`${inputCls} mt-1`} />
                </div>
                <div>
                  <label className={labelCls}>Prescription requirement</label>
                  <div className="mt-1">
                    <ButtonSelectGroup
                      ariaLabel="Prescription requirement"
                      options={[
                        { value: "rx", label: "Prescription (Rx)" },
                        { value: "otc", label: "Over-the-counter" },
                      ]}
                      value={form.prescriptionRequirement}
                      onChange={(v) => setForm({ ...form, prescriptionRequirement: v })}
                    />
                  </div>
                </div>
                <div className="sm:col-span-2">
                  <label className={labelCls}>Catalog dosage reference (optional)</label>
                  <textarea value={form.dosageInstructions} onChange={(e) => setForm({ ...form, dosageInstructions: e.target.value })} placeholder="Reference text only; enter patient-specific directions in the consultation" rows={2} className={`${inputCls} mt-1`} />
                  <p className="mt-1 flex items-start gap-1.5 text-[11px] text-slate-500">
                    <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-blue" />
                    {editing && editing.dosageVerifiedAt
                      ? `A review record is dated ${formatVerified(editing.dosageVerifiedAt)}, but no reference source is recorded.`
                      : "Optional catalog text only. No source is recorded here, so treat it as unverified. It is never copied into a patient prescription."}
                  </p>
                </div>
                <label className="flex items-center gap-2 sm:col-span-2">
                  <input id="med-active" type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} className="h-4 w-4 rounded border-slate-300 accent-brand-blue" />
                  <span className="text-sm text-slate-700">Active (available for selection in consultations)</span>
                </label>
              </div>

              <div className="mt-5 flex items-center justify-end gap-2">
                <button onClick={() => setModalOpen(false)} className="rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">
                  Cancel
                </button>
                <button
                  onClick={saveMedicine}
                  disabled={saving || !form.genericName.trim()}
                  className="inline-flex items-center gap-1.5 rounded-md bg-brand-blue px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-50"
                >
                  <Save className="h-4 w-4" /> {saving ? "Saving…" : "Save medicine"}
                </button>
              </div>
            </div>
          </Card>
        </div>
      )}

      <ConfirmDialog
        open={confirmBpReset}
        title="Reset BP thresholds to defaults?"
        description="Thresholds will return to the verified clinical defaults. Save to persist the change."
        confirmLabel="Reset"
        onConfirm={handleBpReset}
        onCancel={() => setConfirmBpReset(false)}
      />
    </>
  );
}
