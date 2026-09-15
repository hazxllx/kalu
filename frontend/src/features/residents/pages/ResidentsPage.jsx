import React, { useMemo, useState } from "react";
import { Search, Download, Plus, X, Eye, Pencil, CheckCircle2, ChevronDown } from "lucide-react";
import PageHeader from "@/components/common/PageHeader";
import DataTable from "@/components/tables/DataTable";
import StatusBadge from "@/components/common/StatusBadge";
import SearchableSelect from "@/components/common/SearchableSelect";
import { Card } from "@/components/common/Card";
import { useAuth } from "@/context/AuthContext";
import { auditStore } from "@/services/mock/auditStore";
import { getSupervisorScope, HS_SCOPE } from "@/lib/supervisorScope";
import {
  useResidents,
  residentStore,
  PROGRAM_OPTIONS,
  BARANGAYS,
} from "@/services/mock/residentStore";
import { PUROKS } from "@/features/households/lib/householdOptions";

const RISK_OPTIONS = ["Low", "Medium", "High"];
const STATUS_OPTIONS = ["Active", "Inactive"];
const CIVIL_STATUS_OPTIONS = ["Single", "Married", "Widowed", "Separated"];
const SEX_OPTIONS = ["Female", "Male", "Other"];
const SUFFIX_OPTIONS = ["", "Jr.", "Sr.", "II", "III", "IV"];

const EMPTY_FORM = {
  firstName: "",
  middleName: "",
  lastName: "",
  suffix: "",
  dob: "",
  age: "",
  gender: "",
  contact: "",
  purok: "",
  street: "",
  houseNo: "",
  barangay: "",
  civilStatus: "",
  program: "",
  status: "Active",
};

const inputClass = (invalid) =>
  `mt-1.5 w-full bg-white border px-3.5 py-2.5 text-sm outline-none transition-colors rounded-input ${
    invalid ? "border-brand-danger focus:border-brand-danger" : "border-brand-border focus:border-brand-blue"
  }`;

const labelClass = "text-sm font-medium text-brand-ink";
const errorClass = "mt-1 text-xs text-brand-danger";

const calcAge = (dob) => {
  if (!dob) return "";
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) return "";
  const age = Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24 * 365.25));
  return age >= 0 && age < 120 ? String(age) : "";
};

function Select({ label, value, onChange, options = [], placeholder = "", error = "", emptyLabel = "", children = null }) {
  return (
    <div>
      <label className={labelClass}>{label}</label>
      <div className="relative">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={`${inputClass(error)} appearance-none pr-9 cursor-pointer`}
        >
          {placeholder && <option value="">{placeholder}</option>}
          {options.map((o) => (
            <option key={o} value={o}>{o === "" ? emptyLabel : o}</option>
          ))}
          {children}
        </select>
        <ChevronDown className="w-4 h-4 text-brand-gray absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
      </div>
      {error && <p className={errorClass}>{error}</p>}
    </div>
  );
}

function Field({ label, value, onChange, placeholder = "", error = "", type = "text", optional = false }) {
  return (
    <div>
      <label className={labelClass}>{label}</label>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={inputClass(error)}
      />
      {optional && !error && <p className="mt-1 text-xs text-brand-gray">(Optional)</p>}
      {error && <p className={errorClass}>{error}</p>}
    </div>
  );
}

const initialFromUser = (user) => {
  const assigned = user?.assignedBarangay || user?.barangay || "";
  return { ...EMPTY_FORM, barangay: assigned };
};

export default function ResidentsPage() {
  const { user } = useAuth();
  const residents = useResidents();

  const [q, setQ] = useState("");
  const [programFilter, setProgramFilter] = useState("All");
  const [riskFilter, setRiskFilter] = useState("All");
  const [statusFilter, setStatusFilter] = useState("All");

  const [showAddModal, setShowAddModal] = useState(false);
  const [showViewModal, setShowViewModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [selected, setSelected] = useState(null);
  const [editTarget, setEditTarget] = useState(null); // resident being edited
  const [form, setForm] = useState(() => initialFromUser(user));
  const [editForm, setEditForm] = useState({ name: "", contact: "", barangay: "", birthdate: "", gender: "", civilStatus: "", program: "", purok: "", street: "", houseNo: "" });
  const [editErrors, setEditErrors] = useState({});
  const [toast, setToast] = useState(null);

  const programOptions = useMemo(() => {
    const used = Array.from(new Set(residents.map((r) => r.program).filter(Boolean)));
    return Array.from(new Set([...PROGRAM_OPTIONS, ...used]));
  }, [residents]);

  // The Resident Directory is owned by the Health Supervisor. Its rows are
  // always scoped to the supervisor's assigned barangay — no cross-barangay
  // data is shown and no barangay picker is offered.
  const scope = getSupervisorScope(user);
  const scopedBarangays = scope && scope.level === HS_SCOPE.BARANGAY
    ? [scope.assignedBarangay]
    : [...BARANGAYS];

  const scopedResidents = useMemo(
    () => residents.filter((r) => scopedBarangays.includes(r.barangay)),
    [residents, scopedBarangays]
  );

  const allowedBarangays = scopedBarangays;

  const showToast = (message) => {
    setToast(message);
    setTimeout(() => setToast(null), 3200);
  };

  const rows = scopedResidents.filter((r) => {
    const term = q.trim().toLowerCase();
    const matchesQ =
      term === "" ||
      (r.name || "").toLowerCase().includes(term) ||
      (r.barangay || "").toLowerCase().includes(term) ||
      (r.id || "").toLowerCase().includes(term);
    const matchesProgram = programFilter === "All" || r.program === programFilter;
    const matchesRisk = riskFilter === "All" || r.risk === riskFilter;
    const matchesStatus = statusFilter === "All" || r.status === statusFilter;
    return matchesQ && matchesProgram && matchesRisk && matchesStatus;
  });

  const openAdd = () => {
    setForm(initialFromUser(user));
    setErrors({});
    setShowAddModal(true);
  };

  const openView = (resident) => {
    setSelected(resident);
    setShowViewModal(true);
  };

  /**
   * Open the Edit Resident modal (Health Supervisor, assigned barangay only).
   * Pre-fills the editable demographic fields from the existing record.
   */
  const openEdit = (resident) => {
    setEditTarget(resident);
    setEditForm({
      name: resident.name || "",
      contact: resident.contact || "",
      barangay: resident.barangay || "",
      birthdate: resident.birthdate || "",
      gender: resident.gender || "",
      civilStatus: resident.civilStatus || "",
      program: resident.program || "",
      purok: resident.purok || "",
      street: resident.street || "",
      houseNo: resident.houseNo || "",
    });
    setEditErrors({});
    setShowEditModal(true);
  };

  // Validate the edit form; the barangay must stay within the supervisor's scope.
  const validateEdit = () => {
    const errs = {};
    if (!editForm.name.trim()) errs.name = "Full name is required.";
    if (!editForm.barangay) errs.barangay = "Barangay is required.";
    else if (!allowedBarangays.includes(editForm.barangay)) errs.barangay = "You can only edit residents within your assigned barangay.";
    if (editForm.contact && !/^[0-9+\-\s()]{7,20}$/.test(editForm.contact.trim())) errs.contact = "Enter a valid contact number.";
    if (editForm.birthdate) {
      const d = new Date(editForm.birthdate);
      if (Number.isNaN(d.getTime()) || d > new Date()) errs.birthdate = "Enter a valid birth date.";
    }
    setEditErrors(errs);
    return Object.keys(errs).length === 0;
  };

  /** Save the resident edit to the shared store and record an audit entry. */
  const handleEditSave = () => {
    if (!validateEdit() || !editTarget) return;
    residentStore.updateResident(editTarget.id, {
      name: editForm.name.trim(),
      contact: editForm.contact.trim(),
      barangay: editForm.barangay,
      birthdate: editForm.birthdate,
      gender: editForm.gender,
      civilStatus: editForm.civilStatus,
      program: editForm.program,
      purok: editForm.purok,
      street: editForm.street,
      houseNo: editForm.houseNo,
    });
    auditStore.addEvent({
      user: user?.name || "Health Supervisor",
      role: "Health Supervisor",
      action: "Resident updated",
      description: `Updated resident record ${editTarget.id} (${editForm.name.trim()}).`,
    });
    setShowEditModal(false);
    setEditTarget(null);
    showToast("Resident updated successfully.");
  };

  const closeAdd = () => {
    setShowAddModal(false);
    setErrors({});
  };

  const validate = () => {
    const errs = {};
    if (!form.firstName.trim()) errs.firstName = "First name is required";
    if (!form.lastName.trim()) errs.lastName = "Last name is required";
    const age = calcAge(form.dob) || form.age;
    if (!age) errs.age = "Age is required (or enter a date of birth)";
    else if (!/^\d+$/.test(String(age).trim()) || Number(age) <= 0 || Number(age) >= 120) {
      errs.age = "Enter a valid age";
    }
    if (!form.gender) errs.gender = "Sex is required";
    if (!form.barangay) errs.barangay = "Barangay is required";
    if (!form.purok) errs.purok = "Purok/Zone is required";
    if (!form.program) errs.program = "Health program is required";
    if (form.contact && !/^[0-9+\-\s()]{7,20}$/.test(form.contact.trim())) {
      errs.contact = "Enter a valid contact number";
    }
    return errs;
  };

  const handleSubmit = () => {
    const errs = validate();
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      return;
    }
    const record = residentStore.addResident({
      ...form,
      age: calcAge(form.dob) || form.age,
      firstName: form.firstName.trim(),
      middleName: form.middleName.trim(),
      lastName: form.lastName.trim(),
      suffix: form.suffix,
    });
    setShowAddModal(false);
    setErrors({});
    setSelected(record);
    showToast(`${record.name} added to the resident directory.`);
  };

  const onDobChange = (value) => {
    setForm((p) => {
      const age = calcAge(value);
      return { ...p, dob: value, age: age || p.age };
    });
    if (errors.dob) setErrors((p) => ({ ...p, dob: "" }));
  };

  const set = (key) => (value) => {
    setForm((p) => ({ ...p, [key]: value }));
    if (errors[key]) setErrors((p) => ({ ...p, [key]: "" }));
  };

  const columns = [
    { key: "name", label: "Resident" },
    { key: "age", label: "Age" },
    { key: "gender", label: "Gender" },
    { key: "program", label: "Program" },
    { key: "risk", label: "Risk" },
    { key: "barangay", label: "Barangay" },
    { key: "status", label: "Status" },
    { key: "actions", label: "" },
  ];

  const detailCell = (label, value) => (
    <div>
      <p className="text-[11px] text-brand-gray uppercase tracking-wide">{label}</p>
      <p className="mt-0.5 text-sm font-medium text-brand-ink">{value || "—"}</p>
    </div>
  );

  return (
    <>
      <PageHeader
        crumbs={["Residents"]}
        title="Resident Directory"
        subtitle={
          scope && scope.level === HS_SCOPE.BARANGAY
            ? `Search, filter, and manage residents in Barangay ${scope.assignedBarangay}.`
            : "Search, filter, and manage residents in your area."
        }
        action={
          <div className="flex items-center gap-3">
            <button className="hidden sm:flex items-center gap-2 border border-brand-border bg-white px-4 py-2.5 rounded-btn text-sm font-medium text-brand-ink hover:border-brand-blue transition-colors">
              <Download className="w-4 h-4" /> Export
            </button>
            <button
              onClick={openAdd}
              className="flex items-center gap-2 bg-brand-blue text-white px-4 py-2.5 rounded-btn text-sm font-medium hover:bg-brand-dark transition-colors"
            >
              <Plus className="w-4 h-4" /> Add Resident
            </button>
          </div>
        }
      />

      <Card className="p-4 mb-5 flex flex-col lg:flex-row gap-3">
        <div className="flex items-center gap-2 bg-brand-bg border border-brand-border rounded-btn px-3 py-2 flex-1">
          <Search className="w-4 h-4 text-brand-gray" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by name, barangay, or ID..."
            className="bg-transparent text-sm outline-none w-full"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2 bg-brand-bg border border-brand-border rounded-btn px-3 py-2">
            <select
              value={programFilter}
              onChange={(e) => setProgramFilter(e.target.value)}
              className="bg-transparent text-sm outline-none"
            >
              <option>All</option>
              {programOptions.map((p) => <option key={p}>{p}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-2 bg-brand-bg border border-brand-border rounded-btn px-3 py-2">
            <select
              value={riskFilter}
              onChange={(e) => setRiskFilter(e.target.value)}
              className="bg-transparent text-sm outline-none"
            >
              {["All", ...RISK_OPTIONS].map((r) => <option key={r}>{r}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-2 bg-brand-bg border border-brand-border rounded-btn px-3 py-2">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="bg-transparent text-sm outline-none"
            >
              {["All", ...STATUS_OPTIONS].map((s) => <option key={s}>{s}</option>)}
            </select>
          </div>
        </div>
      </Card>

      <DataTable
        columns={columns}
        rows={rows}
        renderCell={(key, row) => {
          if (key === "name")
            return (
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-brand-light text-brand-blue flex items-center justify-center text-xs font-semibold">
                  {residentStore.initialsOf(row.name)}
                </div>
                <div>
                  <p className="font-medium text-brand-ink">{row.name}</p>
                  <p className="text-xs text-brand-gray">{row.id}</p>
                </div>
              </div>
            );
          if (key === "risk") return <StatusBadge value={row.risk} />;
          if (key === "status") return <StatusBadge value={row.status} />;
          if (key === "actions")
            return (
              <div className="flex gap-3">
                <button
                  onClick={() => openView(row)}
                  className="flex items-center gap-1 text-brand-blue text-sm font-medium hover:underline"
                >
                  <Eye className="w-4 h-4" /> View
                </button>
                <button
                  onClick={() => openEdit(row)}
                  className="flex items-center gap-1 text-brand-gray text-sm font-medium hover:underline"
                >
                  <Pencil className="w-4 h-4" /> Edit
                </button>
              </div>
            );
          return row[key];
        }}
      />
      <p className="mt-4 text-sm text-brand-gray">
        Showing {rows.length} of {scopedResidents.length} residents
      </p>

      {/* Add Resident Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <Card className="w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex items-center justify-between mb-1">
                <h3 className="text-lg font-semibold text-brand-ink">Add Resident</h3>
                <button onClick={closeAdd} className="text-brand-gray hover:text-brand-ink">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <p className="text-sm text-brand-gray mb-5">Record a new resident in the directory.</p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="First Name" value={form.firstName} onChange={set("firstName")} placeholder="e.g. Maria" error={errors.firstName} />
                <Field label="Middle Name" value={form.middleName} onChange={set("middleName")} placeholder="e.g. Santos" optional />
                <Field label="Last Name" value={form.lastName} onChange={set("lastName")} placeholder="e.g. Dela Cruz" error={errors.lastName} />
                <Select label="Suffix" value={form.suffix} onChange={set("suffix")} options={SUFFIX_OPTIONS.filter(Boolean)} placeholder="None" />

                <Field label="Date of Birth" type="date" value={form.dob} onChange={onDobChange} optional />
                <Field label="Age" value={form.age} onChange={set("age")} placeholder="Years" error={errors.age} />

                <Select label="Sex" value={form.gender} onChange={set("gender")} options={SEX_OPTIONS} placeholder="Select sex" error={errors.gender} />
                <Select label="Civil Status" value={form.civilStatus} onChange={set("civilStatus")} options={CIVIL_STATUS_OPTIONS} placeholder="Select civil status" />

                <Field label="Contact Number" value={form.contact} onChange={set("contact")} placeholder="e.g. 0917 123 4567" error={errors.contact} optional />
                <SearchableSelect
                  label="Barangay"
                  required
                  value={form.barangay}
                  onChange={set("barangay")}
                  options={allowedBarangays}
                  placeholder="Search barangay..."
                  emptyText="No barangay found."
                  error={errors.barangay}
                />

                <SearchableSelect
                  label="Purok/Zone"
                  required
                  value={form.purok}
                  onChange={set("purok")}
                  options={PUROKS}
                  placeholder="Search or select purok/zone..."
                  emptyText="No purok/zone found."
                  error={errors.purok}
                />
                <Field label="Street / Sitio" value={form.street} onChange={set("street")} placeholder="Enter street or sitio" optional />

                <Field label="House No." value={form.houseNo} onChange={set("houseNo")} placeholder="Enter house number" optional />
                <Select label="Health Program" value={form.program} onChange={set("program")} options={programOptions} placeholder="Select program" error={errors.program} />
              </div>

              <div className="flex justify-end gap-3 mt-6">
                <button onClick={closeAdd} className="px-4 py-2 rounded-btn text-sm font-medium text-brand-gray hover:bg-brand-bg transition-colors">
                  Cancel
                </button>
                <button
                  onClick={handleSubmit}
                  className="px-4 py-2 rounded-btn text-sm font-medium bg-brand-blue text-white hover:bg-brand-dark transition-colors"
                >
                  Add Resident
                </button>
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* View Resident Modal */}
      {showViewModal && selected && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <Card className="w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex items-start justify-between mb-5">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-full bg-brand-light text-brand-blue flex items-center justify-center text-sm font-semibold">
                    {residentStore.initialsOf(selected.name)}
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-brand-ink">{selected.name}</h3>
                    <p className="text-xs text-brand-gray">{selected.id}</p>
                  </div>
                </div>
                <button onClick={() => setShowViewModal(false)} className="text-brand-gray hover:text-brand-ink">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-5 mb-4">
                <p className="text-xs font-semibold text-brand-gray uppercase tracking-wide mb-3">Demographics</p>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                  {detailCell("Age", selected.age)}
                  {detailCell("Sex", selected.gender)}
                  {detailCell("Civil Status", selected.civilStatus)}
                  {detailCell("Birthdate", selected.birthdate)}
                  {detailCell("Barangay", selected.barangay)}
                  {detailCell("Contact Number", selected.contact)}
                  {detailCell("Address", selected.address)}
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-5 mb-6">
                <p className="text-xs font-semibold text-brand-gray uppercase tracking-wide mb-3">Health Information</p>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                  <div>
                    <p className="text-[11px] text-brand-gray uppercase tracking-wide">Health Program</p>
                    <p className="mt-0.5 text-sm font-medium text-brand-ink">{selected.program || "—"}</p>
                  </div>
                  <div>
                    <p className="text-[11px] text-brand-gray uppercase tracking-wide">Risk Level</p>
                    <div className="mt-1"><StatusBadge value={selected.risk} /></div>
                  </div>
                  <div>
                    <p className="text-[11px] text-brand-gray uppercase tracking-wide">Status</p>
                    <div className="mt-1"><StatusBadge value={selected.status} /></div>
                  </div>
                </div>
              </div>

              <div className="flex justify-end gap-3">
                <button
                  onClick={() => setShowViewModal(false)}
                  className="px-4 py-2 rounded-btn text-sm font-medium text-brand-gray hover:bg-brand-bg transition-colors"
                >
                  Close
                </button>
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* Edit Resident Modal (Health Supervisor, assigned barangay only) */}
      {showEditModal && editTarget && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <Card className="w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h3 className="text-lg font-semibold text-brand-ink">Edit Resident</h3>
                  <p className="text-sm text-brand-gray mt-0.5">
                    {editTarget.id} · updates are limited to your assigned barangay.
                  </p>
                </div>
                <button onClick={() => setShowEditModal(false)} className="text-brand-gray hover:text-brand-ink" aria-label="Close">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2">
                  <Field label="Full Name" value={editForm.name} onChange={(v) => { setEditForm((p) => ({ ...p, name: v })); if (editErrors.name) setEditErrors((p) => ({ ...p, name: "" })); }} placeholder="e.g. Maria Santos" error={editErrors.name} />
                </div>
                <Field label="Contact Number" value={editForm.contact} onChange={(v) => { setEditForm((p) => ({ ...p, contact: v })); if (editErrors.contact) setEditErrors((p) => ({ ...p, contact: "" })); }} placeholder="e.g. 0917 123 4567" error={editErrors.contact} optional />
                <Field label="Birth Date" type="date" value={editForm.birthdate} onChange={(v) => { setEditForm((p) => ({ ...p, birthdate: v })); if (editErrors.birthdate) setEditErrors((p) => ({ ...p, birthdate: "" })); }} error={editErrors.birthdate} optional />
                <Select label="Sex" value={editForm.gender} onChange={(v) => setEditForm((p) => ({ ...p, gender: v }))} options={SEX_OPTIONS} placeholder="Select sex" />
                <Select label="Civil Status" value={editForm.civilStatus} onChange={(v) => setEditForm((p) => ({ ...p, civilStatus: v }))} options={CIVIL_STATUS_OPTIONS} placeholder="Select civil status" />
                <Select label="Barangay" value={editForm.barangay} onChange={(v) => { setEditForm((p) => ({ ...p, barangay: v })); if (editErrors.barangay) setEditErrors((p) => ({ ...p, barangay: "" })); }} options={allowedBarangays} placeholder="Select barangay" error={editErrors.barangay} />
                <Select label="Purok/Zone" value={editForm.purok} onChange={(v) => setEditForm((p) => ({ ...p, purok: v }))} options={PUROKS} placeholder="Select purok" />
                <Select label="Health Program" value={editForm.program} onChange={(v) => setEditForm((p) => ({ ...p, program: v }))} options={programOptions} placeholder="Select program" />
                <Field label="Street / Sitio" value={editForm.street} onChange={(v) => setEditForm((p) => ({ ...p, street: v }))} placeholder="Enter street or sitio" optional />
                <Field label="House No." value={editForm.houseNo} onChange={(v) => setEditForm((p) => ({ ...p, houseNo: v }))} placeholder="Enter house number" optional />
              </div>

              <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-brand-border">
                <button onClick={() => setShowEditModal(false)} className="px-4 py-2 rounded-btn text-sm font-medium text-brand-gray hover:bg-brand-bg transition-colors">
                  Cancel
                </button>
                <button
                  onClick={handleEditSave}
                  className="flex items-center gap-2 px-4 py-2 rounded-btn text-sm font-medium bg-brand-blue text-white hover:bg-brand-dark transition-colors"
                >
                  <CheckCircle2 className="w-4 h-4" /> Save Changes
                </button>
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-4 right-4 bg-brand-ink text-white px-4 py-3 rounded-btn shadow-lg flex items-center gap-2 z-50 animate-in slide-in-from-bottom-2">
          <CheckCircle2 className="w-4 h-4 text-brand-green" />
          <span className="text-sm">{toast}</span>
        </div>
      )}
    </>
  );
}
