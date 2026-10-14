import React, { useEffect, useMemo, useState } from "react";
import PageHeader from "@/components/common/PageHeader";
import { Card } from "@/components/common/Card";
import { ButtonSelectGroup } from "@/components/system";
import { AlertTriangle, Info, Pill, Plus, Save, Search, ShieldCheck, X } from "lucide-react";
import { medicinesApi, bpConfigApi } from "@/services/api";
import { useToast } from "@/components/ui/use-toast";
import { DEFAULT_BP_THRESHOLDS } from "@/features/consultations/utils/bpClassification";

const inputCls =
  "w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm outline-none transition-colors placeholder:text-slate-400 focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/15";
const labelCls = "text-xs font-medium text-slate-600";

// BP threshold definitions with plain-language explanations.
const THRESHOLD_ROWS = [
  {
    category: "Low",
    tone: "bg-slate-100 text-slate-600 border-slate-200",
    dot: "bg-slate-400",
    rows: [
      { key: "lowSystolicMax", label: "Systolic at or below", hint: "Readings at or below this are Low" },
      { key: "lowDiastolicMax", label: "Diastolic at or below", hint: "Readings at or below this are Low" },
    ],
  },
  {
    category: "Elevated",
    tone: "bg-amber-50 text-amber-700 border-amber-200",
    dot: "bg-amber-500",
    rows: [
      { key: "elevatedSystolicMin", label: "Systolic from", hint: "Systolic ≥ this with diastolic < 80 is Elevated" },
    ],
  },
  {
    category: "Stage 1",
    tone: "bg-orange-50 text-orange-700 border-orange-200",
    dot: "bg-orange-500",
    rows: [
      { key: "stage1SystolicMin", label: "Systolic from", hint: "Systolic ≥ this is Stage 1" },
      { key: "stage1DiastolicMin", label: "Diastolic from", hint: "Diastolic ≥ this is Stage 1" },
    ],
  },
  {
    category: "Stage 2",
    tone: "bg-rose-50 text-rose-700 border-rose-200",
    dot: "bg-rose-500",
    rows: [
      { key: "stage2SystolicMin", label: "Systolic from", hint: "Systolic ≥ this is Stage 2" },
      { key: "stage2DiastolicMin", label: "Diastolic from", hint: "Diastolic ≥ this is Stage 2" },
    ],
  },
  {
    category: "Crisis",
    tone: "bg-red-600 text-white border-red-600",
    dot: "bg-white",
    rows: [
      { key: "crisisSystolicMin", label: "Systolic above", hint: "Systolic > 180 is Crisis" },
      { key: "crisisDiastolicMin", label: "Diastolic above", hint: "Diastolic > 120 is Crisis" },
    ],
  },
];

const BP_ORDER_NOTE = "Classification uses the more severe category when systolic and diastolic fall into different ranges.";

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

const SourceBadge = ({ source }) => (
  <span
    className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${
      source === "yakap" ? "bg-brand-blue/10 text-brand-blue" : "bg-slate-100 text-slate-600"
    }`}
  >
    {source === "yakap" ? "YAKAP" : "Local"}
  </span>
);

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

  // ---- BP thresholds ---------------------------------------------------
  const [thresholds, setThresholds] = useState(DEFAULT_BP_THRESHOLDS);
  const [thresholdSource, setThresholdSource] = useState("default");
  const [savingThresholds, setSavingThresholds] = useState(false);
  const [confirmBpReset, setConfirmBpReset] = useState(false);
  const thresholdsDirty = useMemo(
    () => JSON.stringify(thresholds) !== JSON.stringify(DEFAULT_BP_THRESHOLDS) || thresholdSource === "configured",
    [thresholds, thresholdSource],
  );

  const loadBpConfig = () => {
    bpConfigApi
      .get()
      .then((cfg) => {
        if (cfg?.thresholds) setThresholds({ ...DEFAULT_BP_THRESHOLDS, ...cfg.thresholds });
        setThresholdSource(cfg?.source || "default");
      })
      .catch(() => {});
  };
  useEffect(loadBpConfig, []);

  const saveThresholds = () => {
    setSavingThresholds(true);
    bpConfigApi
      .updateThresholds(thresholds)
      .then((cfg) => {
        if (cfg?.thresholds) setThresholds({ ...DEFAULT_BP_THRESHOLDS, ...cfg.thresholds });
        setThresholdSource(cfg?.source || "configured");
        toast({ title: "Blood-pressure thresholds saved." });
      })
      .catch((err) => {
        const details = err?.payload?.error?.details;
        const message = Array.isArray(details) ? details.join(" ") : err?.message || "Could not save thresholds.";
        toast({ variant: "destructive", title: "Could not save thresholds", description: message });
      })
      .finally(() => setSavingThresholds(false));
  };

  const handleBpReset = () => {
    setThresholds(DEFAULT_BP_THRESHOLDS);
    setConfirmBpReset(false);
  };

  // ---- Medicine catalog ------------------------------------------------
  const [medicines, setMedicines] = useState([]);
  const [query, setQuery] = useState("");
  const [sourceFilter, setSourceFilter] = useState("");
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
      .list({ includeInactive: true, ...(sourceFilter ? { source: sourceFilter } : {}) })
      .then((res) => setMedicines(res?.medicines || []))
      .catch(() => setMedicines([]))
      .finally(() => setLoading(false));
  };
  useEffect(loadMedicines, [sourceFilter]);

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
        crumbs={["Medicine & Clinical Settings"]}
        title="Medicine & Clinical Settings"
        subtitle="Manage the medicine catalog and blood-pressure classification thresholds."
      />

      <div className="space-y-5">
        {/* ============ BP Classification ============ */}
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
            </div>
          </div>

          {/* Visual classification scale */}
          <div className="border-y border-slate-100 bg-slate-50/50 px-5 py-4 sm:px-6">
            <p className="text-xs font-medium text-slate-500">How readings are classified</p>
            <div className="mt-2 grid gap-2 sm:grid-cols-5">
              {[
                { label: "Low", sub: "≤ 89 / 59", tone: "bg-slate-100 text-slate-700 border-slate-200" },
                { label: "Normal", sub: "< 120 / < 80", tone: "bg-emerald-50 text-emerald-700 border-emerald-200" },
                { label: "Elevated", sub: "120–129 / < 80", tone: "bg-amber-50 text-amber-700 border-amber-200" },
                { label: "Stage 1", sub: "130–139 / 80–89", tone: "bg-orange-50 text-orange-700 border-orange-200" },
                { label: "Stage 2 / Crisis", sub: "≥ 140 / ≥ 90", tone: "bg-rose-50 text-rose-700 border-rose-200" },
              ].map((c) => (
                <div key={c.label} className={`rounded-lg border px-3 py-2.5 text-center ${c.tone}`}>
                  <p className="text-xs font-semibold">{c.label}</p>
                  <p className="mt-0.5 text-xs opacity-80">{c.sub}</p>
                </div>
              ))}
            </div>
            <p className="mt-2 flex items-center gap-1.5 text-xs text-slate-400">
              <Info className="h-3 w-3 shrink-0" /> {BP_ORDER_NOTE}
            </p>
          </div>

          {/* Threshold reference table */}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs text-slate-500">
                  <th className="px-4 py-2.5 font-medium">Category</th>
                  <th className="px-3 py-2.5 font-medium">Systolic (mmHg)</th>
                  <th className="px-3 py-2.5 font-medium">Diastolic (mmHg)</th>
                  <th className="px-3 py-2.5 font-medium">Meaning</th>
                  <th className="px-3 py-2.5 font-medium">Source</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                <tr className="hover:bg-slate-50/50">
                  <td className="px-4 py-2.5">
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Normal
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-xs text-slate-600">Below 120</td>
                  <td className="px-3 py-2.5 text-xs text-slate-600">Below 80</td>
                  <td className="px-3 py-2.5 text-xs text-slate-500">Within reference range.</td>
                  <td className="px-3 py-2.5">
                    <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">Clinical default</span>
                  </td>
                </tr>
                <tr className="hover:bg-slate-50/50">
                  <td className="px-4 py-2.5">
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600">
                      <span className="h-1.5 w-1.5 rounded-full bg-slate-400" /> Low
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-xs text-slate-600">≤ {thresholds.lowSystolicMax}</td>
                  <td className="px-3 py-2.5 text-xs text-slate-600">≤ {thresholds.lowDiastolicMax}</td>
                  <td className="px-3 py-2.5 text-xs text-slate-500">Possible hypotension — assess clinically.</td>
                  <td className="px-3 py-2.5">
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs ${thresholdSource === "configured" ? "bg-brand-blue/10 text-brand-blue" : "bg-slate-100 text-slate-500"}`}>
                      {thresholdSource === "configured" ? "Configured" : "Default"}
                    </span>
                  </td>
                </tr>
                {[
                  { label: "Elevated", key: "elevated", sys: `≥ ${thresholds.elevatedSystolicMin}`, dia: "< 80", tone: "bg-amber-50 text-amber-700", dot: "bg-amber-500", note: "Recheck and monitor." },
                  { label: "Stage 1", key: "stage1", sys: `≥ ${thresholds.stage1SystolicMin}`, dia: `≥ ${thresholds.stage1DiastolicMin}`, tone: "bg-orange-50 text-orange-700", dot: "bg-orange-500", note: "Clinical assessment recommended." },
                  { label: "Stage 2", key: "stage2", sys: `≥ ${thresholds.stage2SystolicMin}`, dia: `≥ ${thresholds.stage2DiastolicMin}`, tone: "bg-rose-50 text-rose-700", dot: "bg-rose-500", note: "Prompt assessment needed." },
                  { label: "Crisis", key: "crisis", sys: `> 180 (${thresholds.crisisSystolicMin})`, dia: `> 120 (${thresholds.crisisDiastolicMin})`, tone: "bg-red-600 text-white", dot: "bg-white", note: "Urgent review. If concerning symptoms, seek emergency assessment." },
                ].map((r) => (
                  <tr key={r.key} className="hover:bg-slate-50/50">
                    <td className="px-4 py-2.5">
                      <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${r.tone}`}>
                        <span className={`h-1.5 w-1.5 rounded-full ${r.dot}`} /> {r.label}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-xs text-slate-600">{r.sys}</td>
                    <td className="px-3 py-2.5 text-xs text-slate-600">{r.dia}</td>
                    <td className="px-3 py-2.5 text-xs leading-relaxed text-slate-500">{r.note}</td>
                    <td className="px-3 py-2.5">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs ${thresholdSource === "configured" ? "bg-brand-blue/10 text-brand-blue" : "bg-slate-100 text-slate-500"}`}>
                        {thresholdSource === "configured" ? "Configured" : "Default"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Crisis warning — visible but not alarming */}
          <div className="mx-5 my-3 flex gap-2.5 rounded-md border border-amber-200 bg-amber-50 px-3.5 py-2.5 sm:mx-6">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <p className="text-xs leading-relaxed text-amber-800">
              <span className="font-medium">Crisis readings</span> require urgent clinical review. A number alone does not
              establish an emergency — symptoms and possible organ effects must be evaluated by a clinician.
            </p>
          </div>

          {/* Editable thresholds — subtle, clearly separate from the reference table */}
          <div className="border-t border-slate-100 bg-slate-50/30 px-5 py-4 sm:px-6">
            <h3 className="text-xs font-semibold text-slate-700">Edit thresholds</h3>
            <p className="mt-1 text-xs text-slate-500">Adjust the numeric cut-offs. Changes are validated for correct ordering.</p>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {THRESHOLD_ROWS.flatMap((group) =>
                group.rows.map((f) => (
                  <div key={f.key}>
                    <label className="block text-xs font-medium text-slate-600" htmlFor={`bp-${f.key}`}>
                      <span className={`mr-1.5 inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${group.tone}`}>
                        <span className={`h-1.5 w-1.5 rounded-full ${group.dot}`} /> {group.category}
                      </span>
                      {f.label}
                    </label>
                    <input
                      id={`bp-${f.key}`}
                      type="number"
                      min="1"
                      max="300"
                      value={thresholds[f.key]}
                      onChange={(e) => setThresholds({ ...thresholds, [f.key]: e.target.value === "" ? "" : Number(e.target.value) })}
                      className={`${inputCls} mt-1`}
                    />
                    <p className="mt-1 text-[11px] text-slate-400">{f.hint}</p>
                  </div>
                )),
              )}
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <button
                onClick={saveThresholds}
                disabled={savingThresholds}
                className="inline-flex items-center gap-1.5 rounded-md bg-brand-blue px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-50"
              >
                <Save className="h-4 w-4" /> {savingThresholds ? "Saving…" : "Save thresholds"}
              </button>
              <button
                onClick={() => setConfirmBpReset(true)}
                className="rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
              >
                Reset to defaults
              </button>
            </div>
          </div>
        </Card>

        {/* ============ Medicine Catalog ============ */}
        <Card className="overflow-hidden">
          <div className="px-5 py-4 sm:px-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-sm font-semibold text-slate-900">Medicine Catalog</h2>
                <p className="mt-1 max-w-2xl text-xs leading-relaxed text-slate-500">
                  Generic-first catalog, searchable by generic or brand name. YAKAP = PhilHealth Advisory 2026-0007; Local =
                  facility catalog (not a guaranteed PhilHealth benefit).
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
              <div className="flex min-w-[200px] flex-1 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 sm:max-w-sm">
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
                value={sourceFilter}
                onChange={(e) => setSourceFilter(e.target.value)}
                aria-label="Filter by source"
                className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-600 outline-none focus:border-brand-blue"
              >
                <option value="">All sources</option>
                <option value="yakap">YAKAP</option>
                <option value="local">Local</option>
              </select>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                aria-label="Filter by status"
                className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-600 outline-none focus:border-brand-blue"
              >
                <option value="">All statuses</option>
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
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-y border-slate-200 bg-slate-50 text-left text-xs text-slate-500">
                  <th className="px-4 py-2.5 font-medium">Generic / Brand</th>
                  <th className="px-3 py-2.5 font-medium">Strength</th>
                  <th className="px-3 py-2.5 font-medium">Form</th>
                  <th className="px-3 py-2.5 font-medium">Category</th>
                  <th className="px-3 py-2.5 font-medium">Type</th>
                  <th className="px-3 py-2.5 font-medium">Source</th>
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
                      <SourceBadge source={m.source} />
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
                {query || sourceFilter || statusFilter ? "No medicines match the current search or filter." : "No medicines found."}
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
                {" · "}
                {medicines.filter((m) => m.source === "yakap").length} YAKAP · {medicines.filter((m) => m.source === "local").length} Local
              </p>
            </div>
          )}
        </Card>
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
                <div>
                  <label className={labelCls}>Source</label>
                  <div className="mt-1">
                    <ButtonSelectGroup
                      ariaLabel="Source"
                      options={[
                        { value: "local", label: "Local / facility" },
                        { value: "yakap", label: "YAKAP (PhilHealth)" },
                      ]}
                      value={form.source}
                      onChange={(v) => setForm({ ...form, source: v })}
                    />
                  </div>
                </div>
                <div className="sm:col-span-2">
                  <label className={labelCls}>Dosage instructions</label>
                  <textarea value={form.dosageInstructions} onChange={(e) => setForm({ ...form, dosageInstructions: e.target.value })} placeholder="Standard dosage, e.g. Adults: 1 tablet every 6 hours as needed" rows={2} className={`${inputCls} mt-1`} />
                  <p className="mt-1 flex items-start gap-1.5 text-[11px] text-slate-500">
                    <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-blue" />
                    {editing && editing.dosageVerifiedAt
                      ? `Verified on ${formatVerified(editing.dosageVerifiedAt)}. Editing re-stamps verification.`
                      : "Saving records that these instructions were entered/verified by you as authorized health personnel."}
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
