import React, { useEffect, useMemo, useState } from "react";
import PageHeader from "@/components/common/PageHeader";
import { Card } from "@/components/common/Card";
import { phnAssessments } from "@/services/mock/mockPhnData";
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
import { Search, Plus, Eye, Edit2, Trash2, X, CheckCircle2, ClipboardList } from "lucide-react";

const STATUS_COLORS = {
  "For Review": "bg-brand-yellow/15 text-[#B07E00]",
  Validated: "bg-brand-green/10 text-brand-green",
  "Needs Update": "bg-brand-danger/10 text-brand-danger",
};

const ASSESSMENT_TYPES = [
  "Prenatal Assessment",
  "Postnatal Assessment",
  "TB Symptom Screening",
  "NCD Risk Assessment",
  "Diabetes Assessment",
  "Growth Monitoring",
  "General Assessment",
];

const ASSESSMENT_STATUSES = ["For Review", "Validated", "Needs Update"];

const emptyForm = () => ({
  resident: "",
  age: "",
  barangay: "",
  date: new Date().toISOString().slice(0, 10),
  type: "General Assessment",
  findings: "",
  assessedBy: "",
  status: "For Review",
  notes: "",
});

export default function PhnAssessments() {
  const { user } = useAuth();
  const scope = getPHNScope(user);
  const phn = isPHN(user);
  const [assessments, setAssessments] = useState(() => filterRowsByScope(phnAssessments, user));
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [barangayFilter, setBarangayFilter] = useState("All");
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showViewModal, setShowViewModal] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [selected, setSelected] = useState(null);
  const [form, setForm] = useState(() => ({ ...emptyForm(), barangay: phnDefaultBarangay(user) }));
  const [errors, setErrors] = useState({});
  const [toast, setToast] = useState(null);

  const filterOptions = phnFilterOptions(user);
  const writableBarangays = phnWritableBarangays(user);

  const showToast = (message) => {
    setToast(message);
    setTimeout(() => setToast(null), 3000);
  };

  const anyModalOpen = showAddModal || showEditModal || showViewModal || showDeleteConfirm;

  useEffect(() => {
    if (!anyModalOpen) return undefined;
    document.body.style.overflow = "hidden";
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      setShowAddModal(false);
      setShowEditModal(false);
      setShowViewModal(false);
      setShowDeleteConfirm(false);
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "";
      document.removeEventListener("keydown", onKey);
    };
  }, [anyModalOpen]);

  const stats = useMemo(
    () => ({
      total: assessments.length,
      forReview: assessments.filter((a) => a.status === "For Review").length,
      validated: assessments.filter((a) => a.status === "Validated").length,
    }),
    [assessments]
  );

  const filtered = assessments.filter((a) => {
    const matchesSearch = searchQuery === "" || a.resident.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = statusFilter === "All" || a.status === statusFilter;
    const matchesBarangay = rowMatchesOption(a, barangayFilter, user);
    return matchesSearch && matchesStatus && matchesBarangay;
  });

  const formatDate = (value) => {
    if (!value) return "";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return value;
    return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  };

  const validate = () => {
    const next = {};
    if (!form.resident.trim()) next.resident = "Resident name is required.";
    if (!form.barangay) next.barangay = "Scope is required.";
    if (!form.type) next.type = "Assessment type is required.";
    if (!form.findings.trim()) next.findings = "Findings are required.";
    if (!form.date) next.date = "Date is required.";
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleAdd = () => {
    if (!validate()) return;
    const newAssessment = {
      id: assessments.reduce((acc, a) => Math.max(acc, a.id || 0), 0) + 1,
      resident: form.resident.trim(),
      age: form.age ? Number(form.age) : undefined,
      barangay: normalizeBarangay(form.barangay),
      date: formatDate(form.date),
      type: form.type,
      findings: form.findings.trim(),
      assessedBy: form.assessedBy.trim() || user?.name || "PHN",
      status: form.status,
      notes: form.notes.trim(),
    };
    setAssessments([newAssessment, ...assessments]);
    setShowAddModal(false);
    setForm({ ...emptyForm(), barangay: phnDefaultBarangay(user) });
    setErrors({});
    showToast("Assessment added successfully.");
  };

  const openEdit = (a) => {
    setSelected(a);
    setForm({
      resident: a.resident,
      age: a.age !== undefined ? String(a.age) : "",
      barangay: a.barangay || "RHU",
      date: a.date,
      type: a.type,
      findings: a.findings,
      assessedBy: a.assessedBy,
      status: a.status,
      notes: a.notes || "",
    });
    setErrors({});
    setShowEditModal(true);
  };

  const handleEdit = () => {
    if (!validate()) return;
    setAssessments((prev) =>
      prev.map((a) =>
        a.id === selected.id
          ? { ...a, ...form, resident: form.resident.trim(), barangay: normalizeBarangay(form.barangay), findings: form.findings.trim(), notes: form.notes.trim(), date: form.date }
          : a
      )
    );
    setShowEditModal(false);
    setSelected(null);
    setForm({ ...emptyForm(), barangay: phnDefaultBarangay(user) });
    setErrors({});
    showToast("Assessment updated successfully.");
  };

  const handleConfirmDelete = () => {
    setAssessments((prev) => prev.filter((a) => a.id !== selected.id));
    setShowDeleteConfirm(false);
    setSelected(null);
    showToast("Assessment deleted successfully.");
  };

  const handleStatusUpdate = (assessment, status) => {
    setAssessments((prev) => prev.map((a) => (a.id === assessment.id ? { ...a, status } : a)));
    if (selected && selected.id === assessment.id) {
      setSelected({ ...selected, status });
    }
    showToast("Assessment status updated successfully.");
  };

  const formFields = (
    <>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="text-sm font-medium text-brand-ink block mb-1.5">Resident <span className="text-brand-danger">*</span></label>
          <input
            type="text"
            placeholder="Resident name..."
            value={form.resident}
            onChange={(e) => {
              setForm({ ...form, resident: e.target.value });
              if (errors.resident) setErrors((prev) => ({ ...prev, resident: "" }));
            }}
            className={`w-full bg-white border rounded-btn px-3 py-2.5 text-sm outline-none focus:border-brand-blue ${
              errors.resident ? "border-brand-danger" : "border-brand-border"
            }`}
          />
          {errors.resident && <p className="text-xs text-brand-danger mt-1">{errors.resident}</p>}
        </div>
        <div>
          <label className="text-sm font-medium text-brand-ink block mb-1.5">Age</label>
          <input
            type="number"
            min="0"
            placeholder="Age..."
            value={form.age}
            onChange={(e) => setForm({ ...form, age: e.target.value })}
            className="w-full bg-white border border-brand-border rounded-btn px-3 py-2.5 text-sm outline-none focus:border-brand-blue"
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
            className={`w-full bg-white border rounded-btn px-3 py-2.5 text-sm outline-none focus:border-brand-blue ${
              errors.date ? "border-brand-danger" : "border-brand-border"
            }`}
          />
          {errors.date && <p className="text-xs text-brand-danger mt-1">{errors.date}</p>}
        </div>
        <div>
          <label className="text-sm font-medium text-brand-ink block mb-1.5">Assessment Type <span className="text-brand-danger">*</span></label>
          <select
            value={form.type}
            onChange={(e) => setForm({ ...form, type: e.target.value })}
            className="w-full bg-white border border-brand-border rounded-btn px-3 py-2.5 text-sm outline-none focus:border-brand-blue"
          >
            {ASSESSMENT_TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>
      </div>
      <div>
        <label className="text-sm font-medium text-brand-ink block mb-1.5">Findings <span className="text-brand-danger">*</span></label>
        <textarea
          rows={3}
          placeholder="Assessment findings..."
          value={form.findings}
          onChange={(e) => {
            setForm({ ...form, findings: e.target.value });
            if (errors.findings) setErrors((prev) => ({ ...prev, findings: "" }));
          }}
          className={`w-full bg-white border rounded-btn px-3 py-2.5 text-sm outline-none focus:border-brand-blue resize-none ${
            errors.findings ? "border-brand-danger" : "border-brand-border"
          }`}
        />
        {errors.findings && <p className="text-xs text-brand-danger mt-1">{errors.findings}</p>}
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="text-sm font-medium text-brand-ink block mb-1.5">Assessed By</label>
          <input
            type="text"
            placeholder="Personnel name..."
            value={form.assessedBy}
            onChange={(e) => setForm({ ...form, assessedBy: e.target.value })}
            className="w-full bg-white border border-brand-border rounded-btn px-3 py-2.5 text-sm outline-none focus:border-brand-blue"
          />
        </div>
        <div>
          <label className="text-sm font-medium text-brand-ink block mb-1.5">Status</label>
          <select
            value={form.status}
            onChange={(e) => setForm({ ...form, status: e.target.value })}
            className="w-full bg-white border border-brand-border rounded-btn px-3 py-2.5 text-sm outline-none focus:border-brand-blue"
          >
            {ASSESSMENT_STATUSES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
      </div>
      <div>
        <label className="text-sm font-medium text-brand-ink block mb-1.5">Notes</label>
        <textarea
          rows={2}
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
        crumbs={["Home", "Assessments"]}
        title="Assessment Review"
        subtitle={
          phn && scope && scope.level === "barangay"
            ? `Review assessments for RHU-level residents and ${scope.assignedBarangay}.`
            : "Review RHU-level assessments."
        }
        action={
          <button
            onClick={() => {
              setForm({ ...emptyForm(), barangay: phnDefaultBarangay(user) });
              setErrors({});
              setShowAddModal(true);
            }}
            className="flex items-center gap-2 bg-brand-blue text-white px-4 py-2.5 rounded-btn text-sm font-medium hover:bg-brand-dark transition-colors"
          >
            <Plus className="w-4 h-4" /> Add Assessment
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
      <div className="grid sm:grid-cols-3 gap-4 mb-6">
        {[
          { label: "Total Assessments", value: stats.total, tone: "bg-brand-blue/10 text-brand-blue" },
          { label: "For Review", value: stats.forReview, tone: "bg-brand-yellow/15 text-[#B07E00]" },
          { label: "Validated", value: stats.validated, tone: "bg-brand-green/10 text-brand-green" },
        ].map((stat) => (
          <Card key={stat.label} className="p-5">
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${stat.tone}`}>
                <ClipboardList className="w-5 h-5" />
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
                <option key={b} value={b}>{b === "All" ? "All Scopes" : b}</option>
              ))}
            </select>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="bg-white border border-brand-border rounded-btn px-3 py-2 text-sm outline-none"
            >
              <option value="All">All Statuses</option>
              {ASSESSMENT_STATUSES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
        </div>
      </Card>

      {/* Assessment Table */}
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-brand-bg border-b border-brand-border">
              <tr>
                <th className="text-left text-xs font-semibold text-brand-gray uppercase tracking-wide px-4 py-3">Resident</th>
                <th className="text-left text-xs font-semibold text-brand-gray uppercase tracking-wide px-4 py-3">Barangay</th>
                <th className="text-left text-xs font-semibold text-brand-gray uppercase tracking-wide px-4 py-3">Date</th>
                <th className="text-left text-xs font-semibold text-brand-gray uppercase tracking-wide px-4 py-3">Type</th>
                <th className="text-left text-xs font-semibold text-brand-gray uppercase tracking-wide px-4 py-3">Findings</th>
                <th className="text-left text-xs font-semibold text-brand-gray uppercase tracking-wide px-4 py-3">Assessed By</th>
                <th className="text-left text-xs font-semibold text-brand-gray uppercase tracking-wide px-4 py-3">Status</th>
                <th className="text-left text-xs font-semibold text-brand-gray uppercase tracking-wide px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((a) => (
                <tr key={a.id} className="border-b border-brand-border hover:bg-brand-bg/50 transition-colors">
                  <td className="px-4 py-3 text-sm font-medium text-brand-ink">{a.resident}</td>
                  <td className="px-4 py-3 text-sm text-brand-ink">{scopeLabel(a, user)}</td>
                  <td className="px-4 py-3 text-sm text-brand-ink whitespace-nowrap">{a.date}</td>
                  <td className="px-4 py-3 text-sm text-brand-ink">{a.type}</td>
                  <td className="px-4 py-3 text-sm text-brand-ink max-w-[220px]">
                    <span className="block truncate" title={a.findings}>{a.findings}</span>
                  </td>
                  <td className="px-4 py-3 text-sm text-brand-ink">{a.assessedBy}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${STATUS_COLORS[a.status]}`}>{a.status}</span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => {
                          setSelected(a);
                          setShowViewModal(true);
                        }}
                        className="p-1.5 text-brand-blue hover:bg-brand-light rounded transition-colors"
                        title="View"
                      >
                        <Eye className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => openEdit(a)}
                        className="p-1.5 text-brand-blue hover:bg-brand-light rounded transition-colors"
                        title="Edit"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => {
                          setSelected(a);
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
                    No assessments match the selected filters.
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
                <h3 className="text-lg font-semibold text-brand-ink">{showAddModal ? "Add Assessment" : "Edit Assessment"}</h3>
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
                  {showAddModal ? "Add Assessment" : "Save Changes"}
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
                <h3 className="text-base font-semibold text-brand-ink">Assessment Details</h3>
                <button onClick={() => setShowViewModal(false)} className="text-brand-gray hover:text-brand-ink">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="space-y-4">
                <div>
                  <h4 className="text-xs font-semibold text-brand-gray uppercase tracking-wide mb-3">Resident</h4>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <p className="text-brand-gray">Name: <span className="text-brand-ink">{selected.resident}</span></p>
                    {selected.age !== undefined && (
                      <p className="text-brand-gray">Age: <span className="text-brand-ink">{selected.age}</span></p>
                    )}
                    <p className="text-brand-gray">Barangay: <span className="text-brand-ink">{scopeLabel(selected, user)}</span></p>
                  </div>
                </div>
                <div>
                  <h4 className="text-xs font-semibold text-brand-gray uppercase tracking-wide mb-3">Assessment</h4>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <p className="text-brand-gray">Type: <span className="text-brand-ink">{selected.type}</span></p>
                    <p className="text-brand-gray">Date: <span className="text-brand-ink">{selected.date}</span></p>
                    <p className="text-brand-gray">Assessed by: <span className="text-brand-ink">{selected.assessedBy}</span></p>
                    <p className="text-brand-gray">Status: <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[selected.status]}`}>{selected.status}</span></p>
                  </div>
                </div>
                <div>
                  <p className="text-xs text-brand-gray mb-1">Findings</p>
                  <p className="text-sm text-brand-ink">{selected.findings}</p>
                </div>
                {selected.notes && (
                  <div>
                    <p className="text-xs text-brand-gray mb-1">Notes</p>
                    <p className="text-sm text-brand-ink">{selected.notes}</p>
                  </div>
                )}
                <div className="pt-4 border-t border-brand-border">
                  <p className="text-xs text-brand-gray mb-2">Update Status</p>
                  <div className="flex gap-2">
                    {ASSESSMENT_STATUSES.map((s) => (
                      <button
                        key={s}
                        onClick={() => handleStatusUpdate(selected, s)}
                        className={`px-3 py-1.5 rounded-btn text-xs font-medium transition-colors ${
                          selected.status === s
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

      {/* Delete Confirmation */}
      {showDeleteConfirm && selected && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <Card className="w-full max-w-md">
            <div className="p-6">
              <div className="flex items-center gap-3 mb-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-danger/10 shrink-0">
                  <Trash2 className="h-5 w-5 text-brand-danger" />
                </div>
                <h3 className="text-lg font-semibold text-brand-ink">Delete this assessment?</h3>
              </div>
              <p className="text-sm text-brand-gray">
                Assessment for {selected.resident} ({scopeLabel(selected, user)}) will be removed. This action cannot be undone.
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
