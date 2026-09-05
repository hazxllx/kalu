import React, { useEffect, useMemo, useState } from "react";
import PageHeader from "@/components/common/PageHeader";
import { Card } from "@/components/common/Card";
import { phnResidents } from "@/services/mock/mockPhnData";
import {
  filterRowsByScope,
  getPHNScope,
  isPHN,
  normalizeBarangay,
  phnDefaultBarangay,
  phnFilterOptions,
  phnWritableBarangays,
  scopeLabel,
} from "@/lib/phnScope";
import { useAuth } from "@/context/AuthContext";
import { Search, Plus, Eye, Edit2, Trash2, X, CheckCircle2 } from "lucide-react";

const LAST_VISITS = [
  "September 5, 2026",
  "September 3, 2026",
  "September 2, 2026",
  "September 1, 2026",
  "August 30, 2026",
  "August 28, 2026",
];

// Health records are derived from the resident registry so the scope of each
// row always matches the resident's scope (null = RHU-level resident).
const RECORDS = phnResidents.map((r, i) => ({
  id: i + 1,
  recordNo: `HR-2026-${String(110 + i).padStart(4, "0")}`,
  resident: r.name,
  age: r.age,
  sex: r.gender,
  barangay: r.barangay,
  program: r.program,
  lastVisit: LAST_VISITS[i % LAST_VISITS.length],
  risk: r.risk,
  status: r.status === "Active" ? "Active" : "Inactive",
  notes: "Routine monitoring record.",
}));

const RISK_COLORS = {
  High: "bg-brand-danger/10 text-brand-danger",
  Medium: "bg-brand-yellow/15 text-[#B07E00]",
  Low: "bg-brand-green/10 text-brand-green",
};

const STATUS_COLORS = {
  Active: "bg-brand-blue/10 text-brand-blue",
  Inactive: "bg-brand-gray/10 text-brand-gray",
};

const PROGRAMS = [
  "Maternal Care",
  "Hypertension",
  "Diabetes",
  "TB Monitoring",
  "Senior Care",
  "Child Health",
  "Family Planning",
  "Nutrition",
];

const emptyForm = () => ({
  resident: "",
  age: "",
  sex: "Female",
  barangay: "",
  program: "Maternal Care",
  risk: "Low",
  status: "Active",
  notes: "",
});

export default function PhnHealthRecords() {
  const { user } = useAuth();
  const scope = getPHNScope(user);
  const phn = isPHN(user);
  // Seed from the subset this PHN is allowed to see; stats, search and
  // filters all operate on these rows only.
  const [records, setRecords] = useState(() => filterRowsByScope(RECORDS, user));
  const [searchQuery, setSearchQuery] = useState("");
  const [barangayFilter, setBarangayFilter] = useState("All");
  const [statusFilter, setStatusFilter] = useState("All");
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
      total: records.length,
      active: records.filter((r) => r.status === "Active").length,
      highRisk: records.filter((r) => r.risk === "High").length,
    }),
    [records]
  );

  const filtered = records.filter((r) => {
    const matchesSearch = searchQuery === "" || r.resident.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesBarangay = barangayFilter === "All" || (barangayFilter === "RHU" ? !r.barangay : r.barangay === barangayFilter);
    const matchesStatus = statusFilter === "All" || r.status === statusFilter;
    return matchesSearch && matchesBarangay && matchesStatus;
  });

  const validate = () => {
    const next = {};
    if (!form.resident.trim()) next.resident = "Resident name is required.";
    if (!form.barangay) next.barangay = "Scope is required.";
    if (!form.age || Number.isNaN(Number(form.age)) || Number(form.age) < 0) next.age = "A valid age is required.";
    if (!form.program) next.program = "Program is required.";
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleAdd = () => {
    if (!validate()) return;
    const newRecord = {
      id: records.reduce((acc, r) => Math.max(acc, r.id || 0), 0) + 1,
      recordNo: `HR-2026-${String(110 + records.length).padStart(4, "0")}`,
      resident: form.resident.trim(),
      age: Number(form.age),
      sex: form.sex,
      barangay: normalizeBarangay(form.barangay),
      program: form.program,
      risk: form.risk,
      status: form.status,
      lastVisit: new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }),
      notes: form.notes.trim(),
    };
    setRecords([newRecord, ...records]);
    setShowAddModal(false);
    setForm({ ...emptyForm(), barangay: phnDefaultBarangay(user) });
    setErrors({});
    showToast("Health record added successfully.");
  };

  const openEdit = (r) => {
    setSelected(r);
    setForm({
      resident: r.resident,
      age: String(r.age),
      sex: r.sex,
      barangay: r.barangay || "RHU",
      program: r.program,
      risk: r.risk,
      status: r.status,
      notes: r.notes || "",
    });
    setErrors({});
    setShowEditModal(true);
  };

  const handleEdit = () => {
    if (!validate()) return;
    setRecords((prev) =>
      prev.map((r) =>
        r.id === selected.id
          ? {
              ...r,
              ...form,
              resident: form.resident.trim(),
              age: Number(form.age),
              barangay: normalizeBarangay(form.barangay),
              notes: form.notes.trim(),
            }
          : r
      )
    );
    setShowEditModal(false);
    setSelected(null);
    setForm({ ...emptyForm(), barangay: phnDefaultBarangay(user) });
    setErrors({});
    showToast("Health record updated successfully.");
  };

  const handleConfirmDelete = () => {
    setRecords((prev) => prev.filter((r) => r.id !== selected.id));
    setShowDeleteConfirm(false);
    setSelected(null);
    showToast("Health record deleted successfully.");
  };

  const residentOptions = Array.from(
    new Set([...filterRowsByScope(phnResidents, user).map((r) => r.name), ...records.map((r) => r.resident)])
  ).sort();

  const formFields = (
    <>
      <div>
        <label className="text-sm font-medium text-brand-ink block mb-1.5">Resident Name <span className="text-brand-danger">*</span></label>
        <input
          type="text"
          list="phn-record-residents"
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
        <datalist id="phn-record-residents">
          {residentOptions.map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>
        {errors.resident && <p className="text-xs text-brand-danger mt-1">{errors.resident}</p>}
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="text-sm font-medium text-brand-ink block mb-1.5">Age <span className="text-brand-danger">*</span></label>
          <input
            type="number"
            min="0"
            placeholder="Age..."
            value={form.age}
            onChange={(e) => {
              setForm({ ...form, age: e.target.value });
              if (errors.age) setErrors((prev) => ({ ...prev, age: "" }));
            }}
            className={`w-full bg-white border rounded-btn px-3 py-2.5 text-sm outline-none focus:border-brand-blue ${
              errors.age ? "border-brand-danger" : "border-brand-border"
            }`}
          />
          {errors.age && <p className="text-xs text-brand-danger mt-1">{errors.age}</p>}
        </div>
        <div>
          <label className="text-sm font-medium text-brand-ink block mb-1.5">Sex</label>
          <select
            value={form.sex}
            onChange={(e) => setForm({ ...form, sex: e.target.value })}
            className="w-full bg-white border border-brand-border rounded-btn px-3 py-2.5 text-sm outline-none focus:border-brand-blue"
          >
            <option>Female</option>
            <option>Male</option>
          </select>
        </div>
      </div>
      <div>
          <label className="text-sm font-medium text-brand-ink block mb-1.5">Scope <span className="text-brand-danger">*</span></label>
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
          <label className="text-sm font-medium text-brand-ink block mb-1.5">Program <span className="text-brand-danger">*</span></label>
          <select
            value={form.program}
            onChange={(e) => setForm({ ...form, program: e.target.value })}
            className="w-full bg-white border border-brand-border rounded-btn px-3 py-2.5 text-sm outline-none focus:border-brand-blue"
          >
            {PROGRAMS.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-sm font-medium text-brand-ink block mb-1.5">Risk Level</label>
          <select
            value={form.risk}
            onChange={(e) => setForm({ ...form, risk: e.target.value })}
            className="w-full bg-white border border-brand-border rounded-btn px-3 py-2.5 text-sm outline-none focus:border-brand-blue"
          >
            <option>High</option>
            <option>Medium</option>
            <option>Low</option>
          </select>
        </div>
      </div>
      <div>
        <label className="text-sm font-medium text-brand-ink block mb-1.5">Status</label>
        <select
          value={form.status}
          onChange={(e) => setForm({ ...form, status: e.target.value })}
          className="w-full bg-white border border-brand-border rounded-btn px-3 py-2.5 text-sm outline-none focus:border-brand-blue"
        >
          <option>Active</option>
          <option>Inactive</option>
        </select>
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
        crumbs={["Home", "Health Records"]}
        title="Health Records"
        subtitle={
          phn && scope && scope.level === "barangay"
            ? `Health records for RHU-level residents and ${scope.assignedBarangay}.`
            : "Health records for RHU-level residents."
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
            <Plus className="w-4 h-4" /> Add Record
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
          { label: "Total Records", value: stats.total, tone: "bg-brand-blue/10 text-brand-blue" },
          { label: "Active", value: stats.active, tone: "bg-brand-green/10 text-brand-green" },
          { label: "High Risk", value: stats.highRisk, tone: "bg-brand-danger/10 text-brand-danger" },
        ].map((stat) => (
          <Card key={stat.label} className="p-5">
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${stat.tone}`}>
                <Search className="w-5 h-5" />
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
              <option value="Active">Active</option>
              <option value="Inactive">Inactive</option>
            </select>
          </div>
        </div>
      </Card>

      {/* Records Table */}
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-brand-bg border-b border-brand-border">
              <tr>
                <th className="text-left text-xs font-semibold text-brand-gray uppercase tracking-wide px-4 py-3">Resident</th>
                <th className="text-left text-xs font-semibold text-brand-gray uppercase tracking-wide px-4 py-3">Scope</th>
                <th className="text-left text-xs font-semibold text-brand-gray uppercase tracking-wide px-4 py-3">Program</th>
                <th className="text-left text-xs font-semibold text-brand-gray uppercase tracking-wide px-4 py-3">Last Visit</th>
                <th className="text-left text-xs font-semibold text-brand-gray uppercase tracking-wide px-4 py-3">Risk</th>
                <th className="text-left text-xs font-semibold text-brand-gray uppercase tracking-wide px-4 py-3">Status</th>
                <th className="text-left text-xs font-semibold text-brand-gray uppercase tracking-wide px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id} className="border-b border-brand-border hover:bg-brand-bg/50 transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-brand-blue text-white flex items-center justify-center text-xs font-semibold">
                        {r.resident.split(" ").map((n) => n[0]).slice(0, 2).join("")}
                      </div>
                      <div>
                        <p className="text-sm font-medium text-brand-ink">{r.resident}</p>
                        <p className="text-xs text-brand-gray">{r.sex} · {r.age}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm text-brand-ink">{scopeLabel(r, user)}</td>
                  <td className="px-4 py-3 text-sm text-brand-ink">{r.program}</td>
                  <td className="px-4 py-3 text-sm text-brand-ink whitespace-nowrap">{r.lastVisit}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${RISK_COLORS[r.risk]}`}>{r.risk}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${STATUS_COLORS[r.status]}`}>{r.status}</span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => {
                          setSelected(r);
                          setShowViewModal(true);
                        }}
                        className="p-1.5 text-brand-blue hover:bg-brand-light rounded transition-colors"
                        title="View"
                      >
                        <Eye className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => openEdit(r)}
                        className="p-1.5 text-brand-blue hover:bg-brand-light rounded transition-colors"
                        title="Edit"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => {
                          setSelected(r);
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
                  <td colSpan={7} className="px-4 py-10 text-center text-sm text-brand-gray">
                    No health records match the selected filters.
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
                <h3 className="text-lg font-semibold text-brand-ink">{showAddModal ? "Add Health Record" : "Edit Health Record"}</h3>
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
                  {showAddModal ? "Add Record" : "Save Changes"}
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
                <h3 className="text-base font-semibold text-brand-ink">Health Record Details</h3>
                <button onClick={() => setShowViewModal(false)} className="text-brand-gray hover:text-brand-ink">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="space-y-4">
                <div>
                  <h4 className="text-xs font-semibold text-brand-gray uppercase tracking-wide mb-3">Resident Information</h4>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <p className="text-brand-gray">Name: <span className="text-brand-ink">{selected.resident}</span></p>
                    <p className="text-brand-gray">Age: <span className="text-brand-ink">{selected.age}</span></p>
                    <p className="text-brand-gray">Sex: <span className="text-brand-ink">{selected.sex}</span></p>
                    <p className="text-brand-gray">Barangay: <span className="text-brand-ink">{scopeLabel(selected, user)}</span></p>
                  </div>
                </div>
                <div>
                  <h4 className="text-xs font-semibold text-brand-gray uppercase tracking-wide mb-3">Record Information</h4>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <p className="text-brand-gray">Record No.: <span className="text-brand-ink">{selected.recordNo}</span></p>
                    <p className="text-brand-gray">Program: <span className="text-brand-ink">{selected.program}</span></p>
                    <p className="text-brand-gray">Last Visit: <span className="text-brand-ink">{selected.lastVisit}</span></p>
                    <p className="text-brand-gray">Risk: <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${RISK_COLORS[selected.risk]}`}>{selected.risk}</span></p>
                    <p className="text-brand-gray">Status: <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[selected.status]}`}>{selected.status}</span></p>
                  </div>
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

      {/* Delete Confirmation */}
      {showDeleteConfirm && selected && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <Card className="w-full max-w-md">
            <div className="p-6">
              <div className="flex items-center gap-3 mb-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-danger/10 shrink-0">
                  <Trash2 className="h-5 w-5 text-brand-danger" />
                </div>
                <h3 className="text-lg font-semibold text-brand-ink">Delete this health record?</h3>
              </div>
              <p className="text-sm text-brand-gray">
                Record for {selected.resident} ({scopeLabel(selected, user)}) will be removed. This action cannot be undone.
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
