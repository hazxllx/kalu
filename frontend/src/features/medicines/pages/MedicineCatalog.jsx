import React, { useEffect, useMemo, useState } from "react";
import PageHeader from "@/components/common/PageHeader";
import { Card } from "@/components/common/Card";
import { ButtonSelectGroup } from "@/components/system";
import { Plus, Search, X, Save, Pencil, Pill, ShieldCheck } from "lucide-react";
import { medicinesApi, bpConfigApi } from "@/services/api";
import { useToast } from "@/components/ui/use-toast";
import { DEFAULT_BP_THRESHOLDS } from "@/features/consultations/utils/bpClassification";

const inputCls =
  "w-full bg-white border border-brand-border rounded-btn px-3 py-2 text-sm outline-none focus:border-brand-blue";

const THRESHOLD_FIELDS = [
  { key: "lowSystolicMax", label: "Low — systolic at/below", hint: "Hypotension when systolic \u2264 this" },
  { key: "lowDiastolicMax", label: "Low — diastolic at/below", hint: "Hypotension when diastolic \u2264 this" },
  { key: "elevatedSystolicMin", label: "Elevated — systolic from", hint: "Elevated when systolic \u2265 this and diastolic normal" },
  { key: "stage1SystolicMin", label: "Stage 1 — systolic from", hint: "" },
  { key: "stage1DiastolicMin", label: "Stage 1 — diastolic from", hint: "" },
  { key: "stage2SystolicMin", label: "Stage 2 — systolic from", hint: "" },
  { key: "stage2DiastolicMin", label: "Stage 2 — diastolic from", hint: "" },
  { key: "crisisSystolicMin", label: "Crisis — systolic from", hint: "Hypertensive crisis" },
  { key: "crisisDiastolicMin", label: "Crisis — diastolic from", hint: "Hypertensive crisis" },
];

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
    className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
      source === "yakap" ? "bg-brand-blue/10 text-brand-blue" : "bg-brand-light text-brand-gray"
    }`}
  >
    {source === "yakap" ? "YAKAP" : "Local"}
  </span>
);

const RxBadge = ({ requirement }) => {
  const isRx = requirement === "rx";
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
        isRx ? "bg-brand-amber/10 text-brand-amber" : "bg-brand-green/10 text-brand-green"
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

export default function MedicineCatalog() {
  const { toast } = useToast();

  // ---- Blood-pressure thresholds -----------------------------------------
  const [thresholds, setThresholds] = useState(DEFAULT_BP_THRESHOLDS);
  const [thresholdSource, setThresholdSource] = useState("default");
  const [savingThresholds, setSavingThresholds] = useState(false);

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
        const message = Array.isArray(details) ? details.join(" ") : (err?.message || "Could not save thresholds.");
        toast({ variant: "destructive", title: "Could not save thresholds", description: message });
      })
      .finally(() => setSavingThresholds(false));
  };

  // ---- Medicine catalog ---------------------------------------------------
  const [medicines, setMedicines] = useState([]);
  const [query, setQuery] = useState("");
  const [sourceFilter, setSourceFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null); // null => new
  const [form, setForm] = useState(emptyMedicine());
  const [saving, setSaving] = useState(false);

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
    const q = query.trim().toLowerCase();
    if (!q) return medicines;
    return medicines.filter((m) =>
      [m.genericName, m.brandName, m.strength, m.dosageForm, m.category]
        .some((f) => String(f || "").toLowerCase().includes(q))
    );
  }, [medicines, query]);

  const openNew = () => {
    setEditing(null);
    setForm(emptyMedicine());
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
    setModalOpen(true);
  };

  const saveMedicine = () => {
    setSaving(true);
    const request = editing
      ? medicinesApi.update(editing.id, form)
      : medicinesApi.create(form);
    request
      .then(() => {
        toast({ title: editing ? "Medicine updated." : "Medicine added to the catalog." });
        setModalOpen(false);
        loadMedicines();
      })
      .catch((err) => {
        toast({ variant: "destructive", title: "Could not save medicine", description: err?.message || "Please try again." });
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
        {/* Blood-pressure thresholds */}
        <Card className="p-5">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <h3 className="font-semibold text-brand-ink">Blood Pressure Classification Thresholds</h3>
              <p className="text-xs text-brand-gray mt-0.5">
                Numeric cut-offs (mmHg) used to classify a recorded reading. Screening guidance only — not a diagnosis.
                Currently using <span className="font-medium text-brand-ink">{thresholdSource === "configured" ? "configured" : "default"}</span> values.
              </p>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-3">
            {THRESHOLD_FIELDS.map((f) => (
              <div key={f.key}>
                <label className="block text-xs text-brand-gray mb-1" htmlFor={`bp-${f.key}`}>{f.label}</label>
                <input
                  id={`bp-${f.key}`}
                  type="number"
                  min="1"
                  max="300"
                  value={thresholds[f.key]}
                  onChange={(e) => setThresholds({ ...thresholds, [f.key]: e.target.value === "" ? "" : Number(e.target.value) })}
                  className={inputCls}
                />
                {f.hint && <p className="mt-1 text-[11px] text-brand-gray/80">{f.hint}</p>}
              </div>
            ))}
          </div>
          <div className="mt-3 flex items-center gap-3">
            <button
              onClick={saveThresholds}
              disabled={savingThresholds}
              className="flex items-center gap-2 rounded-btn bg-brand-blue px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-dark disabled:opacity-60"
            >
              <Save className="h-4 w-4" /> {savingThresholds ? "Saving..." : "Save thresholds"}
            </button>
            <button
              onClick={() => setThresholds(DEFAULT_BP_THRESHOLDS)}
              className="rounded-btn border border-brand-border px-4 py-2 text-sm font-medium text-brand-gray transition-colors hover:bg-brand-bg"
            >
              Reset to defaults
            </button>
          </div>
        </Card>

        {/* Medicine catalog */}
        <Card className="p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="font-semibold text-brand-ink">Medicine Catalog</h3>
              <p className="text-xs text-brand-gray mt-0.5">
                Generic-first catalog, searchable by generic or brand name. YAKAP = PhilHealth Advisory 2026-0007; Local = facility catalog (not a guaranteed PhilHealth benefit).
              </p>
            </div>
            <button
              onClick={openNew}
              className="flex items-center gap-2 rounded-btn bg-brand-blue px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-dark"
            >
              <Plus className="h-4 w-4" /> Add medicine
            </button>
          </div>

          <div className="mb-4 flex flex-wrap items-center gap-3">
            <div className="flex min-w-[220px] flex-1 items-center gap-2 rounded-btn border border-brand-border bg-white px-3 py-2">
              <Search className="h-4 w-4 text-brand-gray" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search generic or brand name, strength, form..."
                className="w-full bg-transparent text-sm outline-none"
              />
            </div>
            <select value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)} className="rounded-btn border border-brand-border bg-white px-3 py-2 text-sm outline-none">
              <option value="">All sources</option>
              <option value="yakap">YAKAP</option>
              <option value="local">Local</option>
            </select>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-brand-border text-left text-xs uppercase tracking-wide text-brand-gray">
                  <th className="py-2 pr-3 font-semibold">Generic / Brand</th>
                  <th className="py-2 pr-3 font-semibold">Strength</th>
                  <th className="py-2 pr-3 font-semibold">Form</th>
                  <th className="py-2 pr-3 font-semibold">Category</th>
                  <th className="py-2 pr-3 font-semibold">Type</th>
                  <th className="py-2 pr-3 font-semibold">Source</th>
                  <th className="py-2 pr-3 font-semibold">Status</th>
                  <th className="py-2 pr-3 font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((m) => (
                  <tr key={m.id} className="border-b border-brand-border/60">
                    <td className="py-2.5 pr-3">
                      <div className="flex items-center gap-2">
                        <Pill className="h-4 w-4 shrink-0 text-brand-blue" />
                        <span className="font-medium text-brand-ink">{m.genericName}</span>
                        {m.brandName && <span className="text-xs text-brand-gray">({m.brandName})</span>}
                      </div>
                    </td>
                    <td className="py-2.5 pr-3 text-brand-gray">{m.strength || "—"}</td>
                    <td className="py-2.5 pr-3 text-brand-gray">{m.dosageForm || "—"}</td>
                    <td className="py-2.5 pr-3 text-brand-gray">{m.category || "—"}</td>
                    <td className="py-2.5 pr-3"><RxBadge requirement={m.prescriptionRequirement} /></td>
                    <td className="py-2.5 pr-3"><SourceBadge source={m.source} /></td>
                    <td className="py-2.5 pr-3">
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${m.active !== false ? "bg-brand-green/10 text-brand-green" : "bg-slate-100 text-slate-500"}`}>
                        {m.active !== false ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td className="py-2.5 pr-3">
                      <div className="flex items-center justify-end gap-3">
                        <button onClick={() => openEdit(m)} className="flex items-center gap-1 text-brand-blue hover:underline">
                          <Pencil className="h-3.5 w-3.5" /> Edit
                        </button>
                        <button onClick={() => toggleActive(m)} className="text-brand-gray hover:text-brand-ink">
                          {m.active !== false ? "Deactivate" : "Reactivate"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {loading ? (
              <p className="py-8 text-center text-sm text-brand-gray">Loading catalog...</p>
            ) : filtered.length === 0 ? (
              <p className="py-8 text-center text-sm text-brand-gray">No medicines found.</p>
            ) : null}
          </div>
        </Card>
      </div>

      {/* Add / edit modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <Card className="w-full max-w-xl max-h-[90vh] overflow-y-auto p-5">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="font-semibold text-brand-ink">{editing ? "Edit medicine" : "Add medicine"}</h3>
              <button onClick={() => setModalOpen(false)} className="text-brand-gray hover:text-brand-ink" aria-label="Close">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">
              <div className="sm:col-span-2">
                <label className="block text-xs text-brand-gray mb-1">Generic name <span className="text-brand-danger">*</span></label>
                <input value={form.genericName} onChange={(e) => setForm({ ...form, genericName: e.target.value })} className={inputCls} />
              </div>
              <div>
                <label className="block text-xs text-brand-gray mb-1">Brand name(s)</label>
                <input value={form.brandName} onChange={(e) => setForm({ ...form, brandName: e.target.value })} placeholder="e.g. Biogesic" className={inputCls} />
              </div>
              <div>
                <label className="block text-xs text-brand-gray mb-1">Strength / concentration</label>
                <input value={form.strength} onChange={(e) => setForm({ ...form, strength: e.target.value })} placeholder="e.g. 500 mg" className={inputCls} />
              </div>
              <div>
                <label className="block text-xs text-brand-gray mb-1">Dosage form</label>
                <input value={form.dosageForm} onChange={(e) => setForm({ ...form, dosageForm: e.target.value })} placeholder="e.g. Tablet, Syrup" className={inputCls} />
              </div>
              <div>
                <label className="block text-xs text-brand-gray mb-1">Category</label>
                <input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="e.g. Antibiotic" className={inputCls} />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs text-brand-gray mb-1">Intended use / indication</label>
                <textarea
                  value={form.indication}
                  onChange={(e) => setForm({ ...form, indication: e.target.value })}
                  placeholder="What this medicine is used for"
                  rows={2}
                  className={inputCls}
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs text-brand-gray mb-1">Basic safety notes</label>
                <textarea
                  value={form.safetyNotes}
                  onChange={(e) => setForm({ ...form, safetyNotes: e.target.value })}
                  placeholder="e.g. Take with food; may cause drowsiness"
                  rows={2}
                  className={inputCls}
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs text-brand-gray mb-1">Contraindications</label>
                <textarea
                  value={form.contraindications}
                  onChange={(e) => setForm({ ...form, contraindications: e.target.value })}
                  placeholder="When this medicine should not be used"
                  rows={2}
                  className={inputCls}
                />
              </div>
              <div>
                <label className="block text-xs text-brand-gray mb-1">Prescription requirement</label>
                <ButtonSelectGroup
                  ariaLabel="Prescription requirement"
                  options={[{ value: "rx", label: "Prescription (Rx)" }, { value: "otc", label: "Over-the-counter" }]}
                  value={form.prescriptionRequirement}
                  onChange={(v) => setForm({ ...form, prescriptionRequirement: v })}
                />
              </div>
              <div>
                <label className="block text-xs text-brand-gray mb-1">Source</label>
                <ButtonSelectGroup
                  ariaLabel="Source"
                  options={[{ value: "local", label: "Local / facility catalog" }, { value: "yakap", label: "YAKAP (PhilHealth 2026-0007)" }]}
                  value={form.source}
                  onChange={(v) => setForm({ ...form, source: v })}
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs text-brand-gray mb-1">Dosage instructions</label>
                <textarea
                  value={form.dosageInstructions}
                  onChange={(e) => setForm({ ...form, dosageInstructions: e.target.value })}
                  placeholder="Standard dosage, e.g. Adults: 1 tablet every 6 hours as needed"
                  rows={2}
                  className={inputCls}
                />
                <p className="mt-1 flex items-start gap-1.5 text-[11px] text-brand-gray">
                  <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-blue" />
                  {editing && editing.dosageVerifiedAt
                    ? `Verified by authorized health personnel on ${formatVerified(editing.dosageVerifiedAt)}. Editing re-stamps verification.`
                    : "Saving records that these instructions were entered/verified by you as authorized health personnel."}
                </p>
              </div>
              <div className="flex items-center gap-2 sm:col-span-2">
                <input id="med-active" type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
                <label htmlFor="med-active" className="text-sm text-brand-ink">Active (available for selection in consultations)</label>
              </div>
            </div>

            <div className="mt-5 flex items-center justify-end gap-3">
              <button onClick={() => setModalOpen(false)} className="rounded-btn border border-brand-border px-4 py-2 text-sm font-medium text-brand-gray hover:bg-brand-bg">
                Cancel
              </button>
              <button
                onClick={saveMedicine}
                disabled={saving || !form.genericName.trim()}
                className="flex items-center gap-2 rounded-btn bg-brand-blue px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-dark disabled:opacity-60"
              >
                <Save className="h-4 w-4" /> {saving ? "Saving..." : "Save medicine"}
              </button>
            </div>
          </Card>
        </div>
      )}
    </>
  );
}
