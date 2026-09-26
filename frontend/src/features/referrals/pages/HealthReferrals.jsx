import React, { useCallback, useEffect, useMemo, useState } from "react";
import PageHeader from "@/components/common/PageHeader";
import { Card } from "@/components/common/Card";
import StatusBadge from "@/components/common/StatusBadge";
import ResidentSearchSelect from "@/components/common/ResidentSearchSelect";
import { useAuth } from "@/context/AuthContext";
import { ROLE } from "@/lib/roles";
import { getSupervisorScope, HS_SCOPE } from "@/lib/supervisorScope";
import { referralsApi, residentsApi } from "@/services/api";
import { Plus, Eye, Edit2, RefreshCw, X, Search, Check, Trash2, Send } from "lucide-react";

/**
 * Referral coordination page backed by the real API (`/api/referrals` ->
 * Supabase `health_referrals`).
 *
 * One component, two audiences:
 *   - Health Supervisor: full create / edit / status / delete, scoped by the
 *     backend to their assigned barangay.
 *   - Resident: read-only view of their OWN referrals (the server returns only
 *     referrals linked to the signed-in resident).
 *
 * No local/mock persistence: every read and write goes through referralsApi,
 * and failures surface as explicit error states rather than empty successes.
 */

const STATUSES = ["Pending", "Accepted", "In Progress", "Completed", "Cancelled"];
const PRIORITIES = ["Low", "Medium", "High"];

const PRIORITY_COLORS = {
  High: "bg-brand-danger/10 text-brand-danger",
  Medium: "bg-brand-yellow/15 text-[#B07E00]",
  Low: "bg-brand-green/10 text-brand-green",
};

const todayIso = () => new Date().toISOString().slice(0, 10);

const formatDate = (iso) => {
  if (!iso) return "—";
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
};

const ageFrom = (birthDate) => {
  if (!birthDate) return undefined;
  const d = new Date(birthDate);
  if (Number.isNaN(d.getTime())) return undefined;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age -= 1;
  return age;
};

/** persisted health_referrals row (snake_case) → view model. */
const mapRecord = (row) => ({
  id: row.id,
  residentId: row.resident_id,
  residentName: row.resident
    ? [row.resident.first_name, row.resident.middle_name, row.resident.last_name].filter(Boolean).join(" ")
    : row.residentName || "Resident",
  barangay: row.resident?.barangay || "",
  sex: row.resident?.sex || "",
  age: ageFrom(row.resident?.birth_date),
  referringFacility: row.referring_facility || "",
  reason: row.reason || "",
  destinationFacility: row.destination_facility || "",
  destinationService: row.destination_service || "",
  priority: row.priority || "Medium",
  status: row.status || "Pending",
  referralDate: row.referral_date || "",
  notes: row.notes || "",
  resolutionNotes: row.resolution_notes || "",
  completedAt: row.completed_at || "",
});

const inputCls = (error) =>
  `mt-1.5 w-full bg-white border rounded-btn px-3.5 py-2.5 text-sm outline-none transition-colors focus:border-brand-blue ${
    error ? "border-brand-danger" : "border-brand-border"
  }`;

const EMPTY_FORM = () => ({
  referralDate: todayIso(),
  destinationFacility: "RHU Pili",
  destinationService: "",
  reason: "",
  priority: "High",
  referringFacility: "",
  notes: "",
});

function ReferralFormModal({ initial, resident, residents, saving, onClose, onSave, onSelectResident }) {
  const isEdit = Boolean(initial);
  const [form, setForm] = useState(() =>
    initial
      ? {
          referralDate: initial.referralDate || todayIso(),
          destinationFacility: initial.destinationFacility || "RHU Pili",
          destinationService: initial.destinationService || "",
          reason: initial.reason || "",
          priority: initial.priority || "High",
          referringFacility: initial.referringFacility || "",
          notes: initial.notes || "",
        }
      : EMPTY_FORM(),
  );
  const [errors, setErrors] = useState({});
  const set = (key) => (value) => {
    setForm((p) => ({ ...p, [key]: value }));
    if (errors[key]) setErrors((p) => ({ ...p, [key]: "" }));
  };

  const validate = () => {
    const next = {};
    if (!isEdit && !resident) next.resident = "Please select a resident.";
    if (!form.reason.trim()) next.reason = "Referral reason is required.";
    if (!form.destinationFacility.trim()) next.destinationFacility = "Destination facility is required.";
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4">
      <Card className="max-h-[92vh] w-full max-w-lg overflow-y-auto">
        <div className="p-6">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <h3 className="text-lg font-semibold text-brand-ink">{isEdit ? "Edit Referral" : "New Referral"}</h3>
              <p className="mt-0.5 text-sm text-brand-gray">Refer a resident to the RHU or a higher-level facility.</p>
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
                <label className="text-sm font-medium text-brand-ink">Referral Date</label>
                <input type="date" value={form.referralDate} onChange={(e) => set("referralDate")(e.target.value)} className={inputCls()} />
              </div>
              <div>
                <label className="text-sm font-medium text-brand-ink">Priority</label>
                <select value={form.priority} onChange={(e) => set("priority")(e.target.value)} className={`${inputCls()} cursor-pointer`}>
                  {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
              <div>
                <label className="text-sm font-medium text-brand-ink">Destination Facility <span className="text-brand-danger">*</span></label>
                <input type="text" value={form.destinationFacility} onChange={(e) => set("destinationFacility")(e.target.value)} placeholder="e.g. RHU Pili" className={inputCls(errors.destinationFacility)} />
                {errors.destinationFacility && <p className="mt-1 text-xs text-brand-danger">{errors.destinationFacility}</p>}
              </div>
              <div>
                <label className="text-sm font-medium text-brand-ink">Destination Service</label>
                <input type="text" value={form.destinationService} onChange={(e) => set("destinationService")(e.target.value)} placeholder="e.g. OB-Gyn, Laboratory" className={inputCls()} />
              </div>
              <div className="sm:col-span-2">
                <label className="text-sm font-medium text-brand-ink">Referring Facility</label>
                <input type="text" value={form.referringFacility} onChange={(e) => set("referringFacility")(e.target.value)} placeholder="e.g. Barangay Health Station" className={inputCls()} />
              </div>
            </div>

            <div>
              <label className="text-sm font-medium text-brand-ink">Referral Reason <span className="text-brand-danger">*</span></label>
              <input type="text" value={form.reason} onChange={(e) => set("reason")(e.target.value)} placeholder="Enter reason..." className={inputCls(errors.reason)} />
              {errors.reason && <p className="mt-1 text-xs text-brand-danger">{errors.reason}</p>}
            </div>

            <div>
              <label className="text-sm font-medium text-brand-ink">Notes</label>
              <textarea rows={3} value={form.notes} onChange={(e) => set("notes")(e.target.value)} placeholder="Additional notes..." className={`${inputCls()} resize-none`} />
            </div>
          </div>

          <div className="mt-6 flex justify-end gap-3 border-t border-brand-border pt-4">
            <button onClick={onClose} className="rounded-btn px-4 py-2 text-sm font-medium text-brand-gray hover:bg-brand-bg">Cancel</button>
            <button
              disabled={saving}
              onClick={() => { if (validate()) onSave(form); }}
              className="inline-flex items-center gap-1.5 rounded-btn bg-brand-blue px-5 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-60"
            >
              <Check className="h-4 w-4" /> {saving ? "Saving..." : isEdit ? "Save Changes" : "Save Referral"}
            </button>
          </div>
        </div>
      </Card>
    </div>
  );
}

export default function HealthReferrals() {
  const { user } = useAuth();
  const isResident = user?.role === ROLE.RESIDENT || user?.role === ROLE.RESIDENT_LIMITED;
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
  const [statusTarget, setStatusTarget] = useState(null);
  const [newStatus, setNewStatus] = useState("");
  const [resolutionNotes, setResolutionNotes] = useState("");
  const [deleteTarget, setDeleteTarget] = useState(null);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [priorityFilter, setPriorityFilter] = useState("All");
  const [toast, setToast] = useState(null);

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(null), 3000); };

  const load = useCallback(() => {
    setLoading(true);
    setLoadError(null);
    const requests = isResident
      ? [referralsApi.list()]
      : [referralsApi.list(), residentsApi.list({ limit: 200 })];
    return Promise.all(requests)
      .then(([referralResult, residentResult]) => {
        setRecords((referralResult?.rows || []).map(mapRecord));
        if (!isResident) {
          const rows = residentResult?.rows || residentResult || [];
          setResidents(
            rows
              .map((r) => ({
                id: r.id,
                name: [r.firstName, r.middleName, r.lastName].filter(Boolean).join(" "),
                barangay: r.barangay || "",
                age: ageFrom(r.birthDate),
                gender: r.sex,
              }))
              .filter((r) => !assignedBarangay || r.barangay === assignedBarangay),
          );
        }
      })
      .catch((err) => setLoadError(err?.message || "Unable to load referrals. Please try again."))
      .finally(() => setLoading(false));
  }, [assignedBarangay, isResident]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return records.filter((r) => {
      if (statusFilter !== "All" && r.status !== statusFilter) return false;
      if (priorityFilter !== "All" && r.priority !== priorityFilter) return false;
      if (q && !`${r.residentName} ${r.reason} ${r.destinationFacility}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [records, search, statusFilter, priorityFilter]);

  const openCreate = () => { setEditing(null); setSelectedResident(null); setFormOpen(true); };
  const openEdit = (record) => { setEditing(record); setSelectedResident(null); setDetail(null); setFormOpen(true); };

  const toPayload = (form) => ({
    referral_date: form.referralDate || null,
    destination_facility: form.destinationFacility.trim(),
    destination_service: form.destinationService.trim(),
    reason: form.reason.trim(),
    priority: form.priority,
    referring_facility: form.referringFacility.trim(),
    notes: form.notes,
  });

  const handleSave = async (form) => {
    setSaving(true);
    try {
      if (editing) {
        const result = await referralsApi.update(editing.id, toPayload(form));
        const mapped = mapRecord(result?.record || result);
        setRecords((prev) => prev.map((r) => (r.id === editing.id ? { ...r, ...mapped } : r)));
        showToast("Referral updated.");
      } else {
        const result = await referralsApi.create({ residentId: selectedResident.id, ...toPayload(form) });
        const mapped = {
          ...mapRecord(result?.record || result),
          residentName: selectedResident.name,
          barangay: selectedResident.barangay,
          age: selectedResident.age,
          sex: selectedResident.gender,
        };
        setRecords((prev) => [mapped, ...prev]);
        showToast("Referral created.");
      }
      setFormOpen(false);
      setEditing(null);
      setSelectedResident(null);
    } catch (err) {
      showToast(err?.message || "Could not save the referral.");
    } finally {
      setSaving(false);
    }
  };

  const openStatus = (record) => { setStatusTarget(record); setNewStatus(record.status); setResolutionNotes(record.resolutionNotes || ""); };

  const handleStatusSave = async () => {
    if (!statusTarget || !newStatus) return;
    setSaving(true);
    try {
      const result = await referralsApi.updateStatus(statusTarget.id, { status: newStatus, resolution_notes: resolutionNotes });
      const mapped = mapRecord(result?.record || result);
      setRecords((prev) => prev.map((r) => (r.id === statusTarget.id ? { ...r, ...mapped } : r)));
      setStatusTarget(null);
      showToast("Referral status updated.");
    } catch (err) {
      showToast(err?.message || "Could not update the referral status.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setSaving(true);
    try {
      await referralsApi.remove(deleteTarget.id);
      setRecords((prev) => prev.filter((r) => r.id !== deleteTarget.id));
      setDeleteTarget(null);
      showToast("Referral deleted.");
    } catch (err) {
      showToast(err?.message || "Could not delete the referral.");
    } finally {
      setSaving(false);
    }
  };

  const columns = isResident
    ? ["Referral Date", "Reason", "Destination", "Priority", "Status", ""]
    : ["Resident", "Referral Date", "Reason", "Destination", "Priority", "Status", "Actions"];

  return (
    <>
      <PageHeader
        crumbs={["Referrals"]}
        title={isResident ? "My Referrals" : "Referrals"}
        subtitle={
          isResident
            ? "Referrals your health workers have made for you and their current status."
            : assignedBarangay
              ? `Manage resident referrals to RHU and higher-level facilities in Brgy. ${assignedBarangay}.`
              : "Manage resident referrals to RHU and higher-level healthcare facilities."
        }
        action={
          isResident ? null : (
            <button onClick={openCreate} className="inline-flex items-center gap-2 rounded-btn bg-brand-blue px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-dark">
              <Plus className="h-4 w-4" /> New Referral
            </button>
          )
        }
      />

      {toast && (
        <div className="fixed bottom-4 right-4 z-[80] flex items-center gap-2 rounded-btn bg-brand-ink px-4 py-3 text-white shadow-lg">
          <Check className="h-4 w-4 text-brand-green" />
          <span className="text-sm">{toast}</span>
        </div>
      )}

      <Card className="p-4 mb-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-2 rounded-btn border border-brand-border bg-brand-bg px-3 py-2 lg:max-w-md lg:flex-1">
            <Search className="h-4 w-4 text-brand-gray" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search resident, reason, facility..." className="w-full bg-transparent text-sm outline-none placeholder:text-brand-gray/70" />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="rounded-btn border border-brand-border bg-white px-3 py-2 text-sm outline-none">
              <option value="All">All Statuses</option>
              {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <select value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value)} className="rounded-btn border border-brand-border bg-white px-3 py-2 text-sm outline-none">
              <option value="All">All Priorities</option>
              {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-brand-bg border-b border-brand-border">
              <tr>
                {columns.map((h) => (
                  <th key={h} className="text-left text-xs font-semibold text-brand-gray uppercase tracking-wide px-4 py-3">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id} className="border-b border-brand-border hover:bg-brand-bg/50">
                  {!isResident && (
                    <td className="px-4 py-3">
                      <p className="text-sm font-medium text-brand-ink">{r.residentName}</p>
                      <p className="text-xs text-brand-gray">{r.barangay}</p>
                    </td>
                  )}
                  <td className="px-4 py-3 text-sm text-brand-ink">{formatDate(r.referralDate)}</td>
                  <td className="px-4 py-3 text-sm text-brand-ink">{r.reason}</td>
                  <td className="px-4 py-3 text-sm text-brand-ink">
                    {r.destinationFacility}
                    {r.destinationService ? <span className="block text-xs text-brand-gray">{r.destinationService}</span> : null}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${PRIORITY_COLORS[r.priority] || ""}`}>{r.priority}</span>
                  </td>
                  <td className="px-4 py-3"><StatusBadge value={r.status} /></td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <button onClick={() => setDetail(r)} className="p-1.5 text-brand-blue hover:bg-brand-light rounded transition-colors" title="View Details">
                        <Eye className="w-4 h-4" />
                      </button>
                      {!isResident && (
                        <>
                          <button onClick={() => openEdit(r)} className="p-1.5 text-brand-blue hover:bg-brand-light rounded transition-colors" title="Edit Referral">
                            <Edit2 className="w-4 h-4" />
                          </button>
                          {r.status !== "Completed" && r.status !== "Cancelled" && (
                            <button onClick={() => openStatus(r)} className="p-1.5 text-brand-blue hover:bg-brand-light rounded transition-colors" title="Update Status">
                              <RefreshCw className="w-4 h-4" />
                            </button>
                          )}
                          <button onClick={() => setDeleteTarget(r)} className="p-1.5 text-brand-danger hover:bg-brand-danger/10 rounded transition-colors" title="Delete Referral">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={columns.length} className="px-4 py-10 text-center text-sm text-brand-gray">
                    {loading
                      ? "Loading referrals..."
                      : loadError
                        ? <span className="text-brand-danger">{loadError}</span>
                        : isResident
                          ? "You have no referrals yet."
                          : "No referrals match the selected filters."}
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
                  <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-light text-brand-blue"><Send className="h-5 w-5" /></div>
                  <div>
                    <h3 className="text-lg font-semibold text-brand-ink">{detail.residentName}</h3>
                    <p className="mt-0.5 text-sm text-brand-gray">{detail.destinationFacility}{detail.barangay ? ` · ${detail.barangay}` : ""}</p>
                  </div>
                </div>
                <button onClick={() => setDetail(null)} className="text-brand-gray hover:text-brand-ink" aria-label="Close"><X className="h-5 w-5" /></button>
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                {[
                  ["Referral Date", formatDate(detail.referralDate)],
                  ["Priority", detail.priority],
                  ["Destination Service", detail.destinationService || "—"],
                  ["Referring Facility", detail.referringFacility || "—"],
                  ["Status", detail.status],
                  ["Completed", formatDate(detail.completedAt)],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-btn bg-brand-bg px-3.5 py-2.5">
                    <p className="text-[11px] uppercase tracking-wide text-brand-gray">{label}</p>
                    <p className="mt-0.5 text-sm font-medium text-brand-ink">{value}</p>
                  </div>
                ))}
              </div>
              <div className="mt-3 rounded-btn bg-brand-bg px-3.5 py-2.5">
                <p className="text-[11px] uppercase tracking-wide text-brand-gray">Reason</p>
                <p className="mt-0.5 text-sm text-brand-ink">{detail.reason || "—"}</p>
              </div>
              <div className="mt-3 rounded-btn bg-brand-bg px-3.5 py-2.5">
                <p className="text-[11px] uppercase tracking-wide text-brand-gray">Notes</p>
                <p className="mt-0.5 text-sm text-brand-ink">{detail.notes || "No notes recorded."}</p>
              </div>
              {detail.resolutionNotes && (
                <div className="mt-3 rounded-btn bg-brand-bg px-3.5 py-2.5">
                  <p className="text-[11px] uppercase tracking-wide text-brand-gray">Resolution</p>
                  <p className="mt-0.5 text-sm text-brand-ink">{detail.resolutionNotes}</p>
                </div>
              )}
              <div className="mt-6 flex justify-end gap-3 border-t border-brand-border pt-4">
                <button onClick={() => setDetail(null)} className="rounded-btn px-4 py-2 text-sm font-medium text-brand-gray hover:bg-brand-bg">Close</button>
                {!isResident && (
                  <button onClick={() => openEdit(detail)} className="inline-flex items-center gap-1.5 rounded-btn bg-brand-blue px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark"><Edit2 className="h-4 w-4" /> Edit</button>
                )}
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* Create / Edit modal */}
      {formOpen && !isResident && (
        <ReferralFormModal
          initial={editing}
          resident={selectedResident}
          residents={residents}
          saving={saving}
          onClose={() => { setFormOpen(false); setEditing(null); setSelectedResident(null); }}
          onSave={handleSave}
          onSelectResident={setSelectedResident}
        />
      )}

      {/* Update status modal */}
      {statusTarget && !isResident && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4">
          <Card className="w-full max-w-md">
            <div className="p-6">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-lg font-semibold text-brand-ink">Update Status</h3>
                <button onClick={() => setStatusTarget(null)} className="text-brand-gray hover:text-brand-ink"><X className="h-4 w-4" /></button>
              </div>
              <div className="space-y-4">
                <div>
                  <p className="text-sm text-brand-gray mb-1">Current Status</p>
                  <StatusBadge value={statusTarget.status} />
                </div>
                <div>
                  <label className="text-sm font-medium text-brand-ink block mb-1.5">New Status</label>
                  <select value={newStatus} onChange={(e) => setNewStatus(e.target.value)} className="w-full bg-white border border-brand-border rounded-btn px-3 py-2.5 text-sm outline-none focus:border-brand-blue">
                    {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-sm font-medium text-brand-ink block mb-1.5">Resolution / Notes</label>
                  <textarea rows={3} value={resolutionNotes} onChange={(e) => setResolutionNotes(e.target.value)} placeholder="Optional notes on this status change..." className="w-full bg-white border border-brand-border rounded-btn px-3 py-2.5 text-sm outline-none focus:border-brand-blue resize-none" />
                </div>
              </div>
              <div className="mt-6 flex justify-end gap-3">
                <button onClick={() => setStatusTarget(null)} className="rounded-btn px-4 py-2 text-sm font-medium text-brand-gray hover:bg-brand-bg">Cancel</button>
                <button disabled={saving} onClick={handleStatusSave} className="rounded-btn bg-brand-blue px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-60">Update</button>
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* Delete confirmation */}
      {deleteTarget && !isResident && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4">
          <Card className="w-full max-w-md">
            <div className="p-6">
              <div className="mb-3 flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-danger/10 shrink-0">
                  <Trash2 className="h-5 w-5 text-brand-danger" />
                </div>
                <h3 className="text-lg font-semibold text-brand-ink">Delete this referral?</h3>
              </div>
              <p className="text-sm text-brand-gray">
                Referral for {deleteTarget.residentName}{deleteTarget.barangay ? ` (${deleteTarget.barangay})` : ""} will be removed. This action cannot be undone.
              </p>
              <div className="mt-6 flex justify-end gap-3">
                <button onClick={() => setDeleteTarget(null)} className="rounded-btn px-4 py-2 text-sm font-medium text-brand-gray hover:bg-brand-bg">Cancel</button>
                <button disabled={saving} onClick={handleDelete} className="rounded-btn bg-brand-danger px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60">Delete</button>
              </div>
            </div>
          </Card>
        </div>
      )}
    </>
  );
}
