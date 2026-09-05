import React, { useEffect, useState } from "react";
import PageHeader from "@/components/common/PageHeader";
import StatusBadge from "@/components/common/StatusBadge";
import { Card } from "@/components/common/Card";
import { SERVICE_STATUSES, phnHealthServices } from "@/services/mock/mockPhnData";
import {
  filterRowsByScope,
  getPHNScope,
  isPHN,
  normalizeBarangay,
  phnDefaultBarangay,
  phnFilterOptions,
  phnWritableBarangays,
  rowMatchesOption,
  scopeLabel,
} from "@/lib/phnScope";
import { useAuth } from "@/context/AuthContext";
import {
  Stethoscope,
  Syringe,
  Shield,
  Heart,
  Activity,
  Plus,
  Trash2,
  X,
  CheckCircle2,
  Search,
  Calendar,
  Clock,
  MapPin,
  User,
} from "lucide-react";

const ICON_MAP = {
  Stethoscope: { Icon: Stethoscope, iconBg: "bg-brand-green/10", iconColor: "text-brand-green" },
  Syringe: { Icon: Syringe, iconBg: "bg-brand-blue/10", iconColor: "text-brand-blue" },
  Shield: { Icon: Shield, iconBg: "bg-brand-yellow/15", iconColor: "text-[#B07E00]" },
  Heart: { Icon: Heart, iconBg: "bg-brand-danger/10", iconColor: "text-brand-danger" },
  Activity: { Icon: Activity, iconBg: "bg-brand-accent/10", iconColor: "text-brand-accent" },
};
const iconStyle = (name) => {
  const key = Object.keys(ICON_MAP).find((k) => name && name.toLowerCase().includes(k.toLowerCase()));
  return ICON_MAP[key || "Activity"];
};

const PERSONNEL_OPTIONS = (user) => [
  user?.name || "PHN",
  "Midwife M. Dela Cruz",
  "BHW L. Ramos",
  "BHW G. Aquino",
];

const nextServiceId = (list) =>
  `SVC-${String(
    list.reduce((acc, s) => {
      const n = parseInt(String(s.id || "").replace(/\D/g, ""), 10);
      return Number.isNaN(n) ? acc : Math.max(acc, n);
    }, 0) + 1
  ).padStart(3, "0")}`;

const emptyForm = () => ({
  name: "",
  date: new Date().toISOString().slice(0, 10),
  time: "09:00",
  barangay: "",
  personnel: "",
  status: "Scheduled",
  notes: "",
});

const inputCls = (error) =>
  `w-full bg-white border rounded-btn px-3 py-2.5 text-sm outline-none focus:border-brand-blue ${
    error ? "border-red-400 bg-red-50/40" : "border-brand-border"
  }`;

const formatTime = (hhmm) => {
  if (!hhmm || !hhmm.includes(":")) return hhmm || "";
  const [h, m] = hhmm.split(":");
  const hour = parseInt(h, 10);
  const ampm = hour >= 12 ? "PM" : "AM";
  const hr12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${hr12}:${m} ${ampm}`;
};

const formatDate = (isoDate) => {
  if (!isoDate) return "";
  const d = new Date(`${isoDate}T00:00:00`);
  if (Number.isNaN(d.getTime())) return isoDate;
  return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
};

export default function PhnHealthServices() {
  const { user } = useAuth();
  const scope = getPHNScope(user);
  const phn = isPHN(user);
  const [services, setServices] = useState(() => filterRowsByScope(phnHealthServices, user));
  const [searchQuery, setSearchQuery] = useState("");
  const [barangayFilter, setBarangayFilter] = useState("All");
  const [statusFilter, setStatusFilter] = useState("All");
  const [showFormModal, setShowFormModal] = useState(false);
  const [editingService, setEditingService] = useState(null);
  const [form, setForm] = useState(() => ({ ...emptyForm(), barangay: phnDefaultBarangay(user) }));
  const [errors, setErrors] = useState({});
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [viewTarget, setViewTarget] = useState(null);
  const [toast, setToast] = useState(null);

  const filterOptions = phnFilterOptions(user);
  const writableBarangays = phnWritableBarangays(user);

  const showToast = (message) => {
    setToast(message);
    setTimeout(() => setToast(null), 3000);
  };

  const anyModalOpen = showFormModal || Boolean(deleteTarget) || Boolean(viewTarget);

  useEffect(() => {
    if (!anyModalOpen) return undefined;
    document.body.style.overflow = "hidden";
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      if (deleteTarget) setDeleteTarget(null);
      else if (viewTarget) setViewTarget(null);
      else setShowFormModal(false);
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "";
      document.removeEventListener("keydown", onKey);
    };
  }, [anyModalOpen, deleteTarget, viewTarget]);

  const filtered = services.filter((s) => {
    const matchesSearch = searchQuery === "" || s.name.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesBarangay = rowMatchesOption(s, barangayFilter, user);
    const matchesStatus = statusFilter === "All" || s.status === statusFilter;
    return matchesSearch && matchesBarangay && matchesStatus;
  });

  const validate = () => {
    const next = {};
    if (!form.name.trim()) next.name = "Service name is required.";
    if (!form.date) next.date = "Date is required.";
    if (!form.barangay) next.barangay = "Scope is required.";
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleAdd = () => {
    if (!validate()) return;
    const newService = {
      id: nextServiceId(services),
      name: form.name.trim(),
      barangay: normalizeBarangay(form.barangay),
      date: formatDate(form.date),
      time: formatTime(form.time),
      personnel: form.personnel || user?.name || "Unassigned",
      status: form.status,
      count: form.status === "Completed" ? "0 completed" : "0 scheduled",
      notes: form.notes.trim(),
    };
    setServices([newService, ...services]);
    setShowFormModal(false);
    setForm({ ...emptyForm(), barangay: phnDefaultBarangay(user) });
    setErrors({});
    showToast("Health service added successfully.");
  };

  const openEdit = (s) => {
    setEditingService(s);
    setForm({
      name: s.name,
      date: s.date,
      time: s.time,
      barangay: s.barangay || "RHU",
      personnel: s.personnel,
      status: s.status,
      notes: s.notes || "",
    });
    setErrors({});
    setShowFormModal(true);
  };

  const handleEdit = () => {
    if (!validate()) return;
    setServices((prev) =>
      prev.map((s) =>
        s.id === editingService.id ? { ...s, ...form, barangay: normalizeBarangay(form.barangay), notes: form.notes.trim() } : s
      )
    );
    setShowFormModal(false);
    setEditingService(null);
    setForm({ ...emptyForm(), barangay: phnDefaultBarangay(user) });
    setErrors({});
    showToast("Health service updated successfully.");
  };

  const handleConfirmDelete = () => {
    setServices((prev) => prev.filter((s) => s.id !== deleteTarget.id));
    setDeleteTarget(null);
    showToast("Health service deleted successfully.");
  };

  const handleStatusUpdate = (service, status) => {
    setServices((prev) => prev.map((s) => (s.id === service.id ? { ...s, status } : s)));
    if (viewTarget && viewTarget.id === service.id) setViewTarget({ ...viewTarget, status });
    showToast("Health service status updated successfully.");
  };

  return (
    <>
      <PageHeader
        crumbs={["Home", "Health Services"]}
        title="Health Services"
        subtitle={
          phn && scope && scope.level === "barangay"
            ? `Health services for the RHU and ${scope.assignedBarangay}.`
            : "RHU-level health services."
        }
        action={
          <button
            onClick={() => {
              setEditingService(null);
              setForm({ ...emptyForm(), barangay: phnDefaultBarangay(user) });
              setErrors({});
              setShowFormModal(true);
            }}
            className="flex items-center gap-2 bg-brand-blue text-white px-4 py-2.5 rounded-btn text-sm font-medium hover:bg-brand-dark transition-colors"
          >
            <Plus className="w-4 h-4" /> Add Health Service
          </button>
        }
      />

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-4 right-4 bg-brand-ink text-white px-4 py-3 rounded-btn shadow-lg flex items-center gap-2 z-50 animate-in slide-in-from-bottom-2">
          <CheckCircle2 className="w-4 h-4 text-brand-green" />
          <span className="text-sm">{toast}</span>
        </div>
      )}

      {/* Filters */}
      <Card className="p-4 mb-5">
        <div className="flex flex-col lg:flex-row gap-4 items-start lg:items-center justify-between">
          <div className="flex items-center gap-2 bg-brand-bg border border-brand-border rounded-btn px-3 py-2 flex-1 max-w-md">
            <Search className="w-4 h-4 text-brand-gray" />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search service..."
              className="bg-transparent text-sm outline-none w-full placeholder:text-brand-gray/70"
            />
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <select
              value={barangayFilter}
              onChange={(e) => setBarangayFilter(e.target.value)}
              className="bg-white border border-brand-border rounded-btn px-3 py-2 text-sm outline-none"
            >
              {filterOptions.map((b) => (
                <option key={b} value={b}>{b === "All" ? "All Scopes" : b === "RHU" ? "RHU" : b}</option>
              ))}
            </select>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="bg-white border border-brand-border rounded-btn px-3 py-2 text-sm outline-none"
            >
              <option value="All">All Statuses</option>
              {SERVICE_STATUSES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
        </div>
      </Card>

      {/* Services Grid */}
      {filtered.length === 0 ? (
        <Card className="p-12 text-center">
          <Activity className="w-12 h-12 text-brand-gray mx-auto mb-4" />
          <p className="text-brand-gray">No health services match the selected filters.</p>
        </Card>
      ) : (
        <div className="grid sm:grid-cols-2 gap-4 sm:gap-5">
          {filtered.map((s) => {
            const style = iconStyle(s.name);
            return (
              <Card key={s.id} className="p-4 sm:p-5 flex flex-col h-full">
                <div className="flex items-start justify-between mb-3 gap-2">
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <div className={`w-10 h-10 rounded-xl ${style.iconBg} flex items-center justify-center shrink-0`}>
                      <style.Icon className={`w-5 h-5 ${style.iconColor}`} strokeWidth={1.8} />
                    </div>
                    <div className="min-w-0">
                      <h3 className="font-semibold text-brand-ink text-sm sm:text-base leading-tight truncate">{s.name}</h3>
                      <p className="text-xs text-brand-gray mt-0.5">{scopeLabel(s, user)} · {s.count}</p>
                    </div>
                  </div>
                  <StatusBadge value={s.status} />
                </div>
                <div className="space-y-1.5 text-sm text-brand-gray flex-1">
                  <p className="flex items-center gap-1.5"><Calendar className="w-3.5 h-3.5" /> {s.date}</p>
                  <p className="flex items-center gap-1.5"><Clock className="w-3.5 h-3.5" /> {s.time}</p>
                  <p className="flex items-center gap-1.5"><User className="w-3.5 h-3.5" /> {s.personnel}</p>
                </div>
                <div className="flex items-center gap-2 mt-4 pt-3 border-t border-brand-border">
                  <button
                    onClick={() => setViewTarget(s)}
                    className="flex-1 px-3 py-1.5 rounded-btn text-xs font-medium text-brand-blue hover:bg-brand-light transition-colors"
                  >
                    View
                  </button>
                  <button
                    onClick={() => openEdit(s)}
                    className="flex-1 px-3 py-1.5 rounded-btn text-xs font-medium text-brand-ink hover:bg-brand-bg border border-brand-border transition-colors"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => setDeleteTarget(s)}
                    className="flex-1 px-3 py-1.5 rounded-btn text-xs font-medium text-brand-danger hover:bg-brand-danger/5 border border-brand-border transition-colors"
                  >
                    Delete
                  </button>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Add / Edit Modal */}
      {showFormModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <Card className="w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-brand-ink">
                  {editingService ? "Edit Health Service" : "Add Health Service"}
                </h3>
                <button
                  onClick={() => setShowFormModal(false)}
                  className="text-brand-gray hover:text-brand-ink"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="space-y-4">
                <div>
                  <label className="text-sm font-medium text-brand-ink block mb-1.5">Service Name <span className="text-brand-danger">*</span></label>
                  <input
                    type="text"
                    placeholder="e.g. Immunization"
                    value={form.name}
                    onChange={(e) => {
                      setForm({ ...form, name: e.target.value });
                      if (errors.name) setErrors((prev) => ({ ...prev, name: "" }));
                    }}
                    className={inputCls(errors.name)}
                  />
                  {errors.name && <p className="text-xs text-brand-danger mt-1">{errors.name}</p>}
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm font-medium text-brand-ink block mb-1.5">Date <span className="text-brand-danger">*</span></label>
                    <input
                      type="date"
                      value={form.date}
                      onChange={(e) => {
                        setForm({ ...form, date: e.target.value });
                        if (errors.date) setErrors((prev) => ({ ...prev, date: "" }));
                      }}
                      className={inputCls(errors.date)}
                    />
                    {errors.date && <p className="text-xs text-brand-danger mt-1">{errors.date}</p>}
                  </div>
                  <div>
                    <label className="text-sm font-medium text-brand-ink block mb-1.5">Time</label>
                    <input
                      type="time"
                      value={form.time}
                      onChange={(e) => setForm({ ...form, time: e.target.value })}
                      className={inputCls()}
                    />
                  </div>
                </div>
                <div>
                  <label className="text-sm font-medium text-brand-ink block mb-1.5">Barangay <span className="text-brand-danger">*</span></label>
                  <select
                    value={form.barangay}
                    onChange={(e) => {
                      setForm({ ...form, barangay: e.target.value });
                      if (errors.barangay) setErrors((prev) => ({ ...prev, barangay: "" }));
                    }}
                    className={inputCls(errors.barangay)}
                  >
                  {writableBarangays.map((b) => (
                    <option key={b} value={b}>{b === "RHU" ? "RHU (no barangay)" : b}</option>
                  ))}
                  </select>
                  {errors.barangay && <p className="text-xs text-brand-danger mt-1">{errors.barangay}</p>}
                </div>
                <div>
                  <label className="text-sm font-medium text-brand-ink block mb-1.5">Assigned Personnel</label>
                  <select
                    value={form.personnel}
                    onChange={(e) => setForm({ ...form, personnel: e.target.value })}
                    className={inputCls()}
                  >
                    <option value="">Unassigned</option>
                    {PERSONNEL_OPTIONS(user).map((p) => (
                      <option key={p} value={p}>{p}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-sm font-medium text-brand-ink block mb-1.5">Status</label>
                  <select
                    value={form.status}
                    onChange={(e) => setForm({ ...form, status: e.target.value })}
                    className={inputCls()}
                  >
                    {SERVICE_STATUSES.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-sm font-medium text-brand-ink block mb-1.5">Notes</label>
                  <textarea
                    rows={3}
                    placeholder="Additional notes..."
                    value={form.notes}
                    onChange={(e) => setForm({ ...form, notes: e.target.value })}
                    className={`${inputCls()} resize-none`}
                  />
                </div>
              </div>
              <div className="flex justify-end gap-3 mt-6">
                <button
                  onClick={() => setShowFormModal(false)}
                  className="px-4 py-2 rounded-btn text-sm font-medium text-brand-gray hover:bg-brand-bg transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={editingService ? handleEdit : handleAdd}
                  className="px-4 py-2 rounded-btn text-sm font-medium bg-brand-blue text-white hover:bg-brand-dark transition-colors"
                >
                  {editingService ? "Save Changes" : "Add Health Service"}
                </button>
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* View Modal */}
      {viewTarget && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <Card className="w-full max-w-md max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex items-center justify-between mb-5">
                <h3 className="text-base font-semibold text-brand-ink">Health Service Details</h3>
                <button onClick={() => setViewTarget(null)} className="text-brand-gray hover:text-brand-ink">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-brand-light text-brand-blue flex items-center justify-center">
                    <Activity className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="font-semibold text-brand-ink">{viewTarget.name}</p>
                    <p className="text-xs text-brand-gray">{viewTarget.id}</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <p className="text-brand-gray flex items-center gap-1.5"><MapPin className="w-3.5 h-3.5" /> <span className="text-brand-ink">{scopeLabel(viewTarget, user)}</span></p>
                  <p className="text-brand-gray flex items-center gap-1.5"><Calendar className="w-3.5 h-3.5" /> <span className="text-brand-ink">{viewTarget.date}</span></p>
                  <p className="text-brand-gray flex items-center gap-1.5"><Clock className="w-3.5 h-3.5" /> <span className="text-brand-ink">{viewTarget.time}</span></p>
                  <p className="text-brand-gray flex items-center gap-1.5"><User className="w-3.5 h-3.5" /> <span className="text-brand-ink">{viewTarget.personnel}</span></p>
                </div>
                <div>
                  <p className="text-xs text-brand-gray mb-1">Status</p>
                  <StatusBadge value={viewTarget.status} />
                </div>
                {viewTarget.notes && (
                  <div>
                    <p className="text-xs text-brand-gray mb-1">Notes</p>
                    <p className="text-sm text-brand-ink">{viewTarget.notes}</p>
                  </div>
                )}
                <div className="pt-4 border-t border-brand-border">
                  <p className="text-xs text-brand-gray mb-2">Update Status</p>
                  <div className="flex flex-wrap gap-2">
                    {SERVICE_STATUSES.map((s) => (
                      <button
                        key={s}
                        onClick={() => handleStatusUpdate(viewTarget, s)}
                        className={`px-3 py-1.5 rounded-btn text-xs font-medium transition-colors ${
                          viewTarget.status === s
                            ? "bg-brand-blue text-white"
                            : "text-brand-gray hover:bg-brand-bg border border-brand-border"
                        }`}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="mt-6 pt-4 border-t border-brand-border flex justify-end gap-3">
                <button
                  onClick={() => setViewTarget(null)}
                  className="px-4 py-2 rounded-btn text-sm font-medium text-brand-gray hover:bg-brand-bg transition-colors"
                >
                  Close
                </button>
                <button
                  onClick={() => {
                    const target = viewTarget;
                    setViewTarget(null);
                    openEdit(target);
                  }}
                  className="px-4 py-2 rounded-btn text-sm font-medium bg-brand-blue text-white hover:bg-brand-dark transition-colors"
                >
                  Edit
                </button>
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteTarget && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <Card className="w-full max-w-md">
            <div className="p-6">
              <div className="flex items-center gap-3 mb-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-danger/10 shrink-0">
                  <Trash2 className="h-5 w-5 text-brand-danger" />
                </div>
                <h3 className="text-lg font-semibold text-brand-ink">Delete this health service?</h3>
              </div>
              <p className="text-sm text-brand-gray">
                {deleteTarget.name} ({scopeLabel(deleteTarget, user)}) will be removed. This action cannot be undone.
              </p>
              <div className="flex justify-end gap-3 mt-6">
                <button
                  onClick={() => setDeleteTarget(null)}
                  className="px-4 py-2 rounded-btn text-sm font-medium text-brand-gray hover:bg-brand-bg transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleConfirmDelete}
                  className="px-4 py-2 rounded-btn text-sm font-medium bg-brand-danger text-white hover:opacity-90 transition-colors"
                >
                  Delete
                </button>
              </div>
            </div>
          </Card>
        </div>
      )}
    </>
  );
}
