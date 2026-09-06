import React, { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import PageHeader from "@/components/common/PageHeader";
import { Card } from "@/components/common/Card";
import { FOLLOWUP_STATUSES, phnResidents } from "@/services/mock/mockPhnData";
import {
  useWorkflowStore,
  addFollowUp,
  patchFollowUp,
  removeFollowUp,
} from "@/services/mock/mockWorkflowStore";
import {
  filterRowsByScope,
  isPHN,
  normalizeBarangay,
  phnDefaultBarangay,
  phnFilterOptions,
  phnWritableBarangays,
  rowMatchesOption,
  scopeLabel,
} from "@/lib/phnScope";
import { useAuth } from "@/context/AuthContext";
import { Search, Plus, Eye, Edit2, Trash2, RefreshCw, X, CheckCircle2, Calendar, Clock } from "lucide-react";

const STATUS_COLORS = {
  Scheduled: "bg-brand-blue/10 text-brand-blue",
  "Due Today": "bg-brand-accent/10 text-brand-accent",
  Overdue: "bg-brand-danger/10 text-brand-danger",
  Completed: "bg-brand-green/10 text-brand-green",
  Cancelled: "bg-brand-gray/10 text-brand-gray",
};

const PRIORITY_COLORS = {
  High: "bg-brand-danger/10 text-brand-danger",
  Medium: "bg-brand-yellow/15 text-[#B07E00]",
  Low: "bg-brand-green/10 text-brand-green",
};

const emptyForm = () => ({
  resident: "",
  barangay: "",
  purpose: "",
  dueDate: "Today",
  time: "09:00",
  assignedTo: "",
  priority: "Medium",
  status: "Scheduled",
  notes: "",
});

export default function PhnFollowUps() {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const phn = isPHN(user);
  const workflow = useWorkflowStore();
  // Shared workflow store so a follow-up scheduled from a completed check-up
  // immediately reflects on the dashboard counts and mock state.
  const followUps = useMemo(
    () => filterRowsByScope(workflow.followUps, user),
    [workflow.followUps, user]
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [barangayFilter, setBarangayFilter] = useState("All");
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showViewModal, setShowViewModal] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showStatusModal, setShowStatusModal] = useState(false);
  const [selected, setSelected] = useState(null);
  const [form, setForm] = useState(() => ({ ...emptyForm(), barangay: phnDefaultBarangay(user) }));
  const [errors, setErrors] = useState({});
  const [newStatus, setNewStatus] = useState("");
  const [toast, setToast] = useState(null);
  const [fromCheckupDraft, setFromCheckupDraft] = useState(false);

  const filterOptions = phnFilterOptions(user);
  const writableBarangays = phnWritableBarangays(user);

  const showToast = (message) => {
    setToast(message);
    setTimeout(() => setToast(null), 3000);
  };

  // "Schedule Follow-up" from a completed check-up pre-fills the patient and
  // relevant check-up information.
  useEffect(() => {
    const draft = location.state?.followUpDraft;
    if (!draft) return undefined;
    const notes = [
      draft.consultationLocation ? `Consultation Location: ${draft.consultationLocation}` : "",
      draft.reason ? `Reason for visit: ${draft.reason}` : "",
      draft.findings ? `PHN findings: ${draft.findings}` : "",
      draft.recommendations ? `Recommendations: ${draft.recommendations}` : "",
    ]
      .filter(Boolean)
      .join("\n");
    setForm({
      resident: draft.resident || "",
      barangay: draft.barangay || phnDefaultBarangay(user),
      purpose: "Follow-up after PHN check-up",
      dueDate: "Today",
      time: "09:00",
      assignedTo: user?.name || "PHN",
      priority: draft.riskLevel || "Medium",
      status: "Scheduled",
      notes,
    });
    setErrors({});
    setFromCheckupDraft(true);
    setShowAddModal(true);
    navigate(location.pathname, { replace: true, state: null });
    return undefined;
  }, [location.state, location.pathname, navigate, user]);

  const anyModalOpen = showAddModal || showEditModal || showViewModal || showDeleteConfirm || showStatusModal;

  useEffect(() => {
    if (!anyModalOpen) return undefined;
    document.body.style.overflow = "hidden";
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      setShowAddModal(false);
      setShowEditModal(false);
      setShowViewModal(false);
      setShowDeleteConfirm(false);
      setShowStatusModal(false);
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "";
      document.removeEventListener("keydown", onKey);
    };
  }, [anyModalOpen]);

  const stats = useMemo(
    () => ({
      dueToday: followUps.filter((f) => f.status === "Due Today").length,
      overdue: followUps.filter((f) => f.status === "Overdue").length,
      scheduled: followUps.filter((f) => f.status === "Scheduled").length,
      completed: followUps.filter((f) => f.status === "Completed").length,
    }),
    [followUps]
  );

  const filtered = followUps.filter((f) => {
    const matchesSearch = searchQuery === "" || f.resident.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = statusFilter === "All" || f.status === statusFilter;
    const matchesBarangay = rowMatchesOption(f, barangayFilter, user);
    return matchesSearch && matchesStatus && matchesBarangay;
  });

  const validate = () => {
    const next = {};
    if (!form.resident.trim()) next.resident = "Resident name is required.";
    if (!form.barangay) next.barangay = "Barangay is required.";
    if (!form.purpose.trim()) next.purpose = "Purpose is required.";
    if (!form.dueDate.trim()) next.dueDate = "Due date is required.";
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleAdd = () => {
    if (!validate()) return;
    const baseIdList = workflow.followUps;
    const newFollowUp = {
      id: baseIdList.reduce((acc, f) => Math.max(acc, f.id || 0), 0) + 1,
      resident: form.resident.trim(),
      barangay: normalizeBarangay(form.barangay),
      purpose: form.purpose.trim(),
      dueDate: form.dueDate,
      time: formatTime(form.time),
      assignedTo: form.assignedTo || user?.name || "Unassigned",
      priority: form.priority,
      status: form.status,
      notes: form.notes.trim(),
    };
    addFollowUp(newFollowUp);
    setShowAddModal(false);
    setForm({ ...emptyForm(), barangay: phnDefaultBarangay(user) });
    setErrors({});
    showToast(fromCheckupDraft ? "Follow-up scheduled successfully." : "Follow-up added successfully.");
    setFromCheckupDraft(false);
  };

  const openEdit = (f) => {
    setSelected(f);
    setForm({
      resident: f.resident,
      barangay: f.barangay || "RHU",
      purpose: f.purpose,
      dueDate: f.dueDate,
      time: f.time,
      assignedTo: f.assignedTo,
      priority: f.priority,
      status: f.status,
      notes: f.notes || "",
    });
    setErrors({});
    setShowEditModal(true);
  };

  const handleEdit = () => {
    if (!validate()) return;
    patchFollowUp(selected.id, {
      ...form,
      barangay: normalizeBarangay(form.barangay),
      notes: form.notes.trim(),
    });
    setShowEditModal(false);
    setSelected(null);
    setForm({ ...emptyForm(), barangay: phnDefaultBarangay(user) });
    setErrors({});
    showToast("Follow-up updated successfully.");
  };

  const handleConfirmDelete = () => {
    removeFollowUp(selected.id);
    setShowDeleteConfirm(false);
    setSelected(null);
    showToast("Follow-up deleted successfully.");
  };

  const handleStatusUpdate = () => {
    patchFollowUp(selected.id, { status: newStatus });
    setShowStatusModal(false);
    setSelected(null);
    showToast("Follow-up status updated successfully.");
  };

  const formatTime = (hhmm) => {
    if (!hhmm || !hhmm.includes(":")) return hhmm;
    const [h, m] = hhmm.split(":");
    const hour = parseInt(h, 10);
    const ampm = hour >= 12 ? "PM" : "AM";
    const hr12 = hour % 12 === 0 ? 12 : hour % 12;
    return `${hr12}:${m} ${ampm}`;
  };

  const residentOptions = Array.from(
    new Set([
      ...filterRowsByScope(phnResidents, user).map((r) => r.name),
      ...followUps.map((f) => f.resident),
    ])
  ).sort();

  const personnelOptions = [
    user?.name || "PHN",
    "Midwife M. Dela Cruz",
    "BHW L. Ramos",
    "BHW G. Aquino",
  ];

  const formFields = (
    <>
      <div>
        <label className="text-sm font-medium text-brand-ink block mb-1.5">Resident <span className="text-brand-danger">*</span></label>
        <input
          type="text"
          list="phn-followup-residents"
          placeholder="Enter resident name..."
          value={form.resident}
          onChange={(e) => {
            setForm({ ...form, resident: e.target.value });
            if (errors.resident) setErrors((prev) => ({ ...prev, resident: "" }));
          }}
          className={`w-full bg-white border rounded-btn px-3 py-2.5 text-sm outline-none focus:border-brand-blue ${
            errors.resident ? "border-brand-danger" : "border-brand-border"
          }`}
        />
        <datalist id="phn-followup-residents">
          {residentOptions.map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>
        {errors.resident && <p className="text-xs text-brand-danger mt-1">{errors.resident}</p>}
      </div>
      <div>
        <label className="text-sm font-medium text-brand-ink block mb-1.5">Barangay <span className="text-brand-danger">*</span></label>
        <select
          value={form.barangay}
          onChange={(e) => {
            setForm({ ...form, barangay: e.target.value });
            if (errors.barangay) setErrors((prev) => ({ ...prev, barangay: "" }));
          }}
          className={`w-full bg-white border rounded-btn px-3 py-2.5 text-sm outline-none focus:border-brand-blue ${
            errors.barangay ? "border-brand-danger" : "border-brand-border"
          }`}
        >
          {writableBarangays.map((b) => (
            <option key={b} value={b}>{b === "RHU" ? "RHU (no barangay)" : b}</option>
          ))}
        </select>
        {errors.barangay && <p className="text-xs text-brand-danger mt-1">{errors.barangay}</p>}
      </div>
      <div>
        <label className="text-sm font-medium text-brand-ink block mb-1.5">Purpose <span className="text-brand-danger">*</span></label>
        <input
          type="text"
          placeholder="e.g. Maternal Follow-up"
          value={form.purpose}
          onChange={(e) => {
            setForm({ ...form, purpose: e.target.value });
            if (errors.purpose) setErrors((prev) => ({ ...prev, purpose: "" }));
          }}
          className={`w-full bg-white border rounded-btn px-3 py-2.5 text-sm outline-none focus:border-brand-blue ${
            errors.purpose ? "border-brand-danger" : "border-brand-border"
          }`}
        />
        {errors.purpose && <p className="text-xs text-brand-danger mt-1">{errors.purpose}</p>}
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="text-sm font-medium text-brand-ink block mb-1.5">Due Date <span className="text-brand-danger">*</span></label>
          <input
            type="text"
            placeholder="Today, Tomorrow, or a date"
            value={form.dueDate}
            onChange={(e) => {
              setForm({ ...form, dueDate: e.target.value });
              if (errors.dueDate) setErrors((prev) => ({ ...prev, dueDate: "" }));
            }}
            className={`w-full bg-white border rounded-btn px-3 py-2.5 text-sm outline-none focus:border-brand-blue ${
              errors.dueDate ? "border-brand-danger" : "border-brand-border"
            }`}
          />
          {errors.dueDate && <p className="text-xs text-brand-danger mt-1">{errors.dueDate}</p>}
        </div>
        <div>
          <label className="text-sm font-medium text-brand-ink block mb-1.5">Time</label>
          <input
            type="time"
            value={form.time}
            onChange={(e) => setForm({ ...form, time: e.target.value })}
            className="w-full bg-white border border-brand-border rounded-btn px-3 py-2.5 text-sm outline-none focus:border-brand-blue"
          />
        </div>
      </div>
      <div>
        <label className="text-sm font-medium text-brand-ink block mb-1.5">Assigned Personnel</label>
        <select
          value={form.assignedTo}
          onChange={(e) => setForm({ ...form, assignedTo: e.target.value })}
          className="w-full bg-white border border-brand-border rounded-btn px-3 py-2.5 text-sm outline-none focus:border-brand-blue"
        >
          <option value="">Unassigned</option>
          {personnelOptions.map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="text-sm font-medium text-brand-ink block mb-1.5">Priority</label>
          <select
            value={form.priority}
            onChange={(e) => setForm({ ...form, priority: e.target.value })}
            className="w-full bg-white border border-brand-border rounded-btn px-3 py-2.5 text-sm outline-none focus:border-brand-blue"
          >
            <option>High</option>
            <option>Medium</option>
            <option>Low</option>
          </select>
        </div>
        <div>
          <label className="text-sm font-medium text-brand-ink block mb-1.5">Status</label>
          <select
            value={form.status}
            onChange={(e) => setForm({ ...form, status: e.target.value })}
            className="w-full bg-white border border-brand-border rounded-btn px-3 py-2.5 text-sm outline-none focus:border-brand-blue"
          >
            {FOLLOWUP_STATUSES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
      </div>
      <div>
        <label className="text-sm font-medium text-brand-ink block mb-1.5">Notes</label>
        <textarea
          rows={3}
          placeholder="Additional notes..."
          value={form.notes}
          onChange={(e) => setForm({ ...form, notes: e.target.value })}
          className="w-full bg-white border border-brand-border rounded-btn px-3 py-2.5 text-sm outline-none focus:border-brand-blue resize-none"
        />
      </div>
    </>
  );

  return (
    <>
      <PageHeader
        crumbs={["Home", "Follow-ups"]}
        title="Follow-up Monitoring"
        subtitle={phn ? "Monitor follow-ups within your assigned coverage." : "Monitor RHU-level follow-ups."}
        action={
          <button
            onClick={() => {
              setForm({ ...emptyForm(), barangay: phnDefaultBarangay(user) });
              setErrors({});
              setFromCheckupDraft(false);
              setShowAddModal(true);
            }}
            className="flex items-center gap-2 bg-brand-blue text-white px-4 py-2.5 rounded-btn text-sm font-medium hover:bg-brand-dark transition-colors"
          >
            <Plus className="w-4 h-4" /> Add Follow-up
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

      {/* Summary Cards */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {[
          { label: "Due Today", value: stats.dueToday, icon: Clock, tone: "bg-brand-accent/10 text-brand-accent" },
          { label: "Overdue", value: stats.overdue, icon: X, tone: "bg-brand-danger/10 text-brand-danger" },
          { label: "Scheduled", value: stats.scheduled, icon: Calendar, tone: "bg-brand-blue/10 text-brand-blue" },
          { label: "Completed", value: stats.completed, icon: CheckCircle2, tone: "bg-brand-green/10 text-brand-green" },
        ].map((stat) => (
          <Card key={stat.label} className="p-5">
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${stat.tone}`}>
                <stat.icon className="w-5 h-5" />
              </div>
              <div>
                <p className="text-sm text-brand-gray">{stat.label}</p>
                <p className="text-2xl font-semibold text-brand-ink mt-0.5">{stat.value}</p>
              </div>
            </div>
          </Card>
        ))}
      </div>

      {/* Filters */}
      <Card className="p-4 mb-5">
        <div className="flex flex-col lg:flex-row gap-4 items-start lg:items-center justify-between">
          <div className="flex items-center gap-2 bg-brand-bg border border-brand-border rounded-btn px-3 py-2 flex-1 max-w-md">
            <Search className="w-4 h-4 text-brand-gray" />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search resident..."
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
                <option key={b} value={b}>{b === "All" ? "All Accessible" : b === "RHU" ? "RHU-level" : b}</option>
              ))}
            </select>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="bg-white border border-brand-border rounded-btn px-3 py-2 text-sm outline-none"
            >
              <option value="All">All Statuses</option>
              {FOLLOWUP_STATUSES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
        </div>
      </Card>

      {/* Follow-up Table */}
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-brand-bg border-b border-brand-border">
              <tr>
                <th className="text-left text-xs font-semibold text-brand-gray uppercase tracking-wide px-4 py-3">Resident</th>
                <th className="text-left text-xs font-semibold text-brand-gray uppercase tracking-wide px-4 py-3">Barangay</th>
                <th className="text-left text-xs font-semibold text-brand-gray uppercase tracking-wide px-4 py-3">Purpose</th>
                <th className="text-left text-xs font-semibold text-brand-gray uppercase tracking-wide px-4 py-3">Due Date</th>
                <th className="text-left text-xs font-semibold text-brand-gray uppercase tracking-wide px-4 py-3">Assigned To</th>
                <th className="text-left text-xs font-semibold text-brand-gray uppercase tracking-wide px-4 py-3">Priority</th>
                <th className="text-left text-xs font-semibold text-brand-gray uppercase tracking-wide px-4 py-3">Status</th>
                <th className="text-left text-xs font-semibold text-brand-gray uppercase tracking-wide px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((f) => (
                <tr key={f.id} className="border-b border-brand-border hover:bg-brand-bg/50 transition-colors">
                  <td className="px-4 py-3 text-sm font-medium text-brand-ink">{f.resident}</td>
                  <td className="px-4 py-3 text-sm text-brand-ink">{scopeLabel(f, user)}</td>
                  <td className="px-4 py-3 text-sm text-brand-ink">{f.purpose}</td>
                  <td className="px-4 py-3">
                    <div className="text-sm text-brand-ink">{f.dueDate}</div>
                    <div className="text-xs text-brand-gray">{f.time}</div>
                  </td>
                  <td className="px-4 py-3 text-sm text-brand-ink">{f.assignedTo}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${PRIORITY_COLORS[f.priority]}`}>{f.priority}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${STATUS_COLORS[f.status]}`}>{f.status}</span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => {
                          setSelected(f);
                          setShowViewModal(true);
                        }}
                        className="p-1.5 text-brand-blue hover:bg-brand-light rounded transition-colors"
                        title="View"
                      >
                        <Eye className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => openEdit(f)}
                        className="p-1.5 text-brand-blue hover:bg-brand-light rounded transition-colors"
                        title="Edit"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => {
                          setSelected(f);
                          setNewStatus(f.status);
                          setShowStatusModal(true);
                        }}
                        className="p-1.5 text-brand-blue hover:bg-brand-light rounded transition-colors"
                        title="Update Status"
                      >
                        <RefreshCw className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => {
                          setSelected(f);
                          setShowDeleteConfirm(true);
                        }}
                        className="p-1.5 text-brand-danger hover:bg-brand-danger/10 rounded transition-colors"
                        title="Delete"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-sm text-brand-gray">
                    No follow-ups match the selected filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Add / Edit Modal */}
      {(showAddModal || showEditModal) && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <Card className="w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-brand-ink">{showAddModal ? "Add Follow-up" : "Edit Follow-up"}</h3>
                <button
                  onClick={() => {
                    setShowAddModal(false);
                    setShowEditModal(false);
                    setErrors({});
                  }}
                  className="text-brand-gray hover:text-brand-ink"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="space-y-4">{formFields}</div>
              <div className="flex justify-end gap-3 mt-6">
                <button
                  onClick={() => {
                    setShowAddModal(false);
                    setShowEditModal(false);
                    setErrors({});
                  }}
                  className="px-4 py-2 rounded-btn text-sm font-medium text-brand-gray hover:bg-brand-bg transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={showAddModal ? handleAdd : handleEdit}
                  className="px-4 py-2 rounded-btn text-sm font-medium bg-brand-blue text-white hover:bg-brand-dark transition-colors"
                >
                  {showAddModal ? "Add Follow-up" : "Save Changes"}
                </button>
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* View Modal */}
      {showViewModal && selected && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <Card className="w-full max-w-md max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex items-center justify-between mb-5">
                <h3 className="text-base font-semibold text-brand-ink">Follow-up Details</h3>
                <button onClick={() => setShowViewModal(false)} className="text-brand-gray hover:text-brand-ink">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="space-y-4">
                <div>
                  <h4 className="text-xs font-semibold text-brand-gray uppercase tracking-wide mb-3">Resident</h4>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <p className="text-brand-gray">Name: <span className="text-brand-ink">{selected.resident}</span></p>
                    <p className="text-brand-gray">Barangay: <span className="text-brand-ink">{scopeLabel(selected, user)}</span></p>
                  </div>
                </div>
                <div>
                  <h4 className="text-xs font-semibold text-brand-gray uppercase tracking-wide mb-3">Follow-up Information</h4>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <p className="text-brand-gray">Purpose: <span className="text-brand-ink">{selected.purpose}</span></p>
                    <p className="text-brand-gray">Due: <span className="text-brand-ink">{selected.dueDate} · {selected.time}</span></p>
                    <p className="text-brand-gray">Assigned to: <span className="text-brand-ink">{selected.assignedTo}</span></p>
                    <p className="text-brand-gray">Priority: <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${PRIORITY_COLORS[selected.priority]}`}>{selected.priority}</span></p>
                  </div>
                </div>
                <div>
                  <p className="text-xs text-brand-gray mb-1">Status</p>
                  <span className={`px-2 py-1 rounded-full text-xs font-medium ${STATUS_COLORS[selected.status]}`}>{selected.status}</span>
                </div>
                {selected.notes && (
                  <div>
                    <p className="text-xs text-brand-gray mb-1">Notes</p>
                    <p className="text-sm text-brand-ink">{selected.notes}</p>
                  </div>
                )}
              </div>
              <div className="mt-6 pt-4 border-t border-brand-border flex justify-end gap-3">
                <button
                  onClick={() => setShowViewModal(false)}
                  className="px-4 py-2 rounded-btn text-sm font-medium text-brand-gray hover:bg-brand-bg transition-colors"
                >
                  Close
                </button>
                <button
                  onClick={() => {
                    setShowViewModal(false);
                    openEdit(selected);
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

      {/* Status Update Modal */}
      {showStatusModal && selected && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <Card className="w-full max-w-md">
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-brand-ink">Update Status</h3>
                <button onClick={() => setShowStatusModal(false)} className="text-brand-gray hover:text-brand-ink">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="space-y-4">
                <div>
                  <p className="text-sm text-brand-gray mb-1">Follow-up</p>
                  <p className="text-sm font-medium text-brand-ink">{selected.resident} — {selected.purpose}</p>
                </div>
                <div>
                  <p className="text-sm text-brand-gray mb-1">Current Status</p>
                  <span className={`px-2 py-1 rounded-full text-xs font-medium ${STATUS_COLORS[selected.status]}`}>{selected.status}</span>
                </div>
                <div>
                  <label className="text-sm font-medium text-brand-ink block mb-1.5">New Status</label>
                  <select
                    value={newStatus}
                    onChange={(e) => setNewStatus(e.target.value)}
                    className="w-full bg-white border border-brand-border rounded-btn px-3 py-2.5 text-sm outline-none focus:border-brand-blue"
                  >
                    {FOLLOWUP_STATUSES.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="flex justify-end gap-3 mt-6">
                <button
                  onClick={() => setShowStatusModal(false)}
                  className="px-4 py-2 rounded-btn text-sm font-medium text-brand-gray hover:bg-brand-bg transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleStatusUpdate}
                  className="px-4 py-2 rounded-btn text-sm font-medium bg-brand-blue text-white hover:bg-brand-dark transition-colors"
                >
                  Update
                </button>
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* Delete Confirmation */}
      {showDeleteConfirm && selected && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <Card className="w-full max-w-md">
            <div className="p-6">
              <div className="flex items-center gap-3 mb-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-danger/10 shrink-0">
                  <Trash2 className="h-5 w-5 text-brand-danger" />
                </div>
                <h3 className="text-lg font-semibold text-brand-ink">Delete this follow-up?</h3>
              </div>
              <p className="text-sm text-brand-gray">
                Follow-up for {selected.resident} ({scopeLabel(selected, user)}) will be removed. This action cannot be undone.
              </p>
              <div className="flex justify-end gap-3 mt-6">
                <button
                  onClick={() => setShowDeleteConfirm(false)}
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
