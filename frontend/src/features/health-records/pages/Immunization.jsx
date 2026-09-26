import React, { useEffect, useMemo, useState } from "react";
import PageHeader from "@/components/common/PageHeader";
import StatusBadge from "@/components/common/StatusBadge";
import { Card } from "@/components/common/Card";
import ResidentSearchSelect from "@/components/common/ResidentSearchSelect";
import { useAuth } from "@/context/AuthContext";
import { getSupervisorScope, HS_SCOPE } from "@/lib/supervisorScope";
import { immunizationsApi, residentsApi } from "@/services/api";
import { X, Plus, CheckCircle2, Search, Syringe, Pencil } from "lucide-react";

const VACCINES = [
  "BCG", "Hepatitis B", "Pentavalent (DPT-HepB-Hib)", "OPV", "IPV", "PCV", "MMR", "Measles",
  "Tetanus Toxoid", "COVID-19", "Influenza", "Other",
];
const STATUSES = ["Due", "Completed", "Missed"];

const formatDate = (iso) => {
  if (!iso) return "—";
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
};

const todayIso = () => new Date().toISOString().slice(0, 10);

const inputCls = (error) =>
  `mt-1.5 w-full bg-white border rounded-btn px-3.5 py-2.5 text-sm outline-none transition-colors focus:border-brand-blue ${
    error ? "border-brand-danger" : "border-brand-border"
  }`;

/** persisted immunizations row (snake_case) → view shape. */
const mapRecord = (row) => ({
  id: row.id,
  residentId: row.resident_id,
  residentName: row.resident
    ? [row.resident.first_name, row.resident.middle_name, row.resident.last_name].filter(Boolean).join(" ")
    : row.residentName || "Resident",
  barangay: row.resident?.barangay || row.barangay || "",
  vaccine: row.vaccine || "",
  dose: row.dose || "",
  administeredDate: row.administered_date || "",
  nextDose: row.next_dose || "",
  provider: row.provider || "",
  status: row.status || "Due",
  notes: row.notes || "",
});

const EMPTY_FORM = () => ({
  vaccine: VACCINES[0],
  dose: "",
  administeredDate: todayIso(),
  nextDose: "",
  provider: "",
  status: "Completed",
  notes: "",
});

function ImmunizationFormModal({ initial, resident, residents, saving, onClose, onSave, onSelectResident }) {
  const isEdit = Boolean(initial);
  const [form, setForm] = useState(() => (initial ? { ...initial } : EMPTY_FORM()));
  const [errors, setErrors] = useState({});
  const set = (key) => (value) => {
    setForm((p) => ({ ...p, [key]: value }));
    if (errors[key]) setErrors((p) => ({ ...p, [key]: "" }));
  };

  const validate = () => {
    const next = {};
    if (!isEdit && !resident) next.resident = "Please select a resident.";
    if (!form.vaccine) next.vaccine = "Select a vaccine.";
    if (form.status === "Completed" && !form.administeredDate) next.administeredDate = "Date administered is required when completed.";
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4">
      <Card className="max-h-[92vh] w-full max-w-lg overflow-y-auto">
        <div className="p-6">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <h3 className="text-lg font-semibold text-brand-ink">{isEdit ? "Edit Immunization" : "Record Immunization"}</h3>
              <p className="mt-0.5 text-sm text-brand-gray">Vaccination details for the resident.</p>
            </div>
            <button onClick={onClose} className="text-brand-gray hover:text-brand-ink" aria-label="Close"><X className="h-5 w-5" /></button>
          </div>

          <div className="space-y-4">
            {isEdit ? (
              <div className="rounded-btn bg-brand-bg px-3.5 py-2.5">
                <p className="text-[11px] uppercase tracking-wide text-brand-gray">Resident</p>
                <p className="mt-0.5 text-sm font-medium text-brand-ink">{initial.residentName}</p>
              </div>
            ) : (
              <div>
                <label className="text-sm font-medium text-brand-ink">Resident <span className="text-brand-danger">*</span></label>
                <div className="mt-1.5">
                  <ResidentSearchSelect residents={residents} value={resident} onChange={onSelectResident} />
                </div>
                {errors.resident && <p className="mt-1 text-xs text-brand-danger">{errors.resident}</p>}
              </div>
            )}

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="text-sm font-medium text-brand-ink">Vaccine <span className="text-brand-danger">*</span></label>
                <select value={form.vaccine} onChange={(e) => set("vaccine")(e.target.value)} className={`${inputCls(errors.vaccine)} cursor-pointer`}>
                  {VACCINES.map((v) => <option key={v} value={v}>{v}</option>)}
                </select>
              </div>
              <div>
                <label className="text-sm font-medium text-brand-ink">Dose</label>
                <input type="text" value={form.dose} onChange={(e) => set("dose")(e.target.value)} placeholder="e.g. 1st dose" className={inputCls()} />
              </div>
              <div>
                <label className="text-sm font-medium text-brand-ink">Date Administered</label>
                <input type="date" value={form.administeredDate} onChange={(e) => set("administeredDate")(e.target.value)} className={inputCls(errors.administeredDate)} />
                {errors.administeredDate && <p className="mt-1 text-xs text-brand-danger">{errors.administeredDate}</p>}
              </div>
              <div>
                <label className="text-sm font-medium text-brand-ink">Next Dose (optional)</label>
                <input type="date" value={form.nextDose} onChange={(e) => set("nextDose")(e.target.value)} className={inputCls()} />
              </div>
              <div>
                <label className="text-sm font-medium text-brand-ink">Provider</label>
                <input type="text" value={form.provider} onChange={(e) => set("provider")(e.target.value)} placeholder="e.g. Midwife" className={inputCls()} />
              </div>
              <div>
                <label className="text-sm font-medium text-brand-ink">Status</label>
                <select value={form.status} onChange={(e) => set("status")(e.target.value)} className={`${inputCls()} cursor-pointer`}>
                  {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </div>

            <div>
              <label className="text-sm font-medium text-brand-ink">Notes</label>
              <textarea rows={3} value={form.notes} onChange={(e) => set("notes")(e.target.value)} placeholder="Additional information..." className={`${inputCls()} resize-none`} />
            </div>
          </div>

          <div className="mt-6 flex justify-end gap-3 border-t border-brand-border pt-4">
            <button onClick={onClose} className="rounded-btn px-4 py-2 text-sm font-medium text-brand-gray hover:bg-brand-bg">Cancel</button>
            <button
              disabled={saving}
              onClick={() => { if (validate()) onSave(form); }}
              className="inline-flex items-center gap-1.5 rounded-btn bg-brand-blue px-5 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-60"
            >
              <CheckCircle2 className="h-4 w-4" /> {saving ? "Saving..." : isEdit ? "Save Changes" : "Save Record"}
            </button>
          </div>
        </div>
      </Card>
    </div>
  );
}

export default function Immunization() {
  const { user } = useAuth();
  const scope = getSupervisorScope(user);
  const assignedBarangay = scope && scope.level === HS_SCOPE.BARANGAY ? scope.assignedBarangay : null;

  const [records, setRecords] = useState([]);
  const [residents, setResidents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [selectedResident, setSelectedResident] = useState(null);
  const [detail, setDetail] = useState(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [toast, setToast] = useState(null);

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(null), 3000); };

  const load = React.useCallback(() => {
    setLoading(true);
    setLoadError(null);
    return Promise.all([immunizationsApi.list(), residentsApi.list({ limit: 200 })])
      .then(([immResult, residentResult]) => {
        setRecords((immResult?.rows || []).map(mapRecord));
        const rows = residentResult?.rows || residentResult || [];
        setResidents(
          rows
            .map((r) => ({
              id: r.id,
              name: [r.firstName, r.middleName, r.lastName].filter(Boolean).join(" "),
              barangay: r.barangay || "",
              age: r.birthDate ? new Date().getFullYear() - new Date(r.birthDate).getFullYear() : undefined,
            }))
            .filter((r) => !assignedBarangay || r.barangay === assignedBarangay)
        );
      })
      .catch((err) => setLoadError(err?.message || "Unable to load immunizations. Please try again."))
      .finally(() => setLoading(false));
  }, [assignedBarangay]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return records.filter((r) => {
      if (statusFilter !== "All" && r.status !== statusFilter) return false;
      if (q && !`${r.residentName} ${r.vaccine}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [records, search, statusFilter]);

  const openCreate = () => { setEditing(null); setSelectedResident(null); setFormOpen(true); };
  const openEdit = (record) => { setEditing(record); setSelectedResident(null); setDetail(null); setFormOpen(true); };

  const handleSave = async (form) => {
    setSaving(true);
    const payload = {
      vaccine: form.vaccine,
      dose: form.dose,
      administered_date: form.administeredDate || null,
      next_dose: form.nextDose || null,
      provider: form.provider,
      status: form.status,
      notes: form.notes,
    };
    try {
      if (editing) {
        const result = await immunizationsApi.update(editing.id, payload);
        const mapped = mapRecord(result?.record || result);
        setRecords((prev) => prev.map((r) => (r.id === editing.id ? { ...r, ...mapped } : r)));
        showToast("Immunization updated.");
      } else {
        const result = await immunizationsApi.create({ residentId: selectedResident.id, ...payload });
        const mapped = {
          ...mapRecord(result?.record || result),
          residentName: selectedResident.name,
          barangay: selectedResident.barangay,
        };
        setRecords((prev) => [mapped, ...prev]);
        showToast("Immunization recorded.");
      }
      setFormOpen(false);
      setEditing(null);
      setSelectedResident(null);
    } catch (err) {
      showToast(err?.message || "Could not save the immunization.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <PageHeader
        crumbs={["Immunization"]}
        title="Immunization"
        subtitle={
          assignedBarangay
            ? `Record and monitor vaccinations in Brgy. ${assignedBarangay}.`
            : "Record and monitor resident vaccinations."
        }
        action={
          <button onClick={openCreate} className="inline-flex items-center gap-2 rounded-btn bg-brand-blue px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-dark">
            <Plus className="h-4 w-4" /> Record Immunization
          </button>
        }
      />

      {toast && (
        <div className="fixed bottom-4 right-4 z-[80] flex items-center gap-2 rounded-btn bg-brand-ink px-4 py-3 text-white shadow-lg">
          <CheckCircle2 className="h-4 w-4 text-brand-green" />
          <span className="text-sm">{toast}</span>
        </div>
      )}

      <Card className="p-4 mb-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2 rounded-btn border border-brand-border bg-brand-bg px-3 py-2 sm:max-w-md sm:flex-1">
            <Search className="h-4 w-4 text-brand-gray" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search resident or vaccine..." className="w-full bg-transparent text-sm outline-none placeholder:text-brand-gray/70" />
          </div>
          <div className="flex items-center gap-1">
            {["All", ...STATUSES].map((s) => (
              <button key={s} onClick={() => setStatusFilter(s)} className={`rounded-btn px-3 py-1.5 text-sm font-medium transition-colors ${statusFilter === s ? "bg-brand-blue text-white" : "text-brand-gray hover:bg-brand-bg"}`}>
                {s}
              </button>
            ))}
          </div>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-brand-bg border-b border-brand-border">
              <tr>
                {["Resident", "Vaccine", "Dose", "Date Administered", "Provider", "Status", "Actions"].map((h) => (
                  <th key={h} className="text-left text-xs font-semibold text-brand-gray uppercase tracking-wide px-4 py-3">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id} className="border-b border-brand-border hover:bg-brand-bg/50">
                  <td className="px-4 py-3">
                    <p className="text-sm font-medium text-brand-ink">{r.residentName}</p>
                    <p className="text-xs text-brand-gray">{r.barangay}</p>
                  </td>
                  <td className="px-4 py-3 text-sm text-brand-ink">{r.vaccine}</td>
                  <td className="px-4 py-3 text-sm text-brand-ink">{r.dose || "—"}</td>
                  <td className="px-4 py-3 text-sm text-brand-ink">{formatDate(r.administeredDate)}</td>
                  <td className="px-4 py-3 text-sm text-brand-ink">{r.provider || "—"}</td>
                  <td className="px-4 py-3"><StatusBadge value={r.status} /></td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <button onClick={() => setDetail(r)} className="text-sm font-medium text-brand-blue hover:underline">View</button>
                      <button onClick={() => openEdit(r)} className="inline-flex items-center gap-1 text-sm font-medium text-brand-blue hover:underline"><Pencil className="h-3.5 w-3.5" /> Edit</button>
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-sm text-brand-gray">
                    {loading
                      ? "Loading immunizations..."
                      : loadError
                        ? <span className="text-brand-danger">{loadError}</span>
                        : "No immunization records yet."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Detail modal */}
      {detail && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4">
          <Card className="max-h-[92vh] w-full max-w-lg overflow-y-auto">
            <div className="p-6">
              <div className="mb-4 flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-light text-brand-blue"><Syringe className="h-5 w-5" /></div>
                  <div>
                    <h3 className="text-lg font-semibold text-brand-ink">{detail.residentName}</h3>
                    <p className="mt-0.5 text-sm text-brand-gray">{detail.vaccine}{detail.barangay ? ` · ${detail.barangay}` : ""}</p>
                  </div>
                </div>
                <button onClick={() => setDetail(null)} className="text-brand-gray hover:text-brand-ink" aria-label="Close"><X className="h-5 w-5" /></button>
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                {[
                  ["Dose", detail.dose || "—"],
                  ["Date Administered", formatDate(detail.administeredDate)],
                  ["Next Dose", formatDate(detail.nextDose)],
                  ["Provider", detail.provider || "—"],
                  ["Status", detail.status],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-btn bg-brand-bg px-3.5 py-2.5">
                    <p className="text-[11px] uppercase tracking-wide text-brand-gray">{label}</p>
                    <p className="mt-0.5 text-sm font-medium text-brand-ink">{value}</p>
                  </div>
                ))}
              </div>
              <div className="mt-3 rounded-btn bg-brand-bg px-3.5 py-2.5">
                <p className="text-[11px] uppercase tracking-wide text-brand-gray">Notes</p>
                <p className="mt-0.5 text-sm text-brand-ink">{detail.notes || "No notes recorded."}</p>
              </div>
              <div className="mt-6 flex justify-end gap-3 border-t border-brand-border pt-4">
                <button onClick={() => setDetail(null)} className="rounded-btn px-4 py-2 text-sm font-medium text-brand-gray hover:bg-brand-bg">Close</button>
                <button onClick={() => openEdit(detail)} className="inline-flex items-center gap-1.5 rounded-btn bg-brand-blue px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark"><Pencil className="h-4 w-4" /> Edit</button>
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* Create / Edit modal */}
      {formOpen && (
        <ImmunizationFormModal
          initial={editing}
          resident={selectedResident}
          residents={residents}
          saving={saving}
          onClose={() => { setFormOpen(false); setEditing(null); setSelectedResident(null); }}
          onSave={handleSave}
          onSelectResident={setSelectedResident}
        />
      )}
    </>
  );
}
