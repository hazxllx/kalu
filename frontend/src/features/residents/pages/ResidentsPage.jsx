import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Search, Plus, X, Eye, Pencil, CheckCircle2, ChevronDown, Users } from "lucide-react";
import PageHeader from "@/components/common/PageHeader";
import DataTable from "@/components/tables/DataTable";
import StatusBadge from "@/components/common/StatusBadge";
import SearchableSelect from "@/components/common/SearchableSelect";
import { Card } from "@/components/common/Card";
import EmptyState from "@/components/common/EmptyState";
import ErrorState from "@/components/common/ErrorState";
import { SkeletonList } from "@/components/common/Skeleton";
import { useAuth } from "@/context/AuthContext";
import { getSupervisorScope, HS_SCOPE } from "@/lib/supervisorScope";
import { residentsApi } from "@/services/api";
import { BARANGAYS } from "@/lib/barangays";

const CIVIL_STATUS_OPTIONS = ["Single", "Married", "Widowed", "Separated"];
const SEX_OPTIONS = ["Female", "Male"];
const SUFFIX_OPTIONS = ["", "Jr.", "Sr.", "II", "III", "IV"];
const VERIFICATION_OPTIONS = ["unverified", "pending", "verified", "rejected"];
const RELIGION_OPTIONS = ["Roman Catholic", "Protestant", "Iglesia ni Cristo", "Born Again", "Muslim", "Other"];

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

const fullNameOf = (r) => [r?.firstName, r?.middleName, r?.lastName, r?.suffix].filter(Boolean).join(" ");
const initialsOf = (name) =>
  String(name || "")
    .split(" ")
    .filter(Boolean)
    .map((n) => n[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

/** Compose the address line from the form's address parts. */
const composeAddress = (f) =>
  [f.houseNo, f.street, f.purok ? `Purok ${f.purok}` : "", f.barangay, "Pili, Camarines Sur"]
    .filter(Boolean)
    .join(", ");

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

function Field({ label, value, onChange, placeholder = "", error = "", type = "text", optional = false, readOnly = false }) {
  return (
    <div>
      <label className={labelClass}>{label}</label>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        readOnly={readOnly}
        onChange={(e) => onChange(e.target.value)}
        className={`${inputClass(error)} ${readOnly ? "bg-brand-bg text-brand-gray cursor-not-allowed" : ""}`}
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

/**
 * Resident Directory (Health Supervisor).
 *
 * Backed by the real API (GET/POST/PUT /api/residents): the list, search,
 * registration, and permitted demographic corrections all run against the
 * Supabase database with the caller's barangay scope enforced on the server.
 * Loading, error, and empty states are rendered from the request lifecycle —
 * no mock data is used.
 */
export default function ResidentsPage() {
  const { user } = useAuth();

  const [residents, setResidents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  const [q, setQ] = useState("");
  const [verificationFilter, setVerificationFilter] = useState("All");

  const [showAddModal, setShowAddModal] = useState(false);
  const [showViewModal, setShowViewModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [selected, setSelected] = useState(null);
  const [editTarget, setEditTarget] = useState(null);
  const [form, setForm] = useState(() => initialFromUser(user));
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState(null);
  const [editForm, setEditForm] = useState({ contact: "", barangay: "", civilStatus: "", currentAddress: "", philhealthNo: "", religion: "", employmentStatus: "", fatherName: "", motherName: "", birthPlace: "" });
  const [editErrors, setEditErrors] = useState({});
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [editError, setEditError] = useState(null);
  const [toast, setToast] = useState(null);

  const showToast = (message) => {
    setToast(message);
    setTimeout(() => setToast(null), 3200);
  };

  // The Resident Directory is owned by the Health Supervisor. Rows are scoped
  // to the supervisor's assigned barangay by the BACKEND (403 on any other
  // barangay); the scope here only drives the subtitle and the barangay picker.
  const scope = getSupervisorScope(user);
  const assignedBarangay = scope && scope.level === HS_SCOPE.BARANGAY ? scope.assignedBarangay : null;
  const allowedBarangays = assignedBarangay ? [assignedBarangay] : [...BARANGAYS];

  /** Load the directory from the API (search term is applied server-side). */
  const load = useCallback(
    async (searchTerm = "") => {
      setLoading(true);
      setLoadError(null);
      try {
        const result = await residentsApi.list({ q: searchTerm, limit: 100 });
        setResidents(result?.rows || []);
      } catch (err) {
        setResidents([]);
        setLoadError(err?.message || "Could not load the resident directory.");
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    load("");
  }, [load]);

  // Debounced server-side search.
  const debounceRef = useRef(null);
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      load(q.trim());
    }, 350);
    return () => clearTimeout(debounceRef.current);
  }, [q, load]);

  const rows = useMemo(() => {
    return residents
      .filter((r) => verificationFilter === "All" || (r.verificationStatus || "unverified") === verificationFilter)
      .map((r) => ({
        ...r,
        name: fullNameOf(r),
        age: calcAge(r.birthDate),
        gender: r.sex || "—",
        status: r.verificationStatus || "unverified",
      }));
  }, [residents, verificationFilter]);

  const openAdd = () => {
    setForm(initialFromUser(user));
    setErrors({});
    setFormError(null);
    setShowAddModal(true);
  };

  const openView = (resident) => {
    setSelected(resident);
    setShowViewModal(true);
  };

  /**
   * Open the Edit Resident modal (Health Supervisor, assigned barangay only).
   * Only the fields the API permits for correction are editable — identity
   * keys (name, birth date, sex) are locked and change through an admin.
   */
  const openEdit = (resident) => {
    setEditTarget(resident);
    setEditForm({
      contact: resident.cellphoneNo || "",
      barangay: resident.barangay || "",
      civilStatus: resident.civilStatus || "",
      currentAddress: resident.currentAddress || "",
      philhealthNo: resident.philhealthNo || "",
      religion: resident.religion || "",
      employmentStatus: resident.employmentStatus || "",
      fatherName: resident.fatherName || "",
      motherName: resident.motherName || "",
      birthPlace: resident.birthPlace || "",
    });
    setEditErrors({});
    setEditError(null);
    setShowEditModal(true);
  };

  const closeAdd = () => {
    setShowAddModal(false);
    setErrors({});
    setFormError(null);
  };

  const validate = () => {
    const errs = {};
    if (!form.firstName.trim()) errs.firstName = "First name is required";
    if (!form.lastName.trim()) errs.lastName = "Last name is required";
    if (!form.dob) errs.dob = "Date of birth is required";
    else if (new Date(form.dob) > new Date()) errs.dob = "Date of birth cannot be in the future";
    if (!form.gender) errs.gender = "Sex is required";
    if (!form.barangay) errs.barangay = "Barangay is required";
    if (form.contact && !/^[0-9+\-\s()]{7,20}$/.test(form.contact.trim())) {
      errs.contact = "Enter a valid contact number";
    }
    return errs;
  };

  const handleSubmit = async () => {
    const errs = validate();
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      return;
    }
    setSubmitting(true);
    setFormError(null);
    try {
      const payload = {
        firstName: form.firstName.trim(),
        middleName: form.middleName.trim(),
        lastName: form.lastName.trim(),
        suffix: form.suffix,
        birthDate: form.dob,
        sex: form.gender,
        civilStatus: form.civilStatus,
        barangay: form.barangay,
        cellphoneNo: form.contact.trim(),
        currentAddress: composeAddress(form),
        permanentAddress: composeAddress(form),
      };
      const result = await residentsApi.create({ resident: payload });
      setShowAddModal(false);
      setErrors({});
      const record = result?.resident;
      showToast(record ? `${fullNameOf(record)} added to the resident directory.` : "Resident added.");
      await load(q.trim());
      if (record) {
        setSelected({ ...record, name: fullNameOf(record), age: calcAge(record.birthDate), status: record.verificationStatus || "unverified" });
        setShowViewModal(true);
      }
    } catch (err) {
      // 422 details are the server's field-level validation list.
      if (err?.status === 422 && Array.isArray(err?.payload?.error?.details)) {
        setFormError(err.payload.error.details.join(" "));
      } else {
        setFormError(err?.message || "Could not register the resident. Please try again.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  const validateEdit = () => {
    const errs = {};
    if (!editForm.barangay) errs.barangay = "Barangay is required.";
    else if (!allowedBarangays.includes(editForm.barangay)) errs.barangay = "You can only edit residents within your assigned barangay.";
    if (editForm.contact && !/^[0-9+\-\s()]{7,20}$/.test(editForm.contact.trim())) errs.contact = "Enter a valid contact number.";
    return errs;
  };

  /** Save the permitted corrections through the API. */
  const handleEditSave = async () => {
    if (!validateEdit() || !editTarget) return;
    setEditSubmitting(true);
    setEditError(null);
    try {
      await residentsApi.update(editTarget.id, {
        resident: {
          cellphoneNo: editForm.contact.trim(),
          barangay: editForm.barangay,
          civilStatus: editForm.civilStatus,
          currentAddress: editForm.currentAddress.trim(),
          philhealthNo: editForm.philhealthNo.trim(),
          religion: editForm.religion,
          employmentStatus: editForm.employmentStatus,
          fatherName: editForm.fatherName.trim(),
          motherName: editForm.motherName.trim(),
          birthPlace: editForm.birthPlace.trim(),
        },
      });
      setShowEditModal(false);
      setEditTarget(null);
      showToast("Resident updated successfully.");
      await load(q.trim());
    } catch (err) {
      if (err?.status === 422 && Array.isArray(err?.payload?.error?.details)) {
        setEditError(err.payload.error.details.join(" "));
      } else {
        setEditError(err?.message || "Could not save the changes. Please try again.");
      }
    } finally {
      setEditSubmitting(false);
    }
  };

  const onDobChange = (value) => {
    setForm((p) => ({ ...p, dob: value, age: calcAge(value) || "" }));
    if (errors.dob) setErrors((p) => ({ ...p, dob: "" }));
  };

  const set = (key) => (value) => {
    setForm((p) => ({ ...p, [key]: value }));
    if (errors[key]) setErrors((p) => ({ ...p, [key]: "" }));
  };

  const columns = [
    { key: "name", label: "Resident" },
    { key: "age", label: "Age" },
    { key: "gender", label: "Sex" },
    { key: "barangay", label: "Barangay" },
    { key: "healthRecordNo", label: "Health Record No." },
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
          assignedBarangay
            ? `Search, filter, and manage residents in Barangay ${assignedBarangay}.`
            : "Search, filter, and manage residents in your area."
        }
        action={
          <button
            onClick={openAdd}
            className="flex items-center gap-2 bg-brand-blue text-white px-4 py-2.5 rounded-btn text-sm font-medium hover:bg-brand-dark transition-colors"
          >
            <Plus className="w-4 h-4" /> Add Resident
          </button>
        }
      />

      <Card className="p-4 mb-5 flex flex-col lg:flex-row gap-3">
        <div className="flex items-center gap-2 bg-brand-bg border border-brand-border rounded-btn px-3 py-2 flex-1">
          <Search className="w-4 h-4 text-brand-gray" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by name, health record no., PhilHealth, or contact..."
            className="bg-transparent text-sm outline-none w-full"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2 bg-brand-bg border border-brand-border rounded-btn px-3 py-2">
            <select
              value={verificationFilter}
              onChange={(e) => setVerificationFilter(e.target.value)}
              className="bg-transparent text-sm outline-none capitalize"
            >
              <option value="All">All Statuses</option>
              {VERIFICATION_OPTIONS.map((s) => <option key={s} value={s} className="capitalize">{s}</option>)}
            </select>
          </div>
        </div>
      </Card>

      {loadError && (
        <Card className="mb-5">
          <ErrorState
            title="Could not load the resident directory"
            message={loadError}
            onRetry={() => load(q.trim())}
          />
        </Card>
      )}

      {!loadError && loading && (
        <Card className="p-5">
          <SkeletonList rows={5} />
        </Card>
      )}

      {!loadError && !loading && rows.length === 0 && (
        <Card>
          <EmptyState
            icon={Users}
            title="No residents found"
            description={
              q.trim()
                ? `No residents match “${q.trim()}”. Try a different name, health record number, or clear the search.`
                : "The resident directory is empty. Register the first resident to get started."
            }
            action={
              q.trim() ? (
                <button
                  onClick={() => setQ("")}
                  className="rounded-btn bg-brand-blue px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-dark"
                >
                  Clear search
                </button>
              ) : undefined
            }
          />
        </Card>
      )}

      {!loadError && !loading && rows.length > 0 && (
        <>
          <DataTable
            columns={columns}
            rows={rows}
            renderCell={(key, row) => {
              if (key === "name")
                return (
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-full bg-brand-light text-brand-blue flex items-center justify-center text-xs font-semibold">
                      {initialsOf(row.name)}
                    </div>
                    <div>
                      <p className="font-medium text-brand-ink">{row.name}</p>
                      <p className="text-xs text-brand-gray">{row.id}</p>
                    </div>
                  </div>
                );
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
              return row[key] || "—";
            }}
          />
          <p className="mt-4 text-sm text-brand-gray">
            {rows.length === 0
              ? "No residents found."
              : `Showing ${rows.length} resident${rows.length === 1 ? "" : "s"}${
                  q.trim() ? ` matching “${q.trim()}”` : ""
                }`}
          </p>
        </>
      )}

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
              <p className="text-sm text-brand-gray mb-5">Register a new resident in the directory.</p>

              {formError && (
                <div className="mb-4 rounded-btn border border-brand-danger/30 bg-brand-danger/5 px-3.5 py-3 text-sm text-brand-danger">
                  {formError}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="First Name" value={form.firstName} onChange={set("firstName")} placeholder="e.g. Maria" error={errors.firstName} />
                <Field label="Middle Name" value={form.middleName} onChange={set("middleName")} placeholder="e.g. Santos" optional />
                <Field label="Last Name" value={form.lastName} onChange={set("lastName")} placeholder="e.g. Dela Cruz" error={errors.lastName} />
                <Select label="Suffix" value={form.suffix} onChange={set("suffix")} options={SUFFIX_OPTIONS.filter(Boolean)} placeholder="None" />

                <Field label="Date of Birth" type="date" value={form.dob} onChange={onDobChange} error={errors.dob} />
                <Field label="Age" value={form.age} onChange={() => {}} placeholder="Auto-calculated" readOnly optional />

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

                <Field label="Purok/Zone" value={form.purok} onChange={set("purok")} placeholder="e.g. Purok 5" optional />
                <Field label="Street / Sitio" value={form.street} onChange={set("street")} placeholder="Enter street or sitio" optional />
                <Field label="House No." value={form.houseNo} onChange={set("houseNo")} placeholder="Enter house number" optional />
              </div>

              <div className="flex justify-end gap-3 mt-6">
                <button onClick={closeAdd} className="px-4 py-2 rounded-btn text-sm font-medium text-brand-gray hover:bg-brand-bg transition-colors">
                  Cancel
                </button>
                <button
                  onClick={handleSubmit}
                  disabled={submitting}
                  className="flex items-center gap-2 px-4 py-2 rounded-btn text-sm font-medium bg-brand-blue text-white hover:bg-brand-dark transition-colors disabled:opacity-60"
                >
                  {submitting ? "Saving..." : "Add Resident"}
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
                    {initialsOf(selected.name)}
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
                  {detailCell("Sex", selected.sex || selected.gender)}
                  {detailCell("Civil Status", selected.civilStatus)}
                  {detailCell("Birthdate", selected.birthDate)}
                  {detailCell("Barangay", selected.barangay)}
                  {detailCell("Contact Number", selected.cellphoneNo)}
                  {detailCell("Address", selected.currentAddress)}
                  {detailCell("PhilHealth No.", selected.philhealthNo)}
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-5 mb-6">
                <p className="text-xs font-semibold text-brand-gray uppercase tracking-wide mb-3">Record Information</p>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                  <div>
                    <p className="text-[11px] text-brand-gray uppercase tracking-wide">Health Record No.</p>
                    <p className="mt-0.5 text-sm font-medium text-brand-ink">{selected.healthRecordNo || "—"}</p>
                  </div>
                  <div>
                    <p className="text-[11px] text-brand-gray uppercase tracking-wide">Verification Status</p>
                    <div className="mt-1"><StatusBadge value={selected.status} /></div>
                  </div>
                  <div>
                    <p className="text-[11px] text-brand-gray uppercase tracking-wide">Registered</p>
                    <p className="mt-0.5 text-sm font-medium text-brand-ink">
                      {selected.createdAt ? new Date(selected.createdAt).toLocaleDateString() : "—"}
                    </p>
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

      {/* Edit Resident Modal (Health Supervisor, assigned barangay only).
          Edits are limited to the fields the API permits for correction —
          identity fields (name, birth date, sex) are locked by design. */}
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

              {editError && (
                <div className="mb-4 rounded-btn border border-brand-danger/30 bg-brand-danger/5 px-3.5 py-3 text-sm text-brand-danger">
                  {editError}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2">
                  <Field label="Full Name" value={editTarget.name || ""} onChange={() => {}} placeholder="" readOnly optional />
                  <p className="mt-1 text-xs text-brand-gray">Identity corrections go through an administrator.</p>
                </div>
                <Field label="Contact Number" value={editForm.contact} onChange={(v) => { setEditForm((p) => ({ ...p, contact: v })); if (editErrors.contact) setEditErrors((p) => ({ ...p, contact: "" })); }} placeholder="e.g. 0917 123 4567" error={editErrors.contact} optional />
                <Select label="Civil Status" value={editForm.civilStatus} onChange={(v) => setEditForm((p) => ({ ...p, civilStatus: v }))} options={CIVIL_STATUS_OPTIONS} placeholder="Select civil status" />
                <SearchableSelect
                  label="Barangay"
                  required
                  value={editForm.barangay}
                  onChange={(v) => { setEditForm((p) => ({ ...p, barangay: v })); if (editErrors.barangay) setEditErrors((p) => ({ ...p, barangay: "" })); }}
                  options={allowedBarangays}
                  placeholder="Search barangay..."
                  emptyText="No barangay found."
                  error={editErrors.barangay}
                />
                <Select label="Religion" value={editForm.religion} onChange={(v) => setEditForm((p) => ({ ...p, religion: v }))} options={RELIGION_OPTIONS} placeholder="Select religion" />
                <Field label="Birth Place" value={editForm.birthPlace} onChange={(v) => setEditForm((p) => ({ ...p, birthPlace: v }))} placeholder="e.g. Pili, Camarines Sur" optional />
                <Field label="Employment Status" value={editForm.employmentStatus} onChange={(v) => setEditForm((p) => ({ ...p, employmentStatus: v }))} placeholder="e.g. Employed" optional />
                <Field label="PhilHealth No." value={editForm.philhealthNo} onChange={(v) => setEditForm((p) => ({ ...p, philhealthNo: v }))} placeholder="e.g. 12-345678901-2" optional />
                <Field label="Father's Name" value={editForm.fatherName} onChange={(v) => setEditForm((p) => ({ ...p, fatherName: v }))} placeholder="Enter father's name" optional />
                <Field label="Mother's Name" value={editForm.motherName} onChange={(v) => setEditForm((p) => ({ ...p, motherName: v }))} placeholder="Enter mother's name" optional />
                <div className="sm:col-span-2">
                  <Field label="Address" value={editForm.currentAddress} onChange={(v) => setEditForm((p) => ({ ...p, currentAddress: v }))} placeholder="House no., street, purok, barangay" optional />
                </div>
              </div>

              <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-brand-border">
                <button onClick={() => setShowEditModal(false)} className="px-4 py-2 rounded-btn text-sm font-medium text-brand-gray hover:bg-brand-bg transition-colors">
                  Cancel
                </button>
                <button
                  onClick={handleEditSave}
                  disabled={editSubmitting}
                  className="flex items-center gap-2 px-4 py-2 rounded-btn text-sm font-medium bg-brand-blue text-white hover:bg-brand-dark transition-colors disabled:opacity-60"
                >
                  <CheckCircle2 className="w-4 h-4" /> {editSubmitting ? "Saving..." : "Save Changes"}
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
